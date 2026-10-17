'use strict';

/**
 * Trading module service — classification + KPI lens over existing Sales/Purchase documents.
 * Does NOT post journals or stock; delegates to authoritative warehouse / accounting modules.
 */

const prisma = require('../prisma/client');

const DOCUMENT_TYPES = Object.freeze({
  SALES_ORDER: 'SALES_ORDER',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  SALES_INVOICE: 'SALES_INVOICE',
  PURCHASE_INVOICE: 'PURCHASE_INVOICE',
  DELIVERY: 'DELIVERY',
  GRN: 'GRN',
  SALES_PAYMENT: 'SALES_PAYMENT',
  PURCHASE_PAYMENT: 'PURCHASE_PAYMENT',
  SALES_RETURN: 'SALES_RETURN',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  QUOTATION: 'QUOTATION',
});

const TRADE_CHANNELS = new Set(['domestic', 'wholesale', 'b2b', 'back_to_back']);

const CANCELLED = new Set(['Cancelled', 'Void', 'Rejected', 'Draft']);

function toNumber(v) {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function companyFilter(companyIdOrFilter) {
  if (companyIdOrFilter == null) return undefined;
  return companyIdOrFilter;
}

function assertSameCompany(recordCompanyId, activeCompanyId) {
  if (!recordCompanyId || !activeCompanyId) {
    const err = new Error('Company context required');
    err.statusCode = 400;
    throw err;
  }
  if (typeof activeCompanyId === 'object' && activeCompanyId.in) {
    if (!activeCompanyId.in.includes(recordCompanyId)) {
      const err = new Error('Cross-company access denied');
      err.statusCode = 403;
      err.code = 'CROSS_COMPANY_DENIED';
      throw err;
    }
    return;
  }
  if (String(recordCompanyId) !== String(activeCompanyId)) {
    const err = new Error('Cross-company access denied');
    err.statusCode = 403;
    err.code = 'CROSS_COMPANY_DENIED';
    throw err;
  }
}

async function writeAudit({ companyId, action, entityType, entityId, details, userId }) {
  try {
    await prisma.tradingAuditLog.create({
      data: {
        companyId,
        action,
        entityType,
        entityId,
        details: details || undefined,
        userId: userId || undefined,
      },
    });
  } catch {
    // Audit must never block the primary transaction path
  }
}

/**
 * Resolve source document and verify company ownership.
 */
async function resolveSourceDocument(documentType, documentId, companyId) {
  let record = null;
  let snapshot = {};

  switch (documentType) {
    case DOCUMENT_TYPES.SALES_ORDER: {
      record = await prisma.order.findFirst({
        where: { id: documentId, companyId, isDeleted: false },
      });
      if (record) {
        snapshot = {
          documentNumber: record.orderNumber,
          counterpartyName: record.customerName,
          status: record.orderStatus,
          amountBase: record.grandTotal,
          documentDate: record.orderDate,
        };
      }
      break;
    }
    case DOCUMENT_TYPES.PURCHASE_ORDER: {
      record = await prisma.purchaseOrder.findFirst({
        where: { id: documentId, companyId, isDeleted: false },
      });
      if (record) {
        snapshot = {
          documentNumber: record.orderNumber,
          counterpartyName: record.supplierName,
          status: record.status,
          amountBase: record.grandTotal,
          documentDate: record.orderDate,
        };
      }
      break;
    }
    case DOCUMENT_TYPES.SALES_INVOICE: {
      record = await prisma.salesInvoice.findFirst({
        where: { id: documentId, companyId, isDeleted: false },
      });
      if (record) {
        snapshot = {
          documentNumber: record.invoiceNumber,
          counterpartyName: record.customerName,
          status: record.invoiceStatus,
          amountBase: record.grandTotal,
          documentDate: record.invoiceDate,
        };
      }
      break;
    }
    case DOCUMENT_TYPES.PURCHASE_INVOICE: {
      record = await prisma.purchaseInvoice.findFirst({
        where: { id: documentId, companyId, isDeleted: false },
      });
      if (record) {
        snapshot = {
          documentNumber: record.invoiceNumber,
          counterpartyName: record.supplierName,
          status: record.invoiceStatus,
          amountBase: record.grandTotal,
          documentDate: record.invoiceDate,
        };
      }
      break;
    }
    case DOCUMENT_TYPES.DELIVERY: {
      record = await prisma.delivery.findFirst({
        where: { id: documentId, companyId, isDeleted: false },
      });
      if (record) {
        snapshot = {
          documentNumber: record.deliveryNumber,
          counterpartyName: record.customerName,
          status: record.deliveryStatus,
          amountBase: null,
          documentDate: record.deliveryDate,
        };
      }
      break;
    }
    case DOCUMENT_TYPES.GRN: {
      record = await prisma.goodsReceiving.findFirst({
        where: { id: documentId, companyId, isDeleted: false },
      });
      if (record) {
        snapshot = {
          documentNumber: record.grnNumber,
          counterpartyName: record.supplierName,
          status: record.status,
          amountBase: record.baseAmount != null ? Number(record.baseAmount) : null,
          documentDate: record.receivingDate,
        };
      }
      break;
    }
    case DOCUMENT_TYPES.QUOTATION: {
      record = await prisma.quotation.findFirst({
        where: { id: documentId, companyId, isDeleted: false },
      });
      if (record) {
        snapshot = {
          documentNumber: record.quotationNumber,
          counterpartyName: record.customerName,
          status: record.status,
          amountBase: record.grandTotal,
          documentDate: record.quotationDate,
        };
      }
      break;
    }
    default: {
      const err = new Error(`Unsupported documentType: ${documentType}`);
      err.statusCode = 400;
      throw err;
    }
  }

  if (!record) {
    const err = new Error('Source document not found for this company');
    err.statusCode = 404;
    throw err;
  }

  assertSameCompany(record.companyId, companyId);
  return { record, snapshot };
}

/**
 * Classify / link an existing ERP document into Trading (idempotent).
 */
async function linkDocument({
  companyId,
  userId,
  documentType,
  documentId,
  tradeChannel = 'domestic',
  tradeRef,
  metadata,
}) {
  if (!Object.values(DOCUMENT_TYPES).includes(documentType)) {
    const err = new Error('Invalid documentType');
    err.statusCode = 400;
    throw err;
  }
  const channel = String(tradeChannel || 'domestic').toLowerCase();
  if (!TRADE_CHANNELS.has(channel)) {
    const err = new Error('Invalid tradeChannel');
    err.statusCode = 400;
    throw err;
  }
  if (!companyId || typeof companyId !== 'string') {
    const err = new Error('Select a specific company to classify trading documents');
    err.statusCode = 400;
    throw err;
  }

  const { snapshot } = await resolveSourceDocument(documentType, documentId, companyId);

  const linked = await prisma.tradingDocument.upsert({
    where: {
      companyId_documentType_documentId: { companyId, documentType, documentId },
    },
    create: {
      companyId,
      documentType,
      documentId,
      documentNumber: snapshot.documentNumber || null,
      tradeChannel: channel,
      tradeRef: tradeRef || null,
      counterpartyName: snapshot.counterpartyName || null,
      status: snapshot.status || null,
      amountBase: snapshot.amountBase != null ? snapshot.amountBase : null,
      currencyCode: metadata?.currencyCode || null,
      documentDate: snapshot.documentDate || null,
      metadata: metadata || undefined,
      createdBy: userId || null,
    },
    update: {
      tradeChannel: channel,
      tradeRef: tradeRef || null,
      documentNumber: snapshot.documentNumber || null,
      counterpartyName: snapshot.counterpartyName || null,
      status: snapshot.status || null,
      amountBase: snapshot.amountBase != null ? snapshot.amountBase : null,
      documentDate: snapshot.documentDate || null,
      metadata: metadata || undefined,
    },
  });

  await writeAudit({
    companyId,
    userId,
    action: 'LINK',
    entityType: 'TradingDocument',
    entityId: linked.id,
    details: { documentType, documentId, tradeChannel: channel },
  });

  return linked;
}

async function unlinkDocument({ companyId, userId, tradingDocumentId }) {
  const existing = await prisma.tradingDocument.findFirst({
    where: { id: tradingDocumentId, companyId },
  });
  if (!existing) {
    const err = new Error('Trading document link not found');
    err.statusCode = 404;
    throw err;
  }
  await prisma.tradingDocument.delete({ where: { id: existing.id } });
  await writeAudit({
    companyId,
    userId,
    action: 'UNLINK',
    entityType: 'TradingDocument',
    entityId: existing.id,
    details: { documentType: existing.documentType, documentId: existing.documentId },
  });
  return { success: true };
}

async function refreshDocumentSnapshot({ companyId, tradingDocumentId }) {
  const existing = await prisma.tradingDocument.findFirst({
    where: { id: tradingDocumentId, companyId },
  });
  if (!existing) {
    const err = new Error('Trading document link not found');
    err.statusCode = 404;
    throw err;
  }
  const { snapshot } = await resolveSourceDocument(
    existing.documentType,
    existing.documentId,
    companyId
  );
  return prisma.tradingDocument.update({
    where: { id: existing.id },
    data: {
      documentNumber: snapshot.documentNumber || null,
      counterpartyName: snapshot.counterpartyName || null,
      status: snapshot.status || null,
      amountBase: snapshot.amountBase != null ? snapshot.amountBase : null,
      documentDate: snapshot.documentDate || null,
    },
  });
}

async function listDocuments({
  companyId,
  documentType,
  tradeChannel,
  search,
  page = 1,
  pageSize = 25,
  fromDate,
  toDate,
}) {
  const where = { companyId: companyFilter(companyId) };
  if (documentType) where.documentType = documentType;
  if (tradeChannel) where.tradeChannel = tradeChannel;
  if (fromDate || toDate) {
    where.documentDate = {};
    if (fromDate) where.documentDate.gte = new Date(fromDate);
    if (toDate) where.documentDate.lte = new Date(toDate);
  }
  if (search) {
    where.OR = [
      { documentNumber: { contains: search, mode: 'insensitive' } },
      { counterpartyName: { contains: search, mode: 'insensitive' } },
      { tradeRef: { contains: search, mode: 'insensitive' } },
    ];
  }

  const take = Math.min(Math.max(Number(pageSize) || 25, 1), 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

  const [total, rows] = await Promise.all([
    prisma.tradingDocument.count({ where }),
    prisma.tradingDocument.findMany({
      where,
      orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
  ]);

  return {
    data: rows,
    pagination: {
      page: Math.max(Number(page) || 1, 1),
      pageSize: take,
      total,
      totalPages: Math.ceil(total / take) || 1,
    },
  };
}

/**
 * Dashboard KPIs from Trading-classified documents only.
 * Gross profit = recognized sales − COGS (from *-COGS journal entries when present).
 * Open PO commitments are NOT Accounts Payable.
 */
async function getDashboardKpis({ companyId, fromDate, toDate }) {
  const companyWhere = companyFilter(companyId);
  const dateFilter = {};
  if (fromDate) dateFilter.gte = new Date(fromDate);
  if (toDate) dateFilter.lte = new Date(toDate);
  const hasDate = Object.keys(dateFilter).length > 0;

  const baseWhere = { companyId: companyWhere };
  const datedWhere = hasDate ? { ...baseWhere, documentDate: dateFilter } : baseWhere;

  const [
    salesOrderLinks,
    purchaseOrderLinks,
    salesInvoiceLinks,
    deliveryCount,
    grnCount,
  ] = await Promise.all([
    prisma.tradingDocument.findMany({
      where: { ...datedWhere, documentType: DOCUMENT_TYPES.SALES_ORDER },
      select: { documentId: true, amountBase: true, status: true },
    }),
    prisma.tradingDocument.findMany({
      where: { ...datedWhere, documentType: DOCUMENT_TYPES.PURCHASE_ORDER },
      select: { documentId: true, amountBase: true, status: true },
    }),
    prisma.tradingDocument.findMany({
      where: { ...datedWhere, documentType: DOCUMENT_TYPES.SALES_INVOICE },
      select: { documentId: true, amountBase: true, status: true },
    }),
    prisma.tradingDocument.count({
      where: { ...datedWhere, documentType: DOCUMENT_TYPES.DELIVERY },
    }),
    prisma.tradingDocument.count({
      where: { ...datedWhere, documentType: DOCUMENT_TYPES.GRN },
    }),
  ]);

  const totalTradingSales = salesInvoiceLinks
    .filter((r) => !CANCELLED.has(String(r.status || '')))
    .reduce((s, r) => s + toNumber(r.amountBase), 0);

  const salesOrderValue = salesOrderLinks
    .filter((r) => !CANCELLED.has(String(r.status || '')))
    .reduce((s, r) => s + toNumber(r.amountBase), 0);

  const recognizedSales = totalTradingSales > 0 ? totalTradingSales : salesOrderValue;

  const purchaseOrderValue = purchaseOrderLinks
    .filter((r) => !CANCELLED.has(String(r.status || '')))
    .reduce((s, r) => s + toNumber(r.amountBase), 0);

  const openPoStatuses = new Set([
    'Draft',
    'Sent',
    'Confirmed',
    'Approved',
    'Partial',
    'Partially Received',
    'Open',
    'Ordered',
  ]);
  const closedPoStatuses = new Set([
    'Received',
    'Received & Invoiced',
    'Completed',
    'Closed',
    'Invoiced',
    'Cancelled',
    'Void',
  ]);
  const openPurchaseCommitments = purchaseOrderLinks
    .filter((r) => {
      const st = String(r.status || '');
      if (closedPoStatuses.has(st)) return false;
      return openPoStatuses.has(st) || !CANCELLED.has(st);
    })
    .reduce((s, r) => s + toNumber(r.amountBase), 0);

  let cogsTotal = 0;
  const invoiceIds = salesInvoiceLinks.map((r) => r.documentId);
  if (invoiceIds.length) {
    const invoices = await prisma.salesInvoice.findMany({
      where: { id: { in: invoiceIds }, companyId: companyWhere },
      select: { id: true, invoiceNumber: true, invoiceStatus: true, journalEntryId: true },
    });
    const postedNumbers = invoices
      .filter((i) => i.journalEntryId || ['Posted', 'Paid', 'Partially Paid', 'Sent'].includes(i.invoiceStatus))
      .map((i) => i.invoiceNumber)
      .filter(Boolean);
    if (postedNumbers.length) {
      const cogsRefs = postedNumbers.map((n) => `${n}-COGS`);
      const cogsEntries = await prisma.journalEntry.findMany({
        where: {
          companyId: companyWhere,
          reference: { in: cogsRefs },
        },
        include: { lines: true },
      });
      for (const je of cogsEntries) {
        for (const line of je.lines || []) {
          cogsTotal += toNumber(line.debit);
        }
      }
    }
  }

  const grossProfit = recognizedSales - cogsTotal;
  const grossMarginPct = recognizedSales > 0 ? (grossProfit / recognizedSales) * 100 : 0;

  const stocks = await prisma.productStock.findMany({
    where: {
      companyId: companyWhere,
      OR: [{ currentStock: { gt: 0 } }, { availableStock: { gt: 0 } }],
    },
    include: {
      product: { select: { costPrice: true, averageCost: true, reorderLevel: true } },
    },
    take: 5000,
  });
  let stockValue = 0;
  let lowStockCount = 0;
  for (const s of stocks) {
    const qty = toNumber(s.currentStock ?? s.availableStock);
    const unitCost = toNumber(s.product?.averageCost ?? s.product?.costPrice);
    stockValue += qty * unitCost;
    const reorder = toNumber(s.reorderLevel ?? s.product?.reorderLevel);
    if (reorder > 0 && qty <= reorder) lowStockCount += 1;
  }

  let outstandingReceivables = 0;
  if (invoiceIds.length) {
    const invs = await prisma.salesInvoice.findMany({
      where: {
        id: { in: invoiceIds },
        companyId: companyWhere,
        invoiceStatus: { notIn: ['Cancelled', 'Void', 'Draft'] },
      },
      select: { outstanding: true, grandTotal: true, paidAmount: true },
    });
    for (const inv of invs) {
      if (inv.outstanding != null) outstandingReceivables += toNumber(inv.outstanding);
      else outstandingReceivables += Math.max(0, toNumber(inv.grandTotal) - toNumber(inv.paidAmount));
    }
  }

  const openSalesOrders = salesOrderLinks.filter((r) =>
    ['Confirmed', 'Pending', 'Processing', 'Allocated', 'Packed', 'Partial', 'Partially Dispatched'].includes(
      String(r.status || '')
    )
  ).length;

  const pendingPurchaseOrders = purchaseOrderLinks.filter((r) =>
    ['Draft', 'Sent', 'Confirmed', 'Approved', 'Ordered'].includes(String(r.status || ''))
  ).length;

  return {
    totalTradingSales: recognizedSales,
    totalTradingPurchases: purchaseOrderValue,
    recognizedSalesInvoices: totalTradingSales,
    cogsTotal,
    grossTradingProfit: grossProfit,
    grossMarginPercentage: grossMarginPct,
    currentTradingStockValue: stockValue,
    openSalesOrders,
    pendingPurchaseOrders,
    openPurchaseCommitments,
    outstandingReceivables,
    lowStockItemsCount: lowStockCount,
    deliveryCount,
    grnCount,
    linkedDocumentCounts: {
      salesOrders: salesOrderLinks.length,
      purchaseOrders: purchaseOrderLinks.length,
      salesInvoices: salesInvoiceLinks.length,
    },
    notes: {
      accounting:
        'Journal posting occurs only via Sales/Purchase invoice post endpoints — Trading never posts GL twice.',
      commitments: 'openPurchaseCommitments are open PO values, not Accounts Payable ledger balances.',
      inventory: 'Stock valuation uses ProductStock (authoritative warehouse ledger).',
    },
  };
}

/**
 * Normalize + validate a price-list line for persistence.
 * Aligns with Prisma Decimal(18,4) fields — whole numbers and decimals allowed.
 */
function mapPriceListItemCreate(i) {
  if (!i?.productId) {
    const err = new Error('Each price list line requires a productId');
    err.statusCode = 400;
    throw err;
  }

  const unitPrice = toNumber(i.unitPrice);
  const listPrice =
    i.listPrice != null && i.listPrice !== '' ? toNumber(i.listPrice) : null;
  const minQty = i.minQty != null && i.minQty !== '' ? toNumber(i.minQty) : 1;
  const maxQty =
    i.maxQty != null && i.maxQty !== '' ? toNumber(i.maxQty) : null;
  const discountPercentage =
    i.discountPercentage != null && i.discountPercentage !== ''
      ? toNumber(i.discountPercentage)
      : 0;
  const markupPercentage =
    i.markupPercentage != null && i.markupPercentage !== ''
      ? toNumber(i.markupPercentage)
      : 0;

  if (!(unitPrice >= 0) || Number.isNaN(unitPrice)) {
    const err = new Error('Net / unit price must be a number ≥ 0');
    err.statusCode = 400;
    throw err;
  }
  if (listPrice != null && (!(listPrice >= 0) || Number.isNaN(listPrice))) {
    const err = new Error('List price must be a number ≥ 0');
    err.statusCode = 400;
    throw err;
  }
  if (!(minQty > 0) || Number.isNaN(minQty)) {
    const err = new Error('Min qty must be greater than 0');
    err.statusCode = 400;
    throw err;
  }
  if (maxQty != null && (Number.isNaN(maxQty) || maxQty < minQty)) {
    const err = new Error('Max qty must be ≥ min qty when provided');
    err.statusCode = 400;
    throw err;
  }
  if (discountPercentage < 0 || markupPercentage < 0) {
    const err = new Error('Discount and markup percentages cannot be negative');
    err.statusCode = 400;
    throw err;
  }

  return {
    productId: i.productId,
    unitName: i.unitName || 'Pcs',
    unitPrice,
    listPrice,
    minQty,
    maxQty,
    discountPercentage,
    markupPercentage,
    effectiveFrom: i.effectiveFrom ? new Date(i.effectiveFrom) : null,
    effectiveTo: i.effectiveTo ? new Date(i.effectiveTo) : null,
  };
}

async function assertProductsOwned(companyId, productIds) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) return;
  const owned = await prisma.product.count({ where: { id: { in: ids }, companyId } });
  if (owned !== ids.length) {
    const err = new Error('One or more products do not belong to this company');
    err.statusCode = 403;
    throw err;
  }
}

function resolveProductCost(product, costBasis = 'CostPrice') {
  if (!product) return 0;
  switch (costBasis) {
    case 'AverageCost':
      return toNumber(product.averageCost ?? product.costPrice);
    case 'LastPurchase':
      return toNumber(product.lastPurchasePrice ?? product.costPrice);
    case 'StandardCost':
      return toNumber(product.standardCost ?? product.costPrice);
    case 'CostPrice':
    default:
      return toNumber(product.costPrice);
  }
}

const PRICE_LIST_INCLUDE = {
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          costPrice: true,
          sellingPrice: true,
          wholesalePrice: true,
          stockUnitName: true,
          currencyCode: true,
        },
      },
    },
    orderBy: [{ productId: 'asc' }, { minQty: 'asc' }],
  },
};

