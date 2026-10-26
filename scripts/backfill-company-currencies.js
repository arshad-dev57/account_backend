#!/usr/bin/env node
'use strict';

/**
 * Idempotent company currency / exchange-rate backfill.
 *
 * - Ensures the ISO 4217 currency master is seeded.
 * - Resolves each company's existing base currency (never silently changes it).
 * - Adds missing rates against that base via the configured provider.
 * - Preserves existing valid and user-edited rates unless --overwrite is passed.
 * - Never deletes companies, rates, transactions, or any other data.
 *
 * Usage:
 *   node scripts/backfill-company-currencies.js --email customer461@gmail.com
 *   node scripts/backfill-company-currencies.js --company-id <uuid> --dry-run
 *   node scripts/backfill-company-currencies.js --all --overwrite
 *
 * Flags:
 *   --email <email>        All companies the user can access (owner/membership)
 *   --company-id <uuid>    A single company
 *   --all                  Every active company (use deliberately)
 *   --dry-run              Read-only report; no writes and no provider calls
 *   --overwrite            Replace same-date rates with provider values
 *   --no-provider          Only resolve base + seed master; skip provider lookups
 *   --as-of <YYYY-MM-DD>   Effective date for provider rates (default today)
 *   --json                 Print the full report as JSON
 */

require('dotenv').config();

const prisma = require('../prisma/client');
const {
  initializeCompanyCurrencyConfiguration,
  getCompanyCurrencyOverview,
  resolveBaseCurrency,
} = require('../services/companyCurrencyService');
const { startOfUtcDay } = require('../utils/multiCurrency');
const { ensureFxAccounts } = require('../utils/fxAccountHelper');

const HELP = `Company currency / exchange-rate backfill (idempotent)

Usage:
  node scripts/backfill-company-currencies.js --email <email>
  node scripts/backfill-company-currencies.js --company-id <uuid> [--dry-run]
  node scripts/backfill-company-currencies.js --all [--overwrite]

Flags:
  --email <email>        Backfill every company the user can access
  --company-id <uuid>    Backfill a single company
  --all                  Backfill every active company
  --dry-run              Read-only: report missing rates, never writes
  --overwrite            Replace same-date rates with provider values
  --no-provider          Skip provider lookups (master/base only)
  --as-of <YYYY-MM-DD>   Provider effective date (default: today)
  --json                 Print the report as JSON
  --help                 Show this help
`;

function parseArgs(argv) {
  const opts = {
    email: null,
    companyId: null,
    all: false,
    dryRun: false,
    overwrite: false,
    provider: true,
    asOf: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) {
      throw new Error(`Unknown argument: ${raw}`);
    }
    const [flag, inline] = raw.slice(2).split('=');
    const key = flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

    if (key === 'email' || key === 'companyId' || key === 'asOf') {
      const value = inline !== undefined ? inline : argv[++i];
      if (!value || String(value).startsWith('--')) {
        throw new Error(`--${flag} requires a value`);
      }
      opts[key] = String(value).trim();
      continue;
    }
    if (key === 'all') opts.all = true;
    else if (key === 'dryRun') opts.dryRun = true;
    else if (key === 'overwrite') opts.overwrite = true;
    else if (key === 'noProvider') opts.provider = false;
    else if (key === 'json') opts.json = true;
    else if (key === 'help') opts.help = true;
    else throw new Error(`Unknown flag: --${flag}`);
  }

  if (opts.dryRun && opts.overwrite) {
    throw new Error('--dry-run cannot be combined with --overwrite');
  }
  return opts;
}

async function resolveTargets(opts) {
  if (opts.companyId) {
    const company = await prisma.company.findUnique({
      where: { id: opts.companyId },
      select: { id: true, name: true, isActive: true },
    });
    if (!company) throw new Error(`Company not found: ${opts.companyId}`);
    return { companies: [company], user: null };
  }

  if (opts.email) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: opts.email, mode: 'insensitive' } },
      select: { id: true, email: true, companyId: true },
    });
    if (!user) throw new Error(`User not found: ${opts.email}`);

    const memberships = await prisma.companyMembership.findMany({
      where: { userId: user.id, isActive: true },
      select: { companyId: true },
    });
    const ids = [
      ...new Set([user.companyId, ...memberships.map((m) => m.companyId)].filter(Boolean)),
    ];
    const companies = ids.length
      ? await prisma.company.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, isActive: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    return { companies, user };
  }

  if (opts.all) {
    const companies = await prisma.company.findMany({
      where: { isActive: true },
      select: { id: true, name: true, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    return { companies, user: null };
  }

  throw new Error('Specify --email, --company-id or --all');
}

/** Read-only inspection used by --dry-run (never persists a base or a rate). */
async function inspectCompany(companyId, asOfDate) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      baseCurrency: true,
      parentCompany: { include: { baseCurrency: true } },
    },
  });
  if (!company) throw new Error(`Company not found: ${companyId}`);

  let base = company.baseCurrency || null;
  let baseSource = base ? 'stored' : null;
  if (!base && company.parentCompany?.baseCurrency) {
    base = company.parentCompany.baseCurrency;
    baseSource = 'parent';
  }
  if (!base) {
    base =
      (await prisma.currency.findUnique({ where: { code: 'PKR' } })) ||
      (await prisma.currency.findFirst({
        where: { isActive: true },
        orderBy: { code: 'asc' },
      }));
    baseSource = base ? 'fallback' : null;
  }

  const currencies = await prisma.currency.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
    orderBy: { code: 'asc' },
  });

  const day = startOfUtcDay(asOfDate || new Date());
  const rows = base
    ? await prisma.exchangeRate.findMany({
        where: {
          companyId,
          toCurrencyId: base.id,
          isActive: true,
          rate: { gt: 0 },
          effectiveDate: { lte: day },
        },
        select: { fromCurrencyId: true },
      })
    : [];
  const covered = new Set(rows.map((r) => r.fromCurrencyId));
  const missing = currencies
    .filter((c) => c.id !== base?.id && !covered.has(c.id))
    .map((c) => c.code);

  const [totalRates, invalidRates] = await Promise.all([
    prisma.exchangeRate.count({ where: { companyId } }),
    prisma.exchangeRate.count({
      where: { companyId, isActive: true, rate: { lte: 0 } },
    }),
  ]);

  return {
    companyId,
    name: company.name,
    base: base ? { code: base.code, name: base.name, source: baseSource } : null,
    supportedCurrencyCount: currencies.length,
    existingRateRecords: totalRates,
    invalidRateRecords: invalidRates,
    missing,
    missingCount: missing.length,
  };
}

