const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
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
router.post('/', createLocation);
router.post('/transfer', transferStock);
router.post('/migrate', migrateLegacyStock);
router.get('/product/:productId/stocks', getProductLocationStocks);
router.get('/:id/stock', getLocationStock);
router.put('/:id', updateLocation);
router.delete('/:id', deleteLocation);

module.exports = router;
