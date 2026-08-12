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

    try {
      const taxCalculationService = require('../../tax/services/taxCalculationService');
      await taxCalculationService.calculateTax({
        items: (items || []).map((item) => ({
          productId: item.productId,
          categoryId: item.categoryId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          pricingModel: item.pricingModel || (String(item.taxType || '').toLowerCase().includes('inclusive') ? 'inclusive' : 'exclusive'),
        })),
        customer: customerId ? { id: customerId } : null,
        companyId,
        transactionType: 'POSSale',
        transactionId: sale.id,
      });
    } catch (taxErr) {
      console.error('POS tax ledger recording failed:', taxErr.message);
    }

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
    if (!['manager','admin','owner','superadmin'].includes(String(req.user.role||'').toLowerCase())) {
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
    if (!['manager','admin','owner','superadmin'].includes(String(req.user.role||'').toLowerCase())) {
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
          taxRate: true, stockUnitName: true,
          isVariant: true, parentProductId: true, variantType: true, variantAttributes: true,
          isSerialManaged: true, isBatchManaged: true, hasExpiry: true,
        }
      }),
      prisma.product.count({ where: filter })
    ]);

    res.json({ success: true, data: products, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Exact barcode / SKU lookup for hardware scanners
// @route GET /api/pos/products/barcode/:code
const getProductByBarcode = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const code = decodeURIComponent(req.params.code || '').trim();
    if (!code) {
      return res.status(400).json({ success: false, message: 'Barcode is required' });
    }

    const product = await prisma.product.findFirst({
      where: {
        companyId,
        isActive: true,
        OR: [
          { barcodeNumber: { equals: code, mode: 'insensitive' } },
          { sku: { equals: code, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true, name: true, sku: true, barcodeNumber: true,
        sellingPrice: true, costPrice: true, currentStock: true,
        availableStock: true, mainImage: true, categoryId: true, categoryName: true,
        taxRate: true, stockUnitName: true,
      },
    });

    if (!product) {
      return res.status(404).json({ success: false, message: `No product found for barcode ${code}` });
    }

    res.json({ success: true, data: product });
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

    const posSale = await prisma.pOSSale.findFirst({
      where: { id, companyId, status: 'Completed' },
      include: { items: true, customer: true },
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

    // Paid POS sales keep existing JE — create a Paid invoice as document trail only
    let calculatedDueDate = new Date();
    if (dueDate) {
      calculatedDueDate = new Date(dueDate);
    } else if (paymentTerms) {
      const days = parseInt(String(paymentTerms).replace(/\D/g, ''), 10) || 30;
      calculatedDueDate.setDate(calculatedDueDate.getDate() + days);
    }

    const lastInvoice = await prisma.salesInvoice.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: { invoiceNumber: true },
    });

    let nextNumber = 1;
    if (lastInvoice?.invoiceNumber) {
      const lastNum = parseInt(String(lastInvoice.invoiceNumber).replace(/\D/g, ''), 10);
      if (Number.isFinite(lastNum)) nextNumber = lastNum + 1;
    }
    const invoiceNumber = `INV-${String(nextNumber).padStart(6, '0')}`;

    const fullyPaid = Number(posSale.paidAmount || 0) >= Number(posSale.grandTotal || 0) - 0.01;

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
        paidAmount: fullyPaid ? posSale.grandTotal : 0,
        outstanding: fullyPaid ? 0 : posSale.grandTotal,
        invoiceStatus: 'Posted',
        paymentStatus: fullyPaid ? 'Paid' : 'Unpaid',
        postedAt: new Date(),
        paidAt: fullyPaid ? new Date() : null,
        notes: `Converted from POS ${posSale.invoiceNumber}`,
        companyId,
        createdBy: userId,
        items: {
          create: posSale.items.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            sku: item.sku || '',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount || 0,
            taxRate: item.taxRate || 0,
            taxAmount: item.taxAmount || 0,
            lineTotal: item.lineTotal,
          })),
        },
      },
      include: { items: true },
    });

    await prisma.pOSSale.update({
      where: { id },
      data: { invoiceId: invoice.id },
    });

    await prisma.pOSAuditLog.create({
      data: {
        action: 'Sale',
        details: `Converted POS ${posSale.invoiceNumber} → Invoice ${invoiceNumber}`,
        companyId,
        createdBy: userId,
      },
    });

    res.status(201).json({
      success: true,
      message: 'POS sale converted to invoice successfully',
      data: invoice,
    });
  } catch (err) {
    console.error('Convert to Invoice Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Void a completed POS sale
// @route POST /api/pos/sales/:id/void
const voidSale = async (req, res) => {
  try {
    const role = String(req.user.role || '').toLowerCase();
    if (!['manager', 'admin', 'owner', 'superadmin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Only managers or admins can void sales' });
    }
    const { reason } = req.body;
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ success: false, message: 'Void reason is required' });
    }
    const result = await POSSaleModel.voidSale({
      saleId: req.params.id,
      companyId: req.user.companyId,
      createdBy: req.user.id,
      reason: String(reason).trim(),
    });
    res.json({ success: true, message: 'Sale voided', data: result.sale });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Verify manager credentials (PIN/password override)
