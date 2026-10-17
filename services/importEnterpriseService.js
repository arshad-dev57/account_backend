'use strict';

/**
 * Enterprise Import lifecycle extensions:
 * Proforma (full commercial doc, no AP/inventory posting),
 * Supplier commercial bills (3-way match + AP JE, no stock),
 * Customs case creation, LC management, landed-cost reverse,
 * document status, FX preview, authorized PO rate correction.
 */

const prisma = require('../prisma/client');
const BalanceCalculator = require('../utils/balanceCalculator');
const { fiscalYearGuard } = require('../middleware/fiscalYearMiddleware');
const { resolveFiscalYearId } = require('../utils/fiscalYearHelper');
const {
  requireSingleCompany,
  assertRecordCompanyAccess,
} = require('../utils/companyAccess');
const { resolveImportExchangeRate, assertImportRateDate } = require('../utils/importFx');
const { randomUUID } = require('crypto');

function toNumber(val, fallback = 0) {
  if (val == null) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
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

const PROFORMA_STATUS_TRANSITIONS = {
  Draft: ['Submitted', 'Cancelled'],
  Submitted: ['Approved', 'Rejected', 'Cancelled'],
  Approved: ['Expired', 'Cancelled'],
  Rejected: ['Draft', 'Cancelled'],
  Expired: ['Cancelled'],
  Cancelled: [],
  // legacy statuses from earlier UI
  Received: ['Accepted', 'Submitted', 'Approved', 'Cancelled'],
  Accepted: ['Approved', 'Advance Paid', 'LC Issued', 'Cancelled'],
  Issued: ['Submitted', 'Approved', 'Accepted', 'Cancelled'],
  'Advance Paid': ['LC Issued', 'Approved', 'Cancelled'],
  'LC Issued': ['Approved', 'Cancelled'],
};

function assertStatusTransition(map, from, to) {
  if (from === to) return;
  const allowed = map[from];
  if (!allowed) return;
  if (!allowed.includes(to)) {
    const err = new Error(`Invalid status transition: ${from} → ${to}`);
    err.status = 400;
    err.code = 'INVALID_STATUS_TRANSITION';
    throw err;
  }
}

async function previewFx(req, data = {}) {
  const companyId = requireSingleCompany(req);
  return resolveImportExchangeRate({
    companyId,
    currencyCode: data.currency || data.currencyCode || 'USD',
    foreignAmount: toNumber(data.foreignAmount ?? data.amountForeign, 0),
    explicitRate: data.exchangeRate ?? data.exchangeRateToUsd,
    allowExplicitRate: data.allowExplicitRate !== false,
    asOfDate: data.asOfDate || data.exchangeRateDate || new Date(),
  });
}

/** Authorized correction of Import PO FX snapshot — does not rewrite stock movements. */
async function correctPurchaseOrderExchangeRate(req, id, data = {}) {
  const companyId = requireSingleCompany(req);
  const po = await prisma.importPurchaseOrder.findFirst({
    where: { id, companyId },
    include: { items: true },
  });
  if (!po) {
    const err = new Error('Import PO not found');
    err.status = 404;
    throw err;
  }

  const rateDate = assertImportRateDate(data.exchangeRateDate || po.exchangeRateDate || new Date(), {
    orderDate: po.orderDate || po.createdAt,
    field: 'exchangeRateDate',
    label: 'Rate date',
  });

  const fx = await resolveImportExchangeRate({
    companyId,
    currencyCode: data.currency || po.currency,
    foreignAmount: toNumber(po.subtotalForeign, 0),
    explicitRate: data.exchangeRateToUsd ?? data.exchangeRate,
    allowExplicitRate: true,
    asOfDate: rateDate,
  });

  const updated = await prisma.importPurchaseOrder.update({
    where: { id },
    data: {
      exchangeRateToUsd: fx.exchangeRate,
      exchangeRateDate: rateDate,
      totalUsd: fx.baseAmount,
      currency: fx.currencyCode,
    },
    include: { items: true },
  });

  await logImportAudit({
    companyId,
    action: 'FX_CORRECTION',
    entityType: 'IMPORT_PO',
    entityId: id,
    details: {
      previousRate: toNumber(po.exchangeRateToUsd),
      previousBase: toNumber(po.totalUsd),
      nextRate: fx.exchangeRate,
      nextBase: fx.baseAmount,
      rateSource: fx.rateSource,
      note: 'FX snapshot corrected; inventory quantities unchanged',
    },
    userId: req.user.id,
  });

  return updated;
}

// ── Proforma ────────────────────────────────────────────────────────────────

async function getProformaById(req, id) {
  const pi = await prisma.importProformaInvoice.findUnique({
    where: { id },
    include: {
      items: true,
      importPo: { include: { items: true, supplier: true } },
    },
  });
  if (!pi) {
    const err = new Error('Proforma Invoice not found');
    err.status = 404;
    throw err;
  }
  await assertRecordCompanyAccess(req, pi.companyId);
  return pi;
}

function buildProformaLines(rawItems = []) {
  let merchandiseSubtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  const items = rawItems.map((it) => {
    const qty = toNumber(it.quantity, 0);
    const unitPrice = toNumber(it.unitPrice, 0);
    const discountPercent = toNumber(it.discountPercent, 0);
    const gross = qty * unitPrice;
    const discountAmount =
      it.discountAmount != null
        ? toNumber(it.discountAmount, 0)
        : Math.round(((gross * discountPercent) / 100) * 100) / 100;
    const taxAmount = toNumber(it.taxAmount, 0);
    const lineTotal = Math.round((gross - discountAmount + taxAmount) * 100) / 100;
    merchandiseSubtotal += gross;
    discountTotal += discountAmount;
    taxTotal += taxAmount;
    return {
      importPoItemId: it.importPoItemId || null,
      productId: it.productId || null,
      productName: it.productName || 'Import Product',
      sku: it.sku || null,
      supplierItemCode: it.supplierItemCode || null,
      description: it.description || null,
      quantity: qty,
      uom: it.uom || 'PCS',
      unitPrice,
      discountPercent,
      discountAmount,
      taxAmount,
      lineTotal,
      hsCode: it.hsCode || null,
      countryOfOrigin: it.countryOfOrigin || null,
      netWeightKg: toNumber(it.netWeightKg, 0),
      grossWeightKg: toNumber(it.grossWeightKg, 0),
      notes: it.notes || null,
    };
  });
  return { items, merchandiseSubtotal, discountTotal, taxTotal };
}

async function createProformaEnterprise(req, data = {}) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;

  let importPo = null;
  if (data.importPoId) {
    importPo = await prisma.importPurchaseOrder.findFirst({
      where: { id: data.importPoId, companyId },
      include: { items: true, supplier: true },
    });
    if (!importPo) {
      const err = new Error('Linked Import PO not found for active company');
      err.status = 400;
      throw err;
    }
  }

  let supplierName = data.supplierName || importPo?.supplierName || '';
  let supplierId = data.supplierId || importPo?.supplierId || null;
  if (supplierId) {
    const sup = await prisma.supplier.findFirst({ where: { id: supplierId, companyId } });
    if (!sup) {
      const err = new Error('Supplier does not belong to the active company');
      err.status = 400;
      throw err;
    }
    supplierName = sup.name;
  }
  if (!supplierName) {
    const err = new Error('Supplier is required');
    err.status = 400;
    throw err;
  }

  const rawItems =
    Array.isArray(data.items) && data.items.length
      ? data.items
      : (importPo?.items || []).map((it) => ({
          importPoItemId: it.id,
          productId: it.productId,
          productName: it.productName,
          sku: it.sku,
          quantity: toNumber(it.quantity),
          uom: it.uom,
          unitPrice: toNumber(it.unitPrice),
        }));

  const { items, merchandiseSubtotal, discountTotal, taxTotal } = buildProformaLines(rawItems);
  const freight = toNumber(data.freightEstimate, importPo ? toNumber(importPo.estimatedFreightUsd) : 0);
  const insurance = toNumber(data.insuranceEstimate, importPo ? toNumber(importPo.estimatedInsuranceUsd) : 0);
  const otherCharges = toNumber(data.otherChargesEstimate, 0);
  const customsDutyEst = toNumber(data.customsDutyEstimate, importPo ? toNumber(importPo.estimatedDutyUsd) : 0);

  const amountForeign =
    data.amountForeign != null
      ? toNumber(data.amountForeign, 0)
      : Math.round(
          (merchandiseSubtotal - discountTotal + taxTotal + freight + insurance + otherCharges) * 100
        ) / 100;

  const currency = String(data.currency || importPo?.currency || 'USD').toUpperCase();
  const rateDate = assertImportRateDate(data.exchangeRateDate || data.issueDate || new Date(), {
    orderDate: importPo?.orderDate || importPo?.createdAt,
    field: 'exchangeRateDate',
    label: 'Rate date',
  });
  const fx = await resolveImportExchangeRate({
    companyId,
    currencyCode: currency,
    foreignAmount: amountForeign,
    explicitRate: data.exchangeRateToUsd ?? data.exchangeRate,
    allowExplicitRate: true,
    asOfDate: rateDate,
  });

  const advancePercent = toNumber(
    data.advanceRequiredPercent,
    importPo ? toNumber(importPo.advanceRequiredPercent) : 0
  );
  const advanceAmount = Math.round(((fx.baseAmount * advancePercent) / 100) * 100) / 100;

  const count = await prisma.importProformaInvoice.count({ where: { companyId } });
  const year = new Date().getFullYear();
  const piNumber = data.piNumber || `PI-${year}-${String(count + 1).padStart(3, '0')}`;

  const status = data.status || 'Draft';
  // Proforma NEVER posts AP/inventory — status may be Approved but no JE.
  const pi = await prisma.importProformaInvoice.create({
    data: {
      companyId,
      piNumber,
      importPoId: importPo?.id || null,
      poRef: data.poRef || importPo?.poNumber || null,
      supplierId,
      supplierName,
      supplierContact: data.supplierContact || null,
      supplierEmail: data.supplierEmail || null,
      supplierAddress: data.supplierAddress || null,
      supplierTaxId: data.supplierTaxId || null,
      supplierReference: data.supplierReference || importPo?.supplierReference || null,
      quotationId: data.quotationId || importPo?.quotationId || null,
      rfqRef: data.rfqRef || importPo?.rfqRef || null,
      issueDate: data.issueDate ? new Date(data.issueDate) : new Date(),
      validUntil: data.validUntil ? new Date(data.validUntil) : null,
      expectedPaymentDate: data.expectedPaymentDate ? new Date(data.expectedPaymentDate) : null,
      preparedBy: data.preparedBy || userId,
      originCountry: data.originCountry || importPo?.originCountry || null,
      countryOfExport: data.countryOfExport || importPo?.originCountry || null,
      portOfLoading: data.portOfLoading || importPo?.portOfLoading || null,
      portOfDischarge: data.portOfDischarge || null,
      portOfEntry: data.portOfEntry || importPo?.portOfEntry || null,
      destination: data.destination || null,
      incoterm: data.incoterm || importPo?.incoterm || 'CIF',
      namedPlace: data.namedPlace || importPo?.namedPlace || null,
      shipmentMode: data.shipmentMode || importPo?.shippingMethod || null,
      expectedShipmentDate: data.expectedShipmentDate
        ? new Date(data.expectedShipmentDate)
        : null,
      estimatedArrival: data.estimatedArrival
        ? new Date(data.estimatedArrival)
        : importPo?.estimatedArrival || null,
      paymentTerms: data.paymentTerms || importPo?.paymentTerms || null,
      creditDays: toNumber(data.creditDays, 0),
      balancePaymentTerms: data.balancePaymentTerms || null,
      currency: fx.currencyCode,
      exchangeRateToUsd: fx.exchangeRate,
      exchangeRateDate: rateDate,
      rateSource: fx.rateSource,
      baseCurrencyCode: fx.baseCurrencyCode,
      amountForeign,
      amountUsd: fx.baseAmount,
      merchandiseSubtotal,
      discountTotal,
      taxTotal,
      freightEstimate: freight,
      insuranceEstimate: insurance,
      otherChargesEstimate: otherCharges,
      customsDutyEstimate: customsDutyEst,
      advanceRequiredPercent: advancePercent,
      advanceAmountUsd: advanceAmount,
      lcRequired: data.lcRequired != null ? Boolean(data.lcRequired) : Boolean(importPo?.lcRequired),
      lcNumber: data.lcNumber || null,
      bankSwift: data.bankSwift || null,
      paymentSchedule: data.paymentSchedule || undefined,
      termsAndConditions: data.termsAndConditions || null,
      internalRemarks: data.internalRemarks || null,
      status,
      notes:
        data.notes ||
        'Proforma is a preliminary commercial document — it does not post AP, tax liability, or inventory.',
      createdBy: userId,
      items: { create: items },
    },
    include: { items: true, importPo: true },
  });

  if (importPo) {
    await prisma.importPurchaseOrder
      .update({ where: { id: importPo.id }, data: { piRef: piNumber } })
      .catch(() => {});
  }

  await logImportAudit({
    companyId,
    action: 'CREATE',
    entityType: 'IMPORT_PI',
    entityId: pi.id,
    details: {
      piNumber,
      amountForeign,
      amountBase: fx.baseAmount,
      exchangeRate: fx.exchangeRate,
      rateSource: fx.rateSource,
      postsAccounting: false,
      postsInventory: false,
    },
    userId,
  });

  return pi;
}

