// controllers/paymentMadeController.js - COMPLETE FIXED VERSION

const prisma = require('../prisma/client');

// ─── HELPER: Get or create Accounts Payable account ──────────────
async function getOrCreatePayableAccount(userId) {
  console.log('🔍 [PM] Getting/Creating Accounts Payable account');
  let apAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '2010',
      createdBy: userId
    }
  });

  if (!apAccount) {
    console.log('📝 [PM] Creating new Accounts Payable account');
    apAccount = await prisma.chartOfAccount.create({
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
        createdBy: userId
      }
    });
    console.log('✅ [PM] Accounts Payable account created');
  } else {
    console.log('✅ [PM] Accounts Payable account found');
  }
  return apAccount;
}

// ─── HELPER: Get or create Cash account ──────────────────────────
async function getOrCreateCashAccount(userId) {
  console.log('🔍 [PM] Getting/Creating Cash account');
  let cashAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '1010',
      createdBy: userId
    }
  });

  if (!cashAccount) {
    console.log('📝 [PM] Creating new Cash account');
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
        createdBy: userId
      }
    });
    console.log('✅ [PM] Cash account created');
  } else {
    console.log('✅ [PM] Cash account found');
  }
  return cashAccount;
}

// ─── HELPER: Validate Supplier ──────────────────────────────────
async function validateSupplier(supplierId, userId) {
  console.log(`🔍 [PM] Validating supplier: ${supplierId}`);
  const supplier = await prisma.supplier.findFirst({
    where: {
      id: supplierId,
      createdBy: userId
    }
  });

  if (!supplier) {
    console.log('❌ [PM] Supplier not found');
    throw new Error('Supplier not found. Please add supplier from warehouse first.');
  }
  console.log(`✅ [PM] Supplier found: ${supplier.name}`);
  return supplier;
}

// ─── HELPER: Validate Bill ────────────────────────────────────────
async function validateBill(billId, userId) {
  console.log(`🔍 [PM] Validating bill: ${billId}`);
  const bill = await prisma.bill.findFirst({
    where: {
      id: billId,
      createdBy: userId
    }
  });

  if (!bill) {
    console.log('❌ [PM] Bill not found');
    throw new Error('Bill not found');
  }
  console.log(`✅ [PM] Bill found: ${bill.billNumber}`);
  return bill;
}

// ─── HELPER: Validate Bank Account ──────────────────────────────
async function validateBankAccount(bankAccountId, userId) {
  console.log(`🔍 [PM] Validating bank account: ${bankAccountId}`);
  const bankAccount = await prisma.bankAccount.findFirst({
    where: {
      id: bankAccountId,
      createdBy: userId,
      status: 'Active'
    },
    include: {
      chartOfAccount: true
    }
  });

  if (!bankAccount) {
    console.log('❌ [PM] Bank account not found');
    throw new Error('Bank account not found or does not belong to you');
  }
  console.log(`✅ [PM] Bank account found: ${bankAccount.accountName}`);
  return bankAccount;
}

// ─── HELPER: Generate payment number ─────────────────────────────
async function generatePaymentNumber(userId) {
  const count = await prisma.paymentMade.count({
    where: { createdBy: userId }
  });
  const year = new Date().getFullYear();
  return `PMT-${year}-${String(count + 1).padStart(4, '0')}`;
}

