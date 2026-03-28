const mongoose = require('mongoose');

const ExpenseItemSchema = new mongoose.Schema({
  description: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    default: 1,
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
});

const ExpenseSchema = new mongoose.Schema(
  {
    expenseNumber: {
      type: String,
      unique: true,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expenseType: {
      type: String,
      enum: [
        'Rent', 'Utilities', 'Salaries', 'Marketing', 
        'Office Supplies', 'Travel', 'Meals', 'Insurance',
        'Maintenance', 'Software', 'Taxes', 'Other'
      ],
      required: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
    },
    vendorName: {
      type: String,
      default: '',
    },
    items: [ExpenseItemSchema],
    amount: {
      type: Number,
      default: 0,
    },
    hasItems: {
      type: Boolean,
      default: false,
    },
    subtotal: {
      type: Number,
      default: 0,
    },
    taxRate: {
      type: Number,
      default: 0,
    },
    taxAmount: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    description: {
      type: String,
      default: '',
    },
    reference: {
      type: String,
      default: '',
    },
    paymentMethod: {
      type: String,
      enum: ['Cash', 'Bank Transfer', 'Cheque', 'Credit Card', 'Online'],
      default: 'Cash',
    },
    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    status: {
      type: String,
      enum: ['Draft', 'Posted', 'Cancelled'],
      default: 'Draft',
    },
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    postedAt: {
      type: Date,
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

// Generate expense number before save
ExpenseSchema.pre('save', async function() {
  if (this.isNew && !this.expenseNumber) {
    try {
      const count = await mongoose.model('Expense').countDocuments();
      const year = new Date().getFullYear();
      this.expenseNumber = `EXP-${year}-${String(count + 1).padStart(4, '0')}`;
    } catch (error) {
    }
  }
});

// Calculate totals before save
ExpenseSchema.pre('save', function() {
  // Check if items exist (detailed expense)
  if (this.items && this.items.length > 0) {
    this.hasItems = true;
    this.subtotal = this.items.reduce((sum, item) => sum + (item.amount || 0), 0);
    this.taxAmount = this.subtotal * (this.taxRate / 100);
    this.totalAmount = this.subtotal + this.taxAmount;
    this.amount = 0;
  } 
  // Check if amount is provided (simple expense)
  else if (this.amount > 0) {
    this.hasItems = false;
    this.subtotal = this.amount;
    this.taxAmount = 0;
    this.totalAmount = this.amount;
    this.items = [];
  } 
  else {
    this.totalAmount = 0;
  }
  
});

module.exports = mongoose.model('Expense', ExpenseSchema);