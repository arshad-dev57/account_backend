const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  type: {
    type: String,
    enum: ['EMI', 'Prepayment', 'Interest Only'],
    default: 'EMI',
  },
  status: {
    type: String,
    enum: ['Paid', 'Pending', 'Overdue'],
    default: 'Pending',
  },
  reference: {
    type: String,
    default: '',
  },
  notes: {
    type: String,
    default: '',
  },
});

const LoanSchema = new mongoose.Schema(
  {
    loanNumber: {
      type: String,
      unique: true,
    },
    loanType: {
      type: String,
      enum: ['Bank Loan', 'Business Loan', 'Vehicle Loan', 'Personal Loan', 'Overdraft', 'Lease Financing'],
      required: true,
    },
    lenderName: {
      type: String,
      required: true,
    },
    lenderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
    },
    loanAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    disbursementDate: {
      type: Date,
      required: true,
    },
    interestRate: {
      type: Number,
      required: true,
      min: 0,
    },
    tenureMonths: {
      type: Number,
      required: true,
      min: 1,
    },
    emiAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    totalPaid: {
      type: Number,
      default: 0,
    },
    outstandingBalance: {
      type: Number,
      default: function() {
        return this.loanAmount - this.totalPaid;
      },
    },
    nextPaymentDate: {
      type: Date,
    },
    lastPaymentDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['Active', 'Fully Paid', 'Overdue', 'Defaulted'],
      default: 'Active',
    },
    purpose: {
      type: String,
      default: '',
    },
    collateral: {
      type: String,
      default: '',
    },
    accountNumber: {
      type: String,
      default: '',
    },
    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    notes: {
      type: String,
      default: '',
    },
    payments: [PaymentSchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Generate loan number before save
LoanSchema.pre('save', async function() {
  if (this.isNew && !this.loanNumber) {
    try {
      const count = await mongoose.model('Loan').countDocuments();
      const year = new Date().getFullYear();
      this.loanNumber = `LN-${year}-${String(count + 1).padStart(4, '0')}`;
    } catch (error) {
    }
  }
  
  // Calculate outstanding balance
  this.outstandingBalance = this.loanAmount - this.totalPaid;
  
  // Update status based on outstanding balance
  if (this.outstandingBalance <= 0) {
    this.status = 'Fully Paid';
  } else if (this.nextPaymentDate && this.nextPaymentDate < new Date() && this.status === 'Active') {
    this.status = 'Overdue';
  }
  
});

// Calculate EMI using formula: P * r * (1+r)^n / ((1+r)^n - 1)
LoanSchema.methods.calculateEMI = function() {
  const P = this.loanAmount;
  const r = (this.interestRate / 100) / 12; // Monthly interest rate
  const n = this.tenureMonths;
  
  if (r === 0) return P / n;
  
  const emi = P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  return Math.round(emi * 100) / 100;
};

// Record payment
LoanSchema.methods.recordPayment = async function(amount, paymentDate, reference, notes, type = 'EMI') {
  // Validate payment amount
  if (amount > this.outstandingBalance) {
    throw new Error(`Payment amount (${amount}) exceeds outstanding balance (${this.outstandingBalance})`);
  }
  
  // Update loan
  this.totalPaid += amount;
  this.outstandingBalance = this.loanAmount - this.totalPaid;
  this.lastPaymentDate = paymentDate;
  
  // Calculate next payment date
  if (this.status === 'Active') {
    const nextDate = new Date(paymentDate);
    nextDate.setMonth(nextDate.getMonth() + 1);
    this.nextPaymentDate = nextDate;
  }
  
  // Add payment record
  this.payments.push({
    date: paymentDate,
    amount: amount,
    type: type,
    status: 'Paid',
    reference: reference,
    notes: notes,
  });
  
  // Update status
  if (this.outstandingBalance <= 0) {
    this.status = 'Fully Paid';
  } else if (this.nextPaymentDate && this.nextPaymentDate < new Date()) {
    this.status = 'Overdue';
  } else {
    this.status = 'Active';
  }
  
  await this.save();
  
  return {
    amount: amount,
    totalPaid: this.totalPaid,
    outstandingBalance: this.outstandingBalance,
    status: this.status,
  };
};

// Prepayment calculation
LoanSchema.methods.calculatePrepayment = function(prepaymentAmount) {
  const remainingEMIs = Math.ceil(this.outstandingBalance / this.emiAmount);
  const interestSaved = this.calculateRemainingInterest();
  const prepaymentPenalty = prepaymentAmount * 0.02; // 2% penalty (adjustable)
  
  return {
    prepaymentAmount: prepaymentAmount,
    interestSaved: interestSaved,
    prepaymentPenalty: prepaymentPenalty,
    netSaving: interestSaved - prepaymentPenalty,
    newOutstandingBalance: this.outstandingBalance - prepaymentAmount,
  };
};

// Calculate remaining interest
LoanSchema.methods.calculateRemainingInterest = function() {
  const remainingMonths = Math.ceil(this.outstandingBalance / this.emiAmount);
  const totalRemainingPayment = this.emiAmount * remainingMonths;
  return totalRemainingPayment - this.outstandingBalance;
};

module.exports = mongoose.model('Loan', LoanSchema);