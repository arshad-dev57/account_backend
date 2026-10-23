'use strict';



const prisma = require('../prisma/client');
const BalanceCalculator = require('../utils/balanceCalculator');
const { resolveLocationId, adjustLocationStock } = require('../warehouse/services/locationService');
const { fiscalYearGuard } = require('../middleware/fiscalYearMiddleware');
const { resolveFiscalYearId } = require('../utils/fiscalYearHelper');
const {
  requireSingleCompany,
  assertRecordCompanyAccess,
  assertLocationBelongsToActiveCompany,
} = require('../utils/companyAccess');
const { resolveImportExchangeRate, assertImportRateDate } = require('../utils/importFx');
const importEnterprise = require('./importEnterpriseService');
const { hasPermission, isAdminRole, isPlatformAdmin } = require('./permissionService');
const { sendToUser, sendToUsers } = require('./notificationService');
const importGrnService = require('./importGrnService');

const RFQ_APPROVE_PERMISSION = 'import.rfqs.approve';
const CUSTOMS_APPROVE_PERMISSION = 'import.customs.approve';

function toNumber(val, fallback = 0) {
  if (val == null) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

/** Pure helper — used by tests and allocation. */
function allocateLandedByValue(items, totalExpenses) {
  const list = (items || []).map((it) => ({
    ...it,
    qty: toNumber(it.qty ?? it.quantity, 0),
    unitFobUsd: toNumber(it.unitFobUsd ?? it.unitPrice, 0),
  }));
  const basisTotal = list.reduce((s, it) => s + it.qty * it.unitFobUsd, 0);
  const expense = toNumber(totalExpenses, 0);
  return list.map((it) => {
    const lineValue = it.qty * it.unitFobUsd;
    const share = basisTotal > 0 ? lineValue / basisTotal : 0;
    const allocatedExpensePerUnitUsd =
      it.qty > 0 ? Math.round(((expense * share) / it.qty) * 10000) / 10000 : 0;
    const finalLandedCostPerUnitUsd =
      Math.round((it.unitFobUsd + allocatedExpensePerUnitUsd) * 10000) / 10000;
    const originalCostVariancePct =
      it.unitFobUsd > 0
        ? Math.round(((finalLandedCostPerUnitUsd - it.unitFobUsd) / it.unitFobUsd) * 1000) / 10
        : 0;
    return {
      productId: it.productId || null,
      productName: it.productName || 'Import Product',
      qty: it.qty,
      unitFobUsd: it.unitFobUsd,
      allocatedExpensePerUnitUsd,
      finalLandedCostPerUnitUsd,
      originalCostVariancePct,
    };
  });
}

const IMPORT_GRN_POSTED_STATUSES = importGrnService.IMPORT_GRN_POSTED_STATUSES;
const validateReceiveQty = importGrnService.validateReceiveQty;
const sumPostedAcceptedForPo = importGrnService.sumPostedAcceptedForPo;
const serializePoItemForReceiving = importGrnService.serializePoItemForReceiving;

const IMPORT_PO_STATUS_TRANSITIONS = {
  Draft: ['Ordered', 'Cancelled'],
  Ordered: ['Confirmed', 'In Transit', 'Cancelled'],
  Confirmed: ['In Transit', 'Cancelled'],
  'In Transit': ['Arrived', 'Customs Hold', 'Cancelled'],
  Arrived: ['Customs Clearance', 'Received', 'Partially Received'],
  'Customs Hold': ['Arrived', 'Customs Clearance', 'Cancelled'],
  'Customs Clearance': ['Received', 'Partially Received'],
  'Partially Received': ['Received', 'Costed'],
  Received: ['Costed', 'Completed'],
  Costed: ['Completed'],
  Completed: [],
  Cancelled: [],
};

/** Canonical Import RFQ lifecycle (legacy aliases normalized via normalizeRfqStatus). */
const IMPORT_RFQ_STATUS_TRANSITIONS = {
  Draft: ['Sent', 'Cancelled'],
  Sent: ['Quotes Received', 'Cancelled', 'Expired'],
  'Quotes Received': ['Under Comparison', 'Cancelled', 'Expired'],
  'Under Comparison': ['Awarded', 'Cancelled', 'Expired'],
  // Approve goes through submit-for-approval → Pending Approval → approve action
  Awarded: ['Pending Approval', 'Cancelled'],
  'Pending Approval': ['Approved', 'Awarded', 'Cancelled'],
  // Awarded via reopenRfq only (not a free-form status jump from the client)
  Approved: ['Converted to PO', 'Cancelled', 'Awarded'],
  'Converted to PO': [],
  Cancelled: [],
  Expired: [],
};

/** RFQ statuses where quotations may still be added / revised */
const QUOTATION_OPEN_STATUSES = ['Sent', 'Quotes Received', 'Under Comparison'];
const QUOTATION_INACTIVE_STATUSES = ['Superseded', 'Expired'];

const INCOTERMS_2020 = [
  'EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP',
];
const SEA_ONLY_INCOTERMS = ['FOB', 'CFR', 'CIF', 'FAS'];

function normalizeRfqStatus(status) {
  const s = String(status || '').trim();
  const aliases = {
    'Sent to Supplier': 'Sent',
    'Quotation Received': 'Quotes Received',
    'Quotations Received': 'Quotes Received',
    'Quotation Selected': 'Awarded',
    'PO Created': 'Converted to PO',
  };
  return aliases[s] || s;
}

function assertPoStatusTransition(from, to) {
  if (from === to) return;
  const allowed = IMPORT_PO_STATUS_TRANSITIONS[from];
  if (!allowed) return; // unknown prior status — allow for legacy rows
  if (!allowed.includes(to)) {
    const err = new Error(`Invalid Import PO status transition: ${from} → ${to}`);
    err.status = 400;
    err.code = 'INVALID_STATUS_TRANSITION';
    throw err;
  }
}

function assertRfqStatusTransition(fromRaw, toRaw) {
  const from = normalizeRfqStatus(fromRaw);
  const to = normalizeRfqStatus(toRaw);
  if (from === to) return { from, to };
  const allowed = IMPORT_RFQ_STATUS_TRANSITIONS[from];
  if (!allowed) {
    const err = new Error(`Unknown RFQ status "${fromRaw}". Use the Import RFQ lifecycle statuses.`);
    err.status = 400;
    err.code = 'INVALID_STATUS';
    throw err;
  }
  if (!allowed.includes(to)) {
    const err = new Error(
      `Invalid RFQ status transition: ${from} → ${to}. Allowed from ${from}: ${allowed.join(', ') || '(none)'}`
    );
    err.status = 400;
    err.code = 'INVALID_STATUS_TRANSITION';
    throw err;
  }
  return { from, to };
}

function isValidHsCode(code) {
  if (code == null || String(code).trim() === '') return true;
  const raw = String(code).trim();
  if (!/^[\d.]+$/.test(raw)) return false;
  const digits = raw.replace(/\./g, '');
  return digits.length >= 6 && digits.length <= 10;
}

function normalizeHsCode(code) {
  if (code == null || String(code).trim() === '') return null;
  const raw = String(code).trim();
  if (!isValidHsCode(raw)) {
    const err = new Error(
      `Invalid HS code "${raw}". Use 6–10 digits with optional dots (e.g. 1006.30 or 100630).`
    );
    err.status = 400;
    err.code = 'INVALID_HS_CODE';
    throw err;
  }
  return raw;
}

const RFQ_HS_REFRESH_STATUSES = [
  'Draft',
  'Sent',
  'Quotes Received',
  'Under Comparison',
  'Awarded',
  'Pending Approval',
  'Approved',
];

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function warnSeaIncotermWithAirPort(incoterm, port) {
  const term = String(incoterm || '').toUpperCase();
  const p = String(port || '').toLowerCase();
  if (!SEA_ONLY_INCOTERMS.includes(term)) return null;
  if (/\b(air|airport|aiport|a\.?i\.?r)\b/.test(p) || /\b(DXB|LHR|JFK|SHA|PVG|HKG)\b/i.test(port || '')) {
    return `Incoterm ${term} is typically sea-freight only; port/airport "${port}" looks air-related.`;
  }
  return null;
}

function normalizeCountryKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function countriesLikelySame(a, b) {
  const x = normalizeCountryKey(a);
  const y = normalizeCountryKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const aliases = {
    uae: 'united arab emirates',
    'u a e': 'united arab emirates',
    emirates: 'united arab emirates',
    usa: 'united states',
    'united states of america': 'united states',
    uk: 'united kingdom',
    'great britain': 'united kingdom',
  };
  const nx = aliases[x] || x;
  const ny = aliases[y] || y;
  return nx === ny || nx.includes(ny) || ny.includes(nx);
}

async function resolveImportPort({ portId, portOfDischarge, unLocode }) {
  if (portId) {
    const byId = await prisma.importPort.findFirst({
      where: { id: portId, isActive: true },
    });
    if (byId) return byId;
  }
  const code = String(unLocode || '').trim().toUpperCase();
  if (code) {
    const byCode = await prisma.importPort.findFirst({
      where: { unLocode: code, isActive: true },
    });
    if (byCode) return byCode;
  }
  const raw = String(portOfDischarge || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const ports = await prisma.importPort.findMany({ where: { isActive: true } });
  for (const p of ports) {
    if (p.name.toLowerCase() === lower || p.unLocode.toLowerCase() === lower) return p;
    const aliases = Array.isArray(p.aliases) ? p.aliases : [];
    if (aliases.some((a) => String(a).toLowerCase() === lower)) return p;
  }
  return null;
}

async function listPorts(req, query = {}) {
  const { search, country, portType, activeOnly = 'true' } = query;
  const where = {
    ...(activeOnly === 'false' ? {} : { isActive: true }),
    ...(country ? { country: { equals: country, mode: 'insensitive' } } : {}),
    ...(portType && portType !== 'All' ? { portType } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { unLocode: { contains: search, mode: 'insensitive' } },
            { country: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  return prisma.importPort.findMany({
    where,
    orderBy: [{ country: 'asc' }, { name: 'asc' }],
  });
}

function isActiveQuotation(q) {
  if (!q) return false;
  return !QUOTATION_INACTIVE_STATUSES.includes(String(q.status || ''));
}

function supplierKeyForQuote(q) {
  if (q.supplierId) return `id:${q.supplierId}`;
  return `name:${normalizeCountryKey(q.supplierName)}`;
}

function activeQuotations(list = []) {
  return (list || []).filter(isActiveQuotation);
}

function countDistinctActiveSuppliers(list = []) {
  const keys = new Set();
  for (const q of activeQuotations(list)) {
    keys.add(supplierKeyForQuote(q));
  }
  return keys.size;
}

function formatImportUser(u) {
  if (!u) return null;
  const rawName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  // Prefer email when the stored name is an internal/auto signup label (e.g. "customer 461")
  const looksInternal =
    !rawName ||
    /^customer\s*\d+$/i.test(rawName) ||
    /^user\s*\d+$/i.test(rawName) ||
    /^test\s*\d+$/i.test(rawName);
  const displayName = looksInternal ? u.email || rawName || null : rawName;
  return {
    id: u.id,
    name: displayName,
    email: u.email || null,
    firstName: u.firstName,
    lastName: u.lastName,
  };
}

/** Internal audit reason codes → human labels. Unknown codes are hidden. */
const AUDIT_REASON_LABELS = {
  pre_award: 'Before award',
  post_award: 'After award',
  reopen: 'RFQ reopened',
  change_award: 'Award changed',
  quotation_revision: 'Quotation revision',
  quotation_received: 'Quotation received',
  legacy_duplicate_cleanup: 'Legacy duplicate cleanup',
  'legacy duplicate cleanup': 'Legacy duplicate cleanup',
  'HS code back-filled from product master': 'HS code back-filled from product master',
  'legacy HS code back-fill': 'Legacy HS code back-fill',
  hs_code_refresh: 'HS code refreshed from product',
};

function formatAuditReasonLabel(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const key = text.toLowerCase();
  if (AUDIT_REASON_LABELS[key]) return AUDIT_REASON_LABELS[key];
  // Unknown snake_case / kebab internal codes → hide (never show raw)
  if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(key)) return null;
  if (['reopen', 'pre_award', 'post_award', 'change_award'].includes(key)) return null;
  // Free-text user reasons (change award / reopen) — show as entered
  return text;
}

function computeRfqTotals(rfq) {
  const items = rfq.items || [];
  const targetTotal = items.reduce(
    (s, it) => s + toNumber(it.quantity) * toNumber(it.targetPriceUsd),
    0
  );
  const awarded = (rfq.quotations || []).find((q) => q.id === rfq.selectedQuotationId);
  let awardedTotal = null;
  if (awarded) {
    awardedTotal = toNumber(awarded.totalForeign);
  } else if (items.some((it) => it.quotedPriceUsd != null)) {
    awardedTotal = items.reduce(
      (s, it) =>
        s +
        toNumber(it.quantity) *
          toNumber(it.quotedPriceUsd != null ? it.quotedPriceUsd : 0),
      0
    );
  }
  return {
    targetTotal: Math.round(targetTotal * 100) / 100,
    awardedTotal: awardedTotal == null ? null : Math.round(awardedTotal * 100) / 100,
  };
}

function serializeRfq(rfq) {
  if (!rfq) return rfq;
  const totals = computeRfqTotals(rfq);
  const destinationCountry = rfq.port?.country || null;
  const dispatchCountry = rfq.countryOfDispatch || rfq.supplierCountry || null;
  const localPurchaseWarning =
    dispatchCountry &&
    destinationCountry &&
    countriesLikelySame(dispatchCountry, destinationCountry)
      ? 'Supplier is in the destination country. This may be a local purchase, not an import.'
      : null;
  const quotes = rfq.quotations || [];
  const activeQuotes = activeQuotations(quotes);
  const distinctActiveSupplierCount = countDistinctActiveSuppliers(quotes);
  const hasJustification =
    rfq.singleSourceJustification != null && String(rfq.singleSourceJustification).trim() !== '';
  // Justification kept for history when RFQ later has 2+ active suppliers
  const singleSourceJustificationHistorical = hasJustification && distinctActiveSupplierCount >= 2;
  return {
    ...rfq,
    status: normalizeRfqStatus(rfq.status),
    issueDate: rfq.date || rfq.createdAt,
    createdAt: rfq.createdAt,
    targetTotal: totals.targetTotal,
    awardedTotal: totals.awardedTotal,
    countryOfDispatch: dispatchCountry,
    destinationCountry,
    localPurchaseWarning,
    port: rfq.port || null,
    activeQuotationCount: activeQuotes.length,
    distinctActiveSupplierCount,
    singleSourceJustificationHistorical,
    quotationsLocked: !QUOTATION_OPEN_STATUSES.includes(normalizeRfqStatus(rfq.status)),
  };
}

function getCompanyScope(req) {
  if (req.companyMode === 'all') {
    const ids = Array.isArray(req.accessibleCompanyIds) ? req.accessibleCompanyIds.filter(Boolean) : [];
    return { in: ids.length ? ids : ['00000000-0000-0000-0000-000000000000'] };
  }
  return req.user.companyId;
}
async function logImportAudit({ companyId, action, entityType, entityId, details, userId }) {
  try {
    await prisma.importAuditLog.create({
      data: {
        companyId,
        action,
        entityType,
        entityId,
        details: details || undefined,
        userId: userId || undefined,
      },
    });
  } catch (err) {
    console.warn('[ImportAudit] Audit log error:', err.message);
  }
}
async function getDashboardKpis(req) {
  const companyScope = getCompanyScope(req);

  const [
    totalOrders,
    ordersList,
    shipmentsList,
    customsList,
    grnsList,
    landedCostsList,
    billsList,
    pendingDocs,
  ] = await Promise.all([
    prisma.importPurchaseOrder.count({ where: { companyId: companyScope } }),
    prisma.importPurchaseOrder.findMany({
      where: { companyId: companyScope },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { items: true },
    }),
    prisma.importShipment.findMany({
      where: { companyId: companyScope },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.importCustomsClearance.findMany({
      where: { companyId: companyScope },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.importGrn.findMany({
      where: { companyId: companyScope },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.importLandedCost.findMany({
      where: { companyId: companyScope },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.importSupplierBill.findMany({
      where: { companyId: companyScope },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.importDocument.findMany({
      where: { companyId: companyScope, status: 'Pending Review' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  let totalImportValueUsd = 0;
  let inTransitCount = 0;
  let inTransitValueUsd = 0;
  let customsPendingCount = 0;
  let customsDutyPayableUsd = 0;
  let receivedCount = 0;

  for (const po of ordersList) {
    const val = toNumber(po.totalUsd);
    totalImportValueUsd += val;
    if (po.status === 'In Transit' || po.status === 'Ordered') {
      inTransitCount++;
      inTransitValueUsd += val;
    }
    if (po.status === 'Received' || po.status === 'Completed') {
      receivedCount++;
    }
  }

  for (const c of customsList) {
    if (c.clearanceStatus !== 'Cleared' && c.clearanceStatus !== 'Out of Charge') {
      customsPendingCount++;
      customsDutyPayableUsd += toNumber(c.totalCustomsPayableUsd);
    }
  }

  let totalLandedCostAllocatedUsd = 0;
  for (const lc of landedCostsList) {
    totalLandedCostAllocatedUsd += toNumber(lc.totalLandedExpensesUsd);
  }

  let supplierLiabilitiesUsd = 0;
  for (const b of billsList) {
    supplierLiabilitiesUsd += toNumber(b.balanceUsd);
  }

  const avgLandedCostPct = totalImportValueUsd > 0
    ? (totalLandedCostAllocatedUsd / totalImportValueUsd) * 100
    : 16.5;

  return {
    totalImportOrders: totalOrders,
    totalImportValueUsd: Math.round(totalImportValueUsd * 100) / 100,
    activeShipmentsInTransit: inTransitCount,
    inTransitValueUsd: Math.round(inTransitValueUsd * 100) / 100,
    customsPendingClearance: customsPendingCount,
    customsDutyPayableUsd: Math.round(customsDutyPayableUsd * 100) / 100,
    completedReceivedOrders: receivedCount,
    totalLandedCostAllocatedUsd: Math.round(totalLandedCostAllocatedUsd * 100) / 100,
    averageLandedCostExpensePct: Math.round(avgLandedCostPct * 10) / 10,
    supplierLiabilitiesUsd: Math.round(supplierLiabilitiesUsd * 100) / 100,
    recentOrders: ordersList.slice(0, 5),
    liveShipments: shipmentsList.slice(0, 5),
    pendingDocs: pendingDocs,
  };
}

async function listRfqs(req, query = {}) {
  const companyScope = getCompanyScope(req);
  const { search, status, page = 1, limit = 20 } = query;
  const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

  const statusFilter = status && status !== 'All' ? normalizeRfqStatus(status) : null;
  const legacyStatusVariants = statusFilter
    ? [
        statusFilter,
        ...(statusFilter === 'Sent' ? ['Sent to Supplier'] : []),
        ...(statusFilter === 'Quotes Received' ? ['Quotation Received', 'Quotations Received'] : []),
        ...(statusFilter === 'Awarded' ? ['Quotation Selected'] : []),
        ...(statusFilter === 'Converted to PO' ? ['PO Created'] : []),
      ]
    : null;

  const where = {
    companyId: companyScope,
    ...(legacyStatusVariants ? { status: { in: legacyStatusVariants } } : {}),
    ...(search
      ? {
        OR: [
          { rfqNumber: { contains: search, mode: 'insensitive' } },
          { supplierName: { contains: search, mode: 'insensitive' } },
          { supplierCountry: { contains: search, mode: 'insensitive' } },
        ],
      }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.importRfq.count({ where }),
    prisma.importRfq.findMany({
      where,
      include: {
        items: true,
        supplier: true,
        port: true,
        quotations: { include: { items: true }, orderBy: { createdAt: 'desc' } },
        purchaseOrders: { select: { id: true, poNumber: true, status: true } },
      },
      orderBy: { date: 'desc' },
      skip,
      take: Number(limit),
    }),
  ]);

  return {
    items: items.map((r) => serializeRfq(r)),
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)) || 1,
    },
  };
}

async function getRfqById(req, id) {
  const rfq = await prisma.importRfq.findUnique({
    where: { id },
    include: {
      items: true,
      supplier: true,
      port: true,
      quotations: { include: { items: true, supplier: true }, orderBy: { totalForeign: 'asc' } },
      purchaseOrders: { select: { id: true, poNumber: true, status: true, createdAt: true } },
    },
  });
  if (!rfq) {
    const err = new Error('Import RFQ not found');
    err.status = 404;
    throw err;
  }
  await assertRecordCompanyAccess(req, rfq.companyId);

  // Enrich award/approve user display names when possible
  const userIds = [rfq.awardedBy, rfq.approvedBy, rfq.createdBy].filter(Boolean);
  let usersById = {};
  if (userIds.length) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    usersById = Object.fromEntries(users.map((u) => [u.id, formatImportUser(u)]));
  }

  const productIds = [...new Set((rfq.items || []).map((it) => it.productId).filter(Boolean))];
  let productHsById = {};
  if (productIds.length) {
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, companyId: rfq.companyId },
      select: { id: true, hsCode: true },
    });
    productHsById = Object.fromEntries(
      products.map((p) => [p.id, p.hsCode ? String(p.hsCode).trim() : ''])
    );
  }
  rfq.items = (rfq.items || []).map((it) => ({
    ...it,
    productHsCode: it.productId ? productHsById[it.productId] || '' : '',
  }));

  const statusLogs = await prisma.importAuditLog.findMany({
    where: {
      companyId: rfq.companyId,
      entityType: 'IMPORT_RFQ',
      entityId: id,
      action: { in: ['STATUS_CHANGE', 'CHANGE_AWARD', 'REOPEN', 'UPDATE'] },
    },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
  });
  const statusHistory = statusLogs
    .filter((log) => {
      const d = log.details && typeof log.details === 'object' ? log.details : {};
      // Keep status transitions + HS / award related updates in the trail
      if (log.action !== 'UPDATE') return true;
      const reason = String(d.reason || '');
      return (
        reason.includes('HS code') ||
        reason.includes('legacy HS') ||
        reason === 'hs_code_refresh'
      );
    })
    .map((log) => {
      const d = log.details && typeof log.details === 'object' ? log.details : {};
      const u = formatImportUser(log.user);
      const rawReason = d.reason || d.changeReason || null;
      const fromTo =
        d.previousHsCode !== undefined || d.nextHsCode !== undefined
          ? {
              from: d.previousHsCode != null ? String(d.previousHsCode || '—') : d.previousStatus || null,
              to: d.nextHsCode != null ? String(d.nextHsCode || '—') : d.nextStatus || null,
            }
          : {
              from: d.previousStatus || d.from || null,
              to: d.nextStatus || d.to || null,
            };
      return {
        id: log.id,
        at: log.createdAt,
        userId: log.userId,
        userName: u?.name || u?.email || null,
        from: fromTo.from,
        to: fromTo.to,
        reason: formatAuditReasonLabel(rawReason),
        reasonCode: rawReason || null,
        action: log.action,
        details: d,
      };
    });

  const serialized = serializeRfq(rfq);
  return {
    ...serialized,
    awardedByUser: rfq.awardedBy ? usersById[rfq.awardedBy] || null : null,
    approvedByUser: rfq.approvedBy ? usersById[rfq.approvedBy] || null : null,
    createdByUser: rfq.createdBy ? usersById[rfq.createdBy] || null : null,
    statusHistory,
  };
}

async function createRfq(req, data) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;

  let supplierName = data.supplierName || '';
  let supplierCountry = data.supplierCountry || '';
  if (!data.supplierId && !supplierName.trim()) {
    const err = new Error('Supplier is required');
    err.status = 400;
    err.code = 'SUPPLIER_REQUIRED';
    throw err;
  }
  if (data.supplierId) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: data.supplierId, companyId },
    });
    if (!supplier) {
      const err = new Error('Supplier does not belong to the active company');
      err.status = 400;
      throw err;
    }
    supplierName = supplier.name;
    supplierCountry = supplier.country || supplierCountry;
  }

  const itemsIn = Array.isArray(data.items) ? data.items : [];
  if (!itemsIn.length) {
    const err = new Error('At least one product line is required');
    err.status = 400;
    err.code = 'ITEMS_REQUIRED';
    throw err;
  }

  const incoterm = String(data.incoterm || '').toUpperCase();
  if (!INCOTERMS_2020.includes(incoterm)) {
    const err = new Error(`Incoterm is required and must be one of: ${INCOTERMS_2020.join(', ')}`);
    err.status = 400;
    err.code = 'INCOTERM_REQUIRED';
    throw err;
  }

  const port = await resolveImportPort({
    portId: data.portId,
    portOfDischarge: data.portOfDischarge || data.port,
    unLocode: data.unLocode || data.portCode,
  });
  if (!port) {
    const err = new Error(
      'Port of discharge must be selected from the port master list (UN/LOCODE). Free-text ports are not allowed.'
    );
    err.status = 400;
    err.code = 'PORT_NOT_IN_MASTER';
    throw err;
  }
  const portOfDischarge = port.name;
  const seaWarn = warnSeaIncotermWithAirPort(incoterm, `${port.name} ${port.unLocode} ${port.portType}`);

  const deliveryRaw = data.expectedDelivery || data.validUntil || data.deliveryDate;
  if (!deliveryRaw) {
    const err = new Error('Expected delivery date is required');
    err.status = 400;
    err.code = 'DELIVERY_DATE_REQUIRED';
    throw err;
  }
  const expectedDelivery = new Date(deliveryRaw);
  if (Number.isNaN(expectedDelivery.getTime()) || expectedDelivery < startOfToday()) {
    const err = new Error('Expected delivery date must be today or a future date');
    err.status = 400;
    err.code = 'DELIVERY_DATE_INVALID';
    throw err;
  }

  const currency = String(data.currency || 'USD').toUpperCase();
  const countryOfDispatch =
    data.countryOfDispatch || data.originCountry || supplierCountry || null;

  const productIds = [...new Set(itemsIn.map((it) => it.productId).filter(Boolean))];
  const productsForHs = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds }, companyId },
        select: { id: true, hsCode: true },
      })
    : [];
  const productHsById = Object.fromEntries(
    productsForHs.map((p) => [p.id, p.hsCode ? String(p.hsCode).trim() : ''])
  );

  let totalEstimated = 0;
  const itemsData = itemsIn.map((it) => {
    const qty = toNumber(it.quantity, 0);
    const targetPrice = toNumber(it.targetPriceUsd ?? it.estimatedUnitPrice ?? it.targetPrice, 0);
    if (!(qty > 0)) {
      const err = new Error(`Quantity must be greater than zero for ${it.productName || 'line'}`);
      err.status = 400;
      err.code = 'INVALID_QTY';
      throw err;
    }
    if (!(targetPrice > 0)) {
      const err = new Error(`Target price must be greater than zero for ${it.productName || 'line'}`);
      err.status = 400;
      err.code = 'INVALID_TARGET_PRICE';
      throw err;
    }
    let hsRaw =
      it.hsCode != null && String(it.hsCode).trim() !== '' ? String(it.hsCode).trim() : '';
    if (!hsRaw && it.productId && productHsById[it.productId]) {
      hsRaw = productHsById[it.productId];
    }
    const hsCode = hsRaw ? normalizeHsCode(hsRaw) : null;
    totalEstimated += qty * targetPrice;
    return {
      productId: it.productId || null,
      productName: it.productName || 'Import Product',
      sku: it.sku || null,
      hsCode,
      quantity: qty,
      uom: it.uom || 'PCS',
      targetPriceUsd: targetPrice,
      // Quoted price comes only from an awarded supplier quotation — never copy target
      quotedPriceUsd: null,
    };
  });

  // Server-generated unique number — ignore client IRFQ/RFQ variants
  const year = new Date().getFullYear();
  const prefix = `RFQ-${year}-`;
  const existingNums = await prisma.importRfq.findMany({
    where: { companyId, rfqNumber: { startsWith: prefix } },
    select: { rfqNumber: true },
  });
  let maxSeq = 0;
  for (const row of existingNums) {
    const m = String(row.rfqNumber).match(/RFQ-\d{4}-(\d+)$/i);
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]) || 0);
  }
  const rfqNumber = `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;

  const notesRaw = data.notes ?? data.specialNotes ?? data.commercialNotes;
  const notes =
    notesRaw != null && String(notesRaw).trim() !== '' ? String(notesRaw).trim() : null;

  const rfq = await prisma.importRfq.create({
    data: {
      companyId,
      rfqNumber,
      date: data.date ? new Date(data.date) : new Date(),
      supplierId: data.supplierId || null,
      supplierName,
      supplierCountry,
      incoterm,
      currency,
      portId: port.id,
      portOfDischarge,
      countryOfDispatch,
      expectedDelivery,
      quotationDeadline: data.quotationDeadline ? new Date(data.quotationDeadline) : null,
      status: 'Draft',
      totalEstimatedUsd: totalEstimated,
      notes,
      createdBy: userId,
      items: { create: itemsData },
    },
    include: {
      items: true,
      port: true,
      quotations: true,
      purchaseOrders: { select: { id: true, poNumber: true, status: true } },
    },
  });

  await logImportAudit({
    companyId,
    action: 'CREATE',
    entityType: 'IMPORT_RFQ',
    entityId: rfq.id,
    details: {
      rfqNumber,
      status: 'Draft',
      totalEstimated,
      currency,
      incoterm,
      portId: port.id,
      portOfDischarge,
      notes,
      seaIncotermWarning: seaWarn || undefined,
    },
    userId,
  });

  const serialized = serializeRfq(rfq);
  return {
    ...serialized,
    warnings: [seaWarn, serialized.localPurchaseWarning].filter(Boolean),
  };
}

async function updateRfq(req, id, data) {
  const existing = await getRfqById(req, id);
  const companyId = existing.companyId;
  const userId = req.user.id;

  const updatePayload = {};
  let statusChange = null;

  if (data.status != null && data.status !== '') {
    const { from, to } = assertRfqStatusTransition(existing.status, data.status);
    if (from === 'Approved' && to === 'Awarded') {
      const err = new Error('Use Reopen RFQ action with a reason — status cannot jump back to Awarded directly');
      err.status = 400;
      err.code = 'USE_REOPEN_ACTION';
      throw err;
    }
    if (to === 'Pending Approval') {
      const err = new Error('Use Send for Approval action — status cannot jump to Pending Approval directly');
      err.status = 400;
      err.code = 'USE_SUBMIT_FOR_APPROVAL_ACTION';
      throw err;
    }
    if (to === 'Approved') {
      const err = new Error('Use Approve RFQ action — status cannot jump to Approved directly');
      err.status = 400;
      err.code = 'USE_APPROVE_ACTION';
      throw err;
    }
    if (from === 'Pending Approval' && to === 'Awarded') {
      const err = new Error('Use Reject Approval action — status cannot return to Awarded directly');
      err.status = 400;
      err.code = 'USE_REJECT_APPROVAL_ACTION';
      throw err;
    }
    if (to === 'Converted to PO') {
      const err = new Error('Use Convert to Purchase Order action — status cannot jump to Converted to PO directly');
      err.status = 400;
      err.code = 'USE_CONVERT_ACTION';
      throw err;
    }
    updatePayload.status = to;
    statusChange = { from, to };
  }

  if (data.notes !== undefined || data.specialNotes !== undefined || data.commercialNotes !== undefined) {
    const notesRaw = data.notes ?? data.specialNotes ?? data.commercialNotes;
    updatePayload.notes =
      notesRaw != null && String(notesRaw).trim() !== '' ? String(notesRaw).trim() : null;
  }
  if (data.countryOfDispatch !== undefined || data.originCountry !== undefined) {
    updatePayload.countryOfDispatch = data.countryOfDispatch || data.originCountry || null;
  }
  if (data.incoterm) {
    const term = String(data.incoterm).toUpperCase();
    if (!INCOTERMS_2020.includes(term)) {
      const err = new Error(`Invalid Incoterm. Allowed: ${INCOTERMS_2020.join(', ')}`);
      err.status = 400;
      throw err;
    }
    updatePayload.incoterm = term;
  }
  if (
    data.portId !== undefined ||
    data.portOfDischarge !== undefined ||
    data.unLocode !== undefined ||
    data.portCode !== undefined
  ) {
    const port = await resolveImportPort({
      portId: data.portId,
      portOfDischarge: data.portOfDischarge,
      unLocode: data.unLocode || data.portCode,
    });
    if (!port) {
      const err = new Error(
        'Port of discharge must be selected from the port master list (UN/LOCODE). Free-text ports are not allowed.'
      );
      err.status = 400;
      err.code = 'PORT_NOT_IN_MASTER';
      throw err;
    }
    updatePayload.portId = port.id;
    updatePayload.portOfDischarge = port.name;
  }
  if (data.expectedDelivery) {
    const d = new Date(data.expectedDelivery);
    if (Number.isNaN(d.getTime()) || d < startOfToday()) {
      const err = new Error('Expected delivery date must be today or a future date');
      err.status = 400;
      throw err;
    }
    updatePayload.expectedDelivery = d;
  }
  if (data.currency) updatePayload.currency = String(data.currency).toUpperCase();
  if (data.singleSourceJustification !== undefined) {
    updatePayload.singleSourceJustification =
      data.singleSourceJustification != null && String(data.singleSourceJustification).trim() !== ''
        ? String(data.singleSourceJustification).trim()
        : null;
  }

  const updated = await prisma.importRfq.update({
    where: { id },
    data: updatePayload,
    include: {
      items: true,
      port: true,
      quotations: { include: { items: true } },
      purchaseOrders: { select: { id: true, poNumber: true, status: true } },
    },
  });

  if (statusChange) {
    await logImportAudit({
      companyId,
      action: 'STATUS_CHANGE',
      entityType: 'IMPORT_RFQ',
      entityId: id,
      details: {
        previousStatus: statusChange.from,
        nextStatus: statusChange.to,
        userId,
        at: new Date().toISOString(),
      },
      userId,
    });
  } else {
    await logImportAudit({
      companyId,
      action: 'UPDATE',
      entityType: 'IMPORT_RFQ',
      entityId: id,
      details: updatePayload,
      userId,
    });
  }

  return serializeRfq(updated);
}

async function deleteRfq(req, id) {
  const existing = await getRfqById(req, id);
  if (existing.status === 'PO Created') {
    const err = new Error('Cannot delete RFQ that has already generated a Purchase Order');
    err.status = 400;
    throw err;
  }
  await prisma.importRfq.delete({ where: { id } });
  await logImportAudit({
    companyId: existing.companyId,
    action: 'DELETE',
    entityType: 'IMPORT_RFQ',
    entityId: id,
    userId: req.user.id,
  });
  return { success: true };
}

async function listPurchaseOrders(req, query = {}) {
  const companyScope = getCompanyScope(req);
  const { search, status, page = 1, limit = 20 } = query;
  const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

  const where = {
    companyId: companyScope,
    ...(status && status !== 'All' ? { status } : {}),
    ...(search
      ? {
        OR: [
          { poNumber: { contains: search, mode: 'insensitive' } },
          { supplierName: { contains: search, mode: 'insensitive' } },
          { supplierCountry: { contains: search, mode: 'insensitive' } },
        ],
      }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.importPurchaseOrder.count({ where }),
    prisma.importPurchaseOrder.findMany({
      where,
      include: {
        items: true,
        supplier: true,
        purchaseOrder: { select: { id: true, orderNumber: true, status: true } },
      },
      orderBy: { orderDate: 'desc' },
      skip,
      take: Number(limit),
    }),
  ]);

  return {
    items,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)) || 1,
    },
  };
}

async function getPurchaseOrderById(req, id) {
  const po = await prisma.importPurchaseOrder.findUnique({
    where: { id },
    include: {
      items: true,
      supplier: true,
      purchaseOrder: true,
      shipments: true,
      customsClearances: true,
      documents: true,
      grns: true,
      landedCosts: true,
      financeLcs: true,
      bills: true,
    },
  });
  if (!po) {
    const err = new Error('Import Purchase Order not found');
    err.status = 404;
    throw err;
  }
  await assertRecordCompanyAccess(req, po.companyId);
  const shippedMap = await sumShippedByPoItem(po.companyId, po.id);
  return {
    ...po,
    items: (po.items || []).map((it) => {
      const shippedQty = shippedMap[it.id] || 0;
      const ordered = toNumber(it.quantity);
      return {
        ...it,
        shippedQty,
        remainingQty: Math.max(0, Math.round((ordered - shippedQty) * 10000) / 10000),
      };
    }),
  };
}

async function createPurchaseOrder(req, data) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;

  let supplierName = data.supplierName || '';
  let supplierCountry = data.supplierCountry || '';
  if (data.supplierId) {
    const sup = await prisma.supplier.findFirst({
      where: { id: data.supplierId, companyId },
    });
    if (!sup) {
      const err = new Error('Supplier does not belong to the active company');
      err.status = 400;
      throw err;
    }
    supplierName = sup.name;
    supplierCountry = sup.country || supplierCountry;
  }

  const count = await prisma.importPurchaseOrder.count({ where: { companyId } });
  const year = new Date().getFullYear();
  const poNumber = data.poNumber || `IPO-${year}-${String(count + 1).padStart(3, '0')}`;

  const currency = String(data.currency || 'USD').toUpperCase();
  const orderDateForFx = data.orderDate ? new Date(data.orderDate) : new Date();
  const rateDate = assertImportRateDate(data.exchangeRateDate || orderDateForFx || new Date(), {
    orderDate: orderDateForFx,
    field: 'exchangeRateDate',
    label: 'Rate date',
  });
  let subtotalForeign = 0;

  const itemsData = (data.items || []).map((it) => {
    const qty = toNumber(it.quantity, 1);
    const price = toNumber(it.unitPrice, 0);
    const lineTotal = qty * price;
    subtotalForeign += lineTotal;
    const hsCode =
      it.hsCode != null && String(it.hsCode).trim() !== ''
        ? normalizeHsCode(it.hsCode)
        : null;

    return {
      productId: it.productId || null,
      productName: it.productName || 'Import Product',
      sku: it.sku || null,
      hsCode,
      quantity: qty,
      uom: it.uom || 'PCS',
      unitPrice: price,
      totalAmount: lineTotal,
    };
  });

  // Reject silent 1:1 when currencies differ — require company rate or authorized explicit rate
  const fx = await resolveImportExchangeRate({
    companyId,
    currencyCode: currency,
    foreignAmount: subtotalForeign,
    explicitRate: data.exchangeRateToUsd ?? data.exchangeRate,
    allowExplicitRate: true,
    asOfDate: rateDate,
  });
  const exchangeRate = fx.exchangeRate;
  const totalUsd = fx.baseAmount;

  if (data.rfqId) {
    const rfq = await prisma.importRfq.findFirst({ where: { id: data.rfqId, companyId } });
    if (!rfq) {
      const err = new Error('Linked Import RFQ not found for active company');
      err.status = 400;
      throw err;
    }
  }
  if (data.quotationId) {
    const quote = await prisma.importSupplierQuotation.findFirst({
      where: { id: data.quotationId, companyId },
    });
    if (!quote) {
      const err = new Error('Linked supplier quotation not found for active company');
      err.status = 400;
      throw err;
    }
  }
  // Optionally link or create core ERP PurchaseOrder (respect Import Settings)
  let corePoId = data.purchaseOrderId || null;
  const importSettings = await prisma.importSetting.findUnique({ where: { companyId } }).catch(() => null);
  const shouldAutoCreateCorePo =
    data.linkCorePurchaseOrder === true ||
    (data.linkCorePurchaseOrder !== false &&
      (importSettings?.autoCreatePurchaseOrder !== false) &&
      Boolean(data.supplierId));
  if (!corePoId && shouldAutoCreateCorePo && data.supplierId) {
    const coreOrderNumber = `PO-${poNumber}`;
    try {
      // Reuse orphan core PO left by a prior failed Import PO create (same order_number).
      const existingCore = await prisma.purchaseOrder.findFirst({
        where: { companyId, orderNumber: coreOrderNumber },
        select: { id: true },
      });
      if (existingCore) {
        corePoId = existingCore.id;
      } else {
        const corePo = await prisma.purchaseOrder.create({
          data: {
            orderNumber: coreOrderNumber,
            supplierId: data.supplierId,
            supplierName,
            orderDate: data.orderDate ? new Date(data.orderDate) : new Date(),
            status: 'Ordered',
            subtotal: subtotalForeign,
            grandTotal: totalUsd,
            exchangeRate,
            foreignAmount: subtotalForeign,
            baseAmount: totalUsd,
            termsConditions: `Incoterms: ${data.incoterm || 'CIF'} - Port of Entry: ${data.portOfEntry || ''}`,
            notes: `Import Order: ${poNumber}`,
            companyId,
            createdBy: userId,
            items: {
              create: itemsData.map((it) => ({
                productId: it.productId || undefined,
                productName: it.productName,
                sku: it.sku || 'SKU-IMP',
                quantity: Number(it.quantity),
                unitPrice: Number(it.unitPrice),
                lineTotal: Number(it.totalAmount),
              })),
            },
          },
        });
        corePoId = corePo.id;
      }
    } catch (coreErr) {
      if (coreErr?.code === 'P2002') {
        const raced = await prisma.purchaseOrder.findFirst({
          where: { companyId, orderNumber: coreOrderNumber },
          select: { id: true },
        });
        if (raced) {
          corePoId = raced.id;
        } else {
          console.warn('[ImportPO] Core PO auto-link skipped:', coreErr.message);
        }
      } else {
        console.warn('[ImportPO] Core PO auto-link skipped:', coreErr.message);
      }
    }
  }

  const importPo = await prisma.importPurchaseOrder.create({
    data: {
      companyId,
      poNumber,
      rfqId: data.rfqId || null,
      rfqRef: data.rfqRef || null,
      piRef: data.piRef || null,
      orderDate: data.orderDate ? new Date(data.orderDate) : new Date(),
      supplierId: data.supplierId || null,
      supplierName,
      supplierCountry,
      incoterm: data.incoterm || 'CIF',
      currency,
      exchangeRateToUsd: exchangeRate,
      subtotalForeign,
      totalUsd,
      paymentTerms: data.paymentTerms || '30% Advance, 70% LC at Sight',
      portOfLoading: data.portOfLoading || null,
      portOfEntry: data.portOfEntry || null,
      estimatedArrival: data.estimatedArrival ? new Date(data.estimatedArrival) : null,
      status: data.status || 'Ordered',
      purchaseOrderId: corePoId,
      notes: data.notes || null,
      quotationId: data.quotationId || null,
      namedPlace: data.namedPlace || null,
      originCountry: data.originCountry || supplierCountry || null,
      shippingMethod: data.shippingMethod || null,
      buyerName: data.buyerName || null,
      internalRef: data.internalRef || null,
      supplierReference: data.supplierReference || null,
      exchangeRateDate: rateDate,
      estimatedFreightUsd: toNumber(data.estimatedFreightUsd, 0),
      estimatedInsuranceUsd: toNumber(data.estimatedInsuranceUsd, 0),
      estimatedDutyUsd: toNumber(data.estimatedDutyUsd, 0),
      advanceRequiredPercent: toNumber(data.advanceRequiredPercent, 0),
      lcRequired: Boolean(data.lcRequired),
      expectedDeliveryDate: data.expectedDeliveryDate
        ? new Date(data.expectedDeliveryDate)
        : null,
      createdBy: userId,
      items: {
        create: itemsData,
      },
    },
    include: { items: true },
  });

  if (data.rfqId) {
    await prisma.importRfq.update({
      where: { id: data.rfqId },
      data: { status: 'PO Created' },
    }).catch(() => { });
  }

  await logImportAudit({
    companyId,
    action: 'CREATE',
    entityType: 'IMPORT_PO',
    entityId: importPo.id,
    details: { poNumber, totalUsd, corePoId, quotationId: data.quotationId || null },
    userId,
  });

  return importPo;
}

async function updatePurchaseOrderStatus(req, id, nextStatus) {
  const existing = await getPurchaseOrderById(req, id);
  const companyId = existing.companyId;
  assertPoStatusTransition(existing.status, nextStatus);

  const updated = await prisma.importPurchaseOrder.update({
    where: { id },
    data: { status: nextStatus },
    include: { items: true },
  });

  await logImportAudit({
    companyId,
    action: 'STATUS_CHANGE',
    entityType: 'IMPORT_PO',
    entityId: id,
    details: { previousStatus: existing.status, nextStatus },
    userId: req.user.id,
  });

  return updated;
}

async function listProformas(req, query = {}) {
  const companyScope = getCompanyScope(req);
  const { search, status } = query;

  const where = {
    companyId: companyScope,
    ...(status && status !== 'All' ? { status } : {}),
    ...(search
      ? {
        OR: [
          { piNumber: { contains: search, mode: 'insensitive' } },
          { supplierName: { contains: search, mode: 'insensitive' } },
          { poRef: { contains: search, mode: 'insensitive' } },
        ],
      }
      : {}),
  };

  return await prisma.importProformaInvoice.findMany({
    where,
    include: { importPo: true, items: true },
    orderBy: { issueDate: 'desc' },
  });
}

async function createProforma(req, data) {
  return importEnterprise.createProformaEnterprise(req, data);
}

async function recordAdvancePayment(req, id, paymentData) {
  return importEnterprise.recordAdvancePaymentEnterprise(req, id, paymentData || {});
}

async function updateProformaStatus(req, id, status, extra) {
  return importEnterprise.updateProformaStatusEnterprise(req, id, status, extra || {});
}

async function getProformaById(req, id) {
  return importEnterprise.getProformaById(req, id);
}

async function updateProforma(req, id, data) {
  return importEnterprise.updateProformaEnterprise(req, id, data);
}

const SHIPMENT_ACTIVE_STATUSES = [
  'Booking Requested',
  'Booking Confirmed',
  'Departed',
  'In Transit',
  'Arrived',
  'Customs Clearance',
  'Cleared',
  'Delivered/Received',
  'Delayed',
  // legacy
  'Arrived at Port',
  'Customs Cleared',
  'Delivered',
];

const SHIPMENT_ELIGIBLE_PO_STATUSES = [
  'Ordered',
  'Approved',
  'Confirmed',
  'In Transit',
  'Shipped',
  'Partially Received',
];

const SHIPMENT_STATUS_TRANSITIONS = {
  'Booking Requested': ['Booking Confirmed'],
  'Booking Confirmed': ['Departed'],
  Departed: ['In Transit'],
  'In Transit': ['Arrived'],
  Arrived: ['Customs Clearance'],
  'Customs Clearance': ['Cleared', 'Delivered/Received'],
  Cleared: ['Delivered/Received'],
  'Delivered/Received': [],
  Delayed: ['Booking Confirmed', 'Departed', 'In Transit', 'Arrived', 'Customs Clearance', 'Cleared'],
  Cancelled: [],
  // legacy aliases
  'Arrived at Port': ['Customs Clearance', 'Cleared'],
  'Customs Cleared': ['Delivered/Received'],
  Delivered: [],
};

const SHIPMENT_FINAL_STATUSES = ['Delivered/Received', 'Cancelled'];

function normalizeShipmentStatus(status) {
  if (!status) return 'Booking Confirmed';
  if (status === 'Arrived at Port' || status === 'Arrived at Destination') return 'Arrived';
  if (status === 'Customs Cleared' || status === 'Customs Released') return 'Cleared';
  if (status === 'Delivered' || status === 'Received') return 'Delivered/Received';
  if (status === 'Departed (Loaded)' || status === 'Loaded' || status === 'Sailed') return 'Departed';
  if (status === 'Under Customs' || status === 'Customs') return 'Customs Clearance';
  return status;
}

function startOfDayUtc(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function shipmentValidationError(message, field) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'SHIPMENT_VALIDATION';
  err.field = field || null;
  return err;
}

function isIso6346Container(value) {
  return /^[A-Za-z]{4}\d{7}$/.test(String(value || '').trim());
}

/** Infer FCL when load type missing but container type looks like ocean FCL. */
function resolveLoadType(loadType, containerType) {
  if (loadType) return String(loadType).trim();
  const ct = String(containerType || '')
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!ct) return null;
  if (/^(20|40)/.test(ct) || /GP|HC|DV|RF|OT|FCL/.test(ct) || /\d+FT/.test(ct)) return 'FCL';
  return null;
}

function optionalMetric(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

function displayAuditUser(user) {
  if (!user) return '—';
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  const looksInternal = !name || /^customer\s*\d+$/i.test(name) || /^user\s*\d+$/i.test(name);
  if (looksInternal) return user.email || name || '—';
  return name;
}

function formatShipmentAuditRow(row) {
  const details = row.details && typeof row.details === 'object' ? row.details : {};
  const from = details.from ?? details.previousStatus ?? null;
  const to = details.to ?? details.nextStatus ?? null;
  let label;
  if (row.action === 'CREATE' || ((!from || from === '—') && to)) {
    label = to ? `Created → ${to}` : 'Created';
  } else if (from && to) {
    label = `${from} → ${to}`;
  } else if (row.action === 'STATUS_CHANGE') {
    label = 'Status updated';
  } else {
    label = String(row.action || 'Updated')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return {
    ...row,
    label,
    reason: details.reason || details.note || null,
    userLabel: displayAuditUser(row.user),
  };
}

function assertShipmentStatusTransition(fromRaw, toRaw) {
  const from = normalizeShipmentStatus(fromRaw);
  const to = normalizeShipmentStatus(toRaw);
  if (from === to) return { from, to };
  if (SHIPMENT_FINAL_STATUSES.includes(from)) {
    throw shipmentValidationError(`Cannot change status from ${from}`);
  }
  // Cancelled / Delayed allowed from any non-final status
  if (to === 'Cancelled' || to === 'Delayed') return { from, to };
  const allowed = SHIPMENT_STATUS_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw shipmentValidationError(`Invalid shipment status transition: ${from} → ${to}`);
  }
  return { from, to };
}

async function formatPortDisplay(nameOrCode) {
  if (!nameOrCode) return null;
  const port = await resolveImportPort({
    portOfDischarge: nameOrCode,
    unLocode: nameOrCode,
  }).catch(() => null);
  if (port?.name && port?.unLocode) return `${port.name} (${port.unLocode})`;
  return String(nameOrCode);
}

async function sumShippedByPoItem(companyId, importPoId, excludeShipmentId) {
  const rows = await prisma.importShipmentItem.findMany({
    where: {
      shipment: {
        companyId,
        importPoId,
        shipmentStatus: { not: 'Cancelled' },
        ...(excludeShipmentId ? { id: { not: excludeShipmentId } } : {}),
      },
    },
    select: { importPoItemId: true, productId: true, productName: true, quantity: true },
  });
  const map = {};
  for (const r of rows) {
    const key = r.importPoItemId || r.productId || r.productName;
    map[key] = (map[key] || 0) + toNumber(r.quantity);
  }
  return map;
}

function buildShipmentMilestones(shp, settings = {}) {
  const status = normalizeShipmentStatus(shp.shipmentStatus);
  const rank = {
    'Booking Requested': 0,
    'Booking Confirmed': 1,
    Departed: 2,
    'In Transit': 3,
    Arrived: 4,
    'Customs Clearance': 5,
    Cleared: 6,
    'Delivered/Received': 7,
    Delayed: 1,
    Cancelled: -1,
  };
  const customsOffice = shp.customsOffice || settings.defaultCustomsBroker || null;
  const warehouse = shp.warehouseName || null;

  const rows = [
    {
      key: 'booking',
      title: 'Booking Confirmed',
      plannedAt: shp.createdAt,
      actualAt: rank[status] >= 1 ? shp.createdAt : null,
      note: null,
    },
    {
      key: 'departed',
      title: 'Origin Port Departure',
      plannedAt: shp.etd,
      actualAt: shp.actualDeparture || null,
      note: null,
    },
    {
      key: 'transit',
      title: 'In Transit',
      plannedAt: shp.etd,
      actualAt: shp.actualDeparture && rank[status] >= 3 ? shp.actualDeparture : null,
      note: null,
    },
    {
      key: 'arrived',
      title: 'Arrived at Destination',
      plannedAt: shp.eta,
      actualAt: shp.actualArrival || null,
      note: null,
    },
    {
      key: 'customs',
      title: 'Customs Clearance',
      plannedAt: shp.eta,
      actualAt: rank[status] >= 5 ? shp.actualArrival || shp.updatedAt : null,
      note: customsOffice || null,
      location: customsOffice,
    },
    {
      key: 'delivered',
      title: 'Delivered / Received',
      plannedAt: null,
      actualAt: rank[status] >= 7 ? shp.deliveredAt || shp.updatedAt : null,
      note: warehouse || null,
      location: warehouse,
    },
  ];

  return rows.map((m) => ({
    ...m,
    completed: Boolean(m.actualAt),
    dateLabel: m.actualAt
      ? m.actualAt
      : m.plannedAt
        ? `Planned ${m.plannedAt}`
        : '—',
  }));
}

function displayCarrierName(shp) {
  if (shp.carrierMaster?.name) return shp.carrierMaster.name;
  if (shp.carrier) return shp.carrier;
  if (shp.carrierManualDesc) return shp.carrierManualDesc;
  return null;
}

async function enrichShipment(shp, extras = {}) {
  if (!shp) return shp;
  const status = normalizeShipmentStatus(shp.shipmentStatus);
  const originPort =
    shp.originPort ||
    extras.originPortFallback ||
    shp.importPo?.portOfLoading ||
    null;
  const portOfEntry = shp.portOfEntry || shp.importPo?.portOfEntry || null;
  const originLabel = await formatPortDisplay(originPort);
  const destLabel = await formatPortDisplay(portOfEntry);
  const settings = extras.settings || null;
  const loadType = resolveLoadType(shp.loadType, shp.containerType);
  const milestones = buildShipmentMilestones({ ...shp, shipmentStatus: status }, settings || {});
  const carrierDisplay = displayCarrierName(shp);
  const packageCount = optionalMetric(shp.packageCount);
  const grossWeightKg = optionalMetric(shp.grossWeightKg);
  const cbm = optionalMetric(shp.cbm);
  const netWeightKg = optionalMetric(shp.netWeightKg);
  const auditTrail = Array.isArray(extras.auditTrail)
    ? extras.auditTrail.filter(Boolean).map(formatShipmentAuditRow)
    : [];
  // Do not spread extras wholesale — ImportSetting.id must never overwrite shipment.id
  return {
    ...shp,
    originPort,
    portOfEntry,
    loadType,
    packageCount,
    grossWeightKg,
    cbm,
    netWeightKg,
    shipmentStatus: status,
    carrierDisplay,
    carrierName: carrierDisplay,
    blAwbNumber: shp.blNumber || null,
    containerNumber: shp.containerNo || null,
    destinationPort: portOfEntry || null,
    shipmentMethod: shp.shipmentMode || null,
    originPortLabel: originLabel,
    destinationPortLabel: destLabel,
    routeLabel:
      originLabel || destLabel
        ? `${originLabel || 'Port of loading TBD'} → ${destLabel || 'Port of discharge TBD'}`
        : null,
    milestones,
    etaHistory: Array.isArray(shp.etaHistory) ? shp.etaHistory : shp.etaHistory ? [shp.etaHistory] : [],
    settings: extras.settings ?? null,
    proforma: extras.proforma ?? null,
    financeLc: extras.financeLc ?? null,
    linkedProformas: extras.linkedProformas || [],
    linkedLcs: extras.linkedLcs || [],
    lcWarning: extras.lcWarning || null,
    auditTrail,
  };
}

async function listEligibleShipmentPos(req, query = {}) {
  const companyId = requireSingleCompany(req);
  const supplierId = query.supplierId || null;

  const pos = await prisma.importPurchaseOrder.findMany({
    where: {
      companyId,
      status: { in: SHIPMENT_ELIGIBLE_PO_STATUSES },
      ...(supplierId ? { supplierId } : {}),
    },
    include: {
      items: true,
      proformaInvoices: {
        where: { status: { notIn: ['Cancelled', 'Rejected', 'Expired'] } },
        select: { id: true, piNumber: true, amountForeign: true, currency: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
      financeLcs: {
        where: { status: { notIn: ['Cancelled', 'Expired'] } },
        select: {
          id: true,
          lcNumber: true,
          latestShipmentDate: true,
          expiryDate: true,
          status: true,
          currency: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
    orderBy: { orderDate: 'desc' },
    take: Math.min(Number(query.limit) || 100, 200),
  });

  const result = [];
  for (const po of pos) {
    const shippedMap = await sumShippedByPoItem(companyId, po.id);
    const lines = (po.items || []).map((it) => {
      const ordered = toNumber(it.quantity);
      const shipped = shippedMap[it.id] || 0;
      const remaining = Math.max(0, Math.round((ordered - shipped) * 10000) / 10000);
      return {
        id: it.id,
        productId: it.productId,
        productName: it.productName,
        sku: it.sku,
        uom: it.uom,
        quantity: ordered,
        shippedQty: shipped,
        remainingQty: remaining,
      };
    });
    const remainingTotal = lines.reduce((s, l) => s + l.remainingQty, 0);
    if (remainingTotal <= 1e-9) continue;
    result.push({
      id: po.id,
      poNumber: po.poNumber,
      status: po.status,
      supplierId: po.supplierId,
      supplierName: po.supplierName,
      currency: po.currency,
      incoterm: po.incoterm,
      portOfLoading: po.portOfLoading,
      portOfEntry: po.portOfEntry,
      orderDate: po.orderDate,
      remainingTotal,
      items: lines,
      proformas: po.proformaInvoices || [],
      financeLcs: po.financeLcs || [],
    });
  }
  return result;
}

async function listShipments(req, query = {}) {
  const companyScope = getCompanyScope(req);
  const { search, status, page = 1, limit = 50 } = query;
  const skip = (Math.max(1, Number(page)) - 1) * Number(limit);
  const normalizedStatus = status && status !== 'All' ? normalizeShipmentStatus(status) : null;

  const where = {
    companyId: companyScope,
    ...(normalizedStatus
      ? {
          OR: [
            { shipmentStatus: normalizedStatus },
            ...(normalizedStatus === 'Arrived' ? [{ shipmentStatus: 'Arrived at Port' }] : []),
            ...(normalizedStatus === 'Cleared' ? [{ shipmentStatus: 'Customs Cleared' }] : []),
            ...(normalizedStatus === 'Delivered/Received' ? [{ shipmentStatus: 'Delivered' }] : []),
          ],
        }
      : {}),
    ...(search
      ? {
        OR: [
          { shipmentNumber: { contains: search, mode: 'insensitive' } },
          { blNumber: { contains: search, mode: 'insensitive' } },
          { containerNo: { contains: search, mode: 'insensitive' } },
          { poRef: { contains: search, mode: 'insensitive' } },
          { carrier: { contains: search, mode: 'insensitive' } },
        ],
      }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.importShipment.count({ where }),
    prisma.importShipment.findMany({
      where,
      include: {
        importPo: { include: { items: true } },
        carrierMaster: true,
        customsClearances: true,
        items: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Number(limit),
    }),
  ]);

  const companyIds = [...new Set(items.map((r) => r.companyId).filter(Boolean))];
  const settingsRows = companyIds.length
    ? await prisma.importSetting.findMany({ where: { companyId: { in: companyIds } } })
    : [];
  const settingsByCompany = Object.fromEntries(settingsRows.map((s) => [s.companyId, s]));

  const enriched = [];
  for (const row of items) {
    enriched.push(await enrichShipment(row, { settings: settingsByCompany[row.companyId] || null }));
  }

  return {
    items: enriched,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)) || 1,
    },
  };
}

async function getShipmentById(req, id) {
  const shipment = await prisma.importShipment.findUnique({
    where: { id },
    include: {
      importPo: { include: { items: true } },
      carrierMaster: true,
      customsClearances: true,
      items: true,
      creator: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  if (!shipment) {
    const err = new Error('Shipment not found');
    err.status = 404;
    throw err;
  }
  await assertRecordCompanyAccess(req, shipment.companyId);

  const settings = await prisma.importSetting.findUnique({ where: { companyId: shipment.companyId } }).catch(() => null);

  const linkedProformas = shipment.importPoId
    ? await prisma.importProformaInvoice.findMany({
        where: {
          companyId: shipment.companyId,
          importPoId: shipment.importPoId,
          status: { notIn: ['Cancelled', 'Rejected', 'Expired'] },
        },
        select: { id: true, piNumber: true, status: true, amountForeign: true, currency: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
    : [];
  const linkedLcs = shipment.importPoId
    ? await prisma.importFinanceLc.findMany({
        where: {
          companyId: shipment.companyId,
          importPoId: shipment.importPoId,
          status: { notIn: ['Cancelled', 'Expired'] },
        },
        select: {
          id: true,
          lcNumber: true,
          status: true,
          latestShipmentDate: true,
          expiryDate: true,
          currency: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
    : [];

  let proforma = null;
  if (shipment.proformaId) {
    proforma =
      linkedProformas.find((p) => p.id === shipment.proformaId) ||
      (await prisma.importProformaInvoice.findFirst({
        where: { id: shipment.proformaId, companyId: shipment.companyId },
        select: { id: true, piNumber: true, status: true, amountForeign: true, currency: true },
      }));
  }
  if (!proforma && linkedProformas[0]) proforma = linkedProformas[0];

  let financeLc = null;
  if (shipment.financeLcId) {
    financeLc =
      linkedLcs.find((l) => l.id === shipment.financeLcId) ||
      (await prisma.importFinanceLc.findFirst({
        where: { id: shipment.financeLcId, companyId: shipment.companyId },
        select: {
          id: true,
          lcNumber: true,
          status: true,
          latestShipmentDate: true,
          expiryDate: true,
          currency: true,
        },
      }));
  }
  if (!financeLc && linkedLcs[0]) financeLc = linkedLcs[0];

  // Persist missing links / port of loading so list + detail stay consistent
  const backfill = {};
  if (!shipment.proformaId && proforma?.id) {
    backfill.proformaId = proforma.id;
    backfill.piRef = proforma.piNumber;
  }
  if (!shipment.financeLcId && financeLc?.id) {
    backfill.financeLcId = financeLc.id;
    backfill.lcRef = financeLc.lcNumber;
  }
  if (!shipment.originPort && shipment.importPo?.portOfLoading) {
    backfill.originPort = shipment.importPo.portOfLoading;
  }
  if (!shipment.loadType && resolveLoadType(null, shipment.containerType)) {
    backfill.loadType = resolveLoadType(null, shipment.containerType);
  }
  if (Object.keys(backfill).length) {
    Object.assign(shipment, backfill);
    await prisma.importShipment.update({ where: { id }, data: backfill }).catch(() => null);
  }

  let lcWarning = null;
  const etdOrAtd = shipment.actualDeparture || shipment.etd;
  if (financeLc && etdOrAtd) {
    const d = startOfDayUtc(etdOrAtd);
    if (financeLc.latestShipmentDate && d.getTime() > startOfDayUtc(financeLc.latestShipmentDate).getTime()) {
      lcWarning = `ATD/ETD is after LC ${financeLc.lcNumber} latest shipment date`;
    } else if (financeLc.expiryDate && d.getTime() > startOfDayUtc(financeLc.expiryDate).getTime()) {
      lcWarning = `ATD/ETD is after LC ${financeLc.lcNumber} expiry date`;
    }
  }

  const auditTrail = await prisma.importAuditLog.findMany({
    where: { companyId: shipment.companyId, entityType: 'IMPORT_SHIPMENT', entityId: id },
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return enrichShipment(shipment, {
    settings,
    proforma,
    financeLc,
    linkedProformas,
    linkedLcs,
    lcWarning,
    auditTrail,
  });
}

async function createShipment(req, data) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;
  const settings = await prisma.importSetting.findUnique({ where: { companyId } }).catch(() => null);

  const count = await prisma.importShipment.count({ where: { companyId } });
  const year = new Date().getFullYear();
  const shipmentNumber = data.shipmentNumber || `ISHP-${year}-${String(count + 1).padStart(3, '0')}`;

  let importPo = null;
  if (data.importPoId) {
    importPo = await prisma.importPurchaseOrder.findFirst({
      where: { id: data.importPoId, companyId },
      include: { items: true },
    });
    if (!importPo) throw shipmentValidationError('Import PO not found for active company', 'importPoId');
    if (!SHIPMENT_ELIGIBLE_PO_STATUSES.includes(importPo.status)) {
      throw shipmentValidationError(
        `Import PO must be Ordered/approved (current: ${importPo.status})`,
        'importPoId'
      );
    }
  }

  if (!data.carrierId && !String(data.carrierManualDesc || '').trim()) {
    throw shipmentValidationError('Carrier is required (select a master carrier or enter a manual description)', 'carrierId');
  }

  let carrierName = null;
  let carrierId = data.carrierId || null;
  if (carrierId) {
    const carrierRow = await prisma.importCarrier.findFirst({
      where: { id: carrierId, companyId, status: 'Active' },
    });
    if (!carrierRow) throw shipmentValidationError('Carrier not found or inactive', 'carrierId');
    carrierName = carrierRow.name;
  } else {
    carrierName = String(data.carrierManualDesc).trim();
  }

  const etd = data.etd ? startOfDayUtc(data.etd) : null;
  const eta = data.eta ? startOfDayUtc(data.eta) : null;
  if (etd && eta && eta.getTime() <= etd.getTime()) {
    throw shipmentValidationError('ETA must be after ETD', 'eta');
  }
  if (etd && importPo?.orderDate && etd.getTime() < startOfDayUtc(importPo.orderDate).getTime()) {
    throw shipmentValidationError('ETD must not be before the PO order date', 'etd');
  }

  const today = startOfDayUtc(new Date());
  const actualDeparture = data.actualDeparture ? startOfDayUtc(data.actualDeparture) : null;
  const actualArrival = data.actualArrival ? startOfDayUtc(data.actualArrival) : null;
  if (actualDeparture && actualDeparture.getTime() > today.getTime()) {
    throw shipmentValidationError('Actual ship date (ATD) must not be in the future', 'actualDeparture');
  }
  if (actualDeparture && importPo?.orderDate && actualDeparture.getTime() < startOfDayUtc(importPo.orderDate).getTime()) {
    throw shipmentValidationError('Actual ship date (ATD) must not be before the PO order date', 'actualDeparture');
  }
  if (actualArrival && actualArrival.getTime() > today.getTime()) {
    throw shipmentValidationError('Actual arrival date (ATA) must not be in the future', 'actualArrival');
  }
  if (actualDeparture && actualArrival && actualArrival.getTime() < actualDeparture.getTime()) {
    throw shipmentValidationError('Actual arrival date (ATA) must be on or after the actual ship date (ATD)', 'actualArrival');
  }

  const loadType = resolveLoadType(data.loadType, data.containerType);
  const containerNo = data.containerNo ? String(data.containerNo).trim().toUpperCase() : null;
  if (loadType === 'FCL' && containerNo && !isIso6346Container(containerNo)) {
    throw shipmentValidationError(
      'Container number must match ISO 6346 (4 letters + 7 digits), e.g. MSCU1234567',
      'containerNo'
    );
  }

  const blNumber = data.blNumber ? String(data.blNumber).trim() : null;
  if (blNumber && carrierId) {
    const dupBl = await prisma.importShipment.findFirst({
      where: {
        companyId,
        carrierId,
        blNumber,
        shipmentStatus: { not: 'Cancelled' },
      },
      select: { id: true, shipmentNumber: true },
    });
    if (dupBl) {
      throw shipmentValidationError(
        `B/L number ${blNumber} already used on active shipment ${dupBl.shipmentNumber} for this carrier`,
        'blNumber'
      );
    }
  }
  if (containerNo && carrierId) {
    const dupCn = await prisma.importShipment.findFirst({
      where: {
        companyId,
        carrierId,
        containerNo,
        shipmentStatus: { not: 'Cancelled' },
      },
      select: { id: true, shipmentNumber: true },
    });
    if (dupCn) {
      throw shipmentValidationError(
        `Container ${containerNo} already used on active shipment ${dupCn.shipmentNumber} for this carrier`,
        'containerNo'
      );
    }
  }

  // Link PI / LC
  let proformaId = data.proformaId || null;
  let piRef = data.piRef || null;
  let financeLcId = data.financeLcId || null;
  let lcRef = data.lcRef || null;
  let lcWarning = null;
  if (importPo) {
    if (!proformaId) {
      const pi = await prisma.importProformaInvoice.findFirst({
        where: { companyId, importPoId: importPo.id, status: { notIn: ['Cancelled', 'Rejected'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (pi) {
        proformaId = pi.id;
        piRef = pi.piNumber;
      }
    }
    if (!financeLcId) {
      const lc = await prisma.importFinanceLc.findFirst({
        where: { companyId, importPoId: importPo.id, status: { notIn: ['Cancelled', 'Expired'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (lc) {
        financeLcId = lc.id;
        lcRef = lc.lcNumber;
        if (etd && lc.latestShipmentDate && etd.getTime() > startOfDayUtc(lc.latestShipmentDate).getTime()) {
          lcWarning = `ETD is after LC ${lc.lcNumber} latest shipment date`;
        }
        if (etd && lc.expiryDate && etd.getTime() > startOfDayUtc(lc.expiryDate).getTime()) {
          lcWarning = `ETD is after LC ${lc.lcNumber} expiry date`;
        }
      }
    }
  }

  const originPort = data.originPort || importPo?.portOfLoading || null;
  const portOfEntry = data.portOfEntry || importPo?.portOfEntry || null;
  const originPortRow = originPort
    ? await resolveImportPort({ portOfDischarge: originPort, unLocode: data.originUnLocode }).catch(() => null)
    : null;
  const destPortRow = portOfEntry
    ? await resolveImportPort({ portOfDischarge: portOfEntry, unLocode: data.destinationUnLocode }).catch(() => null)
    : null;

  const cargoItems = [];
  const requestedLines = Array.isArray(data.items) ? data.items : [];
  if (importPo && requestedLines.length) {
    const shippedByPoItem = await sumShippedByPoItem(companyId, importPo.id);
    for (const line of requestedLines) {
      const qty = toNumber(line.quantity, 0);
      if (qty <= 0) continue;
      const poItem = importPo.items.find(
        (p) =>
          (line.importPoItemId && p.id === line.importPoItemId) ||
          (line.productId && p.productId === line.productId)
      );
      if (!poItem) {
        throw shipmentValidationError(`Shipment line does not match PO items (${line.productName || line.productId})`);
      }
      const ordered = toNumber(poItem.quantity);
      const alreadyShipped = shippedByPoItem[poItem.id] || 0;
      const remaining = Math.max(0, ordered - alreadyShipped);
      if (qty > remaining + 1e-9) {
        throw shipmentValidationError(
          `Remaining PO quantity: ${remaining}`,
          'items'
        );
      }
      shippedByPoItem[poItem.id] = alreadyShipped + qty;
      cargoItems.push({
        importPoItemId: poItem.id,
        productId: line.productId || poItem.productId || null,
        productName: line.productName || poItem.productName,
        sku: line.sku || poItem.sku || null,
        quantity: qty,
        uom: line.uom || poItem.uom || 'PCS',
        packageCount: toNumber(line.packageCount, 0),
        netWeightKg: toNumber(line.netWeightKg, 0),
        grossWeightKg: toNumber(line.grossWeightKg, 0),
      });
    }
  } else if (requestedLines.length) {
    for (const line of requestedLines) {
      const qty = toNumber(line.quantity, 0);
      if (qty <= 0) continue;
      cargoItems.push({
        importPoItemId: line.importPoItemId || null,
        productId: line.productId || null,
        productName: line.productName || 'Import Product',
        sku: line.sku || null,
        quantity: qty,
        uom: line.uom || 'PCS',
        packageCount: toNumber(line.packageCount, 0),
        netWeightKg: toNumber(line.netWeightKg, 0),
        grossWeightKg: toNumber(line.grossWeightKg, 0),
      });
    }
  }

  const blType = data.blType || null;
  if (settings?.requirePhysicalOriginalBl && blType && blType !== 'Original' && data.warnOriginalBl === false) {
    // soft preference only — still allow Telex/Sea Waybill with explicit choice
  }

  const shipment = await prisma.importShipment.create({
    data: {
      companyId,
      shipmentNumber,
      importPoId: importPo?.id || null,
      poRef: data.poRef || importPo?.poNumber || null,
      supplierName: data.supplierName || importPo?.supplierName || null,
      carrierId,
      carrier: carrierName,
      carrierManualDesc: !carrierId ? String(data.carrierManualDesc || '').trim() || null : null,
      shipmentMode: data.shipmentMode || null,
      loadType,
      bookingRef: data.bookingRef || null,
      trackingRef: data.trackingRef || null,
      blNumber,
      blType,
      originPort,
      portOfEntry,
      originUnLocode: data.originUnLocode || originPortRow?.unLocode || null,
      destinationUnLocode: data.destinationUnLocode || destPortRow?.unLocode || null,
      finalDeliveryLocation: data.finalDeliveryLocation || null,
      shippingInstructions: data.shippingInstructions || null,
      vesselFlight: data.vesselFlight || data.vesselName || null,
      vesselName: data.vesselName || data.vesselFlight || null,
      voyageNumber: data.voyageNumber || null,
      consignee: data.consignee || null,
      notifyParty: data.notifyParty || null,
      proformaId,
      piRef,
      financeLcId,
      lcRef,
      incoterm: data.incoterm || importPo?.incoterm || null,
      currency: data.currency || importPo?.currency || null,
      etd,
      eta,
      actualDeparture,
      actualArrival,
      containerNo,
      containerType: data.containerType || null,
      sealNumber: data.sealNumber || null,
      packageCount: optionalMetric(data.packageCount),
      netWeightKg: optionalMetric(data.netWeightKg),
      grossWeightKg: optionalMetric(data.grossWeightKg),
      cbm: optionalMetric(data.cbm),
      estimatedFreightUsd: toNumber(data.estimatedFreightUsd, 0),
      estimatedInsuranceUsd: toNumber(data.estimatedInsuranceUsd, 0),
      shipmentStatus: 'Booking Confirmed',
      currentMilestone: 'Booking Confirmed',
      milestones: [],
      etaHistory: [],
      customsOffice: data.customsOffice || settings?.defaultCustomsBroker || null,
      warehouseName: data.warehouseName || null,
      notes: data.notes || null,
      createdBy: userId,
      items: cargoItems.length ? { create: cargoItems } : undefined,
    },
    include: { items: true, carrierMaster: true, importPo: true },
  });

  await logImportAudit({
    companyId,
    action: 'CREATE',
    entityType: 'IMPORT_SHIPMENT',
    entityId: shipment.id,
    details: {
      shipmentNumber,
      from: null,
      to: 'Booking Confirmed',
      previousStatus: null,
      nextStatus: 'Booking Confirmed',
      carrierId,
      blNumber,
      lcWarning,
    },
    userId,
  });

  const enriched = await enrichShipment(shipment, { settings });
  if (lcWarning) enriched.lcWarning = lcWarning;
  return enriched;
}

async function updateShipmentStatus(req, id, data = {}) {
  const shipment = await prisma.importShipment.findUnique({
    where: { id },
    include: { carrierMaster: true, items: true, importPo: true },
  });
  if (!shipment) {
    const err = new Error('Shipment not found');
    err.status = 404;
    throw err;
  }
  await assertRecordCompanyAccess(req, shipment.companyId);

  const nextStatus = data.shipmentStatus || data.status;
  if (!nextStatus) throw shipmentValidationError('status is required', 'status');
  const { from, to } = assertShipmentStatusTransition(shipment.shipmentStatus, nextStatus);

  const today = startOfDayUtc(new Date());
  const patch = { shipmentStatus: to, currentMilestone: to };
  const note = data.note || data.reason || null;

  if (data.actualDeparture) {
    const atd = startOfDayUtc(data.actualDeparture);
    if (atd.getTime() > today.getTime()) {
      throw shipmentValidationError('Actual ship date (ATD) must not be in the future', 'actualDeparture');
    }
    if (shipment.importPo?.orderDate && atd.getTime() < startOfDayUtc(shipment.importPo.orderDate).getTime()) {
      throw shipmentValidationError('Actual ship date (ATD) must not be before the PO order date', 'actualDeparture');
    }
    patch.actualDeparture = atd;
  }
  if (data.actualArrival) {
    const ata = startOfDayUtc(data.actualArrival);
    if (ata.getTime() > today.getTime()) {
      throw shipmentValidationError('Actual arrival date (ATA) must not be in the future', 'actualArrival');
    }
    patch.actualArrival = ata;
  }
  if (data.deliveredAt || data.actualDelivery || data.deliveredDate) {
    const deliveredAt = startOfDayUtc(data.deliveredAt || data.actualDelivery || data.deliveredDate);
    if (deliveredAt.getTime() > today.getTime()) {
      throw shipmentValidationError('Delivered/received date must not be in the future', 'deliveredAt');
    }
    patch.deliveredAt = deliveredAt;
  }
  if (data.blNumber !== undefined) patch.blNumber = data.blNumber ? String(data.blNumber).trim() : null;
  if (data.containerNo !== undefined) {
    patch.containerNo = data.containerNo ? String(data.containerNo).trim().toUpperCase() : null;
  }
  if (data.loadType !== undefined) patch.loadType = data.loadType || null;
  if (data.containerType !== undefined) patch.containerType = data.containerType || null;
  if (data.originPort !== undefined) patch.originPort = data.originPort ? String(data.originPort).trim() : null;
  if (data.packageCount !== undefined) patch.packageCount = optionalMetric(data.packageCount);
  if (data.grossWeightKg !== undefined) patch.grossWeightKg = optionalMetric(data.grossWeightKg);
  if (data.cbm !== undefined) patch.cbm = optionalMetric(data.cbm);
  if (data.eta !== undefined && data.eta) {
    const newEta = startOfDayUtc(data.eta);
    const etd = shipment.etd ? startOfDayUtc(shipment.etd) : null;
    if (etd && newEta.getTime() <= etd.getTime()) {
      throw shipmentValidationError('ETA must be after ETD', 'eta');
    }
    const prior = Array.isArray(shipment.etaHistory) ? shipment.etaHistory : [];
    if (shipment.eta && startOfDayUtc(shipment.eta).getTime() !== newEta.getTime()) {
      patch.etaHistory = [
        ...prior,
        {
          from: startOfDayUtc(shipment.eta).toISOString().slice(0, 10),
          to: newEta.toISOString().slice(0, 10),
          by: req.user.id,
          at: new Date().toISOString(),
          reason: data.etaReason || data.reason || null,
        },
      ];
    }
    patch.eta = newEta;
  }

  const blNumber = patch.blNumber !== undefined ? patch.blNumber : shipment.blNumber;
  const containerNo = patch.containerNo !== undefined ? patch.containerNo : shipment.containerNo;
  const containerType = patch.containerType !== undefined ? patch.containerType : shipment.containerType;
  const loadType = resolveLoadType(
    patch.loadType !== undefined ? patch.loadType : shipment.loadType,
    containerType
  );
  if (loadType && !shipment.loadType && patch.loadType === undefined) {
    patch.loadType = loadType;
  }
  const originPort =
    (patch.originPort !== undefined ? patch.originPort : shipment.originPort) ||
    shipment.importPo?.portOfLoading ||
    null;
  if (!shipment.originPort && shipment.importPo?.portOfLoading) {
    patch.originPort = shipment.importPo.portOfLoading;
  }
  const packageCount =
    patch.packageCount !== undefined ? patch.packageCount : optionalMetric(shipment.packageCount);
  const grossWeightKg =
    patch.grossWeightKg !== undefined ? patch.grossWeightKg : optionalMetric(shipment.grossWeightKg);

  const atdFinal = patch.actualDeparture || (shipment.actualDeparture ? startOfDayUtc(shipment.actualDeparture) : null);
  const ataFinal = patch.actualArrival || (shipment.actualArrival ? startOfDayUtc(shipment.actualArrival) : null);
  if (atdFinal && ataFinal && ataFinal.getTime() < atdFinal.getTime()) {
    throw shipmentValidationError(
      'Actual arrival date (ATA) must be on or after the actual ship date (ATD)',
      'actualArrival'
    );
  }

  if (to === 'Departed') {
    if (!blNumber) {
      throw shipmentValidationError('B/L number is required to mark as Departed', 'blNumber');
    }
    if (!originPort) {
      throw shipmentValidationError('Port of loading is required before Departed', 'originPort');
    }
    if (packageCount == null || packageCount <= 0) {
      throw shipmentValidationError('Number of packages is required before Departed', 'packageCount');
    }
    if (grossWeightKg == null || grossWeightKg <= 0) {
      throw shipmentValidationError('Gross weight (kg) is required before Departed', 'grossWeightKg');
    }
    if (loadType === 'FCL') {
      if (!containerNo) {
        throw shipmentValidationError('Container number is required for FCL before Departed', 'containerNo');
      }
      if (!isIso6346Container(containerNo)) {
        throw shipmentValidationError(
          'Container number must match ISO 6346 (4 letters + 7 digits)',
          'containerNo'
        );
      }
    }
    if (!atdFinal) {
      throw shipmentValidationError('Actual ship date (ATD) is required when marking Departed', 'actualDeparture');
    }
    if (atdFinal.getTime() > today.getTime()) {
      throw shipmentValidationError('Actual ship date (ATD) must not be in the future', 'actualDeparture');
    }
    if (shipment.importPo?.orderDate && atdFinal.getTime() < startOfDayUtc(shipment.importPo.orderDate).getTime()) {
      throw shipmentValidationError('Actual ship date (ATD) must not be before the PO order date', 'actualDeparture');
    }
  }

  if (to === 'Arrived') {
    if (!ataFinal) {
      throw shipmentValidationError('Actual arrival date (ATA) is required when marking Arrived', 'actualArrival');
    }
    if (ataFinal.getTime() > today.getTime()) {
      throw shipmentValidationError('Actual arrival date (ATA) must not be in the future', 'actualArrival');
    }
    if (atdFinal && ataFinal.getTime() < atdFinal.getTime()) {
      throw shipmentValidationError(
        'Actual arrival date (ATA) must be on or after the actual ship date (ATD)',
        'actualArrival'
      );
    }
  }

  if (to === 'Delivered/Received') {
    const deliveredAt =
      patch.deliveredAt ||
      (shipment.deliveredAt ? startOfDayUtc(shipment.deliveredAt) : null) ||
      ataFinal ||
      today;
    if (ataFinal && deliveredAt.getTime() < ataFinal.getTime()) {
      throw shipmentValidationError(
        'Delivered/received date must be on or after the actual arrival date (ATA)',
        'deliveredAt'
      );
    }
    if (!patch.deliveredAt && !shipment.deliveredAt) {
      patch.deliveredAt = deliveredAt;
    }
  }

  let lcWarning = null;
  if (shipment.financeLcId && atdFinal) {
    const lc = await prisma.importFinanceLc.findFirst({
      where: { id: shipment.financeLcId, companyId: shipment.companyId },
      select: { lcNumber: true, latestShipmentDate: true, expiryDate: true },
    });
    if (lc?.latestShipmentDate && atdFinal.getTime() > startOfDayUtc(lc.latestShipmentDate).getTime()) {
      lcWarning = `ATD is after LC ${lc.lcNumber} latest shipment date`;
    } else if (lc?.expiryDate && atdFinal.getTime() > startOfDayUtc(lc.expiryDate).getTime()) {
      lcWarning = `ATD is after LC ${lc.lcNumber} expiry date`;
    }
  }

  // Uniqueness on update
  if (blNumber && shipment.carrierId) {
    const dupBl = await prisma.importShipment.findFirst({
      where: {
        companyId: shipment.companyId,
        carrierId: shipment.carrierId,
        blNumber,
        shipmentStatus: { not: 'Cancelled' },
        NOT: { id },
      },
      select: { shipmentNumber: true },
    });
    if (dupBl) {
      throw shipmentValidationError(
        `B/L number ${blNumber} already used on active shipment ${dupBl.shipmentNumber} for this carrier`,
        'blNumber'
      );
    }
  }
  if (containerNo && shipment.carrierId) {
    const dupCn = await prisma.importShipment.findFirst({
      where: {
        companyId: shipment.companyId,
        carrierId: shipment.carrierId,
        containerNo,
        shipmentStatus: { not: 'Cancelled' },
        NOT: { id },
      },
      select: { shipmentNumber: true },
    });
    if (dupCn) {
      throw shipmentValidationError(
        `Container ${containerNo} already used on active shipment ${dupCn.shipmentNumber} for this carrier`,
        'containerNo'
      );
    }
  }

  const updated = await prisma.importShipment.update({
    where: { id },
    data: patch,
    include: { items: true, carrierMaster: true, importPo: true },
  });

  await logImportAudit({
    companyId: shipment.companyId,
    action: 'STATUS_CHANGE',
    entityType: 'IMPORT_SHIPMENT',
    entityId: id,
    details: { from, to, previousStatus: from, nextStatus: to, reason: note },
    userId: req.user.id,
  });

  // Return full detail (PI/LC/audit) after status change
  return getShipmentById(req, id).then((full) => {
    if (lcWarning) full.lcWarning = lcWarning;
    return full;
  });
}

async function listCustomsClearances(req, query = {}) {
  return importEnterprise.listCustomsClearancesEnriched(req, query);
}

async function getCustomsClearanceById(req, id) {
  return importEnterprise.getCustomsClearanceById(req, id);
}

async function previewCustomsClearance(req, data) {
  return importEnterprise.previewCustomsClearance(req, data);
}

async function createCustomsClearance(req, data) {
  return importEnterprise.createCustomsClearanceEnterprise(req, data);
}

async function updateCustomsStatus(req, id, status, paymentRef, extra) {
  return importEnterprise.updateCustomsStatusEnterprise(req, id, status, paymentRef, extra || {});
}

async function recalculateCustomsWithCurrentRate(req, id, data) {
  return importEnterprise.recalculateCustomsWithCurrentRate(req, id, data || {});
}

async function refreshCustomsTariffData(req, id, data) {
  return importEnterprise.refreshCustomsTariffData(req, id, data || {});
}

async function recordCustomsDutyPayment(req, id, data) {
  return importEnterprise.recordCustomsDutyPayment(req, id, data || {});
}

async function listCustomsPaymentAccounts(req, query) {
  return importEnterprise.listCustomsPaymentAccounts(req, query || {});
}

// ============================================================
// 7. IMPORT DOCUMENTS
// ============================================================
async function listDocuments(req, query = {}) {
  const companyScope = getCompanyScope(req);
  const { search, docType, documentType, status, page = 1, limit = 50 } = query;
  const typeFilter = docType || documentType;
  const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

  const where = {
    companyId: companyScope,
    ...(typeFilter && typeFilter !== 'All' ? { docType: typeFilter } : {}),
    ...(status && status !== 'All' ? { status } : {}),
    ...(search
      ? {
        OR: [
          { docNumber: { contains: search, mode: 'insensitive' } },
          { poRef: { contains: search, mode: 'insensitive' } },
          { shipmentRef: { contains: search, mode: 'insensitive' } },
          { issuer: { contains: search, mode: 'insensitive' } },
          { docType: { contains: search, mode: 'insensitive' } },
        ],
      }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.importDocument.count({ where }),
    prisma.importDocument.findMany({
      where,
      include: { importPo: true, shipment: true },
      orderBy: { issueDate: 'desc' },
      skip,
      take: Number(limit),
    }),
  ]);

  return {
    items,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)) || 1,
    },
  };
}

async function createDocument(req, data) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;

  const count = await prisma.importDocument.count({ where: { companyId } });
  const year = new Date().getFullYear();
  const docNumber =
    data.docNumber ||
    data.documentNumber ||
    `DOC-${year}-${String(count + 1).padStart(3, '0')}`;
  const docType = data.docType || data.documentType || 'Commercial Invoice';

  if (data.importPoId) {
    const po = await prisma.importPurchaseOrder.findFirst({
      where: { id: data.importPoId, companyId },
    });
    if (!po) {
      const err = new Error('Import PO not found for active company');
      err.status = 404;
      throw err;
    }
    if (!data.poRef) data.poRef = po.poNumber;
  }
  if (data.shipmentId) {
    const ship = await prisma.importShipment.findFirst({
      where: { id: data.shipmentId, companyId },
    });
    if (!ship) {
      const err = new Error('Shipment not found for active company');
      err.status = 404;
      throw err;
    }
    if (!data.shipmentRef) data.shipmentRef = ship.shipmentNumber;
  }

  const doc = await prisma.importDocument.create({
    data: {
      companyId,
      docNumber,
      docType,
      importPoId: data.importPoId || null,
      poRef: data.poRef || null,
      shipmentId: data.shipmentId || null,
      shipmentRef: data.shipmentRef || null,
      issuer: data.issuer || 'Overseas Supplier',
      issueDate: data.issueDate ? new Date(data.issueDate) : new Date(),
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
      originalReceived: Boolean(data.originalReceived),
      status: data.status || 'Pending Review',
      fileUrl: data.fileUrl || null,
      filePlaceholder:
        data.filePlaceholder ||
        data.fileName ||
        `${docNumber}.pdf`,
      createdBy: userId,
    },
  });

  await logImportAudit({
    companyId,
    action: 'CREATE',
    entityType: 'IMPORT_DOCUMENT',
    entityId: doc.id,
    details: { docNumber, docType: doc.docType },
    userId,
  });

  return doc;
}

// ============================================================
// 8. IMPORT GRN / RECEIVING (delegates to importGrnService)
// ============================================================
async function listGrns(req, query = {}) {
  return importGrnService.listGrns(req, query);
}

async function getGrnById(req, id) {
  return importGrnService.getGrnById(req, id);
}

async function getReceivingPreview(req, importPoId) {
  return importGrnService.getReceivingPreview(req, importPoId);
}

async function getShipmentReceivingPreview(req, shipmentId) {
  return importGrnService.getShipmentReceivingPreview(req, shipmentId);
}

async function listReceivableShipments(req, query = {}) {
  return importGrnService.listReceivableShipments(req, query);
}

async function auditImportGrns(req, query = {}) {
  return importGrnService.auditImportGrns(req, query);
}

async function createGrn(req, data) {
  return importGrnService.createGrn(req, data);
}

async function postGrn(req, id) {
  return importGrnService.postGrn(req, id);
}

async function cancelGrn(req, id, data) {
  return importGrnService.cancelGrn(req, id, data);
}

async function verifyShipmentOriginalBl(req, id, data) {
  return importGrnService.verifyShipmentOriginalBl(req, id, data);
}

async function listLandedCosts(req, query = {}) {
  const companyScope = getCompanyScope(req);
  const { search, status } = query;

  const where = {
    companyId: companyScope,
    ...(status && status !== 'All' ? { status } : {}),
    ...(search
      ? {
        OR: [
          { allocationNumber: { contains: search, mode: 'insensitive' } },
          { poRef: { contains: search, mode: 'insensitive' } },
          { grnRef: { contains: search, mode: 'insensitive' } },
        ],
      }
      : {}),
  };

  return await prisma.importLandedCost.findMany({
    where,
    include: { items: true, importPo: true, grn: true, journalEntry: true },
    orderBy: { date: 'desc' },
  });
}

async function getLandedCostById(req, id) {
  const lc = await prisma.importLandedCost.findUnique({
    where: { id },
    include: {
      items: true,
      importPo: { include: { items: true } },
      grn: { include: { items: true } },
      journalEntry: { include: { lines: true } },
    },
  });
  if (!lc) throw new Error('Landed Cost Allocation not found');
  await assertRecordCompanyAccess(req, lc.companyId);
  return lc;
}

async function createLandedCost(req, data) {
  return importEnterprise.createLandedCostEnterprise(req, data);
}

async function postLandedCost(req, id) {
  const lc = await prisma.importLandedCost.findUnique({
    where: { id },
    include: { items: true, company: true },
  });
  if (!lc) throw new Error('Landed Cost record not found');
  await assertRecordCompanyAccess(req, lc.companyId);

  if (lc.status === 'Posted' && lc.journalEntryId) {
    return { success: true, message: 'Landed Cost already posted to General Ledger', journalEntryId: lc.journalEntryId };
  }

  const companyId = lc.companyId;
  const userId = req.user.id;
  const postingDate = lc.date ? new Date(lc.date) : new Date();

  // Guard closed fiscal periods
  await fiscalYearGuard(userId, postingDate);
  const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

  const landedExpenseAmount = toNumber(lc.totalLandedExpensesUsd);
  if (landedExpenseAmount <= 0) {
    throw new Error('Landed expenses total must be greater than zero to post accounting entry');
  }

  return await prisma.$transaction(async (tx) => {
    // Resolve Company Chart of Accounts for Inventory Asset and Landed Cost Clearing
    const settings = await tx.importSetting.findUnique({ where: { companyId } });

    let inventoryAccount = null;
    if (settings?.inventoryAssetAccountId) {
      inventoryAccount = await tx.chartOfAccount.findFirst({
        where: { id: settings.inventoryAssetAccountId, companyId },
      });
    }
    if (!inventoryAccount) {
      // Find default Inventory asset account
      inventoryAccount = await tx.chartOfAccount.findFirst({
        where: {
          companyId,
          type: 'Asset',
          OR: [
            { name: { contains: 'Inventory', mode: 'insensitive' } },
            { name: { contains: 'Stock', mode: 'insensitive' } },
          ],
        },
      });
    }
    if (!inventoryAccount) {
      inventoryAccount = await tx.chartOfAccount.findFirst({
        where: { companyId, type: 'Asset' },
      });
    }

    let clearingAccount = null;
    if (settings?.clearingAccountId) {
      clearingAccount = await tx.chartOfAccount.findFirst({
        where: { id: settings.clearingAccountId, companyId },
      });
    }
    if (!clearingAccount) {
      // Find Landed Cost Clearing / Accrued Charges or Accounts Payable
      clearingAccount = await tx.chartOfAccount.findFirst({
        where: {
          companyId,
          type: 'Liability',
          OR: [
            { name: { contains: 'Landed', mode: 'insensitive' } },
            { name: { contains: 'Clearing', mode: 'insensitive' } },
            { name: { contains: 'Accrued', mode: 'insensitive' } },
            { name: { contains: 'Payable', mode: 'insensitive' } },
          ],
        },
      });
    }
    if (!clearingAccount) {
      clearingAccount = await tx.chartOfAccount.findFirst({
        where: { companyId, type: 'Liability' },
      });
    }

    if (!inventoryAccount || !clearingAccount) {
      throw new Error('Company must have configured Asset (Inventory) and Liability (Clearing/AP) accounts');
    }
    const entryNumber = `JE-LCA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const journalEntry = await tx.journalEntry.create({
      data: {
        entryNumber,
        date: postingDate,
        description: `Landed Cost Allocation #${lc.allocationNumber} (PO #${lc.poRef || ''})`,
        reference: lc.allocationNumber,
        status: 'Posted',
        type: 'Normal',
        companyId,
        fiscalYearId,
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        lines: {
          create: [
            {
              accountId: inventoryAccount.id,
              accountName: inventoryAccount.name,
              accountCode: inventoryAccount.code,
              debit: landedExpenseAmount,
              credit: 0,
            },
            {
              accountId: clearingAccount.id,
              accountName: clearingAccount.name,
              accountCode: clearingAccount.code,
              debit: 0,
              credit: landedExpenseAmount,
            },
          ],
        },
      },
      include: { lines: true },
    });

    await BalanceCalculator.applyJournalLines(tx, journalEntry.lines);

    // Update product costPrice toward final landed unit cost (weighted average when stock exists)
    for (const item of lc.items || []) {
      if (!item.productId) continue;
      const product = await tx.product.findFirst({
        where: { id: item.productId, companyId },
      });
      if (!product) continue;
      const newUnit = toNumber(item.finalLandedCostPerUnitUsd);
      if (!(newUnit > 0)) continue;
      const stock = toNumber(product.currentStock, 0);
      const prevCost = toNumber(product.costPrice, 0);
      const qty = toNumber(item.qty, 0);
      let nextCost = newUnit;
      if (stock > qty && prevCost > 0) {
        const remaining = stock - qty;
        nextCost = Math.round(((prevCost * remaining + newUnit * qty) / stock) * 10000) / 10000;
      }
      await tx.product.update({
        where: { id: product.id },
        data: { costPrice: nextCost },
      });
    }

    const updatedLc = await tx.importLandedCost.update({
      where: { id },
      data: {
        status: 'Posted',
        journalEntryId: journalEntry.id,
      },
    });

    if (lc.grnId) {
      await importGrnService.applyLandedCostToGrn(tx, {
        companyId,
        grnId: lc.grnId,
        items: lc.items || [],
      });
    }

    if (lc.importPoId) {
      await tx.importPurchaseOrder.update({
        where: { id: lc.importPoId },
        data: { status: 'Costed' },
      }).catch(() => { });
    }

    await logImportAudit({
      companyId,
      action: 'POST_ACCOUNTING',
      entityType: 'LANDED_COST',
      entityId: id,
      details: { journalEntryId: journalEntry.id, entryNumber, amount: landedExpenseAmount },
      userId,
    });

    return {
      success: true,
      message: 'Landed cost successfully capitalized and posted to General Ledger',
      journalEntry,
      landedCost: updatedLc,
    };
  });
}

