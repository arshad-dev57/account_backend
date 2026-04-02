const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema(
  {
    transactionNumber: {
      type: String,
      unique: true,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    type: {
      type: String,
      enum: ['income', 'expense'],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      required: true,
    },
    paymentMethod: {
      type: String,
      enum: ['Cash', 'Bank Transfer', 'Cheque', 'Credit Card', 'Online'],
      default: 'Cash',
    },
    reference: {
      type: String,
      default: '',
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
    },
    customerName: {
      type: String,
      default: '',
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
    },
    vendorName: {
      type: String,
      default: '',
    },
    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BankAccount',
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
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    postedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Generate transaction number before save
TransactionSchema.pre('save', async function() {
  if (this.isNew && !this.transactionNumber) {
    try {
      const count = await mongoose.model('Transaction').countDocuments();
      const year = new Date().getFullYear();
      const prefix = this.type === 'income' ? 'INC' : 'EXP';
      this.transactionNumber = `${prefix}-${year}-${String(count + 1).padStart(6, '0')}`;
    } catch (error) {
    }
  }
});

module.exports = mongoose.model('Transaction', TransactionSchema);