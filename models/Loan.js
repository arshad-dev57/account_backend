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
  // ✅ GENERATE UNIQUE LOAN NUMBER - FIXED
  // ============================================================
  static async generateLoanNumber(companyId) {
    const prefix = 'LN-';
    
    // Get all existing loan numbers for this company
    const existingLoans = await prisma.loan.findMany({
      where: {
        companyId: companyId,
        loanNumber: {
          startsWith: prefix
        }
      },
      select: {
        loanNumber: true
      }
    });

    console.log(`🔍 [LN] Found ${existingLoans.length} existing loans`);

    if (existingLoans.length === 0) {
      // No loans exist, start with LN-0001
      return `${prefix}0001`;
    }

    // Extract numbers from existing codes
    const numbers = [];
    for (const loan of existingLoans) {
      const parts = loan.loanNumber.split('-');
      if (parts.length === 2) {
        const num = parseInt(parts[1]);
        if (!isNaN(num)) {
          numbers.push(num);
        }
      }
    }

    if (numbers.length === 0) {
      return `${prefix}0001`;
    }

    // Sort numbers and find the next available number
    numbers.sort((a, b) => a - b);
    
    // Find the first gap in the sequence
    let nextNumber = 1;
    for (const num of numbers) {
      if (num === nextNumber) {
        nextNumber++;
      } else if (num > nextNumber) {
        break;
      }
    }

    // Pad with zeros to 4 digits
    const paddedNumber = String(nextNumber).padStart(4, '0');
    const loanNumber = `${prefix}${paddedNumber}`;
    
    console.log(`🔍 [LN] Generated loan number: ${loanNumber} (next available number: ${nextNumber})`);
    return loanNumber;
  }

  // ============================================================
  // ✅ GENERATE FALLBACK LOAN NUMBER (when all else fails)
  // ============================================================
  static async generateFallbackNumber(companyId) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    const fallbackNumber = `LN-${timestamp}${random}`.substring(0, 15);
    
    // Make sure it's unique
    const existing = await prisma.loan.findFirst({
      where: {
        loanNumber: fallbackNumber,
        companyId: companyId
      }
    });

    if (existing) {
      // If somehow this also exists, add more random
      return `LN-${timestamp}${random}${Math.random().toString(36).substring(2, 4).toUpperCase()}`;
    }

    return fallbackNumber;
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
  // ✅ CREATE LOAN - FIXED
  // ============================================================
  static async create(data) {
    const errors = this.validateLoanData(data);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    // Generate unique loan number with retry logic
    let loanNumber = await this.generateLoanNumber(data.companyId);
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      // Check if this number already exists
      const existing = await prisma.loan.findFirst({
        where: {
          loanNumber: loanNumber,
          companyId: data.companyId
        }
      });

      if (!existing) {
        // Number is unique, break out of loop
        break;
      }

      // Number exists, generate a new one
      console.log(`⚠️ [LN] Loan number ${loanNumber} already exists, generating new one...`);
      loanNumber = await this.generateLoanNumber(data.companyId);
      attempts++;
    }

    // If still not unique after max attempts, use fallback
    if (attempts >= maxAttempts) {
      console.log(`⚠️ [LN] Max attempts reached, using fallback number...`);
      loanNumber = await this.generateFallbackNumber(data.companyId);
    }

    console.log(`✅ [LN] Final loan number: ${loanNumber}`);

    const emiAmount = this.calculateEMI(data.loanAmount, data.interestRate, data.tenureMonths);

    // Calculate next payment date
    const nextPaymentDate = new Date(data.disbursementDate);
    nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

    try {
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
          createdBy: data.createdBy,
          companyId: data.companyId,
          fiscalYearId: data.fiscalYearId || null
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
    } catch (error) {
      // If unique constraint fails, try one more time with fallback
      if (error.code === 'P2002') {
        console.log('⚠️ [LN] Duplicate loan number, trying fallback...');
        const fallbackNumber = await this.generateFallbackNumber(data.companyId);
        console.log(`🔍 [LN] Fallback number: ${fallbackNumber}`);
        
        return await prisma.loan.create({
          data: {
            loanNumber: fallbackNumber,
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
            createdBy: data.createdBy,
            companyId: data.companyId,
            fiscalYearId: data.fiscalYearId || null
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
      throw error;
    }
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
  static async findByLoanNumber(loanNumber, companyId) {
    return await prisma.loan.findFirst({
      where: {
        loanNumber,
        companyId: companyId
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
  static async getStats(companyId) {
    const filter = { companyId: companyId };

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