async function updateProformaEnterprise(req, id, data = {}) {
  const existing = await getProformaById(req, id);
  if (['Approved', 'Cancelled', 'Expired'].includes(existing.status) && !data.forceEdit) {
    const err = new Error(`Cannot edit proforma in status ${existing.status}`);
    err.status = 400;
    throw err;
  }

  const companyId = existing.companyId;
  let amountForeign = toNumber(data.amountForeign, toNumber(existing.amountForeign));
  let merchandiseSubtotal = toNumber(existing.merchandiseSubtotal);
  let discountTotal = toNumber(existing.discountTotal);
  let taxTotal = toNumber(existing.taxTotal);
  let itemsPayload = null;

  if (Array.isArray(data.items)) {
    const built = buildProformaLines(data.items);
    itemsPayload = built.items;
    merchandiseSubtotal = built.merchandiseSubtotal;
    discountTotal = built.discountTotal;
    taxTotal = built.taxTotal;
    const freight = toNumber(data.freightEstimate, toNumber(existing.freightEstimate));
    const insurance = toNumber(data.insuranceEstimate, toNumber(existing.insuranceEstimate));
    const otherCharges = toNumber(data.otherChargesEstimate, toNumber(existing.otherChargesEstimate));
    amountForeign =
      Math.round(
        (merchandiseSubtotal - discountTotal + taxTotal + freight + insurance + otherCharges) * 100
      ) / 100;
  }

  const currency = String(data.currency || existing.currency || 'USD').toUpperCase();
  let poOrderDate = null;
  if (existing.importPoId) {
    const linkedPo = await prisma.importPurchaseOrder.findFirst({
      where: { id: existing.importPoId, companyId },
      select: { orderDate: true, createdAt: true },
    });
    poOrderDate = linkedPo?.orderDate || linkedPo?.createdAt || null;
  }
  const rateDate = assertImportRateDate(
    data.exchangeRateDate || existing.exchangeRateDate || new Date(),
    {
      orderDate: poOrderDate,
      field: 'exchangeRateDate',
      label: 'Rate date',
    }
  );
  const fx = await resolveImportExchangeRate({
    companyId,
    currencyCode: currency,
    foreignAmount: amountForeign,
    explicitRate: data.exchangeRateToUsd ?? data.exchangeRate ?? toNumber(existing.exchangeRateToUsd),
    allowExplicitRate: true,
    asOfDate: rateDate,
  });

  const advancePercent = toNumber(
    data.advanceRequiredPercent,
    toNumber(existing.advanceRequiredPercent)
  );
  const advanceAmount = Math.round(((fx.baseAmount * advancePercent) / 100) * 100) / 100;

  const updated = await prisma.$transaction(async (tx) => {
    if (itemsPayload) {
      await tx.importProformaInvoiceItem.deleteMany({ where: { proformaId: id } });
      await tx.importProformaInvoiceItem.createMany({
        data: itemsPayload.map((it) => ({ ...it, id: randomUUID(), proformaId: id })),
      });
    }
    return tx.importProformaInvoice.update({
      where: { id },
      data: {
        supplierName: data.supplierName ?? existing.supplierName,
        supplierId: data.supplierId !== undefined ? data.supplierId : existing.supplierId,
        supplierContact: data.supplierContact ?? existing.supplierContact,
        supplierEmail: data.supplierEmail ?? existing.supplierEmail,
        supplierAddress: data.supplierAddress ?? existing.supplierAddress,
        supplierTaxId: data.supplierTaxId ?? existing.supplierTaxId,
        supplierReference: data.supplierReference ?? existing.supplierReference,
        issueDate: data.issueDate ? new Date(data.issueDate) : existing.issueDate,
        validUntil: data.validUntil !== undefined
          ? data.validUntil
            ? new Date(data.validUntil)
            : null
          : existing.validUntil,
        expectedPaymentDate: data.expectedPaymentDate
          ? new Date(data.expectedPaymentDate)
          : existing.expectedPaymentDate,
        originCountry: data.originCountry ?? existing.originCountry,
        countryOfExport: data.countryOfExport ?? existing.countryOfExport,
        portOfLoading: data.portOfLoading ?? existing.portOfLoading,
        portOfDischarge: data.portOfDischarge ?? existing.portOfDischarge,
        portOfEntry: data.portOfEntry ?? existing.portOfEntry,
        destination: data.destination ?? existing.destination,
        incoterm: data.incoterm ?? existing.incoterm,
        namedPlace: data.namedPlace ?? existing.namedPlace,
        shipmentMode: data.shipmentMode ?? existing.shipmentMode,
        paymentTerms: data.paymentTerms ?? existing.paymentTerms,
        creditDays: data.creditDays != null ? toNumber(data.creditDays) : existing.creditDays,
        balancePaymentTerms: data.balancePaymentTerms ?? existing.balancePaymentTerms,
        currency: fx.currencyCode,
        exchangeRateToUsd: fx.exchangeRate,
        exchangeRateDate: rateDate,
        rateSource: fx.rateSource,
        baseCurrencyCode: fx.baseCurrencyCode,
        amountForeign,
        amountUsd: fx.baseAmount,
        merchandiseSubtotal,
        discountTotal,
        taxTotal,
        freightEstimate:
          data.freightEstimate != null ? toNumber(data.freightEstimate) : existing.freightEstimate,
        insuranceEstimate:
          data.insuranceEstimate != null
            ? toNumber(data.insuranceEstimate)
            : existing.insuranceEstimate,
        otherChargesEstimate:
          data.otherChargesEstimate != null
            ? toNumber(data.otherChargesEstimate)
            : existing.otherChargesEstimate,
        customsDutyEstimate:
          data.customsDutyEstimate != null
            ? toNumber(data.customsDutyEstimate)
            : existing.customsDutyEstimate,
        advanceRequiredPercent: advancePercent,
        advanceAmountUsd: advanceAmount,
        lcRequired: data.lcRequired != null ? Boolean(data.lcRequired) : existing.lcRequired,
        lcNumber: data.lcNumber !== undefined ? data.lcNumber : existing.lcNumber,
        bankSwift: data.bankSwift !== undefined ? data.bankSwift : existing.bankSwift,
        paymentSchedule: data.paymentSchedule !== undefined ? data.paymentSchedule : undefined,
        termsAndConditions: data.termsAndConditions ?? existing.termsAndConditions,
        internalRemarks: data.internalRemarks ?? existing.internalRemarks,
        notes: data.notes ?? existing.notes,
      },
      include: { items: true, importPo: true },
    });
  });

  await logImportAudit({
    companyId,
    action: 'UPDATE',
    entityType: 'IMPORT_PI',
    entityId: id,
    details: { amountForeign, amountBase: fx.baseAmount },
    userId: req.user.id,
  });

  return updated;
}

