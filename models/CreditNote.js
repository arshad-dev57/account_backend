const mongoose = require('mongoose');

const CreditNoteItemSchema = new mongoose.Schema({
  description: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1,
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
});

const CreditNoteSchema = new mongoose.Schema(
  {
    creditNoteNumber: {
      type: String,
      // 🔴 REMOVE sparse: true
    },
    date: {
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
    originalInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
    },
    originalInvoiceNumber: {
      type: String,
      required: true,
    },
    originalInvoiceAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    reason: {
      type: String,
      required: true,
    },
    reasonType: {
      type: String,
      enum: ['Return', 'Refund', 'Discount', 'Adjustment'],
      required: true,
    },
    items: [CreditNoteItemSchema],
    status: {
      type: String,
      enum: ['Issued', 'Applied', 'Expired', 'PartiallyApplied'],
      default: 'Issued',
    },
    appliedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    remainingAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    expiryDate: {
      type: Date,
      required: true,
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
    appliedToInvoices: [
      {
        invoiceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Invoice',
        },
        invoiceNumber: String,
        amount: Number,
        appliedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// ✅ FIXED: Generate credit note number before save (PER USER)
CreditNoteSchema.pre('save', async function() {
  try {
    console.log('Pre-save hook triggered for credit note');
    
    if (this.isNew && !this.creditNoteNumber) {
      console.log('Generating new credit note number...');
      
      // ✅ FIX: Sirf current user ke credit notes count karo
      const CreditNoteModel = mongoose.model('CreditNote');
      const count = await CreditNoteModel.countDocuments({ 
        createdBy: this.createdBy  // 👈 Sirf is user ke documents count karo
      });
      const year = new Date().getFullYear();
      
      // Format: CN-YYYY-0001, CN-YYYY-0002, etc.
      this.creditNoteNumber = `CN-${year}-${String(count + 1).padStart(4, '0')}`;
      console.log(`Generated credit note number: ${this.creditNoteNumber}`);
    }
    
    // Set expiry date if not set (default 30 days)
    if (!this.expiryDate) {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);
      this.expiryDate = expiryDate;
      console.log(`Set expiry date to: ${this.expiryDate}`);
    }
    
    // Set remaining amount if not set
    if (this.remainingAmount === undefined || this.remainingAmount === null) {
      this.remainingAmount = this.amount - (this.appliedAmount || 0);
      console.log(`Set remaining amount to: ${this.remainingAmount}`);
    }
    
  } catch (error) {
    console.error('Error in pre-save hook:', error);
  }
});

// ✅ ADD: Compound unique index for creditNoteNumber + createdBy
CreditNoteSchema.index({ creditNoteNumber: 1, createdBy: 1 }, { unique: true });

// Method to check if credit note is expired
CreditNoteSchema.methods.isExpired = function () {
  return new Date() > this.expiryDate && this.status !== 'Applied';
};

// Method to apply credit note to invoice
CreditNoteSchema.methods.applyToInvoice = async function (invoiceId, amount) {
  const Invoice = mongoose.model('Invoice');
  const invoice = await Invoice.findById(invoiceId);
  
  if (!invoice) {
    throw new Error('Invoice not found');
  }
  
  if (amount > this.remainingAmount) {
    throw new Error('Amount exceeds remaining credit note amount');
  }
  
  if (amount > invoice.outstanding) {
    throw new Error('Amount exceeds invoice outstanding balance');
  }
  
  // Update credit note
  this.appliedAmount += amount;
  this.remainingAmount -= amount;
  this.appliedToInvoices.push({
    invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    amount: amount,
    appliedAt: new Date(),
  });
  
  // Update status
  if (this.remainingAmount === 0) {
    this.status = 'Applied';
  } else {
    this.status = 'PartiallyApplied';
  }
  
  // Update invoice
  invoice.paidAmount += amount;
  invoice.outstanding = invoice.totalAmount - invoice.paidAmount;
  
  if (invoice.outstanding === 0) {
    invoice.status = 'Paid';
  } else {
    invoice.status = 'Partial';
  }
  
  await invoice.save();
  await this.save();
  
  return { creditNote: this, invoice };
};

const CreditNote = mongoose.model('CreditNote', CreditNoteSchema);
module.exports = CreditNote;