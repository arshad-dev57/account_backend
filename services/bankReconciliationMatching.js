/**
 * Multi-match engine for bank reconciliation (1:1, 1:N, N:1).
 * Allocations are absolute amounts; direction is validated separately.
 */

const crypto = require('crypto');
const prisma = require('../prisma/client');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((toNum(n) + Number.EPSILON) * 100) / 100;
}

function nearlyEqual(a, b, tol = 0.005) {
  return Math.abs(toNum(a) - toNum(b)) <= tol;
}

function stmtMagnitude(txn) {
  if (toNum(txn.credit) > 0) return round2(txn.credit);
  if (toNum(txn.debit) > 0) return round2(txn.debit);
  return round2(Math.abs(txn.amount));
}

function lineMagnitude(line) {
  if (toNum(line.debit) > 0) return round2(line.debit);
  if (toNum(line.credit) > 0) return round2(line.credit);
  return 0;
}

function stmtDirection(txn) {
  // bank credit = inflow; bank debit = outflow
  if (toNum(txn.credit) > 0 || toNum(txn.amount) > 0) return 'in';
  return 'out';
}

function lineDirection(line) {
  // asset bank: debit = inflow, credit = outflow
  if (toNum(line.debit) > 0) return 'in';
  return 'out';
}

async function allocatedOnStatement(statementTransactionId, tx = prisma) {
  const rows = await tx.bankReconciliationMatch.findMany({
    where: { statementTransactionId, isActive: true },
    select: { allocatedAmount: true },
  });
  return round2(rows.reduce((s, r) => s + toNum(r.allocatedAmount), 0));
}

async function allocatedOnLine(journalLineId, tx = prisma) {
  const rows = await tx.bankReconciliationMatch.findMany({
    where: { journalLineId, isActive: true },
    select: { allocatedAmount: true },
  });
  return round2(rows.reduce((s, r) => s + toNum(r.allocatedAmount), 0));
}

async function remainingOnStatement(txn, tx = prisma) {
  const used = await allocatedOnStatement(txn.id, tx);
  return round2(Math.max(0, stmtMagnitude(txn) - used));
}

async function remainingOnLine(line, tx = prisma) {
  const used = await allocatedOnLine(line.id, tx);
  return round2(Math.max(0, lineMagnitude(line) - used));
}

async function syncStatementStatus(statementTransactionId, tx = prisma) {
  const txn = await tx.bankStatementTransaction.findUnique({
    where: { id: statementTransactionId },
  });
  if (!txn || txn.status === 'ignored') return txn;

  const used = await allocatedOnStatement(statementTransactionId, tx);
  const mag = stmtMagnitude(txn);
  let status = 'unmatched';
  if (used <= 0.005) status = 'unmatched';
  else if (nearlyEqual(used, mag)) status = 'matched';
  else status = 'partially_matched';

  const active = await tx.bankReconciliationMatch.findMany({
    where: { statementTransactionId, isActive: true },
    orderBy: { matchedAt: 'desc' },
    take: 1,
  });

  return tx.bankStatementTransaction.update({
    where: { id: statementTransactionId },
    data: {
      status,
      matchedJournalLineId: active[0]?.journalLineId || null,
    },
  });
}

async function syncJournalLineReconciled(journalLineId, tx = prisma) {
  const line = await tx.journalLine.findUnique({ where: { id: journalLineId } });
  if (!line) return null;
  const used = await allocatedOnLine(journalLineId, tx);
  const mag = lineMagnitude(line);
  const isReconciled = nearlyEqual(used, mag) && mag > 0;
  return tx.journalLine.update({
    where: { id: journalLineId },
    data: { isReconciled },
  });
}

async function writeAudit({ companyId, reconciliationId, actorId, action, details }, tx = prisma) {
  try {
    await tx.bankReconciliationAudit.create({
      data: {
        id: crypto.randomUUID(),
        companyId,
        reconciliationId,
        actorId: actorId || null,
        action,
        details: details || undefined,
      },
    });
  } catch (e) {
    // Never fail the business action solely due to audit write
    console.warn('[bank-recon-audit]', e.message);
  }
}

/**
 * Build allocation pairs for 1:1, 1:N, N:1.
 * Rejects unsupported N:M unless pairwise equal-length zip by remaining amount.
 */
