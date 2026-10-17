'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../middleware/rbacMiddleware');
const svc = require('../services/importService');

router.use(protect);

// Catalog keys are import.<resource>.<action> — also accept purchase.* for shared ops.
const CAN_VIEW = requireAnyPermission([
  'import.dashboard.view',
  'import.rfqs.view',
  'import.orders.view',
  'import.proformas.view',
  'import.shipments.view',
  'import.carriers.view',
  'import.customs.view',
  'import.documents.view',
  'import.grn.view',
  'import.landed_costs.view',
  'import.finance.view',
  'import.bills.view',
  'import.reports.view',
  'import.settings.view',
  'purchase.view',
  'purchases.orders.view',
]);
const CAN_CREATE_RFQ = requireAnyPermission(['import.rfqs.create', 'purchases.orders.create']);
const CAN_EDIT_RFQ = requireAnyPermission(['import.rfqs.edit', 'purchases.orders.edit']);
const CAN_DELETE_RFQ = requireAnyPermission(['import.rfqs.delete', 'purchases.orders.delete']);
const CAN_CREATE_PO = requireAnyPermission(['import.orders.create', 'purchases.orders.create']);
const CAN_EDIT_PO = requireAnyPermission(['import.orders.edit', 'purchases.orders.edit']);
const CAN_CREATE_PI = requireAnyPermission(['import.proformas.create', 'purchases.orders.create']);
const CAN_EDIT_PI = requireAnyPermission(['import.proformas.edit', 'purchases.orders.edit']);
const CAN_CREATE_SHIP = requireAnyPermission(['import.shipments.create', 'purchases.orders.create']);
const CAN_EDIT_SHIP = requireAnyPermission(['import.shipments.edit', 'purchases.orders.edit']);
const CAN_CREATE_CARRIER = requireAnyPermission(['import.carriers.create', 'import.shipments.create', 'purchases.orders.create']);
const CAN_EDIT_CARRIER = requireAnyPermission(['import.carriers.edit', 'import.shipments.edit', 'purchases.orders.edit']);
const CAN_CREATE_CUSTOMS = requireAnyPermission(['import.customs.create', 'purchases.orders.create']);
const CAN_EDIT_CUSTOMS = requireAnyPermission(['import.customs.edit', 'purchases.orders.edit']);
const CAN_CUSTOMS_ACTION = requireAnyPermission([
  'import.customs.edit',
  'import.customs.assess',
  'import.customs.record_payment',
  'import.customs.release',
  'import.customs.hold',
  'import.customs.cancel',
  'purchases.orders.edit',
]);
const CAN_RECORD_CUSTOMS_PAYMENT = requireAnyPermission(['import.customs.record_payment']);

// Clearer 403 copy for customs duty payment permission denials
router.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (
      res.statusCode === 403 &&
      Array.isArray(body?.requiredPermissions) &&
      body.requiredPermissions.includes('import.customs.record_payment') &&
      body.requiredPermissions.length === 1
    ) {
      return originalJson({
        ...body,
        message: 'You do not have permission to record customs duty payments',
      });
    }
    return originalJson(body);
  };
  next();
});
const CAN_CREATE_DOC = requireAnyPermission(['import.documents.create', 'purchases.orders.create']);
const CAN_CREATE_GRN = requireAnyPermission(['import.grn.create', 'purchases.orders.create']);
const CAN_CREATE_LCA = requireAnyPermission(['import.landed_costs.create', 'purchases.orders.create']);
const CAN_POST_LCA = requireAnyPermission(['import.landed_costs.post', 'accounting.journal_entries.post']);
const CAN_CREATE_LC = requireAnyPermission(['import.finance.create', 'purchases.orders.create']);
const CAN_CREATE_BILL = requireAnyPermission(['import.bills.create', 'purchases.invoices.create']);
const CAN_PAY_BILL = requireAnyPermission(['import.bills.pay', 'import.bills.edit', 'purchases.payments.create']);
const CAN_EDIT_SETTINGS = requirePermission('import.settings.edit');