async function updateProformaStatusEnterprise(req, id, status, extra = {}) {
  const pi = await getProformaById(req, id);
  assertStatusTransition(PROFORMA_STATUS_TRANSITIONS, pi.status, status);

  const data = { status };
  if (status === 'Approved') {
    data.approvedBy = req.user.id;
    data.approvedAt = new Date();
  }
  if (status === 'Rejected') {
    data.rejectedReason = extra.rejectedReason || extra.reason || null;
  }

  const updated = await prisma.importProformaInvoice.update({
    where: { id },
    data,
    include: { items: true, importPo: true },
  });

  await logImportAudit({
    companyId: pi.companyId,
    action: 'STATUS_CHANGE',
    entityType: 'IMPORT_PI',
    entityId: id,
    details: {
      previousStatus: pi.status,
      nextStatus: status,
      postsAccounting: false,
      postsInventory: false,
    },
    userId: req.user.id,
  });

  return updated;
}

async function recordAdvancePaymentEnterprise(req, id, paymentData = {}) {
  const pi = await getProformaById(req, id);
  if (!['Approved', 'Accepted', 'Issued', 'Submitted', 'Advance Paid'].includes(pi.status)) {
    const err = new Error('Advance payment requires an approved/accepted proforma');
    err.status = 400;
    throw err;
  }

  const amount = toNumber(paymentData.amount, toNumber(pi.advanceAmountUsd, 0));
  if (!(amount > 0)) {
    const err = new Error('Advance payment amount must be greater than zero');
    err.status = 400;
    throw err;
  }
  if (!paymentData.date && !paymentData.paymentDate) {
    const err = new Error('Advance payment date is required');
    err.status = 400;
    throw err;
  }
  if (!paymentData.method && !paymentData.paymentMethod) {
    const err = new Error('Advance payment method is required');
    err.status = 400;
    throw err;
  }

  // Prefer linking a real PurchasePaymentMake id when provided by the payments module.
  // Do not fabricate bank confirmations — only persist the reference the client supplies.
  const paymentMadeId = paymentData.paymentMadeId || paymentData.paymentId || null;
  if (!paymentMadeId && !paymentData.allowStatusOnly) {
    const err = new Error(
      'Provide paymentMadeId from Accounting → Payments Made / Supplier Bills, or set allowStatusOnly=true for a status-only marker (no GL).'
    );
    err.status = 400;
    err.code = 'PAYMENT_REF_REQUIRED';
    throw err;
  }

  const advanceEntry = {
    amount,
    date: paymentData.date || paymentData.paymentDate,
    method: paymentData.method || paymentData.paymentMethod,
    reference: paymentData.reference || paymentData.paymentReference || null,
    bank: paymentData.bank || paymentData.bankName || null,
    paymentMadeId,
    importPoId: pi.importPoId || null,
    poRef: pi.poRef || null,
    piNumber: pi.piNumber,
    recordedAt: new Date().toISOString(),
    recordedBy: req.user.id,
  };
  const previous = Array.isArray(pi.advancePaymentDetails)
    ? pi.advancePaymentDetails
    : pi.advancePaymentDetails
      ? [pi.advancePaymentDetails]
      : [];

  const updated = await prisma.importProformaInvoice.update({
    where: { id },
    data: {
      status: 'Advance Paid',
      paymentMadeId,
      advancePaymentDetails: [...previous, advanceEntry],
    },
    include: { items: true, importPo: true },
  });

  await logImportAudit({
    companyId: pi.companyId,
    action: 'ADVANCE_LINKED',
    entityType: 'IMPORT_PI',
    entityId: id,
    details: {
      paymentMadeId,
      ...advanceEntry,
      note: 'Proforma advance recorded — GL is owned by the payment / bills module when paymentMadeId is set',
    },
    userId: req.user.id,
  });

  return updated;
}

// ── Supplier commercial bills ───────────────────────────────────────────────

async function getSupplierBillById(req, id) {
  const bill = await prisma.importSupplierBill.findUnique({
    where: { id },
    include: {
      items: true,
      importPo: { include: { items: true } },
      purchaseInvoice: true,
    },
  });
  if (!bill) {
    const err = new Error('Supplier bill not found');
    err.status = 404;
    throw err;
  }
  await assertRecordCompanyAccess(req, bill.companyId);
  return bill;
}

async function sumAlreadyInvoicedQty(companyId, importPoId, excludeBillId) {
  const rows = await prisma.importSupplierBillItem.findMany({
    where: {
      bill: {
        companyId,
        importPoId,
        status: { notIn: ['Cancelled', 'Rejected'] },
        ...(excludeBillId ? { id: { not: excludeBillId } } : {}),
      },
    },
    select: { importPoItemId: true, productId: true, invoicedQty: true },
  });
  const byPoItem = {};
  const byProduct = {};
  for (const r of rows) {
    const q = toNumber(r.invoicedQty);
    if (r.importPoItemId) byPoItem[r.importPoItemId] = (byPoItem[r.importPoItemId] || 0) + q;
    if (r.productId) byProduct[r.productId] = (byProduct[r.productId] || 0) + q;
  }
  return { byPoItem, byProduct };
}

