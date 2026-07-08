// models/WarehouseInvoice.js - COMPLETE FIXED VERSION

const prisma = require('../prisma/client');

// ─── Generate Invoice Number ──────────────────────────────
function generateInvoiceNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `WINV-${year}${month}${day}-${random}`;
}

// ─── Determine Payment Status ─────────────────────────────
function getPaymentStatus(totalAmount, paidAmount, dueDate) {
  const outstanding = totalAmount - paidAmount;
  if (outstanding <= 0) return 'Paid';
  if (paidAmount > 0 && outstanding > 0) return 'Partial';
  if (new Date(dueDate) < new Date() && outstanding > 0) return 'Overdue';
  return 'Unpaid';
}

// ─── Get or Create Tax Liability Account ──────────
async function getOrCreateTaxLiabilityAccount(userId, tx) {
  let taxAccount = await tx.chartOfAccount.findFirst({
    where: {
      code: '2220',
      createdBy: userId
    }
  });

  if (!taxAccount) {
    taxAccount = await tx.chartOfAccount.create({
      data: {
        code: '2220',
        name: 'Sales Tax Payable',
        type: 'Liability',
        parentAccount: 'Current Liabilities',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Sales tax collected from customers',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId
      }
    });
  }
  return taxAccount;
}

// ─── Get or Create Revenue Account ────────────────
async function getOrCreateRevenueAccount(userId, tx) {
  let revenueAccount = await tx.chartOfAccount.findFirst({
    where: {
      code: '4010',
      createdBy: userId
    }
  });

  if (!revenueAccount) {
    revenueAccount = await tx.chartOfAccount.create({
      data: {
        code: '4010',
        name: 'Sales Revenue',
        type: 'Revenue',
        parentAccount: 'Operating Income',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Revenue from sales',
        taxCode: 'GST-13%',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId
      }
    });
  }
  return revenueAccount;
}

// ─── Get or Create Accounts Receivable Account ────
async function getOrCreateReceivableAccount(userId, tx) {
  let arAccount = await tx.chartOfAccount.findFirst({
    where: {
      code: '1110',
      createdBy: userId
    }
  });

  if (!arAccount) {
    arAccount = await tx.chartOfAccount.create({
      data: {
        code: '1110',
        name: 'Accounts Receivable',
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Amount due from customers',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId
      }
    });
  }
  return arAccount;
}

// ─── Reverse Journal Entry for Cancellation ───────
async function reverseJournalEntry(invoice, userId, tx) {
  const journalEntry = await tx.journalEntry.findFirst({
    where: {
      reference: invoice.id,
      description: { contains: 'Invoice' }
    },
    include: {
      lines: true
    }
  });

  if (!journalEntry) return null;

  const reversalEntry = await tx.journalEntry.create({
    data: {
      entryNumber: `REV-${Date.now()}`,
      date: new Date(),
      description: `Reverse invoice ${invoice.invoiceNumber}`,
      reference: `REV-${invoice.id}`,
      status: 'Posted',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      lines: {
        create: journalEntry.lines.map(line => ({
          accountId: line.accountId,
          accountName: line.accountName,
          accountCode: line.accountCode,
          debit: line.credit,
          credit: line.debit,
          isReconciled: false
        }))
      }
    }
  });

  const arLine = journalEntry.lines.find(line => 
    line.accountName === 'Accounts Receivable' || 
    line.accountCode === '1110'
  );
  if (arLine) {
    await tx.chartOfAccount.update({
      where: { id: arLine.accountId },
      data: { currentBalance: { decrement: arLine.debit } }
    });
  }

  const taxLine = journalEntry.lines.find(line => 
    line.accountName === 'Sales Tax Payable' || 
    line.accountCode === '2220'
  );
  if (taxLine) {
    await tx.chartOfAccount.update({
      where: { id: taxLine.accountId },
      data: { currentBalance: { decrement: taxLine.credit } }
    });
  }

  const revenueLine = journalEntry.lines.find(line => 
    line.accountName === 'Sales Revenue' || 
    line.accountCode === '4010'
  );
  if (revenueLine) {
    await tx.chartOfAccount.update({
      where: { id: revenueLine.accountId },
      data: { currentBalance: { decrement: revenueLine.credit } }
    });
  }

  return reversalEntry;
}

class WarehouseInvoiceModel {

