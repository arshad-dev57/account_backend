'use strict';

const { randomUUID } = require('crypto');
const prisma = require('../prisma/client');
const {
  INSTALLMENT_FREQUENCIES,
  assertInstallmentSalesAllowed,
  assertInstallmentPurchaseAllowed,
  resolveEffectiveCompanyConfig,
} = require('../utils/companyBusinessConfig');

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function addFrequency(date, frequency, index) {
  const d = new Date(date);
  const f = String(frequency || 'monthly').toLowerCase();
  switch (f) {
    case 'weekly':
      d.setDate(d.getDate() + 7 * index);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14 * index);
      break;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3 * index);
      break;
    case 'monthly':
    default:
      d.setMonth(d.getMonth() + index);
      break;
  }
  return d;
}

/**
 * Build an equal installment schedule after down payment.
 * Last installment absorbs rounding remainder.
 */
function buildInstallmentPlan({
  grandTotal,
  downPaymentAmount = 0,
  installmentCount,
  installmentFrequency = 'monthly',
  startDate = new Date(),
}) {
  const total = roundMoney(grandTotal);
  const down = roundMoney(Math.max(0, Number(downPaymentAmount) || 0));
  const count = parseInt(installmentCount, 10);

  if (!(total > 0)) {
    throw Object.assign(new Error('Grand total must be greater than zero for installment plan'), {
      statusCode: 400,
    });
  }
  if (down >= total) {
    throw Object.assign(new Error('Down payment must be less than the grand total'), {
      statusCode: 400,
    });
  }
  if (!count || count < 1 || count > 120) {
    throw Object.assign(new Error('Installment count must be between 1 and 120'), {
      statusCode: 400,
    });
  }
  const freq = String(installmentFrequency || 'monthly').toLowerCase();
  if (!INSTALLMENT_FREQUENCIES.includes(freq)) {
    throw Object.assign(
      new Error(`Invalid installment frequency (${INSTALLMENT_FREQUENCIES.join(', ')})`),
      { statusCode: 400 }
    );
  }

  const financed = roundMoney(total - down);
  const baseAmount = roundMoney(financed / count);
  const schedule = [];
  let allocated = 0;

  for (let i = 1; i <= count; i += 1) {
    const amount =
      i === count ? roundMoney(financed - allocated) : baseAmount;
    allocated = roundMoney(allocated + amount);
    schedule.push({
      installmentNumber: i,
      dueDate: addFrequency(startDate, freq, i),
      amount,
      paidAmount: 0,
      status: 'Pending',
    });
  }

  return {
    downPaymentAmount: down,
    installmentCount: count,
    installmentFrequency: freq,
    installmentAmount: baseAmount,
    financedAmount: financed,
    schedule,
  };
}

function normalizeInstallmentSaleInput(body = {}) {
  const isInstallment =
    body.isInstallmentSale === true ||
    body.isInstallmentSale === 'true' ||
    body.isInstallmentSale === 1 ||
    body.isInstallmentSale === '1' ||
    String(body.saleType || '').toLowerCase() === 'installment';

  if (!isInstallment) {
    return { isInstallmentSale: false };
  }

  return {
    isInstallmentSale: true,
    downPaymentAmount: Number(body.downPaymentAmount ?? body.down_payment_amount ?? 0) || 0,
    installmentCount: body.installmentCount ?? body.installment_count,
    installmentFrequency:
      body.installmentFrequency || body.installment_frequency || 'monthly',
  };
}

function normalizeInstallmentPurchaseInput(body = {}) {
  const isInstallment =
    body.isInstallmentPurchase === true ||
    body.isInstallmentPurchase === 'true' ||
    body.isInstallmentPurchase === 1 ||
    body.isInstallmentPurchase === '1' ||
    String(body.purchaseType || '').toLowerCase() === 'installment';

  if (!isInstallment) {
    return { isInstallmentPurchase: false };
  }

  return {
    isInstallmentPurchase: true,
    downPaymentAmount: Number(body.downPaymentAmount ?? body.down_payment_amount ?? 0) || 0,
    installmentCount: body.installmentCount ?? body.installment_count,
    installmentFrequency:
      body.installmentFrequency || body.installment_frequency || 'monthly',
  };
}