async function listFinanceLcs(req, query = {}) {
  const companyScope = getCompanyScope(req);
  const { search, status } = query;
  const normalizedStatus =
    status && status !== 'All' ? importEnterprise.normalizeLcStatus(status) : null;

  const where = {
    companyId: companyScope,
    ...(normalizedStatus
      ? {
          OR: [
            { status: normalizedStatus },
            ...(normalizedStatus === 'Draft' ? [{ status: 'Application Submitted' }] : []),
            ...(normalizedStatus === 'Paid/Settled' ? [{ status: 'Settled' }] : []),
          ],
        }
      : {}),
    ...(search
      ? {
        OR: [
          { lcNumber: { contains: search, mode: 'insensitive' } },
          { poRef: { contains: search, mode: 'insensitive' } },
          { piRef: { contains: search, mode: 'insensitive' } },
          { issuingBank: { contains: search, mode: 'insensitive' } },
          { beneficiary: { contains: search, mode: 'insensitive' } },
        ],
      }
      : {}),
  };

  const rows = await prisma.importFinanceLc.findMany({
    where,
    include: { importPo: true },
    orderBy: { issuanceDate: 'desc' },
  });
  return rows.map((lc) => importEnterprise.enrichFinanceLc(lc));
}

async function createFinanceLc(req, data) {
  return importEnterprise.createFinanceLcEnterprise(req, data);
}

