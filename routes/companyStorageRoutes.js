/**
 * companyStorageRoutes.js
 *
 * Mounts at /api/admin  (registered in app.js)
 *
 * Routes:
 *   GET  /api/admin/company-storage-usage                   — full report
 *   POST /api/admin/company-storage-usage/invalidate-cache  — clear cache
 *
 * Authorization:
 *   protectOnly — validates JWT, loads req.user.
 *   Any authenticated user can access storage metrics.
 *   Unauthenticated requests will receive 401 Unauthorized.
 */

'use strict';

const router          = require('express').Router();
const { protectOnly } = require('../middleware/authMiddleware');
const ctrl            = require('../controllers/companyStorageController');

router.get(
  '/company-storage-usage',
  protectOnly,
  ctrl.getCompanyStorageUsage
);

router.post(
  '/company-storage-usage/invalidate-cache',
  protectOnly,
  ctrl.invalidateStorageCache
);

module.exports = router;
