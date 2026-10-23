'use strict';


const prisma = require('../prisma/client');
const {
  requireSingleCompany,
  assertRecordCompanyAccess,
} = require('../utils/companyAccess');
const {
  resolveImportExchangeRate,
  parseDateOnly,
  toDbDateOnly,
  toDateInputValue,
  assertImportRateDate,
} = require('../utils/importFx');
const { getCompanyBaseCurrency: getBaseCurrency } = require('../utils/multiCurrency');
const BalanceCalculator = require('../utils/balanceCalculator');
const { resolveFiscalYearId } = require('../utils/fiscalYearHelper');
const { getEffectivePermissions } = require('./permissionService');
const { sendToUser, sendToUsers } = require('./notificationService');

const CUSTOMS_APPROVE_PERMISSION = 'import.customs.approve';

function toNumber(val, fallback = 0) {
  if (val == null || val === '') return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round(toNumber(n) * 100) / 100;
}

/** Empty / omitted → null; explicit 0 stays 0. */
function optionalMoney(val) {
  if (val === undefined || val === null || val === '') return null;
  return round2(val);
}

function startOfDay(d) {
  // Alias kept for call sites — always returns a calendar-day Date (local Y/M/D).
  return parseDateOnly(d);
}

/** Assessment / payment / release dates: not future, not before entry createdAt. */
function assertCustomsCalendarDate(input, { createdAt, field, label }) {
  const d = parseDateOnly(input);
  if (!d) {
    throw customsError(`${label} is required`, field);
  }
  const today = parseDateOnly(new Date());
  if (today && d.getTime() > today.getTime()) {
    throw customsError(`${label} must not be in the future`, field);
  }
  if (createdAt) {
    const created = parseDateOnly(createdAt);
    if (created && d.getTime() < created.getTime()) {
      throw customsError(`${label} must not be before the entry creation date`, field);
    }
  }
  return toDbDateOnly(d);
}

function customsError(message, field, code = 'CUSTOMS_VALIDATION', status = 400) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.field = field || null;
  return err;
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
    console.warn('[ImportAudit] Customs audit error:', err.message);
  }
}

const CUSTOMS_STATUS_TRANSITIONS = {
  Draft: ['Under Assessment', 'Cancelled'],
  // Maker sends for assessment; assessor confirms → Assessed, or sends back → Draft
  'Under Assessment': ['Assessed', 'Draft', 'On Hold/Examination', 'Cancelled'],
  // Maker sends for payment; payer records duty → Duty Paid / Partially Paid
  Assessed: ['Pending Payment', 'On Hold/Examination', 'Cancelled'],
  'Pending Payment': ['Duty Paid', 'Partially Paid', 'Assessed', 'On Hold/Examination', 'Cancelled'],
  'Partially Paid': ['Partially Paid', 'Duty Paid', 'Pending Payment', 'On Hold/Examination', 'Cancelled'],
  // Release requires approval: Duty Paid → Pending Approval → Approved → Released/Cleared
  'Duty Paid': ['Pending Approval', 'On Hold/Examination', 'Cancelled'],
  'Pending Approval': ['Approved', 'Duty Paid', 'On Hold/Examination', 'Cancelled'],
  Approved: ['Released/Cleared', 'On Hold/Examination', 'Cancelled'],
  'Released/Cleared': [],
  'On Hold/Examination': [
    'Under Assessment',
    'Assessed',
    'Pending Payment',
    'Partially Paid',
    'Duty Paid',
    'Pending Approval',
    'Approved',
    'Cancelled',
  ],
  Cancelled: [],
  // legacy aliases
  Cleared: [],
  Released: [],
  'Out of Charge': [],
};

const CUSTOMS_PERM_MESSAGES = {
  'import.customs.create': 'You do not have permission to create customs clearances',
  'import.customs.assess': 'You do not have permission to assess customs clearances',
  'import.customs.record_payment': 'You do not have permission to record customs duty payments',
  'import.customs.release': 'You do not have permission to release customs clearances',
  'import.customs.hold': 'You do not have permission to put customs clearances on hold',
  'import.customs.cancel': 'You do not have permission to cancel customs clearances',
  'import.customs.edit': 'You do not have permission to edit customs clearances',
  'import.customs.approve':
    'You do not have permission to approve customs clearance & port formalities',
};

/** Permissions that authorize recording customs duty payments (Accountant-friendly). */
const CUSTOMS_PAYMENT_PERMISSIONS = [
  'import.customs.record_payment',
  'purchases.payments.create',
  'purchases.payments.edit',
  'accounting.accounts_payable.create',
  'accounting.accounts_payable.edit',
  'accounting.journal_entries.create',
  'accounting.journal_entries.post',
];

function isCashBankAccount(ba) {
  if (!ba) return false;
  const name = `${ba.bankName || ''} ${ba.accountName || ''} ${ba.accountType || ''}`.toLowerCase();
  return (
    String(ba.bankName || '').toLowerCase() === 'cash' ||
    String(ba.accountType || '').toLowerCase() === 'cash' ||
    /\bcash\b/.test(name)
  );
}

async function assertCustomsPermission(req, permissionKey, { companyId, entityId } = {}) {
  const userId = req.user?.id || req.user?._id;
  const cid = companyId || req.user?.companyId;
  const effective = req.effectivePermissions || (await getEffectivePermissions(userId, cid));
  if (effective?.isAdmin) return true;
  const granted = effective?.permissionMap?.[permissionKey]?.granted === true;
  if (granted) return true;
  const message = CUSTOMS_PERM_MESSAGES[permissionKey] || `You do not have permission for ${permissionKey}`;
  if (cid && entityId) {
    await logImportAudit({
      companyId: cid,
      action: 'PERMISSION_DENIED',
      entityType: 'IMPORT_CUSTOMS',
      entityId,
      details: { permission: permissionKey, message },
      userId,
    });
  }
  throw customsError(message, 'permission', 'PERMISSION_DENIED', 403);
}

function hasAnyEffectivePermission(effective, keys = []) {
  if (!effective) return false;
  if (effective.isAdmin) return true;
  const map = effective.permissionMap || {};
  return keys.some((k) => map[k]?.granted === true);
}

/**
 * Accountants / finance users can record duty payments even if they don't have
 * the dedicated import.customs.record_payment key (stale role seeds).
 */
async function assertCanRecordCustomsDutyPayment(req, { companyId, entityId } = {}) {
  const userId = req.user?.id || req.user?._id;
  const cid = companyId || req.user?.companyId;
  const effective = req.effectivePermissions || (await getEffectivePermissions(userId, cid));
  if (hasAnyEffectivePermission(effective, CUSTOMS_PAYMENT_PERMISSIONS)) return true;

  const message =
    CUSTOMS_PERM_MESSAGES['import.customs.record_payment'] ||
    'You do not have permission to record customs duty payments';
  if (cid && entityId) {
    await logImportAudit({
      companyId: cid,
      action: 'PERMISSION_DENIED',
      entityType: 'IMPORT_CUSTOMS',
      entityId,
      details: { permission: 'import.customs.record_payment', alternatives: CUSTOMS_PAYMENT_PERMISSIONS, message },
      userId,
    });
  }
  throw customsError(message, 'permission', 'PERMISSION_DENIED', 403);
}

/**
 * SOD: creator cannot pay. Assessor may pay when they hold accounting/payment
 * permissions (Accountant flow). Strict mode still blocks assessor if they
 * lack payment-oriented permissions.
 */
async function assertCustomsPaymentSod(req, existing, settings) {
  if (settings?.requireSeparateCustomsPayer === false) return;

  const userId = req.user?.id || req.user?._id;
  if (!userId) return;

  if (existing.createdBy && existing.createdBy === userId) {
    throw customsError(
      'Payment must be recorded by a different user than the clearance creator. Ask an Accountant / Finance user to record the duty payment.',
      'permission',
      'SOD_VIOLATION'
    );
  }

  if (existing.assessedBy && existing.assessedBy === userId) {
    const cid = existing.companyId || req.user?.companyId;
    const effective = req.effectivePermissions || (await getEffectivePermissions(userId, cid));
    // Accountant / AP / payments users are allowed to pay after assessing.
    const isPaymentRole = hasAnyEffectivePermission(effective, CUSTOMS_PAYMENT_PERMISSIONS);
    if (!isPaymentRole) {
      throw customsError(
        'Payment must be recorded by an Accountant (or a user with payment permissions), different from the assessor.',
        'permission',
        'SOD_VIOLATION'
      );
    }
  }
}

function normalizeCustomsStatus(status) {
  if (!status) return 'Draft';
  if (status === 'Cleared' || status === 'Released' || status === 'Out of Charge') return 'Released/Cleared';
  if (status === 'On Hold' || status === 'Examination') return 'On Hold/Examination';
  return status;
}

function assertCustomsTransition(fromRaw, toRaw) {
  const from = normalizeCustomsStatus(fromRaw);
  const to = normalizeCustomsStatus(toRaw);
  if (from === to) return { from, to };
  if (from === 'Cancelled' || from === 'Released/Cleared') {
    throw customsError(`Cannot change status from ${from}`);
  }
  const allowed = CUSTOMS_STATUS_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw customsError(`Invalid customs status transition: ${from} → ${to}`);
  }
  return { from, to };
}

function displayAuditUser(user) {
  if (!user) return '—';
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  if (!name || /^customer\s*\d+$/i.test(name) || /^user\s*\d+$/i.test(name)) {
    return user.email || name || '—';
  }
  return name;
}