async function initializeCompany(company, userId, opts, asOfDate) {
  const result = await initializeCompanyCurrencyConfiguration({
    companyId: company.id,
    userId,
    fetchRates: opts.provider,
    overwrite: opts.overwrite,
    asOfDate,
  });

  let fxAccounts = 'skipped';
  try {
    await ensureFxAccounts(userId, company.id);
    fxAccounts = 'ensured';
  } catch (err) {
    fxAccounts = `error: ${err.message}`;
  }

  let overview = null;
  try {
    overview = await getCompanyCurrencyOverview({ companyId: company.id });
  } catch (err) {
    overview = { error: err.message };
  }

  return {
    companyId: company.id,
    name: company.name,
    base: result.baseCurrency,
    supportedCurrencyCount: result.supportedCurrencyCount,
    created: result.created,
    updated: result.updated,
    preservedCount: result.preserved.length,
    missing: result.missing,
    provider: result.provider,
    errors: result.errors,
    fxAccounts,
    overview: overview
      ? {
          counts: overview.counts,
          staleDays: overview.staleDays,
          error: overview.error,
        }
      : null,
  };
}

function printSummary(report) {
  console.log('');
  console.log('══ Company currency backfill ══');
  console.log(`Mode: ${report.dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(
    `Provider: ${
      report.provider.configured
        ? report.provider.provider || report.provider.name
        : 'not configured'
    }`
  );
  console.log(`Companies: ${report.companies.length}`);
  console.log('');

  for (const row of report.companies) {
    console.log(`• ${row.name} (${row.companyId})`);
    if (row.error) {
      console.log(`  error: ${row.error}`);
      continue;
    }
    console.log(
      `  base: ${row.base?.code || 'unresolved'}${row.base?.source ? ` (${row.base.source})` : ''}`
    );

    if (report.dryRun) {
      console.log(`  active currencies: ${row.supportedCurrencyCount}`);
      console.log(`  existing rate records: ${row.existingRateRecords}`);
      console.log(`  invalid rate records: ${row.invalidRateRecords}`);
      console.log(`  missing rates: ${row.missingCount}`);
      if (row.missing.length) console.log(`    ${row.missing.join(', ')}`);
      continue;
    }

    console.log(
      `  rates created: ${row.created.length}; updated: ${row.updated.length}; preserved: ${row.preservedCount}`
    );
    console.log(`  missing (provider could not supply): ${row.missing.length}`);
    if (row.missing.length) console.log(`    ${row.missing.join(', ')}`);
    console.log(`  FX accounts: ${row.fxAccounts}`);
    if (row.overview?.error) console.log(`  overview error: ${row.overview.error}`);
    if (row.provider?.error) console.log(`  provider note: ${row.provider.error}`);
  }
  console.log('');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const asOfDate = opts.asOf ? new Date(opts.asOf) : new Date();
  if (Number.isNaN(asOfDate.getTime())) {
    throw new Error(`Invalid --as-of date: ${opts.asOf}`);
  }

  const { companies, user } = await resolveTargets(opts);
  if (!companies.length) {
    console.log('No target companies found. Nothing to do.');
    return;
  }

  const providerStatus = require('../services/exchangeRateProvider').getProviderStatus();
  const report = {
    dryRun: opts.dryRun,
    asOfDate: asOfDate.toISOString().slice(0, 10),
    overwrite: opts.overwrite,
    user: user ? { id: user.id, email: user.email } : null,
    provider: providerStatus,
    companies: [],
  };

  let failures = 0;
  for (const company of companies) {
    try {
      if (opts.dryRun) {
        const inspection = await inspectCompany(company.id, asOfDate);
        report.companies.push(inspection);
        continue;
      }

      // Never change an existing base during backfill; resolveBaseCurrency is
      // only used to surface a missing base clearly before initializing.
      await resolveBaseCurrency({
        companyId: company.id,
        client: prisma,
        allowFallback: true,
      });

      const initialized = await initializeCompany(company, user?.id || null, opts, asOfDate);
      report.companies.push(initialized);
    } catch (err) {
      failures += 1;
      report.companies.push({
        companyId: company.id,
        name: company.name,
        error: err.message,
      });
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(report);
  }

  if (failures) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(`backfill failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
