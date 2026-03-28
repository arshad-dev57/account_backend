const express = require('express');
const {
  createFixedAsset,
  getFixedAssets,
  getFixedAsset,
  updateFixedAsset,
  deleteFixedAsset,
  runDepreciation,
  runMonthlyDepreciation,
  disposeFixedAsset,
  getSummary,
} = require('../controllers/fixedAssetController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(protect);

// Summary route
router.get('/summary', getSummary);

// Depreciation routes
router.post('/depreciate', runDepreciation);
router.post('/depreciate-all', runMonthlyDepreciation);

// Disposal route
router.post('/dispose', disposeFixedAsset);

// Main CRUD routes
router.route('/')
  .get(getFixedAssets)
  .post(createFixedAsset);

router.route('/:id')
  .get(getFixedAsset)
  .put(updateFixedAsset)
  .delete(deleteFixedAsset);

module.exports = router;