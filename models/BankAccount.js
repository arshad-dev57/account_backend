const mongoose = require('mongoose');

const BankAccountSchema = new mongoose.Schema(
  {
    // Basic Information
    accountName: {
      type: String,
      required: [true, 'Account name is required'],
      trim: true,
    },
    accountNumber: {
      type: String,
      required: [true, 'Account number is required'],
      trim: true,
      unique: true,
    },
    bankName: {
      type: String,
      required: [true, 'Bank name is required'],
      trim: true,
    },
    branchCode: {
      type: String,
      default: '',
    },
      accountCode: {
      type: String,
      default: '',
    },
    // Account Details
    accountType: {
      type: String,
      enum: ['Current', 'Savings', 'Business', 'Islamic'],
      default: 'Current',
    },
    currency: {
      type: String,
      enum: ['PKR', 'USD', 'EUR', 'GBP'],
      default: 'PKR',
    },
    
    // Financial Information
    openingBalance: {
      type: Number,
      default: 0.0,
    },
    currentBalance: {
      type: Number,
      default: 0.0,
    },
    
    // Status
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
    
    // Reconciliation
    lastReconciled: {
      type: Date,
      default: Date.now,
    },
    
    // Reference to Chart of Accounts
    chartOfAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChartOfAccount',
      required: true,
    },
    
    // Audit
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

module.exports = mongoose.model('BankAccount', BankAccountSchema);