// ─── ✅ NEW: Reverse Journal Entry ──────────────────────────────
async function reverseJournalEntry(payment, userId, tx) {
  console.log('🔍 [PM] reverseJournalEntry called for payment:', payment.id);
  
  const journalEntry = await tx.journalEntry.findFirst({
    where: {
      reference: payment.paymentNumber,
      description: { contains: 'Payment made' }
    },
    include: {
      lines: true
    }
  });

  if (!journalEntry) {
    console.log('⚠️ [PM] Journal entry not found for payment');
    return null;
  }

  console.log('✅ [PM] Journal entry found:', journalEntry.id);

  const reversalEntry = await tx.journalEntry.create({
    data: {
      entryNumber: `REV-${Date.now()}`,
      date: new Date(),
      description: `Reverse payment ${payment.paymentNumber}`,
      reference: `REV-${payment.id}`,
      status: 'Posted',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      lines: {
        create: journalEntry.lines.map(line => ({
          accountId: line.accountId,
          accountName: line.accountName,
          accountCode: line.accountCode,
          debit: line.credit,
          credit: line.debit,
          isReconciled: false
        }))
      }
    }
  });

  console.log('✅ [PM] Reversal entry created:', reversalEntry.id);

  const creditLine = journalEntry.lines.find(line => line.credit > 0);
  if (creditLine) {
    await tx.chartOfAccount.update({
      where: { id: creditLine.accountId },
      data: { currentBalance: { increment: payment.amount } }
    });
    console.log('✅ [PM] AP account balance restored');
  }

  const debitLine = journalEntry.lines.find(line => line.debit > 0);
  if (debitLine) {
    await tx.chartOfAccount.update({
      where: { id: debitLine.accountId },
      data: { currentBalance: { increment: payment.amount } }
    });
    console.log('✅ [PM] Bank/Cash account balance restored');
  }

  return reversalEntry;
}

