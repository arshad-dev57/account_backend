const prisma = require('../prisma/client');
const LoanModel = require('../models/Loan');

async function getOrCreateLoanAccount(userId) {
  console.log('🔍 [LN] Getting/Creating Loan Liability account');
  let loanAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '2100',
      createdBy: userId
    }
  });

  if (!loanAccount) {
    console.log('📝 [LN] Creating new Loan Liability account');
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: '2100' }
    });
    
    let newCode = '2100';
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `21${counter}0`;
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode, createdBy: userId }
        });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }

    loanAccount = await prisma.chartOfAccount.create({
      data: {
        code: newCode,
        name: 'Loans Payable',
        type: 'Liabilities',
        parentAccount: 'Long Term Liabilities',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Loans and borrowings',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId
      }
    });
    console.log('✅ [LN] Loan Liability account created');
  }
  return loanAccount;
}

// Helper: Get or create Interest Expense account
async function getOrCreateInterestExpenseAccount(userId) {
  console.log('🔍 [LN] Getting/Creating Interest Expense account');
  let interestAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '6200',
      createdBy: userId
    }
  });

  if (!interestAccount) {
    console.log('📝 [LN] Creating new Interest Expense account');
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: '6200' }
    });
    
    let newCode = '6200';
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `62${counter}0`;
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode, createdBy: userId }
        });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }

    interestAccount = await prisma.chartOfAccount.create({
      data: {
        code: newCode,
        name: 'Interest Expense',
        type: 'Expenses',
        parentAccount: 'Financial Expenses',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Interest on loans',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId
      }
    });
    console.log('✅ [LN] Interest Expense account created');
  }
  return interestAccount;
}

