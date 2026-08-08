
const User = require('../models/User');
const prisma = require('../prisma/client');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const emailService = require('../services/emailService');
const { sendToUser } = require('../services/onesignal');
const { initializeDefaultChartOfAccounts } = require('../services/defaultChartOfAccountsService');

// Lazy require — avoid circular load with pdfReportSettingsController
function getPdfReportSettingsForUserId(userId) {
  return require('./pdfReportSettingsController').getPdfReportSettingsForUserId(
    userId
  );
}

const cleanToken = (token) => {
  if (!token) return null;
  return token.trim().replace(/^"|"$/g, '').replace(/\s/g, '');
};

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
};

const generateRefreshToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

const checkAndExpireSubscription = async (userId) => {
  const userData = await User.findById(userId);
  if (!userData) return;

  const user = new User(userData);
  if (user.subscription.status !== 'active') return;

  const now = new Date();

  if (user.subscription.plan === 'trial' &&
    user.subscription.trialEndDate &&
    now > new Date(user.subscription.trialEndDate)) {
    await user.expireSubscription();
    return;
  }

  if ((user.subscription.plan === 'monthly' || user.subscription.plan === 'yearly') &&
    user.subscription.status === 'active' &&
    user.subscription.endDate &&
    now > new Date(user.subscription.endDate)) {
    await user.expireSubscription();
    return;
  }
};

const checkTrialDays = async (userId) => {
  const userData = await User.findById(userId);
  if (!userData) return 0;

  const user = new User(userData);
  const trialDaysRemaining = user.getTrialDaysRemaining();

  if (trialDaysRemaining === 0 && user.subscription.status === 'active' && user.subscription.plan === 'trial') {
    await user.expireSubscription();
  }

  return trialDaysRemaining;
};