async function getFinanceLcById(req, id) {
  return importEnterprise.getFinanceLcById(req, id);
}

async function listEligibleFinancePos(req, query = {}) {
  return importEnterprise.listEligibleFinancePos(req, query);
}

async function amendFinanceLc(req, id, data) {
  return importEnterprise.amendFinanceLc(req, id, data || {});
}

// ============================================================
// 11. SUPPLIER BILLS & ACCOUNTS PAYABLE
// ============================================================
async function listSupplierBills(req, query = {}) {
  const companyScope = getCompanyScope(req);
  const { search, status } = query;

  const where = {
    companyId: companyScope,
    ...(status && status !== 'All' ? { status } : {}),
    ...(search
      ? {
        OR: [
          { billNumber: { contains: search, mode: 'insensitive' } },
          { poRef: { contains: search, mode: 'insensitive' } },
          { supplierName: { contains: search, mode: 'insensitive' } },
        ],
      }
      : {}),
  };

  return await prisma.importSupplierBill.findMany({
    where,
    include: { importPo: true, purchaseInvoice: true, items: true },
    orderBy: { billDate: 'desc' },
  });
}

async function createSupplierBill(req, data) {
  return importEnterprise.createSupplierBillEnterprise(req, data);
}

async function recordBillPayment(req, id, data) {
  return importEnterprise.recordBillPaymentEnterprise(req, id, data || {});
}

