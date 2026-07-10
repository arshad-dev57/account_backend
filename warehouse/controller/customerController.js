const prisma = require('../../prisma/client');

const getCustomers = async (req, res) => {
  try {
    const {
      page = 1, limit = 10, search, type, status,
      fromDate, toDate, sortBy = 'createdAt', sortOrder = 'desc'
    } = req.query;

    const where = { isActive: true, isDeleted: false };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
        { customerNumber: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (type && type !== 'all') where.customerType = type;
    if (status && status !== 'all') where.status = status;
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { [sortBy]: sortOrder === 'desc' ? 'desc' : 'asc' }
      }),
      prisma.customer.count({ where })
    ]);

    const allActive = await prisma.customer.count({ where: { isActive: true, isDeleted: false } });
    const stats = { total: allActive };

    res.status(200).json({
      success: true,
      data: customers,
      stats,
      pagination: {
        page: pageNum, limit: limitNum, total,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch customers', error: error.message });
  }
};

const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const orders = await prisma.order.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, orderNumber: true, orderDate: true, grandTotal: true, orderStatus: true, paymentStatus: true }
    });

    res.status(200).json({ success: true, data: { ...customer, recentOrders: orders } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch customer', error: error.message });
  }
};

const getCustomerByNumber = async (req, res) => {
  try {
    const { customerNumber } = req.params;
    const customer = await prisma.customer.findUnique({ where: { customerNumber } });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.status(200).json({ success: true, data: customer });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch customer', error: error.message });
  }
};

const createCustomer = async (req, res) => {
  try {
    const {
      name, email, phone, company, customerType, taxId,
      address, shippingAddress, billingAddress, status,
      loyaltyPoints, notes, tags, preferences
    } = req.body;

    const userId = req.user.id;

    if (!name) return res.status(400).json({ success: false, message: 'Customer name is required' });

    if (email) {
      const existing = await prisma.customer.findUnique({ where: { email } });
      if (existing) return res.status(409).json({ success: false, message: 'Customer with this email already exists' });
    }

    if (phone) {
      const existing = await prisma.customer.findFirst({ where: { phone } });
      if (existing) return res.status(409).json({ success: false, message: 'Customer with this phone already exists' });
    }

    const count = await prisma.customer.count();
    const customerNumber = `CUST-${String(count + 1).padStart(5, '0')}`;

    const customer = await prisma.customer.create({
      data: {
        customerNumber,
        name, email, phone, company,
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
        createdBy: userId,
        userId
      }
    });

    res.status(201).json({ success: true, message: 'Customer created successfully', data: customer });
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ success: false, message: 'Failed to create customer', error: error.message });
  }
};

const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const {
      name, email, phone, company, customerType, taxId,
      address, shippingAddress, billingAddress, status,
      loyaltyPoints, notes, tags, preferences, totalOrders, totalSpent, lastOrderDate
    } = req.body;

    if (email && email !== customer.email) {
      const existing = await prisma.customer.findUnique({ where: { email } });
      if (existing && existing.id !== id) return res.status(409).json({ success: false, message: 'Email already exists' });
    }

    if (phone && phone !== customer.phone) {
      const existing = await prisma.customer.findFirst({ where: { phone } });
      if (existing && existing.id !== id) return res.status(409).json({ success: false, message: 'Phone already exists' });
    }

    const newTotalOrders = totalOrders !== undefined ? totalOrders : customer.totalOrders;
    const newTotalSpent = totalSpent !== undefined ? totalSpent : customer.totalSpent;

    const updated = await prisma.customer.update({
      where: { id },
      data: {
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
        totalOrders: newTotalOrders,
        totalSpent: newTotalSpent,
        averageOrderValue: newTotalOrders > 0 ? newTotalSpent / newTotalOrders : 0,
        lastOrderDate: lastOrderDate ? new Date(lastOrderDate) : customer.lastOrderDate,
        updatedBy: userId
      }
    });

    res.status(200).json({ success: true, message: 'Customer updated successfully', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update customer', error: error.message });
  }
};

const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const ordersCount = await prisma.order.count({ where: { customerId: id } });
    if (ordersCount > 0) return res.status(400).json({ success: false, message: 'Cannot delete customer with existing orders.' });

    await prisma.customer.update({
      where: { id },
      data: { isDeleted: true, isActive: false, updatedBy: userId }
    });

    res.status(200).json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete customer', error: error.message });
  }
};

const updateCustomerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    if (!status) return res.status(400).json({ success: false, message: 'Status is required' });

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const updated = await prisma.customer.update({
      where: { id },
      data: { status, updatedBy: userId }
    });

    res.status(200).json({ success: true, message: 'Status updated successfully', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update status', error: error.message });
  }
};

const getCustomerStats = async (req, res) => {
  try {
    const [total, active, inactive] = await Promise.all([
      prisma.customer.count({ where: { isDeleted: false } }),
      prisma.customer.count({ where: { isDeleted: false, status: 'Active' } }),
      prisma.customer.count({ where: { isDeleted: false, status: 'Inactive' } })
    ]);

    res.status(200).json({ success: true, data: { total, active, inactive } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch stats', error: error.message });
  }
};

const searchCustomers = async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    if (!q || q.length < 2) return res.status(200).json({ success: true, data: [], count: 0 });

    const customers = await prisma.customer.findMany({
      where: {
        isActive: true, isDeleted: false,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
          { customerNumber: { contains: q, mode: 'insensitive' } }
        ]
      },
      take: parseInt(limit)
    });

    res.status(200).json({ success: true, data: customers, count: customers.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to search customers', error: error.message });
  }
};

const getCustomerOrders = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        skip, take: limitNum,
        select: {
          id: true, orderNumber: true, orderDate: true,
          grandTotal: true, orderStatus: true, paymentStatus: true,
          items: { select: { productName: true, quantity: true, totalPrice: true } }
        }
      }),
      prisma.order.count({ where: { customerId: id } })
    ]);

    res.status(200).json({
      success: true, data: orders,
      pagination: {
        page: pageNum, limit: limitNum, total,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch orders', error: error.message });
  }
};

module.exports = {
  getCustomers, getCustomerById, getCustomerByNumber,
  createCustomer, updateCustomer, deleteCustomer,
  updateCustomerStatus, getCustomerStats, searchCustomers, getCustomerOrders
};