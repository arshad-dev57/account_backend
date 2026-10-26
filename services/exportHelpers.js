'use strict';

/**
 * Shared helpers for the Export Management module.
 * All exporters use company-scoped queries, captured FX snapshots and
 * server-generated document numbers.
 */

const prisma = require('../prisma/client');
const {
  requireSingleCompany,
  companyIdForQuery,
  assertRecordCompanyAccess,
} = require('../utils/companyAccess');
const {
  resolveImportExchangeRate,
  toNumber: fxToNumber,
} = require('../utils/importFx');
const { roundMoney, toNumber: mcToNumber } = require('../utils/multiCurrency');

function ApiError(message, { status = 400, code, field, details } = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.field = field;
  if (details) err.details = details;
  return err;
}

function toNum(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, places = 4) {
  return mcToNumber(roundMoney(toNum(value), places), places);
}

function asDate(value, field = 'date') {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw ApiError(`${field} is not a valid date`, {
      status: 400,
      code: 'INVALID_DATE',
      field,
    });
  }
  return d;
}

function requiredDate(value, field = 'date') {
  const d = asDate(value, field);
  if (!d) {
    throw ApiError(`${field} is required`, {
      status: 400,
      code: 'FIELD_REQUIRED',
      field,
    });
  }
  return d;
}

function requiredString(value, field, { max = 400 } = {}) {
  const s = value == null ? '' : String(value).trim();
  if (!s) {
    throw ApiError(`${field} is required`, {
      status: 400,
      code: 'FIELD_REQUIRED',
      field,
    });
  }
  if (s.length > max) {
    throw ApiError(`${field} must be ${max} characters or fewer`, {
      status: 400,
      code: 'FIELD_TOO_LONG',
      field,
    });
  }
  return s;
}

function positiveNumber(value, field) {
  const n = toNum(value, NaN);
  if (!Number.isFinite(n) || n <= 0) {
    throw ApiError(`${field} must be greater than 0`, {
      status: 400,
      code: 'INVALID_AMOUNT',
      field,
    });
  }
  return round(n, 4);
}

function nonNegativeNumber(value, field, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = toNum(value, NaN);
  if (!Number.isFinite(n) || n < 0) {
    throw ApiError(`${field} must be zero or greater`, {
      status: 400,
      code: 'INVALID_AMOUNT',
      field,
    });
  }
  return round(n, 4);
}

function getScope(req) {
  return companyIdForQuery(req);
}

function getWriteCompany(req) {
  return requireSingleCompany(req);
}

function assertAccess(req, record) {
  if (!record) return;
  return assertRecordCompanyAccess(req, record.companyId);
}

