/**
 * App Store billing helpers and verification paths.
 * Run: node tests/apple-app-store-billing.test.js
 */
const {
  mapProduct,
  verifyAppleSubscription,
  hasAppleApiCredentials,
  normalizeAppleTimestamp,
  extractExpiresMs,
  extractPurchaseMs,
  chooseAuthoritativeTransactionPayload,
} = require('../utils/appleAppStoreBilling');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

async function run() {
  const mapped = mapProduct('erp_pos_monthly');
  assert(mapped?.productTier === 'erp_pos', 'maps erp_pos_monthly tier');
  assert(mapped?.billingCycle === 'monthly', 'maps erp_pos_monthly cycle');
  assert(mapProduct('unknown_sku') === null, 'unknown product returns null');

  const purchaseMs = Date.UTC(2026, 9, 9, 9, 22, 45);
  const oneDayLaterMs = purchaseMs + 86400000;
  const oneMonthLaterMs = purchaseMs + 30 * 86400000;

  assert(
    normalizeAppleTimestamp(String(purchaseMs)) === purchaseMs,
    'normalize keeps millisecond timestamps'
  );
  assert(
    normalizeAppleTimestamp(Math.floor(purchaseMs / 1000)) === purchaseMs,
    'normalize converts second timestamps to ms'
  );

  const shortTxn = {
    productId: 'erp_pos_monthly',
    purchaseDate: String(purchaseMs),
    expiresDate: String(oneDayLaterMs),
  };
  const longTxn = {
    productId: 'erp_pos_monthly',
    purchaseDate: String(purchaseMs),
    expiresDate: String(oneMonthLaterMs),
  };

  const chosen = chooseAuthoritativeTransactionPayload(
    shortTxn,
    [longTxn],
    'erp_pos_monthly'
  );
  assert(
    extractExpiresMs(chosen) === oneMonthLaterMs,
    'chooseAuthoritativeTransactionPayload prefers latest Apple expiry'
  );
  assert(
    extractPurchaseMs(chosen) === purchaseMs,
    'purchaseDate preserved from chosen payload'
  );

  const mixedUnits = {
    productId: 'erp_pos_monthly',
    purchaseDate: String(purchaseMs),
    expires_date: String(Math.floor(oneMonthLaterMs / 1000)),
  };
  assert(
    extractExpiresMs(mixedUnits) === oneMonthLaterMs,
    'extractExpiresMs reads expires_date seconds field'
  );

  const prevTrust = process.env.APPLE_IAP_TRUST_CLIENT_JWS;
  process.env.APPLE_IAP_TRUST_CLIENT_JWS = 'true';
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      productId: 'pos_yearly',
      transactionId: '1000000123456789',
      originalTransactionId: '1000000123456789',
      bundleId: 'com.bisonstechs.app',
      expiresDate: String(Date.now() + 86400000),
      purchaseDate: String(Date.now()),
    })
  ).toString('base64url');
  const jws = `${header}.${payload}.sig`;

  const verified = await verifyAppleSubscription({
    productId: 'pos_yearly',
    serverVerificationData: jws,
    bundleId: 'com.bisonstechs.app',
  });
  assert(verified.productTier === 'pos', 'JWS fallback verifies pos_yearly');
  assert(verified.billingCycle === 'yearly', 'JWS fallback billing cycle');

  if (prevTrust === undefined) delete process.env.APPLE_IAP_TRUST_CLIENT_JWS;
  else process.env.APPLE_IAP_TRUST_CLIENT_JWS = prevTrust;

  console.log(
    `Note: hasAppleApiCredentials=${hasAppleApiCredentials()} (live Apple API tests require Railway/local APPLE_* env)`
  );
  console.log('All apple-app-store-billing checks passed.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