async function listPriceLists({ companyId }) {
  return prisma.tradingPriceList.findMany({
    where: { companyId: companyFilter(companyId) },
    include: PRICE_LIST_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
}

async function getPriceList({ companyId, id }) {
  const row = await prisma.tradingPriceList.findFirst({
    where: { id, companyId: companyFilter(companyId) },
    include: PRICE_LIST_INCLUDE,
  });
  if (!row) {
    const err = new Error('Price list not found');
    err.statusCode = 404;
    throw err;
  }
  return row;
}

function validateHeaderPercentages(data) {
  const discount =
    data?.discountPercentage != null && data.discountPercentage !== ''
      ? toNumber(data.discountPercentage)
      : 0;
  const markup =
    data?.markupPercentage != null && data.markupPercentage !== ''
      ? toNumber(data.markupPercentage)
      : 0;
  if (discount < 0 || markup < 0) {
    const err = new Error('Header discount and markup percentages cannot be negative');
    err.statusCode = 400;
    throw err;
  }
  return { discountPercentage: discount, markupPercentage: markup };
}

async function createPriceList({ companyId, userId, data }) {
  if (!companyId || typeof companyId !== 'string') {
    const err = new Error('Select a specific company');
    err.statusCode = 400;
    throw err;
  }
  await assertProductsOwned(
    companyId,
    (data.items || []).map((i) => i.productId)
  );

  const headerPct = validateHeaderPercentages(data);

  const created = await prisma.tradingPriceList.create({
    data: {
      companyId,
      code: data.code,
      name: data.name,
      tier: data.tier || 'Wholesale',
      currencyCode: data.currencyCode || 'PKR',
      pricingMethod: data.pricingMethod || 'Fixed',
      costBasis: data.costBasis || 'CostPrice',
      discountPercentage: headerPct.discountPercentage,
      markupPercentage: headerPct.markupPercentage,
      effectiveFrom: new Date(data.effectiveFrom || Date.now()),
      effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
      isActive: data.isActive !== false,
      notes: data.notes || null,
      createdBy: userId || null,
      items: data.items?.length
        ? { create: data.items.map(mapPriceListItemCreate) }
        : undefined,
    },
    include: PRICE_LIST_INCLUDE,
  });

  await writeAudit({
    companyId,
    userId,
    action: 'CREATE',
    entityType: 'TradingPriceList',
    entityId: created.id,
    details: { code: created.code, itemCount: created.items?.length || 0 },
  });
  return created;
}

async function updatePriceList({ companyId, userId, id, data }) {
  if (!companyId || typeof companyId !== 'string') {
    const err = new Error('Select a specific company');
    err.statusCode = 400;
    throw err;
  }
  const existing = await prisma.tradingPriceList.findFirst({
    where: { id, companyId },
  });
  if (!existing) {
    const err = new Error('Price list not found');
    err.statusCode = 404;
    throw err;
  }

  if (Array.isArray(data.items)) {
    await assertProductsOwned(
      companyId,
      data.items.map((i) => i.productId)
    );
  }

  const headerPct =
    data.discountPercentage != null || data.markupPercentage != null
      ? validateHeaderPercentages({
          discountPercentage:
            data.discountPercentage != null
              ? data.discountPercentage
              : existing.discountPercentage,
          markupPercentage:
            data.markupPercentage != null
              ? data.markupPercentage
              : existing.markupPercentage,
        })
      : null;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.tradingPriceList.update({
      where: { id },
      data: {
        ...(data.code != null ? { code: data.code } : {}),
        ...(data.name != null ? { name: data.name } : {}),
        ...(data.tier != null ? { tier: data.tier } : {}),
        ...(data.currencyCode != null ? { currencyCode: data.currencyCode } : {}),
        ...(data.pricingMethod != null ? { pricingMethod: data.pricingMethod } : {}),
        ...(data.costBasis != null ? { costBasis: data.costBasis } : {}),
        ...(headerPct
          ? {
              discountPercentage: headerPct.discountPercentage,
              markupPercentage: headerPct.markupPercentage,
            }
          : {}),
        ...(data.effectiveFrom != null
          ? { effectiveFrom: new Date(data.effectiveFrom) }
          : {}),
        ...(data.effectiveTo !== undefined
          ? { effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null }
          : {}),
        ...(data.isActive != null ? { isActive: !!data.isActive } : {}),
        ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
      },
    });

    if (Array.isArray(data.items)) {
      await tx.tradingPriceListItem.deleteMany({ where: { priceListId: id } });
      if (data.items.length) {
        await tx.tradingPriceListItem.createMany({
          data: data.items.map((i) => ({
            priceListId: id,
            ...mapPriceListItemCreate(i),
          })),
        });
      }
    }

    return tx.tradingPriceList.findUnique({
      where: { id },
      include: PRICE_LIST_INCLUDE,
    });
  });

  await writeAudit({
    companyId,
    userId,
    action: 'UPDATE',
    entityType: 'TradingPriceList',
    entityId: id,
    details: { code: updated?.code, itemCount: updated?.items?.length || 0 },
  });
  return updated;
}