function buildAllocationPairs(stmtRemainders, lineRemainders) {
  const S = stmtRemainders.filter((x) => x.remaining > 0.005);
  const J = lineRemainders.filter((x) => x.remaining > 0.005);
  if (!S.length || !J.length) {
    const err = new Error('Nothing left to match on selected transactions');
    err.statusCode = 400;
    throw err;
  }

  const sumS = round2(S.reduce((a, x) => a + x.remaining, 0));
  const sumJ = round2(J.reduce((a, x) => a + x.remaining, 0));
  if (!nearlyEqual(sumS, sumJ)) {
    const err = new Error(
      `Match amounts must balance: bank remaining ${sumS} vs book remaining ${sumJ}`
    );
    err.statusCode = 400;
    throw err;
  }

  const pairs = [];

  if (S.length === 1 && J.length === 1) {
    pairs.push({
      statementTransactionId: S[0].id,
      journalLineId: J[0].id,
      allocatedAmount: S[0].remaining,
    });
    return pairs;
  }

  if (S.length === 1 && J.length > 1) {
    for (const j of J) {
      pairs.push({
        statementTransactionId: S[0].id,
        journalLineId: j.id,
        allocatedAmount: j.remaining,
      });
    }
    return pairs;
  }

  if (S.length > 1 && J.length === 1) {
    for (const s of S) {
      pairs.push({
        statementTransactionId: s.id,
        journalLineId: J[0].id,
        allocatedAmount: s.remaining,
      });
    }
    return pairs;
  }

  // N:M — only when equal counts and each remaining amount pairs uniquely after sort
  if (S.length === J.length) {
    const ss = [...S].sort((a, b) => a.remaining - b.remaining);
    const jj = [...J].sort((a, b) => a.remaining - b.remaining);
    for (let i = 0; i < ss.length; i += 1) {
      if (!nearlyEqual(ss[i].remaining, jj[i].remaining)) {
        const err = new Error(
          'Many-to-many matching requires equal pairwise amounts, or use 1:N / N:1 selections'
        );
        err.statusCode = 400;
        throw err;
      }
      pairs.push({
        statementTransactionId: ss[i].id,
        journalLineId: jj[i].id,
        allocatedAmount: ss[i].remaining,
      });
    }
    return pairs;
  }

  const err = new Error(
    'Unsupported selection. Use one bank line with many book lines, many bank lines with one book line, or equal pairwise amounts.'
  );
  err.statusCode = 400;
  throw err;
}

/**
 * Apply a group match between statement line(s) and journal line(s).
 */
async function applyMatchGroup({
  companyId,
  userId,
  reconciliationId,
  statementTransactionIds,
  journalLineIds,
  matchType = 'manual',
  matchScore = null,
  matchReason = null,
  bankChartOfAccountId,
}) {
  const stmtIds = [...new Set((statementTransactionIds || []).filter(Boolean))];
  const lineIds = [...new Set((journalLineIds || []).filter(Boolean))];
  if (!stmtIds.length || !lineIds.length) {
    const err = new Error('statementTransactionIds and journalLineIds are required');
    err.statusCode = 400;
    throw err;
  }

  const recon = await prisma.bankReconciliation.findFirst({
    where: { id: reconciliationId, companyId },
  });
  if (!recon) {
    const err = new Error('Reconciliation not found');
    err.statusCode = 404;
    throw err;
  }
  if (recon.status === 'Completed') {
    const err = new Error('Completed reconciliation is locked');
    err.statusCode = 400;
    throw err;
  }

  const [txns, lines] = await Promise.all([
    prisma.bankStatementTransaction.findMany({
      where: {
        id: { in: stmtIds },
        companyId,
        bankAccountId: recon.bankAccountId,
      },
    }),
    prisma.journalLine.findMany({
      where: { id: { in: lineIds } },
      include: { journal: true },
    }),
  ]);

  if (txns.length !== stmtIds.length) {
    const err = new Error('One or more statement transactions were not found on this bank account');
    err.statusCode = 404;
    throw err;
  }
  if (lines.length !== lineIds.length) {
    const err = new Error('One or more journal lines were not found');
    err.statusCode = 404;
    throw err;
  }

  for (const line of lines) {
    if (line.journal.companyId !== companyId) {
      const err = new Error('Journal line does not belong to this company');
      err.statusCode = 403;
      throw err;
    }
    if (line.accountId !== bankChartOfAccountId) {
      const err = new Error('Journal line does not belong to this bank account');
      err.statusCode = 400;
      throw err;
    }
    if (line.journal.status !== 'Posted') {
      const err = new Error('Only posted journal lines can be matched');
      err.statusCode = 400;
      throw err;
    }
  }

  for (const txn of txns) {
    if (txn.status === 'ignored') {
      const err = new Error('Ignored statement lines cannot be matched');
      err.statusCode = 400;
      throw err;
    }
    if (txn.status === 'matched') {
      const err = new Error('Statement transaction is already fully matched');
      err.statusCode = 400;
      throw err;
    }
  }

  // Direction: all bank same direction; all book same opposite matching bank inflow↔book debit
  const bankDir = stmtDirection(txns[0]);
  if (!txns.every((t) => stmtDirection(t) === bankDir)) {
    const err = new Error('Selected bank lines must all be the same direction (all inflows or all outflows)');
    err.statusCode = 400;
    throw err;
  }
  if (!lines.every((l) => lineDirection(l) === bankDir)) {
    const err = new Error(
      bankDir === 'in'
        ? 'Book lines must be bank debits (inflows) to match bank credits'
        : 'Book lines must be bank credits (outflows) to match bank debits'
    );
    err.statusCode = 400;
    throw err;
  }

  const stmtRemainders = [];
  for (const t of txns) {
    const remaining = await remainingOnStatement(t);
    stmtRemainders.push({ id: t.id, remaining, txn: t });
  }
  const lineRemainders = [];
  for (const l of lines) {
    const remaining = await remainingOnLine(l);
    if (remaining <= 0.005) {
      const err = new Error(`Journal line ${l.id} has no remaining unreconciled amount`);
      err.statusCode = 400;
      throw err;
    }
    lineRemainders.push({ id: l.id, remaining, line: l });
  }

  const pairs = buildAllocationPairs(stmtRemainders, lineRemainders);
  const matchGroupId = crypto.randomUUID();

  const created = await prisma.$transaction(async (tx) => {
    const matches = [];
    for (const pair of pairs) {
      const line = lines.find((l) => l.id === pair.journalLineId);
      const match = await tx.bankReconciliationMatch.create({
        data: {
          companyId,
          reconciliationId,
          statementTransactionId: pair.statementTransactionId,
          journalLineId: pair.journalLineId,
          journalEntryId: line.journalId,
          allocatedAmount: pair.allocatedAmount,
          matchGroupId,
          matchType,
          matchScore,
          matchReason: matchReason || `${matchType} ${pairs.length > 1 ? 'group' : 'pair'}`,
          isActive: true,
          matchedBy: userId,
        },
      });
      matches.push(match);
    }

    for (const id of stmtIds) {
      await syncStatementStatus(id, tx);
      await tx.bankStatementTransaction.update({
        where: { id },
        data: { reconciliationId },
      });
    }
    for (const id of lineIds) {
      await syncJournalLineReconciled(id, tx);
    }

    if (recon.status === 'Draft') {
      await tx.bankReconciliation.update({
        where: { id: recon.id },
        data: { status: 'InProgress' },
      });
    }

    await writeAudit(
      {
        companyId,
        reconciliationId,
        actorId: userId,
        action: 'match',
        details: {
          matchGroupId,
          matchType,
          pairs: pairs.map((p) => ({
            statementTransactionId: p.statementTransactionId,
            journalLineId: p.journalLineId,
            allocatedAmount: p.allocatedAmount,
          })),
        },
      },
      tx
    );

    return matches;
  });

  return { matchGroupId, matches: created, pairCount: created.length };
}

