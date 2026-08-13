// utils/withTransaction.js
// Serverless-safe interactive transactions (Vercel + pooled Postgres).

const DEFAULT_OPTIONS = {
  maxWait: 15_000, // wait to acquire a connection
  timeout: 60_000, // interactive transaction lifetime
};

function isTransientTxError(error) {
  const msg = String(error?.message || error || '');
  return (
    /Transaction not found/i.test(msg) ||
    /Transaction ID is invalid/i.test(msg) ||
    /Server has closed the connection/i.test(msg) ||
    /Error in PostgreSQL connection/i.test(msg) ||
    /Connection reset/i.test(msg) ||
    /ECONNRESET/i.test(msg) ||
    /Can't reach database server/i.test(msg) ||
    /Timed out fetching a new connection/i.test(msg) ||
    /P1001|P1017|P2024/i.test(msg) ||
    error?.code === 'P2028' // transaction API error
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an interactive or batch Prisma transaction with serverless-friendly
 * timeouts and a couple of retries on dropped connections.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Function|Array} fnOrOps
 * @param {object} [options]
 */
async function withTransaction(prisma, fnOrOps, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 2;
  const {
    retries: _r,
    ...txOptions
  } = options;

  const merged =
    typeof fnOrOps === 'function'
      ? { ...DEFAULT_OPTIONS, ...txOptions }
      : Object.keys(txOptions).length
        ? txOptions
        : undefined;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (typeof fnOrOps === 'function') {
        return await prisma.$transaction(fnOrOps, merged);
      }
      return merged
        ? await prisma.$transaction(fnOrOps, merged)
        : await prisma.$transaction(fnOrOps);
    } catch (error) {
      lastError = error;
      const retryable = isTransientTxError(error) && attempt < retries;
      if (!retryable) throw error;
      const delay = 200 * (attempt + 1);
      console.warn(
        `⚠️ [Prisma] Transaction transient error (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms:`,
        error.message
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Patch prisma.$transaction once so every call site gets timeouts + retries.
 */
function patchPrismaTransactions(prisma) {
  if (prisma.__txPatched) return prisma;

  const original = prisma.$transaction.bind(prisma);

  prisma.$transaction = async function patchedTransaction(fnOrOps, options) {
    const retries = 2;
    const isFn = typeof fnOrOps === 'function';
    const merged = isFn
      ? { ...DEFAULT_OPTIONS, ...(options || {}) }
      : options;

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return isFn
          ? await original(fnOrOps, merged)
          : merged
            ? await original(fnOrOps, merged)
            : await original(fnOrOps);
      } catch (error) {
        lastError = error;
        const retryable = isTransientTxError(error) && attempt < retries;
        if (!retryable) throw error;
        const delay = 250 * (attempt + 1);
        console.warn(
          `⚠️ [Prisma] $transaction retry ${attempt + 1}/${retries + 1}:`,
          error.message
        );
        await sleep(delay);
      }
    }
    throw lastError;
  };

  prisma.__txPatched = true;
  return prisma;
}

module.exports = {
  withTransaction,
  patchPrismaTransactions,
  isTransientTxError,
  DEFAULT_OPTIONS
};
