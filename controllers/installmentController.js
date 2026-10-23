'use strict';

const { requireSingleCompany } = require('../utils/companyAccess');
const {
  markOverdueInstallments,
  getInstallmentReport,
  getCustomerInstallmentSummary,
  getSupplierInstallmentSummary,
  getInstallmentReminderCandidates,
  listSalesInstallmentsForInvoice,
  listPurchaseInstallmentsForInvoice,
  summarizeSchedule,
} = require('../services/installmentScheduleService');
const {
  resolveEffectiveCompanyConfig,
} = require('../utils/companyBusinessConfig');
const emailSenderService = require('../services/emailSenderService');

exports.getReport = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const side = String(req.query.side || 'sales').toLowerCase() === 'purchase'
      ? 'purchase'
      : 'sales';
    const data = await getInstallmentReport(companyId, {
      side,
      status: req.query.status || undefined,
      fromDate: req.query.fromDate || undefined,
      toDate: req.query.toDate || undefined,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({
      success: false,
      code: err.code,
      message: err.message,
    });
  }
};

exports.markOverdue = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const result = await markOverdueInstallments(
      companyId,
      req.body?.asOfDate || new Date()
    );
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.getCustomerSummary = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const data = await getCustomerInstallmentSummary(
      companyId,
      req.params.customerId
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.getSupplierSummary = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const data = await getSupplierInstallmentSummary(
      companyId,
      req.params.supplierId
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.getSalesInvoiceSchedule = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const lines = await listSalesInstallmentsForInvoice(req.params.invoiceId, companyId);
    res.json({
      success: true,
      data: { lines, summary: summarizeSchedule(lines) },
    });
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.getPurchaseInvoiceSchedule = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const lines = await listPurchaseInstallmentsForInvoice(
      req.params.invoiceId,
      companyId
    );
    res.json({
      success: true,
      data: { lines, summary: summarizeSchedule(lines) },
    });
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * Send installment schedule / reminder email for a customer invoice.
 * Uses existing email infrastructure; only reports success when send confirms.
 */
exports.sendCustomerScheduleReminder = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const config = await resolveEffectiveCompanyConfig(companyId);
    if (!config.capabilities?.allowInstallmentSales) {
      return res.status(403).json({
        success: false,
        message: 'Installment sales are not enabled for this company',
      });
    }

    const lines = await listSalesInstallmentsForInvoice(req.params.invoiceId, companyId);
    if (!lines.length) {
      return res.status(404).json({
        success: false,
        message: 'No installment schedule found for this invoice',
      });
    }

    const prisma = require('../prisma/client');
    const invoice = await prisma.salesInvoice.findFirst({
      where: { id: req.params.invoiceId, companyId, isDeleted: false },
    });
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const to = req.body?.email || invoice.customerEmail;
    if (!to) {
      return res.status(400).json({
        success: false,
        message: 'Customer email is required to send the installment schedule',
      });
    }

    const summary = summarizeSchedule(lines);
    const rows = lines
      .map(
        (l) =>
          `<tr><td>${l.installmentNumber}</td><td>${new Date(l.dueDate).toLocaleDateString()}</td><td>${Number(l.amount).toFixed(2)}</td><td>${Number(l.paidAmount || 0).toFixed(2)}</td><td>${l.status}</td></tr>`
      )
      .join('');

    const html = `
      <p>Dear ${invoice.customerName},</p>
      <p>Installment schedule for invoice <strong>${invoice.invoiceNumber}</strong>.</p>
      <p>Total scheduled: ${summary.scheduledTotal.toFixed(2)} · Paid: ${summary.paidTotal.toFixed(2)} · Outstanding: ${summary.outstandingTotal.toFixed(2)}</p>
      <table border="1" cellpadding="6" cellspacing="0">
        <thead><tr><th>#</th><th>Due</th><th>Amount</th><th>Paid</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p>Please contact us if you have questions about your account.</p>
    `;

    if (typeof emailSenderService.sendRawEmail === 'function') {
      const result = await emailSenderService.sendRawEmail(
        to,
        `Installment schedule — ${invoice.invoiceNumber}`,
        html
      );
      return res.json({
        success: true,
        message: 'Installment schedule email sent',
        data: { to, result },
      });
    }

    return res.status(501).json({
      success: false,
      message:
        'Email sender does not expose sendRawEmail. Configure emailSenderService and retry.',
      code: 'EMAIL_SENDER_UNAVAILABLE',
      preview: { to, subject: `Installment schedule — ${invoice.invoiceNumber}` },
    });
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.listReminderCandidates = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const side = String(req.query.side || 'sales').toLowerCase() === 'purchase'
      ? 'purchase'
      : 'sales';
    const daysAhead = parseInt(req.query.daysAhead || '3', 10);
    const candidates = await getInstallmentReminderCandidates(companyId, {
      side,
      daysAhead,
    });
    res.json({ success: true, count: candidates.length, data: candidates });
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({
      success: false,
      message: err.message,
    });
  }
};
