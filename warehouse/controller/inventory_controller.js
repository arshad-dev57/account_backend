// controllers/inventoryController.js - MULTI-TENANT VERSION WITH DEBUG LOGS

const prisma = require('../../prisma/client');

// ============================================================
// @desc    Get inventory valuation data (User-specific)
// @route   GET /api/inventory/valuation
// @access  Private
// ============================================================
const getInventoryValuation = async (req, res) => {
  try {
    console.log('\n========== 🚀 INVENTORY VALUATION API START ==========');
    console.log('📌 User ID from token:', req.user?.id);
    console.log('📌 Query params:', req.query);

    const userId = req.user.id;
    const { category, search, sortBy = 'name', sortOrder = 'asc' } = req.query;

    console.log('📌 User ID:', userId);
    console.log('📌 Category filter:', category);
    console.log('📌 Search term:', search);
    console.log('📌 Sort by:', sortBy, 'Order:', sortOrder);

    // ✅ Build filter with userId
    const filter = {
      userId: userId,
      isActive: true
    };
    console.log('📌 Initial filter:', JSON.stringify(filter, null, 2));

    // ─── CATEGORY FILTER ──────────────────────────────────────
    if (category && category !== 'all') {
      console.log('🔍 Checking category existence for user:', userId);
      
      const categoryExists = await prisma.category.findFirst({
        where: {
          id: category,
          userId: userId
        },
        select: { id: true, name: true }
      });
      
      console.log('📌 Category found:', categoryExists ? 'YES ✅' : 'NO ❌');
      console.log('📌 Category details:', categoryExists);

      if (!categoryExists) {
        console.log('❌ Category not found for this user');
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }
      filter.categoryId = category;
      console.log('📌 Added categoryId filter:', category);
    }

    // ─── SEARCH FILTER ─────────────────────────────────────────
    if (search) {
      console.log('🔍 Applying search filter:', search);
      filter.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } }
      ];
      console.log('📌 Search filter applied');
    }

    console.log('📌 Final filter:', JSON.stringify(filter, null, 2));

    // ─── GET PRODUCTS ──────────────────────────────────────────
    console.log('🔄 Fetching products from database...');
    
    const products = await prisma.product.findMany({
      where: filter,
      include: {
        category: {
          select: { id: true, name: true }
        }
      },
      orderBy: {
        [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc'
      }
    });

    console.log(`📦 Found ${products.length} products`);
    console.log('📌 First product sample:', products.length > 0 ? JSON.stringify(products[0], null, 2) : 'No products found');

    // ─── CALCULATE VALUATION DATA ─────────────────────────────
    console.log('🔄 Calculating valuation data...');
    
    const valuationData = products.map((product, index) => {
      const unitCost = product.costPrice || 0;
      const totalCostValue = product.currentStock * product.costPrice;
      const sellingValue = product.currentStock * product.sellingPrice;
      const potentialProfit = sellingValue - totalCostValue;
      
      let status = 'OK';
      if (product.currentStock <= product.minimumStock) {
        status = 'LOW';
      } else if (product.currentStock >= product.maximumStock) {
        status = 'OVER';
      }

      if (index === 0) {
        console.log('📌 Sample valuation calculation:', {
          name: product.name,
          currentStock: product.currentStock,
          costPrice: product.costPrice,
          sellingPrice: product.sellingPrice,
          totalCostValue,
          sellingValue,
          potentialProfit,
          status
        });
      }

      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        category: product.category ? product.category.name : 'Uncategorized',
        categoryId: product.categoryId,
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
        rackLocationName: product.rackLocationName,
        expiryDate: product.expiryDate
      };
    });

    console.log(`📊 Valuation data processed for ${valuationData.length} products`);

    // ─── CALCULATE SUMMARY ────────────────────────────────────
    console.log('🔄 Calculating summary...');
    
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

    console.log('📊 Summary:', JSON.stringify(summary, null, 2));

    // ─── CATEGORY BREAKDOWN ──────────────────────────────────
    console.log('🔄 Calculating category breakdown...');
    
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

    console.log('📊 Category breakdown:', Object.keys(categoryBreakdown).length, 'categories found');
    console.log('📌 Breakdown sample:', Object.values(categoryBreakdown).slice(0, 3));

    console.log('✅ INVENTORY VALUATION API COMPLETED SUCCESSFULLY');
    console.log('========== 🏁 END ==========\n');

    res.status(200).json({
      success: true,
      data: {
        items: valuationData,
        summary: summary,
        categoryBreakdown: Object.values(categoryBreakdown)
      }
    });

  } catch (error) {
    console.error('\n❌❌❌ INVENTORY VALUATION ERROR ❌❌❌');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error code:', error.code);
    console.error('Full error:', JSON.stringify(error, null, 2));
    console.log('========== 🏁 END ==========\n');
    
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// ============================================================
// @desc    Get valuation summary only (for dashboard) (User-specific)
// @route   GET /api/inventory/valuation/summary
// @access  Private
// ============================================================
const getValuationSummary = async (req, res) => {
  try {
    console.log('\n========== 🚀 VALUATION SUMMARY API START ==========');
    console.log('📌 User ID:', req.user?.id);

    const userId = req.user.id;

    console.log('🔄 Fetching products for summary...');

    const products = await prisma.product.findMany({
      where: {
        userId: userId,
        isActive: true
      },
      select: {
        currentStock: true,
        costPrice: true,
        sellingPrice: true,
        minimumStock: true,
        maximumStock: true
      }
    });

    console.log(`📦 Found ${products.length} products for summary`);

    const summary = {
      totalItems: products.length,
      totalQty: products.reduce((sum, p) => sum + p.currentStock, 0),
      totalCostValue: products.reduce((sum, p) => sum + (p.currentStock * p.costPrice), 0),
      totalSellingValue: products.reduce((sum, p) => sum + (p.currentStock * p.sellingPrice), 0),
      lowStockCount: products.filter(p => p.currentStock <= p.minimumStock).length,
      overStockCount: products.filter(p => p.currentStock >= p.maximumStock).length,
    };

    summary.totalPotentialProfit = summary.totalSellingValue - summary.totalCostValue;

    console.log('📊 Summary data:', JSON.stringify(summary, null, 2));
    console.log('✅ VALUATION SUMMARY API COMPLETED SUCCESSFULLY');
    console.log('========== 🏁 END ==========\n');

    res.status(200).json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('\n❌❌❌ VALUATION SUMMARY ERROR ❌❌❌');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error code:', error.code);
    console.log('========== 🏁 END ==========\n');
    
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// ============================================================
// @desc    Get category breakdown for valuation (User-specific)
// @route   GET /api/inventory/valuation/categories
// @access  Private
// ============================================================
const getCategoryBreakdown = async (req, res) => {
  try {
    console.log('\n========== 🚀 CATEGORY BREAKDOWN API START ==========');
    console.log('📌 User ID:', req.user?.id);

    const userId = req.user.id;

    console.log('🔄 Fetching categories with products...');

    const categories = await prisma.category.findMany({
      where: {
        userId: userId,
        isActive: true
      },
      select: {
        id: true,
        name: true,
        products: {
          where: {
            userId: userId,
            isActive: true
          },
          select: {
            currentStock: true,
            costPrice: true
          }
        }
      }
    });

    console.log(`📦 Found ${categories.length} categories`);

    const breakdown = categories.map(category => ({
      id: category.id,
      name: category.name,
      items: category.products.length,
      qty: category.products.reduce((sum, p) => sum + p.currentStock, 0),
      value: category.products.reduce((sum, p) => sum + (p.currentStock * p.costPrice), 0)
    }));

    const filteredBreakdown = breakdown.filter(c => c.items > 0);

    console.log(`📊 ${filteredBreakdown.length} categories with products`);
    console.log('📌 Sample breakdown:', filteredBreakdown.slice(0, 3));
    console.log('✅ CATEGORY BREAKDOWN API COMPLETED SUCCESSFULLY');
    console.log('========== 🏁 END ==========\n');

    res.status(200).json({
      success: true,
      data: filteredBreakdown
    });

  } catch (error) {
    console.error('\n❌❌❌ CATEGORY BREAKDOWN ERROR ❌❌❌');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error code:', error.code);
    console.log('========== 🏁 END ==========\n');
    
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// ============================================================
// @desc    Get inventory turnover report (User-specific)
// @route   GET /api/inventory/valuation/turnover
// @access  Private
// ============================================================
const getInventoryTurnover = async (req, res) => {
  try {
    console.log('\n========== 🚀 INVENTORY TURNOVER API START ==========');
    console.log('📌 User ID:', req.user?.id);
    console.log('📌 Query params:', req.query);

    const userId = req.user.id;
    const { period = 'month' } = req.query;

    console.log('📌 Period:', period);

    const dateFilter = getDateFilter(period);
    console.log('📌 Date filter:', dateFilter);

    console.log('🔄 Fetching stock movements and products...');

    const [totalOut, products] = await Promise.all([
      prisma.stockMovement.aggregate({
        where: {
          userId: userId,
          type: 'stock_out',
          createdAt: dateFilter
        },
        _sum: { quantity: true }
      }),
      prisma.product.findMany({
        where: {
          userId: userId,
          isActive: true
        },
        select: {
          id: true,
          name: true,
          sku: true,
          currentStock: true,
          costPrice: true
        }
      })
    ]);

    console.log(`📦 Found ${products.length} products`);
    console.log('📌 Total stock out:', totalOut._sum.quantity || 0);

    const totalSold = totalOut._sum.quantity || 0;
    const avgInventory = products.reduce((sum, p) => sum + p.currentStock, 0) / (products.length || 1);
    const turnoverRatio = avgInventory > 0 ? totalSold / avgInventory : 0;

    console.log('📊 Turnover calculation:', {
      totalSold,
      avgInventory: avgInventory.toFixed(2),
      turnoverRatio: turnoverRatio.toFixed(2)
    });

    console.log('✅ INVENTORY TURNOVER API COMPLETED SUCCESSFULLY');
    console.log('========== 🏁 END ==========\n');

    res.status(200).json({
      success: true,
      data: {
        period,
        totalSold,
        avgInventory,
        turnoverRatio: turnoverRatio.toFixed(2),
        products: products.map(p => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          currentStock: p.currentStock,
          stockValue: p.currentStock * p.costPrice
        }))
      }
    });

  } catch (error) {
    console.error('\n❌❌❌ INVENTORY TURNOVER ERROR ❌❌❌');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error code:', error.code);
    console.log('========== 🏁 END ==========\n');
    
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// ============================================================
// HELPER: Get Date Filter
// ============================================================
const getDateFilter = (period) => {
  console.log('📌 getDateFilter called with period:', period);
  
  const now = new Date();
  let start = new Date(now);
  
  console.log('📌 Current date:', now.toISOString());
  
  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
    console.log('📌 Today filter applied');
  } else if (period === 'week') {
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    console.log('📌 Week filter applied');
  } else if (period === 'month') {
    start.setMonth(start.getMonth() - 1);
    start.setHours(0, 0, 0, 0);
    console.log('📌 Month filter applied');
  } else if (period === 'year') {
    start.setFullYear(start.getFullYear() - 1);
    start.setHours(0, 0, 0, 0);
    console.log('📌 Year filter applied');
  } else {
    start.setMonth(start.getMonth() - 1);
    start.setHours(0, 0, 0, 0);
    console.log('📌 Default (month) filter applied');
  }
  
  console.log('📌 Start date:', start.toISOString());
  
  return { gte: start };
};

module.exports = {
  getInventoryValuation,
  getValuationSummary,
  getCategoryBreakdown,
  getInventoryTurnover
};