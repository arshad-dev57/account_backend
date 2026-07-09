
// warehouse/controller/purchaseInvoiceController.js - COMPLETE

const PurchaseInvoice = require('../models/PurchaseInvoice');
const prisma = require('../../prisma/client');

// ============================================================
// ─── PURCHASE INVOICE CONTROLLERS ──────────────────────────────
// ============================================================

// @desc    Create Purchase Invoice from Goods Receiving
// @route   POST /api/purchase/invoices/from-grn
// @access  Private
const createInvoiceFromGRN = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      goodsReceivingId,
      supplierInvoiceNo,
      invoiceDate,
      dueDate,
      paymentTerms,
      notes
    } = req.body;

    // ─── Validation ──────────────────────────────────────
    if (!goodsReceivingId) {
      return res.status(400).json({
        success: false,
        message: 'Goods receiving ID is required'
      });
    }

    // ─── Check if GRN exists ────────────────────────────
    const grn = await prisma.goodsReceiving.findFirst({
      where: {
        id: goodsReceivingId,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!grn) {
      return res.status(404).json({
        success: false,
        message: 'Goods receiving not found'
      });
    }

    if (grn.status === 'Draft') {
      return res.status(400).json({
        success: false,
        message: 'Cannot create invoice from draft GRN. Please confirm GRN first.'
      });
    }

    // ─── Check if invoice already exists ──────────────────
    const existingInvoice = await prisma.purchaseInvoice.findFirst({
      where: {
        goodsReceivingId: goodsReceivingId,
        isActive: true,
        isDeleted: false
      }
    });

    if (existingInvoice) {
      return res.status(400).json({
        success: false,
        message: 'Invoice already exists for this goods receiving'
      });
    }

    // ─── Create Invoice ──────────────────────────────────
    const invoiceData = {
      goodsReceivingId,
      supplierInvoiceNo,
      invoiceDate,
      dueDate,
      paymentTerms,
      notes,
      createdBy: userId,
      userId: userId
    };

    const invoice = await PurchaseInvoice.createFromGRN(invoiceData);

    res.status(201).json({
      success: true,
      message: 'Purchase invoice created successfully',
      data: invoice
    });
  } catch (error) {
    console.error('Create invoice from GRN error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Create Purchase Invoice from Purchase Order
// @route   POST /api/purchase/invoices/from-po
// @access  Private
const createInvoiceFromPurchaseOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      purchaseOrderId,
      supplierInvoiceNo,
      invoiceDate,
      dueDate,
      paymentTerms,
      notes
    } = req.body;

    // ─── Validation ──────────────────────────────────────
    if (!purchaseOrderId) {
      return res.status(400).json({
        success: false,
        message: 'Purchase order ID is required'
      });
    }

    // ─── Check if PO exists ─────────────────────────────
    const purchaseOrder = await prisma.purchaseOrder.findFirst({
      where: {
        id: purchaseOrderId,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    // ─── Check if invoice already exists ──────────────────
    const existingInvoice = await prisma.purchaseInvoice.findFirst({
      where: {
        purchaseOrderId: purchaseOrderId,
        isActive: true,
        isDeleted: false
      }
    });

    if (existingInvoice) {
      return res.status(400).json({
        success: false,
        message: 'Invoice already exists for this purchase order'
      });
    }

    // ─── Create Invoice ──────────────────────────────────
    const invoiceData = {
      purchaseOrderId,
      supplierInvoiceNo,
      invoiceDate,
      dueDate,
      paymentTerms,
      notes,
      createdBy: userId,
      userId: userId
    };

    const invoice = await PurchaseInvoice.createFromPurchaseOrder(invoiceData);

    res.status(201).json({
      success: true,
      message: 'Purchase invoice created successfully',
      data: invoice
    });
  } catch (error) {
    console.error('Create invoice from PO error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Post Purchase Invoice (Create Accounting Entries)
// @route   POST /api/purchase/invoices/:id/post
// @access  Private
const postPurchaseInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // ─── Check if invoice exists ────────────────────────
    const invoice = await prisma.purchaseInvoice.findFirst({
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
    const postedInvoice = await PurchaseInvoice.postInvoice(id, userId);

    res.status(200).json({
      success: true,
      message: 'Purchase invoice posted successfully',
      data: postedInvoice
    });
  } catch (error) {
    console.error('Post purchase invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get All Purchase Invoices with Filters
// @route   GET /api/purchase/invoices
// @access  Private
const getPurchaseInvoices = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      search,
      status,
      paymentStatus,
      supplierId,
      purchaseOrderId,
      goodsReceivingId,
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
        { supplierName: { contains: search, mode: 'insensitive' } },
        { supplierInvoiceNo: { contains: search, mode: 'insensitive' } },
        { purchaseOrderNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (status && status !== 'all') {
      filter.invoiceStatus = status;
    }

    if (paymentStatus && paymentStatus !== 'all') {
      filter.paymentStatus = paymentStatus;
    }

    if (supplierId) {
      filter.supplierId = supplierId;
    }

    if (purchaseOrderId) {
      filter.purchaseOrderId = purchaseOrderId;
    }

    if (goodsReceivingId) {
      filter.goodsReceivingId = goodsReceivingId;
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

    const [invoices, total, stats] = await Promise.all([
      PurchaseInvoice.findAll(filter, { skip, take: limitNum, orderBy }),
      PurchaseInvoice.count(filter),
      PurchaseInvoice.getStats(userId)
    ]);

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
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Get purchase invoices error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Purchase Invoice by ID
// @route   GET /api/purchase/invoices/:id
// @access  Private
const getPurchaseInvoiceById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const invoice = await prisma.purchaseInvoice.findFirst({
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
              select: { id: true, name: true, sku: true, costPrice: true }
            }
          }
        },
        supplier: true,
        purchaseOrder: {
          include: {
            supplier: true
          }
        },
        goodsReceiving: {
          include: {
            items: true
          }
        },
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
        accountsPayable: {
          include: {
            payments: true
          }
        },
        inventoryAccount: true,
        apAccount: true
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
    console.error('Get purchase invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Purchase Invoice by Number
// @route   GET /api/purchase/invoices/number/:invoiceNumber
// @access  Private
const getPurchaseInvoiceByNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const { invoiceNumber } = req.params;

    const invoice = await prisma.purchaseInvoice.findFirst({
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
        supplier: true,
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        },
        accountsPayable: {
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
    console.error('Get purchase invoice by number error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update Purchase Invoice (Draft only)
// @route   PUT /api/purchase/invoices/:id
// @access  Private
const updatePurchaseInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      supplierInvoiceNo,
      invoiceDate,
      dueDate,
      paymentTerms,
      items,
      notes,
      status
    } = req.body;

    // ─── Check if invoice exists ────────────────────────
    const invoice = await prisma.purchaseInvoice.findFirst({
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
      ...(supplierInvoiceNo !== undefined && { supplierInvoiceNo }),
      ...(invoiceDate && { invoiceDate: new Date(invoiceDate) }),
      ...(dueDate && { dueDate: new Date(dueDate) }),
      ...(paymentTerms && { paymentTerms }),
      ...(notes !== undefined && { notes }),
      ...(status && { invoiceStatus: status })
    };

    // ─── Process items if provided ──────────────────────
    if (items) {
      const processedItems = [];
      for (const item of items) {
        const product = await prisma.product.findFirst({
          where: {
            id: item.productId,
            userId: userId,
            isActive: true
          }
        });

        if (!product) {
          return res.status(404).json({
            success: false,
            message: `Product not found: ${item.productName || item.productId}`
          });
        }

        processedItems.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice || product.costPrice || 0,
          discount: item.discount || 0,
          taxRate: item.taxRate || product.taxRate || 0,
          notes: item.notes || '',
        });
      }
      updateData.items = processedItems;
    }

    // ─── Update Invoice ──────────────────────────────────
    const updatedInvoice = await PurchaseInvoice.update(id, updateData);

    res.status(200).json({
      success: true,
      message: 'Purchase invoice updated successfully',
      data: updatedInvoice
    });
  } catch (error) {
    console.error('Update purchase invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Cancel Purchase Invoice
// @route   POST /api/purchase/invoices/:id/cancel
// @access  Private
const cancelPurchaseInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { reason } = req.body;

    // ─── Check if invoice exists ────────────────────────
    const invoice = await prisma.purchaseInvoice.findFirst({
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
    const cancelledInvoice = await PurchaseInvoice.cancelInvoice(id, userId, reason);

    res.status(200).json({
      success: true,
      message: 'Purchase invoice cancelled successfully',
      data: cancelledInvoice
    });
  } catch (error) {
    console.error('Cancel purchase invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Delete Purchase Invoice (Soft Delete)
// @route   DELETE /api/purchase/invoices/:id
// @access  Private
const deletePurchaseInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // ─── Check if invoice exists ────────────────────────
    const invoice = await prisma.purchaseInvoice.findFirst({
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

    // ─── Soft Delete ─────────────────────────────────────
    await PurchaseInvoice.softDelete(id, userId);

    res.status(200).json({
      success: true,
      message: 'Purchase invoice deleted successfully'
    });
  } catch (error) {
    console.error('Delete purchase invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Purchase Invoice Stats
// @route   GET /api/purchase/invoices/stats
// @access  Private
const getPurchaseInvoiceStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const stats = await PurchaseInvoice.getStats(userId);

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get purchase invoice stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Supplier Purchase Invoice Summary
// @route   GET /api/purchase/invoices/supplier/:supplierId/summary
// @access  Private
const getSupplierPurchaseInvoiceSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const { supplierId } = req.params;

    const summary = await PurchaseInvoice.getSupplierSummary(userId, supplierId);

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Get supplier purchase invoice summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Available Goods Receivings for Invoicing
// @route   GET /api/purchase/invoices/available-grns
// @access  Private
const getAvailableGRNsForInvoicing = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, page = 1, limit = 20 } = req.query;

    console.log('🔵 [getAvailableGRNsForInvoicing] Called with search:', search);

    const where = {
      userId: userId,
      isActive: true,
      isDeleted: false,
      status: {
        in: ['Partially Received', 'Fully Received']
      }
    };

    // ✅ FIX: Allow search with minimum 2 characters
    if (search && search.trim().length >= 2) {
      where.OR = [
        { grnNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
        { purchaseOrderNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    // ✅ FIX: Don't filter by invoice existence - return ALL GRNs
    const grns = await prisma.goodsReceiving.findMany({
      where,
      include: {
        items: {
          include: {
            product: true,
            purchaseOrderItem: true
          }
        },
        supplier: true,
        purchaseOrder: true,
        purchaseInvoices: {
          where: {
            isActive: true,
            isDeleted: false
          },
          select: {
            id: true,
            invoiceNumber: true,
            invoiceStatus: true
          }
        }
      },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
      orderBy: {
        receivingDate: 'desc'
      }
    });

    console.log('🔵 [getAvailableGRNsForInvoicing] Found GRNs:', grns.length);

    // ✅ Add invoice status info
    const grnsWithStatus = grns.map(grn => ({
      ...grn,
      hasInvoice: grn.purchaseInvoices.length > 0,
      invoiceCount: grn.purchaseInvoices.length,
      invoices: grn.purchaseInvoices
    }));

    const total = grnsWithStatus.length;

    res.status(200).json({
      success: true,
      count: grnsWithStatus.length,
      data: grnsWithStatus,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ Get available GRNs error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
// @desc    Get Available Purchase Orders for Invoicing
// @route   GET /api/purchase/invoices/available-pos
// @access  Private
const getAvailablePOsForInvoicing = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, page = 1, limit = 20 } = req.query;

    console.log('🔵 [getAvailablePOsForInvoicing] Called with search:', search);

    const where = {
      userId: userId,
      isActive: true,
      isDeleted: false,
      status: {
        notIn: ['Cancelled', 'Draft']
      }
    };

    // ✅ FIX: Allow search with minimum 2 characters
    if (search && search.trim().length >= 2) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } }
      ];
    }

    // ✅ FIX: Don't filter by invoice existence - return ALL POs
    const pos = await prisma.purchaseOrder.findMany({
      where,
      include: {
        items: true,
        supplier: true,
        goodsReceivings: {
          where: {
            isActive: true,
            isDeleted: false,
            status: {
              in: ['Partially Received', 'Fully Received']
            }
          },
          include: {
            items: true
          }
        },
        purchaseInvoices: {
          where: {
            isActive: true,
            isDeleted: false
          },
          select: {
            id: true,
            invoiceNumber: true,
            invoiceStatus: true
          }
        }
      },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
      orderBy: {
        orderDate: 'desc'
      }
    });

    console.log('🔵 [getAvailablePOsForInvoicing] Found POs:', pos.length);

    // ✅ Add invoice status info
    const posWithStatus = pos.map(po => {
      const hasReceivedItems = po.goodsReceivings.some(grn => grn.items.length > 0);
      return {
        ...po,
        hasInvoice: po.purchaseInvoices.length > 0,
        invoiceCount: po.purchaseInvoices.length,
        invoices: po.purchaseInvoices,
        hasReceivedItems: hasReceivedItems
      };
    });

    const total = posWithStatus.length;

    res.status(200).json({
      success: true,
      count: posWithStatus.length,
      data: posWithStatus,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ Get available POs error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
// @desc    Print Purchase Invoice
// @route   GET /api/purchase/invoices/:id/print
// @access  Private
const printPurchaseInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const invoice = await prisma.purchaseInvoice.findFirst({
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
              select: { id: true, name: true, sku: true }
            }
          }
        },
        supplier: true,
        purchaseOrder: true,
        goodsReceiving: true,
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
      message: 'Purchase invoice data for print',
      data: invoice
    });
  } catch (error) {
    console.error('Print purchase invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─── EXPORT CONTROLLERS ──────────────────────────────────────

module.exports = {
  createInvoiceFromGRN,
  createInvoiceFromPurchaseOrder,
  postPurchaseInvoice,
  getPurchaseInvoices,
  getPurchaseInvoiceById,
  getPurchaseInvoiceByNumber,
  updatePurchaseInvoice,
  cancelPurchaseInvoice,
  deletePurchaseInvoice,
  getPurchaseInvoiceStats,
  getSupplierPurchaseInvoiceSummary,
  getAvailableGRNsForInvoicing,
  getAvailablePOsForInvoicing,
  printPurchaseInvoice
};