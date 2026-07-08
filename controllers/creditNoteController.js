// controllers/creditNoteController.js - FIXED VERSION

const prisma = require('../prisma/client');
const CreditNoteModel = require('../models/CreditNote');

// ============================================================
// ACCOUNTING CONSTANTS
// ============================================================
const REASON_TYPE_MAPPING = {
  'Return': {
    accountCode: '4100',
    accountName: 'Sales Returns & Allowances',
    accountType: 'ContraRevenue',
    parentAccount: 'Revenue',
    balanceType: 'Debit',
    description: 'Return of goods by customer'
  },
  'Refund': {
    accountCode: '4105',
    accountName: 'Sales Refunds',
    accountType: 'ContraRevenue',
    parentAccount: 'Revenue',
    balanceType: 'Debit',
    description: 'Cash refund to customer'
  },
  'Discount': {
    accountCode: '4110',
    accountName: 'Sales Discounts Allowed',
    accountType: 'ContraRevenue',
    parentAccount: 'Revenue',
    balanceType: 'Debit',
    description: 'Discount allowed to customer'
  },
  'Price Adjustment': {
    accountCode: '4115',
    accountName: 'Sales Adjustments',
    accountType: 'ContraRevenue',
    parentAccount: 'Revenue',
    balanceType: 'Debit',
    description: 'Price adjustment on invoice'
  },
  'Damaged Goods': {
    accountCode: '4120',
    accountName: 'Sales Returns & Allowances',
    accountType: 'ContraRevenue',
    parentAccount: 'Revenue',
    balanceType: 'Debit',
    description: 'Damaged goods returned'
  }
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

async function getOrCreateContraRevenueAccount(userId, reasonType) {
  const mapping = REASON_TYPE_MAPPING[reasonType] || REASON_TYPE_MAPPING['Return'];
  
  let account = await prisma.chartOfAccount.findFirst({
    where: {
      code: mapping.accountCode,
      createdBy: userId
    }
  });

  if (!account) {
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: mapping.accountCode }
    });
    
    let newCode = mapping.accountCode;
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `${mapping.accountCode.substring(0, 2)}${counter}${mapping.accountCode.substring(2)}`;
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode, createdBy: userId }
        });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }

    account = await prisma.chartOfAccount.create({
      data: {
        code: newCode,
        name: mapping.accountName,
        type: mapping.accountType,
        parentAccount: mapping.parentAccount,
        openingBalance: 0,
        currentBalance: 0,
        description: mapping.description,
        taxCode: 'N/A',
        balanceType: mapping.balanceType,
        isActive: true,
        createdBy: userId
      }
    });
  }
  return account;
}

async function getOrCreateReceivableAccount(userId) {
  let arAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '1110',
      createdBy: userId
    }
  });

  if (!arAccount) {
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: '1110' }
    });
    
    let newCode = '1110';
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `111${counter}`;
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode, createdBy: userId }
        });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }

    arAccount = await prisma.chartOfAccount.create({
      data: {
        code: newCode,
        name: 'Accounts Receivable',
        type: 'Assets',
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
  }
  return arAccount;
}

async function getOrCreateTaxPayableAccount(userId) {
  let taxAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '2200',
      createdBy: userId
    }
  });

  if (!taxAccount) {
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: '2200' }
    });
    
    let newCode = '2200';
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `22${counter}0`;
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode, createdBy: userId }
        });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }

    taxAccount = await prisma.chartOfAccount.create({
      data: {
        code: newCode,
        name: 'Sales Tax Payable',
        type: 'Liabilities',
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
  }
  return taxAccount;
}

async function validateCustomer(customerId, userId) {
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      createdBy: userId
    }
  });

  if (!customer) {
    throw new Error('Customer not found');
  }
  return customer;
}

