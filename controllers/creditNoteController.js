// controllers/creditNoteController.js - FIXED VERSION

const prisma = require('../prisma/client');
const CreditNoteModel = require('../models/CreditNote');
const { fiscalYearGuard } = require('../middleware/fiscalYearMiddleware');
const { resolveFiscalYearId } = require('../utils/fiscalYearHelper');
const { get, set, del, delPattern } = require('../utils/redisClient');

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

async function getOrCreateContraRevenueAccount(userId, companyId, reasonType) {
  const mapping = REASON_TYPE_MAPPING[reasonType] || REASON_TYPE_MAPPING['Return'];
  
  let account = await prisma.chartOfAccount.findFirst({
    where: {
      code: mapping.accountCode,
      
      companyId: companyId
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
          where: { code: newCode,  companyId: companyId }
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
        createdBy: userId,
        companyId: companyId
      }
    });
  }
  return account;
}

async function getOrCreateReceivableAccount(userId, companyId) {
  let arAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '1110',
      companyId: companyId
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
          where: { code: newCode, companyId: companyId }
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
        createdBy: userId,
        companyId: companyId
      }
    });
  }
  return arAccount;
}

async function getOrCreateTaxPayableAccount(userId, companyId) {
  let taxAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '2200',
      companyId: companyId
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
          where: { code: newCode, companyId: companyId }
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
        createdBy: userId,
        companyId: companyId
      }
    });
  }
  return taxAccount;
}

async function validateCustomer(customerId, userId, companyId) {
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      OR: [
        { companyId: companyId },
        { createdBy: userId },
      ],
    }
  });

  if (!customer) {
    throw new Error('Customer not found');
  }
  return customer;
}

async function validateWarehouseInvoice(invoiceId, userId, companyId) {
  const invoice = await prisma.warehouseInvoice.findFirst({
    where: {
      id: invoiceId,
      OR: [
        { companyId: companyId },
        { companyId: null, createdBy: userId },
      ],
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
      taxTotal: true,
    }
  });

  if (!invoice) {
    throw new Error('Warehouse invoice not found. Please select a valid invoice.');
  }

  // Normalize outstanding for old records where it was never set
  invoice.outstanding = invoice.outstanding > 0
    ? invoice.outstanding
    : Math.max(0, (invoice.grandTotal || 0) - (invoice.paidAmount || 0));

  return invoice;
}

async function getOrCreateCustomerCreditAccount(userId, companyId) {
  let account = await prisma.chartOfAccount.findFirst({
    where: { code: '2130', companyId: companyId },
  });

  if (!account) {
    account = await prisma.chartOfAccount.create({
      data: {
        code: '2130',
        name: 'Customer Credit Balance',
        type: 'Liabilities',
        parentAccount: 'Current Liabilities',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Unapplied customer credits from credit notes',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId,
        companyId: companyId,
      },
    });
  }
  return account;
}

async function generateCreditNoteNumber(tx, userId) {
  const count = await tx.creditNote.count({ where: { createdBy: userId } });
  const year = new Date().getFullYear();
  return `CN-${year}-${String(count + 1).padStart(4, '0')}`;
}

function computeInvoiceOutstanding(invoice) {
  if (invoice.outstanding != null && invoice.outstanding !== 0) {
    return invoice.outstanding;
  }
  return Math.max(0, (invoice.grandTotal || 0) - (invoice.paidAmount || 0));
}

function deriveInvoiceStatusAfterCredit(grandTotal, paidAmount, totalCredited) {
  const netOutstanding = grandTotal - paidAmount - totalCredited;
  if (netOutstanding < 0) {
    return { outstanding: netOutstanding, paymentStatus: 'Credit Balance', invoiceStatus: 'Credit Balance' };
  }
  if (netOutstanding === 0) {
    return { outstanding: 0, paymentStatus: 'Paid', invoiceStatus: 'Paid' };
  }
  if (paidAmount > 0 || totalCredited > 0) {
    return { outstanding: netOutstanding, paymentStatus: 'Partial', invoiceStatus: 'Partial' };
  }
  return { outstanding: netOutstanding, paymentStatus: 'Unpaid', invoiceStatus: 'Unpaid' };
}

