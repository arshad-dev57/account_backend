'use strict';

/**
 * Export Management service.
 * Complete export sales lifecycle on top of the existing ERP accounting,
 * inventory, currency and company-isolation infrastructure.
 */

const prisma = require('../prisma/client');
const {
  ApiError,
  toNum,
  round,
  asDate,
  requiredDate,
  requiredString,
  positiveNumber,
  nonNegativeNumber,
  getScope,
  getWriteCompany,
  buildPagination,
  paged,
  contains,
  logExportAudit,
  nextNumber,
  resolveFx,
  resolveExportFiscalYear,
  canonicalStatus,
  assertTransition,
  toPlain,
  createWithNumbering,
} = require('./exportHelpers');
const {
  assertLocationBelongsToActiveCompany,
  assertRecordCompanyAccess,
} = require('../utils/companyAccess');
const accounting = require('./exportAccountingService');
const {
  getCompanyBaseCurrency,
  getExchangeRate,
} = require('../utils/multiCurrency');
const { getOrCreateCashAccount } = require('../utils/cashAccountHelper');

const INCLUDE = {
  inquiry: { items: { orderBy: { id: 'asc' } } },
  quotation: { items: { orderBy: { id: 'asc' } } },
  order: { items: { orderBy: { id: 'asc' } } },
  packing: { items: true },
  shipment: { items: true },
};

function requireScope(req) {
  const scope = getScope(req);
  if (!scope) {
    throw ApiError('Select an active company first', {
      status: 400,
      code: 'COMPANY_REQUIRED',
    });
  }
  return scope;
}

async function loadScopedRecord(req, model, id, include) {
  const scope = requireScope(req);
  const record = await prisma[model].findFirst({
    where: { id, companyId: scope },
    ...(include ? { include } : {}),
  });
  if (!record) {
    throw ApiError(`${model} record not found`, {
      status: 404,
      code: 'NOT_FOUND',
    });
  }
  return record;
}

async function loadWriteRecord(req, model, id, include) {
  const companyId = getWriteCompany(req);
  const record = await prisma[model].findFirst({
    where: { id, companyId },
    ...(include ? { include } : {}),
  });
  if (!record) {
    throw ApiError(`${model} record not found for the active company`, {
      status: 404,
      code: 'NOT_FOUND',
    });
  }
  return record;
}

function statusWhere(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase() === 'all') return null;
  return raw;
}

function dateRangeWhere(field, query) {
  const start = query.startDate ? asDate(query.startDate, 'startDate') : null;
  const end = query.endDate ? asDate(query.endDate, 'endDate') : null;
  if (!start && !end) return null;
  const filter = {};
  if (start) filter.gte = start;
  if (end) {
    const e = new Date(end);
    e.setHours(23, 59, 59, 999);
    filter.lte = e;
  }
  return { [field]: filter };
}

function safeOrderBy(value, allowed, fallback) {
  const field = String(value || '').trim();
  if (!allowed.includes(field)) return fallback;
  return field;
}

async function listCollection(req, query, {
  model,
  include,
  searchFields = [],
  statusField = 'status',
  dateField,
  allowedSort = [],
  defaultSort = 'createdAt',
  extraWhere = null,
}) {
  const scope = requireScope(req);
  const { page, limit, skip } = buildPagination(query);
  const where = { companyId: scope };
  const status = statusWhere(query.status);
  if (status && statusField) where[statusField] = status;
  if (query.search && searchFields.length) {
    where.OR = searchFields.map((f) => ({ [f]: contains(query.search) }));
  }
  if (dateField) {
    const range = dateRangeWhere(dateField, query);
    if (range) Object.assign(where, range);
  }
  if (extraWhere) Object.assign(where, extraWhere);
  const sortField = safeOrderBy(query.sortBy, allowedSort, defaultSort);
  const sortDir = String(query.sortDir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const [total, items] = await Promise.all([
    prisma[model].count({ where }),
    prisma[model].findMany({
      where,
      ...(include ? { include } : {}),
      orderBy: { [sortField]: sortDir },
      skip,
      take: limit,
    }),
  ]);
  return paged(items, total, page, limit);
}

async function withOrderNumbers(req, result) {
  const items = result.items || [];
  const ids = [...new Set(items.map((i) => i.orderId).filter(Boolean))];
  const shipmentIds = [...new Set(items.map((i) => i.shipmentId).filter(Boolean))];
  if (!ids.length && !shipmentIds.length) return result;
  const scope = requireScope(req);
  const [orders, shipments] = await Promise.all([
    ids.length
      ? prisma.exportSalesOrder.findMany({
          where: { companyId: scope, id: { in: ids } },
          select: { id: true, orderNumber: true, currency: true, customerName: true },
        })
      : Promise.resolve([]),
    shipmentIds.length
      ? prisma.exportShipment.findMany({
          where: { companyId: scope, id: { in: shipmentIds } },
          select: { id: true, shipmentNumber: true },
        })
      : Promise.resolve([]),
  ]);
  const orderMap = new Map(orders.map((o) => [o.id, o]));
  const shipmentMap = new Map(shipments.map((s) => [s.id, s.shipmentNumber]));
  return {
    ...result,
    items: items.map((i) => {
      const order = orderMap.get(i.orderId);
      return {
        ...i,
        orderNumber: order?.orderNumber || null,
        orderCurrency: order?.currency || null,
        orderCustomerName: order?.customerName || null,
        shipmentNumber: shipmentMap.get(i.shipmentId) || null,
      };
    }),
  };
}

// ─────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────

async function ensureSettings(companyId, userId) {
  let settings = await prisma.exportSetting.findUnique({ where: { companyId } });
  if (!settings) {
    settings = await prisma.exportSetting.create({
      data: { companyId },
    });
  }
  return settings;
}

async function getSettings(req) {
  const companyId = getWriteCompany(req);
  return ensureSettings(companyId, req.user?.id);
}

async function updateSettings(req, body = {}) {
  const companyId = getWriteCompany(req);
  await ensureSettings(companyId, req.user?.id);
  const data = {};
  const stringFields = [
    'defaultIncoterm',
    'defaultPortOfLoading',
    'defaultPortOfDischarge',
    'defaultPaymentTerms',
    'defaultCurrency',
  ];
  for (const f of stringFields) {
    if (body[f] !== undefined) data[f] = body[f] ? String(body[f]).trim() : null;
  }
  const boolFields = [
    'autoPostInvoice',
    'requireCustomsBeforeDispatch',
    'requireInspectionBeforeDispatch',
    'allowNegativeStock',
  ];
  for (const f of boolFields) {
    if (body[f] !== undefined) data[f] = Boolean(body[f]);
  }
  const accountFields = [
    'defaultFreightAccountId',
    'defaultDutyAccountId',
    'defaultBankChargesAccountId',
    'defaultFxGainAccountId',
    'defaultFxLossAccountId',
    'defaultAdvanceAccountId',
  ];
  for (const f of accountFields) {
    if (body[f] !== undefined) {
      if (body[f]) {
        const acc = await prisma.chartOfAccount.findFirst({
          where: { id: body[f], companyId, isActive: true },
        });
        if (!acc) {
          throw ApiError('Selected account does not belong to the active company', {
            status: 400,
            code: 'ACCOUNT_COMPANY_MISMATCH',
            field: f,
          });
        }
        data[f] = acc.id;
      } else {
        data[f] = null;
      }
    }
  }
  if (body.defaultLocationId !== undefined) {
    if (body.defaultLocationId) {
      await assertLocationBelongsToActiveCompany(body.defaultLocationId, companyId);
      data.defaultLocationId = body.defaultLocationId;
    } else {
      data.defaultLocationId = null;
    }
  }
  const settings = await prisma.exportSetting.update({
    where: { companyId },
    data,
  });
  await logExportAudit({
    companyId,
    userId: req.user?.id,
    action: 'SETTINGS_UPDATED',
    entityType: 'ExportSetting',
    entityId: settings.id,
    details: { fields: Object.keys(data) },
  });
  return settings;
}

async function listPorts(req) {
  requireScope(req);
  const search = req.query?.search ? String(req.query.search) : null;
  const ports = await prisma.importPort.findMany({
    where: {
      isActive: true,
      ...(search
        ? {
            OR: [
              { name: contains(search) },
              { country: contains(search) },
              { unLocode: contains(search) },
            ],
          }
        : {}),
    },
    orderBy: [{ country: 'asc' }, { name: 'asc' }],
    take: 500,
  });
  return ports;
}

// ─────────────────────────────────────────────────────────────
// Reporting currency helpers
// ─────────────────────────────────────────────────────────────

async function getReportingContext(req) {
  let reportingCompanyId;
  if (req.companyMode === 'all') {
    reportingCompanyId =
      req.user?.primaryCompanyId ||
      (Array.isArray(req.accessibleCompanyIds) ? req.accessibleCompanyIds[0] : null);
  } else {
    reportingCompanyId = req.user?.companyId || null;
  }
  if (!reportingCompanyId) {
    throw ApiError('Select an active company first', {
      status: 400,
      code: 'COMPANY_REQUIRED',
    });
  }
  const base = await getCompanyBaseCurrency(reportingCompanyId);
  return {
    companyId: reportingCompanyId,
    code: String(base?.code || '').toUpperCase(),
    cache: new Map(),
  };
}

async function convertCompanyBase(companyId, amount, ctx, asOfDate) {
  const value = toNum(amount);
  if (!value) return { value: 0, converted: true, currency: ctx.code };
  const key = String(companyId);
  if (!ctx.cache.has(key)) {
    ctx.cache.set(
      key,
      (async () => {
        const base = await getCompanyBaseCurrency(companyId);
        return String(base?.code || '').toUpperCase();
      })()
    );
  }
  const companyBaseCode = await ctx.cache.get(key);
  if (!companyBaseCode || companyBaseCode === ctx.code) {
    return {
      value,
      converted: Boolean(companyBaseCode) || companyBaseCode === ctx.code,
      currency: companyBaseCode || ctx.code,
    };
  }
  const [fromCur, toCur] = await Promise.all([
    prisma.currency.findUnique({ where: { code: companyBaseCode } }),
    prisma.currency.findUnique({ where: { code: ctx.code } }),
  ]);
  if (!fromCur || !toCur) {
    return { value: 0, converted: false, currency: companyBaseCode };
  }
  const fx = await getExchangeRate({
    companyId: ctx.companyId,
    fromCurrencyId: fromCur.id,
    toCurrencyId: toCur.id,
    asOfDate: asOfDate || new Date(),
  });
  if (!fx || !fx.rate) {
    return { value: 0, converted: false, currency: companyBaseCode };
  }
  return { value: round(value * toNum(fx.rate)), converted: true, currency: ctx.code };
}

async function sumInReporting(rows, field, ctx, asOfDate) {
  const group = new Map();
  for (const row of rows) {
    const companyId = String(row.companyId || '');
    if (!companyId) continue;
    group.set(companyId, round(toNum(group.get(companyId)) + toNum(row[field])));
  }
  let total = 0;
  const warnings = [];
  for (const [companyId, value] of group.entries()) {
    const converted = await convertCompanyBase(companyId, value, ctx, asOfDate);
    total = round(total + converted.value);
    if (!converted.converted) {
      warnings.push(`No exchange rate to consolidate ${converted.currency} → ${ctx.code}`);
    }
  }
  return { total: round(total), warnings: [...new Set(warnings)] };
}

async function resolveReportRange(req, query = {}, ctx) {
  const companyId = ctx.companyId;
  if (query.fiscalYearId) {
    const fy = await prisma.fiscalYear.findFirst({
      where: { id: query.fiscalYearId, companyId },
    });
    if (!fy) {
      throw ApiError('Fiscal year not found for the reporting company', {
        status: 400,
        code: 'FISCAL_YEAR_NOT_FOUND',
      });
    }
    return {
      start: new Date(fy.startDate),
      end: new Date(fy.endDate),
      fiscalYearId: fy.id,
      fiscalYear: fy,
    };
  }
  if (query.startDate || query.endDate) {
    const start = query.startDate ? new Date(query.startDate) : new Date('1970-01-01');
    const end = query.endDate ? new Date(query.endDate) : new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end, fiscalYearId: null, fiscalYear: null };
  }
  const now = new Date();
  const fy = await prisma.fiscalYear.findFirst({
    where: {
      companyId,
      status: 'Open',
      startDate: { lte: now },
      endDate: { gte: now },
    },
    orderBy: { startDate: 'desc' },
  });
  if (fy) {
    return {
      start: new Date(fy.startDate),
      end: new Date(fy.endDate),
      fiscalYearId: fy.id,
      fiscalYear: fy,
    };
  }
  return {
    start: new Date(now.getFullYear(), 0, 1),
    end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999),
    fiscalYearId: null,
    fiscalYear: null,
  };
}

// ─────────────────────────────────────────────────────────────
// Dashboard & reports
// ─────────────────────────────────────────────────────────────

