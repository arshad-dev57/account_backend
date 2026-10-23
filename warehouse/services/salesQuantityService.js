/**
 * Shared sales quantity helpers for partial fulfillment across:
 * Quotation → Order → Delivery → Invoice → Payment → Return → Refund
 *
 * All qty maps are keyed by productId → number.
 */
const prisma = require('../../prisma/client');
const ACTIVE_INVOICE_STATUSES = ['Draft', 'Posted', 'Sent', 'Partially Paid', 'Paid', 'Overdue'];
const ACTIVE_RETURN_STATUSES = ['Pending', 'Approved', 'Completed', 'Processing'];
const ACTIVE_REFUND_STATUSES = ['Pending', 'Processing', 'Completed', 'Approved'];
function addQty(map, productId, qty) {
  if (!productId) return;
  const n = Number(qty) || 0;
  if (n === 0) return;
  map[productId] = (map[productId] || 0) + n;
}

function parseLinkedIds(notes, marker) {
  if (!notes || typeof notes !== 'string') return [];
  try {
    const re = new RegExp(`${marker}:(\\[.*?\\])`);
    const match = notes.match(re);
    if (!match) return [];
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}
/**
 * Confirmed (stock-issued) delivered qty per product for an order.
 * Counts deliveries with confirmedAt OR deliveryStatus === 'Delivered'.
 * Also attributes multi-order delivery lines via __ORDER_ID__ notes.
 */
async function getDeliveredQtyByProduct(orderId, { tx = prisma, includePending = false } = {}) {
  const map = {};
  if (!orderId) return map;
  const deliveries = await tx.delivery.findMany({
    where: {
      isActive: true,
      isDeleted: false,
      ...(includePending
        ? {}
        : {
            OR: [
              { confirmedAt: { not: null } },
              { deliveryStatus: 'Delivered' },
            ],
          }),
    },
    include: { items: true },
  });

  for (const d of deliveries) {
    const linked = parseLinkedIds(d.notes, '__LINKED_ORDERS__');
    for (const item of d.items || []) {
      let lineOrderId = d.salesOrderId;
      if (item.notes) {
        const m = String(item.notes).match(/__ORDER_ID__:([a-zA-Z0-9_-]+)/);
        if (m) lineOrderId = m[1];
      }

      const hasExplicitLineOrder = item.notes && /__ORDER_ID__:/.test(String(item.notes));
      const belongs = hasExplicitLineOrder
        ? lineOrderId === orderId
        : lineOrderId === orderId || d.salesOrderId === orderId || linked.includes(orderId);

      if (!belongs) continue;
      addQty(map, item.productId, item.deliveredQuantity);
    }
  }

  return map;
}

/**
 * Reserved (pending + confirmed) delivery qty — used when creating new deliveries
 * so unconfirmed notes still hold quantity.
 */
async function getReservedDeliveredQtyByProduct(orderId, { tx = prisma } = {}) {
  return getDeliveredQtyByProduct(orderId, { tx, includePending: true });
}

/**
 * Collect all active invoices linked to an order (direct, via delivery, or multi-source notes).
 */
async function findInvoicesForOrder(orderId, { tx = prisma } = {}) {
  if (!orderId) return [];

  const byOrder = await tx.salesInvoice.findMany({
    where: {
      orderId,
      isActive: true,
      isDeleted: false,
      invoiceStatus: { in: ACTIVE_INVOICE_STATUSES },
    },
    include: { items: true },
  });

  const byDelivery = await tx.salesInvoice.findMany({
    where: {
      isActive: true,
      isDeleted: false,
      invoiceStatus: { in: ACTIVE_INVOICE_STATUSES },
      delivery: { salesOrderId: orderId },
      NOT: { orderId },
    },
    include: { items: true },
  });

  const linkedCandidates = await tx.salesInvoice.findMany({
    where: {
      isActive: true,
      isDeleted: false,
      invoiceStatus: { in: ACTIVE_INVOICE_STATUSES },
      notes: { contains: orderId },
    },
    include: { items: true },
  });

  const byLinked = linkedCandidates.filter((inv) => {
    const linked = parseLinkedIds(inv.notes, '__LINKED_ORDERS__');
    return linked.includes(orderId);
  });

  const seen = new Set();
  const merged = [];
  for (const inv of [...byOrder, ...byDelivery, ...byLinked]) {
    if (seen.has(inv.id)) continue;
    seen.add(inv.id);
    merged.push(inv);
  }
  return merged;
}

function resolveInvoiceLineOrderId(inv, item) {
  if (item?.notes) {
    const m = String(item.notes).match(/__ORDER_ID__:([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
  }
  const linked = parseLinkedIds(inv.notes, '__LINKED_ORDERS__');
  if (linked.length > 1) {
    // Multi-order invoice without per-line order tag — cannot safely attribute
    return null;
  }
  if (linked.length === 1) return linked[0];
  return inv.orderId || null;
}

async function getInvoicedQtyByProduct(orderId, { tx = prisma } = {}) {
  const map = {};
  if (!orderId) return map;
  const invoices = await findInvoicesForOrder(orderId, { tx });
  for (const inv of invoices) {
    const linked = parseLinkedIds(inv.notes, '__LINKED_ORDERS__');
    const isMulti = linked.length > 1;

    for (const item of inv.items || []) {
      const lineOrderId = resolveInvoiceLineOrderId(inv, item);

      if (lineOrderId) {
        if (lineOrderId !== orderId) continue;
        addQty(map, item.productId, item.quantity);
        continue;
      }

      // Legacy multi-order invoice without line tags: attribute via linked delivery items
      if (isMulti && inv.deliveryId) {
        const delivery = await tx.delivery.findUnique({
          where: { id: inv.deliveryId },
          include: { items: true },
        });
        if (delivery) {
          const dItem = (delivery.items || []).find((di) => di.productId === item.productId);
          let dOrderId = delivery.salesOrderId;
          if (dItem?.notes) {
            const m = String(dItem.notes).match(/__ORDER_ID__:([a-zA-Z0-9_-]+)/);
            if (m) dOrderId = m[1];
          }
          if (dOrderId !== orderId) continue;
          addQty(map, item.productId, item.quantity);
          continue;
        }
      }

      // Single-order / primary-only fallback
      if (!isMulti && (inv.orderId === orderId || linked.includes(orderId))) {
        addQty(map, item.productId, item.quantity);
      }
    }
  }
  return map;
}

/**
 * Invoiced qty attributed to a specific delivery.
 */
async function getInvoicedQtyForDelivery(deliveryId, { tx = prisma } = {}) {
  const map = {};
  if (!deliveryId) return map;

  const invoices = await tx.salesInvoice.findMany({
    where: {
      isActive: true,
      isDeleted: false,
      invoiceStatus: { in: ACTIVE_INVOICE_STATUSES },
      OR: [
        { deliveryId },
        { notes: { contains: deliveryId } },
      ],
    },
    include: { items: true },
  });

  for (const inv of invoices) {
    const linked = parseLinkedIds(inv.notes, '__LINKED_DELIVERIES__');
    const matches = inv.deliveryId === deliveryId || linked.includes(deliveryId);
    if (!matches) continue;
    for (const item of inv.items || []) {
      addQty(map, item.productId, item.quantity);
    }
  }
  return map;
}

async function getReturnedQtyByProduct(orderId, { tx = prisma } = {}) {
  const map = {};
  if (!orderId) return map;

  const returns = await tx.return.findMany({
    where: {
      orderId,
      isActive: true,
      isDeleted: false,
      returnStatus: { in: ACTIVE_RETURN_STATUSES },
      returnType: 'Sales Return',
    },
    include: { items: true },
  });

  for (const ret of returns) {
    for (const item of ret.items || []) {
      addQty(map, item.productId, item.returnQuantity);
    }
  }
  return map;
}

async function getRefundedAmountForReturn(returnId, { tx = prisma } = {}) {
  if (!returnId) return 0;
  const refunds = await tx.refund.findMany({
    where: {
      returnId,
      isActive: true,
      isDeleted: false,
      refundStatus: { in: ACTIVE_REFUND_STATUSES },
    },
    select: { amount: true },
  });
  return refunds.reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

async function getRefundedAmountForOrder(orderId, { tx = prisma } = {}) {
  if (!orderId) return 0;
  const refunds = await tx.refund.findMany({
    where: {
      orderId,
      isActive: true,
      isDeleted: false,
      refundStatus: { in: ACTIVE_REFUND_STATUSES },
    },
    select: { amount: true },
  });
  return refunds.reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

/**
 * Build remaining-to-deliver lines for an order.
 * Uses reserved (pending+confirmed) qty so pending notes hold stock.
 */
function buildRemainingDeliveryLines(orderItems, reservedQtyMap) {
  return (orderItems || [])
    .map((item) => {
      const ordered = Number(item.quantity) || 0;
      const reserved = reservedQtyMap[item.productId] || 0;
      const remaining = Math.max(0, ordered - reserved);
      return {
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        orderedQuantity: ordered,
        deliveredQuantity: reserved,
        remainingQuantity: remaining,
        unitPrice: Number(item.unitPrice) || 0,
        discount: Number(item.discount) || 0,
        taxRate: Number(item.taxRate) || 0,
        unit: 'Pcs',
      };
    })
    .filter((i) => i.remainingQuantity > 0);
}

/**
 * Remaining to invoice for an order line.
 * Billable = confirmed delivered if any confirmed delivery exists, else ordered qty
 * (direct SO→Invoice / auto-delivery path). Cap at ordered - already invoiced.
 */
function remainingToInvoiceQty(orderedQty, deliveredQty, invoicedQty, hasConfirmedDeliveries) {
  const ordered = Number(orderedQty) || 0;
  const delivered = Number(deliveredQty) || 0;
  const invoiced = Number(invoicedQty) || 0;
  const billable = hasConfirmedDeliveries ? Math.min(ordered, delivered) : ordered;
  return Math.max(0, billable - invoiced);
}

/**
 * Full order remaining summary for invoicing UI/API.
 * @param {{ allowUndelivered?: boolean }} opts - when true (multi-source), remaining = ordered − invoiced
 */
async function getOrderInvoiceRemaining(order, { tx = prisma, allowUndelivered = false } = {}) {
  const orderId = order.id;
  const deliveredMap = await getDeliveredQtyByProduct(orderId, { tx, includePending: false });
  const invoicedMap = await getInvoicedQtyByProduct(orderId, { tx });
  const hasConfirmedDeliveries = Object.values(deliveredMap).some((q) => q > 0);

  const items = (order.items || [])
    .map((item) => {
      const ordered = Number(item.quantity) || 0;
      const delivered = deliveredMap[item.productId] || 0;
      const invoiced = invoicedMap[item.productId] || 0;
      const remaining = allowUndelivered
        ? Math.max(0, ordered - invoiced)
        : remainingToInvoiceQty(ordered, delivered, invoiced, hasConfirmedDeliveries);
      return {
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        quantity: remaining,
        orderedQuantity: ordered,
        deliveredQuantity: delivered,
        invoicedQuantity: invoiced,
        remainingQuantity: remaining,
        maxQuantity: remaining,
        unitPrice: Number(item.unitPrice) || 0,
        discount: Number(item.discount) || 0,
        taxRate: Number(item.taxRate) || 0,
        taxAmount: Number(item.taxAmount) || 0,
        totalPrice: Number(item.totalPrice) || 0,
      };
    })
    .filter((i) => i.remainingQuantity > 0);

  return {
    items,
    hasRemaining: items.length > 0,
    hasConfirmedDeliveries,
    deliveredMap,
    invoicedMap,
  };
}

async function getDeliveryInvoiceRemaining(delivery, { tx = prisma } = {}) {
  const invoicedMap = await getInvoicedQtyForDelivery(delivery.id, { tx });
  const orderItems = delivery.salesOrder?.items || [];

  // Cap delivery remaining by order-level invoiced qty (prevents order+delivery double-bill)
  const orderInvoicedCache = {};
  const resolveLineOrderId = (item) => {
    if (item?.notes) {
      const m = String(item.notes).match(/__ORDER_ID__:([a-zA-Z0-9_-]+)/);
      if (m) return m[1];
    }
    return delivery.salesOrderId || null;
  };

  const items = [];
  for (const item of delivery.items || []) {
    const delivered = Number(item.deliveredQuantity) || 0;
    const deliveryInvoiced = invoicedMap[item.productId] || 0;
    let remaining = Math.max(0, delivered - deliveryInvoiced);

    const lineOrderId = resolveLineOrderId(item);
    if (lineOrderId && remaining > 0) {
      if (!orderInvoicedCache[lineOrderId]) {
        orderInvoicedCache[lineOrderId] = await getInvoicedQtyByProduct(lineOrderId, { tx });
      }
      const orderInvoiced = orderInvoicedCache[lineOrderId][item.productId] || 0;
      const orderItem =
        orderItems.find((oi) => oi.productId === item.productId) ||
        (delivery.salesOrder?.items || []).find((oi) => oi.productId === item.productId);
      const ordered = orderItem ? Number(orderItem.quantity) || 0 : delivered;
      const orderRemaining = Math.max(0, ordered - orderInvoiced);
      remaining = Math.min(remaining, orderRemaining);
    }

    if (remaining <= 0) continue;

    const orderItem = orderItems.find((oi) => oi.productId === item.productId);
    const unitPrice =
      orderItem?.unitPrice != null
        ? Number(orderItem.unitPrice)
        : item.product?.sellingPrice != null
          ? Number(item.product.sellingPrice)
          : Number(item.unitPrice) || 0;

    items.push({
      id: item.id,
      productId: item.productId,
      productName: item.productName || item.product?.name || 'Product',
      sku: item.sku || item.product?.sku || '',
      unit: item.unit || 'Pcs',
      orderedQuantity: item.orderedQuantity || 0,
      deliveredQuantity: delivered,
      invoicedQuantity: deliveryInvoiced,
      quantity: remaining,
      remainingQuantity: remaining,
      maxQuantity: remaining,
      orderId: lineOrderId,
      unitPrice,
      discount: orderItem?.discount != null ? Number(orderItem.discount) : 0,
      taxRate: orderItem?.taxRate != null ? Number(orderItem.taxRate) : 0,
      notes: item.notes || null,
    });
  }

  return { items, hasRemaining: items.length > 0, invoicedMap };
}

/**
 * Quotation → order conversion tracking via order notes marker.
 */
const QUOTATION_MARKER = '__FROM_QUOTATION__:';

function quotationMarker(quotationId) {
  return `${QUOTATION_MARKER}${quotationId}`;
}

async function getConvertedQtyFromQuotation(quotationId, { tx = prisma } = {}) {
  const map = {};
  if (!quotationId) return map;

  const quotation = await tx.quotation.findUnique({
    where: { id: quotationId },
    select: { convertedOrderId: true, companyId: true },
  });

  const orders = await tx.order.findMany({
    where: {
      isActive: true,
      isDeleted: false,
      OR: [
        ...(quotation?.convertedOrderId ? [{ id: quotation.convertedOrderId }] : []),
        { internalNotes: { contains: quotationMarker(quotationId) } },
        { customerNotes: { contains: quotationMarker(quotationId) } },
      ],
    },
    include: { items: true },
  });

  for (const order of orders) {
    for (const item of order.items || []) {
      addQty(map, item.productId, item.quantity);
    }
  }
  return map;
}

function remainingQuotationLines(quotationItems, convertedMap) {
  return (quotationItems || [])
    .map((item) => {
      const ordered = Number(item.quantity) || 0;
      const converted = convertedMap[item.productId] || 0;
      const remaining = Math.max(0, ordered - converted);
      return {
        ...item,
        convertedQuantity: converted,
        remainingQuantity: remaining,
      };
    })
    .filter((i) => i.remainingQuantity > 0);
}

/**
 * Sync order fulfillmentStatus + orderStatus from confirmed deliveries / returns.
 */
async function syncOrderFulfillmentStatus(orderId, { tx = prisma, userId = null } = {}) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return null;

  const deliveredMap = await getDeliveredQtyByProduct(orderId, { tx, includePending: false });
  const returnedMap = await getReturnedQtyByProduct(orderId, { tx });

  let anyDelivered = false;
  let allDelivered = (order.items || []).length > 0;
  let anyReturned = false;
  let allReturned = (order.items || []).length > 0;

  for (const item of order.items || []) {
    const ordered = Number(item.quantity) || 0;
    const delivered = deliveredMap[item.productId] || 0;
    const returned = returnedMap[item.productId] || 0;
    if (delivered > 0) anyDelivered = true;
    if (delivered < ordered) allDelivered = false;
    if (returned > 0) anyReturned = true;
    if (returned < ordered) allReturned = false;
  }

  let orderStatus = order.orderStatus;
  let fulfillmentStatus = order.fulfillmentStatus || 'Not Started';

  if (allReturned && anyReturned) {
    orderStatus = 'Returned';
    fulfillmentStatus = 'Returned';
  } else if (anyReturned) {
    orderStatus = 'Partially Returned';
    fulfillmentStatus = allDelivered ? 'Delivered' : anyDelivered ? 'Partial' : 'Not Started';
  } else if (allDelivered && anyDelivered) {
    orderStatus = 'Delivered';
    fulfillmentStatus = 'Delivered';
  } else if (anyDelivered) {
    orderStatus = 'Partially Delivered';
    fulfillmentStatus = 'Partial';
  }

  // Don't downgrade Cancelled
  if (order.orderStatus === 'Cancelled') {
    return order;
  }

  return tx.order.update({
    where: { id: orderId },
    data: {
      orderStatus,
      fulfillmentStatus,
      ...(userId ? { updatedBy: userId } : {}),
    },
  });
}

module.exports = {
  ACTIVE_INVOICE_STATUSES,
  ACTIVE_RETURN_STATUSES,
  ACTIVE_REFUND_STATUSES,
  addQty,
  parseLinkedIds,
  getDeliveredQtyByProduct,
  getReservedDeliveredQtyByProduct,
  findInvoicesForOrder,
  resolveInvoiceLineOrderId,
  getInvoicedQtyByProduct,
  getInvoicedQtyForDelivery,
  getReturnedQtyByProduct,
  getRefundedAmountForReturn,
  getRefundedAmountForOrder,
  buildRemainingDeliveryLines,
  remainingToInvoiceQty,
  getOrderInvoiceRemaining,
  getDeliveryInvoiceRemaining,
  QUOTATION_MARKER,
  quotationMarker,
  getConvertedQtyFromQuotation,
  remainingQuotationLines,
  syncOrderFulfillmentStatus,
};
