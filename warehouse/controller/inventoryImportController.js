const multer = require('multer');
const {
  createPreviewFromFile,
  executeImport,
  buildTemplateBuffer,
  getBatch,
  listBatches,
} = require('../services/inventoryImportService');
const {
  getOrCreateInventorySettings,
  updateInventorySettings,
} = require('../services/inventorySettingsService');
const { listUoms, listConversions, ensureDefaultUoms } = require('../services/uomService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // hard cap; settings enforce lower
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const ok =
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      name.endsWith('.csv') ||
      [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/csv',
        'application/csv',
      ].includes(file.mimetype);
    if (!ok) {
      return cb(new Error('Only .xlsx, .xls, or .csv files are allowed'));
    }
    cb(null, true);
  },
});

function companyIdOf(req) {
  return req.user?.companyId;
}

// GET /api/warehouse/inventory/import/template
const downloadTemplate = async (_req, res) => {
  try {
    const buf = await buildTemplateBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Factory_ERP_Inventory_Import.xlsx"'
    );
    return res.send(buf);
  } catch (err) {
    console.error('downloadTemplate', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/warehouse/inventory/import/preview
const previewImport = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'File is required' });
    }

    const duplicateSkuMode = String(req.body.duplicateSkuMode || 'skip').toLowerCase();
    const createMissingMasters =
      String(req.body.createMissingMasters || 'false').toLowerCase() === 'true';
    const forceReimport =
      String(req.body.forceReimport || 'false').toLowerCase() === 'true';
    const openingDate = req.body.openingDate || null;

    const result = await createPreviewFromFile({
      companyId,
      userId: req.user.id,
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      duplicateSkuMode,
      createMissingMasters,
      openingDate,
      forceReimport,
    });

    if (result.duplicateFile) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_IMPORT_FILE',
        message: result.message,
        data: result.priorBatch,
      });
    }

    return res.json({
      success: true,
      message: 'Import preview ready',
      data: result,
    });
  } catch (err) {
    console.error('previewImport', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Preview failed',
    });
  }
};

// POST /api/warehouse/inventory/import/:batchId/confirm
// Returns immediately (202) and runs import in the background — large files exceed proxy timeouts.
const confirmImport = async (req, res) => {
  try {
    const headerCompanyId = companyIdOf(req);
    const bodyCompanyId =
      req.body?.companyId && String(req.body.companyId).trim()
        ? String(req.body.companyId).trim()
        : null;
    const companyId = bodyCompanyId || headerCompanyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    const { batchId } = req.params;
    if (!batchId) {
      return res.status(400).json({ success: false, message: 'Batch id is required' });
    }

    const prisma = require('../../prisma/client');
    const { userHasCompanyAccess } = require('../../utils/companyAccess');

    const existing = await prisma.inventoryImportBatch.findFirst({
      where: { id: String(batchId) },
      select: {
        id: true,
        companyId: true,
        batchNumber: true,
        status: true,
        importedCount: true,
        updatedCount: true,
        skippedCount: true,
        resultSummary: true,
      },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Import batch not found' });
    }

    const allowed =
      existing.companyId === companyId ||
      (await userHasCompanyAccess(req.user.id, existing.companyId));
    if (!allowed) {
      return res.status(409).json({
        success: false,
        message:
          'This import batch belongs to another company. Switch company and try again.',
      });
    }

    if (['Completed', 'CompletedWithWarnings'].includes(existing.status)) {
      return res.json({
        success: true,
        message: 'Import already completed',
        data: {
          async: false,
          batch: existing,
          importedCount: existing.importedCount,
          updatedCount: existing.updatedCount,
          skippedCount: existing.skippedCount,
        },
      });
    }

    if (existing.status === 'Processing') {
      return res.status(202).json({
        success: true,
        message: 'Import already in progress',
        data: {
          async: true,
          batchId: existing.id,
          batchNumber: existing.batchNumber,
          status: 'Processing',
          companyId: existing.companyId,
        },
      });
    }

    if (!['Preview', 'Failed'].includes(existing.status)) {
      return res.status(400).json({
        success: false,
        message: `Batch status is ${existing.status}; only Preview / Failed batches can be confirmed`,
      });
    }

    // Mark Processing immediately so polls see progress and duplicates are blocked
    await prisma.inventoryImportBatch.update({
      where: { id: existing.id },
      data: { status: 'Processing', startedAt: new Date(), resultSummary: { progress: 0 } },
    });

    const runCompanyId = existing.companyId;
    const userId = req.user.id;

    setImmediate(() => {
      executeImport(existing.id, runCompanyId, userId, { alreadyClaimed: true }).catch((err) => {
        console.error('confirmImport background error:', err);
      });
    });

    return res.status(202).json({
      success: true,
      message: 'Import started',
      data: {
        async: true,
        batchId: existing.id,
        batchNumber: existing.batchNumber,
        status: 'Processing',
        companyId: runCompanyId,
      },
    });
  } catch (err) {
    console.error('confirmImport', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Import failed',
    });
  }
};

// GET /api/warehouse/inventory/import/batches
const getImportBatches = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const batches = await listBatches(companyId);
    return res.json({ success: true, data: batches });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/warehouse/inventory/import/batches/:batchId
const getImportBatch = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const prisma = require('../../prisma/client');
    const { userHasCompanyAccess } = require('../../utils/companyAccess');
    const batch = await prisma.inventoryImportBatch.findFirst({
      where: { id: String(req.params.batchId) },
    });
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }
    const allowed =
      !companyId ||
      batch.companyId === companyId ||
      (await userHasCompanyAccess(req.user.id, batch.companyId));
    if (!allowed) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }
    return res.json({ success: true, data: batch });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET/PUT inventory settings
const getSettings = async (req, res) => {
  try {
    const settings = await getOrCreateInventorySettings(companyIdOf(req));
    return res.json({ success: true, data: settings });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

const putSettings = async (req, res) => {
  try {
    const settings = await updateInventorySettings(companyIdOf(req), req.body || {});
    return res.json({ success: true, data: settings });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

const getUoms = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    await ensureDefaultUoms(companyId);
    const [uoms, conversions] = await Promise.all([
      listUoms(companyId),
      listConversions(companyId),
    ]);
    return res.json({ success: true, data: { uoms, conversions } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  upload,
  downloadTemplate,
  previewImport,
  confirmImport,
  getImportBatches,
  getImportBatch,
  getSettings,
  putSettings,
  getUoms,
};
