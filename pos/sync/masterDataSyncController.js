const { pullMasterData } = require('./masterDataSyncService');

function errorStatus(code) {
  if (code === 'CURSOR_INVALID') return 409;
  if (code === 'VALIDATION') return 400;
  return 500;
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
    const retryable = code !== 'CURSOR_INVALID' && code !== 'VALIDATION';
    return res.status(errorStatus(code)).json({
      success: false,
      code,
      retryable,
      message: err.message || 'Master data sync failed',
    });
  }
};

module.exports = { getMasterData };
