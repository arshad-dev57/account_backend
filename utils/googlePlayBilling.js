const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

const PLAY_PACKAGE_NAME = process.env.PLAY_PACKAGE_NAME || 'com.bisonstechs.app';

const PRODUCT_MAP = {
  pos_monthly: { productTier: 'pos', billingCycle: 'monthly', licensedUsers: 1, licensedBranches: 1 },
  pos_yearly: { productTier: 'pos', billingCycle: 'yearly', licensedUsers: 1, licensedBranches: 1 },
  erp_pos_monthly: { productTier: 'erp_pos', billingCycle: 'monthly', licensedUsers: 1, licensedBranches: 1 },
  erp_pos_yearly: { productTier: 'erp_pos', billingCycle: 'yearly', licensedUsers: 1, licensedBranches: 1 },
};

const ACTIVE_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED',
]);

function loadServiceAccount() {
  const file = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE;
  if (file && fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) {
    return JSON.parse(raw);
  }
  return null;
}

function mapProduct(productId) {
  return PRODUCT_MAP[productId] || null;
}

async function verifyGooglePlaySubscription({
  purchaseToken,
  productId,
  packageName = PLAY_PACKAGE_NAME,
}) {
  const credentials = loadServiceAccount();
  if (!credentials) {
    const err = new Error(
      'Google Play billing is not configured on the server. Add GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.'
    );
    err.statusCode = 503;
    throw err;
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const client = await auth.getClient();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;

  const { data } = await client.request({ url });
  const state = data.subscriptionState;
  if (!ACTIVE_STATES.has(state)) {
    const err = new Error(`Google Play subscription is not active (${state || 'unknown'}).`);
    err.statusCode = 400;
    throw err;
  }

  const line = Array.isArray(data.lineItems) ? data.lineItems[0] : null;
  const playProductId = line?.productId || productId;
  if (productId && playProductId && productId !== playProductId) {
    const err = new Error('Play product does not match the purchase token.');
    err.statusCode = 400;
    throw err;
  }

  const mapped = mapProduct(playProductId);
  if (!mapped) {
    const err = new Error(`Unknown Play product: ${playProductId}`);
    err.statusCode = 400;
    throw err;
  }

  const expiry = line?.expiryTime ? new Date(line.expiryTime) : null;
  return {
    productId: playProductId,
    expiry,
    startTime: data.startTime ? new Date(data.startTime) : new Date(),
    raw: data,
    ...mapped,
  };
}

module.exports = {
  PLAY_PACKAGE_NAME,
  mapProduct,
  verifyGooglePlaySubscription,
};
