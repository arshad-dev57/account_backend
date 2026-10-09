/**
 * Lightweight checks for App Store product mapping and JWS payload decode.
 * Run: node tests/apple-app-store-billing.test.js
 */
const {
  mapProduct,
  verifyAppleSubscription,
  hasAppleApiCredentials,
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

  console.log(
    `Note: hasAppleApiCredentials=${hasAppleApiCredentials()} (set APPLE_KEY_* on Railway for production)`
  );
  console.log('All apple-app-store-billing checks passed.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