function wrap(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function ok(res, data, status = 200) {
  res.status(status).json({ success: true, data });
}

router.get('/dashboard', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getDashboardKpis(req));
}));

router.get('/ports', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listPorts(req, req.query));
}));

router.get('/rfqs', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listRfqs(req, req.query));
}));

router.post('/rfqs', CAN_CREATE_RFQ, wrap(async (req, res) => {
  ok(res, await svc.createRfq(req, req.body), 201);
}));

router.get('/rfqs/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getRfqById(req, req.params.id));
}));

router.put('/rfqs/:id', CAN_EDIT_RFQ, wrap(async (req, res) => {
  ok(res, await svc.updateRfq(req, req.params.id, req.body));
}));

router.delete('/rfqs/:id', CAN_DELETE_RFQ, wrap(async (req, res) => {
  ok(res, await svc.deleteRfq(req, req.params.id));
}));

router.get('/rfqs/:id/quotations', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listQuotations(req, { ...req.query, rfqId: req.params.id }));
}));

router.post('/rfqs/:id/quotations', CAN_CREATE_RFQ, wrap(async (req, res) => {
  ok(res, await svc.createQuotation(req, { ...req.body, rfqId: req.params.id }), 201);
}));

router.post('/quotations/:id/select', CAN_EDIT_RFQ, wrap(async (req, res) => {
  ok(res, await svc.selectQuotation(req, req.params.id, req.body || {}));
}));

router.post('/rfqs/:id/reopen', CAN_EDIT_RFQ, wrap(async (req, res) => {
  ok(res, await svc.reopenRfq(req, req.params.id, req.body || {}));
}));

router.post('/rfqs/:id/items/:itemId/refresh-hs-code', CAN_EDIT_RFQ, wrap(async (req, res) => {
  ok(res, await svc.refreshRfqItemHsCode(req, req.params.id, req.params.itemId));
}));

router.post('/rfqs/:id/convert-to-po', CAN_CREATE_PO, wrap(async (req, res) => {
  ok(res, await svc.convertRfqToPurchaseOrder(req, req.params.id, req.body), 201);
}));

router.get('/purchase-orders', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listPurchaseOrders(req, req.query));
}));

router.post('/purchase-orders', CAN_CREATE_PO, wrap(async (req, res) => {
  ok(res, await svc.createPurchaseOrder(req, req.body), 201);
}));

router.get('/purchase-orders/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getPurchaseOrderById(req, req.params.id));
}));

router.patch('/purchase-orders/:id/status', CAN_EDIT_PO, wrap(async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ success: false, message: 'status is required' });
  ok(res, await svc.updatePurchaseOrderStatus(req, req.params.id, status));
}));

router.post('/purchase-orders/:id/correct-fx', CAN_EDIT_PO, wrap(async (req, res) => {
  ok(res, await svc.correctPurchaseOrderExchangeRate(req, req.params.id, req.body));
}));

router.post('/fx/preview', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.previewFx(req, req.body));
}));

router.get('/proformas', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listProformas(req, req.query));
}));

router.get('/proformas/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getProformaById(req, req.params.id));
}));

router.post('/proformas', CAN_CREATE_PI, wrap(async (req, res) => {
  ok(res, await svc.createProforma(req, req.body), 201);
}));

router.put('/proformas/:id', CAN_EDIT_PI, wrap(async (req, res) => {
  ok(res, await svc.updateProforma(req, req.params.id, req.body));
}));

router.post('/proformas/:id/advance-payment', CAN_EDIT_PI, wrap(async (req, res) => {
  ok(res, await svc.recordAdvancePayment(req, req.params.id, req.body));
}));

router.patch('/proformas/:id/status', CAN_EDIT_PI, wrap(async (req, res) => {
  ok(res, await svc.updateProformaStatus(req, req.params.id, req.body.status, req.body));
}));

router.get('/shipments', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listShipments(req, req.query));
}));

router.get('/shipments/eligible-pos', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listEligibleShipmentPos(req, req.query));
}));

