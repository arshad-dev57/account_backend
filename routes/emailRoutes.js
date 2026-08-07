// routes/emailRoutes.js - Email Routes

const express = require('express');
const router = express.Router();
const emailSenderService = require('../services/emailSenderService');

// @desc    Send email
// @route   POST /api/email/send
// @access  Private
const sendEmail = async (req, res) => {
  try {
    console.log('Email request received:', { to: req.body.to, subject: req.body.subject, hasAttachments: !!req.body.attachments });
    
    const { to, subject, html, text, attachments } = req.body;

    // Validate required fields
    if (!to || !subject) {
      console.log('Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: to, subject'
      });
    }

    // Process attachments if provided
    let processedAttachments = null;
    if (attachments && attachments.length > 0) {
      console.log('Processing attachments:', attachments.length);
      processedAttachments = attachments.map(att => ({
        filename: att.filename,
        content: att.content, // base64 string
        encoding: 'base64',
        contentType: att.contentType
      }));
    }

    console.log('Sending email via emailSenderService...');
    // Send email using email sender service
    await emailSenderService.sendRawEmail(to, subject, html, text, processedAttachments);

    console.log('Email sent successfully');
    res.status(200).json({
      success: true,
      message: 'Email sent successfully'
    });
  } catch (error) {
    console.error('Send email error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send email',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// @desc    Send invoice email
// @route   POST /api/email/send-invoice
// @access  Private
const sendInvoiceEmail = async (req, res) => {
  try {
    const { email, invoice, companyProfile } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const companyName = companyProfile?.organizationName || companyProfile?.personName || 'BisonTechs';
    const companyLogo = companyProfile?.businessDetails?.logo || companyProfile?.logo || '';

    // Generate invoice HTML
    const invoiceHtml = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0"
        style="max-width:560px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.12);">
        <tr>
          <td style="background:linear-gradient(135deg,#7c3aed 0%,#8b5cf6 55%,#a78bfa 100%);padding:48px 40px 36px;text-align:center;">
            ${companyLogo ? `
              <img src="${companyLogo}" alt="${companyName}" style="width:80px;height:80px;border-radius:12px;object-fit:cover;margin-bottom:20px;" />
            ` : ''}
            <div style="font-size:36px;margin-bottom:8px;">📄</div>
            <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">INVOICE</div>
            <div style="margin-top:8px;font-size:15px;color:rgba(255,255,255,0.7);font-weight:300;">
              ${companyName}
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
              Dear <strong style="color:#111827;">${invoice.customerName || 'Customer'}</strong>,<br/>
              Thank you for your business with <strong style="color:#111827;">${companyName}</strong>.
              Below is your invoice for reference.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3e8ff;border:1px solid #d8b4fe;border-left:4px solid #7c3aed;border-radius:10px;margin-bottom:28px;">
              <tr><td style="padding:16px 20px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="padding-right:12px;vertical-align:top;font-size:18px;">📋</td>
                  <td style="font-size:14px;color:#5b21b6;line-height:1.7;">
                    <strong>Invoice Details:</strong><br/>
                    Invoice: ${invoice.invoiceNumber}<br/>
                    Date: ${new Date(invoice.date).toLocaleDateString()}<br/>
                    Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}<br/>
                    Total: $${invoice.totalAmount?.toFixed(2)}
                  </td>
                </tr></table>
              </td></tr>
            </table>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:28px;">
              <div style="font-size:12px;color:#6b7280;margin-bottom:12px;font-weight:600;">ITEMS</div>
              ${invoice.items?.map((item, i) => `
                <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e5e7eb;">
                  <span style="color:#374151;font-size:13px;">${item.description} x${item.quantity}</span>
                  <span style="color:#111827;font-weight:600;font-size:13px;">$${item.amount?.toFixed(2)}</span>
                </div>
              `).join('') || ''}
              <div style="display:flex;justify-content:space-between;padding:12px 0 8px;margin-top:8px;border-top:2px solid #e5e7eb;">
                <span style="color:#374151;font-weight:600;font-size:14px;">TOTAL</span>
                <span style="color:#111827;font-weight:800;font-size:16px;">$${invoice.totalAmount?.toFixed(2)}</span>
              </div>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
              <tr><td style="height:1px;background:linear-gradient(90deg,transparent,#e5e7eb,transparent);"></td></tr>
            </table>
            <p style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.8;margin:0;">
              Questions? <span style="color:#7c3aed;">support@bisontechs.com</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:22px 40px;">
            <p style="font-size:12px;color:#9ca3af;line-height:1.7;margin:0 0 12px 0;">
              © ${new Date().getFullYear()} ${companyName}. All rights reserved.<br/>Invoice Management System
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const mailOptions = {
      to: email,
      subject: `Invoice - ${invoice.invoiceNumber} - ${companyName}`,
      html: invoiceHtml,
    };

    await emailSenderService.sendRawEmail(email, mailOptions.subject, invoiceHtml, null, null);
    
    res.status(200).json({ success: true, message: 'Invoice sent successfully' });
  } catch (error) {
    console.error('Error sending invoice email:', error);
    res.status(500).json({ success: false, message: 'Failed to send invoice', error: error.message });
  }
};

// Define routes
router.post('/send', sendEmail);
router.post('/send-invoice', sendInvoiceEmail);

module.exports = router;
