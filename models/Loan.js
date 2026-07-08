const prisma = require('../prisma/client');

// ─── CONSTANTS ─────────────────────────────────────────────────────
const VALID_LOAN_TYPES = ['Bank Loan', 'Business Loan', 'Vehicle Loan', 'Personal Loan', 'Overdraft', 'Lease Financing'];
const VALID_STATUS = ['Active', 'Fully Paid', 'Overdue', 'Defaulted'];
const VALID_PAYMENT_TYPES = ['EMI', 'Prepayment', 'Interest Only'];
const VALID_PAYMENT_STATUS = ['Paid', 'Pending', 'Overdue'];

class LoanModel {
  // ============================================================
  // ✅ VALIDATE LOAN DATA
  // ============================================================
  static validateLoanData(data) {
    const errors = [];

    if (!data.loanType) errors.push('Loan type is required');
    if (!data.lenderName) errors.push('Lender name is required');
    if (!data.loanAmount || data.loanAmount <= 0) errors.push('Loan amount must be greater than 0');
    if (!data.disbursementDate) errors.push('Disbursement date is required');
    if (!data.interestRate || data.interestRate < 0) errors.push('Interest rate must be greater than 0');
    if (!data.tenureMonths || data.tenureMonths < 1) errors.push('Tenure months must be at least 1');

    if (data.loanType && !VALID_LOAN_TYPES.includes(data.loanType)) {
      errors.push(`Invalid loan type. Must be one of: ${VALID_LOAN_TYPES.join(', ')}`);
    }

    if (data.status && !VALID_STATUS.includes(data.status)) {
      errors.push(`Invalid status. Must be one of: ${VALID_STATUS.join(', ')}`);
    }

    return errors;
  }

