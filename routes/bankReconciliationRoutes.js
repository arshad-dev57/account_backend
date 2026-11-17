const express = require('express');
const {
  dashboard,
  listReconciliations,
  getReconciliation,
  createReconciliation,
  uploadMiddleware,
  previewImport,
  confirmImport,
  addManualStatementLines,
  listStatementTransactions,
  listBookTransactions,
  runAutoMatch,
  suggestMatches,
  manualMatch,
  unmatchPair,
  ignoreTransaction,
  createAdjustment,
  complete,
  reopen,
  refresh,
  getBookBalancePreview,
  listAudits,
  getReconciliationData,
  getReconciliationHistory,
} = require('../controllers/bankReconciliationController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../middleware/rbacMiddleware');

const router = express.Router();

router.use(protect);

// Dashboard & history
router.get('/dashboard', requirePermission('accounting.bank_reconciliation.view'), dashboard);
router.get('/', requirePermission('accounting.bank_reconciliation.view'), listReconciliations);
router.post('/', requirePermission('accounting.bank_reconciliation.create'), createReconciliation);
router.get(
  '/book-balance',
  requirePermission('accounting.bank_reconciliation.view'),
  getBookBalancePreview
);

// Statement import (import permission preferred; edit also allowed for operators)
const canImport = requireAnyPermission([
  'accounting.bank_reconciliation.import',
  'accounting.bank_reconciliation.edit',
]);
router.post('/import/preview', canImport, uploadMiddleware, previewImport);
router.post('/import/confirm', canImport, confirmImport);
router.post('/statement-transactions/manual', canImport, addManualStatementLines);

// Transaction lists (workspace sides)
router.get('/statement-transactions', requirePermission('accounting.bank_reconciliation.view'), listStatementTransactions);
router.get('/book-transactions', requirePermission('accounting.bank_reconciliation.view'), listBookTransactions);

// Single reconciliation
router.get('/:id', requirePermission('accounting.bank_reconciliation.view'), getReconciliation);
router.get('/:id/audits', requirePermission('accounting.bank_reconciliation.view'), listAudits);
router.post('/:id/refresh', requirePermission('accounting.bank_reconciliation.view'), refresh);
router.post('/:id/auto-match', requirePermission('accounting.bank_reconciliation.edit'), runAutoMatch);
router.post('/:id/suggest-matches', requirePermission('accounting.bank_reconciliation.edit'), suggestMatches);
router.post('/:id/match', requirePermission('accounting.bank_reconciliation.edit'), manualMatch);
router.post('/:id/unmatch', requirePermission('accounting.bank_reconciliation.edit'), unmatchPair);
router.post('/:id/ignore', requirePermission('accounting.bank_reconciliation.edit'), ignoreTransaction);
router.post('/:id/adjustments', requirePermission('accounting.bank_reconciliation.edit'), createAdjustment);
router.post('/:id/complete', requirePermission('accounting.bank_reconciliation.approve'), complete);
router.post('/:id/reopen', requirePermission('accounting.bank_reconciliation.reopen'), reopen);

// Legacy routes (kept for compatibility)
router.get(
  '/account/:accountId',
  requirePermission('accounting.bank_reconciliation.view'),
  getReconciliationData
);
router.get(
  '/account/:accountId/history',
  requirePermission('accounting.bank_reconciliation.view'),
  getReconciliationHistory
);

module.exports = router;
