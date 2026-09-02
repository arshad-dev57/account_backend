// controllers/accountsReceivableController.js - COMPLETE FIXED VERSION

const prisma = require('../prisma/client');
const WarehouseInvoiceModel = require('../models/WarehouseInvoice');
const { getCompanyFiscalYear } = require('../utils/fiscalYearHelper');
const { getOrCreateCashAccount } = require('../utils/cashAccountHelper');
const {
  salesInvoiceLocationWhere,
  warehouseInvoiceLocationWhere
} = require('../utils/accountingLocationHelper');

async function warehouseInvoiceFyDateFilter(companyId, fiscalYearId) {
  if (!fiscalYearId) return null;
  const fy = await getCompanyFiscalYear(companyId, fiscalYearId);
  if (!fy) return null;
  return {
    gte: new Date(fy.startDate),
    lte: new Date(fy.endDate)
  };
}

/**
 * Live AR balance — do not trust invoiceStatus / stored outstanding alone.
 * Outstanding = grandTotal − cash paid − issued credit notes (non-cancelled).
 */
function computeOpenBalance(inv) {
  const grandTotal = Number(inv.grandTotal) || 0;
  const paidFromPayments = (inv.invoicePayments || []).reduce(
    (s, p) => s + (Number(p.amountPaid) || 0),
    0
  );
  const paidAmount = Math.max(Number(inv.paidAmount) || 0, paidFromPayments);
  const credited = (inv.creditNotes || []).reduce(
    (s, c) => s + (Number(c.amount) || 0),
    0
  );
  const outstanding = Math.max(0, grandTotal - paidAmount - credited);
  return { grandTotal, paidAmount, credited, outstanding };
}

const salesOpenInclude = {
  invoicePayments: {
    where: {
      payment: {
        isActive: true,
        isDeleted: false,
        status: 'Completed'
      }
    },
    select: { amountPaid: true }
  },
  creditNotes: {
    where: { status: { notIn: ['Cancelled', 'Voided'] } },
    select: { amount: true }
  }
};

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

async function generateInvoiceNumber(userId) {
  const count = await prisma.warehouseInvoice.count({
    where: { companyId: companyId}
  });
  const year = new Date().getFullYear();
  const invoiceNumber = `INV-${year}-${String(count + 1).padStart(4, '0')}`;
  console.log(`📝 [AR] Generated invoice number: ${invoiceNumber}`);
  return invoiceNumber;
}

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
      notes
    } = req.body;

    const userId = req.user.id;
    const companyId = req.user.companyId;
    console.log('👤 [AR] User ID:', userId);

    const normalizedEmail = email && typeof email === 'string'
      ? email.trim().toLowerCase() || null
      : null;

    if (normalizedEmail) {
      const existing = await prisma.customer.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
          companyId,
          isActive: true,
          isDeleted: false,
        },
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'A customer with this email already exists in your company',
        });
      }
    }

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
        email: normalizedEmail,
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
        createdBy: userId,
        companyId,
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