async function updateAccountBalances(accountId, amount, isDebit) {
  const account = await prisma.chartOfAccount.findUnique({
    where: { id: accountId }
  });

  if (!account) return;

  const journalEntries = await prisma.journalLine.findMany({
    where: {
      accountId: accountId,
      journal: {
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
      items,          // line items for Return/Damaged Goods
      notes,
      expiryDays,
      taxRate = 0,
    } = req.body;

    const userId = req.user.id;
    const companyId = req.user.companyId;
    const postingDate = new Date();

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
    }

    // ─── Fiscal Year Guard ────────────────────────────────────────
    try {
      await fiscalYearGuard(userId, postingDate);
    } catch (err) {
      if (err.code === 'FISCAL_YEAR_CLOSED') {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }

    const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

    const customer = await validateCustomer(customerId, userId, companyId);
    const invoice  = await validateWarehouseInvoice(originalInvoiceId, userId, companyId);

    // ─── ELIGIBLE CREDIT = InvoiceTotal − Sum of all previous Credit Notes ───
    // This is the correct ERP rule: paid invoices CAN have credit notes (e.g., returns after full payment)
    const previousCreditsAgg = await prisma.creditNote.aggregate({
      where: {
        originalInvoiceId: invoice.id,
        status: { notIn: ['Cancelled', 'Voided'] },
      },
      _sum: { amount: true },
    });
    const previousCredits = previousCreditsAgg._sum.amount || 0;
    const eligibleCredit  = Math.max(0, invoice.grandTotal - previousCredits);

    if (eligibleCredit <= 0) {
      return res.status(400).json({
        success: false,
        message: `Invoice ${invoice.invoiceNumber} has already been fully credited. Total invoice: ${invoice.grandTotal}, already credited: ${previousCredits}.`,
      });
    }

    if (amount > eligibleCredit) {
      return res.status(400).json({
        success: false,
        message: `Credit note amount (${amount}) exceeds eligible credit amount (${eligibleCredit}). Invoice total: ${invoice.grandTotal}, already credited: ${previousCredits}.`,
      });
    }

    const taxAmount = (amount * taxRate) / 100;
    const netAmount = amount - taxAmount;

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + (expiryDays || 30));

    const contraRevenueAccount = await getOrCreateContraRevenueAccount(userId, companyId, reasonType || 'Return');
    const arAccount            = await getOrCreateReceivableAccount(userId, companyId);
    const taxAccount           = await getOrCreateTaxPayableAccount(userId, companyId);

    // ─── Use Prisma transaction for atomicity ─────────────────────
    const creditNote = await prisma.$transaction(async (tx) => {
      const creditNumber = await generateCreditNoteNumber(tx, userId);

      // 1. Create Credit Note (inside transaction)
      const cn = await tx.creditNote.create({
        data: {
          creditNumber,
          date: postingDate,
          customerId: customer.id,
          customerName: customer.name,
          originalInvoiceId: invoice.id,
          originalInvoiceNumber: invoice.invoiceNumber,
          originalInvoiceAmount: invoice.grandTotal || 0,
          amount,
          reason: reason || '',
          reasonType: reasonType || 'Return',
          items: items || [],
          status: 'Issued',
          appliedAmount: 0,
          remainingAmount: amount,
          expiryDate,
          notes: notes || '',
          createdBy: userId,
          companyId: companyId || null,
          fiscalYearId: fiscalYearId || null,
        },
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
          originalInvoice: {
            select: {
              id: true, invoiceNumber: true, grandTotal: true,
              paidAmount: true, outstanding: true, invoiceStatus: true, paymentStatus: true,
            },
          },
        },
      });

      // 2. Journal Entry: Dr Contra-Revenue / Dr Tax  Cr AR
      await tx.journalEntry.create({
        data: {
          entryNumber: `JE-CN-${Date.now()}`,
          date: postingDate,
          description: `Credit note ${cn.creditNumber} — ${customer.name} — ${reasonType || 'Return'}`,
          reference: cn.creditNumber,
          status: 'Posted',
          createdBy: userId,
          postedBy: userId,
          fiscalYearId,
          companyId,
          postedAt: new Date(),
          lines: {
            create: [
              // Dr Contra-Revenue (net amount)
              {
                accountId: contraRevenueAccount.id,
                accountName: contraRevenueAccount.name,
                accountCode: contraRevenueAccount.code,
                debit: netAmount,
                credit: 0,
                isReconciled: false,
              },
              // Dr Tax reversal (if applicable)
              ...(taxAmount > 0 ? [{
                accountId: taxAccount.id,
                accountName: taxAccount.name,
                accountCode: taxAccount.code,
                debit: taxAmount,
                credit: 0,
                isReconciled: false,
              }] : []),
              // Cr Accounts Receivable (full credit amount)
              {
                accountId: arAccount.id,
                accountName: arAccount.name,
                accountCode: arAccount.code,
                debit: 0,
                credit: amount,
                isReconciled: false,
              },
            ],
          },
        },
      });

      // 3. Inventory stock return for Return/Damaged Goods
      const isStockReturn = ['Return', 'Damaged Goods'].includes(reasonType);
      if (isStockReturn && Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          if (!item.productId || !item.quantity || item.quantity <= 0) continue;

          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { id: true, name: true, currentStock: true },
          });
          if (!product) continue;

          const prevStock = product.currentStock || 0;
          const newStock  = prevStock + item.quantity;

          await tx.product.update({
            where: { id: item.productId },
            data: { currentStock: newStock },
          });

          await tx.stockMovement.create({
            data: {
              productId:    item.productId,
              productName:  item.productName || product.name,
              type:         'Return',
              quantity:     item.quantity,
              previousStock: prevStock,
              newStock,
              stockType:    'bulk',
              reason:       `Credit note ${cn.creditNumber} — ${reasonType}`,
              customerName: customer.name,
              reference:    cn.creditNumber,
              status:       'Completed',
              notes:        notes || '',
              createdBy:    userId,
              companyId:    companyId || null,
            },
          });
        }
      }

      // 4. Reduce customer AR balance
      await tx.customer.update({
        where: { id: customer.id },
        data: { outstandingBalance: { decrement: amount } },
      });

      // 5. Recompute invoice balances — CN is NOT a cash payment
      const totalCreditedNow = previousCredits + amount;
      const statusUpdate = deriveInvoiceStatusAfterCredit(
        invoice.grandTotal || 0,
        invoice.paidAmount || 0,
        totalCreditedNow,
      );

      await tx.warehouseInvoice.update({
        where: { id: invoice.id },
        data: {
          outstanding: statusUpdate.outstanding,
          invoiceStatus: statusUpdate.invoiceStatus,
          paymentStatus: statusUpdate.paymentStatus,
        },
      });

      return cn;
    });

    // Update account balances outside transaction
    await updateAccountBalances(contraRevenueAccount.id, netAmount, true);
    if (taxAmount > 0) await updateAccountBalances(taxAccount.id, taxAmount, true);
    await updateAccountBalances(arAccount.id, amount, false);

    res.status(201).json({
      success: true,
      data: creditNote,
      message: 'Credit note created successfully',
    });

    // Invalidate cache
    try {
      await delPattern(`cn:list:${userId}:*`);
      await delPattern(`cn:detail:${userId}:*`);
      await delPattern(`cn:summary:${userId}:*`);
      await delPattern(`cn:unpaid-invoices:${userId}:*`);
      await delPattern(`cn:invoices:${userId}:*`);
      await delPattern(`cn:by-number:${userId}:*`);
      console.log('🗑️ [CN] Cache invalidated after credit note creation');
    } catch (e) {
      console.log('⚠️ [CN] Cache invalidation error:', e.message);
    }
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

    const companyId = req.user.companyId;
    // Build cache key with parameters
    const cacheKey = `cn:list:${userId}:${customerId || ''}:${status || ''}:${startDate || ''}:${endDate || ''}:${search || ''}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        ...cached,
        cached: true,
      });
    }

    const filter = {
      OR: [
        { companyId: companyId },
        { companyId: null, createdBy: userId },
      ],
    };

    if (customerId) filter.customerId = customerId;
    if (status) filter.status = status;
    if (startDate && endDate) {
      filter.date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }
    if (search) {
      filter.AND = [
        {
          OR: [
            { creditNumber: { contains: search, mode: 'insensitive' } },
            { customerName: { contains: search, mode: 'insensitive' } },
            { originalInvoiceNumber: { contains: search, mode: 'insensitive' } }
          ]
        }
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

    const responseData = {
      count: creditNotes.length,
      data: creditNotes,
    };

    // Cache the result (5 minutes TTL)
    await set(cacheKey, responseData, 300);

    res.status(200).json({
      success: true,
      ...responseData,
      cached: false,
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

    const companyId = req.user.companyId;
    // Build cache key
    const cacheKey = `cn:detail:${userId}:${id}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const creditNote = await prisma.creditNote.findFirst({
      where: {
        id,
        OR: [
          { companyId: companyId },
          { companyId: null, createdBy: userId },
        ],
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

    // Cache the result (10 minutes TTL)
    await set(cacheKey, creditNote, 600);

    res.status(200).json({
      success: true,
      data: creditNote,
      cached: false,
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

    const companyId = req.user.companyId;
    // Build cache key with parameters
    const cacheKey = `cn:summary:${userId}:${startDate || ''}:${endDate || ''}`;
    
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
      OR: [
        { companyId: companyId },
        { companyId: null, createdBy: userId },
      ],
    };

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

    const summaryData = {
      totalCount,
      totalAmount,
      appliedAmount,
      remainingAmount,
      expiredAmount,
      thisMonth: thisMonth._sum.amount || 0,
      thisMonthCount: thisMonth._count || 0,
      thisWeek: thisWeek._sum.amount || 0,
      thisWeekCount: thisWeek._count || 0,
    };

    // Cache the result (2 minutes TTL)
    await set(cacheKey, summaryData, 120);

    res.status(200).json({
      success: true,
      data: summaryData,
      cached: false,
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
  console.log('📦 [CN] getInvoicesForCreditNote called');
  console.log('🔍 [CN] Customer ID:', req.params.customerId);

  try {
    const { customerId } = req.params;
    const userId    = req.user.id;
    const companyId = req.user.companyId;

    const cacheKey = `cn:invoices:${userId}:${customerId}`;
    const cached   = await get(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, ...cached, cached: true });
    }

    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        OR: [
          { companyId: companyId },
          { createdBy: userId },
        ],
      },
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // ─── Fetch ALL invoices for this customer (paid AND unpaid) ───────────
    // ERP rule: credit notes can be issued on paid invoices (e.g., returns after payment)
    const invoices = await prisma.warehouseInvoice.findMany({
      where: {
        customerId,
        isDeleted: false,
        invoiceStatus: { not: 'Cancelled' },
        OR: [
          { companyId: companyId },
          { companyId: null, createdBy: userId },
        ],
      },
      orderBy: { invoiceDate: 'desc' },
      include: {
        items: {
          select: {
            id: true,
            productId: true,
            productName: true,
            sku: true,
            quantity: true,
            unitPrice: true,
            taxRate: true,
            taxAmount: true,
            discount: true,
            totalPrice: true,
          },
        },
        creditNotes: {
          where: { status: { notIn: ['Cancelled', 'Voided'] } },
          select: { id: true, creditNumber: true, amount: true, status: true, date: true },
        },
      },
    });

    // ─── For each invoice, compute eligibleCredit ─────────────────────────
    const mappedInvoices = invoices.map(invoice => {
      const grandTotal      = invoice.grandTotal || 0;
      const paidAmount      = invoice.paidAmount || 0;
      const totalCredited   = (invoice.creditNotes || []).reduce((s, cn) => s + cn.amount, 0);
      const eligibleCredit  = Math.max(0, grandTotal - totalCredited);

      // Effective outstanding = grandTotal - paid - credited
      const effectiveOutstanding = invoice.outstanding > 0
        ? invoice.outstanding
        : Math.max(0, grandTotal - paidAmount);

      return {
        id:               invoice.id,
        invoiceNumber:    invoice.invoiceNumber,
        invoiceDate:      invoice.invoiceDate,
        dueDate:          invoice.dueDate,
        amount:           grandTotal,                // invoice total
        paidAmount,
        outstanding:      effectiveOutstanding,
        totalCredited,
        eligibleCredit,                              // ← key ERP field
        creditNotes:      invoice.creditNotes || [],
        status:           invoice.paymentStatus,
        invoiceStatus:    invoice.invoiceStatus,
        customerName:     invoice.customerName,
        items:            invoice.items,
        taxTotal:         invoice.taxTotal || 0,
        subtotal:         invoice.subtotal || 0,
      };
    });

    // Only show invoices relevant to the caller's purpose
    const purpose = req.query.purpose || 'create';
    const filteredInvoices = purpose === 'apply'
      ? mappedInvoices.filter(inv => inv.outstanding > 0)
      : mappedInvoices.filter(inv => inv.eligibleCredit > 0);

    const responseData = { count: filteredInvoices.length, data: filteredInvoices };

    await set(cacheKey, responseData, 120); // shorter TTL since eligibleCredit changes

    res.status(200).json({ success: true, ...responseData, cached: false });

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
    const { creditNoteId, invoiceId, amount, applications } = req.body;
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const postingDate = new Date();

    // Support single or multi-invoice application (backward compatible)
    const appList = Array.isArray(applications) && applications.length > 0
      ? applications
      : [{ invoiceId, amount }];

    if (!creditNoteId || appList.some(a => !a.invoiceId || !a.amount || a.amount <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'Valid credit note ID and application amounts are required',
      });
    }

    const totalApplyAmount = appList.reduce((s, a) => s + parseFloat(a.amount), 0);
    if (totalApplyAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Total apply amount must be greater than 0' });
    }

    try {
      await fiscalYearGuard(userId, postingDate);
    } catch (err) {
      if (err.code === 'FISCAL_YEAR_CLOSED') {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }

    const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

    const creditNote = await prisma.creditNote.findFirst({
      where: {
        id: creditNoteId,
        OR: [
          { companyId: companyId },
          { companyId: null, createdBy: userId },
        ],
      },
    });

    if (!creditNote) {
      return res.status(404).json({ success: false, message: 'Credit note not found' });
    }

    if (['Applied', 'Expired', 'Voided', 'Cancelled'].includes(creditNote.status)) {
      return res.status(400).json({
        success: false,
        message: `Credit note cannot be applied (status: ${creditNote.status})`,
      });
    }

    if (new Date() > new Date(creditNote.expiryDate)) {
      return res.status(400).json({
        success: false,
        message: 'Credit note has expired and cannot be applied',
      });
    }

    if (totalApplyAmount > creditNote.remainingAmount) {
      return res.status(400).json({
        success: false,
        message: `Total apply amount (${totalApplyAmount}) exceeds remaining credit (${creditNote.remainingAmount})`,
      });
    }

    const existingApps = Array.isArray(creditNote.appliedToInvoices)
      ? creditNote.appliedToInvoices
      : [];

    const arAccount = await getOrCreateReceivableAccount(userId, companyId);
    const customerCreditAccount = await getOrCreateCustomerCreditAccount(userId, companyId);

    await prisma.$transaction(async (tx) => {
      const newAppliedEntries = [];

      for (const app of appList) {
        const applyAmount = parseFloat(app.amount);

        // Prevent duplicate application to same invoice
        const alreadyApplied = existingApps.some(
          e => e.invoiceId === app.invoiceId && e.amount > 0
        );
        if (alreadyApplied) {
          throw new Error(`Credit note already applied to invoice ${app.invoiceId}`);
        }

        const invoice = await tx.warehouseInvoice.findFirst({
          where: {
            id: app.invoiceId,
            customerId: creditNote.customerId,
            isDeleted: false,
            invoiceStatus: { not: 'Cancelled' },
            OR: [
              { companyId: companyId },
              { companyId: null, createdBy: userId },
            ],
          },
        });

        if (!invoice) {
          throw new Error(`Invoice not found or does not belong to this customer`);
        }

        const invoiceOutstanding = computeInvoiceOutstanding(invoice);
        if (applyAmount > invoiceOutstanding) {
          throw new Error(
            `Amount ${applyAmount} exceeds invoice ${invoice.invoiceNumber} outstanding (${invoiceOutstanding})`
          );
        }

        // Get total credits already on this invoice for status calc
        const creditsOnInvoice = await tx.creditNote.aggregate({
          where: {
            originalInvoiceId: invoice.id,
            status: { notIn: ['Cancelled', 'Voided'] },
          },
          _sum: { amount: true },
        });
        const totalCredited = creditsOnInvoice._sum.amount || 0;

        const statusUpdate = deriveInvoiceStatusAfterCredit(
          invoice.grandTotal,
          invoice.paidAmount + applyAmount, // credit applied reduces effective outstanding
          totalCredited,
        );

        await tx.warehouseInvoice.update({
          where: { id: invoice.id },
          data: {
            outstanding: Math.max(0, invoiceOutstanding - applyAmount),
            paymentStatus: statusUpdate.paymentStatus,
            invoiceStatus: statusUpdate.invoiceStatus,
          },
        });

        newAppliedEntries.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          amount: applyAmount,
          appliedAt: new Date().toISOString(),
        });
      }

      const newAppliedAmount = creditNote.appliedAmount + totalApplyAmount;
      const newRemainingAmount = creditNote.remainingAmount - totalApplyAmount;
      const newStatus = newRemainingAmount === 0 ? 'Applied' : 'PartiallyApplied';

      await tx.creditNote.update({
        where: { id: creditNoteId },
        data: {
          appliedAmount: newAppliedAmount,
          remainingAmount: newRemainingAmount,
          status: newStatus,
          appliedToInvoices: [...existingApps, ...newAppliedEntries],
        },
      });

      // AR netting entry — no duplicate revenue impact
      // Dr Customer Credit Balance  Cr Accounts Receivable
      await tx.journalEntry.create({
        data: {
          entryNumber: `JE-APPLY-${Date.now()}`,
          date: postingDate,
          description: `Applied credit note ${creditNote.creditNumber} to ${newAppliedEntries.length} invoice(s)`,
          reference: creditNote.creditNumber,
          status: 'Posted',
          createdBy: userId,
          postedBy: userId,
          fiscalYearId,
          companyId,
          postedAt: new Date(),
          lines: {
            create: [
              {
                accountId: customerCreditAccount.id,
                accountName: customerCreditAccount.name,
                accountCode: customerCreditAccount.code,
                debit: totalApplyAmount,
                credit: 0,
                isReconciled: false,
              },
              {
                accountId: arAccount.id,
                accountName: arAccount.name,
                accountCode: arAccount.code,
                debit: 0,
                credit: totalApplyAmount,
                isReconciled: false,
              },
            ],
          },
        },
      });

      await tx.customer.update({
        where: { id: creditNote.customerId },
        data: { outstandingBalance: { increment: totalApplyAmount } },
      });
    });

    await updateAccountBalances(customerCreditAccount.id, totalApplyAmount, true);
    await updateAccountBalances(arAccount.id, totalApplyAmount, false);

    res.status(200).json({
      success: true,
      message: 'Credit note applied successfully',
    });

    try {
      await delPattern(`cn:list:${userId}:*`);
      await delPattern(`cn:detail:${userId}:${creditNoteId}`);
      await delPattern(`cn:summary:${userId}:*`);
      await delPattern(`cn:unpaid-invoices:${userId}:*`);
      await delPattern(`cn:invoices:${userId}:*`);
    } catch (e) {
      console.log('⚠️ [CN] Cache invalidation error:', e.message);
    }
  } catch (error) {
    console.error('❌ [CN] Apply credit note error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error applying credit note',
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

    const companyId = req.user.companyId;
    const expiredNotes = await prisma.creditNote.findMany({
      where: {
        companyId: companyId,
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

    // Invalidate cache after successful credit note expiration
    try {
      await delPattern(`cn:list:${userId}:*`);
      await delPattern(`cn:summary:${userId}:*`);
      console.log('🗑️ [CN] Cache invalidated after credit note expiration');
    } catch (cacheError) {
      console.log('⚠️ [CN] Cache invalidation error:', cacheError.message);
    }
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

    const companyId = req.user.companyId;
    const creditNote = await prisma.creditNote.findFirst({
      where: {
        id,
        companyId: companyId}
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

    // Invalidate cache after successful credit note deletion
    try {
      await delPattern(`cn:list:${userId}:*`);
      await delPattern(`cn:detail:${userId}:${id}`);
      await delPattern(`cn:summary:${userId}:*`);
      await delPattern(`cn:unpaid-invoices:${userId}:*`);
      await delPattern(`cn:by-number:${userId}:*`);
      console.log('🗑️ [CN] Cache invalidated after credit note deletion');
    } catch (cacheError) {
      console.log('⚠️ [CN] Cache invalidation error:', cacheError.message);
    }
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

    const companyId = req.user.companyId;
    const creditNote = await prisma.creditNote.findFirst({
      where: {
        id,
        companyId: companyId}
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

    // Invalidate cache after successful credit note void
    try {
      await delPattern(`cn:list:${userId}:*`);
      await delPattern(`cn:detail:${userId}:${id}`);
      await delPattern(`cn:summary:${userId}:*`);
      await delPattern(`cn:unpaid-invoices:${userId}:*`);
      await delPattern(`cn:by-number:${userId}:*`);
      console.log('🗑️ [CN] Cache invalidated after credit note void');
    } catch (cacheError) {
      console.log('⚠️ [CN] Cache invalidation error:', cacheError.message);
    }
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

    const companyId = req.user.companyId;
    // Build cache key
    const cacheKey = `cn:by-number:${userId}:${creditNumber}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const creditNote = await prisma.creditNote.findFirst({
      where: {
        creditNumber: creditNumber,
        companyId: companyId},
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

    // Cache the result (10 minutes TTL)
    await set(cacheKey, creditNote, 600);

    res.status(200).json({
      success: true,
      data: creditNote,
      cached: false,
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