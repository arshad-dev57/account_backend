// models/WarehouseInvoice.js - COMPLETE FIXED VERSION (No Draft)

const prisma = require('../../prisma/client');

function generateInvoiceNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `WINV-${y}${m}${day}-${random}`;
}

class WarehouseInvoiceModel {
  static async create(data) {
    const invoiceNumber = generateInvoiceNumber();
    return prisma.$transaction(async (tx) => {
      // ✅ FIXED: invoiceStatus always 'Unpaid' (no Draft)
      const invoice = await tx.warehouseInvoice.create({
        data: {
          invoiceNumber,
          invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : new Date(),
          dueDate: new Date(data.dueDate),
          orderId: data.orderId || null,
          orderNumber: data.orderNumber || null,
          customerId: data.customerId || null,
          customerName: data.customerName,
          customerEmail: data.customerEmail || null,
          customerPhone: data.customerPhone || null,
          billingAddress: data.billingAddress || null,
          subtotal: data.subtotal,
          taxTotal: data.taxTotal || 0,
          discountTotal: data.discountTotal || 0,
          grandTotal: data.grandTotal,
          invoiceStatus: 'Unpaid',  // ✅ FIXED: Always 'Unpaid'
          paymentStatus: 'Unpaid',   // ✅ FIXED: Always 'Unpaid'
          paidAmount: 0,
          notes: data.notes || '',
          createdBy: data.createdBy,
        },
        include: { items: true, creator: { select: { id: true, firstName: true, lastName: true, email: true } } },
      });

      for (const item of data.items || []) {
        await tx.warehouseInvoiceItem.create({
          data: {
            invoiceId: invoice.id,
            productId: item.productId || null,
            productName: item.productName,
            sku: item.sku || '',
            description: item.description || item.productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate || 0,
            taxAmount: item.taxAmount || 0,
            discount: item.discount || 0,
            totalPrice: item.totalPrice,
          },
        });
      }

      return tx.warehouseInvoice.findUnique({
        where: { id: invoice.id },
        include: {
          items: true,
          order: { select: { id: true, orderNumber: true, grandTotal: true } },
          customer: { select: { id: true, name: true, email: true } },
          creator: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
    });
  }

  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { invoiceDate: 'desc' } } = options;
    return prisma.warehouseInvoice.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        items: true,
        creator: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  static async count(filter = {}) {
    return prisma.warehouseInvoice.count({ where: filter });
  }

  static async findById(id) {
    return prisma.warehouseInvoice.findUnique({
      where: { id },
      include: {
        items: true,
        order: true,
        customer: true,
        creator: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  static async update(id, data) {
    return prisma.warehouseInvoice.update({
      where: { id },
      data,
      include: { items: true },
    });
  }

  static async softDelete(id, userId) {
    return prisma.warehouseInvoice.update({
      where: { id },
      data: { isActive: false, isDeleted: true, updatedBy: userId },
    });
  }

  // ✅ FIXED: getStats - Removed 'Draft' and 'Sent'
  static async getStats(period = 'month') {
    const now = new Date();
    let dateFilter = {};
    if (period === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      dateFilter = { invoiceDate: { gte: start } };
    } else if (period === 'week') {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      dateFilter = { invoiceDate: { gte: start } };
    } else if (period === 'month') {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      dateFilter = { invoiceDate: { gte: start } };
    }

    const base = { isActive: true, isDeleted: false, ...dateFilter };
    
    // ✅ FIXED: Only Unpaid, Partial, Paid, Overdue, Cancelled
    const [total, unpaid, partial, paid, overdue, cancelled] = await Promise.all([
      prisma.warehouseInvoice.count({ where: base }),
      prisma.warehouseInvoice.count({ where: { ...base, invoiceStatus: 'Unpaid' } }),
      prisma.warehouseInvoice.count({ where: { ...base, invoiceStatus: 'Partial' } }),
      prisma.warehouseInvoice.count({ where: { ...base, invoiceStatus: 'Paid' } }),
      prisma.warehouseInvoice.count({ where: { ...base, invoiceStatus: 'Overdue' } }),
      prisma.warehouseInvoice.count({ where: { ...base, invoiceStatus: 'Cancelled' } }),
    ]);

    const financial = await prisma.warehouseInvoice.aggregate({
      where: { ...base, invoiceStatus: { not: 'Cancelled' } },
      _sum: { grandTotal: true, paidAmount: true, taxTotal: true },
    });

    const grandTotal = financial._sum.grandTotal || 0;
    const paidAmount = financial._sum.paidAmount || 0;

    return {
      total,
      unpaid,
      partial,
      paid,
      overdue,
      cancelled,
      grandTotal,
      paidAmount,
      outstanding: grandTotal - paidAmount,
      taxTotal: financial._sum.taxTotal || 0,
    };
  }

  static async getDailyTrend(days = 30) {
    const start = new Date();
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);

    const invoices = await prisma.warehouseInvoice.findMany({
      where: {
        isActive: true,
        isDeleted: false,
        invoiceDate: { gte: start },
        invoiceStatus: { not: 'Cancelled' },
      },
      select: { invoiceDate: true, grandTotal: true, paidAmount: true },
      orderBy: { invoiceDate: 'asc' },
    });

    const map = {};
    invoices.forEach((inv) => {
      const key = inv.invoiceDate.toISOString().split('T')[0];
      if (!map[key]) map[key] = { date: key, revenue: 0, collected: 0, count: 0 };
      map[key].revenue += inv.grandTotal;
      map[key].collected += inv.paidAmount;
      map[key].count += 1;
    });
    return Object.values(map);
  }
}

module.exports = WarehouseInvoiceModel;