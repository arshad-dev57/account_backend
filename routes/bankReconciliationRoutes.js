const express = require('express');
const {
  dashboard,
  listReconciliations,
  getReconciliation,
  createReconciliation,
  uploadMiddleware,
  previewImport,
  confirmImport,
  listStatementTransactions,
  listBookTransactions,
  runAutoMatch,
  manualMatch,
  unmatchPair,
  ignoreTransaction,
  createAdjustment,
  complete,
  reopen,
  refresh,
  getReconciliationData,
  getReconciliationHistory,
} = require('../controllers/bankReconciliationController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');

const router = express.Router();

router.use(protect);

// Dashboard & history
router.get('/dashboard', requirePermission('accounting.bank_reconciliation.view'), dashboard);
router.get('/', requirePermission('accounting.bank_reconciliation.view'), listReconciliations);
router.post('/', requirePermission('accounting.bank_reconciliation.create'), createReconciliation);

// Statement import
router.post('/import/preview', uploadMiddleware, previewImport);
router.post('/import/confirm', confirmImport);

// Transaction lists (workspace sides)
router.get('/statement-transactions', requirePermission('accounting.bank_reconciliation.view'), listStatementTransactions);
router.get('/book-transactions', requirePermission('accounting.bank_reconciliation.view'), listBookTransactions);

// Single reconciliation
router.get('/:id', requirePermission('accounting.bank_reconciliation.view'), getReconciliation);
router.post('/:id/refresh', requirePermission('accounting.bank_reconciliation.view'), refresh);
router.post('/:id/auto-match', requirePermission('accounting.bank_reconciliation.edit'), runAutoMatch);
router.post('/:id/match', requirePermission('accounting.bank_reconciliation.edit'), manualMatch);
router.post('/:id/unmatch', requirePermission('accounting.bank_reconciliation.edit'), unmatchPair);
router.post('/:id/ignore', requirePermission('accounting.bank_reconciliation.edit'), ignoreTransaction);
router.post('/:id/adjustments', requirePermission('accounting.bank_reconciliation.edit'), createAdjustment);
router.post('/:id/complete', requirePermission('accounting.bank_reconciliation.approve'), complete);
router.post('/:id/reopen', requirePermission('accounting.bank_reconciliation.reopen'), reopen);

// Legacy routes (kept for compatibility)
router.get('/account/:accountId', getReconciliationData);
router.get('/account/:accountId/history', getReconciliationHistory);

module.exports = router;
