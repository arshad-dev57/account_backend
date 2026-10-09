/**
 * Bank Reconciliation — statement import, matching, totals.
 * JournalEntry / JournalLine remain the GL source of truth.
 * Matching only links & marks isReconciled; it does not post.
 */

const crypto = require('crypto');
const ExcelJS = require('exceljs');
const prisma = require('../prisma/client');

const MS_DAY = 24 * 60 * 60 * 1000;
const AMOUNT_EPS = 0.005;

function toNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const cleaned = String(v).replace(/[, ]/g, '').replace(/[()]/g, (m) => (m === '(' ? '-' : ''));
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((toNum(n) + Number.EPSILON) * 100) / 100;
}

function nearlyEqual(a, b) {
  return Math.abs(toNum(a) - toNum(b)) < AMOUNT_EPS;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseDate(raw) {
  if (!raw && raw !== 0) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === 'number') {
    // Excel serial
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + raw * MS_DAY);
  }
  const s = String(raw).trim();
  if (!s) return null;
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    return new Date(y, Number(dmy[2]) - 1, Number(dmy[1]));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Opening-balance journals must never become "outstanding deposits". */
function isOpeningBalanceLine(line) {
  const type = String(line?.journal?.type || '').toLowerCase();
  const ref = String(line?.journal?.reference || '').toUpperCase();
  const desc = String(line?.journal?.description || '').toLowerCase();
  if (type === 'openingbalance' || type === 'opening_balance') return true;
  if (ref.startsWith('OB-BANK-') || ref.startsWith('OB-')) return true;
  if (desc.includes('opening balance')) return true;
  return false;
}

function fingerprintOf({ transactionDate, debit, credit, amount, reference, description }) {
  const day = startOfDay(transactionDate).toISOString().slice(0, 10);
  const payload = [
    day,
    round2(debit).toFixed(2),
    round2(credit).toFixed(2),
    round2(amount).toFixed(2),
    normalizeText(reference),
    normalizeText(description).slice(0, 80),
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 40);
}

function similarity(a, b) {
  const sa = normalizeText(a);
  const sb = normalizeText(b);
  if (!sa || !sb) return 0;
  if (sa === sb) return 1;
  if (sa.includes(sb) || sb.includes(sa)) return 0.85;
  const wa = new Set(sa.split(' ').filter(Boolean));
  const wb = new Set(sb.split(' ').filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter += 1;
  return inter / Math.max(wa.size, wb.size);
}

const COLUMN_ALIASES = {
  date: ['date', 'txn date', 'transaction date', 'value date', 'tran date', 'posting date'],
  valueDate: ['value date', 'valuedate', 'value_date'],
  description: ['description', 'narration', 'particulars', 'details', 'memo', 'remarks'],
  reference: ['reference', 'ref', 'cheque', 'check', 'chq', 'cheque no', 'txn id', 'transaction id', 'utr'],
  debit: ['debit', 'withdrawal', 'dr', 'debit amount', 'money out', 'paid out'],
  credit: ['credit', 'deposit', 'cr', 'credit amount', 'money in', 'paid in'],
  amount: ['amount', 'txn amount', 'transaction amount'],
  balance: ['balance', 'running balance', 'closing balance', 'book balance'],
};

function guessMapping(headers) {
  const mapping = {};
  const normalized = headers.map((h) => normalizeText(h));
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = normalized.findIndex((h) => aliases.some((a) => h === normalizeText(a) || h.includes(normalizeText(a))));
    if (idx >= 0) mapping[field] = headers[idx];
  }
  return mapping;
}

async function parseSpreadsheetBuffer(buffer, fileName = '') {
  const lower = String(fileName || '').toLowerCase();
  const workbook = new ExcelJS.Workbook();
  if (lower.endsWith('.csv')) {
    await workbook.csv.read(require('stream').Readable.from(buffer));
  } else {
    await workbook.xlsx.load(buffer);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const matrix = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber - 1] = cell.value != null && typeof cell.value === 'object' && cell.value.text
        ? cell.value.text
        : cell.value != null && typeof cell.value === 'object' && cell.value.result != null
          ? cell.value.result
          : cell.value;
    });
    matrix.push(values);
  });

  if (!matrix.length) return { headers: [], rows: [] };
  const headers = matrix[0].map((h, i) => String(h ?? `Column ${i + 1}`).trim() || `Column ${i + 1}`);
  const rows = matrix.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? '';
    });
    return obj;
  });
  return { headers, rows, fileType: lower.endsWith('.csv') ? 'csv' : 'xlsx' };
}

