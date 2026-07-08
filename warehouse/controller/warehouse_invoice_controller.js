const WarehouseInvoice = require('../models/WarehouseInvoice');
const Order = require('../models/Order');
const prisma = require('../../prisma/client');

const getInvoices = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      paymentStatus,
      fromDate,
      toDate,
      period = 'month',
    } = req.query;

    const filter = { isActive: true, isDeleted: false };

    if (status && status !== 'all') filter.invoiceStatus = status;
    if (paymentStatus && paymentStatus !== 'all') filter.paymentStatus = paymentStatus;

    if (fromDate || toDate) {
      filter.invoiceDate = {};
      if (fromDate) filter.invoiceDate.gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        filter.invoiceDate.lte = end;
      }
    }

    if (search) {
      filter.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { orderNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const [data, total, stats, trend] = await Promise.all([
      WarehouseInvoice.findAll(filter, { skip, take: limitNum }),
      WarehouseInvoice.count(filter),
      WarehouseInvoice.getStats(period),
      WarehouseInvoice.getDailyTrend(30),
    ]);

    res.status(200).json({
      success: true,
      data,
      stats,
      trend,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
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
