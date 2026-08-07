// warehouse/controller/product_controller.js - COMPLETE FIXED

const ProductModel = require('../models/Product');
const prisma = require('../../prisma/client');

const getProducts = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const {
      search,
      q,
      categoryId,
      supplierId,
      stockStatus,
      minPrice,
      maxPrice,
      sortBy = 'name',
      sortOrder = 'asc',
      page = 1,
      limit = 20
    } = req.query;

    const searchQuery = search || q;

    const filter = {
      companyId: companyId,
      isActive: true,
      isDeleted: false
    };

    if (searchQuery) {
      filter.OR = [
        { name: { contains: searchQuery, mode: 'insensitive' } },
        { sku: { contains: searchQuery, mode: 'insensitive' } },
        { barcodeNumber: { contains: searchQuery, mode: 'insensitive' } },
        { description: { contains: searchQuery, mode: 'insensitive' } }
      ];
    }

    if (categoryId) {
      filter.categoryId = categoryId;
    }

    if (supplierId) {
      filter.supplierId = supplierId;
    }

    if (stockStatus) {
      if (stockStatus === 'low') {
        filter.currentStock = { lte: prisma.product.fields.minimumStock };
      } else if (stockStatus === 'out') {
        filter.currentStock = 0;
      } else if (stockStatus === 'in') {
        filter.currentStock = { gt: 0 };
      }
    }

    if (minPrice || maxPrice) {
      filter.sellingPrice = {};
      if (minPrice) filter.sellingPrice.gte = parseFloat(minPrice);
      if (maxPrice) filter.sellingPrice.lte = parseFloat(maxPrice);
    }

    const orderBy = {};
    orderBy[sortBy] = sortOrder === 'asc' ? 'asc' : 'desc';

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      ProductModel.findAll(filter, { skip, take: limitNum, orderBy }),
      ProductModel.count(filter)
    ]);

    console.log('🔵 [getProducts] Returning', products.length, 'products');
    if (products.length > 0) {
      console.log('🔵 [getProducts] First product ID:', products[0].id);
    }

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Get single product by ID
// @route   GET /api/warehouse/products/:id
// @access  Private
// ============================================================
const getProductById = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const product = await ProductModel.findById(id, companyId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Get product by SKU
// @route   GET /api/warehouse/products/sku/:sku
// @access  Private
// ============================================================
const getProductBySku = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { sku } = req.params;

    const product = await ProductModel.findBySku(sku, companyId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Get product by SKU error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Get product by barcode
// @route   GET /api/warehouse/products/barcode/:barcode
// @access  Private
// ============================================================
const getProductByBarcode = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { barcode } = req.params;

    const product = await ProductModel.findByBarcode(barcode, companyId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found with this barcode'
      });
    }

    res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Get product by barcode error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Check if SKU exists
