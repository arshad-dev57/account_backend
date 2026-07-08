// warehouse/routes/category_routes.js - WITH SUB-CATEGORY SUPPORT

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryTree,
  getSubCategories,
  getCategoryBreadcrumb,
  getCategoryStats
} = require('../controller/category_controller');

// All routes protected
router.use(protect);

// Stats
router.get('/stats', getCategoryStats);

// Tree view
router.get('/tree', getCategoryTree);

// Get sub-categories of a specific category
router.get('/:parentId/sub-categories', getSubCategories);

// Breadcrumb
router.get('/:id/breadcrumb', getCategoryBreadcrumb);

// Main CRUD
router.get('/', getCategories);
router.get('/:id', getCategoryById);
router.post('/', createCategory);
router.put('/:id', updateCategory);
router.delete('/:id', deleteCategory);

module.exports = router;