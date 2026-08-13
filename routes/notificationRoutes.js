const express = require('express');
const router = express.Router();
const { sendToUser } = require('../services/onesignal');
const {
  createNotification,
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount
} = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

// Protect all routes except send (which is called from backend)
router.use(protect);

// Get user notifications
router.get('/', getUserNotifications);

// Get unread count
router.get('/unread-count', getUnreadCount);

// Create notification (internal use)
router.post('/', createNotification);

// Mark notification as read
router.put('/:id/read', markAsRead);

// Mark all notifications as read
router.put('/mark-all-read', markAllAsRead);

// Delete notification
router.delete('/:id', deleteNotification);

// Send notification to user (OneSignal - legacy route)
router.post('/send', async (req, res) => {
  try {
    console.log('🔔 [Notification Route] ==================== NOTIFICATION REQUEST START ====================');
    console.log('🔔 [Notification Route] Request body:', JSON.stringify(req.body, null, 2));

    const { userId, subscriptionId, title, message, data } = req.body;

    if (!userId) {
      console.error('❌ [Notification Route] Missing userId in request');
      return res.status(400).json({
        success: false,
        message: 'userId is required'
      });
    }

    console.log('🔔 [Notification Route] Calling OneSignal service...');
    const result = await sendToUser({
      mongoUserId: userId,
      subscriptionId: subscriptionId,
      title: title || 'Notification',
      message: message || '',
      data: data || {}
    });

    console.log('🔔 [Notification Route] OneSignal result:', JSON.stringify(result, null, 2));
    console.log('🔔 [Notification Route] ==================== NOTIFICATION REQUEST SUCCESS ====================');

    res.status(200).json({
      success: true,
      result: result,
      message: 'Notification sent successfully'
    });
  } catch (error) {
    console.error('❌ [Notification Route] Error:', error.message);
    console.error('❌ [Notification Route] Error details:', error);
    console.error('❌ [Notification Route] ==================== NOTIFICATION REQUEST FAILED ====================');

    res.status(500).json({
      success: false,
      message: error.message,
      error: error.toString()
    });
  }
});

module.exports = router;