async function createSalesInstallmentSchedule({
  companyId,
  invoiceId,
  grandTotal,
  invoiceDate,
  planInput,
  tx = prisma,
}) {
  const config = await resolveEffectiveCompanyConfig(companyId);
  assertInstallmentSalesAllowed(config, { isInstallment: true });

  const plan = buildInstallmentPlan({
    grandTotal,
    downPaymentAmount: planInput.downPaymentAmount,
    installmentCount: planInput.installmentCount,
    installmentFrequency: planInput.installmentFrequency,
    startDate: invoiceDate || new Date(),
  });

  await tx.salesInstallmentSchedule.deleteMany({ where: { invoiceId } });

  await tx.salesInstallmentSchedule.createMany({
    data: plan.schedule.map((row) => ({
      id: randomUUID(),
      companyId,
      invoiceId,
      installmentNumber: row.installmentNumber,
      dueDate: row.dueDate,
      amount: row.amount,
      paidAmount: 0,
      status: 'Pending',
      notes: '',
    })),
  });

  return plan;
}

async function createPurchaseInstallmentSchedule({
  companyId,
  invoiceId,
  grandTotal,
  invoiceDate,
  planInput,
  tx = prisma,
}) {
  const config = await resolveEffectiveCompanyConfig(companyId);
  assertInstallmentPurchaseAllowed(config, { isInstallment: true });

  const plan = buildInstallmentPlan({
    grandTotal,
    downPaymentAmount: planInput.downPaymentAmount,
    installmentCount: planInput.installmentCount,
    installmentFrequency: planInput.installmentFrequency,
    startDate: invoiceDate || new Date(),
  });

  await tx.purchaseInstallmentSchedule.deleteMany({ where: { invoiceId } });

  await tx.purchaseInstallmentSchedule.createMany({
    data: plan.schedule.map((row) => ({
      id: randomUUID(),
      companyId,
      invoiceId,
      installmentNumber: row.installmentNumber,
      dueDate: row.dueDate,
      amount: row.amount,
      paidAmount: 0,
      status: 'Pending',
      notes: '',
    })),
  });

  return plan;
}

/**
 * Apply a payment amount FIFO across pending installment lines for an invoice.
 * Does not create accounting entries — caller uses existing payment/accounting services.
 */
function orderInstallmentLines(lines, preferredInstallmentIds) {
  if (!preferredInstallmentIds?.length) return lines;
  const byId = new Map(lines.map((l) => [l.id, l]));
  const preferred = [];
  const seen = new Set();
  for (const id of preferredInstallmentIds) {
    const row = byId.get(id);
    if (row && !seen.has(row.id)) {
      preferred.push(row);
      seen.add(row.id);
    }
  }
  const rest = lines.filter((l) => !seen.has(l.id));
  return [...preferred, ...rest];
}

async function applyPaymentToSalesInstallments({
  companyId,
  invoiceId,
  amount,
  salesPaymentId = null,
  preferredInstallmentIds = null,
  tx = prisma,
}) {
  let remaining = roundMoney(amount);
  if (!(remaining > 0)) return { applied: 0, lines: [] };

  const openLines = await tx.salesInstallmentSchedule.findMany({
    where: {
      companyId,
      invoiceId,
      status: { in: ['Pending', 'Partial', 'Overdue'] },
    },
    orderBy: [{ installmentNumber: 'asc' }],
  });
  const lines = orderInstallmentLines(openLines, preferredInstallmentIds);

  const updated = [];
  for (const line of lines) {
    if (remaining <= 0) break;
    const due = roundMoney(line.amount - (line.paidAmount || 0));
    if (due <= 0) continue;
    const pay = Math.min(due, remaining);
    const newPaid = roundMoney((line.paidAmount || 0) + pay);
    const status = newPaid >= roundMoney(line.amount) - 0.001 ? 'Paid' : 'Partial';
    const row = await tx.salesInstallmentSchedule.update({
      where: { id: line.id },
      data: {
        paidAmount: newPaid,
        status,
        paidAt: status === 'Paid' ? new Date() : line.paidAt,
        salesPaymentId: salesPaymentId || line.salesPaymentId,
      },
    });
    updated.push(row);
    remaining = roundMoney(remaining - pay);
  }

  return { applied: roundMoney(amount - remaining), lines: updated };
}

