const prisma = require('../prisma/client');
const emailService = require('../services/emailService');

function parseEmails(value) {
  return String(value || '')
    .split(',')
    .map((email) => email.trim().replace(/^"|"$/g, ''))
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function feedbackInbox() {
  const inbox = parseEmails(process.env.FEEDBACK_INBOX);
  if (inbox.length) return inbox;
  const owners = parseEmails(process.env.PLATFORM_OWNER_EMAILS);
  if (owners.length) return owners;
  const replyTo = parseEmails(process.env.EMAIL_REPLY_TO);
  if (replyTo.length) return replyTo;
  return ['support@bisonstechs.com'];
}

async function nextFeedbackTicketNumber() {
  return `FB-${Date.now()}`;
}

exports.submitFeedback = async (req, res) => {
  try {
    const rating = Number(req.body.rating);
    const feedback = String(req.body.feedback || '').trim();
    const suggestion = String(req.body.suggestion || '').trim();
    const anonymous = Boolean(req.body.anonymous);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Please rate your experience',
      });
    }

    if (!feedback && !suggestion) {
      return res.status(400).json({
        success: false,
        message: 'Please provide some feedback',
      });
    }

    const description = [
      `Rating: ${rating}/5`,
      `Anonymous: ${anonymous ? 'yes' : 'no'}`,
      '',
      'What they like:',
      feedback || '(none)',
      '',
      'Suggestions:',
      suggestion || '(none)',
    ].join('\n');

    const ticketNumber = await nextFeedbackTicketNumber();
    await prisma.supportTicket.create({
      data: {
        ticketNumber,
        title: `App feedback — ${rating}/5${anonymous ? ' (anonymous)' : ''}`,
        description,
        category: 'Feedback',
        priority: rating <= 2 ? 'High' : 'Low',
        status: 'Open',
        module: 'app',
        userId: req.user.id,
        companyId: req.user.companyId || null,
      },
    });

    try {
      const fromName = anonymous
        ? 'Anonymous'
        : `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
      await emailService.sendFeedbackNotification({
        to: feedbackInbox(),
        rating,
        feedback,
        suggestion,
        fromName,
        fromEmail: anonymous ? '' : req.user.email,
        anonymous,
      });
    } catch (emailError) {
      console.error('⚠️ [feedback] Email failed (saved anyway):', emailError.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Your feedback has been submitted',
    });
  } catch (error) {
    console.error('❌ [feedback] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit feedback. Please try again.',
    });
  }
};
