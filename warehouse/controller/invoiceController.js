const WarehouseInvoice = require('../models/WarehouseInvoice');
const prisma = require('../../prisma/client');

// ============================================================
// @desc    Create Invoice (Manual)
// @route   POST /api/warehouse/invoice
// @access  Private
// ============================================================
const createInvoice = async (req, res) => {
  try {
    const {
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      billingAddress,
      orderId,
      orderNumber,
      invoiceDate,
      dueDate,
      items,
      discountTotal,
      notes,
    } = req.body;

    // ─── Validation ──────────────────────────────────────
    if (!customerName) {
      return res.status(400).json({ success: false, message: 'Customer name is required' });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item is required' });
    }

    // ─── Calculate Totals ────────────────────────────────
    let subtotal = 0;
    let taxTotal = 0;

    const processedItems = items.map((item) => {
      const qty = item.quantity || 1;
      const price = item.unitPrice || 0;
      const totalPrice = qty * price;
      const taxRate = item.taxRate || 0;
      const taxAmount = totalPrice * (taxRate / 100);
      const discount = item.discount || 0;

      subtotal += totalPrice;
      taxTotal += taxAmount;

      return {
        productId: item.productId || null,
        productName: item.productName || item.description || '',
        sku: item.sku || '',
        description: item.description || '',
        quantity: qty,
        unitPrice: price,
        taxRate,
        taxAmount,
        discount,
        totalPrice: totalPrice + taxAmount - discount,
      };
    });

    const discountAmount = discountTotal || 0;
    const grandTotal = subtotal + taxTotal - discountAmount;

    if (grandTotal < 0) {
      return res.status(400).json({ success: false, message: 'Grand total cannot be negative' });
    }

    // ─── Customer check ──────────────────────────────────
    if (customerId) {
      const customer = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!customer) {
        return res.status(404).json({ success: false, message: 'Customer not found' });
      }
    }

    // ─── Order check ─────────────────────────────────────
    if (orderId) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }
    }

    // ─── Create Invoice ──────────────────────────────────
    const invoice = await WarehouseInvoice.create({
      customerId: customerId || null,
      customerName,
      customerEmail,
      customerPhone,
      billingAddress,
      orderId: orderId || null,
      orderNumber: orderNumber || null,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
      dueDate: dueDate
        ? new Date(dueDate)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      items: processedItems,
      subtotal,
      taxTotal,
      discountTotal: discountAmount,
      grandTotal,
      notes: notes || '',
      createdBy: req.user.id,
    });

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      data: invoice,
    });
  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create invoice',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ============================================================
// @desc    Get All Invoices
// @route   GET /api/warehouse/invoice
// @access  Private
// ============================================================
const getInvoices = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      paymentStatus,
      invoiceStatus,
      customerId,
      orderId,
      fromDate,
      toDate,
      sortBy = 'invoiceDate',
      sortOrder = 'desc',
    } = req.query;

    const filter = { isActive: true, isDeleted: false };

    if (search) {
      filter.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { orderNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (paymentStatus && paymentStatus !== 'all') filter.paymentStatus = paymentStatus;
    if (invoiceStatus && invoiceStatus !== 'all') filter.invoiceStatus = invoiceStatus;
    if (customerId) filter.customerId = customerId;
    if (orderId) filter.orderId = orderId;

    if (fromDate || toDate) {
      filter.invoiceDate = {};
      if (fromDate) filter.invoiceDate.gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        filter.invoiceDate.lte = end;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };

    const [invoices, total] = await Promise.all([
      WarehouseInvoice.findAll(filter, { skip, take: limitNum, orderBy }),
      WarehouseInvoice.count(filter),
    ]);

    const stats = await WarehouseInvoice.getStats();

    res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices,
      stats,
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
    console.error('Get invoices error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch invoices', error: error.message });
  }
};

// ============================================================
// @desc    Get Invoice by ID
// @route   GET /api/warehouse/invoice/:id
// @access  Private
// ============================================================
const getInvoiceById = async (req, res) => {
  try {
    const invoice = await WarehouseInvoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch invoice', error: error.message });
  }
};

// ============================================================
// @desc    Get Invoice by Invoice Number
// @route   GET /api/warehouse/invoice/number/:invoiceNumber
// @access  Private
// ============================================================
const getInvoiceByNumber = async (req, res) => {
  try {
    const invoice = await WarehouseInvoice.findByInvoiceNumber(req.params.invoiceNumber);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    console.error('Get invoice by number error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch invoice', error: error.message });
  }
};

// ============================================================
// @desc    Get Invoices by Order ID
// @route   GET /api/warehouse/invoice/order/:orderId
// @access  Private
// ============================================================
const getInvoicesByOrder = async (req, res) => {
  try {
    const invoices = await WarehouseInvoice.findByOrderId(req.params.orderId);
    res.status(200).json({ success: true, data: invoices });
  } catch (error) {
    console.error('Get order invoices error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch order invoices', error: error.message });
  }
};

