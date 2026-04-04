const User = require('../models/User');
const Subscription = require('../models/Subscription');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// ✅ userId pass karo taake hamesha fresh DB data mile
const checkAndExpireSubscription = async (userId) => {
  const user = await User.findById(userId);

  if (!user || user.subscription.status !== 'active') return;

  const now = new Date();

  // Trial check
  if (
    user.subscription.plan === 'trial' &&
    user.subscription.trialEndDate &&
    now > new Date(user.subscription.trialEndDate)
  ) {
    console.log('Trial expired, updating status...');
    await user.expireSubscription();
    return;
  }

  // Paid subscription check
  if (
    (user.subscription.plan === 'monthly' || user.subscription.plan === 'yearly') &&
    user.subscription.endDate &&
    now > new Date(user.subscription.endDate)
  ) {
    console.log('Paid subscription expired, updating status...');
    await user.expireSubscription();
    return;
  }
};
// ==================== REGISTER ====================
exports.register = async (req, res) => {
  try {
    const { 
      firstName, 
      lastName, 
      email, 
      password, 
      country, 
      phone,
      address,        // ✅ New field
      organizationName // ✅ New field (Company Name)
    } = req.body;

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
      address: address || '',              // ✅ Save address
      organizationName: organizationName || '',  // ✅ Save company name
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
        address: updatedUser.address,                    // ✅ Return address
        organizationName: updatedUser.organizationName,  // ✅ Return company name
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
};// ==================== LOGIN ====================
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
        address: updatedUser.address,                    // ✅ Added
        organizationName: updatedUser.organizationName,  // ✅ Added
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
};// ==================== GET CURRENT USER ====================
exports.getMe = async (req, res) => {
  try {
    await checkAndExpireSubscription(req.user.id);

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

// ==================== CHANGE PASSWORD ====================
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current password and new password',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters',
      });
    }

    const user = await User.findById(userId).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const isPasswordMatch = await user.matchPassword(currentPassword);

    if (!isPasswordMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password cannot be the same as current password',
      });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// ==================== FORGOT PASSWORD - SEND OTP ====================
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email address',
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email',
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    user.resetOtp = otp;
    user.resetOtpExpiry = otpExpiry;
    await user.save();

    await sendOTPEmail(email, otp);

    console.log(`OTP sent to ${email}: ${otp}`);

    res.status(200).json({
      success: true,
      message: 'OTP sent to your email',
    });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// ==================== VERIFY OTP ====================
exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and OTP',
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email',
      });
    }

    if (!user.resetOtp || user.resetOtp !== otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP',
      });
    }

    if (user.resetOtpExpiry < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.',
      });
    }

    const resetToken = jwt.sign(
      { id: user._id, purpose: 'reset' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      resetToken: resetToken,
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// ==================== RESET PASSWORD ====================
exports.resetPassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    const resetToken = req.headers.authorization?.split(' ')[1];

    if (!resetToken) {
      return res.status(401).json({
        success: false,
        message: 'No reset token provided',
      });
    }

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide new password and confirm password',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired reset token',
      });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    user.password = newPassword;
    user.resetOtp = null;
    user.resetOtpExpiry = null;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// ==================== HELPER: SEND OTP EMAIL ====================
