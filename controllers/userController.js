// backend/controllers/authController.js

const User = require('../models/User');
const Subscription = require('../models/Subscription');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

// ✅ Clean token helper
const cleanToken = (token) => {
  if (!token) return null;
  return token.trim().replace(/^"|"$/g, '').replace(/\s/g, '');
};

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '7d', // Increased from 1h to 7d
  });
};

const generateRefreshToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d', // Increased from 7d to 30d
  });
};

const checkAndExpireSubscription = async (userId) => {
  const user = await User.findById(userId);
  if (!user || user.subscription.status !== 'active') return;
  const now = new Date();
  if (
    user.subscription.plan === 'trial' &&
    user.subscription.trialEndDate &&
    now > new Date(user.subscription.trialEndDate)
  ) {
    await user.expireSubscription();
    return;
  }
  if (
    (user.subscription.plan === 'monthly' || user.subscription.plan === 'yearly') &&
    user.subscription.endDate &&
    now > new Date(user.subscription.endDate)
  ) {
    await user.expireSubscription();
    return;
  }
};

// ==================== REGISTER ====================
exports.register = async (req, res) => {
  try {
    const {
      firstName, lastName, email, password,
      country, phone, address, organizationName
    } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'User already exists with this email' });
    }

    if (!firstName || !lastName || !email || !password || !country) {
      return res.status(400).json({ success: false, message: 'Please provide all required fields' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const user = await User.create({
      firstName, lastName, email, password, country,
      phone: phone || '',
      address: address || '',
      organizationName: organizationName || '',
    });

    await user.startTrial();
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
    const refreshToken = generateRefreshToken(updatedUser._id);

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Free trial started for 30 days!',
      token,
      refreshToken,
      user: {
        id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        country: updatedUser.country,
        phone: updatedUser.phone,
        address: updatedUser.address,
        organizationName: updatedUser.organizationName,
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
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ==================== LOGIN ====================
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password' });
    }

    const user = await User.findOne({ email }).select(
      '+password +failedLoginAttempts +lockUntil +requiresLoginOtp +loginOtp +loginOtpExpiry'
    );

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Your account has been deactivated. Please contact support.' });
    }

    if (user.isLocked()) {
      const remainingMinutes = Math.ceil((user.lockUntil - Date.now()) / (1000 * 60));
      return res.status(403).json({
        success: false,
        message: `Account temporarily locked. Try again in ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}.`,
      });
    }

    const isPasswordMatch = await user.matchPassword(password);

    if (!isPasswordMatch) {
      user.failedLoginAttempts += 1;

      if (user.failedLoginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 10 * 60 * 1000);
        await user.save();
        return res.status(403).json({
          success: false,
          message: 'Too many failed attempts. Account locked for 10 minutes.',
        });
      }

      const attemptsLeft = 5 - user.failedLoginAttempts;
      await user.save();
      return res.status(401).json({
        success: false,
        message: `Invalid credentials. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining before lockout.`,
      });
    }

    user.failedLoginAttempts = 0;
    user.lockUntil = null;

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.loginOtp = otp;
    user.loginOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    user.requiresLoginOtp = true;
    await user.save();
    console.log(otp);
    await sendOTPEmail(email, otp, user.firstName);

    return res.status(200).json({
      success: true,
      requiresOtp: true,
      email: email,
      message: 'OTP sent to your email for verification.',
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ==================== VERIFY LOGIN OTP ====================
exports.verifyLoginOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Please provide email and OTP' });
    }

    const user = await User.findOne({ email }).select('+loginOtp +loginOtpExpiry +requiresLoginOtp');

    if (!user) {
      return res.status(404).json({ success: false, message: 'No account found with this email' });
    }

    if (!user.loginOtp || user.loginOtp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    if (new Date() > user.loginOtpExpiry) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please login again.' });
    }

    user.requiresLoginOtp = false;
    user.loginOtp = null;
    user.loginOtpExpiry = null;
    await user.save();

    await checkAndExpireSubscription(user._id);
    const updatedUser = await User.findById(user._id);

    const token = generateToken(updatedUser._id);
    const refreshToken = generateRefreshToken(updatedUser._id);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      refreshToken,
      user: {
        id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        country: updatedUser.country,
        phone: updatedUser.phone,
        address: updatedUser.address,
        organizationName: updatedUser.organizationName,
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
    console.error('Verify Login OTP error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ==================== REFRESH TOKEN (FIXED) ====================
exports.refreshToken = async (req, res) => {
  try {
    let { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).json({ success: false, message: 'No refresh token provided' });
    }

    // ✅ Clean token
    refreshToken = cleanToken(refreshToken);
    if (!refreshToken) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token format' });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    } catch (error) {
      console.error('JWT Verify Error:', error.message);
      if (error.name === 'TokenExpiredError') {
        return res.status(403).json({ success: false, message: 'Refresh token expired. Please login again.' });
      }
      return res.status(403).json({ success: false, message: 'Invalid refresh token. Please login again.' });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(403).json({ success: false, message: 'User invalid or inactive' });
    }

    const token = generateToken(user._id);
    const newRefreshToken = generateRefreshToken(user._id);

    res.status(200).json({ success: true, token, refreshToken: newRefreshToken });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ==================== GET CURRENT USER ====================
exports.getMe = async (req, res) => {
  try {
    await checkAndExpireSubscription(req.user.id);
    const updatedUser = await User.findById(req.user.id);

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
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
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==================== CHANGE PASSWORD ====================
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Please provide current password and new password' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isPasswordMatch = await user.matchPassword(currentPassword);
    if (!isPasswordMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, message: 'New password cannot be the same as current password' });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ==================== FORGOT PASSWORD - SEND OTP ====================
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Please provide email address' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'No account found with this email' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOtp = otp;
    user.resetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendOTPEmail(email, otp, user.firstName);

    res.status(200).json({ success: true, message: 'OTP sent to your email' });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ==================== VERIFY OTP ====================
exports.passwordverifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Please provide email and OTP' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'No account found with this email' });
    }
    if (!user.resetOtp || user.resetOtp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
    if (user.resetOtpExpiry < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    const resetToken = jwt.sign(
      { id: user._id, purpose: 'reset' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.status(200).json({ success: true, message: 'OTP verified successfully', resetToken });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ==================== RESET PASSWORD ====================
exports.resetPassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    const resetToken = req.headers.authorization?.split(' ')[1];

    if (!resetToken) {
      return res.status(401).json({ success: false, message: 'No reset token provided' });
    }
    if (!newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'Please provide new password and confirm password' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match' });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({ success: false, message: 'Invalid or expired reset token' });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.password = newPassword;
    user.resetOtp = null;
    user.resetOtpExpiry = null;
    await user.save();

    res.status(200).json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ==================== HELPER: SEND OTP EMAIL ====================
async function sendOTPEmail(email, otp, firstName = '') {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
  console.log(otp);

  const otpDigits = String(otp).split('');
  const digitBoxes = otpDigits
    .map(
      (digit, i) =>
        `<td style="padding:0 5px;">
          <div style="
            width:48px;height:58px;
            background:${i % 2 === 0 ? 'linear-gradient(135deg,#f5f3ff,#eef2ff)' : '#ffffff'};
            border:1.5px solid ${i % 2 === 0 ? '#6366f1' : '#c7d2fe'};
            border-radius:12px;
            text-align:center;line-height:58px;
            font-family:'Courier New',Courier,monospace;
            font-size:26px;font-weight:700;
            color:${i % 2 === 0 ? '#4338ca' : '#1e1b4b'};
            box-shadow:0 4px 12px rgba(99,102,241,0.12);
          ">${digit}</div>
        </td>`
    )
    .join('');

  const mailOptions = {
    from: `"LedgerPro" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: '🔐 Your Login Verification Code — LedgerPro',
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0"
        style="max-width:560px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.12);">

        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#0f2744 100%);padding:48px 40px 56px;text-align:center;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding-bottom:28px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="background:linear-gradient(135deg,#1AB4F5,#6366f1);border-radius:12px;padding:9px 13px;font-size:20px;line-height:1;vertical-align:middle;">💼</td>
                  <td style="padding-left:10px;vertical-align:middle;">
                    <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Ledger<span style="color:#1AB4F5;">Pro</span></span>
                  </td>
                </tr></table>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding-bottom:20px;">
                <div style="width:80px;height:80px;background:rgba(26,180,245,0.12);border:1.5px solid rgba(26,180,245,0.35);border-radius:50%;display:inline-block;line-height:80px;font-size:36px;text-align:center;">🔐</div>
              </td></tr>
            </table>
            <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">Login Verification</div>
            <div style="margin-top:8px;font-size:14px;color:rgba(255,255,255,0.5);font-weight:300;">One-Time Password for ${firstName ? firstName + "'s" : 'your'} Login</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;margin-bottom:-2px;">
              <tr><td>
                <svg viewBox="0 0 560 36" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" width="100%" height="36">
                  <path d="M0,36 C140,0 420,0 560,36 L560,36 L0,36 Z" fill="#ffffff"/>
                </svg>
              </td></tr>
            </table>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="background:#ffffff;padding:36px 40px 28px;">
            <p style="font-size:15px;color:#374151;line-height:1.8;margin:0 0 28px 0;">
              Hello <strong style="color:#111827;">${firstName || 'there'}</strong>,<br/>
              Use the code below to complete your <strong style="color:#111827;">LedgerPro</strong> login.
              This code expires in <strong style="color:#ef4444;">10 minutes</strong>.
            </p>

            <!-- OTP BOX -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#f8faff,#eef2ff);border:1.5px solid #e0e7ff;border-radius:16px;margin-bottom:28px;overflow:hidden;">
              <tr><td style="height:3px;background:linear-gradient(90deg,#1AB4F5,#6366f1,#a855f7,#1AB4F5);"></td></tr>
              <tr><td style="padding:30px 24px 28px;text-align:center;">
                <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#6366f1;font-weight:700;margin-bottom:20px;">YOUR ONE-TIME PASSWORD</div>
                <table cellpadding="0" cellspacing="0" style="margin:0 auto 20px;"><tr>${digitBoxes}</tr></table>
                <div style="display:inline-block;background:#f3f4f6;border-radius:20px;padding:7px 18px;font-size:12px;color:#6b7280;">⏱&nbsp; Expires in 10 minutes</div>
              </td></tr>
            </table>

            <!-- Warning -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:10px;margin-bottom:28px;">
              <tr><td style="padding:14px 16px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="padding-right:10px;vertical-align:top;font-size:17px;padding-top:1px;">⚠️</td>
                  <td style="font-size:13px;color:#78350f;line-height:1.7;">
                    <strong>Security Notice:</strong> LedgerPro will never ask for your OTP via phone or chat.
                    If you did not attempt to login, please secure your account immediately.
                  </td>
                </tr></table>
              </td></tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
              <tr><td style="height:1px;background:linear-gradient(90deg,transparent,#e5e7eb,transparent);"></td></tr>
            </table>
            <p style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.8;margin:0;">
              Sent to <span style="color:#6366f1;">${email}</span><br/>
              Questions? <span style="color:#6366f1;">support@ledgerpro.com</span>
            </p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:22px 40px;">
            <p style="font-size:12px;color:#9ca3af;line-height:1.7;margin:0 0 12px 0;">
              © 2025 LedgerPro. All rights reserved.<br/>Secure Financial Management Platform
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };

  await transporter.sendMail(mailOptions);
}