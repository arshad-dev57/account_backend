'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../middleware/rbacMiddleware');
const svc = require('../services/exportService');
const { toPlain } = require('../services/exportHelpers');

router.use(protect);

const CAN_VIEW = requireAnyPermission([
  'export.dashboard.view',
  'export.inquiries.view',
  'export.quotations.view',
  'export.orders.view',
  'export.proformas.view',
  'export.packing.view',
  'export.shipments.view',
  'export.customs.view',
  'export.documents.view',
  'export.dispatch.view',
  'export.finance.view',
  'export.receipts.view',
  'export.expenses.view',
  'export.reports.view',
  'export.settings.view',
]);

const p = (resource, action) => requirePermission(`export.${resource}.${action}`);

const CAN_CREATE_INQUIRY = p('inquiries', 'create');
const CAN_EDIT_INQUIRY = p('inquiries', 'edit');
const CAN_CREATE_QUOTE = p('quotations', 'create');
const CAN_EDIT_QUOTE = p('quotations', 'edit');
const CAN_APPROVE_QUOTE = p('quotations', 'approve');
const CAN_CREATE_ORDER = p('orders', 'create');
const CAN_EDIT_ORDER = p('orders', 'edit');
const CAN_APPROVE_ORDER = p('orders', 'approve');
const CAN_CREATE_PROFORMA = p('proformas', 'create');
const CAN_EDIT_PROFORMA = p('proformas', 'edit');
const CAN_CREATE_PACKING = p('packing', 'create');
const CAN_EDIT_PACKING = p('packing', 'edit');
const CAN_CREATE_SHIPMENT = p('shipments', 'create');
const CAN_EDIT_SHIPMENT = p('shipments', 'edit');
const CAN_CREATE_CUSTOMS = p('customs', 'create');
const CAN_EDIT_CUSTOMS = p('customs', 'edit');
const CAN_CREATE_DOCUMENT = p('documents', 'create');
const CAN_EDIT_DOCUMENT = p('documents', 'edit');
const CAN_CREATE_DISPATCH = p('dispatch', 'create');
const CAN_EDIT_DISPATCH = p('dispatch', 'edit');
const CAN_CREATE_LC = p('finance', 'create');
const CAN_EDIT_LC = p('finance', 'edit');
const CAN_CREATE_RECEIPT = p('receipts', 'create');
const CAN_EDIT_RECEIPT = p('receipts', 'edit');
const CAN_CREATE_EXPENSE = p('expenses', 'create');
const CAN_EDIT_EXPENSE = p('expenses', 'edit');
const CAN_POST_EXPENSE = p('expenses', 'post');
const CAN_REVERSE_EXPENSE = p('expenses', 'reverse');
const CAN_EDIT_SETTINGS = p('settings', 'edit');

function wrap(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function ok(res, data, status = 200) {
  res.status(status).json({ success: true, data: toPlain(data) });
}

function requireStatus(req, res) {
  if (!req.body?.status) {
    res.status(400).json({ success: false, message: 'status is required' });
    return false;
  }
  return true;
}

// ── Reports, reference data, settings ──────────────────────────
router.get('/dashboard', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getDashboardKpis(req));
}));

router.get('/ports', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listPorts(req, req.query));
}));

router.get('/reports', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getReports(req));
}));

router.get('/settings', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getSettings(req));
}));

router.put('/settings', CAN_EDIT_SETTINGS, wrap(async (req, res) => {
  ok(res, await svc.updateSettings(req, req.body || {}));
}));

// ── Inquiries ──────────────────────────────────────────────────
router.get('/inquiries', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listInquiries(req, req.query));
}));

router.post('/inquiries', CAN_CREATE_INQUIRY, wrap(async (req, res) => {
  ok(res, await svc.createInquiry(req), 201);
}));

router.get('/inquiries/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getInquiry(req));
}));

router.put('/inquiries/:id', CAN_EDIT_INQUIRY, wrap(async (req, res) => {
  ok(res, await svc.updateInquiry(req));
}));

router.patch('/inquiries/:id/status', CAN_EDIT_INQUIRY, wrap(async (req, res) => {
  if (!requireStatus(req, res)) return;
  ok(res, await svc.updateInquiryStatus(req));
}));

router.post(
  '/inquiries/:id/convert-to-quotation',
  requireAnyPermission(['export.quotations.create', 'export.inquiries.edit']),
  wrap(async (req, res) => {
    ok(res, await svc.convertInquiryToQuotation(req), 201);
  })
);

// ── Quotations ─────────────────────────────────────────────────
router.get('/quotations', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listQuotations(req, req.query));
}));