// @route   GET /api/warehouse/products/check-sku/:sku
// @access  Private
// ============================================================
const checkSkuExists = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { sku } = req.params;
    const { excludeId } = req.query;

    const product = await ProductModel.checkSkuExists(sku, companyId, excludeId);

    res.status(200).json({
      success: true,
      exists: !!product
    });
  } catch (error) {
    console.error('Check SKU error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Check if barcode exists
// @route   GET /api/warehouse/products/check-barcode/:barcode
// @access  Private
// ============================================================
const checkBarcodeExists = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { barcode } = req.params;
    const { excludeId } = req.query;

    const product = await ProductModel.checkBarcodeExists(barcode, companyId, excludeId);

    res.status(200).json({
      success: true,
      exists: !!product
    });
  } catch (error) {
    console.error('Check barcode error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Create product - ✅ FIXED
// @route   POST /api/warehouse/products
// @access  Private
// ============================================================
const createProduct = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    
    let data = req.body;

    // Handle FormData
    if (req.body && typeof req.body === 'object') {
      data = { ...req.body };
    }

    // ─── Validation ──────────────────────────────────────────
    if (!data.name || !data.sku) {
      return res.status(400).json({
        success: false,
        message: 'Name and SKU are required'
      });
    }

    // ─── Check duplicate SKU ──────────────────────────────
    const existingSku = await ProductModel.checkSkuExists(data.sku, companyId);
    if (existingSku) {
      return res.status(400).json({
        success: false,
        message: 'Product with this SKU already exists'
      });
    }

    // ─── Check duplicate barcode ──────────────────────────
    if (data.barcodeNumber) {
      const existingBarcode = await ProductModel.checkBarcodeExists(data.barcodeNumber, companyId);
      if (existingBarcode) {
        return res.status(400).json({
          success: false,
          message: 'Product with this barcode already exists'
        });
      }
    }

    // ─── Normalize field names (Flutter short names → Prisma names) ────
    const fieldAliases = {
      currency: 'currencyCode',
      leadTime: 'leadTimeDays',
      shelfLife: 'shelfLifeDays',
      defaultBatchQuantity: 'defaultQuantityPerBatch',
      tempMin: 'temperatureMin',
      tempMax: 'temperatureMax',
      zone: 'zoneName',
      storageCondition: 'storageConditionName',
      countryOfOrigin: 'countryOfOriginName',
      stockUnit: 'stockUnitName',
    };
    Object.entries(fieldAliases).forEach(([alias, canonical]) => {
      if (data[alias] !== undefined) {
        data[canonical] = data[canonical] !== undefined ? data[canonical] : data[alias];
        delete data[alias];
      }
    });

    // ─── Convert numeric fields ────────────────────────────
    const numericFields = [
      'costPrice', 'sellingPrice', 'currentStock', 'minimumStock', 'maximumStock',
      'weight', 'length', 'width', 'height', 'taxRate',
      'warrantyPeriod', 'returnDays', 'shelfLifeDays',
      'defaultQuantityPerBatch', 'leadTimeDays', 'reorderPoint', 'stackingLimit',
      'temperatureMin', 'temperatureMax', 'landingCost',
    ];
    
    numericFields.forEach(field => {
      if (data[field] !== undefined && data[field] !== null && data[field] !== '') {
        const intFields = ['currentStock', 'minimumStock', 'maximumStock',
          'warrantyPeriod', 'returnDays', 'shelfLifeDays',
          'defaultQuantityPerBatch', 'leadTimeDays', 'reorderPoint', 'stackingLimit'];
        data[field] = intFields.includes(field) ? parseInt(data[field]) : parseFloat(data[field]);
      }
    });

    // ─── Convert boolean fields ────────────────────────────
    const booleanFields = ['hasExpiry', 'isBatchManaged', 'isSerialManaged', 'isExpiryManaged',
      'isBulkManaged', 'hasIndividualTracking', 'isReturnable', 'dangerousGoods'];
    
    booleanFields.forEach(field => {
      if (data[field] !== undefined) {
        data[field] = data[field] === 'true' || data[field] === true;
      }
    });

    // ─── Handle arrays ─────────────────────────────────────
    const arrayFields = ['tags', 'colors', 'sizes'];
    arrayFields.forEach(field => {
      if (data[field] !== undefined && typeof data[field] === 'string') {
        if (data[field] === '') {
          data[field] = [];
        } else {
          try {
            data[field] = JSON.parse(data[field]);
          } catch {
            data[field] = data[field].split(',').map(t => t.trim());
          }
        }
      }
    });

    if (data.expiryDate) {
      data.expiryDate = new Date(data.expiryDate);
    }
    if (data.manufacturingDate) {
      data.manufacturingDate = new Date(data.manufacturingDate);
    }

    // ✅ FIXED: Ensure rackLocationName has a value
    const productData = {
      ...data,
      // Set default values for required fields if not provided
      rackLocationName: data.rackLocationName || 'A-1-B1',
      rackLocationId: data.rackLocationId || null,
      storageConditionName: data.storageConditionName || 'Normal',
      shippingClass: data.shippingClass || 'Normal',
      countryOfOriginName: data.countryOfOriginName || 'Pakistan',
      warrantyUnit: data.warrantyUnit || 'Months',
      bulkUnit: data.bulkUnit || 'Bale',
      stockUnitName: data.stockUnitName || 'Pcs',
      dimensionUnit: data.dimensionUnit || 'cm',
      weightUnitName: data.weightUnitName || 'KG',
      taxType: data.taxType || 'Exclusive',
      currencyCode: data.currencyCode || 'PKR',
      productType: data.productType || 'Physical',
      isReturnable: data.isReturnable !== undefined ? data.isReturnable : true,
      returnDays: data.returnDays || 7,
      // Calculate total value
      totalValue: (data.costPrice || 0) * (data.currentStock || 0),
      availableStock: data.availableStock || data.currentStock || 0,
      createdBy: userId,
      companyId: companyId
    };

    console.log('🔵 [createProduct] Final product data:', JSON.stringify(productData, null, 2));

    const product = await ProductModel.create(productData);

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product
    });
  } catch (error) {
    console.error('❌ [createProduct] Error:', error);
    console.error('❌ [createProduct] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Update product
// @route   PUT /api/warehouse/products/:id
// @access  Private
// ============================================================
const updateProduct = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;

    console.log('🔵 [updateProduct] Starting update for product ID:', id);
    console.log('🔵 [updateProduct] User ID:', userId);
    console.log('🔵 [updateProduct] Company ID:', companyId);

    // ─── Check if product exists ──────────────────────────
    const existing = await ProductModel.findById(id, companyId);
    if (!existing) {
      console.log('❌ [updateProduct] Product not found with ID:', id);
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    let data = req.body;
    console.log('🔵 [updateProduct] Request body:', JSON.stringify(data, null, 2));

    // Handle FormData
    if (req.body && typeof req.body === 'object') {
      data = { ...req.body };
    }

    // ─── Check duplicate SKU ──────────────────────────────
    if (data.sku && data.sku.toUpperCase() !== existing.sku) {
      console.log('🔵 [updateProduct] SKU changed from', existing.sku, 'to', data.sku);
      const duplicateSku = await ProductModel.checkSkuExists(data.sku, companyId, id);
      if (duplicateSku) {
        console.log('❌ [updateProduct] Duplicate SKU found:', duplicateSku.sku);
        return res.status(400).json({
          success: false,
          message: 'Product with this SKU already exists'
        });
      }
      console.log('✅ [updateProduct] SKU is unique');
    }

    // ─── Check duplicate barcode ──────────────────────────
    if (data.barcodeNumber && data.barcodeNumber.toUpperCase() !== existing.barcodeNumber) {
      console.log('🔵 [updateProduct] Barcode changed from', existing.barcodeNumber, 'to', data.barcodeNumber);
      const duplicateBarcode = await ProductModel.checkBarcodeExists(data.barcodeNumber, companyId, id);
      if (duplicateBarcode) {
        console.log('❌ [updateProduct] Duplicate barcode found:', duplicateBarcode.barcodeNumber);
        return res.status(400).json({
          success: false,
          message: 'Product with this barcode already exists'
        });
      }
      console.log('✅ [updateProduct] Barcode is unique');
    }

    // ─── Normalize field names (Flutter short names → Prisma names) ────
    const fieldAliasesUpdate = {
      currency: 'currencyCode',
      leadTime: 'leadTimeDays',
      shelfLife: 'shelfLifeDays',
      defaultBatchQuantity: 'defaultQuantityPerBatch',
      tempMin: 'temperatureMin',
      tempMax: 'temperatureMax',
      zone: 'zoneName',
      storageCondition: 'storageConditionName',
      countryOfOrigin: 'countryOfOriginName',
      stockUnit: 'stockUnitName',
    };
    Object.entries(fieldAliasesUpdate).forEach(([alias, canonical]) => {
      if (data[alias] !== undefined) {
        data[canonical] = data[canonical] !== undefined ? data[canonical] : data[alias];
        delete data[alias];
      }
    });

    // ─── Convert numeric fields ────────────────────────────
    const numericFields = [
      'costPrice', 'sellingPrice', 'currentStock', 'minimumStock', 'maximumStock',
      'weight', 'length', 'width', 'height', 'taxRate',
      'warrantyPeriod', 'returnDays', 'shelfLifeDays',
      'defaultQuantityPerBatch', 'leadTimeDays', 'reorderPoint', 'stackingLimit',
      'temperatureMin', 'temperatureMax', 'landingCost',
    ];
    
    numericFields.forEach(field => {
      if (data[field] !== undefined && data[field] !== null && data[field] !== '') {
        const intFields = ['currentStock', 'minimumStock', 'maximumStock',
          'warrantyPeriod', 'returnDays', 'shelfLifeDays',
          'defaultQuantityPerBatch', 'leadTimeDays', 'reorderPoint', 'stackingLimit'];
        data[field] = intFields.includes(field) ? parseInt(data[field]) : parseFloat(data[field]);
      }
    });

    // ─── Convert boolean fields ────────────────────────────
    const booleanFields = ['hasExpiry', 'isBatchManaged', 'isSerialManaged', 'isExpiryManaged',
      'isBulkManaged', 'hasIndividualTracking', 'isReturnable', 'dangerousGoods'];
    
    booleanFields.forEach(field => {
      if (data[field] !== undefined) {
        data[field] = data[field] === 'true' || data[field] === true;
      }
    });

    // ─── Handle arrays ─────────────────────────────────────
    const arrayFields = ['tags', 'colors', 'sizes'];
    arrayFields.forEach(field => {
      if (data[field] !== undefined && typeof data[field] === 'string') {
        if (data[field] === '') {
          data[field] = [];
        } else {
          try {
            data[field] = JSON.parse(data[field]);
          } catch {
            data[field] = data[field].split(',').map(t => t.trim());
          }
        }
      }
    });

    // ─── Handle dates ──────────────────────────────────────
    if (data.expiryDate) {
      data.expiryDate = new Date(data.expiryDate);
    }
    if (data.manufacturingDate) {
      data.manufacturingDate = new Date(data.manufacturingDate);
    }

    // ✅ FIXED: Ensure rackLocationName has a value
    const productData = {
      ...data,
      // Set default values for required fields if not provided
      rackLocationName: data.rackLocationName || existing.rackLocationName || 'A-1-B1',
      storageConditionName: data.storageConditionName || existing.storageConditionName || 'Normal',
      shippingClass: data.shippingClass || existing.shippingClass || 'Normal',
      countryOfOriginName: data.countryOfOriginName || existing.countryOfOriginName || 'Pakistan',
      warrantyUnit: data.warrantyUnit || existing.warrantyUnit || 'Months',
      bulkUnit: data.bulkUnit || existing.bulkUnit || 'Bale',
      stockUnitName: data.stockUnitName || existing.stockUnitName || 'Pcs',
      dimensionUnit: data.dimensionUnit || existing.dimensionUnit || 'cm',
      weightUnitName: data.weightUnitName || existing.weightUnitName || 'KG',
      taxType: data.taxType || existing.taxType || 'Exclusive',
      currencyCode: data.currencyCode || existing.currencyCode || 'PKR',
      productType: data.productType || existing.productType || 'Physical',
      isReturnable: data.isReturnable !== undefined ? data.isReturnable : (existing.isReturnable || true),
      returnDays: data.returnDays || existing.returnDays || 7,
      totalValue: (data.costPrice || existing.costPrice || 0) * (data.currentStock || existing.currentStock || 0),
      availableStock: data.availableStock || data.currentStock || existing.currentStock || 0,
      updatedBy: userId
    };

    console.log('🔵 [updateProduct] Final product data:', JSON.stringify(productData, null, 2));

    // ─── Update product ─────────────────────────────────────
    const product = await ProductModel.update(id, productData);

    console.log('✅ [updateProduct] Product updated successfully:', product.id);

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: product
    });
  } catch (error) {
    console.error('❌ [updateProduct] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Delete product (Soft delete)
// @route   DELETE /api/warehouse/products/:id
// @access  Private
// ============================================================
const deleteProduct = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;

    console.log('🔵 [deleteProduct] Starting delete for product ID:', id);
    console.log('🔵 [deleteProduct] User ID:', userId);
    console.log('🔵 [deleteProduct] Company ID:', companyId);

    // ─── Check if product exists ──────────────────────────
    const existing = await ProductModel.findById(id, companyId);
    if (!existing) {
      console.log('❌ [deleteProduct] Product not found with ID:', id);
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    console.log('✅ [deleteProduct] Product found:', existing.id, existing.name);

    // ─── Soft delete ──────────────────────────────────────
    await ProductModel.delete(id, userId);

    console.log('✅ [deleteProduct] Product deleted successfully');

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('❌ [deleteProduct] Error:', error);
    console.error('❌ [deleteProduct] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Search products
// @route   GET /api/warehouse/products/search
// @access  Private
// ============================================================
const searchProducts = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { q, page = 1, limit = 20 } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const { products, total } = await ProductModel.search(q, companyId, { skip, take: limitNum });

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Search products error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Get low stock products
// @route   GET /api/warehouse/products/low-stock
// @access  Private
// ============================================================
const getLowStockProducts = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const products = await ProductModel.getLowStockProducts(companyId);

    res.status(200).json({
      success: true,
      count: products.length,
      data: products
    });
  } catch (error) {
    console.error('Get low stock error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Get product stats
// @route   GET /api/warehouse/products/stats
// @access  Private
// ============================================================
const getProductStats = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const stats = await ProductModel.getStats(companyId);

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get product stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Update stock
// @route   PUT /api/warehouse/products/:id/stock
// @access  Private
// ============================================================
const updateStock = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;
    const { quantity, type = 'add', reason = 'Manual update' } = req.body;

    if (quantity === undefined || quantity === null) {
      return res.status(400).json({
        success: false,
        message: 'Quantity is required'
      });
    }

    // ─── Check if product exists ──────────────────────────
    const existing = await ProductModel.findById(id, companyId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // ─── Update stock ──────────────────────────────────────
    const updatedProduct = await ProductModel.updateStock(id, quantity, type, reason, userId);

    res.status(200).json({
      success: true,
      message: 'Stock updated successfully',
      data: updatedProduct
    });
  } catch (error) {
    console.error('Update stock error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Get products by category
// @route   GET /api/warehouse/products/category/:categoryId
// @access  Private
// ============================================================
const getProductsByCategory = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { categoryId } = req.params;

    const products = await ProductModel.getByCategory(categoryId, companyId);

    res.status(200).json({
      success: true,
      count: products.length,
      data: products
    });
  } catch (error) {
    console.error('Get products by category error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Generate SKU
// @route   POST /api/warehouse/products/generate-sku
// @access  Private
// ============================================================
const generateSku = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { productName, categoryId } = req.body;

    if (!productName) {
      return res.status(400).json({
        success: false,
        message: 'Product name is required'
      });
    }

    const sku = await ProductModel.generateSku(companyId, productName, categoryId);

    res.status(200).json({
      success: true,
      data: { sku }
    });
  } catch (error) {
    console.error('Generate SKU error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================
// @desc    Bulk create products
// @route   POST /api/warehouse/products/bulk
// @access  Private
// ============================================================
const bulkCreateProducts = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { products } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Products array is required'
      });
    }

    const created = [];
    for (const productData of products) {
      const data = {
        ...productData,
        rackLocationName: productData.rackLocationName || 'A-1-B1',
        storageConditionName: productData.storageConditionName || 'Normal',
        shippingClass: productData.shippingClass || 'Normal',
        countryOfOriginName: productData.countryOfOriginName || 'Pakistan',
        warrantyUnit: productData.warrantyUnit || 'Months',
        bulkUnit: productData.bulkUnit || 'Bale',
        stockUnitName: productData.stockUnitName || 'Pcs',
        dimensionUnit: productData.dimensionUnit || 'cm',
        weightUnitName: productData.weightUnitName || 'KG',
        taxType: productData.taxType || 'Exclusive',
        currencyCode: productData.currencyCode || 'PKR',
        productType: productData.productType || 'Physical',
        isReturnable: productData.isReturnable !== undefined ? productData.isReturnable : true,
        returnDays: productData.returnDays || 7,
        totalValue: (productData.costPrice || 0) * (productData.currentStock || 0),
        availableStock: productData.availableStock || productData.currentStock || 0,
        createdBy: userId,
        companyId: companyId
      };
      const product = await ProductModel.create(data);
      created.push(product);
    }

    res.status(201).json({
      success: true,
      message: `${created.length} products created successfully`,
      data: {
        count: created.length,
        products: created
      }
    });
  } catch (error) {
    console.error('Bulk create products error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─── EXPORT CONTROLLERS ──────────────────────────────────────

module.exports = {
  getProducts,
  getProductById,
  getProductBySku,
  getProductByBarcode,
  checkSkuExists,
  checkBarcodeExists,
  createProduct,
  updateProduct,
  deleteProduct,
  searchProducts,
  getLowStockProducts,
  getProductStats,
  updateStock,
  getProductsByCategory,
  generateSku,
  bulkCreateProducts
};