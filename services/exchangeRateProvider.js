'use strict';

/**
 * Exchange-rate provider adapter.
 *
 * Direction convention (matches Import Management):
 *   1 unit of foreign currency = rate units of company base currency.
 *
 * Providers return "units of X per 1 provider base". We normalize with Decimal
 * before anything is persisted. Unsupported pairs are reported as missing —
 * never filled with random or guessed values.
 *
 * Environment:
 *   FX_PROVIDER=open-er-api | frankfurter | disabled   (default: open-er-api)
 *   FX_PROVIDER_BASE_URL=...                           (optional override)
 *   FX_PROVIDER_API_KEY=...                            (backend only)
 *   FX_PROVIDER_TIMEOUT_MS=6000
 *   FX_RATE_CACHE_TTL_MS=900000
 */

const { Prisma } = require('@prisma/client');
const { startOfUtcDay } = require('../utils/multiCurrency');

const Decimal = Prisma.Decimal;
const MAX_RATE = new Decimal('9999999999.99999999');
const DEFAULT_OPEN_ER_API = 'https://open.er-api.com/v6/latest';
const DEFAULT_FRANKFURTER = 'https://api.frankfurter.app';

const cache = new Map();

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function readConfig() {
  const raw = String(process.env.FX_PROVIDER || 'open-er-api').trim().toLowerCase();
  const disabled = ['', 'none', 'disabled', 'off', 'false', '0'].includes(raw);
  const provider = disabled
    ? 'disabled'
    : raw === 'frankfurter'
      ? 'frankfurter'
      : 'open-er-api';

  return {
    provider,
    configured: !disabled,
    baseUrl:
      process.env.FX_PROVIDER_BASE_URL ||
      (provider === 'frankfurter' ? DEFAULT_FRANKFURTER : DEFAULT_OPEN_ER_API),
    apiKey: process.env.FX_PROVIDER_API_KEY || '',
    timeoutMs: clampInt(process.env.FX_PROVIDER_TIMEOUT_MS, 1000, 30000, 6000),
    cacheTtlMs: clampInt(process.env.FX_RATE_CACHE_TTL_MS, 0, 24 * 60 * 60 * 1000, 15 * 60 * 1000),
  };
}

function getProviderStatus() {
  const cfg = readConfig();
  let host = '';
  try {
    host = new URL(cfg.baseUrl).host;
  } catch {
    host = cfg.baseUrl;
  }
  return {
    configured: cfg.configured,
    provider: cfg.provider,
    host,
    timeoutMs: cfg.timeoutMs,
    cacheTtlMs: cfg.cacheTtlMs,
    hasApiKey: Boolean(cfg.apiKey),
    cachedBases: cache.size,
  };
}

function clearProviderCache() {
  cache.clear();
}

function normalizeCodes(codes) {
  return [...new Set((codes || []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean))];
}

function toRateString(value) {
  const dec = new Decimal(value);
  if (!dec.isFinite() || dec.lte(0) || dec.gt(MAX_RATE)) return null;
  return dec.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toString();
}

function normalizeRates({ providerBase, companyBase, rates, codes }) {
  const providerBaseCode = String(providerBase || companyBase).toUpperCase();
  const companyBaseCode = String(companyBase || providerBase).toUpperCase();

  const readRate = (code) => {
    if (code === providerBaseCode) return 1;
    const raw = Number(rates?.[code]);
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  };

  const basePerProviderBase = readRate(companyBaseCode);
  if (!basePerProviderBase || basePerProviderBase <= 0) {
    return {
      rates: {},
      unsupported: codes.slice(),
      reason: `Provider response does not include the company base currency ${companyBaseCode}`,
    };
  }

  const out = {};
  const unsupported = [];
  for (const code of codes) {
    if (code === companyBaseCode) {
      out[code] = '1';
      continue;
    }
    const codePerProviderBase = readRate(code);
    if (!codePerProviderBase || codePerProviderBase <= 0) {
      unsupported.push(code);
      continue;
    }
    // 1 foreign = (base per provider-base) / (foreign per provider-base) base
    const rate = toRateString(new Decimal(basePerProviderBase).div(codePerProviderBase));
    if (!rate) {
      unsupported.push(code);
      continue;
    }
    out[code] = rate;
  }
  return { rates: out, unsupported, reason: null };
}

