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
    outstanding: {
      type: Number,
      default: function() {
        return this.totalAmount - this.paidAmount;
      },
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

// Auto-update status and outstanding based on due date and payments
InvoiceSchema.pre('save', function() {
  // Calculate outstanding
  this.outstanding = this.totalAmount - this.paidAmount;
  
  // Update status based on outstanding and due date
  if (this.outstanding === 0) {
    this.status = 'Paid';
  } else if (this.paidAmount > 0 && this.outstanding > 0) {
    this.status = 'Partial';
  } else if (this.dueDate < new Date() && this.outstanding > 0) {
    this.status = 'Overdue';
  } else if (this.outstanding === this.totalAmount) {
    this.status = 'Unpaid';
  }
  
});

// Generate invoice number
InvoiceSchema.pre('save', async function() {
  if (this.isNew) {
    try {
      const count = await mongoose.model('Invoice').countDocuments();
      const year = new Date().getFullYear();
      this.invoiceNumber = `INV-${year}-${String(count + 1).padStart(4, '0')}`;
    } catch (error) {
    }
  }
});

// Method to check if invoice can have credit note
InvoiceSchema.methods.canApplyCreditNote = function(amount) {
  return this.outstanding >= amount && this.status !== 'Paid';
};

// Method to apply payment or credit note
InvoiceSchema.methods.applyPayment = async function(amount, type = 'payment') {
  this.paidAmount += amount;
  this.outstanding = this.totalAmount - this.paidAmount;
  
  // Update status
  if (this.outstanding === 0) {
    this.status = 'Paid';
  } else if (this.paidAmount > 0 && this.outstanding > 0) {
    this.status = 'Partial';
  }
  
  await this.save();
  
  return {
    invoiceId: this._id,
    invoiceNumber: this.invoiceNumber,
    paidAmount: this.paidAmount,
    outstanding: this.outstanding,
    status: this.status
  };
};

module.exports = mongoose.model('Invoice', InvoiceSchema);