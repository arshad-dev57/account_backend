const axios = require("axios");
const prisma = require('../prisma/client');

function buildExternalId(mongoUserId) {
  const env = (process.env.ONESIGNAL_ENV || "dev").trim();
  return `${env}:${String(mongoUserId).trim()}`;
}

async function sendToUser({ mongoUserId, subscriptionId, title, message, data = {}, collapseId, type = 'info', category = 'System' }) {
  const externalId = buildExternalId(mongoUserId);

  console.log('🔔 [OneSignal] ==================== SEND NOTIFICATION START ====================');
  console.log('🔔 [OneSignal] MongoDB User ID:', mongoUserId);
  console.log('🔔 [OneSignal] Subscription ID:', subscriptionId);
  console.log('🔔 [OneSignal] External ID:', externalId);
  console.log('🔔 [OneSignal] Title:', title);
  console.log('🔔 [OneSignal] Message:', message);
  console.log('🔔 [OneSignal] Data:', JSON.stringify(data));
  console.log('🔔 [OneSignal] Collapse ID:', collapseId);
  console.log('🔔 [OneSignal] OneSignal App ID:', process.env.ONESIGNAL_APP_ID ? 'Set' : 'NOT SET');

  // Store notification in database
  try {
    console.log('🔔 [OneSignal] Storing notification in database...');
    await prisma.notification.create({
      data: {
        userId: mongoUserId,
        title,
        message,
        type,
        category,
        data
      }
    });
    console.log('🔔 [OneSignal] Notification stored in database successfully');
  } catch (dbError) {
    console.error('⚠️ [OneSignal] Failed to store notification in database:', dbError.message);
    // Don't block notification sending if database storage fails
  }

  const payload = {
    app_id: process.env.ONESIGNAL_APP_ID,
    headings: { en: title || "Templink" },
    contents: { en: message || "" },
    data,
    ...(collapseId ? { collapse_id: collapseId } : {})
  };
  
  if (subscriptionId) {
    payload.include_subscription_ids = [subscriptionId];
    console.log('🔔 [OneSignal] Using subscription ID targeting');
  } else {
    payload.target_channel = "push";
    payload.include_aliases = { external_id: [externalId] };
    console.log('🔔 [OneSignal] Using external ID targeting');
  }

  console.log('🔔 [OneSignal] Payload:', JSON.stringify(payload, null, 2));

  try {
    console.log('🔔 [OneSignal] Sending request to OneSignal API...');
    const res = await axios.post(
      "https://api.onesignal.com/notifications?c=push",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${process.env.ONESIGNAL_REST_API_KEY}`
        },
        timeout: 15000
      }
    );

    console.log('🔔 [OneSignal] Response Status:', res.status);
    console.log('🔔 [OneSignal] Response Data:', JSON.stringify(res.data, null, 2));
    console.log('🔔 [OneSignal] ==================== SEND NOTIFICATION SUCCESS ====================');

    return res.data;
  } catch (error) {
    console.error('❌ [OneSignal] Error sending notification:');
    console.error('❌ [OneSignal] Error Message:', error.message);
    if (error.response) {
      console.error('❌ [OneSignal] Response Status:', error.response.status);
      console.error('❌ [OneSignal] Response Data:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('❌ [OneSignal] ==================== SEND NOTIFICATION FAILED ====================');
    throw error;
  }
}

module.exports = { sendToUser, buildExternalId };