res.status(201).json({
      success: true,
      data: customer
    });
  } catch (error) {
    console.error('❌ [AR] Create customer error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

const getCustomers = async (req, res) => {
  console.log('📦 [AR] getCustomers called');
  
  try {
    const { search, status, refresh, locationId } = req.query;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    if (refresh !== 'true') {
    } else {
      // Clear the cache
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

    const whLoc = warehouseInvoiceLocationWhere(locationId);
    const salesLoc = salesInvoiceLocationWhere(locationId);

    // Warehouse + Sales invoices (sales is the active invoicing module).
    // Include Paid rows — balance is recomputed from payments + credit notes.
    const [warehouseInvoices, salesInvoices] = await Promise.all([
      prisma.warehouseInvoice.findMany({
        where: {
          companyId: companyId,
          isDeleted: false,
          invoiceStatus: { not: 'Cancelled' },
          ...whLoc
        }
      }),
      prisma.salesInvoice.findMany({
        where: {
          companyId: companyId,
          isDeleted: false,
          isActive: true,
          invoiceStatus: { not: 'Cancelled' },
          ...salesLoc
        },
        include: salesOpenInclude
      }),
    ]);

    const normalizeInvoice = (inv, source) => {
      const { grandTotal, paidAmount, outstanding } = computeOpenBalance(inv);
      let status = inv.paymentStatus || inv.invoiceStatus || 'Unpaid';
      if (outstanding <= 0) status = 'Paid';
      else if (paidAmount > 0) status = 'Partial';
      else status = 'Unpaid';
      return {
        id: inv.id,
        source,
        customerId: inv.customerId,
        invoiceNumber: inv.invoiceNumber,
        date: inv.invoiceDate,
        dueDate: inv.dueDate,
        totalAmount: grandTotal,
        paidAmount,
        outstanding,
        status,
        invoiceStatus: inv.invoiceStatus
      };
    };

    const invoices = [
      ...warehouseInvoices.map((inv) => normalizeInvoice(inv, 'warehouse')),
      ...salesInvoices.map((inv) => normalizeInvoice(inv, 'sales')),
    ].filter((inv) => inv.outstanding > 0);

    const customersWithOutstanding = customers.map(customer => {
      const customerInvoices = invoices.filter(
        inv => inv.customerId === customer.id
      );
      const totalAmount = customerInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
      const paidAmount = customerInvoices.reduce((sum, inv) => sum + inv.paidAmount, 0);
      const outstandingAmount = customerInvoices.reduce(
        (sum, inv) => sum + inv.outstanding,
        0
      );

      return {
        id: customer.id,
        name: customer.name,
        email: customer.email || '',
        phone: customer.phone || '',
        isActive: customer.isActive,
        totalAmount,
        paidAmount,
        outstandingAmount,
        invoiceCount: customerInvoices.length,
        invoices: customerInvoices,
        lastPaymentDate: customer.lastOrderDate || null
      };
    });

    res.status(200).json({
      success: true,
      count: customersWithOutstanding.length,
      data: customersWithOutstanding
    });
  } catch (error) {
    console.error('❌ [AR] Get customers error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

const getCustomer = async (req, res) => {
  console.log('📦 [AR] getCustomer called');
  
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
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
        message: 'Customer not found'
      });
    }

    const invoicesWh = await prisma.warehouseInvoice.findMany({
      where: {
        customerId: customer.id,
        companyId: companyId,
        isDeleted: false
      },
      orderBy: { invoiceDate: 'desc' }
    });

    const invoicesSi = await prisma.salesInvoice.findMany({
      where: {
        customerId: customer.id,
        companyId: companyId,
        isDeleted: false,
        isActive: true
      },
      orderBy: { invoiceDate: 'desc' },
      include: {
        invoicePayments: {
          where: {
            payment: {
              isActive: true,
              isDeleted: false,
              status: 'Completed'
            }
          },
          select: { amountPaid: true }
        }
      }
    });

    const invoices = [
      ...invoicesWh.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        date: inv.invoiceDate,
        dueDate: inv.dueDate,
        totalAmount: inv.grandTotal || 0,
        paidAmount: inv.paidAmount || 0,
        status: inv.paymentStatus || inv.invoiceStatus,
        outstanding: Math.max(0, (inv.grandTotal || 0) - (inv.paidAmount || 0))
      })),
      ...invoicesSi.map((inv) => {
        const paidFromPayments = (inv.invoicePayments || []).reduce(
          (s, p) => s + (p.amountPaid || 0),
          0
        );
        const paidAmount = Math.max(inv.paidAmount || 0, paidFromPayments);
        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          date: inv.invoiceDate,
          dueDate: inv.dueDate,
          totalAmount: inv.grandTotal || 0,
          paidAmount,
          status: inv.paymentStatus || inv.invoiceStatus,
          outstanding: Math.max(0, (inv.grandTotal || 0) - paidAmount)
        };
      }),
    ];

    const totalAmount = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
    const paidAmount = invoices.reduce((sum, inv) => sum + inv.paidAmount, 0);
    const outstandingAmount = invoices.reduce(
      (sum, inv) => sum + inv.outstanding,
      0
    );

    const customerData = {
      ...customer,
      invoices,
      totalAmount,
      paidAmount,
      outstandingAmount,
      invoiceCount: invoices.length
    };

    res.status(200).json({
      success: true,
      data: customerData
    });
  } catch (error) {
    console.error('❌ [AR] Get customer error:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
      isActive
    } = req.body;

    const existing = await prisma.customer.findFirst({
      where: {
        id,
        companyId: companyId}
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
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
        isActive: isActive !== undefined ? isActive : existing.isActive
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

res.status(200).json({
      success: true,
      data: customer
    });
  } catch (error) {
    console.error('❌ [AR] Update customer error:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
        message: 'Cannot delete customer with existing invoices'
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
        message: 'Customer not found'
      });
    }

res.status(200).json({
      success: true,
      message: 'Customer deleted successfully'
    });
  } catch (error) {
    console.error('❌ [AR] Delete customer error:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
      notes
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
        taxAmount
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
      createdBy: userId
    });

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      data: invoice
    });

} catch (error) {
    console.error('❌ [AR] Create invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

const getInvoices = async (req, res) => {
  console.log('📦 [AR] getInvoices called');
  
  try {
    const { customerId, status, startDate, endDate, fiscalYearId, locationId } = req.query;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const filter = {
      companyId: companyId,
      ...warehouseInvoiceLocationWhere(locationId)
    };

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

    const fyDates = await warehouseInvoiceFyDateFilter(companyId, fiscalYearId);
    if (fyDates) {
      if (filter.invoiceDate) {
        filter.invoiceDate = {
          gte: filter.invoiceDate.gte > fyDates.gte ? filter.invoiceDate.gte : fyDates.gte,
          lte: filter.invoiceDate.lte < fyDates.lte ? filter.invoiceDate.lte : fyDates.lte
        };
      } else {
        filter.invoiceDate = fyDates;
      }
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

    res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices
    });
  } catch (error) {
    console.error('❌ [AR] Get invoices error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

const getInvoice = async (req, res) => {
  console.log('📦 [AR] getInvoice called');
  
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
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
        message: 'Invoice not found'
      });
    }

    res.status(200).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    console.error('❌ [AR] Get invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
    // v2: includes sales invoices (not just warehouse)
    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        companyId: companyId}
    });
    
    if (!customer) {
      console.log('❌ [AR] Customer not found');
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    console.log(`✅ [AR] Customer found: ${customer.name}`);

    const [warehouseInvoices, salesInvoices] = await Promise.all([
      prisma.warehouseInvoice.findMany({
        where: {
          customerId,
          companyId,
          isActive: true,
          isDeleted: false,
          invoiceStatus: { notIn: ['Paid', 'Cancelled'] },
          ...warehouseInvoiceLocationWhere(req.query.locationId)
        },
        orderBy: { dueDate: 'asc' }
      }),
      prisma.salesInvoice.findMany({
        where: {
          customerId,
          companyId,
          isActive: true,
          isDeleted: false,
          invoiceStatus: { notIn: ['Cancelled'] },
          ...salesInvoiceLocationWhere(req.query.locationId)
        },
        include: salesOpenInclude,
        orderBy: { dueDate: 'asc' }
      }),
    ]);

    const mapWh = (invoice) => {
      const grandTotal = parseFloat(invoice.grandTotal) || 0;
      const paidAmount = parseFloat(invoice.paidAmount || 0);
      const outstanding = Math.max(0, grandTotal - paidAmount);
      return {
        id: invoice.id,
        source: 'warehouse',
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        totalAmount: grandTotal,
        paidAmount,
        outstanding,
        status: invoice.invoiceStatus
      };
    };

    const mapSales = (invoice) => {
      const { grandTotal, paidAmount, outstanding } = computeOpenBalance(invoice);
      let status = invoice.paymentStatus || invoice.invoiceStatus || 'Unpaid';
      if (outstanding <= 0) status = 'Paid';
      else if (paidAmount > 0) status = 'Partial';
      else status = 'Unpaid';
      return {
        id: invoice.id,
        source: 'sales',
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        totalAmount: grandTotal,
        paidAmount,
        outstanding,
        status
      };
    };

    const result = [
      ...warehouseInvoices.map(mapWh),
      ...salesInvoices.map(mapSales),
    ]
      .filter((inv) => inv.outstanding > 0)
      .sort((a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0));

    console.log(
      `📊 [AR] Unpaid invoices: warehouse=${warehouseInvoices.length} sales=${salesInvoices.length} open=${result.length}`
    );

    res.status(200).json({
      success: true,
      count: result.length,
      data: result
    });
  } catch (error) {
    console.error('❌ [AR] getUnpaidInvoices error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ─── HELPER: Generate next payment number ───────────────────────
async function generatePaymentNumber(companyId, tx) {
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
  try {
    const {
      invoiceId,
      amount,
      paymentDate,
      paymentMethod,
      reference,
      bankAccountId,
      notes
    } = req.body;

    const userId = req.user.id;
    const companyId = req.user.companyId;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📦 [AR] recordPayment called');
    console.log('  userId    :', userId);
    console.log('  companyId :', companyId);
    console.log('  invoiceId :', invoiceId);
    console.log('  amount    :', amount);
    console.log('  method    :', paymentMethod);
    console.log('  bankAccId :', bankAccountId);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!companyId) {
      console.error('❌ [AR] companyId is missing from req.user — token may be stale');
      return res.status(400).json({ success: false, message: 'Company ID not found. Please re-login.' });
    }
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
                balanceType: 'Debit', isActive: true, createdBy: userId, companyId: companyId
              }
            });
          }

          const cashAccount = await getOrCreateCashAccount(userId, companyId, tx);

          let bankAccount = null;
          let debitAccount = cashAccount;

          if (bankAccountId && String(paymentMethod || '').toLowerCase() !== 'cash') {
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
          const paymentNumber = await generatePaymentNumber(companyId, tx);

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
              companyId: companyId
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
              companyId: companyId,
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
              status: result.updatedInvoice.invoiceStatus
            },
            payment: result.payment
          }
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

