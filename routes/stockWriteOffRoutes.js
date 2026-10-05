const express = require('express');
const router = express.Router();
const stockWriteOffController = require('../controllers/stockWriteOffController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', stockWriteOffController.getStockWriteOffs);
router.post('/', stockWriteOffController.createStockWriteOff);
router.get('/reports', stockWriteOffController.getWriteOffReports);
router.get('/:id', stockWriteOffController.getStockWriteOffById);
router.put('/:id/submit', stockWriteOffController.submitStockWriteOff);
router.post('/:id/approve', stockWriteOffController.approveStockWriteOff);
router.post('/:id/reject', stockWriteOffController.rejectStockWriteOff);
router.post('/:id/post', stockWriteOffController.postStockWriteOff);

module.exports = router;