async function getDashboardKpis(req) {
  const scope = requireScope(req);
  const ctx = await getReportingContext(req);
  const range = await resolveReportRange(req, req.query || {}, ctx);
  const dateWhere = { gte: range.start, lte: range.end };

  const [
    openInquiries,
    openQuotations,
    openOrders,
    ordersInRange,
    receiptsInRange,
    shipmentsActive,
    documentsCount,
    pendingApprovals,
    recentOrders,
    liveShipments,
    recentReceipts,
  ] = await Promise.all([
    prisma.exportInquiry.count({
      where: { companyId: scope, status: { in: ['Draft', 'Open'] } },
    }),
    prisma.exportQuotation.count({
      where: {
        companyId: scope,
        status: { in: ['Draft', 'Sent to Buyer', 'Under Negotiation'] },
      },
    }),
    prisma.exportSalesOrder.count({
      where: {
        companyId: scope,
        status: { notIn: ['Completed', 'Cancelled'] },
      },
    }),
    prisma.exportSalesOrder.findMany({
      where: { companyId: scope, orderDate: dateWhere },
      select: {
        id: true,
        companyId: true,
        currency: true,
        orderDate: true,
        status: true,
        customerCountry: true,
        totalBase: true,
        invoicedBase: true,
        paidBase: true,
        outstandingBase: true,
      },
    }),
    prisma.exportReceipt.findMany({
      where: {
        companyId: scope,
        receiptDate: dateWhere,
        status: { in: ['Realized & Credited', 'Forex Hedged'] },
      },
      select: {
        companyId: true,
        currency: true,
        grossBase: true,
        receiptType: true,
        receiptDate: true,
      },
    }),
    prisma.exportShipment.groupBy({
      by: ['shipmentStatus'],
      where: { companyId: scope },
      _count: { _all: true },
    }),
    prisma.exportDocument.count({ where: { companyId: scope } }),
    prisma.exportQuotation.count({
      where: {
        companyId: scope,
        status: { in: ['Draft', 'Sent to Buyer', 'Under Negotiation'] },
      },
    }),
    prisma.exportSalesOrder.findMany({
      where: { companyId: scope },
      orderBy: { orderDate: 'desc' },
      take: 6,
      include: { items: true },
    }),
    prisma.exportShipment.findMany({
      where: {
        companyId: scope,
        shipmentStatus: {
          in: ['Booking Confirmed', 'Container Gate-In', 'Loaded on Vessel', 'In Transit'],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
    prisma.exportReceipt.findMany({
      where: { companyId: scope },
      orderBy: { receiptDate: 'desc' },
      take: 6,
    }),
  ]);

  const contracted = await sumInReporting(ordersInRange, 'totalBase', ctx, range.end);
  const invoiced = await sumInReporting(ordersInRange, 'invoicedBase', ctx, range.end);
  const receipts = await sumInReporting(receiptsInRange, 'grossBase', ctx, range.end);
  const receivable = await sumInReporting(ordersInRange, 'outstandingBase', ctx, range.end);
  const advances = await sumInReporting(
    receiptsInRange.filter((r) => r.receiptType === 'Advance'),
    'grossBase',
    ctx,
    range.end
  );

  const countryMap = new Map();
  for (const order of ordersInRange) {
    const country = order.customerCountry || 'Unspecified';
    const key = `${order.companyId}::${country}`;
    const current = countryMap.get(key) || {
      country,
      companyId: order.companyId,
      totalBase: 0,
      orders: 0,
    };
    current.totalBase = round(current.totalBase + toNum(order.totalBase));
    current.orders += 1;
    countryMap.set(key, current);
  }
  const byCountry = [];
  for (const entry of countryMap.values()) {
    const converted = await convertCompanyBase(entry.companyId, entry.totalBase, ctx, range.end);
    const existing = byCountry.find((c) => c.country === entry.country);
    if (existing) {
      existing.value = round(existing.value + converted.value);
      existing.orders += entry.orders;
    } else {
      byCountry.push({
        country: entry.country,
        value: converted.value,
        orders: entry.orders,
      });
    }
  }

  const monthKey = (d) => `${new Date(d).getFullYear()}-${String(new Date(d).getMonth() + 1).padStart(2, '0')}`;
  const monthMap = new Map();
  for (const order of ordersInRange) {
    const key = monthKey(order.orderDate);
    const entry = monthMap.get(key) || {
      month: key,
      contracted: 0,
      invoiced: 0,
      companyId: order.companyId,
    };
    entry.contracted = round(entry.contracted + toNum(order.totalBase));
    entry.invoiced = round(entry.invoiced + toNum(order.invoicedBase));
    monthMap.set(key, entry);
  }
  const monthly = [];
  for (const entry of [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month))) {
    const contractedConv = await convertCompanyBase(entry.companyId, entry.contracted, ctx, range.end);
    const invoicedConv = await convertCompanyBase(entry.companyId, entry.invoiced, ctx, range.end);
    const existing = monthly.find((m) => m.month === entry.month);
    if (existing) {
      existing.contracted = round(existing.contracted + contractedConv.value);
      existing.invoiced = round(existing.invoiced + invoicedConv.value);
    } else {
      monthly.push({
        month: entry.month,
        contracted: contractedConv.value,
        invoiced: invoicedConv.value,
      });
    }
  }

  const shipmentStatus = Object.fromEntries(
    shipmentsActive.map((row) => [row.shipmentStatus, row._count?._all || 0])
  );

  return {
    reportingCurrency: ctx.code,
    range: { start: range.start, end: range.end, fiscalYearId: range.fiscalYearId },
    kpis: {
      openInquiries,
      openQuotations,
      openOrders,
      pendingApprovals,
      contractedValue: contracted.total,
      invoicedValue: invoiced.total,
      receiptsValue: receipts.total,
      advanceValue: advances.total,
      receivableValue: receivable.total,
      invoiceCount: ordersInRange.filter((o) => toNum(o.invoicedBase) > 0).length,
      shipmentsInTransit:
        (shipmentStatus['Loaded on Vessel'] || 0) + (shipmentStatus['In Transit'] || 0),
      documentsCount,
    },
    conversionWarnings: [...new Set([...contracted.warnings, ...invoiced.warnings, ...receipts.warnings, ...receivable.warnings])],
    byCountry,
    monthly,
    shipmentStatus,
    recentOrders,
    liveShipments,
    recentReceipts,
  };
}

async function getReports(req) {
  const scope = requireScope(req);
  const ctx = await getReportingContext(req);
  const range = await resolveReportRange(req, req.query || {}, ctx);
  const currency = req.query?.currency ? String(req.query.currency).toUpperCase() : null;
  const where = {
    companyId: scope,
    orderDate: { gte: range.start, lte: range.end },
    ...(currency ? { currency } : {}),
    ...(req.query?.customerId ? { customerId: req.query.customerId } : {}),
  };

  const [orders, receipts, expenses, inquiries, quotations] = await Promise.all([
    prisma.exportSalesOrder.findMany({ where, include: { items: true } }),
    prisma.exportReceipt.findMany({
      where: {
        companyId: scope,
        receiptDate: { gte: range.start, lte: range.end },
        ...(currency ? { currency } : {}),
      },
    }),
    prisma.exportExpense.findMany({
      where: {
        companyId: scope,
        date: { gte: range.start, lte: range.end },
        status: 'Posted',
      },
    }),
    prisma.exportInquiry.findMany({
      where: { companyId: scope, date: { gte: range.start, lte: range.end } },
    }),
    prisma.exportQuotation.findMany({
      where: { companyId: scope, quoteDate: { gte: range.start, lte: range.end } },
    }),
  ]);

  const contracted = await sumInReporting(orders, 'totalBase', ctx, range.end);
  const invoiced = await sumInReporting(orders, 'invoicedBase', ctx, range.end);
  const paid = await sumInReporting(orders, 'paidBase', ctx, range.end);
  const outstanding = await sumInReporting(orders, 'outstandingBase', ctx, range.end);
  const advances = await sumInReporting(
    receipts.filter((r) => r.receiptType === 'Advance'),
    'grossBase',
    ctx,
    range.end
  );
  const settlements = await sumInReporting(
    receipts.filter((r) => r.receiptType === 'Settlement'),
    'grossBase',
    ctx,
    range.end
  );
  const expenseTotal = await sumInReporting(expenses, 'amountBase', ctx, range.end);

  const countryRows = [];
  for (const order of orders) {
    const country = order.customerCountry || 'Unspecified';
    let row = countryRows.find(
      (r) => r.country === country && r.companyId === order.companyId
    );
    if (!row) {
      row = { country, orders: 0, contracted: 0, invoiced: 0, companyId: order.companyId };
      countryRows.push(row);
    }
    row.orders += 1;
    row.contracted = round(row.contracted + toNum(order.totalBase));
    row.invoiced = round(row.invoiced + toNum(order.invoicedBase));
  }
  const byCountry = [];
  for (const row of countryRows) {
    const convContracted = await convertCompanyBase(row.companyId, row.contracted, ctx, range.end);
    const convInvoiced = await convertCompanyBase(row.companyId, row.invoiced, ctx, range.end);
    const existing = byCountry.find((r) => r.country === row.country);
    if (existing) {
      existing.orders += row.orders;
      existing.contracted = round(existing.contracted + convContracted.value);
      existing.invoiced = round(existing.invoiced + convInvoiced.value);
    } else {
      byCountry.push({
        country: row.country,
        orders: row.orders,
        contracted: convContracted.value,
        invoiced: convInvoiced.value,
      });
    }
  }

  const statusBreakdown = {};
  for (const order of orders) {
    statusBreakdown[order.status] = (statusBreakdown[order.status] || 0) + 1;
  }

  const aging = [
    { bucket: 'Current', min: -9999, max: 0, amount: 0, count: 0 },
    { bucket: '1-30 days', min: 1, max: 30, amount: 0, count: 0 },
    { bucket: '31-60 days', min: 31, max: 60, amount: 0, count: 0 },
    { bucket: '61-90 days', min: 61, max: 90, amount: 0, count: 0 },
    { bucket: '90+ days', min: 91, max: 99999, amount: 0, count: 0 },
  ];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const order of orders) {
    if (toNum(order.outstandingBase) <= 0) continue;
    const due = order.deliveryDeadline ? new Date(order.deliveryDeadline) : new Date(order.orderDate);
    const days = Math.floor((today - due) / (24 * 3600 * 1000));
    const bucket =
      aging.find((b) => days >= b.min && days <= b.max) ||
      aging[aging.length - 1];
    const converted = await convertCompanyBase(order.companyId, order.outstandingBase, ctx, range.end);
    bucket.amount = round(bucket.amount + converted.value);
    bucket.count += 1;
  }

  return {
    reportingCurrency: ctx.code,
    range: { start: range.start, end: range.end, fiscalYearId: range.fiscalYearId },
    filters: { currency, customerId: req.query?.customerId || null },
    summary: {
      inquiryCount: inquiries.length,
      quotationCount: quotations.length,
      orderCount: orders.length,
      contractedValue: contracted.total,
      invoicedValue: invoiced.total,
      paidValue: paid.total,
      outstandingValue: outstanding.total,
      advanceValue: advances.total,
      settlementValue: settlements.total,
      expenseValue: expenseTotal.total,
      grossMarginValue: round(invoiced.total - expenseTotal.total),
    },
    conversionWarnings: [
      ...new Set([
        ...contracted.warnings,
        ...invoiced.warnings,
        ...paid.warnings,
        ...outstanding.warnings,
        ...expenseTotal.warnings,
      ]),
    ],
    byCountry,
    statusBreakdown,
    aging,
  };
}

// ─────────────────────────────────────────────────────────────
// Shared validation helpers
// ─────────────────────────────────────────────────────────────

async function validateCustomer(tx, companyId, customerId, explicitName) {
  if (!customerId) {
    throw ApiError('customerId is required', {
      status: 400,
      code: 'FIELD_REQUIRED',
      field: 'customerId',
    });
  }
  const customer = await tx.customer.findFirst({
    where: { id: customerId, companyId, isActive: true, isDeleted: false },
  });
  if (!customer) {
    throw ApiError('Customer not found for the active company', {
      status: 400,
      code: 'CUSTOMER_NOT_FOUND',
      field: 'customerId',
    });
  }
  const address = customer.address && typeof customer.address === 'object' ? customer.address : {};
  return {
    customerId: customer.id,
    customerName: explicitName || customer.name || 'Customer',
    customerCountry: address.country || address.countryName || null,
  };
}

async function resolveDocumentItems(tx, {
  companyId,
  items,
  rate,
  requireProduct,
  allowZeroPrice = false,
  fieldPrefix = '',
}) {
  if (!Array.isArray(items) || !items.length) {
    throw ApiError('At least one line item is required', {
      status: 400,
      code: 'ITEMS_REQUIRED',
      field: 'items',
    });
  }
  const resolved = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const productId = item.productId || null;
    let product = null;
    if (productId) {
      product = await tx.product.findFirst({
        where: { id: productId, companyId },
      });
      if (!product) {
        throw ApiError(`Product on line ${index + 1} was not found in this company`, {
          status: 400,
          code: 'PRODUCT_NOT_FOUND',
          field: 'items',
        });
      }
    } else if (requireProduct) {
      throw ApiError(`Select a product on line ${index + 1}`, {
        status: 400,
        code: 'PRODUCT_REQUIRED',
        field: 'items',
      });
    }
    const qty = positiveNumber(
      item.quantity ?? item.requestedQty ?? item.quantityShipped,
      `items[${index}].quantity`
    );
    const rawPrice =
      item.unitPriceForeign ??
      item.targetPriceForeign ??
      item.unitPrice ??
      product?.sellingPrice ??
      0;
    const price = allowZeroPrice
      ? nonNegativeNumber(rawPrice, `items[${index}].unitPriceForeign`)
      : positiveNumber(rawPrice, `items[${index}].unitPriceForeign`);
    const discount = nonNegativeNumber(
      item.discountForeign ?? item.discount ?? 0,
      `items[${index}].discountForeign`
    );
    const lineForeign = round(Math.max(0, qty * price - discount));
    resolved.push({
      productId: product?.id || productId || null,
      productName:
        String(item.productName || product?.name || '').trim() || `Item ${index + 1}`,
      sku: String(item.sku || product?.sku || '').trim() || null,
      quantity: qty,
      uom: String(item.uom || product?.stockUnitName || product?.salesUnitName || 'PCS').trim(),
      unitPriceForeign: price,
      unitPriceBase: round(price * rate),
      discountForeign: discount,
      lineTotalForeign: lineForeign,
      lineTotalBase: round(lineForeign * rate),
    });
  }
  return resolved;
}

function sumItems(items, field) {
  return round(items.reduce((s, i) => s + toNum(i[field]), 0));
}

async function nextNumberWithRetry(fn) {
  let lastErr = null;
  for (let i = 0; i < 3; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err.code !== 'P2002') throw err;
    }
  }
  throw lastErr;
}

async function resolveIdempotentRecord(entityModel, companyId, key, include) {
  if (!key) return null;
  const existing = await prisma.exportIdempotency.findFirst({
    where: { companyId, key: String(key).slice(0, 120) },
  });
  if (!existing) return null;
  return prisma[entityModel].findFirst({
    where: { id: existing.entityId, companyId },
    ...(include ? { include } : {}),
  });
}

async function createEntity(req, { entityModel, entityType, include, build }) {
  const companyId = getWriteCompany(req);
  const key = req.body?.idempotencyKey;
  const pre = await resolveIdempotentRecord(entityModel, companyId, key, include);
  if (pre) return pre;
  const created = await createWithNumbering({
    companyId,
    key,
    entityType,
    run: (tx) => build(tx, companyId),
  });
  if (created && created.idempotent) {
    const record = await prisma[entityModel].findFirst({
      where: { id: created.entityId, companyId },
      ...(include ? { include } : {}),
    });
    if (record) return record;
    throw ApiError('Duplicate request detected but the original record was not found', {
      status: 409,
      code: 'DUPLICATE_REQUEST',
    });
  }
  return prisma[entityModel].findFirst({
    where: { id: created.id, companyId },
    ...(include ? { include } : {}),
  });
}

// ─────────────────────────────────────────────────────────────
// Inquiries
// ─────────────────────────────────────────────────────────────

async function listInquiries(req, query = {}) {
  return listCollection(req, query, {
    model: 'exportInquiry',
    include: INCLUDE.inquiry,
    searchFields: ['inquiryNumber', 'customerName', 'customerCountry', 'destinationPort'],
    dateField: 'date',
    allowedSort: ['date', 'inquiryNumber', 'createdAt', 'status', 'customerName'],
    defaultSort: 'date',
  });
}

async function getInquiry(req) {
  return loadScopedRecord(req, 'exportInquiry', req.params.id, INCLUDE.inquiry);
}

function leadStageFor(value) {
  if (!value) return 'New Inquiry';
  return canonicalStatus('leadStage', value);
}

async function createInquiry(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  return createEntity(req, {
    entityModel: 'exportInquiry',
    entityType: 'ExportInquiry',
    include: INCLUDE.inquiry,
    build: async (tx) => {
      const customer = await validateCustomer(tx, companyId, body.customerId, body.customerName);
      const date = body.date ? requiredDate(body.date, 'date') : new Date();
      const currency = requiredString(body.currency || 'USD', 'currency', { max: 8 }).toUpperCase();
      const fx = await resolveFx({
        companyId,
        currencyCode: currency,
        foreignAmount: 0,
        explicitRate: body.exchangeRate,
        asOfDate: date,
        client: tx,
      });
      const items = await resolveDocumentItems(tx, {
        companyId,
        items: body.items,
        rate: toNum(fx.exchangeRate),
        requireProduct: false,
        allowZeroPrice: true,
      });
      const estimatedForeign = sumItems(items, 'lineTotalForeign');
      const estimatedBase = sumItems(items, 'lineTotalBase');
      const number = await nextNumber(tx, 'exportInquiry', 'inquiryNumber', companyId, 'EINQ');
      const inquiry = await tx.exportInquiry.create({
        data: {
          companyId,
          inquiryNumber: number,
          date,
          customerId: customer.customerId,
          customerName: customer.customerName,
          customerCountry: body.customerCountry || customer.customerCountry,
          destinationPort: body.destinationPort || null,
          destinationPortCode: body.destinationPortCode || null,
          incoterm: body.incoterm || 'FOB',
          currency,
          exchangeRate: fx.exchangeRate,
          exchangeRateDate: fx.exchangeRateDate,
          rateSource: fx.rateSource,
          baseCurrencyCode: fx.baseCurrencyCode,
          estimatedRevenueForeign: estimatedForeign,
          estimatedRevenueBase: estimatedBase,
          targetDispatchDate: body.targetDispatchDate
            ? requiredDate(body.targetDispatchDate, 'targetDispatchDate')
            : null,
          leadStage: leadStageFor(body.leadStage),
          status: body.status === 'Open' ? 'Open' : 'Draft',
          notes: body.notes || null,
          createdBy: req.user?.id || null,
          items: {
            create: items.map((i) => ({
              productId: i.productId,
              productName: i.productName,
              sku: i.sku,
              requestedQty: i.quantity,
              uom: i.uom,
              targetPriceForeign: i.unitPriceForeign,
              targetPriceBase: i.unitPriceBase,
            })),
          },
        },
        include: INCLUDE.inquiry,
      });
      await logExportAudit(
        {
          companyId,
          userId: req.user?.id,
          action: 'INQUIRY_CREATED',
          entityType: 'ExportInquiry',
          entityId: inquiry.id,
          details: { inquiryNumber: number, currency, totalForeign: estimatedForeign },
        },
        tx
      );
      return inquiry;
    },
  });
}

async function updateInquiry(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const inquiry = await loadWriteRecord(req, 'exportInquiry', req.params.id, INCLUDE.inquiry);
  if (['Converted', 'Closed'].includes(inquiry.status)) {
    throw ApiError(`Inquiry is ${inquiry.status} and cannot be edited`, {
      status: 409,
      code: 'LOCKED_RECORD',
    });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const data = {};
    for (const f of ['destinationPort', 'destinationPortCode', 'incoterm', 'notes']) {
      if (body[f] !== undefined) data[f] = body[f] || null;
    }
    if (body.customerCountry !== undefined) data.customerCountry = body.customerCountry || null;
    if (body.targetDispatchDate !== undefined) {
      data.targetDispatchDate = body.targetDispatchDate
        ? requiredDate(body.targetDispatchDate, 'targetDispatchDate')
        : null;
    }
    if (body.leadStage !== undefined) data.leadStage = leadStageFor(body.leadStage);
    if (body.customerId !== undefined && body.customerId !== inquiry.customerId) {
      const customer = await validateCustomer(tx, companyId, body.customerId, body.customerName);
      data.customerId = customer.customerId;
      data.customerName = customer.customerName;
      if (body.customerCountry === undefined) {
        data.customerCountry = customer.customerCountry;
      }
    }
    if (body.currency !== undefined || body.exchangeRate !== undefined || body.items) {
      const currency = String(body.currency || inquiry.currency).toUpperCase();
      const fx = await resolveFx({
        companyId,
        currencyCode: currency,
        foreignAmount: 0,
        explicitRate: body.exchangeRate,
        asOfDate: inquiry.date,
        client: tx,
      });
      data.currency = currency;
      data.exchangeRate = fx.exchangeRate;
      data.exchangeRateDate = fx.exchangeRateDate;
      data.rateSource = fx.rateSource;
      data.baseCurrencyCode = fx.baseCurrencyCode;
      if (body.items) {
        const items = await resolveDocumentItems(tx, {
          companyId,
          items: body.items,
          rate: toNum(fx.exchangeRate),
          requireProduct: false,
          allowZeroPrice: true,
        });
        data.estimatedRevenueForeign = sumItems(items, 'lineTotalForeign');
        data.estimatedRevenueBase = sumItems(items, 'lineTotalBase');
        await tx.exportInquiryItem.deleteMany({ where: { inquiryId: inquiry.id } });
        await tx.exportInquiryItem.createMany({
          data: items.map((i) => ({
            inquiryId: inquiry.id,
            productId: i.productId,
            productName: i.productName,
            sku: i.sku,
            requestedQty: i.quantity,
            uom: i.uom,
            targetPriceForeign: i.unitPriceForeign,
            targetPriceBase: i.unitPriceBase,
          })),
        });
      } else if (body.currency !== undefined) {
        // Re-price existing lines with the new FX snapshot.
        const existing = await tx.exportInquiryItem.findMany({ where: { inquiryId: inquiry.id } });
        for (const item of existing) {
          await tx.exportInquiryItem.update({
            where: { id: item.id },
            data: {
              targetPriceBase: round(toNum(item.targetPriceForeign) * toNum(fx.exchangeRate)),
            },
          });
        }
        data.estimatedRevenueBase = round(
          existing.reduce(
            (s, item) =>
              s + toNum(item.requestedQty) * toNum(item.targetPriceForeign),
            0
          ) * toNum(fx.exchangeRate)
        );
      }
    }
    const record = await tx.exportInquiry.update({
      where: { id: inquiry.id },
      data,
      include: INCLUDE.inquiry,
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'INQUIRY_UPDATED',
        entityType: 'ExportInquiry',
        entityId: inquiry.id,
        details: { fields: Object.keys(data) },
      },
      tx
    );
    return record;
  });
  return updated;
}

