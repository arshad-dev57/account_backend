// warehouse/controller/product_controller.js - COMPLETE FIXED

const ProductModel = require('../models/Product');
const prisma = require('../../prisma/client');
const {
  resolveLocationId,
  getOrCreateProductStock,
} = require('../services/locationService');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FIELD_ALIASES = {
  currency: 'currencyCode',
  leadTime: 'leadTimeDays',
  shelfLife: 'shelfLifeDays',
  defaultBatchQuantity: 'defaultQuantityPerBatch',
  tempMin: 'temperatureMin',
  tempMax: 'temperatureMax',
  zone: 'zoneName',
  storageCondition: 'storageConditionName',
  countryOfOrigin: 'countryOfOriginName',
  stockUnit: 'stockUnitName'
};

const INT_FIELDS = [
  'currentStock', 'minimumStock', 'maximumStock',
  'warrantyPeriod', 'returnDays', 'shelfLifeDays',
  'defaultQuantityPerBatch', 'leadTimeDays', 'reorderPoint', 'stackingLimit'
];

const FLOAT_FIELDS = [
  'costPrice', 'sellingPrice', 'weight', 'length', 'width', 'height',
  'taxRate', 'temperatureMin', 'temperatureMax', 'landingCost'
];

const BOOLEAN_FIELDS = [
  'hasExpiry', 'isBatchManaged', 'isSerialManaged', 'isExpiryManaged',
  'isBulkManaged', 'hasIndividualTracking', 'isReturnable', 'dangerousGoods'
];

const ARRAY_FIELDS = ['tags', 'colors', 'sizes'];
const UUID_FIELDS = [
  'categoryId', 'supplierId', 'subCategoryId', 'rackLocationId', 'zoneId', 'brandId'
];

