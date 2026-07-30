// controllers/accountsReceivableController.js - COMPLETE FIXED VERSION

const prisma = require('../prisma/client');
const WarehouseInvoiceModel = require('../models/WarehouseInvoice');
const { get, set, del, delPattern } = require('../utils/redisClient');

// ─── HELPER: Get or create Accounts Receivable account ──────────
async function getOrCreateReceivableAccount(userId, companyId) {
  console.log('🔍 [AR] Getting/Creating Accounts Receivable account');
  let arAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '1110',
      
      companyId: companyId
    }
  });

  if (!arAccount) {
    console.log('📝 [AR] Creating new Accounts Receivable account');
    arAccount = await prisma.chartOfAccount.create({
      data: {
        code: '1110',
        name: 'Accounts Receivable',
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Amount due from customers',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId
      }
    });
    console.log('✅ [AR] Accounts Receivable account created');
  } else {
    console.log('✅ [AR] Accounts Receivable account found');
  }
  return arAccount;
}

// ─── HELPER: Get or create Cash account ──────────────────────────
async function getOrCreateCashAccount(userId, companyId) {
  console.log('🔍 [AR] Getting/Creating Cash account');
  let cashAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '1010',
      
      companyId: companyId
    }
  });

  if (!cashAccount) {
    console.log('📝 [AR] Creating new Cash account');
    cashAccount = await prisma.chartOfAccount.create({
      data: {
        code: '1010',
        name: 'Cash in Hand',
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Physical cash in office',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId,
        companyId: companyId
      }
    });
    console.log('✅ [AR] Cash account created');
  } else {
    console.log('✅ [AR] Cash account found');
  }
  return cashAccount;
}

// ─── HELPER: Get or create Revenue account ──────────────────────
async function getOrCreateRevenueAccount(userId) {
  console.log('🔍 [AR] Getting/Creating Revenue account');
  let revenueAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '4010',
      companyId: companyId}
  });

  if (!revenueAccount) {
    console.log('📝 [AR] Creating new Revenue account');
    revenueAccount = await prisma.chartOfAccount.create({
      data: {
        code: '4010',
        name: 'Sales Revenue',
        type: 'Revenue',
        parentAccount: 'Operating Income',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Revenue from sales',
        taxCode: 'GST-13%',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId
      }
    });
    console.log('✅ [AR] Revenue account created');
  } else {
    console.log('✅ [AR] Revenue account found');
  }
  return revenueAccount;
}

// ─── ✅ NEW: Get or create Tax Liability account ──────────────────
async function getOrCreateTaxLiabilityAccount(userId) {
  console.log('🔍 [AR] Getting/Creating Tax Liability account');
  let taxAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '2220',
      companyId: companyId}
  });

  if (!taxAccount) {
    console.log('📝 [AR] Creating new Sales Tax Payable account');
    taxAccount = await prisma.chartOfAccount.create({
      data: {
        code: '2220',
        name: 'Sales Tax Payable',
        type: 'Liability',
        parentAccount: 'Current Liabilities',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Sales tax collected from customers',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId
      }
    });
    console.log('✅ [AR] Tax Liability account created');
  } else {
    console.log('✅ [AR] Tax Liability account found');
  }
  return taxAccount;
}

// ─── HELPER: Generate invoice number ────────────────────────────
async function generateInvoiceNumber(userId) {
  const count = await prisma.warehouseInvoice.count({
    where: { companyId: companyId}
  });
  const year = new Date().getFullYear();
  const invoiceNumber = `INV-${year}-${String(count + 1).padStart(4, '0')}`;
  console.log(`📝 [AR] Generated invoice number: ${invoiceNumber}`);
  return invoiceNumber;
}

// ─── HELPER: Validate Warehouse Customer ──────────────────────────
async function validateWarehouseCustomer(customerId, userId) {
  console.log(`🔍 [AR] Validating warehouse customer: ${customerId}`);
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      companyId: companyId,
      isActive: true
    }
  });
  
  if (!customer) {
    console.log('❌ [AR] Customer not found in warehouse');
    throw new Error('Customer not found. Please add customer from warehouse first.');
  }
  console.log(`✅ [AR] Customer validated: ${customer.name}`);
  return customer;
}

