// utils/databaseUrl.js
// Normalize Postgres URL for Vercel / serverless Prisma (Neon / Supabase).

function isServerlessRuntime() {
  return !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.PRISMA_SERVERLESS === '1'
  );
}

function looksLikePooler(url) {
  const host = (url.hostname || '').toLowerCase();
  const port = url.port;
  return (
    host.includes('pooler') ||
    port === '6543' ||
    (host.includes('supabase') && port === '6543')
  );
}

/**
 * Neon pooled hosts look like: ep-xxx-pooler.region.aws.neon.tech
 * Direct hosts look like:      ep-xxx.region.aws.neon.tech
 */
function deriveNeonDirectUrl(pooledUrlString) {
  try {
    const url = new URL(pooledUrlString);
    if (!url.hostname.includes('-pooler.')) return null;
    url.hostname = url.hostname.replace('-pooler.', '.');
    // Direct Neon endpoint uses 5432; drop pooler-only flags
    url.searchParams.delete('pgbouncer');
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Ensure serverless-safe query params.
 */
function applyServerlessParams(raw, { forcePoolerFlags = false } = {}) {
  if (!raw || typeof raw !== 'string') return raw;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  const pooler = looksLikePooler(url);

  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set(
      'connection_limit',
      isServerlessRuntime() || pooler ? '1' : '5'
    );
  }

  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', '30');
  }

  if (!url.searchParams.has('connect_timeout')) {
    url.searchParams.set('connect_timeout', '30');
  }

  if ((pooler || forcePoolerFlags) && !url.searchParams.has('pgbouncer')) {
    url.searchParams.set('pgbouncer', 'true');
  }

  return url.toString();
}

/**
 * Pick the runtime URL.
 *
 * Interactive `$transaction` (bank, bills, products, JE…) is unreliable through
 * Neon/Supabase poolers. Prefer DIRECT_URL, else derive Neon direct from
 * "-pooler" host, else use DATABASE_URL with safe params.
 */
function resolveDatabaseUrl() {
  const envDirect = process.env.DIRECT_URL;
  const envDb = process.env.DATABASE_URL;
  const forceDirect =
    process.env.PRISMA_USE_DIRECT === '1' ||
    process.env.PRISMA_USE_DIRECT === 'true';

  let chosen = envDb;
  let reason = 'DATABASE_URL';

  if (envDirect && (forceDirect || isServerlessRuntime())) {
    chosen = envDirect;
    reason = forceDirect
      ? 'DIRECT_URL (PRISMA_USE_DIRECT)'
      : 'DIRECT_URL (serverless)';
  } else if (envDirect && envDb) {
    try {
      if (looksLikePooler(new URL(envDb))) {
        chosen = envDirect;
        reason = 'DIRECT_URL (DATABASE_URL is pooler)';
      }
    } catch {
      /* keep envDb */
    }
  } else if (envDb) {
    try {
      if (looksLikePooler(new URL(envDb))) {
        // Local/dev: keep the pooler URL — Neon direct (-pooler stripped) is
        // often unreachable from laptops (P1001). Serverless / explicit flag
        // can still force direct for interactive transactions.
        if (forceDirect || isServerlessRuntime()) {
          const derived = deriveNeonDirectUrl(envDb);
          if (derived) {
            chosen = derived;
            reason = forceDirect
              ? 'derived Neon direct (PRISMA_USE_DIRECT)'
              : 'derived Neon direct (serverless)';
          }
        } else {
          chosen = envDb;
          reason = 'DATABASE_URL pooler (local/dev)';
        }
      }
    } catch {
      /* keep envDb */
    }
  }

  const isPoolerChosen = (() => {
    try {
      return looksLikePooler(new URL(chosen));
    } catch {
      return false;
    }
  })();

  const resolved = applyServerlessParams(chosen, {
    forcePoolerFlags: isPoolerChosen
  });

  if (!globalThis.__prismaUrlLogged) {
    try {
      const u = new URL(resolved);
      console.log(
        `✅ [Prisma] DB url source=${reason} host=${u.hostname} connection_limit=${u.searchParams.get('connection_limit')} pgbouncer=${u.searchParams.get('pgbouncer')}`
      );
    } catch {
      console.log(`✅ [Prisma] DB url source=${reason}`);
    }
    globalThis.__prismaUrlLogged = true;
  }

  return resolved;
}

function describeDatabaseUrl(raw = process.env.DATABASE_URL) {
  try {
    const url = new URL(raw || '');
    return {
      host: url.hostname,
      port: url.port || '5432',
      pgbouncer: url.searchParams.get('pgbouncer'),
      connection_limit: url.searchParams.get('connection_limit'),
      isPooler: looksLikePooler(url)
    };
  } catch {
    return { host: null, invalid: true };
  }
}

module.exports = {
  resolveDatabaseUrl,
  describeDatabaseUrl,
  deriveNeonDirectUrl,
  applyServerlessParams,
  isServerlessRuntime
};