async function postSupplierBill(req, id) {
  return importEnterprise.postSupplierBillEnterprise(req, id);
}

async function getSupplierBillById(req, id) {
  return importEnterprise.getSupplierBillById(req, id);
}

// ============================================================
// 12. IMPORT SETTINGS
// ============================================================
async function getSettings(req) {
  const companyId = requireSingleCompany(req);
  let setting = await prisma.importSetting.findUnique({ where: { companyId } });
  if (!setting) {
    setting = await prisma.importSetting.create({
      data: {
        companyId,
        defaultIncoterm: 'CIF',
        defaultCurrency: 'USD',
        defaultPortOfEntry: 'Jebel Ali Port (AEJEA)',
        autoCreatePurchaseOrder: true,
        requireSeparateRfqApprover: true,
        requireSeparateLcApprover: true,
        requireSeparateCustomsAssessor: true,
        requireSeparateCustomsPayer: true,
        blockInsufficientBalance: true,
        dutyPaymentDifferenceThresholdPct: 5,
        requirePhysicalOriginalBl: true,
        allowGrnBeforeCustomsRelease: false,
        requireSeparateGrnPoster: true,
        defaultCustomsDutyRatePct: 10,
        defaultImportVatRatePct: 5,
        companyCountryCode: 'PK',
      },
    });
  }
  return setting;
}

