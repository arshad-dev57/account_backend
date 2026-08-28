// controllers/notificationController.js

const prisma = require('../prisma/client');


const createNotification = async (req, res) => {
  try {
    const { userId, title, message, type, category, data } = req.body;

    if (!userId || !title || !message) {
      return res.status(400).json({
        success: false,
        message: 'userId, title, and message are required'
      });
    }

    const notification = await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type: type || 'info',
        category: category || 'System',
        data: data || {}
      }
    });

    res.status(201).json({
      success: true,
      data: notification,
      message: 'Notification created successfully'
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { unreadOnly = false, limit = 50, offset = 0 } = req.query;

    const where = {
      userId
    };

    if (unreadOnly === 'true') {
      where.isRead = false;
    }

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    const totalCount = await prisma.notification.count({ where });
    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false }
    });

    res.status(200).json({
      success: true,
      data: notifications,
      meta: {
        total: totalCount,
        unread: unreadCount,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    console.error('Error getting notifications:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Mark Notification as Read ─────────────────────────────────

const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await prisma.notification.updateMany({
      where: {
        id,
        userId
      },
      data: {
        isRead: true,
        readAt: new Date()
      }
    });

    if (notification.count === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Mark All Notifications as Read ────────────────────────────

const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    await prisma.notification.updateMany({
      where: {
        userId,
        isRead: false
      },
      data: {
        isRead: true,
        readAt: new Date()
      }
    });

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await prisma.notification.deleteMany({
      where: {
        id,
        userId
      }
    });

    if (notification.count === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const count = await prisma.notification.count({
      where: {
        userId,
        isRead: false
      }
    });

    res.status(200).json({
      success: true,
      data: { count }
    });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createNotification,
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount
};