async function updateInquiryStatus(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const inquiry = await loadWriteRecord(req, 'exportInquiry', req.params.id);
  let nextStatus = inquiry.status;
  let nextStage = inquiry.leadStage;
  if (body.status && body.status !== inquiry.status) {
    nextStatus = assertTransition('inquiry', inquiry.status, canonicalStatus('inquiry', body.status));
  }
  if (body.leadStage && body.leadStage !== inquiry.leadStage) {
    nextStage = assertTransition(
      'leadStage',
      inquiry.leadStage,
      canonicalStatus('leadStage', body.leadStage)
    );
  }
  const record = await prisma.exportInquiry.update({
    where: { id: inquiry.id },
    data: { status: nextStatus, leadStage: nextStage },
    include: INCLUDE.inquiry,
  });
  await logExportAudit({
    companyId,
    userId: req.user?.id,
    action: 'INQUIRY_STATUS_UPDATED',
    entityType: 'ExportInquiry',
    entityId: inquiry.id,
    details: { status: nextStatus, leadStage: nextStage },
  });
  return record;
}

async function convertInquiryToQuotation(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const inquiry = await loadWriteRecord(req, 'exportInquiry', req.params.id, INCLUDE.inquiry);
  if (inquiry.convertedQuotationId) {
    const existing = await prisma.exportQuotation.findFirst({
      where: { id: inquiry.convertedQuotationId, companyId },
      include: INCLUDE.quotation,
    });
    if (existing) return existing;
  }
  if (!inquiry.items.length) {
    throw ApiError('Add at least one line item before converting the inquiry', {
      status: 400,
      code: 'ITEMS_REQUIRED',
    });
  }
  const quote = await prisma.$transaction(async (tx) => {
    const rate = toNum(inquiry.exchangeRate) || 1;
    const quoteDate = body.quoteDate ? requiredDate(body.quoteDate, 'quoteDate') : new Date();
    const validUntil = body.validUntil
      ? requiredDate(body.validUntil, 'validUntil')
      : new Date(quoteDate.getTime() + 30 * 24 * 3600 * 1000);
    const freightForeign = nonNegativeNumber(body.freightForeign, 'freightForeign');
    const insuranceForeign = nonNegativeNumber(body.insuranceForeign, 'insuranceForeign');
    const items = inquiry.items.map((item) => {
      const priceForeign = toNum(item.targetPriceForeign);
      const lineForeign = round(priceForeign * toNum(item.requestedQty));
      return {
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        quantity: item.requestedQty,
        uom: item.uom,
        unitPriceForeign: priceForeign,
        unitPriceBase: round(priceForeign * rate),
        discountForeign: 0,
        lineTotalForeign: lineForeign,
        lineTotalBase: round(lineForeign * rate),
      };
    });
    if (items.every((i) => i.unitPriceForeign <= 0)) {
      throw ApiError('Set target prices on the inquiry before creating a quotation', {
        status: 400,
        code: 'PRICE_REQUIRED',
      });
    }
    const subtotalForeign = sumItems(items, 'lineTotalForeign');
    const subtotalBase = sumItems(items, 'lineTotalBase');
    const number = await nextNumber(tx, 'exportQuotation', 'quoteNumber', companyId, 'EQT');
    const record = await tx.exportQuotation.create({
      data: {
        companyId,
        quoteNumber: number,
        inquiryId: inquiry.id,
        quoteDate,
        validUntil,
        customerId: inquiry.customerId,
        customerName: inquiry.customerName,
        customerCountry: inquiry.customerCountry,
        incoterm: inquiry.incoterm,
        currency: inquiry.currency,
        exchangeRate: inquiry.exchangeRate,
        exchangeRateDate: inquiry.exchangeRateDate,
        rateSource: inquiry.rateSource,
        baseCurrencyCode: inquiry.baseCurrencyCode,
        portOfLoading: body.portOfLoading || null,
        portOfDischarge: body.portOfDischarge || inquiry.destinationPort || null,
        subtotalForeign,
        subtotalBase,
        freightForeign,
        freightBase: round(freightForeign * rate),
        insuranceForeign,
        insuranceBase: round(insuranceForeign * rate),
        totalForeign: round(subtotalForeign + freightForeign + insuranceForeign),
        totalBase: round(subtotalBase + freightForeign * rate + insuranceForeign * rate),
        paymentTerms: body.paymentTerms || null,
        status: 'Draft',
        notes: body.notes || null,
        createdBy: req.user?.id || null,
        items: { create: items },
      },
      include: INCLUDE.quotation,
    });
    await tx.exportInquiry.update({
      where: { id: inquiry.id },
      data: { status: 'Converted', leadStage: 'Quoted', convertedQuotationId: record.id },
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'INQUIRY_CONVERTED',
        entityType: 'ExportInquiry',
        entityId: inquiry.id,
        details: { quotationId: record.id, quoteNumber: number },
      },
      tx
    );
    return record;
  });
  return quote;
}

// ─────────────────────────────────────────────────────────────
// Quotations
// ─────────────────────────────────────────────────────────────

async function listQuotations(req, query = {}) {
  return listCollection(req, query, {
    model: 'exportQuotation',
    include: INCLUDE.quotation,
    searchFields: ['quoteNumber', 'customerName', 'customerCountry'],
    dateField: 'quoteDate',
    allowedSort: ['quoteDate', 'quoteNumber', 'createdAt', 'status', 'totalForeign'],
    defaultSort: 'quoteDate',
  });
}

async function getQuotation(req) {
  return loadScopedRecord(req, 'exportQuotation', req.params.id, INCLUDE.quotation);
}

async function createQuotation(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  return createEntity(req, {
    entityModel: 'exportQuotation',
    entityType: 'ExportQuotation',
    include: INCLUDE.quotation,
    build: async (tx) => {
      let inquiry = null;
      if (body.inquiryId) {
        inquiry = await tx.exportInquiry.findFirst({
          where: { id: body.inquiryId, companyId },
        });
        if (!inquiry) {
          throw ApiError('Inquiry not found for the active company', {
            status: 400,
            code: 'INQUIRY_NOT_FOUND',
          });
        }
      }
      const customer = await validateCustomer(
        tx,
        companyId,
        body.customerId || inquiry?.customerId,
        body.customerName || inquiry?.customerName
      );
      const quoteDate = body.quoteDate ? requiredDate(body.quoteDate, 'quoteDate') : new Date();
      const validUntil = body.validUntil
        ? requiredDate(body.validUntil, 'validUntil')
        : new Date(quoteDate.getTime() + 30 * 24 * 3600 * 1000);
      const currency = String(body.currency || inquiry?.currency || 'USD').toUpperCase();
      const fx = await resolveFx({
        companyId,
        currencyCode: currency,
        foreignAmount: 0,
        explicitRate: body.exchangeRate,
        asOfDate: quoteDate,
        client: tx,
      });
      const rate = toNum(fx.exchangeRate);
      const items = await resolveDocumentItems(tx, {
        companyId,
        items: body.items,
        rate,
        requireProduct: false,
      });
      const subtotalForeign = sumItems(items, 'lineTotalForeign');
      const subtotalBase = sumItems(items, 'lineTotalBase');
      const freightForeign = nonNegativeNumber(body.freightForeign, 'freightForeign');
      const insuranceForeign = nonNegativeNumber(body.insuranceForeign, 'insuranceForeign');
      const number = await nextNumber(tx, 'exportQuotation', 'quoteNumber', companyId, 'EQT');
      const record = await tx.exportQuotation.create({
        data: {
          companyId,
          quoteNumber: number,
          inquiryId: inquiry?.id || null,
          quoteDate,
          validUntil,
          customerId: customer.customerId,
          customerName: customer.customerName,
          customerCountry: body.customerCountry || customer.customerCountry,
          incoterm: body.incoterm || inquiry?.incoterm || 'FOB',
          currency,
          exchangeRate: fx.exchangeRate,
          exchangeRateDate: fx.exchangeRateDate,
          rateSource: fx.rateSource,
          baseCurrencyCode: fx.baseCurrencyCode,
          portOfLoading: body.portOfLoading || null,
          portOfDischarge: body.portOfDischarge || inquiry?.destinationPort || null,
          subtotalForeign,
          subtotalBase,
          freightForeign,
          freightBase: round(freightForeign * rate),
          insuranceForeign,
          insuranceBase: round(insuranceForeign * rate),
          totalForeign: round(subtotalForeign + freightForeign + insuranceForeign),
          totalBase: round(subtotalBase + (freightForeign + insuranceForeign) * rate),
          paymentTerms: body.paymentTerms || null,
          status: 'Draft',
          notes: body.notes || null,
          createdBy: req.user?.id || null,
          items: { create: items },
        },
        include: INCLUDE.quotation,
      });
      if (inquiry) {
        await tx.exportInquiry.update({
          where: { id: inquiry.id },
          data: { status: 'Converted', leadStage: 'Quoted', convertedQuotationId: record.id },
        });
      }
      await logExportAudit(
        {
          companyId,
          userId: req.user?.id,
          action: 'QUOTATION_CREATED',
          entityType: 'ExportQuotation',
          entityId: record.id,
          details: { quoteNumber: number, totalForeign: record.totalForeign },
        },
        tx
      );
      return record;
    },
  });
}

async function updateQuotation(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const quote = await loadWriteRecord(req, 'exportQuotation', req.params.id, INCLUDE.quotation);
  if (['Accepted', 'Declined', 'Converted to Order'].includes(quote.status)) {
    throw ApiError(`Quotation is ${quote.status} and cannot be edited`, {
      status: 409,
      code: 'LOCKED_RECORD',
    });
  }
  return prisma.$transaction(async (tx) => {
    const data = {};
    for (const f of ['portOfLoading', 'portOfDischarge', 'paymentTerms', 'notes', 'incoterm']) {
      if (body[f] !== undefined) data[f] = body[f] || null;
    }
    if (body.validUntil !== undefined) {
      data.validUntil = body.validUntil ? requiredDate(body.validUntil, 'validUntil') : null;
    }
    if (body.customerId !== undefined && body.customerId !== quote.customerId) {
      const customer = await validateCustomer(tx, companyId, body.customerId, body.customerName);
      data.customerId = customer.customerId;
      data.customerName = customer.customerName;
      data.customerCountry = body.customerCountry || customer.customerCountry;
    }
    const needsRepricing =
      body.currency !== undefined ||
      body.exchangeRate !== undefined ||
      body.items ||
      body.freightForeign !== undefined ||
      body.insuranceForeign !== undefined;
    if (needsRepricing) {
      const currency = String(body.currency || quote.currency).toUpperCase();
      const fx = await resolveFx({
        companyId,
        currencyCode: currency,
        foreignAmount: 0,
        explicitRate: body.exchangeRate,
        asOfDate: quote.quoteDate,
        client: tx,
      });
      const rate = toNum(fx.exchangeRate);
      let items = quote.items;
      if (body.items) {
        const resolved = await resolveDocumentItems(tx, {
          companyId,
          items: body.items,
          rate,
          requireProduct: false,
        });
        await tx.exportQuotationItem.deleteMany({ where: { quotationId: quote.id } });
        await tx.exportQuotationItem.createMany({
          data: resolved.map((i) => ({ quotationId: quote.id, ...i })),
        });
        items = resolved;
      } else if (body.currency !== undefined || body.exchangeRate !== undefined) {
        for (const item of quote.items) {
          await tx.exportQuotationItem.update({
            where: { id: item.id },
            data: {
              unitPriceBase: round(toNum(item.unitPriceForeign) * rate),
              lineTotalBase: round(toNum(item.lineTotalForeign) * rate),
            },
          });
        }
      }
      const subtotalForeign =
        body.items ? sumItems(items, 'lineTotalForeign') : toNum(quote.subtotalForeign);
      const subtotalBase =
        body.items ? sumItems(items, 'lineTotalBase') : round(toNum(quote.subtotalForeign) * rate);
      const freightForeign =
        body.freightForeign !== undefined
          ? nonNegativeNumber(body.freightForeign, 'freightForeign')
          : toNum(quote.freightForeign);
      const insuranceForeign =
        body.insuranceForeign !== undefined
          ? nonNegativeNumber(body.insuranceForeign, 'insuranceForeign')
          : toNum(quote.insuranceForeign);
      Object.assign(data, {
        currency,
        exchangeRate: fx.exchangeRate,
        exchangeRateDate: fx.exchangeRateDate,
        rateSource: fx.rateSource,
        baseCurrencyCode: fx.baseCurrencyCode,
        subtotalForeign,
        subtotalBase,
        freightForeign,
        freightBase: round(freightForeign * rate),
        insuranceForeign,
        insuranceBase: round(insuranceForeign * rate),
        totalForeign: round(subtotalForeign + freightForeign + insuranceForeign),
        totalBase: round(subtotalBase + (freightForeign + insuranceForeign) * rate),
      });
    }
    const record = await tx.exportQuotation.update({
      where: { id: quote.id },
      data,
      include: INCLUDE.quotation,
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'QUOTATION_UPDATED',
        entityType: 'ExportQuotation',
        entityId: quote.id,
        details: { fields: Object.keys(data) },
      },
      tx
    );
    return record;
  });
}

async function updateQuotationStatus(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const quote = await loadWriteRecord(req, 'exportQuotation', req.params.id);
  const next = canonicalStatus('quotation', body.status);
  assertTransition('quotation', quote.status, next);
  const record = await prisma.exportQuotation.update({
    where: { id: quote.id },
    data: {
      status: next,
      ...(next === 'Accepted'
        ? { approvedBy: req.user?.id || null, approvedAt: new Date() }
        : {}),
    },
    include: INCLUDE.quotation,
  });
  await logExportAudit({
    companyId,
    userId: req.user?.id,
    action: 'QUOTATION_STATUS_UPDATED',
    entityType: 'ExportQuotation',
    entityId: quote.id,
    details: { from: quote.status, to: next },
  });
  return record;
}

async function approveQuotation(req) {
  const quote = await loadWriteRecord(req, 'exportQuotation', req.params.id);
  if (quote.status === 'Accepted') return loadScopedRecord(req, 'exportQuotation', quote.id, INCLUDE.quotation);
  if (!['Draft', 'Sent to Buyer', 'Under Negotiation'].includes(quote.status)) {
    throw ApiError(`Cannot approve a quotation in status "${quote.status}"`, {
      status: 409,
      code: 'INVALID_TRANSITION',
    });
  }
  const record = await prisma.exportQuotation.update({
    where: { id: quote.id },
    data: {
      status: 'Accepted',
      approvedBy: req.user?.id || null,
      approvedAt: new Date(),
    },
    include: INCLUDE.quotation,
  });
  await logExportAudit({
    companyId: quote.companyId,
    userId: req.user?.id,
    action: 'QUOTATION_APPROVED',
    entityType: 'ExportQuotation',
    entityId: quote.id,
  });
  return record;
}

async function convertQuotationToOrder(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const quote = await loadWriteRecord(req, 'exportQuotation', req.params.id, INCLUDE.quotation);
  if (quote.convertedOrderId) {
    const existing = await prisma.exportSalesOrder.findFirst({
      where: { id: quote.convertedOrderId, companyId },
      include: INCLUDE.order,
    });
    if (existing) return existing;
  }
  if (quote.status !== 'Accepted') {
    throw ApiError('Approve the quotation before converting it to an order', {
      status: 409,
      code: 'QUOTATION_NOT_APPROVED',
    });
  }
  const order = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: quote.customerId, companyId, isActive: true, isDeleted: false },
    });
    if (!customer) {
      throw ApiError('Quotation customer is no longer active', {
        status: 400,
        code: 'CUSTOMER_NOT_FOUND',
      });
    }
    const rate = toNum(quote.exchangeRate) || 1;
    const items = quote.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      quantity: item.quantity,
      uom: item.uom,
      unitPriceForeign: item.unitPriceForeign,
      unitPriceBase: item.unitPriceBase,
      discountForeign: item.discountForeign,
      lineTotalForeign: item.lineTotalForeign,
      lineTotalBase: item.lineTotalBase,
    }));
    if (items.some((i) => !i.productId)) {
      throw ApiError(
        'Every quotation line must reference a product before it can become an order',
        { status: 400, code: 'PRODUCT_REQUIRED', field: 'items' }
      );
    }
    const orderDate = body.orderDate ? requiredDate(body.orderDate, 'orderDate') : new Date();
    const number = await nextNumber(tx, 'exportSalesOrder', 'orderNumber', companyId, 'ESO');
    const record = await tx.exportSalesOrder.create({
      data: {
        companyId,
        orderNumber: number,
        quotationId: quote.id,
        inquiryId: quote.inquiryId || null,
        customerId: quote.customerId,
        customerName: quote.customerName,
        customerCountry: quote.customerCountry,
        destinationPort: quote.portOfDischarge || null,
        incoterm: quote.incoterm || 'FOB',
        currency: quote.currency,
        exchangeRate: quote.exchangeRate,
        exchangeRateDate: quote.exchangeRateDate,
        rateSource: quote.rateSource,
        baseCurrencyCode: quote.baseCurrencyCode,
        orderDate,
        deliveryDeadline: body.deliveryDeadline
          ? requiredDate(body.deliveryDeadline, 'deliveryDeadline')
          : null,
        subtotalForeign: quote.subtotalForeign,
        subtotalBase: quote.subtotalBase,
        freightForeign: quote.freightForeign,
        freightBase: quote.freightBase,
        discountForeign: 0,
        discountBase: 0,
        totalForeign: quote.totalForeign,
        totalBase: quote.totalBase,
        outstandingBase: quote.totalBase,
        paymentTerms: quote.paymentTerms || 'Net 30',
        status: 'Confirmed',
        approvedBy: req.user?.id || null,
        approvedAt: new Date(),
        locationId: body.locationId || null,
        notes: body.notes || quote.notes || null,
        createdBy: req.user?.id || null,
        items: {
          create: items.map((i) => ({
            productId: i.productId,
            productName: i.productName,
            sku: i.sku,
            quantity: i.quantity,
            uom: i.uom,
            unitPriceForeign: i.unitPriceForeign,
            unitPriceBase: i.unitPriceBase,
            discountForeign: i.discountForeign,
            lineTotalForeign: i.lineTotalForeign,
            lineTotalBase: i.lineTotalBase,
          })),
        },
      },
      include: INCLUDE.order,
    });
    await tx.exportQuotation.update({
      where: { id: quote.id },
      data: { status: 'Converted to Order', convertedOrderId: record.id },
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'QUOTATION_CONVERTED',
        entityType: 'ExportQuotation',
        entityId: quote.id,
        details: { orderId: record.id, orderNumber: number },
      },
      tx
    );
    return record;
  });
  return order;
}