exports.register = async (req, res) => {
  try {
    const {
      firstName, lastName, email, password,
      country, phone, address,
      organizationName,
      fiscalYear, taxRegistrationNumber,
      industry, businessType,
      websiteLink, contactNo,
      fiscalYearStartDate, fiscalYearEndDate, fiscalYearName,
    } = req.body;
    
    let logo = req.body.logo || '';
    let signature = req.body.signature || '';

    if (req.files) {
      if (req.files.logo && req.files.logo[0]) {
        logo = req.files.logo[0].path;
      }
      if (req.files.signature && req.files.signature[0]) {
        signature = req.files.signature[0].path;
      }
    }


    if (!firstName || !lastName || !email || !password || !country) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: firstName, lastName, email, password, country'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    const userExists = await prisma.user.findUnique({
      where: { email }
    });

    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + 30);

    const userRole = 'admin';

    console.log('🎭 [register] Assigned role:', userRole);

    // Create Company first
    const company = await prisma.company.create({
      data: {
        name: organizationName || `${firstName} ${lastName}'s Company`,
        email: email,
        phone: phone || '',
        address: address || '',
        businessType: businessType || '',
        taxRegistrationNumber: taxRegistrationNumber || '',
        logo: logo || '',
        website: websiteLink || '',
        subscriptionPlan: 'trial',
        subscriptionStatus: 'active',
        trialStartDate: now,
        trialEndDate: trialEnd,
      }
    });

    const userData = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        password: hashedPassword,
        country,
        phone: phone || '',
        address: address || '',
        organizationName: organizationName || '',
        websiteLink: websiteLink || '',
        contactNo: contactNo || '',
        businessDetails: {
          logo: logo || '',
          fiscalYear: fiscalYear || '',
          taxRegistrationNumber: taxRegistrationNumber || '',
          signature: signature || '',
          industry: industry || '',
          businessType: businessType || '',
        },
        role: userRole,
        companyId: company.id,
        subscriptionPlan: 'trial',
        subscriptionStatus: 'active',
        subscriptionStartDate: now,
        trialStartDate: now,
        trialEndDate: trialEnd,
      }
    });

    const user = new User(userData);

    await prisma.subscription.create({
      data: {
        userId: user._id,
        plan: 'trial',
        startDate: now,
        endDate: trialEnd,
        amount: 0,
        paymentMethod: 'free_trial',
      }
    });

    // ─── Req 4: Auto-create first FiscalYear + default Retained Earnings ───
    try {
      let fyStartDate, fyEndDate, fyName;
      const currentYear = new Date().getFullYear();

      if (fiscalYearStartDate && fiscalYearEndDate) {
        fyStartDate = new Date(fiscalYearStartDate);
        fyEndDate   = new Date(fiscalYearEndDate);
        const startYear = fyStartDate.getFullYear();
        const endYear   = fyEndDate.getFullYear();
        fyName = fiscalYearName || (startYear === endYear ? `FY ${startYear}` : `FY ${startYear}-${endYear}`);
      } else {
        fyStartDate = new Date(`${currentYear}-01-01T00:00:00.000Z`);
        fyEndDate   = new Date(`${currentYear}-12-31T23:59:59.999Z`);
        fyName      = fiscalYearName || `FY ${currentYear}`;
      }

      await prisma.fiscalYear.create({
        data: {
          companyId: company.id,
          name:      fyName,
          startDate: fyStartDate,
          endDate:   fyEndDate,
          status:    'Open',
        },
      });

      console.log('✅ [register] FiscalYear created for user:', user._id);
    } catch (fyError) {
      console.error('⚠️ [register] FiscalYear creation failed (non-fatal):', fyError.message);
    }

    try {
      const coaResult = await initializeDefaultChartOfAccounts(company.id, user._id);
      console.log('✅ [register] Default Chart of Accounts initialized:', coaResult.message);
    } catch (coaError) {
      console.error('⚠️ [register] Default Chart of Accounts initialization failed (non-fatal):', coaError.message);
    }

    try {
      await emailService.sendWelcomeEmail(email, firstName);
      console.log('✅ [register] Welcome email sent successfully');
    } catch (emailError) {
      console.error('⚠️ [register] Welcome email failed (non-fatal):', emailError.message);
    }

    const token = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    console.log('✅ [register] User registered successfully');
    console.log('═══════════════════════════════════════════════════');

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Free trial started for 30 days!',
      token,
      refreshToken,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        country: user.country,
        phone: user.phone,
        address: user.address,
        organizationName: user.organizationName,
        websiteLink: user.websiteLink,
        contactNo: user.contactNo,
        businessDetails: user.businessDetails || {},
        role: user.role,
        subscription: {
          plan: user.subscription.plan,
          status: user.subscription.status,
          trialDaysRemaining: user.getTrialDaysRemaining(),
          trialEndDate: user.subscription.trialEndDate,
        },
      },
    });
  } catch (error) {
    console.error('❌ [register] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('═══════════════════════════════════════════════════');
    console.log('🔵 [login] Called');
    console.log('📧 [login] Email:', email);
    console.log('🔐 [login] Password length:', password ? password.length : 0);
    console.log('📦 [login] Request body keys:', Object.keys(req.body));
    console.log('═══════════════════════════════════════════════════');

    if (!email || !password) {
      console.log('❌ [login] Missing email or password');
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    console.log('🔍 [login] Searching for user in database...');
    const userData = await prisma.user.findUnique({
      where: { email }
    });

    if (!userData) {
      console.log('❌ [login] User not found in database');
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    console.log('✅ [login] User found:', userData.id);
    console.log('👤 [login] User name:', userData.firstName, userData.lastName);
    console.log('📊 [login] User isActive:', userData.isActive);

    const user = new User(userData);

    if (!user.isActive) {
      console.log('❌ [login] Account deactivated');
      return res.status(401).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.'
      });
    }

    console.log('🔒 [login] Checking account lock status...');
    if (user.isLocked()) {
      const remainingMinutes = Math.ceil((new Date(user.lockUntil) - Date.now()) / (1000 * 60));
      console.log('❌ [login] Account locked:', remainingMinutes, 'minutes remaining');
      return res.status(403).json({
        success: false,
        message: `Account temporarily locked. Try again in ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}.`,
      });
    }

    console.log('🔐 [login] Verifying password...');
    const isPasswordMatch = await user.matchPassword(password);

    if (!isPasswordMatch) {
      console.log('❌ [login] Password does not match');
      user.failedLoginAttempts += 1;

      if (user.failedLoginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 10 * 60 * 1000);
        await user.save();
        console.log('❌ [login] Account locked due to too many attempts');
        return res.status(403).json({
          success: false,
          message: 'Too many failed attempts. Account locked for 10 minutes.',
        });
      }

      const attemptsLeft = 5 - user.failedLoginAttempts;
      await user.save();
      console.log('❌ [login] Invalid password, attempts left:', attemptsLeft);
      return res.status(401).json({
        success: false,
        message: `Invalid credentials. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining before lockout.`,
      });
    }

    console.log('✅ [login] Password verified successfully');
    user.failedLoginAttempts = 0;
    user.lockUntil = null;

    console.log('🔑 [login] Generating OTP...');
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.loginOtp = otp;
    user.loginOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    user.requiresLoginOtp = true;
    await user.save();

    console.log('🔑 [login] OTP Generated:', otp);
    console.log('📧 [login] Sending OTP to:', email);
    console.log('⏰ [login] OTP expires at:', user.loginOtpExpiry);

    // ─── Send OTP using emailService ───
    try {
      await emailService.sendOTPEmail(email, otp, user.firstName, 'login');
      console.log('✅ [login] OTP sent successfully');
    } catch (emailError) {
      console.error('❌ [login] Failed to send OTP email:', emailError.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP. Please try again.',
      });
    }

    console.log('✅ [login] OTP sent successfully');
    console.log('📤 [login] Sending response with requiresOtp: true');
    console.log('═══════════════════════════════════════════════════');

    return res.status(200).json({
      success: true,
      requiresOtp: true,
      email: email,
      message: 'OTP sent to your email for verification.',
    });

  } catch (error) {
    console.error('❌ [login] Error:', error);
    console.error('❌ [login] Error stack:', error.stack);
    console.error('❌ [login] Error name:', error.name);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ==================== VERIFY LOGIN OTP ====================
exports.verifyLoginOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    console.log('═══════════════════════════════════════════════════');
    console.log('🔐 [verifyLoginOTP] Called');
    console.log('📧 [verifyLoginOTP] Email:', email);
    console.log('🔑 [verifyLoginOTP] OTP:', otp);
    console.log('═══════════════════════════════════════════════════');

    if (!email || !otp) {
      console.log('❌ [verifyLoginOTP] Email or OTP missing');
      return res.status(400).json({
        success: false,
        message: 'Please provide email and OTP'
      });
    }

    const userData = await prisma.user.findUnique({
      where: { email }
    });

    if (!userData) {
      console.log('❌ [verifyLoginOTP] User not found');
      return res.status(404).json({
        success: false,
        message: 'No account found with this email'
      });
    }

    console.log('✅ [verifyLoginOTP] User found:', userData.id);
    console.log('📦 [verifyLoginOTP] Stored OTP in DB:', userData.loginOtp);
    console.log('⏰ [verifyLoginOTP] OTP Expiry:', userData.loginOtpExpiry);

    const user = new User(userData);

    if (!user.loginOtp || user.loginOtp !== otp) {
      console.log('❌ [verifyLoginOTP] Invalid OTP - Provided:', otp, 'Stored:', user.loginOtp);
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    if (new Date() > new Date(user.loginOtpExpiry)) {
      console.log('❌ [verifyLoginOTP] OTP Expired');
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please login again.'
      });
    }

    console.log('✅ [verifyLoginOTP] OTP Verified Successfully');

    user.requiresLoginOtp = false;
    user.loginOtp = null;
    user.loginOtpExpiry = null;
    await user.save();

    console.log('🔄 [verifyLoginOTP] Checking subscription expiry...');
    await checkAndExpireSubscription(user._id);

    console.log('🔄 [verifyLoginOTP] Fetching updated user data...');
    const updatedUserData = await User.findById(user._id);
    const updatedUser = new User(updatedUserData);

    console.log('📦 [verifyLoginOTP] Updated User Business Details:', JSON.stringify(updatedUser.businessDetails, null, 2));

    // Fetch user permissions
    console.log('🔄 [verifyLoginOTP] Fetching user permissions...');
    const userPermissions = await prisma.userPermission.findMany({
      where: { userId: updatedUser._id.toString() },
      select: {
        id: true,
        page: true,
        canView: true,
        canCreate: true,
        canEdit: true,
        canDelete: true
      }
    });
    console.log('📊 [verifyLoginOTP] User permissions count:', userPermissions.length);
    console.log('📊 [verifyLoginOTP] User permissions:', userPermissions);

    let pdfReportSettings = null;
    try {
      pdfReportSettings = await getPdfReportSettingsForUserId(updatedUser._id);
      console.log('📄 [verifyLoginOTP] PDF report settings loaded');
    } catch (pdfErr) {
      console.error('⚠️ [verifyLoginOTP] PDF settings load failed:', pdfErr.message);
      pdfReportSettings = null;
    }

    const token = generateToken(updatedUser._id);
    const refreshToken = generateRefreshToken(updatedUser._id);

    const responseUser = {
      id: updatedUser._id,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      email: updatedUser.email,
      country: updatedUser.country,
      phone: updatedUser.phone,
      address: updatedUser.address,
      organizationName: updatedUser.organizationName,
      websiteLink: updatedUser.websiteLink,
      contactNo: updatedUser.contactNo,
      businessDetails: updatedUser.businessDetails || {},
      pdfReportSettings,
      role: updatedUser.role,
      permissions: userPermissions.map(p => ({
        id: p.id,
        page: p.page,
        canView: p.canView,
        canCreate: p.canCreate,
        canEdit: p.canEdit,
        canDelete: p.canDelete
      })),
      subscription: {
        plan: updatedUser.subscription.plan,
        status: updatedUser.subscription.status,
        trialDaysRemaining: updatedUser.getTrialDaysRemaining(),
        subscriptionDaysRemaining: updatedUser.getSubscriptionDaysRemaining(),
        endDate: updatedUser.subscription.endDate,
        trialEndDate: updatedUser.subscription.trialEndDate,
      },
    };

    console.log('📤 [verifyLoginOTP] Response User Object:');
    console.log('   - ID:', responseUser.id);
    console.log('   - Email:', responseUser.email);
    console.log('   - Business Details:', JSON.stringify(responseUser.businessDetails, null, 2));
    console.log('   - Currency Code:', responseUser.businessDetails?.currencyCode || 'Not Set');
    console.log('   - Currency Symbol:', responseUser.businessDetails?.currencySymbol || 'Not Set');
    console.log('═══════════════════════════════════════════════════');

    // 🔔 Send login success notification
    try {
      console.log('🔔 [verifyLoginOTP] Sending login success notification...');
      await sendToUser({
        mongoUserId: updatedUser._id.toString(),
        title: 'Login Successful',
        message: 'Welcome back to BisonsTechs ✅',
        data: {
          type: 'auth',
          screen: 'home'
        }
      });
      console.log('✅ [verifyLoginOTP] Notification sent successfully');
    } catch (notificationError) {
      console.error('⚠️ [verifyLoginOTP] Failed to send notification:', notificationError.message);
    }

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      refreshToken,
      user: responseUser,
      pdfReportSettings,
    });
  } catch (error) {
    console.error('❌ [verifyLoginOTP] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.updateBusinessDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      organizationName,
      logo,
      fiscalYear,
      taxRegistrationNumber,
      signature,
      industry,
      businessType,
      websiteLink,
      contactNo,
      address,
      phone,
      country,
    } = req.body;

    console.log('🔄 [updateBusinessDetails] Called for user:', userId);

    const userData = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        organizationName: organizationName || userData.organizationName,
        websiteLink: websiteLink || userData.websiteLink,
        contactNo: contactNo || userData.contactNo,
        address: address || userData.address,
        phone: phone || userData.phone,
        country: country || userData.country,
        businessDetails: {
          logo: logo || userData.businessDetails?.logo || '',
          fiscalYear: fiscalYear || userData.businessDetails?.fiscalYear || '',
          taxRegistrationNumber: taxRegistrationNumber || userData.businessDetails?.taxRegistrationNumber || '',
          signature: signature || userData.businessDetails?.signature || '',
          industry: industry || userData.businessDetails?.industry || '',
          businessType: businessType || userData.businessDetails?.businessType || '',
        }
      }
    });

    const user = new User(updatedUser);

    console.log('✅ [updateBusinessDetails] Updated successfully');

    res.status(200).json({
      success: true,
      message: 'Business details updated successfully',
      data: {
        organizationName: user.organizationName,
        websiteLink: user.websiteLink,
        contactNo: user.contactNo,
        address: user.address,
        phone: user.phone,
        country: user.country,
        businessDetails: user.businessDetails || {},
      }
    });
  } catch (error) {
    console.error('❌ [updateBusinessDetails] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ==================== GET BUSINESS DETAILS ====================
exports.getBusinessDetails = async (req, res) => {
  try {
    const userId = req.user.id;

    console.log('🔄 [getBusinessDetails] Called for user:', userId);

    const userData = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        organizationName: true,
        websiteLink: true,
        contactNo: true,
        address: true,
        phone: true,
        country: true,
        businessDetails: true,
      }
    });

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('✅ [getBusinessDetails] Fetched successfully');

    res.status(200).json({
      success: true,
      data: {
        organizationName: userData.organizationName || '',
        websiteLink: userData.websiteLink || '',
        contactNo: userData.contactNo || '',
        address: userData.address || '',
        phone: userData.phone || '',
        country: userData.country || '',
        businessDetails: userData.businessDetails || {},
      }
    });
  } catch (error) {
    console.error('❌ [getBusinessDetails] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    let { refreshToken } = req.body;

    console.log('🔄 [refreshToken] Called');

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'No refresh token provided'
      });
    }

    refreshToken = cleanToken(refreshToken);
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token format'
      });
    }


    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    } catch (error) {
      console.error('❌ [refreshToken] JWT Verify Error:', error.message);
      if (error.name === 'TokenExpiredError') {
        return res.status(403).json({
          success: false,
          message: 'Refresh token expired. Please login again.'
        });
      }
      return res.status(403).json({
        success: false,
        message: 'Invalid refresh token. Please login again.'
      });
    }

    const userData = await User.findById(decoded.id);
    if (!userData || !userData.isActive) {
      return res.status(403).json({
        success: false,
        message: 'User invalid or inactive'
      });
    }

    const token = generateToken(userData._id);
    const newRefreshToken = generateRefreshToken(userData._id);

    console.log('✅ [refreshToken] Token refreshed successfully');

    res.status(200).json({
      success: true,
      token,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    console.error('❌ [refreshToken] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ==================== GET CURRENT USER ====================
exports.getMe = async (req, res) => {
  try {
    console.log('🔄 [getMe] Called for user:', req.user.id);

    await checkAndExpireSubscription(req.user.id);
    const updatedUserData = await User.findById(req.user.id);
    const updatedUser = new User(updatedUserData);

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('✅ [getMe] User fetched successfully');

    res.status(200).json({
      success: true,
      user: {
        id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        country: updatedUser.country,
        phone: updatedUser.phone,
        address: updatedUser.address,
        organizationName: updatedUser.organizationName,
        websiteLink: updatedUser.websiteLink,
        contactNo: updatedUser.contactNo,
        businessDetails: updatedUser.businessDetails || {},
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
    console.error('❌ [getMe] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    console.log('🔄 [changePassword] Called for user:', userId);

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current password and new password'
      });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters'
      });
    }

    const userData = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = new User(userData);
    const isPasswordMatch = await user.matchPassword(currentPassword);

    if (!isPasswordMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password cannot be the same as current password'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    console.log('✅ [changePassword] Password changed successfully');

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('❌ [changePassword] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    console.log('🔄 [forgotPassword] Called for email:', email);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email address'
      });
    }

    const userData = await User.findOne({ email });
    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email'
      });
    }

    const user = new User(userData);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    user.resetOtp = otp;
    user.resetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    console.log('🔑 [forgotPassword] OTP Generated:', otp);

    try {
      await emailService.sendOTPEmail(email, otp, user.firstName, 'reset');
      console.log('✅ [forgotPassword] OTP sent successfully');
    } catch (emailError) {
      console.error('❌ [forgotPassword] Failed to send OTP email:', emailError.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP. Please try again.',
      });
    }

    res.status(200).json({
      success: true,
      message: 'OTP sent to your email'
    });
  } catch (error) {
    console.error('❌ [forgotPassword] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ==================== VERIFY OTP ====================
exports.passwordverifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    console.log('🔄 [passwordverifyOTP] Called for email:', email);

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and OTP'
      });
    }

    const userData = await User.findOne({ email });
    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email'
      });
    }

    const user = new User(userData);

    if (!user.resetOtp || user.resetOtp !== otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }
    if (new Date(user.resetOtpExpiry) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }

    const resetToken = jwt.sign(
      { id: user._id, purpose: 'reset' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    console.log('✅ [passwordverifyOTP] OTP verified successfully');

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      resetToken
    });
  } catch (error) {
    console.error('❌ [passwordverifyOTP] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ==================== RESET PASSWORD ====================
exports.resetPassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    const resetToken = req.headers.authorization?.split(' ')[1];

    console.log('🔄 [resetPassword] Called');

    if (!resetToken) {
      return res.status(401).json({
        success: false,
        message: 'No reset token provided'
      });
    }
    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide new password and confirm password'
      });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    const userData = await User.findById(decoded.id);
    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = new User(userData);

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    user.resetOtp = null;
    user.resetOtpExpiry = null;
    await user.save();

    console.log('✅ [resetPassword] Password reset successfully');

    res.status(200).json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('❌ [resetPassword] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.updateCurrency = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currencyCode, currencySymbol } = req.body;

    console.log('🔄 [updateCurrency] Called for user:', userId);
    console.log('💰 [updateCurrency] Currency:', currencyCode, currencySymbol);

    if (!currencyCode || !currencySymbol) {
      return res.status(400).json({
        success: false,
        message: 'Please provide currencyCode and currencySymbol',
      });
    }

    const userData = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const existingBusinessDetails = userData.businessDetails || {};

    const updatedBusinessDetails = {
      ...existingBusinessDetails,
      currencyCode: currencyCode,
      currencySymbol: currencySymbol,
    };

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        businessDetails: updatedBusinessDetails
      }
    });

    console.log('✅ [updateCurrency] Currency updated successfully');
    console.log('📦 [updateCurrency] Updated Business Details:', JSON.stringify(updatedUser.businessDetails, null, 2));

    res.status(200).json({
      success: true,
      message: 'Currency updated successfully',
      data: {
        currencyCode: updatedUser.businessDetails?.currencyCode || 'USD',
        currencySymbol: updatedUser.businessDetails?.currencySymbol || '$',
      }
    });
  } catch (error) {
    console.error('❌ [updateCurrency] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};