async function fetchOpenErApi({ cfg, baseCode, codes, fetchImpl, signal }) {
  const url = new URL(`${cfg.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(baseCode)}`);
  if (cfg.apiKey) url.searchParams.set('apikey', cfg.apiKey);

  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Rate provider responded with HTTP ${response.status}`);
  }
  const payload = await response.json().catch(() => null);
  if (!payload || payload.result !== 'success' || !payload.rates) {
    const detail = payload?.['error-type'] || payload?.error || 'unexpected response';
    throw new Error(`Rate provider error: ${detail}`);
  }

  const providerBase = String(payload.base_code || baseCode).toUpperCase();
  const asOf = payload.time_last_update_unix
    ? startOfUtcDay(new Date(Number(payload.time_last_update_unix) * 1000))
    : startOfUtcDay(new Date());

  return { providerBase, rates: payload.rates, asOf };
}

const FRANKFURTER_BASE = 'EUR';

async function fetchFrankfurter({ cfg, baseCode, codes, fetchImpl, signal }) {
  // Frankfurter only quotes ECB currencies. Use EUR as the pivot so any base
  // can still be derived; missing crosses are reported as unsupported.
  const to = normalizeCodes([baseCode, ...codes]).filter((c) => c !== FRANKFURTER_BASE);
  const url = new URL(`${cfg.baseUrl.replace(/\/$/, '')}/latest`);
  url.searchParams.set('from', FRANKFURTER_BASE);
  if (to.length) url.searchParams.set('to', to.join(','));

  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Rate provider responded with HTTP ${response.status}`);
  }
  const payload = await response.json().catch(() => null);
  if (!payload || !payload.rates) {
    throw new Error('Rate provider returned no rates');
  }

  const asOf = startOfUtcDay(payload.date ? new Date(`${payload.date}T00:00:00Z`) : new Date());
  return { providerBase: FRANKFURTER_BASE, rates: payload.rates, asOf };
}

/**
 * Fetch rates normalized to the company base currency.
 *
 * @returns {Promise<{
 *   configured: boolean,
 *   provider: string,
 *   baseCode: string,
 *   asOfDate: Date|null,
 *   fetchedAt: Date,
 *   rates: Record<string,string>,
 *   unsupported: string[],
 *   error: string|null,
 *   cached: boolean,
 * }>}
 */
async function fetchProviderRates({
  baseCode,
  codes = [],
  forceRefresh = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  const cfg = readConfig();
  const base = String(baseCode || '').trim().toUpperCase();
  const requested = normalizeCodes(codes).filter((c) => c !== base);
  const now = new Date();
  const empty = {
    configured: cfg.configured,
    provider: cfg.provider,
    baseCode: base,
    asOfDate: null,
    fetchedAt: now,
    rates: {},
    unsupported: requested,
    error: null,
    cached: false,
  };

  if (!cfg.configured) {
    return { ...empty, error: 'FX provider is disabled (FX_PROVIDER=disabled)' };
  }
  if (!base) {
    return { ...empty, error: 'A base currency code is required' };
  }
  if (typeof fetchImpl !== 'function') {
    return { ...empty, error: 'No fetch implementation available for the FX provider' };
  }
  if (!requested.length) {
    return { ...empty, error: null };
  }

  const cacheKey = `${cfg.provider}:${base}`;
  const hit = cache.get(cacheKey);
  if (!forceRefresh && hit && hit.expiresAt > Date.now()) {
    const rates = {};
    const unsupported = [];
    for (const code of requested) {
      if (hit.rates[code]) rates[code] = hit.rates[code];
      else unsupported.push(code);
    }
    return {
      ...empty,
      asOfDate: hit.asOfDate,
      fetchedAt: hit.fetchedAt,
      rates,
      unsupported,
      cached: true,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const result =
      cfg.provider === 'frankfurter'
        ? await fetchFrankfurter({
            cfg,
            baseCode: base,
            codes: requested,
            fetchImpl,
            signal: controller.signal,
          })
        : await fetchOpenErApi({
            cfg,
            baseCode: base,
            codes: requested,
            fetchImpl,
            signal: controller.signal,
          });

    const normalized = normalizeRates({
      providerBase: result.providerBase,
      companyBase: base,
      rates: result.rates,
      codes: requested,
    });

    const response = {
      ...empty,
      asOfDate: result.asOf || startOfUtcDay(now),
      fetchedAt: now,
      rates: normalized.rates,
      unsupported: normalized.unsupported,
      error: normalized.reason,
      cached: false,
    };

    if (!response.error && cfg.cacheTtlMs > 0) {
      const merged = { ...(hit?.rates || {}), ...normalized.rates };
      cache.set(cacheKey, {
        rates: merged,
        asOfDate: response.asOfDate,
        fetchedAt: response.fetchedAt,
        expiresAt: Date.now() + cfg.cacheTtlMs,
      });
    }

    return response;
  } catch (err) {
    const message =
      err?.name === 'AbortError'
        ? `Rate provider timed out after ${cfg.timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : 'Rate provider request failed';
    return { ...empty, error: message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  fetchProviderRates,
  getProviderStatus,
  clearProviderCache,
  readConfig,
  normalizeRates,
};
