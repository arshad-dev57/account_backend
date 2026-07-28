// routes/accountsPayableRoutes.js

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getSuppliers,      // ✅ From warehouse
  getSupplier,       // ✅ From warehouse
  createBill,
  getBills,
  getBill,
  recordPayment,
  getSummary,
  getAgedPayables,
  getNextBillNumber
} = require('../controllers/accountsPayableController');

// ─── Supplier Routes (Using Warehouse Supplier) ──────────────────
router.get('/suppliers', protect, getSuppliers);
router.get('/suppliers/:id', protect, getSupplier);

// ─── Bill Number Generation ─────────────────────────────────────────
router.get('/next-bill-number', protect, getNextBillNumber);

// ─── Bill Routes ──────────────────────────────────────────────────
router.route('/bills')
  .post(protect, createBill)
  .get(protect, getBills);

router.get('/bills/:id', protect, getBill);

// ─── Payment Routes ──────────────────────────────────────────────
router.post('/payments', protect, recordPayment);

// ─── Summary Routes ──────────────────────────────────────────────
router.get('/summary', protect, getSummary);
router.get('/aged', protect, getAgedPayables);

module.exports = router;