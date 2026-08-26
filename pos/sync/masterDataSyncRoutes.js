const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { getMasterData } = require('./masterDataSyncController');

router.get('/master-data', protect, getMasterData);

module.exports = router;