// ============================================================
// @desc    Record payment made to supplier (MULTI-BILL SUPPORT)
// @route   POST /api/payments-made
// @access  Private
// ============================================================
const recordPayment = async (req, res) => {
  console.log('📦 [PM] ========== recordPayment START ==========');
  console.log('📦 [PM] Request body:', JSON.stringify(req.body, null, 2));

  try {
    const {
      supplierId,
      billIds,
      amount,
      paymentDate,
      paymentMethod,
      reference,
      bankAccountId,
      notes,
      allocations,
    } = req.body;

    const userId = req.user.id;
    console.log('👤 [PM] User ID:', userId);

    const supplier = await validateSupplier(supplierId, userId);

    let billList = [];
    if (billIds && Array.isArray(billIds)) {
      for (const id of billIds) {
        const bill = await validateBill(id, userId);
        if (bill) {
          billList.push(bill);
        }
      }
    } else if (billIds && typeof billIds === 'string') {
      const bill = await validateBill(billIds, userId);
      if (bill) {
        billList.push(bill);
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'At least one bill ID is required'
      });
    }

    if (billList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid bills found'
      });
    }

    const totalOutstanding = billList.reduce(
      (sum, bill) => sum + (bill.totalAmount - bill.paidAmount),
      0
    );

    console.log(`📊 [PM] Total outstanding: ${totalOutstanding}, Payment amount: ${amount}`);

    if (amount > totalOutstanding) {
      return res.status(400).json({
        success: false,
        message: `Payment amount (${amount}) exceeds total outstanding (${totalOutstanding})`,
        totalOutstanding
      });
    }

    let bankAccount = null;
    let bankChartAccount = null;

    if (bankAccountId && paymentMethod === 'Bank Transfer') {
      bankAccount = await validateBankAccount(bankAccountId, userId);
      if (bankAccount && bankAccount.chartOfAccount) {
        bankChartAccount = bankAccount.chartOfAccount;
      }
    }

    const apAccount = await getOrCreatePayableAccount(userId);
    const cashAccount = await getOrCreateCashAccount(userId);

    let paymentAccount = cashAccount;
    if (paymentMethod === 'Bank Transfer' && bankChartAccount) {
      paymentAccount = bankChartAccount;
      console.log(`🏦 [PM] Using bank account: ${bankAccount.accountName}`);
    } else {
      console.log('💵 [PM] Using cash account');
    }

    const paymentNumber = await generatePaymentNumber(userId);

    let allocationMap = {};
    let remainingAmount = amount;

    if (allocations && allocations.length > 0) {
      for (const alloc of allocations) {
        allocationMap[alloc.billId] = alloc.amount;
      }
    } else {
      const sortedBills = [...billList].sort(
        (a, b) => new Date(a.dueDate) - new Date(b.dueDate)
      );
      
      for (const bill of sortedBills) {
        const outstanding = bill.totalAmount - bill.paidAmount;
        if (remainingAmount <= 0) break;
        
        const allocAmount = Math.min(remainingAmount, outstanding);
        allocationMap[bill.id] = allocAmount;
        remainingAmount -= allocAmount;
        console.log(`📊 [PM] Allocated ${allocAmount} to bill ${bill.billNumber}`);
      }
    }

    const paymentResults = [];
    let totalPaid = 0;
    const updatedBills = [];

    for (const bill of billList) {
      const allocAmount = allocationMap[bill.id] || 0;
      if (allocAmount <= 0) continue;

      const newPaidAmount = bill.paidAmount + allocAmount;
      const newOutstanding = bill.totalAmount - newPaidAmount;
      const newStatus = newOutstanding <= 0 ? 'Paid' : 'Partial';

      console.log(`📊 [PM] Bill ${bill.billNumber}: paid ${bill.paidAmount} → ${newPaidAmount}`);

      const updatedBill = await prisma.bill.update({
        where: { id: bill.id },
        data: {
          paidAmount: newPaidAmount,
          outstanding: newOutstanding,
          status: newStatus
        }
      });

      updatedBills.push(updatedBill);
      totalPaid += allocAmount;

      const payment = await prisma.paymentMade.create({
        data: {
          paymentNumber: `${paymentNumber}-${String(updatedBills.length).padStart(2, '0')}`,
          paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
          supplierId: supplier.id,
          supplierName: supplier.name,
          billId: bill.id,
          billNumber: bill.billNumber,
          billAmount: bill.totalAmount,
          amount: allocAmount,
          paymentMethod: paymentMethod,
          reference: reference || '',
          bankAccountId: bankAccountId || null,
          bankAccountName: bankAccount ? bankAccount.accountName : (paymentMethod === 'Cash' ? 'Cash in Hand' : ''),
          notes: notes || '',
          status: paymentMethod === 'Cheque' ? 'Pending' : 'Cleared',
          createdBy: userId
        },
        include: {
          supplier: {
            select: { id: true, name: true, email: true, phone: true }
          },
          bill: {
            select: { id: true, billNumber: true, totalAmount: true, paidAmount: true, status: true }
          }
        }
      });

      paymentResults.push({
        payment,
        bill: updatedBill,
        allocatedAmount: allocAmount
      });
      console.log(`✅ [PM] Payment created for bill ${bill.billNumber}: ${payment.paymentNumber}`);
    }

    await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-${Date.now()}`,
        date: paymentDate ? new Date(paymentDate) : new Date(),
        description: `Payment made to ${supplier.name} for ${billList.length} bill(s)`,
        reference: reference || paymentNumber,
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
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
              accountId: paymentAccount.id,
              accountName: paymentAccount.name,
              accountCode: paymentAccount.code,
              debit: 0,
              credit: amount,
              isReconciled: false
            }
          ]
        }
      }
    });

    console.log('✅ [PM] Journal entry created');

    await prisma.chartOfAccount.update({
      where: { id: apAccount.id },
      data: { currentBalance: { decrement: amount } }
    });

    if (paymentMethod === 'Bank Transfer' && bankAccount && bankAccountId) {
      const newBankBalance = bankAccount.currentBalance - amount;
      await prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: { currentBalance: newBankBalance }
      });
      if (bankChartAccount) {
        await prisma.chartOfAccount.update({
          where: { id: bankChartAccount.id },
          data: { currentBalance: newBankBalance }
        });
      }
      console.log(`🏦 [PM] Bank balance updated: ${newBankBalance}`);
    } else if (paymentMethod === 'Cash') {
      const newCashBalance = (cashAccount.currentBalance || 0) - amount;
      await prisma.chartOfAccount.update({
        where: { id: cashAccount.id },
        data: { currentBalance: newCashBalance }
      });
      console.log(`💵 [PM] Cash balance updated: ${newCashBalance}`);
    }

    console.log('✅ [PM] Payment recorded successfully!');

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully! Journal entry created.',
      data: {
        payments: paymentResults,
        totalAmount: amount,
        totalOutstandingRemaining: totalOutstanding - amount,
        billUpdates: updatedBills.map(b => ({
          id: b.id,
          billNumber: b.billNumber,
          paidAmount: b.paidAmount,
          outstanding: b.outstanding,
          status: b.status,
        })),
      },
    });

    console.log('📦 [PM] ========== recordPayment END ==========');

  } catch (error) {
    console.error('❌ [PM] Record payment error:', error);
    console.error('❌ [PM] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    ✅ DELETE payment (with reversal)
// @route   DELETE /api/payments-made/:id
// @access  Private
// ============================================================
const deletePayment = async (req, res) => {
  console.log('📦 [PM] deletePayment called');
  console.log('🔍 [PM] Payment ID:', req.params.id);

  try {
    const { id } = req.params;
    const userId = req.user.id;

    const payment = await prisma.paymentMade.findFirst({
      where: {
        id,
        createdBy: userId
      },
      include: {
        bill: true
      }
    });

    if (!payment) {
      console.log('❌ [PM] Payment not found');
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    console.log(`✅ [PM] Payment found: ${payment.paymentNumber}`);

    await prisma.$transaction(async (tx) => {
      await reverseJournalEntry(payment, userId, tx);

      if (payment.bill) {
        const newPaidAmount = payment.bill.paidAmount - payment.amount;
        const newStatus = newPaidAmount <= 0 ? 'Unpaid' : 'Partial';
        
        await tx.bill.update({
          where: { id: payment.billId },
          data: {
            paidAmount: newPaidAmount,
            outstanding: payment.bill.totalAmount - newPaidAmount,
            status: newStatus
          }
        });
        console.log('✅ [PM] Bill updated:', payment.bill.billNumber);
      }

      await tx.paymentMade.delete({
        where: { id }
      });
      console.log('✅ [PM] Payment deleted');
    });

    res.status(200).json({
      success: true,
      message: 'Payment deleted and journal entry reversed successfully'
    });
  } catch (error) {
    console.error('❌ [PM] Delete payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    ✅ Clear cheque payment
// @route   POST /api/payments-made/:id/clear
// @access  Private
// ============================================================
const clearChequePayment = async (req, res) => {
  console.log('📦 [PM] clearChequePayment called');
  console.log('🔍 [PM] Payment ID:', req.params.id);

  try {
    const { id } = req.params;
    const userId = req.user.id;

    const payment = await prisma.paymentMade.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!payment) {
      console.log('❌ [PM] Payment not found');
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (payment.status === 'Cleared') {
      return res.status(400).json({
        success: false,
        message: 'Payment already cleared'
      });
    }

    if (payment.paymentMethod !== 'Cheque') {
      return res.status(400).json({
        success: false,
        message: 'Only cheque payments can be cleared'
      });
    }

    console.log('✅ [PM] Clearing cheque payment:', payment.paymentNumber);

    const updated = await prisma.paymentMade.update({
      where: { id },
      data: {
        status: 'Cleared'
      },
      include: {
        supplier: {
          select: { id: true, name: true, email: true, phone: true }
        },
        bill: {
          select: { id: true, billNumber: true, totalAmount: true, paidAmount: true, status: true }
        }
      }
    });

    console.log('✅ [PM] Cheque cleared successfully');

    res.status(200).json({
      success: true,
      message: 'Cheque payment cleared successfully',
      data: updated
    });
  } catch (error) {
    console.error('❌ [PM] Clear cheque error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Get all payments
// @route   GET /api/payments-made
// @access  Private
// ============================================================
const getPayments = async (req, res) => {
  console.log('📦 [PM] getPayments called');
  console.log('🔍 [PM] Query params:', req.query);

  try {
    const { supplierId, billId, status, startDate, endDate, search, page = 1, limit = 20 } = req.query;
    const userId = req.user.id;

    const filter = { createdBy: userId };

    if (supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: { id: supplierId, createdBy: userId }
      });
      if (supplier) {
        filter.supplierId = supplierId;
      }
    }

    if (billId) {
      const bill = await prisma.bill.findFirst({
        where: { id: billId, createdBy: userId }
      });
      if (bill) {
        filter.billId = billId;
      }
    }

    if (status) filter.status = status;

    if (startDate && endDate) {
      filter.paymentDate = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    if (search) {
      filter.OR = [
        { paymentNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
        { billNumber: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } }
      ];
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const [payments, total] = await Promise.all([
      prisma.paymentMade.findMany({
        where: filter,
        skip,
        take: limitNum,
        orderBy: { paymentDate: 'desc' },
        include: {
          supplier: {
            select: { id: true, name: true, email: true, phone: true }
          },
          bill: {
            select: { id: true, billNumber: true, totalAmount: true, paidAmount: true, status: true }
          },
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      }),
      prisma.paymentMade.count({ where: filter })
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      count: payments.length,
      total,
      page: pageNum,
      pages: totalPages,
      data: payments,
    });
  } catch (error) {
    console.error('❌ [PM] Get payments error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Get single payment
// @route   GET /api/payments-made/:id
// @access  Private
// ============================================================
const getPayment = async (req, res) => {
  console.log('📦 [PM] getPayment called');
  console.log('🔍 [PM] Payment ID:', req.params.id);

  try {
    const { id } = req.params;
    const userId = req.user.id;

    const payment = await prisma.paymentMade.findFirst({
      where: {
        id,
        createdBy: userId
      },
      include: {
        supplier: {
          select: { id: true, name: true, email: true, phone: true, address: true }
        },
        bill: {
          select: {
            id: true,
            billNumber: true,
            date: true,
            dueDate: true,
            items: true,
            totalAmount: true,
            paidAmount: true,
            status: true
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!payment) {
      console.log('❌ [PM] Payment not found');
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    console.log(`✅ [PM] Payment found: ${payment.paymentNumber}`);

    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error) {
    console.error('❌ [PM] Get payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Get unpaid bills for supplier
// @route   GET /api/payments-made/bills/unpaid/:supplierId
// @access  Private
// ============================================================
const getUnpaidBills = async (req, res) => {
  console.log('📦 [PM] getUnpaidBills called');
  console.log('🔍 [PM] Supplier ID:', req.params.supplierId);

  try {
    const { supplierId } = req.params;
    const userId = req.user.id;

    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        createdBy: userId
      }
    });

    if (!supplier) {
      console.log('❌ [PM] Supplier not found');
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    console.log(`✅ [PM] Supplier found: ${supplier.name}`);

    const bills = await prisma.bill.findMany({
      where: {
        vendorId: supplierId,
        status: { not: 'Paid' },
        createdBy: userId
      },
      orderBy: { dueDate: 'asc' }
    });

    console.log(`📊 [PM] Found ${bills.length} unpaid bills`);

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
    console.error('❌ [PM] Get unpaid bills error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Get payment summary
// @route   GET /api/payments-made/summary
// @access  Private
// ============================================================
const getSummary = async (req, res) => {
  console.log('📦 [PM] getSummary called');

  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    const filter = { createdBy: userId };

    if (startDate && endDate) {
      filter.paymentDate = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [totalPaid, thisWeek, thisMonth, today, pending] = await Promise.all([
      prisma.paymentMade.aggregate({
        where: filter,
        _sum: { amount: true }
      }),
      prisma.paymentMade.aggregate({
        where: {
          ...filter,
          paymentDate: { gte: startOfWeek }
        },
        _sum: { amount: true }
      }),
      prisma.paymentMade.aggregate({
        where: {
          ...filter,
          paymentDate: { gte: startOfMonth }
        },
        _sum: { amount: true }
      }),
      prisma.paymentMade.aggregate({
        where: {
          ...filter,
          paymentDate: { gte: startOfDay }
        },
        _sum: { amount: true }
      }),
      prisma.paymentMade.count({
        where: {
          ...filter,
          status: 'Pending'
        }
      })
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalPaid: totalPaid._sum.amount || 0,
        thisWeek: thisWeek._sum.amount || 0,
        thisMonth: thisMonth._sum.amount || 0,
        today: today._sum.amount || 0,
        pending,
      },
    });
  } catch (error) {
    console.error('❌ [PM] Get summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ─── ✅ EXPORT ALL FUNCTIONS ──────────────────────────────────────────
module.exports = {
  recordPayment,
  getPayments,
  getPayment,
  getUnpaidBills,
  getSummary,
  deletePayment,
  clearChequePayment
};