// ─── HELPER: Validate Bank Account ──────────────────────────────
async function validateBankAccount(bankAccountId, userId) {
  console.log(`🔍 [AR] Validating bank account: ${bankAccountId}`);
  if (!bankAccountId) return null;
  
  const bankAccount = await prisma.bankAccount.findFirst({
    where: {
      id: bankAccountId,
      companyId: companyId,
      status: 'Active'
    },
    include: {
      chartOfAccount: true
    }
  });
  
  if (!bankAccount) {
    console.log('❌ [AR] Bank account not found');
    throw new Error('Bank account not found or does not belong to you');
  }
  console.log(`✅ [AR] Bank account validated: ${bankAccount.accountName}`);
  return bankAccount;
}

// ─── HELPER: Validate Warehouse Invoice ──────────────────────────
async function validateWarehouseInvoice(invoiceId, userId) {
  console.log(`🔍 [AR] Validating warehouse invoice: ${invoiceId}`);
  if (!invoiceId) return null;
  
  const invoice = await prisma.warehouseInvoice.findFirst({
    where: {
      id: invoiceId,
      companyId: companyId,
      invoiceStatus: { not: 'Paid' }
    }
  });
  
  if (!invoice) {
    console.log('❌ [AR] Invoice not found or already paid');
    throw new Error('Invoice not found or already paid');
  }
  console.log(`✅ [AR] Invoice validated: ${invoice.invoiceNumber}`);
  return invoice;
}

// ============================================================
// CUSTOMER CRUD (Using Warehouse Customer)
// ============================================================