function formatCustomsAuditRow(row) {
  const details = row.details && typeof row.details === 'object' ? row.details : {};
  const from = details.from ?? details.previousStatus ?? null;
  const to = details.to ?? details.nextStatus ?? details.clearanceStatus ?? null;
  let label;
  if (row.action === 'CREATE') label = to ? `Created → ${to}` : 'Created';
  else if (row.action === 'RECALCULATE_RATE') label = 'Recalculated with current PO rate';
  else if (row.action === 'REFRESH_TARIFF') label = 'Tariff data refreshed';
  else if (row.action === 'RATE_DATE_CORRECTED') label = 'Rate date corrected (future date)';
  else if (row.action === 'ASSESSMENT_DATE_CORRECTED') label = 'Assessment date corrected';
  else if (row.action === 'DUTY_PAYMENT') label = 'Duty payment recorded';
  else if (row.action === 'PERMISSION_DENIED') label = 'Permission denied';
  else if (from && to) label = `${from} → ${to}`;
  else if (row.action === 'STATUS_CHANGE') label = to ? `Status → ${to}` : 'Status updated';
  else label = String(row.action || 'Updated').replace(/_/g, ' ');

  const norm = (s) =>
    String(s || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const labelN = norm(label);
  const isRedundantNote = (raw) => {
    const n = norm(raw);
    if (!n) return true;
    if (n === labelN) return true;
    if (labelN.includes(n) || n.includes(labelN)) return true;
    // Generic refresh reason that duplicates the action title
    if (row.action === 'REFRESH_TARIFF' && (n === 'refresh tariff data' || n === 'tariff data refreshed')) {
      return true;
    }
    return false;
  };
  // Prefer longer note over short reason; skip if it only restates the label
  const candidates = [details.note, details.reason, details.holdReason].filter(
    (c) => c != null && String(c).trim()
  );
  const reason = (() => {
    for (const c of candidates) {
      if (!isRedundantNote(c)) return String(c).trim();
    }
    return null;
  })();

  const userLabel = !row.userId
    ? 'System'
    : displayAuditUser(row.user);

  return {
    ...row,
    label,
    reason,
    userLabel,
  };
}

async function lookupTariff(companyId, hsCode) {
  const code = String(hsCode || '').replace(/\D/g, '');
  if (!code) return null;
  const rows = await prisma.importHsTariffRate.findMany({
    where: {
      status: 'Active',
      OR: [{ companyId }, { companyId: null }],
      hsCode: { startsWith: code.slice(0, 6) },
    },
    orderBy: [{ companyId: 'desc' }, { hsCode: 'desc' }],
    take: 20,
  });
  const exact =
    rows.find((r) => r.hsCode === code || r.hsCode === code.slice(0, 6)) ||
    rows.find((r) => code.startsWith(String(r.hsCode).replace(/\D/g, '')));
  return exact || null;
}

async function resolvePortMeta(portNameOrCode) {
  if (!portNameOrCode) return null;
  const port = await prisma.importPort
    .findFirst({
      where: {
        OR: [
          { unLocode: { equals: String(portNameOrCode).trim(), mode: 'insensitive' } },
          { name: { contains: String(portNameOrCode).trim(), mode: 'insensitive' } },
        ],
      },
    })
    .catch(() => null);
  if (!port) return { label: String(portNameOrCode), country: null, unLocode: null };
  return {
    label: port.unLocode ? `${port.name} (${port.unLocode})` : port.name,
    country: port.country || null,
    countryCode: port.countryCode || null,
    unLocode: port.unLocode || null,
  };
}

function incotermIncludesFreightInsurance(incoterm) {
  const t = String(incoterm || '').toUpperCase();
  return ['CIF', 'CIP', 'DDP', 'DAP', 'DPU'].includes(t);
}

async function buildShipmentAssessmentContext(req, shipmentId) {
  const companyId = requireSingleCompany(req);
  const shipment = await prisma.importShipment.findFirst({
    where: { id: shipmentId, companyId },
    include: {
      items: true,
      importPo: { include: { items: true, proformaInvoices: true, financeLcs: true } },
      carrierMaster: true,
    },
  });
  if (!shipment) throw customsError('Shipment not found', 'shipmentId', 'NOT_FOUND', 404);

  const settings = await prisma.importSetting.findUnique({ where: { companyId } }).catch(() => null);
  const importPo = shipment.importPo;
  const currency = String(importPo?.currency || shipment.currency || 'USD').toUpperCase();

  let exchangeRate = toNumber(importPo?.exchangeRateToUsd, 0);
  let exchangeRateDate = importPo?.exchangeRateDate || new Date();
  let rateSource = importPo?.exchangeRateToUsd ? 'PO FX snapshot' : null;
  let baseCurrencyCode = 'PKR';
  try {
    const base = await getBaseCurrency(companyId);
    baseCurrencyCode = String(base?.code || 'PKR').toUpperCase();
  } catch {
    /* keep PKR */
  }

  if (exchangeRate <= 0) {
    const fx = await resolveImportExchangeRate({
      companyId,
      currencyCode: currency,
      foreignAmount: 1,
      allowExplicitRate: false,
      asOfDate: exchangeRateDate,
    });
    exchangeRate = fx.exchangeRate;
    exchangeRateDate = fx.exchangeRateDate;
    rateSource = 'Live FX table';
    baseCurrencyCode = fx.baseCurrencyCode || baseCurrencyCode;
  }

  // Prefer explicit foreign total when present
  let foreignGoodsValue = toNumber(importPo?.totalForeign, 0);
  if (foreignGoodsValue <= 0 && importPo?.items?.length) {
    foreignGoodsValue = importPo.items.reduce(
      (s, it) => s + toNumber(it.totalAmount ?? it.quantity * it.unitPrice, 0),
      0
    );
  }
  if (foreignGoodsValue <= 0) {
    foreignGoodsValue = toNumber(importPo?.totalUsd, 0) / (exchangeRate || 1);
  }

  // estimatedFreightUsd / estimatedInsuranceUsd are stored in company base — convert to foreign
  const freightBase = toNumber(shipment.estimatedFreightUsd, 0);
  const insuranceBase = toNumber(shipment.estimatedInsuranceUsd, 0);
  const freightForeignAdj = exchangeRate > 0 ? freightBase / exchangeRate : freightBase;
  const insuranceForeignAdj = exchangeRate > 0 ? insuranceBase / exchangeRate : insuranceBase;

  const incoterm = importPo?.incoterm || shipment.incoterm || 'CIF';
  const includeExtras = !incotermIncludesFreightInsurance(incoterm);
  const cifForeign =
    foreignGoodsValue + (includeExtras ? freightForeignAdj + insuranceForeignAdj : 0);
  const cifBase = round2(cifForeign * exchangeRate);

  const poItemsById = Object.fromEntries((importPo?.items || []).map((it) => [it.id, it]));
  const poItemsByProduct = {};
  for (const it of importPo?.items || []) {
    if (it.productId) poItemsByProduct[it.productId] = it;
  }

  const lineInputs = [];
  const sourceItems =
    shipment.items?.length > 0
      ? shipment.items
      : (importPo?.items || []).map((it) => ({
          id: null,
          importPoItemId: it.id,
          productId: it.productId,
          productName: it.productName,
          sku: it.sku,
          quantity: it.quantity,
          uom: it.uom,
        }));

  let missingHs = [];

  for (const it of sourceItems) {
    const poItem =
      (it.importPoItemId && poItemsById[it.importPoItemId]) ||
      (it.productId && poItemsByProduct[it.productId]) ||
      null;
    let hsCode = poItem?.hsCode || null;
    if (!hsCode && it.productId) {
      const prod = await prisma.product
        .findFirst({ where: { id: it.productId }, select: { hsCode: true, name: true } })
        .catch(() => null);
      hsCode = prod?.hsCode || null;
    }
    if (!hsCode) {
      missingHs.push(it.productName || poItem?.productName || 'Unknown item');
      continue;
    }
    const qty = toNumber(it.quantity, 0);
    const unit = toNumber(poItem?.unitPrice, 0);
    const lineForeign = qty * unit || (foreignGoodsValue / Math.max(sourceItems.length, 1));
    const assessable = round2(lineForeign * exchangeRate);
    const tariff = await lookupTariff(companyId, hsCode);
    lineInputs.push({
      shipmentItemId: it.id || null,
      importPoItemId: poItem?.id || it.importPoItemId || null,
      productId: it.productId || poItem?.productId || null,
      productName: it.productName || poItem?.productName || 'Item',
      sku: it.sku || poItem?.sku || null,
      hsCode: String(hsCode).replace(/\s/g, ''),
      quantity: qty,
      uom: it.uom || poItem?.uom || 'PCS',
      assessableValueBase: assessable,
      dutyRatePct: tariff ? toNumber(tariff.dutyRatePct) : toNumber(settings?.defaultCustomsDutyRatePct, 10),
      additionalDutyRatePct: tariff ? toNumber(tariff.additionalDutyRatePct) : 0,
      regulatoryDutyRatePct: tariff ? toNumber(tariff.regulatoryDutyRatePct) : 0,
      vatRatePct: tariff && toNumber(tariff.salesTaxRatePct) > 0
        ? toNumber(tariff.salesTaxRatePct)
        : toNumber(settings?.defaultImportVatRatePct, 5),
      tariffFound: Boolean(tariff),
    });
  }

  const portMeta = await resolvePortMeta(shipment.portOfEntry || importPo?.portOfEntry);
  const companyCountry =
    settings?.companyCountryCode ||
    (baseCurrencyCode === 'PKR' ? 'PK' : null);
  const portCountryCode = portMeta?.countryCode || null;
  const portCountryWarning =
    companyCountry &&
    portCountryCode &&
    String(portCountryCode).toUpperCase() !== String(companyCountry).toUpperCase()
      ? `Port of entry ${portMeta.label} is in ${portMeta.country || portCountryCode}, while company duties are assessed in ${baseCurrencyCode}. Confirm this is intentional.`
      : null;

  return {
    shipment,
    importPo,
    settings,
    currency,
    baseCurrencyCode,
    exchangeRate,
    exchangeRateDate,
    rateSource,
    foreignGoodsValue: round2(foreignGoodsValue),
    freightForeign: round2(freightForeignAdj),
    insuranceForeign: round2(insuranceForeignAdj),
    includeFreightInsurance: includeExtras,
    incoterm,
    cifForeign: round2(cifForeign),
    cifBase,
    lines: lineInputs,
    missingHs,
    portOfEntry: portMeta?.label || shipment.portOfEntry || importPo?.portOfEntry || null,
    portMeta,
    portCountryWarning,
    customsOffice: shipment.customsOffice || settings?.defaultCustomsBroker || null,
    customsBroker: settings?.defaultCustomsBroker || null,
    defaultVatRatePct: toNumber(settings?.defaultImportVatRatePct, 5),
    defaultDutyRatePct: toNumber(settings?.defaultCustomsDutyRatePct, 10),
    proformas: importPo?.proformaInvoices || [],
    financeLcs: importPo?.financeLcs || [],
  };
}

function computeTotalsFromLines(lines, opts = {}) {
  const vatRateHeader = opts.vatRatePct != null ? toNumber(opts.vatRatePct) : null;
  let duty = 0;
  let addDuty = 0;
  let regDuty = 0;
  let vat = 0;
  const computedLines = lines.map((ln) => {
    const assessable = round2(ln.assessableValueBase);
    const dutyRate = toNumber(ln.dutyRatePct);
    const addRate = toNumber(ln.additionalDutyRatePct);
    const regRate = toNumber(ln.regulatoryDutyRatePct);
    const vatRate = vatRateHeader != null ? vatRateHeader : toNumber(ln.vatRatePct);
    const dutyAmt = round2((assessable * dutyRate) / 100);
    const addAmt = round2((assessable * addRate) / 100);
    const regAmt = round2((assessable * regRate) / 100);
    const vatBase = assessable + dutyAmt + addAmt + regAmt;
    const vatAmt = round2((vatBase * vatRate) / 100);
    duty += dutyAmt;
    addDuty += addAmt;
    regDuty += regAmt;
    vat += vatAmt;
    return {
      ...ln,
      dutyAmountBase: dutyAmt,
      additionalDutyBase: addAmt,
      regulatoryDutyBase: regAmt,
      vatRatePct: vatRate,
      vatAmountBase: vatAmt,
    };
  });

  const portHandling = optionalMoney(opts.portHandlingChargesUsd);
  const clearingFee = optionalMoney(opts.clearingBrokerFeeUsd);
  const demurrage = optionalMoney(opts.demurrageChargesUsd);
  const inspection = optionalMoney(opts.inspectionFeeUsd);
  const penalties = optionalMoney(opts.penaltiesUsd);
  const aitRateProvided =
    opts.advanceIncomeTaxRatePct !== undefined &&
    opts.advanceIncomeTaxRatePct !== null &&
    opts.advanceIncomeTaxRatePct !== '';
  const aitRate = aitRateProvided ? toNumber(opts.advanceIncomeTaxRatePct) : null;
  const cif = round2(opts.cifValueUsd);
  const ait = aitRate != null ? round2((cif * aitRate) / 100) : null;

  // Header fixed duty override
  let customsDuty = duty;
  let customsDutyRatePct = lines.length
    ? round2((duty / Math.max(cif, 1)) * 100)
    : toNumber(opts.customsDutyRatePct);
  if (opts.useFixedDuty && opts.customsDutyUsd != null) {
    customsDuty = round2(opts.customsDutyUsd);
    customsDutyRatePct = 0;
  } else if (!lines.length && opts.customsDutyRatePct != null) {
    customsDuty = round2((cif * toNumber(opts.customsDutyRatePct)) / 100);
    customsDutyRatePct = toNumber(opts.customsDutyRatePct);
  }

  if (opts.useFixedDuty && opts.customsDutyUsd != null) {
    // Recompute VAT on CIF + fixed duty when no lines
    if (!lines.length) {
      const vatRate = toNumber(opts.vatRatePct);
      vat = round2(((cif + customsDuty) * vatRate) / 100);
    }
  }

  const total = round2(
    customsDuty +
      addDuty +
      regDuty +
      vat +
      toNumber(ait) +
      toNumber(portHandling) +
      toNumber(clearingFee) +
      toNumber(demurrage) +
      toNumber(inspection) +
      toNumber(penalties)
  );

  // Header-level add/reg duty: keep null when no line contribution and no rates entered
  const addDutyOut = addDuty > 0 || opts.additionalDutyRatePct != null ? addDuty : null;
  const regDutyOut = regDuty > 0 || opts.regulatoryDutyRatePct != null ? regDuty : null;

  return {
    lines: computedLines,
    customsDutyUsd: customsDuty,
    customsDutyRatePct,
    additionalDutyUsd: addDutyOut,
    regulatoryDutyUsd: regDutyOut,
    advanceIncomeTaxUsd: ait,
    importVatUsd: vat,
    importVatRatePct: toNumber(opts.vatRatePct),
    totalCustomsPayableUsd: total,
    portHandlingChargesUsd: portHandling,
    clearingBrokerFeeUsd: clearingFee,
    demurrageChargesUsd: demurrage,
    inspectionFeeUsd: inspection,
    penaltiesUsd: penalties,
  };
}

async function previewCustomsClearance(req, data = {}) {
  if (!data.shipmentId) throw customsError('shipmentId is required', 'shipmentId');
  const ctx = await buildShipmentAssessmentContext(req, data.shipmentId);
  if (ctx.missingHs.length) {
    throw customsError(
      `Shipment line(s) missing HS code: ${ctx.missingHs.join(', ')}`,
      'hsCode',
      'HS_CODE_REQUIRED'
    );
  }

  let exchangeRate = data.exchangeRateToUsd != null ? toNumber(data.exchangeRateToUsd) : ctx.exchangeRate;
  let exchangeRateDate;
  try {
    exchangeRateDate = assertImportRateDate(data.exchangeRateDate || ctx.exchangeRateDate || new Date(), {
      orderDate: ctx.importPo?.orderDate || ctx.importPo?.createdAt,
      field: 'exchangeRateDate',
      label: 'Customs rate date',
    });
  } catch (err) {
    throw customsError(err.message, err.field || 'exchangeRateDate', err.code || 'RATE_DATE_INVALID');
  }
  if (exchangeRate <= 0) throw customsError('Customs exchange rate must be greater than 0', 'exchangeRateToUsd');

  const foreignGoodsValue =
    data.foreignGoodsValue != null ? toNumber(data.foreignGoodsValue) : ctx.foreignGoodsValue;
  const freightForeign = data.freightForeign != null ? toNumber(data.freightForeign) : ctx.freightForeign;
  const insuranceForeign =
    data.insuranceForeign != null ? toNumber(data.insuranceForeign) : ctx.insuranceForeign;
  const includeExtras =
    data.includeFreightInsurance != null ? Boolean(data.includeFreightInsurance) : ctx.includeFreightInsurance;
  const cifForeign = foreignGoodsValue + (includeExtras ? freightForeign + insuranceForeign : 0);
  const cifBase =
    data.cifValueUsd != null && toNumber(data.cifValueUsd) > 0
      ? toNumber(data.cifValueUsd)
      : round2(cifForeign * exchangeRate);

  if (cifBase <= 0) throw customsError('CIF value must be greater than 0', 'cifValueUsd');

  if (data.importVatRatePct === undefined || data.importVatRatePct === null || data.importVatRatePct === '') {
    // preview may use default for display, but flag required
  }
  const vatRate =
    data.importVatRatePct !== undefined && data.importVatRatePct !== null && data.importVatRatePct !== ''
      ? toNumber(data.importVatRatePct)
      : ctx.defaultVatRatePct;

  const overrideLines = Array.isArray(data.lines) ? data.lines : null;
  let lines = ctx.lines.map((ln) => {
    const ovr = overrideLines?.find(
      (x) =>
        (x.importPoItemId && x.importPoItemId === ln.importPoItemId) ||
        (x.shipmentItemId && x.shipmentItemId === ln.shipmentItemId) ||
        (x.hsCode && x.hsCode === ln.hsCode && x.productName === ln.productName)
    );
    if (!ovr) {
      return {
        ...ln,
        assessableValueBase: round2((toNumber(ln.quantity) *
          (ln.assessableValueBase / Math.max(toNumber(ln.quantity), 1) / ctx.exchangeRate) *
          exchangeRate) || (ln.assessableValueBase / ctx.exchangeRate) * exchangeRate),
      };
    }
    if (ovr.dutyRatePct != null && toNumber(ovr.dutyRatePct) !== toNumber(ln.dutyRatePct) && !ovr.overrideReason) {
      throw customsError(
        `Override reason required for HS ${ln.hsCode} (${ln.productName})`,
        'overrideReason'
      );
    }
    return {
      ...ln,
      dutyRatePct: ovr.dutyRatePct != null ? toNumber(ovr.dutyRatePct) : ln.dutyRatePct,
      additionalDutyRatePct:
        ovr.additionalDutyRatePct != null ? toNumber(ovr.additionalDutyRatePct) : ln.additionalDutyRatePct,
      regulatoryDutyRatePct:
        ovr.regulatoryDutyRatePct != null ? toNumber(ovr.regulatoryDutyRatePct) : ln.regulatoryDutyRatePct,
      rateOverride: Boolean(ovr.overrideReason || ovr.rateOverride),
      overrideReason: ovr.overrideReason || null,
      assessableValueBase:
        ovr.assessableValueBase != null
          ? toNumber(ovr.assessableValueBase)
          : round2((ln.assessableValueBase / ctx.exchangeRate) * exchangeRate),
    };
  });

  // Re-scale line assessable values to sum to CIF
  const lineSum = lines.reduce((s, l) => s + toNumber(l.assessableValueBase), 0);
  if (lineSum > 0 && Math.abs(lineSum - cifBase) > 0.5) {
    lines = lines.map((l) => ({
      ...l,
      assessableValueBase: round2((toNumber(l.assessableValueBase) / lineSum) * cifBase),
    }));
  }

  const useFixedDuty = data.customsDutyUsd != null && data.customsDutyUsd !== '' && !data.customsDutyRatePct;
  const totals = computeTotalsFromLines(lines, {
    cifValueUsd: cifBase,
    vatRatePct: vatRate,
    customsDutyRatePct: data.customsDutyRatePct,
    customsDutyUsd: data.customsDutyUsd,
    useFixedDuty,
    portHandlingChargesUsd: data.portHandlingChargesUsd,
    clearingBrokerFeeUsd: data.clearingBrokerFeeUsd,
    demurrageChargesUsd: data.demurrageChargesUsd,
    inspectionFeeUsd: data.inspectionFeeUsd,
    penaltiesUsd: data.penaltiesUsd,
    advanceIncomeTaxRatePct: data.advanceIncomeTaxRatePct,
  });

  return {
    shipmentId: ctx.shipment.id,
    shipmentNumber: ctx.shipment.shipmentNumber,
    importPoId: ctx.importPo?.id || null,
    poRef: ctx.importPo?.poNumber || ctx.shipment.poRef,
    currency: ctx.currency,
    baseCurrencyCode: ctx.baseCurrencyCode,
    exchangeRate,
    exchangeRateDate,
    rateSource: data.exchangeRateToUsd != null ? 'Manual customs rate' : ctx.rateSource,
    foreignGoodsValue,
    freightForeign,
    insuranceForeign,
    includeFreightInsurance: includeExtras,
    incoterm: ctx.incoterm,
    cifForeign: round2(cifForeign),
    cifValueUsd: cifBase,
    importPoOrderDate: ctx.importPo?.orderDate || ctx.importPo?.createdAt || null,
    portOfEntry: data.portOfEntry || ctx.portOfEntry,
    portMeta: ctx.portMeta,
    portCountryWarning: ctx.portCountryWarning,
    customsOffice: data.customsOffice || ctx.customsOffice,
    customsBroker: data.customsBroker || ctx.customsBroker,
    defaultVatRatePct: ctx.defaultVatRatePct,
    vatRateRequired: true,
    importVatRatePct: vatRate,
    dutyMode: useFixedDuty ? 'fixed_amount' : 'rate_pct',
    ...totals,
    proformas: (ctx.proformas || []).map((p) => ({
      id: p.id,
      piNumber: p.piNumber,
      status: p.status,
    })),
    financeLcs: (ctx.financeLcs || []).map((l) => ({
      id: l.id,
      lcNumber: l.lcNumber,
      status: l.status,
      latestShipmentDate: l.latestShipmentDate,
      expiryDate: l.expiryDate,
    })),
    calculationNote: `CIF (${ctx.baseCurrencyCode}) = (${foreignGoodsValue}${
      includeExtras ? ` + freight ${freightForeign} + insurance ${insuranceForeign}` : ' (incoterm includes freight/insurance)'
    }) × rate ${exchangeRate}`,
  };
}

async function enrichCustomsClearance(record, extras = {}) {
  if (!record) return record;
  const status = normalizeCustomsStatus(record.clearanceStatus);
  const hsList = Array.isArray(record.lines)
    ? [...new Set(record.lines.map((l) => l.hsCode).filter(Boolean))]
    : Array.isArray(record.hsCodes)
      ? record.hsCodes
      : record.hsCodes
        ? [record.hsCodes]
        : [];
  const declared =
    record.billOfEntryNo &&
    String(record.billOfEntryNo).trim() &&
    !String(record.billOfEntryNo).startsWith('ICC-') &&
    record.billOfEntryNo !== record.entryNumber;

  const customsRate = toNumber(record.exchangeRateToUsd, 0);
  const currentPoRate =
    extras.currentPoRate != null
      ? toNumber(extras.currentPoRate)
      : record.importPo
        ? toNumber(record.importPo.exchangeRateToUsd)
        : null;
  const rateStale =
    currentPoRate != null &&
    customsRate > 0 &&
    Math.abs(currentPoRate - customsRate) > 0.0000001;

  const lineTariffs =
    Array.isArray(record.lines) && record.lines.length
      ? record.lines.map((l) => ({
          hsCode: l.hsCode,
          dutyRatePct: toNumber(l.dutyRatePct),
          label: `${l.hsCode} @ ${toNumber(l.dutyRatePct)}%`,
          dutySource: l.rateOverride
            ? `Manual override${l.overrideReason ? ` (${l.overrideReason})` : ''}`
            : 'Tariff table',
        }))
      : [];
  const hsTariffDisplay = lineTariffs.length
    ? [...new Set(lineTariffs.map((l) => l.label))].join(', ')
    : hsList.length
      ? hsList.join(', ')
      : null;

  const rawPayments = Array.isArray(extras.payments) ? extras.payments : record.dutyPayments || [];
  const payments = rawPayments.map((p) => ({
    ...p,
    paymentDate: p.paymentDate ? toDateInputValue(p.paymentDate) || p.paymentDate : p.paymentDate,
  }));
  const totalPaid = round2(
    payments.reduce((s, p) => s + toNumber(p.amount), 0) || toNumber(record.dutyPaidTotalUsd)
  );
  const payable = round2(toNumber(record.totalCustomsPayableUsd));
  const balanceDue = round2(Math.max(0, payable - totalPaid));
  const lastPayment = payments.length
    ? [...payments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
    : null;

  return {
    ...record,
    // Calendar dates as YYYY-MM-DD (import module convention — avoids TZ day shifts in clients)
    declarationDate: toDateInputValue(record.declarationDate) || record.declarationDate,
    assessmentDate: record.assessmentDate ? toDateInputValue(record.assessmentDate) : null,
    releaseDate: record.releaseDate ? toDateInputValue(record.releaseDate) : null,
    dutyPaymentDate: record.dutyPaymentDate ? toDateInputValue(record.dutyPaymentDate) : null,
    exchangeRateDate: record.exchangeRateDate
      ? toDateInputValue(record.exchangeRateDate) || record.exchangeRateDate
      : record.exchangeRateDate,
    clearanceStatus: status,
    declarationNumber: declared ? record.billOfEntryNo : null,
    declarationDisplay: declared ? record.billOfEntryNo : 'Not yet declared',
    internalRef: record.entryNumber,
    vatUsd: record.importVatUsd,
    portHandlingUsd: record.portHandlingChargesUsd,
    clearingAgencyFeeUsd: record.clearingBrokerFeeUsd,
    hsCodes: hsList.length ? hsList.join(', ') : null,
    hsCodeList: hsList,
    tariffSummary: hsTariffDisplay,
    hsTariffDisplay,
    lineTariffs,
    lines: Array.isArray(record.lines)
      ? record.lines.map((l) => ({
          ...l,
          dutySource: l.rateOverride
            ? `Manual override${l.overrideReason ? ` (${l.overrideReason})` : ''}`
            : 'Tariff table',
        }))
      : record.lines,
    baseCurrencyCode: record.baseCurrencyCode || extras.baseCurrencyCode || 'PKR',
    declarationCurrency: record.declarationCurrency || extras.declarationCurrency || 'USD',
    rateSourceLabel: record.rateSource && String(record.rateSource).trim()
      ? String(record.rateSource).trim()
      : 'not recorded',
    currentPoExchangeRate: currentPoRate,
    rateStale,
    canRecalculateRate: rateStale && status === 'Under Assessment',
    canRefreshTariff: status === 'Under Assessment' || status === 'Draft',
    payments,
    totalPaid,
    payableAmount: payable,
    balanceDue,
    lastJournalEntryId: lastPayment?.journalEntryId || record.lastJournalEntryId || null,
    lastJournalEntryNumber:
      lastPayment?.journalEntryNumber || extras.lastJournalEntryNumber || null,
    auditTrail: Array.isArray(extras.auditTrail)
      ? extras.auditTrail.filter(Boolean).map(formatCustomsAuditRow)
      : [],
    linkedProformas: extras.linkedProformas || [],
    linkedLcs: extras.linkedLcs || [],
    portCountryWarning: extras.portCountryWarning || null,
    portLabel: extras.portLabel || record.portOfEntry,
  };
}

async function getCustomsClearanceById(req, id) {
  const record = await prisma.importCustomsClearance.findUnique({
    where: { id },
    include: {
      importPo: true,
      shipment: true,
      lines: true,
      dutyPayments: { orderBy: { createdAt: 'asc' } },
      creator: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  if (!record) throw customsError('Customs Clearance record not found', null, 'NOT_FOUND', 404);
  await assertRecordCompanyAccess(req, record.companyId);

  const linkedProformas = record.importPoId
    ? await prisma.importProformaInvoice.findMany({
        where: {
          companyId: record.companyId,
          importPoId: record.importPoId,
          status: { notIn: ['Cancelled', 'Rejected', 'Expired'] },
        },
        select: { id: true, piNumber: true, status: true },
        take: 10,
      })
    : [];
  const linkedLcs = record.importPoId
    ? await prisma.importFinanceLc.findMany({
        where: {
          companyId: record.companyId,
          importPoId: record.importPoId,
          status: { notIn: ['Cancelled', 'Expired'] },
        },
        select: {
          id: true,
          lcNumber: true,
          status: true,
          latestShipmentDate: true,
          expiryDate: true,
        },
        take: 10,
      })
    : [];

  const portMeta = await resolvePortMeta(record.portOfEntry);
  const settings = await prisma.importSetting.findUnique({ where: { companyId: record.companyId } }).catch(() => null);
  const companyCountry =
    settings?.companyCountryCode ||
    (String(record.baseCurrencyCode || '').toUpperCase() === 'PKR' ? 'PK' : null);
  const portCountryWarning =
    companyCountry &&
    portMeta?.countryCode &&
    String(portMeta.countryCode).toUpperCase() !== String(companyCountry).toUpperCase()
      ? `Port of entry ${portMeta.label} is outside the company country (${companyCountry}). Duties are in ${record.baseCurrencyCode || 'local currency'}.`
      : null;

  const auditTrail = await prisma.importAuditLog.findMany({
    where: { companyId: record.companyId, entityType: 'IMPORT_CUSTOMS', entityId: id },
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return enrichCustomsClearance(record, {
    auditTrail,
    linkedProformas,
    linkedLcs,
    portCountryWarning,
    portLabel: portMeta?.label,
    currentPoRate: record.importPo?.exchangeRateToUsd,
    payments: record.dutyPayments || [],
  });
}

/**
 * Recalculate customs CIF/duty/VAT using the current PO FX rate.
 * Allowed only while Under Assessment; requires a reason; writes audit with old vs new totals.
 */
async function recalculateCustomsWithCurrentRate(req, id, data = {}) {
  const companyId = requireSingleCompany(req);
  const userId = req.user?.id;
  const reason = data.reason != null ? String(data.reason).trim() : '';
  if (!reason) throw customsError('Reason is required to recalculate with the current PO rate', 'reason');

  const existing = await prisma.importCustomsClearance.findFirst({
    where: { id, companyId },
    include: { lines: true, importPo: true, shipment: true },
  });
  if (!existing) throw customsError('Customs Clearance record not found', null, 'NOT_FOUND', 404);

  const status = normalizeCustomsStatus(existing.clearanceStatus);
  if (status !== 'Under Assessment') {
    throw customsError(
      'Recalculate with current rate is only allowed while status is Under Assessment',
      'clearanceStatus'
    );
  }
  if (!existing.shipmentId) throw customsError('Shipment is required on the customs entry', 'shipmentId');
  if (!existing.importPo) throw customsError('Linked PO not found', 'importPoId');

  const newRate = toNumber(existing.importPo.exchangeRateToUsd, 0);
  if (newRate <= 0) throw customsError('Current PO exchange rate is missing or invalid', 'exchangeRateToUsd');

  const oldTotals = {
    exchangeRate: toNumber(existing.exchangeRateToUsd),
    cifValueUsd: toNumber(existing.cifValueUsd),
    customsDutyUsd: toNumber(existing.customsDutyUsd),
    importVatUsd: toNumber(existing.importVatUsd),
    totalCustomsPayableUsd: toNumber(existing.totalCustomsPayableUsd),
  };

  const preview = await previewCustomsClearance(req, {
    shipmentId: existing.shipmentId,
    exchangeRateToUsd: newRate,
    exchangeRateDate: existing.importPo.exchangeRateDate || existing.exchangeRateDate || new Date(),
    importVatRatePct: existing.importVatRatePct,
    customsDutyRatePct: existing.customsDutyRatePct,
    customsDutyUsd:
      toNumber(existing.customsDutyRatePct) > 0 ? undefined : existing.customsDutyUsd,
    portHandlingChargesUsd: existing.portHandlingChargesUsd,
    clearingBrokerFeeUsd: existing.clearingBrokerFeeUsd,
    demurrageChargesUsd: existing.demurrageChargesUsd,
    additionalDutyRatePct: existing.additionalDutyRatePct,
    regulatoryDutyRatePct: existing.regulatoryDutyRatePct,
    advanceIncomeTaxRatePct: existing.advanceIncomeTaxRatePct,
    inspectionFeeUsd: existing.inspectionFeeUsd,
    penaltiesUsd: existing.penaltiesUsd,
  });

  await prisma.$transaction(async (tx) => {
    await tx.importCustomsClearanceLine.deleteMany({ where: { clearanceId: id } });
    await tx.importCustomsClearance.update({
      where: { id },
      data: {
        cifValueUsd: preview.cifValueUsd,
        exchangeRateToUsd: preview.exchangeRate,
        exchangeRateDate: preview.exchangeRateDate,
        rateSource: 'PO FX snapshot (recalculated)',
        foreignGoodsValue: preview.foreignGoodsValue,
        freightForeign: preview.freightForeign,
        insuranceForeign: preview.insuranceForeign,
        customsDutyRatePct: preview.customsDutyRatePct,
        customsDutyUsd: preview.customsDutyUsd,
        additionalDutyUsd: preview.additionalDutyUsd,
        regulatoryDutyUsd: preview.regulatoryDutyUsd,
        advanceIncomeTaxUsd: preview.advanceIncomeTaxUsd,
        importVatUsd: preview.importVatUsd,
        portHandlingChargesUsd: preview.portHandlingChargesUsd,
        clearingBrokerFeeUsd: preview.clearingBrokerFeeUsd,
        demurrageChargesUsd: preview.demurrageChargesUsd,
        totalCustomsPayableUsd: preview.totalCustomsPayableUsd,
        hsCodes: preview.lines.map((l) => l.hsCode),
        lines: {
          create: preview.lines.map((ln) => ({
            shipmentItemId: ln.shipmentItemId,
            importPoItemId: ln.importPoItemId,
            productId: ln.productId,
            productName: ln.productName,
            sku: ln.sku,
            hsCode: ln.hsCode,
            quantity: ln.quantity,
            uom: ln.uom,
            assessableValueBase: ln.assessableValueBase,
            dutyRatePct: ln.dutyRatePct,
            dutyAmountBase: ln.dutyAmountBase,
            additionalDutyRatePct: ln.additionalDutyRatePct,
            additionalDutyBase: ln.additionalDutyBase,
            regulatoryDutyRatePct: ln.regulatoryDutyRatePct,
            regulatoryDutyBase: ln.regulatoryDutyBase,
            vatRatePct: ln.vatRatePct,
            vatAmountBase: ln.vatAmountBase,
            rateOverride: Boolean(ln.rateOverride),
            overrideReason: ln.overrideReason || null,
          })),
        },
      },
    });
  });

  const newTotals = {
    exchangeRate: preview.exchangeRate,
    cifValueUsd: preview.cifValueUsd,
    customsDutyUsd: preview.customsDutyUsd,
    importVatUsd: preview.importVatUsd,
    totalCustomsPayableUsd: preview.totalCustomsPayableUsd,
  };

  await logImportAudit({
    companyId,
    action: 'RECALCULATE_RATE',
    entityType: 'IMPORT_CUSTOMS',
    entityId: id,
    details: {
      reason,
      note: 'Recalculated with current PO rate',
      oldTotals,
      newTotals,
    },
    userId,
  });

  const refreshed = await getCustomsClearanceById(req, id);
  return {
    ...refreshed,
    recalculation: { oldTotals, newTotals, reason },
  };
}

/**
 * Fill HS codes from shipment/PO lines and recompute duty from the tariff table.
 */
async function refreshCustomsTariffData(req, id, data = {}) {
  const companyId = requireSingleCompany(req);
  const userId = req.user?.id;
  const reason = data.reason != null ? String(data.reason).trim() : '';
  if (!reason) throw customsError('Reason is required to refresh tariff data', 'reason');

  const existing = await prisma.importCustomsClearance.findFirst({
    where: { id, companyId },
    include: { lines: true, importPo: true, shipment: true },
  });
  if (!existing) throw customsError('Customs Clearance record not found', null, 'NOT_FOUND', 404);

  const status = normalizeCustomsStatus(existing.clearanceStatus);
  if (status !== 'Under Assessment' && status !== 'Draft') {
    throw customsError(
      'Refresh tariff data is only allowed while status is Draft or Under Assessment',
      'clearanceStatus'
    );
  }
  if (!existing.shipmentId) throw customsError('Shipment is required on the customs entry', 'shipmentId');

  const oldTotals = {
    customsDutyUsd: toNumber(existing.customsDutyUsd),
    importVatUsd: toNumber(existing.importVatUsd),
    totalCustomsPayableUsd: toNumber(existing.totalCustomsPayableUsd),
    hsCodes: existing.hsCodes,
    lineCount: (existing.lines || []).length,
  };

  const preview = await previewCustomsClearance(req, {
    shipmentId: existing.shipmentId,
    exchangeRateToUsd: existing.exchangeRateToUsd,
    exchangeRateDate: existing.exchangeRateDate || new Date(),
    importVatRatePct: existing.importVatRatePct,
    portHandlingChargesUsd: existing.portHandlingChargesUsd,
    clearingBrokerFeeUsd: existing.clearingBrokerFeeUsd,
    demurrageChargesUsd: existing.demurrageChargesUsd,
    additionalDutyRatePct: existing.additionalDutyRatePct,
    regulatoryDutyRatePct: existing.regulatoryDutyRatePct,
    advanceIncomeTaxRatePct: existing.advanceIncomeTaxRatePct,
    inspectionFeeUsd: existing.inspectionFeeUsd,
    penaltiesUsd: existing.penaltiesUsd,
  });

  if (!preview.lines?.length) {
    throw customsError(
      'No HS codes found on shipment/PO lines. Add HS codes on the PO items first.',
      'hsCode',
      'HS_CODE_REQUIRED'
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.importCustomsClearanceLine.deleteMany({ where: { clearanceId: id } });
    await tx.importCustomsClearance.update({
      where: { id },
      data: {
        customsDutyRatePct: preview.customsDutyRatePct,
        customsDutyUsd: preview.customsDutyUsd,
        additionalDutyUsd: preview.additionalDutyUsd,
        regulatoryDutyUsd: preview.regulatoryDutyUsd,
        advanceIncomeTaxUsd: preview.advanceIncomeTaxUsd,
        importVatUsd: preview.importVatUsd,
        totalCustomsPayableUsd: preview.totalCustomsPayableUsd,
        hsCodes: preview.lines.map((l) => l.hsCode),
        lines: {
          create: preview.lines.map((ln) => ({
            shipmentItemId: ln.shipmentItemId,
            importPoItemId: ln.importPoItemId,
            productId: ln.productId,
            productName: ln.productName,
            sku: ln.sku,
            hsCode: ln.hsCode,
            quantity: ln.quantity,
            uom: ln.uom,
            assessableValueBase: ln.assessableValueBase,
            dutyRatePct: ln.dutyRatePct,
            dutyAmountBase: ln.dutyAmountBase,
            additionalDutyRatePct: ln.additionalDutyRatePct,
            additionalDutyBase: ln.additionalDutyBase,
            regulatoryDutyRatePct: ln.regulatoryDutyRatePct,
            regulatoryDutyBase: ln.regulatoryDutyBase,
            vatRatePct: ln.vatRatePct,
            vatAmountBase: ln.vatAmountBase,
            rateOverride: false,
            overrideReason: null,
          })),
        },
      },
    });
  });

  const newTotals = {
    customsDutyUsd: preview.customsDutyUsd,
    importVatUsd: preview.importVatUsd,
    totalCustomsPayableUsd: preview.totalCustomsPayableUsd,
    hsCodes: preview.lines.map((l) => l.hsCode),
    lineCount: preview.lines.length,
  };

  await logImportAudit({
    companyId,
    action: 'REFRESH_TARIFF',
    entityType: 'IMPORT_CUSTOMS',
    entityId: id,
    details: {
      reason,
      note: 'HS codes and tariff rates refreshed from shipment/PO lines',
      oldTotals,
      newTotals,
    },
    userId,
  });

  const refreshed = await getCustomsClearanceById(req, id);
  return {
    ...refreshed,
    tariffRefresh: { oldTotals, newTotals, reason },
  };
}

async function createCustomsClearanceEnterprise(req, data = {}) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;

  if (data.idempotencyKey) {
    const existing = await prisma.importCustomsClearance.findFirst({
      where: { companyId, idempotencyKey: data.idempotencyKey },
      include: { lines: true, importPo: true, shipment: true },
    });
    if (existing) return enrichCustomsClearance(existing);
  }

  if (!data.shipmentId) throw customsError('Shipment is required', 'shipmentId');

  const existingForShipment = await prisma.importCustomsClearance.findFirst({
    where: { companyId, shipmentId: data.shipmentId, clearanceStatus: { not: 'Cancelled' } },
  });
  if (existingForShipment) {
    throw customsError(
      'An active customs clearance already exists for this shipment',
      'shipmentId',
      'DUPLICATE_SHIPMENT'
    );
  }

  const preview = await previewCustomsClearance(req, data);

  if (data.importVatRatePct === undefined || data.importVatRatePct === null || data.importVatRatePct === '') {
    throw customsError('VAT rate is required', 'importVatRatePct');
  }
  if (toNumber(data.importVatRatePct) < 0) {
    throw customsError('VAT rate is required', 'importVatRatePct');
  }

  const useFixedDuty = data.customsDutyUsd != null && data.customsDutyUsd !== '';
  const useRate = data.customsDutyRatePct != null && data.customsDutyRatePct !== '';
  if (!useFixedDuty && !useRate && !preview.lines?.length) {
    throw customsError(
      'Customs duty rate or amount is required (customsDutyRatePct or customsDutyUsd)',
      'customsDutyRatePct',
      'DUTY_RATE_REQUIRED'
    );
  }

  if (toNumber(preview.cifValueUsd) <= 0) {
    throw customsError('CIF value must be greater than 0', 'cifValueUsd');
  }

  const billOfEntryNo = data.billOfEntryNo ? String(data.billOfEntryNo).trim() : null;
  const customsOffice = data.customsOffice ? String(data.customsOffice).trim() : preview.customsOffice;
  if (billOfEntryNo && customsOffice) {
    const dup = await prisma.importCustomsClearance.findFirst({
      where: {
        companyId,
        customsOffice,
        billOfEntryNo,
        clearanceStatus: { not: 'Cancelled' },
      },
    });
    if (dup) {
      throw customsError(
        `Declaration number ${billOfEntryNo} already exists for customs office ${customsOffice}`,
        'billOfEntryNo',
        'DUPLICATE_DECLARATION'
      );
    }
  }

  const declarationDate = data.declarationDate
    ? toDbDateOnly(data.declarationDate) || new Date()
    : new Date();
  let rateDate;
  try {
    rateDate = assertImportRateDate(data.exchangeRateDate || preview.exchangeRateDate || new Date(), {
      orderDate: preview.importPoOrderDate || null,
      field: 'exchangeRateDate',
      label: 'Customs rate date',
    });
  } catch (err) {
    throw customsError(err.message, err.field || 'exchangeRateDate', err.code || 'RATE_DATE_INVALID');
  }

  const count = await prisma.importCustomsClearance.count({ where: { companyId } });
  const year = new Date().getFullYear();
  const entryNumber = data.entryNumber || `ICC-${year}-${String(count + 1).padStart(3, '0')}`;

  const totals = preview;
  const hsCodes = totals.lines.map((l) => l.hsCode);

  const record = await prisma.importCustomsClearance.create({
    data: {
      companyId,
      entryNumber,
      billOfEntryNo: billOfEntryNo || entryNumber,
      importPoId: preview.importPoId,
      poRef: preview.poRef,
      shipmentId: preview.shipmentId,
      shipmentRef: preview.shipmentNumber,
      portOfEntry: data.portOfEntry || preview.portOfEntry,
      customsOffice: customsOffice || null,
      declarationDate,
      assessmentDate: data.assessmentDate
        ? assertCustomsCalendarDate(data.assessmentDate, {
            createdAt: declarationDate,
            field: 'assessmentDate',
            label: 'Assessment date',
          })
        : null,
      customsBroker: data.customsBroker || preview.customsBroker || null,
      brokerContact: data.brokerContact || null,
      cifValueUsd: totals.cifValueUsd,
      declarationCurrency: preview.currency,
      baseCurrencyCode: preview.baseCurrencyCode,
      exchangeRateToUsd: preview.exchangeRate,
      exchangeRateDate: rateDate,
      rateSource: preview.rateSource,
      foreignGoodsValue: preview.foreignGoodsValue,
      freightForeign: preview.freightForeign,
      insuranceForeign: preview.insuranceForeign,
      customsDutyRatePct: totals.customsDutyRatePct,
      customsDutyUsd: totals.customsDutyUsd,
      additionalDutyRatePct:
        data.additionalDutyRatePct !== undefined && data.additionalDutyRatePct !== ''
          ? toNumber(data.additionalDutyRatePct)
          : null,
      additionalDutyUsd: totals.additionalDutyUsd,
      regulatoryDutyRatePct:
        data.regulatoryDutyRatePct !== undefined && data.regulatoryDutyRatePct !== ''
          ? toNumber(data.regulatoryDutyRatePct)
          : null,
      regulatoryDutyUsd: totals.regulatoryDutyUsd,
      advanceIncomeTaxRatePct:
        data.advanceIncomeTaxRatePct !== undefined && data.advanceIncomeTaxRatePct !== ''
          ? toNumber(data.advanceIncomeTaxRatePct)
          : null,
      advanceIncomeTaxUsd: totals.advanceIncomeTaxUsd,
      importVatRatePct: toNumber(data.importVatRatePct),
      importVatUsd: totals.importVatUsd,
      portHandlingChargesUsd: totals.portHandlingChargesUsd,
      clearingBrokerFeeUsd: totals.clearingBrokerFeeUsd,
      demurrageDays:
        data.demurrageDays !== undefined && data.demurrageDays !== null && data.demurrageDays !== ''
          ? toNumber(data.demurrageDays)
          : null,
      demurrageChargesUsd: totals.demurrageChargesUsd,
      inspectionFeeUsd: totals.inspectionFeeUsd ?? 0,
      penaltiesUsd: totals.penaltiesUsd ?? 0,
      totalCustomsPayableUsd: totals.totalCustomsPayableUsd,
      hsCodes,
      clearanceStatus: 'Draft',
      holdReason: null,
      discrepancyNotes: data.discrepancyNotes || null,
      exemptionsNotes: data.exemptionsNotes || null,
      fxReviewFlag: false,
      idempotencyKey: data.idempotencyKey || null,
      createdBy: userId,
      lines: {
        create: totals.lines.map((ln) => ({
          shipmentItemId: ln.shipmentItemId,
          importPoItemId: ln.importPoItemId,
          productId: ln.productId,
          productName: ln.productName,
          sku: ln.sku,
          hsCode: ln.hsCode,
          quantity: ln.quantity,
          uom: ln.uom,
          assessableValueBase: ln.assessableValueBase,
          dutyRatePct: ln.dutyRatePct,
          dutyAmountBase: ln.dutyAmountBase,
          additionalDutyRatePct: ln.additionalDutyRatePct,
          additionalDutyBase: ln.additionalDutyBase,
          regulatoryDutyRatePct: ln.regulatoryDutyRatePct,
          regulatoryDutyBase: ln.regulatoryDutyBase,
          vatRatePct: ln.vatRatePct,
          vatAmountBase: ln.vatAmountBase,
          rateOverride: Boolean(ln.rateOverride),
          overrideReason: ln.overrideReason || null,
        })),
      },
    },
    include: { lines: true, importPo: true, shipment: true },
  });

  // Move shipment into Customs Clearance
  if (record.shipmentId) {
    await prisma.importShipment
      .update({
        where: { id: record.shipmentId },
        data: { shipmentStatus: 'Customs Clearance', currentMilestone: 'Customs Clearance' },
      })
      .catch(() => {});
  }
  if (record.importPoId) {
    await prisma.importPurchaseOrder
      .update({ where: { id: record.importPoId }, data: { status: 'Customs Clearance' } })
      .catch(() => {});
  }

  // Seed / update landed cost component draft
  await upsertCustomsLandedCostComponents(record, userId);

  await logImportAudit({
    companyId,
    action: 'CREATE',
    entityType: 'IMPORT_CUSTOMS',
    entityId: record.id,
    details: {
      from: null,
      to: 'Draft',
      previousStatus: null,
      nextStatus: 'Draft',
      entryNumber,
      billOfEntryNo: record.billOfEntryNo,
      cifValueUsd: record.cifValueUsd,
      exchangeRate: record.exchangeRateToUsd,
      rateSource: record.rateSource,
    },
    userId,
  });

  return getCustomsClearanceById(req, record.id);
}

async function upsertCustomsLandedCostComponents(record, userId) {
  try {
    const companyId = record.companyId;
    let lc = null;
    if (record.landedCostId) {
      lc = await prisma.importLandedCost.findFirst({ where: { id: record.landedCostId, companyId } });
    }
    if (!lc && record.shipmentId) {
      lc = await prisma.importLandedCost.findFirst({
        where: { companyId, shipmentId: record.shipmentId, status: { not: 'Reversed' } },
        orderBy: { createdAt: 'desc' },
      });
    }
    const payload = {
      customsDutyUsd: toNumber(record.customsDutyUsd) + toNumber(record.additionalDutyUsd) + toNumber(record.regulatoryDutyUsd),
      portDemurrageAndHandlingUsd:
        toNumber(record.portHandlingChargesUsd) + toNumber(record.demurrageChargesUsd),
      clearingAgencyChargesUsd: toNumber(record.clearingBrokerFeeUsd),
      customsClearanceId: record.id,
      importPoId: record.importPoId,
      poRef: record.poRef,
      shipmentId: record.shipmentId,
      shipmentRef: record.shipmentRef,
    };
    if (lc) {
      const totalExpenses =
        toNumber(lc.oceanFreightUsd) +
        toNumber(payload.customsDutyUsd) +
        toNumber(lc.marineInsuranceUsd) +
        toNumber(payload.portDemurrageAndHandlingUsd) +
        toNumber(payload.clearingAgencyChargesUsd) +
        toNumber(lc.inlandTransportationUsd);
      await prisma.importLandedCost.update({
        where: { id: lc.id },
        data: {
          ...payload,
          totalLandedExpensesUsd: totalExpenses,
          totalFinalLandedCostUsd: toNumber(lc.purchaseFobTotalUsd) + totalExpenses,
        },
      });
      if (!record.landedCostId) {
        await prisma.importCustomsClearance.update({
          where: { id: record.id },
          data: { landedCostId: lc.id },
        });
      }
      return;
    }
    const count = await prisma.importLandedCost.count({ where: { companyId } });
    const year = new Date().getFullYear();
    const allocationNumber = `ILC-ALLOC-${year}-${String(count + 1).padStart(3, '0')}`;
    const totalExpenses =
      toNumber(payload.customsDutyUsd) +
      toNumber(payload.portDemurrageAndHandlingUsd) +
      toNumber(payload.clearingAgencyChargesUsd);
    const created = await prisma.importLandedCost.create({
      data: {
        companyId,
        allocationNumber,
        ...payload,
        purchaseFobTotalUsd: toNumber(record.cifValueUsd),
        totalLandedExpensesUsd: totalExpenses,
        totalFinalLandedCostUsd: toNumber(record.cifValueUsd) + totalExpenses,
        status: 'Draft',
        notes: `Auto from customs ${record.entryNumber}`,
        createdBy: userId,
      },
    });
    await prisma.importCustomsClearance.update({
      where: { id: record.id },
      data: { landedCostId: created.id },
    });
  } catch (err) {
    console.warn('[ImportCustoms] Landed cost sync skipped:', err.message);
  }
}

async function updateCustomsStatusEnterprise(req, id, status, paymentRef, extra = {}) {
  const existing = await prisma.importCustomsClearance.findUnique({
    where: { id },
    include: { lines: true, importPo: true, shipment: true, dutyPayments: true },
  });
  if (!existing) throw customsError('Customs Clearance record not found', null, 'NOT_FOUND', 404);
  await assertRecordCompanyAccess(req, existing.companyId);

  const { from, to } = assertCustomsTransition(existing.clearanceStatus, status);

  // Approval gates use dedicated endpoints (submit / approve / reject)
  if (to === 'Pending Approval' || (from === 'Pending Approval' && to === 'Approved')) {
    throw customsError(
      to === 'Pending Approval'
        ? 'Use Send for Approval — status cannot jump to Pending Approval directly'
        : 'Use Approve action — status cannot jump to Approved directly',
      'status',
      'USE_APPROVAL_ACTION'
    );
  }
  if (from === 'Pending Approval' && to === 'Duty Paid' && !extra._rejectApproval) {
    throw customsError(
      'Use Reject Approval action to send a pending clearance back to Duty Paid',
      'status',
      'USE_APPROVAL_ACTION'
    );
  }

  const settings = await prisma.importSetting.findUnique({ where: { companyId: existing.companyId } }).catch(() => null);
  const userId = req.user.id;
  const note = extra.reason || extra.note || extra.holdReason || null;

  if (to === 'Under Assessment') {
    // Makers (create/edit) can send for assessment; assessors may also send
    const effective =
      req.effectivePermissions ||
      (await getEffectivePermissions(userId, existing.companyId));
    if (
      !hasAnyEffectivePermission(effective, [
        'import.customs.create',
        'import.customs.edit',
        'import.customs.assess',
      ])
    ) {
      throw customsError(
        'You do not have permission to submit customs clearance for assessment',
        'permission',
        'PERMISSION_DENIED',
        403
      );
    }
  } else if (to === 'Assessed') {
    if (from === 'Pending Payment') {
      // Payer sends payment request back to Assessed
      await assertCanRecordCustomsDutyPayment(req, {
        companyId: existing.companyId,
        entityId: id,
      });
    } else {
      await assertCustomsPermission(req, 'import.customs.assess', {
        companyId: existing.companyId,
        entityId: id,
      });
    }
  } else if (to === 'Draft' && from === 'Under Assessment') {
    // Assessor rejects / sends back for correction
    await assertCustomsPermission(req, 'import.customs.assess', {
      companyId: existing.companyId,
      entityId: id,
    });
  } else if (to === 'Pending Payment') {
    const effective =
      req.effectivePermissions ||
      (await getEffectivePermissions(userId, existing.companyId));
    if (
      !hasAnyEffectivePermission(effective, [
        'import.customs.create',
        'import.customs.edit',
        'import.customs.assess',
        'import.customs.record_payment',
      ])
    ) {
      throw customsError(
        'You do not have permission to submit customs clearance for duty payment',
        'permission',
        'PERMISSION_DENIED',
        403
      );
    }
  } else if (to === 'Duty Paid' || to === 'Partially Paid') {
    await assertCanRecordCustomsDutyPayment(req, {
      companyId: existing.companyId,
      entityId: id,
    });
  } else if (to === 'Released/Cleared') {
    if (normalizeCustomsStatus(existing.clearanceStatus) !== 'Approved') {
      throw customsError(
        'Customs clearance must be Approved before Released/Cleared. Send for approval first.',
        'status',
        'APPROVAL_REQUIRED'
      );
    }
    await assertCustomsPermission(req, 'import.customs.release', {
      companyId: existing.companyId,
      entityId: id,
    });
  } else if (to === 'On Hold/Examination') {
    await assertCustomsPermission(req, 'import.customs.hold', {
      companyId: existing.companyId,
      entityId: id,
    });
  } else if (to === 'Cancelled') {
    await assertCustomsPermission(req, 'import.customs.cancel', {
      companyId: existing.companyId,
      entityId: id,
    });
  }

  if (to === 'Duty Paid' || to === 'Partially Paid') {
    return recordCustomsDutyPayment(req, id, {
      ...extra,
      dutyPaymentRef: paymentRef || extra.dutyPaymentRef,
    });
  }

  let assessedDateForPatch = null;
  let releaseDateForPatch = null;

  if (to === 'Assessed' && from !== 'Pending Payment') {
    if (settings?.requireSeparateCustomsAssessor !== false && existing.createdBy && existing.createdBy === userId) {
      throw customsError(
        'Creator and assessor must be different users',
        'status',
        'SOD_VIOLATION'
      );
    }
    assessedDateForPatch = assertCustomsCalendarDate(
      extra.assessmentDate || existing.assessmentDate || new Date(),
      {
        createdAt: existing.createdAt,
        field: 'assessmentDate',
        label: 'Assessment date',
      }
    );
  }

  if (to === 'Released/Cleared') {
    const boeCandidate = String(extra.billOfEntryNo || existing.billOfEntryNo || '').trim();
    const official =
      boeCandidate &&
      boeCandidate !== existing.entryNumber &&
      !boeCandidate.startsWith('ICC-');
    if (!official) {
      throw customsError(
        'Official declaration number (BOE/GD) must be entered before Released/Cleared',
        'billOfEntryNo'
      );
    }
    if (!existing.assessmentDate && !extra.assessmentDate) {
      throw customsError('Assessment date is required before release', 'assessmentDate');
    }
    if (normalizeCustomsStatus(existing.clearanceStatus) !== 'Approved') {
      throw customsError(
        'Customs clearance & port formalities must be Approved before release',
        'status',
        'APPROVAL_REQUIRED'
      );
    }
    if (extra.assessmentDate) {
      assessedDateForPatch = assertCustomsCalendarDate(extra.assessmentDate, {
        createdAt: existing.createdAt,
        field: 'assessmentDate',
        label: 'Assessment date',
      });
    }
    releaseDateForPatch = assertCustomsCalendarDate(extra.releaseDate || new Date(), {
      createdAt: existing.createdAt,
      field: 'releaseDate',
      label: 'Release date',
    });
    const assessmentDate = parseDateOnly(assessedDateForPatch || existing.assessmentDate);
    const releaseDate = parseDateOnly(releaseDateForPatch);
    if (assessmentDate && releaseDate && releaseDate.getTime() < assessmentDate.getTime()) {
      throw customsError('Release date must not be before the assessment date', 'releaseDate');
    }
  }

  if (to === 'On Hold/Examination' && !(extra.holdReason || note)) {
    throw customsError('Hold reason is required', 'holdReason');
  }

  const patch = {
    clearanceStatus: to === 'Released/Cleared' ? 'Released/Cleared' : to,
  };

  if (to === 'Assessed' && from !== 'Pending Payment') {
    patch.assessedBy = userId;
    patch.assessedAt = new Date();
    patch.assessmentDate = assessedDateForPatch;
  }
  if (extra.assessmentDate && to !== 'Assessed' && to !== 'Released/Cleared') {
    patch.assessmentDate = assertCustomsCalendarDate(extra.assessmentDate, {
      createdAt: existing.createdAt,
      field: 'assessmentDate',
      label: 'Assessment date',
    });
  }
  if (extra.billOfEntryNo) patch.billOfEntryNo = String(extra.billOfEntryNo).trim();
  if (extra.customsOffice) patch.customsOffice = String(extra.customsOffice).trim();
  if (extra.holdReason || (to === 'On Hold/Examination' && note)) {
    patch.holdReason = extra.holdReason || note;
  }
  if (extra.discrepancyNotes) patch.discrepancyNotes = extra.discrepancyNotes;

  if (to === 'Released/Cleared') {
    if (assessedDateForPatch) patch.assessmentDate = assessedDateForPatch;
    patch.releaseDate = releaseDateForPatch;
  }

  // Duplicate official declaration check on update
  if (patch.billOfEntryNo || patch.customsOffice) {
    const office = patch.customsOffice || existing.customsOffice;
    const boe = patch.billOfEntryNo || existing.billOfEntryNo;
    if (office && boe) {
      const dup = await prisma.importCustomsClearance.findFirst({
        where: {
          companyId: existing.companyId,
          customsOffice: office,
          billOfEntryNo: boe,
          clearanceStatus: { not: 'Cancelled' },
          NOT: { id },
        },
      });
      if (dup) {
        throw customsError(
          `Declaration number ${boe} already exists for customs office ${office}`,
          'billOfEntryNo',
          'DUPLICATE_DECLARATION'
        );
      }
    }
  }

  const updated = await prisma.importCustomsClearance.update({
    where: { id },
    data: patch,
    include: { lines: true, importPo: true, shipment: true },
  });

  if (to === 'Released/Cleared' && updated.shipmentId) {
    await prisma.importShipment
      .update({
        where: { id: updated.shipmentId },
        data: { shipmentStatus: 'Cleared', currentMilestone: 'Cleared' },
      })
      .catch(() => {});
    if (updated.importPoId) {
      await prisma.importPurchaseOrder
        .update({ where: { id: updated.importPoId }, data: { status: 'Cleared' } })
        .catch(() => {});
    }
  }
  if (to === 'On Hold/Examination' && updated.shipmentId) {
    await prisma.importShipment
      .update({
        where: { id: updated.shipmentId },
        data: { shipmentStatus: 'Customs Clearance', currentMilestone: 'Customs Clearance' },
      })
      .catch(() => {});
  }

  if (to === 'Duty Paid' || to === 'Released/Cleared') {
    await upsertCustomsLandedCostComponents(updated, userId);
  }

  await logImportAudit({
    companyId: existing.companyId,
    action: 'STATUS_CHANGE',
    entityType: 'IMPORT_CUSTOMS',
    entityId: id,
    details: {
      from,
      to,
      previousStatus: from,
      nextStatus: to,
      reason: note,
      dutyPaymentRef: patch.dutyPaymentRef,
      ...(to === 'Under Assessment' ? { action: 'SUBMIT_FOR_ASSESSMENT' } : {}),
      ...(to === 'Assessed' && from !== 'Pending Payment' ? { action: 'CONFIRM_ASSESSMENT' } : {}),
      ...(to === 'Draft' && from === 'Under Assessment' ? { action: 'REJECT_ASSESSMENT' } : {}),
      ...(to === 'Pending Payment' ? { action: 'SUBMIT_FOR_PAYMENT' } : {}),
      ...(to === 'Assessed' && from === 'Pending Payment' ? { action: 'REJECT_PAYMENT_REQUEST' } : {}),
    },
    userId,
  });

  // Assessment / payment request notifications
  try {
    const { findCompanyUserIdsWithPermission } = require('./importService');
    if (to === 'Under Assessment') {
      const assessorIds = await findCompanyUserIdsWithPermission(
        existing.companyId,
        'import.customs.assess',
        { excludeUserIds: [userId] }
      );
      if (assessorIds.length) {
        await sendToUsers(assessorIds, {
          title: 'Customs assessment requested',
          message: `${existing.entryNumber} was sent for duty assessment.`,
          type: 'action',
          category: 'Import',
          data: {
            entityType: 'IMPORT_CUSTOMS',
            entityId: id,
            entryNumber: existing.entryNumber,
            link: '/import/approvals',
          },
        });
      }
    } else if (to === 'Pending Payment') {
      const payerIds = await findCompanyUserIdsWithPermission(
        existing.companyId,
        'import.customs.record_payment',
        { excludeUserIds: [userId] }
      );
      if (payerIds.length) {
        await sendToUsers(payerIds, {
          title: 'Customs duty payment requested',
          message: `${existing.entryNumber} is ready for duty payment.`,
          type: 'action',
          category: 'Import',
          data: {
            entityType: 'IMPORT_CUSTOMS',
            entityId: id,
            entryNumber: existing.entryNumber,
            link: '/import/approvals',
          },
        });
      }
    } else if (
      (to === 'Assessed' && from === 'Under Assessment') ||
      (to === 'Draft' && from === 'Under Assessment')
    ) {
      const notifyUserId = existing.createdBy;
      if (notifyUserId && notifyUserId !== userId) {
        await sendToUser({
          mongoUserId: notifyUserId,
          title:
            to === 'Assessed'
              ? 'Customs assessment confirmed'
              : 'Customs assessment sent back',
          message:
            to === 'Assessed'
              ? `${existing.entryNumber} assessment was confirmed. Send it for duty payment next.`
              : note
                ? `${existing.entryNumber} was sent back to Draft: ${note}`
                : `${existing.entryNumber} was sent back to Draft. Review and resubmit.`,
          type: to === 'Assessed' ? 'success' : 'warning',
          category: 'Import',
          data: {
            entityType: 'IMPORT_CUSTOMS',
            entityId: id,
            entryNumber: existing.entryNumber,
            link: `/import/customs?id=${id}`,
          },
        });
      }
    } else if (to === 'Assessed' && from === 'Pending Payment') {
      const notifyUserId = existing.createdBy;
      if (notifyUserId && notifyUserId !== userId) {
        await sendToUser({
          mongoUserId: notifyUserId,
          title: 'Duty payment request sent back',
          message: note
            ? `${existing.entryNumber} payment request returned: ${note}`
            : `${existing.entryNumber} was returned to Assessed. Review and resubmit for payment.`,
          type: 'warning',
          category: 'Import',
          data: {
            entityType: 'IMPORT_CUSTOMS',
            entityId: id,
            entryNumber: existing.entryNumber,
            link: `/import/customs?id=${id}`,
          },
        });
      }
    }
  } catch (notifyErr) {
    console.error('[import] Customs workflow notification failed:', notifyErr.message);
  }

  return getCustomsClearanceById(req, id);
}

async function resolveMappedGlAccount(tx, companyId, accountId, label) {
  if (!accountId) {
    throw customsError(
      `Import Settings: ${label} account is not configured. Set it under Import Settings before recording duty payments.`,
      'settings'
    );
  }
  const acc = await tx.chartOfAccount.findFirst({
    where: { id: accountId, companyId, isActive: true },
  });
  if (!acc) {
    throw customsError(
      `${label} account is missing or inactive. Update Import Settings.`,
      'settings'
    );
  }
  return acc;
}

async function listCustomsPaymentAccounts(req, query = {}) {
  const companyId = requireSingleCompany(req);
  const method = String(query.method || query.paymentMethod || '').trim();
  const accounts = await prisma.bankAccount.findMany({
    where: {
      companyId,
      OR: [{ status: 'Active' }, { status: 'active' }, { status: 'ACTIVE' }],
    },
    orderBy: { accountName: 'asc' },
  });
  const mapped = accounts.map((ba) => ({
    id: ba.id,
    accountName: ba.accountName,
    accountNumber: ba.accountNumber,
    bankName: ba.bankName,
    accountType: ba.accountType,
    currency: ba.currency,
    currentBalance: Number(ba.currentBalance) || 0,
    chartOfAccountId: ba.chartOfAccountId,
    isCash: isCashBankAccount(ba),
  }));
  if (!method || method === 'Other') return mapped;
  const normalized = String(method).trim().toLowerCase();
  if (normalized === 'cash') return mapped.filter((a) => a.isCash);
  // Bank / Cheque / Bank Transfer / Pay Order / Online Portal → non-cash bank accounts
  if (
    ['bank', 'bank transfer', 'cheque', 'check', 'pay order', 'online portal'].includes(normalized)
  ) {
    return mapped.filter((a) => !a.isCash);
  }
  return mapped;
}

/**
 * Record a (partial or full) customs duty payment with GL posting in one transaction.
 */
async function recordCustomsDutyPayment(req, id, data = {}) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;

  await assertCanRecordCustomsDutyPayment(req, {
    companyId,
    entityId: id,
  });

  const existing = await prisma.importCustomsClearance.findFirst({
    where: { id, companyId },
    include: { dutyPayments: true, lines: true, importPo: true, shipment: true },
  });
  if (!existing) throw customsError('Customs Clearance record not found', null, 'NOT_FOUND', 404);

  const fromStatus = normalizeCustomsStatus(existing.clearanceStatus);
  if (!['Pending Payment', 'Partially Paid'].includes(fromStatus)) {
    throw customsError(
      'Duty payment can only be recorded when status is Pending Payment or Partially Paid. Send for duty payment first.',
      'clearanceStatus',
      'PAYMENT_REQUEST_REQUIRED'
    );
  }

  const settings =
    (await prisma.importSetting.findUnique({ where: { companyId } }).catch(() => null)) || {};

  await assertCustomsPaymentSod(req, existing, settings);

  const amount = data.dutyPaymentAmount != null ? toNumber(data.dutyPaymentAmount) : null;
  const method = data.dutyPaymentMethod || data.paymentMethod || null;
  const ref = String(data.dutyPaymentRef || data.reference || '').trim();
  const bankAccountId = data.bankAccountId || data.dutyPaymentBankAccountId || null;
  const differenceReason = String(
    data.dutyPaymentDifferenceReason || data.differenceReason || data.reason || ''
  ).trim();
  const assessmentDate = parseDateOnly(existing.assessmentDate);
  const payDateDb = assertCustomsCalendarDate(data.dutyPaymentDate || new Date(), {
    createdAt: existing.createdAt,
    field: 'dutyPaymentDate',
    label: 'Duty payment date',
  });
  const payDate = parseDateOnly(payDateDb);

  if (amount == null || !(amount > 0)) {
    throw customsError('Duty payment amount is required', 'dutyPaymentAmount');
  }
  if (!method) throw customsError('Duty payment method is required', 'dutyPaymentMethod');
  if (!ref) throw customsError('Duty payment reference is required', 'dutyPaymentRef');
  if (!bankAccountId) {
    throw customsError('Bank / cash account is required', 'bankAccountId');
  }
  if (assessmentDate && payDate && payDate.getTime() < assessmentDate.getTime()) {
    throw customsError(
      'Duty payment date must not be before the assessment date',
      'dutyPaymentDate'
    );
  }

  const payable = round2(toNumber(existing.totalCustomsPayableUsd));
  const alreadyPaid = round2(
    (existing.dutyPayments || []).reduce((s, p) => s + toNumber(p.amount), 0) ||
      toNumber(existing.dutyPaidTotalUsd)
  );
  const balanceDue = round2(Math.max(0, payable - alreadyPaid));
  if (amount - balanceDue > 0.009) {
    throw customsError(
      `Payment amount exceeds remaining balance ${balanceDue}`,
      'dutyPaymentAmount'
    );
  }

  const remainingAfter = round2(balanceDue - amount);
  const isPartial = remainingAfter > 0.009;
  if (isPartial && !differenceReason && Math.abs(amount - balanceDue) > 0.009) {
    // partial by definition differs from full remaining — require reason when not paying full balance
    throw customsError(
      'Difference reason is required when the amount differs from the remaining payable balance',
      'dutyPaymentDifferenceReason'
    );
  }
  if (!isPartial && Math.abs(amount - balanceDue) > 0.009 && !differenceReason) {
    throw customsError(
      'Difference reason is required when the amount differs from payable',
      'dutyPaymentDifferenceReason'
    );
  }

  const thresholdPct = toNumber(settings.dutyPaymentDifferenceThresholdPct, 5);
  const diffPct = payable > 0 ? (Math.abs(amount - balanceDue) / payable) * 100 : 0;
  const needsApproval = diffPct > thresholdPct && isPartial;
  if (needsApproval && data.differenceApproved !== true && data.approveDifference !== true) {
    throw customsError(
      `Payment difference (${diffPct.toFixed(2)}%) exceeds the configured threshold (${thresholdPct}%) and needs approval`,
      'dutyPaymentDifferenceReason',
      'DIFFERENCE_APPROVAL_REQUIRED'
    );
  }

  const bankAccount = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, companyId },
  });
  if (!bankAccount) {
    throw customsError('Selected account does not exist', 'bankAccountId');
  }
  if (String(bankAccount.status || '').toLowerCase() !== 'active') {
    throw customsError('Selected account is inactive', 'bankAccountId');
  }
  const cash = isCashBankAccount(bankAccount);
  if (method === 'Cash' && !cash) {
    throw customsError('Selected account is not a cash account', 'bankAccountId');
  }
  if (['Bank Transfer', 'Pay Order', 'Online Portal'].includes(method) && cash) {
    throw customsError('Selected account is not a bank account', 'bankAccountId');
  }
  if (!bankAccount.chartOfAccountId) {
    throw customsError(
      'Selected account is not linked to the chart of accounts',
      'bankAccountId'
    );
  }

  const dup = await prisma.importCustomsDutyPayment.findFirst({
    where: { companyId, bankAccountId, reference: ref },
  });
  if (dup) {
    throw customsError(
      `Payment reference "${ref}" already exists for this bank account`,
      'dutyPaymentRef',
      'DUPLICATE_REFERENCE'
    );
  }

  const blockInsufficient = settings.blockInsufficientBalance !== false;
  const available = Number(bankAccount.currentBalance) || 0;
  if (available + 1e-6 < amount) {
    const msg = `Payment amount exceeds available balance (${available.toLocaleString()}) of ${bankAccount.accountName}`;
    if (blockInsufficient) throw customsError(msg, 'dutyPaymentAmount', 'INSUFFICIENT_BALANCE');
  }

  // Component amounts for proportional allocation on partial payment
  const components = [
    { key: 'customsDuty', amount: toNumber(existing.customsDutyUsd), settingKey: 'customsDutyAccountId', label: 'Customs duty' },
    { key: 'additionalDuty', amount: toNumber(existing.additionalDutyUsd), settingKey: 'additionalDutyAccountId', label: 'Additional duty', fallback: 'customsDutyAccountId' },
    { key: 'regulatoryDuty', amount: toNumber(existing.regulatoryDutyUsd), settingKey: 'regulatoryDutyAccountId', label: 'Regulatory duty', fallback: 'customsDutyAccountId' },
    { key: 'importVat', amount: toNumber(existing.importVatUsd), settingKey: 'importVatAccountId', label: 'Import VAT', fallback: 'customsDutyAccountId' },
    { key: 'advanceIncomeTax', amount: toNumber(existing.advanceIncomeTaxUsd), settingKey: 'advanceIncomeTaxAccountId', label: 'Advance income tax', fallback: 'customsDutyAccountId' },
    {
      key: 'portHandling',
      amount: toNumber(existing.portHandlingChargesUsd) + toNumber(existing.demurrageChargesUsd),
      settingKey: 'handlingAccountId',
      label: 'Port handling',
      fallback: 'customsDutyAccountId',
    },
    {
      key: 'clearing',
      amount: toNumber(existing.clearingBrokerFeeUsd),
      settingKey: 'clearingBrokerAccountId',
      label: 'Clearing agency fee',
      fallback: 'handlingAccountId',
    },
  ].filter((c) => c.amount > 0);

  const componentTotal = components.reduce((s, c) => s + c.amount, 0) || payable || amount;
  const ratio = amount / componentTotal;

  const fiscalYearId = await resolveFiscalYearId(userId, payDate);
  const nextStatus = remainingAfter > 0.009 ? 'Partially Paid' : 'Duty Paid';
  const newPaidTotal = round2(alreadyPaid + amount);

  const result = await prisma.$transaction(async (tx) => {
    const creditCoa = await tx.chartOfAccount.findFirst({
      where: { id: bankAccount.chartOfAccountId, companyId, isActive: true },
    });
    if (!creditCoa) {
      throw customsError(
        'Selected account chart-of-accounts link is invalid or inactive',
        'bankAccountId'
      );
    }
    const coaBal = Number(creditCoa.currentBalance) || 0;
    if (blockInsufficient && coaBal + 1e-6 < amount) {
      throw customsError(
        `Insufficient ledger balance in ${creditCoa.name}. Available: ${coaBal.toLocaleString()}`,
        'dutyPaymentAmount',
        'INSUFFICIENT_BALANCE'
      );
    }

    const debitLines = [];
    for (const c of components) {
      const share = round2(c.amount * ratio);
      if (share <= 0) continue;
      const mappedId = settings[c.settingKey] || (c.fallback ? settings[c.fallback] : null);
      const gl = await resolveMappedGlAccount(tx, companyId, mappedId, c.label);
      debitLines.push({
        accountId: gl.id,
        accountName: gl.name,
        accountCode: gl.code,
        debit: share,
        credit: 0,
        isReconciled: false,
      });
    }
    if (!debitLines.length) {
      const gl = await resolveMappedGlAccount(
        tx,
        companyId,
        settings.customsDutyAccountId,
        'Customs duty'
      );
      debitLines.push({
        accountId: gl.id,
        accountName: gl.name,
        accountCode: gl.code,
        debit: amount,
        credit: 0,
        isReconciled: false,
      });
    }
    // Fix rounding so debits = amount
    const debitSum = round2(debitLines.reduce((s, l) => s + l.debit, 0));
    if (Math.abs(debitSum - amount) > 0.009 && debitLines.length) {
      debitLines[0].debit = round2(debitLines[0].debit + (amount - debitSum));
    }

    const entryNumber = `JE-ICC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const journalEntry = await tx.journalEntry.create({
      data: {
        entryNumber,
        date: payDateDb || new Date(),
        description: `Customs duty payment ${existing.entryNumber} (${ref})`,
        reference: ref,
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        companyId,
        fiscalYearId,
        lines: {
          create: [
            ...debitLines,
            {
              accountId: creditCoa.id,
              accountName: creditCoa.name,
              accountCode: creditCoa.code,
              debit: 0,
              credit: amount,
              isReconciled: false,
            },
          ],
        },
      },
      include: { lines: { include: { account: true } } },
    });

    await BalanceCalculator.applyJournalLines(tx, journalEntry.lines);

    await tx.bankAccount.update({
      where: { id: bankAccount.id },
      data: { currentBalance: { decrement: amount } },
    });

    const payment = await tx.importCustomsDutyPayment.create({
      data: {
        companyId,
        clearanceId: id,
        amount,
        paymentDate: payDateDb || new Date(),
        paymentMethod: method,
        reference: ref,
        bankAccountId: bankAccount.id,
        bankAccountName: bankAccount.accountName,
        chartOfAccountId: creditCoa.id,
        journalEntryId: journalEntry.id,
        journalEntryNumber: journalEntry.entryNumber,
        differenceReason: differenceReason || null,
        differenceApproved: Boolean(data.differenceApproved || data.approveDifference),
        createdBy: userId,
      },
    });

    const updated = await tx.importCustomsClearance.update({
      where: { id },
      data: {
        clearanceStatus: nextStatus,
        dutyPaidTotalUsd: newPaidTotal,
        lastJournalEntryId: journalEntry.id,
        dutyPaymentRef: ref,
        dutyPaymentDate: payDateDb || new Date(),
        dutyPaymentMethod: method,
        dutyPaymentBank: bankAccount.accountName,
        dutyPaymentAmount: amount,
        dutyPaymentDifferenceReason: differenceReason || null,
      },
      include: { lines: true, importPo: true, shipment: true, dutyPayments: true },
    });

    return { updated, payment, journalEntry };
  });

  await upsertCustomsLandedCostComponents(result.updated, userId);

  await logImportAudit({
    companyId,
    action: 'DUTY_PAYMENT',
    entityType: 'IMPORT_CUSTOMS',
    entityId: id,
    details: {
      from: fromStatus,
      to: nextStatus,
      previousStatus: fromStatus,
      nextStatus,
      amount,
      reference: ref,
      bankAccountId: bankAccount.id,
      bankAccountName: bankAccount.accountName,
      journalEntryId: result.journalEntry.id,
      journalEntryNumber: result.journalEntry.entryNumber,
      reason: differenceReason || null,
      totalPaid: newPaidTotal,
      balanceDue: remainingAfter,
    },
    userId,
  });

  try {
    const notifyUserId = existing.createdBy;
    if (notifyUserId && notifyUserId !== userId) {
      await sendToUser({
        mongoUserId: notifyUserId,
        title: nextStatus === 'Duty Paid' ? 'Customs duty fully paid' : 'Customs duty payment recorded',
        message:
          nextStatus === 'Duty Paid'
            ? `${existing.entryNumber} duty is fully paid. You can send it for clearance approval.`
            : `${existing.entryNumber} partial duty payment recorded. Remaining: ${remainingAfter}.`,
        type: 'success',
        category: 'Import',
        data: {
          entityType: 'IMPORT_CUSTOMS',
          entityId: id,
          entryNumber: existing.entryNumber,
          link: `/import/customs?id=${id}`,
        },
      });
    }
  } catch (notifyErr) {
    console.error('[import] Duty payment notification failed:', notifyErr.message);
  }

  const full = await getCustomsClearanceById(req, id);
  return {
    ...full,
    paymentResult: {
      paymentId: result.payment.id,
      journalEntryId: result.journalEntry.id,
      journalEntryNumber: result.journalEntry.entryNumber,
      status: nextStatus,
      totalPaid: newPaidTotal,
      balanceDue: remainingAfter,
      insufficientBalanceWarning:
        !blockInsufficient && available + 1e-6 < amount
          ? `Payment exceeded available balance (${available}) of ${bankAccount.accountName}`
          : null,
    },
  };
}

async function listCustomsClearancesEnriched(req, query = {}) {
  const companyScope = (() => {
    try {
      return requireSingleCompany(req);
    } catch {
      return req.user?.companyId;
    }
  })();
  const { search, status } = query;
  const normalized = status && status !== 'All' ? normalizeCustomsStatus(status) : null;

  const where = {
    companyId: companyScope,
    ...(normalized
      ? {
          OR: [
            { clearanceStatus: normalized },
            ...(normalized === 'Released/Cleared'
              ? [{ clearanceStatus: 'Cleared' }, { clearanceStatus: 'Released' }, { clearanceStatus: 'Out of Charge' }]
              : []),
          ],
        }
      : {}),
    ...(search
      ? {
          OR: [
            { entryNumber: { contains: search, mode: 'insensitive' } },
            { billOfEntryNo: { contains: search, mode: 'insensitive' } },
            { poRef: { contains: search, mode: 'insensitive' } },
            { shipmentRef: { contains: search, mode: 'insensitive' } },
            { customsOffice: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const rows = await prisma.importCustomsClearance.findMany({
    where,
    include: { importPo: true, shipment: true, lines: true },
    orderBy: { declarationDate: 'desc' },
  });
  return Promise.all(rows.map((r) => enrichCustomsClearance(r)));
}

/**
 * Duty Paid → Pending Approval. Notifies users with import.customs.approve.
 */
async function submitCustomsForApproval(req, id) {
  const existing = await prisma.importCustomsClearance.findUnique({
    where: { id },
    include: { lines: true, importPo: true, shipment: true, dutyPayments: true },
  });
  if (!existing) throw customsError('Customs Clearance record not found', null, 'NOT_FOUND', 404);
  await assertRecordCompanyAccess(req, existing.companyId);

  const from = normalizeCustomsStatus(existing.clearanceStatus);
  assertCustomsTransition(from, 'Pending Approval');

  const userId = req.user?.id || req.user?._id;
  const effective =
    req.effectivePermissions || (await getEffectivePermissions(userId, existing.companyId));
  if (
    !hasAnyEffectivePermission(effective, [
      'import.customs.edit',
      'import.customs.assess',
      'import.customs.record_payment',
      'import.customs.release',
      'import.customs.create',
    ])
  ) {
    throw customsError(
      'You do not have permission to submit customs clearance for approval',
      'permission',
      'PERMISSION_DENIED',
      403
    );
  }
  const updated = await prisma.importCustomsClearance.update({
    where: { id },
    data: {
      clearanceStatus: 'Pending Approval',
      approvalRequestedBy: userId,
      approvalRequestedAt: new Date(),
      approvedBy: null,
      approvedAt: null,
    },
    include: { lines: true, importPo: true, shipment: true, dutyPayments: true },
  });

  await logImportAudit({
    companyId: existing.companyId,
    action: 'STATUS_CHANGE',
    entityType: 'IMPORT_CUSTOMS',
    entityId: id,
    details: {
      from,
      to: 'Pending Approval',
      previousStatus: from,
      nextStatus: 'Pending Approval',
      action: 'SUBMIT_FOR_APPROVAL',
      userId,
      at: new Date().toISOString(),
    },
    userId,
  });

  try {
    const { findCompanyUserIdsWithPermission } = require('./importService');
    const approverIds = await findCompanyUserIdsWithPermission(
      existing.companyId,
      CUSTOMS_APPROVE_PERMISSION,
      { excludeUserIds: [userId] }
    );
    if (approverIds.length) {
      await sendToUsers(approverIds, {
        title: 'Customs clearance awaiting approval',
        message: `${existing.entryNumber} port formalities / customs clearance is ready for approval.`,
        type: 'action',
        category: 'Import',
        data: {
          entityType: 'IMPORT_CUSTOMS',
          entityId: id,
          entryNumber: existing.entryNumber,
          link: '/import/approvals',
        },
      });
    }
  } catch (notifyErr) {
    console.error('[import] Customs approval notification failed:', notifyErr.message);
  }

  return enrichCustomsClearance(updated);
}

/**
 * Pending Approval → Approved. Requires import.customs.approve (route-enforced).
 */
async function approveCustomsClearance(req, id) {
  const existing = await prisma.importCustomsClearance.findUnique({
    where: { id },
    include: { lines: true, importPo: true, shipment: true, dutyPayments: true },
  });
  if (!existing) throw customsError('Customs Clearance record not found', null, 'NOT_FOUND', 404);
  await assertRecordCompanyAccess(req, existing.companyId);

  const from = normalizeCustomsStatus(existing.clearanceStatus);
  assertCustomsTransition(from, 'Approved');

  await assertCustomsPermission(req, CUSTOMS_APPROVE_PERMISSION, {
    companyId: existing.companyId,
    entityId: id,
  });

  const userId = req.user.id;
  if (existing.approvalRequestedBy && existing.approvalRequestedBy === userId) {
    throw customsError(
      'Requester and approver must be different users. Ask another user with Customs Approve permission to sign off.',
      'status',
      'SOD_VIOLATION',
      403
    );
  }

  const updated = await prisma.importCustomsClearance.update({
    where: { id },
    data: {
      clearanceStatus: 'Approved',
      approvedBy: userId,
      approvedAt: new Date(),
    },
    include: { lines: true, importPo: true, shipment: true, dutyPayments: true },
  });

  await logImportAudit({
    companyId: existing.companyId,
    action: 'STATUS_CHANGE',
    entityType: 'IMPORT_CUSTOMS',
    entityId: id,
    details: {
      from,
      to: 'Approved',
      previousStatus: from,
      nextStatus: 'Approved',
      action: 'APPROVE',
      userId,
      at: new Date().toISOString(),
    },
    userId,
  });

  try {
    const notifyUserId = existing.approvalRequestedBy || existing.createdBy;
    if (notifyUserId && notifyUserId !== userId) {
      await sendToUser({
        mongoUserId: notifyUserId,
        title: 'Customs clearance approved',
        message: `${existing.entryNumber} was approved. You can now release / clear the shipment.`,
        type: 'success',
        category: 'Import',
        data: {
          entityType: 'IMPORT_CUSTOMS',
          entityId: id,
          entryNumber: existing.entryNumber,
          link: `/import/customs?id=${id}`,
        },
      });
    }
  } catch (notifyErr) {
    console.error('[import] Customs approved notification failed:', notifyErr.message);
  }

  return enrichCustomsClearance(updated);
}

/**
 * Pending Approval → Duty Paid (reject / send back).
 */
async function rejectCustomsApproval(req, id, data = {}) {
  const existing = await prisma.importCustomsClearance.findUnique({
    where: { id },
    include: { lines: true, importPo: true, shipment: true, dutyPayments: true },
  });
  if (!existing) throw customsError('Customs Clearance record not found', null, 'NOT_FOUND', 404);
  await assertRecordCompanyAccess(req, existing.companyId);

  const from = normalizeCustomsStatus(existing.clearanceStatus);
  assertCustomsTransition(from, 'Duty Paid');

  await assertCustomsPermission(req, CUSTOMS_APPROVE_PERMISSION, {
    companyId: existing.companyId,
    entityId: id,
  });

  const userId = req.user.id;
  const reason = String(data.reason || data.rejectReason || '').trim() || null;

  const updated = await prisma.importCustomsClearance.update({
    where: { id },
    data: {
      clearanceStatus: 'Duty Paid',
      approvedBy: null,
      approvedAt: null,
      approvalRequestedBy: null,
      approvalRequestedAt: null,
    },
    include: { lines: true, importPo: true, shipment: true, dutyPayments: true },
  });

  await logImportAudit({
    companyId: existing.companyId,
    action: 'STATUS_CHANGE',
    entityType: 'IMPORT_CUSTOMS',
    entityId: id,
    details: {
      from,
      to: 'Duty Paid',
      previousStatus: from,
      nextStatus: 'Duty Paid',
      action: 'REJECT_APPROVAL',
      reason: reason || undefined,
      userId,
      at: new Date().toISOString(),
    },
    userId,
  });

  try {
    const notifyUserId = existing.approvalRequestedBy || existing.createdBy;
    if (notifyUserId && notifyUserId !== userId) {
      await sendToUser({
        mongoUserId: notifyUserId,
        title: 'Customs clearance approval rejected',
        message: reason
          ? `${existing.entryNumber} was sent back: ${reason}`
          : `${existing.entryNumber} was sent back to Duty Paid. Review and resubmit.`,
        type: 'warning',
        category: 'Import',
        data: {
          entityType: 'IMPORT_CUSTOMS',
          entityId: id,
          entryNumber: existing.entryNumber,
          link: `/import/customs?id=${id}`,
        },
      });
    }
  } catch (notifyErr) {
    console.error('[import] Customs reject notification failed:', notifyErr.message);
  }

  return enrichCustomsClearance(updated);
}

module.exports = {
  CUSTOMS_STATUS_TRANSITIONS,
  CUSTOMS_APPROVE_PERMISSION,
  normalizeCustomsStatus,
  previewCustomsClearance,
  createCustomsClearanceEnterprise,
  updateCustomsStatusEnterprise,
  getCustomsClearanceById,
  listCustomsClearancesEnriched,
  recalculateCustomsWithCurrentRate,
  refreshCustomsTariffData,
  recordCustomsDutyPayment,
  listCustomsPaymentAccounts,
  lookupTariff,
  submitCustomsForApproval,
  approveCustomsClearance,
  rejectCustomsApproval,
};
