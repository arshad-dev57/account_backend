// controllers/productController.js - MULTI-TENANT VERSION

const prisma = require('../../prisma/client');

// ============================================================
// @desc    Get all products (User-specific)
// @route   GET /api/warehouse/products
// @access  Private
// ============================================================
const getProducts = async (req, res) => {
  try {
    const userId = req.user.id; // 👈 Current user from auth middleware
    
    const {
      search,
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

    // ✅ Base filter with userId
    const filter = { 
      isActive: true,
      userId: userId  // 👈 CRITICAL: Sirf current user ke products
    };

    // Search
    if (search) {
      filter.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { barcodeNumber: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Category filter
    if (categoryId) {
      filter.categoryId = categoryId;
    }

    // Supplier filter
    if (supplierId) {
      filter.supplierId = supplierId;
    }

    // Stock status filter
    if (stockStatus) {
      if (stockStatus === 'low') {
        filter.currentStock = { lte: filter.minimumStock };
      } else if (stockStatus === 'out') {
        filter.currentStock = 0;
      } else if (stockStatus === 'in') {
        filter.currentStock = { gt: 0 };
      }
    }

    // Price range
    if (minPrice || maxPrice) {
      filter.sellingPrice = {};
      if (minPrice) filter.sellingPrice.gte = parseFloat(minPrice);
      if (maxPrice) filter.sellingPrice.lte = parseFloat(maxPrice);
    }

    // Sorting
    const orderBy = {};
    orderBy[sortBy] = sortOrder === 'asc' ? 'asc' : 'desc';

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // ✅ Execute query with userId filter
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: filter,
        skip,
        take: limitNum,
        orderBy,
        include: {
          category: {
            select: { id: true, name: true }
          },
          supplier: {
            select: { id: true, name: true }
          }
        }
      }),
      prisma.product.count({ where: filter })
    ]);

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
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get single product (User-specific)
// @route   GET /api/warehouse/products/:id
// @access  Private
// ============================================================
const getProductById = async (req, res) => {
  try {
    const userId = req.user.id;
    const productId = req.params.id;

    // ✅ Product must belong to current user
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        userId: userId  // 👈 CRITICAL
      },
      include: {
        category: {
          select: { id: true, name: true }
        },
        supplier: {
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
        }
      }
    });

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
      error: error.message
    });
  }
};

