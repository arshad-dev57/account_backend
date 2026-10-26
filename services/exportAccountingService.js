'use strict';

/**
 * Export accounting integration.
 * Reuses the existing chart of accounts, journal, AR, cash/bank and
 * inventory/COGS infrastructure. Commercial invoices are materialised as
 * regular SalesInvoice rows so they appear in Sales reports and AR aging.
 */

const prisma = require('../prisma/client');
const BalanceCalculator = require('../utils/balanceCalculator');
const {
  getOrCreateArAccount,
  getOrCreateSalesRevenueAccount,
} = require('../utils/arAccountHelper');
const { getOrCreateCashAccount } = require('../utils/cashAccountHelper');
const {
  findOrCreateCOGSAccount,
  findOrCreateInventoryAccount,
} = require('../warehouse/services/salesAccountingService');
const { resolveLocationIdRequired } = require('../warehouse/services/locationService');
const SalesInvoiceModel = require('../warehouse/models/SalesInvoice');
const {
  ApiError,
  toNum,
  round,
  logExportAudit,
  nextNumber,
  nextSalesInvoiceNumber,
  resolveExportFiscalYear,
  requiredString,
  positiveNumber,
  nonNegativeNumber,
} = require('./exportHelpers');

function line(account, debit, credit) {
  return {
    accountId: account.id,
    accountName: account.name,
    accountCode: account.code,
    debit: round(debit),
    credit: round(credit),
  };
}

/**
 * A code may already belong to an unrelated account (e.g. "2200 Salaries
 * Payable" when we want "2200 Customer Advances"). Never reuse another
 * account just because its code matches — walk forward to the first free
 * code in the same numeric block instead.
 */
