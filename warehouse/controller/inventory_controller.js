// controllers/inventoryController.js

const Product = require('../models/Product');
const Category = require('../models/Category');
const StockMovement = require('../models/StockMovement');

// @desc    Get inventory valuation data
// @route   GET /api/inventory/valuation
// @access  Private
const getInventoryValuation = async (req, res) => {
  try {
    const { category, search, sortBy = 'name', sortOrder = 'asc' } = req.query;

    console.log("===== INVENTORY VALUATION API =====");
    console.log("Category:", category);
    console.log("Search:", search);
    console.log("Sort By:", sortBy);
    console.log("Sort Order:", sortOrder);

    // Build filter
    const filter = {};
    if (category && category !== 'all') {
      filter.categoryId = category;
    }
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } }
      ];
    }

    // Get products with category population
    const products = await Product.find(filter)
      .populate('categoryId', 'name')
      .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 });

    console.log(`📦 Found ${products.length} products`);

    // Calculate valuation data
    const valuationData = products.map(product => {
      const unitCost = product.costPrice;
      const totalCostValue = product.currentStock * product.costPrice;
      const sellingValue = product.currentStock * product.sellingPrice;
      const potentialProfit = sellingValue - totalCostValue;
      
      // Determine status based on stock levels
      let status = 'OK';
      if (product.currentStock <= product.minimumStock) {
        status = 'LOW';
      } else if (product.currentStock >= product.maximumStock) {
        status = 'OVER';
      }

      return {
        id: product._id,
        name: product.name,
        sku: product.sku,
        category: product.categoryId ? product.categoryId.name : 'Uncategorized',
        categoryId: product.categoryId?._id,
        qty: product.currentStock,
        unitCost: product.costPrice,
        sellingPrice: product.sellingPrice,
        totalCostValue: totalCostValue,
        sellingValue: sellingValue,
        potentialProfit: potentialProfit,
        profitMargin: product.costPrice > 0 
          ? ((product.sellingPrice - product.costPrice) / product.costPrice * 100).toFixed(1)
          : 0,
        minStock: product.minimumStock,
        maxStock: product.maximumStock,
        status: status,
        location: product.location,
        expiryDate: product.expiryDate
      };
    });

    // Calculate summary
    const summary = {
      totalItems: valuationData.length,
      totalQty: valuationData.reduce((sum, item) => sum + item.qty, 0),
      totalCostValue: valuationData.reduce((sum, item) => sum + item.totalCostValue, 0),
      totalSellingValue: valuationData.reduce((sum, item) => sum + item.sellingValue, 0),
      totalPotentialProfit: valuationData.reduce((sum, item) => sum + item.potentialProfit, 0),
      avgProfitMargin: valuationData.length > 0
        ? valuationData.reduce((sum, item) => sum + parseFloat(item.profitMargin), 0) / valuationData.length
        : 0,
      lowStockCount: valuationData.filter(item => item.status === 'LOW').length,
      overStockCount: valuationData.filter(item => item.status === 'OVER').length,
    };

    // Category-wise breakdown
    const categoryBreakdown = {};
    valuationData.forEach(item => {
      const catName = item.category;
      if (!categoryBreakdown[catName]) {
        categoryBreakdown[catName] = {
          category: catName,
          items: 0,
          qty: 0,
          value: 0
        };
      }
      categoryBreakdown[catName].items++;
      categoryBreakdown[catName].qty += item.qty;
      categoryBreakdown[catName].value += item.totalCostValue;
    });

    res.status(200).json({
      success: true,
      data: {
        items: valuationData,
        summary: summary,
        categoryBreakdown: Object.values(categoryBreakdown)
      }
    });

  } catch (error) {
    console.error('Inventory valuation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Get valuation summary only (for dashboard)
// @route   GET /api/inventory/valuation/summary
// @access  Private
const getValuationSummary = async (req, res) => {
  try {
    console.log("===== VALUATION SUMMARY API =====");

    const products = await Product.find({}, 'currentStock costPrice sellingPrice minimumStock maximumStock');

    const summary = {
      totalItems: products.length,
      totalQty: products.reduce((sum, p) => sum + p.currentStock, 0),
      totalCostValue: products.reduce((sum, p) => sum + (p.currentStock * p.costPrice), 0),
      totalSellingValue: products.reduce((sum, p) => sum + (p.currentStock * p.sellingPrice), 0),
      lowStockCount: products.filter(p => p.currentStock <= p.minimumStock).length,
      overStockCount: products.filter(p => p.currentStock >= p.maximumStock).length,
    };

    summary.totalPotentialProfit = summary.totalSellingValue - summary.totalCostValue;

    res.status(200).json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('Valuation summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Get category breakdown for valuation
// @route   GET /api/inventory/valuation/categories
// @access  Private
const getCategoryBreakdown = async (req, res) => {
  try {
    console.log("===== CATEGORY BREAKDOWN API =====");

    const categories = await Category.aggregate([
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: 'categoryId',
          as: 'products'
        }
      },
      {
        $project: {
          name: 1,
          items: { $size: '$products' },
          qty: { $sum: '$products.currentStock' },
          value: {
            $sum: {
              $map: {
                input: '$products',
                as: 'p',
                in: { $multiply: ['$$p.currentStock', '$$p.costPrice'] }
              }
            }
          }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: categories
    });

  } catch (error) {
    console.error('Category breakdown error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

module.exports = {
  getInventoryValuation,
  getValuationSummary,
  getCategoryBreakdown
};