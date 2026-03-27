const express = require('express');
const {
  createVendor,
  getVendors,
  getVendor,
  updateVendor,
  deleteVendor,
  createBill,
  getBills,
  getBill,
  recordPayment,
  getSummary,
} = require('../controllers/accountsPayableController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// Summary
router.get('/summary', getSummary);

// Vendor routes
router.route('/vendors')
  .get(getVendors)
  .post(createVendor);

router.route('/vendors/:id')
  .get(getVendor)
  .put(updateVendor)
  .delete(deleteVendor);

// Bill routes
router.route('/bills')
  .get(getBills)
  .post(createBill);

router.route('/bills/:id')
  .get(getBill);

// Payment
router.post('/payments', recordPayment);

module.exports = router;