async function applyPaymentToPurchaseInstallments({
  companyId,
  invoiceId,
  amount,
  purchasePaymentId = null,
  preferredInstallmentIds = null,
  tx = prisma,
}) {
  let remaining = roundMoney(amount);
  if (!(remaining > 0)) return { applied: 0, lines: [] };

  const openLines = await tx.purchaseInstallmentSchedule.findMany({
    where: {
      companyId,
      invoiceId,
      status: { in: ['Pending', 'Partial', 'Overdue'] },
    },
    orderBy: [{ installmentNumber: 'asc' }],
  });
  const lines = orderInstallmentLines(openLines, preferredInstallmentIds);

  const updated = [];
  for (const line of lines) {
    if (remaining <= 0) break;
    const due = roundMoney(line.amount - (line.paidAmount || 0));
    if (due <= 0) continue;
    const pay = Math.min(due, remaining);
    const newPaid = roundMoney((line.paidAmount || 0) + pay);
    const status = newPaid >= roundMoney(line.amount) - 0.001 ? 'Paid' : 'Partial';
    const row = await tx.purchaseInstallmentSchedule.update({
      where: { id: line.id },
      data: {
        paidAmount: newPaid,
        status,
        paidAt: status === 'Paid' ? new Date() : line.paidAt,
        purchasePaymentId: purchasePaymentId || line.purchasePaymentId,
      },
    });
    updated.push(row);
    remaining = roundMoney(remaining - pay);
  }

  return { applied: roundMoney(amount - remaining), lines: updated };
}

async function listSalesInstallmentsForInvoice(invoiceId, companyId) {
  return prisma.salesInstallmentSchedule.findMany({
    where: {
      invoiceId,
      ...(companyId ? { companyId } : {}),
    },
    orderBy: { installmentNumber: 'asc' },
  });
}

async function listPurchaseInstallmentsForInvoice(invoiceId, companyId) {
  return prisma.purchaseInstallmentSchedule.findMany({
    where: {
      invoiceId,
      ...(companyId ? { companyId } : {}),
    },
    orderBy: { installmentNumber: 'asc' },
  });
}

function summarizeSchedule(lines = []) {
  const now = new Date();
  let scheduled = 0;
  let paid = 0;
  let overdue = 0;
  let nextDue = null;
  for (const line of lines) {
    const amt = Number(line.amount) || 0;
    const paidAmt = Number(line.paidAmount) || 0;
    scheduled = roundMoney(scheduled + amt);
    paid = roundMoney(paid + paidAmt);
    const outstanding = roundMoney(amt - paidAmt);
    if (outstanding > 0.001 && new Date(line.dueDate) < now) {
      overdue = roundMoney(overdue + outstanding);
    }
    if (outstanding > 0.001) {
      if (!nextDue || new Date(line.dueDate) < new Date(nextDue.dueDate)) {
        nextDue = line;
      }
    }
  }
  return {
    scheduledTotal: scheduled,
    paidTotal: paid,
    outstandingTotal: roundMoney(scheduled - paid),
    overdueTotal: overdue,
    nextDueDate: nextDue?.dueDate || null,
    nextDueAmount: nextDue
      ? roundMoney((Number(nextDue.amount) || 0) - (Number(nextDue.paidAmount) || 0))
      : 0,
    lineCount: lines.length,
    paidLineCount: lines.filter((l) => l.status === 'Paid').length,
  };
}

/**
 * Mark past-due open installment lines as Overdue (company-scoped).
 */
async function markOverdueInstallments(companyId, asOfDate = new Date()) {
  if (!companyId) throw Object.assign(new Error('Company context required'), { statusCode: 400 });
  const asOf = new Date(asOfDate);
  const sales = await prisma.salesInstallmentSchedule.updateMany({
    where: {
      companyId,
      status: { in: ['Pending', 'Partial'] },
      dueDate: { lt: asOf },
    },
    data: { status: 'Overdue' },
  });
  const purchase = await prisma.purchaseInstallmentSchedule.updateMany({
    where: {
      companyId,
      status: { in: ['Pending', 'Partial'] },
      dueDate: { lt: asOf },
    },
    data: { status: 'Overdue' },
  });
  return { salesUpdated: sales.count, purchaseUpdated: purchase.count, asOf };
}

/**
 * Reverse FIFO application when a sales payment is cancelled.
 * Rebuilds paid amounts for the invoice from remaining non-cancelled payments.
 */
