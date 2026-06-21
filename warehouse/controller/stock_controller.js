// controllers/stockController.js

const StockMovement = require('../models/StockMovement');
const Product = require('../models/Product');
const mongoose = require('mongoose');
// @desc    Add stock (Stock In)
// @route   POST /api/stock/in
// @access  Private
// controllers/stock_controller.js

// @desc    Add stock (Stock In)
// @route   POST /api/stock/in
// @access  Private
const addStock = async (req, res) => {
  try {
    const {
      productId,
      quantity,
      reason,
      supplierId,
      supplierName,
      reference,
      notes
    } = req.body;

    console.log("===== STOCK IN API =====");
    console.log("Body:", req.body);
    console.log("User:", req.user?.id);

    if (!productId || !quantity || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Please provide productId, quantity and reason'
      });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const previousStock = product.currentStock;
    const newStock = previousStock + parseInt(quantity);

    product.currentStock = newStock;
    await product.save();

    // ✅ Create movement with optional supplierId
    const movementData = {
      productId,
      productName: product.name,
      type: 'stock_in',
      quantity: parseInt(quantity),
      previousStock,
      newStock,
      reason,
      reference: reference || '',
      notes: notes || '',
      createdBy: req.user.id
    };

    // ✅ Only add supplierId if it's provided and not empty
    if (supplierId && supplierId.trim() !== '') {
      movementData.supplierId = supplierId;
      movementData.supplierName = supplierName || '';
    }

    const movement = await StockMovement.create(movementData);

    // Populate user info
    await movement.populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      message: 'Stock added successfully',
      data: {
        movement,
        product: {
          id: product._id,
          name: product.name,
          currentStock: product.currentStock
        }
      }
    });

  } catch (error) {
    console.error('Stock In error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};
// controllers/stockController.js - Add this function

// @desc    Remove stock (Stock Out)
// @route   POST /api/stock/out
// @access  Private
const removeStock = async (req, res) => {
  try {
    const {
      productId,
      quantity,
      reason,
      reference,
      notes
    } = req.body;

    console.log("===== STOCK OUT API =====");
    console.log("Body:", req.body);
    console.log("User:", req.user?.id);

    // Validation
    if (!productId || !quantity || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Please provide productId, quantity and reason'
      });
    }

    // Find product
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if sufficient stock
    if (product.currentStock < quantity) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock. Available: ${product.currentStock}`
      });
    }

    const previousStock = product.currentStock;
    const newStock = previousStock - parseInt(quantity);

    // Update product stock
    product.currentStock = newStock;
    await product.save();

    // Create stock movement record
    const movement = await StockMovement.create({
      productId,
      productName: product.name,
      type: 'stock_out',
      quantity: parseInt(quantity),
      previousStock,
      newStock,
      reason,
      reference,
      notes,
      createdBy: req.user.id
    });

    // Populate user info
    await movement.populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      message: 'Stock removed successfully',
      data: {
        movement,
        product: {
          id: product._id,
          name: product.name,
          currentStock: product.currentStock
        }
      }
    });

  } catch (error) {
    console.error('Stock Out error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};
// controllers/stockController.js - Add this function
// controllers/stockController.js

// @desc    Get stock history for a specific product
// @route   GET /api/stock/history/:productId
// @access  Private
const getStockHistory = async (req, res) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    console.log("===== GET STOCK HISTORY =====");
    console.log("Product ID:", productId);
    console.log("Page:", page);
    console.log("Limit:", limit);

    // Validate productId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID format'
      });
    }

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Get stock movements for this product only
    const movements = await StockMovement.find({ productId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('createdBy', 'name email');

    const total = await StockMovement.countDocuments({ productId });

    res.status(200).json({
      success: true,
      data: movements,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get stock history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};


const getAllStockHistory = async (req, res) => {
  try {
    const { page = 1, limit = 100 } = req.query;

    console.log("===== GET ALL STOCK HISTORY =====");
    console.log("Page:", page);
    console.log("Limit:", limit);

    // Pagination
    const skip = (page - 1) * limit;

    // Get all stock movements (no productId filter)
    const movements = await StockMovement.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('createdBy', 'name email');

    const total = await StockMovement.countDocuments();

    res.status(200).json({
      success: true,
      data: movements,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get all stock history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// 🔥 NEW: Get today's movements
// @route   GET /api/stock/movements/today
// @access  Private
const getTodayMovements = async (req, res) => {
  try {
    const { type } = req.query; // 'all', 'in', 'out'

    console.log("===== GET TODAY'S MOVEMENTS =====");
    console.log("Type:", type);

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Build filter
    const filter = {
      createdAt: { $gte: today, $lt: tomorrow }
    };
    
    if (type && type !== 'all') {
      filter.type = type === 'in' ? 'stock_in' : 'stock_out';
    }

    const movements = await StockMovement.find(filter)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name email');

    const totalIn = await StockMovement.countDocuments({
      ...filter,
      type: 'stock_in'
    });
    
    const totalOut = await StockMovement.countDocuments({
      ...filter,
      type: 'stock_out'
    });

    res.status(200).json({
      success: true,
      data: movements,
      summary: {
        totalIn,
        totalOut,
        total: movements.length
      }
    });

  } catch (error) {
    console.error('Get today movements error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

module.exports = {
 addStock,
  removeStock,
  getStockHistory,
  getAllStockHistory, 
  getTodayMovements 
};