function buildPagination(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const rawLimit = parseInt(query.limit, 10) || 20;
  const limit = Math.min(200, Math.max(1, rawLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function paged(items, total, page, limit) {
  return {
    items,
    pagination: {
      total,
      page,
      limit,
      pages: limit > 0 ? Math.ceil(total / limit) : 0,
    },
  };
}

function contains(value) {
  return { contains: String(value), mode: 'insensitive' };
}

async function logExportAudit(
  { companyId, action, entityType, entityId, details, userId },
  client = prisma
) {
  try {
    await client.exportAuditLog.create({
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
    console.warn('[ExportAudit] failed to write audit log:', err.message);
  }
}

/**
 * Generate the next `PREFIX-YYYY-NNNN` number scoped to a company.
 * The DB unique constraint is the final guard; callers retry on P2002.
 */
async function nextNumber(tx, model, field, companyId, prefix) {
  const year = new Date().getFullYear();
  const head = `${prefix}-${year}-`;
  const rows = await tx[model].findMany({
    where: { companyId, [field]: { startsWith: head } },
    select: { [field]: true },
  });
  let max = 0;
  for (const row of rows) {
    const raw = String(row[field] || '').slice(head.length);
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${head}${String(max + 1).padStart(4, '0')}`;
}

/** SalesInvoice numbers are globally unique (legacy constraint). */
async function nextSalesInvoiceNumber(tx, prefix = 'ECI') {
  const year = new Date().getFullYear();
  const head = `${prefix}-${year}-`;
  const rows = await tx.salesInvoice.findMany({
    where: { invoiceNumber: { startsWith: head } },
    select: { invoiceNumber: true },
  });
  let max = 0;
  for (const row of rows) {
    const n = parseInt(String(row.invoiceNumber).slice(head.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${head}${String(max + 1).padStart(4, '0')}`;
}

async function resolveFx({
  companyId,
  currencyCode,
  foreignAmount = 0,
  explicitRate,
  asOfDate,
  allowExplicitRate = true,
  client = prisma,
}) {
  return resolveImportExchangeRate({
    companyId,
    currencyCode,
    foreignAmount,
    explicitRate,
    allowExplicitRate,
    asOfDate: asOfDate || new Date(),
    client,
  });
}

/**
 * Resolve the fiscal year covering `date` for a company.
 * If the company has fiscal years configured, posting outside an open
 * period is blocked (period control). Companies without configured
 * periods keep the legacy "null fiscal year" behaviour.
 */
async function resolveExportFiscalYear(companyId, date, client = prisma) {
  const when = date ? new Date(date) : new Date();
  const configured = await client.fiscalYear.count({ where: { companyId } });
  if (!configured) return null;
  const fy = await client.fiscalYear.findFirst({
    where: {
      companyId,
      status: 'Open',
      startDate: { lte: when },
      endDate: { gte: when },
    },
    orderBy: { startDate: 'desc' },
  });
  if (!fy) {
    throw ApiError(
      `No open fiscal year covers ${when.toISOString().slice(0, 10)}. Post the transaction in an open period.`,
      { status: 400, code: 'PERIOD_CLOSED' }
    );
  }
  return fy.id;
}

const TRANSITIONS = {
  inquiry: {
    Draft: ['Open', 'Converted', 'Closed'],
    Open: ['Converted', 'Closed'],
    Converted: [],
    Closed: [],
  },
  leadStage: {
    'New Inquiry': ['Technical Review', 'Quoted', 'Lost'],
    'Technical Review': ['Quoted', 'Negotiation', 'Lost'],
    Quoted: ['Negotiation', 'Order Won', 'Lost'],
    Negotiation: ['Order Won', 'Lost'],
    'Order Won': [],
    Lost: [],
  },
  quotation: {
    Draft: ['Sent to Buyer', 'Accepted', 'Declined'],
    'Sent to Buyer': ['Under Negotiation', 'Accepted', 'Declined'],
    'Under Negotiation': ['Accepted', 'Declined'],
    Accepted: ['Converted to Order'],
    Declined: [],
    'Converted to Order': [],
  },
  order: {
    Draft: ['Confirmed', 'Cancelled'],
    Confirmed: ['In Production / Packing', 'Cancelled'],
    'In Production / Packing': ['Pre-Shipment Inspection', 'Cancelled'],
    'Pre-Shipment Inspection': ['Customs Cleared', 'Cancelled'],
    'Customs Cleared': ['Dispatched', 'Cancelled'],
    Dispatched: ['On Board Vessel'],
    'On Board Vessel': ['Delivered'],
    Delivered: ['Completed'],
    Completed: [],
    Cancelled: [],
  },
  proforma: {
    Issued: ['LC Advised', 'Advance Remittance Received', 'Cancelled'],
    'LC Advised': ['Advance Remittance Received', 'Cancelled'],
    'Advance Remittance Received': ['Final Settled', 'Cancelled'],
    'Final Settled': [],
    Cancelled: [],
  },
  packing: {
    'Inspection Scheduled': ['Sample Tested', 'Rejection / Re-pack'],
    'Sample Tested': ['Passed & Certified', 'Rejection / Re-pack'],
    'Rejection / Re-pack': ['Inspection Scheduled'],
    'Passed & Certified': [],
  },
  shipment: {
    'Booking Confirmed': ['Container Gate-In', 'Cancelled'],
    'Container Gate-In': ['Loaded on Vessel', 'Cancelled'],
    'Loaded on Vessel': ['In Transit'],
    'In Transit': ['Arrived at Destination'],
    'Arrived at Destination': ['Customs Cleared Buyer'],
    'Customs Cleared Buyer': [],
    Cancelled: [],
  },
  customs: {
    Draft: ['Submitted to Customs', 'Cancelled'],
    'Submitted to Customs': ['Goods Inspected at Port', 'Cancelled'],
    'Goods Inspected at Port': ['Let Export Order (LEO) Granted', 'Cancelled'],
    'Let Export Order (LEO) Granted': ['Sailed & Completed'],
    'Sailed & Completed': [],
    Cancelled: [],
  },
  document: {
    Draft: ['Finalized', 'Cancelled'],
    Finalized: ['Legalized / Attested', 'Dispatched via DHL to Bank'],
    'Legalized / Attested': ['Dispatched via DHL to Bank'],
    'Dispatched via DHL to Bank': ['Delivered to Buyer'],
    'Delivered to Buyer': [],
    Cancelled: [],
  },
  dispatch: {
    'Staged at Warehouse': ['En Route to Port', 'Cancelled'],
    'En Route to Port': ['Container Gate-In Complete', 'Cancelled'],
    'Container Gate-In Complete': ['Handed Over to Shipping Line', 'Cancelled'],
    'Handed Over to Shipping Line': [],
    Cancelled: [],
  },
  lc: {
    'LC Advised': ['Confirmed', 'Cancelled'],
    Confirmed: ['Documents Negotiated', 'Cancelled'],
    'Documents Negotiated': ['Settlement Received'],
    'Settlement Received': [],
    Cancelled: [],
  },
  receipt: {
    'Funds In Transit': ['Realized & Credited', 'Cancelled'],
    'Realized & Credited': ['Forex Hedged'],
    'Forex Hedged': [],
    Cancelled: [],
  },
};

const ALLOWED_STATUSES = Object.fromEntries(
  Object.entries(TRANSITIONS).map(([key, map]) => [key, Object.keys(map)])
);

function canonicalStatus(entity, value) {
  const raw = String(value || '').trim();
  const allowed = ALLOWED_STATUSES[entity] || [];
  const found = allowed.find((s) => s.toLowerCase() === raw.toLowerCase());
  if (!found) {
    throw ApiError(
      `Invalid ${entity} status "${raw}". Allowed: ${allowed.join(', ')}`,
      { status: 400, code: 'INVALID_STATUS', field: 'status' }
    );
  }
  return found;
}

function assertTransition(entity, from, to) {
  if (from === to) return to;
  const map = TRANSITIONS[entity] || {};
  const next = map[from] || [];
  if (!next.includes(to)) {
    throw ApiError(
      `Cannot move ${entity} from "${from}" to "${to}"`,
      { status: 409, code: 'INVALID_TRANSITION' }
    );
  }
  return to;
}

/**
 * Serialize Prisma Decimal/Date values for JSON responses.
 */
function toPlain(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (typeof value.toNumber === 'function') {
      return Number(value.toString());
    }
    if (Array.isArray(value)) return value.map(toPlain);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = toPlain(v);
    return out;
  }
  return value;
}

async function findIdempotent(client, companyId, key) {
  if (!key) return null;
  return client.exportIdempotency.findFirst({
    where: { companyId, key: String(key).slice(0, 120) },
  });
}

async function registerIdempotency(client, { companyId, key, entityType, entityId }) {
  if (!key) return null;
  try {
    return await client.exportIdempotency.create({
      data: {
        companyId,
        key: String(key).slice(0, 120),
        entityType,
        entityId,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw ApiError('This request was already processed', {
        status: 409,
        code: 'DUPLICATE_REQUEST',
      });
    }
    throw err;
  }
}

/** Run a create operation with optional idempotency and P2002 retry for numbering. */
async function createWithNumbering({
  companyId,
  key,
  entityType,
  run,
  retries = 3,
}) {
  return prisma.$transaction(async (tx) => {
    if (key) {
      const existing = await findIdempotent(tx, companyId, key);
      if (existing) {
        return { idempotent: true, entityType: existing.entityType, entityId: existing.entityId };
      }
    }
    let lastErr = null;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const result = await run(tx);
        if (key && result?.id) {
          await registerIdempotency(tx, { companyId, key, entityType, entityId: result.id });
        }
        return result;
      } catch (err) {
        lastErr = err;
        if (err.code !== 'P2002') throw err;
      }
    }
    throw lastErr;
  });
}

module.exports = {
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
  assertAccess,
  buildPagination,
  paged,
  contains,
  logExportAudit,
  nextNumber,
  nextSalesInvoiceNumber,
  resolveFx,
  resolveExportFiscalYear,
  TRANSITIONS,
  ALLOWED_STATUSES,
  canonicalStatus,
  assertTransition,
  toPlain,
  findIdempotent,
  registerIdempotency,
  createWithNumbering,
  fxToNumber,
};