// ============================================================
// @desc    Create product (Auto-add userId)
// @route   POST /api/warehouse/products
// @access  Private
// ============================================================
const createProduct = async (req, res) => {
  try {
    const userId = req.user.id; // 👈 Current user
    
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
      weight,
      weightUnitName,
      length,
      width,
      height,
      dimensionUnit,
      color,
      size,
      material,
      expiryDate,
      hasExpiry,
      isBatchManaged,
      isSerialManaged,
      taxRate,
      taxType,
      currencyCode,
      productType,
      brandName,
      modelNumber,
      tags,
      colors,
      sizes,
    } = req.body;

    // Validation
    if (!name || !sku || !categoryId) {
      return res.status(400).json({
        success: false,
        message: 'Name, SKU, and Category are required'
      });
    }

    // ✅ Check duplicate SKU for THIS user only
    const existingProduct = await prisma.product.findFirst({
      where: {
        sku: sku.toUpperCase(),
        userId: userId  // 👈 User-specific
      }
    });
    
    if (existingProduct) {
      return res.status(400).json({
        success: false,
        message: 'Product with this SKU already exists'
      });
    }

    // ✅ Check duplicate barcode for THIS user only
    if (barcodeNumber) {
      const existingBarcode = await prisma.product.findFirst({
        where: {
          barcodeNumber: barcodeNumber,
          userId: userId  // 👈 User-specific
        }
      });
      
      if (existingBarcode) {
        return res.status(400).json({
          success: false,
          message: 'Product with this barcode already exists'
        });
      }
    }

    // Get category name (User-specific category)
    let categoryName = '';
    if (categoryId) {
      const category = await prisma.category.findFirst({
        where: {
          id: categoryId,
          userId: userId  // 👈 Category must belong to user
        }
      });
      if (category) {
        categoryName = category.name;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Category not found or does not belong to you'
        });
      }
    }

    // Get supplier name (User-specific supplier)
    let supplierName = '';
    if (supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: {
          id: supplierId,
          userId: userId  // 👈 Supplier must belong to user
        }
      });
      if (supplier) {
        supplierName = supplier.name;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Supplier not found or does not belong to you'
        });
      }
    }

    // ✅ Build product data with userId
    const productData = {
      name,
      sku: sku.toUpperCase(),
      barcodeNumber: barcodeNumber || null,
      categoryId,
      categoryName,
      supplierId: supplierId || null,
      supplierName,
      costPrice: parseFloat(costPrice) || 0,
      sellingPrice: parseFloat(sellingPrice) || 0,
      currentStock: parseInt(currentStock) || 0,
      minimumStock: parseInt(minimumStock) || 5,
      maximumStock: parseInt(maximumStock) || 100,
      description: description || '',
      rackLocationName: rackLocationName || 'A-1-B1',
      createdBy: userId,
      userId: userId,  // 👈 CRITICAL: Link to current user
      // Optional fields
      weight: weight ? parseFloat(weight) : 0,
      weightUnitName: weightUnitName || 'KG',
      length: length ? parseFloat(length) : 0,
      width: width ? parseFloat(width) : 0,
      height: height ? parseFloat(height) : 0,
      dimensionUnit: dimensionUnit || 'cm',
      color: color || null,
      size: size || null,
      material: material || null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      hasExpiry: hasExpiry === 'true' || hasExpiry === true,
      isBatchManaged: isBatchManaged === 'true' || isBatchManaged === true,
      isSerialManaged: isSerialManaged === 'true' || isSerialManaged === true,
      taxRate: taxRate ? parseFloat(taxRate) : 0,
      taxType: taxType || 'Exclusive',
      currencyCode: currencyCode || 'PKR',
      productType: productType || 'Physical',
      brandName: brandName || null,
      modelNumber: modelNumber || null,
      tags: tags ? (typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags) : [],
      colors: colors ? (typeof colors === 'string' ? colors.split(',').map(c => c.trim()) : colors) : [],
      sizes: sizes ? (typeof sizes === 'string' ? sizes.split(',').map(s => s.trim()) : sizes) : [],
      // Calculate total value
      totalValue: (parseInt(currentStock) || 0) * (parseFloat(costPrice) || 0),
      availableStock: parseInt(currentStock) || 0
    };

    const product = await prisma.product.create({
      data: productData
    });

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product
    });
  } catch (error) {
    console.error('Create product error:', error);

    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'Duplicate SKU or barcode number'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Update product (User-specific)
// @route   PUT /api/warehouse/products/:id
// @access  Private
// ============================================================
const updateProduct = async (req, res) => {
  try {
    const userId = req.user.id;
    const productId = req.params.id;
    
    // ✅ Check if product exists AND belongs to this user
    const existing = await prisma.product.findFirst({
      where: {
        id: productId,
        userId: userId  // 👈 CRITICAL
      }
    });
    
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // ✅ Check duplicate SKU (within this user's products only)
    if (req.body.sku && req.body.sku !== existing.sku) {
      const duplicate = await prisma.product.findFirst({
        where: {
          sku: req.body.sku.toUpperCase(),
          userId: userId,  // 👈 User-specific
          NOT: { id: productId }
        }
      });
      
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Product with this SKU already exists'
        });
      }
    }

    // ✅ Check duplicate barcode (within this user's products only)
    if (req.body.barcodeNumber && req.body.barcodeNumber !== existing.barcodeNumber) {
      const duplicate = await prisma.product.findFirst({
        where: {
          barcodeNumber: req.body.barcodeNumber,
          userId: userId,  // 👈 User-specific
          NOT: { id: productId }
        }
      });
      
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Product with this barcode already exists'
        });
      }
    }

    // Update category name if category changed (must belong to user)
    if (req.body.categoryId && req.body.categoryId !== existing.categoryId) {
      const category = await prisma.category.findFirst({
        where: {
          id: req.body.categoryId,
          userId: userId  // 👈 Category must belong to user
        }
      });
      if (category) {
        req.body.categoryName = category.name;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Category not found or does not belong to you'
        });
      }
    }

    // Update supplier name if supplier changed (must belong to user)
    if (req.body.supplierId && req.body.supplierId !== existing.supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: {
          id: req.body.supplierId,
          userId: userId  // 👈 Supplier must belong to user
        }
      });
      if (supplier) {
        req.body.supplierName = supplier.name;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Supplier not found or does not belong to you'
        });
      }
    }

    // Handle arrays
    if (req.body.tags && typeof req.body.tags === 'string') {
      req.body.tags = req.body.tags.split(',').map(t => t.trim());
    }
    if (req.body.colors && typeof req.body.colors === 'string') {
      req.body.colors = req.body.colors.split(',').map(c => c.trim());
    }
    if (req.body.sizes && typeof req.body.sizes === 'string') {
      req.body.sizes = req.body.sizes.split(',').map(s => s.trim());
    }

    // Set updatedBy
    req.body.updatedBy = userId;

    // Update totalValue if stock or cost changes
    if (req.body.currentStock !== undefined || req.body.costPrice !== undefined) {
      const newStock = req.body.currentStock !== undefined ? parseInt(req.body.currentStock) : existing.currentStock;
      const newCost = req.body.costPrice !== undefined ? parseFloat(req.body.costPrice) : existing.costPrice;
      req.body.totalValue = newStock * newCost;
      req.body.availableStock = newStock - (existing.reservedStock || 0);
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data: req.body
    });

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: product
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Delete product (User-specific)
// @route   DELETE /api/warehouse/products/:id
// @access  Private
// ============================================================
const deleteProduct = async (req, res) => {
  try {
    const userId = req.user.id;
    const productId = req.params.id;
    
    // ✅ Check if product exists AND belongs to this user
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        userId: userId  // 👈 CRITICAL
      }
    });
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Soft delete - mark as inactive
    await prisma.product.update({
      where: { id: productId },
      data: {
        isActive: false,
        updatedBy: userId
      }
    });

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Hard delete product (Admin only)
// @route   DELETE /api/warehouse/products/:id/hard
// @access  Private (Admin only)
// ============================================================
const hardDeleteProduct = async (req, res) => {
  try {
    const userId = req.user.id;
    const productId = req.params.id;
    
    // ✅ Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can hard delete products'
      });
    }

    // ✅ Check if product exists AND belongs to this user
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        userId: userId
      }
    });
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    await prisma.product.delete({
      where: { id: productId }
    });

    res.status(200).json({
      success: true,
      message: 'Product permanently deleted'
    });
  } catch (error) {
    console.error('Hard delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Search products (User-specific)
// @route   GET /api/warehouse/products/search?q=...
// @access  Private
// ============================================================
const searchProducts = async (req, res) => {
  try {
    const userId = req.user.id;
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

    // ✅ Search only user's products
    const where = {
      userId: userId,  // 👈 CRITICAL
      isActive: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
        { barcodeNumber: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { categoryName: { contains: q, mode: 'insensitive' } },
        { supplierName: { contains: q, mode: 'insensitive' } }
      ]
    };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limitNum,
        include: {
          category: { select: { name: true } },
          supplier: { select: { name: true } }
        }
      }),
      prisma.product.count({ where })
    ]);

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
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get low stock products (User-specific)
// @route   GET /api/warehouse/products/low-stock
// @access  Private
// ============================================================
const getLowStockProducts = async (req, res) => {
  try {
    const userId = req.user.id;

    // ✅ Only user's low stock products
    const products = await prisma.product.findMany({
      where: {
        userId: userId,  // 👈 CRITICAL
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
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get product by barcode (User-specific)
// @route   GET /api/warehouse/products/barcode/:barcode
// @access  Private
// ============================================================
const getProductByBarcode = async (req, res) => {
  try {
    const userId = req.user.id;
    const { barcode } = req.params;

    // ✅ Product must belong to user
    const product = await prisma.product.findFirst({
      where: {
        barcodeNumber: barcode,
        userId: userId,  // 👈 CRITICAL
        isActive: true
      },
      include: {
        category: { select: { name: true } },
        supplier: { select: { name: true } }
      }
    });

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
      error: error.message
    });
  }
};

// ============================================================
// @desc    Check if barcode exists (User-specific)
// @route   GET /api/warehouse/products/check-barcode/:barcode
// @access  Private
// ============================================================
const checkBarcodeExists = async (req, res) => {
  try {
    const userId = req.user.id;
    const { barcode } = req.params;

    // ✅ Check only user's products
    const product = await prisma.product.findFirst({
      where: {
        barcodeNumber: barcode,
        userId: userId,  // 👈 CRITICAL
        isActive: true
      },
      select: { id: true }
    });

    res.status(200).json({
      success: true,
      exists: !!product
    });
  } catch (error) {
    console.error('Check barcode error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get products by category (User-specific)
// @route   GET /api/warehouse/products/category/:categoryId
// @access  Private
// ============================================================
const getProductsByCategory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { categoryId } = req.params;

    // ✅ Category must belong to user
    const category = await prisma.category.findFirst({
      where: {
        id: categoryId,
        userId: userId  // 👈 CRITICAL
      },
      select: { id: true, name: true }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // ✅ Products must belong to user
    const products = await prisma.product.findMany({
      where: {
        categoryId: categoryId,
        userId: userId,  // 👈 CRITICAL
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
      error: error.message
    });
  }
};

// ============================================================
// @desc    Update stock (User-specific)
// @route   PUT /api/warehouse/products/:id/stock
// @access  Private
// ============================================================
const updateStock = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { quantity, type = 'add', reason = 'Manual update' } = req.body;

    if (quantity === undefined || quantity === null) {
      return res.status(400).json({
        success: false,
        message: 'Quantity is required'
      });
    }

    // ✅ Product must belong to user
    const product = await prisma.product.findFirst({
      where: {
        id: id,
        userId: userId  // 👈 CRITICAL
      }
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const qty = parseInt(quantity);
    let newStock = product.currentStock;
    let stockType = 'add';

    if (type === 'add') {
      newStock = product.currentStock + qty;
      stockType = 'add';
    } else if (type === 'subtract') {
      newStock = product.currentStock - qty;
      stockType = 'subtract';
      if (newStock < 0) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient stock'
        });
      }
    } else if (type === 'set') {
      newStock = qty;
      stockType = 'set';
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid stock update type. Use add, subtract, or set'
      });
    }

    // ✅ Create stock movement record
    await prisma.stockMovement.create({
      data: {
        productId: product.id,
        productName: product.name,
        type: stockType,
        quantity: qty,
        previousStock: product.currentStock,
        newStock: newStock,
        reason: reason,
        supplierId: product.supplierId,
        supplierName: product.supplierName,
        createdBy: userId,
        userId: userId  // 👈 User-specific
      }
    });

    // ✅ Update product with new stock
    const updatedProduct = await prisma.product.update({
      where: { id: id },
      data: {
        currentStock: newStock,
        availableStock: newStock - product.reservedStock,
        totalValue: newStock * product.costPrice,
        updatedBy: userId
      },
      select: {
        id: true,
        name: true,
        sku: true,
        currentStock: true,
        availableStock: true,
        totalValue: true
      }
    });

    res.status(200).json({
      success: true,
      message: 'Stock updated successfully',
      data: updatedProduct
    });
  } catch (error) {
    console.error('Update stock error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get product statistics (User-specific)
// @route   GET /api/warehouse/products/stats
// @access  Private
// ============================================================
const getProductStats = async (req, res) => {
  try {
    const userId = req.user.id;

    // ✅ Only user's products
    const stats = await prisma.$transaction([
      prisma.product.count({
        where: { userId: userId, isActive: true }
      }),
      prisma.product.count({
        where: { 
          userId: userId, 
          isActive: true,
          currentStock: { lte: prisma.product.fields.minimumStock }
        }
      }),
      prisma.product.count({
        where: { 
          userId: userId, 
          isActive: true,
          currentStock: 0
        }
      }),
      prisma.product.aggregate({
        where: { userId: userId, isActive: true },
        _sum: {
          currentStock: true,
          totalValue: true
        }
      })
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalProducts: stats[0],
        lowStockProducts: stats[1],
        outOfStockProducts: stats[2],
        totalStock: stats[3]._sum.currentStock || 0,
        totalInventoryValue: stats[3]._sum.totalValue || 0
      }
    });
  } catch (error) {
    console.error('Get product stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Bulk create products (User-specific)
// @route   POST /api/warehouse/products/bulk
// @access  Private
// ============================================================
const bulkCreateProducts = async (req, res) => {
  try {
    const userId = req.user.id;
    const { products } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Products array is required'
      });
    }

    // ✅ Add userId to each product
    const productsWithUser = products.map(product => ({
      ...product,
      sku: product.sku.toUpperCase(),
      userId: userId,
      createdBy: userId,
      isActive: true,
      totalValue: (parseInt(product.currentStock) || 0) * (parseFloat(product.costPrice) || 0),
      availableStock: parseInt(product.currentStock) || 0
    }));

    // ✅ Create all products for this user
    const created = await prisma.product.createMany({
      data: productsWithUser,
      skipDuplicates: true // Skip if SKU already exists for this user
    });

    res.status(201).json({
      success: true,
      message: `${created.count} products created successfully`,
      data: {
        count: created.count
      }
    });
  } catch (error) {
    console.error('Bulk create products error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// EXPORT
// ============================================================
module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  hardDeleteProduct,
  searchProducts,
  getLowStockProducts,
  getProductByBarcode,
  checkBarcodeExists,
  getProductsByCategory,
  updateStock,
  getProductStats,
  bulkCreateProducts
};