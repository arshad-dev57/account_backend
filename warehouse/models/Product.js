// warehouse/models/Product.js - Prisma Version (COMPLETE)
const prisma = require('../../prisma/client');

class ProductModel {
  // ============================================================
  // GET ALL PRODUCTS with filters, pagination, sorting
  // ============================================================
  static async findMany(filter = {}, options = {}) {
    const { skip, take, orderBy, include } = options;
    
    return await prisma.product.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: include || {
        category: {
          select: { id: true, name: true, code: true }
        },
        supplier: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // COUNT PRODUCTS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.product.count({ where: filter });
  }

  // ============================================================
  // FIND PRODUCT BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.product.findUnique({
      where: { id },
      include: {
        category: {
          select: { id: true, name: true, code: true }
        },
        supplier: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        variants: {
          select: { id: true, name: true, sku: true, sellingPrice: true, currentStock: true }
        }
      }
    });
  }

  // ============================================================
  // FIND PRODUCT BY SKU
  // ============================================================
  static async findBySku(sku) {
    return await prisma.product.findUnique({
      where: { sku }
    });
  }

  // ============================================================
  // FIND PRODUCT BY BARCODE
  // ============================================================
  static async findByBarcode(barcodeNumber) {
    return await prisma.product.findUnique({
      where: { barcodeNumber }
    });
  }

  // ============================================================
  // FIND LOW STOCK PRODUCTS
  // ============================================================
  static async findLowStock() {
    return await prisma.product.findMany({
      where: {
        isActive: true,
        currentStock: {
          lte: prisma.product.fields.minimumStock
        }
      },
      include: {
        category: {
          select: { id: true, name: true }
        }
      }
    });
  }

  // ============================================================
  // CREATE PRODUCT
  // ============================================================
  static async create(data) {
    // Auto-generate productId if not provided
    if (!data.productId) {
      const timestamp = Date.now().toString(36).toUpperCase();
      const random = Math.random().toString(36).substring(2, 6).toUpperCase();
      data.productId = `PRD-${timestamp}-${random}`;
    }

    // Calculate total value
    data.totalValue = (data.currentStock || 0) * (data.costPrice || 0);

    // Calculate available stock
    data.availableStock = Math.max(0, (data.currentStock || 0) - (data.reservedStock || 0));

    // Calculate margin
    if (data.costPrice && data.sellingPrice) {
      data.margin = data.sellingPrice - data.costPrice;
      data.marginPercentage = data.costPrice > 0 ? (data.margin / data.costPrice) * 100 : 0;
    }

    // Calculate volume
    if (data.length && data.width && data.height) {
      data.volume = data.length * data.width * data.height;
    }

    // Handle tags, colors, sizes as arrays
    if (data.tags && typeof data.tags === 'string') {
      data.tags = data.tags.split(',').map(t => t.trim());
    }
    if (data.colors && typeof data.colors === 'string') {
      data.colors = data.colors.split(',').map(c => c.trim());
    }
    if (data.sizes && typeof data.sizes === 'string') {
      data.sizes = data.sizes.split(',').map(s => s.trim());
    }

    return await prisma.product.create({
      data,
      include: {
        category: true,
        supplier: true
      }
    });
  }

  // ============================================================
  // UPDATE PRODUCT
  // ============================================================
  static async update(id, data) {
    // Get existing product for calculations
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return null;

    // Calculate total value
    const currentStock = data.currentStock !== undefined ? data.currentStock : existing.currentStock;
    const costPrice = data.costPrice !== undefined ? data.costPrice : existing.costPrice;
    data.totalValue = currentStock * costPrice;

    // Calculate available stock
    const reservedStock = data.reservedStock !== undefined ? data.reservedStock : existing.reservedStock;
    data.availableStock = Math.max(0, currentStock - reservedStock);

    // Calculate margin
    const sellingPrice = data.sellingPrice !== undefined ? data.sellingPrice : existing.sellingPrice;
    if (costPrice && sellingPrice) {
      data.margin = sellingPrice - costPrice;
      data.marginPercentage = costPrice > 0 ? (data.margin / costPrice) * 100 : 0;
    }

    // Calculate volume
    const length = data.length !== undefined ? data.length : existing.length;
    const width = data.width !== undefined ? data.width : existing.width;
    const height = data.height !== undefined ? data.height : existing.height;
    if (length && width && height) {
      data.volume = length * width * height;
    }

    // Handle arrays
    if (data.tags && typeof data.tags === 'string') {
      data.tags = data.tags.split(',').map(t => t.trim());
    }
    if (data.colors && typeof data.colors === 'string') {
      data.colors = data.colors.split(',').map(c => c.trim());
    }
    if (data.sizes && typeof data.sizes === 'string') {
      data.sizes = data.sizes.split(',').map(s => s.trim());
    }

    return await prisma.product.update({
      where: { id },
      data,
      include: {
        category: true,
        supplier: true
      }
    });
  }

  // ============================================================
  // DELETE PRODUCT (Hard Delete)
  // ============================================================
  static async delete(id) {
    return await prisma.product.delete({
      where: { id }
    });
  }

  // ============================================================
  // SOFT DELETE (Deactivate)
  // ============================================================
  static async deactivate(id) {
    return await prisma.product.update({
      where: { id },
      data: { isActive: false }
    });
  }

  // ============================================================
  // UPDATE STOCK - ADD/SUBTRACT/SET
  // ============================================================
  static async updateStock(id, quantity, type = 'add') {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return null;

    let newStock = product.currentStock;
    if (type === 'add') {
      newStock += quantity;
    } else if (type === 'subtract') {
      newStock = Math.max(0, newStock - quantity);
    } else if (type === 'set') {
      newStock = Math.max(0, quantity);
    }

    return await prisma.product.update({
      where: { id },
      data: {
        currentStock: newStock,
        availableStock: Math.max(0, newStock - product.reservedStock),
        totalValue: newStock * product.costPrice
      }
    });
  }

  // ============================================================
  // UPDATE STOCK WITH PREVIOUS VALUE (for stock movements)
  // ============================================================
  static async updateStockWithPrevious(id, newStock) {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return null;

    return await prisma.product.update({
      where: { id },
      data: {
        currentStock: newStock,
        availableStock: Math.max(0, newStock - product.reservedStock),
        totalValue: newStock * product.costPrice
      }
    });
  }

  // ============================================================
  // SEARCH PRODUCTS
  // ============================================================
  static async search(query, options = {}) {
    const { skip, take } = options;
    
    const filter = {
      isActive: true,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { sku: { contains: query, mode: 'insensitive' } },
        { barcodeNumber: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } }
      ]
    };

    const products = await prisma.product.findMany({
      where: filter,
      skip,
      take,
      include: {
        category: {
          select: { id: true, name: true }
        }
      }
    });

    const total = await prisma.product.count({ where: filter });

    return { products, total };
  }

  // ============================================================
  // GET BY CATEGORY
  // ============================================================
  static async findByCategory(categoryId) {
    return await prisma.product.findMany({
      where: {
        categoryId,
        isActive: true
      },
      include: {
        supplier: {
          select: { id: true, name: true }
        }
      }
    });
  }

  // ============================================================
  // GET BY SUPPLIER
  // ============================================================
  static async findBySupplier(supplierId) {
    return await prisma.product.findMany({
      where: {
        supplierId,
        isActive: true
      }
    });
  }

  // ============================================================
  // GET PRODUCT STATS
  // ============================================================
  static async getStats() {
    const [total, active, lowStock, outOfStock] = await Promise.all([
      prisma.product.count(),
      prisma.product.count({ where: { isActive: true } }),
      prisma.product.count({
        where: {
          isActive: true,
          currentStock: {
            lte: prisma.product.fields.minimumStock
          }
        }
      }),
      prisma.product.count({
        where: {
          isActive: true,
          currentStock: 0
        }
      })
    ]);

    return { total, active, lowStock, outOfStock };
  }
}

module.exports = ProductModel;