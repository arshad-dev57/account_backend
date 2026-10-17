/**
 * Pure helpers for Accounting Dashboard KPIs.
 * Keep ledger-safe: never invent balances; only classify and aggregate given inputs.
 */

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Growth % vs prior period. Returns null when prior is zero/unavailable
 * so the UI can show "New" / "—" instead of a fake ±100%.
 */
function pctChange(current, previous) {
  const cur = toNum(current);
  const prev = toNum(previous);
  if (prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function roundPct(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

/**
 * Split BankAccount rows into true bank vs cash mirrors of Cash-in-Hand COA.
 * Cash-type module rows and any row linked to the cash COA must not be summed
 * into "Bank" when Cash is also shown from Chart of Accounts.
 */
function splitBankAndCashAccounts(bankAccounts = [], cashCoaId = null) {
  const cashId = cashCoaId ? String(cashCoaId) : null;
  const cashMirrors = [];
  const trueBanks = [];

  for (const acc of bankAccounts || []) {
    const type = String(acc.accountType || '').toLowerCase();
    const name = String(acc.accountName || acc.bankName || '');
    const linked =
      cashId &&
      acc.chartOfAccountId != null &&
      String(acc.chartOfAccountId) === cashId;
    const isCashType = type === 'cash';
    const isCashNamed = /cash\s*in\s*hand|^cash$/i.test(name.trim());

    if (linked || isCashType || isCashNamed) {
      cashMirrors.push(acc);
    } else {
      trueBanks.push(acc);
    }
  }

  const bankBalance = trueBanks.reduce((s, a) => s + toNum(a.currentBalance), 0);
  const cashMirrorBalance = cashMirrors.reduce(
    (s, a) => s + toNum(a.currentBalance),
    0
  );

  return {
    trueBanks,
    cashMirrors,
    bankBalance,
    cashMirrorBalance,
    bankAccountsCount: trueBanks.length,
    cashMirrorCount: cashMirrors.length,
  };
}

/**
 * Liquid cash = COA Cash in Hand + true bank accounts (excludes cash mirrors).
 */
function liquidCashBalance(cashInHand, bankBalance) {
  return toNum(cashInHand) + toNum(bankBalance);
}

/**
 * Net working capital = current assets − current liabilities.
 * Prefer full current-asset / current-liability totals when provided.
 * Fallback: cash + bank + inventory + AR − AP.
 */
function netWorkingCapital({
  currentAssets = null,
  currentLiabilities = null,
  cashInHand = 0,
  bankBalance = 0,
  inventory = 0,
  receivables = 0,
  payables = 0,
} = {}) {
  if (currentAssets != null && currentLiabilities != null) {
    return toNum(currentAssets) - toNum(currentLiabilities);
  }
  return (
    toNum(cashInHand) +
    toNum(bankBalance) +
    toNum(inventory) +
    toNum(receivables) -
    toNum(payables)
  );
}

function pluralize(count, singular, plural = `${singular}s`) {
  const n = toNum(count);
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * AR/AP aging buckets from open invoices with a date + outstanding.
 * Buckets: 0–30, 31–60, 60+ days (from asOf).
 */
function ageOutstandingBuckets(rows = [], asOf = new Date(), dateField = 'date') {
  const asOfMs = new Date(asOf).getTime();
  const buckets = {
    '0-30': 0,
    '31-60': 0,
    '60+': 0,
    total: 0,
    count: 0,
  };
  for (const row of rows || []) {
    const outstanding = toNum(row.outstanding);
    if (outstanding <= 0) continue;
    const raw = row[dateField] ?? row.invoiceDate ?? row.date;
    const d = raw ? new Date(raw) : null;
    const days =
      d && !Number.isNaN(d.getTime())
        ? Math.max(0, Math.floor((asOfMs - d.getTime()) / (24 * 60 * 60 * 1000)))
        : 0;
    buckets.total += outstanding;
    buckets.count += 1;
    if (days <= 30) buckets['0-30'] += outstanding;
    else if (days <= 60) buckets['31-60'] += outstanding;
    else buckets['60+'] += outstanding;
  }
  return buckets;
}

/**
 * DSO = (AR / credit sales) × days in period. Null when sales ≤ 0.
 * DPO = (AP / purchases) × days in period. Null when purchases ≤ 0.
 */
function daysSalesOutstanding(receivables, creditSales, periodDays) {
  const sales = toNum(creditSales);
  const days = toNum(periodDays);
  if (sales <= 0 || days <= 0) return null;
  return (toNum(receivables) / sales) * days;
}

function daysPayableOutstanding(payables, purchases, periodDays) {
  const purch = toNum(purchases);
  const days = toNum(periodDays);
  if (purch <= 0 || days <= 0) return null;
  return (toNum(payables) / purch) * days;
}

function currentRatio(currentAssets, currentLiabilities) {
  const cl = toNum(currentLiabilities);
  if (cl <= 0) return null;
  return toNum(currentAssets) / cl;
}

/** Quick ratio ≈ (current assets − inventory) / current liabilities */
function quickRatio(currentAssets, inventory, currentLiabilities) {
  const cl = toNum(currentLiabilities);
  if (cl <= 0) return null;
  return (toNum(currentAssets) - toNum(inventory)) / cl;
}

module.exports = {
  toNum,
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
};
