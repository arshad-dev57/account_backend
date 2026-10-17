'use strict';

/**
 * Approval-gated corrections for historical JEs that posted Inventory
 * movements to Prepaid Expenses (1300) instead of Inventory (1200).
 *
 * NEVER posts unless authorize === true AND confirmPost === true.
 * Idempotent via reference CORR-INVMAP-{sourceEntryNumber}.
 */

const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');
const BalanceCalculator = require('../utils/balanceCalculator');

const PREVIEW_PATH = path.join(
  __dirname,
  '..',
  'reports',
  'inventory-account-correction-preview.json'
);

async function buildCorrectionPreview({ writeFile = true } = {}) {
  const prepaid = await prisma.chartOfAccount.findMany({
    where: { code: '1300', name: { contains: 'Prepaid', mode: 'insensitive' } },
    select: { id: true, companyId: true },
  });
  const invByCo = Object.fromEntries(
    (
      await prisma.chartOfAccount.findMany({
        where: { code: '1200', isActive: true },
        select: { id: true, companyId: true, code: true, name: true },
      })
    ).map((a) => [a.companyId, a])
  );

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: { in: prepaid.map((p) => p.id) },
      journal: { status: 'Posted' },
    },
    include: {
      journal: {
        select: {
          id: true,
          entryNumber: true,
          reference: true,
          description: true,
          companyId: true,
          date: true,
        },
      },
    },
  });

  const corrections = [];
  const seen = new Set();
  for (const l of lines) {
    const je = l.journal;
    if (seen.has(je.id)) continue;
    const credit = Number(l.credit) || 0;
    const debit = Number(l.debit) || 0;
    let kind = null;
    if (
      /-COGS$/i.test(je.reference || '') ||
      /^JE-COGS-/i.test(je.entryNumber) ||
      /COGS\s*[—-]/.test(je.description || '')
    ) {
      if (credit > 0) kind = 'COGS_CREDIT_PREPAID_SHOULD_BE_INVENTORY';
    } else if (
      /^PI-/i.test(je.reference || '') ||
      /Purchase Invoice/i.test(je.description || '')
    ) {
      if (debit > 0) kind = 'PURCHASE_DEBIT_PREPAID_SHOULD_BE_INVENTORY';
    } else if (
      /stock (in|out)/i.test(je.description || '') ||
      /^JE-STOCK/i.test(je.entryNumber)
    ) {
      kind =
        debit > 0
          ? 'STOCK_DEBIT_PREPAID_SHOULD_BE_INVENTORY'
          : credit > 0
            ? 'STOCK_CREDIT_PREPAID_SHOULD_BE_INVENTORY'
            : null;
    } else if (
      /POS/i.test(je.description || '') &&
      /COGS|cost of goods/i.test(je.description || '') &&
      credit > 0
    ) {
      kind = 'POS_COGS_CREDIT_PREPAID_SHOULD_BE_INVENTORY';
    }
    if (!kind) continue;
    seen.add(je.id);
    const inv = invByCo[je.companyId];
    const amount = credit > 0 ? credit : debit;
    if (!inv || !(amount > 0)) continue;

    const correctionReference = `CORR-INVMAP-${je.entryNumber}`;
    const already = await prisma.journalEntry.findFirst({
      where: { companyId: je.companyId, reference: correctionReference, status: 'Posted' },
      select: { id: true, entryNumber: true },
    });

    corrections.push({
      companyId: je.companyId,
      sourceJournalId: je.id,
      sourceEntryNumber: je.entryNumber,
      sourceReference: je.reference,
      sourceDescription: (je.description || '').slice(0, 160),
      sourceDate: je.date,
      kind,
      amount,
      prepaidDebit: debit,
      prepaidCredit: credit,
      prepaidAccountId: l.accountId,
      inventoryAccountId: inv.id,
      correctionReference,
      alreadyCorrected: Boolean(already),
      existingCorrectionId: already?.id || null,
      proposedLines:
        credit > 0
          ? [
              {
                accountId: l.accountId,
                accountCode: '1300',
                accountName: 'Prepaid Expenses',
                debit: amount,
                credit: 0,
              },
              {
                accountId: inv.id,
                accountCode: '1200',
                accountName: inv.name,
                debit: 0,
                credit: amount,
              },
            ]
          : [
              {
                accountId: inv.id,
                accountCode: '1200',
                accountName: inv.name,
                debit: amount,
                credit: 0,
              },
              {
                accountId: l.accountId,
                accountCode: '1300',
                accountName: 'Prepaid Expenses',
                debit: 0,
                credit: amount,
              },
            ],
      reason:
        credit > 0
          ? 'Move erroneous credit from Prepaid Expenses (1300) to Inventory (1200)'
          : 'Move erroneous debit from Prepaid Expenses (1300) to Inventory (1200)',
    });
  }

  const pending = corrections.filter((c) => !c.alreadyCorrected);
  const byKind = {};
  let totalAmount = 0;
  for (const c of pending) {
    byKind[c.kind] = (byKind[c.kind] || 0) + 1;
    totalAmount += c.amount;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    status: 'AWAITING_EXPLICIT_AUTHORIZATION',
    doNotAutoPost: true,
    summary: {
      totalDetected: corrections.length,
      alreadyCorrected: corrections.length - pending.length,
      pending: pending.length,
      byKind,
      totalAmountPending: totalAmount,
    },
    knownSaleExample:
      corrections.find(
        (c) =>
          c.sourceEntryNumber === 'JE-COGS-1792134748648' ||
          c.sourceReference === 'SI-20261016-4114-COGS'
      ) || null,
    corrections: pending,
  };

  if (writeFile) {
    fs.mkdirSync(path.dirname(PREVIEW_PATH), { recursive: true });
    fs.writeFileSync(PREVIEW_PATH, JSON.stringify(out, null, 2));
  }
  return out;
}

