// warehouse/controller/purchaseReturnController.js - COMPLETE

const PurchaseReturnModel = require('../models/PurchaseReturn');
const prisma = require('../../prisma/client');

// ============================================================
// ─── PURCHASE RETURN CONTROLLERS ──────────────────────────────
// ============================================================

// @desc    Get Invoice Products for Return
// @route   GET /api/purchase/returns/invoice/:invoiceId/products
// @access  Private
const getInvoiceProducts = async (req, res) => {
  try {
    const userId = req.user.id;
    const { invoiceId } = req.params;

    console.log('🔵 [getInvoiceProducts] Called');
    console.log('🔵 [getInvoiceProducts] Invoice ID:', invoiceId);
    console.log('🔵 [getInvoiceProducts] User ID:', userId);

    // ─── Check if invoice exists ──────────────────────────────
    const invoice = await prisma.purchaseInvoice.findFirst({
      where: {
        id: invoiceId,
        userId: userId,
        isActive: true,
        isDeleted: false
      },
      include: {
        supplier: true,
        items: {
          include: {
            product: true
          }
        }
      }
    });

    if (!invoice) {
      console.log('❌ [getInvoiceProducts] Invoice not found');
      return res.status(404).json({
        success: false,
        message: 'Purchase invoice not found'
      });
    }

    console.log(`✅ [getInvoiceProducts] Invoice found: ${invoice.invoiceNumber}`);

    const result = await PurchaseReturnModel.getInvoiceProducts(invoiceId, userId);

    res.status(200).json({
      success: true,
      data: {
        invoice: result.invoice,
        products: result.products
      }
    });
  } catch (error) {
    console.error('❌ [getInvoiceProducts] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get Supplier Invoices for Return
// @route   GET /api/purchase/returns/supplier/:supplierId/invoices
// @access  Private
const getSupplierInvoices = async (req, res) => {
  try {
    const userId = req.user.id;
    const { supplierId } = req.params;

    console.log('🔵 [getSupplierInvoices] Called');
    console.log('🔵 [getSupplierInvoices] Supplier ID:', supplierId);

    // ─── Check if supplier exists ──────────────────────────────
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        userId: userId,
        status: 'active'
      }
    });

    if (!supplier) {
      console.log('❌ [getSupplierInvoices] Supplier not found');
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        supplierId: supplierId,
        userId: userId,
        isActive: true,
        isDeleted: false,
        invoiceStatus: {
          in: ['Posted', 'Partially Paid', 'Paid']
        }
      },
      orderBy: {
        invoiceDate: 'desc'
      },
      include: {
        items: {
          include: {
            product: true
          }
        },
        supplier: true
      }
    });

    console.log(`✅ [getSupplierInvoices] Found ${invoices.length} invoices`);

    res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices
    });
  } catch (error) {
    console.error('❌ [getSupplierInvoices] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Create Draft Purchase Return
// @route   POST /api/purchase/returns/draft
// @access  Private
const createDraftReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      supplierId,
      supplierName,
      purchaseInvoiceId,
      purchaseInvoiceNumber,
      returnReason,
      notes,
      items
    } = req.body;

    console.log('═══════════════════════════════════════════════════');
    console.log('🔵 [createDraftReturn] Called');
    console.log('🔵 [createDraftReturn] Supplier ID:', supplierId);
    console.log('🔵 [createDraftReturn] Invoice ID:', purchaseInvoiceId);
    console.log('🔵 [createDraftReturn] Items:', items?.length);

    // ─── Validation ──────────────────────────────────────────
    if (!supplierId) {
      console.log('❌ [createDraftReturn] Supplier is required');
      return res.status(400).json({
        success: false,
        message: 'Supplier is required'
      });
    }

    if (!purchaseInvoiceId) {
      console.log('❌ [createDraftReturn] Purchase invoice is required');
      return res.status(400).json({
        success: false,
        message: 'Purchase invoice is required'
      });
    }

    if (!items || items.length === 0) {
      console.log('❌ [createDraftReturn] At least one product must be returned');
      return res.status(400).json({
        success: false,
        message: 'At least one product must be returned'
      });
    }

    // ─── Validate items ──────────────────────────────────────
    for (const item of items) {
      if (!item.productId) {
        return res.status(400).json({
          success: false,
          message: 'Product ID is required for each item'
        });
      }

      if (!item.returnQuantity || item.returnQuantity <= 0) {
        return res.status(400).json({
          success: false,
          message: `Return quantity must be greater than 0 for ${item.productName || 'product'}`
        });
      }

      if (item.isBoxBased) {
        if (!item.boxes || item.boxes <= 0) {
          return res.status(400).json({
            success: false,
            message: `Number of boxes must be specified for ${item.productName || 'product'}`
          });
        }
        if (!item.quantityPerBox || item.quantityPerBox <= 0) {
          return res.status(400).json({
            success: false,
            message: `Quantity per box must be specified for ${item.productName || 'product'}`
          });
        }
      }
    }

    const returnData = {
      supplierId,
      supplierName,
      purchaseInvoiceId,
      purchaseInvoiceNumber,
      returnReason: returnReason || 'Return',
      notes: notes || '',
      items,
      userId,
      createdBy: userId
    };

    console.log('🔵 [createDraftReturn] Creating draft return...');

    const purchaseReturn = await PurchaseReturnModel.createDraft(returnData);

    console.log('✅ [createDraftReturn] Draft return created successfully');
    console.log(`✅ [createDraftReturn] Return Number: ${purchaseReturn.returnNumber}`);
    console.log('═══════════════════════════════════════════════════');

    res.status(201).json({
      success: true,
      message: 'Draft return created successfully',
      data: purchaseReturn
    });
  } catch (error) {
    console.error('❌ [createDraftReturn] Error:', error);
    console.log('═══════════════════════════════════════════════════');
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Process Purchase Return
// @route   POST /api/purchase/returns/:id/process
// @access  Private
const processReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    console.log('═══════════════════════════════════════════════════');
    console.log('🔵 [processReturn] Called');
    console.log('🔵 [processReturn] Return ID:', id);
    console.log('🔵 [processReturn] User ID:', userId);

    // ─── Check if return exists ──────────────────────────────
    const purchaseReturn = await prisma.purchaseReturn.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!purchaseReturn) {
      console.log('❌ [processReturn] Return not found');
      return res.status(404).json({
        success: false,
        message: 'Purchase return not found'
      });
    }

    if (purchaseReturn.status === 'Processed') {
      console.log('❌ [processReturn] Return already processed');
      return res.status(400).json({
        success: false,
        message: 'Purchase return already processed'
      });
    }

    if (purchaseReturn.status === 'Cancelled') {
      console.log('❌ [processReturn] Return is cancelled');
      return res.status(400).json({
        success: false,
        message: 'Purchase return is cancelled'
      });
    }

    console.log('🔵 [processReturn] Processing return...');

    const processedReturn = await PurchaseReturnModel.processReturn(id, userId);

    console.log('✅ [processReturn] Return processed successfully');
    console.log(`✅ [processReturn] Return Number: ${processedReturn.returnNumber}`);
    console.log('═══════════════════════════════════════════════════');

    res.status(200).json({
      success: true,
      message: 'Purchase return processed successfully',
      data: processedReturn
    });
  } catch (error) {
    console.error('❌ [processReturn] Error:', error);
    console.log('═══════════════════════════════════════════════════');
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Cancel Purchase Return
// @route   POST /api/purchase/returns/:id/cancel
// @access  Private
const cancelReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { reason } = req.body;

    console.log('═══════════════════════════════════════════════════');
    console.log('🔵 [cancelReturn] Called');
    console.log('🔵 [cancelReturn] Return ID:', id);
    console.log('🔵 [cancelReturn] Reason:', reason);

    // ─── Check if return exists ──────────────────────────────
    const purchaseReturn = await prisma.purchaseReturn.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!purchaseReturn) {
      console.log('❌ [cancelReturn] Return not found');
      return res.status(404).json({
        success: false,
        message: 'Purchase return not found'
      });
    }

    if (purchaseReturn.status === 'Cancelled') {
      console.log('❌ [cancelReturn] Return already cancelled');
      return res.status(400).json({
        success: false,
        message: 'Purchase return already cancelled'
      });
    }

    if (purchaseReturn.status === 'Processed') {
      console.log('❌ [cancelReturn] Cannot cancel processed return');
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a processed return. Please reverse the transaction.'
      });
    }

    console.log('🔵 [cancelReturn] Cancelling return...');

    const cancelledReturn = await PurchaseReturnModel.cancelReturn(id, userId, reason || '');

    console.log('✅ [cancelReturn] Return cancelled successfully');
    console.log('═══════════════════════════════════════════════════');

    res.status(200).json({
      success: true,
      message: 'Purchase return cancelled successfully',
      data: cancelledReturn
    });
  } catch (error) {
    console.error('❌ [cancelReturn] Error:', error);
    console.log('═══════════════════════════════════════════════════');
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get All Returns with Filters
// @route   GET /api/purchase/returns
// @access  Private
const getReturns = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      search,
      supplierId,
      invoiceId,
      status,
      fromDate,
      toDate,
      sortBy = 'returnDate',
      sortOrder = 'desc'
    } = req.query;

    console.log('🔵 [getReturns] Called');
    console.log('🔵 [getReturns] Filters:', { page, limit, search, status });

    const filter = {
      userId: userId,
      isActive: true,
      isDeleted: false
    };

    if (search) {
      filter.OR = [
        { returnNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
        { purchaseInvoiceNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (supplierId) {
      filter.supplierId = supplierId;
    }

    if (invoiceId) {
      filter.purchaseInvoiceId = invoiceId;
    }

    if (status) {
      filter.status = status;
    }

    if (fromDate || toDate) {
      filter.returnDate = {};
      if (fromDate) filter.returnDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.returnDate.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };

    const [returns, total, stats] = await Promise.all([
      PurchaseReturnModel.findAll(filter, { skip, take: limitNum, orderBy }),
      PurchaseReturnModel.count(filter),
      PurchaseReturnModel.getStats(userId)
    ]);

    console.log(`✅ [getReturns] Found ${returns.length} returns`);

    res.status(200).json({
      success: true,
      count: returns.length,
      data: returns,
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
    console.error('❌ [getReturns] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Return by ID
// @route   GET /api/purchase/returns/:id
// @access  Private
const getReturnById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    console.log('🔵 [getReturnById] Called');
    console.log('🔵 [getReturnById] Return ID:', id);

    const purchaseReturn = await prisma.purchaseReturn.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      },
      include: {
        items: {
          include: {
            product: true,
            purchaseInvoice: {
              include: {
                supplier: true
              }
            }
          }
        },
        supplier: true,
        purchaseInvoice: {
          include: {
            supplier: true,
            items: true
          }
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
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        processor: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        canceller: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!purchaseReturn) {
      console.log('❌ [getReturnById] Return not found');
      return res.status(404).json({
        success: false,
        message: 'Purchase return not found'
      });
    }

    console.log(`✅ [getReturnById] Return found: ${purchaseReturn.returnNumber}`);

    res.status(200).json({
      success: true,
      data: purchaseReturn
    });
  } catch (error) {
    console.error('❌ [getReturnById] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Return by Number
// @route   GET /api/purchase/returns/number/:returnNumber
// @access  Private
const getReturnByNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const { returnNumber } = req.params;

    console.log('🔵 [getReturnByNumber] Called');
    console.log('🔵 [getReturnByNumber] Return Number:', returnNumber);

    const purchaseReturn = await prisma.purchaseReturn.findFirst({
      where: {
        returnNumber: returnNumber,
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
        supplier: true,
        purchaseInvoice: true,
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        }
      }
    });

    if (!purchaseReturn) {
      console.log('❌ [getReturnByNumber] Return not found');
      return res.status(404).json({
        success: false,
        message: 'Purchase return not found'
      });
    }

    console.log(`✅ [getReturnByNumber] Return found: ${purchaseReturn.returnNumber}`);

    res.status(200).json({
      success: true,
      data: purchaseReturn
    });
  } catch (error) {
    console.error('❌ [getReturnByNumber] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Return Stats
// @route   GET /api/purchase/returns/stats
// @access  Private
const getReturnStats = async (req, res) => {
  try {
    const userId = req.user.id;

    console.log('🔵 [getReturnStats] Called');

    const stats = await PurchaseReturnModel.getStats(userId);

    console.log('✅ [getReturnStats] Stats fetched successfully');

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ [getReturnStats] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Return Note Data for Printing
// @route   GET /api/purchase/returns/:id/note
// @access  Private
const getReturnNote = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    console.log('🔵 [getReturnNote] Called');
    console.log('🔵 [getReturnNote] Return ID:', id);

    const purchaseReturn = await prisma.purchaseReturn.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!purchaseReturn) {
      console.log('❌ [getReturnNote] Return not found');
      return res.status(404).json({
        success: false,
        message: 'Purchase return not found'
      });
    }

    const noteData = await PurchaseReturnModel.getReturnNoteData(id);

    console.log('✅ [getReturnNote] Return note data fetched successfully');

    res.status(200).json({
      success: true,
      data: noteData
    });
  } catch (error) {
    console.error('❌ [getReturnNote] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Delete Return (Soft Delete)
// @route   DELETE /api/purchase/returns/:id
// @access  Private
const deleteReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    console.log('🔵 [deleteReturn] Called');
    console.log('🔵 [deleteReturn] Return ID:', id);

    // ─── Check if return exists ──────────────────────────────
    const purchaseReturn = await prisma.purchaseReturn.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!purchaseReturn) {
      console.log('❌ [deleteReturn] Return not found');
      return res.status(404).json({
        success: false,
        message: 'Purchase return not found'
      });
    }

    if (purchaseReturn.status !== 'Cancelled') {
      console.log('❌ [deleteReturn] Only cancelled returns can be deleted');
      return res.status(400).json({
        success: false,
        message: 'Only cancelled returns can be deleted'
      });
    }

    // ─── Soft Delete Return ──────────────────────────────────
    await prisma.purchaseReturn.update({
      where: { id },
      data: {
        isDeleted: true,
        isActive: false,
        updatedBy: userId
      }
    });

    console.log('✅ [deleteReturn] Return deleted successfully');

    res.status(200).json({
      success: true,
      message: 'Return deleted successfully'
    });
  } catch (error) {
    console.error('❌ [deleteReturn] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─── EXPORT CONTROLLERS ──────────────────────────────────────

module.exports = {
  getInvoiceProducts,
  getSupplierInvoices,
  createDraftReturn,
  processReturn,
  cancelReturn,
  getReturns,
  getReturnById,
  getReturnByNumber,
  getReturnStats,
  getReturnNote,
  deleteReturn
};