function rowToTxn(row, mapping) {
  const get = (field) => {
    const key = mapping?.[field];
    return key ? row[key] : undefined;
  };

  const transactionDate = parseDate(get('date'));
  if (!transactionDate) return null;

  let debit = toNum(get('debit'));
  let credit = toNum(get('credit'));
  const amountRaw = toNum(get('amount'));

  if (!debit && !credit && amountRaw) {
    if (amountRaw < 0) debit = Math.abs(amountRaw);
    else credit = amountRaw;
  }

  const description = String(get('description') ?? '').trim();
  const reference = String(get('reference') ?? '').trim();
  const valueDate = parseDate(get('valueDate')) || null;
  const runningBalance = get('balance') != null && get('balance') !== '' ? toNum(get('balance')) : null;
  const amount = round2(credit - debit);

  if (!debit && !credit) return null;

  return {
    transactionDate,
    valueDate,
    description,
    reference,
    debit: round2(debit),
    credit: round2(credit),
    amount,
    runningBalance,
    fingerprint: fingerprintOf({
      transactionDate,
      debit,
      credit,
      amount,
      reference,
      description,
    }),
  };
}

async function resolveCompanyBank(companyId, bankAccountId) {
  const bank = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, companyId },
    include: { chartOfAccount: true },
  });
  if (!bank) {
    const err = new Error('Bank account not found for this company');
    err.statusCode = 404;
    throw err;
  }
  return bank;
}

async function previewStatementImport({
  companyId,
  userId,
  bankAccountId,
  buffer,
  fileName,
  columnMapping: mappingOverride,
  openingBalance,
  closingBalance,
}) {
  const bank = await resolveCompanyBank(companyId, bankAccountId);
  const parsed = await parseSpreadsheetBuffer(buffer, fileName);
  if (!parsed.rows.length) {
    const err = new Error('No rows found in the uploaded file');
    err.statusCode = 400;
    throw err;
  }

  const remembered = bank.statementColumnMapping && typeof bank.statementColumnMapping === 'object'
    ? bank.statementColumnMapping
    : null;
  const mapping = mappingOverride || remembered || guessMapping(parsed.headers);

  const txns = [];
  const errors = [];
  parsed.rows.forEach((row, idx) => {
    try {
      const t = rowToTxn(row, mapping);
      if (!t) {
        errors.push({ row: idx + 2, message: 'Skipped — missing date or amount' });
        return;
      }
      txns.push(t);
    } catch (e) {
      errors.push({ row: idx + 2, message: e.message });
    }
  });

  const fingerprints = txns.map((t) => t.fingerprint);
  const existing = fingerprints.length
    ? await prisma.bankStatementTransaction.findMany({
        where: {
          companyId,
          bankAccountId,
          fingerprint: { in: fingerprints },
        },
        select: { fingerprint: true },
      })
    : [];
  const existingSet = new Set(existing.map((e) => e.fingerprint));

  const previewRows = txns.map((t) => ({
    ...t,
    isDuplicate: existingSet.has(t.fingerprint),
  }));

  const dates = previewRows.map((t) => t.transactionDate.getTime());
  const statementStartDate = dates.length ? new Date(Math.min(...dates)) : null;
  const statementEndDate = dates.length ? new Date(Math.max(...dates)) : null;

  const importRecord = await prisma.bankStatementImport.create({
    data: {
      companyId,
      bankAccountId,
      fileName: fileName || null,
      fileType: parsed.fileType || null,
      status: 'preview',
      statementStartDate,
      statementEndDate,
      openingBalance: openingBalance != null ? toNum(openingBalance) : null,
      closingBalance: closingBalance != null ? toNum(closingBalance) : null,
      rowCount: previewRows.length,
      duplicateCount: previewRows.filter((r) => r.isDuplicate).length,
      columnMapping: mapping,
      importedBy: userId,
    },
  });

  return {
    importId: importRecord.id,
    headers: parsed.headers,
    mapping,
    suggestedMapping: guessMapping(parsed.headers),
    rememberedMapping: remembered,
    statementStartDate,
    statementEndDate,
    rowCount: previewRows.length,
    duplicateCount: previewRows.filter((r) => r.isDuplicate).length,
    preview: previewRows.slice(0, 200),
    errors: errors.slice(0, 50),
    bankAccount: {
      id: bank.id,
      accountName: bank.accountName,
      accountNumber: bank.accountNumber,
      currentBalance: bank.currentBalance,
    },
  };
}

