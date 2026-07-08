const prisma = require('../../prisma/client');

function generatePurchaseNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PO-${y}${m}${day}-${random}`;
}

class WarehousePurchaseModel {
  static async create(data) {
    const purchaseNumber = generatePurchaseNumber();
    return prisma.$transaction(async (tx) => {
      const purchase = await tx.warehousePurchase.create({
        data: {
          purchaseNumber,
          purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : new Date(),
          expectedDeliveryDate: data.expectedDeliveryDate ? new Date(data.expectedDeliveryDate) : null,
          supplierId: data.supplierId,
          supplierName: data.supplierName,
          subtotal: data.subtotal,
          taxTotal: data.taxTotal || 0,
          discountTotal: data.discountTotal || 0,
          grandTotal: data.grandTotal,
          purchaseStatus: data.purchaseStatus || 'Draft',
          paymentStatus: data.paymentStatus || 'Unpaid',
          paymentMethod: data.paymentMethod || null,
          paymentReference: data.paymentReference || null,
          reference: data.reference || '',
          notes: data.notes || '',
          internalNotes: data.internalNotes || '',
          createdBy: data.createdBy,
        },
      });

      for (const item of data.items || []) {
        await tx.warehousePurchaseItem.create({
          data: {
            purchaseId: purchase.id,
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            receivedQty: 0,
            unitCost: item.unitCost,
            taxRate: item.taxRate || 0,
            taxAmount: item.taxAmount || 0,
            totalCost: item.totalCost,
            notes: item.notes || '',
          },
        });
      }

      return tx.warehousePurchase.findUnique({
        where: { id: purchase.id },
        include: {
          items: true,
          supplier: true,
          creator: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
    });
  }

  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { purchaseDate: 'desc' } } = options;
    return prisma.warehousePurchase.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        items: true,
        supplier: { select: { id: true, name: true, companyName: true } },
        creator: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  static async count(filter = {}) {
    return prisma.warehousePurchase.count({ where: filter });
  }

  static async findById(id) {
    return prisma.warehousePurchase.findUnique({
      where: { id },
      include: {
        items: true,
        supplier: true,
        stockMovements: true,
        creator: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  static async update(id, data) {
    return prisma.warehousePurchase.update({
      where: { id },
      data,
      include: { items: true },
    });
  }

  static async softDelete(id, userId) {
    return prisma.warehousePurchase.update({
      where: { id },
      data: { isActive: false, isDeleted: true, updatedBy: userId, purchaseStatus: 'Cancelled' },
    });
  }

  static async receiveGoods(id, receiveItems, userId) {
    return prisma.$transaction(async (tx) => {
      const purchase = await tx.warehousePurchase.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!purchase) throw new Error('Purchase not found');
      if (purchase.purchaseStatus === 'Cancelled') throw new Error('Cannot receive cancelled PO');

      let allReceived = true;
      for (const recv of receiveItems) {
        const line = purchase.items.find((i) => i.id === recv.itemId || i.productId === recv.productId);
        if (!line) continue;

        const qty = parseInt(recv.quantity) || 0;
        if (qty <= 0) continue;
        const remaining = line.quantity - line.receivedQty;
        if (qty > remaining) throw new Error(`Receive qty exceeds remaining for ${line.productName}`);

        const product = await tx.product.findUnique({ where: { id: line.productId } });
        if (!product) throw new Error(`Product not found: ${line.productName}`);

        const previousStock = product.currentStock;
        const newStock = previousStock + qty;

        await tx.product.update({
          where: { id: line.productId },
          data: {
            currentStock: newStock,
            availableStock: newStock,
            costPrice: line.unitCost,
            totalValue: newStock * line.unitCost,
          },
        });

        await tx.stockMovement.create({
          data: {
            productId: line.productId,
            productName: line.productName,
            type: 'stock_in',
            quantity: qty,
            previousStock,
            newStock,
            stockType: 'bulk',
            stockDetails: { type: 'bulk', quantityAdded: qty, purchaseNumber: purchase.purchaseNumber },
            reason: 'Purchase Order',
            supplierId: purchase.supplierId,
            supplierName: purchase.supplierName,
            reference: purchase.purchaseNumber,
            purchaseId: purchase.id,
            notes: recv.notes || purchase.reference || '',
            createdBy: userId,
          },
        });

        const newReceived = line.receivedQty + qty;
        await tx.warehousePurchaseItem.update({
          where: { id: line.id },
          data: { receivedQty: newReceived },
        });
        if (newReceived < line.quantity) allReceived = false;
      }

      const updatedItems = await tx.warehousePurchaseItem.findMany({ where: { purchaseId: id } });
      allReceived = updatedItems.every((i) => i.receivedQty >= i.quantity);

      return tx.warehousePurchase.update({
        where: { id },
        data: {
          purchaseStatus: allReceived ? 'Received' : 'PartiallyReceived',
          receivedDate: allReceived ? new Date() : purchase.receivedDate,
          updatedBy: userId,
        },
        include: { items: true, stockMovements: true },
      });
    });
  }

  static async getStats(period = 'month') {
    const now = new Date();
    let dateFilter = {};
    if (period === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      dateFilter = { purchaseDate: { gte: start } };
    } else if (period === 'week') {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      dateFilter = { purchaseDate: { gte: start } };
    } else if (period === 'month') {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      dateFilter = { purchaseDate: { gte: start } };
    }

    const base = { isActive: true, isDeleted: false, ...dateFilter };
    const [total, draft, ordered, partial, received, cancelled] = await Promise.all([
      prisma.warehousePurchase.count({ where: base }),
      prisma.warehousePurchase.count({ where: { ...base, purchaseStatus: 'Draft' } }),
      prisma.warehousePurchase.count({ where: { ...base, purchaseStatus: 'Ordered' } }),
      prisma.warehousePurchase.count({ where: { ...base, purchaseStatus: 'PartiallyReceived' } }),
      prisma.warehousePurchase.count({ where: { ...base, purchaseStatus: 'Received' } }),
      prisma.warehousePurchase.count({ where: { ...base, purchaseStatus: 'Cancelled' } }),
    ]);

    const financial = await prisma.warehousePurchase.aggregate({
      where: base,
      _sum: { grandTotal: true, taxTotal: true },
    });

    const unpaid = await prisma.warehousePurchase.count({
      where: { ...base, paymentStatus: { in: ['Unpaid', 'Partial'] } },
    });

    return {
      total,
      draft,
      ordered,
      partial,
      received,
      cancelled,
      unpaid,
      grandTotal: financial._sum.grandTotal || 0,
      taxTotal: financial._sum.taxTotal || 0,
    };
  }

  static async getDailyTrend(days = 30) {
    const start = new Date();
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);

    const purchases = await prisma.warehousePurchase.findMany({
      where: {
        isActive: true,
        isDeleted: false,
        purchaseDate: { gte: start },
        purchaseStatus: { not: 'Cancelled' },
      },
      select: { purchaseDate: true, grandTotal: true },
      orderBy: { purchaseDate: 'asc' },
    });

    const map = {};
    purchases.forEach((p) => {
      const key = p.purchaseDate.toISOString().split('T')[0];
      if (!map[key]) map[key] = { date: key, spend: 0, count: 0 };
      map[key].spend += p.grandTotal;
      map[key].count += 1;
    });
    return Object.values(map);
  }
}

module.exports = WarehousePurchaseModel;
