'use strict';

/**
 * End-to-end check of the company-wise currency and exchange-rate module against
 * the real database: an ISO 4217 master, a base currency that the company always
 * honors, manual rate CRUD with the validations the UI relies on, the audit
 * trail, per-company isolation, RBAC, and the rule that automatic rates only ever
 * come from a configured provider.
 *
 * The provider is deliberately forced to "disabled" for the refresh checks so the
 * suite never depends on the network and still proves that no rate is invented.
 *
 * Run: node tests/currency-live.test.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const prisma = require('../prisma/client');
const app = require('../app');

const STAFF = 'currency-e2e@example.com';
const created = { companyIds: [], userIds: [], currencyIds: [] };
let savedProvider;

const results = [];
function check(name, fn) {
  results.push([name, fn]);
}

let server;
let base;

function request(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const req = http.request(`${base}${url}`, { method, headers, agent: false }, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch {
          json = { raw };
        }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function expectOk(method, url, token, body, label) {
  const res = await request(method, url, token, body);
  if (res.status >= 400) {
    throw new Error(`${label || url} → ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return res.body.data;
}

async function expectStatus(method, url, token, body, status, label) {
  const res = await request(method, url, token, body);
  assert.strictEqual(res.status, status, `${label || url} → ${JSON.stringify(res.body).slice(0, 200)}`);
  return res.body;
}

function sign(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '2h' });
}

async function seed() {
  const company = await prisma.company.create({
    data: { name: 'Currency E2E Co', email: STAFF, isActive: true }
  });
  created.companyIds.push(company.id);

  const mk = async (first, last, email, role) =>
    prisma.user.create({
      data: {
        firstName: first,
        lastName: last,
        email,
        password: await bcrypt.hash('test-password', 10),
        role,
        companyId: company.id,
        isActive: true
      }
    });

  const admin = await mk('Cur', 'Admin', `admin+${STAFF}`, 'admin');
  const clerk = await mk('Cur', 'Clerk', `clerk+${STAFF}`, 'employee');
  created.userIds.push(admin.id, clerk.id);

  return { companyId: company.id, adminToken: sign(admin.id), clerkToken: sign(clerk.id), adminId: admin.id };
}

async function seedSecondCompany() {
  const company = await prisma.company.create({
    data: { name: 'Currency E2E Other', email: `other+${STAFF}`, isActive: true }
  });
  created.companyIds.push(company.id);
  const user = await prisma.user.create({
    data: {
      firstName: 'Other',
      lastName: 'Admin',
      email: `other-admin+${STAFF}`,
      password: await bcrypt.hash('test-password', 10),
      role: 'admin',
      companyId: company.id,
      isActive: true
    }
  });
  created.userIds.push(user.id);
  return { companyId: company.id, token: sign(user.id) };
}

async function run() {
  // Run offline and deterministically: with no provider configured the module
  // must never invent a rate, which is the central guarantee of this feature.
  process.env.FX_PROVIDER = 'none';

  const first = await seed();
  const second = await seedSecondCompany();
  const adminToken = first.adminToken;

  // ── ISO 4217 master ────────────────────────────────────────
  let currencies;
  check('the ISO 4217 master is seeded and well formed', async () => {
    currencies = await expectOk('GET', '/api/currencies', adminToken);
    assert.ok(currencies.length >= 150, `expected a full ISO 4217 master, got ${currencies.length}`);
    const codes = currencies.map((c) => c.code);
    for (const code of ['USD', 'EUR', 'PKR', 'SAR', 'AED', 'GBP', 'JPY', 'INR']) {
      assert.ok(codes.includes(code), `${code} must exist in the master`);
    }
    assert.strictEqual(new Set(codes).size, codes.length, 'currency codes must be unique');
    assert.ok(
      currencies.every((c) => /^[A-Z]{3}$/.test(c.code) && c.name && c.symbol),
      'every seeded currency needs a 3-letter code, a name and a symbol'
    );
    const jpy = currencies.find((c) => c.code === 'JPY');
    assert.strictEqual(jpy.decimalPlaces, 0, 'JPY is a zero-decimal currency');
  });

  check('a currency lookup by id answers and an unknown id 404s', async () => {
    const usd = currencies.find((c) => c.code === 'USD');
    const one = await expectOk('GET', `/api/currencies/${usd.id}`, adminToken);
    assert.strictEqual(one.code, 'USD');
    await expectStatus('GET', '/api/currencies/00000000-0000-0000-0000-000000000000', adminToken, null, 404);
  });

  // ── Base currency is always honored ────────────────────────
  check('the provider reports itself unconfigured rather than guessing', async () => {
    const status = await expectOk('GET', '/api/currencies/provider', adminToken);
    assert.strictEqual(status.configured, false);
    assert.strictEqual(status.provider, 'disabled');
    assert.ok(['open-er-api', 'frankfurter', 'disabled'].includes(status.provider), 'the provider name is one of the supported ones');
  });

  check('the company base currency is stored and always resolved', async () => {
    const sar = currencies.find((c) => c.code === 'SAR');
    const res = await request('PUT', '/api/currencies/base', adminToken, { currencyCode: 'SAR' });
    assert.ok(res.status < 400, `set base → ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    assert.strictEqual(res.body.data.code, 'SAR');
    const again = await expectOk('GET', '/api/currencies/base', adminToken);
    assert.strictEqual(again.code, 'SAR', 'the base currency must survive a re-read');
    const overview = await expectOk('GET', '/api/currencies/overview', adminToken);
    assert.strictEqual(overview.baseCurrency.code, 'SAR');
    assert.strictEqual(overview.currencies[0].code, 'SAR', 'the base is listed first');
    assert.strictEqual(overview.currencies[0].isBase, true);
    assert.strictEqual(overview.currencies[0].rate, null, 'the base is never given a rate row of its own');
    assert.ok(sar.id === res.body.data.id);
    assert.strictEqual(
      await prisma.exchangeRate.count({ where: { companyId: first.companyId } }),
      0,
      'choosing a base with no provider must leave the rate table empty'
    );
    assert.ok(res.body.initialization.missing.length > 0, 'the gaps are reported instead of filled');
  });

  check('an unknown base currency code is rejected, not defaulted', async () => {
    await expectStatus('PUT', '/api/currencies/base', adminToken, { currencyCode: 'ZZZ' }, 400);
    const still = await expectOk('GET', '/api/currencies/base', adminToken);
    assert.strictEqual(still.code, 'SAR', 'a rejected change must leave the base untouched');
  });

  // ── Manual rate CRUD and validation ────────────────────────
  let rateId;

  check('rate writes are validated before they reach the table', async () => {
    const usdRow = currencies.find((c) => c.code === 'USD');
    const sarRow = currencies.find((c) => c.code === 'SAR');

    await expectStatus('POST', '/api/currencies/rates', adminToken, { fromCurrencyId: usdRow.id, toCurrencyId: usdRow.id, rate: 3.75 }, 400, 'same pair');
    await expectStatus('POST', '/api/currencies/rates', adminToken, { fromCurrencyId: usdRow.id, toCurrencyId: sarRow.id, rate: 0 }, 400, 'zero rate');
    await expectStatus('POST', '/api/currencies/rates', adminToken, { fromCurrencyId: usdRow.id, toCurrencyId: sarRow.id, rate: -3 }, 400, 'negative rate');
    await expectStatus('POST', '/api/currencies/rates', adminToken, { fromCurrencyId: usdRow.id, toCurrencyId: sarRow.id, rate: 'abc' }, 400, 'non numeric rate');
    await expectStatus('POST', '/api/currencies/rates', adminToken, { toCurrencyId: sarRow.id, rate: 3.75 }, 400, 'missing pair');
    await expectStatus(
      'POST',
      '/api/currencies/rates',
      adminToken,
      { fromCurrencyId: usdRow.id, toCurrencyId: sarRow.id, rate: 3.75, effectiveDate: '2099-01-01' },
      400,
      'future date'
    );
    assert.strictEqual(await prisma.exchangeRate.count({ where: { companyId: first.companyId } }), 0, 'rejected writes must not persist');
  });

  check('a valid manual rate is stored as MANUAL and read back', async () => {
    const usdRow = currencies.find((c) => c.code === 'USD');
    const gbpRow = currencies.find((c) => c.code === 'GBP');
    rateId = (
      await expectOk(
        'POST',
        '/api/currencies/rates',
        adminToken,
        { fromCurrencyId: usdRow.id, toCurrencyId: gbpRow.id, rate: 0.75, effectiveDate: '2026-01-05', notes: 'e2e manual' },
        'create manual rate'
      )
    ).id;
    const list = await expectOk('GET', '/api/currencies/rates', adminToken);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].source, 'MANUAL');
    assert.strictEqual(list[0].rate, '0.75');
    assert.strictEqual(list[0].fromCurrency.code, 'USD');
    assert.strictEqual(list[0].toCurrency.code, 'GBP');
    assert.strictEqual(list[0].notes, 'e2e manual');
    assert.strictEqual(new Date(list[0].effectiveDate).getUTCFullYear(), 2026);
  });

  check('the same pair on the same date is refused, not duplicated', async () => {
    const usdRow = currencies.find((c) => c.code === 'USD');
    const gbpRow = currencies.find((c) => c.code === 'GBP');
    await expectStatus(
      'POST',
      '/api/currencies/rates',
      adminToken,
      { fromCurrencyId: usdRow.id, toCurrencyId: gbpRow.id, rate: 0.8, effectiveDate: '2026-01-05' },
      409,
      'duplicate pair/date'
    );
    assert.strictEqual(await prisma.exchangeRate.count({ where: { companyId: first.companyId } }), 1);
  });

  // ── Lookup and conversion use only stored rates ────────────
  check('lookup returns the stored rate and respects the as-of date', async () => {
    const usdRow = currencies.find((c) => c.code === 'USD');
    const gbpRow = currencies.find((c) => c.code === 'GBP');
    const found = await expectOk(
      'GET',
      `/api/currencies/rates/lookup?fromCurrencyId=${usdRow.id}&toCurrencyId=${gbpRow.id}&date=2026-06-01`,
      adminToken
    );
    assert.strictEqual(found.rate, '0.75');
    assert.strictEqual(found.isIdentity, false);

    const before = await request(
      'GET',
      `/api/currencies/rates/lookup?fromCurrencyId=${usdRow.id}&toCurrencyId=${gbpRow.id}&date=2025-12-31`,
      adminToken
    );
    assert.strictEqual(before.status, 404, 'a rate dated 2026-01-05 must not apply to 2025');
  });

  check('conversion uses the real rate, the base identity, and never invents one', async () => {
    const converted = await expectOk(
      'GET',
      '/api/currencies/convert?fromCode=USD&toCode=GBP&amount=100',
      adminToken
    );
    assert.strictEqual(converted.via, 'DIRECT');
    assert.strictEqual(converted.rate, 0.75);
    assert.strictEqual(converted.amount, 75);

    const identity = await expectOk('GET', '/api/currencies/convert?fromCode=SAR&toCode=SAR&amount=250', adminToken);
    assert.strictEqual(identity.via, 'IDENTITY');
    assert.strictEqual(identity.rate, 1);
    assert.strictEqual(identity.amount, 250);

    const none = await request('GET', '/api/currencies/convert?fromCode=ALL&toCode=MGA&amount=100', adminToken);
    assert.strictEqual(none.status, 404, 'an unconfigurable pair must fail rather than return 1');
    assert.strictEqual(none.body.code, 'EXCHANGE_RATE_REQUIRED');
  });

  // ── Audit trail ────────────────────────────────────────────
  check('editing a rate records old and new values with the changing user', async () => {
    const updated = await expectOk('PUT', `/api/currencies/rates/${rateId}`, adminToken, { rate: 0.8 });
    assert.strictEqual(updated.rate, '0.8');

    const history = await expectOk('GET', `/api/currencies/rates/${rateId}/history`, adminToken);
    const actions = history.map((h) => h.action);
    assert.ok(actions.includes('CREATE'), 'creating a rate is audited');
    assert.ok(actions.includes('UPDATE'), 'editing a rate is audited');
    const edit = history.find((h) => h.action === 'UPDATE');
    assert.strictEqual(String(edit.oldRate), '0.75');
    assert.strictEqual(String(edit.newRate), '0.8');
    assert.strictEqual(edit.changedBy, first.adminId, 'the audit entry names the user who changed it');
  });

  check('the currency pair of an existing rate cannot be rewritten', async () => {
    const eurRow = currencies.find((c) => c.code === 'EUR');
    const body = await expectStatus('PUT', `/api/currencies/rates/${rateId}`, adminToken, { toCurrencyId: eurRow.id }, 400, 'pair change');
    assert.strictEqual(body.code, 'RATE_PAIR_IMMUTABLE');
  });

  check('deactivating a rate removes it from lookup and reactivating restores it', async () => {
    const usdRow = currencies.find((c) => c.code === 'USD');
    const gbpRow = currencies.find((c) => c.code === 'GBP');

    await expectOk('PUT', `/api/currencies/rates/${rateId}`, adminToken, { isActive: false });
    const gone = await request(
      'GET',
      `/api/currencies/rates/lookup?fromCurrencyId=${usdRow.id}&toCurrencyId=${gbpRow.id}`,
      adminToken
    );
    assert.strictEqual(gone.status, 404, 'a deactivated rate must not convert');

    await expectOk('PUT', `/api/currencies/rates/${rateId}`, adminToken, { isActive: true });
    const back = await expectOk(
      'GET',
      `/api/currencies/rates/lookup?fromCurrencyId=${usdRow.id}&toCurrencyId=${gbpRow.id}`,
      adminToken
    );
    assert.strictEqual(back.rate, '0.8');
  });

  // ── Staleness is reported, never silently repaired ─────────
  let baseRateId;
  check('the overview flags missing and stale rates instead of filling them in', async () => {
    const usdRow = currencies.find((c) => c.code === 'USD');
    const sarRow = currencies.find((c) => c.code === 'SAR');
    baseRateId = (
      await expectOk(
        'POST',
        '/api/currencies/rates',
        adminToken,
        { fromCurrencyId: usdRow.id, toCurrencyId: sarRow.id, rate: 3.75, effectiveDate: '2026-01-05' },
        'create USD->SAR rate'
      )
    ).id;

    const overview = await expectOk('GET', '/api/currencies/overview', adminToken);
    assert.ok(Number.isFinite(overview.staleDays), 'the stale window comes from configuration');
    const usd = overview.currencies.find((c) => c.code === 'USD');
    assert.strictEqual(usd.rate, '3.75', 'the configured rate to the base is shown');
    assert.strictEqual(usd.isMissing, false);
    assert.strictEqual(usd.source, 'MANUAL');
    const zmw = overview.currencies.find((c) => c.code === 'ZMW');
    if (zmw) {
      assert.strictEqual(zmw.rate, null);
      assert.strictEqual(zmw.isMissing, true, 'a currency with no rate is reported as missing');
    }
    assert.ok(overview.counts.missing > 0, 'a fresh company must report the gaps honestly');
    assert.strictEqual(
      overview.counts.rateAvailable,
      overview.currencies.filter((c) => !c.isBase && c.rate).length,
      'the counts must agree with the rows'
    );
  });

  check('a rate older than the stale window is reported as stale', async () => {
    await expectOk('PUT', `/api/currencies/rates/${baseRateId}`, adminToken, { effectiveDate: '2000-01-01' });
    const stale = await expectOk('GET', '/api/currencies/overview', adminToken);
    const usd = stale.currencies.find((c) => c.code === 'USD');
    assert.strictEqual(usd.effectiveDate, '2000-01-01');
    assert.strictEqual(usd.isStale, true, 'a twenty-six year old rate must not look current');
    assert.ok(usd.ageDays > stale.staleDays);
    assert.ok(stale.counts.stale > 0, 'the stale count reflects the rows');

    await expectOk('PUT', `/api/currencies/rates/${baseRateId}`, adminToken, { effectiveDate: stale.asOfDate });
    const fresh = await expectOk('GET', '/api/currencies/overview', adminToken);
    const healed = fresh.currencies.find((c) => c.code === 'USD');
    assert.strictEqual(healed.ageDays, 0);
    assert.strictEqual(healed.isStale, false, 'a rate dated today is inside the window');
  });

  // ── The provider is the only source of automatic rates ─────
  check('an unconfigured provider initializes nothing instead of inventing rates', async () => {
    const status = await expectOk('GET', '/api/currencies/provider', adminToken);
    assert.strictEqual(status.configured, false, 'disabling FX_PROVIDER must report the provider as unconfigured');

    const before = await prisma.exchangeRate.count({ where: { companyId: first.companyId } });
    const report = await expectOk(
      'POST',
      '/api/currencies/initialize',
      adminToken,
      { baseCurrencyCode: 'SAR', fetchRates: true, overwrite: false },
      'initialize with no provider'
    );
    assert.strictEqual(report.created.length, 0, 'nothing may be created without a provider');
    assert.strictEqual(report.updated.length, 0);
    assert.ok(report.missing.length > 0, 'every unconfigured currency must be listed as missing');
    assert.strictEqual(report.provider.configured, false);
    const after = await prisma.exchangeRate.count({ where: { companyId: first.companyId } });
    assert.strictEqual(after, before, 'the rate table must be untouched');

    const refresh = await request('POST', '/api/currencies/rates/refresh', adminToken, { overwrite: false });
    assert.strictEqual(refresh.status, 502, 'a refresh with no provider fails loudly');
    assert.strictEqual(refresh.body.code, 'PROVIDER_UNAVAILABLE');
  });

  check('initializing twice is idempotent and preserves manual rates', async () => {
    const firstRun = await expectOk(
      'POST',
      '/api/currencies/initialize',
      adminToken,
      { baseCurrencyCode: 'SAR', fetchRates: false },
      'initialize offline'
    );
    const secondRun = await expectOk(
      'POST',
      '/api/currencies/initialize',
      adminToken,
      { baseCurrencyCode: 'SAR', fetchRates: false },
      'initialize offline again'
    );
    assert.strictEqual(secondRun.created.length, 0, 'a second run must not duplicate rates');
    assert.deepStrictEqual(secondRun.preserved.sort(), firstRun.preserved.sort());
    assert.strictEqual(secondRun.baseCurrency.code, 'SAR');
    assert.ok(secondRun.supportedCurrencyCount >= 150);
  });

  check('a manual rate is never overwritten by a refresh', async () => {
    const rate = await prisma.exchangeRate.findUnique({ where: { id: rateId } });
    assert.strictEqual(rate.source, 'MANUAL', 'manual edits stay manual');
    const gbpRow = currencies.find((c) => c.code === 'GBP');
    const usdRow = currencies.find((c) => c.code === 'USD');
    const lookup = await expectOk(
      'GET',
      `/api/currencies/rates/lookup?fromCurrencyId=${usdRow.id}&toCurrencyId=${gbpRow.id}`,
      adminToken
    );
    assert.strictEqual(lookup.rate, '0.8', 'the manual value is still the one in force');
  });

  // ── Company isolation ──────────────────────────────────────
  check('exchange rates are isolated per company', async () => {
    const other = await expectOk('GET', '/api/currencies/rates', second.token);
    assert.strictEqual(other.length, 0, 'the second company must see none of the first company rates');

    const own = await expectOk('GET', '/api/currencies/rates', adminToken);
    assert.strictEqual(own.length, 2);

    const otherBase = await expectOk('GET', '/api/currencies/base', second.token);
    assert.notStrictEqual(otherBase.code, 'SAR', 'the second company keeps its own base currency');

    const otherOverview = await expectOk('GET', '/api/currencies/overview', second.token);
    assert.strictEqual(otherOverview.counts.rateAvailable, 0);

    const foreignEdit = await request('PUT', `/api/currencies/rates/${rateId}`, second.token, { rate: 99 });
    assert.strictEqual(foreignEdit.status, 404, 'another company cannot edit this rate');
    const foreignDelete = await request('DELETE', `/api/currencies/rates/${rateId}`, second.token);
    assert.strictEqual(foreignDelete.status, 404, 'another company cannot delete this rate');
    const untouched = await prisma.exchangeRate.findUnique({ where: { id: rateId } });
    assert.strictEqual(untouched.rate.toString(), '0.8');
  });

  // ── RBAC ───────────────────────────────────────────────────
  check('rate management is permission-gated while the master stays readable', async () => {
    const gbpRow = currencies.find((c) => c.code === 'GBP');
    const usdRow = currencies.find((c) => c.code === 'USD');
    const sarRow = currencies.find((c) => c.code === 'SAR');

    const readable = await expectOk('GET', '/api/currencies', first.clerkToken);
    assert.ok(readable.length >= 150, 'a clerk may read the shared currency master');

    await expectStatus('POST', '/api/currencies/rates', first.clerkToken, { fromCurrencyId: usdRow.id, toCurrencyId: gbpRow.id, rate: 1 }, 403, 'clerk create rate');
    await expectStatus('POST', '/api/currencies/rates/refresh', first.clerkToken, {}, 403, 'clerk refresh');
    await expectStatus('PUT', '/api/currencies/base', first.clerkToken, { currencyCode: 'GBP' }, 403, 'clerk set base');
    await expectStatus('POST', '/api/currencies/initialize', first.clerkToken, {}, 403, 'clerk initialize');
    await expectStatus('DELETE', `/api/currencies/rates/${rateId}`, first.clerkToken, null, 403, 'clerk delete');

    const baseStill = await expectOk('GET', '/api/currencies/base', adminToken);
    assert.strictEqual(baseStill.code, 'SAR', 'a denied base-currency write must not change anything');

    const anonymous = await request('GET', '/api/currencies', null);
    assert.ok(anonymous.status === 401 || anonymous.status === 403, 'the module must not answer unauthenticated');
  });

  // ── Custom currency master (company-neutral, permissioned) ──
  check('a new currency can be created once and is validated', async () => {
    const digits = await expectStatus('POST', '/api/currencies', adminToken, { code: 'E2E', name: 'Digits', symbol: 'X' }, 400, 'code with digits');
    assert.strictEqual(digits.code, 'CURRENCY_CODE_INVALID');
    const tooLong = await expectStatus('POST', '/api/currencies', adminToken, { code: 'TOOLONGCURRENCY', name: 'Nope', symbol: 'X' }, 400, 'code over 8 letters');
    assert.strictEqual(tooLong.code, 'CURRENCY_CODE_INVALID');
    await expectStatus('POST', '/api/currencies', adminToken, { code: 'EZE', name: '', symbol: 'X' }, 400, 'missing name');
    await expectStatus('POST', '/api/currencies', adminToken, { code: 'EZE', name: 'EZE', symbol: '' }, 400, 'missing symbol');
    await expectStatus('POST', '/api/currencies', adminToken, { code: 'EZE', name: 'EZE', symbol: 'E', decimalPlaces: 40 }, 400, 'bad decimals');

    const row = await expectOk('POST', '/api/currencies', adminToken, { code: 'eze', name: 'Eze Test Currency', symbol: 'Ξ', decimalPlaces: 3 });
    created.currencyIds.push(row.id);
    assert.strictEqual(row.code, 'EZE', 'the code is normalized to upper case');
    assert.strictEqual(row.decimalPlaces, 3);

    const dup = await expectStatus('POST', '/api/currencies', adminToken, { code: 'EZE', name: 'Dup', symbol: 'D' }, 409, 'duplicate code');
    assert.strictEqual(dup.code, 'CURRENCY_EXISTS');

    await expectStatus('POST', '/api/currencies', first.clerkToken, { code: 'EZF', name: 'Nope', symbol: 'N' }, 403, 'clerk create currency');
  });

  check('a currency can be renamed and deactivated without deleting history', async () => {
    const list = await expectOk('GET', '/api/currencies?activeOnly=false', adminToken);
    const row = list.find((c) => c.code === 'EZE');
    const updated = await expectOk('PUT', `/api/currencies/${row.id}`, adminToken, { isActive: false, symbol: 'ΞΞ' });
    assert.strictEqual(updated.isActive, false);
    assert.strictEqual(updated.symbol, 'ΞΞ');

    const active = await expectOk('GET', '/api/currencies', adminToken);
    assert.ok(!active.some((c) => c.code === 'EZE'), 'an inactive currency leaves the default picker');

    const usdRow = currencies.find((c) => c.code === 'USD');
    const blocked = await expectStatus(
      'POST',
      '/api/currencies/rates',
      adminToken,
      { fromCurrencyId: usdRow.id, toCurrencyId: row.id, rate: 1 },
      400,
      'rate onto an inactive currency'
    );
    assert.strictEqual(blocked.code, 'CURRENCY_INACTIVE');
  });

  // ── Deleting a rate deactivates it and keeps the audit trail ─
  check('deleting a rate deactivates it, stops it converting, and keeps its history', async () => {
    const usdRow = currencies.find((c) => c.code === 'USD');
    const gbpRow = currencies.find((c) => c.code === 'GBP');

    const response = await request('DELETE', `/api/currencies/rates/${rateId}`, adminToken);
    assert.ok(response.status < 400, `delete → ${response.status} ${JSON.stringify(response.body).slice(0, 200)}`);
    assert.strictEqual(response.body.data.isActive, false);

    const active = await expectOk('GET', '/api/currencies/rates?activeOnly=true', adminToken);
    assert.strictEqual(active.length, 1, 'only the live rate remains in the active table');
    assert.strictEqual(active[0].toCurrency.code, 'SAR');

    const gone = await request(
      'GET',
      `/api/currencies/rates/lookup?fromCurrencyId=${usdRow.id}&toCurrencyId=${gbpRow.id}`,
      adminToken
    );
    assert.strictEqual(gone.status, 404, 'a deleted rate must not be used for conversion');

    const history = await expectOk('GET', `/api/currencies/rates/${rateId}/history`, adminToken);
    assert.ok(history.some((h) => h.action === 'DEACTIVATE'), 'the deletion is audited');
  });
}

async function cleanup() {
  process.env.FX_PROVIDER = savedProvider;
  for (const id of created.companyIds) {
    await prisma.exchangeRateHistory.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.exchangeRate.deleteMany({ where: { companyId: id } }).catch(() => {});
  }
  await prisma.company.updateMany({ where: { id: { in: created.companyIds } }, data: { baseCurrencyId: null } }).catch(() => {});
  await prisma.currency.deleteMany({ where: { id: { in: created.currencyIds } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: { in: created.companyIds } } }).catch(() => {});
}

(async () => {
  savedProvider = process.env.FX_PROVIDER;

  await new Promise((resolve) => {
    server = app.listen(0);
    server.once('listening', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  let failed = 0;
  let setupError = null;
  try {
    await run();
  } catch (error) {
    setupError = error;
  }

  if (setupError) {
    console.error('setup failed:', setupError.message);
    failed = results.length || 1;
  } else {
    for (const [name, fn] of results) {
      try {
        await fn();
        console.log(`  ✓ ${name}`);
      } catch (error) {
        failed += 1;
        console.error(`  ✗ ${name}\n    ${error.message}`);
      }
    }
  }

  await cleanup();
  server.close();
  await prisma.$disconnect();

  const total = results.length;
  console.log(`\n${total - failed}/${total} currency checks passed`);
  process.exitCode = failed ? 1 : 0;
})();
