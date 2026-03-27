const mongoose = require('mongoose');

const JournalLineSchema = new mongoose.Schema({
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    required: [true, 'Account is required'],
  },
  accountName: {
    type: String,
    required: true,
  },
  accountCode: {
    type: String,
    required: true,
  },
     isReconciled: {
      type: Boolean,
      default: false,
    },
  debit: {
    type: Number,
    default: 0.0,
    min: 0,
  },
  credit: {
    type: Number,
    default: 0.0,
    min: 0,
  },
});

const JournalEntrySchema = new mongoose.Schema(
  {
    entryNumber: {
      type: String,
      unique: true,
    },
    date: {
      type: Date,
      required: [true, 'Date is required'],
      default: Date.now,
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
    },
    reference: {
      type: String,
      default: '',
      trim: true,
    },
    lines: [JournalLineSchema],
    status: {
      type: String,
      enum: ['Draft', 'Posted'],
      default: 'Draft',
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

// Generate entry number before save - WITHOUT next
JournalEntrySchema.pre('save', async function() {
  if (this.isNew) {
    const count = await mongoose.model('JournalEntry').countDocuments();
    const year = new Date().getFullYear();
    this.entryNumber = `JE-${year}-${String(count + 1).padStart(4, '0')}`;
  }
});

JournalEntrySchema.pre('save', function() {
  const totalDebit = this.lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = this.lines.reduce((sum, line) => sum + line.credit, 0);
  
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error('Total Debit must equal Total Credit');
  }
});

module.exports = mongoose.model('JournalEntry', JournalEntrySchema);