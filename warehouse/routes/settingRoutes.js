const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getSettings,
  createSetting,
  updateSetting,
  deleteSetting
} = require('../controller/settingController');

router.use(protect);

router.get('/', getSettings);
router.post('/', createSetting);
router.put('/:id', updateSetting);
router.delete('/:id', deleteSetting);

module.exports = router;