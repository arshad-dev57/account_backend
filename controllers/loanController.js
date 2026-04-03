const Loan = require('../models/Loan');
const Vendor = require('../models/Vendor');
const BankAccount = require('../models/BankAccount');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

// Helper: Get or create Loan Liability account
async function getOrCreateLoanAccount(userId) {
  let loanAccount = await ChartOfAccount.findOne({ 
    code: '2100',
    createdBy: userId  // 👈 Only find account created by this user
  });
  
  if (!loanAccount) {
    loanAccount = await ChartOfAccount.create({
      code: '2100',
      name: 'Loans Payable',
      type: 'Liabilities',
      parentAccount: 'Long Term Liabilities',
      openingBalance: 0,
      description: 'Loans and borrowings',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return loanAccount;
}

// Helper: Get or create Interest Expense account
async function getOrCreateInterestExpenseAccount(userId) {
  let interestAccount = await ChartOfAccount.findOne({ 
    code: '6200',
    createdBy: userId  // 👈 Only find account created by this user
  });
  
  if (!interestAccount) {
    interestAccount = await ChartOfAccount.create({
      code: '6200',
      name: 'Interest Expense',
      type: 'Expenses',
      parentAccount: 'Financial Expenses',
      openingBalance: 0,
      description: 'Interest on loans',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return interestAccount;
}

// Helper: Get cash account
async function getOrCreateCashAccount(userId) {
  let cashAccount = await ChartOfAccount.findOne({ 
    code: '1010',
    createdBy: userId  // 👈 Only find account created by this user
  });
  
  if (!cashAccount) {
    cashAccount = await ChartOfAccount.create({
      code: '1010',
      name: 'Cash in Hand',
      type: 'Assets',
      parentAccount: 'Current Assets',
      openingBalance: 0,
      description: 'Physical cash',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return cashAccount;
}

// ==================== CREATE LOAN ====================
exports.createLoan = async (req, res) => {
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

    // Validate lender if provided - must belong to user
    if (lenderId) {
      const lender = await Vendor.findOne({
        _id: lenderId,
        createdBy: req.user.id
      });
      if (!lender) {
        return res.status(404).json({
          success: false,
          message: 'Lender not found',
        });
      }
    }

    // Validate bank account if provided - must belong to user
    if (bankAccountId) {
      const bankAccount = await BankAccount.findOne({
        _id: bankAccountId,
        createdBy: req.user.id
      });
      if (!bankAccount) {
        return res.status(404).json({
          success: false,
          message: 'Bank account not found',
        });
      }
    }

    // Calculate EMI
    const P = loanAmount;
    const r = (interestRate / 100) / 12;
    const n = tenureMonths;
    let emiAmount = 0;
    
    if (r === 0) {
      emiAmount = P / n;
    } else {
      emiAmount = P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    }
    emiAmount = Math.round(emiAmount * 100) / 100;

    // Calculate next payment date
    const nextPaymentDate = new Date(disbursementDate);
    nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

    // Create loan
    const loan = await Loan.create({
      loanType,
      lenderName,
      lenderId: lenderId || null,
      loanAmount,
      disbursementDate,
      interestRate,
      tenureMonths,
      emiAmount,
      totalPaid: 0,
      outstandingBalance: loanAmount,
      nextPaymentDate,
      status: 'Active',
      purpose: purpose || '',
      collateral: collateral || '',
      accountNumber: accountNumber || '',
      bankAccountId: bankAccountId || null,
      notes: notes || '',
      createdBy: req.user.id,
    });

    // Create journal entry for loan disbursement
    const loanAccount = await getOrCreateLoanAccount(req.user.id);
    let cashChartAccount;
    
    if (bankAccountId) {
      const bankAccount = await BankAccount.findOne({
        _id: bankAccountId,
        createdBy: req.user.id
      });
      if (bankAccount) {
        cashChartAccount = await ChartOfAccount.findOne({
          _id: bankAccount.chartOfAccountId,
          createdBy: req.user.id
        });
      }
    }
    
    if (!cashChartAccount) {
      cashChartAccount = await getOrCreateCashAccount(req.user.id);
    }

    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: disbursementDate,
      description: `Loan disbursement - ${loanType} from ${lenderName}`,
      reference: loan.loanNumber,
      lines: [
        {
          accountId: cashChartAccount._id,
          accountName: cashChartAccount.name,
          accountCode: cashChartAccount.code,
          debit: loanAmount,
          credit: 0,
        },
        {
          accountId: loanAccount._id,
          accountName: loanAccount.name,
          accountCode: loanAccount.code,
          debit: 0,
          credit: loanAmount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      data: loan,
      message: 'Loan created successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET ALL LOANS ====================
exports.getLoans = async (req, res) => {
  try {
    const { status, loanType, search } = req.query;
    let query = {
      createdBy: req.user.id  // 👈 Only show loans created by this user
    };

    if (status) query.status = status;
    if (loanType) query.loanType = loanType;
    
    if (search) {
      query.$or = [
        { loanNumber: { $regex: search, $options: 'i' } },
        { lenderName: { $regex: search, $options: 'i' } },
        { loanType: { $regex: search, $options: 'i' } },
      ];
    }

    const loans = await Loan.find(query)
      .populate('lenderId', 'name email phone')
      .populate('bankAccountId', 'accountName accountNumber')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: loans.length,
      data: loans,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET SINGLE LOAN ====================
exports.getLoan = async (req, res) => {
  try {
    const loan = await Loan.findOne({
      _id: req.params.id,
      createdBy: req.user.id  // 👈 Only allow if user owns this loan
    })
      .populate('lenderId', 'name email phone')
      .populate('bankAccountId', 'accountName accountNumber');

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
      });
    }

    res.status(200).json({
      success: true,
      data: loan,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== UPDATE LOAN ====================
exports.updateLoan = async (req, res) => {
  try {
    const loan = await Loan.findOne({
      _id: req.params.id,
      createdBy: req.user.id  // 👈 Only allow if user owns this loan
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
      });
    }

    // Validate lender if updating
    if (req.body.lenderId) {
      const lender = await Vendor.findOne({
        _id: req.body.lenderId,
        createdBy: req.user.id
      });
      if (!lender) {
        return res.status(404).json({
          success: false,
          message: 'Lender not found',
        });
      }
    }

    // Validate bank account if updating
    if (req.body.bankAccountId) {
      const bankAccount = await BankAccount.findOne({
        _id: req.body.bankAccountId,
        createdBy: req.user.id
      });
      if (!bankAccount) {
        return res.status(404).json({
          success: false,
          message: 'Bank account not found',
        });
      }
    }

    const allowedUpdates = [
      'loanType', 'lenderName', 'lenderId', 'interestRate', 
      'purpose', 'collateral', 'accountNumber', 'bankAccountId', 'notes'
    ];
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        loan[field] = req.body[field];
      }
    });

    await loan.save();

    res.status(200).json({
      success: true,
      data: loan,
      message: 'Loan updated successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== RECORD LOAN PAYMENT ====================
exports.recordPayment = async (req, res) => {
  try {
    const { loanId, amount, paymentDate, reference, notes, type } = req.body;
    const date = paymentDate ? new Date(paymentDate) : new Date();

    const loan = await Loan.findOne({
      _id: loanId,
      createdBy: req.user.id  // 👈 Only allow if user owns this loan
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

    // Record payment
    const result = await loan.recordPayment(amount, date, reference, notes, type || 'EMI');

    // Create journal entry for payment
    const loanAccount = await getOrCreateLoanAccount(req.user.id);
    let cashChartAccount;
    
    if (loan.bankAccountId) {
      const bankAccount = await BankAccount.findOne({
        _id: loan.bankAccountId,
        createdBy: req.user.id
      });
      if (bankAccount) {
        cashChartAccount = await ChartOfAccount.findOne({
          _id: bankAccount.chartOfAccountId,
          createdBy: req.user.id
        });
      }
    }
    
    if (!cashChartAccount) {
      cashChartAccount = await getOrCreateCashAccount(req.user.id);
    }

    // Calculate interest portion (simplified)
    const interestPortion = loan.interestRate / 100 / 12 * loan.outstandingBalance;
    const principalPortion = amount - interestPortion;

    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: date,
      description: `Loan payment - ${loan.loanNumber}`,
      reference: reference || loan.loanNumber,
      lines: [
        {
          accountId: loanAccount._id,
          accountName: loanAccount.name,
          accountCode: loanAccount.code,
          debit: principalPortion,
          credit: 0,
        },
        {
          accountId: (await getOrCreateInterestExpenseAccount(req.user.id))._id,
          accountName: 'Interest Expense',
          accountCode: '6200',
          debit: interestPortion,
          credit: 0,
        },
        {
          accountId: cashChartAccount._id,
          accountName: cashChartAccount.name,
          accountCode: cashChartAccount.code,
          debit: 0,
          credit: amount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      data: {
        loan: {
          id: loan._id,
          loanNumber: loan.loanNumber,
          totalPaid: loan.totalPaid,
          outstandingBalance: loan.outstandingBalance,
          status: loan.status,
        },
        payment: {
          amount: amount,
          principal: principalPortion,
          interest: interestPortion,
          date: date,
        },
      },
      message: 'Payment recorded successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== CALCULATE EMI ====================
exports.calculateEMI = async (req, res) => {
  try {
    const { loanAmount, interestRate, tenureMonths } = req.body;

    const P = loanAmount;
    const r = (interestRate / 100) / 12;
    const n = tenureMonths;
    let emi = 0;

    if (r === 0) {
      emi = P / n;
    } else {
      emi = P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    }
    emi = Math.round(emi * 100) / 100;

    const totalPayment = emi * n;
    const totalInterest = totalPayment - P;

    res.status(200).json({
      success: true,
      data: {
        emi: emi,
        totalPayment: totalPayment,
        totalInterest: totalInterest,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== PREPAYMENT CALCULATION ====================
exports.calculatePrepayment = async (req, res) => {
  try {
    const { loanId, prepaymentAmount } = req.body;

    const loan = await Loan.findOne({
      _id: loanId,
      createdBy: req.user.id  // 👈 Only allow if user owns this loan
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
      });
    }

    const result = await loan.calculatePrepayment(prepaymentAmount);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== PREPAY LOAN ====================
exports.prepayLoan = async (req, res) => {
  try {
    const { loanId, prepaymentAmount, paymentDate, reference } = req.body;
    const date = paymentDate ? new Date(paymentDate) : new Date();

    const loan = await Loan.findOne({
      _id: loanId,
      createdBy: req.user.id  // 👈 Only allow if user owns this loan
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

    if (prepaymentAmount > loan.outstandingBalance) {
      return res.status(400).json({
        success: false,
        message: `Prepayment amount cannot exceed outstanding balance of ${loan.outstandingBalance}`,
      });
    }

    const prepaymentResult = await loan.calculatePrepayment(prepaymentAmount);
    
    // Record prepayment as a special payment
    const result = await loan.recordPayment(prepaymentAmount, date, reference, 'Prepayment', 'Prepayment');

    // Create journal entry for prepayment
    const loanAccount = await getOrCreateLoanAccount(req.user.id);
    const cashAccount = await getOrCreateCashAccount(req.user.id);

    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: date,
      description: `Loan prepayment - ${loan.loanNumber}`,
      reference: reference || loan.loanNumber,
      lines: [
        {
          accountId: loanAccount._id,
          accountName: loanAccount.name,
          accountCode: loanAccount.code,
          debit: prepaymentAmount,
          credit: 0,
        },
        {
          accountId: cashAccount._id,
          accountName: cashAccount.name,
          accountCode: cashAccount.code,
          debit: 0,
          credit: prepaymentAmount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      data: {
        loan: {
          id: loan._id,
          loanNumber: loan.loanNumber,
          totalPaid: loan.totalPaid,
          outstandingBalance: loan.outstandingBalance,
          status: loan.status,
        },
        prepayment: prepaymentResult,
      },
      message: `Prepayment of ${prepaymentAmount} recorded successfully`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET LOAN SUMMARY ====================
exports.getSummary = async (req, res) => {
  try {
    const loans = await Loan.find({
      createdBy: req.user.id  // 👈 Only show loans created by this user
    });

    const totalLoans = loans.length;
    const totalPrincipal = loans.reduce((sum, l) => sum + l.loanAmount, 0);
    const totalOutstanding = loans.reduce((sum, l) => sum + l.outstandingBalance, 0);
    const totalPaid = loans.reduce((sum, l) => sum + l.totalPaid, 0);
    const totalEMI = loans
      .filter(l => l.status === 'Active')
      .reduce((sum, l) => sum + l.emiAmount, 0);

    const activeCount = loans.filter(l => l.status === 'Active').length;
    const fullyPaidCount = loans.filter(l => l.status === 'Fully Paid').length;
    const overdueCount = loans.filter(l => l.status === 'Overdue').length;

    res.status(200).json({
      success: true,
      data: {
        totalLoans,
        totalPrincipal,
        totalOutstanding,
        totalPaid,
        totalEMI,
        activeCount,
        fullyPaidCount,
        overdueCount,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET PAYMENT SCHEDULE ====================
exports.getPaymentSchedule = async (req, res) => {
  try {
    const loan = await Loan.findOne({
      _id: req.params.id,
      createdBy: req.user.id  // 👈 Only allow if user owns this loan
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
      });
    }

    const schedule = [];
    let remainingBalance = loan.loanAmount;
    const monthlyRate = loan.interestRate / 100 / 12;
    const date = new Date(loan.disbursementDate);

    for (let i = 1; i <= loan.tenureMonths; i++) {
      const interest = remainingBalance * monthlyRate;
      const principal = loan.emiAmount - interest;
      const endingBalance = remainingBalance - principal;

      const paymentDate = new Date(date);
      paymentDate.setMonth(date.getMonth() + i);

      schedule.push({
        installmentNo: i,
        dueDate: paymentDate,
        emiAmount: loan.emiAmount,
        principal: principal,
        interest: interest,
        endingBalance: endingBalance > 0 ? endingBalance : 0,
        status: paymentDate < new Date() ? 'Overdue' : 'Pending',
      });

      remainingBalance = endingBalance;
    }

    res.status(200).json({
      success: true,
      data: schedule,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== DELETE LOAN ====================
exports.deleteLoan = async (req, res) => {
  try {
    const loan = await Loan.findOne({
      _id: req.params.id,
      createdBy: req.user.id  // 👈 Only allow if user owns this loan
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
      });
    }

    if (loan.totalPaid > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete loan with payments recorded',
      });
    }

    await loan.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Loan deleted successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};