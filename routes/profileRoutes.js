// routes/profileRoutes.js

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getProfile,
  updateProfile,
  updateBusinessDetails,
  getBusinessDetails,
  updateProfileImage,
} = require('../controllers/profileController');

// ─── ALL ROUTES PROTECTED ──────────────────────────────────
router.use(protect);

// ─── PROFILE ROUTES ────────────────────────────────────────
router.get('/', getProfile);
router.put('/', updateProfile);

// ─── BUSINESS DETAILS ROUTES ──────────────────────────────
router.get('/business', getBusinessDetails);
router.put('/business', updateBusinessDetails);

// ─── PROFILE IMAGE ROUTES ──────────────────────────────────
router.put('/image', updateProfileImage);

module.exports = router;