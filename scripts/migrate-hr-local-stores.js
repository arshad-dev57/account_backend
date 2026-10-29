#!/usr/bin/env node
'use strict';

/**
 * Import the shifts and holidays that were kept in the web app's local
 * `.hr-data` JSON files into the HR backend tables (hr_shifts, hr_holidays),
 * which is what the Shift Type and Holiday List screens now read.
 *
 * Rows whose id still carries the old `_seed_` prefix were demo fixtures, not
 * user data, and are skipped unless --include-demo is passed.
 *
 * Usage:
 *   node scripts/migrate-hr-local-stores.js --email customer461@gmail.com --dry-run
 *   node scripts/migrate-hr-local-stores.js --company-id <uuid>
 *   node scripts/migrate-hr-local-stores.js --all --dir ../accounting-web-app/.hr-data
 *
 * Flags:
 *   --email <email>      Every company the user can access
 *   --company-id <uuid>  A single company
 *   --all                Every active company
 *   --dir <path>         Folder holding hr-shifts.json / hr-holidays.json
 *   --include-demo       Also import the `_seed_` demo fixtures
 *   --dry-run            Read-only report; nothing is written
 *   --json               Print the report as JSON
 *   --help               Show this help
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const prisma = require('../prisma/client');
const { normalizeClock } = require('../utils/clock');

const HELP = `Local HR store -> backend migration (idempotent)

Usage:
  node scripts/migrate-hr-local-stores.js --email <email> [--dry-run]
  node scripts/migrate-hr-local-stores.js --company-id <uuid>
  node scripts/migrate-hr-local-stores.js --all

Flags:
  --email <email>      Every company the user can access
  --company-id <uuid>  A single company
  --all                Every active company
  --dir <path>         Folder holding hr-shifts.json / hr-holidays.json
  --include-demo       Also import the "_seed_" demo fixtures
  --dry-run            Read-only report; nothing is written
  --json               Print the report as JSON
  --help               Show this help
`;

const DEMO_TYPES = { National: 'Public', Religious: 'Public', Company: 'Private' };

function parseArgs(argv) {
  const opts = {
    email: null,
    companyId: null,
    all: false,
    dir: path.join(__dirname, '..', '..', 'accounting-web-app', '.hr-data'),
    includeDemo: false,
    dryRun: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) throw new Error(`Unknown argument: ${raw}`);
    const [flag, inline] = raw.slice(2).split('=');
    const key = flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

    if (key === 'email' || key === 'companyId' || key === 'dir') {
      const value = inline !== undefined ? inline : argv[++i];
      if (!value || String(value).startsWith('--')) throw new Error(`--${flag} requires a value`);
      opts[key] = String(value).trim();
      continue;
    }
    if (key === 'all') opts.all = true;
    else if (key === 'includeDemo') opts.includeDemo = true;
    else if (key === 'dryRun') opts.dryRun = true;
    else if (key === 'json') opts.json = true;
    else if (key === 'help') opts.help = true;
    else throw new Error(`Unknown flag: --${flag}`);
  }
  return opts;
}

function readJson(file) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(full, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function resolveTargets(opts) {
  if (opts.companyId) {
    const company = await prisma.company.findUnique({
      where: { id: opts.companyId },
      select: { id: true, name: true },
    });
    if (!company) throw new Error(`Company not found: ${opts.companyId}`);
    return [company];
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
          select: { id: true, name: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    if (!companies.length) throw new Error(`No company for ${user.email}`);
    return companies;
  }

  if (opts.all) {
    return prisma.company.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  throw new Error('Pass --email, --company-id or --all');
}

async function migrateShifts(companyId, rows, opts) {
  const report = { created: [], skipped: [] };
  for (const row of rows) {
    if (!opts.includeDemo && String(row.id || '').includes('_seed_')) {
      report.skipped.push(`${row.name} (demo fixture)`);
      continue;
    }
    const name = String(row.name || '').trim();
    if (!name) {
      report.skipped.push('unnamed row');
      continue;
    }
    const startTime = normalizeClock(row.startTime);
    const endTime = normalizeClock(row.endTime);
    if (!startTime || !endTime) {
      report.skipped.push(`${name} (unreadable timing)`);
      continue;
    }

    const existing = await prisma.hrShift.findFirst({
      where: { companyId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      report.skipped.push(`${name} (already in the backend)`);
      continue;
    }
    if (opts.dryRun) {
      report.created.push(`${name} ${startTime}-${endTime} (would insert)`);
      continue;
    }

    const created = await prisma.hrShift.create({
      data: {
        companyId,
        name,
        startTime,
        endTime,
        graceMinutes: Math.max(0, parseInt(String(row.graceMinutes ?? 15), 10) || 0),
        status: String(row.status) === 'Inactive' ? 'Inactive' : 'Active',
      },
    });
    report.created.push(`${created.name} ${created.startTime}-${created.endTime}`);
  }
  return report;
}

async function migrateHolidays(companyId, rows, opts) {
  const report = { created: [], skipped: [] };
  for (const row of rows) {
    if (!opts.includeDemo && String(row.id || '').includes('_seed_')) {
      report.skipped.push(`${row.name} (demo fixture)`);
      continue;
    }
    const name = String(row.name || '').trim();
    const date = String(row.date || '').slice(0, 10);
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      report.skipped.push(`${name || 'unnamed'} (no valid date)`);
      continue;
    }

    const existing = await prisma.hrHoliday.findFirst({
      where: { companyId, name: { equals: name, mode: 'insensitive' }, date: new Date(`${date}T00:00:00.000Z`) },
      select: { id: true },
    });
    if (existing) {
      report.skipped.push(`${name} ${date} (already in the backend)`);
      continue;
    }
    if (opts.dryRun) {
      report.created.push(`${name} ${date} (would insert)`);
      continue;
    }

    const created = await prisma.hrHoliday.create({
      data: {
        companyId,
        name,
        date: new Date(`${date}T00:00:00.000Z`),
        type: DEMO_TYPES[String(row.type)] || (['Public', 'Private', 'Optional', 'Weekly Off'].includes(row.type) ? row.type : 'Public'),
        optional: Boolean(row.optional),
      },
    });
    report.created.push(`${created.name} ${date}`);
  }
  return report;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const shiftsFile = path.join(opts.dir, 'hr-shifts.json');
  const holidaysFile = path.join(opts.dir, 'hr-holidays.json');
  const shifts = readJson(shiftsFile);
  const holidays = readJson(holidaysFile);

  if (!shifts.length && !holidays.length) {
    console.log(`Nothing to import from ${path.resolve(opts.dir)}`);
    return;
  }

  const companies = await resolveTargets(opts);
  const report = [];

  for (const company of companies) {
    const shiftReport = await migrateShifts(company.id, shifts, opts);
    const holidayReport = await migrateHolidays(company.id, holidays, opts);
    report.push({
      company: `${company.name} (${company.id})`,
      shifts: shiftReport,
      holidays: holidayReport,
    });
  }

  if (opts.json) {
    console.log(JSON.stringify({ dryRun: opts.dryRun, report }, null, 2));
    return;
  }

  for (const entry of report) {
    console.log(`\n${entry.company}`);
    for (const [label, section] of [
      ['shifts', entry.shifts],
      ['holidays', entry.holidays],
    ]) {
      console.log(`  ${label}: ${section.created.length} imported, ${section.skipped.length} skipped`);
      section.created.forEach((line) => console.log(`    + ${line}`));
      section.skipped.forEach((line) => console.log(`    - ${line}`));
    }
  }
  console.log(opts.dryRun ? '\nDry run: nothing written.' : '\nDone. The HR screens read these rows from the backend now.');
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
