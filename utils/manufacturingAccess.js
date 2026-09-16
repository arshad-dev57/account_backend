'use strict';

function companyIdOf(req) {
  return req.user?.companyId || req.authUserRow?.companyId || null;
}

function userIdOf(req) {
  return req.user?.id || req.authUserRow?.id || null;
}

function requireCompany(req, res) {
  const companyId = companyIdOf(req);
  if (!companyId) {
    res.status(400).json({
      success: false,
      message: 'Company is required to use Manufacturing'
    });
    return null;
  }
  return companyId;
}

function paginationParams(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

function paginationMeta(page, limit, total) {
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / limit));
  return {
    page,
    limit,
    total: Number(total) || 0,
    pages,
    hasNext: page < pages,
    hasPrev: page > 1
  };
}

function toDate(value, fallback = null) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: `W${String(week).padStart(2, '0')}` };
}

module.exports = {
  companyIdOf,
  userIdOf,
  requireCompany,
  paginationParams,
  paginationMeta,
  toDate,
  toNum,
  emptyToNull,
  addDays,
  isoWeek
};
