'use strict';

/**
 * One-time (idempotent) HS code back-fill for Import RFQ / PO lines.
 *
 * For RFQ lines on RFQs not Converted to PO / Cancelled / Expired:
 *   if line hs_code empty and product master has a valid HS → copy + audit.
 * For PO lines on POs not Cancelled (and parent RFQ not Converted is N/A — use PO status):
 *   if line hs_code empty and product has HS → copy + audit.
 *
 * Usage:
 *   node scripts/cleanup-import-hs-code-backfill.js
 */

const prisma = require('../prisma/client');

function isValidHsCode(code) {
  if (code == null || String(code).trim() === '') return false;
  const raw = String(code).trim();
  if (!/^[\d.]+$/.test(raw)) return false;
  const digits = raw.replace(/\./g, '');
  return digits.length >= 6 && digits.length <= 10;
}

const RFQ_SKIP = new Set(['Converted to PO', 'PO Created', 'Cancelled', 'Expired']);
const PO_SKIP = new Set(['Cancelled', 'Canceled']);

async function main() {
  const summary = { rfqLines: 0, poLines: 0, rfqs: new Set(), pos: new Set() };

  const rfqs = await prisma.importRfq.findMany({
    where: { NOT: { status: { in: [...RFQ_SKIP] } } },
    include: { items: true },
  });

  for (const rfq of rfqs) {
    const empty = (rfq.items || []).filter(
      (it) => (!it.hsCode || !String(it.hsCode).trim()) && it.productId
    );
    if (!empty.length) continue;

    const productIds = [...new Set(empty.map((it) => it.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, hsCode: true },
    });
    const hsById = Object.fromEntries(
      products.map((p) => [p.id, p.hsCode ? String(p.hsCode).trim() : ''])
    );

    for (const it of empty) {
      const master = hsById[it.productId];
      if (!master || !isValidHsCode(master)) continue;

      await prisma.importRfqItem.update({
        where: { id: it.id },
        data: { hsCode: master },
      });
      await prisma.importAuditLog.create({
        data: {
          companyId: rfq.companyId,
          action: 'UPDATE',
          entityType: 'IMPORT_RFQ',
          entityId: rfq.id,
          details: {
            reason: 'legacy HS code back-fill',
            itemId: it.id,
            productId: it.productId,
            productName: it.productName,
            previousHsCode: it.hsCode || null,
            nextHsCode: master,
            at: new Date().toISOString(),
          },
        },
      });
      summary.rfqLines += 1;
      summary.rfqs.add(rfq.rfqNumber);
    }
  }

  const pos = await prisma.importPurchaseOrder.findMany({
    where: { NOT: { status: { in: [...PO_SKIP] } } },
    include: { items: true },
  });

  for (const po of pos) {
    // Skip POs already past conversion that somehow stay — also skip if RFQ converted is fine; we back-fill open POs
    const empty = (po.items || []).filter(
      (it) => (!it.hsCode || !String(it.hsCode).trim()) && it.productId
    );
    if (!empty.length) continue;

    const productIds = [...new Set(empty.map((it) => it.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, hsCode: true },
    });
    const hsById = Object.fromEntries(
      products.map((p) => [p.id, p.hsCode ? String(p.hsCode).trim() : ''])
    );

    for (const it of empty) {
      const master = hsById[it.productId];
      if (!master || !isValidHsCode(master)) continue;

      try {
        await prisma.importPurchaseOrderItem.update({
          where: { id: it.id },
          data: { hsCode: master },
        });
      } catch (e) {
        // Column may not exist yet
        if (String(e.message || '').includes('hs_code') || e.code === 'P2022') {
          console.warn('PO hs_code column missing — run apply-import-po-item-hs-migration.js first');
          throw e;
        }
        throw e;
      }

      await prisma.importAuditLog.create({
        data: {
          companyId: po.companyId,
          action: 'UPDATE',
          entityType: 'IMPORT_PO',
          entityId: po.id,
          details: {
            reason: 'legacy HS code back-fill',
            itemId: it.id,
            productId: it.productId,
            productName: it.productName,
            previousHsCode: it.hsCode || null,
            nextHsCode: master,
            at: new Date().toISOString(),
          },
        },
      });
      summary.poLines += 1;
      summary.pos.add(po.poNumber);
    }
  }

  console.log('=== Legacy HS code back-fill ===');
  console.log(`RFQ lines updated: ${summary.rfqLines} (RFQs: ${[...summary.rfqs].join(', ') || 'none'})`);
  console.log(`PO lines updated:  ${summary.poLines} (POs: ${[...summary.pos].join(', ') || 'none'})`);
  if (!summary.rfqLines && !summary.poLines) {
    console.log('No empty HS lines needed back-fill (idempotent re-run is a no-op).');
  }
}

main()
  .catch((err) => {
    console.error('Cleanup failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
