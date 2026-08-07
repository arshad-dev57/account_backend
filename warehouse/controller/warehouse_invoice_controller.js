const WarehouseInvoice = require('../models/WarehouseInvoice');
const Order = require('../models/Order');
const prisma = require('../../prisma/client');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizePaymentStatus(status) {
  const s = String(status || 'Unpaid');
  const lower = s.toLowerCase();
  if (lower === 'paid') return 'Paid';
  if (lower === 'partial' || lower === 'partially paid') return 'Partial';
  if (lower === 'cancelled' || lower === 'voided') return 'Cancelled';
  if (lower === 'overdue') return 'Overdue';
  if (lower === 'unpaid') return 'Unpaid';
  return s;
}

function companyScope(user) {
  if (user.companyId) {
    return {
      OR: [
        { companyId: user.companyId },
        { companyId: null, createdBy: user.id },
      ],
    };
  }
  return { createdBy: user.id };
}

function buildSalesWhere(req) {
  const { search, status, paymentStatus, fromDate, toDate } = req.query;
  const andClauses = [
    { isActive: true },
    { isDeleted: false },
    companyScope(req.user),
  ];

  if (status && status !== 'all') andClauses.push({ invoiceStatus: status });
  if (paymentStatus && paymentStatus !== 'all') {
    andClauses.push({
      OR: [
        { paymentStatus },
        { paymentStatus: String(paymentStatus).toLowerCase() },
      ],
    });
  }
  if (fromDate || toDate) {
    const invoiceDate = {};
    if (fromDate) invoiceDate.gte = new Date(fromDate);
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      invoiceDate.lte = end;
    }
    andClauses.push({ invoiceDate });
  }
  if (search) {
    andClauses.push({
      OR: [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { orderNumber: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  return { AND: andClauses };
}

function buildPurchaseWhere(req) {
  const { search, status, paymentStatus, fromDate, toDate } = req.query;
  const andClauses = [
    { isActive: true },
    { isDeleted: false },
    companyScope(req.user),
  ];

  if (status && status !== 'all') {
    andClauses.push({
      OR: [
        { invoiceStatus: status },
        { invoiceStatus: String(status).toLowerCase() },
      ],
    });
  }
  if (paymentStatus && paymentStatus !== 'all') {
    andClauses.push({
      OR: [
        { paymentStatus },
        { paymentStatus: String(paymentStatus).toLowerCase() },
      ],
    });
  }
  if (fromDate || toDate) {
    const invoiceDate = {};
    if (fromDate) invoiceDate.gte = new Date(fromDate);
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      invoiceDate.lte = end;
    }
    andClauses.push({ invoiceDate });
  }
  if (search) {
    andClauses.push({
      OR: [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
        { purchaseOrderNumber: { contains: search, mode: 'insensitive' } },
        { supplierInvoiceNo: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  return { AND: andClauses };
}

function mapSalesInvoice(inv, creditIssued = 0) {
  const grandTotal = toNum(inv.grandTotal);
  const paidAmount = toNum(inv.paidAmount);
  const netOutstanding = grandTotal - paidAmount - creditIssued;
  const paymentStatus = normalizePaymentStatus(inv.paymentStatus);

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    orderId: inv.orderId || null,
    orderNumber: inv.orderNumber || null,
    customerId: inv.customerId || null,
    customerName: inv.customerName || '',
    customerEmail: inv.customerEmail || null,
    customerPhone: inv.customerPhone || null,
    partyName: inv.customerName || '',
    partyType: 'customer',
    subtotal: toNum(inv.subtotal),
    taxTotal: toNum(inv.taxTotal),
    discountTotal: toNum(inv.discountTotal),
    grandTotal,
    paidAmount,
    outstanding: toNum(inv.outstanding) || Math.max(0, netOutstanding),
    creditIssued,
    netOutstanding,
    invoiceStatus: inv.invoiceStatus || paymentStatus,
    paymentStatus,
    displayStatus: netOutstanding < 0 ? 'Credit Balance' : paymentStatus,
    notes: inv.notes || '',
    items: inv.items || [],
    invoiceType: 'sales',
    source: 'warehouse_invoice',
  };
}

function buildSalesInvoiceWhere(req) {
  const { search, status, paymentStatus, fromDate, toDate } = req.query;
  const andClauses = [
    { isActive: true },
    { isDeleted: false },
    companyScope(req.user),
  ];

  if (status && status !== 'all') {
    andClauses.push({
      OR: [
        { invoiceStatus: status },
        { invoiceStatus: String(status).toLowerCase() },
      ],
    });
  }
  if (paymentStatus && paymentStatus !== 'all') {
    andClauses.push({
      OR: [
        { paymentStatus },
        { paymentStatus: String(paymentStatus).toLowerCase() },
      ],
    });
  }
  if (fromDate || toDate) {
    const invoiceDate = {};
    if (fromDate) invoiceDate.gte = new Date(fromDate);
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      invoiceDate.lte = end;
    }
    andClauses.push({ invoiceDate });
  }
  if (search) {
    andClauses.push({
      OR: [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { orderNumber: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  return { AND: andClauses };
}

function mapModuleSalesInvoice(inv) {
  const grandTotal = toNum(inv.grandTotal);
  const paidAmount = toNum(inv.paidAmount);
  const outstanding = toNum(inv.outstanding) || Math.max(0, grandTotal - paidAmount);
  const paymentStatus = normalizePaymentStatus(inv.paymentStatus);

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    orderId: inv.orderId || null,
    orderNumber: inv.orderNumber || null,
    customerId: inv.customerId || null,
    customerName: inv.customerName || '',
    customerEmail: inv.customerEmail || null,
    customerPhone: inv.customerPhone || null,
    partyName: inv.customerName || '',
    partyType: 'customer',
    subtotal: toNum(inv.subtotal),
    taxTotal: toNum(inv.taxTotal),
    discountTotal: toNum(inv.discountTotal),
    grandTotal,
    paidAmount,
    outstanding,
    creditIssued: 0,
    netOutstanding: outstanding,
    invoiceStatus: inv.invoiceStatus || paymentStatus,
    paymentStatus,
    displayStatus: paymentStatus,
    notes: inv.notes || '',
    items: (inv.items || []).map((it) => ({
      id: it.id,
      productId: it.productId || null,
      productName: it.productName || '',
      sku: it.sku || null,
      description: it.notes || null,
      quantity: it.quantity || 0,
      unitPrice: toNum(it.unitPrice),
      taxRate: toNum(it.taxRate),
      taxAmount: toNum(it.taxAmount),
      discount: toNum(it.discount),
      totalPrice: toNum(it.lineTotal ?? it.totalPrice),
    })),
    invoiceType: 'sales',
    source: 'sales_invoice',
  };
}

function mapPurchaseInvoice(inv) {
  const grandTotal = toNum(inv.grandTotal);
  const paidAmount = toNum(inv.paidAmount);
  const outstanding = toNum(inv.outstanding) || Math.max(0, grandTotal - paidAmount);
  const paymentStatus = normalizePaymentStatus(inv.paymentStatus);

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    orderId: inv.purchaseOrderId || null,
    orderNumber: inv.purchaseOrderNumber || null,
    customerId: inv.supplierId || null,
    customerName: inv.supplierName || '',
    customerEmail: inv.supplierEmail || null,
    customerPhone: inv.supplierPhone || null,
    partyName: inv.supplierName || '',
    partyType: 'supplier',
    subtotal: toNum(inv.subtotal),
    taxTotal: toNum(inv.taxTotal),
    discountTotal: toNum(inv.discountTotal),
    grandTotal,
    paidAmount,
    outstanding,
    creditIssued: 0,
    netOutstanding: outstanding,
    invoiceStatus: inv.invoiceStatus || paymentStatus,
    paymentStatus,
    displayStatus: paymentStatus,
    notes: inv.notes || '',
    items: (inv.items || []).map((it) => ({
      id: it.id,
      productId: it.productId || null,
      productName: it.productName || '',
      sku: it.sku || null,
      description: it.notes || null,
      quantity: it.quantity || 0,
      unitPrice: toNum(it.unitPrice),
      taxRate: toNum(it.taxRate),
      taxAmount: toNum(it.taxAmount),
      discount: toNum(it.discount),
      totalPrice: toNum(it.lineTotal ?? it.totalPrice),
    })),
    invoiceType: 'purchase',
    source: 'purchase_invoice',
  };
}

function computeCombinedStats(rows) {
  const stats = {
    total: rows.length,
    unpaid: 0,
    partial: 0,
    paid: 0,
    overdue: 0,
    cancelled: 0,
    grandTotal: 0,
    paidAmount: 0,
    outstanding: 0,
    taxTotal: 0,
    salesCount: 0,
    purchaseCount: 0,
    salesTotal: 0,
    purchaseTotal: 0,
  };

  const now = new Date();
  rows.forEach((r) => {
    const pay = normalizePaymentStatus(r.paymentStatus);
    if (pay === 'Paid') stats.paid += 1;
    else if (pay === 'Partial') stats.partial += 1;
    else if (pay === 'Cancelled') stats.cancelled += 1;
    else if (r.dueDate && new Date(r.dueDate) < now && pay !== 'Paid') stats.overdue += 1;
    else stats.unpaid += 1;

    stats.grandTotal += toNum(r.grandTotal);
    stats.paidAmount += toNum(r.paidAmount);
    stats.outstanding += toNum(r.outstanding ?? r.netOutstanding);
    stats.taxTotal += toNum(r.taxTotal);

    if (r.invoiceType === 'purchase') {
      stats.purchaseCount += 1;
      stats.purchaseTotal += toNum(r.grandTotal);
    } else {
      stats.salesCount += 1;
      stats.salesTotal += toNum(r.grandTotal);
    }
  });

  return stats;
}

const getInvoices = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      invoiceType = 'all', // all | sales | purchase
      period = 'month',
    } = req.query;

    const type = String(invoiceType || 'all').toLowerCase();
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const includeSales = type === 'all' || type === 'sales';
    const includePurchase = type === 'all' || type === 'purchase';

    const [salesRows, moduleSalesRows, purchaseRows] = await Promise.all([
      includeSales
        ? prisma.warehouseInvoice.findMany({
            where: buildSalesWhere(req),
            include: {
              items: true,
              creator: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
            },
            orderBy: { invoiceDate: 'desc' },
          })
        : Promise.resolve([]),
      includeSales
        ? prisma.salesInvoice.findMany({
            where: buildSalesInvoiceWhere(req),
            include: {
              items: true,
              creator: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
            },
            orderBy: { invoiceDate: 'desc' },
          })
        : Promise.resolve([]),
      includePurchase
        ? prisma.purchaseInvoice.findMany({
            where: buildPurchaseWhere(req),
            include: {
              items: true,
              creator: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
            },
            orderBy: { invoiceDate: 'desc' },
          })
        : Promise.resolve([]),
    ]);

    let creditMap = {};
    if (salesRows.length > 0) {
      const invoiceIds = salesRows.map((inv) => inv.id);
      const creditAgg = await prisma.creditNote.groupBy({
        by: ['originalInvoiceId'],
        where: {
          originalInvoiceId: { in: invoiceIds },
          status: { notIn: ['Cancelled', 'Voided'] },
        },
        _sum: { amount: true },
      });
      creditMap = Object.fromEntries(
        creditAgg.map((c) => [c.originalInvoiceId, c._sum.amount || 0])
      );
    }

    const mappedSales = [
      ...salesRows.map((inv) => mapSalesInvoice(inv, creditMap[inv.id] || 0)),
      ...moduleSalesRows.map(mapModuleSalesInvoice),
    ];
    const mappedPurchases = purchaseRows.map(mapPurchaseInvoice);

    const combined = [...mappedSales, ...mappedPurchases].sort(
      (a, b) => new Date(b.invoiceDate) - new Date(a.invoiceDate)
    );

    const total = combined.length;
    const pages = Math.max(1, Math.ceil(total / limitNum) || 1);
    const pageRows = combined.slice(skip, skip + limitNum);
    const stats = computeCombinedStats(combined);
    const trend = includeSales
      ? await WarehouseInvoice.getDailyTrend(30, req.user.companyId || null)
      : [];

    res.status(200).json({
      success: true,
      data: pageRows,
      stats,
      trend,
      filters: {
        invoiceType: type,
        availableTypes: ['all', 'sales', 'purchase'],
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages,
        hasNext: pageNum < pages,
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    console.error('Get warehouse invoices error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getInvoiceById = async (req, res) => {
  try {
    const invoice = await WarehouseInvoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getInvoiceStats = async (req, res) => {
  try {
    const stats = await WarehouseInvoice.getStats(req.query.period || 'month');
    const trend = await WarehouseInvoice.getDailyTrend(parseInt(req.query.days) || 30);
    res.status(200).json({ success: true, stats, trend });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createInvoice = async (req, res) => {
  try {
    const {
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      billingAddress,
      dueDate,
      invoiceDate,
      items,
      discountTotal,
      notes,
      orderId,
      orderNumber,
      invoiceStatus,
    } = req.body;

    if (!customerName) {
      return res.status(400).json({ success: false, message: 'Customer name is required' });
    }
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item is required' });
    }
    if (!dueDate) {
      return res.status(400).json({ success: false, message: 'Due date is required' });
    }

    let subtotal = 0;
    let taxTotal = 0;
    const processedItems = items.map((item) => {
      const qty = parseInt(item.quantity) || 1;
      const unitPrice = parseFloat(item.unitPrice) || 0;
      const taxRate = parseFloat(item.taxRate) || 0;
      const discount = parseFloat(item.discount) || 0;
      const amount = qty * unitPrice - discount;
      const taxAmount = amount * (taxRate / 100);
      subtotal += amount;
      taxTotal += taxAmount;
      return {
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        description: item.description || item.productName,
        quantity: qty,
        unitPrice,
        taxRate,
        taxAmount,
        discount,
        totalPrice: amount + taxAmount,
      };
    });

    const discount = parseFloat(discountTotal) || 0;
    const grandTotal = subtotal + taxTotal - discount;

    const invoice = await WarehouseInvoice.create({
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      billingAddress,
      dueDate,
      invoiceDate,
      orderId,
      orderNumber,
      subtotal,
      taxTotal,
      discountTotal: discount,
      grandTotal,
      invoiceStatus: invoiceStatus || 'Sent',
      paymentStatus: 'Unpaid',
      notes,
      items: processedItems,
      createdBy: req.user.id,
    });

    res.status(201).json({ success: true, message: 'Invoice created', data: invoice });
  } catch (error) {
    console.error('Create warehouse invoice error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const createInvoiceFromOrder = async (req, res) => {
  try {
    const { id: orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const existing = await prisma.warehouseInvoice.findFirst({
      where: { orderId, isDeleted: false, invoiceStatus: { not: 'Cancelled' } },
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Invoice already exists for this order: ${existing.invoiceNumber}`,
        data: existing,
      });
    }

    const dueDate = req.body.dueDate || new Date(Date.now() + 30 * 86400000).toISOString();
    const items = order.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      description: `${item.productName} (${item.sku})`,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate || 0,
      taxAmount: item.taxAmount || 0,
      discount: item.discount || 0,
      totalPrice: item.totalPrice,
    }));

    const invoice = await WarehouseInvoice.create({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      billingAddress: order.billingAddress,
      dueDate,
      invoiceDate: new Date().toISOString(),
      subtotal: order.subtotal,
      taxTotal: order.taxTotal,
      discountTotal: order.discountTotal,
      grandTotal: order.grandTotal,
      invoiceStatus: 'Sent',
      paymentStatus: order.paymentStatus === 'Paid' ? 'Paid' : 'Unpaid',
      paidAmount: order.paymentStatus === 'Paid' ? order.grandTotal : 0,
      notes: order.customerNotes || '',
      items,
      createdBy: req.user.id,
    });

    res.status(201).json({ success: true, message: 'Invoice created from order', data: invoice });
  } catch (error) {
    console.error('Create invoice from order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateInvoiceStatus = async (req, res) => {
  try {
    const { invoiceStatus, paymentStatus, paidAmount } = req.body;
    const data = { updatedBy: req.user.id };
    if (invoiceStatus) data.invoiceStatus = invoiceStatus;
    if (paymentStatus) data.paymentStatus = paymentStatus;
    if (paidAmount !== undefined) data.paidAmount = parseFloat(paidAmount);

    const invoice = await WarehouseInvoice.update(req.params.id, data);
    res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const recordPayment = async (req, res) => {
  try {
    const { amount } = req.body;
    const invoice = await WarehouseInvoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const pay = parseFloat(amount) || 0;
    const newPaid = (invoice.paidAmount || 0) + pay;
    let paymentStatus = 'Partial';
    if (newPaid >= invoice.grandTotal) paymentStatus = 'Paid';
    else if (newPaid <= 0) paymentStatus = 'Unpaid';

    const updated = await WarehouseInvoice.update(req.params.id, {
      paidAmount: Math.min(newPaid, invoice.grandTotal),
      paymentStatus,
      invoiceStatus: paymentStatus === 'Paid' ? 'Paid' : invoice.invoiceStatus,
      updatedBy: req.user.id,
    });

    res.status(200).json({ success: true, message: 'Payment recorded', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteInvoice = async (req, res) => {
  try {
    const invoice = await WarehouseInvoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (invoice.paymentStatus === 'Paid') {
      return res.status(400).json({ success: false, message: 'Cannot delete paid invoice' });
    }
    await WarehouseInvoice.softDelete(req.params.id, req.user.id);
    res.status(200).json({ success: true, message: 'Invoice deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getInvoices,
  getInvoiceById,
  getInvoiceStats,
  createInvoice,
  createInvoiceFromOrder,
  updateInvoiceStatus,
  recordPayment,
  deleteInvoice,
};
