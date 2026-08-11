// warehouse/models/Product.js - COMPLETE FIXED

const prisma = require('../../prisma/client');

class ProductModel {
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { name: 'asc' } } = options;

    const cleanFilter = { ...filter };
    delete cleanFilter.userId;
    delete cleanFilter.isDeleted;

    return await prisma.product.findMany({
      where: {
        ...cleanFilter,
        isActive: true
      },
      skip,
      take,
      orderBy,
      include: {
        category: {
          select: { id: true, name: true }
        },
        supplier: {
          select: { id: true, name: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        company: {
          select: { id: true, name: true }
        }
      }
    });
  }

  static async count(filter = {}) {
    const cleanFilter = { ...filter };
    delete cleanFilter.userId;
    delete cleanFilter.isDeleted;

    return await prisma.product.count({
      where: {
        ...cleanFilter,
        isActive: true
      }
    });
  }

  static async findById(id, companyId) {
    return await prisma.product.findFirst({
      where: {
        id,
        companyId,
        isActive: true
      },
      include: {
        category: {
          select: { id: true, name: true }
        },
        supplier: {
          select: { id: true, name: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        company: {
          select: { id: true, name: true }
        },
        variants: {
          select: {
            id: true,
            name: true,
            sku: true,
            sellingPrice: true,
            currentStock: true
          }
        },
        stockMovements: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            quantity: true,
            previousStock: true,
            newStock: true,
            reason: true,
            createdAt: true
          }
        }
      }
    });
  }

  static async findBySku(sku, companyId) {
    return await prisma.product.findFirst({
      where: {
        sku: sku.toUpperCase(),
        companyId,
        isActive: true
      },
      include: {
        category: {
          select: { id: true, name: true }
        },
        supplier: {
          select: { id: true, name: true }
        }
      }
    });
  }

  static async findByBarcode(barcode, companyId) {
    return await prisma.product.findFirst({
      where: {
        barcodeNumber: barcode,
        companyId,
        isActive: true
      },
      include: {
        category: {
          select: { id: true, name: true }
        },
        supplier: {
          select: { id: true, name: true }
        }
      }
    });
  }

  static async checkSkuExists(sku, companyId, excludeId = null) {
    const where = {
      sku: sku.toUpperCase(),
      companyId: companyId,
      isActive: true
    };
    
    if (excludeId) {
      where.NOT = {
        id: excludeId
      };
    }
    
    return await prisma.product.findFirst({ where });
  }

  static async checkBarcodeExists(barcode, companyId, excludeId = null) {
    const where = {
      barcodeNumber: barcode,
      companyId: companyId,
      isActive: true
    };
    
    if (excludeId) {
      where.NOT = {
        id: excludeId
      };
    }
    
    return await prisma.product.findFirst({ where });
  }

  // ✅ FIXED: create method with ALL required fields properly handled
  static async create(data) {
    const {
      name,
      sku,
      barcodeNumber,
      categoryId,
      supplierId,
      costPrice,
      sellingPrice,
      currentStock,
      minimumStock,
      maximumStock,
      description,
      rackLocationName,
      rackLocationId,
      weight,
      weightUnitName,
      length,
      width,
      height,
      dimensionUnit,
      color,
      size,
      material,
      finish,
      expiryDate,
      hasExpiry,
      isBatchManaged,
      isSerialManaged,
      isExpiryManaged,
      taxRate,
      taxType,
      currencyCode,
      productType,
      brandName,
      modelNumber,
      tags,
      colors,
      sizes,
      stockUnitName,
      zoneName,
      zoneId,
      storageConditionName,
      hsCode,
      countryOfOriginName,
      shippingClass,
      freightClass,
      palletNumber,
      shelfNumber,
      temperatureMin,
      temperatureMax,
      dangerousGoods,
      unNumber,
      handlingInstructions,
      warrantyPeriod,
      warrantyUnit,
      isReturnable,
      returnDays,
      isBulkManaged,
      hasIndividualTracking,
      bulkUnit,
      defaultQuantityPerBatch,
      shelfLifeDays,
      videoUrl,
      leadTimeDays,
      reorderPoint,
      supplierSku,
      landingCost,
      mainImage,
      images,
      barcodeImage,
      createdBy,
      companyId
    } = data;

    const totalValue = (currentStock || 0) * (costPrice || 0);
    const availableStock = currentStock || 0;

    // ✅ Ensure all required fields have values
    const createData = {
      name,
      sku: sku.toUpperCase(),
      barcodeNumber: barcodeNumber || null,
      barcodeImage: barcodeImage || null,
      costPrice: costPrice || 0,
      sellingPrice: sellingPrice || 0,
      currentStock: currentStock || 0,
      minimumStock: minimumStock || 5,
      maximumStock: maximumStock || 100,
      description: description || '',
      rackLocationName: rackLocationName || 'A-1-B1',
      rackLocationId: rackLocationId || null,
      weight: weight || 0,
      weightUnitName: weightUnitName || 'KG',
      length: length || 0,
      width: width || 0,
      height: height || 0,
      dimensionUnit: dimensionUnit || 'cm',
      color: color || null,
      size: size || null,
      material: material || null,
      finish: finish || null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      hasExpiry: hasExpiry || false,
      isBatchManaged: isBatchManaged || false,
      isSerialManaged: isSerialManaged || false,
      isExpiryManaged: isExpiryManaged || false,
      taxRate: taxRate || 0,
      taxType: taxType || 'Exclusive',
      currencyCode: currencyCode || 'PKR',
      productType: productType || 'Physical',
      brandName: brandName || null,
      modelNumber: modelNumber || null,
      tags: tags || [],
      colors: colors || [],
      sizes: sizes || [],
      stockUnitName: stockUnitName || 'Pcs',
      zoneName: zoneName || null,
      zoneId: zoneId || null,
      storageConditionName: storageConditionName || 'Normal',
      hsCode: hsCode || null,
      countryOfOriginName: countryOfOriginName || 'Pakistan',
      shippingClass: shippingClass || 'Normal',
      freightClass: freightClass || null,
      palletNumber: palletNumber || null,
      shelfNumber: shelfNumber || null,
      temperatureMin: temperatureMin ? parseFloat(temperatureMin) : null,
      temperatureMax: temperatureMax ? parseFloat(temperatureMax) : null,
      dangerousGoods: dangerousGoods || false,
      unNumber: unNumber || null,
      handlingInstructions: handlingInstructions || null,
      warrantyPeriod: parseInt(warrantyPeriod) >= 0 ? parseInt(warrantyPeriod) : 0,
      warrantyUnit: warrantyUnit || 'Months',
      isReturnable: isReturnable !== undefined ? isReturnable : true,
      returnDays: parseInt(returnDays) >= 0 ? parseInt(returnDays) : 7,
      isBulkManaged: isBulkManaged || false,
      hasIndividualTracking: hasIndividualTracking || false,
      bulkUnit: bulkUnit || 'Bale',
      shelfLifeDays: parseInt(shelfLifeDays) >= 0 ? parseInt(shelfLifeDays) : 0,
      defaultQuantityPerBatch: parseInt(defaultQuantityPerBatch) >= 0 ? parseInt(defaultQuantityPerBatch) : 0,
      videoUrl: videoUrl || null,
      leadTimeDays: parseInt(leadTimeDays) >= 0 ? parseInt(leadTimeDays) : 0,
      reorderPoint: parseInt(reorderPoint) >= 0 ? parseInt(reorderPoint) : 0,
      supplierSku: supplierSku || null,
      landingCost: landingCost ? parseFloat(landingCost) : 0,
      mainImage: mainImage || (Array.isArray(images) && images.length ? images[0] : null),
      images: Array.isArray(images) ? images : [],
      totalValue,
      availableStock,
      // Relations (all relation-owned FKs must use connect syntax)
      company:   companyId   ? { connect: { id: companyId } }   : undefined,
      creator:   createdBy   ? { connect: { id: createdBy } }   : undefined,
      category:  categoryId  ? { connect: { id: categoryId } }  : undefined,
      supplier:  supplierId  ? { connect: { id: supplierId } }  : undefined
    };

    // Remove undefined values
    Object.keys(createData).forEach(key => {
      if (createData[key] === undefined) {
        delete createData[key];
      }
    });

    return await prisma.product.create({
      data: createData,
      include: {
        category: {
          select: { id: true, name: true }
        },
        supplier: {
          select: { id: true, name: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        company: {
          select: { id: true, name: true }
        }
      }
    });
  }

  static async update(id, data) {
    // First get current product
    const existing = await prisma.product.findUnique({
      where: { id }
    });

    if (!existing) {
      throw new Error('Product not found');
    }

    if (data.sku && data.sku !== existing.sku) {
      const duplicate = await prisma.product.findFirst({
        where: {
          sku: data.sku.toUpperCase(),
          companyId: existing.companyId,
          isActive: true,
          id: {
            not: id
          }
        }
      });
      
      if (duplicate) {
        throw new Error('Product with this SKU already exists');
      }
    }

    // ─── BARCODE CHECK ─────────────────────────────────────────
    if (data.barcodeNumber && data.barcodeNumber !== existing.barcodeNumber) {
      const duplicate = await prisma.product.findFirst({
        where: {
          barcodeNumber: data.barcodeNumber,
          companyId: existing.companyId,
          isActive: true,
          id: {
            not: id
          }
        }
      });
      
      if (duplicate) {
        throw new Error('Product with this barcode already exists');
      }
    }

    // ─── Calculate stock values ────────────────────────────────
    const newStock = data.currentStock !== undefined ? data.currentStock : existing.currentStock;
    const newCost = data.costPrice !== undefined ? data.costPrice : existing.costPrice;
    const totalValue = newStock * newCost;
    const availableStock = newStock - (existing.reservedStock || 0);

    // ✅ Ensure all required fields have values when updating
    const updateData = {
      name: data.name !== undefined ? data.name : undefined,
      sku: data.sku ? data.sku.toUpperCase() : undefined,
      barcodeNumber: data.barcodeNumber !== undefined ? data.barcodeNumber : undefined,
      costPrice: data.costPrice !== undefined ? data.costPrice : undefined,
      sellingPrice: data.sellingPrice !== undefined ? data.sellingPrice : undefined,
      currentStock: data.currentStock !== undefined ? data.currentStock : undefined,
      minimumStock: data.minimumStock !== undefined ? data.minimumStock : undefined,
      maximumStock: data.maximumStock !== undefined ? data.maximumStock : undefined,
      description: data.description !== undefined ? data.description : undefined,
      rackLocationName: data.rackLocationName !== undefined ? data.rackLocationName : existing.rackLocationName,
      rackLocationId: data.rackLocationId !== undefined ? data.rackLocationId : undefined,
      weight: data.weight !== undefined ? data.weight : undefined,
      weightUnitName: data.weightUnitName !== undefined ? data.weightUnitName : undefined,
      length: data.length !== undefined ? data.length : undefined,
      width: data.width !== undefined ? data.width : undefined,
      height: data.height !== undefined ? data.height : undefined,
      dimensionUnit: data.dimensionUnit !== undefined ? data.dimensionUnit : undefined,
      color: data.color !== undefined ? data.color : undefined,
      size: data.size !== undefined ? data.size : undefined,
      material: data.material !== undefined ? data.material : undefined,
      finish: data.finish !== undefined ? data.finish : undefined,
      expiryDate: data.expiryDate !== undefined ? (data.expiryDate ? new Date(data.expiryDate) : null) : undefined,
      hasExpiry: data.hasExpiry !== undefined ? data.hasExpiry : undefined,
      isBatchManaged: data.isBatchManaged !== undefined ? data.isBatchManaged : undefined,
      isSerialManaged: data.isSerialManaged !== undefined ? data.isSerialManaged : undefined,
      isExpiryManaged: data.isExpiryManaged !== undefined ? data.isExpiryManaged : undefined,
      taxRate: data.taxRate !== undefined ? data.taxRate : undefined,
      taxType: data.taxType !== undefined ? data.taxType : undefined,
      currencyCode: data.currencyCode !== undefined ? data.currencyCode : undefined,
      productType: data.productType !== undefined ? data.productType : undefined,
      brandName: data.brandName !== undefined ? data.brandName : undefined,
      modelNumber: data.modelNumber !== undefined ? data.modelNumber : undefined,
      tags: data.tags !== undefined ? data.tags : undefined,
      colors: data.colors !== undefined ? data.colors : undefined,
      sizes: data.sizes !== undefined ? data.sizes : undefined,
      stockUnitName: data.stockUnitName !== undefined ? data.stockUnitName : undefined,
      zoneName: data.zoneName !== undefined ? data.zoneName : undefined,
      zoneId: data.zoneId !== undefined ? data.zoneId : undefined,
      storageConditionName: data.storageConditionName !== undefined ? data.storageConditionName : existing.storageConditionName,
      hsCode: data.hsCode !== undefined ? data.hsCode : undefined,
      countryOfOriginName: data.countryOfOriginName !== undefined ? data.countryOfOriginName : existing.countryOfOriginName,
      shippingClass: data.shippingClass !== undefined ? data.shippingClass : existing.shippingClass,
      freightClass: data.freightClass !== undefined ? data.freightClass : undefined,
      palletNumber: data.palletNumber !== undefined ? data.palletNumber : undefined,
      shelfNumber: data.shelfNumber !== undefined ? data.shelfNumber : undefined,
      temperatureMin: data.temperatureMin !== undefined ? (data.temperatureMin ? parseFloat(data.temperatureMin) : null) : undefined,
      temperatureMax: data.temperatureMax !== undefined ? (data.temperatureMax ? parseFloat(data.temperatureMax) : null) : undefined,
      dangerousGoods: data.dangerousGoods !== undefined ? data.dangerousGoods : undefined,
      unNumber: data.unNumber !== undefined ? data.unNumber : undefined,
      handlingInstructions: data.handlingInstructions !== undefined ? data.handlingInstructions : undefined,
      warrantyPeriod: data.warrantyPeriod !== undefined ? (parseInt(data.warrantyPeriod) >= 0 ? parseInt(data.warrantyPeriod) : 0) : existing.warrantyPeriod,
      warrantyUnit: data.warrantyUnit !== undefined ? data.warrantyUnit : existing.warrantyUnit,
      isReturnable: data.isReturnable !== undefined ? data.isReturnable : existing.isReturnable,
      returnDays: data.returnDays !== undefined ? (parseInt(data.returnDays) >= 0 ? parseInt(data.returnDays) : 7) : existing.returnDays,
      isBulkManaged: data.isBulkManaged !== undefined ? data.isBulkManaged : undefined,
      hasIndividualTracking: data.hasIndividualTracking !== undefined ? data.hasIndividualTracking : undefined,
      bulkUnit: data.bulkUnit !== undefined ? data.bulkUnit : existing.bulkUnit,
      shelfLifeDays: data.shelfLifeDays !== undefined ? (parseInt(data.shelfLifeDays) >= 0 ? parseInt(data.shelfLifeDays) : 0) : undefined,
      defaultQuantityPerBatch: data.defaultQuantityPerBatch !== undefined ? (parseInt(data.defaultQuantityPerBatch) >= 0 ? parseInt(data.defaultQuantityPerBatch) : 0) : undefined,
      videoUrl: data.videoUrl !== undefined ? data.videoUrl : undefined,
      leadTimeDays: data.leadTimeDays !== undefined ? (parseInt(data.leadTimeDays) >= 0 ? parseInt(data.leadTimeDays) : 0) : undefined,
      reorderPoint: data.reorderPoint !== undefined ? (parseInt(data.reorderPoint) >= 0 ? parseInt(data.reorderPoint) : 0) : undefined,
      supplierSku: data.supplierSku !== undefined ? data.supplierSku : undefined,
      landingCost: data.landingCost !== undefined ? parseFloat(data.landingCost) : undefined,
      mainImage: data.mainImage !== undefined ? data.mainImage : undefined,
      images: data.images !== undefined ? data.images : undefined,
      barcodeImage: data.barcodeImage !== undefined ? data.barcodeImage : undefined,
      totalValue,
      availableStock,
      updatedAt: new Date(),
      // Relations - using category and supplier (NOT categoryId or supplierId)
      updater: data.updatedBy ? { connect: { id: data.updatedBy } } : undefined,
      category: data.categoryId ? { connect: { id: data.categoryId } } : undefined,
      supplier: data.supplierId ? { connect: { id: data.supplierId } } : undefined
    };

    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    return await prisma.product.update({
      where: { id },
      data: updateData,
      include: {
        category: {
          select: { id: true, name: true }
        },
        supplier: {
          select: { id: true, name: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        company: {
          select: { id: true, name: true }
        }
      }
    });
  }

  static async delete(id, userId) {
    console.log('🔵 [ProductModel.delete] Starting delete for product ID:', id);
    console.log('🔵 [ProductModel.delete] User ID:', userId);

    const existing = await prisma.product.findUnique({
      where: { id }
    });

    if (!existing) {
      console.log('❌ [ProductModel.delete] Product not found with ID:', id);
      throw new Error('Product not found');
    }

    console.log('✅ [ProductModel.delete] Existing product found:', existing.id, existing.name);

    const deletedProduct = await prisma.product.update({
      where: { id },
      data: {
        isActive: false,
        updatedAt: new Date(),
        updater: userId ? { connect: { id: userId } } : undefined
      }
    });

    console.log('✅ [ProductModel.delete] Product soft deleted successfully:', deletedProduct.id, deletedProduct.name);
    return deletedProduct;
  }

  static async getLowStockProducts(companyId) {
    return await prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        currentStock: {
          lte: prisma.product.fields.minimumStock
        }
      },
      select: {
        id: true,
        name: true,
        sku: true,
        currentStock: true,
        minimumStock: true,
        maximumStock: true,
        categoryName: true,
        supplierName: true,
        sellingPrice: true,
        totalValue: true
      },
      orderBy: {
        currentStock: 'asc'
      }
    });
  }

  static async getStats(companyId) {
    const [total, lowStock, outOfStock, aggregate] = await Promise.all([
      prisma.product.count({
        where: { companyId, isActive: true }
      }),
      prisma.product.count({
        where: {
          companyId,
          isActive: true,
          currentStock: { lte: prisma.product.fields.minimumStock }
        }
      }),
      prisma.product.count({
        where: {
          companyId,
          isActive: true,
          currentStock: 0
        }
      }),
      prisma.product.aggregate({
        where: { companyId, isActive: true },
        _sum: {
          currentStock: true,
          totalValue: true
        }
      })
    ]);

    return {
      total,
      lowStock,
      outOfStock,
      totalStock: aggregate._sum.currentStock || 0,
      totalInventoryValue: aggregate._sum.totalValue || 0
    };
  }

  static async updateStock(id, quantity, type, reason, userId) {
    const product = await prisma.product.findUnique({
      where: { id }
    });

    if (!product) {
      throw new Error('Product not found');
    }

    const qty = parseInt(quantity);
    let newStock = product.currentStock;

    if (type === 'add') {
      newStock = product.currentStock + qty;
    } else if (type === 'subtract') {
      newStock = product.currentStock - qty;
      if (newStock < 0) {
        throw new Error('Insufficient stock');
      }
    } else if (type === 'set') {
      newStock = qty;
    } else {
      throw new Error('Invalid stock update type');
    }

    const updatedProduct = await prisma.product.update({
      where: { id },
      data: {
        currentStock: newStock,
        availableStock: newStock - (product.reservedStock || 0),
        totalValue: newStock * product.costPrice,
        updatedAt: new Date(),
        updater: userId ? { connect: { id: userId } } : undefined
      }
    });

    await prisma.stockMovement.create({
      data: {
        productId: product.id,
        productName: product.name,
        type: type,
        quantity: qty,
        previousStock: product.currentStock,
        newStock: newStock,
        reason: reason || 'Manual update',
        supplierId: product.supplierId,
        supplierName: product.supplierName,
        companyId: product.companyId,
        createdBy: userId
      }
    });

    return updatedProduct;
  }

  static async search(query, companyId, options = {}) {
    const { skip = 0, take = 20 } = options;

    const where = {
      companyId,
      isActive: true,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { sku: { contains: query, mode: 'insensitive' } },
        { barcodeNumber: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { categoryName: { contains: query, mode: 'insensitive' } },
        { supplierName: { contains: query, mode: 'insensitive' } }
      ]
    };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take,
        include: {
          category: { select: { name: true } },
          supplier: { select: { name: true } }
        }
      }),
      prisma.product.count({ where })
    ]);

    return { products, total };
  }

  static async getByCategory(categoryId, companyId) {
    return await prisma.product.findMany({
      where: {
        category: {
          id: categoryId
        },
        companyId,
        isActive: true
      },
      select: {
        id: true,
        name: true,
        sku: true,
        sellingPrice: true,
        currentStock: true,
        minimumStock: true,
        barcodeNumber: true
      },
      orderBy: {
        name: 'asc'
      }
    });
  }

  static async generateSku(companyId, productName, categoryId) {
    const prefix = productName.substring(0, 3).toUpperCase();
    let categoryPrefix = '';
    
    if (categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: categoryId }
      });
      if (category) {
        categoryPrefix = category.name.substring(0, 2).toUpperCase();
      }
    }

    const baseSku = categoryPrefix ? `${categoryPrefix}-${prefix}` : prefix;
    
    const lastProduct = await prisma.product.findFirst({
      where: {
        companyId,
        sku: {
          startsWith: baseSku
        }
      },
      orderBy: {
        sku: 'desc'
      },
      select: {
        sku: true
      }
    });

    let sequence = 1;
    if (lastProduct && lastProduct.sku) {
      const parts = lastProduct.sku.split('-');
      const lastSeq = parseInt(parts[parts.length - 1]);
      if (!isNaN(lastSeq)) {
        sequence = lastSeq + 1;
      }
    }

    return `${baseSku}-${String(sequence).padStart(3, '0')}`;
  }
}

module.exports = ProductModel;