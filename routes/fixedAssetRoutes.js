const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/AuthMiddleware');
const {
  createFixedAsset,
  getFixedAssets,
  getFixedAsset,
  updateFixedAsset,
  runDepreciation,
  runMonthlyDepreciation,
  disposeFixedAsset,
  getSummary,
  deleteFixedAsset
} = require('../controllers/fixedAssetController');

// ─── Protected Routes ─────────────────────────────────────────────
router.use(protect);

// ─── CRUD Operations ──────────────────────────────────────────────
router.post('/', createFixedAsset);
router.get('/', getFixedAssets);
router.get('/summary', getSummary);
router.get('/:id', getFixedAsset);
router.put('/:id', updateFixedAsset);
router.delete('/:id', deleteFixedAsset);

// ─── Special Operations ───────────────────────────────────────────
router.post('/depreciate', runDepreciation);
router.post('/depreciate-all', runMonthlyDepreciation);
router.post('/dispose', disposeFixedAsset);

module.exports = router;