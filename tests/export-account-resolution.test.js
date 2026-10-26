'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const accounting = require('../services/exportAccountingService');

const COMPANY_ID = 'company-1';
const USER_ID = 'user-1';

function matches(row, where) {
  return Object.entries(where || {}).every(([key, expected]) => {
    if (key === 'OR') return expected.some((clause) => matches(row, clause));
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const value = String(row[key] ?? '');
      if ('equals' in expected) {
        return expected.mode === 'insensitive'
          ? value.toLowerCase() === String(expected.equals).toLowerCase()
          : value === expected.equals;
      }
      if ('contains' in expected) {
        return expected.mode === 'insensitive'
          ? value.toLowerCase().includes(String(expected.contains).toLowerCase())
          : value.includes(expected.contains);
      }
      if ('startsWith' in expected) {
        return expected.mode === 'insensitive'
          ? value.toLowerCase().startsWith(String(expected.startsWith).toLowerCase())
          : value.startsWith(expected.startsWith);
      }
    }
    return row[key] === expected;
  });
}

function fakeChart(initialRows) {
  const rows = initialRows.map((row) => ({ ...row }));
  return {
    rows,
    chartOfAccount: {
      async findFirst({ where }) {
        return rows.find((row) => matches(row, where)) || null;
      },
      async create({ data }) {
        if (rows.some((row) => row.companyId === data.companyId && row.code === data.code)) {
          const err = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
        const row = { id: `acc-${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      },
    },
  };
}

test('account resolution', async (t) => {
  await t.test('never reuses an unrelated account that owns the requested code', async () => {
    const tx = fakeChart([
      { companyId: COMPANY_ID, code: '2200', name: 'Salaries Payable', type: 'Liability', isActive: true },
    ]);
    const account = await accounting.getCustomerAdvancesAccount(tx, COMPANY_ID, USER_ID);
    assert.equal(account.code, '2201');
    assert.equal(account.name, 'Customer Advances');
    assert.equal(tx.rows.find((row) => row.code === '2200').name, 'Salaries Payable');
  });

  await t.test('prefers an exact name match over the requested code', async () => {
    const tx = fakeChart([
      { companyId: COMPANY_ID, code: '7100', name: 'Foreign Exchange Loss', type: 'Expense', isActive: true },
      { companyId: COMPANY_ID, code: '4201', name: 'Foreign Exchange Gain', type: 'Revenue', isActive: true },
    ]);
    const gain = await accounting.getFxGainAccount(tx, COMPANY_ID, USER_ID);
    const loss = await accounting.getFxLossAccount(tx, COMPANY_ID, USER_ID);
    assert.equal(gain.code, '4201');
    assert.equal(loss.code, '7100');
    assert.equal(tx.rows.length, 2);
  });

  await t.test('matches keywords only within the requested account type', async () => {
    const tx = fakeChart([
      { companyId: COMPANY_ID, code: '6250', name: 'Sales Commission Income', type: 'Revenue', isActive: true },
      { companyId: COMPANY_ID, code: '6810', name: 'Bank Fees & Commission', type: 'Expense', isActive: true },
    ]);
    const commission = await accounting.getCommissionAccount(tx, COMPANY_ID, USER_ID);
    assert.equal(commission.code, '6251');
    assert.equal(commission.type, 'Expense');

    const bank = await accounting.getBankChargesAccount(tx, COMPANY_ID, USER_ID);
    assert.equal(bank.code, '6810');
  });

  await t.test('skips inactive accounts and reuses the created account afterwards', async () => {
    const tx = fakeChart([
      { companyId: COMPANY_ID, code: '2200', name: 'Customer Advances', type: 'Liability', isActive: false },
    ]);
    const first = await accounting.getCustomerAdvancesAccount(tx, COMPANY_ID, USER_ID);
    const second = await accounting.getCustomerAdvancesAccount(tx, COMPANY_ID, USER_ID);
    assert.equal(first.code, '2201');
    assert.equal(second.id, first.id);
    assert.equal(tx.rows.filter((row) => row.name === 'Customer Advances').length, 2);
  });
});
