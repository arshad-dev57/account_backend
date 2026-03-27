const mongoose = require('mongoose');

const InvoiceItemSchema = new mongoose.Schema({
  description: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  amount: {
    type: Number,
    required: true,
  },
  taxRate: {
    type: Number,
    default: 0,
  },
  taxAmount: {
    type: Number,
    default: 0,
  },
});

const InvoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
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
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    items: [InvoiceItemSchema],
    subtotal: {
      type: Number,
      required: true,
    },
    taxTotal: {
      type: Number,
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    paidAmount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['Draft', 'Unpaid', 'Partial', 'Paid', 'Overdue'],
      default: 'Unpaid',
    },
    notes: {
      type: String,
      default: '',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    posted: {
      type: Boolean,
      default: false,
    },
    postedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-update status based on due date and payments
InvoiceSchema.pre('save', function() {
  if (this.paidAmount >= this.totalAmount) {
    this.status = 'Paid';
  } else if (this.paidAmount > 0 && this.paidAmount < this.totalAmount) {
    this.status = 'Partial';
  } else if (this.dueDate < new Date() && this.paidAmount < this.totalAmount) {
    this.status = 'Overdue';
  } else if (this.paidAmount === 0) {
    this.status = 'Unpaid';
  }
});

// Generate invoice number
InvoiceSchema.pre('save', async function() {
  if (this.isNew) {
    const count = await mongoose.model('Invoice').countDocuments();
    const year = new Date().getFullYear();
    this.invoiceNumber = `INV-${year}-${String(count + 1).padStart(4, '0')}`;
  }
});

module.exports = mongoose.model('Invoice', InvoiceSchema);