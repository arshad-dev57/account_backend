const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ['trial', 'monthly', 'yearly'],
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'cancelled'],
      default: 'active',
    },
    startDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endDate: {
      type: Date,
      required: false, // ✅ required hata diya
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'PKR',
    },
    paymentMethod: {
      type: String,
      enum: ['free_trial', 'in_app_purchase', 'manual'],
      default: 'free_trial',
    },
    transactionId: {
      type: String,
      default: '',
    },
    paymentDetails: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// ✅ pre save hook mein endDate calculate karo
SubscriptionSchema.pre('save', function() {
  if (this.isNew && !this.endDate) {
    const startDate = this.startDate || new Date();
    const endDate = new Date(startDate);

    if (this.plan === 'trial') {
      endDate.setDate(endDate.getDate() + 30);
    } else if (this.plan === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else if (this.plan === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    this.endDate = endDate;
  }
});

module.exports = mongoose.model('Subscription', SubscriptionSchema);