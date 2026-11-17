'use strict';

/**
 * Live bank reconciliation suite against local Postgres.
 * Covers: create recon, manual lines, 1:1 / 1:N / N:1 match, direction reject,
 * duplicate fingerprint, adjustment posting, complete/reopen, company isolation, audits.
 *
 * Run: DATABASE_URL="postgresql://glplanet@localhost:5432/erp_local_db" node tests/bank-reconciliation-live.test.js
 */

process.env.DATABASE_URL =
  process.env.BANK_RECON_TEST_DATABASE_URL ||
  'postgresql://glplanet@localhost:5432/erp_local_db';
process.env.DIRECT_URL = process.env.DATABASE_URL;

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: false });

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const prisma = require('../prisma/client');
const app = require('../app');

const TAG = `br-${Date.now()}`;
const created = {
  companyIds: [],
  userIds: [],
  bankIds: [],
  coaIds: [],
  fyIds: [],
  reconIds: [],
};

const results = [];
function check(name, fn) {
  results.push([name, fn]);
}

let server;
let base;

function request(method, url, token, body, companyId) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (companyId) headers['X-Company-Id'] = companyId;
    if (body) headers['Content-Type'] = 'application/json';
    const req = http.request(`${base}${url}`, { method, headers, agent: false }, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch {
          json = { raw };
        }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function expectOk(method, url, token, body, companyId, label) {
  const res = await request(method, url, token, body, companyId);
  if (res.status >= 400) {
    throw new Error(`${label || url} → ${res.status} ${JSON.stringify(res.body).slice(0, 400)}`);
  }
  return res.body.data;
}

function sign(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'your_super_secret_jwt_key_here_123456789', {
    expiresIn: '2h',
  });
}

async function seedCompany(name) {
  const company = await prisma.company.create({
    data: { name, email: `${TAG}-${name}@example.com`, isActive: true },
  });
  created.companyIds.push(company.id);

  const admin = await prisma.user.create({
    data: {
      firstName: 'BR',
      lastName: 'Admin',
      email: `admin-${TAG}-${name}@example.com`,
      password: await bcrypt.hash('test-password', 8),
      role: 'admin',
      companyId: company.id,
      isActive: true,
    },
  });
  created.userIds.push(admin.id);

  const year = new Date().getFullYear();
  const fy = await prisma.fiscalYear.create({
    data: {
      name: `FY${year}-${TAG}`,
      startDate: new Date(`${year}-01-01`),
      endDate: new Date(`${year}-12-31`),
      status: 'Open',
      company: { connect: { id: company.id } },
    },
  });
  created.fyIds.push(fy.id);

  const bankCoa = await prisma.chartOfAccount.create({
    data: {
      code: `11${String(Math.floor(Math.random() * 90) + 10)}`,
      name: `Bank COA ${TAG}`,
      type: 'Asset',
      company: { connect: { id: company.id } },
      creator: { connect: { id: admin.id } },
      openingBalance: 0,
      currentBalance: 0,
    },
  });
  const expenseCoa = await prisma.chartOfAccount.create({
    data: {
      code: `5${String(Math.floor(Math.random() * 900) + 100)}`,
      name: `Bank Charges ${TAG}`,
      type: 'Expense',
      company: { connect: { id: company.id } },
      creator: { connect: { id: admin.id } },
      openingBalance: 0,
      currentBalance: 0,
    },
  });
  const incomeCoa = await prisma.chartOfAccount.create({
    data: {
      code: `4${String(Math.floor(Math.random() * 900) + 100)}`,
      name: `Interest Income ${TAG}`,
      type: 'Income',
      company: { connect: { id: company.id } },
      creator: { connect: { id: admin.id } },
      openingBalance: 0,
      currentBalance: 0,
    },
  });
  const arCoa = await prisma.chartOfAccount.create({
    data: {
      code: `12${String(Math.floor(Math.random() * 90) + 10)}`,
      name: `AR ${TAG}`,
      type: 'Asset',
      company: { connect: { id: company.id } },
      creator: { connect: { id: admin.id } },
      openingBalance: 0,
      currentBalance: 0,
    },
  });
  created.coaIds.push(bankCoa.id, expenseCoa.id, incomeCoa.id, arCoa.id);

  const bank = await prisma.bankAccount.create({
    data: {
      accountName: `Test Bank ${TAG}`,
      accountNumber: `ACC${Date.now()}`,
      iban: `PK36MEZN${String(Date.now()).slice(-16)}`,
      bankName: 'Test Bank',
      chartOfAccount: { connect: { id: bankCoa.id } },
      company: { connect: { id: company.id } },
      creator: { connect: { id: admin.id } },
      openingBalance: 0,
      currentBalance: 0,
      status: 'Active',
    },
  });
  created.bankIds.push(bank.id);

  return {
    companyId: company.id,
    adminId: admin.id,
    token: sign(admin.id),
    bank,
    bankCoa,
    expenseCoa,
    incomeCoa,
    arCoa,
    fy,
  };
}