/**
 * @param {{ authorize: boolean, confirmPost: boolean, dryRun?: boolean, companyId?: string, limit?: number }} opts
 */
async function applyCorrections(opts = {}) {
  const {
    authorize = false,
    confirmPost = false,
    dryRun = true,
    companyId = null,
    limit = null,
    userId = 'SYSTEM-CORRECTION',
  } = opts;

  if (!authorize) {
    const err = new Error(
      'Refused: set authorize=true only after explicit management approval'
    );
    err.statusCode = 403;
    throw err;
  }

  const preview = await buildCorrectionPreview({ writeFile: true });
  let list = preview.corrections;
  if (companyId) list = list.filter((c) => c.companyId === companyId);
  if (limit != null) list = list.slice(0, Number(limit));

  if (dryRun || !confirmPost) {
    return {
      mode: 'DRY_RUN',
      wouldPost: list.length,
      sample: list.slice(0, 5),
      summary: preview.summary,
      message:
        'Dry run only. Re-run with authorize=true, confirmPost=true, dryRun=false to post.',
    };
  }

  const posted = [];
  for (const c of list) {
    const existing = await prisma.journalEntry.findFirst({
      where: {
        companyId: c.companyId,
        reference: c.correctionReference,
        status: 'Posted',
      },
    });
    if (existing) {
      posted.push({ skipped: true, reason: 'already_corrected', id: existing.id });
      continue;
    }

    const je = await prisma.$transaction(async (tx) => {
      const created = await tx.journalEntry.create({
        data: {
          entryNumber: `JE-CORR-INVMAP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          date: new Date(),
          description: `Inventory account mapping correction for ${c.sourceEntryNumber}: ${c.reason}`,
          reference: c.correctionReference,
          status: 'Posted',
          type: 'Adjustment',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          companyId: c.companyId,
          lines: {
            create: c.proposedLines.map((line) => ({
              accountId: line.accountId,
              accountName: line.accountName,
              accountCode: line.accountCode,
              debit: line.debit,
              credit: line.credit,
            })),
          },
        },
        include: { lines: true },
      });
      await BalanceCalculator.applyJournalLines(tx, created.lines);
      return created;
    });
    posted.push({
      skipped: false,
      id: je.id,
      entryNumber: je.entryNumber,
      reference: je.reference,
      amount: c.amount,
      sourceEntryNumber: c.sourceEntryNumber,
    });
  }

  return { mode: 'EXECUTED', postedCount: posted.filter((p) => !p.skipped).length, posted };
}

module.exports = {
  buildCorrectionPreview,
  applyCorrections,
  PREVIEW_PATH,
};
