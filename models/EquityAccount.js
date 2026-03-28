const mongoose = require('mongoose');

const EquityTransactionSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    default: Date.now,
  },
  type: {
    type: String,
    enum: ['Additional Capital', 'Drawings', 'Retained Earnings', 'Reserve Transfer', 'Share Issue'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  description: {
    type: String,
    required: true,
  },
  reference: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['Draft', 'Posted', 'Cancelled'],
    default: 'Posted',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
});

const EquityAccountSchema = new mongoose.Schema(
  {
    accountName: {
      type: String,
      required: true,
    },
    accountCode: {
      type: String,
      required: true,
      unique: true,
    },
    accountType: {
      type: String,
      enum: ['Capital', 'Retained Earnings', 'Reserves', 'Drawings', 'Share Capital'],
      required: true,
    },
    openingBalance: {
      type: Number,
      default: 0,
    },
    currentBalance: {
      type: Number,
      default: function() {
        return this.openingBalance;
      },
    },
    additions: {
      type: Number,
      default: 0,
    },
    withdrawals: {
      type: Number,
      default: 0,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      default: '',
    },
    transactions: [EquityTransactionSchema],
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

// Update balance before save
EquityAccountSchema.pre('save', function(next) {
  this.currentBalance = this.openingBalance + this.additions - this.withdrawals;
  this.lastUpdated = new Date();
  next();
});

// Method to add capital
EquityAccountSchema.methods.addCapital = async function(amount, description, reference, userId) {
  this.additions += amount;
  this.currentBalance = this.openingBalance + this.additions - this.withdrawals;
  
  this.transactions.push({
    date: new Date(),
    type: 'Additional Capital',
    amount: amount,
    description: description,
    reference: reference,
    status: 'Posted',
    createdBy: userId,
  });
  
  await this.save();
  return this;
};

// Method to record drawings
EquityAccountSchema.methods.recordDrawings = async function(amount, description, reference, userId) {
  this.withdrawals += amount;
  this.currentBalance = this.openingBalance + this.additions - this.withdrawals;
  
  this.transactions.push({
    date: new Date(),
    type: 'Drawings',
    amount: amount,
    description: description,
    reference: reference,
    status: 'Posted',
    createdBy: userId,
  });
  
  await this.save();
  return this;
};

// Method to transfer to retained earnings
EquityAccountSchema.methods.transferToRetainedEarnings = async function(amount, description, reference, userId) {
  this.additions += amount;
  this.currentBalance = this.openingBalance + this.additions - this.withdrawals;
  
  this.transactions.push({
    date: new Date(),
    type: 'Retained Earnings',
    amount: amount,
    description: description,
    reference: reference,
    status: 'Posted',
    createdBy: userId,
  });
  
  await this.save();
  return this;
};

module.exports = mongoose.model('EquityAccount', EquityAccountSchema);