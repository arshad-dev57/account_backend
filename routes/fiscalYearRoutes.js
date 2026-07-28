// routes/fiscalYearRoutes.js
'use strict';

const express = require('express');
const router  = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const {
  listFiscalYears,
  createFiscalYear,
  getActiveFiscalYear,
  getAuditLog,
  getFiscalYearById,
  updateFiscalYear,
  closeFiscalYear,
  reopenFiscalYear,
} = require('../controllers/fiscalYearController');

// All routes require authentication + active subscription
router.use(authMiddleware.protect);

// ── Collection routes ──────────────────────────────────────────────────────
router.get('/',    listFiscalYears);
router.post('/',   createFiscalYear);

// IMPORTANT: static named routes MUST come before /:id to prevent Express
// from treating "active" / "audit-log" as dynamic :id params.
router.get('/active',    getActiveFiscalYear);
router.get('/audit-log', getAuditLog);          // all audit logs for user

// ── Resource routes ────────────────────────────────────────────────────────
router.get('/:id',             getFiscalYearById);
router.put('/:id',             updateFiscalYear);
router.post('/:id/close',      closeFiscalYear);
router.post('/:id/reopen',     reopenFiscalYear);
router.get('/:id/audit-log',   getAuditLog);    // logs for a specific FY

module.exports = router;