router.get('/shipments/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getShipmentById(req, req.params.id));
}));

router.post('/shipments', CAN_CREATE_SHIP, wrap(async (req, res) => {
  ok(res, await svc.createShipment(req, req.body), 201);
}));

router.patch('/shipments/:id/status', CAN_EDIT_SHIP, wrap(async (req, res) => {
  const { status, shipmentStatus, ...extra } = req.body;
  const next = shipmentStatus || status;
  if (!next) return res.status(400).json({ success: false, message: 'status is required' });
  ok(res, await svc.updateShipmentStatus(req, req.params.id, {
    shipmentStatus: next,
    ...extra,
  }));
}));

router.get('/carriers', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listCarriers(req, req.query));
}));

router.post('/carriers', CAN_CREATE_CARRIER, wrap(async (req, res) => {
  ok(res, await svc.createCarrier(req, req.body), 201);
}));

router.get('/carriers/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getCarrierById(req, req.params.id));
}));

router.put('/carriers/:id', CAN_EDIT_CARRIER, wrap(async (req, res) => {
  ok(res, await svc.updateCarrier(req, req.params.id, req.body));
}));

router.patch('/carriers/:id/status', CAN_EDIT_CARRIER, wrap(async (req, res) => {
  ok(res, await svc.deactivateCarrier(req, req.params.id));
}));

router.get('/customs', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listCustomsClearances(req, req.query));
}));

router.post('/customs/preview', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.previewCustomsClearance(req, req.body));
}));

// Static paths MUST be registered before /customs/:id
router.get('/customs/payment-accounts', CAN_RECORD_CUSTOMS_PAYMENT, wrap(async (req, res) => {
  ok(res, await svc.listCustomsPaymentAccounts(req, req.query));
}));

router.post('/customs', CAN_CREATE_CUSTOMS, wrap(async (req, res) => {
  ok(res, await svc.createCustomsClearance(req, req.body), 201);
}));

router.post('/customs/:id/payments', CAN_RECORD_CUSTOMS_PAYMENT, wrap(async (req, res) => {
  ok(res, await svc.recordCustomsDutyPayment(req, req.params.id, req.body), 201);
}));

router.patch('/customs/:id/status', CAN_CUSTOMS_ACTION, wrap(async (req, res) => {
  const { status, dutyPaymentRef, ...extra } = req.body;
  if (!status) return res.status(400).json({ success: false, message: 'status is required' });
  ok(res, await svc.updateCustomsStatus(req, req.params.id, status, dutyPaymentRef, extra));
}));

router.get('/customs/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getCustomsClearanceById(req, req.params.id));
}));

router.post('/customs/:id/recalculate-rate', CAN_EDIT_CUSTOMS, wrap(async (req, res) => {
  ok(res, await svc.recalculateCustomsWithCurrentRate(req, req.params.id, req.body));
}));

router.post('/customs/:id/refresh-tariff', CAN_EDIT_CUSTOMS, wrap(async (req, res) => {
  ok(res, await svc.refreshCustomsTariffData(req, req.params.id, req.body));
}));

router.get('/documents', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listDocuments(req, req.query));
}));

router.post('/documents', CAN_CREATE_DOC, wrap(async (req, res) => {
  ok(res, await svc.createDocument(req, req.body), 201);
}));

router.patch('/documents/:id/status', CAN_CREATE_DOC, wrap(async (req, res) => {
  const { status, ...extra } = req.body;
  if (!status) return res.status(400).json({ success: false, message: 'status is required' });
  ok(res, await svc.updateDocumentStatus(req, req.params.id, status, extra));
}));