  // ============================================================
  // CREATE INVOICE - ✅ Status = 'Unpaid' (No Draft)
  // ============================================================
  static async create(data) {
    const invoiceNumber = generateInvoiceNumber();

    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.warehouseInvoice.create({
        data: {
          invoiceNumber,
          invoiceDate: data.invoiceDate || new Date(),
          dueDate: data.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          orderId: data.orderId || null,
          orderNumber: data.orderNumber || null,
          customerId: data.customerId || null,
          customerName: data.customerName,
          customerEmail: data.customerEmail || '',
          customerPhone: data.customerPhone || '',
          billingAddress: data.billingAddress || {},
          subtotal: data.subtotal,
          taxTotal: data.taxTotal || 0,
          discountTotal: data.discountTotal || 0,
          grandTotal: data.grandTotal,
          invoiceStatus: 'Unpaid',  // ✅ FIXED: Always 'Unpaid'
          paymentStatus: 'Unpaid',
          paidAmount: 0,
          notes: data.notes || '',
          createdBy: data.createdBy,
          updatedBy: data.createdBy,
        },
      });

      if (data.items && data.items.length > 0) {
        await tx.warehouseInvoiceItem.createMany({
          data: data.items.map((item) => ({
            invoiceId: invoice.id,
            productId: item.productId || null,
            productName: item.productName || item.description || '',
            sku: item.sku || '',
            description: item.description || '',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate || 0,
            taxAmount: item.taxAmount || 0,
            discount: item.discount || 0,
            totalPrice: item.totalPrice || item.quantity * item.unitPrice,
          })),
        });
      }

      const userId = data.createdBy;
      const arAccount = await getOrCreateReceivableAccount(userId, tx);
      const revenueAccount = await getOrCreateRevenueAccount(userId, tx);
      const taxAccount = await getOrCreateTaxLiabilityAccount(userId, tx);

      let taxTotal = 0;
      if (data.items && data.items.length > 0) {
        data.items.forEach(item => {
          const amount = item.quantity * item.unitPrice;
          const taxAmount = amount * (item.taxRate || 0) / 100;
          taxTotal += taxAmount;
        });
      }

      await tx.journalEntry.create({
        data: {
          entryNumber: `JE-${Date.now()}`,
          date: new Date(),
          description: `Invoice ${invoice.invoiceNumber} - ${data.customerName}`,
          reference: invoice.id,
          status: 'Posted',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          lines: {
            create: [
              {
                accountId: arAccount.id,
                accountName: arAccount.name,
                accountCode: arAccount.code,
                debit: data.grandTotal,
                credit: 0,
                isReconciled: false
              },
              {
                accountId: revenueAccount.id,
                accountName: revenueAccount.name,
                accountCode: revenueAccount.code,
                debit: 0,
                credit: data.subtotal,
                isReconciled: false
              },
              {
                accountId: taxAccount.id,
                accountName: taxAccount.name,
                accountCode: taxAccount.code,
                debit: 0,
                credit: taxTotal,
                isReconciled: false
              }
            ]
          }
        }
      });

      await tx.chartOfAccount.update({
        where: { id: arAccount.id },
        data: { currentBalance: { increment: data.grandTotal } }
      });

      await tx.chartOfAccount.update({
        where: { id: taxAccount.id },
        data: { currentBalance: { increment: taxTotal } }
      });

      await tx.chartOfAccount.update({
        where: { id: revenueAccount.id },
        data: { currentBalance: { increment: data.subtotal } }
      });

      return await tx.warehouseInvoice.findUnique({
        where: { id: invoice.id },
        include: {
          items: true,
          order: { select: { id: true, orderNumber: true } },
          customer: { select: { id: true, name: true, email: true, phone: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    });
  }

  // ============================================================
  // FIND ALL WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { invoiceDate: 'desc' } } = options;

    return await prisma.warehouseInvoice.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        items: true,
        order: { select: { id: true, orderNumber: true } },
        customer: { select: { id: true, name: true, email: true, phone: true } },
        creator: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  // ============================================================
  // COUNT
  // ============================================================
  static async count(filter = {}) {
    return await prisma.warehouseInvoice.count({ where: filter });
  }

  // ============================================================
  // FIND BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.warehouseInvoice.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
        order: { select: { id: true, orderNumber: true, orderStatus: true, grandTotal: true } },
        customer: { select: { id: true, name: true, email: true, phone: true } },
        creator: { select: { id: true, firstName: true, lastName: true, email: true } },
        updater: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  // ============================================================
  // FIND BY INVOICE NUMBER
  // ============================================================
  static async findByInvoiceNumber(invoiceNumber) {
    return await prisma.warehouseInvoice.findUnique({
      where: { invoiceNumber },
      include: {
        items: true,
        order: { select: { id: true, orderNumber: true } },
        customer: { select: { id: true, name: true, email: true } },
        creator: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  // ============================================================
  // FIND BY ORDER ID
  // ============================================================
  static async findByOrderId(orderId) {
    return await prisma.warehouseInvoice.findMany({
      where: { orderId, isActive: true, isDeleted: false },
      include: { items: true },
      orderBy: { invoiceDate: 'desc' },
    });
  }

  // ============================================================
  // UPDATE
  // ============================================================
  static async update(id, data) {
    return await prisma.warehouseInvoice.update({
      where: { id },
      data,
      include: {
        items: true,
        customer: { select: { id: true, name: true, email: true } },
      },
    });
  }

  // ============================================================
  // APPLY PAYMENT
  // ============================================================
  static async applyPayment(id, amount, userId) {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.warehouseInvoice.findUnique({ where: { id } });
      if (!invoice) return null;

      const newPaidAmount = invoice.paidAmount + amount;
      const paymentStatus = getPaymentStatus(invoice.grandTotal, newPaidAmount, invoice.dueDate);

      return await tx.warehouseInvoice.update({
        where: { id },
        data: {
          paidAmount: newPaidAmount,
          paymentStatus,
          invoiceStatus: paymentStatus === 'Paid' ? 'Paid' : 'Unpaid', // ✅ FIXED
          updatedBy: userId,
        },
        include: { items: true },
      });
    });
  }

  // ============================================================
  // CANCEL INVOICE
  // ============================================================
  static async cancelInvoice(id, userId) {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.warehouseInvoice.findUnique({
        where: { id }
      });

      if (!invoice) return null;

      if (invoice.invoiceStatus === 'Paid') {
        throw new Error('Cannot cancel a paid invoice');
      }

      if (invoice.invoiceStatus === 'Cancelled') {
        throw new Error('Invoice already cancelled');
      }

      await reverseJournalEntry(invoice, userId, tx);

      const updated = await tx.warehouseInvoice.update({
        where: { id },
        data: {
          invoiceStatus: 'Cancelled',
          paymentStatus: 'Cancelled',
          updatedBy: userId,
        },
        include: { items: true },
      });

      return updated;
    });
  }

  // ============================================================
  // MARK OVERDUE
  // ============================================================
  static async markOverdue() {
    return await prisma.warehouseInvoice.updateMany({
      where: {
        paymentStatus: { in: ['Unpaid', 'Partial'] },
        dueDate: { lt: new Date() },
        isActive: true,
        isDeleted: false,
      },
      data: { paymentStatus: 'Overdue' },
    });
  }

  // ============================================================
  // SOFT DELETE
  // ============================================================
  static async softDelete(id, userId) {
    return await prisma.warehouseInvoice.update({
      where: { id },
      data: { isActive: false, isDeleted: true, updatedBy: userId },
    });
  }

  // ============================================================
  // GET STATS
  // ============================================================
  static async getStats(period = 'month') {
    const now = new Date();
    let startDate = new Date(now);

    if (period === 'today') startDate.setHours(0, 0, 0, 0);
    else if (period === 'week') startDate.setDate(startDate.getDate() - 7);
    else startDate.setMonth(startDate.getMonth() - 1);

    const filter = {
      isActive: true,
      isDeleted: false,
      invoiceDate: { gte: startDate },
    };

    const [total, unpaid, partial, paid, overdue, financial] = await Promise.all([
      prisma.warehouseInvoice.count({ where: filter }),
      prisma.warehouseInvoice.count({ where: { ...filter, paymentStatus: 'Unpaid' } }),
      prisma.warehouseInvoice.count({ where: { ...filter, paymentStatus: 'Partial' } }),
      prisma.warehouseInvoice.count({ where: { ...filter, paymentStatus: 'Paid' } }),
      prisma.warehouseInvoice.count({ where: { ...filter, paymentStatus: 'Overdue' } }),
      prisma.warehouseInvoice.aggregate({
        where: filter,
        _sum: { grandTotal: true, paidAmount: true },
      }),
    ]);

    const totalAmount = financial._sum.grandTotal || 0;
    const totalPaid = financial._sum.paidAmount || 0;

    return {
      total,
      unpaid,
      partial,
      paid,
      overdue,
      totalAmount,
      totalPaid,
      totalOutstanding: totalAmount - totalPaid,
    };
  }

  // ============================================================
  // GET DAILY TREND
  // ============================================================
  static async getDailyTrend(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const invoices = await prisma.warehouseInvoice.findMany({
      where: {
        isActive: true,
        isDeleted: false,
        invoiceDate: { gte: startDate },
      },
      select: { invoiceDate: true, grandTotal: true, paidAmount: true },
      orderBy: { invoiceDate: 'asc' },
    });

    const trendMap = {};
    invoices.forEach((inv) => {
      const key = inv.invoiceDate.toISOString().split('T')[0];
      if (!trendMap[key]) trendMap[key] = { date: key, count: 0, total: 0, paid: 0 };
      trendMap[key].count += 1;
      trendMap[key].total += inv.grandTotal;
      trendMap[key].paid += inv.paidAmount;
    });

    return Object.values(trendMap);
  }
}

module.exports = WarehouseInvoiceModel;