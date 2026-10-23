'use strict';

/**
 * Import GRN — shipment-centric receiving after customs release.
 * Local / domestic purchases keep their own PO → GRN path.
 */

const prisma = require('../prisma/client');
const { adjustLocationStock } = require('../warehouse/services/locationService');
const {
  requireSingleCompany,
  assertRecordCompanyAccess,
  assertLocationBelongsToActiveCompany,
} = require('../utils/companyAccess');

const IMPORT_GRN_POSTED_STATUSES = ['Posted', 'Inspected & Received', 'Confirmed', 'Received'];
const CUSTOMS_RELEASED_STATUSES = ['Released/Cleared', 'Cleared', 'Out of Charge', 'Released'];
const RECEIVABLE_SHIPMENT_STATUSES = [
  'Arrived',
  'Arrived at Port',
  'Arrived at Destination',
  'Customs Clearance',
  'Cleared',
  'Customs Cleared',
  'Customs Released',
  'Partially Received',
  'Delivered/Received',
];

function toNumber(val, fallback = 0) {
  if (val == null) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function startOfDay(d) {
  const x = d instanceof Date ? new Date(d) : new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function todayUtc() {
  return startOfDay(new Date());
}

function grnError(message, code = 'GRN_ERROR', status = 400, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function isCustomsReleased(status) {
  return CUSTOMS_RELEASED_STATUSES.includes(String(status || '').trim());
}

function isBlOriginal(blType) {
  const t = String(blType || '').toLowerCase();
  return t.includes('original') && !t.includes('telex') && !t.includes('express') && !t.includes('seaway');
}

async function logImportAudit({ companyId, action, entityType, entityId, details, userId }) {
  try {
    await prisma.importAuditLog.create({
      data: {
        companyId,
        action,
        entityType,
        entityId,
        details: details || {},
        userId: userId || null,
      },
    });
  } catch (_) {
    /* non-fatal */
  }
}

/** Sum processed qty (good+short+damaged+rejected) from posted GRNs per shipment line. */
async function sumPostedProcessedForShipment(tx, { companyId, shipmentId }) {
  const rows = await tx.importGrnItem.findMany({
    where: {
      importGrn: {
        companyId,
        shipmentId,
        status: { in: IMPORT_GRN_POSTED_STATUSES },
      },
    },
    select: {
      shipmentItemId: true,
      importPoItemId: true,
      productId: true,
      acceptedQty: true,
      receivedQty: true,
      shortQty: true,
      damagedQty: true,
      rejectedQty: true,
    },
  });
  const byShipmentItemId = {};
  const byPoItemId = {};
  const byProductId = {};
  for (const r of rows) {
    const good = toNumber(r.acceptedQty != null ? r.acceptedQty : r.receivedQty, 0);
    const processed =
      good + toNumber(r.shortQty, 0) + toNumber(r.damagedQty, 0) + toNumber(r.rejectedQty, 0);
    if (r.shipmentItemId) {
      byShipmentItemId[r.shipmentItemId] = (byShipmentItemId[r.shipmentItemId] || 0) + processed;
    }
    if (r.importPoItemId) {
      byPoItemId[r.importPoItemId] = (byPoItemId[r.importPoItemId] || 0) + processed;
    }
    if (r.productId) {
      byProductId[r.productId] = (byProductId[r.productId] || 0) + processed;
    }
  }
  return { byShipmentItemId, byPoItemId, byProductId };
}

async function sumPostedAcceptedForPo(tx, { companyId, importPoId }) {
  const rows = await tx.importGrnItem.findMany({
    where: {
      importGrn: {
        companyId,
        importPoId,
        status: { in: IMPORT_GRN_POSTED_STATUSES },
      },
    },
    select: {
      importPoItemId: true,
      productId: true,
      acceptedQty: true,
      receivedQty: true,
    },
  });
  const byPoItemId = {};
  const byProductId = {};
  for (const r of rows) {
    const qty = toNumber(r.acceptedQty != null ? r.acceptedQty : r.receivedQty, 0);
    if (r.importPoItemId) byPoItemId[r.importPoItemId] = (byPoItemId[r.importPoItemId] || 0) + qty;
    if (r.productId) byProductId[r.productId] = (byProductId[r.productId] || 0) + qty;
  }
  return { byPoItemId, byProductId };
}

function validateReceiveQty({
  orderedQty,
  alreadyReceivedQty,
  receiveQty,
  allowOverReceive = false,
  requirePositive = true,
  remainingLabel = 'remaining',
}) {
  const ordered = toNumber(orderedQty, 0);
  const already = toNumber(alreadyReceivedQty, 0);
  const recv = toNumber(receiveQty, 0);
  if (!Number.isFinite(recv)) {
    throw grnError('Quantity is not a valid number', 'INVALID_QTY');
  }
  if (recv < 0 || (requirePositive && !(recv > 0))) {
    throw grnError(
      requirePositive && !(recv > 0)
        ? 'Quantity must be greater than zero where entered'
        : 'Quantity cannot be negative',
      'INVALID_QTY'
    );
  }
  const remaining = Math.max(0, ordered - already);
  if (!allowOverReceive && recv > remaining + 1e-9) {
    throw grnError(
      `Remaining shipped quantity: ${remaining}`,
      'OVER_RECEIVE',
      400,
      { remaining }
    );
  }
  return { ordered, already, recv, remaining };
}

function serializePoItemForReceiving(item, previouslyReceived) {
  const orderedQty = toNumber(item.quantity, 0);
  const previouslyReceivedQty = toNumber(previouslyReceived, 0);
  const remainingQty = Math.max(0, orderedQty - previouslyReceivedQty);
  return {
    id: item.id,
    importPoItemId: item.id,
    productId: item.productId || null,
    productName: item.productName,
    sku: item.sku || null,
    uom: item.uom || 'PCS',
    orderedQty,
    previouslyReceivedQty,
    remainingQty,
    unitPrice: toNumber(item.unitPrice, 0),
  };
}

async function assertCustomsGate(shipment, settings, { earlyReceiveReason } = {}) {
  const customsList = shipment.customsClearances || [];
  const customs =
    customsList.find((c) => isCustomsReleased(c.clearanceStatus)) ||
    customsList.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0] ||
    null;

  if (!customs) {
    if (settings?.allowGrnBeforeCustomsRelease) {
      if (!String(earlyReceiveReason || '').trim()) {
        throw grnError(
          'Customs entry is missing. Provide a reason to receive before customs release (stock will be Bonded / under customs).',
          'CUSTOMS_MISSING_REASON',
          400,
          { customsStatus: null, customsLink: '/import/customs' }
        );
      }
      return { customs: null, isBonded: true, early: true };
    }
    throw grnError(
      'Cannot create Import GRN: no customs entry linked to this shipment. Complete customs clearance first.',
      'CUSTOMS_REQUIRED',
      400,
      { customsStatus: null, customsLink: '/import/customs' }
    );
  }

  if (isCustomsReleased(customs.clearanceStatus)) {
    return { customs, isBonded: false, early: false };
  }

  if (settings?.allowGrnBeforeCustomsRelease) {
    if (!String(earlyReceiveReason || '').trim()) {
      throw grnError(
        `Customs status is "${customs.clearanceStatus}". Provide a reason to receive before release (stock will be Bonded / under customs). Open entry: /import/customs?id=${customs.id}`,
        'CUSTOMS_NOT_RELEASED',
        400,
        {
          customsStatus: customs.clearanceStatus,
          customsId: customs.id,
          customsLink: `/import/customs?id=${customs.id}`,
        }
      );
    }
    return { customs, isBonded: true, early: true };
  }

  throw grnError(
    `Cannot create Import GRN while customs status is "${customs.clearanceStatus}". Wait until Released/Cleared. Open entry: /import/customs?id=${customs.id}`,
    'CUSTOMS_NOT_RELEASED',
    400,
    {
      customsStatus: customs.clearanceStatus,
      customsId: customs.id,
      customsEntry: customs.entryNumber,
      customsLink: `/import/customs?id=${customs.id}`,
    }
  );
}

async function assertOriginalBl(shipment, settings) {
  if (settings?.requirePhysicalOriginalBl === false) return;
  if (!isBlOriginal(shipment.blType)) return;
  if (shipment.originalBlReceived) return;
  throw grnError(
    `Original B/L is required and not yet verified for shipment ${shipment.shipmentNumber}. Record "Original B/L received and verified" first.`,
    'ORIGINAL_BL_REQUIRED',
    400,
    { shipmentId: shipment.id, blNumber: shipment.blNumber }
  );
}

function assertReceiptDate(receiptDate, shipment, customs, { isBonded = false } = {}) {
  const rd = startOfDay(receiptDate);
  if (rd.getTime() > todayUtc().getTime()) {
    throw grnError('Receiving date must not be in the future', 'INVALID_RECEIPT_DATE');
  }
  const ata = shipment.actualArrival ? startOfDay(shipment.actualArrival) : null;
  if (ata && rd.getTime() < ata.getTime()) {
    throw grnError(
      'Receiving date must not be before the shipment ATA (actual arrival)',
      'INVALID_RECEIPT_DATE'
    );
  }
  if (isBonded) return;
  const release = customs?.releaseDate ? startOfDay(customs.releaseDate) : null;
  if (release && isCustomsReleased(customs.clearanceStatus) && rd.getTime() < release.getTime()) {
    throw grnError(
      'Receiving date must not be before the customs release date',
      'INVALID_RECEIPT_DATE'
    );
  }
}

async function listReceivableShipments(req, query = {}) {
  const companyId = requireSingleCompany(req);
  const settings = await prisma.importSetting.findUnique({ where: { companyId } }).catch(() => null);

  const shipments = await prisma.importShipment.findMany({
    where: {
      companyId,
      shipmentStatus: { notIn: ['Cancelled', 'Booking Confirmed'] },
      ...(query.search
        ? {
            OR: [
              { shipmentNumber: { contains: query.search, mode: 'insensitive' } },
              { blNumber: { contains: query.search, mode: 'insensitive' } },
              { containerNo: { contains: query.search, mode: 'insensitive' } },
              { poRef: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: {
      items: true,
      customsClearances: {
        orderBy: { updatedAt: 'desc' },
        take: 5,
      },
      importPo: {
        select: {
          id: true,
          poNumber: true,
          status: true,
          currency: true,
          items: {
            select: {
              id: true,
              productId: true,
              productName: true,
              sku: true,
              quantity: true,
              uom: true,
              unitPrice: true,
            },
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: Number(query.limit) || 100,
  });

  const result = [];
  for (const s of shipments) {
    const statusNorm = String(s.shipmentStatus || '');
    // Prefer arrived/cleared; still list in-transit so user sees why receive may be blocked later
    const isReceivableStatus = RECEIVABLE_SHIPMENT_STATUSES.some(
      (st) => st.toLowerCase() === statusNorm.toLowerCase()
    );
    if (
      !isReceivableStatus &&
      !['Departed', 'In Transit', 'Delayed', 'Customs Hold'].includes(statusNorm)
    ) {
      continue;
    }

    let posted = { byShipmentItemId: {}, byPoItemId: {}, byProductId: {} };
    try {
      posted = await sumPostedProcessedForShipment(prisma, {
        companyId,
        shipmentId: s.id,
      });
    } catch (e) {
      // Prisma client / column mismatch should not blank the whole dropdown
      console.warn('[listReceivableShipments] posted qty lookup failed:', e.message);
    }

    let sourceLines = s.items || [];
    // Shipments created without line items: fall back to linked PO lines
    if (!sourceLines.length && s.importPo?.items?.length) {
      sourceLines = s.importPo.items.map((pi) => ({
        id: `po:${pi.id}`,
        importPoItemId: pi.id,
        productId: pi.productId,
        productName: pi.productName,
        quantity: pi.quantity,
        uom: pi.uom,
      }));
    }

    let remainingTotal = 0;
    const lineSummaries = sourceLines.map((it) => {
      const shipped = toNumber(it.quantity, 0);
      const already =
        (it.id && !String(it.id).startsWith('po:') && posted.byShipmentItemId[it.id]) ||
        (it.importPoItemId && posted.byPoItemId[it.importPoItemId]) ||
        (it.productId && posted.byProductId[it.productId]) ||
        0;
      const remaining = Math.max(0, shipped - already);
      remainingTotal += remaining;
      return {
        shipmentItemId: String(it.id).startsWith('po:') ? null : it.id,
        importPoItemId: it.importPoItemId || null,
        productName: it.productName,
        shippedQty: shipped,
        previouslyReceivedQty: already,
        remainingQty: remaining,
      };
    });
    // Fully received Delivered/Received with no remaining — skip
    if (remainingTotal <= 1e-9) continue;
    // Not yet arrived: still show so user can pick once status advances (label marks it)
    if (!isReceivableStatus) {
      // keep in list with canReceive false below
    }

    const customs =
      (s.customsClearances || []).find((c) => isCustomsReleased(c.clearanceStatus)) ||
      (s.customsClearances || [])[0] ||
      null;

    result.push({
      id: s.id,
      shipmentNumber: s.shipmentNumber,
      shipmentStatus: s.shipmentStatus,
      importPoId: s.importPoId,
      poRef: s.poRef || s.importPo?.poNumber || null,
      piRef: s.piRef,
      lcRef: s.lcRef,
      blNumber: s.blNumber,
      blType: s.blType,
      originalBlReceived: s.originalBlReceived,
      containerNo: s.containerNo,
      vesselName: s.vesselName || s.vesselFlight,
      actualArrival: s.actualArrival,
      remainingTotal,
      linesRemaining: lineSummaries,
      customs: customs
        ? {
            id: customs.id,
            entryNumber: customs.entryNumber,
            billOfEntryNo: customs.billOfEntryNo,
            clearanceStatus: customs.clearanceStatus,
            releaseDate: customs.releaseDate,
            isReleased: isCustomsReleased(customs.clearanceStatus),
          }
        : null,
      canReceive:
        isReceivableStatus &&
        ((customs && isCustomsReleased(customs.clearanceStatus)) ||
          settings?.allowGrnBeforeCustomsRelease === true),
      label: `${s.shipmentNumber} · ${statusNorm} · rem ${remainingTotal}${
        s.poRef || s.importPo?.poNumber ? ` · PO ${s.poRef || s.importPo.poNumber}` : ''
      }${!isReceivableStatus ? ' (not arrived yet)' : ''}`,
    });
  }
  return result;
}

async function getShipmentReceivingPreview(req, shipmentId) {
  const companyId = requireSingleCompany(req);
  if (!shipmentId) throw grnError('shipmentId is required', 'SHIPMENT_REQUIRED');

  const shipment = await prisma.importShipment.findFirst({
    where: { id: shipmentId, companyId },
    include: {
      items: true,
      customsClearances: { orderBy: { updatedAt: 'desc' } },
      importPo: { include: { items: true } },
    },
  });
  if (!shipment) throw grnError('Shipment not found', 'NOT_FOUND', 404);

  const settings = await prisma.importSetting.findUnique({ where: { companyId } }).catch(() => null);
  let posted = { byShipmentItemId: {}, byPoItemId: {}, byProductId: {} };
  try {
    posted = await sumPostedProcessedForShipment(prisma, { companyId, shipmentId });
  } catch (e) {
    console.warn('[getShipmentReceivingPreview] posted qty lookup failed:', e.message);
  }

  const customs =
    (shipment.customsClearances || []).find((c) => isCustomsReleased(c.clearanceStatus)) ||
    (shipment.customsClearances || [])[0] ||
    null;

  const poItemsById = {};
  for (const pi of shipment.importPo?.items || []) poItemsById[pi.id] = pi;

  let sourceItems = shipment.items || [];
  if (!sourceItems.length && shipment.importPo?.items?.length) {
    sourceItems = shipment.importPo.items.map((pi) => ({
      id: null,
      importPoItemId: pi.id,
      productId: pi.productId,
      productName: pi.productName,
      sku: pi.sku,
      quantity: pi.quantity,
      uom: pi.uom,
    }));
  }

  const lines = sourceItems.map((it) => {
    const shipped = toNumber(it.quantity, 0);
    const already =
      (it.id && posted.byShipmentItemId[it.id]) ||
      (it.importPoItemId && posted.byPoItemId[it.importPoItemId]) ||
      (it.productId && posted.byProductId[it.productId]) ||
      0;
    const remaining = Math.max(0, shipped - already);
    const poLine = it.importPoItemId ? poItemsById[it.importPoItemId] : null;
    return {
      shipmentItemId: it.id || null,
      importPoItemId: it.importPoItemId || null,
      productId: it.productId || poLine?.productId || null,
      productName: it.productName,
      sku: it.sku || poLine?.sku || null,
      uom: it.uom || poLine?.uom || 'PCS',
      orderedQty: poLine ? toNumber(poLine.quantity, 0) : shipped,
      shippedQty: shipped,
      previouslyReceivedQty: already,
      remainingQty: remaining,
      unitPrice: poLine ? toNumber(poLine.unitPrice, 0) : 0,
      receivedOfLabel: `Received ${already} of ${shipped}`,
    };
  });

  return {
    shipmentId: shipment.id,
    shipmentNumber: shipment.shipmentNumber,
    shipmentStatus: shipment.shipmentStatus,
    importPoId: shipment.importPoId,
    poNumber: shipment.poRef || shipment.importPo?.poNumber || null,
    piRef: shipment.piRef,
    proformaId: shipment.proformaId,
    lcRef: shipment.lcRef,
    financeLcId: shipment.financeLcId,
    blNumber: shipment.blNumber,
    blType: shipment.blType,
    originalBlReceived: shipment.originalBlReceived,
    containerNo: shipment.containerNo,
    vesselName: shipment.vesselName || shipment.vesselFlight,
    actualArrival: shipment.actualArrival,
    currency: shipment.currency || shipment.importPo?.currency || 'USD',
    customs: customs
      ? {
          id: customs.id,
          entryNumber: customs.entryNumber,
          billOfEntryNo: customs.billOfEntryNo,
          clearanceStatus: customs.clearanceStatus,
          releaseDate: customs.releaseDate,
          exchangeRateToUsd: toNumber(customs.exchangeRateToUsd, 1),
          isReleased: isCustomsReleased(customs.clearanceStatus),
          link: `/import/customs?id=${customs.id}`,
        }
      : null,
    settings: {
      allowGrnBeforeCustomsRelease: settings?.allowGrnBeforeCustomsRelease === true,
      requirePhysicalOriginalBl: settings?.requirePhysicalOriginalBl !== false,
      requireSeparateGrnPoster: settings?.requireSeparateGrnPoster !== false,
      defaultReceivingLocationId: settings?.defaultReceivingLocationId || null,
    },
    lines,
  };
}

/** Reject PO-direct receiving — kept for backwards compat of old route. */
async function getReceivingPreview(req, importPoId) {
  throw grnError(
    'Import goods must be received against a shipment. Use shipment receiving preview instead.',
    'SHIPMENT_REQUIRED',
    400
  );
}

async function listGrns(req, query = {}) {
  const companyScope = requireSingleCompany(req);
  const { search, status, page = 1, limit = 20 } = query;
  const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

  const where = {
    companyId: companyScope,
    ...(status && status !== 'All' ? { status } : {}),
    ...(search
      ? {
          OR: [
            { grnNumber: { contains: search, mode: 'insensitive' } },
            { poRef: { contains: search, mode: 'insensitive' } },
            { shipmentRef: { contains: search, mode: 'insensitive' } },
            { containerNo: { contains: search, mode: 'insensitive' } },
            { warehouseName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.importGrn.count({ where }),
    prisma.importGrn.findMany({
      where,
      include: {
        items: true,
        importPo: true,
        location: true,
        shipment: true,
        customsClearance: true,
        supplierClaims: true,
        landedCosts: { select: { id: true, allocationNumber: true, status: true } },
      },
      orderBy: { receiptDate: 'desc' },
      skip,
      take: Number(limit),
    }),
  ]);

  return {
    items: items.map(enrichGrn),
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)) || 1,
    },
  };
}

function enrichGrn(grn) {
  if (!grn) return grn;
  return {
    ...grn,
    isPosted: IMPORT_GRN_POSTED_STATUSES.includes(grn.status) && !!grn.stockPostedAt,
    isLegacy: grn.isLegacy === true,
    legacyBanner: grn.isLegacy
      ? 'Legacy - no shipment/customs link. This GRN was created before shipment-gated receiving.'
      : null,
    receivedDate: grn.receiptDate,
  };
}

async function getGrnById(req, id) {
  const grn = await prisma.importGrn.findUnique({
    where: { id },
    include: {
      items: true,
      importPo: true,
      location: true,
      shipment: true,
      customsClearance: true,
      supplierClaims: true,
      landedCosts: true,
      creator: { select: { id: true, email: true, firstName: true, lastName: true } },
      poster: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  });
  if (!grn) throw grnError('Import GRN not found', 'NOT_FOUND', 404);
  await assertRecordCompanyAccess(req, grn.companyId);

  const auditTrail = await prisma.importAuditLog.findMany({
    where: { companyId: grn.companyId, entityType: 'IMPORT_GRN', entityId: id },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return { ...enrichGrn(grn), auditTrail };
}

async function auditImportGrns(req, query = {}) {
  const companyScope = requireSingleCompany(req);
  const where = {
    companyId: companyScope,
    ...(query.importPoId ? { importPoId: query.importPoId } : {}),
    ...(query.legacyOnly === '1' || query.legacyOnly === 'true' ? { isLegacy: true } : {}),
  };

  const grns = await prisma.importGrn.findMany({
    where,
    include: { items: true, shipment: true, customsClearance: true },
    orderBy: { createdAt: 'asc' },
  });

  const legacy = [];
  const issues = [];

  for (const g of grns) {
    const noShipment = !g.shipmentId;
    const customsOk =
      g.customsClearance && isCustomsReleased(g.customsClearance.clearanceStatus);
    if (noShipment || !customsOk || g.isLegacy) {
      legacy.push({
        grnId: g.id,
        grnNumber: g.grnNumber,
        status: g.status,
        importPoId: g.importPoId,
        poRef: g.poRef,
        shipmentId: g.shipmentId,
        customsStatus: g.customsClearance?.clearanceStatus || null,
        reason: noShipment
          ? 'Created without shipment'
          : !customsOk
            ? 'Missing released customs link'
            : 'Marked legacy',
        createdAt: g.createdAt,
      });
    }
    if (IMPORT_GRN_POSTED_STATUSES.includes(g.status) && !g.stockPostedAt) {
      issues.push({
        type: 'MISSING_STOCK_MOVEMENT',
        grnNumber: g.grnNumber,
        grnId: g.id,
      });
    }
  }

  return {
    scanned: grns.length,
    legacyCount: legacy.length,
    legacy,
    issues,
    summary: `${legacy.length} legacy Import GRN(s) without shipment/released customs link`,
    generatedAt: new Date().toISOString(),
  };
}

async function verifyShipmentOriginalBl(req, shipmentId, data = {}) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;
  const shipment = await prisma.importShipment.findFirst({
    where: { id: shipmentId, companyId },
  });
  if (!shipment) throw grnError('Shipment not found', 'NOT_FOUND', 404);

  const updated = await prisma.importShipment.update({
    where: { id: shipmentId },
    data: {
      originalBlReceived: true,
      originalBlReceivedAt: data.receivedAt ? new Date(data.receivedAt) : new Date(),
      originalBlReceivedBy: userId,
    },
  });

  await logImportAudit({
    companyId,
    action: 'ORIGINAL_BL_VERIFIED',
    entityType: 'IMPORT_SHIPMENT',
    entityId: shipmentId,
    details: { blNumber: shipment.blNumber, blType: shipment.blType },
    userId,
  });

  return updated;
}

function parseLineQtys(it) {
  const accepted = toNumber(it.acceptedQty != null ? it.acceptedQty : it.receivedQty, 0);
  const shortQty = toNumber(it.shortQty, 0);
  const damagedQty = toNumber(it.damagedQty, 0);
  const rejectedQty = toNumber(it.rejectedQty, 0);
  const received = toNumber(it.receivedQty, accepted);
  for (const [label, q] of [
    ['accepted', accepted],
    ['short', shortQty],
    ['damaged', damagedQty],
    ['rejected', rejectedQty],
  ]) {
    if (q < 0) throw grnError(`${label} quantity cannot be negative`, 'INVALID_QTY');
  }
  return { accepted, shortQty, damagedQty, rejectedQty, received };
}

async function createClaimsForLine(tx, {
  companyId,
  userId,
  grn,
  grnItem,
  shortQty,
  shortReason,
  damagedQty,
  damagedReason,
  rejectedQty,
  rejectedReason,
}) {
  const claims = [];
  const specs = [
    { type: 'Shortage', qty: shortQty, reason: shortReason },
    { type: 'Damage', qty: damagedQty, reason: damagedReason },
    { type: 'Rejected', qty: rejectedQty, reason: rejectedReason },
  ];
  for (const s of specs) {
    if (!(s.qty > 0)) continue;
    if (!String(s.reason || '').trim()) {
      throw grnError(
        `Reason is required for ${s.type.toLowerCase()} quantity on ${grnItem.productName}`,
        'CLAIM_REASON_REQUIRED'
      );
    }
    const count = await tx.importSupplierClaim.count({ where: { companyId } });
    const year = new Date().getFullYear();
    const claimNumber = `ICLM-${year}-${String(count + claims.length + 1).padStart(3, '0')}`;
    const claim = await tx.importSupplierClaim.create({
      data: {
        companyId,
        claimNumber,
        importGrnId: grn.id,
        importGrnItemId: grnItem.id,
        shipmentId: grn.shipmentId,
        importPoId: grn.importPoId,
        productId: grnItem.productId,
        productName: grnItem.productName,
        claimType: s.type,
        quantity: s.qty,
        uom: grnItem.uom || 'PCS',
        reason: String(s.reason).trim(),
        status: 'Open',
        createdBy: userId,
      },
    });
    claims.push(claim);
  }
  return claims;
}

async function syncShipmentAndPoStatus(tx, { companyId, shipment, importPo }) {
  if (!shipment) return;
  const posted = await sumPostedProcessedForShipment(tx, {
    companyId,
    shipmentId: shipment.id,
  });
  let allCovered = true;
  let anyReceived = false;
  for (const it of shipment.items || []) {
    const shipped = toNumber(it.quantity, 0);
    const done =
      posted.byShipmentItemId[it.id] ||
      (it.importPoItemId && posted.byPoItemId[it.importPoItemId]) ||
      (it.productId && posted.byProductId[it.productId]) ||
      0;
    if (done > 1e-9) anyReceived = true;
    if (done + 1e-9 < shipped) allCovered = false;
  }

  let nextShipmentStatus = shipment.shipmentStatus;
  if (allCovered && (shipment.items || []).length) {
    nextShipmentStatus = 'Delivered/Received';
  } else if (anyReceived) {
    // Keep Cleared/Arrived but surface partial via milestone note — use Cleared if was Cleared
    if (!['Delivered/Received', 'Cancelled'].includes(shipment.shipmentStatus)) {
      nextShipmentStatus = shipment.shipmentStatus;
    }
  }
  if (nextShipmentStatus !== shipment.shipmentStatus) {
    await tx.importShipment.update({
      where: { id: shipment.id },
      data: {
        shipmentStatus: nextShipmentStatus,
        ...(nextShipmentStatus === 'Delivered/Received' ? { deliveredAt: new Date() } : {}),
      },
    });
  }

  if (importPo) {
    const poPosted = await sumPostedAcceptedForPo(tx, {
      companyId,
      importPoId: importPo.id,
    });
    let allPo = true;
    let anyPo = false;
    for (const poLine of importPo.items || []) {
      const nextRecv =
        poPosted.byPoItemId[poLine.id] ||
        (poLine.productId && poPosted.byProductId[poLine.productId]) ||
        0;
      await tx.importPurchaseOrderItem.update({
        where: { id: poLine.id },
        data: { receivedQty: nextRecv },
      });
      if (nextRecv > 1e-9) anyPo = true;
      if (nextRecv + 1e-9 < toNumber(poLine.quantity)) allPo = false;
    }
    const nextPo = allPo ? 'Received' : anyPo ? 'Partially Received' : importPo.status;
    if (nextPo !== importPo.status && ['Partially Received', 'Received'].includes(nextPo)) {
      await tx.importPurchaseOrder.update({
        where: { id: importPo.id },
        data: { status: nextPo },
      });
    }
  }

  return { shipmentFullyReceived: allCovered, partiallyReceived: anyReceived && !allCovered };
}

async function postGrnStock(tx, {
  companyId,
  userId,
  grn,
  locationId,
  importPo,
  isBonded,
  customsRate,
}) {
  const existingMoves = await tx.stockMovement.count({
    where: { companyId, reference: grn.grnNumber, type: 'Goods Receiving' },
  });
  if (existingMoves > 0) {
    throw grnError(`Stock already posted for ${grn.grnNumber}`, 'ALREADY_POSTED', 409);
  }

  for (const item of grn.items) {
    if (!item.productId) {
      throw grnError(`Cannot post stock without productId for ${item.productName}`, 'PRODUCT_REQUIRED');
    }
    const acceptedQty = toNumber(item.acceptedQty || item.receivedQty, 0);
    if (!(acceptedQty > 0)) continue;

    const product = await tx.product.findFirst({
      where: { id: item.productId, companyId },
    });
    if (!product) {
      throw grnError(`Product not found in active company: ${item.productName}`, 'PRODUCT_REQUIRED');
    }

    const unitCost = toNumber(
      item.unitCostProvisional,
      toNumber(product.costPrice, 0) * (customsRate || 1)
    );

    const adj = await adjustLocationStock(tx, {
      companyId,
      productId: item.productId,
      locationId: locationId || null,
      delta: acceptedQty,
      productName: item.productName,
    });

    await tx.stockMovement.create({
      data: {
        productId: item.productId,
        productName: item.productName,
        type: 'Goods Receiving',
        movementType: 'PURCHASE_RECEIPT',
        quantity: acceptedQty,
        uom: item.uom || null,
        previousStock: adj.previousLocationStock ?? adj.previousCompanyStock ?? 0,
        newStock: adj.newLocationStock ?? adj.newCompanyStock ?? 0,
        unitCost,
        totalValue: Math.round(unitCost * acceptedQty * 10000) / 10000,
        reason: `Import GRN #${grn.grnNumber} - Shipment #${grn.shipmentRef || ''} (Provisional landed cost pending)`,
        reference: grn.grnNumber,
        status: 'Completed',
        createdBy: userId,
        companyId,
        locationId: locationId || null,
        supplierId: importPo?.supplierId || null,
        supplierName: importPo?.supplierName || null,
        movementDate: grn.receiptDate || new Date(),
        stockType: isBonded ? 'bonded' : 'bulk',
        stockDetails: {
          provisional: true,
          costStatus: 'Provisional',
          isBonded: !!isBonded,
          importGrnId: grn.id,
          shipmentId: grn.shipmentId,
          cannotSell: !!isBonded,
        },
        notes: isBonded ? 'Bonded / under customs — not sellable until released' : null,
      },
    });

    // Provisional weighted average into product cost if currently zero / unset
    if (unitCost > 0) {
      const currentCost = toNumber(product.costPrice, 0);
      const currentStock = toNumber(product.currentStock, 0);
      const prevStock = Math.max(0, currentStock - acceptedQty);
      const nextCost =
        prevStock + acceptedQty > 0
          ? (currentCost * prevStock + unitCost * acceptedQty) / (prevStock + acceptedQty)
          : unitCost;
      await tx.product.update({
        where: { id: product.id },
        data: { costPrice: Math.round(nextCost * 10000) / 10000 },
      });
    }
  }
}

async function createGrn(req, data) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;
  const idempotencyKey =
    (data.idempotencyKey || req.headers['idempotency-key'] || '').toString().trim() || null;

  if (idempotencyKey) {
    const existing = await prisma.importGrn.findFirst({
      where: { companyId, idempotencyKey },
      include: {
        items: true,
        location: true,
        shipment: true,
        customsClearance: true,
        supplierClaims: true,
      },
    });
    if (existing) return enrichGrn(existing);
  }

  // Reject PO-direct path
  if (!data.shipmentId) {
    throw grnError(
      'Import goods must be received against a shipment',
      'SHIPMENT_REQUIRED',
      400
    );
  }
  if (data.importPoId && !data.shipmentId) {
    throw grnError(
      'Import goods must be received against a shipment',
      'SHIPMENT_REQUIRED',
      400
    );
  }

  const shouldPost =
    data.confirmNow === true ||
    String(data.status || '').toLowerCase() === 'posted' ||
    String(data.status || '').toLowerCase() === 'inspected & received';

  return prisma.$transaction(
    async (tx) => {
      const shipment = await tx.importShipment.findFirst({
        where: { id: data.shipmentId, companyId },
        include: {
          items: true,
          customsClearances: { orderBy: { updatedAt: 'desc' } },
          importPo: { include: { items: true } },
        },
      });
      if (!shipment) throw grnError('Shipment not found for active company', 'NOT_FOUND', 404);

      const normalizedStatus = String(shipment.shipmentStatus || '');
      const receivable = RECEIVABLE_SHIPMENT_STATUSES.some(
        (s) => s.toLowerCase() === normalizedStatus.toLowerCase()
      );
      if (!receivable) {
        throw grnError(
          `Shipment status must be Arrived or Customs Cleared to receive (current: ${shipment.shipmentStatus})`,
          'SHIPMENT_NOT_RECEIVABLE'
        );
      }

      await tx.$queryRaw`
        SELECT id FROM import_shipment_items
        WHERE shipment_id = ${shipment.id}
        FOR UPDATE
      `;

      const settings = await tx.importSetting.findUnique({ where: { companyId } });
      const gate = await assertCustomsGate(shipment, settings, {
        earlyReceiveReason: data.earlyReceiveReason,
      });
      await assertOriginalBl(shipment, settings);

      const receiptDate = data.receiptDate ? new Date(data.receiptDate) : new Date();
      assertReceiptDate(receiptDate, shipment, gate.customs, { isBonded: gate.isBonded });

      let locationId = data.locationId || settings?.defaultReceivingLocationId || null;
      let warehouseName = data.warehouseName || '';
      if (locationId) {
        const loc = await assertLocationBelongsToActiveCompany(locationId, companyId);
        warehouseName = loc.name || warehouseName;
      }

      if (shouldPost && !locationId) {
        throw grnError(
          'Warehouse/location is required to post Import GRN stock',
          'WAREHOUSE_REQUIRED'
        );
      }

      const receivedBy = String(data.receivedBy || '').trim();
      if (shouldPost && !receivedBy) {
        throw grnError('Received-by is required when posting a GRN', 'RECEIVED_BY_REQUIRED');
      }

      const importPo = shipment.importPo;
      const posted = await sumPostedProcessedForShipment(tx, {
        companyId,
        shipmentId: shipment.id,
      });

      const incoming = Array.isArray(data.items) ? data.items : [];
      if (!incoming.length) {
        throw grnError('At least one receiving line is required', 'ITEMS_REQUIRED');
      }

      const customsRate = toNumber(gate.customs?.exchangeRateToUsd, 1) || 1;
      const itemsData = [];

      // Prefer shipment items; if empty, synthesize from PO lines
      let shipItems = shipment.items || [];
      if (!shipItems.length && importPo?.items?.length) {
        shipItems = importPo.items.map((pi) => ({
          id: null,
          importPoItemId: pi.id,
          productId: pi.productId,
          productName: pi.productName,
          sku: pi.sku,
          quantity: pi.quantity,
          uom: pi.uom,
        }));
      }

      for (const it of incoming) {
        const shipLine = shipItems.find(
          (s) =>
            (it.shipmentItemId && s.id === it.shipmentItemId) ||
            (it.importPoItemId && s.importPoItemId === it.importPoItemId) ||
            (it.productId && s.productId === it.productId)
        );
        if (!shipLine) {
          throw grnError(
            `Receiving line does not match shipment items (${it.productName || it.productId || it.shipmentItemId})`,
            'SHIPMENT_LINE_MISMATCH'
          );
        }

        const poLine =
          importPo?.items?.find((p) => p.id === (it.importPoItemId || shipLine.importPoItemId)) ||
          null;
        const productId = shipLine.productId || poLine?.productId || it.productId || null;
        if (!productId) {
          throw grnError(
            `Shipment line "${shipLine.productName}" has no productId`,
            'PRODUCT_REQUIRED'
          );
        }

        const shipped = toNumber(shipLine.quantity, 0);
        if (!(shipped > 0)) {
          throw grnError(
            `Shipment line "${shipLine.productName}" has invalid shipped quantity`,
            'INVALID_SHIPPED_QTY'
          );
        }

        const already =
          (shipLine.id && posted.byShipmentItemId[shipLine.id]) ||
          (shipLine.importPoItemId && posted.byPoItemId[shipLine.importPoItemId]) ||
          (shipLine.productId && posted.byProductId[shipLine.productId]) ||
          0;

        const { accepted, shortQty, damagedQty, rejectedQty } = parseLineQtys(it);
        const processed = accepted + shortQty + damagedQty + rejectedQty;

        if (!(processed > 0)) {
          throw grnError(
            `Enter good / short / damaged / rejected quantity for ${shipLine.productName}`,
            'INVALID_QTY'
          );
        }

        // Optional explicit batch total from client (received + short + damaged + rejected)
        const batchTotal = toNumber(it.batchQty, 0);
        if (batchTotal > 0 && Math.abs(batchTotal - processed) > 1e-6) {
          throw grnError(
            `For ${shipLine.productName}: good + short + damaged + rejected must equal the quantity being processed (${batchTotal} vs ${processed})`,
            'QTY_BALANCE'
          );
        }

        const { remaining } = validateReceiveQty({
          orderedQty: shipped,
          alreadyReceivedQty: already,
          receiveQty: processed,
          allowOverReceive: false,
          requirePositive: true,
        });

        if (shortQty > 0 && !String(it.shortReason || '').trim()) {
          throw grnError(
            `Short reason is required for ${shipLine.productName}`,
            'CLAIM_REASON_REQUIRED'
          );
        }
        if (damagedQty > 0 && !String(it.damagedReason || '').trim()) {
          throw grnError(
            `Damaged reason is required for ${shipLine.productName}`,
            'CLAIM_REASON_REQUIRED'
          );
        }
        if (rejectedQty > 0 && !String(it.rejectedReason || '').trim()) {
          throw grnError(
            `Rejected reason is required for ${shipLine.productName}`,
            'CLAIM_REASON_REQUIRED'
          );
        }

        const unitPrice = poLine ? toNumber(poLine.unitPrice, 0) : toNumber(it.unitPrice, 0);
        const unitCostProvisional = Math.round(unitPrice * customsRate * 10000) / 10000;

        itemsData.push({
          shipmentItemId: shipLine.id || null,
          importPoItemId: shipLine.importPoItemId || poLine?.id || null,
          productId,
          productName: shipLine.productName,
          sku: shipLine.sku || poLine?.sku || null,
          orderedQty: poLine ? toNumber(poLine.quantity, 0) : shipped,
          shippedQty: shipped,
          previouslyReceivedQty: already,
          remainingQty: remaining,
          receivedQty: accepted,
          acceptedQty: accepted,
          shortQty,
          damagedQty,
          rejectedQty,
          shortReason: shortQty > 0 ? String(it.shortReason).trim() : null,
          damagedReason: damagedQty > 0 ? String(it.damagedReason).trim() : null,
          rejectedReason: rejectedQty > 0 ? String(it.rejectedReason).trim() : null,
          unitCostProvisional,
          costStatus: 'Provisional',
          stockDisposition: gate.isBonded ? 'Bonded' : 'Sellable',
          uom: shipLine.uom || poLine?.uom || it.uom || 'PCS',
          lotNumber: it.lotNumber || null,
        });
      }

      const count = await tx.importGrn.count({ where: { companyId } });
      const year = new Date().getFullYear();
      const grnNumber = data.grnNumber || `IGRN-${year}-${String(count + 1).padStart(3, '0')}`;

      const initialStatus = shouldPost ? 'Posted' : 'Draft';

      let grn;
      try {
        grn = await tx.importGrn.create({
          data: {
            companyId,
            grnNumber,
            importPoId: shipment.importPoId || null,
            poRef: shipment.poRef || importPo?.poNumber || null,
            shipmentId: shipment.id,
            shipmentRef: shipment.shipmentNumber,
            customsClearanceId: gate.customs?.id || null,
            customsRef: gate.customs?.entryNumber || null,
            boeNumber: gate.customs?.billOfEntryNo || null,
            locationId,
            warehouseName: warehouseName || null,
            receiptDate,
            containerNo: data.containerNo || shipment.containerNo || null,
            sealIntact: data.sealIntact !== false,
            receivedBy: receivedBy || req.user.firstName || null,
            status: initialStatus,
            idempotencyKey,
            notes: data.notes || null,
            isLegacy: false,
            isBonded: gate.isBonded,
            earlyReceiveReason: gate.early ? String(data.earlyReceiveReason || '').trim() : null,
            costStatus: 'Provisional',
            createdBy: userId,
            items: { create: itemsData },
          },
          include: { items: true, location: true },
        });
      } catch (e) {
        if (e.code === 'P2002' && idempotencyKey) {
          const again = await tx.importGrn.findFirst({
            where: { companyId, idempotencyKey },
            include: { items: true, location: true, shipment: true, customsClearance: true },
          });
          if (again) return enrichGrn(again);
        }
        throw e;
      }

      // Create claims for short/damaged/rejected
      for (const item of grn.items) {
        await createClaimsForLine(tx, {
          companyId,
          userId,
          grn,
          grnItem: item,
          shortQty: toNumber(item.shortQty, 0),
          shortReason: item.shortReason,
          damagedQty: toNumber(item.damagedQty, 0),
          damagedReason: item.damagedReason,
          rejectedQty: toNumber(item.rejectedQty, 0),
          rejectedReason: item.rejectedReason,
        });
      }

      if (shouldPost) {
        if (settings?.requireSeparateGrnPoster !== false && grn.createdBy === userId) {
          // Creating and posting in same request by same user — SoD blocks post;
          // save as Draft instead? Spec says setting ON means creator cannot post.
          // For confirmNow with SoD: reject entirely so UI must create draft then other posts.
          throw grnError(
            'GRN must be posted by a user different from its creator. Save as Draft first, then have another user post it.',
            'SOD_GRN_POSTER',
            403
          );
        }

        await postGrnStock(tx, {
          companyId,
          userId,
          grn,
          locationId,
          importPo,
          isBonded: gate.isBonded,
          customsRate,
        });

        const shipFull = await tx.importShipment.findFirst({
          where: { id: shipment.id },
          include: { items: true },
        });
        await syncShipmentAndPoStatus(tx, {
          companyId,
          shipment: shipFull,
          importPo,
        });

        grn = await tx.importGrn.update({
          where: { id: grn.id },
          data: {
            stockPostedAt: new Date(),
            postedAt: new Date(),
            postedBy: userId,
            status: 'Posted',
          },
          include: {
            items: true,
            location: true,
            shipment: true,
            customsClearance: true,
            supplierClaims: true,
          },
        });
      } else {
        grn = await tx.importGrn.findUnique({
          where: { id: grn.id },
          include: {
            items: true,
            location: true,
            shipment: true,
            customsClearance: true,
            supplierClaims: true,
          },
        });
      }

      await logImportAudit({
        companyId,
        action: shouldPost ? 'POST' : 'CREATE',
        entityType: 'IMPORT_GRN',
        entityId: grn.id,
        details: {
          grnNumber,
          from: null,
          to: grn.status,
          shipmentId: shipment.id,
          isBonded: gate.isBonded,
          reason: data.earlyReceiveReason || null,
        },
        userId,
      });

      return enrichGrn(grn);
    },
    { maxWait: 15_000, timeout: 60_000 }
  );
}

async function postGrn(req, id) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;

  return prisma.$transaction(
    async (tx) => {
      const grn = await tx.importGrn.findFirst({
        where: { id, companyId },
        include: {
          items: true,
          shipment: { include: { items: true, customsClearances: true } },
          importPo: { include: { items: true } },
          customsClearance: true,
        },
      });
      if (!grn) throw grnError('Import GRN not found', 'NOT_FOUND', 404);
      if (IMPORT_GRN_POSTED_STATUSES.includes(grn.status) && grn.stockPostedAt) {
        throw grnError('GRN is already posted', 'ALREADY_POSTED', 409);
      }
      if (grn.status === 'Cancelled') {
        throw grnError('Cancelled GRN cannot be posted', 'CANCELLED');
      }

      const settings = await tx.importSetting.findUnique({ where: { companyId } });
      if (settings?.requireSeparateGrnPoster !== false && grn.createdBy && grn.createdBy === userId) {
        throw grnError(
          'GRN must be posted by a user different from its creator',
          'SOD_GRN_POSTER',
          403
        );
      }

      if (!grn.locationId) {
        throw grnError('Warehouse/location is required to post', 'WAREHOUSE_REQUIRED');
      }
      if (!String(grn.receivedBy || '').trim()) {
        throw grnError('Received-by is required to post', 'RECEIVED_BY_REQUIRED');
      }

      const shipment = grn.shipment;
      if (!shipment) {
        throw grnError('Import goods must be received against a shipment', 'SHIPMENT_REQUIRED');
      }

      const gate = await assertCustomsGate(
        { ...shipment, customsClearances: shipment.customsClearances || (grn.customsClearance ? [grn.customsClearance] : []) },
        settings,
        { earlyReceiveReason: grn.earlyReceiveReason }
      );
      await assertOriginalBl(shipment, settings);
      assertReceiptDate(grn.receiptDate, shipment, gate.customs, {
        isBonded: grn.isBonded || gate.isBonded,
      });

      const customsRate = toNumber(gate.customs?.exchangeRateToUsd, 1) || 1;

      await postGrnStock(tx, {
        companyId,
        userId,
        grn,
        locationId: grn.locationId,
        importPo: grn.importPo,
        isBonded: grn.isBonded || gate.isBonded,
        customsRate,
      });

      await syncShipmentAndPoStatus(tx, {
        companyId,
        shipment,
        importPo: grn.importPo,
      });

      const updated = await tx.importGrn.update({
        where: { id: grn.id },
        data: {
          status: 'Posted',
          stockPostedAt: new Date(),
          postedAt: new Date(),
          postedBy: userId,
          isBonded: grn.isBonded || gate.isBonded,
        },
        include: {
          items: true,
          location: true,
          shipment: true,
          customsClearance: true,
          supplierClaims: true,
        },
      });

      await logImportAudit({
        companyId,
        action: 'POST',
        entityType: 'IMPORT_GRN',
        entityId: id,
        details: { from: grn.status, to: 'Posted', grnNumber: grn.grnNumber },
        userId,
      });

      return enrichGrn(updated);
    },
    { maxWait: 15_000, timeout: 60_000 }
  );
}

async function cancelGrn(req, id, data = {}) {
  const companyId = requireSingleCompany(req);
  const userId = req.user.id;
  const reason = String(data.reason || '').trim();
  if (!reason) throw grnError('Cancel reason is required', 'REASON_REQUIRED');

  return prisma.$transaction(async (tx) => {
    const grn = await tx.importGrn.findFirst({
      where: { id, companyId },
      include: { items: true },
    });
    if (!grn) throw grnError('Import GRN not found', 'NOT_FOUND', 404);
    if (grn.status === 'Cancelled') {
      throw grnError('GRN is already cancelled', 'ALREADY_CANCELLED');
    }

    if (grn.stockPostedAt) {
      // Check if stock has moved further (any non-GRN movement after post referencing product from this GRN is complex);
      // Simple rule: if any sales/issue movement exists for these products after stockPostedAt at same location with qty, block.
      for (const item of grn.items) {
        if (!item.productId || !(toNumber(item.acceptedQty, 0) > 0)) continue;
        const later = await tx.stockMovement.count({
          where: {
            companyId,
            productId: item.productId,
            locationId: grn.locationId || undefined,
            createdAt: { gt: grn.stockPostedAt },
            NOT: { reference: grn.grnNumber },
            movementType: { in: ['SALES_DELIVERY', 'TRANSFER_OUT', 'WRITE_OFF', 'ADJUSTMENT_OUT'] },
          },
        });
        if (later > 0) {
          throw grnError(
            `Cannot cancel: stock from ${grn.grnNumber} (${item.productName}) has already moved. Create a reversal instead.`,
            'STOCK_MOVED'
          );
        }
      }

      // Reverse stock for accepted qty
      for (const item of grn.items) {
        const qty = toNumber(item.acceptedQty || item.receivedQty, 0);
        if (!(qty > 0) || !item.productId) continue;
        const adj = await adjustLocationStock(tx, {
          companyId,
          productId: item.productId,
          locationId: grn.locationId || null,
          delta: -qty,
          productName: item.productName,
        });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            productName: item.productName,
            type: 'Goods Receiving Reversal',
            movementType: 'PURCHASE_RECEIPT_REVERSAL',
            quantity: -qty,
            previousStock: adj.previousLocationStock ?? adj.previousCompanyStock ?? 0,
            newStock: adj.newLocationStock ?? adj.newCompanyStock ?? 0,
            reason: `Cancel Import GRN #${grn.grnNumber}: ${reason}`,
            reference: `${grn.grnNumber}-REV`,
            status: 'Completed',
            createdBy: userId,
            companyId,
            locationId: grn.locationId || null,
            movementDate: new Date(),
          },
        });
      }
    }

    const updated = await tx.importGrn.update({
      where: { id },
      data: {
        status: 'Cancelled',
        cancelledAt: new Date(),
        cancelReason: reason,
      },
      include: { items: true, shipment: true, customsClearance: true, supplierClaims: true },
    });

    await tx.importSupplierClaim.updateMany({
      where: { importGrnId: id, status: 'Open' },
      data: { status: 'Cancelled' },
    });

    await logImportAudit({
      companyId,
      action: 'CANCEL',
      entityType: 'IMPORT_GRN',
      entityId: id,
      details: { from: grn.status, to: 'Cancelled', reason },
      userId,
    });

    return enrichGrn(updated);
  });
}

/**
 * After landed cost post — mark GRN lines Final and update unitCostFinal.
 * Called from landed cost post path; safe no-op if no grnId.
 */
async function applyLandedCostToGrn(tx, { companyId, grnId, items }) {
  if (!grnId) return;
  const grn = await tx.importGrn.findFirst({
    where: { id: grnId, companyId },
    include: { items: true },
  });
  if (!grn) return;

  for (const alloc of items || []) {
    const line = (grn.items || []).find(
      (i) =>
        (alloc.productId && i.productId === alloc.productId) ||
        (alloc.productName && i.productName === alloc.productName)
    );
    if (!line) continue;
    await tx.importGrnItem.update({
      where: { id: line.id },
      data: {
        unitCostFinal: toNumber(alloc.finalLandedCostPerUnitUsd, 0),
        costStatus: 'Final',
      },
    });
  }

  await tx.importGrn.update({
    where: { id: grnId },
    data: { costStatus: 'Final' },
  });
}

module.exports = {
  toNumber,
  validateReceiveQty,
  serializePoItemForReceiving,
  sumPostedAcceptedForPo,
  sumPostedProcessedForShipment,
  IMPORT_GRN_POSTED_STATUSES,
  CUSTOMS_RELEASED_STATUSES,
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
  applyLandedCostToGrn,
  isCustomsReleased,
  isBlOriginal,
};
