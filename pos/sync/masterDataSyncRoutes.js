const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { getMasterData, pushMasterData, postMasterDataSync } = require('./masterDataSyncController');

router.get('/master-data', protect, getMasterData);
router.post('/master-data/push', protect, pushMasterData);
router.post('/master-data/sync', protect, postMasterDataSync);

module.exports = router;
