// warehouse/controller/quotationController.js - COMPLETE QUOTATION CONTROLLER

const Quotation = require('../models/Quotation');
const prisma = require('../../prisma/client');

// ============================================================
// ─── QUOTATION CONTROLLERS ────────────────────────────────────
// ============================================================

// @desc    Create Quotation
// @route   POST /api/quotations
// @access  Private
const createQuotation = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      customerCompany,
      quotationDate,
      validUntil,
      salesPerson,
      items,
      notes,
      termsConditions,
      status
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
        message: 'Quotation must have at least one item'
      });
    }

    // ─── Get Customer Details ────────────────────────────
    let customer = null;
    let finalCustomerName = customerName;
    let finalCustomerEmail = customerEmail;
    let finalCustomerPhone = customerPhone;
    let finalCustomerCompany = customerCompany;

    if (customerId) {
      customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          userId: userId,
          isActive: true,
          isDeleted: false
        }
      });

      if (!customer) {
        return res.status(404).json({
          success: false,
          message: 'Customer not found'
        });
      }

      finalCustomerName = customer.name;
      finalCustomerEmail = customer.email || '';
      finalCustomerPhone = customer.phone || '';
      finalCustomerCompany = customer.company || '';
    }

    // ─── Process Items ──────────────────────────────────
    const quotationItems = [];
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

      quotationItems.push({
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

    // ─── Create Quotation ──────────────────────────────
    const quotationData = {
      customerId: customerId || '',
      customerName: finalCustomerName,
      customerEmail: finalCustomerEmail,
      customerPhone: finalCustomerPhone,
      customerCompany: finalCustomerCompany,
      quotationDate: quotationDate || new Date(),
      validUntil: validUntil || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days default
      salesPerson: salesPerson || '',
      items: quotationItems,
      notes: notes || '',
      termsConditions: termsConditions || '',
      status: status || 'Draft',
      createdBy: userId,
      userId: userId
    };

    const quotation = await Quotation.create(quotationData);

    res.status(201).json({
      success: true,
      message: 'Quotation created successfully',
      data: quotation
    });
  } catch (error) {
    console.error('Create quotation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get All Quotations with Filters
// @route   GET /api/quotations
// @access  Private
const getQuotations = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      search,
      status,
      customerId,
      fromDate,
      toDate,
      sortBy = 'quotationDate',
      sortOrder = 'desc'
    } = req.query;

    const filter = {
      userId: userId,
      isActive: true,
      isDeleted: false
    };

    if (search) {
      filter.OR = [
        { quotationNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { customerCompany: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (customerId) {
      filter.customerId = customerId;
    }

    if (fromDate || toDate) {
      filter.quotationDate = {};
      if (fromDate) filter.quotationDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.quotationDate.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };

    // Check and update expired quotations
    await Quotation.updateExpiredQuotations(userId);

    const [quotations, total, kpi, stats] = await Promise.all([
      Quotation.findAll(filter, { skip, take: limitNum, orderBy }),
      Quotation.count(filter),
      Quotation.getStatusCounts(userId),
      Quotation.getStats(userId)
    ]);

    res.status(200).json({
      success: true,
      count: quotations.length,
      data: quotations,
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
    console.error('Get quotations error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Quotation by ID
// @route   GET /api/quotations/:id
// @access  Private
const getQuotationById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const quotation = await prisma.quotation.findFirst({
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
        customer: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        convertedOrder: {
          select: { id: true, orderNumber: true, orderStatus: true, createdAt: true }
        }
      }
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    res.status(200).json({
      success: true,
      data: quotation
    });
  } catch (error) {
    console.error('Get quotation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Quotation by Number
// @route   GET /api/quotations/number/:quotationNumber
// @access  Private
const getQuotationByNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const { quotationNumber } = req.params;

    const quotation = await prisma.quotation.findFirst({
      where: {
        quotationNumber: quotationNumber,
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
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        convertedOrder: {
          select: { id: true, orderNumber: true, orderStatus: true }
        }
      }
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    res.status(200).json({
      success: true,
      data: quotation
    });
  } catch (error) {
    console.error('Get quotation by number error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update Quotation
// @route   PUT /api/quotations/:id
// @access  Private
const updateQuotation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      customerCompany,
      quotationDate,
      validUntil,
      salesPerson,
      items,
      notes,
      termsConditions,
      status
    } = req.body;

    // ─── Check if quotation exists ──────────────────────
    const quotation = await prisma.quotation.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    if (quotation.status === 'Converted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update converted quotation'
      });
    }

    // ─── Prepare update data ─────────────────────────────
    const updateData = {
      updatedBy: userId
    };

    if (customerId) updateData.customerId = customerId;
    if (customerName) updateData.customerName = customerName;
    if (customerEmail !== undefined) updateData.customerEmail = customerEmail;
    if (customerPhone !== undefined) updateData.customerPhone = customerPhone;
    if (customerCompany !== undefined) updateData.customerCompany = customerCompany;
    if (quotationDate) updateData.quotationDate = new Date(quotationDate);
    if (validUntil) updateData.validUntil = new Date(validUntil);
    if (salesPerson !== undefined) updateData.salesPerson = salesPerson;
    if (notes !== undefined) updateData.notes = notes;
    if (termsConditions !== undefined) updateData.termsConditions = termsConditions;
    if (status) updateData.status = status;

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

    // ─── Update Quotation ──────────────────────────────────
    const updatedQuotation = await Quotation.update(id, updateData);

    res.status(200).json({
      success: true,
      message: 'Quotation updated successfully',
      data: updatedQuotation
    });
  } catch (error) {
    console.error('Update quotation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update Quotation Status
// @route   PATCH /api/quotations/:id/status
// @access  Private
const updateQuotationStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    // ─── Check if quotation exists ──────────────────────
    const quotation = await prisma.quotation.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    // ─── Validate status transition ──────────────────────
    const validTransitions = {
      'Draft': ['Sent', 'Expired', 'Cancelled'],
      'Sent': ['Accepted', 'Rejected', 'Expired'],
      'Accepted': ['Converted', 'Expired'],
      'Rejected': [],
      'Expired': [],
      'Converted': []
    };

    if (!validTransitions[quotation.status]?.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot transition from ${quotation.status} to ${status}`
      });
    }

    const updatedQuotation = await Quotation.updateStatus(id, status, userId, notes);

    res.status(200).json({
      success: true,
      message: `Quotation status updated to ${status}`,
      data: updatedQuotation
    });
  } catch (error) {
    console.error('Update quotation status error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Convert Quotation to Sales Order
// @route   POST /api/quotations/:id/convert
// @access  Private
const convertQuotationToOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // ─── Check if quotation exists ──────────────────────
    const quotation = await prisma.quotation.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      },
      include: {
        items: true
      }
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    if (quotation.status === 'Converted') {
      return res.status(400).json({
        success: false,
        message: 'Quotation already converted to order'
      });
    }

    if (quotation.status === 'Rejected' || quotation.status === 'Expired') {
      return res.status(400).json({
        success: false,
        message: `Cannot convert ${quotation.status} quotation`
      });
    }

    // ─── Convert to Order ──────────────────────────────────
    const result = await Quotation.convertToOrder(id, userId);

    res.status(200).json({
      success: true,
      message: 'Quotation converted to sales order successfully',
      data: {
        quotation: result.quotation,
        order: result.order
      }
    });
  } catch (error) {
    console.error('Convert quotation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Delete Quotation (Soft Delete)
// @route   DELETE /api/quotations/:id
// @access  Private
const deleteQuotation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // ─── Check if quotation exists ──────────────────────
    const quotation = await prisma.quotation.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    if (quotation.status === 'Converted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete converted quotation'
      });
    }

    // ─── Soft Delete Quotation ────────────────────────────
    await Quotation.softDelete(id, userId);

    res.status(200).json({
      success: true,
      message: 'Quotation deleted successfully'
    });
  } catch (error) {
    console.error('Delete quotation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Quotation Stats / KPI
// @route   GET /api/quotations/stats
// @access  Private
const getQuotationStats = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check and update expired quotations
    await Quotation.updateExpiredQuotations(userId);

    const [kpi, stats] = await Promise.all([
      Quotation.getStatusCounts(userId),
      Quotation.getStats(userId)
    ]);

    res.status(200).json({
      success: true,
      data: {
        kpi,
        stats
      }
    });
  } catch (error) {
    console.error('Get quotation stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Customer Quotation Summary
// @route   GET /api/quotations/customer-summary
// @access  Private
const getCustomerQuotationSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    const summary = await Quotation.getCustomerSummary(userId, startDate, endDate);

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Get customer quotation summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Product Quotation Summary
// @route   GET /api/quotations/product-summary
// @access  Private
const getProductQuotationSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    const summary = await Quotation.getProductSummary(userId, startDate, endDate);

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Get product quotation summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Send Quotation (Mark as Sent)
// @route   POST /api/quotations/:id/send
// @access  Private
const sendQuotation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { email } = req.body;

    // ─── Check if quotation exists ──────────────────────
    const quotation = await prisma.quotation.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    if (quotation.status !== 'Draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft quotations can be sent'
      });
    }

    // ─── Update status to Sent ────────────────────────────
    const updatedQuotation = await Quotation.updateStatus(id, 'Sent', userId);

    // Here you would typically send an email with the quotation
    // For now, we just update the status
    // You can integrate with email service here

    res.status(200).json({
      success: true,
      message: 'Quotation sent successfully',
      data: updatedQuotation
    });
  } catch (error) {
    console.error('Send quotation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Print/PDF Quotation
// @route   GET /api/quotations/:id/print
// @access  Private
const printQuotation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const quotation = await prisma.quotation.findFirst({
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
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    // Here you would generate PDF
    // For now, return the quotation data
    res.status(200).json({
      success: true,
      message: 'Quotation data for print',
      data: quotation
    });
  } catch (error) {
    console.error('Print quotation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  createQuotation,
  getQuotations,
  getQuotationById,
  getQuotationByNumber,
  updateQuotation,
  updateQuotationStatus,
  convertQuotationToOrder,
  deleteQuotation,
  getQuotationStats,
  getCustomerQuotationSummary,
  getProductQuotationSummary,
  sendQuotation,
  printQuotation
};