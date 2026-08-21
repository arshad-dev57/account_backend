// warehouse/models/SalesInvoice.js - COMPLETE CORRECTED

const prisma = require('../../prisma/client');
const BalanceCalculator = require('../../utils/balanceCalculator');
const {
  getOrCreateArAccount,
  getOrCreateSalesRevenueAccount,
} = require('../../utils/arAccountHelper');
const { postSalesInvoiceCOGS } = require('../services/salesAccountingService');

// ─── Generate Invoice Number Function ──────────────────────
function generateInvoiceNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `SI-${year}${month}${day}-${random}`;
}

async function findARAccount(tx, companyId, userId) {
  return getOrCreateArAccount(userId, companyId, tx);
}

async function findRevenueAccount(tx, companyId, userId) {
  return getOrCreateSalesRevenueAccount(userId, companyId, tx);
}

// ─── Helper: Find or Create Customer ────────────────────────
async function findOrCreateCustomer(tx, order, userId, createdBy, companyId) {
  let customerId = order.customerId;
  let customer = null;

  if (customerId) {
    customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (customer) return { customerId, customer };
    customerId = null;
  }

  if (order.customerEmail) {
    customer = await tx.customer.findFirst({
      where: { email: order.customerEmail, companyId: companyId, isActive: true, isDeleted: false }
    });
    if (customer) {
      await tx.order.update({ where: { id: order.id }, data: { customerId: customer.id } });
      return { customerId: customer.id, customer };
    }
  }

  if (order.customerPhone) {
    customer = await tx.customer.findFirst({
      where: { phone: order.customerPhone, companyId: companyId, isActive: true, isDeleted: false }
    });
    if (customer) {
      await tx.order.update({ where: { id: order.id }, data: { customerId: customer.id } });
      return { customerId: customer.id, customer };
    }
  }

  if (order.customerName) {
    customer = await tx.customer.findFirst({
      where: { name: order.customerName, companyId: companyId, isActive: true, isDeleted: false }
    });
    if (customer) {
      await tx.order.update({ where: { id: order.id }, data: { customerId: customer.id } });
      return { customerId: customer.id, customer };
    }
  }

  const customerNumber = `CUS-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  let email = order.customerEmail;
  if (email) {
    const existingEmail = await tx.customer.findFirst({
      where: { email, isActive: true, isDeleted: false }
    });
    if (existingEmail) email = null;
  }

  let phone = order.customerPhone;
  if (phone) {
    const existingPhone = await tx.customer.findFirst({
      where: { phone, isActive: true, isDeleted: false }
    });
    if (existingPhone) phone = null;
  }

  customer = await tx.customer.create({
    data: {
      customerNumber,
      name: order.customerName || 'Unknown Customer',
      email,
      phone,
      companyName: order.customerCompany || null,
      customerType: order.customerType || 'Individual',
      createdBy: createdBy,
      companyId: companyId,
      isActive: true
    }
  });

  await tx.order.update({ where: { id: order.id }, data: { customerId: customer.id } });
  return { customerId: customer.id, customer };
}

class SalesInvoiceModel {
  // ============================================================
  // CREATE SALES INVOICE FROM ORDER
  // ============================================================
  static async createFromOrder(orderId, userId, dueDate, paymentTerms = 'Net 30', fiscalYearId) {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { product: true } },
          customer: true,
          deliveries: {
            where: { isActive: true, isDeleted: false, deliveryStatus: 'Delivered' }
          }
        }
      });

      if (!order) throw new Error('Order not found');

      const existingInvoice = await tx.salesInvoice.findFirst({
        where: { orderId, isActive: true, isDeleted: false }
      });
      if (existingInvoice) throw new Error('Invoice already exists for this order');

      const companyId = order.companyId;
      const { customerId, customer } = await findOrCreateCustomer(
        tx, order, order.createdBy || userId, userId, companyId
      );

      let deliveryId = null;
      let deliveryNumber = null;
      if (order.deliveries && order.deliveries.length > 0) {
        deliveryId = order.deliveries[0].id;
        deliveryNumber = order.deliveries[0].deliveryNumber;
      }

      const invoiceNumber = generateInvoiceNumber();
      const invoiceDate = new Date();
      const dueDateObj = dueDate
        ? new Date(dueDate)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      let subtotal = 0, totalDiscount = 0, totalTax = 0;

      const invoiceItems = order.items.map(item => {
        const lineTotal = item.quantity * item.unitPrice;
        const discountAmount = (lineTotal * (item.discount || 0)) / 100;
        const taxableAmount = lineTotal - discountAmount;
        const taxAmount = (taxableAmount * (item.taxRate || 0)) / 100;
        const total = taxableAmount + taxAmount;
        subtotal += lineTotal;
        totalDiscount += discountAmount;
        totalTax += taxAmount;
        return {
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount || 0,
          taxRate: item.taxRate || 0,
          taxAmount,
          lineTotal: total,
          notes: item.notes || null
        };
      });

      const grandTotal = subtotal - totalDiscount + totalTax;

      // ✅ FIXED: Use companyId instead of userId
      const arAccount = await findARAccount(tx, companyId, userId);
      const revenueAccount = await findRevenueAccount(tx, companyId, userId);

      const invoice = await tx.salesInvoice.create({
        data: {
          invoiceNumber,
          orderId: order.id,
          orderNumber: order.orderNumber,
          deliveryId,
          deliveryNumber,
          customerId,
          customerName: customer?.name || order.customerName || 'Unknown Customer',
          customerEmail: customer?.email || order.customerEmail || null,
          customerPhone: customer?.phone || order.customerPhone || null,
          billingAddress: order.billingAddress || {},
          shippingAddress: order.shippingAddress || {},
          invoiceDate,
          dueDate: dueDateObj,
          paymentTerms: paymentTerms || 'Net 30',
          subtotal,
          discountTotal: totalDiscount,
          taxTotal: totalTax,
          grandTotal,
          paidAmount: 0,
          outstanding: grandTotal,
          invoiceStatus: 'Draft',
          paymentStatus: 'Unpaid',
          notes: order.customerNotes || null,
          salesRevenueAccountId: revenueAccount?.id || null,
          arAccountId: arAccount?.id || null,
          createdBy: userId,          // ✅ Use createdBy
          companyId: companyId,       // ✅ Use companyId
          fiscalYearId: fiscalYearId,
          locationId: order.locationId || null,
          items: { create: invoiceItems }
        },
        include: {
          items: { include: { product: true } },
          customer: true,
          order: true,
          delivery: true
        }
      });

      // Invoice created → lift Draft order to Pending
      if (order.orderStatus === 'Draft') {
        await tx.order.update({
          where: { id: order.id },
          data: { orderStatus: 'Pending', updatedBy: userId }
        });
      }

      return invoice;
    });
  }

  // ============================================================
  // CREATE SALES INVOICE MANUALLY (Without Order)
  // ============================================================
  static async createManual(data) {
    return await prisma.$transaction(async (tx) => {
      const {
        customerId, customerName, customerEmail, customerPhone,
        billingAddress, shippingAddress, items, dueDate,
        paymentTerms, notes, userId, createdBy, fiscalYearId, companyId,
        locationId,
      } = data;

      if (!customerId && !customerName) throw new Error('Customer is required');
      if (!items || items.length === 0) throw new Error('Invoice must have at least one item');

      let finalCustomerId = customerId;
      let finalCustomerName = customerName;
      let finalCustomerEmail = customerEmail;
      let finalCustomerPhone = customerPhone;

      if (customerId) {
        const customer = await tx.customer.findFirst({
          where: { id: customerId, companyId: companyId, isActive: true, isDeleted: false }
        });
        if (!customer) throw new Error('Customer not found');
        finalCustomerName = customer.name;
        finalCustomerEmail = customer.email || '';
        finalCustomerPhone = customer.phone || '';
      } else if (customerName) {
        let customer = null;
        if (customerEmail) {
          customer = await tx.customer.findFirst({
            where: { email: customerEmail, companyId: companyId, isActive: true, isDeleted: false }
          });
        }
        if (!customer && customerPhone) {
          customer = await tx.customer.findFirst({
            where: { phone: customerPhone, companyId: companyId, isActive: true, isDeleted: false }
          });
        }
        if (!customer) {
          customer = await tx.customer.findFirst({
            where: { name: customerName, companyId: companyId, isActive: true, isDeleted: false }
          });
        }
        if (customer) {
          finalCustomerId = customer.id;
          finalCustomerName = customer.name;
          finalCustomerEmail = customer.email || '';
          finalCustomerPhone = customer.phone || '';
        }
      }

      const invoiceNumber = generateInvoiceNumber();
      const invoiceDate = new Date();
      const dueDateObj = dueDate
        ? new Date(dueDate)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      let subtotal = 0, totalDiscount = 0, totalTax = 0;

      const invoiceItems = items.map(item => {
        const lineTotal = item.quantity * item.unitPrice;
        const discountAmount = (lineTotal * (item.discount || 0)) / 100;
        const taxableAmount = lineTotal - discountAmount;
        const taxAmount = (taxableAmount * (item.taxRate || 0)) / 100;
        const total = taxableAmount + taxAmount;
        subtotal += lineTotal;
        totalDiscount += discountAmount;
        totalTax += taxAmount;
        return {
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount || 0,
          taxRate: item.taxRate || 0,
          taxAmount,
          lineTotal: total,
          notes: item.notes || null
        };
      });

      const grandTotal = subtotal - totalDiscount + totalTax;

      // ✅ FIXED: Use companyId instead of userId
      const arAccount = await findARAccount(tx, companyId, userId);
      const revenueAccount = await findRevenueAccount(tx, companyId, userId);

      const invoice = await tx.salesInvoice.create({
        data: {
          invoiceNumber,
          customerId: finalCustomerId || '',
          customerName: finalCustomerName,
          customerEmail: finalCustomerEmail || null,
          customerPhone: finalCustomerPhone || null,
          billingAddress: billingAddress || {},
          shippingAddress: shippingAddress || {},
          invoiceDate,
          dueDate: dueDateObj,
          paymentTerms: paymentTerms || 'Net 30',
          subtotal,
          discountTotal: totalDiscount,
          taxTotal: totalTax,
          grandTotal,
          paidAmount: 0,
          outstanding: grandTotal,
          invoiceStatus: 'Draft',
          paymentStatus: 'Unpaid',
          notes: notes || null,
          salesRevenueAccountId: revenueAccount?.id || null,
          arAccountId: arAccount?.id || null,
          createdBy: createdBy || userId,   // ✅ Use createdBy
          companyId: companyId,             // ✅ Use companyId
          fiscalYearId: fiscalYearId,
          locationId: locationId || null,
          items: { create: invoiceItems }
        },
        include: {
          items: { include: { product: true } },
          customer: true
        }
      });

      return invoice;
    });
  }

  // ============================================================
  // POST INVOICE (Create Accounting Entries)
  // Missing JE is posted even if the invoice was already marked Paid.
  // ============================================================
  static async postInvoice(invoiceId, userId, existingTx) {
    const run = async (tx) => {
      const invoice = await tx.salesInvoice.findUnique({
        where: { id: invoiceId },
        include: {
          items: true,
          customer: true,
          salesRevenueAccount: true,
          arAccount: true,
          accountsReceivable: true
        }
      });

      if (!invoice) throw new Error('Invoice not found');
      if (invoice.invoiceStatus === 'Cancelled') {
        throw new Error('Cannot post cancelled invoice');
      }
      if (invoice.journalEntryId) {
        return invoice;
      }

      const companyId = invoice.companyId;
      const linkedArIsInventory =
        invoice.arAccount &&
        (String(invoice.arAccount.code) === '1200' ||
          /^inventory$/i.test(String(invoice.arAccount.name || '').trim()));

      const arAccount = (!invoice.arAccountId || linkedArIsInventory)
        ? await findARAccount(tx, companyId, userId)
        : invoice.arAccount;
      const revenueAccount = invoice.salesRevenueAccountId
        ? invoice.salesRevenueAccount
        : await findRevenueAccount(tx, companyId, userId);

      if (!arAccount || !revenueAccount) {
        throw new Error(
          'Accounts Receivable or Sales Revenue account not found in Chart of Accounts.'
        );
      }

      await tx.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          arAccountId: arAccount.id,
          salesRevenueAccountId: revenueAccount.id
        }
      });

      const entryNumber = `JE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      const journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber,
          date: invoice.invoiceDate || new Date(),
          description: `Sales Invoice #${invoice.invoiceNumber} for ${invoice.customerName}`,
          reference: invoice.invoiceNumber,
          status: 'Posted',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          companyId: companyId,
          fiscalYearId: invoice.fiscalYearId,
          lines: {
            create: [
              {
                accountId: arAccount.id,
                accountName: arAccount.name,
                accountCode: arAccount.code,
                debit: invoice.grandTotal,
                credit: 0
              },
              {
                accountId: revenueAccount.id,
                accountName: revenueAccount.name,
                accountCode: revenueAccount.code,
                debit: 0,
                credit: invoice.grandTotal
              }
            ]
          }
        },
        include: { lines: true }
      });

      await BalanceCalculator.applyJournalLines(tx, journalEntry.lines);

      const existingAr = Array.isArray(invoice.accountsReceivable)
        ? invoice.accountsReceivable[0]
        : invoice.accountsReceivable;

      if (!existingAr) {
        await tx.accountsReceivable.create({
          data: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            customerId: invoice.customerId,
            customerName: invoice.customerName,
            amount: invoice.grandTotal,
            paidAmount: invoice.paidAmount || 0,
            outstanding: invoice.outstanding != null
              ? invoice.outstanding
              : invoice.grandTotal,
            dueDate: invoice.dueDate,
            status: (invoice.outstanding || invoice.grandTotal) <= 0 ? 'Paid' : 'Current',
            accountId: arAccount.id,
            companyId: companyId,
            fiscalYearId: invoice.fiscalYearId,
            notes: `Created from invoice #${invoice.invoiceNumber}`
          }
        });
      }

      const keepStatus = ['Paid', 'Partially Paid'].includes(invoice.invoiceStatus);
      if (!keepStatus && invoice.customerId) {
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { outstandingBalance: { increment: invoice.grandTotal } }
        });
      }

      const invoiceWithItems = await tx.salesInvoice.findUnique({
        where: { id: invoiceId },
        include: { items: { include: { product: true } } },
      });
      if (invoiceWithItems) {
        await postSalesInvoiceCOGS(tx, {
          invoice: invoiceWithItems,
          userId,
          companyId,
        });
      }

      const updatedInvoice = await tx.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          invoiceStatus: keepStatus ? invoice.invoiceStatus : 'Posted',
          postedAt: invoice.postedAt || new Date(),
          journalEntryId: journalEntry.id,
          arAccountId: arAccount.id,
          salesRevenueAccountId: revenueAccount.id,
          updatedBy: userId
        },
        include: {
          items: { include: { product: true } },
          customer: true,
          journalEntry: {
            include: { lines: { include: { account: true } } }
          },
          accountsReceivable: true
        }
      });

      if (invoice.orderId) {
        const linkedOrder = await tx.order.findUnique({
          where: { id: invoice.orderId }
        });
        if (
          linkedOrder &&
          ['Draft', 'Pending'].includes(linkedOrder.orderStatus)
        ) {
          await tx.order.update({
            where: { id: invoice.orderId },
            data: { orderStatus: 'Processing', updatedBy: userId }
          });
        }
      }

      return updatedInvoice;
    };

    if (existingTx) return run(existingTx);
    return prisma.$transaction(run);
  }

  // ============================================================
  // GET INVOICE BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.salesInvoice.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, sellingPrice: true } }
          }
        },
        order: { include: { customer: true } },
        delivery: true,
        customer: true,
        creator: { select: { id: true, firstName: true, lastName: true, email: true } },
        updater: { select: { id: true, firstName: true, lastName: true, email: true } },
        journalEntry: {
          include: { lines: { include: { account: true } } }
        },
        accountsReceivable: { include: { payments: true } },
        salesRevenueAccount: true,
        arAccount: true
      }
    });
  }

  // ============================================================
  // GET INVOICE BY NUMBER
  // ============================================================
  static async findByInvoiceNumber(invoiceNumber) {
    return await prisma.salesInvoice.findUnique({
      where: { invoiceNumber },
      include: {
        items: { include: { product: true } },
        customer: true,
        journalEntry: {
          include: { lines: { include: { account: true } } }
        },
        accountsReceivable: { include: { payments: true } }
      }
    });
  }

  // ============================================================
  // GET ALL INVOICES WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { invoiceDate: 'desc' } } = options;
    return await prisma.salesInvoice.findMany({
      where: { ...filter, isActive: true, isDeleted: false },
      skip,
      take,
      orderBy,
      include: {
        items: {
          include: { product: { select: { id: true, name: true, sku: true } } }
        },
        customer: true,
        order: { select: { id: true, orderNumber: true, orderStatus: true } },
        creator: { select: { id: true, firstName: true, lastName: true, email: true } },
        accountsReceivable: { include: { payments: true } }
      }
    });
  }

  // ============================================================
  // COUNT INVOICES
  // ============================================================
  static async count(filter = {}) {
    return await prisma.salesInvoice.count({
      where: { ...filter, isActive: true, isDeleted: false }
    });
  }

  // ============================================================
  // UPDATE INVOICE (Only Draft)
  // ============================================================
  static async update(id, data) {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.salesInvoice.findUnique({
        where: { id },
        include: { items: true }
      });

      if (!invoice) throw new Error('Invoice not found');
      if (invoice.invoiceStatus === 'Posted') throw new Error('Cannot update posted invoice');
      if (invoice.invoiceStatus === 'Cancelled') throw new Error('Cannot update cancelled invoice');

      const updateData = {
        updatedBy: data.updatedBy,
        ...(data.customerId && { customerId: data.customerId }),
        ...(data.customerName && { customerName: data.customerName }),
        ...(data.customerEmail !== undefined && { customerEmail: data.customerEmail }),
        ...(data.customerPhone !== undefined && { customerPhone: data.customerPhone }),
        ...(data.billingAddress && { billingAddress: data.billingAddress }),
        ...(data.shippingAddress && { shippingAddress: data.shippingAddress }),
        ...(data.invoiceDate && { invoiceDate: new Date(data.invoiceDate) }),
        ...(data.dueDate && { dueDate: new Date(data.dueDate) }),
        ...(data.paymentTerms && { paymentTerms: data.paymentTerms }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.termsConditions !== undefined && { termsConditions: data.termsConditions })
      };

      if (data.items) {
        await tx.salesInvoiceItem.deleteMany({ where: { invoiceId: id } });

        let subtotal = 0, totalDiscount = 0, totalTax = 0;

        const invoiceItems = data.items.map(item => {
          const lineTotal = item.quantity * item.unitPrice;
          const discountAmount = (lineTotal * (item.discount || 0)) / 100;
          const taxableAmount = lineTotal - discountAmount;
          const taxAmount = (taxableAmount * (item.taxRate || 0)) / 100;
          const total = taxableAmount + taxAmount;
          subtotal += lineTotal;
          totalDiscount += discountAmount;
          totalTax += taxAmount;
          return {
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount || 0,
            taxRate: item.taxRate || 0,
            taxAmount,
            lineTotal: total,
            notes: item.notes || null
          };
        });

        const grandTotal = subtotal - totalDiscount + totalTax;
        updateData.subtotal = subtotal;
        updateData.discountTotal = totalDiscount;
        updateData.taxTotal = totalTax;
        updateData.grandTotal = grandTotal;
        updateData.outstanding = grandTotal - invoice.paidAmount;
        updateData.items = { create: invoiceItems };
      }

      return await tx.salesInvoice.update({
        where: { id },
        data: updateData,
        include: {
          items: { include: { product: true } },
          customer: true
        }
      });
    });
  }

  // ============================================================
  // CANCEL INVOICE
  // ============================================================
  static async cancelInvoice(id, userId, reason = '') {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.salesInvoice.findUnique({
        where: { id },
        include: {
          accountsReceivable: true,
          journalEntry: { include: { lines: true } }
        }
      });

      if (!invoice) throw new Error('Invoice not found');
      if (invoice.invoiceStatus === 'Cancelled') throw new Error('Invoice already cancelled');
      if (invoice.invoiceStatus === 'Posted' && invoice.paidAmount > 0) {
        throw new Error('Cannot cancel invoice with payments');
      }

      if (invoice.invoiceStatus === 'Posted') {
        if (invoice.journalEntry) {
          const reverseEntryNumber = `REV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
          await tx.journalEntry.create({
            data: {
              entryNumber: reverseEntryNumber,
              date: new Date(),
              description: `Reversal of invoice #${invoice.invoiceNumber}`,
              reference: invoice.invoiceNumber,
              status: 'Posted',
              createdBy: userId,
              postedBy: userId,
              postedAt: new Date(),
              companyId: invoice.companyId,
              fiscalYearId: invoice.fiscalYearId,
              lines: {
                create: invoice.journalEntry.lines.map(line => ({
                  accountId: line.accountId,
                  accountName: line.accountName,
                  accountCode: line.accountCode,
                  debit: line.credit,
                  credit: line.debit
                }))
              }
            }
          });
        }

        await tx.accountsReceivable.deleteMany({
          where: { invoiceId: invoice.id },
        });

        if (invoice.customerId) {
          await tx.customer.update({
            where: { id: invoice.customerId },
            data: { outstandingBalance: { decrement: invoice.grandTotal } },
          });
        }
      }

      return await tx.salesInvoice.update({
        where: { id },
        data: { invoiceStatus: 'Cancelled', cancelledAt: new Date(), updatedBy: userId },
        include: {
          items: { include: { product: true } },
          customer: true
        }
      });
    });
  }

  // ============================================================
  // SOFT DELETE INVOICE
  // ============================================================
  static async softDelete(id, userId) {
    const invoice = await prisma.salesInvoice.findUnique({ where: { id } });
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.invoiceStatus === 'Posted') throw new Error('Cannot delete posted invoice');

    return await prisma.salesInvoice.update({
      where: { id },
      data: { isDeleted: true, isActive: false, updatedBy: userId, updatedAt: new Date() },
      include: { items: true }
    });
  }

  // ============================================================
  // GET INVOICE STATS / KPI - ✅ FIXED
  // ============================================================
  static async getStats(companyId) {
    // ✅ FIXED: Use companyId instead of userId
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startOfWeek = new Date(today);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const baseFilter = { 
      isActive: true, 
      isDeleted: false, 
      companyId: companyId  // ✅ Use companyId
    };

    const [todayInvoices, weekInvoices, monthInvoices, monthRevenue, overdueInvoices] =
      await Promise.all([
        prisma.salesInvoice.count({ where: { ...baseFilter, invoiceDate: { gte: today, lt: tomorrow } } }),
        prisma.salesInvoice.count({ where: { ...baseFilter, invoiceDate: { gte: startOfWeek } } }),
        prisma.salesInvoice.count({ where: { ...baseFilter, invoiceDate: { gte: startOfMonth } } }),
        prisma.salesInvoice.aggregate({
          where: { ...baseFilter, invoiceDate: { gte: startOfMonth } },
          _sum: { grandTotal: true }
        }),
        prisma.salesInvoice.count({
          where: {
            ...baseFilter,
            invoiceStatus: { in: ['Posted', 'Partially Paid'] },
            dueDate: { lt: today },
            outstanding: { gt: 0 }
          }
        })
      ]);

    return {
      today: { invoices: todayInvoices },
      week: { invoices: weekInvoices },
      month: { invoices: monthInvoices, revenue: monthRevenue._sum.grandTotal || 0 },
      overdue: overdueInvoices
    };
  }

  // ============================================================
  // GET INVOICE STATUS COUNTS (KPI) - ✅ FIXED
  // ============================================================
  static async getStatusCounts(companyId) {
    // ✅ FIXED: Use companyId instead of userId
    const baseFilter = { 
      isActive: true, 
      isDeleted: false, 
      companyId: companyId  // ✅ Use companyId
    };

    const [total, draft, posted, partiallyPaid, paid, cancelled] = await Promise.all([
      prisma.salesInvoice.count({ where: baseFilter }),
      prisma.salesInvoice.count({ where: { ...baseFilter, invoiceStatus: 'Draft' } }),
      prisma.salesInvoice.count({ where: { ...baseFilter, invoiceStatus: 'Posted' } }),
      prisma.salesInvoice.count({ where: { ...baseFilter, invoiceStatus: 'Partially Paid' } }),
      prisma.salesInvoice.count({ where: { ...baseFilter, invoiceStatus: 'Paid' } }),
      prisma.salesInvoice.count({ where: { ...baseFilter, invoiceStatus: 'Cancelled' } })
    ]);

    const [totalValue, outstanding] = await Promise.all([
      prisma.salesInvoice.aggregate({
        where: { ...baseFilter, invoiceStatus: { notIn: ['Draft', 'Cancelled'] } },
        _sum: { grandTotal: true }
      }),
      prisma.salesInvoice.aggregate({
        where: { ...baseFilter, invoiceStatus: { in: ['Posted', 'Partially Paid'] } },
        _sum: { outstanding: true }
      })
    ]);

    return {
      total, draft, posted, partiallyPaid, paid, cancelled,
      totalValue: totalValue._sum.grandTotal || 0,
      outstanding: outstanding._sum.outstanding || 0
    };
  }

  // ============================================================
  // UPDATE PAYMENT STATUS
  // ============================================================
  static async updatePaymentStatus(invoiceId) {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.salesInvoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new Error('Invoice not found');

      const totalPaid = await tx.paymentReceived.aggregate({
        where: { invoiceId, status: 'Completed' },
        _sum: { amount: true }
      });

      const paidAmount = totalPaid._sum.amount || 0;
      const outstanding = invoice.grandTotal - paidAmount;
      let invoiceStatus = invoice.invoiceStatus;
      let paymentStatus = 'Unpaid';

      if (paidAmount >= invoice.grandTotal) {
        invoiceStatus = 'Paid';
        paymentStatus = 'Paid';
      } else if (paidAmount > 0) {
        invoiceStatus = 'Partially Paid';
        paymentStatus = 'Partial';
      }

      const updatedInvoice = await tx.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount, outstanding, invoiceStatus, paymentStatus,
          ...(invoiceStatus === 'Paid' && { paidAt: new Date() })
        }
      });

      await tx.accountsReceivable.updateMany({
        where: { invoiceId },
        data: {
          paidAmount, outstanding,
          status: invoiceStatus === 'Paid' ? 'Paid' : 'Current'
        }
      });

      if (invoice.orderId) {
        const Order = require('./Order');
        await Order.syncFromInvoices(invoice.orderId, tx);
      }

      return updatedInvoice;
    });
  }

  // ============================================================
  // GET CUSTOMER INVOICE SUMMARY - ✅ FIXED
  // ============================================================
  static async getCustomerSummary(companyId, customerId) {
    // ✅ FIXED: Use companyId instead of userId
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        companyId: companyId, 
        customerId, 
        isActive: true, 
        isDeleted: false,
        invoiceStatus: { notIn: ['Draft', 'Cancelled'] }
      },
      select: {
        id: true, invoiceNumber: true, invoiceDate: true, dueDate: true,
        grandTotal: true, paidAmount: true, outstanding: true,
        invoiceStatus: true, paymentStatus: true
      },
      orderBy: { invoiceDate: 'desc' }
    });

    const summary = {
      totalInvoices: invoices.length,
      totalAmount: 0, totalPaid: 0, totalOutstanding: 0,
      overdueCount: 0, overdueAmount: 0,
      invoices
    };

    const today = new Date();
    for (const invoice of invoices) {
      summary.totalAmount += invoice.grandTotal;
      summary.totalPaid += invoice.paidAmount;
      summary.totalOutstanding += invoice.outstanding;
      if (invoice.dueDate < today && invoice.outstanding > 0) {
        summary.overdueCount++;
        summary.overdueAmount += invoice.outstanding;
      }
    }

    return summary;
  }

  static async backfillMissingJournals(companyId, userId) {
    if (!companyId || !userId) return;
    const missing = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        isActive: true,
        isDeleted: false,
        journalEntryId: null,
        invoiceStatus: { not: 'Cancelled' }
      },
      select: { id: true }
    });
    for (const inv of missing) {
      await this.postInvoice(inv.id, userId);
    }
  }
}

module.exports = SalesInvoiceModel;