const statusCode = lastError && lastError.statusCode ? lastError.statusCode : 500;
    return res.status(statusCode).json({
      success: false,
      message: lastError ? lastError.message : 'Failed to record payment'
    });

  } catch (error) {
    console.error('❌ [AR] Record payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
    const { fiscalYearId, locationId } = req.query;
    const whLoc = warehouseInvoiceLocationWhere(locationId);
    const salesLoc = salesInvoiceLocationWhere(locationId);

    const baseWh = {
      companyId: companyId,
      isDeleted: false,
      invoiceStatus: { not: 'Cancelled' },
      ...whLoc
    };
    const baseSi = {
      companyId: companyId,
      isDeleted: false,
      isActive: true,
      invoiceStatus: { not: 'Cancelled' },
      ...salesLoc
    };

    // WarehouseInvoice has no fiscalYearId — use invoiceDate window.
    // SalesInvoice has the FK; also clamp by date so null-FY legacy rows still match.
    const fyDates = await warehouseInvoiceFyDateFilter(companyId, fiscalYearId);
    if (fyDates) {
      baseWh.invoiceDate = fyDates;
      baseSi.invoiceDate = fyDates;
    } else if (fiscalYearId) {
      baseSi.fiscalYearId = fiscalYearId;
    }

    const [warehouseInvoices, salesInvoices] = await Promise.all([
      prisma.warehouseInvoice.findMany({ where: baseWh }),
      prisma.salesInvoice.findMany({
        where: baseSi,
        include: salesOpenInclude
      }),
    ]);

    const normalize = (inv) => {
      const { outstanding } = computeOpenBalance(inv);
      return {
        dueDate: inv.dueDate,
        invoiceStatus: inv.invoiceStatus,
        outstanding
      };
    };

    const invoices = [
      ...warehouseInvoices.map(normalize),
      ...salesInvoices.map(normalize),
    ].filter((inv) => inv.outstanding > 0);

    const totalOutstanding = invoices.reduce(
      (sum, inv) => sum + inv.outstanding,
      0
    );

    const now = new Date();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const overdue = invoices
      .filter(inv => inv.dueDate && new Date(inv.dueDate) < now)
      .reduce((sum, inv) => sum + inv.outstanding, 0);

    const dueThisWeek = invoices
      .filter(inv => inv.dueDate && new Date(inv.dueDate) >= now && new Date(inv.dueDate) <= endOfWeek)
      .reduce((sum, inv) => sum + inv.outstanding, 0);

    const dueThisMonth = invoices
      .filter(inv => inv.dueDate && new Date(inv.dueDate) >= now && new Date(inv.dueDate) <= endOfMonth)
      .reduce((sum, inv) => sum + inv.outstanding, 0);

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
      activeCustomers
    };

    res.status(200).json({
      success: true,
      data: summaryData
    });
  } catch (error) {
    console.error('❌ [AR] Get AR summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
const getAgedReceivables = async (req, res) => {
  console.log('📦 [AR] getAgedReceivables called');
  
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { fiscalYearId, locationId } = req.query;
    const whLoc = warehouseInvoiceLocationWhere(locationId);
    const salesLoc = salesInvoiceLocationWhere(locationId);

    const filter = {
      companyId: companyId,
      isDeleted: false,
      invoiceStatus: { not: 'Cancelled' },
      ...whLoc
    };

    const fyDates = await warehouseInvoiceFyDateFilter(companyId, fiscalYearId);
    if (fyDates) {
      filter.invoiceDate = fyDates;
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

    const salesInvoices = await prisma.salesInvoice.findMany({
      where: {
        companyId: companyId,
        isDeleted: false,
        isActive: true,
        invoiceStatus: { not: 'Cancelled' },
        ...salesLoc,
        ...(fyDates ? { invoiceDate: fyDates } : fiscalYearId ? { fiscalYearId } : {})
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        ...salesOpenInclude
      }
    });

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const customerMap = new Map();

    const pushInvoice = (invoice, outstanding) => {
      if (outstanding <= 0) return;

      const customerId = invoice.customerId || 'unknown';
      const customerName = invoice.customer?.name || invoice.customerName || 'Unknown Customer';

      if (!customerMap.has(customerId)) {
        customerMap.set(customerId, {
          id: customerId,
          name: customerName,
          email: invoice.customer?.email || invoice.customerEmail || '',
          phone: invoice.customer?.phone || invoice.customerPhone || '',
          invoices: [],
          current: 0,
          days1to30: 0,
          days31to60: 0,
          days61to90: 0,
          days90plus: 0,
          totalOutstanding: 0
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
        daysPastDue: Math.max(0, daysPastDue)
      });
    };

    for (const invoice of invoices) {
      const outstanding = Math.max(0, (invoice.grandTotal || 0) - (invoice.paidAmount || 0));
      pushInvoice(invoice, outstanding);
    }

    for (const invoice of salesInvoices) {
      const { outstanding } = computeOpenBalance(invoice);
      pushInvoice(invoice, outstanding);
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
        totalOutstanding: acc.totalOutstanding + c.totalOutstanding
      }),
      { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, totalOutstanding: 0 }
    );

    const agedData = { customers, summary };

    res.status(200).json({
      success: true,
      data: agedData
    });
  } catch (error) {
    console.error('❌ [AR] Get aged receivables error:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
getUnpaidInvoices
};