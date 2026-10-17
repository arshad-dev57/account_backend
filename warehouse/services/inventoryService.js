const {
  resolveLocationId,
  adjustLocationStock,
} = require('./locationService');

async function getConfirmedDeliveredQty(tx, { orderId, productId }) {
  if (!orderId || !productId) return 0;
  const deliveries = await tx.delivery.findMany({
    where: {
      salesOrderId: orderId,
      isDeleted: false,
      OR: [
        { confirmedAt: { not: null } },
        { deliveryStatus: 'Delivered' },
      ],
    },
    include: { items: true },
  });
  let qty = 0;
  for (const delivery of deliveries) {
    for (const item of delivery.items || []) {
      if (item.productId === productId) {
        qty += Number(item.deliveredQuantity) || 0;
      }
    }
  }
  return qty;
}

async function getIssuedByInvoiceQty(tx, { companyId, productId, orderId }) {
  if (!orderId || !productId) return 0;
  const invoices = await tx.salesInvoice.findMany({
    where: {
      orderId,
      companyId,
      invoiceStatus: { not: 'Cancelled' },
    },
    select: { invoiceNumber: true },
  });
  const refs = invoices.map((inv) => inv.invoiceNumber).filter(Boolean);
  if (!refs.length) return 0;

  const movements = await tx.stockMovement.findMany({
    where: {
      companyId,
      productId,
      reference: { in: refs },
      type: { in: ['stock_out', 'Sales Invoice'] },
    },
    select: { quantity: true },
  });
  return movements.reduce((sum, row) => sum + Math.abs(Number(row.quantity) || 0), 0);
}

/**
 * Physical stock-out for posted sales invoices.
 * Skips qty already issued by a confirmed delivery on the same order.
 */
async function applySalesInvoiceStockOut(tx, { invoice, userId }) {
  const alreadyMoved = await tx.stockMovement.count({
    where: {
      companyId: invoice.companyId,
      reference: invoice.invoiceNumber,
      type: { in: ['stock_out', 'Sales Invoice'] },
    },
  });
  if (alreadyMoved > 0) return;

  let orderLocationId = null;
  if (invoice.orderId) {
    const order = await tx.order.findUnique({
      where: { id: invoice.orderId },
      select: { locationId: true },
    });
    orderLocationId = order?.locationId || null;
  }

  const locationId = await resolveLocationId(
    tx,
    invoice.companyId,
    invoice.locationId || orderLocationId,
    userId,
    { required: false }
  );

  for (const item of invoice.items || []) {
    if (!item.productId) continue;
    const invoicedQty = Number(item.quantity) || 0;
    if (invoicedQty <= 0) continue;

    const deliveredQty = invoice.orderId
      ? await getConfirmedDeliveredQty(tx, {
          orderId: invoice.orderId,
          productId: item.productId,
        })
      : 0;
    const qtyToIssue = Math.max(0, invoicedQty - deliveredQty);
    if (qtyToIssue <= 0) continue;

    const fromOrder = Boolean(invoice.orderId);
    const adj = await adjustLocationStock(tx, {
      companyId: invoice.companyId,
      productId: item.productId,
      locationId,
      delta: -qtyToIssue,
      reservedDelta: fromOrder ? -qtyToIssue : 0,
      checkAvailable: !fromOrder,
      productName: item.productName,
    });

    await tx.stockMovement.create({
      data: {
        productId: item.productId,
        productName: item.productName,
        type: 'stock_out',
        quantity: qtyToIssue,
        previousStock: adj.previousLocationStock,
        newStock: adj.newLocationStock,
        reason: `Sales Invoice #${invoice.invoiceNumber}`,
        reference: invoice.invoiceNumber,
        status: 'Completed',
        createdBy: userId || invoice.createdBy || 'SYSTEM',
        companyId: invoice.companyId,
        locationId,
        customerName: invoice.customerName || null,
      },
    });
  }
}

/**
 * Reverse invoice stock-out movements exactly once (idempotent).
 * Restores on-hand qty for movements still tagged to this invoice reference.
 */
async function reverseSalesInvoiceStockOut(tx, { invoice, userId }) {
  const revMarker = `${invoice.invoiceNumber}-REV`;
  const already = await tx.stockMovement.count({
    where: {
      companyId: invoice.companyId,
      reference: revMarker,
      type: { in: ['stock_in', 'Sales Invoice Reversal'] },
    },
  });
  if (already > 0) return { reversed: 0, skipped: true };

  const outs = await tx.stockMovement.findMany({
    where: {
      companyId: invoice.companyId,
      reference: invoice.invoiceNumber,
      type: { in: ['stock_out', 'Sales Invoice'] },
      status: 'Completed',
    },
  });
  if (!outs.length) return { reversed: 0, skipped: false };

  let reversed = 0;
  for (const mov of outs) {
    const qty = Math.abs(Number(mov.quantity) || 0);
    if (!(qty > 0) || !mov.productId) continue;

    const adj = await adjustLocationStock(tx, {
      companyId: invoice.companyId,
      productId: mov.productId,
      locationId: mov.locationId || null,
      delta: qty,
      reservedDelta: 0,
      checkAvailable: false,
      productName: mov.productName,
    });

    await tx.stockMovement.create({
      data: {
        productId: mov.productId,
        productName: mov.productName,
        type: 'stock_in',
        quantity: qty,
        previousStock: adj.previousLocationStock,
        newStock: adj.newLocationStock,
        reason: `Reversal of Sales Invoice #${invoice.invoiceNumber}`,
        reference: revMarker,
        status: 'Completed',
        createdBy: userId || invoice.createdBy || 'SYSTEM',
        companyId: invoice.companyId,
        locationId: mov.locationId || null,
        customerName: invoice.customerName || null,
      },
    });
    reversed += 1;
  }
  return { reversed, skipped: false };
}

module.exports = {
  getConfirmedDeliveredQty,
  getIssuedByInvoiceQty,
  applySalesInvoiceStockOut,
  reverseSalesInvoiceStockOut,
};
