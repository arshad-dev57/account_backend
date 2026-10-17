// warehouse/controller/quotationController.js - COMPLETE QUOTATION CONTROLLER

const Quotation = require('../models/Quotation');
const prisma = require('../../prisma/client');
const tradingService = require('../../services/tradingService');

/**
 * Resolve products + authoritative unit prices for a customer.
 * Priority: customer negotiated → linked price list → standard selling.
 * Client unitPrice is used only when manualPriceOverride / priceSource=MANUAL.
 */
async function buildPricedQuotationItems({
  companyId,
  customerId,
  items,
  asOfDate,
}) {
  const quotationItems = [];
  const pricingMeta = [];

  for (const item of items) {
    let product;

    if (item.productId) {
      product = await prisma.product.findFirst({
        where: {
          id: item.productId,
          companyId,
          isActive: true,
        },
      });
    } else if (item.sku) {
      product = await prisma.product.findFirst({
        where: {
          sku: item.sku,
          companyId,
          isActive: true,
        },
      });
    }

    if (!product) {
      const err = new Error(
        `Product not found: ${item.productName || item.sku || item.productId}`
      );
      err.statusCode = 404;
      throw err;
    }

    const resolved = await tradingService.resolveSellPrice({
      companyId,
      customerId: customerId || null,
      productId: product.id,
      quantity: item.quantity != null ? item.quantity : 1,
      asOfDate: asOfDate || new Date(),
    });

    const priced = tradingService.applyResolvedPriceToLine(resolved, item);

    quotationItems.push({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      quantity: item.quantity,
      unitPrice: priced.unitPrice,
      discount: priced.discount,
      taxRate: priced.taxRate,
      notes: item.notes || '',
    });

    pricingMeta.push({
      productId: product.id,
      sku: product.sku,
      unitPrice: priced.unitPrice,
      pricingSource: priced.pricingSource,
      currencyCode: priced.currencyCode,
      unitName: priced.unitName,
      listPrice: priced.listPrice,
      messages: priced.pricingMessages,
      warnings: priced.pricingWarnings,
    });
  }

  return { quotationItems, pricingMeta };
}

// ============================================================
// ─── QUOTATION CONTROLLERS ────────────────────────────────────
// ============================================================

