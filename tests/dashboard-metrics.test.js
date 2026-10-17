const assert = require('assert');
const {
  pctChange,
  roundPct,
  splitBankAndCashAccounts,
  liquidCashBalance,
  netWorkingCapital,
  pluralize,
  ageOutstandingBuckets,
  daysSalesOutstanding,
  daysPayableOutstanding,
  currentRatio,
  quickRatio,
} = require('../utils/dashboardMetricsHelper');

describe('dashboardMetricsHelper', () => {
  it('does not invent ±100% when prior period is zero', () => {
    assert.strictEqual(pctChange(20330, 0), null);
    assert.strictEqual(pctChange(0, 0), null);
    assert.strictEqual(roundPct(pctChange(200, 100)), 100);
    assert.ok(Math.abs(pctChange(150, 100) - 50) < 1e-9);
  });

  it('splits cash-mirror bank rows so Cash and Bank are not double-counted', () => {
    const cashCoaId = 'coa-cash-1001';
    const accounts = [
      {
        accountName: 'Cash in Hand',
        accountType: 'Cash',
        chartOfAccountId: cashCoaId,
        currentBalance: -60470,
      },
      {
        accountName: 'HBL Current',
        accountType: 'Current',
        chartOfAccountId: 'coa-bank-1',
        currentBalance: 10000,
      },
      {
        accountName: 'Petty Cash',
        accountType: 'Cash',
        chartOfAccountId: 'coa-other',
        currentBalance: 500,
      },
    ];

    const split = splitBankAndCashAccounts(accounts, cashCoaId);
    assert.strictEqual(split.bankAccountsCount, 1);
    assert.strictEqual(split.cashMirrorCount, 2);
    assert.strictEqual(split.bankBalance, 10000);
    assert.strictEqual(split.cashMirrorBalance, -59970);

    const cashInHand = -60470;
    const liquid = liquidCashBalance(cashInHand, split.bankBalance);
    // Must NOT be cash + cash-mirror + bank (-60470*2 + 10000)
    assert.strictEqual(liquid, -50470);
    assert.notStrictEqual(liquid, cashInHand + split.cashMirrorBalance + split.bankBalance);
  });

  it('excludes cash-COA-linked Current-type bank row from bank sum', () => {
    const cashId = 'cash-id';
    const split = splitBankAndCashAccounts(
      [
        {
          accountName: 'Operating Cash Mirror',
          accountType: 'Current',
          chartOfAccountId: cashId,
          currentBalance: -60470,
        },
      ],
      cashId
    );
    assert.strictEqual(split.bankBalance, 0);
    assert.strictEqual(split.cashMirrorCount, 1);
  });

  it('computes NWC as current assets − current liabilities (incl. inventory)', () => {
    // Prefer full CA/CL when provided
    assert.strictEqual(
      netWorkingCapital({
        currentAssets: 100000,
        currentLiabilities: 40000,
      }),
      60000
    );

    // Fallback includes inventory (not Cash + AR − AP alone)
    assert.strictEqual(
      netWorkingCapital({
        cashInHand: -60470,
        bankBalance: 0,
        inventory: 63800,
        receivables: 0,
        payables: 0,
      }),
      3330
    );

    const wrongCashOnly = -60470 + 0 - 0;
    assert.notStrictEqual(
      netWorkingCapital({
        cashInHand: -60470,
        bankBalance: 0,
        inventory: 63800,
        receivables: 0,
        payables: 0,
      }),
      wrongCashOnly
    );
  });

  it('handles negative cash without inventing capital', () => {
    const cash = -60470;
    assert.ok(cash < 0);
    // Liquid with no banks stays the real ledger cash balance
    assert.strictEqual(liquidCashBalance(cash, 0), -60470);
  });

  it('pluralizes account/type labels', () => {
    assert.strictEqual(pluralize(1, 'account'), '1 account');
    assert.strictEqual(pluralize(2, 'account'), '2 accounts');
    assert.strictEqual(pluralize(1, 'type'), '1 type');
  });

  it('ages AR/AP into 0–30 / 31–60 / 60+', () => {
    const asOf = new Date('2026-10-16');
    const buckets = ageOutstandingBuckets(
      [
        { outstanding: 1000, invoiceDate: '2026-10-01' },
        { outstanding: 2000, invoiceDate: '2026-08-20' },
        { outstanding: 3000, invoiceDate: '2026-07-01' },
      ],
      asOf,
      'invoiceDate'
    );
    assert.strictEqual(buckets['0-30'], 1000);
    assert.strictEqual(buckets['31-60'], 2000);
    assert.strictEqual(buckets['60+'], 3000);
    assert.strictEqual(buckets.total, 6000);
  });

  it('returns null DSO/DPO and ratios when denominators are zero', () => {
    assert.strictEqual(daysSalesOutstanding(1000, 0, 30), null);
    assert.strictEqual(daysPayableOutstanding(500, 0, 30), null);
    assert.strictEqual(currentRatio(100, 0), null);
    assert.strictEqual(quickRatio(100, 20, 0), null);
    assert.strictEqual(daysSalesOutstanding(1000, 10000, 30), 3);
  });

  it('isolates company by only aggregating the provided account rows', () => {
    const companyA = splitBankAndCashAccounts(
      [{ accountType: 'Current', chartOfAccountId: 'b1', currentBalance: 50 }],
      'cash-a'
    );
    const companyB = splitBankAndCashAccounts(
      [{ accountType: 'Current', chartOfAccountId: 'b2', currentBalance: 999 }],
      'cash-b'
    );
    assert.strictEqual(companyA.bankBalance, 50);
    assert.strictEqual(companyB.bankBalance, 999);
  });
});
