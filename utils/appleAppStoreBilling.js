const jwt = require('jsonwebtoken');
const axios = require('axios');

const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.bisonstechs.app';

const PRODUCT_MAP = {
  pos_monthly: { productTier: 'pos', billingCycle: 'monthly', licensedUsers: 1, licensedBranches: 1 },
  pos_yearly: { productTier: 'pos', billingCycle: 'yearly', licensedUsers: 1, licensedBranches: 1 },
  erp_pos_monthly: { productTier: 'erp_pos', billingCycle: 'monthly', licensedUsers: 1, licensedBranches: 1 },
  erp_pos_yearly: { productTier: 'erp_pos', billingCycle: 'yearly', licensedUsers: 1, licensedBranches: 1 },
};

const PRODUCTION_API = 'https://api.storekit.itunes.apple.com';
const SANDBOX_API = 'https://api.storekit-sandbox.itunes.apple.com';

/** Subscription statuses that still grant access (App Store Server API). */
const ACTIVE_SUBSCRIPTION_STATUSES = new Set([1, 3, 4]); // active, billing retry, grace period

function mapProduct(productId) {
  return PRODUCT_MAP[productId] || null;
}

function loadApplePrivateKey() {
  const raw = process.env.APPLE_PRIVATE_KEY;
  if (raw && raw.trim()) {
    return raw.replace(/\\n/g, '\n').trim();
  }
  return null;
}

function hasAppleApiCredentials() {
  return Boolean(
    process.env.APPLE_KEY_ID &&
      process.env.APPLE_ISSUER_ID &&
      loadApplePrivateKey()
  );
}

function createAppStoreApiToken(bundleId = APPLE_BUNDLE_ID) {
  const keyId = process.env.APPLE_KEY_ID;
  const issuerId = process.env.APPLE_ISSUER_ID;
  const privateKey = loadApplePrivateKey();
  if (!keyId || !issuerId || !privateKey) {
    const err = new Error(
      'App Store billing is not configured. Set APPLE_KEY_ID, APPLE_ISSUER_ID, and APPLE_PRIVATE_KEY.'
    );
    err.statusCode = 503;
    throw err;
  }

  return jwt.sign(
    { bid: bundleId },
    privateKey,
    {
      algorithm: 'ES256',
      keyid: keyId,
      issuer: issuerId,
      audience: 'appstoreconnect-v1',
      expiresIn: '20m',
      header: { alg: 'ES256', kid: keyId, typ: 'JWT' },
    }
  );
}

function decodeJwsPayload(jws) {
  if (!jws || typeof jws !== 'string') return null;
  const parts = jws.split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    try {
      const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
      const json = Buffer.from(padded, 'base64').toString('utf8');
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }
}

/**
 * Apple StoreKit timestamps are milliseconds; legacy fields may be seconds (~1e9).
 */
function normalizeAppleTimestamp(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1_000_000_000_000) return n * 1000;
  return n;
}

function extractExpiresMs(payload) {
  if (!payload) return 0;
  const fields = [
    payload.expiresDate,
    payload.expires_date_ms,
    payload.expires_date,
  ];
  for (const raw of fields) {
    const ms = normalizeAppleTimestamp(raw);
    if (ms) return ms;
  }
  return 0;
}

function extractPurchaseMs(payload) {
  if (!payload) return null;
  const fields = [
    payload.purchaseDate,
    payload.purchase_date_ms,
    payload.purchase_date,
    payload.originalPurchaseDate,
    payload.original_purchase_date_ms,
  ];
  for (const raw of fields) {
    const ms = normalizeAppleTimestamp(raw);
    if (ms) return ms;
  }
  return null;
}

function payloadProductId(payload) {
  return payload?.productId || payload?.product_id || null;
}

/**
 * Pick the transaction payload with the latest expiry for the expected product.
 * Used when Get Transaction Info and Get All Subscription Statuses disagree.
 */
function chooseAuthoritativeTransactionPayload(
  primaryPayload,
  additionalPayloads,
  expectedProductId
) {
  const candidates = [primaryPayload, ...(additionalPayloads || [])].filter(Boolean);
  let best = null;
  let bestExpires = 0;

  for (const p of candidates) {
    const pid = payloadProductId(p);
    if (expectedProductId && pid && pid !== expectedProductId) continue;
    const expires = extractExpiresMs(p);
    if (!expires) continue;
    if (!best || expires > bestExpires) {
      best = p;
      bestExpires = expires;
    }
  }

  return best || primaryPayload;
}

async function appleApiGet(path, bundleId = APPLE_BUNDLE_ID) {
  const token = createAppStoreApiToken(bundleId);
  const headers = { Authorization: `Bearer ${token}` };

  const tryHost = async (host) => {
    const { data, status } = await axios.get(`${host}${path}`, {
      headers,
      validateStatus: () => true,
    });
    return { data, status, host };
  };

  let result = await tryHost(PRODUCTION_API);
  if (result.status === 404 || result.status === 401) {
    const sandbox = await tryHost(SANDBOX_API);
    if (sandbox.status >= 200 && sandbox.status < 300) {
      result = sandbox;
    }
  }

  if (result.status < 200 || result.status >= 300) {
    const err = new Error(
      result.data?.errorMessage ||
        `Apple API request failed (${result.status}).`
    );
    err.statusCode = result.status === 404 ? 400 : 502;
    throw err;
  }

  return result.data;
}

