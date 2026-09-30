const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  upload,
  downloadTemplate,
  previewImport,
  confirmImport,
  getImportBatches,
  getImportBatch,
  getSettings,
  putSettings,
  getUoms,
} = require('../controller/inventoryImportController');
const {
  getInventoryValuation,
  getValuationSummary,
  getCategoryBreakdown,
} = require('../controller/inventory_controller');

router.use(protect);

// Existing valuation endpoints (mounted under /api/warehouse/inventory)
router.get('/valuation', getInventoryValuation);
router.get('/valuation/summary', getValuationSummary);
router.get('/valuation/categories', getCategoryBreakdown);

// Inventory settings + UOM
router.get('/settings', getSettings);
router.put('/settings', putSettings);
router.get('/uoms', getUoms);

// Import workflow
router.get('/import/template', downloadTemplate);
router.get('/import/batches', getImportBatches);
router.get('/import/batches/:batchId', getImportBatch);
router.post('/import/preview', upload.single('file'), (err, req, res, next) => {
  if (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  return next();
}, previewImport);
router.post('/import/:batchId/confirm', confirmImport);

module.exports = router;
