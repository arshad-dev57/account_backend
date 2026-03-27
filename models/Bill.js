const mongoose = require('mongoose');

const BillItemSchema = new mongoose.Schema({
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

const BillSchema = new mongoose.Schema(
  {
    billNumber: {
      type: String,
      unique: true,
      sparse: true,
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
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    items: [BillItemSchema],
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
      enum: ['Unpaid', 'Partial', 'Paid', 'Overdue'],
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
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-update status based on due date and payments
BillSchema.pre('save', function() {
  // Update status
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

// Generate bill number - FIXED
BillSchema.pre('save', async function() {
  if (this.isNew && !this.billNumber) {
    try {
      const Bill = mongoose.model('Bill');
      const count = await Bill.countDocuments();
      const year = new Date().getFullYear();
      this.billNumber = `BILL-${year}-${String(count + 1).padStart(4, '0')}`;
    } catch (error) {
    }
  } else {
  }
});

module.exports = mongoose.model('Bill', BillSchema);