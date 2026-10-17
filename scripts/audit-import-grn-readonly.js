'use strict';

/**
 * Read-only Import GRN audit.
 * Does NOT delete, merge, repost, or alter inventory/accounting.
 *
 * Usage: node scripts/audit-import-grn-readonly.js [poRef]
 */

const prisma = require('../prisma/client');
const { toNumber, IMPORT_GRN_POSTED_STATUSES } = require('../services/importService');

async function main() {
  const poRefFilter = process.argv[2] || null;
  const where = poRefFilter
    ? {
        OR: [
          { poRef: { contains: poRefFilter, mode: 'insensitive' } },
          { importPo: { poNumber: { contains: poRefFilter, mode: 'insensitive' } } },
        ],
      }
    : {};

  const grns = await prisma.importGrn.findMany({
    where,
    include: { items: true, importPo: { include: { items: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const report = {
    generatedAt: new Date().toISOString(),
    filter: poRefFilter || 'ALL',
    scanned: grns.length,
    issues: [],
    duplicateGroups: [],
    notes: [
      'This report is read-only. Do not auto-repost missing stock without reconciling each receipt.',
      'Historical Inspected GRNs without stockPostedAt / stock movements need manual reconciliation.',
    ],
  };

  const byPo = {};
  for (const g of grns) {
    const key = g.importPoId || g.poRef || g.id;
    if (!byPo[key]) byPo[key] = [];
    byPo[key].push(g);

    for (const it of g.items) {
      if (toNumber(it.orderedQty) <= 0) {
        report.issues.push({
          type: 'ZERO_ORDERED_QTY',
          grnNumber: g.grnNumber,
          productName: it.productName,
          productId: it.productId,
        });
      }
    }

    if (IMPORT_GRN_POSTED_STATUSES.includes(g.status) && !g.stockPostedAt) {
      const moves = await prisma.stockMovement.count({
        where: {
          companyId: g.companyId,
          reference: g.grnNumber,
          type: 'Goods Receiving',
        },
      });
      if (moves === 0) {
        report.issues.push({
          type: 'MISSING_STOCK_MOVEMENT',
          grnNumber: g.grnNumber,
          poRef: g.poRef,
          status: g.status,
          locationId: g.locationId,
          items: g.items.map((i) => ({
            productId: i.productId,
            productName: i.productName,
            acceptedQty: toNumber(i.acceptedQty || i.receivedQty),
          })),
        });
      }
    }
  }

  for (const [poKey, list] of Object.entries(byPo)) {
    const posted = list.filter((g) => IMPORT_GRN_POSTED_STATUSES.includes(g.status));
    if (posted.length > 1) {
      report.duplicateGroups.push({
        importPoKey: poKey,
        poRef: posted[0].poRef,
        postedCount: posted.length,
        grnNumbers: posted.map((g) => g.grnNumber),
      });
    }
  }

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