async function listCustomerPrices({ companyId }) {
  return prisma.tradingCustomerPrice.findMany({
    where: { companyId: companyFilter(companyId) },
    include: {
      customer: { select: { id: true, name: true, customerNumber: true } },
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          costPrice: true,
          averageCost: true,
          lastPurchasePrice: true,
          standardCost: true,
          sellingPrice: true,
          stockUnitName: true,
          currencyCode: true,
        },
      },
      priceList: { select: { id: true, code: true, name: true, tier: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Normalize + validate customer-pricing numeric fields.
 * Aligns with Prisma Decimal(18,4) / Decimal(8,4) — whole and fractional qty allowed.
 */
function mapCustomerPriceFields(data, { product } = {}) {
  const listPrice = toNumber(data.listPrice);
  const negotiatedPrice = toNumber(data.negotiatedPrice);
  const discountPercentage =
    data.discountPercentage != null && data.discountPercentage !== ''
      ? toNumber(data.discountPercentage)
      : listPrice > 0
        ? Math.max(0, ((listPrice - negotiatedPrice) / listPrice) * 100)
        : 0;
  const targetMarginPct =
    data.targetMarginPct != null && data.targetMarginPct !== ''
      ? toNumber(data.targetMarginPct)
      : 20;
  const minOrderQty =
    data.minOrderQty != null && data.minOrderQty !== ''
      ? toNumber(data.minOrderQty)
      : 1;

  if (!(listPrice >= 0) || Number.isNaN(listPrice)) {
    const err = new Error('List price must be a number ≥ 0');
    err.statusCode = 400;
    throw err;
  }
  if (!(negotiatedPrice >= 0) || Number.isNaN(negotiatedPrice)) {
    const err = new Error('Negotiated price must be a number ≥ 0');
    err.statusCode = 400;
    throw err;
  }
  if (!(minOrderQty > 0) || Number.isNaN(minOrderQty)) {
    const err = new Error('Min order qty must be greater than 0');
    err.statusCode = 400;
    throw err;
  }
  if (discountPercentage < 0 || targetMarginPct < 0) {
    const err = new Error('Discount and target margin percentages cannot be negative');
    err.statusCode = 400;
    throw err;
  }

  return {
    priceListId: data.priceListId || null,
    currencyCode: data.currencyCode || product?.currencyCode || 'PKR',
    unitName: data.unitName || product?.stockUnitName || 'Pcs',
    listPrice,
    negotiatedPrice,
    discountPercentage,
    targetMarginPct,
    minOrderQty,
    effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : null,
    effectiveUntil: data.effectiveUntil ? new Date(data.effectiveUntil) : null,
    status: data.status || 'Active',
    notes: data.notes || null,
  };
}

async function upsertCustomerPrice({ companyId, userId, data }) {
  if (!companyId || typeof companyId !== 'string') {
    const err = new Error('Select a specific company');
    err.statusCode = 400;
    throw err;
  }
  const [customer, product] = await Promise.all([
    prisma.customer.findFirst({ where: { id: data.customerId, companyId } }),
    prisma.product.findFirst({ where: { id: data.productId, companyId } }),
  ]);
  if (!customer || !product) {
    const err = new Error('Customer or product not found for this company');
    err.statusCode = 404;
    throw err;
  }

  if (data.priceListId) {
    const pl = await prisma.tradingPriceList.findFirst({
      where: { id: data.priceListId, companyId },
    });
    if (!pl) {
      const err = new Error('Price list not found for this company');
      err.statusCode = 404;
      throw err;
    }
  }

  const payload = mapCustomerPriceFields(data, { product });

  const row = await prisma.tradingCustomerPrice.upsert({
    where: {
      companyId_customerId_productId: {
        companyId,
        customerId: data.customerId,
        productId: data.productId,
      },
    },
    create: {
      companyId,
      customerId: data.customerId,
      productId: data.productId,
      createdBy: userId || null,
      ...payload,
    },
    update: payload,
    include: {
      customer: { select: { id: true, name: true, customerNumber: true } },
      product: { select: { id: true, name: true, sku: true, costPrice: true } },
      priceList: { select: { id: true, code: true, name: true } },
    },
  });

  await writeAudit({
    companyId,
    userId,
    action: 'UPDATE',
    entityType: 'TradingCustomerPrice',
    entityId: row.id,
    details: { customerId: data.customerId, productId: data.productId },
  });
  return row;
}

async function getMarginAnalysis({ companyId, costBasis = 'CostPrice', targetMarginPct = 20 }) {
  const hurdle = toNumber(targetMarginPct) || 20;
  const prices = await prisma.tradingCustomerPrice.findMany({
    where: { companyId: companyFilter(companyId), status: 'Active' },
    include: {
      customer: { select: { id: true, name: true, customerNumber: true } },
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          costPrice: true,
          averageCost: true,
          lastPurchasePrice: true,
          standardCost: true,
          categoryName: true,
          currencyCode: true,
        },
      },
      priceList: { select: { id: true, code: true, name: true, costBasis: true } },
    },
  });

  return prices.map((p) => {
    const basis = p.priceList?.costBasis || costBasis || 'CostPrice';
    const cost = resolveProductCost(p.product, basis);
    const sell = toNumber(p.negotiatedPrice);
    const list = toNumber(p.listPrice);
    const gp = sell - cost;
    const marginPct = sell > 0 ? (gp / sell) * 100 : 0;
    const markupPct = cost > 0 ? (gp / cost) * 100 : 0;
    const target = toNumber(p.targetMarginPct) || hurdle;
    const variancePct = marginPct - target;
    let health = 'Healthy';
    if (marginPct < target - 5 || marginPct < 15) health = 'Under Review';
    else if (marginPct < target || marginPct < 20) health = 'Watch';

    return {
      id: p.id,
      productId: p.productId,
      sku: p.product?.sku,
      name: p.product?.name,
      customerId: p.customerId,
      customerName: p.customer?.name,
      currencyCode: p.currencyCode || p.product?.currencyCode || 'PKR',
      costBasis: basis,
      avgPurchaseCost: cost,
      listPrice: list,
      avgSellingPrice: sell,
      discountPercentage: toNumber(p.discountPercentage),
      grossMargin: gp,
      grossMarginPct: marginPct,
      markupPct,
      targetMarginPct: target,
      variancePct,
      health,
      priceListCode: p.priceList?.code || null,
    };
  });
}

function startOfDayUTC(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Validate a TradingCustomerPrice row for sell-price resolution.
 * Min-order qty failures are warnings (quotation may still use the price).
 */
function evaluateCustomerPriceValidity(agreement, { quantity = 1, asOfDate = new Date() } = {}) {
  const reasons = [];
  const warnings = [];
  if (!agreement) {
    return { valid: false, reasons: ['No customer pricing record'], warnings, minOrderQty: 1 };
  }
  const status = String(agreement.status || '').trim();
  if (status !== 'Active') {
    reasons.push(
      status === 'Expired' || status === 'Draft' || status === 'Under Review'
        ? `Customer pricing is ${status}`
        : `Customer pricing is inactive (${status || 'unknown'})`
    );
  }
  const asOf = startOfDayUTC(asOfDate) || startOfDayUTC(new Date());
  if (agreement.effectiveFrom) {
    const from = startOfDayUTC(agreement.effectiveFrom);
    if (from && asOf < from) reasons.push('Customer pricing is not yet effective');
  }
  if (agreement.effectiveUntil) {
    const until = startOfDayUTC(agreement.effectiveUntil);
    if (until && asOf > until) reasons.push('Customer pricing has expired');
  }
  const minOrderQty = toNumber(agreement.minOrderQty) > 0 ? toNumber(agreement.minOrderQty) : 1;
  const qty = toNumber(quantity);
  if (qty > 0 && qty < minOrderQty) {
    warnings.push(`Quantity ${qty} is below minimum order qty ${minOrderQty}`);
  }
  return { valid: reasons.length === 0, reasons, warnings, minOrderQty };
}

function isPriceListEffective(priceList, asOfDate = new Date()) {
  if (!priceList) return false;
  if (priceList.isActive === false) return false;
  const asOf = startOfDayUTC(asOfDate) || startOfDayUTC(new Date());
  if (priceList.effectiveFrom) {
    const from = startOfDayUTC(priceList.effectiveFrom);
    if (from && asOf < from) return false;
  }
  if (priceList.effectiveTo) {
    const to = startOfDayUTC(priceList.effectiveTo);
    if (to && asOf > to) return false;
  }
  return true;
}

/**
 * Deterministic quantity-break pick: highest minQty where minQty ≤ qty ≤ maxQty (or open max).
 */
function pickPriceListItem(items, productId, quantity) {
  const qty = toNumber(quantity) > 0 ? toNumber(quantity) : 1;
  const candidates = (items || [])
    .filter((i) => i && i.productId === productId)
    .filter((i) => {
      const minQ = toNumber(i.minQty) > 0 ? toNumber(i.minQty) : 1;
      if (minQ > qty) return false;
      if (i.maxQty != null && i.maxQty !== '' && toNumber(i.maxQty) < qty) return false;
      if (i.effectiveFrom || i.effectiveTo) {
        const asOf = startOfDayUTC(new Date());
        if (i.effectiveFrom && asOf < startOfDayUTC(i.effectiveFrom)) return false;
        if (i.effectiveTo && asOf > startOfDayUTC(i.effectiveTo)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const diff = toNumber(b.minQty) - toNumber(a.minQty);
      if (diff !== 0) return diff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  return candidates[0] || null;
}

/**
 * Pricing priority (international ERP):
 * 1) Valid customer-specific negotiated price
 * 2) Applicable linked customer price-list item
 * 3) Standard product selling price
 *
 * Never returns standard selling when a valid negotiated price exists.
 */
async function resolveSellPrice({
  companyId,
  customerId,
  productId,
  quantity = 1,
  asOfDate = new Date(),
} = {}) {
  if (!companyId || typeof companyId !== 'string') {
    const err = new Error('Company context required');
    err.statusCode = 400;
    throw err;
  }
  if (!productId) {
    const err = new Error('productId is required');
    err.statusCode = 400;
    throw err;
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, companyId, isActive: true },
  });
  if (!product) {
    const err = new Error('Product not found for this company');
    err.statusCode = 404;
    throw err;
  }

  const standardSellingPrice = toNumber(product.sellingPrice);
  const messages = [];
  const warnings = [];
  const base = {
    companyId,
    customerId: customerId || null,
    productId: product.id,
    sku: product.sku,
    productName: product.name,
    currencyCode: product.currencyCode || 'PKR',
    unitName: product.stockUnitName || 'Pcs',
    taxRate: toNumber(product.taxRate),
    listPrice: standardSellingPrice,
    standardSellingPrice,
    quantity: toNumber(quantity) > 0 ? toNumber(quantity) : 1,
  };

  if (customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, companyId, isActive: true, isDeleted: false },
    });
    if (!customer) {
      const err = new Error('Customer not found for this company');
      err.statusCode = 404;
      throw err;
    }

    const agreement = await prisma.tradingCustomerPrice.findUnique({
      where: {
        companyId_customerId_productId: { companyId, customerId, productId },
      },
      include: {
        priceList: {
          include: {
            items: { where: { productId } },
          },
        },
      },
    });

    if (agreement) {
      const validity = evaluateCustomerPriceValidity(agreement, { quantity, asOfDate });
      warnings.push(...validity.warnings);

      if (validity.valid) {
        return {
          ...base,
          unitPrice: toNumber(agreement.negotiatedPrice),
          listPrice: toNumber(agreement.listPrice),
          discountPercentage: toNumber(agreement.discountPercentage),
          currencyCode: agreement.currencyCode || base.currencyCode,
          unitName: agreement.unitName || base.unitName,
          source: 'CUSTOMER_NEGOTIATED',
          sourceLabel: 'Customer negotiated price',
          sourceId: agreement.id,
          priceListId: agreement.priceListId || null,
          minOrderQty: validity.minOrderQty,
          messages: [],
          warnings,
        };
      }

      messages.push(...validity.reasons);

      const pl = agreement.priceList;
      if (pl && isPriceListEffective(pl, asOfDate)) {
        const item = pickPriceListItem(pl.items, productId, quantity);
        if (item) {
          messages.push(
            'Using linked price list after customer negotiated price was not applicable'
          );
          return {
            ...base,
            unitPrice: toNumber(item.unitPrice),
            listPrice: toNumber(
              item.listPrice != null ? item.listPrice : item.unitPrice
            ),
            discountPercentage: toNumber(item.discountPercentage),
            currencyCode: pl.currencyCode || base.currencyCode,
            unitName: item.unitName || base.unitName,
            source: 'PRICE_LIST',
            sourceLabel: `Price list ${pl.code || pl.name}`,
            sourceId: pl.id,
            priceListId: pl.id,
            minOrderQty: toNumber(item.minQty) > 0 ? toNumber(item.minQty) : 1,
            messages,
            warnings,
          };
        }
        messages.push('Linked price list has no matching quantity break for this product');
      } else if (agreement.priceListId) {
        messages.push('Linked price list is inactive or outside its effective dates');
      }

      messages.push('Falling back to standard product selling price');
    } else {
      messages.push('No customer-specific pricing found; using standard selling price');
    }
  }

  return {
    ...base,
    unitPrice: standardSellingPrice,
    discountPercentage: 0,
    source: 'STANDARD_SELLING',
    sourceLabel: 'Standard selling price',
    sourceId: null,
    priceListId: null,
    minOrderQty: 1,
    messages,
    warnings,
  };
}

/**
 * Apply authoritative resolved price to a quotation line.
 * Manual overrides are accepted only when the client explicitly opts in.
 */
function applyResolvedPriceToLine(resolved, item = {}) {
  const manual =
    item.manualPriceOverride === true ||
    String(item.priceSource || '').toUpperCase() === 'MANUAL';
  const clientPrice =
    item.unitPrice != null && item.unitPrice !== '' ? toNumber(item.unitPrice) : null;

  let unitPrice = toNumber(resolved.unitPrice);
  let pricingSource = resolved.source;
  if (manual && clientPrice != null && clientPrice >= 0 && !Number.isNaN(clientPrice)) {
    unitPrice = clientPrice;
    pricingSource = 'MANUAL';
  }

  const discount =
    item.discount != null && item.discount !== '' ? toNumber(item.discount) : 0;
  const taxRate =
    item.taxRate != null && item.taxRate !== ''
      ? toNumber(item.taxRate)
      : toNumber(resolved.taxRate);

  return {
    unitPrice,
    discount: discount >= 0 ? discount : 0,
    taxRate: taxRate >= 0 ? taxRate : 0,
    pricingSource,
    currencyCode: resolved.currencyCode,
    unitName: resolved.unitName,
    listPrice: resolved.listPrice,
    pricingMessages: resolved.messages || [],
    pricingWarnings: resolved.warnings || [],
  };
}

/** Pure helpers exported for unit tests */
function computeGrossProfit(recognizedSales, cogsTotal) {
  const sales = toNumber(recognizedSales);
  const cogs = toNumber(cogsTotal);
  return { grossProfit: sales - cogs, marginPct: sales > 0 ? ((sales - cogs) / sales) * 100 : 0 };
}

function isOpenPurchaseCommitment(status) {
  const st = String(status || '');
  const closed = new Set([
    'Received',
    'Received & Invoiced',
    'Completed',
    'Closed',
    'Invoiced',
    'Cancelled',
    'Void',
  ]);
  if (closed.has(st)) return false;
  return true;
}

module.exports = {
  DOCUMENT_TYPES,
  TRADE_CHANNELS,
  linkDocument,
  unlinkDocument,
  refreshDocumentSnapshot,
  listDocuments,
  getDashboardKpis,
  listPriceLists,
  getPriceList,
  createPriceList,
  updatePriceList,
  listCustomerPrices,
  upsertCustomerPrice,
  mapCustomerPriceFields,
  getMarginAnalysis,
  resolveProductCost,
  mapPriceListItemCreate,
  resolveSellPrice,
  applyResolvedPriceToLine,
  evaluateCustomerPriceValidity,
  pickPriceListItem,
  isPriceListEffective,
  resolveSourceDocument,
  assertSameCompany,
  computeGrossProfit,
  isOpenPurchaseCommitment,
  toNumber,
};
