// warehouse/controller/orderController.js - COMPLETE CORRECTED

const Order = require('../models/Order');
const prisma = require('../../prisma/client');
const { resolveLocationId } = require('../services/locationService');

// ============================================================
// HELPER: Auto-Generate Invoice
// ============================================================
const autoGenerateInvoice = async (order, userId, companyId) => {
  try {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const day = String(new Date().getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    
    const prefix = order.orderType === 'Sales Order' ? 'SI' : 'PI';
    const invoiceNumber = `${prefix}-${year}${month}${day}-${random}`;

    const invoice = await prisma.warehouseInvoice.create({
      data: {
        invoiceNumber,
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        customerEmail: order.customerEmail || '',
        customerPhone: order.customerPhone || '',
        subtotal: order.subtotal,
        taxTotal: order.taxTotal || 0,
        discountTotal: order.discountTotal || 0,
        grandTotal: order.grandTotal,
        paidAmount: 0,
        outstanding: order.grandTotal,
        invoiceStatus: 'Draft',
        paymentStatus: 'Unpaid',
        notes: order.customerNotes || '',
        createdBy: userId,
        updatedBy: userId,
        companyId: companyId,
        items: {
          create: order.items.map(item => ({
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            taxRate: item.taxRate || 0,
            taxAmount: item.taxAmount || 0,
            discount: item.discount || 0
          }))
        }
      },
      include: { items: true }
    });

    console.log(`✅ ${order.orderType} Invoice auto-generated: ${invoiceNumber}`);
    return invoice;
  } catch (error) {
    console.error('Auto-generate invoice error:', error);
    return null;
  }
};

// ============================================================
// ─── SALES ORDER CONTROLLERS ────────────────────────────────
// ============================================================

// @desc    Create Sales Order
// @route   POST /api/sales/orders
// @access  Private
const createSalesOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const tradingService = require('../../services/tradingService');
    const {
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      customerType,
      customerCompany,
      customerTaxId,
      shippingAddress,
      billingAddress,
      items,
      priority,
      source,
      salesPerson,
      expectedDeliveryDate,
      shippingMethod,
      shippingCarrier,
      shippingCost,
      paymentMethod,
      paymentStatus,
      orderStatus,
      couponCode,
      discountTotal,
      customerNotes,
      internalNotes,
      tags,
      locationId,
      quotationId,
    } = req.body;

    // ─── Validation ──────────────────────────────────────
    if (!customerName) {
      return res.status(400).json({
        success: false,
        message: 'Customer name is required'
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Sales order must have at least one item'
      });
    }

    // Warehouse is optional — use it for stock checks when provided
    let resolvedLocationId = null;
    if (locationId) {
      try {
        resolvedLocationId = await resolveLocationId(
          prisma,
          companyId,
          locationId,
          userId,
          { required: false }
        );
      } catch (locErr) {
        return res.status(locErr.statusCode || 400).json({
          success: false,
          message: locErr.message || 'Invalid warehouse',
        });
      }
    }

    // ─── Process Items ──────────────────────────────────
    let subtotal = 0;
    let taxTotal = 0;
    let totalWeight = 0;
    const orderItems = [];

    for (const item of items) {
      let product;

      if (item.productId) {
        product = await prisma.product.findFirst({
          where: {
            id: item.productId,
            companyId: companyId
          }
        });
      } else if (item.sku) {
        product = await prisma.product.findFirst({
          where: {
            sku: item.sku,
            companyId: companyId
          }
        });
      } else if (item.productName) {
        product = await prisma.product.findFirst({
          where: {
            name: { contains: item.productName, mode: 'insensitive' },
            companyId: companyId
          }
        });
      }

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.productName || item.sku || item.productId}`
        });
      }

      // Only enforce warehouse stock when a warehouse was selected
      if (resolvedLocationId) {
        const locationStock = await prisma.productStock.findUnique({
          where: {
            productId_locationId: {
              productId: product.id,
              locationId: resolvedLocationId,
            },
          },
        });
        const locCurrent = locationStock?.currentStock || 0;
        const locReserved = locationStock?.reservedStock || 0;
        const freeToSell = Math.max(0, locCurrent - locReserved);

        if (freeToSell < item.quantity) {
          return res.status(400).json({
            success: false,
            message: `Insufficient stock at this warehouse for ${product.name}. Available: ${freeToSell}`,
          });
        }
      }

      // Direct SO: resolve customer negotiated / price-list / standard selling.
      // Quotation→SO and explicit manual overrides keep the client/quotation unitPrice.
      const fromQuotation =
        Boolean(quotationId) ||
        String(source || '').toLowerCase() === 'quotation';
      const isManual =
        item.manualPriceOverride === true ||
        String(item.priceSource || item.pricingSource || '').toUpperCase() ===
          'MANUAL';

      let unitPrice =
        item.unitPrice != null && item.unitPrice !== ''
          ? Number(item.unitPrice)
          : Number(product.sellingPrice) || 0;
      let lineTaxRate = item.taxRate != null ? Number(item.taxRate) : 0;
      let lineDiscount = item.discount != null ? Number(item.discount) : 0;

      if (customerId && !fromQuotation && !isManual) {
        try {
          const resolved = await tradingService.resolveSellPrice({
            companyId,
            customerId,
            productId: product.id,
            quantity: item.quantity != null ? item.quantity : 1,
            asOfDate: new Date(),
          });
          const priced = tradingService.applyResolvedPriceToLine(resolved, item);
          unitPrice = priced.unitPrice;
          if (item.taxRate == null || item.taxRate === '') {
            lineTaxRate = priced.taxRate;
          }
          if (item.discount == null || item.discount === '') {
            lineDiscount = priced.discount;
          }
        } catch (priceErr) {
          console.warn(
            '[createSalesOrder] price resolve fallback to line/catalog:',
            priceErr.message
          );
        }
      }

      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        unitPrice = Number(product.sellingPrice) || 0;
      }

      const totalPrice = unitPrice * item.quantity;
      const taxAmount = (totalPrice * (lineTaxRate || 0)) / 100;
      const itemWeight = (item.weight || product.weight || 0) * item.quantity;

      orderItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        weight: item.weight || product.weight || 0,
        weightUnit: item.weightUnit || product.weightUnit || 'KG',
        dimensions: item.dimensions || '',
        taxRate: lineTaxRate || 0,
        taxAmount,
        discount: lineDiscount || 0,
        batchNumber: item.batchNumber || '',
        serialNumber: item.serialNumber || '',
        notes: item.notes || ''
      });

      subtotal += totalPrice;
      taxTotal += taxAmount;
      totalWeight += itemWeight;
    }

    // ─── Calculate Grand Total ──────────────────────────
    const shippingCostAmount = shippingCost || 0;
    const discountAmount = discountTotal || 0;
    const grandTotal = subtotal + taxTotal + shippingCostAmount - discountAmount;
    const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

    // ─── Create Sales Order ──────────────────────────────
    // ✅ FIXED: Use createdBy and companyId (NOT userId)
    const orderData = {
      customerName,
      customerEmail,
      customerPhone,
      customerType: customerType || 'Individual',
      customerCompany,
      customerTaxId,
      shippingAddress: shippingAddress || {},
      billingAddress: billingAddress || {},
      items: orderItems,
      subtotal,
      taxTotal,
      shippingCost: shippingCostAmount,
      discountTotal: discountAmount,
      grandTotal,
      totalWeight,
      totalItems,
      orderType: 'Sales Order',
      priority: priority || 'Medium',
      source: source || 'Web',
      salesPerson: salesPerson || '',
      expectedDeliveryDate: expectedDeliveryDate || null,
      shippingMethod: shippingMethod || 'Standard',
      shippingCarrier: shippingCarrier || '',
      paymentMethod: paymentMethod || 'Cash',
      paymentStatus: paymentStatus || 'Pending',
      orderStatus: orderStatus || 'Pending',
      couponCode: couponCode || '',
      customerNotes: customerNotes || '',
      internalNotes: internalNotes || '',
      tags: tags || [],
      createdBy: userId,      // ✅ Use createdBy
      companyId: companyId,   // ✅ Use companyId
      locationId: resolvedLocationId,
    };

    const order = await Order.create(orderData);

    // Do NOT auto-create WarehouseInvoice drafts here.
    // Invoices are created explicitly from Sales Invoice / Warehouse Invoice screens
    // (auto-drafts were duplicating when a SalesInvoice was also created for the same order).

    res.status(201).json({
      success: true,
      message: 'Sales Order created successfully',
      data: order
    });
  } catch (error) {
    console.error('Create sales order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update Sales Order
// @route   PUT /api/orders/:id
// @access  Private
const updateSalesOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const tradingService = require('../../services/tradingService');
    const { id } = req.params;
    const {
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      customerType,
      customerCompany,
      customerTaxId,
      shippingAddress,
      billingAddress,
      items,
      priority,
      source,
      salesPerson,
      expectedDeliveryDate,
      shippingMethod,
      shippingCarrier,
      shippingCost,
      paymentMethod,
      paymentStatus,
      couponCode,
      discountTotal,
      customerNotes,
      internalNotes,
      tags,
      subtotal,
      taxTotal,
      grandTotal,
      totalWeight,
      totalItems,
      quotationId,
    } = req.body;

    const existing = await prisma.order.findFirst({
      where: {
        id,
        ...(companyId ? { OR: [{ companyId: companyId }, { companyId: null }] } : {}),
        isActive: true,
        isDeleted: false,
        orderType: { notIn: ['Purchase Order', 'Purchase'] },
      },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Sales order not found',
      });
    }

    let orderItems = items;
    if (items) {
      orderItems = [];
      for (const item of items) {
        if (!item.quantity || Number(item.quantity) <= 0) {
          return res.status(400).json({
            success: false,
            message: `Line quantity must be greater than 0 for ${item.productName || 'product'}`,
          });
        }
        let product;
        if (item.productId) {
          product = await prisma.product.findFirst({
            where: { id: item.productId, companyId },
          });
        } else if (item.sku) {
          product = await prisma.product.findFirst({
            where: { sku: item.sku, companyId },
          });
        }

        if (!product) {
          return res.status(404).json({
            success: false,
            message: `Product not found: ${item.productName || item.sku || item.productId}`,
          });
        }

        const fromQuotation =
          Boolean(quotationId) ||
          String(source || existing.source || '').toLowerCase() === 'quotation';
        const isManual =
          item.manualPriceOverride === true ||
          String(item.priceSource || item.pricingSource || '').toUpperCase() ===
            'MANUAL';

        let unitPrice =
          item.unitPrice != null && item.unitPrice !== ''
            ? Number(item.unitPrice)
            : Number(product.sellingPrice) || 0;
        let lineTaxRate = item.taxRate != null ? Number(item.taxRate) : 0;

        if (customerId && !fromQuotation && !isManual) {
          try {
            const resolved = await tradingService.resolveSellPrice({
              companyId,
              customerId,
              productId: product.id,
              quantity: item.quantity != null ? item.quantity : 1,
              asOfDate: new Date(),
            });
            const priced = tradingService.applyResolvedPriceToLine(resolved, item);
            unitPrice = priced.unitPrice;
            if (item.taxRate == null || item.taxRate === '') {
              lineTaxRate = priced.taxRate;
            }
          } catch (priceErr) {
            console.warn(
              '[updateSalesOrder] price resolve fallback:',
              priceErr.message
            );
          }
        }

        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          unitPrice = Number(product.sellingPrice) || 0;
        }

        const quantity = item.quantity;
        const totalPrice = unitPrice * quantity;
        const taxAmount = (totalPrice * (lineTaxRate || 0)) / 100;

        if (existing.locationId) {
          const locationStock = await prisma.productStock.findUnique({
            where: {
              productId_locationId: {
                productId: product.id,
                locationId: existing.locationId,
              },
            },
          });
          const locCurrent = locationStock?.currentStock || 0;
          const locReserved = locationStock?.reservedStock || 0;
          const freeToSell = Math.max(0, locCurrent - locReserved);
          const oldItem = await prisma.orderItem.findFirst({
            where: { orderId: id, productId: product.id },
          });
          const previouslyReserved = oldItem?.quantity || 0;
          const netNeeded = quantity - previouslyReserved;
          if (netNeeded > 0 && freeToSell < netNeeded) {
            return res.status(400).json({
              success: false,
              message: `Insufficient stock at warehouse for ${product.name}. Available: ${freeToSell}`,
            });
          }
        }

        orderItems.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity,
          unitPrice,
          totalPrice,
          weight: item.weight || product.weight || 0,
          weightUnit: item.weightUnit || product.weightUnit || 'KG',
          dimensions: item.dimensions || '',
          taxRate: lineTaxRate || 0,
          taxAmount,
          discount: item.discount || 0,
          batchNumber: item.batchNumber || '',
          serialNumber: item.serialNumber || '',
          notes: item.notes || '',
        });
      }
    }

    const updatedOrder = await Order.updateSalesOrder(
      id,
      {
        updatedBy: userId,
        customerName,
        customerEmail,
        customerPhone,
        customerType,
        customerCompany,
        customerTaxId,
        shippingAddress,
        billingAddress,
        items: orderItems,
        priority,
        source,
        salesPerson,
        expectedDeliveryDate,
        shippingMethod,
        shippingCarrier,
        shippingCost,
        paymentMethod,
        paymentStatus,
        couponCode,
        discountTotal,
        customerNotes,
        internalNotes,
        tags,
        subtotal,
        taxTotal,
        grandTotal,
        totalWeight,
        totalItems,
      },
      companyId
    );

    res.status(200).json({
      success: true,
      message: 'Sales order updated successfully',
      data: updatedOrder,
    });
  } catch (error) {
    console.error('Update sales order error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// @desc    Get all Sales Orders
// @route   GET /api/sales/orders
// @access  Private
const getSalesOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const {
      page = 1,
      limit = 20,
      search,
      status,
      paymentStatus,
      customerId,
      fromDate,
      toDate,
      sortBy = 'orderDate',
      sortOrder = 'desc',
      locationId,
    } = req.query;

    // Company + optional warehouse — all users of the company see location orders
    const filter = {
      isActive: true,
      companyId: companyId,
      orderType: 'Sales Order'
    };

    if (locationId) {
      filter.locationId = locationId;
    }

    if (search) {
      filter.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { customerCompany: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status && status !== 'all') filter.orderStatus = status;
    if (paymentStatus && paymentStatus !== 'all') filter.paymentStatus = paymentStatus;
    if (customerId) filter.customerId = customerId;

    if (fromDate || toDate) {
      filter.orderDate = {};
      if (fromDate) filter.orderDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.orderDate.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };

    const [orders, total] = await Promise.all([
      Order.findSalesOrders(filter, { skip, take: limitNum, orderBy }),
      Order.countSalesOrders(filter),
    ]);

    // Repair stale Draft/Pending payment badges from linked invoices
    await Order.syncManyFromInvoices(orders.map((o) => o.id));
    const syncedOrders = await Order.findSalesOrders(filter, {
      skip,
      take: limitNum,
      orderBy
    });

    const kpi = await Order.getStatusCounts(userId, 'Sales Order');

    res.status(200).json({
      success: true,
      count: syncedOrders.length,
      data: syncedOrders,
      kpi,
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
    console.error('Get sales orders error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ============================================================
// ─── PURCHASE ORDER CONTROLLERS ─────────────────────────────
// ============================================================

// @desc    Create Purchase Order
// @route   POST /api/purchase/orders
// @access  Private
const createPurchaseOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const {
      supplierName,
      supplierEmail,
      supplierPhone,
      shippingAddress,
      billingAddress,
      items,
      priority,
      source,
      expectedDeliveryDate,
      shippingMethod,
      shippingCarrier,
      shippingCost,
      paymentMethod,
      paymentStatus,
      couponCode,
      discountTotal,
      internalNotes,
      tags
    } = req.body;

    // ─── Validation ──────────────────────────────────────
    if (!supplierName) {
      return res.status(400).json({
        success: false,
        message: 'Supplier name is required'
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Purchase order must have at least one item'
      });
    }

    // ─── Process Items ──────────────────────────────────
    let subtotal = 0;
    let taxTotal = 0;
    let totalWeight = 0;
    const orderItems = [];

    for (const item of items) {
      let product;

      if (item.productId) {
        product = await prisma.product.findFirst({
          where: {
            id: item.productId,
            companyId: companyId
          }
        });
      } else if (item.sku) {
        product = await prisma.product.findFirst({
          where: {
            sku: item.sku,
            companyId: companyId
          }
        });
      } else if (item.productName) {
        product = await prisma.product.findFirst({
          where: {
            name: { contains: item.productName, mode: 'insensitive' },
            companyId: companyId
          }
        });
      }

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.productName || item.sku || item.productId}`
        });
      }

      const unitPrice = item.unitPrice || product.costPrice;
      const totalPrice = unitPrice * item.quantity;
      const taxAmount = (totalPrice * (item.taxRate || 0)) / 100;
      const itemWeight = (item.weight || product.weight || 0) * item.quantity;

      orderItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        weight: item.weight || product.weight || 0,
        weightUnit: item.weightUnit || product.weightUnit || 'KG',
        dimensions: item.dimensions || '',
        taxRate: item.taxRate || 0,
        taxAmount,
        discount: item.discount || 0,
        batchNumber: item.batchNumber || '',
        serialNumber: item.serialNumber || '',
        notes: item.notes || ''
      });

      subtotal += totalPrice;
      taxTotal += taxAmount;
      totalWeight += itemWeight;
    }

    // ─── Calculate Grand Total ──────────────────────────
    const shippingCostAmount = shippingCost || 0;
    const discountAmount = discountTotal || 0;
    const grandTotal = subtotal + taxTotal + shippingCostAmount - discountAmount;
    const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

    // ─── Create Purchase Order ──────────────────────────────
    // ✅ FIXED: Use createdBy and companyId (NOT userId)
    const orderData = {
      customerName: supplierName,
      customerEmail: supplierEmail,
      customerPhone: supplierPhone,
      customerType: 'Supplier',
      customerCompany: supplierName,
      customerTaxId: '',
      shippingAddress: shippingAddress || {},
      billingAddress: billingAddress || {},
      items: orderItems,
      subtotal,
      taxTotal,
      shippingCost: shippingCostAmount,
      discountTotal: discountAmount,
      grandTotal,
      totalWeight,
      totalItems,
      orderType: 'Purchase Order',
      priority: priority || 'Medium',
      source: source || 'Manual',
      salesPerson: '',
      expectedDeliveryDate: expectedDeliveryDate || null,
      shippingMethod: shippingMethod || 'Standard',
      shippingCarrier: shippingCarrier || '',
      paymentMethod: paymentMethod || 'Cash',
      paymentStatus: paymentStatus || 'Pending',
      couponCode: couponCode || '',
      customerNotes: '',
      internalNotes: internalNotes || '',
      tags: tags || [],
      createdBy: userId,      // ✅ Use createdBy
      companyId: companyId,   // ✅ Use companyId
    };

    const order = await Order.create(orderData);

    // Do NOT auto-create invoice drafts on PO create (same duplication issue as sales).

    res.status(201).json({
      success: true,
      message: 'Purchase Order created successfully',
      data: order
    });
  } catch (error) {
    console.error('Create purchase order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get all Purchase Orders
// @route   GET /api/purchase/orders
// @access  Private
const getPurchaseOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const {
      page = 1,
      limit = 20,
      search,
      status,
      paymentStatus,
      fromDate,
      toDate,
      sortBy = 'orderDate',
      sortOrder = 'desc'
    } = req.query;

    // ✅ FIXED: Use createdBy instead of userId
    const filter = {
      isActive: true,
      createdBy: userId,      // ✅ Use createdBy
      companyId: companyId,   // ✅ Use companyId
      orderType: 'Purchase Order'
    };

    if (search) {
      filter.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { customerCompany: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status && status !== 'all') filter.orderStatus = status;
    if (paymentStatus && paymentStatus !== 'all') filter.paymentStatus = paymentStatus;

    if (fromDate || toDate) {
      filter.orderDate = {};
      if (fromDate) filter.orderDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.orderDate.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };

    const [orders, total] = await Promise.all([
      Order.findPurchaseOrders(filter, { skip, take: limitNum, orderBy }),
      Order.countPurchaseOrders(filter),
    ]);

    const kpi = await Order.getStatusCounts(userId, 'Purchase Order');

    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
      kpi,
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
    console.error('Get purchase orders error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ============================================================
// ─── SHARED CONTROLLERS ──────────────────────────────────────
// ============================================================

// @desc    Get single order by ID
// @route   GET /api/orders/:id
// @access  Private
const getOrderById = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const order = await prisma.order.findFirst({
      where: {
        id: req.params.id,
        companyId: companyId,
        isActive: true
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        picker: {
          select: { id: true, firstName: true, lastName: true }
        },
        packer: {
          select: { id: true, firstName: true, lastName: true }
        },
        shipper: {
          select: { id: true, firstName: true, lastName: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    await Order.syncFromInvoices(order.id);
    const synced = await prisma.order.findFirst({
      where: { id: order.id },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        picker: {
          select: { id: true, firstName: true, lastName: true }
        },
        packer: {
          select: { id: true, firstName: true, lastName: true }
        },
        shipper: {
          select: { id: true, firstName: true, lastName: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    res.status(200).json({ success: true, data: synced || order });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update order status
// @route   PATCH /api/orders/:id/status
// @access  Private
const updateOrderStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const order = await prisma.order.findFirst({
      where: { id: id, companyId: companyId }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Manual status changes are only for pre-fulfillment workflow.
    // Partially Delivered / Delivered / Returned come from Delivery confirm & Returns — never from this dropdown.
    const validTransitions = {
      Draft: ['Pending', 'Cancelled'],
      Pending: ['Processing', 'On Hold', 'Cancelled'],
      Processing: ['Packed', 'On Hold', 'Cancelled'],
      Packed: ['Shipped', 'On Hold', 'Cancelled'],
      Shipped: ['In Transit', 'Cancelled'],
      'In Transit': ['Cancelled'],
      'Partially Delivered': [],
      Delivered: [],
      'Partially Returned': [],
      Returned: [],
      Cancelled: [],
      'On Hold': ['Pending', 'Processing', 'Cancelled'],
    };

    if (!validTransitions[order.orderStatus]?.includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          status === 'Delivered' ||
          status === 'Partially Delivered' ||
          status === 'Returned' ||
          status === 'Partially Returned'
            ? `Cannot set "${status}" manually. Confirm a Delivery (or Sales Return) to update fulfillment status.`
            : `Cannot transition from ${order.orderStatus} to ${status}`,
      });
    }

    const updatedOrder = await Order.updateStatus(id, status, userId, notes);
    res.status(200).json({ success: true, data: updatedOrder });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update order payment status
// @route   PATCH /api/orders/:id/payment
// @access  Private
const updateOrderPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const { id } = req.params;
    const { paymentStatus, paymentReference } = req.body;

    if (!paymentStatus) {
      return res.status(400).json({ success: false, message: 'Payment status is required' });
    }

    const order = await prisma.order.findFirst({
      where: { id: id, companyId: companyId }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const updatedOrder = await Order.updatePayment(id, paymentStatus, paymentReference, userId);
    res.status(200).json({ success: true, data: updatedOrder });
  } catch (error) {
    console.error('Update payment status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Cancel order
// @route   POST /api/orders/:id/cancel
// @access  Private
const cancelOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const { id } = req.params;
    const { reason } = req.body;

    const order = await prisma.order.findFirst({
      where: { id: id, companyId: companyId }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (!['Draft', 'Pending', 'Processing', 'On Hold', 'Packed', 'Shipped', 'In Transit'].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Order cannot be cancelled in current status'
      });
    }

    const cancelledOrder = await Order.cancelOrder(id, userId, reason);
    res.status(200).json({ success: true, data: cancelledOrder });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete order (soft delete)
// @route   DELETE /api/orders/:id
// @access  Private (Admin only)
const deleteOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: { id: id, companyId: companyId }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (!['Draft', 'Cancelled'].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Only draft or cancelled orders can be deleted'
      });
    }

    await Order.softDelete(id, userId);
    res.status(200).json({ success: true, message: 'Order deleted successfully' });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get order statistics / KPI
// @route   GET /api/orders/stats
// @access  Private
const getOrderStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const { type } = req.query;
    
    let stats;
    if (type === 'sales') {
      stats = await Order.getStats(userId, 'Sales Order');
    } else if (type === 'purchase') {
      stats = await Order.getStats(userId, 'Purchase Order');
    } else {
      stats = await Order.getStats(userId);
    }
    
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('Get order stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get order KPI
// @route   GET /api/orders/kpi
// @access  Private
const getOrderKPI = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = (req.method === 'GET' || req.method === 'HEAD') ? (req.companyIdFilter ?? req.user.companyId) : req.user.companyId;
    const { type } = req.query;
    
    let kpi;
    if (type === 'sales') {
      kpi = await Order.getStatusCounts(userId, 'Sales Order');
    } else if (type === 'purchase') {
      kpi = await Order.getStatusCounts(userId, 'Purchase Order');
    } else {
      kpi = await Order.getStatusCounts(userId);
    }
    
    res.status(200).json({ success: true, data: kpi });
  } catch (error) {
    console.error('Get order KPI error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// ─── WHATSAPP DELIVERY (SALES ORDER DOCUMENT) ───────────────
// ============================================================

const WHATSAPP_API_VERSION = 'v18.0';

function normalizeWhatsAppNumber(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/[^0-9]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Pakistani local mobile 03XXXXXXXXX -> 923XXXXXXXXX
  if (digits.startsWith('0') && digits.length >= 10) digits = `92${digits.slice(1)}`;
  return digits;
}

const sendWhatsAppOrder = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { to, format, fileBase64, filename, mimeType, caption } = req.body || {};

    const order = await prisma.order.findFirst({
      where: { id: req.params.id, companyId, isActive: true },
      select: { id: true, orderNumber: true, customerName: true }
    });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Sales order not found' });
    }

    const digits = normalizeWhatsAppNumber(to);
    if (!/^[1-9]\d{6,14}$/.test(digits)) {
      return res.status(400).json({ success: false, message: 'Invalid WhatsApp number' });
    }

    if (!fileBase64 || !filename || !['pdf', 'jpeg'].includes(format)) {
      return res.status(400).json({ success: false, message: 'A valid file payload (pdf or jpeg) is required' });
    }

    const token = process.env.WHATSAPP_API_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) {
      return res.status(200).json({
        success: true,
        whatsappConfigured: false,
        message: 'WhatsApp Business Cloud API is not configured on this server. The file was not delivered automatically.'
      });
    }

    const buffer = Buffer.from(String(fileBase64), 'base64');
    const maxBytes = format === 'pdf' ? 20 * 1024 * 1024 : 5 * 1024 * 1024;
    if (!buffer.length || buffer.length > maxBytes) {
      return res.status(400).json({
        success: false,
        message: `File exceeds the ${format === 'pdf' ? '20 MB' : '5 MB'} WhatsApp limit`
      });
    }

    // 1) Upload media to the WhatsApp Business Cloud API
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([buffer], { type: mimeType }), filename);
    const mediaRes = await fetch(
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/media`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
    );
    const mediaJson = await mediaRes.json().catch(() => ({}));
    if (!mediaRes.ok || !mediaJson.id) {
      console.error('[whatsapp] media upload failed', mediaRes.status, JSON.stringify(mediaJson).slice(0, 300));
      return res.status(502).json({
        success: false,
        message: 'WhatsApp media upload failed',
        detail: mediaJson?.error?.message
      });
    }

    // 2) Send document/image message with the uploaded media
    const type = format === 'pdf' ? 'document' : 'image';
    const media = { id: mediaJson.id };
    if (type === 'document') media.filename = filename;
    if (caption) media.caption = String(caption).slice(0, 1024);

    const sendRes = await fetch(
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: digits,
          type,
          [type]: media
        })
      }
    );
    const sendJson = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok) {
      console.error('[whatsapp] message send failed', sendRes.status, JSON.stringify(sendJson).slice(0, 300));
      return res.status(502).json({
        success: false,
        message: 'WhatsApp message send failed',
        detail: sendJson?.error?.message
      });
    }

    res.status(200).json({
      success: true,
      whatsappConfigured: true,
      message: `Sales order ${order.orderNumber} sent to ${digits} on WhatsApp`,
      data: { messageId: sendJson?.messages?.[0]?.id || null }
    });
  } catch (error) {
    console.error('[whatsapp] sendSalesOrder error', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  // Sales Orders
  createSalesOrder,
  updateSalesOrder,
  getSalesOrders,
  sendWhatsAppOrder,
  
  // Purchase Orders
  createPurchaseOrder,
  getPurchaseOrders,
  
  // Shared
  getOrderById,
  updateOrderStatus,
  updateOrderPayment,
  cancelOrder,
  deleteOrder,
  getOrderStats,
  getOrderKPI
};