async function updateSettings(req, data) {
  const companyId = requireSingleCompany(req);
  return await prisma.importSetting.upsert({
    where: { companyId },
    create: {
      companyId,
      defaultIncoterm: data.defaultIncoterm || 'CIF',
      defaultCurrency: data.defaultCurrency || 'USD',
      defaultCustomsBroker: data.defaultCustomsBroker || null,
      defaultPortOfEntry: data.defaultPortOfEntry || null,
      autoCreatePurchaseOrder: data.autoCreatePurchaseOrder !== false,
      defaultReceivingLocationId: data.defaultReceivingLocationId || null,
      clearingAccountId: data.clearingAccountId || null,
      customsDutyAccountId: data.customsDutyAccountId || null,
      freightAccountId: data.freightAccountId || null,
      insuranceAccountId: data.insuranceAccountId || null,
      handlingAccountId: data.handlingAccountId || null,
      inventoryAssetAccountId: data.inventoryAssetAccountId || null,
      requireSeparateRfqApprover: data.requireSeparateRfqApprover !== false,
      requireSeparateLcApprover: data.requireSeparateLcApprover !== false,
      requireSeparateCustomsAssessor: data.requireSeparateCustomsAssessor !== false,
      requireSeparateCustomsPayer: data.requireSeparateCustomsPayer !== false,
      blockInsufficientBalance: data.blockInsufficientBalance !== false,
      dutyPaymentDifferenceThresholdPct:
        data.dutyPaymentDifferenceThresholdPct != null
          ? Number(data.dutyPaymentDifferenceThresholdPct)
          : 5,
      requirePhysicalOriginalBl: data.requirePhysicalOriginalBl !== false,
      allowGrnBeforeCustomsRelease: data.allowGrnBeforeCustomsRelease === true,
      requireSeparateGrnPoster: data.requireSeparateGrnPoster !== false,
      defaultCustomsDutyRatePct: data.defaultCustomsDutyRatePct != null ? Number(data.defaultCustomsDutyRatePct) : 10,
      defaultImportVatRatePct: data.defaultImportVatRatePct != null ? Number(data.defaultImportVatRatePct) : 5,
      companyCountryCode: data.companyCountryCode || 'PK',
      additionalDutyAccountId: data.additionalDutyAccountId || null,
      regulatoryDutyAccountId: data.regulatoryDutyAccountId || null,
      importVatAccountId: data.importVatAccountId || null,
      advanceIncomeTaxAccountId: data.advanceIncomeTaxAccountId || null,
      clearingBrokerAccountId: data.clearingBrokerAccountId || null,
    },
    update: {
      defaultIncoterm: data.defaultIncoterm,
      defaultCurrency: data.defaultCurrency,
      defaultCustomsBroker: data.defaultCustomsBroker,
      defaultPortOfEntry: data.defaultPortOfEntry,
      autoCreatePurchaseOrder: data.autoCreatePurchaseOrder,
      defaultReceivingLocationId: data.defaultReceivingLocationId,
      clearingAccountId: data.clearingAccountId,
      customsDutyAccountId: data.customsDutyAccountId,
      additionalDutyAccountId: data.additionalDutyAccountId,
      regulatoryDutyAccountId: data.regulatoryDutyAccountId,
      importVatAccountId: data.importVatAccountId,
      advanceIncomeTaxAccountId: data.advanceIncomeTaxAccountId,
      freightAccountId: data.freightAccountId,
      insuranceAccountId: data.insuranceAccountId,
      handlingAccountId: data.handlingAccountId,
      clearingBrokerAccountId: data.clearingBrokerAccountId,
      inventoryAssetAccountId: data.inventoryAssetAccountId,
      ...(data.requireSeparateRfqApprover !== undefined
        ? { requireSeparateRfqApprover: data.requireSeparateRfqApprover === true }
        : {}),
      ...(data.requireSeparateLcApprover !== undefined
        ? { requireSeparateLcApprover: data.requireSeparateLcApprover === true }
        : {}),
      ...(data.requireSeparateCustomsAssessor !== undefined
        ? { requireSeparateCustomsAssessor: data.requireSeparateCustomsAssessor === true }
        : {}),
      ...(data.requireSeparateCustomsPayer !== undefined
        ? { requireSeparateCustomsPayer: data.requireSeparateCustomsPayer === true }
        : {}),
      ...(data.blockInsufficientBalance !== undefined
        ? { blockInsufficientBalance: data.blockInsufficientBalance === true }
        : {}),
      ...(data.dutyPaymentDifferenceThresholdPct !== undefined
        ? { dutyPaymentDifferenceThresholdPct: Number(data.dutyPaymentDifferenceThresholdPct) }
        : {}),
      ...(data.requirePhysicalOriginalBl !== undefined
        ? { requirePhysicalOriginalBl: data.requirePhysicalOriginalBl === true }
        : {}),
      ...(data.allowGrnBeforeCustomsRelease !== undefined
        ? { allowGrnBeforeCustomsRelease: data.allowGrnBeforeCustomsRelease === true }
        : {}),
      ...(data.requireSeparateGrnPoster !== undefined
        ? { requireSeparateGrnPoster: data.requireSeparateGrnPoster === true }
        : {}),
      ...(data.defaultCustomsDutyRatePct !== undefined
        ? { defaultCustomsDutyRatePct: Number(data.defaultCustomsDutyRatePct) }
        : {}),
      ...(data.defaultImportVatRatePct !== undefined
        ? { defaultImportVatRatePct: Number(data.defaultImportVatRatePct) }
        : {}),
      ...(data.companyCountryCode !== undefined
        ? { companyCountryCode: data.companyCountryCode || null }
        : {}),
    },
  });
}

