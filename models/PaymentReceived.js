const mongoose = require('mongoose');

const PaymentReceivedSchema = new mongoose.Schema(
  {
    paymentNumber: {
      type: String,
      unique: true,
      sparse: true,  // Allow null/undefined during save, will be set in pre-save
    },
    paymentDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    customerName: {
      type: String,
      required: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
    },
    invoiceNumber: {
      type: String,
      required: true,
    },
    invoiceAmount: {
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
PaymentReceivedSchema.pre('save', async function() {
  // Only generate if paymentNumber is not already set
  if (!this.paymentNumber) {
    try {
      const count = await mongoose.model('PaymentReceived').countDocuments();
      const year = new Date().getFullYear();
      this.paymentNumber = `PMT-${year}-${String(count + 1).padStart(4, '0')}`;
    } catch (error) {
    }
  } else {
  }
});

module.exports = mongoose.model('PaymentReceived', PaymentReceivedSchema);