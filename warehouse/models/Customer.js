// warehouse/models/customer.js - Prisma Version
const prisma = require('../../prisma/client');  // ✅ CORRECT PATH - 2 levels up
console.log('🔍 Prisma in customer model:', prisma ? '✅ Defined' : '❌ UNDEFINED');
console.log('🔍 Prisma methods:', Object.keys(prisma || {}));
// ─── Generate Customer Number Function ──────────────────────
function generateCustomerNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `CUST-${year}${month}${day}-${random}`;
}

class CustomerModel {
  // ============================================================
  // GET ALL CUSTOMERS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { createdAt: 'desc' } } = options;
    
    return await prisma.customer.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // COUNT CUSTOMERS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.customer.count({ where: filter });
  }

  // ============================================================
  // FIND CUSTOMER BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.customer.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // FIND CUSTOMER BY CUSTOMER NUMBER
  // ============================================================
  static async findByCustomerNumber(customerNumber) {
    return await prisma.customer.findUnique({
      where: { customerNumber },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // FIND CUSTOMER BY EMAIL
  // ============================================================
  static async findByEmail(email) {
    return await prisma.customer.findUnique({
      where: { email }
    });
  }

  // ============================================================
  // FIND CUSTOMER BY PHONE
  // ============================================================
  static async findByPhone(phone) {
    return await prisma.customer.findFirst({
      where: { phone }
    });
  }

  // ============================================================
  // CREATE CUSTOMER
  // ============================================================
  static async create(data) {
    // Generate customer number if not provided
    let customerNumber = data.customerNumber;
    if (!customerNumber) {
      let isUnique = false;
      let attempts = 0;
      
      while (!isUnique && attempts < 10) {
        customerNumber = generateCustomerNumber();
        const existing = await prisma.customer.findUnique({
          where: { customerNumber }
        });
        if (!existing) {
          isUnique = true;
        }
        attempts++;
      }
      
      if (!isUnique) {
        throw new Error('Failed to generate unique customer number');
      }
    }

    const customerData = {
      customerNumber,
      name: data.name,
      email: data.email,
      phone: data.phone,
      company: data.company,
      customerType: data.customerType || 'Individual',
      taxId: data.taxId,
      address: data.address || {},
      shippingAddress: data.shippingAddress || {},
      billingAddress: data.billingAddress || {},
      status: data.status || 'Active',
      loyaltyPoints: data.loyaltyPoints || 0,
      notes: data.notes || '',
      tags: data.tags || [],
      preferences: data.preferences || {},
      createdBy: data.createdBy,
      updatedBy: data.createdBy
    };

    return await prisma.customer.create({
      data: customerData,
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // UPDATE CUSTOMER
  // ============================================================
  static async update(id, data) {
    const updateData = { ...data, updatedBy: data.updatedBy };
    
    // Calculate average order value if totalOrders and totalSpent provided
    if (data.totalOrders !== undefined && data.totalSpent !== undefined) {
      updateData.averageOrderValue = data.totalOrders > 0 ? data.totalSpent / data.totalOrders : 0;
    }

    return await prisma.customer.update({
      where: { id },
      data: updateData,
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // SOFT DELETE CUSTOMER
  // ============================================================
  static async softDelete(id, userId) {
    return await prisma.customer.update({
      where: { id },
      data: {
        isActive: false,
        isDeleted: true,
        updatedBy: userId
      }
    });
  }

  // ============================================================
  // UPDATE CUSTOMER STATUS
  // ============================================================
  static async updateStatus(id, userId, status, notes = '') {
    const updateData = {
      status,
      updatedBy: userId
    };

    if (notes) {
      const customer = await prisma.customer.findUnique({ where: { id } });
      if (customer && customer.notes) {
        updateData.notes = `${customer.notes}\n\nStatus Change: ${status} - ${notes}`;
      } else {
        updateData.notes = `Status Change: ${status} - ${notes}`;
      }
    }

    return await prisma.customer.update({
      where: { id },
      data: updateData,
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // GET CUSTOMER STATS
  // ============================================================
  static async getStats(period = 'month') {
    const now = new Date();
    let dateFilter = {};

    if (period === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      dateFilter = { createdAt: { gte: start } };
    } else if (period === 'week') {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      dateFilter = { createdAt: { gte: start } };
    } else if (period === 'month') {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      dateFilter = { createdAt: { gte: start } };
    }

    const filter = { 
      isActive: true, 
      isDeleted: false,
      ...dateFilter 
    };

    // Get all stats
    const [total, active, inactive, blocked, pending] = await Promise.all([
      prisma.customer.count({ where: filter }),
      prisma.customer.count({ where: { ...filter, status: 'Active' } }),
      prisma.customer.count({ where: { ...filter, status: 'Inactive' } }),
      prisma.customer.count({ where: { ...filter, status: 'Blocked' } }),
      prisma.customer.count({ where: { ...filter, status: 'Pending' } })
    ]);

    // Get financial stats
    const financial = await prisma.customer.aggregate({
      where: filter,
      _sum: {
        totalSpent: true,
        totalOrders: true
      },
      _avg: {
        averageOrderValue: true
      }
    });

    return {
      total,
      active,
      inactive,
      blocked,
      pending,
      totalSpent: financial._sum.totalSpent || 0,
      totalOrders: financial._sum.totalOrders || 0,
      avgOrderValue: financial._avg.averageOrderValue || 0
    };
  }

  // ============================================================
  // GET CUSTOMER TYPE DISTRIBUTION
  // ============================================================
  static async getTypeDistribution() {
    const types = await prisma.customer.groupBy({
      by: ['customerType'],
      where: {
        isActive: true,
        isDeleted: false
      },
      _count: true,
      orderBy: {
        _count: {
          customerType: 'desc'
        }
      }
    });

    return types.map(item => ({
      type: item.customerType,
      count: item._count
    }));
  }

  // ============================================================
  // GET TOP CUSTOMERS
  // ============================================================
  static async getTopCustomers(limit = 10) {
    return await prisma.customer.findMany({
      where: {
        isActive: true,
        isDeleted: false
      },
      orderBy: {
        totalSpent: 'desc'
      },
      take: limit,
      select: {
        id: true,
        name: true,
        customerNumber: true,
        totalSpent: true,
        totalOrders: true,
        email: true,
        phone: true
      }
    });
  }

  // ============================================================
  // SEARCH CUSTOMERS
  // ============================================================
  static async search(query, limit = 10) {
    if (!query || query.length < 2) {
      return [];
    }

    return await prisma.customer.findMany({
      where: {
        isActive: true,
        isDeleted: false,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query, mode: 'insensitive' } },
          { company: { contains: query, mode: 'insensitive' } },
          { customerNumber: { contains: query, mode: 'insensitive' } }
        ]
      },
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        company: true,
        customerNumber: true,
        customerType: true,
        address: true
      }
    });
  }
}

module.exports = CustomerModel;