// @desc    Create Quotation
// @route   POST /api/quotations
// @access  Private
const createQuotation = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const {
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      customerCompany,
      customers,
      quotationDate,
      validUntil,
      salesPerson,
      items,
      notes,
      termsConditions,
      status,
      locationId,
    } = req.body;

    // ─── Validation ──────────────────────────────────────
    const hasMultipleCustomers = Array.isArray(customers) && customers.length > 0;
    if (!hasMultipleCustomers && !customerId && !customerName) {
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

    const { resolveLocationId } = require('../services/locationService');
    let resolvedLocationId = null;
    try {
      resolvedLocationId = await resolveLocationId(
        prisma,
        companyId,
        locationId,
        userId
      );
    } catch (locErr) {
      return res.status(locErr.statusCode || 400).json({
        success: false,
        message: locErr.message || 'Invalid warehouse',
      });
    }

    const asOfDate = quotationDate ? new Date(quotationDate) : new Date();

    // ─── If Multiple Customers Provided ─────────────────
    if (hasMultipleCustomers) {
      const createdQuotations = [];
      for (const cust of customers) {
        let custId = cust.id || cust.customerId || '';
        let cName = cust.name || cust.customerName || '';
        let cEmail = cust.email || cust.customerEmail || '';
        let cPhone = cust.phone || cust.customerPhone || '';
        let cCompany = cust.company || cust.customerCompany || '';

        if (custId) {
          const dbCust = await prisma.customer.findFirst({
            where: { id: custId, companyId: companyId, isActive: true, isDeleted: false }
          });
          if (dbCust) {
            cName = dbCust.name;
            cEmail = dbCust.email || '';
            cPhone = dbCust.phone || '';
            cCompany = dbCust.company || '';
          } else {
            return res.status(404).json({
              success: false,
              message: `Customer not found: ${custId}`,
            });
          }
        }

        const { quotationItems, pricingMeta } = await buildPricedQuotationItems({
          companyId,
          customerId: custId || null,
          items,
          asOfDate,
        });

        const qData = {
          customerId: custId,
          customerName: cName,
          customerEmail: cEmail,
          customerPhone: cPhone,
          customerCompany: cCompany,
          quotationDate: quotationDate || new Date(),
          validUntil: validUntil || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          salesPerson: salesPerson || '',
          items: quotationItems,
          notes: notes || '',
          termsConditions: termsConditions || '',
          status: status || 'Draft',
          createdBy: userId,
          companyId: companyId,
          locationId: resolvedLocationId,
        };

        const created = await Quotation.create(qData);
        createdQuotations.push({ ...created, pricingMeta });
      }

      return res.status(201).json({
        success: true,
        message: `${createdQuotations.length} Quotation(s) created successfully`,
        data: createdQuotations
      });
    }

    // ─── Single Customer Fallback ────────────────────────
    let customer = null;
    let finalCustomerName = customerName;
    let finalCustomerEmail = customerEmail;
    let finalCustomerPhone = customerPhone;
    let finalCustomerCompany = customerCompany;

    if (customerId) {
      customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          companyId: companyId,
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

    const { quotationItems, pricingMeta } = await buildPricedQuotationItems({
      companyId,
      customerId: customerId || null,
      items,
      asOfDate,
    });

    const quotationData = {
      customerId: customerId || '',
      customerName: finalCustomerName,
      customerEmail: finalCustomerEmail,
      customerPhone: finalCustomerPhone,
      customerCompany: finalCustomerCompany,
      quotationDate: quotationDate || new Date(),
      validUntil: validUntil || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      salesPerson: salesPerson || '',
      items: quotationItems,
      notes: notes || '',
      termsConditions: termsConditions || '',
      status: status || 'Draft',
      createdBy: userId,
      companyId: companyId,
      locationId: resolvedLocationId,
    };

    const quotation = await Quotation.create(quotationData);

    res.status(201).json({
      success: true,
      message: 'Quotation created successfully',
      data: { ...quotation, pricingMeta },
    });
  } catch (error) {
    console.error('Create quotation error:', error);
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Server error',
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
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const {
      page = 1,
      limit = 20,
      search,
      status,
      customerId,
      fromDate,
      toDate,
      sortBy = 'quotationDate',
      sortOrder = 'desc',
      locationId,
    } = req.query;

    const filter = {
      companyId: companyId,
      isActive: true,
      isDeleted: false
    };

    if (locationId) {
      filter.locationId = locationId;
    }

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
    await Quotation.updateExpiredQuotations(companyId, userId);

    const [quotations, total, kpi, stats] = await Promise.all([
      Quotation.findAll(filter, { skip, take: limitNum, orderBy }),
      Quotation.count(filter),
      Quotation.getStatusCounts(companyId),
      Quotation.getStats(companyId)
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
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const { id } = req.params;

    const quotation = await prisma.quotation.findFirst({
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
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const { quotationNumber } = req.params;

    const quotation = await prisma.quotation.findFirst({
      where: {
        quotationNumber: quotationNumber,
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
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
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
        companyId: companyId,
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

    // ─── Process items if provided (authoritative pricing) ─
    let pricingMeta = null;
    if (items) {
      const effectiveCustomerId =
        updateData.customerId || quotation.customerId || customerId || null;
      const asOfDate = updateData.quotationDate || quotation.quotationDate || new Date();
      try {
        const priced = await buildPricedQuotationItems({
          companyId,
          customerId: effectiveCustomerId,
          items,
          asOfDate,
        });
        updateData.items = priced.quotationItems;
        pricingMeta = priced.pricingMeta;
      } catch (priceErr) {
        return res.status(priceErr.statusCode || 400).json({
          success: false,
          message: priceErr.message || 'Failed to resolve line pricing',
        });
      }
    }

    // ─── Update Quotation ──────────────────────────────────
    const updatedQuotation = await Quotation.update(id, updateData);

    res.status(200).json({
      success: true,
      message: 'Quotation updated successfully',
      data: pricingMeta ? { ...updatedQuotation, pricingMeta } : updatedQuotation,
    });
  } catch (error) {
    console.error('Update quotation error:', error);
    res.status(error.statusCode || 500).json({
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
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
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
        companyId: companyId,
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
      'Draft': ['Pending Approval', 'Approved', 'Sent', 'Expired', 'Cancelled'],
      'Pending Approval': ['Approved', 'Rejected', 'Cancelled', 'Draft'],
      'Approved': ['Converted', 'Expired', 'Cancelled', 'Sent'],
      'Sent': ['Approved', 'Accepted', 'Rejected', 'Expired', 'Cancelled'],
      'Accepted': ['Converted', 'Expired', 'Cancelled'],
      'Rejected': ['Draft'],
      'Expired': [],
      'Cancelled': [],
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
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const { id } = req.params;

    // ─── Check if quotation exists ──────────────────────
    const quotation = await prisma.quotation.findFirst({
      where: {
        id: id,
        companyId: companyId,
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
        message: 'Quotation already fully converted to order'
      });
    }

    if (quotation.status === 'Rejected' || quotation.status === 'Expired' || quotation.status === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: `Cannot convert ${quotation.status} quotation`
      });
    }

    // Optional partial conversion: { items: [{ productId, quantity }], locationId? }
    const selectedItems = Array.isArray(req.body?.items) ? req.body.items : null;
    const convertLocationId = req.body?.locationId || null;

    // ─── Convert to Order ──────────────────────────────────
    const result = await Quotation.convertToOrder(id, userId, selectedItems, {
      locationId: convertLocationId,
    });

    res.status(200).json({
      success: true,
      message:
        result.quotation.status === 'Partially Converted'
          ? 'Quotation partially converted to sales order'
          : 'Quotation converted to sales order successfully',
      data: {
        quotation: result.quotation,
        order: result.order,
        remainingLines: result.remainingLines || [],
      }
    });
  } catch (error) {
    console.error('Convert quotation error:', error);
    const status = error.statusCode || (error.name === 'PrismaClientValidationError' ? 400 : 500);
    res.status(status).json({
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
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const { id } = req.params;

    // ─── Check if quotation exists ──────────────────────
    const quotation = await prisma.quotation.findFirst({
      where: {
        id: id,
        companyId: companyId,
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
    
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    // Check and update expired quotations
    await Quotation.updateExpiredQuotations(companyId, userId);

    const [kpi, stats] = await Promise.all([
      Quotation.getStatusCounts(companyId),
      Quotation.getStats(companyId)
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
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const { startDate, endDate } = req.query;

    const summary = await Quotation.getCustomerSummary(companyId, startDate, endDate);

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
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const { startDate, endDate } = req.query;

    const summary = await Quotation.getProductSummary(companyId, startDate, endDate);

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
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const { id } = req.params;
    const { email } = req.body;

    // ─── Check if quotation exists ──────────────────────
    const quotation = await prisma.quotation.findFirst({
      where: {
        id: id,
        companyId: companyId,
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
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const { id } = req.params;

    const quotation = await prisma.quotation.findFirst({
      where: {
        id: id,
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