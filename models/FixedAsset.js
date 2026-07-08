const prisma = require('../prisma/client');

// ─── CONSTANTS ─────────────────────────────────────────────────────
const VALID_CATEGORIES = ['Building', 'Vehicle', 'IT Equipment', 'Furniture', 'Machinery', 'Equipment'];
const VALID_DEPRECIATION_METHODS = ['Straight Line', 'Declining Balance', 'Units of Production'];
const VALID_STATUS = ['Active', 'Fully Depreciated', 'Disposed'];

class FixedAssetModel {
  // ============================================================
  // ✅ VALIDATE FIXED ASSET DATA
  // ============================================================
  static validateAssetData(data) {
    const errors = [];

    if (!data.name) errors.push('Asset name is required');
    if (!data.category) errors.push('Category is required');
    if (!data.purchaseDate) errors.push('Purchase date is required');
    if (!data.purchaseCost || data.purchaseCost <= 0) errors.push('Purchase cost must be greater than 0');
    if (!data.usefulLife || data.usefulLife < 1) errors.push('Useful life must be at least 1 year');
    if (data.salvageValue < 0) errors.push('Salvage value cannot be negative');

    if (data.category && !VALID_CATEGORIES.includes(data.category)) {
      errors.push(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }

    if (data.depreciationMethod && !VALID_DEPRECIATION_METHODS.includes(data.depreciationMethod)) {
      errors.push(`Invalid depreciation method. Must be one of: ${VALID_DEPRECIATION_METHODS.join(', ')}`);
    }

    if (data.status && !VALID_STATUS.includes(data.status)) {
      errors.push(`Invalid status. Must be one of: ${VALID_STATUS.join(', ')}`);
    }

    return errors;
  }

  // ============================================================
  // ✅ GENERATE ASSET CODE
  // ============================================================
  static async generateAssetCode(userId) {
    const count = await prisma.fixedAsset.count({
      where: { createdBy: userId }
    });
    const year = new Date().getFullYear();
    return `FA-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  // ============================================================
  // ✅ CALCULATE MONTHLY DEPRECIATION
  // ============================================================
  static calculateMonthlyDepreciation(asset) {
    if (asset.depreciationMethod === 'Straight Line') {
      const depreciableAmount = asset.purchaseCost - asset.salvageValue;
      const totalMonths = asset.usefulLife * 12;
      return depreciableAmount / totalMonths;
    }
    // TODO: Add other depreciation methods
    return 0;
  }

  // ============================================================
  // ✅ CREATE FIXED ASSET
  // ============================================================
  static async create(data) {
    const errors = this.validateAssetData(data);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    const assetCode = await this.generateAssetCode(data.createdBy);
    const netBookValue = data.purchaseCost;

    return await prisma.fixedAsset.create({
      data: {
        assetCode,
        name: data.name,
        category: data.category,
        purchaseDate: data.purchaseDate,
        purchaseCost: data.purchaseCost,
        usefulLife: data.usefulLife,
        salvageValue: data.salvageValue || 0,
        depreciationMethod: data.depreciationMethod || 'Straight Line',
        currentDepreciation: 0,
        accumulatedDepreciation: 0,
        netBookValue: netBookValue,
        location: data.location || '',
        supplierId: data.supplierId || null,
        supplierName: data.supplierName || '',
        warrantyExpiry: data.warrantyExpiry || null,
        notes: data.notes || '',
        status: 'Active',
        createdBy: data.createdBy
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ FIND ALL ASSETS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { createdAt: 'desc' } } = options;

    return await prisma.fixedAsset.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ FIND ASSET BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.fixedAsset.findUnique({
      where: { id },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            address: true
          }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ FIND BY ASSET CODE
  // ============================================================
  static async findByAssetCode(assetCode, createdBy) {
    return await prisma.fixedAsset.findFirst({
      where: {
        assetCode,
        createdBy
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ UPDATE FIXED ASSET
  // ============================================================
  static async update(id, data) {
    const existing = await prisma.fixedAsset.findUnique({
      where: { id }
    });

    if (!existing) return null;

    const mergedData = { ...existing, ...data };
    const errors = this.validateAssetData(mergedData);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    return await prisma.fixedAsset.update({
      where: { id },
      data: {
        name: data.name,
        category: data.category,
        purchaseDate: data.purchaseDate,
        purchaseCost: data.purchaseCost,
        usefulLife: data.usefulLife,
        salvageValue: data.salvageValue,
        depreciationMethod: data.depreciationMethod,
        location: data.location,
        supplierId: data.supplierId,
        supplierName: data.supplierName,
        warrantyExpiry: data.warrantyExpiry,
        notes: data.notes,
        status: data.status
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ RUN DEPRECIATION
  // ============================================================
  static async runDepreciation(id, depreciationDate) {
    const asset = await prisma.fixedAsset.findUnique({
      where: { id }
    });

    if (!asset) return null;

    // Check if already fully depreciated
    if (asset.netBookValue <= asset.salvageValue) {
      await prisma.fixedAsset.update({
        where: { id },
        data: { status: 'Fully Depreciated' }
      });
      return {
        asset,
        amount: 0,
        message: 'Asset already fully depreciated'
      };
    }

    const monthlyDepreciation = this.calculateMonthlyDepreciation(asset);
    const newAccumulatedDepreciation = asset.accumulatedDepreciation + monthlyDepreciation;
    const newNetBookValue = asset.purchaseCost - newAccumulatedDepreciation;

    let status = asset.status;
    if (newNetBookValue <= asset.salvageValue) {
      status = 'Fully Depreciated';
    }

    const updatedAsset = await prisma.fixedAsset.update({
      where: { id },
      data: {
        currentDepreciation: monthlyDepreciation,
        accumulatedDepreciation: newAccumulatedDepreciation,
        netBookValue: newNetBookValue,
        lastDepreciationDate: depreciationDate || new Date(),
        status: status
      }
    });

    return {
      asset: updatedAsset,
      amount: monthlyDepreciation,
      accumulatedDepreciation: newAccumulatedDepreciation,
      netBookValue: newNetBookValue,
      status: status
    };
  }

  // ============================================================
  // ✅ DISPOSE FIXED ASSET
  // ============================================================
  static async dispose(id, data) {
    const asset = await prisma.fixedAsset.findUnique({
      where: { id }
    });

    if (!asset) return null;

    const disposalAmount = data.disposalAmount || 0;
    const gainLoss = disposalAmount - asset.netBookValue;

    const updatedAsset = await prisma.fixedAsset.update({
      where: { id },
      data: {
        status: 'Disposed',
        disposedDate: data.disposalDate || new Date(),
        disposalAmount: disposalAmount,
        disposalReason: data.disposalReason || ''
      }
    });

    return {
      asset: updatedAsset,
      gainLoss: gainLoss
    };
  }

  // ============================================================
  // ✅ GET SUMMARY STATISTICS
  // ============================================================
  static async getStats(createdBy) {
    const filter = { createdBy };

    const assets = await prisma.fixedAsset.findMany({
      where: filter
    });

    const totalAssets = assets.length;
    const totalCost = assets.reduce((sum, a) => sum + a.purchaseCost, 0);
    const accumulatedDepreciation = assets.reduce((sum, a) => sum + a.accumulatedDepreciation, 0);
    const netBookValue = totalCost - accumulatedDepreciation;

    const activeCount = assets.filter(a => a.status === 'Active').length;
    const fullyDepreciatedCount = assets.filter(a => a.status === 'Fully Depreciated').length;
    const disposedCount = assets.filter(a => a.status === 'Disposed').length;

    return {
      totalAssets,
      totalCost,
      accumulatedDepreciation,
      netBookValue,
      activeCount,
      fullyDepreciatedCount,
      disposedCount
    };
  }

  // ============================================================
  // ✅ DELETE FIXED ASSET
  // ============================================================
  static async delete(id) {
    return await prisma.fixedAsset.delete({
      where: { id }
    });
  }
}

module.exports = FixedAssetModel;