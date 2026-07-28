const prisma = require('../../prisma/client');

// ============================================================
// @desc    Get all products (Company-specific)
// @route   GET /api/warehouse/products
// @access  Private
// ============================================================
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
      isActive: true,
      company: {
        id: companyId
      }
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
          },
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          },
          company: {
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
// @desc    Get single product (Company-specific)
// @route   GET /api/warehouse/products/:id
// @access  Private
// ============================================================
const getProductById = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const productId = req.params.id;

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        company: {
          id: companyId
        }
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
// @desc    Create product (Company-specific)
// @route   POST /api/warehouse/products
// @access  Private
// ============================================================
const createProduct = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    
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
    if (!name || !sku) {
      return res.status(400).json({
        success: false,
        message: 'Name and SKU are required'
      });
    }

    // Check duplicate SKU for this company
    const existingProduct = await prisma.product.findFirst({
      where: {
        sku: sku.toUpperCase(),
        company: {
          id: companyId
        }
      }
    });
    
    if (existingProduct) {
      return res.status(400).json({
        success: false,
        message: 'Product with this SKU already exists'
      });
    }

    // Check duplicate barcode for this company
    if (barcodeNumber) {
      const existingBarcode = await prisma.product.findFirst({
        where: {
          barcodeNumber: barcodeNumber,
          company: {
            id: companyId
          }
        }
      });
      
      if (existingBarcode) {
        return res.status(400).json({
          success: false,
          message: 'Product with this barcode already exists'
        });
      }
    }

    // Get category and connect using relation
    let categoryConnect = undefined;
    let categoryName = '';
    if (categoryId) {
      const category = await prisma.category.findFirst({
        where: {
          id: categoryId,
          company: {
            id: companyId
          }
        }
      });
      if (category) {
        categoryConnect = { connect: { id: categoryId } };
        categoryName = category.name;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Category not found or does not belong to your company'
        });
      }
    }

    // Get supplier and connect using relation
    let supplierConnect = undefined;
    let supplierName = '';
    if (supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: {
          id: supplierId,
          company: {
            id: companyId
          }
        }
      });
      if (supplier) {
        supplierConnect = { connect: { id: supplierId } };
        supplierName = supplier.name;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Supplier not found or does not belong to your company'
        });
      }
    }

    // ✅ FIXED: Use company relation instead of companyId
    const productData = {
      name,
      sku: sku.toUpperCase(),
      barcodeNumber: barcodeNumber || null,
      categoryName: categoryName,
      supplierName: supplierName,
      costPrice: parseFloat(costPrice) || 0,
      sellingPrice: parseFloat(sellingPrice) || 0,
      currentStock: parseInt(currentStock) || 0,
      minimumStock: parseInt(minimumStock) || 5,
      maximumStock: parseInt(maximumStock) || 100,
      description: description || '',
      rackLocationName: rackLocationName || 'A-1-B1',
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
      totalValue: (parseInt(currentStock) || 0) * (parseFloat(costPrice) || 0),
      availableStock: parseInt(currentStock) || 0,
      // ✅ FIXED: Use relations instead of direct IDs
      creator: { connect: { id: userId } },
      company: { connect: { id: companyId } },
      ...(categoryConnect && { category: categoryConnect }),
      ...(supplierConnect && { supplier: supplierConnect })
    };

    const product = await prisma.product.create({
      data: productData,
      include: {
        category: true,
        supplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        company: {
          select: { id: true, name: true }
        }
      }
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
// @desc    Update product (Company-specific)
// @route   PUT /api/warehouse/products/:id
// @access  Private
// ============================================================
const updateProduct = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const productId = req.params.id;
    
    const existing = await prisma.product.findFirst({
      where: {
        id: productId,
        company: {
          id: companyId
        }
      }
    });
    
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check duplicate SKU
    if (req.body.sku && req.body.sku !== existing.sku) {
      const duplicate = await prisma.product.findFirst({
        where: {
          sku: req.body.sku.toUpperCase(),
          company: {
            id: companyId
          },
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

    // Check duplicate barcode
    if (req.body.barcodeNumber && req.body.barcodeNumber !== existing.barcodeNumber) {
      const duplicate = await prisma.product.findFirst({
        where: {
          barcodeNumber: req.body.barcodeNumber,
          company: {
            id: companyId
          },
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

    // Handle category update with relation
    let categoryConnect = undefined;
    if (req.body.categoryId && req.body.categoryId !== existing.categoryId) {
      const category = await prisma.category.findFirst({
        where: {
          id: req.body.categoryId,
          company: {
            id: companyId
          }
        }
      });
      if (category) {
        categoryConnect = { connect: { id: req.body.categoryId } };
        req.body.categoryName = category.name;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Category not found or does not belong to your company'
        });
      }
      delete req.body.categoryId;
    }

    // Handle supplier update with relation
    let supplierConnect = undefined;
    if (req.body.supplierId && req.body.supplierId !== existing.supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: {
          id: req.body.supplierId,
          company: {
            id: companyId
          }
        }
      });
      if (supplier) {
        supplierConnect = { connect: { id: req.body.supplierId } };
        req.body.supplierName = supplier.name;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Supplier not found or does not belong to your company'
        });
      }
      delete req.body.supplierId;
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

    // ✅ FIXED: Use updater relation instead of updatedBy
    const updateData = {
      ...req.body,
      updater: { connect: { id: userId } }
    };

    // Update totalValue if stock or cost changes
    if (req.body.currentStock !== undefined || req.body.costPrice !== undefined) {
      const newStock = req.body.currentStock !== undefined ? parseInt(req.body.currentStock) : existing.currentStock;
      const newCost = req.body.costPrice !== undefined ? parseFloat(req.body.costPrice) : existing.costPrice;
      updateData.totalValue = newStock * newCost;
      updateData.availableStock = newStock - (existing.reservedStock || 0);
    }

    // Add relations to update data
    if (categoryConnect) {
      updateData.category = categoryConnect;
    }
    if (supplierConnect) {
      updateData.supplier = supplierConnect;
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data: updateData,
      include: {
        category: true,
        supplier: true,
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
// @desc    Delete product (Soft delete)
// @route   DELETE /api/warehouse/products/:id
// @access  Private
// ============================================================
const deleteProduct = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const productId = req.params.id;
    
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        company: {
          id: companyId
        }
      }
    });
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    await prisma.product.update({
      where: { id: productId },
      data: {
        isActive: false,
        updater: { connect: { id: userId } }
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
    const companyId = req.user.companyId;
    const productId = req.params.id;
    
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can hard delete products'
      });
    }

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        company: {
          id: companyId
        }
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
// @desc    Search products (Company-specific)
// @route   GET /api/warehouse/products/search?q=...
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

    const where = {
      company: {
        id: companyId
      },
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
          supplier: { select: { name: true } },
          company: { select: { name: true } }
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
// @desc    Get low stock products (Company-specific)
// @route   GET /api/warehouse/products/low-stock
// @access  Private
// ============================================================
const getLowStockProducts = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const products = await prisma.product.findMany({
      where: {
        company: {
          id: companyId
        },
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
// @desc    Get product by barcode (Company-specific)
// @route   GET /api/warehouse/products/barcode/:barcode
// @access  Private
// ============================================================
const getProductByBarcode = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { barcode } = req.params;

    const product = await prisma.product.findFirst({
      where: {
        barcodeNumber: barcode,
        company: {
          id: companyId
        },
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
// @desc    Check if barcode exists (Company-specific)
// @route   GET /api/warehouse/products/check-barcode/:barcode
// @access  Private
// ============================================================
const checkBarcodeExists = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { barcode } = req.params;

    const product = await prisma.product.findFirst({
      where: {
        barcodeNumber: barcode,
        company: {
          id: companyId
        },
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
// @desc    Get products by category (Company-specific)
// @route   GET /api/warehouse/products/category/:categoryId
// @access  Private
// ============================================================
const getProductsByCategory = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { categoryId } = req.params;

    const category = await prisma.category.findFirst({
      where: {
        id: categoryId,
        company: {
          id: companyId
        }
      },
      select: { id: true, name: true }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const products = await prisma.product.findMany({
      where: {
        categoryId: categoryId,
        company: {
          id: companyId
        },
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
// @desc    Update stock (Company-specific)
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

    const product = await prisma.product.findFirst({
      where: {
        id: id,
        company: {
          id: companyId
        }
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
        company: { connect: { id: companyId } }
      }
    });

    const updatedProduct = await prisma.product.update({
      where: { id: id },
      data: {
        currentStock: newStock,
        availableStock: newStock - (product.reservedStock || 0),
        totalValue: newStock * product.costPrice,
        updater: { connect: { id: userId } }
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
// @desc    Get product stats (Company-specific)
// @route   GET /api/warehouse/products/stats
// @access  Private
// ============================================================
const getProductStats = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const stats = await prisma.$transaction([
      prisma.product.count({
        where: { company: { id: companyId }, isActive: true }
      }),
      prisma.product.count({
        where: { 
          company: { id: companyId },
          isActive: true,
          currentStock: { lte: prisma.product.fields.minimumStock }
        }
      }),
      prisma.product.count({
        where: { 
          company: { id: companyId },
          isActive: true,
          currentStock: 0
        }
      }),
      prisma.product.aggregate({
        where: { company: { id: companyId }, isActive: true },
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
// @desc    Bulk create products (Company-specific)
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

    const productsWithCompany = products.map(product => ({
      ...product,
      sku: product.sku.toUpperCase(),
      isActive: true,
      totalValue: (parseInt(product.currentStock) || 0) * (parseFloat(product.costPrice) || 0),
      availableStock: parseInt(product.currentStock) || 0,
      company: { connect: { id: companyId } },
      creator: { connect: { id: userId } }
    }));

    // For createMany, we need to use nested creates differently
    const created = await prisma.$transaction(
      productsWithCompany.map(productData => 
        prisma.product.create({ data: productData })
      )
    );

    res.status(201).json({
      success: true,
      message: `${created.length} products created successfully`,
      data: {
        count: created.length
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