async function postBankInflow({ companyId, userId, bankCoa, offsetCoa, amount, date, ref, desc }) {
  const entryNumber = `JE-BR-${crypto.randomUUID().slice(0, 8)}`;
  return prisma.journalEntry.create({
    data: {
      entryNumber,
      date: new Date(date),
      description: desc || 'Test inflow',
      reference: ref || entryNumber,
      status: 'Posted',
      type: 'Normal',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      companyId,
      lines: {
        create: [
          {
            accountId: bankCoa.id,
            accountName: bankCoa.name,
            accountCode: bankCoa.code,
            debit: amount,
            credit: 0,
            isReconciled: false,
          },
          {
            accountId: offsetCoa.id,
            accountName: offsetCoa.name,
            accountCode: offsetCoa.code,
            debit: 0,
            credit: amount,
            isReconciled: false,
          },
        ],
      },
    },
    include: { lines: true },
  });
}

async function cleanup() {
  for (const id of created.reconIds) {
    try {
      await prisma.bankReconciliationAudit.deleteMany({ where: { reconciliationId: id } });
      await prisma.bankReconciliationMatch.deleteMany({ where: { reconciliationId: id } });
      await prisma.bankStatementTransaction.deleteMany({ where: { reconciliationId: id } });
      await prisma.bankReconciliation.delete({ where: { id } }).catch(() => {});
    } catch {
      /* ignore */
    }
  }
  for (const id of created.bankIds) {
    try {
      await prisma.bankStatementTransaction.deleteMany({ where: { bankAccountId: id } });
      await prisma.bankStatementImport.deleteMany({ where: { bankAccountId: id } });
      await prisma.bankReconciliation.deleteMany({ where: { bankAccountId: id } });
      await prisma.bankAccount.delete({ where: { id } });
    } catch {
      /* ignore */
    }
  }
  for (const id of created.coaIds) {
    try {
      await prisma.journalLine.deleteMany({ where: { accountId: id } });
    } catch {
      /* ignore */
    }
  }
  for (const id of created.companyIds) {
    try {
      await prisma.journalEntry.deleteMany({ where: { companyId: id } });
      await prisma.fiscalYear.deleteMany({ where: { companyId: id } });
      await prisma.chartOfAccount.deleteMany({ where: { companyId: id } });
      await prisma.user.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } });
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;

  const ctx = await seedCompany('A');
  const other = await seedCompany('B');
  const { companyId, token, bank, bankCoa, expenseCoa, arCoa, adminId } = ctx;

  const d1 = `${new Date().getFullYear()}-11-01`;
  const d2 = `${new Date().getFullYear()}-11-15`;
  const d3 = `${new Date().getFullYear()}-11-20`;

  // Book: one 5000 inflow, two 1000+2000 inflows for 1:N, two 1500 for N:1 target 3000
  const je1 = await postBankInflow({
    companyId,
    userId: adminId,
    bankCoa,
    offsetCoa: arCoa,
    amount: 5000,
    date: d1,
    ref: 'PAY-5000',
    desc: 'Customer payment lump',
  });
  const je2a = await postBankInflow({
    companyId,
    userId: adminId,
    bankCoa,
    offsetCoa: arCoa,
    amount: 1000,
    date: d2,
    ref: 'PAY-1000',
    desc: 'Split A',
  });
  const je2b = await postBankInflow({
    companyId,
    userId: adminId,
    bankCoa,
    offsetCoa: arCoa,
    amount: 2000,
    date: d2,
    ref: 'PAY-2000',
    desc: 'Split B',
  });
  const je3a = await postBankInflow({
    companyId,
    userId: adminId,
    bankCoa,
    offsetCoa: arCoa,
    amount: 1500,
    date: d3,
    ref: 'PAY-1500A',
    desc: 'Part A',
  });
  const je3b = await postBankInflow({
    companyId,
    userId: adminId,
    bankCoa,
    offsetCoa: arCoa,
    amount: 1500,
    date: d3,
    ref: 'PAY-1500B',
    desc: 'Part B',
  });

  const bankLine = (je) => je.lines.find((l) => l.accountId === bankCoa.id);

  let recon;

  check('create reconciliation', async () => {
    recon = await expectOk(
      'POST',
      '/api/bank-reconciliation',
      token,
      {
        bankAccountId: bank.id,
        statementStartDate: `${new Date().getFullYear()}-11-01`,
        statementEndDate: `${new Date().getFullYear()}-11-30`,
        statementOpeningBalance: 0,
        statementClosingBalance: 11000,
      },
      companyId,
      'create recon'
    );
    created.reconIds.push(recon.id);
    assert.ok(recon.id);
    assert.equal(recon.status, 'Draft');
  });

  check('rejects second open recon for same bank', async () => {
    const res = await request(
      'POST',
      '/api/bank-reconciliation',
      token,
      {
        bankAccountId: bank.id,
        statementStartDate: `${new Date().getFullYear()}-12-01`,
        statementEndDate: `${new Date().getFullYear()}-12-31`,
        statementOpeningBalance: 0,
        statementClosingBalance: 0,
      },
      companyId
    );
    assert.equal(res.status, 400);
    assert.ok(res.body.data?.existingId || /open reconciliation/i.test(res.body.message || ''));
  });

  check('manual statement lines + duplicate detection', async () => {
    const data = await expectOk(
      'POST',
      '/api/bank-reconciliation/statement-transactions/manual',
      token,
      {
        bankAccountId: bank.id,
        reconciliationId: recon.id,
        transactions: [
          {
            transactionDate: d1,
            description: 'Customer payment lump',
            reference: 'PAY-5000',
            credit: 5000,
          },
          {
            transactionDate: d2,
            description: 'Combined deposit',
            reference: 'DEP-3000',
            credit: 3000,
          },
          {
            transactionDate: d3,
            description: 'Batch receipt A',
            reference: 'BR-A',
            credit: 1500,
          },
          {
            transactionDate: d3,
            description: 'Batch receipt B',
            reference: 'BR-B',
            credit: 1500,
          },
          {
            transactionDate: d1,
            description: 'Bank charges',
            reference: 'CHG-100',
            debit: 100,
          },
        ],
      },
      companyId,
      'manual lines'
    );
    assert.equal(data.imported, 5);

    const dup = await expectOk(
      'POST',
      '/api/bank-reconciliation/statement-transactions/manual',
      token,
      {
        bankAccountId: bank.id,
        reconciliationId: recon.id,
        transactions: [
          {
            transactionDate: d1,
            description: 'Customer payment lump',
            reference: 'PAY-5000',
            credit: 5000,
          },
        ],
      },
      companyId,
      'dup lines'
    );
    assert.equal(dup.imported, 0);
    assert.equal(dup.skippedDuplicates, 1);
  });

  let stmtItems;
  check('list statement + book sides', async () => {
    stmtItems = (
      await expectOk(
        'GET',
        `/api/bank-reconciliation/statement-transactions?reconciliationId=${recon.id}&bankAccountId=${bank.id}&status=all&limit=50`,
        token,
        null,
        companyId
      )
    ).items;
    assert.ok(stmtItems.length >= 5);
    const book = await expectOk(
      'GET',
      `/api/bank-reconciliation/book-transactions?bankAccountId=${bank.id}&startDate=${new Date().getFullYear()}-11-01&endDate=${new Date().getFullYear()}-11-30&unmatchedOnly=true&limit=50`,
      token,
      null,
      companyId
    );
    assert.ok(book.items.length >= 5);
  });

  check('1:1 match', async () => {
    const stmt = stmtItems.find((t) => t.reference === 'PAY-5000');
    const line = bankLine(je1);
    const data = await expectOk(
      'POST',
      `/api/bank-reconciliation/${recon.id}/match`,
      token,
      { statementTransactionId: stmt.id, journalLineId: line.id },
      companyId,
      '1:1'
    );
    assert.ok(data.match);
    const refreshed = await prisma.bankStatementTransaction.findUnique({ where: { id: stmt.id } });
    assert.equal(refreshed.status, 'matched');
    const jl = await prisma.journalLine.findUnique({ where: { id: line.id } });
    assert.equal(jl.isReconciled, true);
  });

  check('1:N match (one bank ↔ two books)', async () => {
    const stmt = stmtItems.find((t) => t.reference === 'DEP-3000');
    const data = await expectOk(
      'POST',
      `/api/bank-reconciliation/${recon.id}/match`,
      token,
      {
        statementTransactionIds: [stmt.id],
        journalLineIds: [bankLine(je2a).id, bankLine(je2b).id],
      },
      companyId,
      '1:N'
    );
    assert.ok(data.match?.pairCount === 2 || data.match?.matches?.length === 2 || data.match);
    const refreshed = await prisma.bankStatementTransaction.findUnique({ where: { id: stmt.id } });
    assert.equal(refreshed.status, 'matched');
    const m = await prisma.bankReconciliationMatch.findMany({
      where: { statementTransactionId: stmt.id, isActive: true },
    });
    assert.equal(m.length, 2);
  });

  check('N:1 match (two bank ↔ one book)', async () => {
    // Create one book line of 3000 and match two 1500 statement lines — use je3a+je3b as books summing? 
    // Better: match BR-A + BR-B to a single combined isn't available; create one 3000 JE.
    const jeCombo = await postBankInflow({
      companyId,
      userId: adminId,
      bankCoa,
      offsetCoa: arCoa,
      amount: 3000,
      date: d3,
      ref: 'PAY-3000-COMBO',
      desc: 'Combined receipt',
    });
    // Unmatch would be needed if we already used je3a/b — they are free. Use combo instead of 3a/3b.
    const sA = stmtItems.find((t) => t.reference === 'BR-A');
    const sB = stmtItems.find((t) => t.reference === 'BR-B');
    await expectOk(
      'POST',
      `/api/bank-reconciliation/${recon.id}/match`,
      token,
      {
        statementTransactionIds: [sA.id, sB.id],
        journalLineIds: [bankLine(jeCombo).id],
      },
      companyId,
      'N:1'
    );
    const m = await prisma.bankReconciliationMatch.findMany({
      where: { journalLineId: bankLine(jeCombo).id, isActive: true },
    });
    assert.equal(m.length, 2);
  });

  check('rejects wrong direction match', async () => {
    // Post an outflow book line and try to match to a bank credit
    const outflow = await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-OUT-${crypto.randomUUID().slice(0, 8)}`,
        date: new Date(d1),
        description: 'Outflow',
        reference: 'OUT-1',
        status: 'Posted',
        type: 'Normal',
        createdBy: adminId,
        postedBy: adminId,
        postedAt: new Date(),
        companyId,
        lines: {
          create: [
            {
              accountId: expenseCoa.id,
              accountName: expenseCoa.name,
              accountCode: expenseCoa.code,
              debit: 50,
              credit: 0,
            },
            {
              accountId: bankCoa.id,
              accountName: bankCoa.name,
              accountCode: bankCoa.code,
              debit: 0,
              credit: 50,
              isReconciled: false,
            },
          ],
        },
      },
      include: { lines: true },
    });
    const chargeStmt = stmtItems.find((t) => t.reference === 'CHG-100');
    // charge is bank debit (outflow) — matching to bank credit book line should fail direction
    const bankCreditLine = outflow.lines.find((l) => l.accountId === bankCoa.id);
    // Actually both are outflow — direction should match. Create inflow bank line and try match to charge.
    const inflowLine = bankLine(je3a);
    const res = await request(
      'POST',
      `/api/bank-reconciliation/${recon.id}/match`,
      token,
      { statementTransactionId: chargeStmt.id, journalLineId: inflowLine.id },
      companyId
    );
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  check('bank charge adjustment posts balanced JE and can match', async () => {
    const chargeStmt = stmtItems.find((t) => t.reference === 'CHG-100');
    const data = await expectOk(
      'POST',
      `/api/bank-reconciliation/${recon.id}/adjustments`,
      token,
      {
        type: 'charge',
        amount: 100,
        offsetAccountId: expenseCoa.id,
        description: 'Bank service charge',
        statementTransactionId: chargeStmt.id,
        autoMatchAfter: true,
      },
      companyId,
      'adjustment'
    );
    assert.ok(data.journalEntry);
    const lines = data.journalEntry.lines || [];
    const debits = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const credits = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    assert.ok(Math.abs(debits - credits) < 0.01);
    const refreshed = await prisma.bankStatementTransaction.findUnique({
      where: { id: chargeStmt.id },
    });
    assert.equal(refreshed.status, 'matched');
  });

  check('company isolation — other company cannot view recon', async () => {
    const res = await request(
      'GET',
      `/api/bank-reconciliation/${recon.id}`,
      other.token,
      null,
      other.companyId
    );
    assert.ok(res.status === 404 || res.status === 403 || res.body.success === false);
  });

  check('complete reconciliation when balanced or with remaining book outstanding', async () => {
    // Refresh — difference may remain due to unmatched book (je3a/je3b unused). Statement lines should be matched.
    const detail = await expectOk(
      'GET',
      `/api/bank-reconciliation/${recon.id}`,
      token,
      null,
      companyId
    );
    assert.equal(detail.unmatchedBankCount, 0);

    if (Math.abs(detail.difference) < 0.01) {
      await expectOk(
        'POST',
        `/api/bank-reconciliation/${recon.id}/complete`,
        token,
        {},
        companyId,
        'complete'
      );
    } else {
      // Admin exception path
      await expectOk(
        'POST',
        `/api/bank-reconciliation/${recon.id}/complete`,
        token,
        { exceptionAllowed: true, exceptionNote: 'test outstanding books' },
        companyId,
        'complete exception'
      );
    }
    const done = await prisma.bankReconciliation.findUnique({ where: { id: recon.id } });
    assert.equal(done.status, 'Completed');
  });

  check('reopen preserves matches and unlocks', async () => {
    await expectOk(
      'POST',
      `/api/bank-reconciliation/${recon.id}/reopen`,
      token,
      {},
      companyId,
      'reopen'
    );
    const active = await prisma.bankReconciliationMatch.count({
      where: { reconciliationId: recon.id, isActive: true },
    });
    assert.ok(active >= 4);
    const done = await prisma.bankReconciliation.findUnique({ where: { id: recon.id } });
    assert.equal(done.status, 'InProgress');
  });

  check('audit trail recorded', async () => {
    const audits = await expectOk(
      'GET',
      `/api/bank-reconciliation/${recon.id}/audits?limit=20`,
      token,
      null,
      companyId
    );
    const actions = (audits || []).map((a) => a.action);
    assert.ok(actions.includes('match'));
    assert.ok(actions.includes('complete'));
    assert.ok(actions.includes('reopen'));
  });

  check('dashboard returns bank with book balance', async () => {
    const dash = await expectOk(
      'GET',
      '/api/bank-reconciliation/dashboard',
      token,
      null,
      companyId
    );
    assert.ok(Array.isArray(dash.bankAccounts));
    const row = dash.bankAccounts.find((b) => b.id === bank.id);
    assert.ok(row);
    assert.ok(typeof row.bookBalance === 'number');
  });

  let failed = 0;
  for (const [name, fn] of results) {
    try {
      await fn();
      console.log(`✅ ${name}`);
    } catch (e) {
      failed += 1;
      console.error(`❌ ${name}`);
      console.error(e.message || e);
    }
  }

  await cleanup();
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();

  if (failed) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} bank reconciliation live tests passed`);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await cleanup();
  } catch {
    /* ignore */
  }
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
  } catch {
    /* ignore */
  }
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
