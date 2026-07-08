// warehouse/models/StockMovement.js - Prisma Version
const prisma = require('../../prisma/client');

class StockMovementModel {
  // ============================================================
  // CREATE STOCK MOVEMENT
  // ============================================================
  static async create(data) {
    return await prisma.stockMovement.create({
      data: {
        productId: data.productId,
        productName: data.productName,
        type: data.type,
        quantity: data.quantity,
        previousStock: data.previousStock,
        newStock: data.newStock,
        stockType: data.stockType || 'bulk',
        stockDetails: data.stockDetails || {},
        reason: data.reason,
        supplierId: data.supplierId || null,
        supplierName: data.supplierName || null,
        customerName: data.customerName || null,
        reference: data.reference || '',
        status: data.status || 'Completed',
        notes: data.notes || '',
        createdBy: data.createdBy
      },
      include: {
        product: {
          select: { id: true, name: true, sku: true }
        },
        supplier: {
          select: { id: true, name: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // GET STOCK HISTORY BY PRODUCT ID
  // ============================================================
  static async findByProductId(productId, options = {}) {
    const { skip, take, orderBy = { createdAt: 'desc' } } = options;
    
    return await prisma.stockMovement.findMany({
      where: { productId },
      skip,
      take,
      orderBy,
      include: {
        product: {
          select: { id: true, name: true, sku: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // COUNT STOCK MOVEMENTS BY PRODUCT ID
  // ============================================================
  static async countByProductId(productId) {
    return await prisma.stockMovement.count({
      where: { productId }
    });
  }

  // ============================================================
  // GET ALL STOCK MOVEMENTS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { createdAt: 'desc' } } = options;
    
    return await prisma.stockMovement.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        product: {
          select: { id: true, name: true, sku: true }
        },
        supplier: {
          select: { id: true, name: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // COUNT STOCK MOVEMENTS WITH FILTERS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.stockMovement.count({ where: filter });
  }

  // ============================================================
  // GET TODAY'S MOVEMENTS
  // ============================================================
  static async findToday(filter = {}) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return await prisma.stockMovement.findMany({
      where: {
        ...filter,
        createdAt: {
          gte: today,
          lt: tomorrow
        }
      },
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          select: { id: true, name: true, sku: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // GET STOCK MOVEMENT BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.stockMovement.findUnique({
      where: { id },
      include: {
        product: {
          select: { id: true, name: true, sku: true }
        },
        supplier: {
          select: { id: true, name: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // UPDATE STOCK MOVEMENT
  // ============================================================
  static async update(id, data) {
    return await prisma.stockMovement.update({
      where: { id },
      data: {
        status: data.status,
        notes: data.notes
      },
      include: {
        product: {
          select: { id: true, name: true, sku: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // DELETE STOCK MOVEMENT
  // ============================================================
  static async delete(id) {
    return await prisma.stockMovement.delete({
      where: { id }
    });
  }

  // ============================================================
  // GET SUMMARY STATS
  // ============================================================
  static async getSummary(filter = {}) {
    const [totalIn, totalOut, total] = await Promise.all([
      prisma.stockMovement.count({ where: { ...filter, type: 'stock_in' } }),
      prisma.stockMovement.count({ where: { ...filter, type: 'stock_out' } }),
      prisma.stockMovement.count({ where: filter })
    ]);

    return { totalIn, totalOut, total };
  }
}

module.exports = StockMovementModel;