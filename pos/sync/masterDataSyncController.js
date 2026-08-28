const { pullMasterData, pullAllMaster } = require('./masterDataSyncService');
const { ingestMasterData } = require('./masterDataIngestService');

function errorStatus(code) {
  if (code === 'CURSOR_INVALID') return 409;
  if (code === 'VALIDATION') return 400;
  if (code === 'OFFLINE') return 503;
  return 500;
}

function isRetryable(code) {
  return code !== 'CURSOR_INVALID' && code !== 'VALIDATION' && code !== 'OFFLINE';
}

const getMasterData = async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION',
        message: 'Company context is required',
      });
    }

    const data = await pullMasterData({
      companyId,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    const code = err.code || 'SERVER_ERROR';
    const retryable = isRetryable(code);
    return res.status(errorStatus(code)).json({
      success: false,
      code,
      retryable,
      message: err.message || 'Master data sync failed',
    });
  }
};

/**
 * Phase 1 (Local -> Cloud): accept records created/edited on the client while
 * offline, upsert them into the cloud keyed by a stable `syncId`, and return the
 * `syncId -> cloudId` mapping so the client can mark records as synced.
 */
const pushMasterData = async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.id;
    if (!companyId || !userId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION',
        message: 'Company and user context are required',
      });
    }

    const records = req.body?.records;
    if (!records) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION',
        message: 'records (categories, subcategories, products) are required in the request body',
      });
    }

    const result = await ingestMasterData({ companyId, userId, records });

    return res.status(200).json({
      success: true,
      syncId: require('crypto').randomUUID(),
      direction: 'local->cloud',
      data: {
        pushed: result.pushed,
        mapping: result.mapping,
        summary: result.summary,
      },
    });
  } catch (err) {
    const code = err.code || 'SERVER_ERROR';
    return res.status(errorStatus(code)).json({
      success: false,
      code,
      retryable: isRetryable(code),
      message: err.message || 'Master data push failed',
    });
  }
};

/**
 * Combined bidirectional sync (Local -> Cloud -> Local) for the "Sync" button:
 *   1. Push client's pending local records to the cloud.
 *   2. Pull the latest merged cloud state so the client can merge it locally.
 */
const postMasterDataSync = async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.id;
    if (!companyId || !userId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION',
        message: 'Company and user context are required',
      });
    }

    const records = req.body?.records || {};
    const ingest = Object.keys(records).length
      ? await ingestMasterData({ companyId, userId, records })
      : { pushed: { categories: [], subcategories: [], products: [], failed: [] }, mapping: {}, summary: {} };

    const latest = await pullAllMaster(companyId, { limit: 200 });

    return res.status(200).json({
      success: true,
      syncId: require('crypto').randomUUID(),
      data: {
        phase: {
          push: ingest.summary,
          pull: true,
        },
        pushed: ingest.pushed,
        mapping: ingest.mapping,
        categories: latest.categories,
        subcategories: latest.subcategories,
        products: latest.products,
      },
    });
  } catch (err) {
    const code = err.code || 'SERVER_ERROR';
    return res.status(errorStatus(code)).json({
      success: false,
      code,
      retryable: isRetryable(code),
      message: err.message || 'Bidirectional sync failed',
    });
  }
};

module.exports = { getMasterData, pushMasterData, postMasterDataSync };