// ─────────────────────────────────────────────────────────────
// Sales orders
// ─────────────────────────────────────────────────────────────

async function listOrders(req, query = {}) {
  return listCollection(req, query, {
    model: 'exportSalesOrder',
    include: INCLUDE.order,
    searchFields: ['orderNumber', 'customerName', 'customerCountry', 'destinationPort'],
    dateField: 'orderDate',
    allowedSort: ['orderDate', 'orderNumber', 'createdAt', 'status', 'totalForeign', 'outstandingBase'],
    defaultSort: 'orderDate',
  });
}

async function getOrder(req) {
  return loadScopedRecord(req, 'exportSalesOrder', req.params.id, INCLUDE.order);
}

async function getOrderFull(req) {
  const order = await loadScopedRecord(req, 'exportSalesOrder', req.params.id, INCLUDE.order);
  const scope = requireScope(req);
  const [
    proformas,
    packings,
    shipments,
    customs,
    dispatches,
    documents,
    receipts,
    lcs,
    expenses,
  ] = await Promise.all([
    prisma.exportProformaInvoice.findMany({ where: { companyId: scope, orderId: order.id } }),
    prisma.exportPacking.findMany({
      where: { companyId: scope, orderId: order.id },
      include: { items: true },
    }),
    prisma.exportShipment.findMany({
      where: { companyId: scope, orderId: order.id },
      include: { items: true },
    }),
    prisma.exportCustomsDeclaration.findMany({ where: { companyId: scope, orderId: order.id } }),
    prisma.exportDispatch.findMany({ where: { companyId: scope, orderId: order.id } }),
    prisma.exportDocument.findMany({ where: { companyId: scope, orderId: order.id } }),
    prisma.exportReceipt.findMany({
      where: { companyId: scope, orderId: order.id },
      orderBy: { receiptDate: 'desc' },
    }),
    prisma.exportFinanceLc.findMany({ where: { companyId: scope, orderId: order.id } }),
    prisma.exportExpense.findMany({ where: { companyId: scope, orderId: order.id } }),
  ]);
  const invoiceIds = dispatches.map((d) => d.salesInvoiceId).filter(Boolean);
  const invoices = invoiceIds.length
    ? await prisma.salesInvoice.findMany({
        where: { id: { in: invoiceIds }, companyId: scope },
        include: { items: true },
      })
    : [];
  return {
    order,
    proformas,
    packings,
    shipments,
    customs,
    dispatches,
    documents,
    receipts,
    lcs,
    expenses,
    invoices,
  };
}

async function createOrder(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  return createEntity(req, {
    entityModel: 'exportSalesOrder',
    entityType: 'ExportSalesOrder',
    include: INCLUDE.order,
    build: async (tx) => {
      const customer = await validateCustomer(tx, companyId, body.customerId, body.customerName);
      const orderDate = body.orderDate ? requiredDate(body.orderDate, 'orderDate') : new Date();
      const currency = String(body.currency || 'USD').toUpperCase();
      const fx = await resolveFx({
        companyId,
        currencyCode: currency,
        foreignAmount: 0,
        explicitRate: body.exchangeRate,
        asOfDate: orderDate,
        client: tx,
      });
      const rate = toNum(fx.exchangeRate);
      const items = await resolveDocumentItems(tx, {
        companyId,
        items: body.items,
        rate,
        requireProduct: true,
      });
      const subtotalForeign = sumItems(items, 'lineTotalForeign');
      const subtotalBase = sumItems(items, 'lineTotalBase');
      const freightForeign = nonNegativeNumber(body.freightForeign, 'freightForeign');
      const discountForeign = nonNegativeNumber(body.discountForeign, 'discountForeign');
      const totalForeign = round(subtotalForeign + freightForeign - discountForeign);
      if (totalForeign <= 0) {
        throw ApiError('Order total must be greater than zero', {
          status: 400,
          code: 'INVALID_AMOUNT',
        });
      }
      const totalBase = round(subtotalBase + (freightForeign - discountForeign) * rate);
      if (body.locationId) {
        await assertLocationBelongsToActiveCompany(body.locationId, companyId);
      }
      const number = await nextNumber(tx, 'exportSalesOrder', 'orderNumber', companyId, 'ESO');
      const confirm = Boolean(body.confirm);
      const record = await tx.exportSalesOrder.create({
        data: {
          companyId,
          orderNumber: number,
          quotationId: body.quotationId || null,
          inquiryId: body.inquiryId || null,
          customerId: customer.customerId,
          customerName: customer.customerName,
          customerCountry: body.customerCountry || customer.customerCountry,
          destinationPort: body.destinationPort || null,
          destinationPortCode: body.destinationPortCode || null,
          incoterm: body.incoterm || 'FOB',
          currency,
          exchangeRate: fx.exchangeRate,
          exchangeRateDate: fx.exchangeRateDate,
          rateSource: fx.rateSource,
          baseCurrencyCode: fx.baseCurrencyCode,
          orderDate,
          deliveryDeadline: body.deliveryDeadline
            ? requiredDate(body.deliveryDeadline, 'deliveryDeadline')
            : null,
          subtotalForeign,
          subtotalBase,
          freightForeign,
          freightBase: round(freightForeign * rate),
          discountForeign,
          discountBase: round(discountForeign * rate),
          totalForeign,
          totalBase,
          outstandingBase: totalBase,
          paymentTerms: body.paymentTerms || 'Net 30',
          status: confirm ? 'Confirmed' : 'Draft',
          approvedBy: confirm ? req.user?.id || null : null,
          approvedAt: confirm ? new Date() : null,
          locationId: body.locationId || null,
          notes: body.notes || null,
          createdBy: req.user?.id || null,
          items: {
            create: items.map((i) => ({
              productId: i.productId,
              productName: i.productName,
              sku: i.sku,
              quantity: i.quantity,
              uom: i.uom,
              unitPriceForeign: i.unitPriceForeign,
              unitPriceBase: i.unitPriceBase,
              discountForeign: i.discountForeign,
              lineTotalForeign: i.lineTotalForeign,
              lineTotalBase: i.lineTotalBase,
            })),
          },
        },
        include: INCLUDE.order,
      });
      await logExportAudit(
        {
          companyId,
          userId: req.user?.id,
          action: 'ORDER_CREATED',
          entityType: 'ExportSalesOrder',
          entityId: record.id,
          details: { orderNumber: number, currency, totalForeign, totalBase },
        },
        tx
      );
      return record;
    },
  });
}

async function updateOrder(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const order = await loadWriteRecord(req, 'exportSalesOrder', req.params.id, INCLUDE.order);
  if (!['Draft', 'Confirmed'].includes(order.status)) {
    throw ApiError(`Order is ${order.status} and can no longer be edited`, {
      status: 409,
      code: 'LOCKED_RECORD',
    });
  }
  const financialEdit =
    body.items !== undefined ||
    body.currency !== undefined ||
    body.exchangeRate !== undefined ||
    body.freightForeign !== undefined ||
    body.discountForeign !== undefined;
  if (order.status === 'Confirmed' && financialEdit) {
    throw ApiError(
      'Confirmed orders cannot change items, currency or charges. Cancel and recreate the order instead.',
      { status: 409, code: 'LOCKED_FINANCIALS' }
    );
  }
  return prisma.$transaction(async (tx) => {
    const data = {};
    for (const f of ['destinationPort', 'destinationPortCode', 'incoterm', 'paymentTerms', 'notes']) {
      if (body[f] !== undefined) data[f] = body[f] || null;
    }
    if (body.deliveryDeadline !== undefined) {
      data.deliveryDeadline = body.deliveryDeadline
        ? requiredDate(body.deliveryDeadline, 'deliveryDeadline')
        : null;
    }
    if (body.locationId !== undefined) {
      if (body.locationId) {
        await assertLocationBelongsToActiveCompany(body.locationId, companyId);
        data.locationId = body.locationId;
      } else {
        data.locationId = null;
      }
    }
    if (body.customerId !== undefined && body.customerId !== order.customerId) {
      const customer = await validateCustomer(tx, companyId, body.customerId, body.customerName);
      data.customerId = customer.customerId;
      data.customerName = customer.customerName;
      data.customerCountry = body.customerCountry || customer.customerCountry;
    }
    if (financialEdit) {
      const currency = String(body.currency || order.currency).toUpperCase();
      const fx = await resolveFx({
        companyId,
        currencyCode: currency,
        foreignAmount: 0,
        explicitRate: body.exchangeRate,
        asOfDate: order.orderDate,
        client: tx,
      });
      const rate = toNum(fx.exchangeRate);
      let items = order.items;
      if (body.items) {
        const resolved = await resolveDocumentItems(tx, {
          companyId,
          items: body.items,
          rate,
          requireProduct: true,
        });
        await tx.exportSalesOrderItem.deleteMany({ where: { orderId: order.id } });
        await tx.exportSalesOrderItem.createMany({
          data: resolved.map((i) => ({ orderId: order.id, ...i })),
        });
        items = resolved;
      }
      const subtotalForeign = body.items
        ? sumItems(items, 'lineTotalForeign')
        : toNum(order.subtotalForeign);
      const subtotalBase = body.items
        ? sumItems(items, 'lineTotalBase')
        : round(subtotalForeign * rate);
      const freightForeign =
        body.freightForeign !== undefined
          ? nonNegativeNumber(body.freightForeign, 'freightForeign')
          : toNum(order.freightForeign);
      const discountForeign =
        body.discountForeign !== undefined
          ? nonNegativeNumber(body.discountForeign, 'discountForeign')
          : toNum(order.discountForeign);
      const totalForeign = round(subtotalForeign + freightForeign - discountForeign);
      if (totalForeign <= 0) {
        throw ApiError('Order total must be greater than zero', {
          status: 400,
          code: 'INVALID_AMOUNT',
        });
      }
      Object.assign(data, {
        currency,
        exchangeRate: fx.exchangeRate,
        exchangeRateDate: fx.exchangeRateDate,
        rateSource: fx.rateSource,
        baseCurrencyCode: fx.baseCurrencyCode,
        subtotalForeign,
        subtotalBase,
        freightForeign,
        freightBase: round(freightForeign * rate),
        discountForeign,
        discountBase: round(discountForeign * rate),
        totalForeign,
        totalBase: round(totalForeign * rate),
      });
    }
    const record = await tx.exportSalesOrder.update({
      where: { id: order.id },
      data,
      include: INCLUDE.order,
    });
    await accounting.refreshOrderBalances(tx, order.id);
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'ORDER_UPDATED',
        entityType: 'ExportSalesOrder',
        entityId: order.id,
        details: { fields: Object.keys(data) },
      },
      tx
    );
    return tx.exportSalesOrder.findFirst({
      where: { id: record.id, companyId },
      include: INCLUDE.order,
    });
  });
}

async function approveOrder(req) {
  const order = await loadWriteRecord(req, 'exportSalesOrder', req.params.id);
  if (order.status === 'Confirmed') {
    return loadScopedRecord(req, 'exportSalesOrder', order.id, INCLUDE.order);
  }
  if (order.status !== 'Draft') {
    throw ApiError(`Cannot confirm an order in status "${order.status}"`, {
      status: 409,
      code: 'INVALID_TRANSITION',
    });
  }
  const record = await prisma.exportSalesOrder.update({
    where: { id: order.id },
    data: { status: 'Confirmed', approvedBy: req.user?.id || null, approvedAt: new Date() },
    include: INCLUDE.order,
  });
  await logExportAudit({
    companyId: order.companyId,
    userId: req.user?.id,
    action: 'ORDER_APPROVED',
    entityType: 'ExportSalesOrder',
    entityId: order.id,
  });
  return record;
}

async function assertOrderCompletable(tx, companyId, order) {
  const items = await tx.exportSalesOrderItem.findMany({ where: { orderId: order.id } });
  const incomplete = items.filter(
    (i) =>
      toNum(i.shippedQty) + 0.0001 < toNum(i.quantity) ||
      toNum(i.invoicedQty) + 0.0001 < toNum(i.quantity)
  );
  if (incomplete.length) {
    throw ApiError(
      'Cannot complete: not all order quantities have been shipped and invoiced',
      {
        status: 409,
        code: 'ORDER_NOT_FULLY_SHIPPED',
        details: incomplete.map((i) => ({
          productName: i.productName,
          ordered: toNum(i.quantity),
          shipped: toNum(i.shippedQty),
          invoiced: toNum(i.invoicedQty),
        })),
      }
    );
  }
  const shipments = await tx.exportShipment.findMany({ where: { orderId: order.id, companyId } });
  const pendingShipments = shipments.filter(
    (s) => s.shipmentStatus !== 'Customs Cleared Buyer' && s.shipmentStatus !== 'Cancelled'
  );
  if (pendingShipments.length) {
    throw ApiError(
      'Cannot complete: every shipment must reach "Customs Cleared Buyer"',
      {
        status: 409,
        code: 'SHIPMENTS_NOT_DELIVERED',
        details: pendingShipments.map((s) => ({
          shipmentNumber: s.shipmentNumber,
          status: s.shipmentStatus,
        })),
      }
    );
  }
  const unappliedAdvance = Math.max(
    0,
    toNum(order.advanceReceivedBase) - toNum(order.advanceAppliedBase)
  );
  const settled = round(toNum(order.paidBase) + unappliedAdvance);
  if (toNum(order.invoicedBase) + 0.01 < toNum(order.totalBase)) {
    throw ApiError('Cannot complete: the full contract value has not been invoiced', {
      status: 409,
      code: 'ORDER_NOT_FULLY_INVOICED',
      details: {
        totalBase: toNum(order.totalBase),
        invoicedBase: toNum(order.invoicedBase),
      },
    });
  }
  if (settled + 0.01 < toNum(order.totalBase)) {
    throw ApiError('Cannot complete: the order still has an unpaid balance', {
      status: 409,
      code: 'ORDER_NOT_FULLY_PAID',
      details: {
        totalBase: toNum(order.totalBase),
        paidBase: toNum(order.paidBase),
        unappliedAdvance,
      },
    });
  }
  const pendingReceipts = await tx.exportReceipt.findMany({
    where: { companyId, orderId: order.id, status: 'Funds In Transit' },
  });
  if (pendingReceipts.length) {
    throw ApiError('Cannot complete: some receipts are still in transit', {
      status: 409,
      code: 'RECEIPTS_IN_TRANSIT',
    });
  }
}

async function updateOrderStatus(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const order = await loadWriteRecord(req, 'exportSalesOrder', req.params.id);
  const next = canonicalStatus('order', body.status);
  if (next === 'Completed') {
    if (order.status !== 'Delivered') {
      throw ApiError('Only delivered orders can be completed', {
        status: 409,
        code: 'INVALID_TRANSITION',
      });
    }
    await prisma.$transaction(async (tx) => {
      await assertOrderCompletable(tx, companyId, order);
      await tx.exportSalesOrder.update({
        where: { id: order.id },
        data: { status: 'Completed' },
      });
    });
  } else if (next === 'Cancelled') {
    assertTransition('order', order.status, next);
    const [dispatches, receipts, shipments] = await Promise.all([
      prisma.exportDispatch.count({
        where: { companyId, orderId: order.id, salesInvoiceId: { not: null } },
      }),
      prisma.exportReceipt.count({ where: { companyId, orderId: order.id } }),
      prisma.exportShipment.count({
        where: { companyId, orderId: order.id, shipmentStatus: { not: 'Cancelled' } },
      }),
    ]);
    if (dispatches || receipts || shipments) {
      throw ApiError(
        'Cannot cancel an order with shipments, commercial invoices or receipts. Reverse those documents first.',
        { status: 409, code: 'ORDER_HAS_ACTIVITY' }
      );
    }
    await prisma.exportSalesOrder.update({
      where: { id: order.id },
      data: { status: 'Cancelled' },
    });
  } else {
    assertTransition('order', order.status, next);
    if (next === 'Confirmed' && !order.approvedAt) {
      await prisma.exportSalesOrder.update({
        where: { id: order.id },
        data: { status: next, approvedBy: req.user?.id || null, approvedAt: new Date() },
      });
    } else {
      await prisma.exportSalesOrder.update({
        where: { id: order.id },
        data: { status: next },
      });
    }
  }
  const record = await loadScopedRecord(req, 'exportSalesOrder', order.id, INCLUDE.order);
  await logExportAudit({
    companyId,
    userId: req.user?.id,
    action: 'ORDER_STATUS_UPDATED',
    entityType: 'ExportSalesOrder',
    entityId: order.id,
    details: { from: order.status, to: next },
  });
  return record;
}

