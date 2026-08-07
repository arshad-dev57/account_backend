// pos/controllers/posSaleController.js
// NO fiscal year dependency — POS works independently
const POSSaleModel = require('../models/POSSale');
const prisma = require('../../prisma/client');

// ─── Helper: get active shift (required for any sale) ──────────────────────
async function requireActiveShift(userId, companyId) {
  const shift = await prisma.pOSShift.findFirst({
    where: { cashierId: userId, companyId, status: 'Open' }
  });
  if (!shift) throw new Error('No active open shift. Please open a shift before processing sales.');
  return shift;
}

// @desc  Complete Sale (checkout)
// @route POST /api/pos/sales
const completeSale = async (req, res) => {
  try {
    const userId    = req.user.id;
    const companyId = req.user.companyId;
    const { id, terminalId, customerId, customerName, customerEmail, customerPhone,
            items, payments, discountTotal, taxTotal, notes, isOffline, offlineCreatedAt } = req.body;

    if (!items || items.length === 0)    return res.status(400).json({ success: false, message: 'At least one item is required' });
    if (!payments || payments.length === 0) return res.status(400).json({ success: false, message: 'At least one payment is required' });
    if (!terminalId) return res.status(400).json({ success: false, message: 'terminalId is required' });

    const shift = await requireActiveShift(userId, companyId);

    const { sale, journalEntry } = await POSSaleModel.completeSale({
      id, shiftId: shift.id, terminalId, customerId, customerName, customerEmail, customerPhone,
      items, payments,
      discountTotal: discountTotal || 0,
      taxTotal:      taxTotal      || 0,
      notes,
      companyId, createdBy: userId,
      isOffline:        !!isOffline,
      offlineCreatedAt: offlineCreatedAt || null
    });

    res.status(201).json({ success: true, message: 'Sale completed successfully', data: { sale, journalEntry } });
  } catch (err) {
    console.error('POS Sale Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Batch Sync (offline transactions)
// @route POST /api/pos/sales/sync
const syncSales = async (req, res) => {
  try {
    const { transactions } = req.body;
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ success: false, message: 'transactions array is required' });
    }
    const results = await POSSaleModel.batchSync(transactions, req.user.companyId, req.user.id);
    const succeeded = results.filter(r => r.status === 'success').length;
    const failed    = results.filter(r => r.status === 'failed').length;
    const skipped   = results.filter(r => r.status === 'skipped').length;
    res.json({ success: true, message: `Sync complete: ${succeeded} synced, ${failed} failed, ${skipped} skipped`, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Hold Sale (save for later)
// @route POST /api/pos/sales/hold
const holdSale = async (req, res) => {
  try {
    const userId    = req.user.id;
    const companyId = req.user.companyId;
    const { terminalId, customerId, customerName, customerEmail, customerPhone,
            items, discountTotal, taxTotal, notes } = req.body;

    if (!items || items.length === 0) return res.status(400).json({ success: false, message: 'At least one item is required' });
    if (!terminalId) return res.status(400).json({ success: false, message: 'terminalId is required' });

    const shift = await requireActiveShift(userId, companyId);

    const held = await POSSaleModel.holdSale({
      shiftId: shift.id, terminalId, customerId, customerName, customerEmail, customerPhone,
      items, discountTotal: discountTotal || 0, taxTotal: taxTotal || 0, notes,
      companyId, createdBy: userId
    });

    res.status(201).json({ success: true, message: 'Sale held successfully', data: held });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  List held sales
// @route GET /api/pos/sales/held
const getHeldSales = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const filter = { companyId, status: 'Held' };
    if (req.user.role === 'cashier') filter.createdBy = req.user.id;

    const held = await prisma.pOSSale.findMany({
      where: filter,
      orderBy: { createdAt: 'desc' },
      include: { items: true, customer: { select: { id: true, name: true } } }
    });
    res.json({ success: true, data: held });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Delete held sale (manager only)
// @route DELETE /api/pos/sales/held/:id
const deleteHeldSale = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    if (!['manager','admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only managers or admins can delete held sales' });
    }
    const sale = await prisma.pOSSale.findFirst({ where: { id, companyId, status: 'Held' } });
    if (!sale) return res.status(404).json({ success: false, message: 'Held sale not found' });

    await prisma.pOSSale.update({ where: { id }, data: { status: 'Cancelled' } });
    await prisma.pOSAuditLog.create({
      data: { action: 'Void', details: `Held sale ${sale.invoiceNumber} deleted`, companyId, createdBy: req.user.id }
    });
    res.json({ success: true, message: 'Held sale deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  List all POS sales
// @route GET /api/pos/sales
const listSales = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { page = 1, limit = 20, status, shiftId, cashierId, startDate, endDate } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const filter = { companyId };
    if (status)    filter.status   = status;
    if (shiftId)   filter.shiftId  = shiftId;
    if (cashierId) filter.createdBy = cashierId;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.gte = new Date(startDate);
      if (endDate)   filter.createdAt.lte = new Date(endDate + 'T23:59:59.999Z');
    }

    const [sales, total] = await Promise.all([
      POSSaleModel.findAll(filter, { skip, take: parseInt(limit) }),
      POSSaleModel.count(filter)
    ]);
    res.json({ success: true, data: sales, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Get single POS sale
// @route GET /api/pos/sales/:id
const getSale = async (req, res) => {
  try {
    const sale = await POSSaleModel.findById(req.params.id, req.user.companyId);
    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });
    res.json({ success: true, data: sale });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Process Return (manager/admin only)
// @route POST /api/pos/returns
const processReturn = async (req, res) => {
  try {
    const userId    = req.user.id;
    const companyId = req.user.companyId;
    if (!['manager','admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only managers or admins can process returns' });
    }
    const { originalSaleId, returnItems, refundMethod, reason } = req.body;
    if (!originalSaleId || !returnItems?.length || !refundMethod || !reason) {
      return res.status(400).json({ success: false, message: 'originalSaleId, returnItems, refundMethod, reason are required' });
    }

    const shift = await requireActiveShift(userId, companyId);

    const result = await POSSaleModel.processReturn({
      originalSaleId, returnItems, refundMethod, reason,
      approvedBy: userId, companyId, createdBy: userId, shiftId: shift.id
    });

    res.status(201).json({ success: true, message: 'Return processed successfully', data: result });
  } catch (err) {
    console.error('POS Return Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Daily Report (Z-Report style)
// @route GET /api/pos/reports/daily
const getDailyReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const start = new Date(targetDate); start.setHours(0,0,0,0);
    const end   = new Date(targetDate); end.setHours(23,59,59,999);

    const [sales, returns, payments] = await Promise.all([
      prisma.pOSSale.aggregate({
        where: { companyId, status: 'Completed', createdAt: { gte: start, lte: end } },
        _sum:   { grandTotal: true, discountTotal: true },
        _count: { id: true }
      }),
      prisma.pOSReturn.aggregate({
        where: { companyId, createdAt: { gte: start, lte: end } },
        _sum: { refundedAmount: true }, _count: { id: true }
      }),
      prisma.pOSSalePayment.groupBy({
        by:    ['paymentMethod'],
        where: { posSale: { companyId, status: 'Completed', createdAt: { gte: start, lte: end } } },
        _sum:  { amount: true }
      })
    ]);

    res.json({ success: true, data: { date: targetDate, sales, returns, paymentBreakdown: payments } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Product search for POS (with barcode support)
// @route GET /api/pos/products/search
const searchProducts = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { q, categoryId, page = 1, limit = 30 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = { companyId, isActive: true, currentStock: { gt: 0 } };
    if (categoryId) filter.categoryId = categoryId;
    if (q) {
      filter.OR = [
        { name:          { contains: q, mode: 'insensitive' } },
        { sku:           { contains: q, mode: 'insensitive' } },
        { barcodeNumber: { contains: q, mode: 'insensitive' } }
      ];
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: filter, skip, take: parseInt(limit),
        orderBy: { name: 'asc' },
        select: {
          id: true, name: true, sku: true, barcodeNumber: true,
          sellingPrice: true, costPrice: true, currentStock: true,
          availableStock: true, mainImage: true, categoryId: true, categoryName: true,
          taxRate: true, stockUnitName: true
        }
      }),
      prisma.product.count({ where: filter })
    ]);

    res.json({ success: true, data: products, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Audit log
// @route GET /api/pos/audit-logs
const getAuditLogs = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!['manager','admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const { page = 1, limit = 50, action } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const filter = { companyId };
    if (action) filter.action = action;

    const [logs, total] = await Promise.all([
      prisma.pOSAuditLog.findMany({
        where: filter, skip, take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: { creator: { select: { id:true, firstName:true, lastName:true } } }
      }),
      prisma.pOSAuditLog.count({ where: filter })
    ]);
    res.json({ success: true, data: logs, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Convert POS sale to Sales Invoice
// @route POST /api/pos/sales/:id/convert-to-invoice
const convertToInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentTerms, dueDate } = req.body;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    // Fetch the POS sale
    const posSale = await prisma.pOSSale.findFirst({
      where: { id, companyId, status: 'Completed' },
      include: { items: true, customer: true }
    });

    if (!posSale) {
      return res.status(404).json({ success: false, message: 'POS sale not found or not completed' });
    }

    if (posSale.invoiceId) {
      return res.status(400).json({ success: false, message: 'This sale has already been converted to an invoice' });
    }

    if (!posSale.customerId) {
      return res.status(400).json({ success: false, message: 'Cannot convert sale without customer to invoice' });
    }

    // Reverse the POS journal entry
    if (posSale.journalEntryId) {
      const journalEntry = await prisma.journalEntry.findUnique({
        where: { id: posSale.journalEntryId },
        include: { lines: true }
      });

      if (journalEntry) {
        // Create reversing journal entry
        const reversalEntry = await prisma.journalEntry.create({
          data: {
            entryNumber: `REV-${journalEntry.entryNumber}`,
            entryDate: new Date(),
            description: `Reversal of POS sale ${posSale.invoiceNumber} for invoice conversion`,
            status: 'Posted',
            companyId,
            createdBy: userId,
            lines: {
              create: journalEntry.lines.map(line => ({
                accountId: line.accountId,
                debitAmount: line.creditAmount,
                creditAmount: line.debitAmount,
                description: `Reversal: ${line.description}`,
                companyId
              }))
            }
          }
        });

        // Mark original entry as reversed
        await prisma.journalEntry.update({
          where: { id: posSale.journalEntryId },
          data: { status: 'Reversed' }
        });

        // Update POS sale
        await prisma.pOSSale.update({
          where: { id },
          data: { journalEntryId: null }
        });
      }
    }

    // Calculate due date
    let calculatedDueDate = new Date();
    if (dueDate) {
      calculatedDueDate = new Date(dueDate);
    } else if (paymentTerms) {
      const days = parseInt(paymentTerms.replace(/\D/g, '')) || 30;
      calculatedDueDate.setDate(calculatedDueDate.getDate() + days);
    }

    // Generate invoice number
    const lastInvoice = await prisma.salesInvoice.findFirst({
      where: { companyId },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true }
    });

    let nextNumber = 1;
    if (lastInvoice && lastInvoice.invoiceNumber) {
      const lastNum = parseInt(lastInvoice.invoiceNumber.replace(/\D/g, ''));
      nextNumber = lastNum + 1;
    }
    const invoiceNumber = `INV-${String(nextNumber).padStart(6, '0')}`;

    // Create Sales Invoice
    const invoice = await prisma.salesInvoice.create({
      data: {
        invoiceNumber,
        customerId: posSale.customerId,
        customerName: posSale.customerName,
        customerEmail: posSale.customerEmail,
        customerPhone: posSale.customerPhone,
        posSaleId: posSale.id,
        invoiceDate: new Date(),
        dueDate: calculatedDueDate,
        paymentTerms: paymentTerms || 'Net 30',
        subtotal: posSale.subtotal,
        discountTotal: posSale.discountTotal,
        taxTotal: posSale.taxTotal,
        grandTotal: posSale.grandTotal,
        paidAmount: 0,
        outstanding: posSale.grandTotal,
        invoiceStatus: 'Posted',
        paymentStatus: 'Unpaid',
        postedAt: new Date(),
        companyId,
        createdBy: userId,
        items: {
          create: posSale.items.map(item => ({
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            taxRate: item.taxRate,
            taxAmount: item.taxAmount,
            totalPrice: item.totalPrice,
            companyId
          }))
        }
      }
    });

    // Create journal entry for the invoice (Debit AR, Credit Revenue)
    const customer = posSale.customer;
    const arAccount = await prisma.chartOfAccount.findFirst({
      where: { companyId, accountName: { contains: 'Accounts Receivable', mode: 'insensitive' } }
    });

    const revenueAccount = await prisma.chartOfAccount.findFirst({
      where: { companyId, accountName: { contains: 'Sales', mode: 'insensitive' } }
    });

    if (arAccount && revenueAccount) {
      const journalEntry = await prisma.journalEntry.create({
        data: {
          entryNumber: `JE-${Date.now()}`,
          entryDate: new Date(),
          description: `Sales Invoice ${invoiceNumber} from POS sale ${posSale.invoiceNumber}`,
          status: 'Posted',
          companyId,
          createdBy: userId,
          lines: {
            create: [
              {
                accountId: arAccount.id,
                debitAmount: posSale.grandTotal,
                creditAmount: 0,
                description: `Accounts Receivable - ${customer.name}`,
                companyId
              },
              {
                accountId: revenueAccount.id,
                debitAmount: 0,
                creditAmount: posSale.subtotal - posSale.discountTotal,
                description: 'Sales Revenue',
                companyId
              }
            ]
          }
        }
      });

      await prisma.salesInvoice.update({
        where: { id: invoice.id },
        data: { journalEntryId: journalEntry.id, arAccountId: arAccount.id, salesRevenueAccountId: revenueAccount.id }
      });
    }

    // Update customer outstanding balance
    if (customer) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          outstandingBalance: { increment: posSale.grandTotal }
        }
      });
    }

    // Update POS sale with invoice reference
    await prisma.pOSSale.update({
      where: { id },
      data: { invoiceId: invoice.id, status: 'Invoiced' }
    });

    res.status(201).json({ success: true, message: 'POS sale converted to invoice successfully', data: invoice });
  } catch (err) {
    console.error('Convert to Invoice Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  completeSale, syncSales, holdSale, getHeldSales, deleteHeldSale,
  listSales, getSale, processReturn, getDailyReport, searchProducts, getAuditLogs, convertToInvoice
};
