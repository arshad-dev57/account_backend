// routes/profileRoutes.js

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { upload } = require('../config/cloudinary');
const {
  getProfile,
  updateProfile,
  updateBusinessDetails,
  getBusinessDetails,
  updateProfileImage
} = require('../controllers/profileController');

// ─── ALL ROUTES PROTECTED ──────────────────────────────────
router.use(protect);

// ─── PROFILE ROUTES ────────────────────────────────────────
router.get('/', getProfile);
router.put('/', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'signature', maxCount: 1 }]), updateProfile);

// ─── BUSINESS DETAILS ROUTES ──────────────────────────────
router.get('/business', getBusinessDetails);
router.put('/business', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'signature', maxCount: 1 }]), updateBusinessDetails);

// ─── PROFILE IMAGE ROUTES ──────────────────────────────────
router.put('/image', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'signature', maxCount: 1 }]), updateProfileImage);

module.exports = router;
