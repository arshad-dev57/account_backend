// services/emailService.js
const { getEmailFrom } = require('../utils/emailConfig');
const {
  sendMail,
  verifyMailTransport,
  isEmailConfigured
} = require('../utils/mailTransport');

class EmailService {
  constructor() {
    this._ready = this._bootstrap();
  }

  async _bootstrap() {
    if (!isEmailConfigured()) {
      console.warn('⚠️ Email not configured. Set RESEND_API_KEY (Railway) or EMAIL_USER/PASS (local SMTP).');
      return false;
    }

    try {
      return await verifyMailTransport();
    } catch (error) {
      console.error('❌ Email bootstrap error:', error.message || error);
      return false;
    }
  }

  async _ensureReady() {
    await this._ready;
    if (!isEmailConfigured()) {
      throw new Error('Email service not configured properly');
    }
  }

  _mailIdentity() {
    const from = getEmailFrom();
    if (!from.address) {
      throw new Error('EMAIL_FROM / EMAIL_USER not configured');
    }
    return from;
  }

  async _sendMail(mailOptions) {
    await this._ensureReady();
    return sendMail(mailOptions);
  }

  /**
   * Send OTP email to user
   * @param {string} email - Recipient email address
   * @param {string} otp - One-time password
   * @param {string} firstName - User's first name (optional)
   * @param {string} type - Type of OTP: 'login' or 'reset' (default: 'login')
   * @returns {Promise<object>} - Email send result
   */
  async sendOTPEmail(email, otp, firstName = '', type = 'login') {
    console.log(`📧 [EmailService] Sending ${type} OTP to:`, email);
    await this._ensureReady();

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

    const isLoginOTP = type === 'login';
    // Avoid emojis / spammy words in subject — Gmail often filters those
    const subject = isLoginOTP
      ? 'Your BisonsTechs login verification code'
      : 'Your BisonsTechs password reset code';

    const headerTitle = isLoginOTP ? 'Login Verification' : 'Password Reset';
    const headerSubtitle = isLoginOTP
      ? `One-Time Password for ${firstName ? firstName + "'s" : 'your'} Login`
      : `One-Time Password for ${firstName ? firstName + "'s" : 'your'} Password Reset`;
    const securityNotice = isLoginOTP
      ? 'BisonsTechs will never ask for your OTP via phone or chat. If you did not attempt to login, please secure your account immediately.'
      : 'If you did not request a password reset, please ignore this email.';

    const identity = this._mailIdentity();

    const textBody = [
      `Hello ${firstName || 'there'},`,
      '',
      isLoginOTP
        ? 'Your BisonsTechs login verification code is:'
        : 'Your BisonsTechs password reset code is:',
      String(otp),
      '',
      'This code expires in 10 minutes.',
      '',
      securityNotice,
      '',
      '— BisonsTechs',
    ].join('\n');

    const mailOptions = {
      from: identity.fromHeader,
      to: email,
      replyTo: identity.replyTo,
      subject,
      text: textBody, // plaintext alternative improves inbox placement
      headers: {
        'X-Entity-Ref-ID': `otp-${type}-${Date.now()}`,
        'X-Priority': '1',
        Importance: 'high'
      },
      html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0"
        style="max-width:560px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.12);">
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
                <div style="width:80px;height:80px;background:rgba(26,180,245,0.12);border:1.5px solid rgba(26,180,245,0.35);border-radius:50%;display:inline-block;line-height:80px;font-size:36px;text-align:center;">${isLoginOTP ? '🔐' : '🔑'}</div>
              </td></tr>
            </table>
            <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">${headerTitle}</div>
            <div style="margin-top:8px;font-size:14px;color:rgba(255,255,255,0.5);font-weight:300;">${headerSubtitle}</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;margin-bottom:-2px;">
              <tr><td>
                <svg viewBox="0 0 560 36" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" width="100%" height="36">
                  <path d="M0,36 C140,0 420,0 560,36 L560,36 L0,36 Z" fill="#ffffff"/>
                </svg>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px 28px;">
            <p style="font-size:15px;color:#374151;line-height:1.8;margin:0 0 28px 0;">
              Hello <strong style="color:#111827;">${firstName || 'there'}</strong>,<br/>
              Use the code below to complete your <strong style="color:#111827;">BisonsTechs</strong> ${isLoginOTP ? 'login' : 'password reset'}.
              This code expires in <strong style="color:#ef4444;">10 minutes</strong>.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#f8faff,#eef2ff);border:1.5px solid #e0e7ff;border-radius:16px;margin-bottom:28px;overflow:hidden;">
              <tr><td style="height:3px;background:linear-gradient(90deg,#1AB4F5,#6366f1,#a855f7,#1AB4F5);"></td></tr>
              <tr><td style="padding:30px 24px 28px;text-align:center;">
                <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#6366f1;font-weight:700;margin-bottom:20px;">YOUR ONE-TIME PASSWORD</div>
                <table cellpadding="0" cellspacing="0" style="margin:0 auto 20px;"><tr>${digitBoxes}</tr></table>
                <div style="display:inline-block;background:#f3f4f6;border-radius:20px;padding:7px 18px;font-size:12px;color:#6b7280;">⏱&nbsp; Expires in 10 minutes</div>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:10px;margin-bottom:28px;">
              <tr><td style="padding:14px 16px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="padding-right:10px;vertical-align:top;font-size:17px;padding-top:1px;">⚠️</td>
                  <td style="font-size:13px;color:#78350f;line-height:1.7;">
                    <strong>Security Notice:</strong> ${securityNotice}
                  </td>
                </tr></table>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
              <tr><td style="height:1px;background:linear-gradient(90deg,transparent,#e5e7eb,transparent);"></td></tr>
            </table>
            <p style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.8;margin:0;">
              Sent to <span style="color:#6366f1;">${email}</span><br/>
              Questions? <span style="color:#6366f1;">support@BisonsTechs.com</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:22px 40px;">
            <p style="font-size:12px;color:#9ca3af;line-height:1.7;margin:0 0 12px 0;">
              © 2025 BisonsTechs. All rights reserved.<br/>Secure Financial Management Platform
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    };

    try {
      const info = await this._sendMail(mailOptions);
      console.log('✅ Email sent:', info.messageId, '→', email);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Email send failed:', error);
      throw error;
    }
  }