async function reversePaymentFromSalesInstallments({
  companyId,
  invoiceId,
  amount,
  salesPaymentId = null,
  tx = prisma,
}) {
  const lines = await tx.salesInstallmentSchedule.findMany({
    where: { companyId, invoiceId },
    orderBy: [{ installmentNumber: 'desc' }],
  });
  let remaining = roundMoney(amount);
  const updated = [];
  for (const line of lines) {
    if (remaining <= 0) break;
    const paidAmt = Number(line.paidAmount) || 0;
    if (paidAmt <= 0) continue;
    const take = Math.min(paidAmt, remaining);
    const newPaid = roundMoney(paidAmt - take);
    let status = 'Pending';
    if (newPaid <= 0.001) status = 'Pending';
    else if (newPaid < roundMoney(line.amount) - 0.001) status = 'Partial';
    else status = 'Paid';
    if (status !== 'Paid' && new Date(line.dueDate) < new Date()) status = 'Overdue';
    const row = await tx.salesInstallmentSchedule.update({
      where: { id: line.id },
      data: {
        paidAmount: Math.max(0, newPaid),
        status,
        paidAt: status === 'Paid' ? line.paidAt : null,
        salesPaymentId:
          salesPaymentId && line.salesPaymentId === salesPaymentId ? null : line.salesPaymentId,
      },
    });
    updated.push(row);
    remaining = roundMoney(remaining - take);
  }
  return { reversed: roundMoney(amount - remaining), lines: updated };
}

async function reversePaymentFromPurchaseInstallments({
  companyId,
  invoiceId,
  amount,
  purchasePaymentId = null,
  tx = prisma,
}) {
  const lines = await tx.purchaseInstallmentSchedule.findMany({
    where: { companyId, invoiceId },
    orderBy: [{ installmentNumber: 'desc' }],
  });
  let remaining = roundMoney(amount);
  const updated = [];
  for (const line of lines) {
    if (remaining <= 0) break;
    const paidAmt = Number(line.paidAmount) || 0;
    if (paidAmt <= 0) continue;
    const take = Math.min(paidAmt, remaining);
    const newPaid = roundMoney(paidAmt - take);
    let status = 'Pending';
    if (newPaid <= 0.001) status = 'Pending';
    else if (newPaid < roundMoney(line.amount) - 0.001) status = 'Partial';
    else status = 'Paid';
    if (status !== 'Paid' && new Date(line.dueDate) < new Date()) status = 'Overdue';
    const row = await tx.purchaseInstallmentSchedule.update({
      where: { id: line.id },
      data: {
        paidAmount: Math.max(0, newPaid),
        status,
        paidAt: status === 'Paid' ? line.paidAt : null,
        purchasePaymentId:
          purchasePaymentId && line.purchasePaymentId === purchasePaymentId
            ? null
            : line.purchasePaymentId,
      },
    });
    updated.push(row);
    remaining = roundMoney(remaining - take);
  }
  return { reversed: roundMoney(amount - remaining), lines: updated };
}

/**
 * Cancel remaining unpaid installment lines (e.g. after full credit note / return).
 * Does not alter already-paid amounts or create accounting entries.
 */
async function cancelOpenInstallmentsForSalesInvoice(invoiceId, companyId, tx = prisma) {
  return tx.salesInstallmentSchedule.updateMany({
    where: {
      invoiceId,
      ...(companyId ? { companyId } : {}),
      status: { in: ['Pending', 'Partial', 'Overdue'] },
    },
    data: { status: 'Cancelled' },
  });
}

async function cancelOpenInstallmentsForPurchaseInvoice(invoiceId, companyId, tx = prisma) {
  return tx.purchaseInstallmentSchedule.updateMany({
    where: {
      invoiceId,
      ...(companyId ? { companyId } : {}),
      status: { in: ['Pending', 'Partial', 'Overdue'] },
    },
    data: { status: 'Cancelled' },
  });
}