// ─────────────────────────────────────────────────────────────
// Proforma invoices
// ─────────────────────────────────────────────────────────────

async function listProformas(req, query = {}) {
  const extraWhere = query.orderId ? { orderId: query.orderId } : null;
  return withOrderNumbers(
    req,
    await listCollection(req, query, {
      model: 'exportProformaInvoice',
      searchFields: ['piNumber', 'customerName', 'customerCountry'],
      dateField: 'date',
      allowedSort: ['date', 'piNumber', 'createdAt', 'status', 'amountForeign'],
      defaultSort: 'date',
      extraWhere,
    })
  );
}

async function getProforma(req) {
  return loadScopedRecord(req, 'exportProformaInvoice', req.params.id);
}

async function createProforma(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  return prisma.$transaction(async (tx) => {
    const orderId = req.params.orderId || body.orderId;
    const order = await tx.exportSalesOrder.findFirst({
      where: { id: orderId, companyId },
      include: INCLUDE.order,
    });
    if (!order) {
      throw ApiError('Export order not found for the active company', {
        status: 404,
        code: 'ORDER_NOT_FOUND',
      });
    }
    if (['Cancelled', 'Completed'].includes(order.status)) {
      throw ApiError(`Cannot raise a proforma for a ${order.status.toLowerCase()} order`, {
        status: 409,
        code: 'INVALID_ORDER_STATUS',
      });
    }
    const amountForeign = body.amountForeign
      ? positiveNumber(body.amountForeign, 'amountForeign')
      : toNum(order.totalForeign);
    if (amountForeign > toNum(order.totalForeign) + 0.01) {
      throw ApiError('Proforma amount cannot exceed the order value', {
        status: 400,
        code: 'INVALID_AMOUNT',
        field: 'amountForeign',
      });
    }
    const amountBase = round(amountForeign * (toNum(order.exchangeRate) || 1));
    const date = body.date ? requiredDate(body.date, 'date') : new Date();
    const number = await nextNumber(
      tx,
      'exportProformaInvoice',
      'piNumber',
      companyId,
      'EPI'
    );
    const record = await tx.exportProformaInvoice.create({
      data: {
        companyId,
        piNumber: number,
        orderId: order.id,
        customerName: order.customerName,
        customerCountry: order.customerCountry,
        date,
        currency: order.currency,
        exchangeRate: order.exchangeRate,
        exchangeRateDate: order.exchangeRateDate,
        rateSource: order.rateSource,
        baseCurrencyCode: order.baseCurrencyCode,
        amountForeign,
        amountBase,
        bankSwiftCode: body.bankSwiftCode || null,
        beneficiaryAccount: body.beneficiaryAccount || null,
        lcNumber: body.lcNumber || null,
        status: 'Issued',
        notes: body.notes || null,
        createdBy: req.user?.id || null,
      },
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'PROFORMA_CREATED',
        entityType: 'ExportProformaInvoice',
        entityId: record.id,
        details: { piNumber: number, orderNumber: order.orderNumber, amountForeign },
      },
      tx
    );
    return record;
  });
}

async function updateProforma(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const pi = await loadWriteRecord(req, 'exportProformaInvoice', req.params.id);
  if (pi.status !== 'Issued') {
    throw ApiError(`Proforma is ${pi.status} and cannot be edited`, {
      status: 409,
      code: 'LOCKED_RECORD',
    });
  }
  const data = {};
  for (const f of ['bankSwiftCode', 'beneficiaryAccount', 'lcNumber', 'notes']) {
    if (body[f] !== undefined) data[f] = body[f] || null;
  }
  if (body.date !== undefined) data.date = requiredDate(body.date, 'date');
  const record = await prisma.exportProformaInvoice.update({
    where: { id: pi.id },
    data,
  });
  await logExportAudit({
    companyId,
    userId: req.user?.id,
    action: 'PROFORMA_UPDATED',
    entityType: 'ExportProformaInvoice',
    entityId: pi.id,
    details: { fields: Object.keys(data) },
  });
  return record;
}

async function updateProformaStatus(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const pi = await loadWriteRecord(req, 'exportProformaInvoice', req.params.id);
  const next = canonicalStatus('proforma', body.status);
  assertTransition('proforma', pi.status, next);
  const record = await prisma.exportProformaInvoice.update({
    where: { id: pi.id },
    data: { status: next, ...(body.notes !== undefined ? { notes: body.notes } : {}) },
  });
  await logExportAudit({
    companyId,
    userId: req.user?.id,
    action: 'PROFORMA_STATUS_UPDATED',
    entityType: 'ExportProformaInvoice',
    entityId: pi.id,
    details: { from: pi.status, to: next },
  });
  return record;
}

// ─────────────────────────────────────────────────────────────
// Packing & inspection
// ─────────────────────────────────────────────────────────────

async function listPackings(req, query = {}) {
  const extraWhere = query.orderId ? { orderId: query.orderId } : null;
  return withOrderNumbers(
    req,
    await listCollection(req, query, {
      model: 'exportPacking',
      include: INCLUDE.packing,
      searchFields: ['packingListNo', 'containerNo', 'sealNo'],
      dateField: 'packingDate',
      statusField: 'inspectionStatus',
      allowedSort: ['packingDate', 'packingListNo', 'createdAt'],
      defaultSort: 'packingDate',
      extraWhere,
    })
  );
}

async function getPacking(req) {
  return loadScopedRecord(req, 'exportPacking', req.params.id, INCLUDE.packing);
}

async function createPacking(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  return prisma.$transaction(async (tx) => {
    const orderId = req.params.orderId || body.orderId;
    const order = await tx.exportSalesOrder.findFirst({
      where: { id: orderId, companyId },
      include: INCLUDE.order,
    });
    if (!order) {
      throw ApiError('Export order not found for the active company', {
        status: 404,
        code: 'ORDER_NOT_FOUND',
      });
    }
    if (['Cancelled', 'Completed'].includes(order.status)) {
      throw ApiError(`Cannot pack a ${order.status.toLowerCase()} order`, {
        status: 409,
        code: 'INVALID_ORDER_STATUS',
      });
    }
    const rawItems = Array.isArray(body.items) && body.items.length
      ? body.items
      : order.items.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          sku: i.sku,
          quantity: i.quantity,
          uom: i.uom,
          packages: 1,
          grossWeightKg: 0,
          netWeightKg: 0,
          cbm: 0,
        }));
    const items = rawItems.map((i, index) => ({
      productId: i.productId || null,
      productName: String(i.productName || `Item ${index + 1}`),
      sku: i.sku || null,
      quantity: nonNegativeNumber(i.quantity, `items[${index}].quantity`),
      uom: i.uom || 'PCS',
      packages: Math.max(0, parseInt(i.packages, 10) || 0),
      grossWeightKg: nonNegativeNumber(i.grossWeightKg, `items[${index}].grossWeightKg`),
      netWeightKg: nonNegativeNumber(i.netWeightKg, `items[${index}].netWeightKg`),
      cbm: nonNegativeNumber(i.cbm, `items[${index}].cbm`),
    }));
    const number = await nextNumber(tx, 'exportPacking', 'packingListNo', companyId, 'EPL');
    const record = await tx.exportPacking.create({
      data: {
        companyId,
        packingListNo: number,
        orderId: order.id,
        shipmentId: body.shipmentId || null,
        packingDate: body.packingDate ? requiredDate(body.packingDate, 'packingDate') : new Date(),
        containerNo: body.containerNo || null,
        sealNo: body.sealNo || null,
        containerType: body.containerType || null,
        totalGrossWeightKg: round(items.reduce((s, i) => s + i.grossWeightKg, 0)),
        totalNetWeightKg: round(items.reduce((s, i) => s + i.netWeightKg, 0)),
        totalCbm: round(items.reduce((s, i) => s + i.cbm, 0)),
        packagesCount: items.reduce((s, i) => s + i.packages, 0),
        inspectionAgency: body.inspectionAgency || null,
        inspectionCertificateNo: body.inspectionCertificateNo || null,
        inspectionStatus: 'Inspection Scheduled',
        notes: body.notes || null,
        createdBy: req.user?.id || null,
        items: { create: items },
      },
      include: INCLUDE.packing,
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'PACKING_CREATED',
        entityType: 'ExportPacking',
        entityId: record.id,
        details: { packingListNo: number, orderNumber: order.orderNumber },
      },
      tx
    );
    return record;
  });
}

async function updatePacking(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const packing = await loadWriteRecord(req, 'exportPacking', req.params.id, INCLUDE.packing);
  if (packing.inspectionStatus === 'Passed & Certified') {
    throw ApiError('Packing is certified and cannot be edited', {
      status: 409,
      code: 'LOCKED_RECORD',
    });
  }
  return prisma.$transaction(async (tx) => {
    const data = {};
    for (const f of ['containerNo', 'sealNo', 'containerType', 'inspectionAgency', 'inspectionCertificateNo', 'notes']) {
      if (body[f] !== undefined) data[f] = body[f] || null;
    }
    if (body.packingDate !== undefined) data.packingDate = requiredDate(body.packingDate, 'packingDate');
    if (body.shipmentId !== undefined) data.shipmentId = body.shipmentId || null;
    if (Array.isArray(body.items)) {
      const items = body.items.map((i, index) => ({
        packingId: packing.id,
        productId: i.productId || null,
        productName: String(i.productName || `Item ${index + 1}`),
        sku: i.sku || null,
        quantity: nonNegativeNumber(i.quantity, `items[${index}].quantity`),
        uom: i.uom || 'PCS',
        packages: Math.max(0, parseInt(i.packages, 10) || 0),
        grossWeightKg: nonNegativeNumber(i.grossWeightKg, `items[${index}].grossWeightKg`),
        netWeightKg: nonNegativeNumber(i.netWeightKg, `items[${index}].netWeightKg`),
        cbm: nonNegativeNumber(i.cbm, `items[${index}].cbm`),
      }));
      await tx.exportPackingItem.deleteMany({ where: { packingId: packing.id } });
      await tx.exportPackingItem.createMany({ data: items });
      data.totalGrossWeightKg = round(items.reduce((s, i) => s + i.grossWeightKg, 0));
      data.totalNetWeightKg = round(items.reduce((s, i) => s + i.netWeightKg, 0));
      data.totalCbm = round(items.reduce((s, i) => s + i.cbm, 0));
      data.packagesCount = items.reduce((s, i) => s + i.packages, 0);
    }
    const record = await tx.exportPacking.update({
      where: { id: packing.id },
      data,
      include: INCLUDE.packing,
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'PACKING_UPDATED',
        entityType: 'ExportPacking',
        entityId: packing.id,
        details: { fields: Object.keys(data) },
      },
      tx
    );
    return record;
  });
}

async function updatePackingStatus(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const packing = await loadWriteRecord(req, 'exportPacking', req.params.id, INCLUDE.packing);
  const next = canonicalStatus('packing', body.status);
  assertTransition('packing', packing.inspectionStatus, next);
  const certificate =
    body.inspectionCertificateNo || packing.inspectionCertificateNo || null;
  if (next === 'Passed & Certified' && !certificate) {
    throw ApiError('An inspection certificate number is required before certification', {
      status: 400,
      code: 'CERTIFICATE_REQUIRED',
      field: 'inspectionCertificateNo',
    });
  }
  const record = await prisma.exportPacking.update({
    where: { id: packing.id },
    data: {
      inspectionStatus: next,
      inspectionCertificateNo: certificate,
      ...(body.inspectionAgency ? { inspectionAgency: body.inspectionAgency } : {}),
    },
    include: INCLUDE.packing,
  });
  await logExportAudit({
    companyId,
    userId: req.user?.id,
    action: 'PACKING_STATUS_UPDATED',
    entityType: 'ExportPacking',
    entityId: packing.id,
    details: { from: packing.inspectionStatus, to: next },
  });
  return record;
}

// ─────────────────────────────────────────────────────────────
// Shipments (partial shipment support)
// ─────────────────────────────────────────────────────────────

async function committedQtyByProduct(tx, orderId, excludeShipmentId = null) {
  const shipments = await tx.exportShipment.findMany({
    where: {
      orderId,
      shipmentStatus: { not: 'Cancelled' },
      ...(excludeShipmentId ? { id: { not: excludeShipmentId } } : {}),
    },
    include: { items: true },
  });
  const map = new Map();
  for (const shipment of shipments) {
    for (const item of shipment.items) {
      const key = String(item.productId);
      map.set(key, round(toNum(map.get(key)) + toNum(item.quantity)));
    }
  }
  return map;
}

async function buildShipmentItems(tx, order, bodyItems, excludeShipmentId = null) {
  const committed = await committedQtyByProduct(tx, order.id, excludeShipmentId);
  const orderByProduct = new Map();
  for (const item of order.items) {
    const key = String(item.productId);
    const entry = orderByProduct.get(key) || { item, quantity: 0, committed: toNum(committed.get(key)) };
    entry.quantity = round(entry.quantity + toNum(item.quantity));
    orderByProduct.set(key, entry);
  }

  let raw;
  if (Array.isArray(bodyItems) && bodyItems.length) {
    raw = bodyItems;
  } else {
    raw = [];
    for (const entry of orderByProduct.values()) {
      const remaining = round(entry.quantity - entry.committed);
      if (remaining > 0) {
        raw.push({
          productId: entry.item.productId,
          productName: entry.item.productName,
          sku: entry.item.sku,
          quantity: remaining,
          uom: entry.item.uom,
          unitPriceForeign: entry.item.unitPriceForeign,
          unitPriceBase: entry.item.unitPriceBase,
        });
      }
    }
  }
  if (!raw.length) {
    throw ApiError('There is no remaining quantity to ship on this order', {
      status: 409,
      code: 'NOTHING_TO_SHIP',
    });
  }

  const requested = new Map();
  const resolved = [];
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    const productId = item.productId || item.orderItemProductId;
    const orderEntry = productId ? orderByProduct.get(String(productId)) : null;
    if (!orderEntry) {
      throw ApiError(`Shipment line ${index + 1} does not match an order product`, {
        status: 400,
        code: 'SHIPMENT_ITEM_MISMATCH',
        field: 'items',
      });
    }
    const qty = positiveNumber(item.quantity, `items[${index}].quantity`);
    const seen = round(toNum(requested.get(String(productId))) + qty);
    requested.set(String(productId), seen);
    const remaining = round(orderEntry.quantity - orderEntry.committed);
    if (seen > remaining + 0.0001) {
      throw ApiError(
        `Shipment quantity for ${orderEntry.item.productName} exceeds the remaining order quantity (${Math.max(0, remaining)})`,
        { status: 400, code: 'OVER_SHIPMENT', field: 'items' }
      );
    }
    const unitPriceForeign = round(
      toNum(item.unitPriceForeign ?? orderEntry.item.unitPriceForeign)
    );
    const unitPriceBase = round(
      toNum(item.unitPriceBase ?? orderEntry.item.unitPriceBase) ||
        unitPriceForeign * (toNum(order.exchangeRate) || 1)
    );
    resolved.push({
      orderItemId: orderEntry.item.id,
      productId: productId,
      productName: orderEntry.item.productName,
      sku: orderEntry.item.sku,
      quantity: qty,
      uom: item.uom || orderEntry.item.uom || 'PCS',
      unitPriceForeign,
      unitPriceBase,
      lineTotalForeign: round(qty * unitPriceForeign),
      lineTotalBase: round(qty * unitPriceBase),
    });
  }
  return resolved;
}

async function listShipments(req, query = {}) {
  const extraWhere = query.orderId ? { orderId: query.orderId } : null;
  return withOrderNumbers(
    req,
    await listCollection(req, query, {
      model: 'exportShipment',
      include: INCLUDE.shipment,
      searchFields: ['shipmentNumber', 'customerName', 'blNumber', 'vesselName', 'portOfDischarge'],
      dateField: 'createdAt',
      statusField: 'shipmentStatus',
      allowedSort: ['createdAt', 'shipmentNumber', 'etd', 'eta'],
      defaultSort: 'createdAt',
      extraWhere,
    })
  );
}

async function getShipment(req) {
  return loadScopedRecord(req, 'exportShipment', req.params.id, INCLUDE.shipment);
}

