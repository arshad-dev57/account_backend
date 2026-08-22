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
    userId
  );

  for (const item of invoice.items || []) {
    if (!item.productId) continue;
    const invoicedQty = Math.round(Number(item.quantity) || 0);
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

module.exports = {
  getConfirmedDeliveredQty,
  getIssuedByInvoiceQty,
  applySalesInvoiceStockOut,
};
