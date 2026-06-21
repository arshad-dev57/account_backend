// routes/categoryRoutes.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getCategories,
  createCategory
} = require('../controller/category_controller');

router.use(protect);

router.get('/', getCategories);
router.post('/', protect, createCategory);

module.exports = router;