router.post('/quotations', CAN_CREATE_QUOTE, wrap(async (req, res) => {
  ok(res, await svc.createQuotation(req), 201);
}));

router.get('/quotations/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getQuotation(req));
}));

router.put('/quotations/:id', CAN_EDIT_QUOTE, wrap(async (req, res) => {
  ok(res, await svc.updateQuotation(req));
}));

router.patch('/quotations/:id/status', CAN_EDIT_QUOTE, wrap(async (req, res) => {
  if (!requireStatus(req, res)) return;
  ok(res, await svc.updateQuotationStatus(req));
}));

router.post('/quotations/:id/approve', CAN_APPROVE_QUOTE, wrap(async (req, res) => {
  ok(res, await svc.approveQuotation(req));
}));

router.post(
  '/quotations/:id/convert-to-order',
  requireAnyPermission(['export.orders.create', 'export.quotations.edit']),
  wrap(async (req, res) => {
    ok(res, await svc.convertQuotationToOrder(req), 201);
  })
);

// ── Sales orders ───────────────────────────────────────────────
router.get('/orders', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listOrders(req, req.query));
}));

router.post('/orders', CAN_CREATE_ORDER, wrap(async (req, res) => {
  ok(res, await svc.createOrder(req), 201);
}));

router.get('/orders/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getOrder(req));
}));

router.get('/orders/:id/full', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getOrderFull(req));
}));

router.put('/orders/:id', CAN_EDIT_ORDER, wrap(async (req, res) => {
  ok(res, await svc.updateOrder(req));
}));

router.post('/orders/:id/approve', CAN_APPROVE_ORDER, wrap(async (req, res) => {
  ok(res, await svc.approveOrder(req));
}));

router.patch('/orders/:id/status', CAN_EDIT_ORDER, wrap(async (req, res) => {
  if (!requireStatus(req, res)) return;
  ok(res, await svc.updateOrderStatus(req));
}));

// ── Proforma invoices ──────────────────────────────────────────
router.get('/proformas', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listProformas(req, req.query));
}));

router.post('/proformas', CAN_CREATE_PROFORMA, wrap(async (req, res) => {
  ok(res, await svc.createProforma(req), 201);
}));

router.get('/proformas/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getProforma(req));
}));

router.put('/proformas/:id', CAN_EDIT_PROFORMA, wrap(async (req, res) => {
  ok(res, await svc.updateProforma(req));
}));

router.patch('/proformas/:id/status', CAN_EDIT_PROFORMA, wrap(async (req, res) => {
  if (!requireStatus(req, res)) return;
  ok(res, await svc.updateProformaStatus(req));
}));

// ── Packing & certification ────────────────────────────────────
router.get('/packing', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listPackings(req, req.query));
}));

router.post('/packing', CAN_CREATE_PACKING, wrap(async (req, res) => {
  ok(res, await svc.createPacking(req), 201);
}));

router.get('/packing/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getPacking(req));
}));

router.put('/packing/:id', CAN_EDIT_PACKING, wrap(async (req, res) => {
  ok(res, await svc.updatePacking(req));
}));

router.patch('/packing/:id/status', CAN_EDIT_PACKING, wrap(async (req, res) => {
  if (!requireStatus(req, res)) return;
  ok(res, await svc.updatePackingStatus(req));
}));

// ── Shipments ──────────────────────────────────────────────────
router.get('/shipments', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listShipments(req, req.query));
}));

router.post('/shipments', CAN_CREATE_SHIPMENT, wrap(async (req, res) => {
  ok(res, await svc.createShipment(req), 201);
}));

router.get('/shipments/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getShipment(req));
}));

router.put('/shipments/:id', CAN_EDIT_SHIPMENT, wrap(async (req, res) => {
  ok(res, await svc.updateShipment(req));
}));

router.patch('/shipments/:id/status', CAN_EDIT_SHIPMENT, wrap(async (req, res) => {
  if (!requireStatus(req, res)) return;
  ok(res, await svc.updateShipmentStatus(req));
}));

// ── Customs ────────────────────────────────────────────────────
router.get('/customs', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listCustoms(req, req.query));
}));

router.post('/customs', CAN_CREATE_CUSTOMS, wrap(async (req, res) => {
  ok(res, await svc.createCustoms(req), 201);
}));

router.get('/customs/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getCustoms(req));
}));

router.put('/customs/:id', CAN_EDIT_CUSTOMS, wrap(async (req, res) => {
  ok(res, await svc.updateCustoms(req));
}));

