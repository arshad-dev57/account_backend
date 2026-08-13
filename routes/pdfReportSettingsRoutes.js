// routes/pdfReportSettingsRoutes.js

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { upload } = require('../config/cloudinary');
const {
  getPdfReportSettings,
  updatePdfReportSettings
} = require('../controllers/pdfReportSettingsController');

router.use(protect);

router.get('/', getPdfReportSettings);
router.put(
  '/',
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'signature', maxCount: 1 },
  ]),
  updatePdfReportSettings
);

module.exports = router;
