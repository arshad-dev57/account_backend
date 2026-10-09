#!/usr/bin/env node
/**
 * Read-only: compare DB subscription dates with Apple Server API.
 * Usage: node scripts/compare-apple-subscription.js
 * Requires APPLE_KEY_ID, APPLE_ISSUER_ID, APPLE_PRIVATE_KEY (e.g. railway run).
 * Does not print full transaction IDs, JWS, or secrets.
 */
require('dotenv').config();
const prisma = require('../prisma/client');
const {
  hasAppleApiCredentials,
  verifyAppleSubscription,
  extractExpiresMs,
  extractPurchaseMs,
} = require('../utils/appleAppStoreBilling');

function mask(id) {
  const s = String(id || '');
  return s.length <= 4 ? '****' : '*'.repeat(s.length - 4) + s.slice(-4);
}
function iso(d) {
  return d ? new Date(d).toISOString() : null;
}
function hours(a, b) {
  return ((new Date(b) - new Date(a)) / 3600000).toFixed(2);
}

(async () => {
  if (!hasAppleApiCredentials()) {
    console.error('Missing APPLE_KEY_ID / APPLE_ISSUER_ID / APPLE_PRIVATE_KEY');
    process.exit(2);
  }

  const row = await prisma.subscription.findFirst({
    where: { paymentMethod: 'apple_app_store' },
    orderBy: { createdAt: 'desc' },
    select: {
      transactionId: true,
      paymentDetails: true,
      startDate: true,
      endDate: true,
    },
  });

  if (!row) {
    console.error('No apple_app_store subscription found');
    process.exit(1);
  }

  const pd = row.paymentDetails || {};
  const transactionId = String(pd.transactionId || row.transactionId || '');
  const productId = pd.productId || 'erp_pos_monthly';

  const verified = await verifyAppleSubscription({
    transactionId,
    productId,
    bundleId: process.env.APPLE_BUNDLE_ID || 'com.bisonstechs.app',
  });

  const raw = verified.raw || {};
  const appleStart = iso(verified.startTime);
  const appleEnd = iso(verified.expiry);

  console.log(
    JSON.stringify(
      {
        transactionIdMasked: mask(transactionId),
        productId: verified.productId,
        environment: raw.environment ?? null,
        applePurchaseDate: appleStart,
        appleExpiresDate: appleEnd,
        applePeriodHours: hours(verified.startTime, verified.expiry),
        dbStart: iso(row.startDate),
        dbEnd: iso(row.endDate),
        dbPeriodHours: hours(row.startDate, row.endDate),
        purchaseMatchesDb: appleStart === iso(row.startDate),
        expiryMatchesDb: appleEnd === iso(row.endDate),
        rawExpiresMs: extractExpiresMs(raw),
        rawPurchaseMs: extractPurchaseMs(raw),
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