async function confirmStatementImportWithRows({
  companyId,
  userId,
  importId,
  rows,
  columnMapping,
  openingBalance,
  closingBalance,
  skipDuplicates = true,
  rememberMapping = true,
  reconciliationId = null,
}) {
  const imp = await prisma.bankStatementImport.findFirst({
    where: { id: importId, companyId },
  });
  if (!imp) {
    const err = new Error('Import batch not found');
    err.statusCode = 404;
    throw err;
  }
  if (imp.status === 'imported') {
    const err = new Error('This statement has already been imported');
    err.statusCode = 400;
    throw err;
  }

  const mapping = columnMapping || imp.columnMapping || {};
  const normalized = (rows || []).map((r) => {
    if (r.fingerprint && r.transactionDate != null) {
      return {
        transactionDate: new Date(r.transactionDate),
        valueDate: r.valueDate ? new Date(r.valueDate) : null,
        description: String(r.description || ''),
        reference: String(r.reference || ''),
        debit: round2(r.debit),
        credit: round2(r.credit),
        amount: round2(r.amount != null ? r.amount : toNum(r.credit) - toNum(r.debit)),
        runningBalance: r.runningBalance != null ? toNum(r.runningBalance) : null,
        fingerprint: r.fingerprint,
        isDuplicate: !!r.isDuplicate,
      };
    }
    return rowToTxn(r, mapping);
  }).filter(Boolean);

  const fingerprints = normalized.map((t) => t.fingerprint);
  const existing = fingerprints.length
    ? await prisma.bankStatementTransaction.findMany({
        where: { companyId, bankAccountId: imp.bankAccountId, fingerprint: { in: fingerprints } },
        select: { fingerprint: true },
      })
    : [];
  const existingSet = new Set(existing.map((e) => e.fingerprint));

  const toInsert = [];
  let skipped = 0;
  for (const t of normalized) {
    if (existingSet.has(t.fingerprint)) {
      skipped += 1;
      if (skipDuplicates) continue;
    }
    toInsert.push(t);
    existingSet.add(t.fingerprint);
  }

  let attachReconId = null;
  if (reconciliationId) {
    const recon = await prisma.bankReconciliation.findFirst({
      where: {
        id: reconciliationId,
        companyId,
        bankAccountId: imp.bankAccountId,
        status: { not: 'Completed' },
      },
    });
    if (!recon) {
      const err = new Error('Reconciliation not found or locked for this bank account');
      err.statusCode = 400;
      throw err;
    }
    attachReconId = recon.id;
  }

  const result = await prisma.$transaction(async (tx) => {
    if (toInsert.length) {
      await tx.bankStatementTransaction.createMany({
        data: toInsert.map((t) => ({
          companyId,
          bankAccountId: imp.bankAccountId,
          importId: imp.id,
          reconciliationId: attachReconId,
          transactionDate: t.transactionDate,
          valueDate: t.valueDate,
          description: t.description,
          reference: t.reference,
          debit: t.debit,
          credit: t.credit,
          amount: t.amount,
          runningBalance: t.runningBalance,
          fingerprint: t.fingerprint,
          status: 'unmatched',
          importedAt: new Date(),
        })),
        skipDuplicates: true,
      });
    }

    // Also link any rows that were skipped as duplicates but still unattached
    if (attachReconId) {
      await tx.bankStatementTransaction.updateMany({
        where: {
          companyId,
          bankAccountId: imp.bankAccountId,
          importId: imp.id,
          reconciliationId: null,
        },
        data: { reconciliationId: attachReconId },
      });
    }

    const dates = normalized.map((t) => t.transactionDate.getTime());
    const updatedImport = await tx.bankStatementImport.update({
      where: { id: imp.id },
      data: {
        status: 'imported',
        importedAt: new Date(),
        columnMapping: mapping,
        openingBalance: openingBalance != null ? toNum(openingBalance) : imp.openingBalance,
        closingBalance: closingBalance != null ? toNum(closingBalance) : imp.closingBalance,
        statementStartDate: dates.length ? new Date(Math.min(...dates)) : imp.statementStartDate,
        statementEndDate: dates.length ? new Date(Math.max(...dates)) : imp.statementEndDate,
        rowCount: toInsert.length,
        duplicateCount: skipped,
      },
    });

    if (rememberMapping && mapping) {
      await tx.bankAccount.update({
        where: { id: imp.bankAccountId },
        data: { statementColumnMapping: mapping },
      });
    }

    if (attachReconId) {
      const stmtOpen =
        openingBalance != null ? toNum(openingBalance) : updatedImport.openingBalance;
      const stmtClose =
        closingBalance != null ? toNum(closingBalance) : updatedImport.closingBalance;
      await tx.bankReconciliation.update({
        where: { id: attachReconId },
        data: {
          importId: imp.id,
          ...(stmtOpen != null ? { statementOpeningBalance: toNum(stmtOpen) } : {}),
          ...(stmtClose != null ? { statementClosingBalance: toNum(stmtClose) } : {}),
          status: 'InProgress',
        },
      });
    }

    return updatedImport;
  });

  if (attachReconId) {
    await refreshReconciliationTotals(attachReconId);
  }

  return {
    import: result,
    imported: toInsert.length,
    skippedDuplicates: skipped,
    reconciliationId: attachReconId,
  };
}