  // ============================================================
  // ✅ GENERATE LOAN NUMBER
  // ============================================================
  static async generateLoanNumber(userId) {
    const count = await prisma.loan.count({
      where: { createdBy: userId }
    });
    const year = new Date().getFullYear();
    return `LN-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  // ============================================================
  // ✅ CALCULATE EMI
  // ============================================================
  static calculateEMI(loanAmount, interestRate, tenureMonths) {
    const P = loanAmount;
    const r = (interestRate / 100) / 12;
    const n = tenureMonths;

    if (r === 0) return P / n;

    const emi = P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    return Math.round(emi * 100) / 100;
  }

  // ============================================================
  // ✅ CALCULATE REMAINING INTEREST
  // ============================================================
  static calculateRemainingInterest(outstandingBalance, emiAmount) {
    const remainingMonths = Math.ceil(outstandingBalance / emiAmount);
    const totalRemainingPayment = emiAmount * remainingMonths;
    return totalRemainingPayment - outstandingBalance;
  }

  // ============================================================
  // ✅ CREATE LOAN
  // ============================================================
  static async create(data) {
    const errors = this.validateLoanData(data);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    const loanNumber = await this.generateLoanNumber(data.createdBy);
    const emiAmount = this.calculateEMI(data.loanAmount, data.interestRate, data.tenureMonths);

    // Calculate next payment date
    const nextPaymentDate = new Date(data.disbursementDate);
    nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

    return await prisma.loan.create({
      data: {
        loanNumber,
        loanType: data.loanType,
        lenderName: data.lenderName,
        lenderId: data.lenderId || null,
        loanAmount: data.loanAmount,
        disbursementDate: data.disbursementDate,
        interestRate: data.interestRate,
        tenureMonths: data.tenureMonths,
        emiAmount: emiAmount,
        totalPaid: 0,
        outstandingBalance: data.loanAmount,
        nextPaymentDate: nextPaymentDate,
        status: 'Active',
        purpose: data.purpose || '',
        collateral: data.collateral || '',
        accountNumber: data.accountNumber || '',
        bankAccountId: data.bankAccountId || null,
        notes: data.notes || '',
        createdBy: data.createdBy
      },
      include: {
        lender: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
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
        }
      }
    });
  }

  // ============================================================
  // ✅ FIND ALL LOANS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { createdAt: 'desc' } } = options;

    return await prisma.loan.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        lender: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
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
          orderBy: { date: 'desc' },
          take: 5
        }
      }
    });
  }

  // ============================================================
  // ✅ FIND LOAN BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.loan.findUnique({
      where: { id },
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
  }

  // ============================================================
  // ✅ FIND BY LOAN NUMBER
  // ============================================================
  static async findByLoanNumber(loanNumber, createdBy) {
    return await prisma.loan.findFirst({
      where: {
        loanNumber,
        createdBy
      },
      include: {
        lender: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
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
        payments: {
          orderBy: { date: 'desc' }
        }
      }
    });
  }

  // ============================================================
  // ✅ UPDATE LOAN
  // ============================================================
  static async update(id, data) {
    const existing = await prisma.loan.findUnique({
      where: { id }
    });

    if (!existing) return null;

    const mergedData = { ...existing, ...data };
    const errors = this.validateLoanData(mergedData);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    return await prisma.loan.update({
      where: { id },
      data: {
        loanType: data.loanType,
        lenderName: data.lenderName,
        lenderId: data.lenderId,
        interestRate: data.interestRate,
        purpose: data.purpose,
        collateral: data.collateral,
        accountNumber: data.accountNumber,
        bankAccountId: data.bankAccountId,
        notes: data.notes
      },
      include: {
        lender: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
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
        }
      }
    });
  }

  // ============================================================
  // ✅ RECORD PAYMENT
  // ============================================================
  static async recordPayment(loanId, data) {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId }
    });

    if (!loan) return null;

    if (loan.status === 'Fully Paid') {
      throw new Error('Loan is already fully paid');
    }

    if (data.amount > loan.outstandingBalance) {
      throw new Error(`Payment amount (${data.amount}) exceeds outstanding balance (${loan.outstandingBalance})`);
    }

    // Calculate interest portion
    const monthlyRate = loan.interestRate / 100 / 12;
    const interestPortion = loan.outstandingBalance * monthlyRate;
    const principalPortion = data.amount - interestPortion;

    const newTotalPaid = loan.totalPaid + data.amount;
    const newOutstandingBalance = loan.loanAmount - newTotalPaid;

    // Calculate next payment date
    const nextPaymentDate = new Date(data.paymentDate);
    nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

    // Determine status
    let status = 'Active';
    if (newOutstandingBalance <= 0) {
      status = 'Fully Paid';
    } else if (nextPaymentDate < new Date() && status === 'Active') {
      status = 'Overdue';
    }

    // Update loan
    const updatedLoan = await prisma.loan.update({
      where: { id: loanId },
      data: {
        totalPaid: newTotalPaid,
        outstandingBalance: newOutstandingBalance > 0 ? newOutstandingBalance : 0,
        lastPaymentDate: data.paymentDate,
        nextPaymentDate: status === 'Fully Paid' ? null : nextPaymentDate,
        status: status
      }
    });

    // Create payment record
    const payment = await prisma.loanPayment.create({
      data: {
        loanId: loanId,
        date: data.paymentDate,
        amount: data.amount,
        type: data.type || 'EMI',
        status: 'Paid',
        reference: data.reference || '',
        notes: data.notes || ''
      }
    });

    return {
      loan: updatedLoan,
      payment: payment,
      principal: principalPortion,
      interest: interestPortion
    };
  }

  // ============================================================
  // ✅ CALCULATE PREPAYMENT
  // ============================================================
  static calculatePrepayment(loan, prepaymentAmount) {
    const interestSaved = this.calculateRemainingInterest(loan.outstandingBalance, loan.emiAmount);
    const prepaymentPenalty = prepaymentAmount * 0.02; // 2% penalty

    return {
      prepaymentAmount: prepaymentAmount,
      interestSaved: interestSaved,
      prepaymentPenalty: prepaymentPenalty,
      netSaving: interestSaved - prepaymentPenalty,
      newOutstandingBalance: loan.outstandingBalance - prepaymentAmount
    };
  }

  // ============================================================
  // ✅ GET PAYMENT SCHEDULE
  // ============================================================
  static getPaymentSchedule(loan) {
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
        status: paymentDate < new Date() ? 'Overdue' : 'Pending'
      });

      remainingBalance = endingBalance;
    }

    return schedule;
  }

  // ============================================================
  // ✅ GET SUMMARY STATISTICS
  // ============================================================
  static async getStats(createdBy) {
    const filter = { createdBy };

    const loans = await prisma.loan.findMany({
      where: filter
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

    return {
      totalLoans,
      totalPrincipal,
      totalOutstanding,
      totalPaid,
      totalEMI,
      activeCount,
      fullyPaidCount,
      overdueCount
    };
  }

  // ============================================================
  // ✅ DELETE LOAN
  // ============================================================
  static async delete(id) {
    return await prisma.loan.delete({
      where: { id }
    });
  }
}

module.exports = LoanModel;