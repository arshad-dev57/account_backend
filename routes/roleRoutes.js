const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const roleController = require('../controllers/roleController');

// All role routes require authentication
router.use(protect);

// Permission Catalog (public to all authenticated staff so UI matrices can render)
router.get('/catalog', roleController.getCatalog);

// List available roles
router.get('/', roleController.getRoles);

// Role details by ID
router.get('/:id', roleController.getRoleById);

// Inspect Effective Permissions for a specific user
router.get('/user-effective-permissions/:userId', roleController.getUserEffectivePermissions);

// Create custom role (requires settings.roles.create or admin)
router.post('/', requirePermission('settings.roles.create'), roleController.createRole);

// Update role (requires settings.roles.edit or admin)
router.put('/:id', requirePermission('settings.roles.edit'), roleController.updateRole);

// Duplicate role (requires settings.roles.create or admin)
router.post('/:id/duplicate', requirePermission('settings.roles.create'), roleController.duplicateRole);

// Delete custom role (requires settings.roles.delete or admin)
router.delete('/:id', requirePermission('settings.roles.delete'), roleController.deleteRole);

// Set direct user permission override (ALLOW / DENY / RESET)
router.post('/user-overrides/:userId', requirePermission('settings.roles.edit'), roleController.setUserPermissionOverride);

// Security & RBAC Audit Logs
router.get('/audit/logs', requirePermission('settings.audit_logs.view'), roleController.getAuditLogs);

module.exports = router;
