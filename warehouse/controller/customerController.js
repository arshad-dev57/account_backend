// warehouse/controller/customerController.js - Prisma Version
const Customer = require('../models/customer');
const Order = require('../models/Order');
const prisma = require('../../prisma/client');

const getCustomers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      type,
      status,
      fromDate,
      toDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = { isActive: true, isDeleted: false };

    // ─── Search ──────────────────────────────────────────────
    if (search) {
      filter.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
        { customerNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (type && type !== 'all') {
      filter.customerType = type;
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) {
        filter.createdAt.gte = new Date(fromDate);
      }
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.createdAt.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const orderBy = {};
    orderBy[sortBy] = sortOrder === 'desc' ? 'desc' : 'asc';

    // ─── Execute Query ─────────────────────────────────────
    const [customers, total] = await Promise.all([
      Customer.findAll(filter, {
        skip,
        take: limitNum,
        orderBy
      }),
      Customer.count(filter)
    ]);

    // ─── Get Stats ──────────────────────────────────────────
    const stats = await Customer.getStats();

    res.status(200).json({
      success: true,
      data: customers,
      stats,
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
    console.error('Get customers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customers',
      error: error.message
    });
  }
};

// ─────────────────────────────────────────────────────────────
// ─── Get Customer by ID ─────────────────────────────────────
// ─────────────────────────────────────────────────────────────
const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findById(id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // ─── Get recent orders ──────────────────────────────────
    const orders = await prisma.order.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        grandTotal: true,
        orderStatus: true,
        paymentStatus: true
      }
    });

    res.status(200).json({
      success: true,
      data: {
        ...customer,
        recentOrders: orders
      }
    });

  } catch (error) {
    console.error('Get customer by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer',
      error: error.message
    });
  }
};

// ─────────────────────────────────────────────────────────────
// ─── Get Customer by Customer Number ──────────────────────
// ─────────────────────────────────────────────────────────────
const getCustomerByNumber = async (req, res) => {
  try {
    const { customerNumber } = req.params;

    const customer = await Customer.findByCustomerNumber(customerNumber);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    res.status(200).json({
      success: true,
      data: customer
    });

  } catch (error) {
    console.error('Get customer by number error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer',
      error: error.message
    });
  }
};

// ─────────────────────────────────────────────────────────────
// ─── Create Customer ────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
const createCustomer = async (req, res) => {
  try {
    console.log('===== CREATE CUSTOMER =====');
    console.log('Body:', req.body);

    const {
      name,
      email,
      phone,
      company,
      customerType,
      taxId,
      address,
      shippingAddress,
      billingAddress,
      status,
      loyaltyPoints,
      notes,
      tags,
      preferences
    } = req.body;

    const userId = req.user.id;

    // ─── Validation ────────────────────────────────────────
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Customer name is required'
      });
    }

    // ─── Check for duplicate email ──────────────────────────
    if (email) {
      const existing = await Customer.findByEmail(email);
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Customer with this email already exists'
        });
      }
    }

    // ─── Check for duplicate phone ──────────────────────────
    if (phone) {
      const existing = await Customer.findByPhone(phone);
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Customer with this phone number already exists'
        });
      }
    }

    // ─── Create Customer ────────────────────────────────────
    const customer = await Customer.create({
      name,
      email,
      phone,
      company,
      customerType: customerType || 'Individual',
      taxId,
      address: address || {},
      shippingAddress: shippingAddress || {},
      billingAddress: billingAddress || {},
      status: status || 'Active',
      loyaltyPoints: loyaltyPoints || 0,
      notes: notes || '',
      tags: tags || [],
      preferences: preferences || {},
      createdBy: userId
    });

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: customer
    });

  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create customer',
      error: error.message
    });
  }
};