router.patch('/customs/:id/status', CAN_EDIT_CUSTOMS, wrap(async (req, res) => {
  if (!requireStatus(req, res)) return;
  ok(res, await svc.updateCustomsStatus(req));
}));

// ── Documents ──────────────────────────────────────────────────
router.get('/documents', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listDocuments(req, req.query));
}));

router.post('/documents', CAN_CREATE_DOCUMENT, wrap(async (req, res) => {
  ok(res, await svc.createDocument(req), 201);
}));

router.post('/orders/:orderId/documents', CAN_CREATE_DOCUMENT, wrap(async (req, res) => {
  ok(res, await svc.createDocument(req), 201);
}));

router.get('/documents/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getDocument(req));
}));

router.put('/documents/:id', CAN_EDIT_DOCUMENT, wrap(async (req, res) => {
  ok(res, await svc.updateDocument(req));
}));

router.patch('/documents/:id/status', CAN_EDIT_DOCUMENT, wrap(async (req, res) => {
  if (!requireStatus(req, res)) return;
  ok(res, await svc.updateDocumentStatus(req));
}));

// ── Dispatch (posts commercial invoice + inventory) ────────────
router.get('/dispatch', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listDispatches(req, req.query));
}));

router.post('/dispatch', CAN_CREATE_DISPATCH, wrap(async (req, res) => {
  ok(res, await svc.createDispatch(req), 201);
}));

router.get('/dispatch/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getDispatch(req));
}));

router.put('/dispatch/:id', CAN_EDIT_DISPATCH, wrap(async (req, res) => {
  ok(res, await svc.updateDispatch(req));
}));

router.patch('/dispatch/:id/status', CAN_EDIT_DISPATCH, wrap(async (req, res) => {
  if (!requireStatus(req, res)) return;
  ok(res, await svc.updateDispatchStatus(req));
}));

// ── Finance: letters of credit ─────────────────────────────────
router.get('/finance/lcs', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listFinanceLcs(req, req.query));
}));

router.post('/finance/lcs', CAN_CREATE_LC, wrap(async (req, res) => {
  ok(res, await svc.createFinanceLc(req), 201);
}));

router.get('/finance/lcs/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getFinanceLc(req));
}));

router.put('/finance/lcs/:id', CAN_EDIT_LC, wrap(async (req, res) => {
  ok(res, await svc.updateFinanceLc(req));
}));

router.patch('/finance/lcs/:id/status', CAN_EDIT_LC, wrap(async (req, res) => {
  if (!requireStatus(req, res)) return;
  ok(res, await svc.updateFinanceLcStatus(req));
}));

// ── Finance: receipts and advances ─────────────────────────────
router.get('/receipts', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listReceipts(req, req.query));
}));

router.post('/receipts', CAN_CREATE_RECEIPT, wrap(async (req, res) => {
  ok(res, await svc.createReceipt(req), 201);
}));

router.get('/receipts/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getReceipt(req));
}));

router.put('/receipts/:id', CAN_EDIT_RECEIPT, wrap(async (req, res) => {
  ok(res, await svc.updateReceipt(req));
}));

router.patch('/receipts/:id/status', CAN_EDIT_RECEIPT, wrap(async (req, res) => {
  if (!requireStatus(req, res)) return;
  ok(res, await svc.updateReceiptStatus(req));
}));

router.post('/receipts/:id/post', CAN_EDIT_RECEIPT, wrap(async (req, res) => {
  req.body = { ...(req.body || {}), status: 'Realized & Credited' };
  ok(res, await svc.updateReceiptStatus(req));
}));

// ── Export expenses ────────────────────────────────────────────
router.get('/expenses', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listExpenses(req, req.query));
}));

router.post('/expenses', CAN_CREATE_EXPENSE, wrap(async (req, res) => {
  ok(res, await svc.createExpense(req), 201);
}));

router.get('/expenses/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getExpense(req));
}));

router.put('/expenses/:id', CAN_EDIT_EXPENSE, wrap(async (req, res) => {
  ok(res, await svc.updateExpense(req));
}));

router.post('/expenses/:id/post', CAN_POST_EXPENSE, wrap(async (req, res) => {
  ok(res, await svc.postExpense(req));
}));

router.post('/expenses/:id/reverse', CAN_REVERSE_EXPENSE, wrap(async (req, res) => {
  ok(res, await svc.reverseExpense(req));
}));

router.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  if (status >= 500) console.error('[ExportRoutes]', err);
  res.status(status).json({
    success: false,
    message,
    code: err.code || undefined,
    field: err.field || undefined,
  });
});

module.exports = router;
