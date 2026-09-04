/**
 * OneSignal push — Flutter logs in with external_id `dev:<userId>`.
 * Inbox is still stored in Postgres; this only delivers the device push.
 */
const axios = require('axios');

function buildExternalId(mongoUserId) {
  const env = (process.env.ONESIGNAL_ENV || process.env.NOTIFICATION_ENV || 'dev').trim();
  return `${env}:${String(mongoUserId).trim()}`;
}

async function sendPushToUser({
  mongoUserId,
  subscriptionId,
  title,
  message,
  data = {},
  collapseId,
}) {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    throw new Error('ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY not set');
  }

  const externalId = buildExternalId(mongoUserId);
  const payload = {
    app_id: appId,
    headings: { en: title || 'BisonsTechs' },
    contents: { en: message || '' },
    data,
    ...(collapseId ? { collapse_id: collapseId } : {}),
  };

  if (subscriptionId) {
    payload.include_subscription_ids = [subscriptionId];
  } else {
    payload.target_channel = 'push';
    payload.include_aliases = { external_id: [externalId] };
  }

  const res = await axios.post(
    'https://api.onesignal.com/notifications?c=push',
    payload,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${apiKey}`,
      },
      timeout: 15000,
    }
  );
  return res.data;
}

module.exports = {
  sendPushToUser,
  sendToUser: sendPushToUser,
  buildExternalId,
};
