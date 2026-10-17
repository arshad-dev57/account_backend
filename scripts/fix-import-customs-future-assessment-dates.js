'use strict';

/**
 * One-time idempotent fix: customs entries whose assessmentDate is in the future
 * are corrected to the calendar date of the "Assessed" audit (or assessedAt / createdAt).
 * Logs ImportAuditLog action ASSESSMENT_DATE_CORRECTED with userId null ("System").
 *
 * Run: node scripts/fix-import-customs-future-assessment-dates.js
 */

const prisma = require('../prisma/client');
const { parseDateOnly, toDbDateOnly, toDateInputValue } = require('../utils/importFx');

function isAssessedAudit(details) {
  if (!details || typeof details !== 'object') return false;
  const to = details.to ?? details.nextStatus ?? details.clearanceStatus;
  return String(to || '') === 'Assessed';
}

async function main() {
  const today = parseDateOnly(new Date());
  if (!today) throw new Error('Could not resolve today');

  const rows = await prisma.importCustomsClearance.findMany({
    where: { assessmentDate: { not: null } },
    select: {
      id: true,
      companyId: true,
      entryNumber: true,
      billOfEntryNo: true,
      assessmentDate: true,
      assessedAt: true,
      createdAt: true,
    },
  });

  const candidates = rows.filter((r) => {
    const ad = parseDateOnly(r.assessmentDate);
    return ad && ad.getTime() > today.getTime();
  });

  console.log(`Found ${candidates.length} customs entry(ies) with future assessment date(s).`);

  let corrected = 0;
  let skipped = 0;
  const summary = [];

  for (const row of candidates) {
    const prior = await prisma.importAuditLog.findFirst({
      where: {
        entityType: 'IMPORT_CUSTOMS',
        entityId: row.id,
        action: 'ASSESSMENT_DATE_CORRECTED',
      },
      orderBy: { createdAt: 'desc' },
    });

    const audits = await prisma.importAuditLog.findMany({
      where: {
        entityType: 'IMPORT_CUSTOMS',
        entityId: row.id,
        action: 'STATUS_CHANGE',
      },
      orderBy: { createdAt: 'asc' },
    });
    const assessedAudit = audits.find((a) => isAssessedAudit(a.details));

    const sourceInstant =
      assessedAudit?.createdAt || row.assessedAt || row.createdAt;
    const correctedDate = toDbDateOnly(sourceInstant);
    if (!correctedDate) {
      console.warn(`  skip ${row.entryNumber}: could not resolve correction date`);
      skipped += 1;
      continue;
    }

    // Idempotent: if already corrected to a non-future date matching source, skip
    const current = parseDateOnly(row.assessmentDate);
    const target = parseDateOnly(correctedDate);
    if (
      prior &&
      current &&
      target &&
      current.getTime() === target.getTime() &&
      current.getTime() <= today.getTime()
    ) {
      skipped += 1;
      summary.push({
        entryNumber: row.entryNumber,
        billOfEntryNo: row.billOfEntryNo,
        status: 'already_corrected',
        assessmentDate: toDateInputValue(row.assessmentDate),
      });
      continue;
    }

    const previousIso = toDateInputValue(row.assessmentDate);
    const nextIso = toDateInputValue(correctedDate);

    await prisma.importCustomsClearance.update({
      where: { id: row.id },
      data: { assessmentDate: correctedDate },
    });

    await prisma.importAuditLog.create({
      data: {
        companyId: row.companyId,
        action: 'ASSESSMENT_DATE_CORRECTED',
        entityType: 'IMPORT_CUSTOMS',
        entityId: row.id,
        details: {
          // Additive note (label already says "Assessment date corrected")
          note: `Corrected from ${previousIso} to ${nextIso}`,
          previousAssessmentDate: previousIso,
          correctedAssessmentDate: nextIso,
          source: assessedAudit
            ? 'assessed_audit'
            : row.assessedAt
              ? 'assessed_at'
              : 'created_at',
        },
        userId: null,
      },
    });

    corrected += 1;
    summary.push({
      entryNumber: row.entryNumber,
      billOfEntryNo: row.billOfEntryNo,
      status: 'corrected',
      previousAssessmentDate: previousIso,
      correctedAssessmentDate: nextIso,
    });
    console.log(
      `  ✓ ${row.entryNumber} (${row.billOfEntryNo}): ${previousIso} → ${nextIso}`
    );
  }

  console.log('\n--- Summary ---');
  console.log(JSON.stringify({ corrected, skipped, totalCandidates: candidates.length, rows: summary }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