/**
 * Unmatch by match id, match group, or statement transaction (all active links).
 */
async function unmatchGroup({
  companyId,
  userId,
  reconciliationId,
  matchId,
  matchGroupId,
  statementTransactionId,
}) {
  const recon = await prisma.bankReconciliation.findFirst({
    where: { id: reconciliationId, companyId },
  });
  if (!recon) {
    const err = new Error('Reconciliation not found');
    err.statusCode = 404;
    throw err;
  }
  if (recon.status === 'Completed') {
    const err = new Error('Completed reconciliation is locked');
    err.statusCode = 400;
    throw err;
  }

  let matches = [];
  if (matchId) {
    const one = await prisma.bankReconciliationMatch.findFirst({
      where: { id: matchId, companyId, reconciliationId, isActive: true },
    });
    if (one) {
      if (one.matchGroupId) {
        matches = await prisma.bankReconciliationMatch.findMany({
          where: {
            companyId,
            reconciliationId,
            matchGroupId: one.matchGroupId,
            isActive: true,
          },
        });
      } else {
        matches = [one];
      }
    }
  } else if (matchGroupId) {
    matches = await prisma.bankReconciliationMatch.findMany({
      where: { companyId, reconciliationId, matchGroupId, isActive: true },
    });
  } else if (statementTransactionId) {
    matches = await prisma.bankReconciliationMatch.findMany({
      where: { companyId, reconciliationId, statementTransactionId, isActive: true },
    });
  }

  if (!matches.length) {
    const err = new Error('Active match not found');
    err.statusCode = 404;
    throw err;
  }

  const stmtIds = [...new Set(matches.map((m) => m.statementTransactionId))];
  const lineIds = [...new Set(matches.map((m) => m.journalLineId))];

  await prisma.$transaction(async (tx) => {
    await tx.bankReconciliationMatch.updateMany({
      where: { id: { in: matches.map((m) => m.id) } },
      data: { isActive: false, unmatchedAt: new Date() },
    });
    for (const id of stmtIds) await syncStatementStatus(id, tx);
    for (const id of lineIds) await syncJournalLineReconciled(id, tx);
    await writeAudit(
      {
        companyId,
        reconciliationId,
        actorId: userId,
        action: 'unmatch',
        details: {
          matchIds: matches.map((m) => m.id),
          matchGroupId: matches[0]?.matchGroupId || null,
          statementTransactionIds: stmtIds,
          journalLineIds: lineIds,
        },
      },
      tx
    );
  });

  return { success: true, unmatched: matches.length };
}

module.exports = {
  toNum,
  round2,
  nearlyEqual,
  stmtMagnitude,
  lineMagnitude,
  stmtDirection,
  lineDirection,
  allocatedOnStatement,
  allocatedOnLine,
  remainingOnStatement,
  remainingOnLine,
  syncStatementStatus,
  syncJournalLineReconciled,
  writeAudit,
  buildAllocationPairs,
  applyMatchGroup,
  unmatchGroup,
};
