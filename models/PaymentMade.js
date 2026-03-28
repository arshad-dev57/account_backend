const mongoose = require('mongoose');

const PaymentMadeSchema = new mongoose.Schema(
  {
    paymentNumber: {
      type: String,
      required: true,
      unique: true,
    },
    paymentDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
    },
    vendorName: {
      type: String,
      required: true,
    },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bill',
      required: true,
    },
    billNumber: {
      type: String,
      required: true,
    },
    billAmount: {
      type: Number,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    paymentMethod: {
      type: String,
      enum: ['Bank Transfer', 'Cash', 'Cheque', 'Credit Card'],
      required: true,
    },
    reference: {
      type: String,
      default: '',
    },
    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    bankAccountName: {
      type: String,
      default: '',
    },
    notes: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['Cleared', 'Pending'],
      default: 'Pending',
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

// Generate payment number before save
PaymentMadeSchema.pre('save', async function() {
  if (this.isNew) {
    const count = await mongoose.model('PaymentMade').countDocuments();
    const year = new Date().getFullYear();
    this.paymentNumber = `PMT-${year}-${String(count + 1).padStart(4, '0')}`;
  }
});

module.exports = mongoose.model('PaymentMade', PaymentMadeSchema);