async function sendOTPEmail(email, otp) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  // Build individual OTP digit boxes
  const otpDigits = String(otp).split('');
  const digitBoxes = otpDigits
    .map(
      (digit, i) =>
        `<td style="padding:0 5px;">
          <div style="
            width:48px;
            height:58px;
            background:${i % 2 === 0 ? 'linear-gradient(135deg,#f5f3ff,#eef2ff)' : '#ffffff'};
            border:1.5px solid ${i % 2 === 0 ? '#6366f1' : '#c7d2fe'};
            border-radius:12px;
            text-align:center;
            line-height:58px;
            font-family:'Courier New',Courier,monospace;
            font-size:26px;
            font-weight:700;
            color:${i % 2 === 0 ? '#4338ca' : '#1e1b4b'};
            box-shadow:0 4px 12px rgba(99,102,241,0.12);
          ">${digit}</div>
        </td>`
    )
    .join('');

  const mailOptions = {
    from: `"AccountingPro" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: '🔐 Your Password Reset OTP — AccountingPro',
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Reset Password OTP</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr>
      <td align="center">

        <!-- MAIN CARD -->
        <table width="560" cellpadding="0" cellspacing="0" border="0"
          style="max-width:560px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.12);">

          <!-- ══════════ HEADER ══════════ -->
          <tr>
            <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#0f2744 100%);padding:48px 40px 56px;text-align:center;">

              <!-- Logo Row -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:28px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="
                          background:linear-gradient(135deg,#1AB4F5,#6366f1);
                          border-radius:12px;
                          padding:9px 13px;
                          font-size:20px;
                          line-height:1;
                          vertical-align:middle;
                        ">💼</td>
                        <td style="padding-left:10px;vertical-align:middle;">
                          <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">
                            Accounting<span style="color:#1AB4F5;">Pro</span>
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Shield Circle -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:20px;">
                    <div style="
                      width:80px;height:80px;
                      background:rgba(26,180,245,0.12);
                      border:1.5px solid rgba(26,180,245,0.35);
                      border-radius:50%;
                      display:inline-block;
                      line-height:80px;
                      font-size:36px;
                      text-align:center;
                    ">🔐</div>
                  </td>
                </tr>
              </table>

              <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">
                Verify Your Identity
              </div>
              <div style="margin-top:8px;font-size:14px;color:rgba(255,255,255,0.5);font-weight:300;">
                One-Time Password for Password Reset
              </div>

              <!-- Curved white bottom -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;margin-bottom:-2px;">
                <tr>
                  <td>
                    <svg viewBox="0 0 560 36" xmlns="http://www.w3.org/2000/svg"
                      preserveAspectRatio="none" width="100%" height="36">
                      <path d="M0,36 C140,0 420,0 560,36 L560,36 L0,36 Z" fill="#ffffff"/>
                    </svg>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ══════════ BODY ══════════ -->
          <tr>
            <td style="background:#ffffff;padding:36px 40px 28px;">

              <!-- Greeting -->
              <p style="font-size:15px;color:#374151;line-height:1.8;margin:0 0 28px 0;">
                Hello <strong style="color:#111827;">there</strong>,<br/>
                We received a request to reset your <strong style="color:#111827;">AccountingPro</strong>
                account password. Use the verification code below to proceed.
                This code is valid for <strong style="color:#ef4444;">10 minutes only</strong>.
              </p>

              <!-- OTP BOX -->
              <table width="100%" cellpadding="0" cellspacing="0" style="
                background:linear-gradient(135deg,#f8faff,#eef2ff);
                border:1.5px solid #e0e7ff;
                border-radius:16px;
                margin-bottom:28px;
                overflow:hidden;
              ">
                <!-- Top shimmer bar -->
                <tr>
                  <td style="height:3px;background:linear-gradient(90deg,#1AB4F5,#6366f1,#a855f7,#1AB4F5);"></td>
                </tr>
                <tr>
                  <td style="padding:30px 24px 28px;text-align:center;">

                    <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#6366f1;font-weight:700;margin-bottom:20px;">
                      YOUR ONE-TIME PASSWORD
                    </div>

                    <!-- Digit boxes -->
                    <table cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
                      <tr>${digitBoxes}</tr>
                    </table>

                    <!-- Expiry badge -->
                    <div style="
                      display:inline-block;
                      background:#f3f4f6;
                      border-radius:20px;
                      padding:7px 18px;
                      font-size:12px;
                      color:#6b7280;
                    ">
                      ⏱&nbsp; Expires in 10 minutes
                    </div>
                  </td>
                </tr>
              </table>

              <!-- HOW TO USE steps -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9ca3af;font-weight:700;padding-bottom:14px;">
                    HOW TO USE
                  </td>
                </tr>
                <tr>
                  <td style="padding:11px 0;border-bottom:1px solid #f3f4f6;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:12px;vertical-align:top;">
                          <div style="width:26px;height:26px;background:linear-gradient(135deg,#1AB4F5,#6366f1);border-radius:8px;color:#fff;font-size:12px;font-weight:800;text-align:center;line-height:26px;">1</div>
                        </td>
                        <td style="font-size:13px;color:#4b5563;line-height:1.6;padding-top:4px;">
                          Go back to the AccountingPro reset page in your browser.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:11px 0;border-bottom:1px solid #f3f4f6;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:12px;vertical-align:top;">
                          <div style="width:26px;height:26px;background:linear-gradient(135deg,#1AB4F5,#6366f1);border-radius:8px;color:#fff;font-size:12px;font-weight:800;text-align:center;line-height:26px;">2</div>
                        </td>
                        <td style="font-size:13px;color:#4b5563;line-height:1.6;padding-top:4px;">
                          Enter the 6-digit OTP code above in the verification field.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:11px 0;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:12px;vertical-align:top;">
                          <div style="width:26px;height:26px;background:linear-gradient(135deg,#1AB4F5,#6366f1);border-radius:8px;color:#fff;font-size:12px;font-weight:800;text-align:center;line-height:26px;">3</div>
                        </td>
                        <td style="font-size:13px;color:#4b5563;line-height:1.6;padding-top:4px;">
                          Create a strong new password to secure your account.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Warning Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="
                background:#fffbeb;
                border:1px solid #fde68a;
                border-left:4px solid #f59e0b;
                border-radius:10px;
                margin-bottom:28px;
              ">
                <tr>
                  <td style="padding:14px 16px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:10px;vertical-align:top;font-size:17px;padding-top:1px;">⚠️</td>
                        <td style="font-size:13px;color:#78350f;line-height:1.7;">
                          <strong>Security Notice:</strong> AccountingPro will never ask for your OTP via phone or chat.
                          If you did not request this, please ignore this email — your account remains safe.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
                <tr>
                  <td style="height:1px;background:linear-gradient(90deg,transparent,#e5e7eb,transparent);"></td>
                </tr>
              </table>

              <p style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.8;margin:0;">
                This email was sent to <span style="color:#6366f1;">${email}</span><br/>
                Questions? Contact <span style="color:#6366f1;">support@accountingpro.com</span>
              </p>
            </td>
          </tr>

          <!-- ══════════ FOOTER ══════════ -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:22px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <!-- Brand -->
                    <table cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
                      <tr>
                        <td style="width:8px;height:8px;background:linear-gradient(135deg,#1AB4F5,#6366f1);border-radius:50%;vertical-align:middle;"></td>
                        <td style="padding-left:8px;font-size:13px;font-weight:700;color:#374151;vertical-align:middle;">AccountingPro</td>
                      </tr>
                    </table>
                    <p style="font-size:12px;color:#9ca3af;line-height:1.7;margin:0 0 12px 0;">
                      © 2025 AccountingPro. All rights reserved.<br/>
                      Secure Financial Management Platform
                    </p>
                    <a href="#" style="font-size:11px;color:#6b7280;margin-right:16px;text-decoration:none;border-bottom:1px solid #e5e7eb;">Privacy Policy</a>
                    <a href="#" style="font-size:11px;color:#6b7280;margin-right:16px;text-decoration:none;border-bottom:1px solid #e5e7eb;">Terms of Service</a>
                    <a href="#" style="font-size:11px;color:#6b7280;text-decoration:none;border-bottom:1px solid #e5e7eb;">Unsubscribe</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- END MAIN CARD -->

      </td>
    </tr>
  </table>

</body>
</html>
    `,
  };

  await transporter.sendMail(mailOptions);
}