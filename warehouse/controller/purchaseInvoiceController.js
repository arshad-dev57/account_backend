// warehouse/controller/purchaseInvoiceController.js - COMPLETE CORRECTED

const PurchaseInvoice = require('../models/PurchaseInvoice');
const prisma = require('../../prisma/client');
const taxCalculationService = require('../../tax/services/taxCalculationService');
const { fiscalYearGuard } = require('../../middleware/fiscalYearMiddleware');
const { resolveFiscalYearId } = require('../../utils/fiscalYearHelper');

// ============================================================
// ─── PURCHASE INVOICE CONTROLLERS ──────────────────────────────
// ============================================================

// @desc    Create Purchase Invoice from Goods Receiving
// @route   POST /api/purchase/invoices/from-grn
// @access  Private
const createInvoiceFromGRN = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const {
      goodsReceivingId,
      supplierInvoiceNo,
      invoiceDate,
      dueDate,
      paymentTerms,
      notes
    } = req.body;

    const postingDate = invoiceDate ? new Date(invoiceDate) : new Date();

    try {
      await fiscalYearGuard(userId, postingDate);
    } catch (err) {
      if (err.code === 'FISCAL_YEAR_CLOSED') {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }

    const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

    if (!goodsReceivingId) {
      return res.status(400).json({
        success: false,
        message: 'Goods receiving ID is required'
      });
    }

    const grn = await prisma.goodsReceiving.findFirst({
      where: {
        id: goodsReceivingId,
        companyId: companyId,
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

    const invoiceData = {
      goodsReceivingId,
      supplierInvoiceNo,
      invoiceDate,
      dueDate,
      paymentTerms,
      notes,
      createdBy: userId,
      userId: userId,
      companyId: companyId,
      fiscalYearId
    };

    const invoice = await PurchaseInvoice.createFromGRN(invoiceData);

    await taxCalculationService.recordFromDocument({
      companyId,
      transactionId: invoice.id,
      transactionType: 'PurchaseInvoice',
      items: invoice.items || []
    });

    res.status(201).json({
      success: true,
      message: 'Purchase invoice created and posted successfully',
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
    const companyId = req.user.companyId;
    const {
      purchaseOrderId,
      supplierInvoiceNo,
      invoiceDate,
      dueDate,
      paymentTerms,
      notes
    } = req.body;

    if (!purchaseOrderId) {
      return res.status(400).json({
        success: false,
        message: 'Purchase order ID is required'
      });
    }

    const purchaseOrder = await prisma.purchaseOrder.findFirst({
      where: {
        id: purchaseOrderId,
        companyId: companyId,
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

    const invoiceData = {
      purchaseOrderId,
      supplierInvoiceNo,
      invoiceDate,
      dueDate,
      paymentTerms,
      notes,
      createdBy: userId,
      userId: userId,
      companyId: companyId,
      fiscalYearId: null
    };

    const invoice = await PurchaseInvoice.createFromPurchaseOrder(invoiceData);

    await taxCalculationService.recordFromDocument({
      companyId,
      transactionId: invoice.id,
      transactionType: 'PurchaseInvoice',
      items: invoice.items || []
    });

    res.status(201).json({
      success: true,
      message: 'Purchase invoice created and posted successfully',
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
    const companyId = req.user.companyId;
    const { id } = req.params;

    const invoice = await prisma.purchaseInvoice.findFirst({
      where: {
        id: id,
        companyId: companyId,
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
    const companyId = req.user.companyId;
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

    // ✅ FIXED: Use createdBy and companyId
    const filter = {
      createdBy: userId,      // ✅ Use createdBy instead of userId
      companyId: companyId,   // ✅ Use companyId
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

    // ✅ FIXED: Pass companyId to getStats
    const [invoices, total, stats] = await Promise.all([
      PurchaseInvoice.findAll(filter, { skip, take: limitNum, orderBy }),
      PurchaseInvoice.count(filter),
      PurchaseInvoice.getStats(companyId)  // ✅ Pass companyId
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
    const companyId = req.user.companyId;
    const { id } = req.params;

    const invoice = await prisma.purchaseInvoice.findFirst({
      where: {
        id: id,
        companyId: companyId,
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
    const companyId = req.user.companyId;
    const { invoiceNumber } = req.params;

    const invoice = await prisma.purchaseInvoice.findFirst({
      where: {
        invoiceNumber: invoiceNumber,
        companyId: companyId,
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
    const companyId = req.user.companyId;
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

    const invoice = await prisma.purchaseInvoice.findFirst({
      where: {
        id: id,
        companyId: companyId,
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

    const updateData = {
      updatedBy: userId,
      ...(supplierInvoiceNo !== undefined && { supplierInvoiceNo }),
      ...(invoiceDate && { invoiceDate: new Date(invoiceDate) }),
      ...(dueDate && { dueDate: new Date(dueDate) }),
      ...(paymentTerms && { paymentTerms }),
      ...(notes !== undefined && { notes }),
      ...(status && { invoiceStatus: status })
    };

    if (items) {
      const processedItems = [];
      for (const item of items) {
        const product = await prisma.product.findFirst({
          where: {
            id: item.productId,
            companyId: companyId,
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
          notes: item.notes || ''
        });
      }
      updateData.items = processedItems;
    }

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
    const companyId = req.user.companyId;
    const { id } = req.params;
    const { reason } = req.body;

    const invoice = await prisma.purchaseInvoice.findFirst({
      where: {
        id: id,
        companyId: companyId,
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
    const companyId = req.user.companyId;
    const { id } = req.params;

    const invoice = await prisma.purchaseInvoice.findFirst({
      where: {
        id: id,
        companyId: companyId,
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
    const companyId = req.user.companyId;
    // ✅ FIXED: Pass companyId
    const stats = await PurchaseInvoice.getStats(companyId);

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
    const companyId = req.user.companyId;
    const { supplierId } = req.params;

    // ✅ FIXED: Pass companyId first
    const summary = await PurchaseInvoice.getSupplierSummary(companyId, supplierId);

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
    const companyId = req.user.companyId;
    const { search, page = 1, limit = 20 } = req.query;

    // ✅ FIXED: Use createdBy and companyId
    const where = {
      createdBy: userId,      // ✅ Use createdBy
      companyId: companyId,   // ✅ Use companyId
      isActive: true,
      isDeleted: false,
      status: {
        in: ['Partially Received', 'Fully Received']
      }
    };

    if (search && search.trim().length >= 2) {
      where.OR = [
        { grnNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
        { purchaseOrderNumber: { contains: search, mode: 'insensitive' } },
        { supplier: { phone: { contains: search, mode: 'insensitive' } } },
        { supplier: { email: { contains: search, mode: 'insensitive' } } }
      ];
    }

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
        location: {
          select: { id: true, name: true, code: true, type: true }
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
        receivingDate: 'desc'
      }
    });

    const grnsWithStatus = grns.map((grn) => {
      const items = grn.items.map((item) => {
        const unitPrice =
          item.purchaseOrderItem?.unitPrice || item.product?.costPrice || 0;
        const discount = item.purchaseOrderItem?.discount || 0;
        const taxRate = item.purchaseOrderItem?.taxRate || 0;
        const qty = item.receivingQuantity || 0;
        return {
          ...item,
          quantity: qty,
          unitPrice,
          discount,
          taxRate,
          productName: item.productName || item.product?.name,
          sku: item.sku || item.product?.sku
        };
      });
      const totalQuantity = items.reduce(
        (sum, item) => sum + (item.quantity || 0),
        0
      );
      const invoiceSubtotal = items.reduce(
        (sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0),
        0
      );
      const totalDiscount = items.reduce((sum, item) => {
        const line = (item.quantity || 0) * (item.unitPrice || 0);
        return sum + line * ((item.discount || 0) / 100);
      }, 0);
      const totalTax = items.reduce((sum, item) => {
        const line = (item.quantity || 0) * (item.unitPrice || 0);
        const afterDisc = line * (1 - (item.discount || 0) / 100);
        return sum + afterDisc * ((item.taxRate || 0) / 100);
      }, 0);
      const itemPreview = items
        .slice(0, 3)
        .map((item) => item.productName)
        .filter(Boolean)
        .join(', ');

      return {
        id: grn.id,
        grnNumber: grn.grnNumber,
        purchaseOrderId: grn.purchaseOrderId,
        purchaseOrderNumber:
          grn.purchaseOrderNumber || grn.purchaseOrder?.orderNumber,
        supplierId: grn.supplierId,
        supplierName: grn.supplierName,
        supplierEmail: grn.supplier?.email || grn.purchaseOrder?.supplierEmail,
        supplierPhone: grn.supplier?.phone || grn.purchaseOrder?.supplierPhone,
        supplierAddress: grn.supplier?.address || grn.purchaseOrder?.supplierAddress,
        receivingDate: grn.receivingDate,
        status: grn.status,
        locationId: grn.locationId,
        locationName: grn.location?.name,
        locationCode: grn.location?.code,
        hasInvoice: grn.purchaseInvoices.length > 0,
        invoiceCount: grn.purchaseInvoices.length,
        invoices: grn.purchaseInvoices,
        hasReceivedItems: true,
        totalQuantity,
        invoiceSubtotal,
        totalDiscount,
        totalTax,
        grandTotal: invoiceSubtotal - totalDiscount + totalTax,
        itemCount: items.length,
        itemPreview,
        items
      };
    });

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
    const companyId = req.user.companyId;
    const { search, page = 1, limit = 20 } = req.query;

    // Show POs available for invoicing (GRN optional).
    // Exclude already-invoiced POs at DB level so pagination/search stay correct.
    const where = {
      isActive: true,
      isDeleted: false,
      status: { not: 'Cancelled' },
      OR: [
        { companyId: companyId },
        { companyId: null, createdBy: userId },
      ],
      purchaseInvoices: {
        none: {
          isActive: true,
          isDeleted: false,
          invoiceStatus: { notIn: ['Cancelled'] }
        }
      }
    };

    if (search && search.trim().length >= 1) {
      const q = search.trim();
      where.AND = [
        {
          OR: [
            { orderNumber: { contains: q, mode: 'insensitive' } },
            { supplierName: { contains: q, mode: 'insensitive' } },
            { supplierEmail: { contains: q, mode: 'insensitive' } },
            { supplierPhone: { contains: q, mode: 'insensitive' } },
          ]
        },
      ];
    }

    const [pos, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          items: true,
          supplier: true,
          location: {
            select: { id: true, name: true, code: true, type: true }
          },
          goodsReceivings: {
            where: {
              isActive: true,
              isDeleted: false,
              status: { in: ['Partially Received', 'Fully Received'] }
            },
            include: {
              items: true
            }
          }
        },
        skip: (parseInt(page, 10) - 1) * parseInt(limit, 10),
        take: parseInt(limit, 10),
        orderBy: {
          orderDate: 'desc'
        }
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    const posWithStatus = pos.map((po) => {
      const receivedQty = {};
      for (const grn of po.goodsReceivings) {
        for (const item of grn.items) {
          receivedQty[item.purchaseOrderItemId] =
            (receivedQty[item.purchaseOrderItemId] || 0) +
            item.receivingQuantity;
        }
      }
      const hasReceivedItems = Object.values(receivedQty).some((q) => q > 0);

      // Prefer confirmed received qty; fall back to ordered qty for listing
      const invoiceItems = po.items
        .map((item) => {
          const qty = hasReceivedItems
            ? receivedQty[item.id] || 0
            : item.quantity || 0;
          return {
            ...item,
            quantity: qty,
            unitPrice: item.unitPrice || 0,
            discount: item.discount || 0,
            taxRate: item.taxRate || 0,
            lineTotal:
              qty *
              (item.unitPrice || 0) *
              (1 - (item.discount || 0) / 100) *
              (1 + (item.taxRate || 0) / 100)
          };
        })
        .filter((item) => item.quantity > 0);

      const totalQuantity = invoiceItems.reduce(
        (sum, item) => sum + (item.quantity || 0),
        0
      );
      const invoiceSubtotal = invoiceItems.reduce((sum, item) => {
        const line = (item.quantity || 0) * (item.unitPrice || 0);
        return sum + line;
      }, 0);
      const itemPreview = invoiceItems
        .slice(0, 3)
        .map((item) => item.productName)
        .filter(Boolean)
        .join(', ');

      return {
        id: po.id,
        orderNumber: po.orderNumber,
        supplierId: po.supplierId,
        supplierName: po.supplierName,
        supplierEmail: po.supplierEmail,
        supplierPhone: po.supplierPhone,
        supplierAddress: po.supplierAddress,
        orderDate: po.orderDate,
        expectedDeliveryDate: po.expectedDeliveryDate,
        status: po.status,
        locationId: po.locationId,
        locationName: po.location?.name,
        locationCode: po.location?.code,
        subtotal: po.subtotal,
        totalDiscount: po.totalDiscount,
        totalTax: po.totalTax,
        grandTotal: po.grandTotal,
        notes: po.notes,
        hasInvoice: false,
        invoiceCount: 0,
        invoices: [],
        hasReceivedItems,
        totalQuantity,
        invoiceSubtotal,
        itemCount: invoiceItems.length,
        itemPreview,
        items: invoiceItems,
        supplier: po.supplier
          ? {
              id: po.supplier.id,
              name: po.supplier.name,
              email: po.supplier.email,
              phone: po.supplier.phone,
              address: po.supplier.address
            }
          : null
      };
    });

    res.status(200).json({
      success: true,
      count: posWithStatus.length,
      data: posWithStatus,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        pages: Math.ceil(total / parseInt(limit, 10)) || 1
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
    const companyId = req.user.companyId;
    const { id } = req.params;

    const invoice = await prisma.purchaseInvoice.findFirst({
      where: {
        id: id,
        companyId: companyId,
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