// services/emailTemplateService.js - Generic Email Template System

/**
 * Generic Email Template Service
 * Provides reusable email templates for different document types
 */

class EmailTemplateService {
  constructor() {
    this.companyName = process.env.COMPANY_NAME || 'WarehousePro';
    this.companyEmail = process.env.COMPANY_EMAIL || 'support@warehousepro.com';
    this.frontendUrl = process.env.FRONTEND_URL || 'https://app.warehousepro.com';
  }

  /**
   * Generate base email template wrapper
   */
  getBaseTemplate(content, subject, companyName = this.companyName) {
    return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0"
        style="max-width:560px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.12);">
        ${content}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  /**
   * Generate header section
   */
  getHeader(title, subtitle, icon = '📋', logo = null) {
    const logoHtml = logo 
      ? `<img src="${logo}" alt="${this.companyName}" style="width:50px;height:50px;border-radius:12px;object-fit:cover;" />`
      : `<table cellpadding="0" cellspacing="0"><tr>
          <td style="background:linear-gradient(135deg,#7c4dff,#6c3fe0);border-radius:12px;padding:9px 13px;font-size:20px;line-height:1;vertical-align:middle;">📦</td>
        </tr></table>`;

    return `
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#0f2744 100%);padding:48px 40px 36px;text-align:center;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding-bottom:20px;">
                ${logoHtml}
              </td></tr>
            </table>
            <div style="font-size:36px;margin-bottom:8px;">${icon}</div>
            <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">${title}</div>
            <div style="margin-top:8px;font-size:15px;color:rgba(255,255,255,0.7);font-weight:300;">
              ${subtitle}
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;margin-bottom:-2px;">
              <tr><td>
                <svg viewBox="0 0 560 36" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" width="100%" height="36">
                  <path d="M0,36 C140,0 420,0 560,36 L560,36 L0,36 Z" fill="#ffffff"/>
                </svg>
              </td></tr>
            </table>
          </td>
        </tr>`;
  }

  /**
   * Generate footer section
   */
  getFooter(companyName = this.companyName, supportEmail = this.companyEmail) {
    return `
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:22px 40px;">
            <p style="font-size:12px;color:#9ca3af;line-height:1.7;margin:0 0 12px 0;">
              © 2025 ${companyName}. All rights reserved.<br/>Warehouse & Inventory Management System
            </p>
          </td>
        </tr>`;
  }

  /**
   * Generate document email template (Purchase Order, Invoice, etc.)
   */
  getDocumentEmailTemplate({
    documentType,
    documentNumber,
    recipientName,
    companyName,
    companyLogo,
    companyEmail,
    companyPhone,
    documentDetails,
    hasAttachment = true
  }) {
    const title = documentType;
    const subtitle = `${documentType} Number: ${documentNumber}`;
    
    const content = `
${this.getHeader(title, subtitle, '📋', companyLogo)}
        <tr>
          <td style="background:#ffffff;padding:36px 40px 28px;">
            <p style="font-size:15px;color:#374151;line-height:1.8;margin:0 0 28px 0;">
              Dear <strong style="color:#111827;">${recipientName}</strong>,<br/>
              Please find attached the ${documentType.toLowerCase()} <strong style="color:#111827;">${documentNumber}</strong> from <strong style="color:#111827;">${companyName}</strong> for your review and processing.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #22c55e;border-radius:10px;margin-bottom:28px;">
              <tr><td style="padding:16px 20px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="padding-right:12px;vertical-align:top;font-size:18px;">📊</td>
                  <td style="font-size:14px;color:#14532d;line-height:1.7;">
                    <strong>Document Details:</strong><br/>
                    ${documentDetails}
                  </td>
                </tr></table>
              </td></tr>
            </table>
            ${hasAttachment ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-left:4px solid #3b82f6;border-radius:10px;margin-bottom:28px;">
              <tr><td style="padding:16px 20px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="padding-right:12px;vertical-align:top;font-size:18px;">📎</td>
                  <td style="font-size:14px;color:#1e3a8a;line-height:1.7;">
                    <strong>Attachment:</strong> The detailed ${documentType.toLowerCase()} is attached as a PDF file for your records.
                  </td>
                </tr></table>
              </td></tr>
            </table>` : ''}
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
              <tr><td style="height:1px;background:linear-gradient(90deg,transparent,#e5e7eb,transparent);"></td></tr>
            </table>
            <p style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.8;margin:0;">
              Questions? <span style="color:#7c4dff;">${companyEmail || supportEmail}</span>
            </p>
          </td>
        </tr>
${this.getFooter(companyName, companyEmail)}`;

    return this.getBaseTemplate(content, `${documentType} ${documentNumber} - ${companyName}`, companyName);
  }

  /**
   * Generate welcome email template
   */
  getWelcomeEmailTemplate({ firstName, companyName = this.companyName }) {
    const title = 'Welcome to WarehousePro';
    const subtitle = 'Your 30-day free trial has started';
    
    const content = `
${this.getHeader(title, subtitle, '🎉')}
        <tr>
          <td style="background:#ffffff;padding:36px 40px 28px;">
            <p style="font-size:15px;color:#374151;line-height:1.8;margin:0 0 28px 0;">
              Hello <strong style="color:#111827;">${firstName || 'there'}</strong>,<br/>
              Welcome to <strong style="color:#111827;">${companyName}</strong>! We're thrilled to have you on board.
              Your 30-day free trial is now active — explore all the features and take control of your inventory.
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
                    <strong>Getting Started:</strong> Complete your business profile, set up your fiscal year, and start managing your inventory.
                  </td>
                </tr></table>
              </td></tr>
            </table>
            <div style="text-align:center;margin:32px 0 24px;">
              <a href="${this.frontendUrl}/dashboard" 
                 style="display:inline-block;background:linear-gradient(135deg,#7c4dff,#6c3fe0);color:#ffffff;text-decoration:none;padding:14px 44px;border-radius:50px;font-weight:600;font-size:16px;box-shadow:0 8px 24px rgba(124,77,255,0.35);">
                Go to Dashboard →
              </a>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
              <tr><td style="height:1px;background:linear-gradient(90deg,transparent,#e5e7eb,transparent);"></td></tr>
            </table>
            <p style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.8;margin:0;">
              Questions? <span style="color:#7c4dff;">${this.companyEmail}</span>
            </p>
          </td>
        </tr>
${this.getFooter(companyName)}`;

    return this.getBaseTemplate(content, `🎉 Welcome to ${companyName}`, companyName);
  }

  /**
   * Generate OTP email template
   */
  getOTPEmailTemplate({ otp, firstName, type = 'login' }) {
    const isLoginOTP = type === 'login';
    const title = isLoginOTP ? 'Login Verification' : 'Password Reset';
    const subtitle = isLoginOTP 
      ? `One-Time Password for ${firstName ? firstName + "'s" : 'your'} Login`
      : `One-Time Password for ${firstName ? firstName + "'s" : 'your'} Password Reset`;
    
    const otpDigits = String(otp).split('');
    const digitBoxes = otpDigits
      .map((digit, i) =>
        `<td style="padding:0 5px;">
          <div style="
            width:48px;height:58px;
            background:${i % 2 === 0 ? 'linear-gradient(135deg,#f5f3ff,#eef2ff)' : '#ffffff'};
            border:1.5px solid ${i % 2 === 0 ? '#7c4dff' : '#c7d2fe'};
            border-radius:12px;
            text-align:center;line-height:58px;
            font-family:'Courier New',Courier,monospace;
            font-size:26px;font-weight:700;
            color:${i % 2 === 0 ? '#4338ca' : '#1e1b4b'};
            box-shadow:0 4px 12px rgba(124,77,255,0.12);
          ">${digit}</div>
        </td>`
      )
      .join('');

    const securityNotice = isLoginOTP
      ? 'WarehousePro will never ask for your OTP via phone or chat. If you did not attempt to login, please secure your account immediately.'
      : 'If you did not request a password reset, please ignore this email.';

    const content = `
${this.getHeader(title, subtitle, isLoginOTP ? '🔐' : '🔑')}
        <tr>
          <td style="background:#ffffff;padding:36px 40px 28px;">
            <p style="font-size:15px;color:#374151;line-height:1.8;margin:0 0 28px 0;">
              Hello <strong style="color:#111827;">${firstName || 'there'}</strong>,<br/>
              Use the code below to complete your <strong style="color:#111827;">WarehousePro</strong> ${isLoginOTP ? 'login' : 'password reset'}.
              This code expires in <strong style="color:#ef4444;">10 minutes</strong>.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#f8faff,#eef2ff);border:1.5px solid #e0e7ff;border-radius:16px;margin-bottom:28px;overflow:hidden;">
              <tr><td style="height:3px;background:linear-gradient(90deg,#7c4dff,#6c3fe0,#a855f7,#7c4dff);"></td></tr>
              <tr><td style="padding:30px 24px 28px;text-align:center;">
                <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#7c4dff;font-weight:700;margin-bottom:20px;">YOUR ONE-TIME PASSWORD</div>
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
              Questions? <span style="color:#7c4dff;">${this.companyEmail}</span>
            </p>
          </td>
        </tr>
${this.getFooter()}`;

    const subject = isLoginOTP 
      ? '🔐 Your Login Verification Code — WarehousePro' 
      : '🔑 Password Reset OTP — WarehousePro';

    return this.getBaseTemplate(content, subject);
  }

  /**
   * Generate notification email template
   */
  getNotificationEmailTemplate({ 
    title, 
    message, 
    recipientName, 
    actionUrl = null,
    actionText = 'View Details'
  }) {
    const content = `
${this.getHeader(title, 'System Notification', '🔔')}
        <tr>
          <td style="background:#ffffff;padding:36px 40px 28px;">
            <p style="font-size:15px;color:#374151;line-height:1.8;margin:0 0 28px 0;">
              Hello <strong style="color:#111827;">${recipientName}</strong>,<br/>
              ${message}
            </p>
            ${actionUrl ? `
            <div style="text-align:center;margin:32px 0 24px;">
              <a href="${actionUrl}" 
                 style="display:inline-block;background:linear-gradient(135deg,#7c4dff,#6c3fe0);color:#ffffff;text-decoration:none;padding:14px 44px;border-radius:50px;font-weight:600;font-size:16px;box-shadow:0 8px 24px rgba(124,77,255,0.35);">
                ${actionText} →
              </a>
            </div>` : ''}
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
              <tr><td style="height:1px;background:linear-gradient(90deg,transparent,#e5e7eb,transparent);"></td></tr>
            </table>
            <p style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.8;margin:0;">
              Questions? <span style="color:#7c4dff;">${this.companyEmail}</span>
            </p>
          </td>
        </tr>
${this.getFooter()}`;

    return this.getBaseTemplate(content, title);
  }
}

const emailTemplateService = new EmailTemplateService();
module.exports = emailTemplateService;