/** Book (ERP) lines on the bank COA for a period */
async function getBookTransactions({
  companyId,
  bankAccountId,
  startDate,
  endDate,
  unmatchedOnly = false,
  search = '',
  page = 1,
  limit = 50,
}) {
  const bank = await resolveCompanyBank(companyId, bankAccountId);
  const where = {
    accountId: bank.chartOfAccountId,
    journal: {
      companyId,
      status: 'Posted',
      date: {
        gte: startOfDay(startDate),
        lte: endOfDay(endDate),
      },
    },
  };
  if (unmatchedOnly) where.isReconciled = false;
  if (search) {
    where.OR = [
      { journal: { description: { contains: search, mode: 'insensitive' } } },
      { journal: { reference: { contains: search, mode: 'insensitive' } } },
      { journal: { entryNumber: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const skip = (Math.max(1, page) - 1) * limit;
  const [total, lines] = await Promise.all([
    prisma.journalLine.count({ where }),
    prisma.journalLine.findMany({
      where,
      include: {
        journal: {
          select: {
            id: true,
            entryNumber: true,
            date: true,
            description: true,
            reference: true,
            type: true,
            status: true,
          },
        },
      },
      orderBy: [{ journal: { date: 'asc' } }, { id: 'asc' }],
      skip,
      take: Math.min(500, limit * 3), // over-fetch then filter OB lines
    }),
  ]);

  const items = lines
    .filter((l) => !isOpeningBalanceLine(l))
    .slice(0, limit)
    .map((l) => ({
      id: l.id,
      journalEntryId: l.journalId,
      entryNumber: l.journal.entryNumber,
      date: l.journal.date,
      description: l.journal.description,
      reference: l.journal.reference,
      type: l.journal.type,
      debit: l.debit,
      credit: l.credit,
      amount: round2(l.debit - l.credit),
      isReconciled: l.isReconciled,
      direction: l.debit > 0 ? 'in' : 'out',
    }));

  return {
    bankAccountId: bank.id,
    chartOfAccountId: bank.chartOfAccountId,
    total: items.length, // approximate after OB filter; fine for workspace paging
    page,
    limit,
    pages: Math.ceil(total / limit) || 1,
    items,
  };
}

async function getStatementTransactions({
  companyId,
  bankAccountId,
  reconciliationId,
  importId,
  status,
  search = '',
  startDate,
  endDate,
  minAmount,
  maxAmount,
  page = 1,
  limit = 50,
}) {
  const where = { companyId, bankAccountId };
  if (reconciliationId) where.reconciliationId = reconciliationId;
  if (importId) where.importId = importId;
  if (status && status !== 'all') where.status = status;
  if (startDate || endDate) {
    where.transactionDate = {};
    if (startDate) where.transactionDate.gte = startOfDay(startDate);
    if (endDate) where.transactionDate.lte = endOfDay(endDate);
  }
  if (minAmount != null || maxAmount != null) {
    where.amount = {};
    if (minAmount != null) where.amount.gte = toNum(minAmount);
    if (maxAmount != null) where.amount.lte = toNum(maxAmount);
  }
  if (search) {
    where.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { reference: { contains: search, mode: 'insensitive' } },
    ];
  }

  const skip = (Math.max(1, page) - 1) * limit;
  const [total, items] = await Promise.all([
    prisma.bankStatementTransaction.count({ where }),
    prisma.bankStatementTransaction.findMany({
      where,
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
      skip,
      take: limit,
      include: {
        matches: {
          where: { isActive: true },
          take: 1,
          include: {
            journalLine: {
              include: {
                journal: {
                  select: { id: true, entryNumber: true, date: true, description: true, reference: true },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    total,
    page,
    limit,
    pages: Math.ceil(total / limit) || 1,
    items: items.map((t) => ({
      ...t,
      direction: t.credit > 0 ? 'in' : 'out',
      match: t.matches[0] || null,
    })),
  };
}

function bookMatchesBankDirection(bankTxn, bookLine) {
  // Bank credit (inflow) ↔ book debit on bank asset
  // Bank debit (outflow) ↔ book credit on bank asset
  if (bankTxn.credit > 0) return bookLine.debit > 0 && nearlyEqual(bookLine.debit, bankTxn.credit);
  if (bankTxn.debit > 0) return bookLine.credit > 0 && nearlyEqual(bookLine.credit, bankTxn.debit);
  return false;
}

function scoreCandidate(bankTxn, bookLine) {
  const reasons = [];
  let score = 0;
  const bankAmt = bankTxn.credit > 0 ? bankTxn.credit : bankTxn.debit;
  const bookAmt = bookLine.debit > 0 ? bookLine.debit : bookLine.credit;
  if (!nearlyEqual(bankAmt, bookAmt)) return { score: 0, reasons: ['amount mismatch'] };
  if (!bookMatchesBankDirection(bankTxn, bookLine)) return { score: 0, reasons: ['direction mismatch'] };

  score += 40;
  reasons.push('exact amount + direction');

  const bankDay = startOfDay(bankTxn.transactionDate).getTime();
  const bookDay = startOfDay(bookLine.journal.date).getTime();
  const dayDiff = Math.abs(bankDay - bookDay) / MS_DAY;
  if (dayDiff === 0) {
    score += 35;
    reasons.push('same date');
  } else if (dayDiff <= 3) {
    score += 20;
    reasons.push(`date within ${dayDiff}d`);
  } else if (dayDiff <= 7) {
    score += 10;
    reasons.push(`date within ${dayDiff}d`);
  } else {
    return { score: 0, reasons: ['date too far'] };
  }

  const refSim = Math.max(
    similarity(bankTxn.reference, bookLine.journal.reference),
    similarity(bankTxn.reference, bookLine.journal.entryNumber)
  );
  const descSim = Math.max(
    similarity(bankTxn.description, bookLine.journal.description),
    similarity(bankTxn.description, bookLine.journal.reference)
  );
  if (refSim >= 0.85) {
    score += 20;
    reasons.push('reference match');
  } else if (refSim >= 0.4) {
    score += 8;
    reasons.push('partial reference');
  }
  if (descSim >= 0.7) {
    score += 15;
    reasons.push('description similarity');
  } else if (descSim >= 0.4) {
    score += 6;
    reasons.push('partial description');
  }

  return { score, reasons, dayDiff, refSim, descSim };
}

async function findCandidatesForBankTxn(bankTxn, bookLines, usedLineIds) {
  const candidates = [];
  for (const line of bookLines) {
    if (usedLineIds.has(line.id) || line.isReconciled) continue;
    const { score, reasons } = scoreCandidate(bankTxn, line);
    if (score >= 55) {
      candidates.push({
        journalLineId: line.id,
        journalEntryId: line.journalId,
        entryNumber: line.journal.entryNumber,
        date: line.journal.date,
        description: line.journal.description,
        reference: line.journal.reference,
        debit: line.debit,
        credit: line.credit,
        score,
        reasons,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

async function autoMatch({ companyId, userId, reconciliationId, dateWindowDays = 7 }) {
  const recon = await prisma.bankReconciliation.findFirst({
    where: { id: reconciliationId, companyId },
  });
  if (!recon) {
    const err = new Error('Reconciliation not found');
    err.statusCode = 404;
    throw err;
  }
  if (recon.status === 'Completed') {
    const err = new Error('Cannot match on a completed reconciliation');
    err.statusCode = 400;
    throw err;
  }

  const bank = await resolveCompanyBank(companyId, recon.bankAccountId);
  const padStart = new Date(recon.statementStartDate.getTime() - dateWindowDays * MS_DAY);
  const padEnd = new Date(recon.statementEndDate.getTime() + dateWindowDays * MS_DAY);

  const [bankTxns, bookLinesRaw] = await Promise.all([
    prisma.bankStatementTransaction.findMany({
      where: {
        companyId,
        bankAccountId: recon.bankAccountId,
        status: 'unmatched',
        reconciliationId: recon.id,
      },
      orderBy: { transactionDate: 'asc' },
    }),
    prisma.journalLine.findMany({
      where: {
        accountId: bank.chartOfAccountId,
        isReconciled: false,
        journal: {
          companyId,
          status: 'Posted',
          date: { gte: startOfDay(padStart), lte: endOfDay(padEnd) },
        },
      },
      include: {
        journal: {
          select: {
            id: true,
            entryNumber: true,
            date: true,
            description: true,
            reference: true,
            type: true,
          },
        },
      },
    }),
  ]);

  if (!bankTxns.length) {
    return { matched: 0, ambiguousCount: 0, ambiguous: [], message: 'No imported statement lines to match' };
  }

  const bookLines = bookLinesRaw.filter((l) => !isOpeningBalanceLine(l));

  const usedLineIds = new Set();
  const ambiguous = [];
  let matched = 0;

  for (const txn of bankTxns) {
    const candidates = await findCandidatesForBankTxn(txn, bookLines, usedLineIds);
    if (candidates.length === 1 && candidates[0].score >= 75) {
      await applyMatch({
        companyId,
        userId,
        reconciliationId: recon.id,
        statementTransactionId: txn.id,
        journalLineId: candidates[0].journalLineId,
        matchType: 'auto',
        matchScore: candidates[0].score,
        matchReason: candidates[0].reasons.join(', '),
      });
      usedLineIds.add(candidates[0].journalLineId);
      matched += 1;
    } else if (candidates.length > 1) {
      ambiguous.push({
        statementTransactionId: txn.id,
        description: txn.description,
        amount: txn.amount,
        date: txn.transactionDate,
        candidates: candidates.slice(0, 5),
      });
    } else if (candidates.length === 1) {
      ambiguous.push({
        statementTransactionId: txn.id,
        description: txn.description,
        amount: txn.amount,
        date: txn.transactionDate,
        candidates,
        note: 'Low confidence — confirm manually',
      });
    }
  }

  await refreshReconciliationTotals(recon.id);
  return { matched, ambiguousCount: ambiguous.length, ambiguous };
}

async function applyMatch({
  companyId,
  userId,
  reconciliationId,
  statementTransactionId,
  journalLineId,
  matchType = 'manual',
  matchScore = null,
  matchReason = null,
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

  const [txn, line] = await Promise.all([
    prisma.bankStatementTransaction.findFirst({
      where: { id: statementTransactionId, companyId, bankAccountId: recon.bankAccountId },
    }),
    prisma.journalLine.findFirst({
      where: { id: journalLineId },
      include: { journal: true },
    }),
  ]);

  if (!txn) {
    const err = new Error('Statement transaction not found');
    err.statusCode = 404;
    throw err;
  }
  if (!line || line.journal.companyId !== companyId) {
    const err = new Error('ERP journal line not found');
    err.statusCode = 404;
    throw err;
  }
  if (txn.status === 'matched') {
    const err = new Error('Statement transaction already matched');
    err.statusCode = 400;
    throw err;
  }
  if (line.isReconciled) {
    const err = new Error('ERP transaction already reconciled');
    err.statusCode = 400;
    throw err;
  }

  const bank = await resolveCompanyBank(companyId, recon.bankAccountId);
  if (line.accountId !== bank.chartOfAccountId) {
    const err = new Error('Journal line does not belong to this bank account');
    err.statusCode = 400;
    throw err;
  }

  const result = await prisma.$transaction(async (tx) => {
    const match = await tx.bankReconciliationMatch.create({
      data: {
        companyId,
        reconciliationId,
        statementTransactionId,
        journalLineId,
        journalEntryId: line.journalId,
        matchType,
        matchScore,
        matchReason,
        isActive: true,
        matchedBy: userId,
      },
    });

    await tx.bankStatementTransaction.update({
      where: { id: txn.id },
      data: {
        status: 'matched',
        matchedJournalLineId: line.id,
        reconciliationId,
      },
    });

    await tx.journalLine.update({
      where: { id: line.id },
      data: { isReconciled: true },
    });

    if (recon.status === 'Draft') {
      await tx.bankReconciliation.update({
        where: { id: recon.id },
        data: { status: 'InProgress' },
      });
    }

    return match;
  });

  await refreshReconciliationTotals(reconciliationId);
  return result;
}

async function unmatch({ companyId, userId, reconciliationId, matchId, statementTransactionId }) {
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

  const match = await prisma.bankReconciliationMatch.findFirst({
    where: {
      companyId,
      reconciliationId,
      isActive: true,
      ...(matchId ? { id: matchId } : {}),
      ...(statementTransactionId ? { statementTransactionId } : {}),
    },
  });
  if (!match) {
    const err = new Error('Active match not found');
    err.statusCode = 404;
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    await tx.bankReconciliationMatch.update({
      where: { id: match.id },
      data: { isActive: false, unmatchedAt: new Date() },
    });
    await tx.bankStatementTransaction.update({
      where: { id: match.statementTransactionId },
      data: { status: 'unmatched', matchedJournalLineId: null },
    });
    await tx.journalLine.update({
      where: { id: match.journalLineId },
      data: { isReconciled: false },
    });
  });

  await refreshReconciliationTotals(reconciliationId);
  return { success: true };
}

async function ignoreStatementTxn({ companyId, reconciliationId, statementTransactionId, notes }) {
  const recon = await prisma.bankReconciliation.findFirst({
    where: { id: reconciliationId, companyId },
  });
  if (!recon || recon.status === 'Completed') {
    const err = new Error(recon ? 'Completed reconciliation is locked' : 'Reconciliation not found');
    err.statusCode = recon ? 400 : 404;
    throw err;
  }

  const txn = await prisma.bankStatementTransaction.findFirst({
    where: { id: statementTransactionId, companyId, bankAccountId: recon.bankAccountId },
  });
  if (!txn) {
    const err = new Error('Statement transaction not found');
    err.statusCode = 404;
    throw err;
  }
  if (txn.status === 'matched') {
    const err = new Error('Unmatch before ignoring');
    err.statusCode = 400;
    throw err;
  }

  await prisma.bankStatementTransaction.update({
    where: { id: txn.id },
    data: {
      status: 'ignored',
      notes: notes || txn.notes,
      reconciliationId,
    },
  });
  await refreshReconciliationTotals(reconciliationId);
  return { success: true };
}

async function computeBookBalanceAt(companyId, chartOfAccountId, asOfDate, inclusive = true) {
  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: chartOfAccountId,
      journal: {
        companyId,
        status: 'Posted',
        date: inclusive
          ? { lte: endOfDay(asOfDate) }
          : { lt: startOfDay(asOfDate) },
      },
    },
    select: { debit: true, credit: true },
  });
  // Asset bank: balance = sum(debit - credit)
  let bal = 0;
  for (const l of lines) bal += toNum(l.debit) - toNum(l.credit);
  return round2(bal);
}

async function refreshReconciliationTotals(reconciliationId) {
  const recon = await prisma.bankReconciliation.findUnique({
    where: { id: reconciliationId },
  });
  if (!recon) return null;

  const bank = await resolveCompanyBank(recon.companyId, recon.bankAccountId);

  // Only statement lines linked to THIS reconciliation — never period orphans.
  const stmtTxns = await prisma.bankStatementTransaction.findMany({
    where: {
      companyId: recon.companyId,
      bankAccountId: recon.bankAccountId,
      reconciliationId,
    },
  });

  const statementImported = stmtTxns.length > 0;

  const bookOpening = await computeBookBalanceAt(
    recon.companyId,
    bank.chartOfAccountId,
    recon.statementStartDate,
    false
  );
  const bookClosing = await computeBookBalanceAt(
    recon.companyId,
    bank.chartOfAccountId,
    recon.statementEndDate,
    true
  );

  // Before statement import: do NOT invent outstanding deposits/payments from book
  // balances or opening-balance journals. Keep counts and adjustments clean.
  if (!statementImported) {
    const simpleDiff = round2(
      toNum(recon.statementClosingBalance) - bookClosing
    );
    return prisma.bankReconciliation.update({
      where: { id: reconciliationId },
      data: {
        bookOpeningBalance: bookOpening,
        bookClosingBalance: bookClosing,
        reconciledAmount: 0,
        unreconciledAmount: 0,
        outstandingDeposits: 0,
        outstandingPayments: 0,
        difference: simpleDiff,
        matchedCount: 0,
        unmatchedBankCount: 0,
        unmatchedBookCount: 0,
        status: recon.status === 'Completed' ? 'Completed' : 'Draft',
      },
    });
  }

  const bookLines = await prisma.journalLine.findMany({
    where: {
      accountId: bank.chartOfAccountId,
      journal: {
        companyId: recon.companyId,
        status: 'Posted',
        date: {
          gte: startOfDay(recon.statementStartDate),
          lte: endOfDay(recon.statementEndDate),
        },
      },
    },
    include: {
      journal: {
        select: { date: true, type: true, description: true, reference: true },
      },
    },
  });

  // Exclude opening-balance / OB journals from reconciliation outstanding items.
  const reconcilableBook = bookLines.filter((l) => !isOpeningBalanceLine(l));

  const matched = stmtTxns.filter((t) => t.status === 'matched');
  const unmatchedBank = stmtTxns.filter((t) => t.status === 'unmatched');
  const ignored = stmtTxns.filter((t) => t.status === 'ignored');
  const unmatchedBook = reconcilableBook.filter((l) => !l.isReconciled);

  const reconciledAmount = round2(
    matched.reduce((s, t) => s + Math.abs(t.amount), 0)
  );
  const unreconciledAmount = round2(
    unmatchedBank.reduce((s, t) => s + Math.abs(t.amount), 0)
  );

  // Outstanding = book movements in period not yet cleared against the statement.
  // Never use account opening/current balance as a deposit/payment.
  let outstandingDeposits = 0;
  let outstandingPayments = 0;
  for (const l of unmatchedBook) {
    if (toNum(l.debit) > 0) outstandingDeposits += toNum(l.debit);
    if (toNum(l.credit) > 0) outstandingPayments += toNum(l.credit);
  }

  // Adjusted bank = statement closing + deposits in transit − outstanding payments
  const adjustedBank = round2(
    toNum(recon.statementClosingBalance) +
      outstandingDeposits -
      outstandingPayments
  );
  const difference = round2(adjustedBank - bookClosing);

  const nextStatus =
    recon.status === 'Completed'
      ? 'Completed'
      : matched.length > 0 || ignored.length > 0 || unmatchedBank.length < stmtTxns.length
        ? nearlyEqual(difference, 0) && unmatchedBank.length === 0
          ? 'Reconciled'
          : 'InProgress'
        : 'InProgress';

  return prisma.bankReconciliation.update({
    where: { id: reconciliationId },
    data: {
      bookOpeningBalance: bookOpening,
      bookClosingBalance: bookClosing,
      reconciledAmount,
      unreconciledAmount,
      outstandingDeposits: round2(outstandingDeposits),
      outstandingPayments: round2(outstandingPayments),
      difference,
      matchedCount: matched.length,
      unmatchedBankCount: unmatchedBank.length,
      unmatchedBookCount: unmatchedBook.length,
      status:
        nextStatus === 'Reconciled' && recon.status !== 'Completed'
          ? 'Reconciled'
          : nextStatus,
    },
  });
}

async function createReconciliation({
  companyId,
  userId,
  bankAccountId,
  statementStartDate,
  statementEndDate,
  statementOpeningBalance,
  statementClosingBalance,
  importId,
}) {
  const bank = await resolveCompanyBank(companyId, bankAccountId);
  if (!statementStartDate || !statementEndDate) {
    const err = new Error('Statement start and end dates are required');
    err.statusCode = 400;
    throw err;
  }

  const open = await prisma.bankReconciliation.findFirst({
    where: {
      companyId,
      bankAccountId,
      status: { in: ['Draft', 'InProgress', 'Reconciled'] },
    },
  });
  if (open) {
    const err = new Error('An open reconciliation already exists for this bank account. Complete or reopen it first.');
    err.statusCode = 400;
    err.data = { existingId: open.id };
    throw err;
  }

  const bookOpening = await computeBookBalanceAt(
    companyId,
    bank.chartOfAccountId,
    statementStartDate,
    false
  );
  const bookClosing = await computeBookBalanceAt(
    companyId,
    bank.chartOfAccountId,
    statementEndDate,
    true
  );

  const recon = await prisma.bankReconciliation.create({
    data: {
      companyId,
      bankAccountId,
      importId: importId || null,
      statementStartDate: startOfDay(statementStartDate),
      statementEndDate: endOfDay(statementEndDate),
      statementOpeningBalance: toNum(statementOpeningBalance),
      statementClosingBalance: toNum(statementClosingBalance),
      bookOpeningBalance: bookOpening,
      bookClosingBalance: bookClosing,
      difference: round2(toNum(statementClosingBalance) - bookClosing),
      outstandingDeposits: 0,
      outstandingPayments: 0,
      matchedCount: 0,
      unmatchedBankCount: 0,
      unmatchedBookCount: 0,
      reconciledAmount: 0,
      unreconciledAmount: 0,
      status: 'Draft',
      createdBy: userId,
    },
  });

  // Only attach statement rows from an explicit import batch — never scoop
  // unrelated orphan statement lines by date (that inflated unmatched bank counts).
  if (importId) {
    await prisma.bankStatementTransaction.updateMany({
      where: {
        companyId,
        bankAccountId,
        importId,
        reconciliationId: null,
      },
      data: { reconciliationId: recon.id },
    });
  }

  return refreshReconciliationTotals(recon.id);
}

async function completeReconciliation({
  companyId,
  userId,
  reconciliationId,
  exceptionAllowed = false,
  exceptionNote = '',
  isAdmin = false,
}) {
  let recon = await refreshReconciliationTotals(reconciliationId);
  if (!recon || recon.companyId !== companyId) {
    const err = new Error('Reconciliation not found');
    err.statusCode = 404;
    throw err;
  }
  if (recon.status === 'Completed') {
    return recon;
  }

  const diffOk = nearlyEqual(recon.difference, 0);
  if (!diffOk) {
    if (!(exceptionAllowed && isAdmin)) {
      const err = new Error(
        `Difference must be 0.00 before completing (current: ${recon.difference}). Admin exception required otherwise.`
      );
      err.statusCode = 400;
      throw err;
    }
  }

  if (recon.unmatchedBankCount > 0 && !(exceptionAllowed && isAdmin)) {
    const err = new Error(
      `${recon.unmatchedBankCount} unmatched bank transaction(s) remain. Match, ignore, or create entries first.`
    );
    err.statusCode = 400;
    throw err;
  }

  recon = await prisma.$transaction(async (tx) => {
    const updated = await tx.bankReconciliation.update({
      where: { id: reconciliationId },
      data: {
        status: 'Completed',
        completedBy: userId,
        completedAt: new Date(),
        exceptionAllowed: !diffOk && exceptionAllowed,
        exceptionNote: !diffOk ? exceptionNote || 'Completed with authorized exception' : null,
      },
      include: {
        bankAccount: { select: { id: true, accountName: true, accountNumber: true } },
        completer: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    await tx.bankAccount.update({
      where: { id: recon.bankAccountId },
      data: { lastReconciled: new Date() },
    });

    return updated;
  });

  return recon;
}

async function reopenReconciliation({ companyId, userId, reconciliationId, isAdmin }) {
  if (!isAdmin) {
    const err = new Error('Only administrators can reopen a completed reconciliation');
    err.statusCode = 403;
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
  if (recon.status !== 'Completed') {
    const err = new Error('Only completed reconciliations can be reopened');
    err.statusCode = 400;
    throw err;
  }

  return prisma.bankReconciliation.update({
    where: { id: reconciliationId },
    data: {
      status: 'InProgress',
      reopenedBy: userId,
      reopenedAt: new Date(),
      completedBy: null,
      completedAt: null,
      exceptionAllowed: false,
      exceptionNote: null,
    },
  });
}

module.exports = {
  toNum,
  round2,
  nearlyEqual,
  guessMapping,
  parseSpreadsheetBuffer,
  previewStatementImport,
  confirmStatementImportWithRows,
  getBookTransactions,
  getStatementTransactions,
  autoMatch,
  applyMatch,
  unmatch,
  ignoreStatementTxn,
  refreshReconciliationTotals,
  createReconciliation,
  completeReconciliation,
  reopenReconciliation,
  computeBookBalanceAt,
  resolveCompanyBank,
  scoreCandidate,
};
