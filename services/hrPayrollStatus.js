'use strict';

/** Pay period lifecycle — forward-only transitions. */
const PERIOD_STATUSES = [
  'OPEN',
  'CALCULATING',
  'CALCULATED',
  'REVIEW',
  'APPROVED',
  'FINALIZED',
  'PAID',
  'CLOSED'
];

const PERIOD_TRANSITIONS = {
  OPEN: ['CALCULATING', 'CLOSED'],
  CALCULATING: ['CALCULATED', 'OPEN'],
  CALCULATED: ['REVIEW', 'CALCULATING', 'OPEN'],
  REVIEW: ['APPROVED', 'CALCULATED'],
  APPROVED: ['FINALIZED', 'REVIEW'],
  FINALIZED: ['PAID', 'CLOSED'],
  PAID: ['CLOSED'],
  CLOSED: []
};

/** Payroll item lifecycle — maps legacy statuses for compatibility. */
const ITEM_STATUSES = [
  'Draft',
  'Calculated',
  'Review',
  'Approved',
  'Finalized',
  'Paid',
  'Closed',
  'Held'
];

const ITEM_TRANSITIONS = {
  Draft: ['Calculated', 'Review', 'Held', 'Closed'],
  Calculated: ['Review', 'Draft', 'Held'],
  Review: ['Approved', 'Calculated', 'Held', 'Draft'],
  Approved: ['Finalized', 'Paid', 'Review', 'Held'],
  Finalized: ['Paid', 'Closed'],
  Paid: ['Closed'],
  Closed: [],
  Held: ['Draft', 'Calculated', 'Review']
};

const LOCKED_ITEM_STATUSES = new Set(['Finalized', 'Paid', 'Closed']);
const LOCKED_PERIOD_STATUSES = new Set(['FINALIZED', 'PAID', 'CLOSED']);

function normalizeItemStatus(status) {
  const s = String(status || 'Draft');
  if (s === 'Paid' && !ITEM_STATUSES.includes('Paid')) return 'Paid';
  return s;
}

function canTransitionPeriod(from, to) {
  const f = String(from || 'OPEN').toUpperCase();
  const t = String(to || '').toUpperCase();
  return (PERIOD_TRANSITIONS[f] || []).includes(t);
}

function canTransitionItem(from, to) {
  const f = normalizeItemStatus(from);
  const t = normalizeItemStatus(to);
  return (ITEM_TRANSITIONS[f] || []).includes(t);
}

function assertPeriodTransition(from, to) {
  if (!canTransitionPeriod(from, to)) {
    const err = new Error(`Invalid pay period status transition: ${from} → ${to}`);
    err.code = 'INVALID_PERIOD_STATUS';
    throw err;
  }
}

function assertItemTransition(from, to) {
  if (!canTransitionItem(from, to)) {
    const err = new Error(`Invalid payroll item status transition: ${from} → ${to}`);
    err.code = 'INVALID_ITEM_STATUS';
    throw err;
  }
}

function isPeriodLocked(status) {
  return LOCKED_PERIOD_STATUSES.has(String(status || '').toUpperCase());
}

function isItemLocked(status) {
  return LOCKED_ITEM_STATUSES.has(normalizeItemStatus(status));
}

function isItemEditable(status) {
  return !isItemLocked(status);
}

function canRecalculatePeriod(status) {
  const s = String(status || 'OPEN').toUpperCase();
  return ['OPEN', 'CALCULATED', 'REVIEW'].includes(s);
}

/** Map legacy bulk-status values to item transitions. */
function mapBulkStatusTarget(status) {
  const s = String(status || '');
  if (s === 'Review') return 'Review';
  if (s === 'Approved') return 'Approved';
  if (s === 'Paid') return 'Paid';
  if (s === 'Held') return 'Held';
  if (s === 'Draft') return 'Draft';
  if (s === 'Finalized') return 'Finalized';
  if (s === 'Closed') return 'Closed';
  if (s === 'Calculated') return 'Calculated';
  return s;
}

module.exports = {
  PERIOD_STATUSES,
  PERIOD_TRANSITIONS,
  ITEM_STATUSES,
  ITEM_TRANSITIONS,
  LOCKED_ITEM_STATUSES,
  LOCKED_PERIOD_STATUSES,
  normalizeItemStatus,
  canTransitionPeriod,
  canTransitionItem,
  assertPeriodTransition,
  assertItemTransition,
  isPeriodLocked,
  isItemLocked,
  isItemEditable,
  canRecalculatePeriod,
  mapBulkStatusTarget
};
