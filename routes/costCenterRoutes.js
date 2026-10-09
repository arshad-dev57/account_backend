const express = require('express');
const {
  list,
  getById,
  create,
  update,
  setStatus,
} = require('../controllers/costCenterController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/', list);
router.post('/', create);
router.get('/:id', getById);
router.put('/:id', update);
router.patch('/:id/status', setStatus);

module.exports = router;