async function fetchTransactionInfo(transactionId, bundleId = APPLE_BUNDLE_ID) {
  const path = `/inApps/v1/transactions/${encodeURIComponent(transactionId)}`;
  const data = await appleApiGet(path, bundleId);
  const payload = decodeJwsPayload(data.signedTransactionInfo);
  if (!payload) {
    const err = new Error('Invalid signed transaction from Apple.');
    err.statusCode = 502;
    throw err;
  }
  return payload;
}

/**
 * Latest subscription-period transactions from Get All Subscription Statuses.
 * @see https://developer.apple.com/documentation/appstoreserverapi/get_all_subscription_statuses
 */
async function fetchSubscriptionStatusPayloads(anyTransactionId, bundleId = APPLE_BUNDLE_ID) {
  const query = '?status=1&status=3&status=4';
  const path =
    `/inApps/v1/subscriptions/${encodeURIComponent(anyTransactionId)}${query}`;
  const data = await appleApiGet(path, bundleId);
  const groups = Array.isArray(data?.data) ? data.data : [];
  const payloads = [];

  for (const group of groups) {
    const items = Array.isArray(group?.lastTransactions) ? group.lastTransactions : [];
    for (const item of items) {
      const status = item?.status;
      if (status != null && !ACTIVE_SUBSCRIPTION_STATUSES.has(Number(status))) {
        continue;
      }
      const decoded = decodeJwsPayload(item?.signedTransactionInfo);
      if (decoded) payloads.push(decoded);
    }
  }

  return payloads;
}

function assertActiveSubscription(payload, expectedProductId, bundleId) {
  const productId = payloadProductId(payload);
  const expiresMs = extractExpiresMs(payload);
  const purchaseMs = extractPurchaseMs(payload);
  const revocationDate = payload.revocationDate || payload.revocation_date;

  if (bundleId && payload.bundleId && payload.bundleId !== bundleId) {
    const err = new Error('Apple bundle id does not match this app.');
    err.statusCode = 400;
    throw err;
  }

  if (expectedProductId && productId && expectedProductId !== productId) {
    const err = new Error('App Store product does not match the purchase.');
    err.statusCode = 400;
    throw err;
  }

  if (revocationDate) {
    const err = new Error('This App Store purchase was revoked or refunded.');
    err.statusCode = 400;
    throw err;
  }

  if (expiresMs && expiresMs < Date.now()) {
    const err = new Error('This App Store subscription has expired.');
    err.statusCode = 400;
    throw err;
  }

  const mapped = mapProduct(productId);
  if (!mapped) {
    const err = new Error(`Unknown App Store product: ${productId}`);
    err.statusCode = 400;
    throw err;
  }

  return {
    productId,
    transactionId: String(payload.transactionId || payload.transaction_id || ''),
    originalTransactionId: String(
      payload.originalTransactionId || payload.original_transaction_id || ''
    ),
    expiry: expiresMs ? new Date(expiresMs) : null,
    startTime: purchaseMs ? new Date(purchaseMs) : new Date(),
    raw: payload,
    ...mapped,
  };
}

async function resolvePayloadViaAppStoreApi(transactionId, productId, bundleId) {
  const txnPayload = await fetchTransactionInfo(transactionId, bundleId);
  const lookupId =
    txnPayload.originalTransactionId ||
    txnPayload.original_transaction_id ||
    transactionId;

  let statusPayloads = [];
  try {
    statusPayloads = await fetchSubscriptionStatusPayloads(lookupId, bundleId);
  } catch (err) {
    if (err.statusCode !== 400 && err.statusCode !== 404) {
      throw err;
    }
  }

  return chooseAuthoritativeTransactionPayload(
    txnPayload,
    statusPayloads,
    productId
  );
}

/**
 * Verify an App Store subscription purchase.
 * Prefers App Store Server API; falls back to decoding client JWS when API
 * credentials are missing only if APPLE_IAP_TRUST_CLIENT_JWS=true (dev).
 */
async function verifyAppleSubscription({
  transactionId,
  productId,
  serverVerificationData,
  bundleId = APPLE_BUNDLE_ID,
}) {
  let payload = null;

  if (hasAppleApiCredentials() && transactionId) {
    payload = await resolvePayloadViaAppStoreApi(transactionId, productId, bundleId);
  } else if (
    process.env.APPLE_IAP_TRUST_CLIENT_JWS === 'true' &&
    serverVerificationData
  ) {
    payload = decodeJwsPayload(serverVerificationData);
    if (!payload) {
      const err = new Error('Could not decode App Store transaction data.');
      err.statusCode = 400;
      throw err;
    }
  } else if (!hasAppleApiCredentials()) {
    const err = new Error(
      'App Store billing is not configured on the server. Add APPLE_KEY_ID, APPLE_ISSUER_ID, and APPLE_PRIVATE_KEY.'
    );
    err.statusCode = 503;
    throw err;
  } else if (serverVerificationData) {
    payload = decodeJwsPayload(serverVerificationData);
    const tid = payload?.transactionId || payload?.transaction_id;
    if (tid) {
      payload = await resolvePayloadViaAppStoreApi(String(tid), productId, bundleId);
    }
  }

  if (!payload) {
    const err = new Error('transactionId or serverVerificationData is required.');
    err.statusCode = 400;
    throw err;
  }

  return assertActiveSubscription(payload, productId, bundleId);
}

module.exports = {
  APPLE_BUNDLE_ID,
  mapProduct,
  verifyAppleSubscription,
  hasAppleApiCredentials,
  normalizeAppleTimestamp,
  extractExpiresMs,
  extractPurchaseMs,
  chooseAuthoritativeTransactionPayload,
};
