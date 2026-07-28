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

// Define routes
router.post('/send', sendEmail);

module.exports = router;
