/**
 * Own notification pipeline: PostgreSQL inbox + live SSE to connected clients.
 * Replaces OneSignal — no external push vendor required.
 */
const prisma = require('../prisma/client');
const notificationHub = require('./notificationHub');

function buildExternalId(mongoUserId) {
  const env = (process.env.NOTIFICATION_ENV || process.env.ONESIGNAL_ENV || 'dev').trim();
  return `${env}:${String(mongoUserId).trim()}`;
}

async function sendToUser({
  mongoUserId,
  title,
  message,
  data = {},
  type = 'info',
  category = 'System',
  collapseId, // kept for API compatibility; ignored for now
}) {
  const userId = String(mongoUserId || '').trim();
  if (!userId) throw new Error('userId is required');

  const notification = await prisma.notification.create({
    data: {
      userId,
      title: title || 'Notification',
      message: message || '',
      type,
      category,
      data: data || {},
    },
  });

  const liveClients = notificationHub.publish(userId, {
    event: 'notification',
    notification: {
      id: notification.id,
      userId: notification.userId,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      category: notification.category,
      data: notification.data,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
    },
  });

  return {
    id: notification.id,
    stored: true,
    liveClients,
    deliveredLive: liveClients > 0,
  };
}

async function sendToUsers(userIds, payload) {
  const ids = [...new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const results = await Promise.all(
    ids.map((mongoUserId) =>
      sendToUser({ mongoUserId, ...payload }).catch((err) => ({
        userId: mongoUserId,
        error: err.message,
      }))
    )
  );
  return results;
}

module.exports = {
  sendToUser,
  sendToUsers,
  buildExternalId,
};