async function getInstallmentReport(companyId, { side = 'sales', status, fromDate, toDate } = {}) {
  if (!companyId) throw Object.assign(new Error('Company context required'), { statusCode: 400 });
  const where = { companyId };
  if (status) where.status = status;
  if (fromDate || toDate) {
    where.dueDate = {};
    if (fromDate) where.dueDate.gte = new Date(fromDate);
    if (toDate) where.dueDate.lte = new Date(toDate);
  }

  if (side === 'purchase') {
    const lines = await prisma.purchaseInstallmentSchedule.findMany({
      where,
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            supplierId: true,
            supplierName: true,
            grandTotal: true,
            outstanding: true,
            isInstallmentPurchase: true,
          },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
      take: 500,
    });
    return { side: 'purchase', count: lines.length, summary: summarizeSchedule(lines), lines };
  }

  const lines = await prisma.salesInstallmentSchedule.findMany({
    where,
    include: {
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          customerId: true,
          customerName: true,
          grandTotal: true,
          outstanding: true,
          isInstallmentSale: true,
        },
      },
    },
    orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
    take: 500,
  });
  return { side: 'sales', count: lines.length, summary: summarizeSchedule(lines), lines };
}

async function getCustomerInstallmentSummary(companyId, customerId) {
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      companyId,
      customerId,
      isInstallmentSale: true,
      isActive: true,
      isDeleted: false,
    },
    select: {
      id: true,
      invoiceNumber: true,
      grandTotal: true,
      paidAmount: true,
      outstanding: true,
      downPaymentAmount: true,
      installmentCount: true,
      installmentFrequency: true,
      invoiceStatus: true,
      paymentStatus: true,
      installmentSchedules: { orderBy: { installmentNumber: 'asc' } },
    },
    orderBy: { invoiceDate: 'desc' },
    take: 100,
  });
  const allLines = invoices.flatMap((inv) => inv.installmentSchedules || []);
  return {
    customerId,
    invoices,
    summary: summarizeSchedule(allLines),
  };
}

async function getSupplierInstallmentSummary(companyId, supplierId) {
  const invoices = await prisma.purchaseInvoice.findMany({
    where: {
      companyId,
      supplierId,
      isInstallmentPurchase: true,
      isActive: true,
      isDeleted: false,
    },
    select: {
      id: true,
      invoiceNumber: true,
      grandTotal: true,
      paidAmount: true,
      outstanding: true,
      downPaymentAmount: true,
      installmentCount: true,
      installmentFrequency: true,
      invoiceStatus: true,
      paymentStatus: true,
      installmentSchedules: { orderBy: { installmentNumber: 'asc' } },
    },
    orderBy: { invoiceDate: 'desc' },
    take: 100,
  });
  const allLines = invoices.flatMap((inv) => inv.installmentSchedules || []);
  return {
    supplierId,
    invoices,
    summary: summarizeSchedule(allLines),
  };
}

/**
 * Build reminder payload for overdue/upcoming dues (caller sends email).
 */
async function getInstallmentReminderCandidates(companyId, { daysAhead = 3, side = 'sales' } = {}) {
  const now = new Date();
  const until = new Date(now);
  until.setDate(until.getDate() + Number(daysAhead || 3));

  if (side === 'purchase') {
    return prisma.purchaseInstallmentSchedule.findMany({
      where: {
        companyId,
        status: { in: ['Pending', 'Partial', 'Overdue'] },
        dueDate: { lte: until },
      },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            supplierId: true,
            supplierName: true,
            supplierEmail: true,
            outstanding: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' },
      take: 200,
    });
  }

  return prisma.salesInstallmentSchedule.findMany({
    where: {
      companyId,
      status: { in: ['Pending', 'Partial', 'Overdue'] },
      dueDate: { lte: until },
    },
    include: {
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          customerId: true,
          customerName: true,
          customerEmail: true,
          outstanding: true,
        },
      },
    },
    orderBy: { dueDate: 'asc' },
    take: 200,
  });
}

module.exports = {
  roundMoney,
  buildInstallmentPlan,
  normalizeInstallmentSaleInput,
  normalizeInstallmentPurchaseInput,
  createSalesInstallmentSchedule,
  createPurchaseInstallmentSchedule,
  applyPaymentToSalesInstallments,
  applyPaymentToPurchaseInstallments,
  reversePaymentFromSalesInstallments,
  reversePaymentFromPurchaseInstallments,
  listSalesInstallmentsForInvoice,
  listPurchaseInstallmentsForInvoice,
  summarizeSchedule,
  markOverdueInstallments,
  cancelOpenInstallmentsForSalesInvoice,
  cancelOpenInstallmentsForPurchaseInvoice,
  getInstallmentReport,
  getCustomerInstallmentSummary,
  getSupplierInstallmentSummary,
  getInstallmentReminderCandidates,
};