async function validateWarehouseInvoice(invoiceId, userId) {
  const invoice = await prisma.warehouseInvoice.findFirst({
    where: {
      id: invoiceId,
      createdBy: userId
    },
    select: {
      id: true,
      invoiceNumber: true,
      grandTotal: true,
      paidAmount: true,
      outstanding: true,
      invoiceStatus: true,
      paymentStatus: true,
      customerId: true,
      customerName: true,
      invoiceDate: true,
      dueDate: true,
      taxRate: true,
      taxAmount: true
    }
  });

  if (!invoice) {
    throw new Error('Warehouse invoice not found. Please select a valid invoice.');
  }
  return invoice;
}

async function updateAccountBalances(accountId, amount, isDebit) {
  const account = await prisma.chartOfAccount.findUnique({
    where: { id: accountId }
  });

  if (!account) return;

  const journalEntries = await prisma.journalEntryLine.findMany({
    where: {
      accountId: accountId,
      journalEntry: {
        status: 'Posted'
      }
    }
  });

  let totalDebit = 0;
  let totalCredit = 0;
  
  journalEntries.forEach(line => {
    totalDebit += line.debit || 0;
    totalCredit += line.credit || 0;
  });

  const newBalance = totalDebit - totalCredit;

  await prisma.chartOfAccount.update({
    where: { id: accountId },
    data: {
      currentBalance: newBalance
    }
  });
}

