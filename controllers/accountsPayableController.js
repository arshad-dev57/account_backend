const prisma = require('../prisma/client');
const { getCompanyFiscalYear } = require('../utils/fiscalYearHelper');
const { getOrCreateCashAccount } = require('../utils/cashAccountHelper');
const { getOrCreateApAccount } = require('../utils/apAccountHelper');

async function applyBillFiscalYearDateFilter(filter, companyId, fiscalYearId) {
  if (!fiscalYearId) return;
  const fy = await getCompanyFiscalYear(companyId, fiscalYearId);
  if (!fy) return;
  const fyRange = {
    gte: new Date(fy.startDate),
    lte: new Date(fy.endDate)
  };
  if (filter.date?.gte || filter.date?.lte) {
    filter.date = {
      gte: filter.date.gte && filter.date.gte > fyRange.gte ? filter.date.gte : fyRange.gte,
      lte: filter.date.lte && filter.date.lte < fyRange.lte ? filter.date.lte : fyRange.lte
    };
  } else {
    filter.date = fyRange;
  }
}

async function getOrCreatePayableAccount(userId, companyId, tx) {
  return getOrCreateApAccount(userId, companyId, tx);
}

// ─── HELPER: Get or create Expense account ────────────────────────
async function getOrCreateExpenseAccount(userId, companyId, tx) {
  const db = tx || prisma;
  console.log('🔍 [AP] Getting/Creating Expense account');

  let expenseAccount = await db.chartOfAccount.findFirst({
    where: {
      code: '5000',
      companyId: companyId
    }
  });

  if (!expenseAccount) {
    console.log('📝 [AP] Creating new Expense account');
    expenseAccount = await db.chartOfAccount.create({
      data: {
        code: '5000',
        name: 'Expense Account',
        type: 'Expense',
        parentAccount: 'Operating Expenses',
        openingBalance: 0,
        currentBalance: 0,
        description: 'General expenses',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId,
        companyId: companyId
      }
    });
    console.log('✅ [AP] Expense account created:', expenseAccount.id);
  } else {
    console.log('✅ [AP] Expense account found:', expenseAccount.id);
  }

  return expenseAccount;
}

// ─── HELPER: Generate bill number - FIXED ─────────────────────────────────
async function generateBillNumber(companyId, attemptOffset = 0, tx = null) {
  if (!companyId) {
    throw new Error('companyId is required to generate a bill number');
  }

  const db = tx || prisma;
  const prefix = 'BILL-';

  // Serialize bill-number allocation per company (prevents Vercel race → same BILL-0001)
  if (tx) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`bill-seq:${companyId}`}))
    `;
  }

  const existingBills = await db.bill.findMany({
    where: {
      companyId,
      billNumber: { startsWith: prefix }
    },
    select: { billNumber: true }
  });

  let maxNumber = 0;
  for (const bill of existingBills) {
    const match = String(bill.billNumber || '').match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNumber) maxNumber = num;
    }
  }

  const nextNumber = maxNumber + 1 + attemptOffset;
  const billNumber = `${prefix}${String(nextNumber).padStart(4, '0')}`;

  console.log(
    `🔍 [AP] Bill# gen company=${companyId} existing=${existingBills.length} max=${maxNumber} offset=${attemptOffset} → ${billNumber}`
  );
  return billNumber;
}

// ─── HELPER: Generate fallback bill number ─────────────────────────────────
async function generateFallbackBillNumber(companyId) {
  const short = String(companyId || 'X').replace(/-/g, '').slice(0, 6).toUpperCase();
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  // Company fragment avoids cross-tenant collisions even if a global unique still exists
  return `BILL-${short}-${stamp}${random}`.slice(0, 32);
}

