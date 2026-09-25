// warehouse/controller/internalTransferController.js
const InternalTransfer = require('../models/InternalTransfer');
const prisma = require('../../prisma/client');

// List Transfers
const listTransfers = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      page = 1,
      limit = 20,
      search,
      status,
      fromLocationId,
      toLocationId,
      dateFrom,
      dateTo,
    } = req.query;

    const result = await InternalTransfer.list({
      companyId,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      search,
      status,
      fromLocationId,
      toLocationId,
      dateFrom,
      dateTo,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error listing internal transfers:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to list internal transfers',
    });
  }
};

// Get Transfer by ID
const getTransfer = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const transfer = await InternalTransfer.getById(id, companyId);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: 'Internal transfer not found',
      });
    }

    res.json({
      success: true,
      data: transfer,
    });
  } catch (error) {
    console.error('Error fetching internal transfer:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch internal transfer',
    });
  }
};

// Create Transfer
const createTransfer = async (req, res) => {
  try {
    const userId = req.user.id;
    const userName = req.user.name || req.user.email || 'User';
    const companyId = req.user.companyId;

    const {
      fromLocationId,
      toLocationId,
      transferDate,
      expectedDate,
      priority,
      reference,
      reason,
      notes,
      items,
    } = req.body;

    if (!fromLocationId || !toLocationId) {
      return res.status(400).json({
        success: false,
        message: 'Source and Destination locations are required',
      });
    }

    if (fromLocationId === toLocationId) {
      return res.status(400).json({
        success: false,
        message: 'Source and Destination locations cannot be the same',
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Transfer must contain at least one item',
      });
    }

    const transfer = await InternalTransfer.create({
      companyId,
      createdBy: userId,
      userName,
      fromLocationId,
      toLocationId,
      transferDate,
      expectedDate,
      priority,
      reference,
      reason,
      notes,
      items,
    });

    res.status(201).json({
      success: true,
      data: transfer,
      message: 'Internal transfer created successfully',
    });
  } catch (error) {
    console.error('Error creating internal transfer:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create internal transfer',
    });
  }
};

// Update Transfer (Draft status only)
const updateTransfer = async (req, res) => {
  try {
    const userId = req.user.id;
    const userName = req.user.name || req.user.email || 'User';
    const companyId = req.user.companyId;
    const { id } = req.params;

    const transfer = await InternalTransfer.update({
      id,
      companyId,
      userId,
      userName,
      data: req.body,
    });

    res.json({
      success: true,
      data: transfer,
      message: 'Internal transfer updated successfully',
    });
  } catch (error) {
    console.error('Error updating internal transfer:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update internal transfer',
    });
  }
};

// Action: Confirm Transfer
const confirmTransfer = async (req, res) => {
  try {
    const userId = req.user.id;
    const userName = req.user.name || req.user.email || 'User';
    const companyId = req.user.companyId;
    const { id } = req.params;

    const transfer = await InternalTransfer.confirm({
      id,
      companyId,
      userId,
      userName,
    });

    res.json({
      success: true,
      data: transfer,
      message: 'Transfer confirmed successfully',
    });
  } catch (error) {
    console.error('Error confirming transfer:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to confirm transfer',
    });
  }
};

// Action: Dispatch Transfer
const dispatchTransfer = async (req, res) => {
  try {
    const userId = req.user.id;
    const userName = req.user.name || req.user.email || 'User';
    const companyId = req.user.companyId;
    const { id } = req.params;

    const transfer = await InternalTransfer.dispatch({
      id,
      companyId,
      userId,
      userName,
      dispatchDetails: req.body,
    });

    res.json({
      success: true,
      data: transfer,
      message: 'Transfer dispatched successfully',
    });
  } catch (error) {
    console.error('Error dispatching transfer:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to dispatch transfer',
    });
  }
};

// Action: Receive Transfer
const receiveTransfer = async (req, res) => {
  try {
    const userId = req.user.id;
    const userName = req.user.name || req.user.email || 'User';
    const companyId = req.user.companyId;
    const { id } = req.params;

    const transfer = await InternalTransfer.receive({
      id,
      companyId,
      userId,
      userName,
      receiveDetails: req.body,
    });

    res.json({
      success: true,
      data: transfer,
      message: 'Transfer received successfully',
    });
  } catch (error) {
    console.error('Error receiving transfer:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to receive transfer',
    });
  }
};

// Action: Complete Transfer
const completeTransfer = async (req, res) => {
  try {
    const userId = req.user.id;
    const userName = req.user.name || req.user.email || 'User';
    const companyId = req.user.companyId;
    const { id } = req.params;

    const transfer = await InternalTransfer.complete({
      id,
      companyId,
      userId,
      userName,
    });

    res.json({
      success: true,
      data: transfer,
      message: 'Transfer marked as complete',
    });
  } catch (error) {
    console.error('Error completing transfer:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to complete transfer',
    });
  }
};

// Action: Cancel Transfer
const cancelTransfer = async (req, res) => {
  try {
    const userId = req.user.id;
    const userName = req.user.name || req.user.email || 'User';
    const companyId = req.user.companyId;
    const { id } = req.params;
    const { cancelReason } = req.body;

    const transfer = await InternalTransfer.cancel({
      id,
      companyId,
      userId,
      userName,
      cancelReason,
    });

    res.json({
      success: true,
      data: transfer,
      message: 'Transfer cancelled successfully',
    });
  } catch (error) {
    console.error('Error cancelling transfer:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to cancel transfer',
    });
  }
};

// Helper: Get product stock at specific location
const { getOrCreateProductStock, absorbUnallocatedStock } = require('../services/locationService');

const getProductStock = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { productId, locationId } = req.query;

    if (!productId || !locationId) {
      return res.status(400).json({
        success: false,
        message: 'productId and locationId are required',
      });
    }

    // Ensure ProductStock row exists and absorb any unallocated stock from Product table
    try {
      await getOrCreateProductStock(prisma, { companyId, productId, locationId });
      await absorbUnallocatedStock(prisma, { productId, locationId });
    } catch (e) {
      console.warn('Warning absorbing stock:', e.message);
    }

    const stock = await prisma.productStock.findUnique({
      where: {
        productId_locationId: {
          productId,
          locationId,
        },
      },
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true, availableStock: true } },
        location: { select: { id: true, name: true, code: true } },
      },
    });

    let currentStock = stock?.currentStock ?? 0;
    let availableStock = stock?.availableStock ?? 0;
    let reservedStock = stock?.reservedStock ?? 0;

    // Fallback: If ProductStock has 0, check if Product itself has stock
    if (currentStock === 0) {
      const prod = await prisma.product.findUnique({
        where: { id: productId },
        select: { currentStock: true, availableStock: true },
      });
      if (prod && (prod.currentStock > 0 || prod.availableStock > 0)) {
        currentStock = prod.currentStock ?? 0;
        availableStock = prod.availableStock ?? prod.currentStock ?? 0;
      }
    }

    res.json({
      success: true,
      data: {
        productId,
        locationId,
        currentStock,
        reservedStock,
        availableStock,
      },
    });
  } catch (error) {
    console.error('Error fetching product stock:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch product stock',
    });
  }
};

module.exports = {
  listTransfers,
  getTransfer,
  createTransfer,
  updateTransfer,
  confirmTransfer,
  dispatchTransfer,
  receiveTransfer,
  completeTransfer,
  cancelTransfer,
  getProductStock,
};
