const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'Please add first name'],
  },
  lastName: {
    type: String,
    required: [true, 'Please add last name'],
  },
  email: {
    type: String,
    required: [true, 'Please add email'],
    unique: true,
    lowercase: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email',
    ],
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: 6,
    select: false,
  },
  phone: {
    type: String,
    default: '',
  },
  country: {
    type: String,
    required: [true, 'Please add country'],
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  // Add these fields to UserSchema
resetOtp: {
  type: String,
  default: null,
},
resetOtpExpiry: {
  type: Date,
  default: null,
},
  // ✅ NEW PROFILE FIELDS
  organizationName: {
    type: String,
    default: '',
  },
  address: {
    type: String,
    default: '',
  },
  contactNo: {
    type: String,
    default: '',
  },
  websiteLink: {
    type: String,
    default: '',
  },
  subscription: {
    plan: {
      type: String,
      enum: ['trial', 'monthly', 'yearly', 'none'],
      default: 'none',
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'cancelled'],
      default: 'active',
    },
    startDate: Date,
    endDate: Date,
    trialStartDate: Date,
    trialEndDate: Date,
  },
}, {
  timestamps: true,
});

// ✅ Hash password only when modified
UserSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Match password
UserSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Check if trial is expired
UserSchema.methods.isTrialExpired = function() {
  if (!this.subscription.trialEndDate) return true;
  return new Date() > this.subscription.trialEndDate;
};

// Check if user has active subscription
UserSchema.methods.hasActiveSubscription = function() {
  // Check trial
  if (this.subscription.plan === 'trial' &&
      this.subscription.trialEndDate &&
      new Date() <= this.subscription.trialEndDate) {
    return true;
  }

  // Check paid subscription
  if ((this.subscription.plan === 'monthly' || this.subscription.plan === 'yearly') &&
      this.subscription.status === 'active' &&
      this.subscription.endDate &&
      new Date() <= this.subscription.endDate) {
    return true;
  }

  return false;
};

// Get trial days remaining
UserSchema.methods.getTrialDaysRemaining = function() {
  if (!this.subscription.trialEndDate) return 0;
  const now = new Date();
  const end = new Date(this.subscription.trialEndDate);
  if (now > end) return 0;
  const diffTime = Math.abs(end - now);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Get subscription days remaining
UserSchema.methods.getSubscriptionDaysRemaining = function() {
  if (!this.subscription.endDate) return 0;
  const now = new Date();
  const end = new Date(this.subscription.endDate);
  if (now > end) return 0;
  const diffTime = Math.abs(end - now);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Start free trial
UserSchema.methods.startTrial = async function() {
  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + 30);

  await this.constructor.findByIdAndUpdate(this._id, {
    $set: {
      'subscription.plan': 'trial',
      'subscription.status': 'active',
      'subscription.startDate': now,
      'subscription.endDate': null,
      'subscription.trialStartDate': now,
      'subscription.trialEndDate': trialEnd,
    }
  });

  console.log('Trial started for user:', this._id);
};

// Activate paid subscription
UserSchema.methods.activateSubscription = async function(plan, amount) {
  const now = new Date();
  let endDate = new Date(now);

  if (plan === 'monthly') {
    endDate.setMonth(endDate.getMonth() + 1);
  } else if (plan === 'yearly') {
    endDate.setFullYear(endDate.getFullYear() + 1);
  }

  console.log('Activating subscription:', { plan, status: 'active', startDate: now, endDate });

  await this.constructor.findByIdAndUpdate(this._id, {
    $set: {
      'subscription.plan': plan,
      'subscription.status': 'active',
      'subscription.startDate': now,
      'subscription.endDate': endDate,
      'subscription.trialStartDate': null,
      'subscription.trialEndDate': null,
    }
  });

  console.log('Subscription activated for user:', this._id);
};

// ✅ FIXED: Atomic update - race condition khatam
UserSchema.methods.expireSubscription = async function() {
  const result = await this.constructor.findOneAndUpdate(
    {
      _id: this._id,
      'subscription.status': 'active'
    },
    {
      $set: { 'subscription.status': 'expired' }
    },
    { new: true }
  );

  if (result) {
    console.log('Subscription expired for user:', this._id);
  } else {
    console.log('Subscription already expired, skipping...');
  }
};

module.exports = mongoose.model('User', UserSchema);