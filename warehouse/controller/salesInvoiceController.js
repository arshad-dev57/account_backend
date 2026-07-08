// warehouse/controller/salesInvoiceController.js - COMPLETE SALES INVOICE CONTROLLER

const SalesInvoice = require('../models/SalesInvoice');
const prisma = require('../../prisma/client');

// ============================================================
// ─── SALES INVOICE CONTROLLERS ──────────────────────────────
// ============================================================

// @desc    Create Sales Invoice from Order
// @route   POST /api/sales/invoices/from-order
// @access  Private
const createInvoiceFromOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId, dueDate, paymentTerms } = req.body;

    // ─── Validation ──────────────────────────────────────
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    // ─── Check if order exists ──────────────────────────
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // ─── Create Invoice ──────────────────────────────────
    const invoice = await SalesInvoice.createFromOrder(
      orderId,
      userId,
      dueDate,
      paymentTerms
    );

    res.status(201).json({
      success: true,
      message: 'Sales invoice created successfully',
      data: invoice
    });
  } catch (error) {
    console.error('Create invoice from order error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Create Manual Sales Invoice
// @route   POST /api/sales/invoices/manual
// @access  Private
const createManualInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      billingAddress,
      shippingAddress,
      items,
      dueDate,
      paymentTerms,
      notes
    } = req.body;

    // ─── Validation ──────────────────────────────────────
    if (!customerId && !customerName) {
      return res.status(400).json({
        success: false,
        message: 'Customer is required'
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invoice must have at least one item'
      });
    }

    // ─── Process Items ──────────────────────────────────
    const processedItems = [];
    for (const item of items) {
      let product;

      if (item.productId) {
        product = await prisma.product.findFirst({
          where: {
            id: item.productId,
            userId: userId,
            isActive: true
          }
        });
      } else if (item.sku) {
        product = await prisma.product.findFirst({
          where: {
            sku: item.sku,
            userId: userId,
            isActive: true
          }
        });
      }

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.productName || item.sku || item.productId}`
        });
      }

      processedItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice || product.sellingPrice,
        discount: item.discount || 0,
        taxRate: item.taxRate || product.taxRate || 0,
        notes: item.notes || '',
      });
    }

    // ─── Create Invoice ──────────────────────────────────
    const invoiceData = {
      customerId: customerId || '',
      customerName: customerName,
      customerEmail: customerEmail,
      customerPhone: customerPhone,
      billingAddress: billingAddress || {},
      shippingAddress: shippingAddress || {},
      items: processedItems,
      dueDate: dueDate,
      paymentTerms: paymentTerms,
      notes: notes,
      userId: userId,
      createdBy: userId
    };

    const invoice = await SalesInvoice.createManual(invoiceData);

    res.status(201).json({
      success: true,
      message: 'Sales invoice created successfully',
      data: invoice
    });
  } catch (error) {
    console.error('Create manual invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Post Invoice (Create Accounting Entries)
// @route   POST /api/sales/invoices/:id/post
// @access  Private
const postInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // ─── Check if invoice exists ────────────────────────
    const invoice = await prisma.salesInvoice.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    if (invoice.invoiceStatus === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Invoice already posted'
      });
    }

    if (invoice.invoiceStatus === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot post cancelled invoice'
      });
    }

    // ─── Post Invoice ────────────────────────────────────
    const postedInvoice = await SalesInvoice.postInvoice(id, userId);

    res.status(200).json({
      success: true,
      message: 'Invoice posted successfully',
      data: postedInvoice
    });
  } catch (error) {
    console.error('Post invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get All Sales Invoices with Filters
// @route   GET /api/sales/invoices
// @access  Private
const getSalesInvoices = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      search,
      status,
      paymentStatus,
      customerId,
      fromDate,
      toDate,
      sortBy = 'invoiceDate',
      sortOrder = 'desc'
    } = req.query;

    const filter = {
      userId: userId,
      isActive: true,
      isDeleted: false
    };

    if (search) {
      filter.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { orderNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (status && status !== 'all') {
      filter.invoiceStatus = status;
    }

    if (paymentStatus && paymentStatus !== 'all') {
      filter.paymentStatus = paymentStatus;
    }

    if (customerId) {
      filter.customerId = customerId;
    }

    if (fromDate || toDate) {
      filter.invoiceDate = {};
      if (fromDate) filter.invoiceDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.invoiceDate.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };

    const [invoices, total, kpi, stats] = await Promise.all([
      SalesInvoice.findAll(filter, { skip, take: limitNum, orderBy }),
      SalesInvoice.count(filter),
      SalesInvoice.getStatusCounts(userId),
      SalesInvoice.getStats(userId)
    ]);

    res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices,
      kpi,
      stats,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Get sales invoices error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Sales Invoice by ID
// @route   GET /api/sales/invoices/:id
// @access  Private
const getSalesInvoiceById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const invoice = await prisma.salesInvoice.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, sellingPrice: true }
            }
          }
        },
        order: {
          include: {
            customer: true
          }
        },
        delivery: true,
        customer: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        },
        accountsReceivable: {
          include: {
            payments: true
          }
        },
        salesRevenueAccount: true,
        arAccount: true
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    res.status(200).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    console.error('Get sales invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Sales Invoice by Number
// @route   GET /api/sales/invoices/number/:invoiceNumber
// @access  Private
const getSalesInvoiceByNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const { invoiceNumber } = req.params;

    const invoice = await prisma.salesInvoice.findFirst({
      where: {
        invoiceNumber: invoiceNumber,
        userId: userId,
        isActive: true,
        isDeleted: false
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        customer: true,
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        },
        accountsReceivable: {
          include: {
            payments: true
          }
        }
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    res.status(200).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    console.error('Get sales invoice by number error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update Sales Invoice (Draft only)
// @route   PUT /api/sales/invoices/:id
// @access  Private
const updateSalesInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      billingAddress,
      shippingAddress,
      invoiceDate,
      dueDate,
      paymentTerms,
      items,
      notes,
      termsConditions
    } = req.body;

    // ─── Check if invoice exists ────────────────────────
    const invoice = await prisma.salesInvoice.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    if (invoice.invoiceStatus === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update posted invoice'
      });
    }

    if (invoice.invoiceStatus === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update cancelled invoice'
      });
    }

    // ─── Prepare update data ─────────────────────────────
    const updateData = {
      updatedBy: userId,
      ...(customerId && { customerId }),
      ...(customerName && { customerName }),
      ...(customerEmail !== undefined && { customerEmail }),
      ...(customerPhone !== undefined && { customerPhone }),
      ...(billingAddress && { billingAddress }),
      ...(shippingAddress && { shippingAddress }),
      ...(invoiceDate && { invoiceDate: new Date(invoiceDate) }),
      ...(dueDate && { dueDate: new Date(dueDate) }),
      ...(paymentTerms && { paymentTerms }),
      ...(notes !== undefined && { notes }),
      ...(termsConditions !== undefined && { termsConditions })
    };

    // ─── Process items if provided ──────────────────────
    if (items) {
      const processedItems = [];
      for (const item of items) {
        let product;

        if (item.productId) {
          product = await prisma.product.findFirst({
            where: {
              id: item.productId,
              userId: userId,
              isActive: true
            }
          });
        } else if (item.sku) {
          product = await prisma.product.findFirst({
            where: {
              sku: item.sku,
              userId: userId,
              isActive: true
            }
          });
        }

        if (!product) {
          return res.status(404).json({
            success: false,
            message: `Product not found: ${item.productName || item.sku || item.productId}`
          });
        }

        processedItems.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice || product.sellingPrice,
          discount: item.discount || 0,
          taxRate: item.taxRate || product.taxRate || 0,
          notes: item.notes || '',
        });
      }
      updateData.items = processedItems;
    }

    // ─── Update Invoice ──────────────────────────────────
    const updatedInvoice = await SalesInvoice.update(id, updateData);

    res.status(200).json({
      success: true,
      message: 'Invoice updated successfully',
      data: updatedInvoice
    });
  } catch (error) {
    console.error('Update sales invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Cancel Sales Invoice
// @route   POST /api/sales/invoices/:id/cancel
// @access  Private
const cancelSalesInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { reason } = req.body;

    // ─── Check if invoice exists ────────────────────────
    const invoice = await prisma.salesInvoice.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    if (invoice.invoiceStatus === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Invoice already cancelled'
      });
    }

    if (invoice.invoiceStatus === 'Posted' && invoice.paidAmount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel invoice with payments'
      });
    }

    // ─── Cancel Invoice ──────────────────────────────────
    const cancelledInvoice = await SalesInvoice.cancelInvoice(id, userId, reason);

    res.status(200).json({
      success: true,
      message: 'Invoice cancelled successfully',
      data: cancelledInvoice
    });
  } catch (error) {
    console.error('Cancel sales invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Delete Sales Invoice (Soft Delete)
// @route   DELETE /api/sales/invoices/:id
// @access  Private
const deleteSalesInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // ─── Check if invoice exists ────────────────────────
    const invoice = await prisma.salesInvoice.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    if (invoice.invoiceStatus === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete posted invoice'
      });
    }

    // ─── Soft Delete Invoice ────────────────────────────
    await SalesInvoice.softDelete(id, userId);

    res.status(200).json({
      success: true,
      message: 'Invoice deleted successfully'
    });
  } catch (error) {
    console.error('Delete sales invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Invoice Stats / KPI
// @route   GET /api/sales/invoices/stats
// @access  Private
const getInvoiceStats = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [kpi, stats] = await Promise.all([
      SalesInvoice.getStatusCounts(userId),
      SalesInvoice.getStats(userId)
    ]);

    res.status(200).json({
      success: true,
      data: {
        kpi,
        stats
      }
    });
  } catch (error) {
    console.error('Get invoice stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Customer Invoice Summary
// @route   GET /api/sales/invoices/customer/:customerId/summary
// @access  Private
const getCustomerInvoiceSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const { customerId } = req.params;

    const summary = await SalesInvoice.getCustomerSummary(userId, customerId);

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Get customer invoice summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Available Orders for Invoicing
// @route   GET /api/sales/invoices/available-orders
// @access  Private
const getAvailableOrdersForInvoicing = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, page = 1, limit = 20 } = req.query;

    const where = {
      userId: userId,
      isActive: true,
      isDeleted: false,
      orderType: 'Sales Order',
      orderStatus: {
    notIn: ['Cancelled']  // ✅ sirf yeh line change ki
      }
    };

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get orders that don't have invoices yet
    const orders = await prisma.order.findMany({
      where,
      include: {
        items: {
          include: {
            product: true
          }
        },
        customer: true,
        salesInvoices: {
          where: {
            isActive: true,
            isDeleted: false
          }
        }
      },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
      orderBy: {
        orderDate: 'desc'
      }
    });

    // Filter orders without invoices
    const availableOrders = orders.filter(order => order.salesInvoices.length === 0);

    const total = availableOrders.length;

    res.status(200).json({
      success: true,
      count: availableOrders.length,
      data: availableOrders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get available orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Print Invoice (Get PDF data)
// @route   GET /api/sales/invoices/:id/print
// @access  Private
const printInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const invoice = await prisma.salesInvoice.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      },
      include: {
        items: {
          include: {
            product: true
          }
        },
        customer: true,
        order: true,
        delivery: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Here you would generate PDF
    // For now, return the invoice data
    res.status(200).json({
      success: true,
      message: 'Invoice data for print',
      data: invoice
    });
  } catch (error) {
    console.error('Print invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Send Invoice via Email
// @route   POST /api/sales/invoices/:id/send
// @access  Private
const sendInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { email } = req.body;

    // ─── Check if invoice exists ────────────────────────
    const invoice = await prisma.salesInvoice.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Update invoice status to Sent if currently Draft
    let updatedInvoice = invoice;
    if (invoice.invoiceStatus === 'Draft') {
      updatedInvoice = await prisma.salesInvoice.update({
        where: { id: id },
        data: {
          invoiceStatus: 'Posted',
          sentAt: new Date(),
          updatedBy: userId
        }
      });
    }

    // Here you would send email with PDF attachment
    // For now, just return success

    res.status(200).json({
      success: true,
      message: `Invoice sent to ${email || invoice.customerEmail}`,
      data: updatedInvoice
    });
  } catch (error) {
    console.error('Send invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─── EXPORT CONTROLLERS ──────────────────────────────────────

module.exports = {
  createInvoiceFromOrder,
  createManualInvoice,
  postInvoice,
  getSalesInvoices,
  getSalesInvoiceById,
  getSalesInvoiceByNumber,
  updateSalesInvoice,
  cancelSalesInvoice,
  deleteSalesInvoice,
  getInvoiceStats,
  getCustomerInvoiceSummary,
  getAvailableOrdersForInvoicing,
  printInvoice,
  sendInvoice
};