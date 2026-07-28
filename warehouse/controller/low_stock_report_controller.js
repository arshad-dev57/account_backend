const prisma = require('../../prisma/client');

// ============================================================
// @desc    Get low stock report data
// @route   GET /api/warehouse/reports/low-stock
// @access  Private
// ============================================================
const getLowStockReport = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    
    // Get all products for the user
    const allProducts = await prisma.product.findMany({
      where: {
        companyId: companyId,
        isActive: true
      },
      select: {
        id: true,
        name: true,
        sku: true,
        barcodeNumber: true,
        currentStock: true,
        minimumStock: true,
        sellingPrice: true,
        category: {
          select: { id: true, name: true }
        },
        supplier: {
          select: { id: true, name: true }
        }
      }
    });

    // Filter low stock products
    const lowStockProducts = allProducts.filter(p => {
      const isLowStock = p.currentStock <= p.minimumStock;
      const isOutOfStock = p.currentStock === 0;
      return isLowStock || isOutOfStock;
    });

    // Calculate counts
    const criticalCount = lowStockProducts.filter(p => p.currentStock === 0).length;
    const lowCount = lowStockProducts.filter(p => p.currentStock > 0 && p.currentStock <= p.minimumStock).length;

    // Calculate needed quantity for each product
    const lowStockWithDetails = lowStockProducts.map(p => {
      const needed = p.minimumStock - p.currentStock;
      const isOutOfStock = p.currentStock === 0;
      const status = isOutOfStock ? 'out_of_stock' : 'low_stock';
      
      return {
        ...p,
        needed,
        status
      };
    });

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalProducts: allProducts.length,
          lowStockCount: lowStockProducts.length,
          criticalCount,
          lowCount
        },
        lowStockProducts: lowStockWithDetails
      }
    });
  } catch (error) {
    console.error('Get low stock report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

module.exports = {
  getLowStockReport
};