async function createShipment(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  return prisma.$transaction(async (tx) => {
    const orderId = req.params.orderId || body.orderId;
    const order = await tx.exportSalesOrder.findFirst({
      where: { id: orderId, companyId },
      include: INCLUDE.order,
    });
    if (!order) {
      throw ApiError('Export order not found for the active company', {
        status: 404,
        code: 'ORDER_NOT_FOUND',
      });
    }
    if (!['Confirmed', 'In Production / Packing', 'Pre-Shipment Inspection', 'Customs Cleared', 'Dispatched'].includes(order.status)) {
      throw ApiError(`Cannot create a shipment for an order in status "${order.status}"`, {
        status: 409,
        code: 'INVALID_ORDER_STATUS',
      });
    }
    if (body.locationId) {
      await assertLocationBelongsToActiveCompany(body.locationId, companyId);
    }
    const items = await buildShipmentItems(tx, order, body.items);
    const number = await nextNumber(tx, 'exportShipment', 'shipmentNumber', companyId, 'ESHP');
    const record = await tx.exportShipment.create({
      data: {
        companyId,
        shipmentNumber: number,
        orderId: order.id,
        customerName: order.customerName,
        customerCountry: order.customerCountry,
        shippingLine: body.shippingLine || null,
        bookingRef: body.bookingRef || null,
        blNumber: body.blNumber || null,
        portOfLoading: body.portOfLoading || null,
        portOfDischarge: body.portOfDischarge || order.destinationPort || null,
        vesselName: body.vesselName || null,
        etd: body.etd ? requiredDate(body.etd, 'etd') : null,
        eta: body.eta ? requiredDate(body.eta, 'eta') : null,
        shipmentStatus: 'Booking Confirmed',
        currentPosition: body.currentPosition || null,
        locationId: body.locationId || order.locationId || null,
        notes: body.notes || null,
        createdBy: req.user?.id || null,
        items: { create: items },
      },
      include: INCLUDE.shipment,
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'SHIPMENT_CREATED',
        entityType: 'ExportShipment',
        entityId: record.id,
        details: { shipmentNumber: number, orderNumber: order.orderNumber },
      },
      tx
    );
    return record;
  });
}

async function updateShipment(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const shipment = await loadWriteRecord(req, 'exportShipment', req.params.id, {
    ...INCLUDE.shipment,
  });
  if (shipment.shipmentStatus !== 'Booking Confirmed') {
    throw ApiError('Shipment can only be edited while booking is confirmed', {
      status: 409,
      code: 'LOCKED_RECORD',
    });
  }
  return prisma.$transaction(async (tx) => {
    const data = {};
    for (const f of ['shippingLine', 'bookingRef', 'blNumber', 'portOfLoading', 'portOfDischarge', 'vesselName', 'currentPosition', 'notes']) {
      if (body[f] !== undefined) data[f] = body[f] || null;
    }
    for (const f of ['etd', 'eta']) {
      if (body[f] !== undefined) data[f] = body[f] ? requiredDate(body[f], f) : null;
    }
    if (body.locationId !== undefined) {
      if (body.locationId) {
        await assertLocationBelongsToActiveCompany(body.locationId, companyId);
        data.locationId = body.locationId;
      } else {
        data.locationId = null;
      }
    }
    if (Array.isArray(body.items)) {
      const order = await tx.exportSalesOrder.findFirst({
        where: { id: shipment.orderId, companyId },
        include: INCLUDE.order,
      });
      if (!order) {
        throw ApiError('Parent export order was not found', {
          status: 404,
          code: 'ORDER_NOT_FOUND',
        });
      }
      const items = await buildShipmentItems(tx, order, body.items, shipment.id);
      await tx.exportShipmentItem.deleteMany({ where: { shipmentId: shipment.id } });
      await tx.exportShipmentItem.createMany({
        data: items.map((i) => ({ shipmentId: shipment.id, ...i })),
      });
    }
    const record = await tx.exportShipment.update({
      where: { id: shipment.id },
      data,
      include: INCLUDE.shipment,
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'SHIPMENT_UPDATED',
        entityType: 'ExportShipment',
        entityId: shipment.id,
        details: { fields: Object.keys(data) },
      },
      tx
    );
    return record;
  });
}

async function updateShipmentStatus(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const shipment = await loadWriteRecord(req, 'exportShipment', req.params.id);
  const next = canonicalStatus('shipment', body.status);
  assertTransition('shipment', shipment.shipmentStatus, next);
  const record = await prisma.$transaction(async (tx) => {
    const updated = await tx.exportShipment.update({
      where: { id: shipment.id },
      data: {
        shipmentStatus: next,
        ...(body.currentPosition !== undefined
          ? { currentPosition: body.currentPosition || null }
          : {}),
      },
      include: INCLUDE.shipment,
    });
    const order = await tx.exportSalesOrder.findFirst({
      where: { id: shipment.orderId, companyId },
    });
    if (order) {
      if (next === 'Loaded on Vessel' && order.status === 'Dispatched') {
        await tx.exportSalesOrder.update({
          where: { id: order.id },
          data: { status: 'On Board Vessel' },
        });
      }
      if (next === 'Customs Cleared Buyer' && ['Dispatched', 'On Board Vessel'].includes(order.status)) {
        await tx.exportSalesOrder.update({
          where: { id: order.id },
          data: { status: 'Delivered' },
        });
      }
    }
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'SHIPMENT_STATUS_UPDATED',
        entityType: 'ExportShipment',
        entityId: shipment.id,
        details: { from: shipment.shipmentStatus, to: next },
      },
      tx
    );
    return updated;
  });
  return record;
}

// ─────────────────────────────────────────────────────────────
// Customs declarations
// ─────────────────────────────────────────────────────────────

async function listCustoms(req, query = {}) {
  const extraWhere = query.orderId ? { orderId: query.orderId } : null;
  return withOrderNumbers(
    req,
    await listCollection(req, query, {
      model: 'exportCustomsDeclaration',
      searchFields: ['shippingBillNo', 'customsAgent', 'exportPort'],
      dateField: 'declarationDate',
      allowedSort: ['declarationDate', 'shippingBillNo', 'createdAt'],
      defaultSort: 'declarationDate',
      extraWhere,
    })
  );
}

async function getCustoms(req) {
  return loadScopedRecord(req, 'exportCustomsDeclaration', req.params.id);
}

async function createCustoms(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  return prisma.$transaction(async (tx) => {
    const orderId = req.params.orderId || body.orderId;
    const order = await tx.exportSalesOrder.findFirst({
      where: { id: orderId, companyId },
      include: INCLUDE.order,
    });
    if (!order) {
      throw ApiError('Export order not found for the active company', {
        status: 404,
        code: 'ORDER_NOT_FOUND',
      });
    }
    if (body.shipmentId) {
      const shipment = await tx.exportShipment.findFirst({
        where: { id: body.shipmentId, companyId, orderId: order.id },
      });
      if (!shipment) {
        throw ApiError('Shipment does not belong to this order', {
          status: 400,
          code: 'SHIPMENT_MISMATCH',
        });
      }
    }
    const rate = toNum(order.exchangeRate) || 1;
    const fobForeign =
      body.fobValueForeign !== undefined
        ? nonNegativeNumber(body.fobValueForeign, 'fobValueForeign')
        : toNum(order.totalForeign);
    const drawbackForeign = nonNegativeNumber(
      body.dutyDrawbackEstimatedForeign,
      'dutyDrawbackEstimatedForeign'
    );
    const number = await nextNumber(
      tx,
      'exportCustomsDeclaration',
      'shippingBillNo',
      companyId,
      'ESB'
    );
    const record = await tx.exportCustomsDeclaration.create({
      data: {
        companyId,
        shippingBillNo: number,
        orderId: order.id,
        shipmentId: body.shipmentId || null,
        exportPort: body.exportPort || null,
        declarationDate: body.declarationDate
          ? requiredDate(body.declarationDate, 'declarationDate')
          : new Date(),
        fobValueForeign: fobForeign,
        fobValueBase: round(fobForeign * rate),
        customsAgent: body.customsAgent || null,
        dutyDrawbackEligible: Boolean(body.dutyDrawbackEligible),
        dutyDrawbackEstimatedForeign: drawbackForeign,
        dutyDrawbackEstimatedBase: round(drawbackForeign * rate),
        status: 'Draft',
        notes: body.notes || null,
        createdBy: req.user?.id || null,
      },
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'CUSTOMS_CREATED',
        entityType: 'ExportCustomsDeclaration',
        entityId: record.id,
        details: { shippingBillNo: number, orderNumber: order.orderNumber },
      },
      tx
    );
    return record;
  });
}

async function updateCustoms(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const decl = await loadWriteRecord(req, 'exportCustomsDeclaration', req.params.id);
  if (decl.status !== 'Draft') {
    throw ApiError('Only draft customs declarations can be edited', {
      status: 409,
      code: 'LOCKED_RECORD',
    });
  }
  const data = {};
  for (const f of ['exportPort', 'customsAgent', 'notes']) {
    if (body[f] !== undefined) data[f] = body[f] || null;
  }
  if (body.declarationDate !== undefined) data.declarationDate = requiredDate(body.declarationDate, 'declarationDate');
  if (body.dutyDrawbackEligible !== undefined) data.dutyDrawbackEligible = Boolean(body.dutyDrawbackEligible);
  const record = await prisma.$transaction(async (tx) => {
    if (body.fobValueForeign !== undefined) {
      const order = await tx.exportSalesOrder.findFirst({
        where: { id: decl.orderId, companyId },
      });
      const rate = toNum(order?.exchangeRate) || 1;
      const fobForeign = nonNegativeNumber(body.fobValueForeign, 'fobValueForeign');
      data.fobValueForeign = fobForeign;
      data.fobValueBase = round(fobForeign * rate);
    }
    if (body.dutyDrawbackEstimatedForeign !== undefined) {
      const order = await tx.exportSalesOrder.findFirst({
        where: { id: decl.orderId, companyId },
      });
      const rate = toNum(order?.exchangeRate) || 1;
      const value = nonNegativeNumber(
        body.dutyDrawbackEstimatedForeign,
        'dutyDrawbackEstimatedForeign'
      );
      data.dutyDrawbackEstimatedForeign = value;
      data.dutyDrawbackEstimatedBase = round(value * rate);
    }
    const updated = await tx.exportCustomsDeclaration.update({
      where: { id: decl.id },
      data,
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'CUSTOMS_UPDATED',
        entityType: 'ExportCustomsDeclaration',
        entityId: decl.id,
        details: { fields: Object.keys(data) },
      },
      tx
    );
    return updated;
  });
  return record;
}

async function updateCustomsStatus(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const decl = await loadWriteRecord(req, 'exportCustomsDeclaration', req.params.id);
  const next = canonicalStatus('customs', body.status);
  assertTransition('customs', decl.status, next);
  const record = await prisma.exportCustomsDeclaration.update({
    where: { id: decl.id },
    data: {
      status: next,
      ...(next === 'Let Export Order (LEO) Granted'
        ? { leoDate: body.leoDate ? requiredDate(body.leoDate, 'leoDate') : new Date() }
        : {}),
    },
  });
  await logExportAudit({
    companyId,
    userId: req.user?.id,
    action: 'CUSTOMS_STATUS_UPDATED',
    entityType: 'ExportCustomsDeclaration',
    entityId: decl.id,
    details: { from: decl.status, to: next },
  });
  return record;
}

// ─────────────────────────────────────────────────────────────
// Export documents
// ─────────────────────────────────────────────────────────────

async function listDocuments(req, query = {}) {
  const extraWhere = query.docType ? { docType: query.docType } : null;
  return listCollection(req, query, {
    model: 'exportDocument',
    searchFields: ['docNumber', 'customerName', 'courierTrackingNo'],
    dateField: 'issueDate',
    allowedSort: ['issueDate', 'docNumber', 'createdAt'],
    defaultSort: 'issueDate',
    extraWhere,
  });
}

async function getDocument(req) {
  return loadScopedRecord(req, 'exportDocument', req.params.id);
}

async function createDocument(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  return prisma.$transaction(async (tx) => {
    const docType = requiredString(body.docType, 'docType', { max: 120 });
    const orderId = req.params.orderId || body.orderId || null;
    let customerName = body.customerName || null;
    if (orderId) {
      const order = await tx.exportSalesOrder.findFirst({
        where: { id: orderId, companyId },
      });
      if (!order) {
        throw ApiError('Export order not found for the active company', {
          status: 404,
          code: 'ORDER_NOT_FOUND',
        });
      }
      customerName = customerName || order.customerName;
    }
    if (body.invoiceId) {
      const invoice = await tx.salesInvoice.findFirst({
        where: { id: body.invoiceId, companyId },
      });
      if (!invoice) {
        throw ApiError('Commercial invoice not found for this company', {
          status: 400,
          code: 'INVOICE_NOT_FOUND',
        });
      }
    }
    const number = await nextNumber(tx, 'exportDocument', 'docNumber', companyId, 'EDOC');
    const record = await tx.exportDocument.create({
      data: {
        companyId,
        docNumber: number,
        docType,
        orderId,
        shipmentId: body.shipmentId || null,
        invoiceId: body.invoiceId || null,
        customerName,
        issueDate: body.issueDate ? requiredDate(body.issueDate, 'issueDate') : new Date(),
        status: 'Draft',
        courierTrackingNo: body.courierTrackingNo || null,
        filePlaceholder: body.filePlaceholder || null,
        notes: body.notes || null,
        createdBy: req.user?.id || null,
      },
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'DOCUMENT_CREATED',
        entityType: 'ExportDocument',
        entityId: record.id,
        details: { docNumber: number, docType },
      },
      tx
    );
    return record;
  });
}

async function updateDocument(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const doc = await loadWriteRecord(req, 'exportDocument', req.params.id);
  if (doc.status !== 'Draft') {
    throw ApiError('Only draft documents can be edited', {
      status: 409,
      code: 'LOCKED_RECORD',
    });
  }
  const data = {};
  for (const f of ['courierTrackingNo', 'filePlaceholder', 'notes', 'customerName']) {
    if (body[f] !== undefined) data[f] = body[f] || null;
  }
  if (body.issueDate !== undefined) data.issueDate = requiredDate(body.issueDate, 'issueDate');
  const record = await prisma.exportDocument.update({ where: { id: doc.id }, data });
  await logExportAudit({
    companyId,
    userId: req.user?.id,
    action: 'DOCUMENT_UPDATED',
    entityType: 'ExportDocument',
    entityId: doc.id,
  });
  return record;
}

async function updateDocumentStatus(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const doc = await loadWriteRecord(req, 'exportDocument', req.params.id);
  const next = canonicalStatus('document', body.status);
  assertTransition('document', doc.status, next);
  const record = await prisma.exportDocument.update({
    where: { id: doc.id },
    data: {
      status: next,
      ...(body.courierTrackingNo !== undefined
        ? { courierTrackingNo: body.courierTrackingNo || null }
        : {}),
    },
  });
  await logExportAudit({
    companyId,
    userId: req.user?.id,
    action: 'DOCUMENT_STATUS_UPDATED',
    entityType: 'ExportDocument',
    entityId: doc.id,
    details: { from: doc.status, to: next },
  });
  return record;
}

// ─────────────────────────────────────────────────────────────
// Dispatches (trigger commercial invoice + inventory movement)
// ─────────────────────────────────────────────────────────────

async function listDispatches(req, query = {}) {
  const extraWhere = query.orderId ? { orderId: query.orderId } : null;
  return withOrderNumbers(
    req,
    await listCollection(req, query, {
      model: 'exportDispatch',
      searchFields: ['dispatchNumber', 'transporterName', 'truckNo', 'gatePassNo'],
      dateField: 'dispatchDate',
      allowedSort: ['dispatchDate', 'dispatchNumber', 'createdAt'],
      defaultSort: 'dispatchDate',
      extraWhere,
    })
  );
}

async function getDispatch(req) {
  return loadScopedRecord(req, 'exportDispatch', req.params.id);
}

async function createDispatch(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  return prisma.$transaction(async (tx) => {
    const orderId = req.params.orderId || body.orderId;
    const shipmentId = body.shipmentId;
    if (!shipmentId) {
      throw ApiError('shipmentId is required to dispatch a shipment', {
        status: 400,
        code: 'FIELD_REQUIRED',
        field: 'shipmentId',
      });
    }
    const order = await tx.exportSalesOrder.findFirst({
      where: { id: orderId, companyId },
      include: INCLUDE.order,
    });
    if (!order) {
      throw ApiError('Export order not found for the active company', {
        status: 404,
        code: 'ORDER_NOT_FOUND',
      });
    }
    if (['Draft', 'Cancelled', 'Completed'].includes(order.status)) {
      throw ApiError(`Cannot dispatch an order in status "${order.status}"`, {
        status: 409,
        code: 'INVALID_ORDER_STATUS',
      });
    }
    const shipment = await tx.exportShipment.findFirst({
      where: { id: shipmentId, companyId, orderId: order.id },
      include: INCLUDE.shipment,
    });
    if (!shipment) {
      throw ApiError('Shipment does not belong to this export order', {
        status: 400,
        code: 'SHIPMENT_MISMATCH',
      });
    }
    const existing = await tx.exportDispatch.findFirst({
      where: { companyId, shipmentId, status: { not: 'Cancelled' } },
    });
    if (existing) {
      throw ApiError(`Shipment already has dispatch ${existing.dispatchNumber}`, {
        status: 409,
        code: 'DISPATCH_EXISTS',
        details: { dispatchId: existing.id },
      });
    }
    if (body.locationId) {
      await assertLocationBelongsToActiveCompany(body.locationId, companyId);
    }
    const number = await nextNumber(tx, 'exportDispatch', 'dispatchNumber', companyId, 'EDISP');
    const record = await tx.exportDispatch.create({
      data: {
        companyId,
        dispatchNumber: number,
        orderId: order.id,
        shipmentId: shipment.id,
        dispatchDate: body.dispatchDate ? requiredDate(body.dispatchDate, 'dispatchDate') : new Date(),
        transporterName: body.transporterName || null,
        truckNo: body.truckNo || null,
        driverName: body.driverName || null,
        driverPhone: body.driverPhone || null,
        destinationPort: body.destinationPort || shipment.portOfDischarge || order.destinationPort || null,
        sealNo: body.sealNo || null,
        gatePassNo: body.gatePassNo || null,
        locationId: body.locationId || shipment.locationId || order.locationId || null,
        status: 'Staged at Warehouse',
        notes: body.notes || null,
        createdBy: req.user?.id || null,
      },
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'DISPATCH_CREATED',
        entityType: 'ExportDispatch',
        entityId: record.id,
        details: { dispatchNumber: number, shipmentNumber: shipment.shipmentNumber },
      },
      tx
    );
    return record;
  });
}