// @route POST /api/pos/auth/verify-manager
const verifyManager = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'email and password are required' });
    }
    const user = await prisma.user.findFirst({
      where: {
        email: String(email).trim().toLowerCase(),
        companyId: req.user.companyId,
        isActive: true,
      },
    });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid manager credentials' });
    }
    const role = String(user.role || '').toLowerCase();
    if (!['manager', 'admin', 'owner', 'superadmin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'User is not a manager/admin' });
    }
    const bcrypt = require('bcryptjs');
    const ok = await bcrypt.compare(String(password), user.password);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Invalid manager credentials' });
    }
    await prisma.pOSAuditLog.create({
      data: {
        action: 'Cash Adjustment',
        details: `Manager override approved by ${user.email}`,
        companyId: req.user.companyId,
        createdBy: req.user.id,
      },
    }).catch(() => {});
    res.json({
      success: true,
      message: 'Manager verified',
      data: {
        managerId: user.id,
        managerName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Shift Z/X report
// @route GET /api/pos/reports/shift/:shiftId
const getShiftReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { shiftId } = req.params;
    const shift = await prisma.pOSShift.findFirst({
      where: { id: shiftId, companyId },
      include: {
        terminal: true,
        cashier: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });

    const salesWhere = { shiftId, companyId, status: 'Completed' };
    const [salesAgg, salesCount, payments, cashIn, cashOut, returns, sales] = await Promise.all([
      prisma.pOSSale.aggregate({
        where: salesWhere,
        _sum: { grandTotal: true, discountTotal: true, taxTotal: true, subtotal: true },
      }),
      prisma.pOSSale.count({ where: salesWhere }),
      prisma.pOSSalePayment.groupBy({
        by: ['paymentMethod'],
        where: { posSale: salesWhere },
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.pOSCashTransaction.aggregate({ where: { shiftId, type: 'CASH_IN' }, _sum: { amount: true } }),
      prisma.pOSCashTransaction.aggregate({ where: { shiftId, type: 'CASH_OUT' }, _sum: { amount: true } }),
      prisma.pOSReturn.aggregate({
        where: { shiftId, companyId },
        _sum: { refundedAmount: true },
        _count: { id: true },
      }),
      prisma.pOSSale.findMany({
        where: salesWhere,
        select: { id: true, invoiceNumber: true, grandTotal: true, createdAt: true, customerName: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);

    const cashSales =
      payments.find((p) => String(p.paymentMethod).toLowerCase() === 'cash')?._sum?.amount || 0;
    const cashRefunds = returns._sum.refundedAmount || 0;
    const expectedCash =
      (shift.openingCash || 0) +
      (cashIn._sum.amount || 0) +
      cashSales -
      (cashOut._sum.amount || 0) -
      cashRefunds;

    res.json({
      success: true,
      data: {
        type: shift.status === 'Closed' ? 'Z' : 'X',
        shift,
        summary: {
          salesCount,
          subtotal: salesAgg._sum.subtotal || 0,
          discountTotal: salesAgg._sum.discountTotal || 0,
          taxTotal: salesAgg._sum.taxTotal || 0,
          grandTotal: salesAgg._sum.grandTotal || 0,
          returnsCount: returns._count.id || 0,
          returnsTotal: cashRefunds,
          cashIn: cashIn._sum.amount || 0,
          cashOut: cashOut._sum.amount || 0,
          openingCash: shift.openingCash || 0,
          expectedCash,
          actualCash: shift.actualCash,
          difference: shift.difference,
        },
        paymentBreakdown: payments,
        recentSales: sales,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  completeSale, syncSales, holdSale, getHeldSales, deleteHeldSale,
  listSales, getSale, processReturn, getDailyReport, searchProducts, getProductByBarcode, getAuditLogs,
  convertToInvoice, voidSale, verifyManager, getShiftReport,
};
