const express = require('express');
const router = express.Router();
const {
  createNotification,
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  streamNotifications,
  sendNotification,
} = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

// Live SSE stream (must be registered before param routes)
router.get('/stream', streamNotifications);

router.get('/', getUserNotifications);
router.get('/unread-count', getUnreadCount);
router.post('/', createNotification);
router.post('/send', sendNotification);
router.put('/mark-all-read', markAllAsRead);
router.put('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);

module.exports = router;