async function updateDispatch(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const dispatch = await loadWriteRecord(req, 'exportDispatch', req.params.id);
  if (['Handed Over to Shipping Line', 'Cancelled'].includes(dispatch.status)) {
    throw ApiError(`Dispatch is ${dispatch.status} and cannot be edited`, {
      status: 409,
      code: 'LOCKED_RECORD',
    });
  }
  const data = {};
  for (const f of ['transporterName', 'truckNo', 'driverName', 'driverPhone', 'destinationPort', 'sealNo', 'gatePassNo', 'notes']) {
    if (body[f] !== undefined) data[f] = body[f] || null;
  }
  if (body.dispatchDate !== undefined) data.dispatchDate = requiredDate(body.dispatchDate, 'dispatchDate');
  if (body.locationId !== undefined) {
    if (body.locationId) {
      await assertLocationBelongsToActiveCompany(body.locationId, companyId);
      data.locationId = body.locationId;
    } else {
      data.locationId = null;
    }
  }
  const record = await prisma.exportDispatch.update({ where: { id: dispatch.id }, data });
  await logExportAudit({
    companyId,
    userId: req.user?.id,
    action: 'DISPATCH_UPDATED',
    entityType: 'ExportDispatch',
    entityId: dispatch.id,
    details: { fields: Object.keys(data) },
  });
  return record;
}

async function updateDispatchStatus(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const dispatch = await loadWriteRecord(req, 'exportDispatch', req.params.id);
  const next = canonicalStatus('dispatch', body.status);
  assertTransition('dispatch', dispatch.status, next);

  if (next !== 'Handed Over to Shipping Line') {
    const record = await prisma.exportDispatch.update({
      where: { id: dispatch.id },
      data: { status: next },
    });
    await logExportAudit({
      companyId,
      userId: req.user?.id,
      action: 'DISPATCH_STATUS_UPDATED',
      entityType: 'ExportDispatch',
      entityId: dispatch.id,
      details: { from: dispatch.status, to: next },
    });
    return record;
  }

  const settings = await ensureSettings(companyId, req.user?.id);
  const result = await prisma.$transaction(async (tx) => {
    if (settings.requireInspectionBeforeDispatch) {
      const packing = await tx.exportPacking.findFirst({
        where: {
          companyId,
          orderId: dispatch.orderId,
          inspectionStatus: 'Passed & Certified',
        },
      });
      if (!packing) {
        throw ApiError(
          'A passed & certified packing/inspection record is required before dispatch',
          { status: 409, code: 'INSPECTION_REQUIRED' }
        );
      }
    }
    if (settings.requireCustomsBeforeDispatch) {
      const customs = await tx.exportCustomsDeclaration.findFirst({
        where: {
          companyId,
          orderId: dispatch.orderId,
          status: { in: ['Let Export Order (LEO) Granted', 'Sailed & Completed'] },
        },
      });
      if (!customs) {
        throw ApiError(
          'Customs must grant a Let Export Order (LEO) before dispatch',
          { status: 409, code: 'CUSTOMS_LEO_REQUIRED' }
        );
      }
    }
    const posting = await accounting.postCommercialInvoice(tx, {
      companyId,
      userId: req.user?.id,
      orderId: dispatch.orderId,
      shipmentId: dispatch.shipmentId,
      dispatchId: dispatch.id,
      invoiceDate: dispatch.dispatchDate,
      locationId: dispatch.locationId,
    });
    const updated = await tx.exportDispatch.update({
      where: { id: dispatch.id },
      data: { status: next, stockPostedAt: new Date() },
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'DISPATCH_HANDED_OVER',
        entityType: 'ExportDispatch',
        entityId: dispatch.id,
        details: {
          salesInvoiceId: posting.invoice?.id,
          invoiceNumber: posting.invoice?.invoiceNumber,
          idempotent: posting.idempotent,
        },
      },
      tx
    );
    return { dispatch: updated, invoice: posting.invoice, posting };
  });
  return result.dispatch;
}

// ─────────────────────────────────────────────────────────────
// Finance — letters of credit
// ─────────────────────────────────────────────────────────────

async function listFinanceLcs(req, query = {}) {
  const extraWhere = {
    ...(query.orderId ? { orderId: query.orderId } : {}),
  };
  return withOrderNumbers(
    req,
    await listCollection(req, query, {
      model: 'exportFinanceLc',
      searchFields: ['lcAdviceNumber', 'issuingBank', 'advisingBank', 'applicant'],
      dateField: 'createdAt',
      allowedSort: ['createdAt', 'lcAdviceNumber', 'expiryDate', 'lcValueBase'],
      defaultSort: 'createdAt',
      extraWhere: Object.keys(extraWhere).length ? extraWhere : null,
    })
  );
}

async function getFinanceLc(req) {
  return loadScopedRecord(req, 'exportFinanceLc', req.params.id);
}

async function createFinanceLc(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  return createEntity(req, {
    entityModel: 'exportFinanceLc',
    entityType: 'ExportFinanceLc',
    build: async (tx) => {
      const orderId = requiredString(body.orderId, 'orderId', { max: 64 });
      const order = await tx.exportSalesOrder.findFirst({
        where: { id: orderId, companyId },
      });
      if (!order) {
        throw ApiError('Export order not found for the active company', {
          status: 404,
          code: 'ORDER_NOT_FOUND',
          field: 'orderId',
        });
      }
      const currency = String(body.currency || order.currency || '').toUpperCase();
      const amount = positiveNumber(body.lcValueForeign, 'lcValueForeign');
      const fx = await resolveFx({
        companyId,
        currencyCode: currency,
        foreignAmount: amount,
        explicitRate: body.exchangeRate,
        asOfDate: body.exchangeRateDate || new Date(),
        client: tx,
      });
      const number = await nextNumber(tx, 'exportFinanceLc', 'lcAdviceNumber', companyId, 'LC');
      const record = await tx.exportFinanceLc.create({
        data: {
          companyId,
          lcAdviceNumber: number,
          orderId: order.id,
          issuingBank: requiredString(body.issuingBank, 'issuingBank', { max: 200 }),
          advisingBank: body.advisingBank ? String(body.advisingBank).trim() : null,
          applicant: requiredString(
            body.applicant || order.customerName,
            'applicant',
            { max: 200 }
          ),
          lcValueForeign: amount,
          lcValueBase: round(amount * toNum(fx.exchangeRate)),
          currency,
          exchangeRate: fx.exchangeRate,
          exchangeRateDate: fx.exchangeRateDate,
          rateSource: fx.rateSource,
          baseCurrencyCode: fx.baseCurrencyCode,
          expiryDate: body.expiryDate ? requiredDate(body.expiryDate, 'expiryDate') : null,
          latestShipmentDate: body.latestShipmentDate
            ? requiredDate(body.latestShipmentDate, 'latestShipmentDate')
            : null,
          presentationDays:
            body.presentationDays !== undefined
              ? nonNegativeNumber(body.presentationDays, 'presentationDays')
              : 21,
          discrepancyStatus: 'Pending Review',
          status: 'LC Advised',
          notes: body.notes || null,
          createdBy: req.user?.id || null,
        },
      });
      await logExportAudit(
        {
          companyId,
          userId: req.user?.id,
          action: 'LC_CREATED',
          entityType: 'ExportFinanceLc',
          entityId: record.id,
          details: { lcAdviceNumber: number, orderNumber: order.orderNumber },
        },
        tx
      );
      return record;
    },
  });
}

async function updateFinanceLc(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const lc = await loadWriteRecord(req, 'exportFinanceLc', req.params.id);
  if (['Settlement Received', 'Cancelled'].includes(lc.status)) {
    throw ApiError(`LC is ${lc.status} and can no longer be edited`, {
      status: 409,
      code: 'LOCKED_RECORD',
    });
  }
  return prisma.$transaction(async (tx) => {
    const data = {};
    for (const f of ['issuingBank', 'advisingBank', 'applicant', 'notes']) {
      if (body[f] !== undefined) {
        data[f] = f === 'issuingBank' || f === 'applicant'
          ? requiredString(body[f], f, { max: 200 })
          : body[f] ? String(body[f]).trim() : null;
      }
    }
    for (const f of ['expiryDate', 'latestShipmentDate']) {
      if (body[f] !== undefined) {
        data[f] = body[f] ? requiredDate(body[f], f) : null;
      }
    }
    if (body.presentationDays !== undefined) {
      data.presentationDays = nonNegativeNumber(body.presentationDays, 'presentationDays');
    }
    const reprice =
      body.lcValueForeign !== undefined ||
      body.currency !== undefined ||
      body.exchangeRate !== undefined;
    if (reprice) {
      const currency = String(body.currency || lc.currency).toUpperCase();
      const amount =
        body.lcValueForeign !== undefined
          ? positiveNumber(body.lcValueForeign, 'lcValueForeign')
          : toNum(lc.lcValueForeign);
      const fx = await resolveFx({
        companyId,
        currencyCode: currency,
        foreignAmount: amount,
        explicitRate: body.exchangeRate,
        asOfDate: body.exchangeRateDate || lc.exchangeRateDate || new Date(),
        client: tx,
      });
      Object.assign(data, {
        lcValueForeign: amount,
        lcValueBase: round(amount * toNum(fx.exchangeRate)),
        currency,
        exchangeRate: fx.exchangeRate,
        exchangeRateDate: fx.exchangeRateDate,
        rateSource: fx.rateSource,
        baseCurrencyCode: fx.baseCurrencyCode,
      });
    }
    const record = await tx.exportFinanceLc.update({ where: { id: lc.id }, data });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'LC_UPDATED',
        entityType: 'ExportFinanceLc',
        entityId: lc.id,
        details: { fields: Object.keys(data) },
      },
      tx
    );
    return record;
  });
}

async function updateFinanceLcStatus(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const lc = await loadWriteRecord(req, 'exportFinanceLc', req.params.id);
  const next = canonicalStatus('lc', body.status);
  assertTransition('lc', lc.status, next);
  if (next === 'Settlement Received') {
    const receipt = await prisma.exportReceipt.findFirst({
      where: { companyId, orderId: lc.orderId, status: 'Realized & Credited' },
    });
    if (!receipt) {
      throw ApiError(
        'Record the LC settlement receipt before marking the LC as settled',
        { status: 409, code: 'LC_SETTLEMENT_RECEIPT_REQUIRED' }
      );
    }
  }
  const record = await prisma.exportFinanceLc.update({
    where: { id: lc.id },
    data: {
      status: next,
      ...(body.discrepancyStatus !== undefined
        ? { discrepancyStatus: String(body.discrepancyStatus).trim() }
        : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
    },
  });
  await logExportAudit({
    companyId,
    userId: req.user?.id,
    action: 'LC_STATUS_UPDATED',
    entityType: 'ExportFinanceLc',
    entityId: lc.id,
    details: { from: lc.status, to: next },
  });
  return record;
}

// ─────────────────────────────────────────────────────────────
// Finance — receipts / advances
// ─────────────────────────────────────────────────────────────

function normalizeReceiptType(value) {
  const raw = String(value || 'Settlement').trim().toLowerCase();
  if (raw === 'advance') return 'Advance';
  if (raw === 'settlement') return 'Settlement';
  throw ApiError(
    `Invalid receiptType "${value}". Allowed: Advance, Settlement`,
    { status: 400, code: 'INVALID_RECEIPT_TYPE', field: 'receiptType' }
  );
}

async function assertBankAccount(tx, companyId, bankAccountId, field = 'bankAccountId') {
  if (!bankAccountId) return null;
  const account = await tx.bankAccount.findFirst({
    where: { id: bankAccountId, companyId },
  });
  if (!account) {
    throw ApiError('Bank account not found for the active company', {
      status: 400,
      code: 'BANK_ACCOUNT_NOT_FOUND',
      field,
    });
  }
  return account;
}

async function listReceipts(req, query = {}) {
  const extraWhere = {
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
    ...(query.receiptType ? { receiptType: String(query.receiptType).trim() } : {}),
  };
  return withOrderNumbers(
    req,
    await listCollection(req, query, {
      model: 'exportReceipt',
      searchFields: ['receiptNumber', 'customerName', 'nostroAccountRef'],
      dateField: 'receiptDate',
      allowedSort: ['receiptDate', 'receiptNumber', 'createdAt', 'grossBase'],
      defaultSort: 'receiptDate',
      extraWhere: Object.keys(extraWhere).length ? extraWhere : null,
    })
  );
}

async function getReceipt(req) {
  return loadScopedRecord(req, 'exportReceipt', req.params.id);
}

async function createReceipt(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  return createEntity(req, {
    entityModel: 'exportReceipt',
    entityType: 'ExportReceipt',
    build: async (tx) => {
      const orderId = requiredString(body.orderId, 'orderId', { max: 64 });
      const order = await tx.exportSalesOrder.findFirst({
        where: { id: orderId, companyId },
      });
      if (!order) {
        throw ApiError('Export order not found for the active company', {
          status: 404,
          code: 'ORDER_NOT_FOUND',
          field: 'orderId',
        });
      }
      const receiptType = normalizeReceiptType(body.receiptType);
      const currency = String(body.currency || order.currency || '').toUpperCase();
      if (currency !== String(order.currency || '').toUpperCase()) {
        throw ApiError(
          `Receipt currency ${currency} does not match the order currency ${order.currency}. Convert through a separate FX arrangement instead of mixing currencies.`,
          { status: 400, code: 'CURRENCY_MISMATCH', field: 'currency' }
        );
      }
      const receiptDate = body.receiptDate
        ? requiredDate(body.receiptDate, 'receiptDate')
        : new Date();
      const foreignAmount = positiveNumber(body.foreignAmount, 'foreignAmount');
      const fx = await resolveFx({
        companyId,
        currencyCode: currency,
        foreignAmount,
        explicitRate: body.exchangeRate,
        asOfDate: receiptDate,
        client: tx,
      });
      const rate = toNum(fx.exchangeRate);
      const grossBase = round(foreignAmount * rate);
      const chargesForeign = nonNegativeNumber(
        body.bankChargesForeign ?? 0,
        'bankChargesForeign'
      );
      const chargesBase =
        chargesForeign > 0
          ? round(chargesForeign * rate)
          : nonNegativeNumber(body.bankChargesBase ?? 0, 'bankChargesBase');
      if (chargesBase >= grossBase) {
        throw ApiError('Bank charges must be less than the gross receipt', {
          status: 400,
          code: 'INVALID_BANK_CHARGES',
          field: 'bankChargesForeign',
        });
      }

      let invoice = null;
      if (body.invoiceId) {
        invoice = await tx.salesInvoice.findFirst({
          where: { id: body.invoiceId, companyId, isDeleted: false },
        });
        if (!invoice) {
          throw ApiError('Commercial invoice not found for the active company', {
            status: 400,
            code: 'INVOICE_NOT_FOUND',
            field: 'invoiceId',
          });
        }
        if (String(invoice.customerId) !== String(order.customerId)) {
          throw ApiError('The invoice belongs to a different customer', {
            status: 400,
            code: 'INVOICE_CUSTOMER_MISMATCH',
            field: 'invoiceId',
          });
        }
        if (invoice.invoiceStatus === 'Cancelled') {
          throw ApiError('Cannot settle a cancelled invoice', {
            status: 409,
            code: 'INVOICE_CANCELLED',
          });
        }
        if (toNum(invoice.outstanding) <= 0.005) {
          throw ApiError('The invoice is already fully paid', {
            status: 409,
            code: 'INVOICE_PAID',
          });
        }
      }
      if (receiptType === 'Advance' && invoice) {
        throw ApiError('Advance receipts cannot be linked to a commercial invoice', {
          status: 400,
          code: 'ADVANCE_INVOICE_CONFLICT',
          field: 'invoiceId',
        });
      }
      if (receiptType === 'Settlement' && !invoice) {
        throw ApiError('Select the commercial invoice this settlement applies to', {
          status: 400,
          code: 'INVOICE_REQUIRED',
          field: 'invoiceId',
        });
      }
      let proforma = null;
      if (body.proformaId) {
        proforma = await tx.exportProformaInvoice.findFirst({
          where: { id: body.proformaId, companyId, orderId: order.id },
        });
        if (!proforma) {
          throw ApiError('Proforma invoice not found for this export order', {
            status: 400,
            code: 'PROFORMA_NOT_FOUND',
            field: 'proformaId',
          });
        }
      }
      const bankAccount = await assertBankAccount(tx, companyId, body.bankAccountId);
      const number = await nextNumber(tx, 'exportReceipt', 'receiptNumber', companyId, 'XRCP');
      const record = await tx.exportReceipt.create({
        data: {
          companyId,
          receiptNumber: number,
          orderId: order.id,
          proformaId: proforma?.id || null,
          invoiceId: invoice?.id || null,
          customerId: order.customerId,
          customerName: order.customerName,
          receiptDate,
          receiptType,
          currency,
          exchangeRate: fx.exchangeRate,
          exchangeRateDate: fx.exchangeRateDate,
          rateSource: fx.rateSource,
          baseCurrencyCode: fx.baseCurrencyCode,
          foreignAmount,
          grossBase,
          bankChargesBase: chargesBase,
          netBase: round(grossBase - chargesBase),
          fxGainLossBase: 0,
          appliedBase: 0,
          bankAccountId: bankAccount?.id || null,
          nostroAccountRef: body.nostroAccountRef || null,
          status: 'Funds In Transit',
          notes: body.notes || null,
          createdBy: req.user?.id || null,
          idempotencyKey: body.idempotencyKey
            ? String(body.idempotencyKey).slice(0, 120)
            : null,
        },
      });
      await logExportAudit(
        {
          companyId,
          userId: req.user?.id,
          action: receiptType === 'Advance' ? 'ADVANCE_RECORDED' : 'SETTLEMENT_RECORDED',
          entityType: 'ExportReceipt',
          entityId: record.id,
          details: {
            receiptNumber: number,
            orderNumber: order.orderNumber,
            invoiceNumber: invoice?.invoiceNumber || null,
            grossBase,
          },
        },
        tx
      );
      return record;
    },
  });
}

async function updateReceipt(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const receipt = await loadWriteRecord(req, 'exportReceipt', req.params.id);
  if (receipt.status !== 'Funds In Transit') {
    throw ApiError(`Receipt is ${receipt.status} and can no longer be edited`, {
      status: 409,
      code: 'LOCKED_RECORD',
    });
  }
  return prisma.$transaction(async (tx) => {
    const data = {};
    for (const f of ['nostroAccountRef', 'notes']) {
      if (body[f] !== undefined) data[f] = body[f] || null;
    }
    if (body.bankAccountId !== undefined) {
      const bank = await assertBankAccount(tx, companyId, body.bankAccountId);
      data.bankAccountId = bank?.id || null;
    }
    if (body.receiptDate !== undefined) {
      data.receiptDate = requiredDate(body.receiptDate, 'receiptDate');
    }
    if (body.bankChargesBase !== undefined || body.bankChargesForeign !== undefined) {
      const rate = toNum(receipt.exchangeRate);
      const chargesBase =
        body.bankChargesForeign !== undefined
          ? round(nonNegativeNumber(body.bankChargesForeign, 'bankChargesForeign') * rate)
          : nonNegativeNumber(body.bankChargesBase, 'bankChargesBase');
      if (chargesBase >= toNum(receipt.grossBase)) {
        throw ApiError('Bank charges must be less than the gross receipt', {
          status: 400,
          code: 'INVALID_BANK_CHARGES',
          field: 'bankChargesBase',
        });
      }
      data.bankChargesBase = chargesBase;
      data.netBase = round(toNum(receipt.grossBase) - chargesBase);
    }
    const record = await tx.exportReceipt.update({ where: { id: receipt.id }, data });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'RECEIPT_UPDATED',
        entityType: 'ExportReceipt',
        entityId: receipt.id,
        details: { fields: Object.keys(data) },
      },
      tx
    );
    return record;
  });
}