async function createSupplierBillEnterprise(req, data = {}) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;

  if (data.idempotencyKey) {
    const existing = await prisma.importSupplierBill.findFirst({
      where: { companyId, idempotencyKey: data.idempotencyKey },
      include: { items: true },
    });
    if (existing) return existing;
  }

  let importPo = null;
  if (data.importPoId) {
    importPo = await prisma.importPurchaseOrder.findFirst({
      where: { id: data.importPoId, companyId },
      include: { items: true },
    });
    if (!importPo) {
      const err = new Error('Import PO not found');
      err.status = 400;
      throw err;
    }
  }

  let grn = null;
  if (data.importGrnId || data.grnId) {
    grn = await prisma.importGrn.findFirst({
      where: { id: data.importGrnId || data.grnId, companyId },
      include: { items: true },
    });
    if (!grn) {
      const err = new Error('Import GRN not found');
      err.status = 400;
      throw err;
    }
    if (!importPo && grn.importPoId) {
      importPo = await prisma.importPurchaseOrder.findFirst({
        where: { id: grn.importPoId, companyId },
        include: { items: true },
      });
    }
  }

  const supplierId = data.supplierId || importPo?.supplierId || null;
  let supplierName = data.supplierName || importPo?.supplierName || '';
  if (supplierId) {
    const sup = await prisma.supplier.findFirst({ where: { id: supplierId, companyId } });
    if (!sup) {
      const err = new Error('Supplier does not belong to the active company');
      err.status = 400;
      throw err;
    }
    supplierName = sup.name;
  }
  if (!supplierName) {
    const err = new Error('Supplier is required');
    err.status = 400;
    throw err;
  }

  if (data.supplierInvoiceNumber && supplierId) {
    const dup = await prisma.importSupplierBill.findFirst({
      where: {
        companyId,
        supplierId,
        supplierInvoiceNumber: data.supplierInvoiceNumber,
        status: { notIn: ['Cancelled', 'Rejected'] },
      },
    });
    if (dup) {
      const err = new Error(
        `Duplicate supplier invoice ${data.supplierInvoiceNumber} already exists as ${dup.billNumber}`
      );
      err.status = 409;
      err.code = 'DUPLICATE_SUPPLIER_INVOICE';
      throw err;
    }
  }

  const already = importPo
    ? await sumAlreadyInvoicedQty(companyId, importPo.id)
    : { byPoItem: {}, byProduct: {} };

  const tolerancePct = toNumber(data.matchTolerancePct, 2);
  let merchandiseForeign = 0;
  let taxTotal = 0;
  let discountTotal = 0;
  const allowOverInvoice = Boolean(data.allowOverInvoiceException);

  const rawItems =
    Array.isArray(data.items) && data.items.length
      ? data.items
      : (grn?.items || importPo?.items || []).map((it) => {
          const isGrn = Boolean(it.acceptedQty != null || it.receivedQty != null);
          const accepted = isGrn
            ? toNumber(it.acceptedQty != null ? it.acceptedQty : it.receivedQty)
            : toNumber(it.quantity);
          const poItemId = it.importPoItemId || (isGrn ? null : it.id);
          const prior = poItemId
            ? already.byPoItem[poItemId] || 0
            : already.byProduct[it.productId] || 0;
          const outstanding = Math.max(0, accepted - prior);
          const unitPrice =
            isGrn && importPo
              ? toNumber(
                  importPo.items.find((p) => p.id === it.importPoItemId || p.productId === it.productId)
                    ?.unitPrice
                )
              : toNumber(it.unitPrice);
          return {
            importPoItemId: poItemId,
            importGrnItemId: isGrn ? it.id : null,
            productId: it.productId,
            productName: it.productName,
            sku: it.sku,
            orderedQty: isGrn ? toNumber(it.orderedQty) : toNumber(it.quantity),
            receivedQty: isGrn ? toNumber(it.receivedQty) : 0,
            acceptedQty: accepted,
            rejectedQty: isGrn ? toNumber(it.rejectedQty) : 0,
            invoicedQty: outstanding,
            uom: it.uom || 'PCS',
            unitPrice,
          };
        });

  const itemsData = [];
  for (const it of rawItems) {
    const invoicedQty = toNumber(it.invoicedQty, 0);
    if (!(invoicedQty > 0)) continue;
    const acceptedQty = toNumber(it.acceptedQty, invoicedQty);
    const prior = it.importPoItemId
      ? already.byPoItem[it.importPoItemId] || 0
      : already.byProduct[it.productId] || 0;
    const maxBillable = Math.max(0, acceptedQty - prior);
    if (!allowOverInvoice && invoicedQty > maxBillable + 1e-9) {
      const err = new Error(
        `Invoice qty ${invoicedQty} exceeds eligible ${maxBillable} for ${it.productName || 'line'} (3-way match)`
      );
      err.status = 400;
      err.code = 'OVER_INVOICE';
      throw err;
    }
    const unitPrice = toNumber(it.unitPrice, 0);
    const discountPercent = toNumber(it.discountPercent, 0);
    const gross = invoicedQty * unitPrice;
    const discountAmount = Math.round(((gross * discountPercent) / 100) * 100) / 100;
    const taxRate = toNumber(it.taxRate, 0);
    const taxAmount =
      it.taxAmount != null
        ? toNumber(it.taxAmount)
        : Math.round((((gross - discountAmount) * taxRate) / 100) * 100) / 100;
    const lineTotal = Math.round((gross - discountAmount + taxAmount) * 100) / 100;
    merchandiseForeign += gross - discountAmount;
    taxTotal += taxAmount;
    discountTotal += discountAmount;
    itemsData.push({
      importPoItemId: it.importPoItemId || null,
      importGrnItemId: it.importGrnItemId || null,
      productId: it.productId || null,
      productName: it.productName || 'Import Product',
      sku: it.sku || null,
      orderedQty: toNumber(it.orderedQty, 0),
      receivedQty: toNumber(it.receivedQty, 0),
      acceptedQty,
      rejectedQty: toNumber(it.rejectedQty, 0),
      invoicedQty,
      uom: it.uom || 'PCS',
      unitPrice,
      discountPercent,
      taxRate,
      taxAmount,
      lineTotal,
      hsCode: it.hsCode || null,
      notes: it.notes || null,
    });
  }

  if (!itemsData.length && toNumber(data.totalAmountForeign, 0) <= 0) {
    const err = new Error('Bill requires line items or a total amount');
    err.status = 400;
    throw err;
  }

  const freight = toNumber(data.freightAmount, 0);
  const insurance = toNumber(data.insuranceAmount, 0);
  const duty = toNumber(data.dutyAmount, 0);
  const otherCharges = toNumber(data.otherCharges, 0);
  const totalAmountForeign =
    data.totalAmountForeign != null
      ? toNumber(data.totalAmountForeign)
      : Math.round((merchandiseForeign + taxTotal + freight + insurance + duty + otherCharges) * 100) /
        100;

  const currency = String(data.currency || importPo?.currency || 'USD').toUpperCase();
  const fx = await resolveImportExchangeRate({
    companyId,
    currencyCode: currency,
    foreignAmount: totalAmountForeign,
    explicitRate: data.exchangeRateToUsd ?? data.exchangeRate,
    allowExplicitRate: true,
    asOfDate: data.exchangeRateDate || data.billDate || new Date(),
  });

  // PO match variance (foreign merchandise vs PO subtotal proportional)
  const poForeign = importPo ? toNumber(importPo.subtotalForeign) : 0;
  const varianceAmount = poForeign > 0 ? Math.round((totalAmountForeign - poForeign) * 100) / 100 : 0;
  const variancePercent =
    poForeign > 0 ? Math.round((varianceAmount / poForeign) * 1000) / 10 : 0;
  let matchStatus = 'MATCHED';
  if (Math.abs(variancePercent) > tolerancePct) {
    matchStatus = allowOverInvoice || data.acceptVariance ? 'VARIANCE_ACCEPTED' : 'VARIANCE';
    if (matchStatus === 'VARIANCE' && !data.allowVariance) {
      const err = new Error(
        `Bill variance ${variancePercent}% exceeds tolerance ${tolerancePct}%. Pass allowVariance=true with authorization to proceed.`
      );
      err.status = 400;
      err.code = 'MATCH_VARIANCE';
      throw err;
    }
  }

  const count = await prisma.importSupplierBill.count({ where: { companyId } });
  const year = new Date().getFullYear();
  const billNumber = data.billNumber || `IBILL-${year}-${String(count + 1).padStart(3, '0')}`;

  const bill = await prisma.importSupplierBill.create({
    data: {
      companyId,
      billNumber,
      importPoId: importPo?.id || null,
      poRef: data.poRef || importPo?.poNumber || null,
      supplierId,
      supplierName,
      supplierInvoiceNumber: data.supplierInvoiceNumber || null,
      billDate: data.billDate ? new Date(data.billDate) : new Date(),
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      currency: fx.currencyCode,
      exchangeRateToUsd: fx.exchangeRate,
      exchangeRateDate: fx.exchangeRateDate,
      rateSource: fx.rateSource,
      baseCurrencyCode: fx.baseCurrencyCode,
      totalAmountForeign,
      totalAmountUsd: fx.baseAmount,
      paidAmountUsd: 0,
      balanceUsd: fx.baseAmount,
      freightAmount: freight,
      insuranceAmount: insurance,
      dutyAmount: duty,
      otherCharges,
      taxTotal,
      discountTotal,
      varianceAmount,
      variancePercent,
      matchStatus,
      matchTolerancePct: tolerancePct,
      paymentTerms: data.paymentTerms || importPo?.paymentTerms || 'Net 30 Days',
      status: data.status || 'Draft',
      importGrnId: grn?.id || null,
      shipmentId: data.shipmentId || grn?.shipmentId || null,
      proformaId: data.proformaId || null,
      linkedPurchaseBillUrl: '/purchases/invoices',
      idempotencyKey: data.idempotencyKey || null,
      notes: data.notes || null,
      createdBy: userId,
      items: { create: itemsData },
    },
    include: { items: true, importPo: true },
  });

  await logImportAudit({
    companyId,
    action: 'CREATE',
    entityType: 'IMPORT_BILL',
    entityId: bill.id,
    details: {
      billNumber,
      totalAmountForeign,
      totalBase: fx.baseAmount,
      matchStatus,
      postsAccounting: false,
    },
    userId,
  });

  return bill;
}