async function findFreeAccountCode(tx, companyId, requestedCode) {
  const base = Number(requestedCode);
  const numeric = Number.isFinite(base) && base > 0 && String(base) === String(requestedCode).trim();

  for (let offset = 0; offset < 100; offset += 1) {
    const candidate = numeric
      ? String(base + offset)
      : `${requestedCode}${offset === 0 ? '' : `-${offset + 1}`}`;
    const taken = await tx.chartOfAccount.findFirst({
      where: { companyId, code: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }

  throw ApiError(`Unable to allocate a chart-of-accounts code near ${requestedCode}`, {
    status: 500,
    code: 'ACCOUNT_CODE_EXHAUSTED',
  });
}

async function findOrCreateAccount(tx, {
  companyId,
  userId,
  code,
  name,
  type,
  parentAccount,
  balanceType,
  keywords = [],
}) {
  let account = await tx.chartOfAccount.findFirst({
    where: { companyId, isActive: true, name: { equals: name, mode: 'insensitive' } },
    orderBy: { code: 'asc' },
  });
  if (account) return account;

  if (keywords.length) {
    account = await tx.chartOfAccount.findFirst({
      where: {
        companyId,
        isActive: true,
        type,
        OR: keywords.map((kw) => ({ name: { startsWith: kw, mode: 'insensitive' } })),
      },
      orderBy: { code: 'asc' },
    });
    if (account) return account;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const accountCode = await findFreeAccountCode(tx, companyId, code);
    try {
      return await tx.chartOfAccount.create({
        data: {
          code: accountCode,
          name,
          type,
          parentAccount: parentAccount || '',
          openingBalance: 0,
          currentBalance: 0,
          balanceType,
          description: `${name} — auto-created for Export Management`,
          taxCode: 'N/A',
          isActive: true,
          createdBy: userId || 'SYSTEM',
          companyId,
        },
      });
    } catch (err) {
      if (err.code !== 'P2002') throw err;
    }
  }

  throw ApiError(`Unable to create the "${name}" chart-of-accounts entry`, {
    status: 500,
    code: 'ACCOUNT_CREATE_FAILED',
  });
}

async function getCustomerAdvancesAccount(tx, companyId, userId) {
  return findOrCreateAccount(tx, {
    companyId,
    userId,
    code: '2200',
    name: 'Customer Advances',
    type: 'Liability',
    parentAccount: 'Current Liabilities',
    balanceType: 'Credit',
    keywords: ['Advance', 'Advances', 'Customer Advance'],
  });
}

async function getFxGainAccount(tx, companyId, userId) {
  return findOrCreateAccount(tx, {
    companyId,
    userId,
    code: '7100',
    name: 'Foreign Exchange Gain',
    type: 'Revenue',
    parentAccount: 'Other Income',
    balanceType: 'Credit',
    keywords: ['Exchange Gain', 'FX Gain', 'Foreign Exchange Gain'],
  });
}

async function getFxLossAccount(tx, companyId, userId) {
  return findOrCreateAccount(tx, {
    companyId,
    userId,
    code: '7200',
    name: 'Foreign Exchange Loss',
    type: 'Expense',
    parentAccount: 'Other Expenses',
    balanceType: 'Debit',
    keywords: ['Exchange Loss', 'FX Loss', 'Foreign Exchange Loss'],
  });
}

async function getBankChargesAccount(tx, companyId, userId) {
  return findOrCreateAccount(tx, {
    companyId,
    userId,
    code: '6300',
    name: 'Bank Charges',
    type: 'Expense',
    parentAccount: 'Operating Expenses',
    balanceType: 'Debit',
    keywords: ['Bank Charges', 'Bank Fees', 'Commission'],
  });
}

async function getExportDutyAccount(tx, companyId, userId) {
  return findOrCreateAccount(tx, {
    companyId,
    userId,
    code: '6100',
    name: 'Export Duties & Taxes',
    type: 'Expense',
    parentAccount: 'Operating Expenses',
    balanceType: 'Debit',
    keywords: ['Export Duty', 'Customs Duty', 'Duties'],
  });
}

async function getFreightAccount(tx, companyId, userId) {
  return findOrCreateAccount(tx, {
    companyId,
    userId,
    code: '6200',
    name: 'Freight & Export Charges',
    type: 'Expense',
    parentAccount: 'Operating Expenses',
    balanceType: 'Debit',
    keywords: ['Freight', 'Shipping Charges', 'Export Charges'],
  });
}

async function getInsuranceAccount(tx, companyId, userId) {
  return findOrCreateAccount(tx, {
    companyId,
    userId,
    code: '6210',
    name: 'Export Insurance',
    type: 'Expense',
    parentAccount: 'Operating Expenses',
    balanceType: 'Debit',
    keywords: ['Insurance'],
  });
}

async function getCommissionAccount(tx, companyId, userId) {
  return findOrCreateAccount(tx, {
    companyId,
    userId,
    code: '6250',
    name: 'Export Commission',
    type: 'Expense',
    parentAccount: 'Operating Expenses',
    balanceType: 'Debit',
    keywords: ['Commission'],
  });
}

async function getMiscAccount(tx, companyId, userId) {
  return findOrCreateAccount(tx, {
    companyId,
    userId,
    code: '6900',
    name: 'Other Export Expenses',
    type: 'Expense',
    parentAccount: 'Operating Expenses',
    balanceType: 'Debit',
    keywords: ['Other Export', 'Miscellaneous'],
  });
}

async function getBankOrCashAccount(tx, { companyId, bankAccountId, userId }) {
  if (bankAccountId) {
    const bank = await tx.bankAccount.findFirst({
      where: { id: bankAccountId, companyId, status: 'Active' },
      include: { chartOfAccount: true },
    });
    if (!bank || !bank.chartOfAccount) {
      throw ApiError('Bank account not found for the active company', {
        status: 400,
        code: 'BANK_ACCOUNT_NOT_FOUND',
        field: 'bankAccountId',
      });
    }
    return { account: bank.chartOfAccount, bankAccount: bank };
  }
  const cash = await getOrCreateCashAccount(userId, companyId, tx);
  return { account: cash, bankAccount: null };
}

async function postJournal(tx, {
  companyId,
  userId,
  date,
  description,
  reference,
  lines,
  fiscalYearId,
  type = 'Normal',
  locationId,
}) {
  const debit = round(lines.reduce((s, l) => s + toNum(l.debit), 0));
  const credit = round(lines.reduce((s, l) => s + toNum(l.credit), 0));
  if (Math.abs(debit - credit) > 0.005) {
    throw ApiError(
      `Journal entry is not balanced (debit ${debit}, credit ${credit})`,
      { status: 500, code: 'UNBALANCED_JOURNAL' }
    );
  }
  const journalEntry = await tx.journalEntry.create({
    data: {
      entryNumber: `JE-EXP-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      date: date || new Date(),
      description,
      reference,
      status: 'Posted',
      type,
      createdBy: userId || 'SYSTEM',
      postedBy: userId || 'SYSTEM',
      postedAt: new Date(),
      companyId,
      fiscalYearId: fiscalYearId || null,
      locationId: locationId || null,
      lines: { create: lines },
    },
    include: { lines: true },
  });
  await BalanceCalculator.applyJournalLines(tx, journalEntry.lines);
  return journalEntry;
}

function shipmentCogsPrecheck() {
  return null;
}

async function assertStockAvailable(tx, { companyId, locationId, items }) {
  const totals = new Map();
  for (const item of items) {
    const productId = item.productId || item.orderItem?.productId;
    if (!productId) continue;
    const key = String(productId);
    const current = totals.get(key) || { productId, name: item.productName, qty: 0 };
    current.qty += toNum(item.quantity);
    totals.set(key, current);
  }
  for (const entry of totals.values()) {
    if (entry.qty <= 0) continue;
    const product = await tx.product.findFirst({
      where: { id: entry.productId, companyId },
      select: { id: true, name: true, sku: true, currentStock: true, availableStock: true },
    });
    if (!product) {
      throw ApiError(`Product ${entry.name || entry.productId} was not found in this company`, {
        status: 400,
        code: 'PRODUCT_NOT_FOUND',
      });
    }
    const stock = await tx.productStock.findUnique({
      where: { productId_locationId: { productId: entry.productId, locationId } },
    });
    const available = stock
      ? toNum(stock.currentStock) - toNum(stock.reservedStock)
      : 0;
    if (available + 0.0001 < entry.qty) {
      throw ApiError(
        `Insufficient stock for ${product.name}. Available at this location: ${available}, required: ${entry.qty}.`,
        { status: 409, code: 'INSUFFICIENT_STOCK', field: 'items' }
      );
    }
  }
}

async function loadOrderForPosting(tx, companyId, orderId) {
  const order = await tx.exportSalesOrder.findFirst({
    where: { id: orderId, companyId },
    include: { items: true },
  });
  if (!order) {
    throw ApiError('Export sales order not found', {
      status: 404,
      code: 'ORDER_NOT_FOUND',
    });
  }
  return order;
}

/**
 * Posts the commercial invoice + COGS + physical stock-out for a shipment
 * dispatch and applies any customer advances. Idempotent via
 * ExportDispatch.salesInvoiceId and the SalesInvoice journal link.
 */
async function postCommercialInvoice(tx, {
  companyId,
  userId,
  orderId,
  shipmentId,
  dispatchId,
  invoiceDate,
  locationId,
}) {
  const dispatch = await tx.exportDispatch.findFirst({
    where: { id: dispatchId, companyId, orderId },
  });
  if (!dispatch) {
    throw ApiError('Export dispatch not found', {
      status: 404,
      code: 'DISPATCH_NOT_FOUND',
    });
  }
  if (dispatch.salesInvoiceId) {
    const existing = await tx.salesInvoice.findUnique({
      where: { id: dispatch.salesInvoiceId },
    });
    return { invoice: existing, idempotent: true };
  }

  const order = await loadOrderForPosting(tx, companyId, orderId);
  if (['Cancelled', 'Completed'].includes(order.status)) {
    throw ApiError(`Cannot invoice an order in status "${order.status}"`, {
      status: 409,
      code: 'INVALID_ORDER_STATUS',
    });
  }

  const customer = await tx.customer.findFirst({
    where: {
      id: order.customerId,
      companyId,
      isActive: true,
      isDeleted: false,
    },
    select: { id: true, name: true, email: true, phone: true },
  });
  if (!customer) {
    throw ApiError(
      'The order customer is missing or inactive for this company. Select a valid customer first.',
      { status: 400, code: 'CUSTOMER_NOT_FOUND', field: 'customerId' }
    );
  }

  const shipment = await tx.exportShipment.findFirst({
    where: { id: shipmentId, companyId, orderId },
    include: { items: true },
  });
  if (!shipment || !(shipment.items || []).length) {
    throw ApiError('Shipment has no items to invoice', {
      status: 400,
      code: 'SHIPMENT_EMPTY',
    });
  }

  const resolvedLocationId = await resolveLocationIdRequired(
    tx,
    companyId,
    locationId || dispatch.locationId || order.locationId || shipment.locationId,
    userId
  );

  await assertStockAvailable(tx, {
    companyId,
    locationId: resolvedLocationId,
    items: shipment.items,
  });

  const orderItemsById = new Map((order.items || []).map((i) => [i.id, i]));
  const orderItemsByProduct = new Map();
  for (const item of order.items || []) {
    const key = String(item.productId);
    if (!orderItemsByProduct.has(key)) orderItemsByProduct.set(key, []);
    orderItemsByProduct.get(key).push(item);
  }

  const invoiceItems = [];
  const qtyUpdates = new Map();
  let subtotalBase = 0;
  let subtotalForeign = 0;

  for (const sItem of shipment.items) {
    const orderItem =
      (sItem.orderItemId && orderItemsById.get(sItem.orderItemId)) ||
      (orderItemsByProduct.get(String(sItem.productId)) || []).find((oi) => {
        const remaining = toNum(oi.quantity) - toNum(oi.shippedQty);
        return toNum(sItem.quantity) <= remaining + 0.0001;
      });
    if (!orderItem) {
      throw ApiError(
        `Shipment item ${sItem.productName} does not match an order line`,
        { status: 400, code: 'SHIPMENT_ITEM_MISMATCH' }
      );
    }
    const qty = toNum(sItem.quantity);
    if (qty <= 0) continue;
    const already = toNum(qtyUpdates.get(orderItem.id)?.qty || 0);
    const remaining = round(toNum(orderItem.quantity) - toNum(orderItem.shippedQty) - already);
    if (qty > remaining + 0.0001) {
      throw ApiError(
        `Shipment quantity for ${sItem.productName} exceeds the remaining order quantity (${Math.max(0, remaining)})`,
        { status: 400, code: 'OVER_SHIPMENT', field: 'items' }
      );
    }
    qtyUpdates.set(orderItem.id, {
      item: orderItem,
      qty: already + qty,
    });

    const unitBase = round(toNum(orderItem.unitPriceBase) || toNum(orderItem.unitPriceForeign) * toNum(order.exchangeRate));
    const unitForeign = round(toNum(orderItem.unitPriceForeign));
    const lineBase = round(qty * unitBase);
    const lineForeign = round(qty * unitForeign);
    subtotalBase = round(subtotalBase + lineBase);
    subtotalForeign = round(subtotalForeign + lineForeign);

    invoiceItems.push({
      productId: sItem.productId,
      productName: sItem.productName,
      sku: sItem.sku || orderItem.sku || 'N/A',
      quantity: qty,
      unitPrice: unitBase,
      discount: 0,
      taxRate: 0,
      taxAmount: 0,
      lineTotal: lineBase,
    });
  }

  if (!invoiceItems.length) {
    throw ApiError('No shippable quantities were found on this shipment', {
      status: 400,
      code: 'SHIPMENT_EMPTY',
    });
  }

  const goodsValue = subtotalBase;
  const priorInvoiced = toNum(order.invoicedBase);
  let freightShare = 0;
  const orderGoodsValue = toNum(order.subtotalBase);
  const orderFreight = toNum(order.freightBase);
  if (orderFreight > 0) {
    if (orderGoodsValue > 0) {
      freightShare = round(orderFreight * (goodsValue / orderGoodsValue));
    }
    const willBeFullyInvoiced =
      round(priorInvoiced + goodsValue) >= round(orderGoodsValue) - 0.01;
    if (willBeFullyInvoiced) {
      freightShare = round(Math.max(0, toNum(order.totalBase) - priorInvoiced - goodsValue));
    }
  }
  const invoiceTotal = round(goodsValue + freightShare);
  const freightShareForeign = order.exchangeRate
    ? round(freightShare / (toNum(order.exchangeRate) || 1))
    : 0;

  const when = invoiceDate ? new Date(invoiceDate) : dispatch.dispatchDate || new Date();
  const fiscalYearId = await resolveExportFiscalYear(companyId, when, tx);
  const invoiceNumber = await nextSalesInvoiceNumber(tx, 'ECI');
  const dueDate = new Date(when);
  dueDate.setDate(dueDate.getDate() + 30);

  const invoice = await tx.salesInvoice.create({
    data: {
      invoiceNumber,
      customerId: customer.id,
      customerName: customer.name || order.customerName,
      customerEmail: customer.email || null,
      customerPhone: customer.phone || null,
      invoiceDate: when,
      dueDate,
      paymentTerms: order.paymentTerms || 'Net 30',
      subtotal: subtotalBase,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: invoiceTotal,
      paidAmount: 0,
      outstanding: invoiceTotal,
      invoiceStatus: 'Draft',
      paymentStatus: 'Unpaid',
      notes: `Export commercial invoice ${invoiceNumber} — order ${order.orderNumber}, shipment ${shipment.shipmentNumber}. Transaction currency ${order.currency} @ ${toNum(order.exchangeRate)}.`,
      createdBy: userId || 'SYSTEM',
      companyId,
      locationId: resolvedLocationId,
      fiscalYearId,
      items: { create: invoiceItems },
    },
    include: { items: true },
  });

  for (const [orderItemId, update] of qtyUpdates.entries()) {
    await tx.exportSalesOrderItem.update({
      where: { id: orderItemId },
      data: {
        shippedQty: { increment: update.qty },
        invoicedQty: { increment: update.qty },
      },
    });
  }

  await tx.exportDispatch.update({
    where: { id: dispatch.id },
    data: {
      salesInvoiceId: invoice.id,
      stockPostedAt: new Date(),
      locationId: resolvedLocationId,
    },
  });

  await tx.exportSalesOrder.update({
    where: { id: order.id },
    data: {
      status: 'Dispatched',
      locationId: resolvedLocationId,
      invoicedBase: { increment: invoiceTotal },
    },
  });

  let posted;
  try {
    posted = await SalesInvoiceModel.postInvoice(invoice.id, userId || 'SYSTEM', tx);
  } catch (err) {
    if (err.statusCode) err.status = err.statusCode;
    if (/insufficient stock/i.test(String(err.message))) {
      err.code = err.code || 'INSUFFICIENT_STOCK';
      err.status = 409;
    }
    throw err;
  }

  const advancesApplied = await applyAdvancesToInvoice(tx, {
    companyId,
    userId,
    order,
    invoiceId: posted.id,
    invoiceNumber: posted.invoiceNumber,
    invoiceTotal,
    fiscalYearId,
    invoiceDate: when,
  });

  await refreshOrderBalances(tx, order.id);

  const docNumber = await nextNumber(tx, 'exportDocument', 'docNumber', companyId, 'EDOC');
  await tx.exportDocument.create({
    data: {
      companyId,
      docNumber,
      docType: 'Commercial Invoice',
      orderId: order.id,
      shipmentId: shipment.id,
      invoiceId: posted.id,
      customerName: customer.name,
      issueDate: when,
      status: 'Finalized',
      notes: `Commercial invoice ${invoiceNumber}`,
      createdBy: userId || null,
    },
  });

  await logExportAudit(
    {
      companyId,
      userId,
      action: 'COMMERCIAL_INVOICE_POSTED',
      entityType: 'ExportSalesOrder',
      entityId: order.id,
      details: {
        invoiceId: posted.id,
        invoiceNumber: posted.invoiceNumber,
        shipmentId: shipment.id,
        subtotalBase,
        subtotalForeign,
        freightShareBase: freightShare,
        invoiceTotal,
        currency: order.currency,
        exchangeRate: toNum(order.exchangeRate),
      },
    },
    tx
  );

  return {
    invoice: posted,
    idempotent: false,
    advancesApplied,
    subtotalBase,
    subtotalForeign,
    freightShare,
    freightShareForeign,
    invoiceTotal,
  };
}

async function applyAdvancesToInvoice(tx, {
  companyId,
  userId,
  order,
  invoiceId,
  invoiceNumber,
  invoiceTotal,
  fiscalYearId,
  invoiceDate,
}) {
  const freshOrder = await tx.exportSalesOrder.findUnique({ where: { id: order.id } });
  const available = round(
    Math.max(0, toNum(freshOrder.advanceReceivedBase) - toNum(freshOrder.advanceAppliedBase))
  );
  if (available <= 0) return 0;

  const invoice = await tx.salesInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return 0;
  const applied = round(Math.min(available, toNum(invoice.outstanding, invoiceTotal)));
  if (applied <= 0) return 0;

  const advancesAccount = await getCustomerAdvancesAccount(tx, companyId, userId);
  const arAccount = await getOrCreateArAccount(
    userId,
    companyId,
    tx
  );
  const je = await postJournal(tx, {
    companyId,
    userId,
    date: invoiceDate,
    description: `Customer advance applied to export invoice ${invoiceNumber}`,
    reference: `${invoiceNumber}-ADV`,
    fiscalYearId,
    lines: [
      line(advancesAccount, applied, 0),
      line(arAccount, 0, applied),
    ],
  });

  const newPaid = round(toNum(invoice.paidAmount) + applied);
  const newOutstanding = round(Math.max(0, toNum(invoice.outstanding) - applied));
  const fullyPaid = newOutstanding <= 0.01;
  await tx.salesInvoice.update({
    where: { id: invoice.id },
    data: {
      paidAmount: newPaid,
      outstanding: newOutstanding,
      paymentStatus: fullyPaid ? 'Paid' : 'Partially Paid',
      invoiceStatus: fullyPaid ? 'Paid' : invoice.invoiceStatus === 'Draft' ? 'Posted' : invoice.invoiceStatus,
      paidAt: fullyPaid ? new Date() : invoice.paidAt,
    },
  });

  const ar = await tx.accountsReceivable.findFirst({ where: { invoiceId: invoice.id } });
  if (ar) {
    const arPaid = round(toNum(ar.paidAmount) + applied);
    const arOutstanding = round(Math.max(0, toNum(ar.outstanding) - applied));
    await tx.accountsReceivable.update({
      where: { id: ar.id },
      data: {
        paidAmount: arPaid,
        outstanding: arOutstanding,
        status: arOutstanding <= 0.01 ? 'Paid' : 'Partial',
      },
    });
  }

  await tx.customer.update({
    where: { id: invoice.customerId },
    data: { outstandingBalance: { decrement: applied } },
  });

  await tx.exportSalesOrder.update({
    where: { id: order.id },
    data: {
      paidBase: { increment: applied },
      advanceAppliedBase: { increment: applied },
    },
  });

  await logExportAudit(
    {
      companyId,
      userId,
      action: 'ADVANCE_APPLIED',
      entityType: 'ExportSalesOrder',
      entityId: order.id,
      details: { invoiceNumber, appliedBase: applied, journalEntryId: je.id },
    },
    tx
  );

  return applied;
}

function resolveExpenseAccount(tx, { companyId, userId, expenseType, explicitAccountId, settings }) {
  if (explicitAccountId) {
    return tx.chartOfAccount
      .findFirst({ where: { id: explicitAccountId, companyId, isActive: true } })
      .then((acc) => {
        if (!acc) {
          throw ApiError('Expense account not found for this company', {
            status: 400,
            code: 'ACCOUNT_NOT_FOUND',
            field: 'accountId',
          });
        }
        return acc;
      });
  }
  const type = String(expenseType || '').toLowerCase();
  if (type.includes('duty') || type.includes('customs') || type.includes('tax')) {
    if (settings?.defaultDutyAccountId) {
      return tx.chartOfAccount.findFirst({
        where: { id: settings.defaultDutyAccountId, companyId, isActive: true },
      }).then((acc) => acc || getExportDutyAccount(tx, companyId, userId));
    }
    return getExportDutyAccount(tx, companyId, userId);
  }
  if (type.includes('freight') || type.includes('shipping') || type.includes('transport')) {
    if (settings?.defaultFreightAccountId) {
      return tx.chartOfAccount.findFirst({
        where: { id: settings.defaultFreightAccountId, companyId, isActive: true },
      }).then((acc) => acc || getFreightAccount(tx, companyId, userId));
    }
    return getFreightAccount(tx, companyId, userId);
  }
  if (type.includes('bank') || type.includes('charge') || type.includes('fee')) {
    if (settings?.defaultBankChargesAccountId) {
      return tx.chartOfAccount.findFirst({
        where: { id: settings.defaultBankChargesAccountId, companyId, isActive: true },
      }).then((acc) => acc || getBankChargesAccount(tx, companyId, userId));
    }
    return getBankChargesAccount(tx, companyId, userId);
  }
  if (type.includes('insurance')) return getInsuranceAccount(tx, companyId, userId);
  if (type.includes('commission')) return getCommissionAccount(tx, companyId, userId);
  return getMiscAccount(tx, companyId, userId);
}

async function postExpense(tx, { companyId, userId, expense, settings }) {
  const account = await resolveExpenseAccount(tx, {
    companyId,
    userId,
    expenseType: expense.expenseType,
    explicitAccountId: expense.accountId,
    settings,
  });
  const { account: creditAccount, bankAccount } = await getBankOrCashAccount(tx, {
    companyId,
    bankAccountId: expense.bankAccountId,
    userId,
  });
  const fiscalYearId = await resolveExportFiscalYear(companyId, expense.date, tx);
  const je = await postJournal(tx, {
    companyId,
    userId,
    date: expense.date,
    description: `Export expense ${expense.expenseNumber} — ${expense.expenseType}`,
    reference: expense.expenseNumber,
    fiscalYearId,
    lines: [
      line(account, expense.amountBase, 0),
      line(creditAccount, 0, expense.amountBase),
    ],
  });
  if (bankAccount) {
    await tx.bankAccount.update({
      where: { id: bankAccount.id },
      data: { currentBalance: { decrement: toNum(expense.amountBase) } },
    });
  }
  return { journalEntry: je, account, bankAccountId: bankAccount?.id || null };
}

async function reverseExpense(tx, { companyId, userId, expense }) {
  const original = await tx.journalEntry.findFirst({
    where: { id: expense.journalEntryId, companyId },
    include: { lines: true },
  });
  if (!original) {
    throw ApiError('Original expense journal entry was not found', {
      status: 400,
      code: 'JOURNAL_NOT_FOUND',
    });
  }
  const fiscalYearId = await resolveExportFiscalYear(companyId, new Date(), tx);
  const je = await postJournal(tx, {
    companyId,
    userId,
    date: new Date(),
    description: `Reversal of export expense ${expense.expenseNumber}`,
    reference: `${expense.expenseNumber}-REV`,
    fiscalYearId,
    type: 'Reversal',
    lines: original.lines.map((l) =>
      line(
        { id: l.accountId, name: l.accountName, code: l.accountCode },
        l.credit,
        l.debit
      )
    ),
  });
  if (expense.bankAccountId) {
    await tx.bankAccount.update({
      where: { id: expense.bankAccountId },
      data: { currentBalance: { increment: toNum(expense.amountBase) } },
    });
  }
  return je;
}

/**
 * Contract balance = total - cash applied - unapplied advances.
 * Recomputed from source fields to avoid drift.
 */
async function refreshOrderBalances(tx, orderId) {
  const order = await tx.exportSalesOrder.findUnique({ where: { id: orderId } });
  if (!order) return null;
  const total = toNum(order.totalBase);
  const paid = toNum(order.paidBase);
  const unappliedAdvance = Math.max(
    0,
    toNum(order.advanceReceivedBase) - toNum(order.advanceAppliedBase)
  );
  const outstanding = round(Math.max(0, total - paid - unappliedAdvance));
  if (outstanding !== toNum(order.outstandingBase)) {
    await tx.exportSalesOrder.update({
      where: { id: order.id },
      data: { outstandingBase: outstanding },
    });
  }
  return outstanding;
}

/**
 * Settlement receipt against a posted commercial invoice.
 * AR is relieved at the invoice FX rate; the bank receives the actual
 * remittance and any difference is recognised as a realised FX gain/loss.
 */
async function postSettlementAccounting(tx, {
  companyId,
  userId,
  receipt,
  order,
  invoice,
  bankAccountId,
}) {
  if (String(invoice.companyId) !== String(companyId)) {
    throw ApiError('Invoice does not belong to the active company', {
      status: 403,
      code: 'CROSS_COMPANY_DENIED',
    });
  }
  if (invoice.invoiceStatus === 'Cancelled' || invoice.isDeleted) {
    throw ApiError('Cannot settle a cancelled invoice', {
      status: 409,
      code: 'INVOICE_CANCELLED',
    });
  }
  if (toNum(invoice.outstanding) <= 0.005) {
    throw ApiError('Invoice is already fully paid', {
      status: 409,
      code: 'INVOICE_PAID',
    });
  }

  const invoiceRate = toNum(order.exchangeRate) || 1;
  const arRelief = round(Math.min(
    toNum(invoice.outstanding),
    toNum(receipt.foreignAmount) * invoiceRate
  ));
  if (arRelief <= 0) {
    throw ApiError('Receipt amount does not relieve any invoice balance', {
      status: 400,
      code: 'INVALID_AMOUNT',
    });
  }

  const grossBase = round(toNum(receipt.grossBase));
  const chargesBase = round(toNum(receipt.bankChargesBase));
  const netBase = round(Math.max(0, grossBase - chargesBase));
  const fxDiff = round(grossBase - arRelief);

  const { account: bankAccountCoa, bankAccount } = await getBankOrCashAccount(tx, {
    companyId,
    bankAccountId,
    userId,
  });
  const arAccount = await getOrCreateArAccount(userId, companyId, tx);

  const lines = [
    line(bankAccountCoa, netBase, 0),
    line(arAccount, 0, arRelief),
  ];
  if (chargesBase > 0) {
    const chargesAccount = await getBankChargesAccount(tx, companyId, userId);
    lines.push(line(chargesAccount, chargesBase, 0));
  }
  if (fxDiff > 0.005) {
    const gain = await getFxGainAccount(tx, companyId, userId);
    lines.push(line(gain, 0, fxDiff));
  } else if (fxDiff < -0.005) {
    const loss = await getFxLossAccount(tx, companyId, userId);
    lines.push(line(loss, Math.abs(fxDiff), 0));
  }

  const fiscalYearId = await resolveExportFiscalYear(companyId, receipt.receiptDate, tx);
  const je = await postJournal(tx, {
    companyId,
    userId,
    date: receipt.receiptDate,
    description: `Export settlement ${receipt.receiptNumber} — invoice ${invoice.invoiceNumber}`,
    reference: receipt.receiptNumber,
    fiscalYearId,
    lines,
  });

  const newPaid = round(toNum(invoice.paidAmount) + arRelief);
  const newOutstanding = round(Math.max(0, toNum(invoice.outstanding) - arRelief));
  const fullyPaid = newOutstanding <= 0.01;
  await tx.salesInvoice.update({
    where: { id: invoice.id },
    data: {
      paidAmount: newPaid,
      outstanding: newOutstanding,
      paymentStatus: fullyPaid ? 'Paid' : 'Partially Paid',
      invoiceStatus: fullyPaid ? 'Paid' : invoice.invoiceStatus === 'Draft' ? 'Posted' : invoice.invoiceStatus,
      paidAt: fullyPaid ? new Date() : invoice.paidAt,
    },
  });

  const ar = await tx.accountsReceivable.findFirst({ where: { invoiceId: invoice.id } });
  if (ar) {
    const arPaid = round(toNum(ar.paidAmount) + arRelief);
    const arOutstanding = round(Math.max(0, toNum(ar.outstanding) - arRelief));
    await tx.accountsReceivable.update({
      where: { id: ar.id },
      data: {
        paidAmount: arPaid,
        outstanding: arOutstanding,
        status: arOutstanding <= 0.01 ? 'Paid' : 'Partial',
      },
    });
  }

  await tx.customer.update({
    where: { id: invoice.customerId },
    data: { outstandingBalance: { decrement: arRelief } },
  });

  if (bankAccount) {
    await tx.bankAccount.update({
      where: { id: bankAccount.id },
      data: { currentBalance: { increment: netBase } },
    });
  }

  await tx.exportSalesOrder.update({
    where: { id: order.id },
    data: { paidBase: { increment: arRelief } },
  });
  await refreshOrderBalances(tx, order.id);

  await tx.exportReceipt.update({
    where: { id: receipt.id },
    data: {
      status: 'Realized & Credited',
      journalEntryId: je.id,
      grossBase,
      netBase,
      fxGainLossBase: fxDiff,
      appliedBase: arRelief,
    },
  });

  return { journalEntry: je, arRelief, fxDiff, netBase };
}

/** Advance receipt: cash received before the commercial invoice exists. */
async function postAdvanceAccounting(tx, {
  companyId,
  userId,
  receipt,
  order,
  proforma,
  bankAccountId,
}) {
  const grossBase = round(toNum(receipt.grossBase));
  const chargesBase = round(toNum(receipt.bankChargesBase));
  const netBase = round(Math.max(0, grossBase - chargesBase));

  const { account: bankAccountCoa, bankAccount } = await getBankOrCashAccount(tx, {
    companyId,
    bankAccountId,
    userId,
  });
  const advancesAccount = await getCustomerAdvancesAccount(tx, companyId, userId);

  const lines = [line(advancesAccount, 0, grossBase)];
  if (netBase > 0) lines.push(line(bankAccountCoa, netBase, 0));
  if (chargesBase > 0) {
    const chargesAccount = await getBankChargesAccount(tx, companyId, userId);
    lines.push(line(chargesAccount, chargesBase, 0));
  }

  const fiscalYearId = await resolveExportFiscalYear(companyId, receipt.receiptDate, tx);
  const je = await postJournal(tx, {
    companyId,
    userId,
    date: receipt.receiptDate,
    description: `Export advance ${receipt.receiptNumber} — order ${order.orderNumber}`,
    reference: receipt.receiptNumber,
    fiscalYearId,
    lines,
  });

  if (bankAccount) {
    await tx.bankAccount.update({
      where: { id: bankAccount.id },
      data: { currentBalance: { increment: netBase } },
    });
  }

  await tx.exportSalesOrder.update({
    where: { id: order.id },
    data: { advanceReceivedBase: { increment: grossBase } },
  });
  await refreshOrderBalances(tx, order.id);

  if (proforma) {
    await tx.exportProformaInvoice.update({
      where: { id: proforma.id },
      data: {
        advanceReceivedBase: { increment: grossBase },
        status:
          proforma.status === 'Issued' || proforma.status === 'LC Advised'
            ? 'Advance Remittance Received'
            : proforma.status,
      },
    });
  }

  await tx.exportReceipt.update({
    where: { id: receipt.id },
    data: {
      status: 'Realized & Credited',
      journalEntryId: je.id,
      grossBase,
      netBase,
      fxGainLossBase: 0,
      appliedBase: 0,
    },
  });

  return { journalEntry: je, netBase };
}

module.exports = {
  findOrCreateAccount,
  getCustomerAdvancesAccount,
  getFxGainAccount,
  getFxLossAccount,
  getBankChargesAccount,
  getExportDutyAccount,
  getFreightAccount,
  getMiscAccount,
  getCommissionAccount,
  getBankOrCashAccount,
  postJournal,
  postCommercialInvoice,
  applyAdvancesToInvoice,
  postSettlementAccounting,
  postAdvanceAccounting,
  postExpense,
  reverseExpense,
  refreshOrderBalances,
  resolveExpenseAccount,
  assertStockAvailable,
  findOrCreateCOGSAccount,
  findOrCreateInventoryAccount,
  getOrCreateSalesRevenueAccount,
  getOrCreateArAccount,
  getOrCreateCashAccount,
  // exported for tests
  shipmentCogsPrecheck,
};
