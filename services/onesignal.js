/**
 * @deprecated Use services/notificationService.js — OneSignal removed.
 * Kept so older imports keep working during migration.
 */
const notificationService = require('./notificationService');

module.exports = {
  sendToUser: notificationService.sendToUser,
  buildExternalId: notificationService.buildExternalId,
};