const createCustomer = async (req, res) => {
  console.log('📦 [AR] createCustomer called');
  console.log('🔍 [AR] Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const {
      customerNumber,
      name,
      email,
      phone,
      company,
      customerType,
      taxId,
      address,
      shippingAddress,
      billingAddress,
      notes,
    } = req.body;

    const userId = req.user.id;
    const companyId = req.user.companyId;
    console.log('👤 [AR] User ID:', userId);

    let finalCustomerNumber = customerNumber;
    if (!finalCustomerNumber) {
      const count = await prisma.customer.count({
        where: { companyId: companyId}
      });
      finalCustomerNumber = `CUST-${String(count + 1).padStart(4, '0')}`;
      console.log(`📝 [AR] Generated customer number: ${finalCustomerNumber}`);
    }

    const customer = await prisma.customer.create({
      data: {
        customerNumber: finalCustomerNumber,
        name,
        email,
        phone,
        company,
        customerType: customerType || 'Individual',
        taxId,
        address: address || {},
        shippingAddress: shippingAddress || {},
        billingAddress: billingAddress || {},
        notes,
        status: 'Active',
        isActive: true,
        createdBy: userId
      },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    console.log(`✅ [AR] Customer created: ${customer.name}`);

    // Invalidate cache after successful customer creation
    try {
      await delPattern(`ar:customers:${userId}:*`);
      console.log('🗑️ [AR] Cache invalidated after customer creation');
    } catch (cacheError) {
      console.log('⚠️ [AR] Cache invalidation error:', cacheError.message);
    }

    res.status(201).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    console.error('❌ [AR] Create customer error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getCustomers = async (req, res) => {
  console.log('📦 [AR] getCustomers called');
  
  try {
    const { search, status, refresh } = req.query;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    // Build cache key with parameters
    const cacheKey = `ar:customers:${userId}:${search || ''}:${status || ''}`;
    
    // Try to get from cache (unless refresh is requested)
    if (refresh !== 'true') {
      const cached = await get(cacheKey);
      if (cached) {
        console.log('📦 [AR] Returning cached customers data');
        return res.status(200).json({
          success: true,
          count: cached.length,
          data: cached,
          cached: true,
        });
      }
    } else {
      console.log('🔄 [AR] Cache refresh requested, bypassing cache');
      // Clear the cache
      try {
        await delPattern(`ar:customers:${userId}:*`);
        console.log('🗑️ [AR] Cache cleared for refresh');
      } catch (cacheError) {
        console.log('⚠️ [AR] Cache clear error:', cacheError.message);
      }
    }

    const filter = { companyId: companyId };

    if (search) {
      filter.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status === 'active') {
      filter.isActive = true;
    } else if (status === 'inactive') {
      filter.isActive = false;
    }

    const customers = await prisma.customer.findMany({
      where: filter,
      orderBy: { name: 'asc' },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    const invoices = await prisma.warehouseInvoice.findMany({
      where: {
        companyId: companyId,
        invoiceStatus: { not: 'Paid' }
      }
    });

    const customersWithOutstanding = customers.map(customer => {
      const customerInvoices = invoices.filter(
        inv => inv.customerId === customer.id
      );
      const totalAmount = customerInvoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
      const paidAmount = customerInvoices.reduce((sum, inv) => sum + inv.paidAmount, 0);
      const outstandingAmount = totalAmount - paidAmount;

      return {
        ...customer,
        totalAmount,
        paidAmount,
        outstandingAmount,
        invoiceCount: customerInvoices.length,
      };
    });

    // Cache the result (10 minutes TTL)
    await set(cacheKey, customersWithOutstanding, 600);

    res.status(200).json({
      success: true,
      count: customersWithOutstanding.length,
      data: customersWithOutstanding,
      cached: false,
    });
  } catch (error) {
    console.error('❌ [AR] Get customers error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getCustomer = async (req, res) => {
  console.log('📦 [AR] getCustomer called');
  
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    // Build cache key
    const cacheKey = `ar:customer:${userId}:${id}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const customer = await prisma.customer.findFirst({
      where: {
        id,
        companyId: companyId},
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    const invoices = await prisma.warehouseInvoice.findMany({
      where: {
        customerId: customer.id,
        companyId: companyId},
      orderBy: { invoiceDate: 'desc' }
    });

    const totalAmount = invoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
    const paidAmount = invoices.reduce((sum, inv) => sum + inv.paidAmount, 0);
    const outstandingAmount = totalAmount - paidAmount;

    const customerData = {
      ...customer,
      invoices,
      totalAmount,
      paidAmount,
      outstandingAmount,
    };

    // Cache the result (10 minutes TTL)
    await set(cacheKey, customerData, 600);

    res.status(200).json({
      success: true,
      data: customerData,
      cached: false,
    });
  } catch (error) {
    console.error('❌ [AR] Get customer error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const {
      customerNumber,
      name,
      email,
      phone,
      company,
      customerType,
      taxId,
      address,
      shippingAddress,
      billingAddress,
      notes,
      status,
      isActive,
    } = req.body;

    const existing = await prisma.customer.findFirst({
      where: {
        id,
        companyId: companyId}
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        customerNumber: customerNumber || existing.customerNumber,
        name: name || existing.name,
        email: email !== undefined ? email : existing.email,
        phone: phone !== undefined ? phone : existing.phone,
        company: company !== undefined ? company : existing.company,
        customerType: customerType || existing.customerType,
        taxId: taxId !== undefined ? taxId : existing.taxId,
        address: address !== undefined ? address : existing.address,
        shippingAddress: shippingAddress !== undefined ? shippingAddress : existing.shippingAddress,
        billingAddress: billingAddress !== undefined ? billingAddress : existing.billingAddress,
        notes: notes !== undefined ? notes : existing.notes,
        status: status || existing.status,
        isActive: isActive !== undefined ? isActive : existing.isActive,
      },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    // Invalidate cache after successful customer update
    try {
      await delPattern(`ar:customers:${userId}:*`);
      await delPattern(`ar:customer:${userId}:${id}`);
      console.log('🗑️ [AR] Cache invalidated after customer update');
    } catch (cacheError) {
      console.log('⚠️ [AR] Cache invalidation error:', cacheError.message);
    }

    res.status(200).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    console.error('❌ [AR] Update customer error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const hasInvoices = await prisma.warehouseInvoice.findFirst({
      where: {
        customerId: id,
        companyId: companyId}
    });

    if (hasInvoices) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete customer with existing invoices',
      });
    }

    const customer = await prisma.customer.deleteMany({
      where: {
        id,
        companyId: companyId}
    });

    if (customer.count === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    // Invalidate cache after successful customer deletion
    try {
      await delPattern(`ar:customers:${userId}:*`);
      await delPattern(`ar:customer:${userId}:${id}`);
      console.log('🗑️ [AR] Cache invalidated after customer deletion');
    } catch (cacheError) {
      console.log('⚠️ [AR] Cache invalidation error:', cacheError.message);
    }

    res.status(200).json({
      success: true,
      message: 'Customer deleted successfully',
    });
  } catch (error) {
    console.error('❌ [AR] Delete customer error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// ✅ INVOICE CRUD - UPDATED with Tax Liability
// ============================================================

const createInvoice = async (req, res) => {
  console.log('📦 [AR] createInvoice called');
  
  try {
    const {
      customerId,
      date,
      dueDate,
      items,
      discount,
      notes,
    } = req.body;

    const userId = req.user.id;

    const companyId = req.user.companyId;
    // Validate warehouse customer
    const customer = await validateWarehouseCustomer(customerId, userId);

    // Calculate totals
    let subtotal = 0;
    let taxTotal = 0;

    const processedItems = items.map(item => {
      const amount = item.quantity * item.unitPrice;
      const taxAmount = amount * (item.taxRate / 100);
      subtotal += amount;
      taxTotal += taxAmount;

      return {
        ...item,
        amount,
        taxAmount,
      };
    });

    const totalAmount = subtotal + taxTotal - (discount || 0);

    // Create invoice
    const invoice = await WarehouseInvoiceModel.create({
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email || '',
      customerPhone: customer.phone || '',
      billingAddress: customer.billingAddress || {},
      invoiceDate: date ? new Date(date) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      subtotal,
      taxTotal,
      discountTotal: discount || 0,
      grandTotal: totalAmount,
      items: processedItems,
      notes: notes || '',
      createdBy: userId,
    });

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      data: invoice,
    });

    // Invalidate cache after successful invoice creation
    try {
      await delPattern(`ar:invoices:${userId}:*`);
      await delPattern(`ar:summary:${userId}:*`);
      await delPattern(`ar:aged:${userId}:*`);
      await delPattern(`ar:customer:${userId}:${customerId}:unpaid-invoices`);
      await delPattern(`ar:customer:${userId}:${customerId}`);
      console.log('🗑️ [AR] Cache invalidated after invoice creation');
    } catch (cacheError) {
      console.log('⚠️ [AR] Cache invalidation error:', cacheError.message);
    }
  } catch (error) {
    console.error('❌ [AR] Create invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getInvoices = async (req, res) => {
  console.log('📦 [AR] getInvoices called');
  
  try {
    const { customerId, status, startDate, endDate, fiscalYearId } = req.query;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    // Build cache key with parameters
    const cacheKey = `ar:invoices:${userId}:${customerId || ''}:${status || ''}:${startDate || ''}:${endDate || ''}:${fiscalYearId || ''}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        count: cached.length,
        data: cached,
        cached: true,
      });
    }

    const filter = { companyId: companyId };

    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          companyId: companyId}
      });
      if (customer) {
        filter.customerId = customerId;
      }
    }

    if (status) {
      filter.invoiceStatus = status;
    }
    
    if (startDate && endDate) {
      filter.invoiceDate = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    if (fiscalYearId) {
      filter.fiscalYearId = fiscalYearId;
    }

    const invoices = await prisma.warehouseInvoice.findMany({
      where: filter,
      orderBy: { invoiceDate: 'desc' },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    // Cache the result (5 minutes TTL)
    await set(cacheKey, invoices, 300);

    res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices,
      cached: false,
    });
  } catch (error) {
    console.error('❌ [AR] Get invoices error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getInvoice = async (req, res) => {
  console.log('📦 [AR] getInvoice called');
  
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    // Build cache key
    const cacheKey = `ar:invoice:${userId}:${id}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const invoice = await prisma.warehouseInvoice.findFirst({
      where: {
        id,
        companyId: companyId},
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            address: true
          }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }

    // Cache the result (10 minutes TTL)
    await set(cacheKey, invoice, 600);

    res.status(200).json({
      success: true,
      data: invoice,
      cached: false,
    });
  } catch (error) {
    console.error('❌ [AR] Get invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// ✅ CANCEL INVOICE - NEW FUNCTION
// ============================================================

const cancelInvoice = async (req, res) => {
  console.log('📦 [AR] cancelInvoice called');
  
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const invoice = await prisma.warehouseInvoice.findFirst({
      where: {
        id,
        companyId: companyId}
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    if (invoice.invoiceStatus === 'Paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a paid invoice'
      });
    }

    if (invoice.invoiceStatus === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Invoice already cancelled'
      });
    }

    const cancelled = await WarehouseInvoiceModel.cancelInvoice(id, userId);

    res.status(200).json({
      success: true,
      message: 'Invoice cancelled successfully',
      data: cancelled
    });
  } catch (error) {
    console.error('❌ [AR] Cancel invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// PAYMENT RECORDING
// ============================================================

const getUnpaidInvoices = async (req, res) => {
  console.log('🔍 [AR] getUnpaidInvoices called');
  console.log('🔍 [AR] customerId:', req.params.customerId);
  console.log('🔍 [AR] userId:', req.user.id);
  
  try {
    const { customerId } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    // Build cache key
    const cacheKey = `ar:customer:${userId}:${customerId}:unpaid-invoices`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        count: cached.length,
        data: cached,
        cached: true,
      });
    }
    
    // ─── Step 1: Check customer ──────────────────────────────
    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        companyId: companyId}
    });
    
    if (!customer) {
      console.log('❌ [AR] Customer not found');
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }
    
    console.log(`✅ [AR] Customer found: ${customer.name}`);
    
    // ─── Step 2: ✅ CHECK ALL INVOICES FIRST (for debugging) ──
    const allInvoices = await prisma.warehouseInvoice.findMany({
      where: {
        customerId: customerId,
        companyId: companyId,
      }
    });
    
    console.log(`📊 [AR] Total invoices for customer: ${allInvoices.length}`);
    console.log('📊 [AR] Invoice statuses:', allInvoices.map(i => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      invoiceStatus: i.invoiceStatus,
      isActive: i.isActive,
      isDeleted: i.isDeleted,
      grandTotal: i.grandTotal,
      paidAmount: i.paidAmount
    })));
    
    // ─── Step 3: Get UNPAID invoices ──────────────────────────
    const unpaidInvoices = await prisma.warehouseInvoice.findMany({
      where: {
        customerId: customerId,
        companyId: companyId,
        // ✅ FIX: Include Active status (not just Unpaid)
        invoiceStatus: { in: ['Active', 'Unpaid', 'Partial'] },
        isActive: true,
        isDeleted: false,
      },
      orderBy: { dueDate: 'asc' }
    });
    
    console.log(`📊 [AR] Unpaid invoices found: ${unpaidInvoices.length}`);
    
    const result = unpaidInvoices.map(invoice => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      totalAmount: parseFloat(invoice.grandTotal),
      paidAmount: parseFloat(invoice.paidAmount || 0),
      outstanding: parseFloat(invoice.grandTotal - invoice.paidAmount),
      status: invoice.invoiceStatus,
    }));

    // Cache the result (5 minutes TTL)
    await set(cacheKey, result, 300);
    
    res.status(200).json({
      success: true,
      count: result.length,
      data: result,
      cached: false,
    });
  } catch (error) {
    console.error('❌ [AR] getUnpaidInvoices error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ─── HELPER: Generate next payment number ───────────────────────
async function generatePaymentNumber(userId, tx) {
  const year = new Date().getFullYear();
  const prefix = `PMT-${year}-`;

  const lastPayment = await tx.paymentReceived.findFirst({
    where: { companyId: companyId, paymentNumber: { startsWith: prefix } },
    orderBy: { paymentNumber: 'desc' }
  });

  if (!lastPayment) return `${prefix}0001`;

  const parts = lastPayment.paymentNumber.split('-');
  const lastNum = parseInt(parts[parts.length - 1]) || 0;
  return `${prefix}${String(lastNum + 1).padStart(4, '0')}`;
}

const recordPayment = async (req, res) => {
  console.log('📦 [AR] recordPayment called');

  try {
    const {
      invoiceId,
      amount,
      paymentDate,
      paymentMethod,
      reference,
      bankAccountId,
      notes,
    } = req.body;

    const userId = req.user.id;

    const companyId = req.user.companyId;
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be greater than zero'
      });
    }

    const MAX_RETRIES = 5;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          // Validate warehouse invoice (inside tx for consistency)
          const invoice = await tx.warehouseInvoice.findFirst({
            where: { id: invoiceId, companyId: companyId, invoiceStatus: { not: 'Paid' } }
          });
          if (!invoice) {
            const err = new Error('Invoice not found or already paid');
            err.statusCode = 404;
            throw err;
          }
          console.log(`✅ [AR] Invoice validated: ${invoice.invoiceNumber}`);

          const outstanding = invoice.grandTotal - invoice.paidAmount;
          if (amount > outstanding) {
            const err = new Error(`Payment amount cannot exceed outstanding balance of ${outstanding}`);
            err.statusCode = 400;
            throw err;
          }

          // Update invoice paid amount
          const newPaidAmount = invoice.paidAmount + amount;
          const newOutstanding = invoice.grandTotal - newPaidAmount;
          const newStatus = newOutstanding <= 0 ? 'Paid' : 'Partial';

          const updatedInvoice = await tx.warehouseInvoice.update({
            where: { id: invoiceId },
            data: {
              paidAmount: newPaidAmount,
              invoiceStatus: newStatus,
              paymentStatus: newOutstanding <= 0 ? 'Paid' : 'Partial'
            }
          });

          // Get/create accounts
          let arAccount = await tx.chartOfAccount.findFirst({ where: { code: '1110', companyId: companyId} });
          if (!arAccount) {
            arAccount = await tx.chartOfAccount.create({
              data: {
                code: '1110', name: 'Accounts Receivable', type: 'Asset',
                parentAccount: 'Current Assets', openingBalance: 0, currentBalance: 0,
                description: 'Amount due from customers', taxCode: 'N/A',
                balanceType: 'Debit', isActive: true, createdBy: userId
              }
            });
          }

          let cashAccount = await tx.chartOfAccount.findFirst({ where: { code: '1010', companyId: companyId} });
          if (!cashAccount) {
            cashAccount = await tx.chartOfAccount.create({
              data: {
                code: '1010', name: 'Cash in Hand', type: 'Asset',
                parentAccount: 'Current Assets', openingBalance: 0, currentBalance: 0,
                description: 'Physical cash in office', taxCode: 'N/A',
                balanceType: 'Debit', isActive: true, createdBy: userId
              }
            });
          }

          let bankAccount = null;
          let debitAccount = cashAccount;

          if (bankAccountId) {
            bankAccount = await tx.bankAccount.findFirst({
              where: { id: bankAccountId, companyId: companyId, status: 'Active' },
              include: { chartOfAccount: true }
            });
            if (!bankAccount) {
              const err = new Error('Bank account not found or does not belong to you');
              err.statusCode = 404;
              throw err;
            }
            if (bankAccount.chartOfAccount) debitAccount = bankAccount.chartOfAccount;
          }

          // ✅ THE MISSING PIECE: create the PaymentReceived record
          const paymentNumber = await generatePaymentNumber(userId, tx);

          const payment = await tx.paymentReceived.create({
            data: {
              paymentNumber,
              paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
              customerId: invoice.customerId,
              customerName: invoice.customerName || '',
              invoiceId: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              invoiceAmount: invoice.grandTotal,
              amount,
              paymentMethod: paymentMethod || 'Cash',
              reference: reference || '',
              bankAccountId: bankAccountId || null,
              bankAccountName: bankAccount ? bankAccount.accountName : (paymentMethod === 'Cash' ? 'Cash in Hand' : ''),
              notes: notes || '',
              status: paymentMethod === 'Cheque' ? 'Pending' : 'Cleared',
              clearedDate: paymentMethod === 'Cheque' ? null : new Date(),
              createdBy: userId,
            }
          });
          console.log('✅ [AR] Payment record created:', payment.paymentNumber);

          // Create journal entry
          await tx.journalEntry.create({
            data: {
              entryNumber: `JE-${Date.now()}`,
              date: paymentDate ? new Date(paymentDate) : new Date(),
              description: `Payment received for ${invoice.invoiceNumber}`,
              reference: reference || payment.paymentNumber,
              status: 'Posted',
              createdBy: userId,
              postedBy: userId,
              postedAt: new Date(),
              lines: {
                create: [
                  {
                    accountId: debitAccount.id,
                    accountName: debitAccount.name,
                    accountCode: debitAccount.code,
                    debit: amount,
                    credit: 0,
                    isReconciled: false
                  },
                  {
                    accountId: arAccount.id,
                    accountName: arAccount.name,
                    accountCode: arAccount.code,
                    debit: 0,
                    credit: amount,
                    isReconciled: false
                  }
                ]
              }
            }
          });

          // Update AR account balance (decrease)
          await tx.chartOfAccount.update({
            where: { id: arAccount.id },
            data: { currentBalance: { decrement: amount } }
          });

          // Update bank/cash balance
          if (bankAccount) {
            const newBankBalance = bankAccount.currentBalance + amount;
            await tx.bankAccount.update({
              where: { id: bankAccountId },
              data: { currentBalance: newBankBalance }
            });
            if (bankAccount.chartOfAccountId) {
              await tx.chartOfAccount.update({
                where: { id: bankAccount.chartOfAccountId },
                data: { currentBalance: newBankBalance }
              });
            }
          } else {
            await tx.chartOfAccount.update({
              where: { id: cashAccount.id },
              data: { currentBalance: { increment: amount } }
            });
          }

          return { payment, updatedInvoice };
        });

        return res.status(200).json({
          success: true,
          data: {
            invoice: {
              id: result.updatedInvoice.id,
              invoiceNumber: result.updatedInvoice.invoiceNumber,
              paidAmount: result.updatedInvoice.paidAmount,
              outstanding: result.updatedInvoice.grandTotal - result.updatedInvoice.paidAmount,
              status: result.updatedInvoice.invoiceStatus,
            },
            payment: result.payment,
          },
        });

      } catch (error) {
        lastError = error;
        if (error.code === 'P2002' && attempt < MAX_RETRIES) {
          console.warn(`⚠️ [AR] paymentNumber collision, retrying (attempt ${attempt}/${MAX_RETRIES})`);
          continue;
        }
        break;
      }
    }

    // Invalidate cache after successful payment recording
    try {
      await delPattern(`ar:invoices:${userId}:*`);
      await delPattern(`ar:invoice:${userId}:${invoiceId}`);
      await delPattern(`ar:summary:${userId}:*`);
      await delPattern(`ar:aged:${userId}:*`);
      await delPattern(`ar:customers:${userId}:*`);
      console.log('🗑️ [AR] Cache invalidated after payment recording');
    } catch (cacheError) {
      console.log('⚠️ [AR] Cache invalidation error:', cacheError.message);
    }

    const statusCode = lastError && lastError.statusCode ? lastError.statusCode : 500;
    return res.status(statusCode).json({
      success: false,
      message: lastError ? lastError.message : 'Failed to record payment'
    });

  } catch (error) {
    console.error('❌ [AR] Record payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// ACCOUNTS RECEIVABLE SUMMARY
// ============================================================

const getSummary = async (req, res) => {
  console.log('📦 [AR] getSummary called');
  
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { fiscalYearId } = req.query;

    // Build cache key with parameters
    const cacheKey = `ar:summary:${userId}:${fiscalYearId || ''}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const filter = {
      companyId: companyId,
      invoiceStatus: { not: 'Paid' }
    };

    if (fiscalYearId) {
      filter.fiscalYearId = fiscalYearId;
    }

    const invoices = await prisma.warehouseInvoice.findMany({
      where: filter
    });

    const totalOutstanding = invoices.reduce(
      (sum, inv) => sum + (inv.grandTotal - inv.paidAmount),
      0
    );

    const now = new Date();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const overdue = invoices
      .filter(inv => inv.dueDate < now && inv.invoiceStatus !== 'Paid')
      .reduce((sum, inv) => sum + (inv.grandTotal - inv.paidAmount), 0);

    const dueThisWeek = invoices
      .filter(inv => inv.dueDate >= now && inv.dueDate <= endOfWeek && inv.invoiceStatus !== 'Paid')
      .reduce((sum, inv) => sum + (inv.grandTotal - inv.paidAmount), 0);

    const dueThisMonth = invoices
      .filter(inv => inv.dueDate >= now && inv.dueDate <= endOfMonth && inv.invoiceStatus !== 'Paid')
      .reduce((sum, inv) => sum + (inv.grandTotal - inv.paidAmount), 0);

    const activeCustomers = await prisma.customer.count({
      where: {
        companyId: companyId,
        isActive: true
      }
    });

    const summaryData = {
      totalOutstanding,
      overdue,
      dueThisWeek,
      dueThisMonth,
      activeCustomers,
    };

    // Cache the result (2 minutes TTL)
    await set(cacheKey, summaryData, 120);

    res.status(200).json({
      success: true,
      data: summaryData,
      cached: false,
    });
  } catch (error) {
    console.error('❌ [AR] Get AR summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getAgedReceivables = async (req, res) => {
  console.log('📦 [AR] getAgedReceivables called');
  
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { fiscalYearId } = req.query;

    // Build cache key with parameters
    const cacheKey = `ar:aged:${userId}:${fiscalYearId || ''}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const filter = {
      companyId: companyId,
      invoiceStatus: { not: 'Paid' }
    };

    if (fiscalYearId) {
      filter.fiscalYearId = fiscalYearId;
    }

    const invoices = await prisma.warehouseInvoice.findMany({
      where: filter,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        }
      }
    });

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const customerMap = new Map();

    for (const invoice of invoices) {
      const outstanding = invoice.grandTotal - (invoice.paidAmount || 0);
      if (outstanding <= 0) continue;

      const customerId = invoice.customerId || 'unknown';
      const customerName = invoice.customer?.name || 'Unknown Customer';

      if (!customerMap.has(customerId)) {
        customerMap.set(customerId, {
          id: customerId,
          name: customerName,
          email: invoice.customer?.email || '',
          phone: invoice.customer?.phone || '',
          invoices: [],
          current: 0,
          days1to30: 0,
          days31to60: 0,
          days61to90: 0,
          days90plus: 0,
          totalOutstanding: 0,
        });
      }

      const customer = customerMap.get(customerId);
      const dueDate = new Date(invoice.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      const daysPastDue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));

      if (daysPastDue <= 0) {
        customer.current += outstanding;
      } else if (daysPastDue <= 30) {
        customer.days1to30 += outstanding;
      } else if (daysPastDue <= 60) {
        customer.days31to60 += outstanding;
      } else if (daysPastDue <= 90) {
        customer.days61to90 += outstanding;
      } else {
        customer.days90plus += outstanding;
      }

      customer.totalOutstanding += outstanding;
      customer.invoices.push({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        amount: invoice.grandTotal,
        paidAmount: invoice.paidAmount || 0,
        outstanding,
        daysPastDue: Math.max(0, daysPastDue),
      });
    }

    const customers = Array.from(customerMap.values()).sort(
      (a, b) => b.totalOutstanding - a.totalOutstanding
    );

    const summary = customers.reduce(
      (acc, c) => ({
        current: acc.current + c.current,
        days1to30: acc.days1to30 + c.days1to30,
        days31to60: acc.days31to60 + c.days31to60,
        days61to90: acc.days61to90 + c.days61to90,
        days90plus: acc.days90plus + c.days90plus,
        totalOutstanding: acc.totalOutstanding + c.totalOutstanding,
      }),
      { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, totalOutstanding: 0 }
    );

    const agedData = { customers, summary };

    // Cache the result (2 minutes TTL)
    await set(cacheKey, agedData, 120);

    res.status(200).json({
      success: true,
      data: agedData,
      cached: false,
    });
  } catch (error) {
    console.error('❌ [AR] Get aged receivables error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ─── ✅ EXPORTS ──────────────────────────────────────────────────────
module.exports = {
  createCustomer,
  getCustomers,
  getCustomer,
  updateCustomer,
  deleteCustomer,
  createInvoice,
  getInvoices,
  getInvoice,
  cancelInvoice, // ✅ NEW
  recordPayment,
  getSummary,
  getAgedReceivables,
  getUnpaidInvoices,
getUnpaidInvoices,
};