  /**
   * Send welcome email to new user
   * @param {string} email - Recipient email address
   * @param {string} firstName - User's first name
   * @returns {Promise<object>} - Email send result
   */
  async sendWelcomeEmail(email, firstName = '') {
    console.log('📧 [EmailService] Sending welcome email to:', email);
    await this._ensureReady();

    const identity = this._mailIdentity();

    const mailOptions = {
      from: identity.fromHeader,
      to: email,
      replyTo: identity.replyTo,
      subject: 'Welcome to BisonsTechs — your free trial has started',
      text: `Hello ${firstName || 'there'},\n\nWelcome to BisonsTechs. Your 30-day free trial is now active.\n\n— BisonsTechs`,
      html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0"
        style="max-width:560px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.12);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#0f2744 100%);padding:48px 40px 36px;text-align:center;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding-bottom:20px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="background:linear-gradient(135deg,#1AB4F5,#6366f1);border-radius:12px;padding:9px 13px;font-size:20px;line-height:1;vertical-align:middle;">💼</td>
                  <td style="padding-left:10px;vertical-align:middle;">
                    <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Ledger<span style="color:#1AB4F5;">Pro</span></span>
                  </td>
                </tr></table>
              </td></tr>
            </table>
            <div style="font-size:36px;margin-bottom:8px;">🎉</div>
            <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">Welcome to BisonsTechs</div>
            <div style="margin-top:8px;font-size:15px;color:rgba(255,255,255,0.7);font-weight:300;">
              Your 30-day free trial has started
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;margin-bottom:-2px;">
              <tr><td>
                <svg viewBox="0 0 560 36" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" width="100%" height="36">
                  <path d="M0,36 C140,0 420,0 560,36 L560,36 L0,36 Z" fill="#ffffff"/>
                </svg>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px 28px;">
            <p style="font-size:15px;color:#374151;line-height:1.8;margin:0 0 28px 0;">
              Hello <strong style="color:#111827;">${firstName || 'there'}</strong>,<br/>
              Welcome to <strong style="color:#111827;">BisonsTechs</strong>! We're thrilled to have you on board.
              Your 30-day free trial is now active — explore all the features and take control of your finances.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr><td style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #22c55e;border-radius:10px;padding:16px 20px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="padding-right:12px;vertical-align:top;font-size:18px;">✅</td>
                  <td style="font-size:14px;color:#14532d;line-height:1.7;">
                    <strong>Trial Active:</strong> You have 30 days of free access to all premium features.
                  </td>
                </tr></table>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr><td style="background:#eff6ff;border:1px solid #bfdbfe;border-left:4px solid #3b82f6;border-radius:10px;padding:16px 20px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="padding-right:12px;vertical-align:top;font-size:18px;">🚀</td>
                  <td style="font-size:14px;color:#1e3a8a;line-height:1.7;">
                    <strong>Getting Started:</strong> Complete your business profile, set up your fiscal year, and start managing your accounts.
                  </td>
                </tr></table>
              </td></tr>
            </table>
            <div style="text-align:center;margin:32px 0 24px;">
              <a href="${process.env.FRONTEND_URL || 'https://app.BisonsTechs.com'}/dashboard" 
                 style="display:inline-block;background:linear-gradient(135deg,#1AB4F5,#6366f1);color:#ffffff;text-decoration:none;padding:14px 44px;border-radius:50px;font-weight:600;font-size:16px;box-shadow:0 8px 24px rgba(99,102,241,0.35);">
                Go to Dashboard →
              </a>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
              <tr><td style="height:1px;background:linear-gradient(90deg,transparent,#e5e7eb,transparent);"></td></tr>
            </table>
            <p style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.8;margin:0;">
              Questions? <span style="color:#6366f1;">support@BisonsTechs.com</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:22px 40px;">
            <p style="font-size:12px;color:#9ca3af;line-height:1.7;margin:0 0 12px 0;">
              © 2025 BisonsTechs. All rights reserved.<br/>Secure Financial Management Platform
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    };

    try {
      const info = await this._sendMail(mailOptions);
      console.log('✅ Welcome email sent:', info.messageId, '→', email);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Welcome email send failed:', error);
      throw error;
    }
  }

  /**
   * Send purchase order email with PDF attachment
   * @param {string} email - Recipient email address
   * @param {object} orderData - Purchase order data
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @returns {Promise<object>} - Email send result
   */
  async sendPurchaseOrderEmail(email, orderData, pdfBuffer) {
    console.log('📧 [EmailService] Sending purchase order email to:', email);
    await this._ensureReady();

    const companyName = orderData.companyName || 'WarehousePro';
    const companyLogo = orderData.companyLogo || '';
    const identity = this._mailIdentity();

    const mailOptions = {
      from: `"${companyName}" <${identity.address}>`,
      to: email,
      replyTo: identity.replyTo,
      subject: `Purchase Order ${orderData.orderNumber} - ${companyName}`,
      html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0"
        style="max-width:560px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.12);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#0f2744 100%);padding:48px 40px 36px;text-align:center;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding-bottom:20px;">
                ${companyLogo ? `
                  <img src="${companyLogo}" alt="${companyName}" style="width:50px;height:50px;border-radius:12px;object-fit:cover;" />
                ` : `
                  <table cellpadding="0" cellspacing="0"><tr>
                    <td style="background:linear-gradient(135deg,#7c4dff,#6c3fe0);border-radius:12px;padding:9px 13px;font-size:20px;line-height:1;vertical-align:middle;">📦</td>
                  </tr></table>
                `}
              </td></tr>
            </table>
            <div style="font-size:36px;margin-bottom:8px;">📋</div>
            <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">Purchase Order</div>
            <div style="margin-top:8px;font-size:15px;color:rgba(255,255,255,0.7);font-weight:300;">
              Order Number: ${orderData.orderNumber}
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;margin-bottom:-2px;">
              <tr><td>
                <svg viewBox="0 0 560 36" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" width="100%" height="36">
                  <path d="M0,36 C140,0 420,0 560,36 L560,36 L0,36 Z" fill="#ffffff"/>
                </svg>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px 28px;">
            <p style="font-size:15px;color:#374151;line-height:1.8;margin:0 0 28px 0;">
              Dear <strong style="color:#111827;">${orderData.supplierName}</strong>,<br/>
              Please find attached the purchase order <strong style="color:#111827;">${orderData.orderNumber}</strong> from <strong style="color:#111827;">${companyName}</strong> for your review and processing.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #22c55e;border-radius:10px;margin-bottom:28px;">
              <tr><td style="padding:16px 20px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="padding-right:12px;vertical-align:top;font-size:18px;">📊</td>
                  <td style="font-size:14px;color:#14532d;line-height:1.7;">
                    <strong>Order Details:</strong><br/>
                    Order Date: ${new Date(orderData.orderDate).toLocaleDateString()}<br/>
                    Expected Delivery: ${orderData.expectedDeliveryDate ? new Date(orderData.expectedDeliveryDate).toLocaleDateString() : 'TBD'}<br/>
                    Total Amount: Rs. ${orderData.grandTotal.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                  </td>
                </tr></table>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-left:4px solid #3b82f6;border-radius:10px;margin-bottom:28px;">
              <tr><td style="padding:16px 20px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="padding-right:12px;vertical-align:top;font-size:18px;">📎</td>
                  <td style="font-size:14px;color:#1e3a8a;line-height:1.7;">
                    <strong>Attachment:</strong> The detailed purchase order invoice is attached as a PDF file for your records.
                  </td>
                </tr></table>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
              <tr><td style="height:1px;background:linear-gradient(90deg,transparent,#e5e7eb,transparent);"></td></tr>
            </table>
            <p style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.8;margin:0;">
              Questions? <span style="color:#7c4dff;">${orderData.companyEmail || 'support@warehousepro.com'}</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:22px 40px;">
            <p style="font-size:12px;color:#9ca3af;line-height:1.7;margin:0 0 12px 0;">
              © 2025 ${companyName}. All rights reserved.<br/>Warehouse & Inventory Management System
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
      attachments: [
        {
          filename: `Purchase_Order_${orderData.orderNumber}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };

    try {
      const info = await this._sendMail(mailOptions);
      console.log('✅ Purchase order email sent:', info.messageId, '→', email);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Purchase order email send failed:', error);
      throw error;
    }
  }

  /**
   * Team invite: login email, temporary password, role, and app links.
   */
  async sendTeamInviteEmail({
    to,
    firstName = '',
    lastName = '',
    loginEmail,
    password,
    roleLabel = 'User',
    companyName = 'BisonsTechs',
    invitedBy = ''
  }) {
    await this._ensureReady();

    const identity = this._mailIdentity();
    const webBase = (process.env.FRONTEND_URL || 'https://app.bisonstechs.com').replace(/\/$/, '');
    const loginUrl = `${webBase}/login`;
    const androidUrl = (process.env.ANDROID_APP_URL || '').trim();
    const iosUrl = (process.env.IOS_APP_URL || '').trim();
    const supportEmail = identity.replyTo || 'support@bisonstechs.com';

    const esc = (value) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'there';
    const safeName = esc(fullName);
    const safeCompany = esc(companyName);
    const safeRole = esc(roleLabel);
    const safeEmail = esc(loginEmail);
    const safePassword = esc(password);
    const safeInviter = esc(invitedBy);
    const year = new Date().getFullYear();

    const storeLinks = [];
    if (androidUrl) {
      storeLinks.push(
        `<a href="${esc(androidUrl)}" style="color:#1AB4F5;text-decoration:none;font-weight:600;">Android app</a>`
      );
    }
    if (iosUrl) {
      storeLinks.push(
        `<a href="${esc(iosUrl)}" style="color:#1AB4F5;text-decoration:none;font-weight:600;">iOS app</a>`
      );
    }
    const storeLine = storeLinks.length
      ? `You can also open BisonsTechs on ${storeLinks.join(' or ')} with the same login.`
      : 'You can use the same email and password in the BisonsTechs mobile app.';

    const mailOptions = {
      from: identity.fromHeader,
      to,
      replyTo: identity.replyTo,
      subject: `You're invited to ${companyName} on BisonsTechs`,
      text: [
        `Hello ${fullName},`,
        '',
        `${invitedBy || 'Your admin'} added you to ${companyName} on BisonsTechs.`,
        `Role: ${roleLabel}`,
        `Email: ${loginEmail}`,
        `Password: ${password}`,
        '',
        `Sign in here: ${loginUrl}`,
        storeLine.replace(/<[^>]+>/g, ''),
        '',
        'Please change your password after you log in.',
        '',
        '— BisonsTechs'
      ].join('\n'),
      html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0"
        style="max-width:560px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.12);">
        <tr>
          <td style="background:linear-gradient(135deg,#014582 0%,#0A3D5C 55%,#0f2744 100%);padding:40px 40px 28px;text-align:center;">
            <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.4px;">BisonsTechs</div>
            <div style="margin-top:14px;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.4px;line-height:1.25;">
              You've been added to the team
            </div>
            <div style="margin-top:8px;font-size:14px;color:rgba(255,255,255,0.75);">
              ${safeCompany} · ${safeRole}
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px 28px;">
            <p style="font-size:15px;color:#374151;line-height:1.8;margin:0 0 22px 0;">
              Hello <strong style="color:#111827;">${safeName}</strong>,<br/>
              ${safeInviter ? `<strong>${safeInviter}</strong> added you to` : 'You were added to'}
              <strong style="color:#111827;">${safeCompany}</strong> on BisonsTechs.
              Use the details below to sign in.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;">
              <tr>
                <td style="padding:18px 20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:6px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.6px;">Email</td>
                      <td align="right" style="padding:6px 0;font-size:14px;font-weight:700;color:#0f172a;">${safeEmail}</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.6px;">Password</td>
                      <td align="right" style="padding:6px 0;font-size:14px;font-weight:700;color:#0f172a;font-family:Consolas,Monaco,monospace;">${safePassword}</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.6px;">Role</td>
                      <td align="right" style="padding:6px 0;font-size:14px;font-weight:700;color:#014582;">${safeRole}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <div style="text-align:center;margin:8px 0 24px;">
              <a href="${esc(loginUrl)}"
                 style="display:inline-block;background:linear-gradient(135deg,#1AB4F5,#014582);color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:50px;font-weight:700;font-size:15px;">
                Open BisonsTechs →
              </a>
            </div>
            <p style="font-size:13px;color:#64748b;line-height:1.7;margin:0 0 16px 0;text-align:center;">
              ${storeLine}
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
              <tr><td style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px 16px;font-size:13px;color:#9a3412;line-height:1.6;">
                For security, change this password after you log in.
              </td></tr>
            </table>
            <p style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.8;margin:0;">
              Questions? <span style="color:#014582;">${esc(supportEmail)}</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:20px 40px;">
            <p style="font-size:12px;color:#9ca3af;line-height:1.7;margin:0;">
              © ${year} BisonsTechs. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    };

    const info = await this._sendMail(mailOptions);
    console.log('✅ Team invite email sent:', info.messageId, '→', to);
    return { success: true, messageId: info.messageId };
  }
}

const emailService = new EmailService();
module.exports = emailService;