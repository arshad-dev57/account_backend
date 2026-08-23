const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { requireLocationAdmin } = require('../../utils/locationAccessHelper');
const {
  listLocations,
  createLocation,
  updateLocation,
  deleteLocation,
  getLocationStock,
  getProductLocationStocks,
  transferStock,
  migrateLegacyStock,
} = require('../controller/locationController');

router.use(protect);

router.get('/', listLocations);
router.post('/', requireLocationAdmin, createLocation);
router.post('/transfer', requireLocationAdmin, transferStock);
router.post('/migrate', requireLocationAdmin, migrateLegacyStock);
router.get('/product/:productId/stocks', getProductLocationStocks);
router.get('/:id/stock', getLocationStock);
router.put('/:id', requireLocationAdmin, updateLocation);
router.delete('/:id', requireLocationAdmin, deleteLocation);

module.exports = router;