async function updateReceiptStatus(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const receipt = await loadWriteRecord(req, 'exportReceipt', req.params.id);
  const next = canonicalStatus('receipt', body.status);
  assertTransition('receipt', receipt.status, next);

  if (next === 'Cancelled') {
    if (receipt.journalEntryId) {
      throw ApiError(
        'A posted receipt cannot be cancelled — reverse it through accounting instead',
        { status: 409, code: 'POSTED_RECEIPT_LOCKED' }
      );
    }
    const record = await prisma.exportReceipt.update({
      where: { id: receipt.id },
      data: { status: 'Cancelled' },
    });
    await logExportAudit({
      companyId,
      userId: req.user?.id,
      action: 'RECEIPT_CANCELLED',
      entityType: 'ExportReceipt',
      entityId: receipt.id,
    });
    return record;
  }

  if (next === 'Realized & Credited') {
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.exportReceipt.findFirst({
        where: { id: receipt.id, companyId },
      });
      if (!fresh) {
        throw ApiError('Receipt not found for the active company', {
          status: 404,
          code: 'NOT_FOUND',
        });
      }
      if (fresh.status !== 'Funds In Transit') {
        throw ApiError(`Receipt is already ${fresh.status}`, {
          status: 409,
          code: 'INVALID_TRANSITION',
        });
      }
      if (fresh.journalEntryId) {
        throw ApiError('Receipt has already been posted', {
          status: 409,
          code: 'DUPLICATE_POSTING',
        });
      }
      const bankAccountId = body.bankAccountId || fresh.bankAccountId;
      if (!bankAccountId) {
        throw ApiError('Select the bank account that received the funds', {
          status: 400,
          code: 'BANK_ACCOUNT_REQUIRED',
          field: 'bankAccountId',
        });
      }
      await assertBankAccount(tx, companyId, bankAccountId);
      const order = await tx.exportSalesOrder.findFirst({
        where: { id: fresh.orderId, companyId },
      });
      if (!order) {
        throw ApiError('Export order not found for the active company', {
          status: 404,
          code: 'ORDER_NOT_FOUND',
        });
      }
      if (fresh.receiptType === 'Advance') {
        const proforma = fresh.proformaId
          ? await tx.exportProformaInvoice.findFirst({
              where: { id: fresh.proformaId, companyId },
            })
          : null;
        await accounting.postAdvanceAccounting(tx, {
          companyId,
          userId: req.user?.id,
          receipt: fresh,
          order,
          proforma,
          bankAccountId,
        });
      } else {
        const invoice = fresh.invoiceId
          ? await tx.salesInvoice.findFirst({
              where: { id: fresh.invoiceId, companyId, isDeleted: false },
            })
          : null;
        if (!invoice) {
          throw ApiError('The commercial invoice for this receipt no longer exists', {
            status: 400,
            code: 'INVOICE_NOT_FOUND',
          });
        }
        await accounting.postSettlementAccounting(tx, {
          companyId,
          userId: req.user?.id,
          receipt: fresh,
          order,
          invoice,
          bankAccountId,
        });
      }
      await tx.exportReceipt.update({
        where: { id: fresh.id },
        data: { bankAccountId },
      });
      await logExportAudit(
        {
          companyId,
          userId: req.user?.id,
          action: 'RECEIPT_POSTED',
          entityType: 'ExportReceipt',
          entityId: fresh.id,
          details: {
            receiptType: fresh.receiptType,
            orderNumber: order.orderNumber,
            grossBase: toNum(fresh.grossBase),
          },
        },
        tx
      );
      return tx.exportReceipt.findFirst({ where: { id: fresh.id, companyId } });
    });
    return result;
  }

  const record = await prisma.exportReceipt.update({
    where: { id: receipt.id },
    data: { status: next },
  });
  await logExportAudit({
    companyId,
    userId: req.user?.id,
    action: 'RECEIPT_STATUS_UPDATED',
    entityType: 'ExportReceipt',
    entityId: receipt.id,
    details: { from: receipt.status, to: next },
  });
  return record;
}

// ─────────────────────────────────────────────────────────────
// Export expenses (duties, freight, bank charges, fees)
// ─────────────────────────────────────────────────────────────

async function validateAccountForCompany(tx, companyId, accountId, field = 'accountId') {
  if (!accountId) return null;
  const account = await tx.chartOfAccount.findFirst({
    where: { id: accountId, companyId, isActive: true },
  });
  if (!account) {
    throw ApiError('Expense account not found for the active company', {
      status: 400,
      code: 'ACCOUNT_NOT_FOUND',
      field,
    });
  }
  return account;
}

async function listExpenses(req, query = {}) {
  const extraWhere = {
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...(query.shipmentId ? { shipmentId: query.shipmentId } : {}),
    ...(query.expenseType ? { expenseType: String(query.expenseType).trim() } : {}),
  };
  return withOrderNumbers(
    req,
    await listCollection(req, query, {
      model: 'exportExpense',
      searchFields: ['expenseNumber', 'expenseType', 'description'],
      dateField: 'date',
      allowedSort: ['date', 'expenseNumber', 'createdAt', 'amountBase'],
      defaultSort: 'date',
      extraWhere: Object.keys(extraWhere).length ? extraWhere : null,
    })
  );
}

async function getExpense(req) {
  return loadScopedRecord(req, 'exportExpense', req.params.id);
}

async function createExpense(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  return createEntity(req, {
    entityModel: 'exportExpense',
    entityType: 'ExportExpense',
    build: async (tx) => {
      let order = null;
      if (body.orderId) {
        order = await tx.exportSalesOrder.findFirst({
          where: { id: body.orderId, companyId },
        });
        if (!order) {
          throw ApiError('Export order not found for the active company', {
            status: 404,
            code: 'ORDER_NOT_FOUND',
            field: 'orderId',
          });
        }
      }
      if (body.shipmentId) {
        const shipment = await tx.exportShipment.findFirst({
          where: { id: body.shipmentId, companyId },
        });
        if (!shipment) {
          throw ApiError('Shipment not found for the active company', {
            status: 400,
            code: 'SHIPMENT_NOT_FOUND',
            field: 'shipmentId',
          });
        }
        if (order && shipment.orderId !== order.id) {
          throw ApiError('The shipment does not belong to the selected order', {
            status: 400,
            code: 'SHIPMENT_ORDER_MISMATCH',
            field: 'shipmentId',
          });
        }
      }
      const date = body.date ? requiredDate(body.date, 'date') : new Date();
      const currency = String(body.currency || order?.currency || '').toUpperCase();
      const amountForeign = positiveNumber(
        body.amountForeign ?? body.amount,
        'amountForeign'
      );
      const fx = await resolveFx({
        companyId,
        currencyCode: currency,
        foreignAmount: amountForeign,
        explicitRate: body.exchangeRate,
        asOfDate: date,
        client: tx,
      });
      const account = await validateAccountForCompany(tx, companyId, body.accountId);
      const bankAccount = await assertBankAccount(tx, companyId, body.bankAccountId);
      const number = await nextNumber(tx, 'exportExpense', 'expenseNumber', companyId, 'XEXP');
      const record = await tx.exportExpense.create({
        data: {
          companyId,
          expenseNumber: number,
          orderId: order?.id || null,
          shipmentId: body.shipmentId || null,
          expenseType: requiredString(body.expenseType, 'expenseType', { max: 120 }),
          date,
          description: body.description || null,
          currency,
          exchangeRate: fx.exchangeRate,
          exchangeRateDate: fx.exchangeRateDate,
          rateSource: fx.rateSource,
          baseCurrencyCode: fx.baseCurrencyCode,
          amountForeign,
          amountBase: round(amountForeign * toNum(fx.exchangeRate)),
          accountId: account?.id || null,
          bankAccountId: bankAccount?.id || null,
          status: 'Draft',
          notes: body.notes || null,
          createdBy: req.user?.id || null,
        },
      });
      await logExportAudit(
        {
          companyId,
          userId: req.user?.id,
          action: 'EXPENSE_CREATED',
          entityType: 'ExportExpense',
          entityId: record.id,
          details: {
            expenseNumber: number,
            expenseType: record.expenseType,
            amountBase: toNum(record.amountBase),
          },
        },
        tx
      );
      return record;
    },
  });
}

async function updateExpense(req) {
  const body = req.body || {};
  const companyId = getWriteCompany(req);
  const expense = await loadWriteRecord(req, 'exportExpense', req.params.id);
  if (expense.status !== 'Draft') {
    throw ApiError(`Expense is ${expense.status} and can no longer be edited`, {
      status: 409,
      code: 'LOCKED_RECORD',
    });
  }
  return prisma.$transaction(async (tx) => {
    const data = {};
    for (const f of ['description', 'notes']) {
      if (body[f] !== undefined) data[f] = body[f] || null;
    }
    if (body.expenseType !== undefined) {
      data.expenseType = requiredString(body.expenseType, 'expenseType', { max: 120 });
    }
    if (body.date !== undefined) data.date = requiredDate(body.date, 'date');
    if (body.orderId !== undefined && body.orderId !== expense.orderId) {
      if (!body.orderId) {
        data.orderId = null;
      } else {
        const order = await tx.exportSalesOrder.findFirst({
          where: { id: body.orderId, companyId },
        });
        if (!order) {
          throw ApiError('Export order not found for the active company', {
            status: 400,
            code: 'ORDER_NOT_FOUND',
            field: 'orderId',
          });
        }
        data.orderId = order.id;
      }
    }
    if (body.shipmentId !== undefined) {
      if (body.shipmentId) {
        const shipment = await tx.exportShipment.findFirst({
          where: { id: body.shipmentId, companyId },
        });
        if (!shipment) {
          throw ApiError('Shipment not found for the active company', {
            status: 400,
            code: 'SHIPMENT_NOT_FOUND',
            field: 'shipmentId',
          });
        }
        data.shipmentId = shipment.id;
      } else {
        data.shipmentId = null;
      }
    }
    if (body.accountId !== undefined) {
      const account = await validateAccountForCompany(tx, companyId, body.accountId);
      data.accountId = account?.id || null;
    }
    if (body.bankAccountId !== undefined) {
      const bank = await assertBankAccount(tx, companyId, body.bankAccountId);
      data.bankAccountId = bank?.id || null;
    }
    const reprice =
      body.amountForeign !== undefined ||
      body.amount !== undefined ||
      body.currency !== undefined ||
      body.exchangeRate !== undefined;
    if (reprice) {
      const currency = String(body.currency || expense.currency).toUpperCase();
      const amountForeign =
        body.amountForeign !== undefined || body.amount !== undefined
          ? positiveNumber(body.amountForeign ?? body.amount, 'amountForeign')
          : toNum(expense.amountForeign);
      const fx = await resolveFx({
        companyId,
        currencyCode: currency,
        foreignAmount: amountForeign,
        explicitRate: body.exchangeRate,
        asOfDate: body.date ? requiredDate(body.date, 'date') : expense.date,
        client: tx,
      });
      Object.assign(data, {
        currency,
        exchangeRate: fx.exchangeRate,
        exchangeRateDate: fx.exchangeRateDate,
        rateSource: fx.rateSource,
        baseCurrencyCode: fx.baseCurrencyCode,
        amountForeign,
        amountBase: round(amountForeign * toNum(fx.exchangeRate)),
      });
    }
    const record = await tx.exportExpense.update({ where: { id: expense.id }, data });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'EXPENSE_UPDATED',
        entityType: 'ExportExpense',
        entityId: expense.id,
        details: { fields: Object.keys(data) },
      },
      tx
    );
    return record;
  });
}

async function postExpense(req) {
  const companyId = getWriteCompany(req);
  const expense = await loadWriteRecord(req, 'exportExpense', req.params.id);
  if (expense.status !== 'Draft') {
    throw ApiError(`Expense is ${expense.status} and cannot be posted again`, {
      status: 409,
      code: 'INVALID_TRANSITION',
    });
  }
  const result = await prisma.$transaction(async (tx) => {
    const settings = await tx.exportSetting.findUnique({ where: { companyId } });
    const posting = await accounting.postExpense(tx, {
      companyId,
      userId: req.user?.id,
      expense,
      settings,
    });
    const updated = await tx.exportExpense.update({
      where: { id: expense.id },
      data: {
        status: 'Posted',
        journalEntryId: posting.journalEntry.id,
        accountId: posting.account.id,
        ...(expense.bankAccountId ? {} : { bankAccountId: posting.bankAccountId || null }),
      },
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'EXPENSE_POSTED',
        entityType: 'ExportExpense',
        entityId: expense.id,
        details: {
          journalEntryId: posting.journalEntry.id,
          accountCode: posting.account.code,
          amountBase: toNum(expense.amountBase),
        },
      },
      tx
    );
    return updated;
  });
  return result;
}

async function reverseExpense(req) {
  const companyId = getWriteCompany(req);
  const expense = await loadWriteRecord(req, 'exportExpense', req.params.id);
  if (expense.status !== 'Posted') {
    throw ApiError(`Only posted expenses can be reversed (current: ${expense.status})`, {
      status: 409,
      code: 'INVALID_TRANSITION',
    });
  }
  const result = await prisma.$transaction(async (tx) => {
    const je = await accounting.reverseExpense(tx, {
      companyId,
      userId: req.user?.id,
      expense,
    });
    const updated = await tx.exportExpense.update({
      where: { id: expense.id },
      data: {
        status: 'Reversed',
        notes: [expense.notes, `Reversed by journal ${je.entryNumber || je.id}`]
          .filter(Boolean)
          .join(' | '),
      },
    });
    await logExportAudit(
      {
        companyId,
        userId: req.user?.id,
        action: 'EXPENSE_REVERSED',
        entityType: 'ExportExpense',
        entityId: expense.id,
        details: { reversalJournalEntryId: je.id },
      },
      tx
    );
    return updated;
  });
  return result;
}

module.exports = {
  // settings & reference data
  getSettings,
  updateSettings,
  listPorts,
  // reporting
  getDashboardKpis,
  getReports,
  // inquiries
  listInquiries,
  getInquiry,
  createInquiry,
  updateInquiry,
  updateInquiryStatus,
  convertInquiryToQuotation,
  // quotations
  listQuotations,
  getQuotation,
  createQuotation,
  updateQuotation,
  updateQuotationStatus,
  approveQuotation,
  convertQuotationToOrder,
  // orders
  listOrders,
  getOrder,
  getOrderFull,
  createOrder,
  updateOrder,
  approveOrder,
  updateOrderStatus,
  // proformas
  listProformas,
  getProforma,
  createProforma,
  updateProforma,
  updateProformaStatus,
  // packing
  listPackings,
  getPacking,
  createPacking,
  updatePacking,
  updatePackingStatus,
  // shipments
  listShipments,
  getShipment,
  createShipment,
  updateShipment,
  updateShipmentStatus,
  // customs
  listCustoms,
  getCustoms,
  createCustoms,
  updateCustoms,
  updateCustomsStatus,
  // documents
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  updateDocumentStatus,
  // dispatch
  listDispatches,
  getDispatch,
  createDispatch,
  updateDispatch,
  updateDispatchStatus,
  // finance — LCs
  listFinanceLcs,
  getFinanceLc,
  createFinanceLc,
  updateFinanceLc,
  updateFinanceLcStatus,
  // finance — receipts
  listReceipts,
  getReceipt,
  createReceipt,
  updateReceipt,
  updateReceiptStatus,
  // expenses
  listExpenses,
  getExpense,
  createExpense,
  updateExpense,
  postExpense,
  reverseExpense,
};
