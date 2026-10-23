'use strict';

const router = require('express').Router();
const { protectOnly } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/installmentController');

router.use(protectOnly);

router.get('/report', ctrl.getReport);
router.post('/mark-overdue', ctrl.markOverdue);
router.get('/reminders', ctrl.listReminderCandidates);
router.get('/customers/:customerId/summary', ctrl.getCustomerSummary);
router.get('/suppliers/:supplierId/summary', ctrl.getSupplierSummary);
router.get('/sales-invoices/:invoiceId/schedule', ctrl.getSalesInvoiceSchedule);
router.get('/purchase-invoices/:invoiceId/schedule', ctrl.getPurchaseInvoiceSchedule);
router.post(
  '/sales-invoices/:invoiceId/send-reminder',
  ctrl.sendCustomerScheduleReminder
);

module.exports = router;