// ============================================================
// 13. IMPORT REPORTS & ANALYTICS
// ============================================================
async function getReports(req, query = {}) {
  const companyScope = getCompanyScope(req);

  const [orders, shipments, landedCosts, bills] = await Promise.all([
    prisma.importPurchaseOrder.findMany({
      where: { companyId: companyScope },
      include: { items: true },
    }),
    prisma.importShipment.findMany({
      where: { companyId: companyScope },
    }),
    prisma.importLandedCost.findMany({
      where: { companyId: companyScope },
      include: { items: true },
    }),
    prisma.importSupplierBill.findMany({
      where: { companyId: companyScope },
    }),
  ]);

  // Spend by currency
  const spendByCurrency = {};
  for (const o of orders) {
    const curr = o.currency || 'USD';
    spendByCurrency[curr] = (spendByCurrency[curr] || 0) + toNumber(o.subtotalForeign);
  }

  // Orders by Incoterm
  const ordersByIncoterm = {};
  for (const o of orders) {
    const term = o.incoterm || 'CIF';
    ordersByIncoterm[term] = (ordersByIncoterm[term] || 0) + 1;
  }

  // Landed Cost Breakdown
  let totalFob = 0;
  let totalFreight = 0;
  let totalDuty = 0;
  let totalInsurance = 0;
  let totalPortHandling = 0;
  let totalClearing = 0;
  let totalInland = 0;

  for (const l of landedCosts) {
    totalFob += toNumber(l.purchaseFobTotalUsd);
    totalFreight += toNumber(l.oceanFreightUsd);
    totalDuty += toNumber(l.customsDutyUsd);
    totalInsurance += toNumber(l.marineInsuranceUsd);
    totalPortHandling += toNumber(l.portDemurrageAndHandlingUsd);
    totalClearing += toNumber(l.clearingAgencyChargesUsd);
    totalInland += toNumber(l.inlandTransportationUsd);
  }

  return {
    summary: {
      totalOrders: orders.length,
      totalShipments: shipments.length,
      totalLandedCostsCalculated: landedCosts.length,
      totalSupplierBills: bills.length,
    },
    spendByCurrency,
    ordersByIncoterm,
    landedCostBreakdown: {
      purchaseFobTotal: Math.round(totalFob * 100) / 100,
      oceanFreightTotal: Math.round(totalFreight * 100) / 100,
      customsDutyTotal: Math.round(totalDuty * 100) / 100,
      marineInsuranceTotal: Math.round(totalInsurance * 100) / 100,
      portHandlingTotal: Math.round(totalPortHandling * 100) / 100,
      clearingAgencyTotal: Math.round(totalClearing * 100) / 100,
      inlandTransportationTotal: Math.round(totalInland * 100) / 100,
      totalLandedExpenses: Math.round((totalFreight + totalDuty + totalInsurance + totalPortHandling + totalClearing + totalInland) * 100) / 100,
    },
    orders,
    shipments,
    landedCosts,
    bills,
  };
}

async function listQuotations(req, query = {}) {
  const companyScope = getCompanyScope(req);
  const { rfqId, status } = query;
  if (!rfqId) {
    const err = new Error('rfqId is required');
    err.status = 400;
    throw err;
  }
  const rfq = await prisma.importRfq.findFirst({
    where: { id: rfqId, companyId: companyScope },
  });
  if (!rfq) {
    const err = new Error('Import RFQ not found');
    err.status = 404;
    throw err;
  }
  return prisma.importSupplierQuotation.findMany({
    where: {
      companyId: companyScope,
      rfqId,
      ...(status && status !== 'All' ? { status } : {}),
    },
    include: { items: true, supplier: true },
    orderBy: { totalUsd: 'asc' },
  });
}

async function createQuotation(req, data) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;
  const rfqId = data.rfqId;
  if (!rfqId) {
    const err = new Error('rfqId is required');
    err.status = 400;
    throw err;
  }
  const rfq = await prisma.importRfq.findFirst({
    where: { id: rfqId, companyId },
    include: { items: true, quotations: true },
  });
  if (!rfq) {
    const err = new Error('Import RFQ not found for active company');
    err.status = 404;
    throw err;
  }

  const rfqStatus = normalizeRfqStatus(rfq.status);
  if (rfqStatus === 'Draft') {
    const err = new Error('Send the RFQ first (Draft → Sent) before recording supplier quotations');
    err.status = 400;
    err.code = 'RFQ_NOT_SENT';
    throw err;
  }
  if (!QUOTATION_OPEN_STATUSES.includes(rfqStatus)) {
    const err = new Error(
      rfqStatus === 'Awarded'
        ? 'RFQ is awarded; quotations are locked'
        : `RFQ is ${rfqStatus}; quotations are locked`
    );
    err.status = 400;
    err.code = 'QUOTATIONS_LOCKED';
    throw err;
  }

  let supplierName = data.supplierName || '';
  let supplierCountry = data.supplierCountry || '';
  if (data.supplierId) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: data.supplierId, companyId },
    });
    if (!supplier) {
      const err = new Error('Supplier does not belong to the active company');
      err.status = 400;
      throw err;
    }
    supplierName = supplier.name;
    supplierCountry = supplier.country || supplierCountry;
  }
  if (!supplierName) {
    const err = new Error('Supplier is required for a quotation');
    err.status = 400;
    throw err;
  }

  const year = new Date().getFullYear();
  const prefix = `ISQ-${year}-`;
  const existingQ = await prisma.importSupplierQuotation.findMany({
    where: { companyId, quotationNumber: { startsWith: prefix } },
    select: { quotationNumber: true },
  });
  let maxQ = 0;
  for (const row of existingQ) {
    const m = String(row.quotationNumber).match(/ISQ-\d{4}-(\d+)$/i);
    if (m) maxQ = Math.max(maxQ, Number(m[1]) || 0);
  }
  const quotationNumber = data.quotationNumber || `${prefix}${String(maxQ + 1).padStart(3, '0')}`;

  // Prices must come from the quotation payload — never copy RFQ target prices
  let rawItems = Array.isArray(data.items) ? data.items : [];
  if (!rawItems.length && (data.unitPrice != null || data.quotedUnitPrice != null)) {
    const base = rfq.items[0];
    if (!base) {
      const err = new Error('RFQ has no product lines to quote against');
      err.status = 400;
      throw err;
    }
    rawItems = [
      {
        productId: base.productId,
        productName: base.productName,
        sku: base.sku,
        quantity: data.quantity != null ? data.quantity : base.quantity,
        uom: base.uom,
        unitPrice: data.unitPrice ?? data.quotedUnitPrice,
      },
    ];
  }
  if (!rawItems.length) {
    const err = new Error('Quotation requires line items with unitPrice (do not reuse target price)');
    err.status = 400;
    err.code = 'QUOTE_ITEMS_REQUIRED';
    throw err;
  }

  const currency = String(data.currency || '').trim().toUpperCase();
  if (!currency) {
    const err = new Error('Quotation currency is required');
    err.status = 400;
    err.code = 'QUOTE_CURRENCY_REQUIRED';
    throw err;
  }

  const leadTimeDays = Number(data.leadTimeDays);
  if (!Number.isFinite(leadTimeDays) || leadTimeDays < 0 || String(data.leadTimeDays ?? '').trim() === '') {
    const err = new Error('Lead time (days) is required');
    err.status = 400;
    err.code = 'QUOTE_LEAD_TIME_REQUIRED';
    throw err;
  }

  const paymentTerms = data.paymentTerms != null ? String(data.paymentTerms).trim() : '';
  if (!paymentTerms) {
    const err = new Error('Payment terms are required');
    err.status = 400;
    err.code = 'QUOTE_PAYMENT_TERMS_REQUIRED';
    throw err;
  }

  if (!data.validUntil) {
    const err = new Error('Validity date is required');
    err.status = 400;
    err.code = 'QUOTE_VALIDITY_REQUIRED';
    throw err;
  }
  const validUntil = new Date(data.validUntil);
  if (Number.isNaN(validUntil.getTime()) || validUntil < startOfToday()) {
    const err = new Error('Validity date must be today or a future date');
    err.status = 400;
    err.code = 'QUOTE_VALIDITY_INVALID';
    throw err;
  }

  let totalForeign = 0;
  const itemsData = rawItems.map((it) => {
    const qty = toNumber(it.quantity, 0);
    const price = toNumber(it.unitPrice ?? it.quotedUnitPrice, 0);
    if (!(qty > 0) || !(price > 0)) {
      const err = new Error(
        `Each quotation line needs qty > 0 and unitPrice > 0 (got qty=${qty}, unitPrice=${price} for ${it.productName || 'line'})`
      );
      err.status = 400;
      throw err;
    }
    const lineTotal = qty * price;
    totalForeign += lineTotal;
    return {
      productId: it.productId || null,
      productName: it.productName || 'Import Product',
      sku: it.sku || null,
      quantity: qty,
      uom: it.uom || 'PCS',
      unitPrice: price,
      lineTotal,
      moq: toNumber(it.moq, 0),
      leadTimeDays: Number(it.leadTimeDays ?? leadTimeDays) || leadTimeDays,
    };
  });

  const freight = toNumber(data.freightEstimateUsd, 0);
  const fx = await resolveImportExchangeRate({
    companyId,
    currencyCode: currency,
    foreignAmount: totalForeign,
    explicitRate: data.exchangeRateToUsd ?? data.exchangeRate,
    allowExplicitRate: true,
    asOfDate: data.quotationDate || new Date(),
  });

  const incomingKey = supplierKeyForQuote({
    supplierId: data.supplierId || null,
    supplierName,
  });
  const priorActive = activeQuotations(rfq.quotations || []).find(
    (q) => supplierKeyForQuote(q) === incomingKey
  );
  const revision = priorActive ? (Number(priorActive.revision) || 1) + 1 : 1;

  const quotation = await prisma.$transaction(async (tx) => {
    if (priorActive) {
      await tx.importSupplierQuotation.update({
        where: { id: priorActive.id },
        data: { status: 'Superseded' },
      });
    }

    const created = await tx.importSupplierQuotation.create({
      data: {
        companyId,
        rfqId,
        quotationNumber,
        supplierId: data.supplierId || null,
        supplierName,
        supplierCountry,
        quotationDate: data.quotationDate ? new Date(data.quotationDate) : new Date(),
        validUntil,
        currency,
        exchangeRateToUsd: fx.exchangeRate,
        incoterm: data.incoterm || rfq.incoterm || 'CIF',
        paymentTerms,
        leadTimeDays,
        freightEstimateUsd: freight,
        totalForeign,
        totalUsd: fx.baseAmount,
        estimatedLandedUsd: Math.round((fx.baseAmount + freight) * 100) / 100,
        status: 'Received',
        revision,
        supersedesId: priorActive ? priorActive.id : null,
        notes: data.notes || null,
        negotiationHistory: data.negotiationHistory || [],
        createdBy: userId,
        items: { create: itemsData },
      },
      include: { items: true },
    });

    if (priorActive) {
      await tx.importSupplierQuotation.update({
        where: { id: priorActive.id },
        data: { supersededById: created.id },
      });
    }

    const allQuotes = await tx.importSupplierQuotation.findMany({
      where: { rfqId, companyId },
      select: { id: true, status: true, supplierId: true, supplierName: true },
    });
    const distinctSuppliers = countDistinctActiveSuppliers(allQuotes);

    let nextStatus = null;
    if (['Draft', 'Sent'].includes(rfqStatus)) {
      nextStatus = 'Quotes Received';
    } else if (rfqStatus === 'Quotes Received' && distinctSuppliers >= 2) {
      nextStatus = 'Under Comparison';
    }
    if (nextStatus) {
      assertRfqStatusTransition(rfqStatus, nextStatus);
      await tx.importRfq.update({
        where: { id: rfqId },
        data: { status: nextStatus },
      });
      await tx.importAuditLog.create({
        data: {
          companyId,
          action: 'STATUS_CHANGE',
          entityType: 'IMPORT_RFQ',
          entityId: rfqId,
          details: {
            previousStatus: rfqStatus,
            nextStatus,
            reason: priorActive ? 'quotation_revision' : 'quotation_received',
            quotationId: created.id,
            revision,
            supersededQuotationId: priorActive?.id,
            userId,
            at: new Date().toISOString(),
          },
          userId,
        },
      }).catch(() => {});
    }

    return created;
  });

  await logImportAudit({
    companyId,
    action: priorActive ? 'REVISE' : 'CREATE',
    entityType: 'IMPORT_QUOTATION',
    entityId: quotation.id,
    details: {
      quotationNumber,
      rfqId,
      totalForeign,
      currency,
      revision,
      supersedesId: priorActive?.id,
    },
    userId,
  });

  return quotation;
}