// ============================================================
// @desc    Create a new credit note
// @route   POST /api/credit-notes
// @access  Private
// ============================================================
exports.createCreditNote = async (req, res) => {
  try {
    const {
      customerId,
      originalInvoiceId,
      amount,
      reason,
      reasonType,
      items,
      notes,
      expiryDays,
      taxRate = 0,
    } = req.body;

    const userId = req.user.id;

    const customer = await validateCustomer(customerId, userId);
    const invoice = await validateWarehouseInvoice(originalInvoiceId, userId);

    if (invoice.outstanding <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invoice is already fully paid. Cannot issue credit note.',
      });
    }

    const existingCN = await prisma.creditNote.findFirst({
      where: {
        originalInvoiceId: invoice.id,
        status: { in: ['Issued', 'PartiallyApplied'] },
        createdBy: userId
      }
    });

    if (existingCN) {
      return res.status(400).json({
        success: false,
        message: `A credit note (${existingCN.creditNumber}) already exists for this invoice.`,
      });
    }

    if (amount > invoice.outstanding) {
      return res.status(400).json({
        success: false,
        message: `Credit note amount cannot exceed invoice outstanding balance of ${invoice.outstanding}`,
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0',
      });
    }

    const taxAmount = (amount * taxRate) / 100;
    const netAmount = amount - taxAmount;

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + (expiryDays || 30));

    const contraRevenueAccount = await getOrCreateContraRevenueAccount(userId, reasonType || 'Return');
    const arAccount = await getOrCreateReceivableAccount(userId);
    const taxAccount = await getOrCreateTaxPayableAccount(userId);

    const creditNote = await CreditNoteModel.create({
      date: new Date(),
      customerId: customer.id,
      customerName: customer.name,
      originalInvoiceId: invoice.id,
      originalInvoiceNumber: invoice.invoiceNumber,
      originalInvoiceAmount: invoice.grandTotal || 0,
      amount: amount,
      reason: reason || '',
      reasonType: reasonType || 'Adjustment',
      items: items || [
        {
          description: reason || 'Credit Note',
          quantity: 1,
          unitPrice: amount,
          amount: amount,
        }
      ],
      expiryDate: expiryDate,
      notes: notes || '',
      createdBy: userId,
      taxRate: taxRate,
      taxAmount: taxAmount,
      netAmount: netAmount
    });

    await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-CN-${Date.now()}`,
        date: new Date(),
        description: `Credit note ${creditNote.creditNumber} issued to ${customer.name} for ${reason || 'Adjustment'}`,
        reference: creditNote.creditNumber,
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        lines: {
          create: [
            {
              accountId: contraRevenueAccount.id,
              accountName: contraRevenueAccount.name,
              accountCode: contraRevenueAccount.code,
              debit: netAmount,
              credit: 0,
              isReconciled: false,
              description: `Credit note ${creditNote.creditNumber}`
            },
            ...(taxAmount > 0 ? [{
              accountId: taxAccount.id,
              accountName: taxAccount.name,
              accountCode: taxAccount.code,
              debit: taxAmount,
              credit: 0,
              isReconciled: false,
              description: `Tax on credit note ${creditNote.creditNumber}`
            }] : []),
            {
              accountId: arAccount.id,
              accountName: arAccount.name,
              accountCode: arAccount.code,
              debit: 0,
              credit: amount,
              isReconciled: false,
              description: `Credit note ${creditNote.creditNumber}`
            }
          ]
        }
      }
    });

    await updateAccountBalances(contraRevenueAccount.id, netAmount, true);
    if (taxAmount > 0) {
      await updateAccountBalances(taxAccount.id, taxAmount, true);
    }
    await updateAccountBalances(arAccount.id, amount, false);

    // Update Customer - Remove balance field if not exists
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        totalCreditNotes: { increment: amount }
      }
    });

    await prisma.customerTransaction.create({
      data: {
        customerId: customer.id,
        transactionType: 'CreditNote',
        reference: creditNote.creditNumber,
        amount: amount,
        type: 'Credit',
        date: new Date(),
        description: `Credit note issued for invoice ${invoice.invoiceNumber}`,
        createdBy: userId,
        status: 'Posted'
      }
    });

    const newOutstanding = invoice.outstanding - amount;
    const newPaidAmount = invoice.paidAmount + amount;
    
    let invoiceStatus = 'Partial';
    let paymentStatus = 'Partial';
    
    if (newOutstanding === 0) {
      invoiceStatus = 'Paid';
      paymentStatus = 'Paid';
    }

    const creditNoteReferences = invoice.creditNoteReferences || [];
    creditNoteReferences.push({
      creditNoteId: creditNote.id,
      creditNoteNumber: creditNote.creditNumber,
      amount: amount,
      appliedAt: new Date()
    });

    await prisma.warehouseInvoice.update({
      where: { id: invoice.id },
      data: {
        outstanding: newOutstanding,
        paidAmount: newPaidAmount,
        invoiceStatus: invoiceStatus,
        paymentStatus: paymentStatus,
        creditNoteReferences: creditNoteReferences
      }
    });

    res.status(201).json({
      success: true,
      data: creditNote,
      message: 'Credit note created successfully with proper accounting entries',
    });
  } catch (error) {
    console.error('❌ [CN] Create credit note error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creating credit note',
    });
  }
};

// ============================================================
// @desc    Get all credit notes
// @route   GET /api/credit-notes
// @access  Private
// ============================================================
exports.getCreditNotes = async (req, res) => {
  try {
    const { customerId, status, startDate, endDate, search } = req.query;
    const userId = req.user.id;

    const filter = { createdBy: userId };

    if (customerId) filter.customerId = customerId;
    if (status) filter.status = status;
    if (startDate && endDate) {
      filter.date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }
    if (search) {
      filter.OR = [
        { creditNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { originalInvoiceNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    const creditNotes = await prisma.creditNote.findMany({
      where: filter,
      orderBy: { date: 'desc' },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
            // Removed: balance - field doesn't exist
          }
        },
        originalInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            grandTotal: true,
            paidAmount: true,
            outstanding: true,
            invoiceStatus: true,
            paymentStatus: true
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      count: creditNotes.length,
      data: creditNotes,
    });
  } catch (error) {
    console.error('❌ [CN] Get credit notes error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Get single credit note
// @route   GET /api/credit-notes/:id
// @access  Private
// ============================================================
exports.getCreditNote = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const creditNote = await prisma.creditNote.findFirst({
      where: {
        id,
        createdBy: userId
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
        originalInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            grandTotal: true,
            paidAmount: true,
            outstanding: true,
            invoiceStatus: true,
            paymentStatus: true,
            creditNoteReferences: true
          }
        }
      }
    });

    if (!creditNote) {
      return res.status(404).json({
        success: false,
        message: 'Credit note not found',
      });
    }

    res.status(200).json({
      success: true,
      data: creditNote,
    });
  } catch (error) {
    console.error('❌ [CN] Get credit note error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Get credit note summary
// @route   GET /api/credit-notes/summary
// @access  Private
// ============================================================
exports.getSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    const filter = { createdBy: userId };

    if (startDate && endDate) {
      filter.date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    const allCreditNotes = await prisma.creditNote.findMany({
      where: filter
    });

    const totalCount = allCreditNotes.length;
    const totalAmount = allCreditNotes.reduce((sum, cn) => sum + cn.amount, 0);
    const appliedAmount = allCreditNotes.reduce((sum, cn) => sum + cn.appliedAmount, 0);
    const remainingAmount = allCreditNotes.reduce((sum, cn) => sum + cn.remainingAmount, 0);
    const expiredAmount = allCreditNotes
      .filter(cn => cn.status === 'Expired')
      .reduce((sum, cn) => sum + cn.amount, 0);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const thisMonth = await prisma.creditNote.aggregate({
      where: {
        ...filter,
        date: { gte: startOfMonth }
      },
      _sum: { amount: true },
      _count: true
    });

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const thisWeek = await prisma.creditNote.aggregate({
      where: {
        ...filter,
        date: { gte: startOfWeek }
      },
      _sum: { amount: true },
      _count: true
    });

    res.status(200).json({
      success: true,
      data: {
        totalCount,
        totalAmount,
        appliedAmount,
        remainingAmount,
        expiredAmount,
        thisMonth: thisMonth._sum.amount || 0,
        thisMonthCount: thisMonth._count || 0,
        thisWeek: thisWeek._sum.amount || 0,
        thisWeekCount: thisWeek._count || 0,
      },
    });
  } catch (error) {
    console.error('❌ [CN] Get summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Get unpaid warehouse invoices for customer
// @route   GET /api/credit-notes/unpaid-invoices/:customerId
// @access  Private
// ============================================================
exports.getUnpaidInvoices = async (req, res) => {
  console.log('📦 [CN] getUnpaidInvoices called');
  console.log('🔍 [CN] Customer ID:', req.params.customerId);

  try {
    const { customerId } = req.params;
    const userId = req.user.id;

    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        createdBy: userId
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
        customerId: customerId,
        createdBy: userId,
        paymentStatus: {
          not: 'Paid'
        },
        outstanding: {
          gt: 0
        }
      },
      orderBy: {
        invoiceDate: 'desc'
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
        items: {
          select: {
            id: true,
            productName: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true
          }
        }
      }
    });

    const invoiceIds = invoices.map(inv => inv.id);
    const creditNotes = await prisma.creditNote.findMany({
      where: {
        originalInvoiceId: { in: invoiceIds },
        createdBy: userId,
        status: { in: ['Issued', 'PartiallyApplied'] }
      },
      select: {
        originalInvoiceId: true,
        creditNumber: true
      }
    });

    const invoicesWithCreditNotes = new Set(
      creditNotes.map(cn => cn.originalInvoiceId)
    );

    const unpaidInvoices = invoices.map(invoice => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.grandTotal || 0,
      outstanding: invoice.outstanding || 0,
      date: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      status: invoice.invoiceStatus,
      paidAmount: invoice.paidAmount || 0,
      customerName: invoice.customerName,
      items: invoice.items,
      taxRate: invoice.taxRate || 0,
      taxAmount: invoice.taxAmount || 0,
      hasCreditNote: invoicesWithCreditNotes.has(invoice.id)
    }));

    const filteredInvoices = unpaidInvoices.filter(
      inv => !inv.hasCreditNote
    );

    res.status(200).json({
      success: true,
      count: filteredInvoices.length,
      data: filteredInvoices,
    });

  } catch (error) {
    console.error('❌ [CN] Get unpaid invoices error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Apply credit note to warehouse invoice
// @route   POST /api/credit-notes/apply
// @access  Private
// ============================================================
exports.applyCreditNote = async (req, res) => {
  try {
    const { creditNoteId, invoiceId, amount } = req.body;
    const userId = req.user.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required',
      });
    }

    const creditNote = await prisma.creditNote.findFirst({
      where: {
        id: creditNoteId,
        createdBy: userId
      }
    });

    if (!creditNote) {
      return res.status(404).json({
        success: false,
        message: 'Credit note not found',
      });
    }

    if (new Date() > new Date(creditNote.expiryDate) && creditNote.status !== 'Applied') {
      return res.status(400).json({
        success: false,
        message: 'Credit note has expired and cannot be applied',
      });
    }

    if (creditNote.status === 'Applied') {
      return res.status(400).json({
        success: false,
        message: 'Credit note is already fully applied',
      });
    }

    if (amount > creditNote.remainingAmount) {
      return res.status(400).json({
        success: false,
        message: `Amount exceeds remaining credit note amount of ${creditNote.remainingAmount}`,
      });
    }

    const invoice = await prisma.warehouseInvoice.findFirst({
      where: {
        id: invoiceId,
        createdBy: userId
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse invoice not found',
      });
    }

    if (amount > invoice.outstanding) {
      return res.status(400).json({
        success: false,
        message: `Amount exceeds invoice outstanding balance of ${invoice.outstanding}`,
      });
    }

    const newAppliedAmount = creditNote.appliedAmount + amount;
    const newRemainingAmount = creditNote.remainingAmount - amount;
    
    let status = 'PartiallyApplied';
    if (newRemainingAmount === 0) {
      status = 'Applied';
    }

    const appliedToInvoices = creditNote.appliedToInvoices || [];
    appliedToInvoices.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: amount,
      appliedAt: new Date()
    });

    await prisma.creditNote.update({
      where: { id: creditNoteId },
      data: {
        appliedAmount: newAppliedAmount,
        remainingAmount: newRemainingAmount,
        status: status,
        appliedToInvoices: appliedToInvoices
      }
    });

    const newPaidAmount = invoice.paidAmount + amount;
    const newOutstanding = invoice.grandTotal - newPaidAmount;
    
    let invoiceStatus = 'Partial';
    if (newOutstanding === 0) {
      invoiceStatus = 'Paid';
    }

    const creditNoteReferences = invoice.creditNoteReferences || [];
    creditNoteReferences.push({
      creditNoteId: creditNote.id,
      creditNoteNumber: creditNote.creditNumber,
      amount: amount,
      appliedAt: new Date()
    });

    await prisma.warehouseInvoice.update({
      where: { id: invoiceId },
      data: {
        paidAmount: newPaidAmount,
        outstanding: newOutstanding,
        invoiceStatus: invoiceStatus,
        paymentStatus: newOutstanding === 0 ? 'Paid' : 'Partial',
        creditNoteReferences: creditNoteReferences
      }
    });

    // Update customer - Remove balance field
    await prisma.customer.update({
      where: { id: invoice.customerId },
      data: {
        totalCreditNotes: { increment: amount }
      }
    });

    const arAccount = await getOrCreateReceivableAccount(userId);
    const contraRevenueAccount = await getOrCreateContraRevenueAccount(userId, creditNote.reasonType || 'Return');

    await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-APPLY-${Date.now()}`,
        date: new Date(),
        description: `Applied credit note ${creditNote.creditNumber} to invoice ${invoice.invoiceNumber}`,
        reference: `${creditNote.creditNumber} -> ${invoice.invoiceNumber}`,
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        lines: {
          create: [
            {
              accountId: arAccount.id,
              accountName: arAccount.name,
              accountCode: arAccount.code,
              debit: amount,
              credit: 0,
              isReconciled: false,
              description: `Applied credit note ${creditNote.creditNumber}`
            },
            {
              accountId: contraRevenueAccount.id,
              accountName: contraRevenueAccount.name,
              accountCode: contraRevenueAccount.code,
              debit: 0,
              credit: amount,
              isReconciled: false,
              description: `Applied credit note ${creditNote.creditNumber}`
            }
          ]
        }
      }
    });

    await updateAccountBalances(arAccount.id, amount, true);
    await updateAccountBalances(contraRevenueAccount.id, amount, false);

    res.status(200).json({
      success: true,
      message: 'Credit note applied successfully with proper accounting entries',
    });
  } catch (error) {
    console.error('❌ [CN] Apply credit note error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Auto-expire credit notes
// @route   POST /api/credit-notes/expire
// @access  Private
// ============================================================
exports.expireCreditNotes = async (req, res) => {
  console.log('📦 [CN] expireCreditNotes called');

  try {
    const userId = req.user.id;

    const expiredNotes = await prisma.creditNote.findMany({
      where: {
        createdBy: userId,
        expiryDate: { lt: new Date() },
        status: { in: ['Issued', 'PartiallyApplied'] },
        remainingAmount: { gt: 0 }
      }
    });

    for (const note of expiredNotes) {
      await prisma.creditNote.update({
        where: { id: note.id },
        data: {
          status: 'Expired'
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        updated: expiredNotes.length,
      },
      message: `${expiredNotes.length} credit notes expired`,
    });
  } catch (error) {
    console.error('❌ [CN] Expire credit notes error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Delete credit note
// @route   DELETE /api/credit-notes/:id
// @access  Private
// ============================================================
exports.deleteCreditNote = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const creditNote = await prisma.creditNote.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!creditNote) {
      return res.status(404).json({
        success: false,
        message: 'Credit note not found',
      });
    }

    if (creditNote.appliedAmount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete credit note that has been applied',
      });
    }

    await prisma.creditNote.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'Credit note deleted successfully',
    });
  } catch (error) {
    console.error('❌ [CN] Delete credit note error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Void credit note
// @route   POST /api/credit-notes/:id/void
// @access  Private
// ============================================================
exports.voidCreditNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;

    const creditNote = await prisma.creditNote.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!creditNote) {
      return res.status(404).json({
        success: false,
        message: 'Credit note not found',
      });
    }

    if (creditNote.status === 'Voided') {
      return res.status(400).json({
        success: false,
        message: 'Credit note is already voided',
      });
    }

    if (creditNote.appliedAmount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot void credit note that has been applied',
      });
    }

    await prisma.creditNote.update({
      where: { id: id },
      data: {
        status: 'Voided',
        notes: `${creditNote.notes}\nVoided: ${reason || 'No reason provided'}`
      }
    });

    res.status(200).json({
      success: true,
      message: 'Credit note voided successfully',
    });
  } catch (error) {
    console.error('❌ [CN] Void credit note error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Get credit note by number
// @route   GET /api/credit-notes/number/:creditNumber
// @access  Private
// ============================================================
exports.getCreditNoteByNumber = async (req, res) => {
  try {
    const { creditNumber } = req.params;
    const userId = req.user.id;

    const creditNote = await prisma.creditNote.findFirst({
      where: {
        creditNumber: creditNumber,
        createdBy: userId
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
        originalInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            grandTotal: true,
            outstanding: true
          }
        }
      }
    });

    if (!creditNote) {
      return res.status(404).json({
        success: false,
        message: 'Credit note not found',
      });
    }

    res.status(200).json({
      success: true,
      data: creditNote,
    });
  } catch (error) {
    console.error('❌ [CN] Get credit note by number error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = exports;