// Helper: Get or create Cash account
async function getOrCreateCashAccount(userId) {
  console.log('🔍 [LN] Getting/Creating Cash account');
  let cashAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '1010',
      createdBy: userId
    }
  });

  if (!cashAccount) {
    console.log('📝 [LN] Creating new Cash account');
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: '1010' }
    });
    
    let newCode = '1010';
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `101${counter}`;
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode, createdBy: userId }
        });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }

    cashAccount = await prisma.chartOfAccount.create({
      data: {
        code: newCode,
        name: 'Cash in Hand',
        type: 'Assets',
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
    console.log('✅ [LN] Cash account created');
  }
  return cashAccount;
}

// controllers/loanController.js - Update validateLender

// Helper: Validate Lender (returns null instead of throwing)
async function validateLender(lenderId, userId) {
  if (!lenderId || lenderId === 'null' || lenderId.trim() === '') {
    return null;
  }
  
  console.log(`🔍 [LN] Validating lender: ${lenderId}`);
  const lender = await prisma.supplier.findFirst({
    where: {
      id: lenderId,
      createdBy: userId
    }
  });

  if (!lender) {
    console.log('⚠️ [LN] Lender not found, returning null');
    return null;
  }
  console.log(`✅ [LN] Lender found: ${lender.name}`);
  return lender;
}
// Helper: Validate Bank Account
// controllers/loanController.js - Update validateBankAccount

// Helper: Validate Bank Account (returns null instead of throwing)
async function validateBankAccount(bankAccountId, userId) {
  if (!bankAccountId || bankAccountId === 'null' || bankAccountId.trim() === '') {
    return null;
  }
  
  console.log(`🔍 [LN] Validating bank account: ${bankAccountId}`);
  const bankAccount = await prisma.bankAccount.findFirst({
    where: {
      id: bankAccountId,
      createdBy: userId
    }
  });

  if (!bankAccount) {
    console.log('⚠️ [LN] Bank account not found, returning null');
    return null;
  }
  console.log(`✅ [LN] Bank account found: ${bankAccount.accountName}`);
  return bankAccount;
}// controllers/loanController.js - Update createLoan function

// ============================================================
// @desc    Create a new loan
// @route   POST /api/loans
// @access  Private
// ============================================================
exports.createLoan = async (req, res) => {
  console.log('📦 [LN] createLoan called');
  console.log('🔍 [LN] Request body:', JSON.stringify(req.body, null, 2));

  try {
    const {
      loanType,
      lenderName,
      lenderId,
      loanAmount,
      disbursementDate,
      interestRate,
      tenureMonths,
      purpose,
      collateral,
      accountNumber,
      bankAccountId,
      notes,
    } = req.body;

    const userId = req.user.id;
    console.log('👤 [LN] User ID:', userId);

    // ─── 1. Validate Lender (only if provided) ──────────────────
    let finalLenderId = null;
    if (lenderId && lenderId !== 'null' && lenderId.trim() !== '') {
      try {
        const lender = await validateLender(lenderId, userId);
        if (lender) {
          finalLenderId = lender.id;
          console.log(`✅ [LN] Lender found: ${lender.name}`);
        }
      } catch (error) {
        console.log('⚠️ [LN] Lender not found, continuing without lender');
      }
    } else {
      console.log('ℹ️ [LN] No lender provided');
    }

    // ─── 2. Validate Bank Account (only if provided) ──────────
    let finalBankAccountId = null;
    if (bankAccountId && bankAccountId !== 'null' && bankAccountId.trim() !== '') {
      try {
        const bankAccount = await validateBankAccount(bankAccountId, userId);
        if (bankAccount) {
          finalBankAccountId = bankAccount.id;
          console.log(`✅ [LN] Bank account found: ${bankAccount.accountName}`);
        }
      } catch (error) {
        console.log('⚠️ [LN] Bank account not found, continuing without bank account');
      }
    } else {
      console.log('ℹ️ [LN] No bank account provided');
    }

    // ─── 3. Create Loan ──────────────────────────────────────
    const loan = await LoanModel.create({
      loanType,
      lenderName,
      lenderId: finalLenderId,
      loanAmount: parseFloat(loanAmount),
      disbursementDate: new Date(disbursementDate),
      interestRate: parseFloat(interestRate),
      tenureMonths: parseInt(tenureMonths),
      purpose: purpose || '',
      collateral: collateral || '',
      accountNumber: accountNumber || '',
      bankAccountId: finalBankAccountId,
      notes: notes || '',
      createdBy: userId
    });

    console.log(`✅ [LN] Loan created: ${loan.loanNumber}`);

    // ─── 4. Create Journal Entry ──────────────────────────────
    const loanAccount = await getOrCreateLoanAccount(userId);
    let cashChartAccount = await getOrCreateCashAccount(userId);

    // If bank account is selected, use its chart of account
    if (finalBankAccountId) {
      const bankAccount = await prisma.bankAccount.findFirst({
        where: {
          id: finalBankAccountId,
          createdBy: userId
        }
      });
      if (bankAccount && bankAccount.chartOfAccountId) {
        const bankChartAccount = await prisma.chartOfAccount.findFirst({
          where: {
            id: bankAccount.chartOfAccountId,
            createdBy: userId
          }
        });
        if (bankChartAccount) {
          cashChartAccount = bankChartAccount;
        }
      }
    }

    await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-${Date.now()}`,
        date: new Date(disbursementDate),
        description: `Loan disbursement - ${loanType} from ${lenderName}`,
        reference: loan.loanNumber,
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        lines: {
          create: [
            {
              accountId: cashChartAccount.id,
              accountName: cashChartAccount.name,
              accountCode: cashChartAccount.code,
              debit: parseFloat(loanAmount),
              credit: 0,
              isReconciled: false
            },
            {
              accountId: loanAccount.id,
              accountName: loanAccount.name,
              accountCode: loanAccount.code,
              debit: 0,
              credit: parseFloat(loanAmount),
              isReconciled: false
            }
          ]
        }
      }
    });

    console.log('✅ [LN] Journal entry created');

    res.status(201).json({
      success: true,
      data: loan,
      message: 'Loan created successfully',
    });
  } catch (error) {
    console.error('❌ [LN] Create loan error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
// ============================================================
// @desc    Get all loans
// @route   GET /api/loans
// @access  Private
// ============================================================
exports.getLoans = async (req, res) => {
  console.log('📦 [LN] getLoans called');
  console.log('🔍 [LN] Query params:', req.query);

  try {
    const { status, loanType, search } = req.query;
    const userId = req.user.id;

    const filter = { createdBy: userId };

    if (status) filter.status = status;
    if (loanType) filter.loanType = loanType;

    if (search) {
      filter.OR = [
        { loanNumber: { contains: search, mode: 'insensitive' } },
        { lenderName: { contains: search, mode: 'insensitive' } },
        { loanType: { contains: search, mode: 'insensitive' } }
      ];
    }

    const loans = await LoanModel.findAll(filter);

    console.log(`✅ [LN] Found ${loans.length} loans`);

    res.status(200).json({
      success: true,
      count: loans.length,
      data: loans,
    });
  } catch (error) {
    console.error('❌ [LN] Get loans error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Get single loan
// @route   GET /api/loans/:id
// @access  Private
// ============================================================
exports.getLoan = async (req, res) => {
  console.log('📦 [LN] getLoan called');
  console.log('🔍 [LN] Loan ID:', req.params.id);

  try {
    const { id } = req.params;
    const userId = req.user.id;

    const loan = await prisma.loan.findFirst({
      where: {
        id,
        createdBy: userId
      },
      include: {
        lender: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            address: true
          }
        },
        bankAccount: {
          select: {
            id: true,
            accountName: true,
            accountNumber: true,
            bankName: true
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
        payments: {
          orderBy: { date: 'desc' }
        }
      }
    });

    if (!loan) {
      console.log('❌ [LN] Loan not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
      });
    }

    console.log(`✅ [LN] Loan found: ${loan.loanNumber}`);

    res.status(200).json({
      success: true,
      data: loan,
    });
  } catch (error) {
    console.error('❌ [LN] Get loan error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Update loan
// @route   PUT /api/loans/:id
// @access  Private
// ============================================================
exports.updateLoan = async (req, res) => {
  console.log('📦 [LN] updateLoan called');
  console.log('🔍 [LN] Loan ID:', req.params.id);

  try {
    const { id } = req.params;
    const userId = req.user.id;
    const {
      loanType,
      lenderName,
      lenderId,
      interestRate,
      purpose,
      collateral,
      accountNumber,
      bankAccountId,
      notes,
    } = req.body;

    // ─── Check if loan exists ──────────────────────────────
    const existingLoan = await prisma.loan.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!existingLoan) {
      console.log('❌ [LN] Loan not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
      });
    }

    // ─── Validate Lender ──────────────────────────────────
    if (lenderId) {
      await validateLender(lenderId, userId);
    }

    // ─── Validate Bank Account ──────────────────────────
    if (bankAccountId) {
      await validateBankAccount(bankAccountId, userId);
    }

    // ─── Update Loan ──────────────────────────────────────────
    const updatedLoan = await LoanModel.update(id, {
      loanType: loanType || existingLoan.loanType,
      lenderName: lenderName || existingLoan.lenderName,
      lenderId: lenderId || existingLoan.lenderId,
      interestRate: interestRate ? parseFloat(interestRate) : existingLoan.interestRate,
      purpose: purpose !== undefined ? purpose : existingLoan.purpose,
      collateral: collateral !== undefined ? collateral : existingLoan.collateral,
      accountNumber: accountNumber !== undefined ? accountNumber : existingLoan.accountNumber,
      bankAccountId: bankAccountId || existingLoan.bankAccountId,
      notes: notes !== undefined ? notes : existingLoan.notes
    });

    console.log(`✅ [LN] Loan updated: ${updatedLoan.loanNumber}`);

    res.status(200).json({
      success: true,
      data: updatedLoan,
      message: 'Loan updated successfully',
    });
  } catch (error) {
    console.error('❌ [LN] Update loan error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Record loan payment
// @route   POST /api/loans/payment
// @access  Private
// ============================================================
exports.recordPayment = async (req, res) => {
  console.log('📦 [LN] recordPayment called');
  console.log('🔍 [LN] Request body:', JSON.stringify(req.body, null, 2));

  try {
    const { loanId, amount, paymentDate, reference, notes, type } = req.body;
    const userId = req.user.id;
    const date = paymentDate ? new Date(paymentDate) : new Date();

    // ─── Check if loan exists ──────────────────────────────
    const loan = await prisma.loan.findFirst({
      where: {
        id: loanId,
        createdBy: userId
      }
    });

    if (!loan) {
      console.log('❌ [LN] Loan not found:', loanId);
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
      });
    }

    if (loan.status === 'Fully Paid') {
      return res.status(400).json({
        success: false,
        message: 'Loan is already fully paid',
      });
    }

    // ─── Record Payment ──────────────────────────────────────
    const result = await LoanModel.recordPayment(loanId, {
      amount: parseFloat(amount),
      paymentDate: date,
      reference: reference || '',
      notes: notes || '',
      type: type || 'EMI'
    });

    // ─── Create Journal Entry ──────────────────────────────
    const loanAccount = await getOrCreateLoanAccount(userId);
    const interestAccount = await getOrCreateInterestExpenseAccount(userId);

    let cashChartAccount = await getOrCreateCashAccount(userId);
    if (loan.bankAccountId) {
      const bankAccount = await prisma.bankAccount.findFirst({
        where: {
          id: loan.bankAccountId,
          createdBy: userId
        }
      });
      if (bankAccount && bankAccount.chartOfAccountId) {
        const bankChartAccount = await prisma.chartOfAccount.findFirst({
          where: {
            id: bankAccount.chartOfAccountId,
            createdBy: userId
          }
        });
        if (bankChartAccount) {
          cashChartAccount = bankChartAccount;
        }
      }
    }

    await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-${Date.now()}`,
        date: date,
        description: `Loan payment - ${loan.loanNumber}`,
        reference: reference || loan.loanNumber,
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        lines: {
          create: [
            {
              accountId: loanAccount.id,
              accountName: loanAccount.name,
              accountCode: loanAccount.code,
              debit: result.principal,
              credit: 0,
              isReconciled: false
            },
            {
              accountId: interestAccount.id,
              accountName: interestAccount.name,
              accountCode: interestAccount.code,
              debit: result.interest,
              credit: 0,
              isReconciled: false
            },
            {
              accountId: cashChartAccount.id,
              accountName: cashChartAccount.name,
              accountCode: cashChartAccount.code,
              debit: 0,
              credit: parseFloat(amount),
              isReconciled: false
            }
          ]
        }
      }
    });

    console.log(`✅ [LN] Payment recorded: ${amount}`);

    res.status(200).json({
      success: true,
      data: {
        loan: {
          id: result.loan.id,
          loanNumber: result.loan.loanNumber,
          totalPaid: result.loan.totalPaid,
          outstandingBalance: result.loan.outstandingBalance,
          status: result.loan.status,
        },
        payment: {
          amount: parseFloat(amount),
          principal: result.principal,
          interest: result.interest,
          date: date,
        },
      },
      message: 'Payment recorded successfully',
    });
  } catch (error) {
    console.error('❌ [LN] Record payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Calculate EMI
// @route   POST /api/loans/calculate-emi
// @access  Private
// ============================================================
exports.calculateEMI = async (req, res) => {
  console.log('📦 [LN] calculateEMI called');

  try {
    const { loanAmount, interestRate, tenureMonths } = req.body;

    const emi = LoanModel.calculateEMI(
      parseFloat(loanAmount),
      parseFloat(interestRate),
      parseInt(tenureMonths)
    );

    const totalPayment = emi * tenureMonths;
    const totalInterest = totalPayment - loanAmount;

    res.status(200).json({
      success: true,
      data: {
        emi: emi,
        totalPayment: totalPayment,
        totalInterest: totalInterest,
      },
    });
  } catch (error) {
    console.error('❌ [LN] Calculate EMI error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Calculate prepayment
// @route   POST /api/loans/calculate-prepayment
// @access  Private
// ============================================================
exports.calculatePrepayment = async (req, res) => {
  console.log('📦 [LN] calculatePrepayment called');

  try {
    const { loanId, prepaymentAmount } = req.body;
    const userId = req.user.id;

    const loan = await prisma.loan.findFirst({
      where: {
        id: loanId,
        createdBy: userId
      }
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
      });
    }

    const result = LoanModel.calculatePrepayment(loan, parseFloat(prepaymentAmount));

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('❌ [LN] Calculate prepayment error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Prepay loan
// @route   POST /api/loans/prepay
// @access  Private
// ============================================================
exports.prepayLoan = async (req, res) => {
  console.log('📦 [LN] prepayLoan called');

  try {
    const { loanId, prepaymentAmount, paymentDate, reference } = req.body;
    const userId = req.user.id;
    const date = paymentDate ? new Date(paymentDate) : new Date();

    const loan = await prisma.loan.findFirst({
      where: {
        id: loanId,
        createdBy: userId
      }
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
      });
    }

    if (loan.status === 'Fully Paid') {
      return res.status(400).json({
        success: false,
        message: 'Loan is already fully paid',
      });
    }

    const amount = parseFloat(prepaymentAmount);
    if (amount > loan.outstandingBalance) {
      return res.status(400).json({
        success: false,
        message: `Prepayment amount cannot exceed outstanding balance of ${loan.outstandingBalance}`,
      });
    }

    const prepaymentResult = LoanModel.calculatePrepayment(loan, amount);

    // Record prepayment as a special payment
    const result = await LoanModel.recordPayment(loanId, {
      amount: amount,
      paymentDate: date,
      reference: reference || '',
      notes: 'Prepayment',
      type: 'Prepayment'
    });

    // ─── Create Journal Entry ──────────────────────────────
    const loanAccount = await getOrCreateLoanAccount(userId);
    let cashChartAccount = await getOrCreateCashAccount(userId);

    if (loan.bankAccountId) {
      const bankAccount = await prisma.bankAccount.findFirst({
        where: {
          id: loan.bankAccountId,
          createdBy: userId
        }
      });
      if (bankAccount && bankAccount.chartOfAccountId) {
        const bankChartAccount = await prisma.chartOfAccount.findFirst({
          where: {
            id: bankAccount.chartOfAccountId,
            createdBy: userId
          }
        });
        if (bankChartAccount) {
          cashChartAccount = bankChartAccount;
        }
      }
    }

    await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-${Date.now()}`,
        date: date,
        description: `Loan prepayment - ${loan.loanNumber}`,
        reference: reference || loan.loanNumber,
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        lines: {
          create: [
            {
              accountId: loanAccount.id,
              accountName: loanAccount.name,
              accountCode: loanAccount.code,
              debit: amount,
              credit: 0,
              isReconciled: false
            },
            {
              accountId: cashChartAccount.id,
              accountName: cashChartAccount.name,
              accountCode: cashChartAccount.code,
              debit: 0,
              credit: amount,
              isReconciled: false
            }
          ]
        }
      }
    });

    console.log(`✅ [LN] Prepayment recorded: ${amount}`);

    res.status(200).json({
      success: true,
      data: {
        loan: {
          id: result.loan.id,
          loanNumber: result.loan.loanNumber,
          totalPaid: result.loan.totalPaid,
          outstandingBalance: result.loan.outstandingBalance,
          status: result.loan.status,
        },
        prepayment: prepaymentResult,
      },
      message: `Prepayment of ${amount} recorded successfully`,
    });
  } catch (error) {
    console.error('❌ [LN] Prepay loan error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Get loan summary
// @route   GET /api/loans/summary
// @access  Private
// ============================================================
exports.getSummary = async (req, res) => {
  console.log('📦 [LN] getSummary called');

  try {
    const userId = req.user.id;

    const stats = await LoanModel.getStats(userId);

    console.log('✅ [LN] Summary generated');

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('❌ [LN] Get summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Get payment schedule
// @route   GET /api/loans/:id/schedule
// @access  Private
// ============================================================
exports.getPaymentSchedule = async (req, res) => {
  console.log('📦 [LN] getPaymentSchedule called');
  console.log('🔍 [LN] Loan ID:', req.params.id);

  try {
    const { id } = req.params;
    const userId = req.user.id;

    const loan = await prisma.loan.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
      });
    }

    const schedule = LoanModel.getPaymentSchedule(loan);

    res.status(200).json({
      success: true,
      data: schedule,
    });
  } catch (error) {
    console.error('❌ [LN] Get payment schedule error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Delete loan
// @route   DELETE /api/loans/:id
// @access  Private
// ============================================================
exports.deleteLoan = async (req, res) => {
  console.log('📦 [LN] deleteLoan called');
  console.log('🔍 [LN] Loan ID:', req.params.id);

  try {
    const { id } = req.params;
    const userId = req.user.id;

    // ─── Check if loan exists ──────────────────────────────
    const loan = await prisma.loan.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!loan) {
      console.log('❌ [LN] Loan not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
      });
    }

    // ─── Check if payments exist ──────────────────────────
    if (loan.totalPaid > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete loan with payments recorded',
      });
    }

    // ─── Delete Loan ──────────────────────────────────────────
    await LoanModel.delete(id);

    console.log(`✅ [LN] Loan deleted: ${loan.loanNumber}`);

    res.status(200).json({
      success: true,
      message: 'Loan deleted successfully',
    });
  } catch (error) {
    console.error('❌ [LN] Delete loan error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};