const isBlank = (v) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function normalizeIncomingProduct(raw) {
  const data = { ...(raw || {}) };

  Object.entries(FIELD_ALIASES).forEach(([alias, canonical]) => {
    if (data[alias] !== undefined) {
      if (data[canonical] === undefined) data[canonical] = data[alias];
      delete data[alias];
    }
  });

  INT_FIELDS.forEach((field) => {
    if (!(field in data)) return;
    if (isBlank(data[field])) {
      delete data[field];
      return;
    }
    const n = parseInt(data[field], 10);
    if (Number.isFinite(n)) data[field] = n;
    else delete data[field];
  });

  FLOAT_FIELDS.forEach((field) => {
    if (!(field in data)) return;
    if (isBlank(data[field])) {
      delete data[field];
      return;
    }
    const n = parseFloat(data[field]);
    if (Number.isFinite(n)) data[field] = n;
    else delete data[field];
  });

  BOOLEAN_FIELDS.forEach((field) => {
    if (data[field] === undefined) return;
    data[field] = data[field] === true || data[field] === 'true' || data[field] === '1';
  });

  ARRAY_FIELDS.forEach((field) => {
    if (data[field] === undefined) return;
    if (Array.isArray(data[field])) return;
    if (typeof data[field] === 'string') {
      if (data[field].trim() === '') {
        data[field] = [];
        return;
      }
      try {
        const parsed = JSON.parse(data[field]);
        data[field] = Array.isArray(parsed) ? parsed : [String(parsed)];
      } catch {
        data[field] = data[field]
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      }
    }
  });

  UUID_FIELDS.forEach((field) => {
    if (data[field] === undefined) return;
    if (isBlank(data[field]) || !UUID_RE.test(String(data[field]))) {
      delete data[field];
    }
  });

  if (data.barcodeNumber !== undefined && isBlank(data.barcodeNumber)) {
    data.barcodeNumber = null;
  }

  ['expiryDate', 'manufacturingDate'].forEach((field) => {
    if (!data[field]) return;
    const d = new Date(data[field]);
    data[field] = Number.isNaN(d.getTime()) ? null : d;
  });

  [
    'currencyName',
    'currencySymbol',
    'countryOfOriginFlag',
    'id',
    '_id',
    'createdAt',
    'updatedAt',
    'category',
    'supplier',
    'creator',
    'updater',
    'company',
    'variants',
    'stockMovements'
  ].forEach((key) => delete data[key]);

  return data;
}

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
      limit = 20,
      locationId,
      scope,
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

    // Company-level stock filter only when no location selected
    if (stockStatus && !locationId) {
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

    let locationStockMap = null;
    const companyScope = String(scope || '') === 'company';
    if (locationId) {
      const loc = await prisma.location.findFirst({
        where: { id: locationId, companyId, isDeleted: false },
      });
      if (!loc) {
        return res.status(400).json({
          success: false,
          message: 'Location not found',
        });
      }

      const stocks = await prisma.productStock.findMany({
        where: { companyId, locationId },
        select: {
          productId: true,
          currentStock: true,
          reservedStock: true,
          availableStock: true,
        },
      });
      locationStockMap = new Map(
        stocks.map((s) => [s.productId, s])
      );

      // Default: only products assigned to this location.
      // scope=company: full catalog (for stock-in search) with location qty overlay.
      if (!companyScope) {
        const locationProductIds = stocks.map((s) => s.productId);
        filter.id = {
          in: locationProductIds.length ? locationProductIds : ['__none__'],
        };
      }

      if (stockStatus && !companyScope) {
        const locationProductIds = stocks.map((s) => s.productId);
        const candidates = await prisma.product.findMany({
          where: {
            companyId,
            isActive: true,
            id: { in: locationProductIds.length ? locationProductIds : ['__none__'] },
            ...(categoryId ? { categoryId } : {}),
            ...(supplierId ? { supplierId } : {}),
            ...(searchQuery
              ? {
                  OR: [
                    { name: { contains: searchQuery, mode: 'insensitive' } },
                    { sku: { contains: searchQuery, mode: 'insensitive' } },
                    {
                      barcodeNumber: {
                        contains: searchQuery,
                        mode: 'insensitive',
                      },
                    },
                  ],
                }
              : {}),
          },
          select: { id: true, minimumStock: true },
        });

        const matchingIds = candidates
          .filter((p) => {
            const qty = locationStockMap.get(p.id)?.currentStock ?? 0;
            if (stockStatus === 'out') return qty === 0;
            if (stockStatus === 'in') return qty > 0;
            if (stockStatus === 'low') {
              return (
                (p.minimumStock || 0) > 0 &&
                qty > 0 &&
                qty <= (p.minimumStock || 0)
              );
            }
            return true;
          })
          .map((p) => p.id);

        filter.id = { in: matchingIds.length ? matchingIds : ['__none__'] };
      }
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

    const data = products.map((p) => {
      // Prisma rows → plain object so location stock reliably overrides company total
      const plain = JSON.parse(JSON.stringify(p));
      if (!locationStockMap) {
        return {
          ...plain,
          locationStock: plain.currentStock ?? 0,
        };
      }
      const s = locationStockMap.get(plain.id);
      const locQty = s?.currentStock ?? 0;
      const locReserved = s?.reservedStock ?? 0;
      const locAvailable = s?.availableStock ?? Math.max(0, locQty - locReserved);
      return {
        ...plain,
        companyStock: plain.currentStock ?? 0,
        currentStock: locQty,
        locationStock: locQty,
        reservedStock: locReserved,
        availableStock: locAvailable,
        locationId,
      };
    });

    console.log(
      '🔵 [getProducts] Returning',
      data.length,
      'products',
      locationId ? `(location ${locationId})` : '',
      locationStockMap
        ? `stocks=${locationStockMap.size} sample=${data
            .slice(0, 3)
            .map((x) => `${x.name}:${x.currentStock}`)
            .join(',')}`
        : ''
    );

    res.status(200).json({
      success: true,
      count: data.length,
      data,
      locationId: locationId || null,
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
    if (!data.name) {
      return res.status(400).json({
        success: false,
        message: 'Product name is required'
      });
    }

    data.sku = await ProductModel.generateSku(companyId, data.name, data.categoryId);

    if (data.barcodeNumber) {
      const existingBarcode = await ProductModel.checkBarcodeExists(data.barcodeNumber, companyId);
      if (existingBarcode) {
        data.barcodeNumber = `${data.sku}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
      }
    }

    // Opening stock must go through Stock Movement (posts accounting entry)
    const requestedStock = Number(data.currentStock) || 0;
    if (requestedStock > 0) {
      return res.status(400).json({
        success: false,
        message:
          'Do not set opening stock on product create. Add inventory via Warehouse → Stock Movement → Opening Stock.',
      });
    }

    // ─── Handle Cloudinary uploads (same pattern as register logo/signature) ──
    const uploadedImageUrls = [];
    if (req.files?.images?.length) {
      for (const file of req.files.images) {
        if (file.path) uploadedImageUrls.push(file.path);
      }
    }
    let uploadedBarcodeImage = null;
    if (req.files?.barcodeImage?.[0]?.path) {
      uploadedBarcodeImage = req.files.barcodeImage[0].path;
    }

    // Client may send existingImages JSON (URLs to keep on update flows / create with none)
    let existingImages = [];
    if (data.existingImages) {
      try {
        existingImages = typeof data.existingImages === 'string'
          ? JSON.parse(data.existingImages)
          : data.existingImages;
        if (!Array.isArray(existingImages)) existingImages = [];
      } catch {
        existingImages = [];
      }
    }
    delete data.existingImages;
    delete data.images;
    delete data.mainImage;
    delete data.barcodeImage;

    const finalImages = [...existingImages, ...uploadedImageUrls].filter(Boolean);
    if (finalImages.length > 0) {
      data.images = finalImages;
      data.mainImage = finalImages[0];
    }
    if (uploadedBarcodeImage) {
      data.barcodeImage = uploadedBarcodeImage;
    }

    data = normalizeIncomingProduct(data);

    const locationIdInput = data.locationId || null;
    delete data.locationId;

    // ✅ Ensure rackLocationName has a value
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
      currentStock: 0,
      totalValue: 0,
      availableStock: 0,
      createdBy: userId,
      companyId: companyId
    };

    console.log('🔵 [createProduct] Final product data:', JSON.stringify(productData, null, 2));

    let product;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        product = await ProductModel.create(productData);
        break;
      } catch (createErr) {
        const isDup = createErr?.code === 'P2002';
        if (!isDup || attempt === 7) throw createErr;
        productData.sku = await ProductModel.generateSku(companyId, data.name, data.categoryId);
        productData.barcodeNumber = `${productData.sku}-${String(attempt + 1)}`;
      }
    }

    // Assign product to selected location (0 stock) so it appears in that warehouse catalog
    try {
      const locationId = await resolveLocationId(
        prisma,
        companyId,
        locationIdInput,
        userId
      );
      await getOrCreateProductStock(prisma, {
        companyId,
        productId: product.id,
        locationId,
      });
      console.log(
        '✅ [createProduct] Assigned to location',
        locationId,
        'product',
        product.id
      );
    } catch (locErr) {
      console.error(
        '⚠️ [createProduct] Location assign failed (non-fatal):',
        locErr.message
      );
    }

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

    // ─── Cloudinary uploads ─────────────────────────────────
    const uploadedImageUrls = [];
    if (req.files?.images?.length) {
      for (const file of req.files.images) {
        if (file.path) uploadedImageUrls.push(file.path);
      }
    }
    let uploadedBarcodeImage = null;
    if (req.files?.barcodeImage?.[0]?.path) {
      uploadedBarcodeImage = req.files.barcodeImage[0].path;
    }

    let keepImages;
    if (data.existingImages !== undefined) {
      try {
        keepImages = typeof data.existingImages === 'string'
          ? JSON.parse(data.existingImages)
          : data.existingImages;
        if (!Array.isArray(keepImages)) keepImages = existing.images || [];
      } catch {
        keepImages = existing.images || [];
      }
    } else {
      keepImages = existing.images || [];
    }
    delete data.existingImages;
    delete data.images;
    delete data.mainImage;

    const finalImages = [...keepImages, ...uploadedImageUrls].filter(Boolean);
    data.images = finalImages;
    data.mainImage = finalImages.length > 0 ? finalImages[0] : null;

    if (uploadedBarcodeImage) {
      data.barcodeImage = uploadedBarcodeImage;
    } else if (data.barcodeImage === '' || data.clearBarcodeImage === 'true') {
      data.barcodeImage = null;
    }
    delete data.clearBarcodeImage;

    data = normalizeIncomingProduct(data);

    // ─── Check duplicate SKU ──────────────────────────────
    if (data.sku && String(data.sku).toUpperCase() !== String(existing.sku || '').toUpperCase()) {
      const duplicateSku = await ProductModel.checkSkuExists(data.sku, companyId, id);
      if (duplicateSku) {
        data.sku = existing.sku;
      }
    }

    // ─── Check duplicate barcode ──────────────────────────
    const nextBarcode = data.barcodeNumber ? String(data.barcodeNumber).trim() : '';
    const prevBarcode = existing.barcodeNumber ? String(existing.barcodeNumber).trim() : '';
    if (nextBarcode && nextBarcode.toUpperCase() !== prevBarcode.toUpperCase()) {
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

    if (data.categoryId) {
      const cat = await prisma.category.findUnique({
        where: { id: data.categoryId },
        select: { name: true }
      });
      if (cat) data.categoryName = cat.name;
    }
    if (data.supplierId) {
      const sup = await prisma.supplier.findUnique({
        where: { id: data.supplierId },
        select: { name: true }
      });
      if (sup) data.supplierName = sup.name;
    }

    // Stock qty changes only via Stock Movement (with accounting)
    if (data.currentStock !== undefined && data.currentStock !== null) {
      const newStock = Number(data.currentStock);
      const oldStock = Number(existing.currentStock) || 0;
      if (newStock !== oldStock) {
        return res.status(400).json({
          success: false,
          message:
            'Cannot change stock quantity here. Use Warehouse → Stock Movement (Opening Stock, Adjustment, etc.).',
        });
      }
      delete data.currentStock;
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
    const { q, page = 1, limit = 20, locationId } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const { products, total } = await ProductModel.search(q, companyId, {
      skip,
      take: limitNum,
    });

    let data = products;
    if (locationId) {
      const stocks = await prisma.productStock.findMany({
        where: {
          companyId,
          locationId,
          productId: { in: products.map((p) => p.id) },
        },
      });
      const byProduct = new Map(stocks.map((s) => [s.productId, s]));
      data = products.map((p) => {
        const s = byProduct.get(p.id);
        const currentStock = s?.currentStock ?? 0;
        const reservedStock = s?.reservedStock ?? 0;
        return {
          ...p,
          currentStock,
          reservedStock,
          availableStock: Math.max(0, currentStock - reservedStock),
          locationId,
        };
      });
    }

    res.status(200).json({
      success: true,
      count: data.length,
      data,
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
      const openingQty = Number(productData.currentStock) || 0;
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
        currentStock: 0,
        totalValue: 0,
        availableStock: 0,
        createdBy: userId,
        companyId: companyId
      };
      const product = await ProductModel.create(data);
      created.push({ product, skippedOpeningStock: openingQty });
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