// ─── HELPER: Validate bank account ────────────────────────────────
async function validateBankAccount(bankAccountId, companyId, tx) {
  const db = tx || prisma;
  if (!bankAccountId) return null;

  const bankAccount = await db.bankAccount.findFirst({
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
    throw new Error('Bank account not found');
  }
  return bankAccount;
}

// ─── HELPER: Determine bill status ───────────────────────────────
function determineBillStatus(totalAmount, paidAmount, dueDate) {
  const outstanding = totalAmount - paidAmount;
  if (outstanding <= 0) return 'Paid';
  if (paidAmount > 0 && outstanding > 0) return 'Partial';
  if (new Date(dueDate) < new Date() && outstanding > 0) return 'Overdue';
  return 'Unpaid';
}

const purchasePaymentInclude = {
  purchasePayments: {
    where: {
      payment: {
        isActive: true,
        isDeleted: false,
        status: 'Completed'
      }
    },
    select: { amountPaid: true }
  }
};

function computePurchaseOpenBalance(inv) {
  const grandTotal = Number(inv.grandTotal) || 0;
  const paidFromPayments = (inv.purchasePayments || []).reduce(
    (s, p) => s + (Number(p.amountPaid) || 0),
    0
  );
  const paidAmount = Math.max(Number(inv.paidAmount) || 0, paidFromPayments);
  const outstanding = Math.max(0, grandTotal - paidAmount);
  return { grandTotal, paidAmount, outstanding };
}

function purchaseInvoiceToBillShape(inv) {
  const { grandTotal, paidAmount, outstanding } = computePurchaseOpenBalance(inv);
  let status = 'Unpaid';
  if (outstanding <= 0) status = 'Paid';
  else if (paidAmount > 0) status = 'Partial';
  else if (inv.dueDate && new Date(inv.dueDate) < new Date()) status = 'Overdue';

  return {
    id: inv.id,
    billNumber: inv.invoiceNumber,
    vendorId: inv.supplierId,
    vendorName: inv.supplierName || '',
    vendor: inv.supplier
      ? {
          id: inv.supplier.id,
          name: inv.supplier.name,
          email: inv.supplier.email,
          phone: inv.supplier.phone
        }
      : {
          id: inv.supplierId,
          name: inv.supplierName || ''
        },
    date: inv.invoiceDate,
    dueDate: inv.dueDate,
    items: (inv.items || []).map((i) => ({
      description: i.productName || i.sku || '',
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      amount: i.lineTotal,
      taxRate: i.taxRate,
      taxAmount: i.taxAmount
    })),
    subtotal: inv.subtotal || 0,
    taxTotal: inv.taxTotal || 0,
    discount: inv.discountTotal || 0,
    totalAmount: grandTotal,
    paidAmount,
    outstanding,
    status,
    notes: inv.notes || '',
    source: 'purchaseInvoice',
    invoiceStatus: inv.invoiceStatus,
    paymentStatus: inv.paymentStatus
  };
}

function billOpenBalance(bill) {
  const totalAmount = Number(bill.totalAmount) || 0;
  const paidAmount = Number(bill.paidAmount) || 0;
  return {
    totalAmount,
    paidAmount,
    outstanding: Math.max(0, totalAmount - paidAmount)
  };
}

function billToResponseShape(bill) {
  const { totalAmount, paidAmount, outstanding } = billOpenBalance(bill);
  const vendor = bill.vendor || {};
  return {
    ...bill,
    supplierId: bill.vendorId || vendor.id,
    supplierName: bill.vendorName || vendor.name || '',
    totalAmount,
    paidAmount,
    outstanding,
    source: bill.source || 'bill'
  };
}

function computeOpenPayablesSummary(openPayables) {
  const now = new Date();
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const totalOutstanding = openPayables.reduce(
    (sum, doc) => sum + (Number(doc.outstanding) || 0),
    0
  );

  const overdue = openPayables
    .filter((doc) => doc.dueDate && new Date(doc.dueDate) < now && doc.status !== 'Paid')
    .reduce((sum, doc) => sum + (Number(doc.outstanding) || 0), 0);

  const dueThisWeek = openPayables
    .filter(
      (doc) =>
        doc.dueDate &&
        new Date(doc.dueDate) >= now &&
        new Date(doc.dueDate) <= endOfWeek &&
        doc.status !== 'Paid'
    )
    .reduce((sum, doc) => sum + (Number(doc.outstanding) || 0), 0);

  const dueThisMonth = openPayables
    .filter(
      (doc) =>
        doc.dueDate &&
        new Date(doc.dueDate) >= now &&
        new Date(doc.dueDate) <= endOfMonth &&
        doc.status !== 'Paid'
    )
    .reduce((sum, doc) => sum + (Number(doc.outstanding) || 0), 0);

  return {
    totalOutstanding,
    overdue,
    dueThisWeek,
    dueThisMonth,
    totalBills: openPayables.length
  };
}

async function fetchCompanyPurchaseInvoices(companyId, extraWhere = {}) {
  return prisma.purchaseInvoice.findMany({
    where: {
      companyId,
      isActive: true,
      isDeleted: false,
      invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
      ...extraWhere
    },
    include: {
      supplier: {
        select: { id: true, name: true, email: true, phone: true }
      },
      items: true,
      ...purchasePaymentInclude
    },
    orderBy: { invoiceDate: 'desc' }
  });
}

// ============================================================
// ✅ BILL NUMBER GENERATION
// ============================================================

// @desc    Get next bill number
// @route   GET /api/accounts-payable/next-bill-number
// @access  Private
exports.getNextBillNumber = async (req, res) => {
  console.log('📦 [AP] getNextBillNumber called');

  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const billNumber = await generateBillNumber(companyId);

    res.status(200).json({
      success: true,
      data: { billNumber }
    });
  } catch (error) {
    console.error('❌ [AP] Get next bill number error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// ✅ SUPPLIER FUNCTIONS
// ============================================================

// @desc    Get all suppliers
// @route   GET /api/accounts-payable/suppliers
// @access  Private
exports.getSuppliers = async (req, res) => {
  console.log('📦 [AP] getSuppliers called');

  try {
    const { search, status } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const filter = { companyId: companyId };

    if (search) {
      filter.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (status === 'active') {
      filter.status = 'active';
    } else if (status === 'inactive') {
      filter.status = 'inactive';
    }

    const suppliers = await prisma.supplier.findMany({
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

    const [bills, purchaseInvoices] = await Promise.all([
      prisma.bill.findMany({
        where: { companyId }
      }),
      fetchCompanyPurchaseInvoices(companyId)
    ]);

    const openDocs = [
      ...bills.map((bill) => {
        const { totalAmount, paidAmount, outstanding } = billOpenBalance(bill);
        return {
          supplierId: bill.vendorId,
          totalAmount,
          paidAmount,
          outstanding
        };
      }),
      ...purchaseInvoices.map((inv) => {
        const { grandTotal, paidAmount, outstanding } = computePurchaseOpenBalance(inv);
        return {
          supplierId: inv.supplierId,
          totalAmount: grandTotal,
          paidAmount,
          outstanding
        };
      })
    ];

    const suppliersWithOutstanding = suppliers.map((supplier) => {
      const docs = openDocs.filter((d) => d.supplierId === supplier.id);
      const outstandingDocs = docs.filter((d) => d.outstanding > 0);
      const totalAmount = outstandingDocs.reduce((sum, d) => sum + d.totalAmount, 0);
      const paidAmount = outstandingDocs.reduce((sum, d) => sum + d.paidAmount, 0);
      const outstandingAmount = outstandingDocs.reduce(
        (sum, d) => sum + d.outstanding,
        0
      );

      return {
        ...supplier,
        totalAmount,
        paidAmount,
        outstandingAmount,
        billCount: outstandingDocs.length
      };
    });

    res.status(200).json({
      success: true,
      count: suppliersWithOutstanding.length,
      data: suppliersWithOutstanding
    });
  } catch (error) {
    console.error('❌ [AP] Get suppliers error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single supplier
// @route   GET /api/accounts-payable/suppliers/:id
// @access  Private
exports.getSupplier = async (req, res) => {
  console.log('📦 [AP] getSupplier called');

  try {
    const { id } = req.params;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const supplier = await prisma.supplier.findFirst({
      where: {
        id,
        companyId: companyId
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

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    const [bills, purchaseInvoices] = await Promise.all([
      prisma.bill.findMany({
        where: {
          vendorId: supplier.id,
          companyId: companyId
        },
        orderBy: { date: 'desc' }
      }),
      fetchCompanyPurchaseInvoices(companyId, { supplierId: supplier.id })
    ]);

    const mappedBills = [
      ...bills,
      ...purchaseInvoices.map(purchaseInvoiceToBillShape)
    ];

    const totalAmount = mappedBills.reduce(
      (sum, bill) => sum + (Number(bill.totalAmount) || 0),
      0
    );
    const paidAmount = mappedBills.reduce(
      (sum, bill) => sum + (Number(bill.paidAmount) || 0),
      0
    );
    const outstandingAmount = mappedBills.reduce((sum, bill) => {
      const out =
        bill.outstanding != null
          ? Number(bill.outstanding)
          : Number(bill.totalAmount || 0) - Number(bill.paidAmount || 0);
      return sum + Math.max(0, out);
    }, 0);

    const supplierData = {
      ...supplier,
      bills: mappedBills,
      totalAmount,
      paidAmount,
      outstandingAmount
    };

    res.status(200).json({
      success: true,
      data: supplierData
    });
  } catch (error) {
    console.error('❌ [AP] Get supplier error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// BILL CRUD
// ============================================================

// @desc    Create bill
// @route   POST /api/accounts-payable/bills
// @access  Private
exports.createBill = async (req, res) => {
  console.log('📦 [AP] createBill called [bill-seq-v2]');

  try {
    const { supplierId, date, dueDate, items, discount, notes } = req.body;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID missing from session. Please log out and log in again.'
      });
    }

    // Validate supplier
    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, companyId: companyId }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found. Please add supplier from warehouse first.'
      });
    }

    // Calculate totals
    let subtotal = 0;
    let taxTotal = 0;
    const processedItems = items.map(item => {
      const amount = item.quantity * item.unitPrice;
      const taxAmount = amount * ((item.taxRate || 0) / 100);
      subtotal += amount;
      taxTotal += taxAmount;
      return {
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount,
        taxRate: item.taxRate || 0,
        taxAmount
      };
    });

    const totalAmount = subtotal + taxTotal - (discount || 0);
    const finalDueDate = dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const status = determineBillStatus(totalAmount, 0, finalDueDate);

    // ─── Retry loop handles race condition ───────────────────────
    const MAX_ATTEMPTS = 5;
    let result = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        result = await prisma.$transaction(async (tx) => {
          // Allocate number INSIDE the tx under advisory lock
          const billNumber =
            attempt === MAX_ATTEMPTS
              ? await generateFallbackBillNumber(companyId)
              : await generateBillNumber(companyId, attempt - 1, tx);

          console.log(`🔍 [AP] Attempt ${attempt}: creating ${billNumber}`);

          const bill = await tx.bill.create({
            data: {
              billNumber,
              vendorId: supplier.id,
              vendorName: supplier.name,
              date: date ? new Date(date) : new Date(),
              dueDate: finalDueDate,
              items: processedItems,
              subtotal,
              taxTotal,
              discount: discount || 0,
              totalAmount,
              paidAmount: 0,
              outstanding: totalAmount,
              status,
              notes: notes || '',
              posted: true,
              postedAt: new Date(),
              createdBy: userId,
              companyId: companyId
            },
            include: {
              vendor: { select: { id: true, name: true, email: true, phone: true } },
              creator: { select: { id: true, firstName: true, lastName: true, email: true } }
            }
          });

          console.log(`✅ [AP] Bill created: ${bill.billNumber}`);

          const apAccount = await getOrCreatePayableAccount(userId, companyId, tx);
          const expenseAccount = await getOrCreateExpenseAccount(userId, companyId, tx);

          const billJe = await tx.journalEntry.create({
            data: {
              entryNumber: `JE-${Date.now()}-${attempt}`,
              date: new Date(),
              description: `Bill ${bill.billNumber} - ${supplier.name}`,
              reference: bill.billNumber,
              status: 'Posted',
              createdBy: userId,
              postedBy: userId,
              postedAt: new Date(),
              companyId: companyId,
              lines: {
                create: [
                  {
                    accountId: expenseAccount.id,
                    accountName: expenseAccount.name,
                    accountCode: expenseAccount.code,
                    debit: totalAmount,
                    credit: 0,
                    isReconciled: false
                  },
                  {
                    accountId: apAccount.id,
                    accountName: apAccount.name,
                    accountCode: apAccount.code,
                    debit: 0,
                    credit: totalAmount,
                    isReconciled: false
                  }
                ]
              }
            },
            include: { lines: true }
          });

          const BalanceCalculator = require('../utils/balanceCalculator');
          await BalanceCalculator.applyJournalLines(tx, billJe.lines);

          return bill;
        });

        break;

      } catch (txError) {
        if (txError.code === 'P2002' && attempt < MAX_ATTEMPTS) {
          console.log(`⚠️ [AP] Bill number collision, retrying (${attempt}/${MAX_ATTEMPTS}):`, txError.meta);
          continue;
        }
        throw txError;
      }
    }

    if (!result) {
      throw new Error('Failed to generate a unique bill number after multiple attempts');
    }

res.status(201).json({
      success: true,
      data: result,
      message: 'Bill created successfully. AP balance updated.'
    });

  } catch (error) {
    console.error('❌ [AP] Create bill error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
// @desc    Get all bills
// @route   GET /api/accounts-payable/bills
// @access  Private
exports.getBills = async (req, res) => {
  console.log('📦 [AP] getBills called');

  try {
    const { supplierId, status, startDate, endDate, fiscalYearId } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const filter = { companyId: companyId };

    if (supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: {
          id: supplierId,
          companyId: companyId
        }
      });
      if (supplier) {
        filter.vendorId = supplierId;
      }
    }

    if (status) {
      filter.status = status;
    }

    if (startDate && endDate) {
      filter.date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    await applyBillFiscalYearDateFilter(filter, companyId, fiscalYearId);

    const piWhere = {};
    if (supplierId) piWhere.supplierId = supplierId;
    if (startDate && endDate) {
      piWhere.invoiceDate = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    } else if (filter.date) {
      piWhere.invoiceDate = filter.date;
    }

    const [bills, purchaseInvoices] = await Promise.all([
      prisma.bill.findMany({
        where: filter,
        orderBy: { date: 'desc' },
        include: {
          vendor: {
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
          },
          paymentsMade: {
            select: {
              id: true,
              paymentNumber: true,
              amount: true,
              paymentDate: true,
              status: true
            }
          }
        }
      }),
      fetchCompanyPurchaseInvoices(companyId, piWhere)
    ]);

    let mapped = [
      ...bills,
      ...purchaseInvoices.map(purchaseInvoiceToBillShape)
    ];

    if (status) {
      mapped = mapped.filter(
        (b) => String(b.status).toLowerCase() === String(status).toLowerCase()
      );
    }

    mapped.sort((a, b) => new Date(b.date) - new Date(a.date));

    const shaped = mapped.map((row) =>
      row.source === 'purchaseInvoice' ? row : billToResponseShape(row)
    );

    const openPayables = shaped.filter((doc) => (Number(doc.outstanding) || 0) > 0);
    const summary = computeOpenPayablesSummary(openPayables);

    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const total = shaped.length;
    const pages = Math.max(1, Math.ceil(total / limitNum));
    const start = (pageNum - 1) * limitNum;
    const paged = shaped.slice(start, start + limitNum);

    res.status(200).json({
      success: true,
      count: total,
      data: paged,
      summary,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages,
        hasNext: pageNum < pages,
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('❌ [AP] Get bills error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single bill
// @route   GET /api/accounts-payable/bills/:id
// @access  Private
exports.getBill = async (req, res) => {
  console.log('📦 [AP] getBill called');

  try {
    const { id } = req.params;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const bill = await prisma.bill.findFirst({
      where: {
        id,
        companyId: companyId
      },
      include: {
        vendor: {
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
        },
        paymentsMade: {
          select: {
            id: true,
            paymentNumber: true,
            amount: true,
            paymentDate: true,
            status: true
          }
        }
      }
    });

    if (!bill) {
      const purchaseInvoice = await prisma.purchaseInvoice.findFirst({
        where: {
          id,
          companyId,
          isActive: true,
          isDeleted: false
        },
        include: {
          supplier: {
            select: { id: true, name: true, email: true, phone: true }
          },
          items: true,
          ...purchasePaymentInclude
        }
      });

      if (!purchaseInvoice) {
        return res.status(404).json({
          success: false,
          message: 'Bill not found'
        });
      }

      return res.status(200).json({
        success: true,
        data: purchaseInvoiceToBillShape(purchaseInvoice)
      });
    }

    res.status(200).json({
      success: true,
      data: bill
    });
  } catch (error) {
    console.error('❌ [AP] Get bill error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update bill
// @route   PUT /api/accounts-payable/bills/:id
// @access  Private
exports.updateBill = async (req, res) => {
  console.log('📦 [AP] updateBill called');

  try {
    const { id } = req.params;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const existing = await prisma.bill.findFirst({
      where: {
        id,
        companyId: companyId
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    if (existing.status === 'Paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update a paid bill'
      });
    }

    const {
      date,
      dueDate,
      items,
      discount,
      notes,
      status
    } = req.body;

    let subtotal = existing.subtotal;
    let taxTotal = existing.taxTotal;
    let totalAmount = existing.totalAmount;
    let processedItems = existing.items;

    if (items && items.length > 0) {
      subtotal = 0;
      taxTotal = 0;
      processedItems = items.map(item => {
        const amount = item.quantity * item.unitPrice;
        const taxAmount = amount * ((item.taxRate || 0) / 100);
        subtotal += amount;
        taxTotal += taxAmount;

        return {
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: amount,
          taxRate: item.taxRate || 0,
          taxAmount: taxAmount
        };
      });
      totalAmount = subtotal + taxTotal - (discount || existing.discount || 0);
    }

    const updateData = {
      date: date ? new Date(date) : existing.date,
      dueDate: dueDate ? new Date(dueDate) : existing.dueDate,
      items: processedItems,
      subtotal,
      taxTotal,
      discount: discount !== undefined ? discount : existing.discount,
      totalAmount,
      notes: notes !== undefined ? notes : existing.notes,
      status: status || existing.status
    };

    if (totalAmount !== existing.totalAmount) {
      updateData.status = determineBillStatus(totalAmount, existing.paidAmount, updateData.dueDate);
    }

    const updated = await prisma.bill.update({
      where: { id },
      data: updateData,
      include: {
        vendor: {
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
      data: updated,
      message: 'Bill updated successfully'
    });
  } catch (error) {
    console.error('❌ [AP] Update bill error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete bill
// @route   DELETE /api/accounts-payable/bills/:id
// @access  Private
exports.deleteBill = async (req, res) => {
  console.log('📦 [AP] deleteBill called');

  try {
    const { id } = req.params;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const bill = await prisma.bill.findFirst({
      where: {
        id,
        companyId: companyId
      }
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    if (bill.status === 'Paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete a paid bill'
      });
    }

    const payments = await prisma.paymentMade.findMany({
      where: {
        billId: id,
        companyId: companyId
      }
    });

    if (payments.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete bill with existing payments'
      });
    }

    await prisma.bill.delete({
      where: { id }
    });

res.status(200).json({
      success: true,
      message: 'Bill deleted successfully'
    });
  } catch (error) {
    console.error('❌ [AP] Delete bill error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// PAYMENT FUNCTIONS
// ============================================================

// @desc    Record payment against bill
// @route   POST /api/accounts-payable/payments
// @access  Private
exports.recordPayment = async (req, res) => {
  console.log('📦 [AP] recordPayment called');

  try {
    const {
      billId,
      amount,
      paymentDate,
      paymentMethod,
      reference,
      bankAccountId
    } = req.body;

    const userId = req.user.id;
    const companyId = req.user.companyId;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be greater than zero'
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findFirst({
        where: { id: billId, companyId: companyId },
        include: { vendor: true }
      });

      if (!bill) {
        throw new Error('Bill not found');
      }

      const outstanding = bill.totalAmount - bill.paidAmount;
      if (amount > outstanding) {
        throw new Error(`Payment amount cannot exceed outstanding balance of ${outstanding}`);
      }

      const newPaidAmount = bill.paidAmount + amount;
      const newOutstanding = bill.totalAmount - newPaidAmount;
      const newStatus = determineBillStatus(bill.totalAmount, newPaidAmount, bill.dueDate);

      const updatedBill = await tx.bill.update({
        where: { id: billId },
        data: {
          paidAmount: newPaidAmount,
          outstanding: newOutstanding,
          status: newStatus
        }
      });

      const apAccount = await getOrCreatePayableAccount(userId, companyId, tx);
      let debitAccount;
      let bankAccountData = null;

      if (bankAccountId && String(paymentMethod || '').toLowerCase() !== 'cash') {
        bankAccountData = await validateBankAccount(bankAccountId, companyId, tx);
        if (bankAccountData && bankAccountData.chartOfAccount) {
          debitAccount = bankAccountData.chartOfAccount;
        }
      }

      if (!debitAccount) {
        debitAccount = await getOrCreateCashAccount(userId, companyId, tx);
      }

      const paymentEntry = await tx.journalEntry.create({
        data: {
          entryNumber: `JE-${Date.now()}`,
          date: paymentDate ? new Date(paymentDate) : new Date(),
          description: `Payment made for ${bill.billNumber} to ${bill.vendor.name}`,
          reference: reference || `PAY-${bill.billNumber}`,
          status: 'Posted',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          companyId: companyId,
          lines: {
            create: [
              {
                accountId: apAccount.id,
                accountName: apAccount.name,
                accountCode: apAccount.code,
                debit: amount,
                credit: 0,
                isReconciled: false
              },
              {
                accountId: debitAccount.id,
                accountName: debitAccount.name,
                accountCode: debitAccount.code,
                debit: 0,
                credit: amount,
                isReconciled: false
              }
            ]
          }
        },
        include: { lines: true }
      });

      const BalanceCalculator = require('../utils/balanceCalculator');
      await BalanceCalculator.applyJournalLines(tx, paymentEntry.lines);

      if (bankAccountData) {
        const newBankBalance = Number(bankAccountData.currentBalance) - amount;
        await tx.bankAccount.update({
          where: { id: bankAccountData.id },
          data: { currentBalance: newBankBalance }
        });
      }

      const paymentNumber = `PMT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const paymentRecord = await tx.paymentMade.create({
        data: {
          paymentNumber,
          paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
          supplierId: bill.vendorId,
          supplierName: bill.vendor.name,
          billId: bill.id,
          billNumber: bill.billNumber,
          billAmount: bill.totalAmount,
          amount: amount,
          paymentMethod: paymentMethod || 'Bank Transfer',
          reference: reference || '',
          bankAccountId: bankAccountData?.id || null,
          bankAccountName: bankAccountData?.accountName || '',
          notes: '',
          status: 'Cleared',
          createdBy: userId,
          companyId: companyId
        }
      });

      return { updatedBill, paymentRecord };
    });

res.status(200).json({
      success: true,
      data: {
        bill: {
          id: result.updatedBill.id,
          billNumber: result.updatedBill.billNumber,
          paidAmount: result.updatedBill.paidAmount,
          outstanding: result.updatedBill.outstanding,
          status: result.updatedBill.status
        },
        payment: {
          id: result.paymentRecord.id,
          paymentNumber: result.paymentRecord.paymentNumber,
          amount: result.paymentRecord.amount,
          date: result.paymentRecord.paymentDate,
          method: result.paymentRecord.paymentMethod,
          reference: result.paymentRecord.reference
        }
      },
      message: 'Payment recorded successfully. AP balance updated.'
    });

  } catch (error) {
    console.error('❌ [AP] Record payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// SUMMARY & REPORTS
// ============================================================

// @desc    Get AP summary
// @route   GET /api/accounts-payable/summary
// @access  Private
exports.getSummary = async (req, res) => {
  console.log('📦 [AP] getSummary called');

  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { fiscalYearId } = req.query;

    const filter = {
      companyId: companyId,
      status: { not: 'Paid' }
    };

    await applyBillFiscalYearDateFilter(filter, companyId, fiscalYearId);

    const [bills, purchaseInvoices] = await Promise.all([
      prisma.bill.findMany({
        where: filter
      }),
      fetchCompanyPurchaseInvoices(
        companyId,
        filter.date ? { invoiceDate: filter.date } : {}
      )
    ]);

    const openPayables = [
      ...bills.map((bill) => {
        const { outstanding } = billOpenBalance(bill);
        return { ...bill, outstanding, dueDate: bill.dueDate, status: bill.status };
      }),
      ...purchaseInvoices.map(purchaseInvoiceToBillShape)
    ].filter((doc) => (Number(doc.outstanding) || 0) > 0);

    const summaryData = computeOpenPayablesSummary(openPayables);

    res.status(200).json({
      success: true,
      data: summaryData
    });
  } catch (error) {
    console.error('❌ [AP] Get AP summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get aged payables report
// @route   GET /api/accounts-payable/aged
// @access  Private
exports.getAgedPayables = async (req, res) => {
  console.log('📦 [AP] getAgedPayables called');

  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { fiscalYearId } = req.query;

    const filter = {
      companyId: companyId,
      status: { not: 'Paid' }
    };

    await applyBillFiscalYearDateFilter(filter, companyId, fiscalYearId);

    const [bills, purchaseInvoices] = await Promise.all([
      prisma.bill.findMany({
        where: filter,
        include: {
          vendor: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true
            }
          }
        }
      }),
      fetchCompanyPurchaseInvoices(
        companyId,
        filter.date ? { invoiceDate: filter.date } : {}
      )
    ]);

    const payableDocs = [
      ...bills,
      ...purchaseInvoices.map(purchaseInvoiceToBillShape)
    ];

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const supplierMap = new Map();

    for (const bill of payableDocs) {
      const outstanding =
        bill.outstanding != null
          ? Number(bill.outstanding)
          : (Number(bill.totalAmount) || 0) - (Number(bill.paidAmount) || 0);
      if (outstanding <= 0) continue;

      const supplierId = bill.vendorId || bill.vendor?.id || 'unknown';
      const supplierName = bill.vendor?.name || bill.vendorName || 'Unknown Supplier';

      if (!supplierMap.has(supplierId)) {
        supplierMap.set(supplierId, {
          id: supplierId,
          name: supplierName,
          email: bill.vendor?.email || '',
          phone: bill.vendor?.phone || '',
          bills: [],
          current: 0,
          days1to30: 0,
          days31to60: 0,
          days61to90: 0,
          days90plus: 0,
          totalOutstanding: 0
        });
      }

      const supplier = supplierMap.get(supplierId);
      const dueDate = new Date(bill.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      const daysPastDue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));

      if (daysPastDue <= 0) {
        supplier.current += outstanding;
      } else if (daysPastDue <= 30) {
        supplier.days1to30 += outstanding;
      } else if (daysPastDue <= 60) {
        supplier.days31to60 += outstanding;
      } else if (daysPastDue <= 90) {
        supplier.days61to90 += outstanding;
      } else {
        supplier.days90plus += outstanding;
      }

      supplier.totalOutstanding += outstanding;
      supplier.bills.push({
        id: bill.id,
        billNumber: bill.billNumber,
        date: bill.date,
        dueDate: bill.dueDate,
        amount: bill.totalAmount,
        paidAmount: bill.paidAmount || 0,
        outstanding,
        daysPastDue: Math.max(0, daysPastDue)
      });
    }

    const suppliers = Array.from(supplierMap.values()).sort(
      (a, b) => b.totalOutstanding - a.totalOutstanding
    );

    const summary = suppliers.reduce(
      (acc, v) => ({
        current: acc.current + v.current,
        days1to30: acc.days1to30 + v.days1to30,
        days31to60: acc.days31to60 + v.days31to60,
        days61to90: acc.days61to90 + v.days61to90,
        days90plus: acc.days90plus + v.days90plus,
        totalOutstanding: acc.totalOutstanding + v.totalOutstanding
      }),
      { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, totalOutstanding: 0 }
    );

    const agedData = { suppliers, summary };

    res.status(200).json({
      success: true,
      data: agedData
    });
  } catch (error) {
    console.error('❌ [AP] Get aged payables error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get unpaid bills for supplier
// @route   GET /api/accounts-payable/bills/unpaid/:supplierId
// @access  Private
exports.getUnpaidBills = async (req, res) => {
  console.log('📦 [AP] getUnpaidBills called');

  try {
    const { supplierId } = req.params;
    const userId = req.user.id;
    const companyId = req.user.companyId;

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

    const [bills, purchaseInvoices] = await Promise.all([
      prisma.bill.findMany({
        where: {
          vendorId: supplierId,
          companyId: companyId,
          status: { not: 'Paid' }
        },
        orderBy: { dueDate: 'asc' },
        include: {
          paymentsMade: {
            select: {
              id: true,
              paymentNumber: true,
              amount: true,
              paymentDate: true,
              status: true
            }
          }
        }
      }),
      fetchCompanyPurchaseInvoices(companyId, { supplierId })
    ]);

    const unpaidBills = [
      ...bills.map((bill) => {
        const { totalAmount, paidAmount, outstanding } = billOpenBalance(bill);
        return {
          id: bill.id,
          billNumber: bill.billNumber,
          date: bill.date,
          dueDate: bill.dueDate,
          totalAmount,
          paidAmount,
          outstanding,
          status: bill.status,
          source: 'bill'
        };
      }),
      ...purchaseInvoices
        .map(purchaseInvoiceToBillShape)
        .filter((inv) => inv.outstanding > 0)
        .map((inv) => ({
          id: inv.id,
          billNumber: inv.billNumber,
          date: inv.date,
          dueDate: inv.dueDate,
          totalAmount: inv.totalAmount,
          paidAmount: inv.paidAmount,
          outstanding: inv.outstanding,
          status: inv.status,
          source: 'purchaseInvoice'
        }))
    ].filter((b) => b.outstanding > 0);

    res.status(200).json({
      success: true,
      count: unpaidBills.length,
      data: unpaidBills
    });
  } catch (error) {
    console.error('❌ [AP] Get unpaid bills error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Mark overdue bills (cron job)
// @route   POST /api/accounts-payable/bills/mark-overdue
// @access  Private (Admin)
exports.markOverdueBills = async (req, res) => {
  console.log('📦 [AP] markOverdueBills called');

  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const result = await prisma.bill.updateMany({
      where: {
        companyId: companyId,
        dueDate: { lt: new Date() },
        status: { in: ['Unpaid', 'Partial'] }
      },
      data: {
        status: 'Overdue'
      }
    });

    res.status(200).json({
      success: true,
      message: `${result.count} bills marked as overdue`,
      count: result.count
    });
  } catch (error) {
    console.error('❌ [AP] Mark overdue bills error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};