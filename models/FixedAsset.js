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
  // ✅ GENERATE UNIQUE ASSET CODE - FIXED
  // ============================================================
  static async generateAssetCode(companyId) {
    const prefix = 'FA-';
    
    // Get all existing asset codes for this company
    const existingAssets = await prisma.fixedAsset.findMany({
      where: {
        companyId: companyId,
        assetCode: {
          startsWith: prefix
        }
      },
      select: {
        assetCode: true
      }
    });

    console.log(`🔍 [FA] Found ${existingAssets.length} existing assets`);

    if (existingAssets.length === 0) {
      // No assets exist, start with FA-0001
      return `${prefix}0001`;
    }

    // Extract numbers from existing codes
    const numbers = [];
    for (const asset of existingAssets) {
      const parts = asset.assetCode.split('-');
      if (parts.length === 2) {
        const num = parseInt(parts[1]);
        if (!isNaN(num)) {
          numbers.push(num);
        }
      }
    }

    if (numbers.length === 0) {
      return `${prefix}0001`;
    }

    // Sort numbers and find the next available number
    numbers.sort((a, b) => a - b);
    
    // Find the first gap in the sequence
    let nextNumber = 1;
    for (const num of numbers) {
      if (num === nextNumber) {
        nextNumber++;
      } else if (num > nextNumber) {
        break;
      }
    }

    // Pad with zeros to 4 digits
    const paddedNumber = String(nextNumber).padStart(4, '0');
    const assetCode = `${prefix}${paddedNumber}`;
    
    console.log(`🔍 [FA] Generated asset code: ${assetCode} (next available number: ${nextNumber})`);
    return assetCode;
  }

  // ============================================================
  // ✅ GENERATE FALLBACK ASSET CODE (when all else fails)
  // ============================================================
  static async generateFallbackCode(companyId) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    const fallbackCode = `FA-${timestamp}${random}`.substring(0, 20);
    
    // Make sure it's unique
    const existing = await prisma.fixedAsset.findFirst({
      where: {
        assetCode: fallbackCode,
        companyId: companyId
      }
    });

    if (existing) {
      // If somehow this also exists, add more random
      return `FA-${timestamp}${random}${Math.random().toString(36).substring(2, 4).toUpperCase()}`;
    }

    return fallbackCode;
  }

  // ============================================================
  // ✅ CALCULATE MONTHLY DEPRECIATION
  // ============================================================
  static calculateMonthlyDepreciation(asset) {
    if (asset.depreciationMethod === 'Straight Line') {
      const depreciableAmount = asset.purchaseCost - asset.salvageValue;
      const totalMonths = asset.usefulLife * 12;
      if (totalMonths <= 0) return 0;
      return depreciableAmount / totalMonths;
    }
    // TODO: Add other depreciation methods
    return 0;
  }

  // ============================================================
  // ✅ CREATE FIXED ASSET - FIXED
  // ============================================================
  static async create(data) {
    const errors = this.validateAssetData(data);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    // Generate unique asset code with retry logic
    let assetCode = await this.generateAssetCode(data.companyId);
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      // Check if this code already exists (double-check)
      const existing = await prisma.fixedAsset.findFirst({
        where: {
          assetCode: assetCode,
          companyId: data.companyId
        }
      });

      if (!existing) {
        // Code is unique, break out of loop
        break;
      }

      // Code exists, generate a new one
      console.log(`⚠️ [FA] Asset code ${assetCode} already exists, generating new one...`);
      assetCode = await this.generateAssetCode(data.companyId);
      attempts++;
    }

    // If still not unique after max attempts, use fallback
    if (attempts >= maxAttempts) {
      console.log(`⚠️ [FA] Max attempts reached, using fallback code...`);
      assetCode = await this.generateFallbackCode(data.companyId);
    }

    console.log(`✅ [FA] Final asset code: ${assetCode}`);

    const openingAccumulated = parseFloat(data.openingAccumulatedDepreciation || 0);
    const netBookValue = Math.max(0, data.purchaseCost - openingAccumulated);

    const buildCreateData = (code) => {
      const createData = {
        assetCode: code,
        name: data.name,
        category: data.category,
        purchaseDate: data.purchaseDate,
        purchaseCost: data.purchaseCost,
        usefulLife: data.usefulLife,
        salvageValue: data.salvageValue || 0,
        depreciationMethod: data.depreciationMethod || 'Straight Line',
        currentDepreciation: 0,
        accumulatedDepreciation: openingAccumulated,
        netBookValue: netBookValue,
        location: data.location || '',
        supplierName: data.supplierName || '',
        acquisitionType: data.acquisitionType || 'purchase',
        paymentMethod: data.paymentMethod || 'Cash',
        openingAccumulatedDepreciation: openingAccumulated,
        warrantyExpiry: data.warrantyExpiry || null,
        notes: data.notes || '',
        status: 'Active',
        creator: { connect: { id: data.createdBy } }
      };

      if (data.supplierId) {
        createData.supplier = { connect: { id: data.supplierId } };
      }
      if (data.bankAccountId) {
        createData.bankAccount = { connect: { id: data.bankAccountId } };
      }
      if (data.companyId) {
        createData.company = { connect: { id: data.companyId } };
      }
      if (data.fiscalYearId) {
        createData.fiscalYear = { connect: { id: data.fiscalYearId } };
      }

      return createData;
    };

    const includeOpts = {
      supplier: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true
        }
      },
      bankAccount: {
        select: {
          id: true,
          accountName: true,
          accountNumber: true,
          bankName: true
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
    };

    try {
      return await prisma.fixedAsset.create({
        data: buildCreateData(assetCode),
        include: includeOpts
      });
    } catch (error) {
      // If unique constraint fails, try one more time with fallback
      if (error.code === 'P2002') {
        console.log('⚠️ [FA] Duplicate asset code, trying fallback...');
        const fallbackCode = await this.generateFallbackCode(data.companyId);
        console.log(`🔍 [FA] Fallback code: ${fallbackCode}`);
        
        return await prisma.fixedAsset.create({
          data: buildCreateData(fallbackCode),
          include: includeOpts
        });
      }
      throw error;
    }
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
  static async findByAssetCode(assetCode, companyId) {
    return await prisma.fixedAsset.findFirst({
      where: {
        assetCode,
        companyId: companyId
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

    const updateData = {
      name: data.name,
      category: data.category,
      purchaseDate: data.purchaseDate,
      purchaseCost: data.purchaseCost,
      usefulLife: data.usefulLife,
      salvageValue: data.salvageValue,
      depreciationMethod: data.depreciationMethod,
      location: data.location,
      supplierName: data.supplierName,
      warrantyExpiry: data.warrantyExpiry,
      notes: data.notes,
      status: data.status
    };

    if (data.supplierId === null) {
      updateData.supplier = { disconnect: true };
    } else if (data.supplierId) {
      updateData.supplier = { connect: { id: data.supplierId } };
    }

    return await prisma.fixedAsset.update({
      where: { id },
      data: updateData,
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
  static async getStats(companyId) {
    const filter = { companyId: companyId };

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