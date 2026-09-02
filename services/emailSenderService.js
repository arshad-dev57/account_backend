// services/emailSenderService.js - Reusable Email Sender Service

const emailTemplateService = require('./emailTemplateService');
const emailService = require('./emailService');

/**
 * Reusable Email Sender Service
 * Provides simple methods to send different types of emails using the template system
 */

class EmailSenderService {
  /**
   * Send document email (Purchase Order, Invoice, etc.)
   * @param {string} to - Recipient email
   * @param {object} data - Document data
   * @param {Buffer} attachment - PDF attachment buffer (optional)
   * @returns {Promise<object>}
   */
  async sendDocumentEmail(to, data, attachment = null) {
    const {
      documentType,
      documentNumber,
      recipientName,
      companyName,
      companyLogo,
      companyEmail,
      companyPhone,
      orderDate,
      expectedDate,
      grandTotal
    } = data;

    const documentDetails = `
      Order Date: ${new Date(orderDate).toLocaleDateString()}<br/>
      ${expectedDate ? `Expected Delivery: ${new Date(expectedDate).toLocaleDateString()}<br/>` : ''}
      Total Amount: Rs. ${grandTotal.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
    `;

    const html = emailTemplateService.getDocumentEmailTemplate({
      documentType,
      documentNumber,
      recipientName,
      companyName,
      companyLogo,
      companyEmail,
      companyPhone,
      documentDetails,
      hasAttachment: !!attachment
    });

    const subject = `${documentType} ${documentNumber} - ${companyName}`;

    try {
      if (attachment) {
        // Send with attachment using the existing email service
        return await emailService.sendPurchaseOrderEmail(to, data, attachment);
      } else {
        // Send without attachment
        return await this.sendRawEmail(to, subject, html);
      }
    } catch (error) {
      console.error('Failed to send document email:', error);
      throw error;
    }
  }

  /**
   * Send welcome email
   * @param {string} to - Recipient email
   * @param {string} firstName - User's first name
   * @param {string} companyName - Company name (optional)
   * @returns {Promise<object>}
   */
  async sendWelcomeEmail(to, firstName, companyName) {
    const html = emailTemplateService.getWelcomeEmailTemplate({ firstName, companyName });
    const subject = `🎉 Welcome to ${companyName || 'WarehousePro'}`;
    return await this.sendRawEmail(to, subject, html);
  }

  /**
   * Send OTP email
   * @param {string} to - Recipient email
   * @param {string} otp - One-time password
   * @param {string} firstName - User's first name (optional)
   * @param {string} type - Type of OTP: 'login' or 'reset' (default: 'login')
   * @returns {Promise<object>}
   */
  async sendOTPEmail(to, otp, firstName = '', type = 'login') {
    const html = emailTemplateService.getOTPEmailTemplate({ otp, firstName, type });
    return await emailService.sendOTPEmail(to, otp, firstName, type);
  }

  /**
   * Send notification email
   * @param {string} to - Recipient email
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {string} recipientName - Recipient name
   * @param {string} actionUrl - Action URL (optional)
   * @param {string} actionText - Action button text (optional)
   * @returns {Promise<object>}
   */
  async sendNotificationEmail(to, title, message, recipientName, actionUrl = null, actionText = 'View Details') {
    const html = emailTemplateService.getNotificationEmailTemplate({
      title,
      message,
      recipientName,
      actionUrl,
      actionText
    });
    return await this.sendRawEmail(to, title, html);
  }

  /**
   * Send purchase order email specifically
   * @param {string} to - Recipient email
   * @param {object} orderData - Purchase order data
   * @param {Buffer} pdfBuffer - PDF attachment buffer
   * @returns {Promise<object>}
   */
  async sendPurchaseOrderEmail(to, orderData, pdfBuffer) {
    return await this.sendDocumentEmail(to, {
      documentType: 'Purchase Order',
      documentNumber: orderData.orderNumber,
      recipientName: orderData.supplierName,
      companyName: orderData.companyName,
      companyLogo: orderData.companyLogo,
      companyEmail: orderData.companyEmail,
      companyPhone: orderData.companyPhone,
      orderDate: orderData.orderDate,
      expectedDate: orderData.expectedDeliveryDate,
      grandTotal: orderData.grandTotal
    }, pdfBuffer);
  }

  /**
   * Send invoice email
   * @param {string} to - Recipient email
   * @param {object} invoiceData - Invoice data
   * @param {Buffer} pdfBuffer - PDF attachment buffer
   * @returns {Promise<object>}
   */
  async sendInvoiceEmail(to, invoiceData, pdfBuffer) {
    return await this.sendDocumentEmail(to, {
      documentType: 'Invoice',
      documentNumber: invoiceData.invoiceNumber,
      recipientName: invoiceData.customerName,
      companyName: invoiceData.companyName,
      companyLogo: invoiceData.companyLogo,
      companyEmail: invoiceData.companyEmail,
      companyPhone: invoiceData.companyPhone,
      orderDate: invoiceData.invoiceDate,
      expectedDate: invoiceData.dueDate,
      grandTotal: invoiceData.grandTotal
    }, pdfBuffer);
  }

  /**
   * Send quotation email
   * @param {string} to - Recipient email
   * @param {object} quotationData - Quotation data
   * @param {Buffer} pdfBuffer - PDF attachment buffer
   * @returns {Promise<object>}
   */
  async sendQuotationEmail(to, quotationData, pdfBuffer) {
    return await this.sendDocumentEmail(to, {
      documentType: 'Quotation',
      documentNumber: quotationData.quotationNumber,
      recipientName: quotationData.customerName,
      companyName: quotationData.companyName,
      companyLogo: quotationData.companyLogo,
      companyEmail: quotationData.companyEmail,
      companyPhone: quotationData.companyPhone,
      orderDate: quotationData.quotationDate,
      expectedDate: quotationData.validUntil,
      grandTotal: quotationData.grandTotal
    }, pdfBuffer);
  }

  /**
   * Send raw email with custom HTML
   * @param {string} to - Recipient email
   * @param {string} subject - Email subject
   * @param {string} html - Email HTML content
   * @param {string} text - Plain text content (optional)
   * @param {Array} attachments - Email attachments (optional)
   * @returns {Promise<object>}
   */
  async sendRawEmail(to, subject, html, text = null, attachments = null) {
    const { getEmailFrom } = require('../utils/emailConfig');
    const { sendMail, isEmailConfigured } = require('../utils/mailTransport');

    if (!isEmailConfigured()) {
      console.error('Email credentials not configured');
      throw new Error('Email service not configured properly');
    }

    const from = getEmailFrom();

    const mailOptions = {
      from: from.fromHeader || `"${process.env.COMPANY_NAME || 'WarehousePro'}" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
      text
    };

    if (attachments && attachments.length > 0) {
      mailOptions.attachments = attachments;
    }

    try {
      const info = await sendMail(mailOptions);
      console.log('✅ Email sent:', info.messageId, '→', to);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Email send failed:', error);
      throw error;
    }
  }
}

const emailSenderService = new EmailSenderService();
module.exports = emailSenderService;