// ─────────────────────────────────────────────────────────────
// ─── Update Customer ────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      email,
      phone,
      company,
      customerType,
      taxId,
      address,
      shippingAddress,
      billingAddress,
      status,
      loyaltyPoints,
      notes,
      tags,
      preferences,
      totalOrders,
      totalSpent,
      lastOrderDate
    } = req.body;

    const userId = req.user.id;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // ─── Check for duplicate email ──────────────────────────
    if (email && email !== customer.email) {
      const existing = await Customer.findByEmail(email);
      if (existing && existing.id !== id) {
        return res.status(409).json({
          success: false,
          message: 'Customer with this email already exists'
        });
      }
    }

    // ─── Check for duplicate phone ──────────────────────────
    if (phone && phone !== customer.phone) {
      const existing = await Customer.findByPhone(phone);
      if (existing && existing.id !== id) {
        return res.status(409).json({
          success: false,
          message: 'Customer with this phone number already exists'
        });
      }
    }

    // ─── Build update data ──────────────────────────────────
    const updateData = {
      name: name || customer.name,
      email: email || customer.email,
      phone: phone || customer.phone,
      company: company || customer.company,
      customerType: customerType || customer.customerType,
      taxId: taxId || customer.taxId,
      address: address || customer.address,
      shippingAddress: shippingAddress || customer.shippingAddress,
      billingAddress: billingAddress || customer.billingAddress,
      status: status || customer.status,
      loyaltyPoints: loyaltyPoints !== undefined ? loyaltyPoints : customer.loyaltyPoints,
      notes: notes !== undefined ? notes : customer.notes,
      tags: tags || customer.tags,
      preferences: preferences || customer.preferences,
      totalOrders: totalOrders !== undefined ? totalOrders : customer.totalOrders,
      totalSpent: totalSpent !== undefined ? totalSpent : customer.totalSpent,
      lastOrderDate: lastOrderDate ? new Date(lastOrderDate) : customer.lastOrderDate,
      updatedBy: userId
    };

    // ─── Calculate average order value ──────────────────────
    if (updateData.totalOrders > 0) {
      updateData.averageOrderValue = updateData.totalSpent / updateData.totalOrders;
    }

    const updated = await Customer.update(id, updateData);

    res.status(200).json({
      success: true,
      message: 'Customer updated successfully',
      data: updated
    });

  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update customer',
      error: error.message
    });
  }
};

// ─────────────────────────────────────────────────────────────
// ─── Delete Customer (Soft Delete) ──────────────────────────
// ─────────────────────────────────────────────────────────────
const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // ─── Check if customer has orders ──────────────────────
    const ordersCount = await prisma.order.count({
      where: { customerId: id }
    });

    if (ordersCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete customer with existing orders. Please archive instead.'
      });
    }

    await Customer.softDelete(id, userId);

    res.status(200).json({
      success: true,
      message: 'Customer deleted successfully'
    });

  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete customer',
      error: error.message
    });
  }
};

// ─────────────────────────────────────────────────────────────
// ─── Update Customer Status ─────────────────────────────────
// ─────────────────────────────────────────────────────────────
const updateCustomerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const userId = req.user.id;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const updated = await Customer.updateStatus(id, userId, status, reason || '');

    res.status(200).json({
      success: true,
      message: 'Customer status updated successfully',
      data: updated
    });

  } catch (error) {
    console.error('Update customer status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update customer status',
      error: error.message
    });
  }
};

// ─────────────────────────────────────────────────────────────
// ─── Get Customer Stats ─────────────────────────────────────
// ─────────────────────────────────────────────────────────────
const getCustomerStats = async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    const stats = await Customer.getStats(period);
    const typeDistribution = await Customer.getTypeDistribution();
    const topCustomers = await Customer.getTopCustomers(10);

    res.status(200).json({
      success: true,
      data: {
        ...stats,
        typeDistribution,
        topCustomers
      }
    });

  } catch (error) {
    console.error('Get customer stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer stats',
      error: error.message
    });
  }
};

const searchCustomers = async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return res.status(200).json({
        success: true,
        data: [],
        count: 0
      });
    }

    const customers = await Customer.search(q, parseInt(limit));

    res.status(200).json({
      success: true,
      data: customers,
      count: customers.length
    });

  } catch (error) {
    console.error('Search customers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search customers',
      error: error.message
    });
  }
};

const getCustomerOrders = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        select: {
          id: true,
          orderNumber: true,
          orderDate: true,
          grandTotal: true,
          orderStatus: true,
          paymentStatus: true,
          items: {
            select: {
              productName: true,
              quantity: true,
              totalPrice: true
            }
          }
        }
      }),
      prisma.order.count({ where: { customerId: id } })
    ]);

    res.status(200).json({
      success: true,
      data: orders,
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
    console.error('Get customer orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer orders',
      error: error.message
    });
  }
};

module.exports = {
  getCustomers,
  getCustomerById,
  getCustomerByNumber,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  updateCustomerStatus,
  getCustomerStats,
  searchCustomers,
  getCustomerOrders
};