async function selectQuotation(req, id, data = {}) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;
  const body = data && typeof data === 'object' ? data : {};
  const quotation = await prisma.importSupplierQuotation.findFirst({
    where: { id, companyId },
    include: {
      items: true,
      rfq: { include: { items: true, quotations: true } },
    },
  });
  if (!quotation) {
    const err = new Error('Supplier quotation not found');
    err.status = 404;
    throw err;
  }

  if (!isActiveQuotation(quotation)) {
    const err = new Error(
      `Cannot award a ${quotation.status} quotation. Only active (non-superseded) quotations can be awarded.`
    );
    err.status = 400;
    err.code = 'QUOTE_INACTIVE';
    throw err;
  }

  const rfqStatus = normalizeRfqStatus(quotation.rfq?.status);
  if (rfqStatus === 'Approved' || rfqStatus === 'Converted to PO') {
    const err = new Error(
      rfqStatus === 'Approved'
        ? 'RFQ is approved; awarding is locked. Use Reopen RFQ with a reason before changing the award.'
        : 'RFQ already converted to PO; awarding is locked.'
    );
    err.status = 400;
    err.code = 'AWARD_LOCKED';
    throw err;
  }
  if (!['Quotes Received', 'Under Comparison', 'Awarded'].includes(rfqStatus)) {
    const err = new Error(
      `Cannot award quotation while RFQ is "${rfqStatus}". Move to Quotes Received / Under Comparison first.`
    );
    err.status = 400;
    throw err;
  }

  const isChangeAward =
    rfqStatus === 'Awarded' &&
    quotation.rfq?.selectedQuotationId &&
    quotation.rfq.selectedQuotationId !== id;

  const changeReason = String(
    body.changeReason || body.reason || body.awardChangeReason || ''
  ).trim();
  if (isChangeAward && !changeReason) {
    const err = new Error('A reason is required to change the awarded quotation');
    err.status = 400;
    err.code = 'CHANGE_AWARD_REASON_REQUIRED';
    throw err;
  }

  const distinctSuppliers = countDistinctActiveSuppliers(quotation.rfq?.quotations || []);
  let singleSourceJustification =
    body.singleSourceJustification != null
      ? String(body.singleSourceJustification).trim()
      : quotation.rfq?.singleSourceJustification
        ? String(quotation.rfq.singleSourceJustification).trim()
        : '';
  if (distinctSuppliers < 2) {
    if (!singleSourceJustification) {
      const err = new Error(
        'Single-source justification is required when fewer than 2 distinct suppliers have active quotations.'
      );
      err.status = 400;
      err.code = 'SINGLE_SOURCE_JUSTIFICATION_REQUIRED';
      throw err;
    }
  } else if (!isChangeAward) {
    singleSourceJustification = singleSourceJustification || null;
  }

  const previousSelectedId = quotation.rfq?.selectedQuotationId || null;

  await prisma.$transaction(async (tx) => {
    let fromStatus = rfqStatus;
    if (fromStatus === 'Quotes Received') {
      assertRfqStatusTransition(fromStatus, 'Under Comparison');
      await tx.importRfq.update({
        where: { id: quotation.rfqId },
        data: { status: 'Under Comparison' },
      });
      await tx.importAuditLog.create({
        data: {
          companyId,
          action: 'STATUS_CHANGE',
          entityType: 'IMPORT_RFQ',
          entityId: quotation.rfqId,
          details: {
            previousStatus: 'Quotes Received',
            nextStatus: 'Under Comparison',
            reason: 'pre_award',
            userId,
            at: new Date().toISOString(),
          },
          userId,
        },
      }).catch(() => {});
      fromStatus = 'Under Comparison';
    }
    if (fromStatus !== 'Awarded') {
      assertRfqStatusTransition(fromStatus, 'Awarded');
    }

    if (isChangeAward && previousSelectedId) {
      await tx.importSupplierQuotation.update({
        where: { id: previousSelectedId },
        data: { status: 'Received' },
      });
    } else if (!isChangeAward) {
      // Initial award: mark other active quotes Rejected (keep Superseded as-is)
      const others = (quotation.rfq?.quotations || []).filter(
        (q) => q.id !== id && isActiveQuotation(q)
      );
      for (const other of others) {
        await tx.importSupplierQuotation.update({
          where: { id: other.id },
          data: { status: 'Rejected' },
        });
      }
    }

    await tx.importSupplierQuotation.update({
      where: { id },
      data: { status: 'Selected' },
    });

    const rfqItems = quotation.rfq?.items || [];
    for (const qItem of quotation.items || []) {
      const match =
        rfqItems.find((r) => qItem.productId && r.productId === qItem.productId) ||
        rfqItems.find((r) => r.productName === qItem.productName);
      if (match) {
        await tx.importRfqItem.update({
          where: { id: match.id },
          data: { quotedPriceUsd: toNumber(qItem.unitPrice, 0) },
        });
      }
    }

    const awardAt = new Date();
    await tx.importRfq.update({
      where: { id: quotation.rfqId },
      data: {
        status: 'Awarded',
        selectedQuotationId: id,
        supplierId: quotation.supplierId,
        supplierName: quotation.supplierName,
        supplierCountry: quotation.supplierCountry,
        countryOfDispatch: quotation.supplierCountry || quotation.rfq?.countryOfDispatch || null,
        incoterm: quotation.incoterm,
        currency: quotation.currency,
        awardedBy: userId,
        awardedAt: awardAt,
        singleSourceJustification: singleSourceJustification || null,
      },
    });

    await tx.importAuditLog.create({
      data: {
        companyId,
        action: isChangeAward ? 'CHANGE_AWARD' : 'STATUS_CHANGE',
        entityType: 'IMPORT_RFQ',
        entityId: quotation.rfqId,
        details: {
          previousStatus: fromStatus,
          nextStatus: 'Awarded',
          awardedQuotationId: id,
          previousQuotationId: previousSelectedId || undefined,
          reason: isChangeAward ? changeReason : undefined,
          singleSourceJustification: singleSourceJustification || undefined,
          userId,
          at: awardAt.toISOString(),
        },
        userId,
      },
    }).catch(() => {});
  });

  await logImportAudit({
    companyId,
    action: isChangeAward ? 'CHANGE_AWARD' : 'SELECT_QUOTATION',
    entityType: 'IMPORT_QUOTATION',
    entityId: id,
    details: {
      rfqId: quotation.rfqId,
      awarded: true,
      changeReason: isChangeAward ? changeReason : undefined,
      previousQuotationId: previousSelectedId || undefined,
      singleSourceJustification: singleSourceJustification || undefined,
    },
    userId,
  });

  return prisma.importSupplierQuotation.findUnique({
    where: { id },
    include: { items: true, rfq: { include: { items: true, port: true } } },
  });
}

/**
 * Resolve active company user IDs that effectively hold a permission
 * (role grants, overrides, or admin/owner). Optionally exclude users.
 */
async function findCompanyUserIdsWithPermission(companyId, permissionKey, { excludeUserIds = [] } = {}) {
  const exclude = new Set((excludeUserIds || []).map((id) => String(id || '').trim()).filter(Boolean));

  const [memberships, directUsers] = await Promise.all([
    prisma.companyMembership.findMany({
      where: { companyId, isActive: true },
      select: {
        userId: true,
        role: true,
        isOwner: true,
        user: { select: { id: true, isActive: true, email: true, role: true } },
      },
    }),
    prisma.user.findMany({
      where: { companyId, isActive: true },
      select: { id: true, email: true, role: true },
    }),
  ]);

  const candidates = new Map();
  for (const m of memberships) {
    if (!m.user?.isActive) continue;
    candidates.set(String(m.userId), {
      id: String(m.userId),
      email: m.user.email,
      role: m.user.role,
      membershipRole: m.role,
      isOwner: Boolean(m.isOwner),
    });
  }
  for (const u of directUsers) {
    if (!candidates.has(String(u.id))) {
      candidates.set(String(u.id), {
        id: String(u.id),
        email: u.email,
        role: u.role,
        membershipRole: null,
        isOwner: false,
      });
    }
  }

  const results = [];
  for (const candidate of candidates.values()) {
    if (exclude.has(candidate.id)) continue;
    if (
      candidate.isOwner ||
      isAdminRole(candidate.membershipRole) ||
      isAdminRole(candidate.role) ||
      isPlatformAdmin(candidate.email)
    ) {
      results.push(candidate.id);
      continue;
    }
    const allowed = await hasPermission(candidate.id, companyId, permissionKey);
    if (allowed) results.push(candidate.id);
  }
  return [...new Set(results)];
}

/**
 * Awarded → Pending Approval. Notifies users with import.rfqs.approve.
 */
async function submitRfqForApproval(req, id) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;

  const rfq = await prisma.importRfq.findFirst({
    where: { id, companyId },
    include: {
      items: true,
      port: true,
      quotations: { include: { items: true } },
      purchaseOrders: { select: { id: true, poNumber: true, status: true } },
    },
  });
  if (!rfq) {
    const err = new Error('Import RFQ not found');
    err.status = 404;
    throw err;
  }

  const status = normalizeRfqStatus(rfq.status);
  assertRfqStatusTransition(status, 'Pending Approval');

  if (!rfq.selectedQuotationId) {
    const err = new Error('Cannot submit for approval without an awarded supplier quotation');
    err.status = 400;
    err.code = 'QUOTATION_REQUIRED';
    throw err;
  }

  const updated = await prisma.importRfq.update({
    where: { id },
    data: { status: 'Pending Approval' },
    include: {
      items: true,
      port: true,
      quotations: { include: { items: true } },
      purchaseOrders: { select: { id: true, poNumber: true, status: true } },
    },
  });

  await logImportAudit({
    companyId,
    action: 'STATUS_CHANGE',
    entityType: 'IMPORT_RFQ',
    entityId: id,
    details: {
      previousStatus: status,
      nextStatus: 'Pending Approval',
      action: 'SUBMIT_FOR_APPROVAL',
      userId,
      at: new Date().toISOString(),
    },
    userId,
  });

  try {
    const approverIds = await findCompanyUserIdsWithPermission(companyId, RFQ_APPROVE_PERMISSION, {
      excludeUserIds: [userId],
    });
    if (approverIds.length) {
      await sendToUsers(approverIds, {
        title: 'RFQ awaiting approval',
        message: `${rfq.rfqNumber} supplier quotation is ready for approval.`,
        type: 'action',
        category: 'Import',
        data: {
          entityType: 'IMPORT_RFQ',
          entityId: id,
          rfqId: id,
          rfqNumber: rfq.rfqNumber,
          link: '/import/approvals',
        },
      });
    }
  } catch (notifyErr) {
    console.error('[import] RFQ approval notification failed:', notifyErr.message);
  }

  return serializeRfq(updated);
}

/**
 * Pending Approval → Approved. Requires import.rfqs.approve (enforced at route).
 */
async function approveRfq(req, id) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;

  const rfq = await prisma.importRfq.findFirst({
    where: { id, companyId },
  });
  if (!rfq) {
    const err = new Error('Import RFQ not found');
    err.status = 404;
    throw err;
  }

  const status = normalizeRfqStatus(rfq.status);
  assertRfqStatusTransition(status, 'Approved');

  if (!rfq.selectedQuotationId) {
    const err = new Error('Cannot approve RFQ without an awarded supplier quotation');
    err.status = 400;
    err.code = 'QUOTATION_REQUIRED';
    throw err;
  }

  const settings = await getSettings(req);
  const requireSeparate = settings.requireSeparateRfqApprover !== false;
  if (requireSeparate && rfq.awardedBy && rfq.awardedBy === userId) {
    const err = new Error(
      'Award and approval must be done by different users. The user who awarded this RFQ cannot approve it.'
    );
    err.status = 403;
    err.code = 'SEPARATE_APPROVER_REQUIRED';
    throw err;
  }

  await prisma.importRfq.update({
    where: { id },
    data: {
      status: 'Approved',
      approvedBy: userId,
      approvedAt: new Date(),
    },
  });

  await logImportAudit({
    companyId,
    action: 'STATUS_CHANGE',
    entityType: 'IMPORT_RFQ',
    entityId: id,
    details: {
      previousStatus: status,
      nextStatus: 'Approved',
      action: 'APPROVE',
      userId,
      at: new Date().toISOString(),
    },
    userId,
  });

  try {
    const notifyUserId = rfq.awardedBy || rfq.createdBy;
    if (notifyUserId && notifyUserId !== userId) {
      await sendToUser({
        mongoUserId: notifyUserId,
        title: 'RFQ approved',
        message: `${rfq.rfqNumber} was approved. You can convert it to a purchase order.`,
        type: 'success',
        category: 'Import',
        data: {
          entityType: 'IMPORT_RFQ',
          entityId: id,
          rfqId: id,
          rfqNumber: rfq.rfqNumber,
          link: `/import/rfqs?id=${id}`,
        },
      });
    }
  } catch (notifyErr) {
    console.error('[import] RFQ approved notification failed:', notifyErr.message);
  }

  return getRfqById(req, id);
}

/**
 * Pending Approval → Awarded (reject / send back). Optional reason in audit.
 */
async function rejectRfqApproval(req, id, data = {}) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;
  const reason = String(data.reason || data.rejectReason || '').trim() || null;

  const rfq = await prisma.importRfq.findFirst({
    where: { id, companyId },
  });
  if (!rfq) {
    const err = new Error('Import RFQ not found');
    err.status = 404;
    throw err;
  }

  const status = normalizeRfqStatus(rfq.status);
  assertRfqStatusTransition(status, 'Awarded');

  await prisma.importRfq.update({
    where: { id },
    data: {
      status: 'Awarded',
      approvedBy: null,
      approvedAt: null,
    },
  });

  await logImportAudit({
    companyId,
    action: 'STATUS_CHANGE',
    entityType: 'IMPORT_RFQ',
    entityId: id,
    details: {
      previousStatus: status,
      nextStatus: 'Awarded',
      action: 'REJECT_APPROVAL',
      reason: reason || undefined,
      userId,
      at: new Date().toISOString(),
    },
    userId,
  });

  try {
    const notifyUserId = rfq.awardedBy || rfq.createdBy;
    if (notifyUserId && notifyUserId !== userId) {
      await sendToUser({
        mongoUserId: notifyUserId,
        title: 'RFQ approval rejected',
        message: reason
          ? `${rfq.rfqNumber} was sent back: ${reason}`
          : `${rfq.rfqNumber} was sent back to Awarded. Review and resubmit.`,
        type: 'warning',
        category: 'Import',
        data: {
          entityType: 'IMPORT_RFQ',
          entityId: id,
          rfqId: id,
          rfqNumber: rfq.rfqNumber,
          link: `/import/rfqs?id=${id}`,
        },
      });
    }
  } catch (notifyErr) {
    console.error('[import] RFQ reject notification failed:', notifyErr.message);
  }

  return getRfqById(req, id);
}

/**
 * Approval inbox: pending RFQs + customs clearances (and optional recent approved).
 */
async function listImportApprovals(req, query = {}) {
  const companyId = requireSingleCompany(req);
  const includeRecent = String(query.includeRecent || '').toLowerCase() === 'true';
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));

  const pending = await prisma.importRfq.findMany({
    where: { companyId, status: 'Pending Approval' },
    include: {
      items: true,
      supplier: true,
      port: true,
      quotations: { include: { items: true }, orderBy: { createdAt: 'desc' } },
      purchaseOrders: { select: { id: true, poNumber: true, status: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });

  const pendingCustoms = await prisma.importCustomsClearance.findMany({
    where: { companyId, clearanceStatus: 'Pending Approval' },
    include: { importPo: true, shipment: true, lines: true },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });

  const pendingAssessments = await prisma.importCustomsClearance.findMany({
    where: { companyId, clearanceStatus: 'Under Assessment' },
    include: { importPo: true, shipment: true, lines: true },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });

  const pendingPayments = await prisma.importCustomsClearance.findMany({
    where: { companyId, clearanceStatus: 'Pending Payment' },
    include: { importPo: true, shipment: true, lines: true },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });

  let recent = [];
  let recentCustoms = [];
  let recentAssessments = [];
  if (includeRecent) {
    recent = await prisma.importRfq.findMany({
      where: {
        companyId,
        status: { in: ['Approved', 'Awarded'] },
        approvedAt: { not: null },
      },
      include: {
        items: true,
        supplier: true,
        port: true,
        quotations: { include: { items: true }, orderBy: { createdAt: 'desc' } },
        purchaseOrders: { select: { id: true, poNumber: true, status: true } },
      },
      orderBy: { approvedAt: 'desc' },
      take: Math.min(20, limit),
    });
    recentCustoms = await prisma.importCustomsClearance.findMany({
      where: {
        companyId,
        clearanceStatus: { in: ['Approved', 'Released/Cleared'] },
        approvedAt: { not: null },
      },
      include: { importPo: true, shipment: true, lines: true },
      orderBy: { approvedAt: 'desc' },
      take: Math.min(20, limit),
    });
    recentAssessments = await prisma.importCustomsClearance.findMany({
      where: {
        companyId,
        clearanceStatus: { in: ['Assessed', 'Partially Paid', 'Duty Paid'] },
        assessedAt: { not: null },
      },
      include: { importPo: true, shipment: true, lines: true },
      orderBy: { assessedAt: 'desc' },
      take: Math.min(20, limit),
    });
  }

  const importCustoms = require('./importCustomsService');
  const pendingCustomsOut = await Promise.all(
    pendingCustoms.map((r) => importCustoms.getCustomsClearanceById(req, r.id))
  );
  const recentCustomsOut = await Promise.all(
    recentCustoms.map((r) => importCustoms.getCustomsClearanceById(req, r.id))
  );
  const pendingAssessmentsOut = await Promise.all(
    pendingAssessments.map((r) => importCustoms.getCustomsClearanceById(req, r.id))
  );
  const recentAssessmentsOut = await Promise.all(
    recentAssessments.map((r) => importCustoms.getCustomsClearanceById(req, r.id))
  );
  const pendingPaymentsOut = await Promise.all(
    pendingPayments.map((r) => importCustoms.getCustomsClearanceById(req, r.id))
  );

  return {
    pending: pending.map((r) => serializeRfq(r)),
    recent: recent.map((r) => serializeRfq(r)),
    pendingCustoms: pendingCustomsOut,
    recentCustoms: recentCustomsOut,
    pendingAssessments: pendingAssessmentsOut,
    recentAssessments: recentAssessmentsOut,
    pendingPayments: pendingPaymentsOut,
  };
}

async function submitCustomsForApproval(req, id) {
  return importEnterprise.submitCustomsForApproval(req, id);
}

async function approveCustomsClearance(req, id) {
  return importEnterprise.approveCustomsClearance(req, id);
}

async function rejectCustomsApproval(req, id, data = {}) {
  return importEnterprise.rejectCustomsApproval(req, id, data || {});
}

/**
 * Reopen an Approved RFQ so award can be changed. Clears approval; requires reason.
 */
async function reopenRfq(req, id, data = {}) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;
  const reason = String(data.reason || data.reopenReason || '').trim();
  if (!reason) {
    const err = new Error('A reason is required to reopen an approved RFQ');
    err.status = 400;
    err.code = 'REOPEN_REASON_REQUIRED';
    throw err;
  }

  const rfq = await prisma.importRfq.findFirst({
    where: { id, companyId },
  });
  if (!rfq) {
    const err = new Error('Import RFQ not found');
    err.status = 404;
    throw err;
  }

  const status = normalizeRfqStatus(rfq.status);
  if (status !== 'Approved') {
    const err = new Error(`Only Approved RFQs can be reopened (current: ${status})`);
    err.status = 400;
    err.code = 'REOPEN_NOT_ALLOWED';
    throw err;
  }

  assertRfqStatusTransition('Approved', 'Awarded');
  await prisma.importRfq.update({
    where: { id },
    data: {
      status: 'Awarded',
      approvedBy: null,
      approvedAt: null,
    },
  });

  await logImportAudit({
    companyId,
    action: 'REOPEN',
    entityType: 'IMPORT_RFQ',
    entityId: id,
    details: {
      previousStatus: 'Approved',
      nextStatus: 'Awarded',
      reason,
      userId,
      at: new Date().toISOString(),
    },
    userId,
  });

  return getRfqById(req, id);
}

/**
 * Copy current product-master HS code onto an RFQ line (does not reopen / re-approve).
 * Allowed while RFQ is Draft … Approved (not Converted to PO / Cancelled / Expired).
 */
async function refreshRfqItemHsCode(req, rfqId, itemId) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;

  const rfq = await prisma.importRfq.findFirst({
    where: { id: rfqId, companyId },
    include: { items: true },
  });
  if (!rfq) {
    const err = new Error('Import RFQ not found');
    err.status = 404;
    throw err;
  }

  const status = normalizeRfqStatus(rfq.status);
  if (!RFQ_HS_REFRESH_STATUSES.includes(status)) {
    const err = new Error(
      `Cannot refresh HS codes while RFQ is "${status}". Line is locked after Convert to PO.`
    );
    err.status = 400;
    err.code = 'HS_REFRESH_LOCKED';
    throw err;
  }

  const item = (rfq.items || []).find((it) => it.id === itemId);
  if (!item) {
    const err = new Error('RFQ line item not found');
    err.status = 404;
    throw err;
  }
  if (!item.productId) {
    const err = new Error('This RFQ line has no linked product to refresh HS code from');
    err.status = 400;
    err.code = 'NO_PRODUCT';
    throw err;
  }

  const product = await prisma.product.findFirst({
    where: { id: item.productId, companyId },
    select: { id: true, hsCode: true, name: true },
  });
  if (!product) {
    const err = new Error('Linked product not found for active company');
    err.status = 404;
    throw err;
  }

  const masterHs = product.hsCode != null ? String(product.hsCode).trim() : '';
  if (!masterHs) {
    const err = new Error(
      `Product "${product.name || item.productName}" still has no HS code. Add it on the product master first.`
    );
    err.status = 400;
    err.code = 'PRODUCT_HS_MISSING';
    throw err;
  }
  if (!isValidHsCode(masterHs)) {
    const err = new Error(
      `Product HS code "${masterHs}" is invalid. Use 6–10 digits with optional dots.`
    );
    err.status = 400;
    err.code = 'INVALID_HS_CODE';
    throw err;
  }

  const previousHsCode = item.hsCode || null;
  if (previousHsCode && String(previousHsCode).trim() === masterHs) {
    return getRfqById(req, rfqId);
  }

  await prisma.importRfqItem.update({
    where: { id: item.id },
    data: { hsCode: masterHs },
  });

  await logImportAudit({
    companyId,
    action: 'UPDATE',
    entityType: 'IMPORT_RFQ',
    entityId: rfqId,
    details: {
      reason: 'HS code back-filled from product master',
      source: 'refresh_action',
      itemId: item.id,
      productId: item.productId,
      productName: item.productName,
      previousHsCode,
      nextHsCode: masterHs,
      userId,
      at: new Date().toISOString(),
    },
    userId,
  });

  return getRfqById(req, rfqId);
}

