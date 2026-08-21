// controllers/inventoryController.js - MULTI-TENANT VERSION WITH DEBUG LOGS

const prisma = require('../../prisma/client');

// ============================================================
// @desc    Get inventory valuation data (User-specific)
// @route   GET /api/inventory/valuation
// @access  Private
// ============================================================
const getInventoryValuation = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      category,
      search,
      sortBy = 'name',
      sortOrder = 'asc',
      locationId,
    } = req.query;

    if (locationId) {
      const loc = await prisma.location.findFirst({
        where: { id: locationId, companyId, isDeleted: false },
        select: { id: true },
      });
      if (!loc) {
        return res.status(400).json({
          success: false,
          message: 'Location not found',
        });
      }
    }

    const filter = {
      companyId,
      isActive: true,
    };

    if (locationId) {
      filter.productStocks = { some: { locationId, companyId } };
    }

    // Category: accept id or name (UI sends name)
    if (category && category !== 'all') {
      const categoryExists = await prisma.category.findFirst({
        where: {
          companyId,
          OR: [{ id: category }, { name: category }],
        },
        select: { id: true, name: true },
      });

      if (!categoryExists) {
        return res.status(404).json({
          success: false,
          message: 'Category not found',
        });
      }
      filter.categoryId = categoryExists.id;
    }

    if (search) {
      filter.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }

    const products = await prisma.product.findMany({
      where: filter,
      include: {
        category: {
          select: { id: true, name: true },
        },
        ...(locationId
          ? {
              productStocks: {
                where: { locationId, companyId },
                select: { currentStock: true },
              },
            }
          : {}),
      },
      orderBy: {
        [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc',
      },
    });

    const valuationData = products.map((product) => {
      const qty = locationId
        ? product.productStocks?.[0]?.currentStock ?? 0
        : product.currentStock || 0;
      const unitCost = product.costPrice || 0;
      const sellingPrice = product.sellingPrice || 0;
      const totalCostValue = qty * unitCost;
      const sellingValue = qty * sellingPrice;
      const potentialProfit = sellingValue - totalCostValue;

      let status = 'OK';
      if (qty <= (product.minimumStock || 0)) {
        status = 'LOW';
      } else if (
        (product.maximumStock || 0) > 0 &&
        qty >= product.maximumStock
      ) {
        status = 'OVER';
      }

      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        category: product.category ? product.category.name : 'Uncategorized',
        categoryId: product.categoryId,
        qty,
        unitCost,
        sellingPrice,
        totalCostValue,
        sellingValue,
        potentialProfit,
        profitMargin:
          unitCost > 0
            ? (((sellingPrice - unitCost) / unitCost) * 100).toFixed(1)
            : 0,
        minStock: product.minimumStock,
        maxStock: product.maximumStock,
        status,
        rackLocationName: product.rackLocationName,
        expiryDate: product.expiryDate,
        locationId: locationId || null,
      };
    });

    const summary = {
      totalItems: valuationData.length,
      totalQty: valuationData.reduce((sum, item) => sum + item.qty, 0),
      totalCostValue: valuationData.reduce(
        (sum, item) => sum + item.totalCostValue,
        0
      ),
      totalSellingValue: valuationData.reduce(
        (sum, item) => sum + item.sellingValue,
        0
      ),
      totalPotentialProfit: valuationData.reduce(
        (sum, item) => sum + item.potentialProfit,
        0
      ),
      avgProfitMargin:
        valuationData.length > 0
          ? valuationData.reduce(
              (sum, item) => sum + parseFloat(item.profitMargin),
              0
            ) / valuationData.length
          : 0,
      lowStockCount: valuationData.filter((item) => item.status === 'LOW')
        .length,
      overStockCount: valuationData.filter((item) => item.status === 'OVER')
        .length,
    };

    const categoryBreakdown = {};
    valuationData.forEach((item) => {
      const catName = item.category;
      if (!categoryBreakdown[catName]) {
        categoryBreakdown[catName] = {
          category: catName,
          items: 0,
          qty: 0,
          value: 0,
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
        summary,
        categoryBreakdown: Object.values(categoryBreakdown),
        locationId: locationId || null,
      },
    });
  } catch (error) {
    console.error('❌ Inventory valuation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
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
    const companyId = req.user.companyId;
    const locationId = req.query.locationId || null;

    if (locationId) {
      const loc = await prisma.location.findFirst({
        where: { id: locationId, companyId, isDeleted: false },
        select: { id: true },
      });
      if (!loc) {
        return res.status(400).json({
          success: false,
          message: 'Location not found',
        });
      }

      const stocks = await prisma.productStock.findMany({
        where: { companyId, locationId },
        include: {
          product: {
            select: {
              isActive: true,
              costPrice: true,
              sellingPrice: true,
              minimumStock: true,
              maximumStock: true,
            },
          },
        },
      });

      const rows = stocks.filter((s) => s.product?.isActive !== false);
      const summary = {
        totalItems: rows.length,
        totalQty: rows.reduce((sum, s) => sum + (s.currentStock || 0), 0),
        totalCostValue: rows.reduce(
          (sum, s) =>
            sum + (s.currentStock || 0) * (s.product?.costPrice || 0),
          0
        ),
        totalSellingValue: rows.reduce(
          (sum, s) =>
            sum + (s.currentStock || 0) * (s.product?.sellingPrice || 0),
          0
        ),
        lowStockCount: rows.filter((s) => {
          const min = s.product?.minimumStock || 0;
          return (s.currentStock || 0) <= min;
        }).length,
        overStockCount: rows.filter((s) => {
          const max = s.product?.maximumStock || 0;
          return max > 0 && (s.currentStock || 0) >= max;
        }).length,
      };
      summary.totalPotentialProfit =
        summary.totalSellingValue - summary.totalCostValue;

      return res.status(200).json({
        success: true,
        data: summary,
        locationId,
      });
    }

    const products = await prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
      },
      select: {
        currentStock: true,
        costPrice: true,
        sellingPrice: true,
        minimumStock: true,
        maximumStock: true,
      },
    });

    const summary = {
      totalItems: products.length,
      totalQty: products.reduce((sum, p) => sum + p.currentStock, 0),
      totalCostValue: products.reduce(
        (sum, p) => sum + p.currentStock * p.costPrice,
        0
      ),
      totalSellingValue: products.reduce(
        (sum, p) => sum + p.currentStock * p.sellingPrice,
        0
      ),
      lowStockCount: products.filter(
        (p) => p.currentStock <= p.minimumStock
      ).length,
      overStockCount: products.filter(
        (p) => p.currentStock >= p.maximumStock
      ).length,
    };

    summary.totalPotentialProfit =
      summary.totalSellingValue - summary.totalCostValue;

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('❌ Valuation summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
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

    const companyId = req.user.companyId;
    console.log('🔄 Fetching categories with products...');

    const categories = await prisma.category.findMany({
      where: {
        companyId: companyId,
        isActive: true
      },
      select: {
        id: true,
        name: true,
        products: {
          where: {
            companyId: companyId,
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
    const companyId = req.user.companyId;
    const { period = 'month' } = req.query;

    console.log('📌 Period:', period);

    const dateFilter = getDateFilter(period);
    console.log('📌 Date filter:', dateFilter);

    console.log('🔄 Fetching stock movements and products...');

    const [totalOut, products] = await Promise.all([
      prisma.stockMovement.aggregate({
        where: {
          companyId: companyId,
          type: 'stock_out',
          createdAt: dateFilter
        },
        _sum: { quantity: true }
      }),
      prisma.product.findMany({
        where: {
          companyId: companyId,
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