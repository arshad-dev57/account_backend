const prisma = require('../prisma/client');
const { get, set, del, delPattern } = require('../utils/redisClient');

// ─── HELPER: Get or create Accounts Payable account ──────────────
async function getOrCreatePayableAccount(userId, companyId, tx) {
  const db = tx || prisma;
  console.log('🔍 [AP] Getting/Creating Accounts Payable account');

  let apAccount = await db.chartOfAccount.findFirst({
    where: {
      code: '2010',
      companyId: companyId
    }
  });

  if (!apAccount) {
    console.log('📝 [AP] Creating new Accounts Payable account');
    apAccount = await db.chartOfAccount.create({
      data: {
        code: '2010',
        name: 'Accounts Payable',
        type: 'Liability',
        parentAccount: 'Current Liabilities',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Amount due to suppliers',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId,
        companyId: companyId
      }
    });
    console.log('✅ [AP] Accounts Payable account created:', apAccount.id);
  } else {
    console.log('✅ [AP] Accounts Payable account found:', apAccount.id);
  }

  return apAccount;
}

// ─── HELPER: Get or create Cash account ──────────────────────────
async function getOrCreateCashAccount(userId, companyId, tx) {
  const db = tx || prisma;
  console.log('🔍 [AP] Getting/Creating Cash account');

  let cashAccount = await db.chartOfAccount.findFirst({
    where: {
      code: '1010',
      companyId: companyId
    }
  });

  if (!cashAccount) {
    console.log('📝 [AP] Creating new Cash account');
    cashAccount = await db.chartOfAccount.create({
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
    console.log('✅ [AP] Cash account created:', cashAccount.id);
  } else {
    console.log('✅ [AP] Cash account found:', cashAccount.id);
  }

  return cashAccount;
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
async function generateBillNumber(companyId, attemptOffset = 0) {
  const prefix = 'BILL-';

  // Company-scoped sequence (matches @@unique([billNumber, companyId]))
  const existingBills = await prisma.bill.findMany({
    where: {
      companyId: companyId,
      billNumber: { startsWith: prefix },
    },
    select: { billNumber: true },
  });

  console.log(`🔍 [AP] Found ${existingBills.length} existing bills for company`);

  let maxNumber = 0;
  for (const bill of existingBills) {
    const parts = bill.billNumber.split('-');
    if (parts.length >= 2) {
      const num = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  }

  // attemptOffset bumps past collisions (race / stale global unique)
  const nextNumber = maxNumber + 1 + attemptOffset;
  const billNumber = `${prefix}${String(nextNumber).padStart(4, '0')}`;

  console.log(
    `🔍 [AP] Generated bill number: ${billNumber} (max: ${maxNumber}, offset: ${attemptOffset})`
  );
  return billNumber;
}

// ─── HELPER: Generate fallback bill number ─────────────────────────────────
async function generateFallbackBillNumber(companyId) {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  const fallbackNumber = `BILL-${timestamp}${random}`.substring(0, 15);
  
  const existing = await prisma.bill.findFirst({
    where: {
      billNumber: fallbackNumber,
      companyId: companyId
    }
  });

  if (existing) {
    return `BILL-${timestamp}${random}${Math.random().toString(36).substring(2, 4).toUpperCase()}`;
  }

  return fallbackNumber;
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
      data: { billNumber },
    });
  } catch (error) {
    console.error('❌ [AP] Get next bill number error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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

    const cacheKey = `ap:suppliers:${userId}:${search || ''}:${status || ''}`;
    
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

    const bills = await prisma.bill.findMany({
      where: {
        companyId: companyId,
        status: { not: 'Paid' }
      }
    });

    const suppliersWithOutstanding = suppliers.map(supplier => {
      const supplierBills = bills.filter(bill => bill.vendorId === supplier.id);
      const totalAmount = supplierBills.reduce((sum, bill) => sum + bill.totalAmount, 0);
      const paidAmount = supplierBills.reduce((sum, bill) => sum + bill.paidAmount, 0);
      const outstandingAmount = totalAmount - paidAmount;

      return {
        ...supplier,
        totalAmount,
        paidAmount,
        outstandingAmount,
        billCount: supplierBills.length,
      };
    });

    await set(cacheKey, suppliersWithOutstanding, 600);

    res.status(200).json({
      success: true,
      count: suppliersWithOutstanding.length,
      data: suppliersWithOutstanding,
      cached: false,
    });
  } catch (error) {
    console.error('❌ [AP] Get suppliers error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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

    const cacheKey = `ap:supplier:${userId}:${id}`;
    
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

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
        message: 'Supplier not found',
      });
    }

    const bills = await prisma.bill.findMany({
      where: {
        vendorId: supplier.id,
        companyId: companyId
      },
      orderBy: { date: 'desc' }
    });

    const totalAmount = bills.reduce((sum, bill) => sum + bill.totalAmount, 0);
    const paidAmount = bills.reduce((sum, bill) => sum + bill.paidAmount, 0);
    const outstandingAmount = totalAmount - paidAmount;

    const supplierData = {
      ...supplier,
      bills,
      totalAmount,
      paidAmount,
      outstandingAmount,
    };

    await set(cacheKey, supplierData, 600);

    res.status(200).json({
      success: true,
      data: supplierData,
      cached: false,
    });
  } catch (error) {
    console.error('❌ [AP] Get supplier error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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
  console.log('📦 [AP] createBill called');

  try {
    const { supplierId, date, dueDate, items, discount, notes } = req.body;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    // Validate supplier
    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, companyId: companyId }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found. Please add supplier from warehouse first.',
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
        taxAmount,
      };
    });

    const totalAmount = subtotal + taxTotal - (discount || 0);
    const finalDueDate = dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const status = determineBillStatus(totalAmount, 0, finalDueDate);

    // ─── Retry loop handles race condition ───────────────────────
    const MAX_ATTEMPTS = 5;
    let result = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Offset grows on each collision so we never retry the same number
      const billNumber =
        attempt === MAX_ATTEMPTS
          ? await generateFallbackBillNumber(companyId)
          : await generateBillNumber(companyId, attempt - 1);
      console.log(`🔍 [AP] Attempt ${attempt}: trying bill number ${billNumber}`);

      try {
        result = await prisma.$transaction(async (tx) => {
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

          await tx.journalEntry.create({
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
            }
          });

          await tx.chartOfAccount.update({
            where: { id: apAccount.id },
            data: { currentBalance: { increment: totalAmount } }
          });

          return bill;
        });

        // Transaction succeeded — break out of retry loop
        break;

      } catch (txError) {
        // P2002 = unique constraint violation on bill_number
        if (txError.code === 'P2002' && attempt < MAX_ATTEMPTS) {
          console.log(`⚠️ [AP] Bill number ${billNumber} collision, retrying (${attempt}/${MAX_ATTEMPTS})`);
          continue;
        }
        // Last attempt or different error — rethrow
        throw txError;
      }
    }

    if (!result) {
      throw new Error('Failed to generate a unique bill number after multiple attempts');
    }

    // Invalidate cache
    try {
      await delPattern(`ap:bills:${userId}:*`);
      await delPattern(`ap:summary:${userId}:*`);
      await delPattern(`ap:aged:${userId}:*`);
      await delPattern(`ap:suppliers:${userId}:*`);
      await delPattern(`ap:supplier:${userId}:${supplierId}`);
    } catch (cacheError) {
      console.log('⚠️ [AP] Cache invalidation error:', cacheError.message);
    }

    res.status(201).json({
      success: true,
      data: result,
      message: 'Bill created successfully. AP balance updated.',
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

    const cacheKey = `ap:bills:${userId}:${supplierId || ''}:${status || ''}:${startDate || ''}:${endDate || ''}:${fiscalYearId || ''}`;
    
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

    if (fiscalYearId) {
      filter.fiscalYearId = fiscalYearId;
    }

    const bills = await prisma.bill.findMany({
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
    });

    await set(cacheKey, bills, 300);

    res.status(200).json({
      success: true,
      count: bills.length,
      data: bills,
      cached: false,
    });
  } catch (error) {
    console.error('❌ [AP] Get bills error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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

    const cacheKey = `ap:bill:${userId}:${id}`;
    
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

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
      return res.status(404).json({
        success: false,
        message: 'Bill not found',
      });
    }

    await set(cacheKey, bill, 600);

    res.status(200).json({
      success: true,
      data: bill,
      cached: false,
    });
  } catch (error) {
    console.error('❌ [AP] Get bill error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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
        message: 'Bill not found',
      });
    }

    if (existing.status === 'Paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update a paid bill',
      });
    }

    const {
      date,
      dueDate,
      items,
      discount,
      notes,
      status,
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
          taxAmount: taxAmount,
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
      status: status || existing.status,
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

    // Invalidate cache
    try {
      await delPattern(`ap:bills:${userId}:*`);
      await delPattern(`ap:bill:${userId}:${id}`);
      console.log('🗑️ [AP] Cache invalidated after bill update');
    } catch (cacheError) {
      console.log('⚠️ [AP] Cache invalidation error:', cacheError.message);
    }

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Bill updated successfully',
    });
  } catch (error) {
    console.error('❌ [AP] Update bill error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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
        message: 'Bill not found',
      });
    }

    if (bill.status === 'Paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete a paid bill',
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
        message: 'Cannot delete bill with existing payments',
      });
    }

    await prisma.bill.delete({
      where: { id }
    });

    // Invalidate cache
    try {
      await delPattern(`ap:bills:${userId}:*`);
      await delPattern(`ap:bill:${userId}:${id}`);
      console.log('🗑️ [AP] Cache invalidated after bill deletion');
    } catch (cacheError) {
      console.log('⚠️ [AP] Cache invalidation error:', cacheError.message);
    }

    res.status(200).json({
      success: true,
      message: 'Bill deleted successfully',
    });
  } catch (error) {
    console.error('❌ [AP] Delete bill error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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
      bankAccountId,
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

      if (bankAccountId) {
        bankAccountData = await validateBankAccount(bankAccountId, companyId, tx);
        if (bankAccountData && bankAccountData.chartOfAccount) {
          debitAccount = bankAccountData.chartOfAccount;
        }
      }

      if (!debitAccount) {
        debitAccount = await getOrCreateCashAccount(userId, companyId, tx);
      }

      await tx.journalEntry.create({
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
        }
      });

      await tx.chartOfAccount.update({
        where: { id: apAccount.id },
        data: { currentBalance: { decrement: amount } }
      });

      if (bankAccountData) {
        const newBankBalance = bankAccountData.currentBalance - amount;
        await tx.bankAccount.update({
          where: { id: bankAccountData.id },
          data: { currentBalance: newBankBalance }
        });
        if (bankAccountData.chartOfAccountId) {
          await tx.chartOfAccount.update({
            where: { id: bankAccountData.chartOfAccountId },
            data: { currentBalance: newBankBalance }
          });
        }
      } else if (debitAccount) {
        await tx.chartOfAccount.update({
          where: { id: debitAccount.id },
          data: { currentBalance: { decrement: amount } }
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

    // Invalidate cache
    try {
      await delPattern(`ap:bills:${userId}:*`);
      await delPattern(`ap:bill:${userId}:${billId}`);
      await delPattern(`ap:summary:${userId}:*`);
      await delPattern(`ap:aged:${userId}:*`);
      await delPattern(`ap:suppliers:${userId}:*`);
      console.log('🗑️ [AP] Cache invalidated after payment recording');
    } catch (cacheError) {
      console.log('⚠️ [AP] Cache invalidation error:', cacheError.message);
    }

    res.status(200).json({
      success: true,
      data: {
        bill: {
          id: result.updatedBill.id,
          billNumber: result.updatedBill.billNumber,
          paidAmount: result.updatedBill.paidAmount,
          outstanding: result.updatedBill.outstanding,
          status: result.updatedBill.status,
        },
        payment: {
          id: result.paymentRecord.id,
          paymentNumber: result.paymentRecord.paymentNumber,
          amount: result.paymentRecord.amount,
          date: result.paymentRecord.paymentDate,
          method: result.paymentRecord.paymentMethod,
          reference: result.paymentRecord.reference,
        },
      },
      message: 'Payment recorded successfully. AP balance updated.',
    });

  } catch (error) {
    console.error('❌ [AP] Record payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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

    const cacheKey = `ap:summary:${userId}:${fiscalYearId || ''}`;
    
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
      status: { not: 'Paid' }
    };

    if (fiscalYearId) {
      filter.fiscalYearId = fiscalYearId;
    }

    const bills = await prisma.bill.findMany({
      where: filter
    });

    const totalOutstanding = bills.reduce(
      (sum, bill) => sum + (bill.totalAmount - bill.paidAmount),
      0
    );

    const now = new Date();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const overdue = bills
      .filter(bill => bill.dueDate < now && bill.status !== 'Paid')
      .reduce((sum, bill) => sum + (bill.totalAmount - bill.paidAmount), 0);

    const dueThisWeek = bills
      .filter(bill => bill.dueDate >= now && bill.dueDate <= endOfWeek && bill.status !== 'Paid')
      .reduce((sum, bill) => sum + (bill.totalAmount - bill.paidAmount), 0);

    const dueThisMonth = bills
      .filter(bill => bill.dueDate >= now && bill.dueDate <= endOfMonth && bill.status !== 'Paid')
      .reduce((sum, bill) => sum + (bill.totalAmount - bill.paidAmount), 0);

    const activeSuppliers = await prisma.supplier.count({
      where: {
        companyId: companyId,
        status: 'active'
      }
    });

    const summaryData = {
      totalOutstanding,
      overdue,
      dueThisWeek,
      dueThisMonth,
      activeSuppliers,
    };

    await set(cacheKey, summaryData, 120);

    res.status(200).json({
      success: true,
      data: summaryData,
      cached: false,
    });
  } catch (error) {
    console.error('❌ [AP] Get AP summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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

    const cacheKey = `ap:aged:${userId}:${fiscalYearId || ''}`;
    
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
      status: { not: 'Paid' }
    };

    if (fiscalYearId) {
      filter.fiscalYearId = fiscalYearId;
    }

    const bills = await prisma.bill.findMany({
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
    });

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const supplierMap = new Map();

    for (const bill of bills) {
      const outstanding = bill.totalAmount - (bill.paidAmount || 0);
      if (outstanding <= 0) continue;

      const supplierId = bill.vendorId || 'unknown';
      const supplierName = bill.vendor?.name || 'Unknown Supplier';

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
          totalOutstanding: 0,
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
        daysPastDue: Math.max(0, daysPastDue),
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
        totalOutstanding: acc.totalOutstanding + v.totalOutstanding,
      }),
      { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, totalOutstanding: 0 }
    );

    const agedData = { suppliers, summary };

    await set(cacheKey, agedData, 120);

    res.status(200).json({
      success: true,
      data: agedData,
      cached: false,
    });
  } catch (error) {
    console.error('❌ [AP] Get aged payables error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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
        message: 'Supplier not found',
      });
    }

    const bills = await prisma.bill.findMany({
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
    });

    const unpaidBills = bills.map(bill => ({
      id: bill.id,
      billNumber: bill.billNumber,
      date: bill.date,
      dueDate: bill.dueDate,
      totalAmount: bill.totalAmount,
      paidAmount: bill.paidAmount,
      outstanding: bill.totalAmount - bill.paidAmount,
      status: bill.status,
    }));

    res.status(200).json({
      success: true,
      count: unpaidBills.length,
      data: unpaidBills,
    });
  } catch (error) {
    console.error('❌ [AP] Get unpaid bills error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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
      count: result.count,
    });
  } catch (error) {
    console.error('❌ [AP] Mark overdue bills error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};