// Secure file upload (Cloudinary) — stores URL on ImportDocument metadata
try {
  const { expenseUpload } = require('../config/expenseUpload');
  router.post(
    '/documents/upload',
    CAN_CREATE_DOC,
    expenseUpload.single('file'),
    wrap(async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }
      const fileUrl = req.file.path || req.file.secure_url || req.file.url;
      const meta = {
        fileUrl,
        filePlaceholder: req.file.originalname,
        docType: req.body.docType || req.body.documentType || 'Commercial Invoice',
        docNumber: req.body.docNumber || req.body.documentNumber,
        importPoId: req.body.importPoId,
        shipmentId: req.body.shipmentId,
        issuer: req.body.issuer,
        issueDate: req.body.issueDate,
        expiryDate: req.body.expiryDate,
        status: req.body.status || 'Pending Review',
      };
      ok(res, await svc.createDocument(req, meta), 201);
    })
  );
} catch (uploadInitErr) {
  console.warn('[ImportRoutes] Document upload middleware unavailable:', uploadInitErr.message);
}

router.get('/grns', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listGrns(req, req.query));
}));

router.get('/grns/audit', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.auditImportGrns(req, req.query));
}));

router.get('/purchase-orders/:id/receiving-preview', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getReceivingPreview(req, req.params.id));
}));

router.get('/grns/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getGrnById(req, req.params.id));
}));

router.post('/grns', CAN_CREATE_GRN, wrap(async (req, res) => {
  ok(res, await svc.createGrn(req, req.body), 201);
}));

router.get('/landed-costs', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listLandedCosts(req, req.query));
}));

router.get('/landed-costs/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getLandedCostById(req, req.params.id));
}));

router.post('/landed-costs', CAN_CREATE_LCA, wrap(async (req, res) => {
  ok(res, await svc.createLandedCost(req, req.body), 201);
}));

router.post('/landed-costs/:id/post', CAN_POST_LCA, wrap(async (req, res) => {
  ok(res, await svc.postLandedCost(req, req.params.id));
}));

router.post('/landed-costs/:id/reverse', CAN_POST_LCA, wrap(async (req, res) => {
  ok(res, await svc.reverseLandedCost(req, req.params.id));
}));

router.get('/finance/lcs', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listFinanceLcs(req, req.query));
}));

router.get('/finance/lcs/eligible-pos', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listEligibleFinancePos(req, req.query));
}));

router.get('/finance/lcs/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getFinanceLcById(req, req.params.id));
}));

router.post('/finance/lcs', CAN_CREATE_LC, wrap(async (req, res) => {
  ok(res, await svc.createFinanceLc(req, req.body), 201);
}));

router.patch('/finance/lcs/:id/status', CAN_CREATE_LC, wrap(async (req, res) => {
  const { status, ...extra } = req.body;
  if (!status) return res.status(400).json({ success: false, message: 'status is required' });
  ok(res, await svc.updateFinanceLcStatus(req, req.params.id, status, extra));
}));

router.post('/finance/lcs/:id/amend', CAN_CREATE_LC, wrap(async (req, res) => {
  ok(res, await svc.amendFinanceLc(req, req.params.id, req.body));
}));

router.get('/bills', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.listSupplierBills(req, req.query));
}));

router.get('/bills/:id', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getSupplierBillById(req, req.params.id));
}));

router.post('/bills', CAN_CREATE_BILL, wrap(async (req, res) => {
  ok(res, await svc.createSupplierBill(req, req.body), 201);
}));

router.post('/bills/:id/post', CAN_CREATE_BILL, wrap(async (req, res) => {
  ok(res, await svc.postSupplierBill(req, req.params.id));
}));

router.post('/bills/:id/payment', CAN_PAY_BILL, wrap(async (req, res) => {
  ok(res, await svc.recordBillPayment(req, req.params.id, req.body));
}));

router.get('/settings', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getSettings(req));
}));

router.put('/settings', CAN_EDIT_SETTINGS, wrap(async (req, res) => {
  ok(res, await svc.updateSettings(req, req.body));
}));

router.get('/reports', CAN_VIEW, wrap(async (req, res) => {
  ok(res, await svc.getReports(req, req.query));
}));

router.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  if (status >= 500) console.error('[ImportRoutes]', err);
  res.status(status).json({
    success: false,
    message,
    code: err.code || undefined,
    field: err.field || undefined,
  });
});

module.exports = router;
