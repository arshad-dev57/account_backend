// warehouse/controller/supplier_controller.js - MULTI-TENANT VERSION

const prisma = require('../../prisma/client');

// ─── HELPERS ────────────────────────────────────────────────
const buildSupplierFilter = (userId, search, status) => {
  const filter = {
    userId: userId // 👈 CRITICAL: Sirf current user ke suppliers
  };

  // Status filter
  if (status && status !== 'all') {
    filter.status = status;
  }

  // Search across multiple fields
  if (search) {
    filter.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { companyName: { contains: search, mode: 'insensitive' } },
      { contactPerson: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
      { department: { contains: search, mode: 'insensitive' } },
      { city: { contains: search, mode: 'insensitive' } },
      { country: { contains: search, mode: 'insensitive' } },
      { industry: { contains: search, mode: 'insensitive' } },
      { gstNumber: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } }
    ];
  }

  return filter;
};

// ============================================================
// @desc    Get all suppliers (User-specific)
// @route   GET /api/warehouse/supplier
// @access  Private
// ============================================================
const getSuppliers = async (req, res) => {
  try {
    const userId = req.user.id; // 👈 Current user
    const { search, status, page = 1, limit = 20 } = req.query;

    const filter = buildSupplierFilter(userId, search, status);

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get paginated suppliers
    const [suppliers, total, stats] = await Promise.all([
      prisma.supplier.findMany({
        where: filter,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.supplier.count({ where: filter }),
      getSupplierStatsInternal(userId) // 👈 User-specific stats
    ]);

    res.status(200).json({
      success: true,
      count: suppliers.length,
      data: suppliers,
      kpi: {
        total: stats.total,
        active: stats.active,
        inactive: stats.inactive,
        preferred: stats.preferred
      },
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
    console.error('Get suppliers error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get single supplier by ID (User-specific)
// @route   GET /api/warehouse/supplier/:id
// @access  Private
// ============================================================
const getSupplierById = async (req, res) => {
  try {
    const userId = req.user.id;
    const supplierId = req.params.id;

    // ✅ Supplier must belong to current user
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        userId: userId // 👈 CRITICAL
      },
      include: {
        products: {
          where: {
            isActive: true,
            userId: userId // 👈 User-specific
          },
          select: {
            id: true,
            name: true,
            sku: true,
            currentStock: true,
            sellingPrice: true
          },
          take: 5
        },
        purchases: {
          where: {
            userId: userId // 👈 User-specific
          },
          select: {
            id: true,
            purchaseNumber: true,
            purchaseDate: true,
            grandTotal: true,
            purchaseStatus: true
          },
          orderBy: { purchaseDate: 'desc' },
          take: 5
        },
        bills: {
          where: {
            userId: userId // 👈 User-specific
          },
          select: {
            id: true,
            billNumber: true,
            date: true,
            totalAmount: true,
            status: true
          },
          orderBy: { date: 'desc' },
          take: 5
        }
      }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    // Get additional stats
    const stats = await getSupplierStatsInternal(userId, supplierId);

    res.status(200).json({
      success: true,
      data: {
        ...supplier,
        stats: {
          totalProducts: stats.totalProducts,
          totalPurchases: stats.totalPurchases,
          totalPurchaseValue: stats.totalPurchaseValue,
          totalBills: stats.totalBills,
          totalBillsAmount: stats.totalBillsAmount,
          outstandingBills: stats.outstandingBills
        }
      }
    });
  } catch (error) {
    console.error('Get supplier error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Create a new supplier (Auto-add userId)
// @route   POST /api/warehouse/supplier
// @access  Private
// ============================================================
const createSupplier = async (req, res) => {
  try {
    const userId = req.user.id; // 👈 Current user
    const {
      name,
      companyName,
      contactPerson,
      department,
      phone,
      email,
      address,
      city,
      country,
      industry,
      businessType,
      paymentTerms,
      gstNumber,
      taxId,
      status,
      isPreferred,
      isVerified,
      notes
    } = req.body;

    // Validation
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Supplier name is required'
      });
    }

    // ✅ Check duplicate name for this user
    const existingName = await prisma.supplier.findFirst({
      where: {
        name: name,
        userId: userId // 👈 User-specific
      }
    });

    if (existingName) {
      return res.status(400).json({
        success: false,
        message: 'Supplier with this name already exists for your account'
      });
    }

    // ✅ Generate unique code for this user
    const code = req.body.code || `SUP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // ✅ Check duplicate code for this user
    const existingCode = await prisma.supplier.findFirst({
      where: {
        code: code,
        userId: userId // 👈 User-specific
      }
    });

    if (existingCode) {
      return res.status(400).json({
        success: false,
        message: 'Supplier with this code already exists for your account'
      });
    }

    // ✅ Check duplicate email for this user
    if (email) {
      const existingEmail = await prisma.supplier.findFirst({
        where: {
          email: email,
          userId: userId // 👈 User-specific
        }
      });

      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: 'Supplier with this email already exists for your account'
        });
      }
    }

    // ✅ Check duplicate phone for this user
    if (phone) {
      const existingPhone = await prisma.supplier.findFirst({
        where: {
          phone: phone,
          userId: userId // 👈 User-specific
        }
      });

      if (existingPhone) {
        return res.status(400).json({
          success: false,
          message: 'Supplier with this phone already exists for your account'
        });
      }
    }

    // Build supplier data with userId
    const supplierData = {
      name,
      code,
      companyName: companyName || '',
      contactPerson: contactPerson || '',
      department: department || '',
      phone: phone || '',
      email: email || '',
      address: address || '',
      city: city || '',
      country: country || 'Pakistan',
      industry: industry || '',
      businessType: businessType || '',
      paymentTerms: paymentTerms || 'Net 30',
      gstNumber: gstNumber || '',
      taxId: taxId || '',
      status: status || 'active',
      isPreferred: isPreferred || false,
      isVerified: isVerified || false,
      notes: notes || '',
      createdBy: userId,
      userId: userId // 👈 CRITICAL: Link to current user
    };

    const supplier = await prisma.supplier.create({
      data: supplierData
    });

    res.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      data: supplier
    });
  } catch (error) {
    console.error('Create supplier error:', error);

    // Prisma unique constraint error
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'Supplier with this name, code, email, or phone already exists'
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
// @desc    Update supplier (User-specific)
// @route   PUT /api/warehouse/supplier/:id
// @access  Private
// ============================================================
const updateSupplier = async (req, res) => {
  try {
    const userId = req.user.id;
    const supplierId = req.params.id;

    // ✅ Check if supplier exists AND belongs to this user
    const existing = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        userId: userId // 👈 CRITICAL
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    // ✅ Check duplicate name for this user (excluding current)
    if (req.body.name && req.body.name !== existing.name) {
      const duplicate = await prisma.supplier.findFirst({
        where: {
          name: req.body.name,
          userId: userId,
          NOT: { id: supplierId }
        }
      });

      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Supplier with this name already exists for your account'
        });
      }
    }

    // ✅ Check duplicate code for this user (excluding current)
    if (req.body.code && req.body.code !== existing.code) {
      const duplicate = await prisma.supplier.findFirst({
        where: {
          code: req.body.code,
          userId: userId,
          NOT: { id: supplierId }
        }
      });

      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Supplier with this code already exists for your account'
        });
      }
    }

    // ✅ Check duplicate email for this user (excluding current)
    if (req.body.email && req.body.email !== existing.email) {
      const duplicate = await prisma.supplier.findFirst({
        where: {
          email: req.body.email,
          userId: userId,
          NOT: { id: supplierId }
        }
      });

      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Supplier with this email already exists for your account'
        });
      }
    }

    // ✅ Check duplicate phone for this user (excluding current)
    if (req.body.phone && req.body.phone !== existing.phone) {
      const duplicate = await prisma.supplier.findFirst({
        where: {
          phone: req.body.phone,
          userId: userId,
          NOT: { id: supplierId }
        }
      });

      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Supplier with this phone already exists for your account'
        });
      }
    }

    // Allowed fields to update
    const allowedUpdates = [
      'name', 'code', 'companyName', 'contactPerson', 'department',
      'phone', 'email', 'address', 'city', 'country',
      'industry', 'businessType', 'paymentTerms',
      'gstNumber', 'taxId', 'status', 'isPreferred',
      'isVerified', 'notes'
    ];

    const updateData = {};
    for (const field of allowedUpdates) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    const supplier = await prisma.supplier.update({
      where: { id: supplierId },
      data: updateData
    });

    res.status(200).json({
      success: true,
      message: 'Supplier updated successfully',
      data: supplier
    });
  } catch (error) {
    console.error('Update supplier error:', error);

    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'Supplier with this name, code, email, or phone already exists'
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
// @desc    Delete supplier (User-specific)
// @route   DELETE /api/warehouse/supplier/:id
// @access  Private (Admin only)
// ============================================================
const deleteSupplier = async (req, res) => {
  try {
    const userId = req.user.id;
    const supplierId = req.params.id;

    // ✅ Check if supplier exists AND belongs to this user
    const existing = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        userId: userId // 👈 CRITICAL
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    // ✅ Check if linked to any products (user-specific)
    const productCount = await prisma.product.count({
      where: {
        supplierId: supplierId,
        userId: userId, // 👈 User-specific
        isActive: true
      }
    });

    // Check if linked to any purchases (user-specific)
    const purchaseCount = await prisma.warehousePurchase.count({
      where: {
        supplierId: supplierId,
        userId: userId // 👈 User-specific
      }
    });

    // Check if linked to any bills (user-specific)
    const billCount = await prisma.bill.count({
      where: {
        vendorId: supplierId,
        userId: userId // 👈 User-specific
      }
    });

    const hasLinkedRecords = productCount > 0 || purchaseCount > 0 || billCount > 0;

    if (hasLinkedRecords) {
      // Soft delete: deactivate instead of hard delete
      await prisma.supplier.update({
        where: { id: supplierId },
        data: {
          status: 'inactive',
          updatedBy: userId
        }
      });

      return res.status(200).json({
        success: true,
        message: 'Supplier deactivated (has linked records)',
        data: {
          supplierId,
          status: 'inactive',
          linkedProducts: productCount,
          linkedPurchases: purchaseCount,
          linkedBills: billCount
        }
      });
    }

    // Hard delete if no linked records
    await prisma.supplier.delete({
      where: { id: supplierId }
    });

    res.status(200).json({
      success: true,
      message: 'Supplier deleted successfully'
    });
  } catch (error) {
    console.error('Delete supplier error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Hard delete supplier (Admin only)
// @route   DELETE /api/warehouse/supplier/:id/hard
// @access  Private (Admin only)
// ============================================================
const hardDeleteSupplier = async (req, res) => {
  try {
    const userId = req.user.id;
    const supplierId = req.params.id;

    // ✅ Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can hard delete suppliers'
      });
    }

    // ✅ Check if supplier exists AND belongs to this user
    const existing = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        userId: userId
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    await prisma.supplier.delete({
      where: { id: supplierId }
    });

    res.status(200).json({
      success: true,
      message: 'Supplier permanently deleted'
    });
  } catch (error) {
    console.error('Hard delete supplier error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Search suppliers (User-specific)
// @route   GET /api/warehouse/supplier/search?q=...
// @access  Private
// ============================================================
const searchSuppliers = async (req, res) => {
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

    // ✅ Search only user's suppliers
    const where = {
      userId: userId, // 👈 CRITICAL
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
        { contactPerson: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { department: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
        { country: { contains: q, mode: 'insensitive' } },
        { industry: { contains: q, mode: 'insensitive' } },
        { gstNumber: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } }
      ]
    };

    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.supplier.count({ where })
    ]);

    res.status(200).json({
      success: true,
      count: suppliers.length,
      data: suppliers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Search suppliers error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get supplier stats (User-specific)
// @route   GET /api/warehouse/supplier/stats
// @access  Private
// ============================================================
const getSupplierStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const stats = await getSupplierStatsInternal(userId);

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get supplier stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get supplier stats (Internal helper - User-specific)
// ============================================================
const getSupplierStatsInternal = async (userId, supplierId = null) => {
  const whereCondition = {
    userId: userId // 👈 User-specific
  };

  if (supplierId) {
    whereCondition.id = supplierId;
  }

  // Count by status
  const [total, active, inactive, preferred] = await Promise.all([
    prisma.supplier.count({ where: whereCondition }),
    prisma.supplier.count({ 
      where: { 
        ...whereCondition, 
        status: 'active' 
      } 
    }),
    prisma.supplier.count({ 
      where: { 
        ...whereCondition, 
        status: 'inactive' 
      } 
    }),
    prisma.supplier.count({ 
      where: { 
        ...whereCondition, 
        isPreferred: true 
      } 
    })
  ]);

  // Get product counts for suppliers
  let totalProducts = 0;
  let totalPurchases = 0;
  let totalPurchaseValue = 0;
  let totalBills = 0;
  let totalBillsAmount = 0;
  let outstandingBills = 0;

  if (supplierId) {
    // Single supplier stats
    const [products, purchases, bills] = await Promise.all([
      prisma.product.count({
        where: {
          supplierId: supplierId,
          userId: userId,
          isActive: true
        }
      }),
      prisma.warehousePurchase.aggregate({
        where: {
          supplierId: supplierId,
          userId: userId
        },
        _count: true,
        _sum: {
          grandTotal: true
        }
      }),
      prisma.bill.aggregate({
        where: {
          vendorId: supplierId,
          userId: userId
        },
        _count: true,
        _sum: {
          totalAmount: true
        }
      })
    ]);

    totalProducts = products;
    totalPurchases = purchases._count;
    totalPurchaseValue = purchases._sum.grandTotal || 0;
    totalBills = bills._count;
    totalBillsAmount = bills._sum.totalAmount || 0;

    // Outstanding bills
    const outstanding = await prisma.bill.aggregate({
      where: {
        vendorId: supplierId,
        userId: userId,
        status: { not: 'Paid' }
      },
      _sum: {
        outstanding: true
      }
    });
    outstandingBills = outstanding._sum.outstanding || 0;
  }

  return {
    total,
    active,
    inactive,
    preferred,
    totalProducts,
    totalPurchases,
    totalPurchaseValue,
    totalBills,
    totalBillsAmount,
    outstandingBills
  };
};

// ============================================================
// @desc    Bulk create suppliers (User-specific)
// @route   POST /api/warehouse/supplier/bulk
// @access  Private
// ============================================================
const bulkCreateSuppliers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { suppliers } = req.body;

    if (!suppliers || !Array.isArray(suppliers) || suppliers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Suppliers array is required'
      });
    }

    // ✅ Add userId to each supplier
    const suppliersWithUser = suppliers.map((sup, index) => ({
      ...sup,
      code: sup.code || `SUP-${Date.now()}-${index}`,
      userId: userId, // 👈 CRITICAL
      createdBy: userId,
      status: sup.status || 'active'
    }));

    // ✅ Create all suppliers for this user
    const created = await prisma.supplier.createMany({
      data: suppliersWithUser,
      skipDuplicates: true
    });

    res.status(201).json({
      success: true,
      message: `${created.count} suppliers created successfully`,
      data: {
        count: created.count
      }
    });
  } catch (error) {
    console.error('Bulk create suppliers error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Toggle supplier status (User-specific)
// @route   PATCH /api/warehouse/supplier/:id/toggle-status
// @access  Private
// ============================================================
const toggleSupplierStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const supplierId = req.params.id;

    // ✅ Check if supplier exists AND belongs to this user
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        userId: userId
      }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    const newStatus = supplier.status === 'active' ? 'inactive' : 'active';

    const updated = await prisma.supplier.update({
      where: { id: supplierId },
      data: {
        status: newStatus,
        updatedBy: userId
      }
    });

    res.status(200).json({
      success: true,
      message: `Supplier ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully`,
      data: updated
    });
  } catch (error) {
    console.error('Toggle supplier status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

module.exports = {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  hardDeleteSupplier,
  searchSuppliers,
  getSupplierStats,
  bulkCreateSuppliers,
  toggleSupplierStatus
};