// ============================================================
// @desc    Update Invoice
// @route   PUT /api/warehouse/invoice/:id
// @access  Private
// ============================================================
const updateInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await WarehouseInvoice.findById(id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (invoice.paymentStatus === 'Paid') {
      return res.status(400).json({ success: false, message: 'Cannot update a paid invoice' });
    }

    const {
      customerName,
      customerEmail,
      customerPhone,
      billingAddress,
      dueDate,
      items,
      discountTotal,
      notes,
    } = req.body;

    const updateData = { updatedBy: req.user.id };

    if (customerName) updateData.customerName = customerName;
    if (customerEmail !== undefined) updateData.customerEmail = customerEmail;
    if (customerPhone !== undefined) updateData.customerPhone = customerPhone;
    if (billingAddress) updateData.billingAddress = billingAddress;
    if (dueDate) updateData.dueDate = new Date(dueDate);
    if (notes !== undefined) updateData.notes = notes;

    // ─── Recalculate if items changed ───────────────────
    if (items && items.length > 0) {
      let subtotal = 0;
      let taxTotal = 0;

      const processedItems = items.map((item) => {
        const qty = item.quantity || 1;
        const price = item.unitPrice || 0;
        const totalPrice = qty * price;
        const taxRate = item.taxRate || 0;
        const taxAmount = totalPrice * (taxRate / 100);
        const discount = item.discount || 0;

        subtotal += totalPrice;
        taxTotal += taxAmount;

        return {
          invoiceId: id,
          productId: item.productId || null,
          productName: item.productName || item.description || '',
          sku: item.sku || '',
          description: item.description || '',
          quantity: qty,
          unitPrice: price,
          taxRate,
          taxAmount,
          discount,
          totalPrice: totalPrice + taxAmount - discount,
        };
      });

      const discountAmount = discountTotal || invoice.discountTotal || 0;
      const grandTotal = subtotal + taxTotal - discountAmount;

      // Delete old items and create new
      await prisma.warehouseInvoiceItem.deleteMany({ where: { invoiceId: id } });
      await prisma.warehouseInvoiceItem.createMany({ data: processedItems });

      updateData.subtotal = subtotal;
      updateData.taxTotal = taxTotal;
      updateData.discountTotal = discountAmount;
      updateData.grandTotal = grandTotal;

      // Recalculate payment status
      updateData.paymentStatus = getPaymentStatusHelper(
        grandTotal,
        invoice.paidAmount,
        updateData.dueDate || invoice.dueDate
      );
    }

    const updated = await WarehouseInvoice.update(id, updateData);

    res.status(200).json({
      success: true,
      message: 'Invoice updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Update invoice error:', error);
    res.status(500).json({ success: false, message: 'Failed to update invoice', error: error.message });
  }
};

// ============================================================
// @desc    Apply Payment to Invoice
// @route   PATCH /api/warehouse/invoice/:id/payment
// @access  Private
// ============================================================
const applyPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Payment amount must be greater than 0' });
    }

    const invoice = await WarehouseInvoice.findById(id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (invoice.paymentStatus === 'Paid') {
      return res.status(400).json({ success: false, message: 'Invoice is already paid' });
    }

    const outstanding = invoice.grandTotal - invoice.paidAmount;
    if (amount > outstanding) {
      return res.status(400).json({
        success: false,
        message: `Payment amount exceeds outstanding balance (Rs. ${outstanding})`,
      });
    }

    const updated = await WarehouseInvoice.applyPayment(id, amount, req.user.id);

    res.status(200).json({
      success: true,
      message: 'Payment applied successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Apply payment error:', error);
    res.status(500).json({ success: false, message: 'Failed to apply payment', error: error.message });
  }
};

// ============================================================
// @desc    Mark Invoice as Overdue (batch)
// @route   PATCH /api/warehouse/invoice/mark-overdue
// @access  Private (Admin)
// ============================================================
const markOverdueInvoices = async (req, res) => {
  try {
    const result = await WarehouseInvoice.markOverdue();
    res.status(200).json({
      success: true,
      message: `${result.count} invoices marked as overdue`,
      data: result,
    });
  } catch (error) {
    console.error('Mark overdue error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark overdue invoices', error: error.message });
  }
};

// ============================================================
// @desc    Delete Invoice (Soft Delete)
// @route   DELETE /api/warehouse/invoice/:id
// @access  Private
// ============================================================
const deleteInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await WarehouseInvoice.findById(id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (invoice.paymentStatus === 'Paid') {
      return res.status(400).json({ success: false, message: 'Cannot delete a paid invoice' });
    }

    if (invoice.paidAmount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete invoice with partial payment',
      });
    }

    await WarehouseInvoice.softDelete(id, req.user.id);

    res.status(200).json({ success: true, message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error('Delete invoice error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete invoice', error: error.message });
  }
};

// ============================================================
// @desc    Get Invoice Stats
// @route   GET /api/warehouse/invoice/stats
// @access  Private
// ============================================================
const getInvoiceStats = async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const stats = await WarehouseInvoice.getStats(period);
    const trend = await WarehouseInvoice.getDailyTrend(30);

    res.status(200).json({ success: true, data: { ...stats, trend } });
  } catch (error) {
    console.error('Get invoice stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch invoice stats', error: error.message });
  }
};

// ─── Helper ──────────────────────────────────────────────────
function getPaymentStatusHelper(grandTotal, paidAmount, dueDate) {
  const outstanding = grandTotal - paidAmount;
  if (outstanding <= 0) return 'Paid';
  if (paidAmount > 0 && outstanding > 0) return 'Partial';
  if (new Date(dueDate) < new Date() && outstanding > 0) return 'Overdue';
  return 'Unpaid';
}

module.exports = {
  createInvoice,
  getInvoices,
  getInvoiceById,
  getInvoiceByNumber,
  getInvoicesByOrder,
  updateInvoice,
  applyPayment,
  markOverdueInvoices,
  deleteInvoice,
  getInvoiceStats,
};