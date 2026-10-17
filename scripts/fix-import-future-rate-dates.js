'use strict';

/**
 * One-time idempotent fix: import records whose FX rate date is in the future
 * are corrected to the record's creation date, with an audit entry.
 *
 * Run: node scripts/fix-import-future-rate-dates.js
 */

const prisma = require('../prisma/client');
const { parseDateOnly, toDbDateOnly } = require('../utils/importFx');

function isFutureRateDate(rateDate, today) {
  const d = parseDateOnly(rateDate);
  if (!d) return false;
  return d.getTime() > today.getTime();
}

function fmtDate(d) {
  const x = parseDateOnly(d);
  if (!x) return String(d ?? '');
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function auditOnce({ companyId, entityType, entityId, details }) {
  const existing = await prisma.importAuditLog.findFirst({
    where: {
      companyId,
      entityType,
      entityId,
      action: 'RATE_DATE_CORRECTED',
    },
  });
  if (existing) return false;
  await prisma.importAuditLog.create({
    data: {
      companyId,
      entityType,
      entityId,
      action: 'RATE_DATE_CORRECTED',
      details: {
        note: 'rate date corrected (future date)',
        ...details,
      },
    },
  });
  return true;
}

async function fixModel({
  label,
  findMany,
  update,
  entityType,
  getCompanyId,
  getId,
  getRateDate,
  getCreatedAt,
}) {
  const today = parseDateOnly(new Date());
  const rows = await findMany();
  const future = rows.filter((r) => isFutureRateDate(getRateDate(r), today));
  console.log(`\n=== ${label} ===`);
  console.log(`Scanned: ${rows.length}, future rate dates: ${future.length}`);
  const fixed = [];
  for (const row of future) {
    const id = getId(row);
    const companyId = getCompanyId(row);
    const oldDate = getRateDate(row);
    const newDate = toDbDateOnly(getCreatedAt(row)) || toDbDateOnly(new Date());
    // Prefer updates that select only safe scalars so nullable-column migrations
    // don't break mid-script if the Prisma client is briefly out of date.
    await update(id, newDate);
    const audited = await auditOnce({
      companyId,
      entityType,
      entityId: id,
      details: {
        previousRateDate: oldDate,
        nextRateDate: newDate,
        ref:
          row.poNumber ||
          row.piNumber ||
          row.lcNumber ||
          row.entryNumber ||
          row.billOfEntryNo ||
          id,
      },
    });
    fixed.push({
      id,
      ref: row.poNumber || row.piNumber || row.lcNumber || row.entryNumber || id,
      previousRateDate: oldDate,
      nextRateDate: newDate,
      audited,
    });
    console.log(
      `  - ${fixed[fixed.length - 1].ref}: ${fmtDate(oldDate)} → ${fmtDate(newDate)}${
        audited ? '' : ' (audit already present)'
      }`
    );
  }
  return { scanned: rows.length, future: future.length, fixed };
}

async function main() {
  console.log('Import future rate-date correction (idempotent)');
  console.log(`Today (local calendar): ${fmtDate(new Date())}`);

  const po = await fixModel({
    label: 'Import Purchase Orders',
    entityType: 'IMPORT_PO',
    findMany: () =>
      prisma.importPurchaseOrder.findMany({
        select: {
          id: true,
          companyId: true,
          poNumber: true,
          exchangeRateDate: true,
          createdAt: true,
        },
      }),
    getId: (r) => r.id,
    getCompanyId: (r) => r.companyId,
    getRateDate: (r) => r.exchangeRateDate,
    getCreatedAt: (r) => r.createdAt,
    update: (id, exchangeRateDate) =>
      prisma.importPurchaseOrder.update({
        where: { id },
        data: { exchangeRateDate },
        select: { id: true },
      }),
  });

  const pi = await fixModel({
    label: 'Import Proforma Invoices',
    entityType: 'IMPORT_PI',
    findMany: () =>
      prisma.importProformaInvoice.findMany({
        select: {
          id: true,
          companyId: true,
          piNumber: true,
          exchangeRateDate: true,
          createdAt: true,
        },
      }),
    getId: (r) => r.id,
    getCompanyId: (r) => r.companyId,
    getRateDate: (r) => r.exchangeRateDate,
    getCreatedAt: (r) => r.createdAt,
    update: (id, exchangeRateDate) =>
      prisma.importProformaInvoice.update({
        where: { id },
        data: { exchangeRateDate },
        select: { id: true },
      }),
  });

  const lc = await fixModel({
    label: 'Import Finance LCs',
    entityType: 'IMPORT_LC',
    findMany: () =>
      prisma.importFinanceLc.findMany({
        select: {
          id: true,
          companyId: true,
          lcNumber: true,
          exchangeRateDate: true,
          createdAt: true,
        },
      }),
    getId: (r) => r.id,
    getCompanyId: (r) => r.companyId,
    getRateDate: (r) => r.exchangeRateDate,
    getCreatedAt: (r) => r.createdAt,
    update: (id, exchangeRateDate) =>
      prisma.importFinanceLc.update({
        where: { id },
        data: { exchangeRateDate },
        select: { id: true },
      }),
  });

  const customs = await fixModel({
    label: 'Import Customs Clearances',
    entityType: 'IMPORT_CUSTOMS',
    findMany: () =>
      prisma.importCustomsClearance.findMany({
        select: {
          id: true,
          companyId: true,
          entryNumber: true,
          billOfEntryNo: true,
          exchangeRateDate: true,
          createdAt: true,
        },
      }),
    getId: (r) => r.id,
    getCompanyId: (r) => r.companyId,
    getRateDate: (r) => r.exchangeRateDate,
    getCreatedAt: (r) => r.createdAt,
    update: (id, exchangeRateDate) =>
      prisma.importCustomsClearance.update({
        where: { id },
        data: { exchangeRateDate },
        select: { id: true },
      }),
  });

  console.log('\n========== SUMMARY ==========');
  console.log(`PO:      scanned ${po.scanned}, fixed ${po.fixed.length}`);
  console.log(`PI:      scanned ${pi.scanned}, fixed ${pi.fixed.length}`);
  console.log(`LC:      scanned ${lc.scanned}, fixed ${lc.fixed.length}`);
  console.log(`Customs: scanned ${customs.scanned}, fixed ${customs.fixed.length}`);
  console.log(
    `Total fixed: ${po.fixed.length + pi.fixed.length + lc.fixed.length + customs.fixed.length}`
  );
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
