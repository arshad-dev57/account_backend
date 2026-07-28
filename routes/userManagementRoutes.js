const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  updateUserPermissions,
  getRoles
} = require('../controllers/userManagementController');

// All routes are protected
router.use(protect);

// ─── GET Routes ──────────────────────────────────────────────
// Get all users
router.get('/', getAllUsers);

// Get available roles
router.get('/roles', getRoles);

// Get single user
router.get('/:id', getUserById);

// ─── POST Routes ──────────────────────────────────────────────
// Create user
router.post('/', createUser);

// ─── PUT Routes ──────────────────────────────────────────────
// Update user
router.put('/:id', updateUser);

// Update user permissions
router.put('/:id/permissions', updateUserPermissions);

// ─── DELETE Routes ──────────────────────────────────────────────
// Delete user
router.delete('/:id', deleteUser);

module.exports = router;
