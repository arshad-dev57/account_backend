const User = require('../models/User');
const Subscription = require('../models/Subscription');
const jwt = require('jsonwebtoken');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// ✅ userId pass karo taake hamesha fresh DB data mile
const checkAndExpireSubscription = async (userId) => {
  // ✅ DB se fresh fetch karo
  const user = await User.findById(userId);
  
  if (!user || user.subscription.status !== 'active') return;

  const now = new Date();

  // Trial check
  if (user.subscription.plan === 'trial' &&
      user.subscription.trialEndDate &&
      now > new Date(user.subscription.trialEndDate)) {
    console.log('Trial expired, updating status...');
    await user.expireSubscription();
    return;
  }

  // Paid subscription check
  if ((user.subscription.plan === 'monthly' || user.subscription.plan === 'yearly') &&
      user.subscription.endDate &&
      now > new Date(user.subscription.endDate)) {
    console.log('Paid subscription expired, updating status...');
    await user.expireSubscription();
    return;
  }
};

// ==================== REGISTER ====================
exports.register = async (req, res) => {
  try {
    const { firstName, lastName, email, password, country, phone } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email',
      });
    }

    if (!firstName || !lastName || !email || !password || !country) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
    }

    const user = await User.create({
      firstName,
      lastName,
      email,
      password,
      country,
      phone: phone || '',
    });

    await user.startTrial();

    // ✅ Fresh fetch after startTrial
    const updatedUser = await User.findById(user._id);

    await Subscription.create({
      userId: updatedUser._id,
      plan: 'trial',
      startDate: updatedUser.subscription.trialStartDate || new Date(),
      endDate: updatedUser.subscription.trialEndDate,
      amount: 0,
      paymentMethod: 'free_trial',
    });

    const token = generateToken(updatedUser._id);

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Free trial started for 30 days!',
      token,
      user: {
        id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        country: updatedUser.country,
        phone: updatedUser.phone,
        role: updatedUser.role,
        subscription: {
          plan: updatedUser.subscription.plan,
          status: updatedUser.subscription.status,
          trialDaysRemaining: updatedUser.getTrialDaysRemaining(),
          trialEndDate: updatedUser.subscription.trialEndDate,
        },
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// ==================== LOGIN ====================
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('=== LOGIN ATTEMPT ===');
    console.log('Email:', email);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.',
      });
    }

    const isPasswordMatch = await user.matchPassword(password);
    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // ✅ userId pass karo
    await checkAndExpireSubscription(user._id);

    const updatedUser = await User.findById(user._id);

    console.log('Subscription plan:', updatedUser.subscription.plan);
    console.log('Subscription status:', updatedUser.subscription.status);

    const token = generateToken(updatedUser._id);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        country: updatedUser.country,
        phone: updatedUser.phone,
        role: updatedUser.role,
        subscription: {
          plan: updatedUser.subscription.plan,
          status: updatedUser.subscription.status,
          trialDaysRemaining: updatedUser.getTrialDaysRemaining(),
          subscriptionDaysRemaining: updatedUser.getSubscriptionDaysRemaining(),
          endDate: updatedUser.subscription.endDate,
          trialEndDate: updatedUser.subscription.trialEndDate,
        },
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// ==================== GET CURRENT USER ====================
exports.getMe = async (req, res) => {
  try {
    // ✅ userId pass karo - fresh fetch helper ke andar hoga
    await checkAndExpireSubscription(req.user.id);

    // ✅ Expire check ke baad fresh fetch
    const updatedUser = await User.findById(req.user.id);

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      user: {
        id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        country: updatedUser.country,
        phone: updatedUser.phone,
        role: updatedUser.role,
        subscription: {
          plan: updatedUser.subscription.plan,
          status: updatedUser.subscription.status,
          trialDaysRemaining: updatedUser.getTrialDaysRemaining(),
          subscriptionDaysRemaining: updatedUser.getSubscriptionDaysRemaining(),
          startDate: updatedUser.subscription.startDate,
          endDate: updatedUser.subscription.endDate,
          trialStartDate: updatedUser.subscription.trialStartDate,
          trialEndDate: updatedUser.subscription.trialEndDate,
        },
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};