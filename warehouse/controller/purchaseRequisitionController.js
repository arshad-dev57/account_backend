const PurchaseRequisition = require('../models/PurchaseRequisition');
const PurchaseOrder = require('../models/PurchaseOrder');
const prisma = require('../../prisma/client');

const createPurchaseRequisition = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const {
      title,
      department,
      priority,
      requiredDate,
      suggestedSupplierId,
      notes,
      items,
      status,
      locationId,
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Requisition must have at least one item',
      });
    }

    const processedItems = [];
    for (const item of items) {
      let product = null;
      if (item.productId) {
        product = await prisma.product.findFirst({
          where: { id: item.productId, companyId, isActive: true },
        });
      } else if (item.sku) {
        product = await prisma.product.findFirst({
          where: { sku: item.sku, companyId, isActive: true },
        });
      }

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.productName || item.sku || item.productId}`,
        });
      }

      processedItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        estimatedUnitPrice: item.estimatedUnitPrice ?? product.costPrice ?? 0,
        notes: item.notes || '',
        purpose: item.purpose || '',
      });
    }

    const requisition = await PurchaseRequisition.create({
      title,
      department,
      priority,
      requiredDate,
      suggestedSupplierId,
      notes,
      items: processedItems,
      status: status || 'Draft',
      createdBy: userId,
      companyId,
      locationId,
    });

    res.status(201).json({
      success: true,
      message: 'Purchase requisition created successfully',
      data: requisition,
    });
  } catch (error) {
    console.error('Create purchase requisition error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
};

const getPurchaseRequisitions = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { status, search, page, limit, locationId } = req.query;
    const result = await PurchaseRequisition.findAll({
      companyId,
      locationId: locationId || undefined,
      status,
      search,
      page,
      limit,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Get purchase requisitions error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

const getPurchaseRequisitionById = async (req, res) => {
  try {
    const requisition = await PurchaseRequisition.findById(req.params.id, req.user.companyId);
    if (!requisition) {
      return res.status(404).json({ success: false, message: 'Purchase requisition not found' });
    }
    res.json({ success: true, data: requisition });
  } catch (error) {
    console.error('Get purchase requisition error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

const updatePurchaseRequisition = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const {
      title,
      department,
      priority,
      requiredDate,
      suggestedSupplierId,
      notes,
      items,
    } = req.body;

    let processedItems;
    if (items?.length) {
      processedItems = [];
      for (const item of items) {
        const product = await prisma.product.findFirst({
          where: { id: item.productId, companyId, isActive: true },
        });
        if (!product) {
          return res.status(404).json({
            success: false,
            message: `Product not found: ${item.productName || item.productId}`,
          });
        }
        processedItems.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: item.quantity,
          estimatedUnitPrice: item.estimatedUnitPrice ?? product.costPrice ?? 0,
          notes: item.notes || '',
          purpose: item.purpose || '',
        });
      }
    }

    const requisition = await PurchaseRequisition.update(
      req.params.id,
      {
        title,
        department,
        priority,
        requiredDate,
        suggestedSupplierId,
        notes,
        items: processedItems,
        updatedBy: userId,
      },
      companyId
    );

    res.json({
      success: true,
      message: 'Purchase requisition updated successfully',
      data: requisition,
    });
  } catch (error) {
    console.error('Update purchase requisition error:', error);
    res.status(400).json({ success: false, message: error.message || 'Server error' });
  }
};

const submitPurchaseRequisition = async (req, res) => {
  try {
    const data = await PurchaseRequisition.submit(req.params.id, req.user.companyId, req.user.id);
    res.json({ success: true, message: 'Requisition submitted for approval', data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Server error' });
  }
};

const approvePurchaseRequisition = async (req, res) => {
  try {
    const data = await PurchaseRequisition.approve(req.params.id, req.user.companyId, req.user.id);
    res.json({ success: true, message: 'Requisition approved', data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Server error' });
  }
};

const rejectPurchaseRequisition = async (req, res) => {
  try {
    const data = await PurchaseRequisition.reject(
      req.params.id,
      req.user.companyId,
      req.user.id,
      req.body.reason
    );
    res.json({ success: true, message: 'Requisition rejected', data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Server error' });
  }
};

const cancelPurchaseRequisition = async (req, res) => {
  try {
    const data = await PurchaseRequisition.cancel(req.params.id, req.user.companyId, req.user.id);
    res.json({ success: true, message: 'Requisition cancelled', data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Server error' });
  }
};

const deletePurchaseRequisition = async (req, res) => {
  try {
    await PurchaseRequisition.softDelete(req.params.id, req.user.companyId, req.user.id);
    res.json({ success: true, message: 'Requisition deleted' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Server error' });
  }
};

const getPurchaseRequisitionStats = async (req, res) => {
  try {
    const stats = await PurchaseRequisition.getStats(
      req.user.companyId,
      req.query.locationId || undefined
    );
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

const convertToPurchaseOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;
    const {
      supplierId,
      orderDate,
      expectedDeliveryDate,
      notes,
      termsConditions,
      items,
      locationId,
      status,
    } = req.body;

    const requisition = await PurchaseRequisition.findById(id, companyId);
    if (!requisition) {
      return res.status(404).json({ success: false, message: 'Purchase requisition not found' });
    }
    if (!requisition.canConvert) {
      return res.status(400).json({
        success: false,
        message: 'Only approved requisitions can be converted to purchase orders',
      });
    }

    const resolvedSupplierId = String(
      supplierId || requisition.suggestedSupplierId || ''
    ).trim();
    if (!resolvedSupplierId) {
      return res.status(400).json({
        success: false,
        message: 'Supplier is required to create a purchase order',
      });
    }

    const sourceItems = items?.length
      ? items
      : requisition.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.estimatedUnitPrice,
          discount: 0,
          taxRate: item.product?.taxRate || 0,
          notes: item.notes || '',
        }));

    if (!sourceItems.length) {
      return res.status(400).json({
        success: false,
        message: 'At least one item is required',
      });
    }

    const processedItems = [];
    for (const item of sourceItems) {
      const product = await prisma.product.findFirst({
        where: { id: item.productId, companyId, isActive: true },
      });
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.productId}`,
        });
      }
      processedItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice ?? item.estimatedUnitPrice ?? product.costPrice ?? 0,
        discount: item.discount || 0,
        taxRate: item.taxRate ?? product.taxRate ?? 0,
        notes: item.notes || '',
      });
    }

    const order = await PurchaseOrder.create({
      supplierId: resolvedSupplierId,
      orderDate: orderDate || new Date(),
      expectedDeliveryDate,
      notes: notes || `Converted from ${requisition.requisitionNumber}`,
      termsConditions,
      items: processedItems,
      status: status || 'Draft',
      createdBy: userId,
      companyId,
      locationId: locationId || requisition.locationId,
      purchaseRequisitionId: requisition.id,
      purchaseRequisitionNumber: requisition.requisitionNumber,
    });

    await PurchaseRequisition.markConverted(requisition.id, companyId, userId);

    res.status(201).json({
      success: true,
      message: 'Purchase order created from requisition',
      data: order,
    });
  } catch (error) {
    console.error('Convert requisition to PO error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

module.exports = {
  createPurchaseRequisition,
  getPurchaseRequisitions,
  getPurchaseRequisitionById,
  updatePurchaseRequisition,
  submitPurchaseRequisition,
  approvePurchaseRequisition,
  rejectPurchaseRequisition,
  cancelPurchaseRequisition,
  deletePurchaseRequisition,
  getPurchaseRequisitionStats,
  convertToPurchaseOrder,
};
