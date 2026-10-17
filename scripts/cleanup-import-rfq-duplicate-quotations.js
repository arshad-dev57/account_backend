'use strict';

/**
 * One-time (idempotent) cleanup: one active quotation per supplier per RFQ.
 *
 * For each RFQ not in "Converted to PO", if a supplier has more than one active
 * quotation (status not Superseded/Expired), keep the selected quotation (or the
 * latest by createdAt if none selected) and mark older ones Superseded.
 *
 * Usage:
 *   node scripts/cleanup-import-rfq-duplicate-quotations.js
 */

const prisma = require('../prisma/client');

const INACTIVE = new Set(['Superseded', 'Expired']);

function supplierKey(q) {
  if (q.supplierId) return `id:${q.supplierId}`;
  return `name:${String(q.supplierName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()}`;
}

function isActive(q) {
  return !INACTIVE.has(String(q.status || ''));
}

async function main() {
  const rfqs = await prisma.importRfq.findMany({
    where: {
      NOT: {
        OR: [{ status: 'Converted to PO' }, { status: 'PO Created' }],
      },
    },
    include: {
      quotations: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const summary = [];
  let supersededCount = 0;

  for (const rfq of rfqs) {
    const active = (rfq.quotations || []).filter(isActive);
    const bySupplier = new Map();
    for (const q of active) {
      const key = supplierKey(q);
      if (!bySupplier.has(key)) bySupplier.set(key, []);
      bySupplier.get(key).push(q);
    }

    const rfqChanges = [];

    for (const [key, group] of bySupplier.entries()) {
      if (group.length < 2) continue;

      let keep =
        (rfq.selectedQuotationId &&
          group.find((q) => q.id === rfq.selectedQuotationId)) ||
        null;
      if (!keep) {
        keep = [...group].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )[0];
      }

      const toSupersede = group.filter((q) => q.id !== keep.id);
      for (const old of toSupersede) {
        // Idempotent: skip if already superseded
        if (String(old.status) === 'Superseded') continue;

        await prisma.$transaction(async (tx) => {
          await tx.importSupplierQuotation.update({
            where: { id: old.id },
            data: {
              status: 'Superseded',
              supersededById: keep.id,
            },
          });

          // Link keeper as revision of the oldest superseded in the chain if unset
          if (!keep.supersedesId && !old.supersedesId) {
            await tx.importSupplierQuotation.update({
              where: { id: keep.id },
              data: {
                supersedesId: old.id,
                revision: Math.max(Number(keep.revision) || 1, (Number(old.revision) || 1) + 1),
              },
            });
          }

          await tx.importAuditLog.create({
            data: {
              companyId: rfq.companyId,
              action: 'STATUS_CHANGE',
              entityType: 'IMPORT_QUOTATION',
              entityId: old.id,
              details: {
                reason: 'legacy duplicate cleanup',
                previousStatus: old.status,
                nextStatus: 'Superseded',
                rfqId: rfq.id,
                rfqNumber: rfq.rfqNumber,
                keptQuotationId: keep.id,
                keptQuotationNumber: keep.quotationNumber,
                supersededQuotationNumber: old.quotationNumber,
                supplierKey: key,
                at: new Date().toISOString(),
              },
            },
          });
        });

        supersededCount += 1;
        rfqChanges.push({
          superseded: old.quotationNumber,
          kept: keep.quotationNumber,
          supplier: old.supplierName,
        });
      }
    }

    if (rfqChanges.length) {
      summary.push({
        rfqNumber: rfq.rfqNumber,
        rfqId: rfq.id,
        status: rfq.status,
        changes: rfqChanges,
      });

      await prisma.importAuditLog.create({
        data: {
          companyId: rfq.companyId,
          action: 'STATUS_CHANGE',
          entityType: 'IMPORT_RFQ',
          entityId: rfq.id,
          details: {
            reason: 'legacy duplicate cleanup',
            previousStatus: rfq.status,
            nextStatus: rfq.status,
            supersededCount: rfqChanges.length,
            changes: rfqChanges,
            at: new Date().toISOString(),
          },
        },
      });
    }
  }

  console.log('=== Legacy duplicate quotation cleanup ===');
  console.log(`RFQs scanned (excl. Converted to PO): ${rfqs.length}`);
  console.log(`RFQs affected: ${summary.length}`);
  console.log(`Quotations superseded: ${supersededCount}`);
  if (summary.length) {
    console.log('Details:');
    for (const row of summary) {
      console.log(
        `  ${row.rfqNumber} [${row.status}]: ${row.changes
          .map((c) => `${c.superseded} → Superseded (kept ${c.kept}, ${c.supplier})`)
          .join('; ')}`
      );
    }
  } else {
    console.log('No duplicate active quotations found (idempotent re-run is a no-op).');
  }
}

main()
  .catch((err) => {
    console.error('Cleanup failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