async function postSupplierBillEnterprise(req, id) {
  const bill = await getSupplierBillById(req, id);
  if (bill.status === 'Posted' && bill.journalEntryId) {
    return {
      success: true,
      message: 'Bill already posted',
      journalEntryId: bill.journalEntryId,
      bill,
    };
  }
  if (['Cancelled', 'Rejected'].includes(bill.status)) {
    const err = new Error(`Cannot post bill in status ${bill.status}`);
    err.status = 400;
    throw err;
  }

  const companyId = bill.companyId;
  const userId = req.user.id;
  const postingDate = bill.billDate ? new Date(bill.billDate) : new Date();
  await fiscalYearGuard(userId, postingDate);
  const fiscalYearId = await resolveFiscalYearId(userId, postingDate);
  const baseAmount = toNumber(bill.totalAmountUsd);
  if (baseAmount <= 0) {
    const err = new Error('Bill base amount must be greater than zero');
    err.status = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    // Re-check idempotency inside transaction
    const locked = await tx.importSupplierBill.findUnique({ where: { id } });
    if (locked.status === 'Posted' && locked.journalEntryId) {
      return {
        success: true,
        message: 'Bill already posted',
        journalEntryId: locked.journalEntryId,
        bill: locked,
      };
    }

    let apAccount = await tx.chartOfAccount.findFirst({
      where: {
        companyId,
        type: 'Liability',
        OR: [
          { name: { contains: 'Payable', mode: 'insensitive' } },
          { name: { contains: 'Creditor', mode: 'insensitive' } },
        ],
      },
    });
    if (!apAccount) {
      apAccount = await tx.chartOfAccount.findFirst({ where: { companyId, type: 'Liability' } });
    }

    let clearingAccount = await tx.chartOfAccount.findFirst({
      where: {
        companyId,
        OR: [
          { name: { contains: 'GRNI', mode: 'insensitive' } },
          { name: { contains: 'Goods Received', mode: 'insensitive' } },
          { name: { contains: 'Clearing', mode: 'insensitive' } },
          { name: { contains: 'Inventory', mode: 'insensitive' } },
        ],
      },
    });
    if (!clearingAccount) {
      clearingAccount = await tx.chartOfAccount.findFirst({
        where: { companyId, type: 'Asset' },
      });
    }

    if (!apAccount || !clearingAccount) {
      throw new Error('Company must have AP (Liability) and Inventory/Clearing (Asset) accounts');
    }

    const entryNumber = `JE-IBILL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const journalEntry = await tx.journalEntry.create({
      data: {
        entryNumber,
        date: postingDate,
        description: `Import supplier bill ${bill.billNumber} (${bill.supplierName})`,
        reference: bill.supplierInvoiceNumber || bill.billNumber,
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
              accountId: clearingAccount.id,
              accountName: clearingAccount.name,
              accountCode: clearingAccount.code,
              debit: baseAmount,
              credit: 0,
            },
            {
              accountId: apAccount.id,
              accountName: apAccount.name,
              accountCode: apAccount.code,
              debit: 0,
              credit: baseAmount,
            },
          ],
        },
      },
      include: { lines: true },
    });

    await BalanceCalculator.applyJournalLines(tx, journalEntry.lines);

    // AP subledger (accounts_payable) requires a PurchaseInvoice FK — do not invent one.
    // JE credits the AP COA account; optional link to a real Purchase Invoice via purchaseInvoiceId.
    // No stock movement — Import GRN already posted quantities.

    const updated = await tx.importSupplierBill.update({
      where: { id },
      data: {
        status: 'Posted',
        journalEntryId: journalEntry.id,
        postedAt: new Date(),
        linkedPurchaseBillUrl: '/purchases/invoices',
      },
      include: { items: true, importPo: true },
    });

    await logImportAudit({
      companyId,
      action: 'POST_ACCOUNTING',
      entityType: 'IMPORT_BILL',
      entityId: id,
      details: {
        journalEntryId: journalEntry.id,
        entryNumber,
        baseAmount,
        stockMovement: false,
        apAccountId: apAccount.id,
        clearingAccountId: clearingAccount.id,
        note: 'GL posted; AP subledger row created only when linked to PurchaseInvoice',
      },
      userId,
    });

    return {
      success: true,
      message: 'Supplier bill posted to GL (Inventory/Clearing Dr, AP Cr) without inventory re-receipt',
      journalEntry,
      bill: updated,
    };
  });
}

async function recordBillPaymentEnterprise(req, id, data = {}) {
  const bill = await getSupplierBillById(req, id);
  if (!['Posted', 'Partially Paid', 'Approved'].includes(bill.status) && bill.status !== 'Paid') {
    // Allow payment recording after post; Approved drafts need post first for GL
    if (['Draft', 'Pending Approval', 'Submitted'].includes(bill.status)) {
      const err = new Error('Post the bill before recording payments');
      err.status = 400;
      throw err;
    }
  }

  const paymentAmount = toNumber(data.paymentAmountUsd ?? data.amountUsd ?? data.amount, 0);
  if (!(paymentAmount > 0)) {
    const err = new Error('Payment amount must be greater than zero');
    err.status = 400;
    throw err;
  }

  const newPaid = toNumber(bill.paidAmountUsd) + paymentAmount;
  if (newPaid > toNumber(bill.totalAmountUsd) + 0.01) {
    const err = new Error('Payment exceeds bill balance');
    err.status = 400;
    throw err;
  }
  const newBalance = Math.max(0, toNumber(bill.totalAmountUsd) - newPaid);
  const status = newBalance === 0 ? 'Paid' : 'Partially Paid';

  const updated = await prisma.importSupplierBill.update({
    where: { id },
    data: {
      paidAmountUsd: newPaid,
      balanceUsd: newBalance,
      status,
    },
    include: { items: true },
  });

  await logImportAudit({
    companyId: bill.companyId,
    action: 'PAYMENT_RECORDED',
    entityType: 'IMPORT_BILL',
    entityId: id,
    details: {
      paymentAmount,
      newPaid,
      newBalance,
      status,
      paymentMadeId: data.paymentMadeId || null,
      note: 'Import bill payment counter updated; bank GL should come from Purchase Payments module when paymentMadeId is linked',
    },
    userId: req.user.id,
  });

  return updated;
}

// ── Customs ─────────────────────────────────────────────────────────────────

const importCustoms = require('./importCustomsService');

async function createCustomsClearanceEnterprise(req, data = {}) {
  return importCustoms.createCustomsClearanceEnterprise(req, data);
}

async function updateCustomsStatusEnterprise(req, id, status, paymentRef, extra = {}) {
  return importCustoms.updateCustomsStatusEnterprise(req, id, status, paymentRef, extra);
}

// ── Landed cost helpers ─────────────────────────────────────────────────────

async function createLandedCostEnterprise(req, data = {}) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;

  if (data.idempotencyKey) {
    const existing = await prisma.importLandedCost.findFirst({
      where: { companyId, idempotencyKey: data.idempotencyKey },
      include: { items: true },
    });
    if (existing) return existing;
  }

  let grn = null;
  if (data.grnId) {
    grn = await prisma.importGrn.findFirst({
      where: { id: data.grnId, companyId },
      include: { items: true, importPo: { include: { items: true } } },
    });
    if (!grn) {
      const err = new Error('Import GRN not found');
      err.status = 400;
      throw err;
    }
  }

  const importPo =
    grn?.importPo ||
    (data.importPoId
      ? await prisma.importPurchaseOrder.findFirst({
          where: { id: data.importPoId, companyId },
          include: { items: true },
        })
      : null);

  const purchaseFob =
    data.purchaseFobTotalUsd != null
      ? toNumber(data.purchaseFobTotalUsd)
      : importPo
        ? toNumber(importPo.totalUsd)
        : 0;

  const freight = toNumber(data.oceanFreightUsd, 0);
  const duty = toNumber(data.customsDutyUsd, 0);
  const insurance = toNumber(data.marineInsuranceUsd, 0);
  const demurrage = toNumber(data.portDemurrageAndHandlingUsd, 0);
  const clearing = toNumber(data.clearingAgencyChargesUsd, 0);
  const inland = toNumber(data.inlandTransportationUsd, 0);
  const totalLandedExpenses =
    Math.round((freight + duty + insurance + demurrage + clearing + inland) * 100) / 100;
  const totalFinalLandedCost = Math.round((purchaseFob + totalLandedExpenses) * 100) / 100;

  const allocationMethod = data.allocationMethod || 'By Item Value';

  let rawItems = data.items || [];
  if (!rawItems.length && grn?.items?.length) {
    rawItems = grn.items.map((gi) => {
      const poLine = importPo?.items?.find(
        (p) => p.id === gi.importPoItemId || p.productId === gi.productId
      );
      return {
        productId: gi.productId,
        productName: gi.productName,
        qty: toNumber(gi.acceptedQty != null ? gi.acceptedQty : gi.receivedQty),
        unitFobUsd: toNumber(poLine?.unitPrice),
      };
    });
  }
  if (!rawItems.length && importPo?.items?.length) {
    rawItems = importPo.items.map((it) => ({
      productId: it.productId,
      productName: it.productName,
      qty: toNumber(it.receivedQty) || toNumber(it.quantity),
      unitFobUsd: toNumber(it.unitPrice),
    }));
  }

  let basisTotal = 0;
  if (allocationMethod === 'By Quantity' || allocationMethod === 'quantity') {
    basisTotal = rawItems.reduce((acc, it) => acc + toNumber(it.qty, 1), 0) || 1;
  } else if (allocationMethod === 'By Weight' || allocationMethod === 'weight') {
    basisTotal = rawItems.reduce((acc, it) => acc + toNumber(it.weight || it.netWeightKg, 1), 0) || 1;
  } else if (allocationMethod === 'Equal Split' || allocationMethod === 'equal') {
    basisTotal = rawItems.length || 1;
  } else if (allocationMethod === 'Manual' || allocationMethod === 'manual') {
    basisTotal = rawItems.reduce((acc, it) => acc + toNumber(it.allocationShare, 0), 0) || 1;
  } else {
    basisTotal =
      rawItems.reduce((acc, it) => acc + toNumber(it.qty, 1) * toNumber(it.unitFobUsd, 0), 0) ||
      purchaseFob ||
      1;
  }

  const itemsData = rawItems.map((it) => {
    const qty = toNumber(it.qty, 1);
    const unitFob = toNumber(it.unitFobUsd, 0);
    let ratio = 0;
    if (allocationMethod === 'By Quantity' || allocationMethod === 'quantity') {
      ratio = qty / basisTotal;
    } else if (allocationMethod === 'By Weight' || allocationMethod === 'weight') {
      ratio = toNumber(it.weight || it.netWeightKg, 1) / basisTotal;
    } else if (allocationMethod === 'Equal Split' || allocationMethod === 'equal') {
      ratio = 1 / basisTotal;
    } else if (allocationMethod === 'Manual' || allocationMethod === 'manual') {
      ratio = toNumber(it.allocationShare, 0) / basisTotal;
    } else {
      ratio = (qty * unitFob) / basisTotal;
    }
    const allocatedExpenseTotal = totalLandedExpenses * ratio;
    const allocatedExpensePerUnit = qty > 0 ? allocatedExpenseTotal / qty : 0;
    const finalLandedCostPerUnit = unitFob + allocatedExpensePerUnit;
    const variancePct = unitFob > 0 ? (allocatedExpensePerUnit / unitFob) * 100 : 0;
    return {
      productId: it.productId || null,
      productName: it.productName || 'Import Product',
      qty,
      unitFobUsd: unitFob,
      allocatedExpensePerUnitUsd: Math.round(allocatedExpensePerUnit * 10000) / 10000,
      finalLandedCostPerUnitUsd: Math.round(finalLandedCostPerUnit * 10000) / 10000,
      originalCostVariancePct: Math.round(variancePct * 10) / 10,
    };
  });

  const count = await prisma.importLandedCost.count({ where: { companyId } });
  const year = new Date().getFullYear();
  const allocationNumber =
    data.allocationNumber || `LCA-${year}-${String(count + 1).padStart(3, '0')}`;

  const record = await prisma.importLandedCost.create({
    data: {
      companyId,
      allocationNumber,
      importPoId: importPo?.id || data.importPoId || null,
      poRef: data.poRef || importPo?.poNumber || null,
      shipmentId: data.shipmentId || grn?.shipmentId || null,
      shipmentRef: data.shipmentRef || grn?.shipmentRef || null,
      grnId: grn?.id || null,
      grnRef: data.grnRef || grn?.grnNumber || null,
      customsClearanceId: data.customsClearanceId || null,
      date: data.date ? new Date(data.date) : new Date(),
      purchaseFobTotalUsd: purchaseFob,
      oceanFreightUsd: freight,
      customsDutyUsd: duty,
      marineInsuranceUsd: insurance,
      portDemurrageAndHandlingUsd: demurrage,
      clearingAgencyChargesUsd: clearing,
      inlandTransportationUsd: inland,
      totalLandedExpensesUsd: totalLandedExpenses,
      totalFinalLandedCostUsd: totalFinalLandedCost,
      allocationMethod,
      status: data.status || 'Draft',
      idempotencyKey: data.idempotencyKey || null,
      notes: data.notes || null,
      createdBy: userId,
      items: { create: itemsData },
    },
    include: { items: true, importPo: true, grn: true },
  });

  await logImportAudit({
    companyId,
    action: 'CREATE',
    entityType: 'LANDED_COST',
    entityId: record.id,
    details: { allocationNumber, totalLandedExpenses, totalFinalLandedCost },
    userId,
  });

  return record;
}

async function reverseLandedCost(req, id) {
  const lc = await prisma.importLandedCost.findUnique({
    where: { id },
    include: { items: true, journalEntry: { include: { lines: true } } },
  });
  if (!lc) {
    const err = new Error('Landed Cost not found');
    err.status = 404;
    throw err;
  }
  await assertRecordCompanyAccess(req, lc.companyId);
  if (lc.status !== 'Posted' || !lc.journalEntryId) {
    const err = new Error('Only posted landed costs can be reversed');
    err.status = 400;
    throw err;
  }
  if (lc.reversedAt) {
    return { success: true, message: 'Already reversed', landedCost: lc };
  }

  const companyId = lc.companyId;
  const userId = req.user.id;
  const postingDate = new Date();
  await fiscalYearGuard(userId, postingDate);
  const fiscalYearId = await resolveFiscalYearId(userId, postingDate);
  const amount = toNumber(lc.totalLandedExpensesUsd);

  return prisma.$transaction(async (tx) => {
    const original = await tx.journalEntry.findUnique({
      where: { id: lc.journalEntryId },
      include: { lines: true },
    });
    if (!original) throw new Error('Original journal entry missing');

    const entryNumber = `JE-LCA-REV-${Date.now()}`;
    const revLines = original.lines.map((l) => ({
      accountId: l.accountId,
      accountName: l.accountName,
      accountCode: l.accountCode,
      debit: toNumber(l.credit),
      credit: toNumber(l.debit),
    }));

    const journalEntry = await tx.journalEntry.create({
      data: {
        entryNumber,
        date: postingDate,
        description: `Reversal of Landed Cost ${lc.allocationNumber}`,
        reference: lc.allocationNumber,
        status: 'Posted',
        type: 'Reversal',
        companyId,
        fiscalYearId,
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        lines: { create: revLines },
      },
      include: { lines: true },
    });

    await BalanceCalculator.applyJournalLines(tx, journalEntry.lines);

    const updated = await tx.importLandedCost.update({
      where: { id },
      data: {
        status: 'Reversed',
        reversedAt: new Date(),
        reversalJournalEntryId: journalEntry.id,
      },
      include: { items: true },
    });

    await logImportAudit({
      companyId,
      action: 'REVERSE',
      entityType: 'LANDED_COST',
      entityId: id,
      details: { reversalJournalEntryId: journalEntry.id, amount },
      userId,
    });

    return { success: true, journalEntry, landedCost: updated };
  });
}

// ── Finance LC ──────────────────────────────────────────────────────────────

const LC_COVERING_STATUSES = [
  'Draft',
  'Issued',
  'Amended',
  'Documents Presented',
  'Accepted',
  'Paid/Settled',
  // legacy
  'Application Submitted',
  'Settled',
];

const LC_ELIGIBLE_PO_STATUSES = [
  'Ordered',
  'Approved',
  'Confirmed',
  'In Transit',
  'Shipped',
  'Partially Received',
];

const LC_STATUS_TRANSITIONS = {
  Draft: ['Issued', 'Cancelled'],
  Issued: ['Amended', 'Documents Presented', 'Expired', 'Cancelled'],
  Amended: ['Amended', 'Documents Presented', 'Expired', 'Cancelled'],
  'Documents Presented': ['Accepted', 'Amended', 'Cancelled'],
  Accepted: ['Paid/Settled', 'Cancelled'],
  'Paid/Settled': [],
  Expired: ['Cancelled'],
  Cancelled: [],
  // legacy aliases
  'Application Submitted': ['Issued', 'Cancelled'],
  Settled: [],
};

function normalizeLcStatus(status) {
  if (!status) return 'Draft';
  if (status === 'Application Submitted' || status === 'Pending') return 'Draft';
  if (status === 'Settled' || status === 'Paid' || status === 'Closed') return 'Paid/Settled';
  if (status === 'Docs Presented' || status === 'Presented') return 'Documents Presented';
  return status;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function validationError(message, field) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'LC_VALIDATION';
  err.field = field || null;
  return err;
}

async function sumCoveringLcAmount(companyId, { importPoId, proformaId, excludeLcId }) {
  const where = {
    companyId,
    status: { in: LC_COVERING_STATUSES },
    ...(excludeLcId ? { id: { not: excludeLcId } } : {}),
  };
  if (proformaId) where.proformaId = proformaId;
  else if (importPoId) where.importPoId = importPoId;
  else return 0;

  const rows = await prisma.importFinanceLc.findMany({
    where,
    select: { lcAmount: true },
  });
  return rows.reduce((s, r) => s + toNumber(r.lcAmount), 0);
}

function enrichFinanceLc(lc, extras = {}) {
  if (!lc) return lc;
  const status = normalizeLcStatus(lc.status);
  const lcAmount = toNumber(lc.lcAmount);
  const amountDrawn = toNumber(lc.amountDrawn);
  const marginPercent = toNumber(lc.marginPercent);
  const marginDeposit = Math.round(((lcAmount * marginPercent) / 100) * 10000) / 10000;
  const balance = Math.round((lcAmount - amountDrawn) * 10000) / 10000;
  let daysToExpiry = null;
  if (lc.expiryDate) {
    const ms = startOfDay(lc.expiryDate).getTime() - startOfDay(new Date()).getTime();
    daysToExpiry = Math.ceil(ms / (24 * 60 * 60 * 1000));
  }
  return {
    ...lc,
    status,
    amountDrawn,
    balance,
    remainingBalance: balance,
    marginDeposit,
    marginDepositForeign: marginDeposit,
    cashMarginBlockedUsd: toNumber(lc.cashMarginBlockedUsd) || marginDeposit * toNumber(lc.exchangeRateToUsd, 1),
    daysToExpiry,
    expiringSoon: daysToExpiry != null && daysToExpiry >= 0 && daysToExpiry <= 15,
    amendments: Array.isArray(lc.amendments) ? lc.amendments : lc.amendments ? [lc.amendments] : [],
    ...extras,
  };
}

function validateLcDatesAndTerms(data, { requireExpiry = true } = {}) {
  const paymentTenor = data.paymentTenor || 'At Sight';
  let usanceDays = toNumber(data.usanceDays, 0);
  if (paymentTenor === 'At Sight') {
    usanceDays = 0;
  } else if (paymentTenor === 'Usance' || paymentTenor === 'Deferred') {
    if (!(usanceDays > 0)) {
      throw validationError('Usance days are required and must be greater than zero for Usance/Deferred tenor', 'usanceDays');
    }
  }

  const marginPercent = toNumber(data.marginPercent, 0);
  if (marginPercent < 0 || marginPercent > 100) {
    throw validationError('Margin % must be between 0 and 100', 'marginPercent');
  }

  if (!data.issuingBank || !String(data.issuingBank).trim()) {
    throw validationError('Issuing bank is required', 'issuingBank');
  }
  if (!data.beneficiary || !String(data.beneficiary).trim()) {
    throw validationError('Beneficiary is required', 'beneficiary');
  }

  const issuanceDate = data.issuanceDate ? startOfDay(data.issuanceDate) : startOfDay(new Date());
  const today = startOfDay(new Date());
  if (issuanceDate.getTime() > today.getTime()) {
    throw validationError('Issuance date must not be in the future', 'issuanceDate');
  }

  if (!data.expiryDate && requireExpiry) {
    throw validationError('Expiry date is required', 'expiryDate');
  }
  let expiryDate = null;
  if (data.expiryDate) {
    expiryDate = startOfDay(data.expiryDate);
    if (expiryDate.getTime() <= issuanceDate.getTime()) {
      throw validationError('Expiry date must be after the issuance date', 'expiryDate');
    }
  }

  let latestShipmentDate = null;
  if (data.latestShipmentDate) {
    latestShipmentDate = startOfDay(data.latestShipmentDate);
    if (latestShipmentDate.getTime() <= issuanceDate.getTime()) {
      throw validationError('Latest shipment date must be after the issuance date', 'latestShipmentDate');
    }
    if (expiryDate && latestShipmentDate.getTime() > expiryDate.getTime()) {
      throw validationError('Latest shipment date must be on or before the expiry date', 'latestShipmentDate');
    }
  }

  const presentationPeriodDays = data.presentationPeriodDays != null
    ? toNumber(data.presentationPeriodDays, 21)
    : 21;
  if (presentationPeriodDays < 0) {
    throw validationError('Presentation period (days) cannot be negative', 'presentationPeriodDays');
  }

  const amountTolerancePercent = toNumber(data.amountTolerancePercent, 0);
  if (amountTolerancePercent < 0 || amountTolerancePercent > 100) {
    throw validationError('Amount tolerance must be between 0 and 100', 'amountTolerancePercent');
  }

  return {
    paymentTenor,
    usanceDays,
    marginPercent,
    issuanceDate,
    expiryDate,
    latestShipmentDate,
    presentationPeriodDays,
    amountTolerancePercent,
  };
}

async function listEligibleFinancePos(req, query = {}) {
  const companyId = requireSingleCompany(req);
  const supplierId = query.supplierId || null;
  const beneficiary = query.beneficiary ? String(query.beneficiary).trim() : null;

  const pos = await prisma.importPurchaseOrder.findMany({
    where: {
      companyId,
      status: { in: LC_ELIGIBLE_PO_STATUSES },
      ...(supplierId ? { supplierId } : {}),
      ...(beneficiary && !supplierId
        ? { supplierName: { equals: beneficiary, mode: 'insensitive' } }
        : {}),
    },
    include: {
      financeLcs: {
        where: { status: { in: LC_COVERING_STATUSES } },
        select: { id: true, lcAmount: true, status: true, currency: true },
      },
      proformaInvoices: {
        where: { status: { notIn: ['Cancelled', 'Rejected', 'Expired'] } },
        select: {
          id: true,
          piNumber: true,
          amountForeign: true,
          currency: true,
          status: true,
          portOfLoading: true,
          portOfDischarge: true,
          portOfEntry: true,
          incoterm: true,
          advanceRequiredPercent: true,
          lcRequired: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { orderDate: 'desc' },
    take: Math.min(Number(query.limit) || 100, 200),
  });

  return pos
    .map((po) => {
      const covered = (po.financeLcs || []).reduce((s, l) => s + toNumber(l.lcAmount), 0);
      const poValue = toNumber(po.subtotalForeign);
      const outstanding = Math.max(0, Math.round((poValue - covered) * 10000) / 10000);
      return {
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        supplierId: po.supplierId,
        supplierName: po.supplierName,
        supplierCountry: po.supplierCountry,
        currency: po.currency,
        incoterm: po.incoterm,
        portOfLoading: po.portOfLoading,
        portOfEntry: po.portOfEntry,
        subtotalForeign: poValue,
        totalUsd: toNumber(po.totalUsd),
        coveredByLc: covered,
        outstandingForLc: outstanding,
        fullyCovered: outstanding <= 0.0001,
        proformas: po.proformaInvoices || [],
      };
    })
    .filter((p) => !p.fullyCovered);
}

async function createFinanceLcEnterprise(req, data = {}) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true },
  });

  let importPo = null;
  if (data.importPoId) {
    importPo = await prisma.importPurchaseOrder.findFirst({
      where: { id: data.importPoId, companyId },
    });
    if (!importPo) throw validationError('Import PO not found', 'importPoId');
    if (!LC_ELIGIBLE_PO_STATUSES.includes(importPo.status)) {
      throw validationError(
        `Import PO must be Ordered/approved (current status: ${importPo.status})`,
        'importPoId'
      );
    }
  }

  let proforma = null;
  if (data.proformaId) {
    proforma = await prisma.importProformaInvoice.findFirst({
      where: { id: data.proformaId, companyId },
    });
    if (!proforma) throw validationError('Proforma invoice not found', 'proformaId');
    if (importPo && proforma.importPoId && proforma.importPoId !== importPo.id) {
      throw validationError('Proforma invoice is not linked to the selected Import PO', 'proformaId');
    }
    if (!importPo && proforma.importPoId) {
      importPo = await prisma.importPurchaseOrder.findFirst({
        where: { id: proforma.importPoId, companyId },
      });
    }
  }

  const beneficiary = String(data.beneficiary || importPo?.supplierName || proforma?.supplierName || '').trim();
  if (!beneficiary) throw validationError('Beneficiary is required', 'beneficiary');

  if (importPo) {
    const poBeneficiary = String(importPo.supplierName || '').trim().toLowerCase();
    if (poBeneficiary && poBeneficiary !== beneficiary.toLowerCase()) {
      throw validationError(
        'Linked PO belongs to a different supplier/beneficiary',
        'importPoId'
      );
    }
    if (data.supplierId && importPo.supplierId && data.supplierId !== importPo.supplierId) {
      throw validationError('Linked PO does not match the selected supplier', 'importPoId');
    }
  }

  const terms = validateLcDatesAndTerms({
    ...data,
    beneficiary,
  });

  const referenceValue = proforma
    ? toNumber(proforma.amountForeign)
    : importPo
      ? toNumber(importPo.subtotalForeign)
      : 0;
  const alreadyCovered = await sumCoveringLcAmount(companyId, {
    importPoId: importPo?.id,
    proformaId: proforma?.id,
  });
  const outstanding = Math.max(0, referenceValue - alreadyCovered);
  const maxAllowed = outstanding * (1 + terms.amountTolerancePercent / 100);

  const lcAmount = toNumber(
    data.lcAmount,
    outstanding > 0 ? outstanding : referenceValue
  );
  if (!(lcAmount > 0)) {
    throw validationError('LC amount must be greater than zero', 'lcAmount');
  }
  if ((importPo || proforma) && lcAmount > maxAllowed + 0.0001) {
    throw validationError(
      `LC amount (${lcAmount}) exceeds outstanding ${proforma ? 'PI' : 'PO'} value ${outstanding} beyond tolerance ±${terms.amountTolerancePercent}%`,
      'lcAmount'
    );
  }

  const linkedCurrency = String(proforma?.currency || importPo?.currency || '').toUpperCase();
  const currency = String(data.currency || linkedCurrency || 'USD').toUpperCase();
  if (linkedCurrency && currency !== linkedCurrency) {
    throw validationError(
      `Currency must match the linked ${proforma ? 'PI' : 'PO'} currency (${linkedCurrency})`,
      'currency'
    );
  }

  const rateDate = assertImportRateDate(data.exchangeRateDate || terms.issuanceDate || new Date(), {
    orderDate: importPo?.orderDate || importPo?.createdAt,
    field: 'exchangeRateDate',
    label: 'Rate date',
  });
  const fx = await resolveImportExchangeRate({
    companyId,
    currencyCode: currency,
    foreignAmount: lcAmount,
    explicitRate: data.exchangeRateToUsd ?? data.exchangeRate,
    allowExplicitRate: true,
    asOfDate: rateDate,
  });

  const cashMarginBlocked =
    data.cashMarginBlockedUsd != null
      ? toNumber(data.cashMarginBlockedUsd)
      : Math.round(((fx.baseAmount * terms.marginPercent) / 100) * 100) / 100;
  const bankCharges = toNumber(data.bankChargesUsd, 0);
  const confirmed = data.confirmed !== false && data.confirmed !== 'false' && data.confirmed !== 'unconfirmed';

  const count = await prisma.importFinanceLc.count({ where: { companyId } });
  const year = new Date().getFullYear();
  const lcNumber = String(data.lcNumber || `ILC-${year}-${String(count + 1).padStart(3, '0')}`).trim();
  if (!lcNumber) throw validationError('LC number is required', 'lcNumber');

  const existingNumber = await prisma.importFinanceLc.findFirst({
    where: { companyId, lcNumber },
    select: { id: true },
  });
  if (existingNumber) throw validationError(`LC number ${lcNumber} already exists`, 'lcNumber');

  const lcType =
    data.lcType ||
    `Irrevocable ${confirmed ? 'Confirmed' : 'Unconfirmed'} ${terms.paymentTenor} LC`;

  const lc = await prisma.importFinanceLc.create({
    data: {
      companyId,
      lcNumber,
      importPoId: importPo?.id || null,
      poRef: data.poRef || importPo?.poNumber || null,
      piRef: data.piRef || proforma?.piNumber || importPo?.piRef || null,
      proformaId: proforma?.id || null,
      shipmentId: data.shipmentId || null,
      supplierId: data.supplierId || importPo?.supplierId || proforma?.supplierId || null,
      applicant: data.applicant || company?.name || null,
      incoterm: data.incoterm || importPo?.incoterm || proforma?.incoterm || null,
      lcType,
      paymentTenor: terms.paymentTenor,
      usanceDays: terms.usanceDays,
      issuingBank: String(data.issuingBank).trim(),
      advisingBank: data.advisingBank ? String(data.advisingBank).trim() : null,
      beneficiary,
      lcAmount,
      currency: fx.currencyCode,
      exchangeRateToUsd: fx.exchangeRate,
      exchangeRateDate: rateDate,
      baseCurrencyCode: fx.baseCurrencyCode,
      lcAmountBase: fx.baseAmount,
      amountTolerancePercent: terms.amountTolerancePercent,
      amountDrawn: 0,
      issuanceDate: terms.issuanceDate,
      expiryDate: terms.expiryDate,
      latestShipmentDate: terms.latestShipmentDate,
      presentationPeriodDays: terms.presentationPeriodDays,
      confirmed,
      partialShipmentAllowed: Boolean(data.partialShipmentAllowed),
      transshipmentAllowed: Boolean(data.transshipmentAllowed),
      portOfLoading:
        data.portOfLoading || importPo?.portOfLoading || proforma?.portOfLoading || null,
      portOfDischarge:
        data.portOfDischarge ||
        importPo?.portOfEntry ||
        proforma?.portOfDischarge ||
        proforma?.portOfEntry ||
        null,
      marginPercent: terms.marginPercent,
      cashMarginBlockedUsd: cashMarginBlocked,
      bankChargesUsd: bankCharges,
      status: 'Draft',
      notes: data.notes || null,
      createdBy: userId,
      amendments: [],
    },
    include: { importPo: true },
  });

  await logImportAudit({
    companyId,
    action: 'CREATE',
    entityType: 'IMPORT_FINANCE_LC',
    entityId: lc.id,
    details: {
      lcNumber,
      lcAmount,
      lcAmountBase: fx.baseAmount,
      from: null,
      to: 'Draft',
      note: 'LC draft created',
    },
    userId,
  });

  return enrichFinanceLc(lc);
}

async function getFinanceLcById(req, id) {
  const lc = await prisma.importFinanceLc.findUnique({
    where: { id },
    include: {
      importPo: true,
      creator: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  if (!lc) {
    const err = new Error('LC not found');
    err.status = 404;
    throw err;
  }
  await assertRecordCompanyAccess(req, lc.companyId);

  let proforma = null;
  if (lc.proformaId) {
    proforma = await prisma.importProformaInvoice.findFirst({
      where: { id: lc.proformaId, companyId: lc.companyId },
      select: {
        id: true,
        piNumber: true,
        amountForeign: true,
        currency: true,
        status: true,
        importPoId: true,
      },
    });
  }

  let shipment = null;
  if (lc.shipmentId) {
    shipment = await prisma.importShipment.findFirst({
      where: { id: lc.shipmentId, companyId: lc.companyId },
      select: { id: true, shipmentNumber: true, status: true, eta: true },
    });
  }

  const auditTrail = await prisma.importAuditLog.findMany({
    where: { companyId: lc.companyId, entityType: 'IMPORT_FINANCE_LC', entityId: id },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return enrichFinanceLc(lc, { proforma, shipment, auditTrail });
}

async function updateFinanceLcStatus(req, id, status, extra = {}) {
  const lc = await prisma.importFinanceLc.findUnique({ where: { id } });
  if (!lc) {
    const err = new Error('LC not found');
    err.status = 404;
    throw err;
  }
  await assertRecordCompanyAccess(req, lc.companyId);

  const from = normalizeLcStatus(lc.status);
  const to = normalizeLcStatus(status);
  assertStatusTransition(LC_STATUS_TRANSITIONS, from, to);

  const userId = req.user.id;
  const isIssueOrApprove = from === 'Draft' && to === 'Issued';

  if (isIssueOrApprove) {
    const settings = await prisma.importSetting.findUnique({ where: { companyId: lc.companyId } });
    const requireSeparate = settings?.requireSeparateLcApprover !== false;
    if (requireSeparate && lc.createdBy && lc.createdBy === userId) {
      const err = new Error(
        'Creator and approver must be different users. The user who created this LC cannot issue/approve it.'
      );
      err.status = 403;
      err.code = 'SEPARATE_LC_APPROVER_REQUIRED';
      throw err;
    }
  }

  if (
    (to === 'Paid/Settled' || to === 'Settled') &&
    !extra.settlementPaymentId &&
    !lc.settlementPaymentId
  ) {
    const err = new Error(
      'Cannot mark LC Paid/Settled without settlementPaymentId from an authorized bank/payment transaction'
    );
    err.status = 400;
    err.code = 'SETTLEMENT_PAYMENT_REQUIRED';
    throw err;
  }

  const data = { status: to };
  if (isIssueOrApprove) {
    data.issuedBy = userId;
    data.issuedAt = new Date();
    data.approvedBy = userId;
    data.approvedAt = new Date();
  }
  if (extra.documentPresentationDate) {
    data.documentPresentationDate = new Date(extra.documentPresentationDate);
  }
  if (extra.discrepancyNotes !== undefined) data.discrepancyNotes = extra.discrepancyNotes;
  if (to === 'Paid/Settled') {
    data.settlementDate = new Date();
    data.settlementPaymentId = extra.settlementPaymentId || lc.settlementPaymentId;
    if (extra.amountDrawn != null) {
      data.amountDrawn = toNumber(extra.amountDrawn, toNumber(lc.lcAmount));
    } else if (toNumber(lc.amountDrawn) <= 0) {
      data.amountDrawn = toNumber(lc.lcAmount);
    }
  }
  if (extra.amountDrawn != null) {
    const drawn = toNumber(extra.amountDrawn);
    if (drawn < 0) throw validationError('Amount drawn cannot be negative', 'amountDrawn');
    const maxDraw = toNumber(lc.lcAmount) * (1 + toNumber(lc.amountTolerancePercent) / 100);
    if (drawn > maxDraw + 0.0001) {
      throw validationError('Amount drawn exceeds LC amount beyond tolerance', 'amountDrawn');
    }
    data.amountDrawn = drawn;
  }

  const updated = await prisma.importFinanceLc.update({
    where: { id },
    data,
    include: { importPo: true },
  });

  await logImportAudit({
    companyId: lc.companyId,
    action: isIssueOrApprove ? 'APPROVE' : 'STATUS_CHANGE',
    entityType: 'IMPORT_FINANCE_LC',
    entityId: id,
    details: { from, to, previousStatus: from, nextStatus: to },
    userId,
  });

  return enrichFinanceLc(updated);
}

async function amendFinanceLc(req, id, patch = {}) {
  const lc = await prisma.importFinanceLc.findUnique({ where: { id } });
  if (!lc) {
    const err = new Error('LC not found');
    err.status = 404;
    throw err;
  }
  await assertRecordCompanyAccess(req, lc.companyId);

  const fromStatus = normalizeLcStatus(lc.status);
  if (!['Issued', 'Amended', 'Documents Presented'].includes(fromStatus)) {
    throw validationError(`Cannot amend LC in status ${fromStatus}`);
  }

  const nextAmount = patch.lcAmount != null ? toNumber(patch.lcAmount) : toNumber(lc.lcAmount);
  const nextExpiry = patch.expiryDate != null ? patch.expiryDate : lc.expiryDate;
  const nextShipment =
    patch.latestShipmentDate !== undefined ? patch.latestShipmentDate : lc.latestShipmentDate;
  const nextTolerance =
    patch.amountTolerancePercent != null
      ? toNumber(patch.amountTolerancePercent)
      : toNumber(lc.amountTolerancePercent);

  const terms = validateLcDatesAndTerms(
    {
      paymentTenor: lc.paymentTenor || 'At Sight',
      usanceDays: lc.usanceDays,
      marginPercent: lc.marginPercent,
      issuingBank: lc.issuingBank,
      beneficiary: lc.beneficiary,
      issuanceDate: lc.issuanceDate,
      expiryDate: nextExpiry,
      latestShipmentDate: nextShipment,
      presentationPeriodDays: lc.presentationPeriodDays,
      amountTolerancePercent: nextTolerance,
    },
    { requireExpiry: true }
  );

  if (!(nextAmount > 0)) throw validationError('LC amount must be greater than zero', 'lcAmount');

  if (lc.importPoId || lc.proformaId) {
    const reference = lc.proformaId
      ? await prisma.importProformaInvoice.findFirst({
          where: { id: lc.proformaId, companyId: lc.companyId },
        })
      : await prisma.importPurchaseOrder.findFirst({
          where: { id: lc.importPoId, companyId: lc.companyId },
        });
    const referenceValue = lc.proformaId
      ? toNumber(reference?.amountForeign)
      : toNumber(reference?.subtotalForeign);
    const alreadyCovered = await sumCoveringLcAmount(lc.companyId, {
      importPoId: lc.importPoId,
      proformaId: lc.proformaId,
      excludeLcId: lc.id,
    });
    const outstanding = Math.max(0, referenceValue - alreadyCovered);
    const maxAllowed = outstanding * (1 + terms.amountTolerancePercent / 100);
    if (nextAmount > maxAllowed + 0.0001) {
      throw validationError(
        `Amended LC amount exceeds outstanding linked value beyond tolerance`,
        'lcAmount'
      );
    }
  }

  const changes = {};
  if (patch.lcAmount != null && toNumber(patch.lcAmount) !== toNumber(lc.lcAmount)) {
    changes.lcAmount = { from: toNumber(lc.lcAmount), to: nextAmount };
  }
  if (patch.expiryDate != null) {
    const from = lc.expiryDate ? startOfDay(lc.expiryDate).toISOString().slice(0, 10) : null;
    const to = terms.expiryDate ? terms.expiryDate.toISOString().slice(0, 10) : null;
    if (from !== to) changes.expiryDate = { from, to };
  }
  if (patch.latestShipmentDate !== undefined) {
    const from = lc.latestShipmentDate
      ? startOfDay(lc.latestShipmentDate).toISOString().slice(0, 10)
      : null;
    const to = terms.latestShipmentDate
      ? terms.latestShipmentDate.toISOString().slice(0, 10)
      : null;
    if (from !== to) changes.latestShipmentDate = { from, to };
  }
  if (Object.keys(changes).length === 0) {
    throw validationError('No amendment changes provided');
  }

  const fx = await resolveImportExchangeRate({
    companyId: lc.companyId,
    currencyCode: lc.currency,
    foreignAmount: nextAmount,
    explicitRate: lc.exchangeRateToUsd,
    allowExplicitRate: true,
    asOfDate: lc.issuanceDate,
  });

  const amendmentEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    by: req.user.id,
    reason: patch.reason || patch.notes || null,
    changes,
  };
  const priorAmendments = Array.isArray(lc.amendments)
    ? lc.amendments
    : lc.amendments
      ? [lc.amendments]
      : [];

  const updated = await prisma.importFinanceLc.update({
    where: { id },
    data: {
      lcAmount: nextAmount,
      lcAmountBase: fx.baseAmount,
      expiryDate: terms.expiryDate,
      latestShipmentDate: terms.latestShipmentDate,
      amountTolerancePercent: terms.amountTolerancePercent,
      cashMarginBlockedUsd: Math.round(((fx.baseAmount * toNumber(lc.marginPercent)) / 100) * 100) / 100,
      status: 'Amended',
      amendments: [...priorAmendments, amendmentEntry],
      notes: patch.notes !== undefined ? patch.notes : lc.notes,
    },
    include: { importPo: true },
  });

  await logImportAudit({
    companyId: lc.companyId,
    action: 'AMEND',
    entityType: 'IMPORT_FINANCE_LC',
    entityId: id,
    details: { from: fromStatus, to: 'Amended', changes, reason: amendmentEntry.reason },
    userId: req.user.id,
  });

  return enrichFinanceLc(updated);
}

async function updateDocumentStatus(req, id, status, extra = {}) {
  const doc = await prisma.importDocument.findUnique({ where: { id } });
  if (!doc) {
    const err = new Error('Document not found');
    err.status = 404;
    throw err;
  }
  await assertRecordCompanyAccess(req, doc.companyId);

  const updated = await prisma.importDocument.update({
    where: { id },
    data: {
      status,
      verifiedAt: status === 'Verified' || status === 'Approved' ? new Date() : doc.verifiedAt,
      verifiedBy:
        status === 'Verified' || status === 'Approved' ? req.user.id : doc.verifiedBy,
      originalReceived:
        extra.originalReceived != null ? Boolean(extra.originalReceived) : doc.originalReceived,
      notes: extra.notes !== undefined ? extra.notes : doc.notes,
      fileUrl: extra.fileUrl !== undefined ? extra.fileUrl : doc.fileUrl,
    },
  });

  await logImportAudit({
    companyId: doc.companyId,
    action: 'STATUS_CHANGE',
    entityType: 'IMPORT_DOCUMENT',
    entityId: id,
    details: { status },
    userId: req.user.id,
  });

  return updated;
}

module.exports = {
  previewFx,
  correctPurchaseOrderExchangeRate,
  getProformaById,
  createProformaEnterprise,
  updateProformaEnterprise,
  updateProformaStatusEnterprise,
  recordAdvancePaymentEnterprise,
  getSupplierBillById,
  createSupplierBillEnterprise,
  postSupplierBillEnterprise,
  recordBillPaymentEnterprise,
  createCustomsClearanceEnterprise,
  updateCustomsStatusEnterprise,
  previewCustomsClearance: (...args) => importCustoms.previewCustomsClearance(...args),
  getCustomsClearanceById: (...args) => importCustoms.getCustomsClearanceById(...args),
  listCustomsClearancesEnriched: (...args) => importCustoms.listCustomsClearancesEnriched(...args),
  recalculateCustomsWithCurrentRate: (...args) =>
    importCustoms.recalculateCustomsWithCurrentRate(...args),
  refreshCustomsTariffData: (...args) => importCustoms.refreshCustomsTariffData(...args),
  recordCustomsDutyPayment: (...args) => importCustoms.recordCustomsDutyPayment(...args),
  listCustomsPaymentAccounts: (...args) => importCustoms.listCustomsPaymentAccounts(...args),
  CUSTOMS_STATUS_TRANSITIONS: importCustoms.CUSTOMS_STATUS_TRANSITIONS,
  normalizeCustomsStatus: importCustoms.normalizeCustomsStatus,
  createLandedCostEnterprise,
  reverseLandedCost,
  createFinanceLcEnterprise,
  getFinanceLcById,
  updateFinanceLcStatus,
  amendFinanceLc,
  listEligibleFinancePos,
  enrichFinanceLc,
  normalizeLcStatus,
  LC_STATUS_TRANSITIONS,
  updateDocumentStatus,
  PROFORMA_STATUS_TRANSITIONS,
};
