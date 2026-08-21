// warehouse/controller/supplier_controller.js - MULTI-TENANT VERSION

const prisma = require('../../prisma/client');

// ─── HELPERS ────────────────────────────────────────────────
const buildSupplierFilter = (companyId, search, status) => {
  const filter = {
    companyId: companyId // 👈 CRITICAL: Sirf current company ke suppliers
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
    const companyId = req.user.companyId; // 👈 Current company
    const { search, status, page = 1, limit = 20 } = req.query;

    const filter = buildSupplierFilter(companyId, search, status);

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
      getSupplierStatsInternal(companyId) // 👈 Company-specific stats
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
    const companyId = req.user.companyId;
    const supplierId = req.params.id;

    // ✅ Supplier must belong to current company
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        companyId: companyId // 👈 CRITICAL
      },
      include: {
        products: {
          where: {
            isActive: true,
            companyId: companyId // 👈 Company-specific
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
            companyId: companyId // 👈 Company-specific
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
            companyId: companyId // 👈 Company-specific
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
    const stats = await getSupplierStatsInternal(companyId, supplierId);

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
    const companyId = req.user.companyId; // 👈 Current company
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

    // ✅ Check duplicate name for this company
    const existingName = await prisma.supplier.findFirst({
      where: {
        name: name,
        companyId: companyId // 👈 Company-specific
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

    // ✅ Check duplicate code for this company
    const existingCode = await prisma.supplier.findFirst({
      where: {
        code: code,
        companyId: companyId // 👈 Company-specific
      }
    });

    if (existingCode) {
      return res.status(400).json({
        success: false,
        message: 'Supplier with this code already exists for your account'
      });
    }

    // ✅ Check duplicate email for this company
    if (email) {
      const existingEmail = await prisma.supplier.findFirst({
        where: {
          email: email,
          companyId: companyId // 👈 Company-specific
        }
      });

      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: 'Supplier with this email already exists for your account'
        });
      }
    }

    // ✅ Check duplicate phone for this company
    if (phone) {
      const existingPhone = await prisma.supplier.findFirst({
        where: {
          phone: phone,
          companyId: companyId // 👈 Company-specific
        }
      });

      if (existingPhone) {
        return res.status(400).json({
          success: false,
          message: 'Supplier with this phone already exists for your account'
        });
      }
    }

    // Build supplier data with companyId
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
      createdBy: req.user.id,
      companyId: companyId // 👈 CRITICAL: Link to current company
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
    const companyId = req.user.companyId;
    const supplierId = req.params.id;

    // ✅ Check if supplier exists AND belongs to this company
    const existing = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        companyId: companyId // 👈 CRITICAL
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    // ✅ Check duplicate name for this company (excluding current)
    if (req.body.name && req.body.name !== existing.name) {
      const duplicate = await prisma.supplier.findFirst({
        where: {
          name: req.body.name,
          companyId: companyId,
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

    // ✅ Check duplicate code for this company (excluding current)
    if (req.body.code && req.body.code !== existing.code) {
      const duplicate = await prisma.supplier.findFirst({
        where: {
          code: req.body.code,
          companyId: companyId,
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

    // ✅ Check duplicate email for this company (excluding current)
    if (req.body.email && req.body.email !== existing.email) {
      const duplicate = await prisma.supplier.findFirst({
        where: {
          email: req.body.email,
          companyId: companyId,
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

    // ✅ Check duplicate phone for this company (excluding current)
    if (req.body.phone && req.body.phone !== existing.phone) {
      const duplicate = await prisma.supplier.findFirst({
        where: {
          phone: req.body.phone,
          companyId: companyId,
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
// @desc    Delete supplier permanently (hard delete)
// @route   DELETE /api/warehouse/supplier/:id
// @access  Private
// ============================================================
const deleteSupplier = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const supplierId = String(req.params.id || '').trim();

    if (!supplierId || supplierId === 'undefined' || supplierId === 'null') {
      return res.status(400).json({
        success: false,
        message: 'Valid supplier id is required',
      });
    }

    const existing = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        companyId: companyId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    // Count required (blocking) links — these cannot be nullified
    const related = await prisma.supplier.findFirst({
      where: { id: supplierId },
      select: {
        _count: {
          select: {
            purchases: true,
            bills: true,
            purchaseOrders: true,
            goodsReceivings: true,
            purchaseInvoices: true,
            accountsPayable: true,
            paymentsMade: true,
            purchaseReturns: true,
            purchasePayments: true,
          },
        },
      },
    });

    const blocking = related?._count || {};
    const blockingParts = Object.entries(blocking)
      .filter(([, n]) => Number(n) > 0)
      .map(([key, n]) => `${key}: ${n}`);

    if (blockingParts.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete supplier — linked records exist (${blockingParts.join(', ')}). Remove those first.`,
        data: { supplierId, blocking },
      });
    }

    // Nullify optional FKs, then hard-delete supplier
    await prisma.$transaction(async (tx) => {
      await Promise.all([
        tx.product.updateMany({
          where: { supplierId },
          data: { supplierId: null },
        }),
        tx.stockMovement.updateMany({
          where: { supplierId },
          data: { supplierId: null },
        }),
        tx.expense.updateMany({
          where: { vendorId: supplierId },
          data: { vendorId: null },
        }),
        tx.fixedAsset.updateMany({
          where: { supplierId },
          data: { supplierId: null },
        }),
        tx.refund.updateMany({
          where: { supplierId },
          data: { supplierId: null },
        }),
        tx.return.updateMany({
          where: { supplierId },
          data: { supplierId: null },
        }),
        tx.loan.updateMany({
          where: { lenderId: supplierId },
          data: { lenderId: null },
        }),
        tx.transaction.updateMany({
          where: { vendorId: supplierId },
          data: { vendorId: null },
        }),
      ]);

      await tx.supplier.delete({ where: { id: supplierId } });
    });

    return res.status(200).json({
      success: true,
      message: 'Supplier deleted successfully',
    });
  } catch (error) {
    console.error('Delete supplier error:', error);
    if (error.code === 'P2003') {
      return res.status(409).json({
        success: false,
        message:
          'Cannot delete supplier — it still has linked purchase/accounting records. Remove those first.',
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: error.message,
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
    const companyId = req.user.companyId;
    const supplierId = req.params.id;

    // ✅ Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can hard delete suppliers'
      });
    }

    // ✅ Check if supplier exists AND belongs to this company
    const existing = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        companyId: companyId
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

    // ✅ Search only company's suppliers
    const where = {
      companyId: companyId, // 👈 CRITICAL
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
    const companyId = req.user.companyId;
    const stats = await getSupplierStatsInternal(companyId);

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
// @desc    Get supplier stats (Internal helper - Company-specific)
// ============================================================
const getSupplierStatsInternal = async (companyId, supplierId = null) => {
  const whereCondition = {
    companyId: companyId // 👈 Company-specific
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
          companyId: companyId,
          isActive: true
        }
      }),
      prisma.warehousePurchase.aggregate({
        where: {
          supplierId: supplierId,
          companyId: companyId
        },
        _count: true,
        _sum: {
          grandTotal: true
        }
      }),
      prisma.bill.aggregate({
        where: {
          vendorId: supplierId,
          companyId: companyId
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
        companyId: companyId,
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
    const companyId = req.user.companyId;
    const { suppliers } = req.body;

    if (!suppliers || !Array.isArray(suppliers) || suppliers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Suppliers array is required'
      });
    }

    // ✅ Add companyId to each supplier
    const suppliersWithCompany = suppliers.map((sup, index) => ({
      ...sup,
      code: sup.code || `SUP-${Date.now()}-${index}`,
      companyId: companyId, // 👈 CRITICAL
      createdBy: req.user.id,
      status: sup.status || 'active'
    }));

    // ✅ Create all suppliers for this company
    const created = await prisma.supplier.createMany({
      data: suppliersWithCompany,
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
    const companyId = req.user.companyId;
    const supplierId = req.params.id;

    // ✅ Check if supplier exists AND belongs to this company
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        companyId: companyId
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