/**
 * Convert Approved RFQ with awarded quotation into Import PO.
 * Blocks duplicate conversion.
 */
async function convertRfqToPurchaseOrder(req, rfqId, data = {}) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;

  const rfq = await prisma.importRfq.findFirst({
    where: { id: rfqId, companyId },
    include: {
      items: true,
      port: true,
      purchaseOrders: true,
      quotations: { include: { items: true } },
    },
  });
  if (!rfq) {
    const err = new Error('Import RFQ not found');
    err.status = 404;
    throw err;
  }

  const status = normalizeRfqStatus(rfq.status);
  if (status === 'Converted to PO' || (rfq.purchaseOrders && rfq.purchaseOrders.length > 0)) {
    const existingPo = rfq.purchaseOrders[0];
    const err = new Error(
      `RFQ already converted${existingPo ? ` to ${existingPo.poNumber}` : ''}. Duplicate conversion is not allowed.`
    );
    err.status = 409;
    err.code = 'ALREADY_CONVERTED';
    err.existingPoNumber = existingPo?.poNumber;
    throw err;
  }

  if (status !== 'Approved') {
    const err = new Error(`RFQ must be Approved before conversion (current: ${status})`);
    err.status = 400;
    err.code = 'NOT_APPROVED';
    throw err;
  }

  if (!rfq.selectedQuotationId) {
    const err = new Error('RFQ has no awarded quotation — award a quotation before converting');
    err.status = 400;
    err.code = 'NO_AWARDED_QUOTATION';
    throw err;
  }

  // Resolve HS: RFQ line first, else product master (back-fill RFQ line + audit)
  const productIdsForHs = [
    ...new Set((rfq.items || []).map((it) => it.productId).filter(Boolean)),
  ];
  const productsForHs = productIdsForHs.length
    ? await prisma.product.findMany({
        where: { id: { in: productIdsForHs }, companyId },
        select: { id: true, hsCode: true, name: true },
      })
    : [];
  const productById = Object.fromEntries(productsForHs.map((p) => [p.id, p]));

  const resolvedHsByRfqItemId = {};
  const stillMissing = [];
  for (const it of rfq.items || []) {
    let hs =
      it.hsCode != null && String(it.hsCode).trim() !== ''
        ? String(it.hsCode).trim()
        : '';
    if (hs && !isValidHsCode(hs)) {
      const err = new Error(
        `Cannot convert to PO: invalid HS code "${hs}" on item "${it.productName}". Use 6–10 digits with optional dots.`
      );
      err.status = 400;
      err.code = 'INVALID_HS_CODE';
      throw err;
    }
    if (!hs && it.productId && productById[it.productId]?.hsCode) {
      const masterHs = String(productById[it.productId].hsCode).trim();
      if (masterHs && isValidHsCode(masterHs)) {
        const oldHs = it.hsCode || null;
        await prisma.importRfqItem.update({
          where: { id: it.id },
          data: { hsCode: masterHs },
        });
        it.hsCode = masterHs;
        hs = masterHs;
        await logImportAudit({
          companyId,
          action: 'UPDATE',
          entityType: 'IMPORT_RFQ',
          entityId: rfq.id,
          details: {
            reason: 'HS code back-filled from product master',
            itemId: it.id,
            productId: it.productId,
            productName: it.productName,
            previousHsCode: oldHs,
            nextHsCode: masterHs,
            userId,
            at: new Date().toISOString(),
          },
          userId,
        });
      }
    }
    if (!hs) {
      stillMissing.push(it);
    } else {
      resolvedHsByRfqItemId[it.id] = hs;
    }
  }
  if (stillMissing.length) {
    const names = stillMissing.map((it) => it.productName || 'item').join(', ');
    const err = new Error(
      `Cannot convert to PO: HS code missing for ${names}. Add a valid HS code (6–10 digits) on the product or RFQ item first.`
    );
    err.status = 400;
    err.code = 'HS_CODE_REQUIRED';
    err.items = stillMissing.map((it) => ({ id: it.id, productName: it.productName }));
    throw err;
  }

  const awarded =
    rfq.quotations.find((q) => q.id === rfq.selectedQuotationId) ||
    (await prisma.importSupplierQuotation.findFirst({
      where: { id: rfq.selectedQuotationId, companyId },
      include: { items: true },
    }));
  if (!awarded) {
    const err = new Error('Awarded quotation record not found');
    err.status = 400;
    throw err;
  }

  const poItems = (awarded.items || []).map((it) => {
    const rfqMatch =
      (rfq.items || []).find((r) => it.productId && r.productId === it.productId) ||
      (rfq.items || []).find((r) => r.productName === it.productName);
    const hsCode = rfqMatch
      ? resolvedHsByRfqItemId[rfqMatch.id] || rfqMatch.hsCode || null
      : null;
    return {
      productId: it.productId,
      productName: it.productName,
      sku: it.sku,
      hsCode,
      quantity: toNumber(it.quantity),
      uom: it.uom || 'PCS',
      unitPrice: toNumber(it.unitPrice),
      totalAmount: toNumber(it.lineTotal) || toNumber(it.quantity) * toNumber(it.unitPrice),
    };
  });
  if (!poItems.length) {
    const err = new Error('Awarded quotation has no line items');
    err.status = 400;
    throw err;
  }

  const port =
    (rfq.portId
      ? await prisma.importPort.findFirst({ where: { id: rfq.portId, isActive: true } })
      : null) ||
    (await resolveImportPort({
      portId: rfq.portId,
      portOfDischarge: rfq.portOfDischarge,
    }));
  const portOfEntry = port?.name || rfq.portOfDischarge || null;

  const importPo = await createPurchaseOrder(req, {
    rfqId: rfq.id,
    rfqRef: rfq.rfqNumber,
    quotationId: awarded.id,
    supplierId: awarded.supplierId || rfq.supplierId,
    supplierName: awarded.supplierName || rfq.supplierName,
    supplierCountry: awarded.supplierCountry || rfq.supplierCountry,
    originCountry: awarded.supplierCountry || rfq.countryOfDispatch || rfq.supplierCountry,
    incoterm: awarded.incoterm || rfq.incoterm,
    currency: awarded.currency || rfq.currency,
    exchangeRateToUsd: data.exchangeRateToUsd ?? awarded.exchangeRateToUsd,
    exchangeRateDate: data.exchangeRateDate || new Date().toISOString(),
    portOfEntry,
    portOfLoading: data.portOfLoading,
    paymentTerms: awarded.paymentTerms || data.paymentTerms,
    expectedDeliveryDate: rfq.expectedDelivery,
    notes: data.notes || `Converted from RFQ ${rfq.rfqNumber} / Quotation ${awarded.quotationNumber}`,
    items: poItems,
    status: 'Ordered',
  });

  assertRfqStatusTransition('Approved', 'Converted to PO');
  await prisma.importRfq.update({
    where: { id: rfq.id },
    data: { status: 'Converted to PO' },
  });

  await logImportAudit({
    companyId,
    action: 'STATUS_CHANGE',
    entityType: 'IMPORT_RFQ',
    entityId: rfq.id,
    details: {
      previousStatus: 'Approved',
      nextStatus: 'Converted to PO',
      importPoId: importPo.id,
      poNumber: importPo.poNumber,
      quotationId: awarded.id,
      userId,
      at: new Date().toISOString(),
    },
    userId,
  });

  return {
    purchaseOrder: importPo,
    rfq: await getRfqById(req, rfq.id),
  };
}

async function listCarriers(req, query = {}) {
  const companyScope = getCompanyScope(req);
  const { search, status, carrierType, page = 1, limit = 20 } = query;
  const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

  const where = {
    companyId: companyScope,
    ...(status && status !== 'All' ? { status } : {}),
    ...(carrierType && carrierType !== 'All' ? { carrierType } : {}),
    ...(search
      ? {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { country: { contains: search, mode: 'insensitive' } },
          { contactPerson: { contains: search, mode: 'insensitive' } },
        ],
      }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.importCarrier.count({ where }),
    prisma.importCarrier.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      skip,
      take: Number(limit),
    }),
  ]);

  return {
    items,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)) || 1,
    },
  };
}

async function getCarrierById(req, id) {
  const carrier = await prisma.importCarrier.findUnique({ where: { id } });
  if (!carrier) {
    const err = new Error('Carrier not found');
    err.status = 404;
    throw err;
  }
  await assertRecordCompanyAccess(req, carrier.companyId);
  return carrier;
}

async function createCarrier(req, data) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;
  const name = String(data.name || '').trim();
  if (!name) {
    const err = new Error('Carrier name is required');
    err.status = 400;
    throw err;
  }

  const email = data.email != null && String(data.email).trim() !== '' ? String(data.email).trim() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error('Carrier email format is invalid');
    err.status = 400;
    err.field = 'email';
    throw err;
  }

  const count = await prisma.importCarrier.count({ where: { companyId } });
  const code =
    String(data.code || '').trim() ||
    `CAR-${String(count + 1).padStart(4, '0')}`;

  const existing = await prisma.importCarrier.findFirst({
    where: { companyId, code },
  });
  if (existing) {
    const err = new Error('Carrier code already exists');
    err.status = 409;
    err.code = 'DUPLICATE_CARRIER_CODE';
    err.field = 'code';
    throw err;
  }

  const carrier = await prisma.importCarrier.create({
    data: {
      companyId,
      code,
      name,
      carrierType: data.carrierType || 'Ocean',
      scacCode: data.scacCode ? String(data.scacCode).trim().toUpperCase() : null,
      iataCode: data.iataCode ? String(data.iataCode).trim().toUpperCase() : null,
      country: data.country || null,
      contactPerson: data.contactPerson || null,
      email,
      phone: data.phone || null,
      address: data.address || null,
      website: data.website || null,
      servicesNotes: data.servicesNotes || null,
      trackingUrlTemplate: data.trackingUrlTemplate || null,
      status: data.status || 'Active',
      createdBy: userId,
    },
  });

  await logImportAudit({
    companyId,
    action: 'CREATE',
    entityType: 'IMPORT_CARRIER',
    entityId: carrier.id,
    details: { code, name },
    userId,
  });

  return carrier;
}

async function updateCarrier(req, id, data) {
  const existing = await getCarrierById(req, id);
  const companyId = existing.companyId;

  if (data.code && data.code !== existing.code) {
    const dup = await prisma.importCarrier.findFirst({
      where: { companyId, code: data.code, NOT: { id } },
    });
    if (dup) {
      const err = new Error('Carrier code already exists');
      err.status = 409;
      err.code = 'DUPLICATE_CARRIER_CODE';
      err.field = 'code';
      throw err;
    }
  }

  if (data.email != null && String(data.email).trim() !== '') {
    const email = String(data.email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const err = new Error('Carrier email format is invalid');
      err.status = 400;
      err.field = 'email';
      throw err;
    }
  }

  const updated = await prisma.importCarrier.update({
    where: { id },
    data: {
      code: data.code != null ? String(data.code).trim() : undefined,
      name: data.name != null ? String(data.name).trim() : undefined,
      carrierType: data.carrierType != null ? data.carrierType : undefined,
      scacCode:
        data.scacCode !== undefined
          ? data.scacCode
            ? String(data.scacCode).trim().toUpperCase()
            : null
          : undefined,
      iataCode:
        data.iataCode !== undefined
          ? data.iataCode
            ? String(data.iataCode).trim().toUpperCase()
            : null
          : undefined,
      country: data.country !== undefined ? data.country : undefined,
      contactPerson: data.contactPerson !== undefined ? data.contactPerson : undefined,
      email: data.email !== undefined ? (data.email ? String(data.email).trim() : null) : undefined,
      phone: data.phone !== undefined ? data.phone : undefined,
      address: data.address !== undefined ? data.address : undefined,
      website: data.website !== undefined ? data.website : undefined,
      servicesNotes: data.servicesNotes !== undefined ? data.servicesNotes : undefined,
      trackingUrlTemplate:
        data.trackingUrlTemplate !== undefined ? data.trackingUrlTemplate : undefined,
      status: data.status != null ? data.status : undefined,
    },
  });

  await logImportAudit({
    companyId,
    action: 'UPDATE',
    entityType: 'IMPORT_CARRIER',
    entityId: id,
    details: { fields: Object.keys(data || {}) },
    userId: req.user.id,
  });

  return updated;
}

async function deactivateCarrier(req, id) {
  const existing = await getCarrierById(req, id);
  const updated = await prisma.importCarrier.update({
    where: { id },
    data: { status: existing.status === 'Active' ? 'Inactive' : 'Active' },
  });
  await logImportAudit({
    companyId: existing.companyId,
    action: 'STATUS_CHANGE',
    entityType: 'IMPORT_CARRIER',
    entityId: id,
    details: { previousStatus: existing.status, nextStatus: updated.status },
    userId: req.user.id,
  });
  return updated;
}

module.exports = {
  toNumber,
  allocateLandedByValue,
  validateReceiveQty,
  assertPoStatusTransition,
  IMPORT_PO_STATUS_TRANSITIONS,
  getDashboardKpis,
  listPorts,
  resolveImportPort,
  listRfqs,
  getRfqById,
  createRfq,
  updateRfq,
  deleteRfq,
  listQuotations,
  createQuotation,
  selectQuotation,
  submitRfqForApproval,
  approveRfq,
  rejectRfqApproval,
  listImportApprovals,
  findCompanyUserIdsWithPermission,
  reopenRfq,
  refreshRfqItemHsCode,
  convertRfqToPurchaseOrder,
  normalizeHsCode,
  QUOTATION_OPEN_STATUSES,
  isActiveQuotation,
  countDistinctActiveSuppliers,
  normalizeRfqStatus,
  assertRfqStatusTransition,
  IMPORT_RFQ_STATUS_TRANSITIONS,
  INCOTERMS_2020,
  isValidHsCode,
  resolveImportExchangeRate,
  listPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  updatePurchaseOrderStatus,
  listProformas,
  getProformaById,
  createProforma,
  updateProforma,
  recordAdvancePayment,
  updateProformaStatus,
  previewFx: (...args) => importEnterprise.previewFx(...args),
  correctPurchaseOrderExchangeRate: (...args) =>
    importEnterprise.correctPurchaseOrderExchangeRate(...args),
  reverseLandedCost: (...args) => importEnterprise.reverseLandedCost(...args),
  updateFinanceLcStatus: (...args) => importEnterprise.updateFinanceLcStatus(...args),
  amendFinanceLc,
  getFinanceLcById,
  listEligibleFinancePos,
  updateDocumentStatus: (...args) => importEnterprise.updateDocumentStatus(...args),
  postSupplierBill,
  getSupplierBillById,
  listShipments,
  getShipmentById,
  listEligibleShipmentPos,
  createShipment,
  updateShipmentStatus,
  normalizeShipmentStatus,
  SHIPMENT_STATUS_TRANSITIONS,
  resolveLoadType,
  optionalMetric,
  sumShippedByPoItem,
  listCustomsClearances,
  getCustomsClearanceById,
  previewCustomsClearance,
  createCustomsClearance,
  updateCustomsStatus,
  submitCustomsForApproval,
  approveCustomsClearance,
  rejectCustomsApproval,
  recalculateCustomsWithCurrentRate,
  refreshCustomsTariffData,
  recordCustomsDutyPayment,
  listCustomsPaymentAccounts,
  CUSTOMS_APPROVE_PERMISSION,
  listDocuments,
  createDocument,
  listGrns,
  getGrnById,
  getReceivingPreview,
  getShipmentReceivingPreview,
  listReceivableShipments,
  auditImportGrns,
  createGrn,
  postGrn,
  cancelGrn,
  verifyShipmentOriginalBl,
  sumPostedAcceptedForPo,
  serializePoItemForReceiving,
  IMPORT_GRN_POSTED_STATUSES,
  listLandedCosts,
  getLandedCostById,
  createLandedCost,
  postLandedCost,
  listFinanceLcs,
  createFinanceLc,
  listSupplierBills,
  createSupplierBill,
  recordBillPayment,
  getSettings,
  updateSettings,
  getReports,
  listCarriers,
  getCarrierById,
  createCarrier,
  updateCarrier,
  deactivateCarrier,
};
