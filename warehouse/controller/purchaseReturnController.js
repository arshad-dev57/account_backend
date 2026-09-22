// warehouse/controller/purchaseReturnController.js - COMPLETE CORRECTED

const PurchaseReturnModel = require('../models/PurchaseReturn');
const prisma = require('../../prisma/client');
const { fiscalYearGuard } = require('../../middleware/fiscalYearMiddleware');
const { resolveFiscalYearId } = require('../../utils/fiscalYearHelper');

// ============================================================
// ─── PURCHASE RETURN CONTROLLERS ──────────────────────────────
// ============================================================

// @desc    Get GRN Products for Return - ✅ NEW GRN-BASED
// @route   GET /api/purchase/returns/grn/:grnId/products
// @access  Private
const getGRNProducts = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { grnId } = req.params;

    console.log('🔵 [getGRNProducts] Called for GRN ID:', grnId);

    const result = await PurchaseReturnModel.getGRNProducts(grnId, companyId);

    res.status(200).json({
      success: true,
      data: {
        grn: result.grn,
        linkedInvoice: result.linkedInvoice,
        products: result.products
      }
    });
  } catch (error) {
    console.error('❌ [getGRNProducts] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get Supplier GRNs for Return - ✅ NEW
// @route   GET /api/purchase/returns/supplier/:supplierId/grns
// @access  Private
const getSupplierGRNs = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { supplierId } = req.params;

    console.log('🔵 [getSupplierGRNs] Called for Supplier ID:', supplierId);

    const grns = await PurchaseReturnModel.getSupplierGRNs(supplierId, companyId);

    res.status(200).json({
      success: true,
      count: grns.length,
      data: grns
    });
  } catch (error) {
    console.error('❌ [getSupplierGRNs] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get Invoice Products for Return - LEGACY
// @route   GET /api/purchase/returns/invoice/:invoiceId/products
// @access  Private
const getInvoiceProducts = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { invoiceId } = req.params;

    const result = await PurchaseReturnModel.getInvoiceProducts(invoiceId, companyId);

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

// @desc    Get Supplier Invoices for Return - LEGACY
// @route   GET /api/purchase/returns/supplier/:supplierId/invoices
// @access  Private
const getSupplierInvoices = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { supplierId } = req.params;

    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        companyId: companyId,
        status: 'active'
      }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        supplierId: supplierId,
        companyId: companyId,
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

// @desc    Create Draft Purchase Return - ✅ GRN-BASED WITH INVOICE LINK
// @route   POST /api/purchase/returns/draft
// @access  Private
const createDraftReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const {
      supplierId,
      supplierName,
      goodsReceivingId,
      grnNumber,
      purchaseInvoiceId,
      purchaseInvoiceNumber,
      returnReason,
      notes,
      items,
      returnDate
    } = req.body;

    const postingDate = returnDate ? new Date(returnDate) : new Date();

    try {
      await fiscalYearGuard(userId, postingDate);
    } catch (err) {
      if (err.code === 'FISCAL_YEAR_CLOSED') {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }

    const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

    console.log('═══════════════════════════════════════════════════');
    console.log('🔵 [createDraftReturn] Called');
    console.log('🔵 [createDraftReturn] Supplier ID:', supplierId);
    console.log('🔵 [createDraftReturn] GRN ID:', goodsReceivingId);
    console.log('🔵 [createDraftReturn] Invoice ID:', purchaseInvoiceId);
    console.log('🔵 [createDraftReturn] Items:', items?.length);

    if (!supplierId) {
      return res.status(400).json({
        success: false,
        message: 'Supplier is required'
      });
    }

    if (!goodsReceivingId && !purchaseInvoiceId) {
      return res.status(400).json({
        success: false,
        message: 'Goods receiving (GRN) or Purchase invoice is required'
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one product must be returned'
      });
    }

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

    // ✅ FIXED: Include goodsReceivingId, grnNumber and companyId
    const returnData = {
      supplierId,
      supplierName,
      goodsReceivingId,
      grnNumber,
      purchaseInvoiceId,
      purchaseInvoiceNumber,
      returnReason: returnReason || 'Return',
      notes: notes || '',
      items,
      returnDate: postingDate,
      userId,
      createdBy: userId,
      companyId: companyId,
      fiscalYearId
    };

    console.log('🔵 [createDraftReturn] Creating return...');

    const purchaseReturn = await PurchaseReturnModel.createDraft(returnData);
    // No Draft step — process immediately (stock − + JE)
    const processedReturn = await PurchaseReturnModel.processReturn(
      purchaseReturn.id,
      userId,
      companyId
    );

    console.log('✅ [createDraftReturn] Return processed successfully');
    console.log(`✅ [createDraftReturn] Return Number: ${processedReturn.returnNumber}`);
    console.log('═══════════════════════════════════════════════════');

    res.status(201).json({
      success: true,
      message: 'Purchase return created successfully',
      data: processedReturn
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

// @desc    Process Purchase Return - ✅ FIXED
// @route   POST /api/purchase/returns/:id/process
// @access  Private
const processReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;

    console.log('═══════════════════════════════════════════════════');
    console.log('🔵 [processReturn] Called');
    console.log('🔵 [processReturn] Return ID:', id);

    const purchaseReturn = await prisma.purchaseReturn.findFirst({
      where: {
        id: id,
        companyId: companyId,
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

    if (purchaseReturn.status === 'Cancelled') {
      console.log('❌ [processReturn] Return is cancelled');
      return res.status(400).json({
        success: false,
        message: 'Purchase return is cancelled'
      });
    }

    console.log('🔵 [processReturn] Processing return...');

    // ✅ FIXED: Pass companyId
    const wasProcessed = purchaseReturn.status === 'Processed';
    const processedReturn = await PurchaseReturnModel.processReturn(id, userId, companyId);

    console.log('✅ [processReturn] Return processed successfully');
    console.log(`✅ [processReturn] Return Number: ${processedReturn.returnNumber}`);
    console.log('═══════════════════════════════════════════════════');

    res.status(200).json({
      success: true,
      message: wasProcessed
        ? 'Purchase return stock reconciled successfully'
        : 'Purchase return processed successfully',
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

// @desc    Cancel Purchase Return - ✅ FIXED
// @route   POST /api/purchase/returns/:id/cancel
// @access  Private
const cancelReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;
    const { reason } = req.body;

    console.log('═══════════════════════════════════════════════════');
    console.log('🔵 [cancelReturn] Called');
    console.log('🔵 [cancelReturn] Return ID:', id);

    const purchaseReturn = await prisma.purchaseReturn.findFirst({
      where: {
        id: id,
        companyId: companyId,
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

    // ✅ FIXED: Pass companyId
    const cancelledReturn = await PurchaseReturnModel.cancelReturn(id, userId, companyId, reason || '');

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

// @desc    Get All Returns with Filters - ✅ FIXED
// @route   GET /api/purchase/returns
// @access  Private
const getReturns = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
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

    // ✅ FIXED: Use createdBy and companyId
    const filter = {
      createdBy: userId,      // ✅ Use createdBy instead of userId
      companyId: companyId,   // ✅ Use companyId
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

    // ✅ FIXED: Pass companyId to getStats
    const [returns, total, stats] = await Promise.all([
      PurchaseReturnModel.findAll(filter, { skip, take: limitNum, orderBy }),
      PurchaseReturnModel.count(filter),
      PurchaseReturnModel.getStats(companyId)  // ✅ Pass companyId
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
    const companyId = req.user.companyId;
    const { id } = req.params;

    console.log('🔵 [getReturnById] Called');
    console.log('🔵 [getReturnById] Return ID:', id);

    const purchaseReturn = await prisma.purchaseReturn.findFirst({
      where: {
        id: id,
        companyId: companyId,
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
    const companyId = req.user.companyId;
    const { returnNumber } = req.params;

    console.log('🔵 [getReturnByNumber] Called');
    console.log('🔵 [getReturnByNumber] Return Number:', returnNumber);

    const purchaseReturn = await prisma.purchaseReturn.findFirst({
      where: {
        returnNumber: returnNumber,
        companyId: companyId,
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

// @desc    Get Return Stats - ✅ FIXED
// @route   GET /api/purchase/returns/stats
// @access  Private
const getReturnStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    console.log('🔵 [getReturnStats] Called');

    // ✅ FIXED: Pass companyId
    const stats = await PurchaseReturnModel.getStats(companyId);

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
    const companyId = req.user.companyId;
    const { id } = req.params;

    console.log('🔵 [getReturnNote] Called');
    console.log('🔵 [getReturnNote] Return ID:', id);

    const purchaseReturn = await prisma.purchaseReturn.findFirst({
      where: {
        id: id,
        companyId: companyId,
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
    const companyId = req.user.companyId;
    const { id } = req.params;

    console.log('🔵 [deleteReturn] Called');
    console.log('🔵 [deleteReturn] Return ID:', id);

    const purchaseReturn = await prisma.purchaseReturn.findFirst({
      where: {
        id: id,
        companyId: companyId,
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
  getGRNProducts,
  getSupplierGRNs,
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