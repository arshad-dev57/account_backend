const mongoose = require('mongoose');

const ChartOfAccountSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Account code is required'],
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'Account name is required'],
      trim: true,
    },
    type: {
      type: String,
      required: [true, 'Account type is required'],
      enum: ['Assets', 'Liabilities', 'Equity', 'Income', 'Expenses'],
    },
    parentAccount: {
      type: String,
      default: '',
    },
    openingBalance: {
      type: Number,
      default: 0.0,
    },
    currentBalance: {
      type: Number,
      default: 0.0,
    },
    balanceType: {
      type: String,
      enum: ['Debit', 'Credit'],
      default: 'Debit',
    },
    description: {
      type: String,
      default: '',
    },
    taxCode: {
      type: String,
      default: 'N/A',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
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

// Auto-calculate balanceType and currentBalance
ChartOfAccountSchema.pre('save', function() {
  // Update currentBalance to match openingBalance
  this.currentBalance = this.openingBalance;
  
  // Assets and Expenses have Debit balance
  if (this.type === 'Assets' || this.type === 'Expenses') {
    this.balanceType = 'Debit';
  } 
  // Liabilities, Equity, Income have Credit balance
  else if (this.type === 'Liabilities' || this.type === 'Equity' || this.type === 'Income') {
    this.balanceType = 'Credit';
  }
});

module.exports = mongoose.model('ChartOfAccount', ChartOfAccountSchema);