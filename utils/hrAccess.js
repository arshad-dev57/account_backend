function normalizeRole(role) {
  return String(role || '').toLowerCase().trim();
}

function isEmployeeRole(role) {
  return normalizeRole(role) === 'employee';
}

function isHrAdminRole(role) {
  const r = normalizeRole(role);
  return [
    'admin',
    'owner',
    'superadmin',
    'company_admin',
    'manager',
    'hr',
    'hr_manager'
  ].includes(r);
}

function canManageHr(user) {
  if (!user) return false;
  if (isEmployeeRole(user.role) && !isHrAdminRole(user.role)) return false;
  return true;
}

function companyIdOf(req) {
  return req.user?.companyId || req.authUserRow?.companyId || null;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function workDateKey(date = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
  return new Date(`${ymd}T00:00:00.000Z`);
}

function isLateCheckIn(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return hour > 9 || (hour === 9 && minute > 15);
}

function generateTempPassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const crypto = require('crypto');
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function statusLabel(status) {
  const map = {
    active: 'Active',
    inactive: 'Inactive',
    on_leave: 'On Leave',
    terminated: 'Terminated',
    present: 'Present',
    late: 'Late',
    absent: 'Absent'
  };
  const key = String(status || '').toLowerCase();
  return map[key] || status || '';
}

function statusKey(label) {
  const key = String(label || '').toLowerCase().trim().replace(/\s+/g, '_');
  if (['active', 'inactive', 'on_leave', 'terminated'].includes(key)) return key;
  if (key === 'onleave') return 'on_leave';
  return 'active';
}

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Employee', lastName: 'User' };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function requireCompany(req, res) {
  const companyId = companyIdOf(req);
  if (!companyId) {
    res.status(400).json({
      success: false,
      message: 'Company is required to use HR'
    });
    return null;
  }
  return companyId;
}

function canViewSalary(user) {
  const r = normalizeRole(user?.role);
  return ['admin', 'owner', 'superadmin', 'company_admin', 'hr', 'hr_manager'].includes(r);
}

function canProcessPayroll(user) {
  return canViewSalary(user);
}

function requirePayrollAccess(req, res) {
  if (!canProcessPayroll(req.user)) {
    res.status(403).json({
      success: false,
      message: 'Payroll and salary data is restricted'
    });
    return false;
  }
  return true;
}

function requireHrManager(req, res) {
  if (!canManageHr(req.user)) {
    res.status(403).json({
      success: false,
      message: 'Employees cannot access HR admin features'
    });
    return false;
  }
  return true;
}

module.exports = {
  isEmployeeRole,
  isHrAdminRole,
  canManageHr,
  companyIdOf,
  haversineMeters,
  workDateKey,
  isLateCheckIn,
  generateTempPassword,
  statusLabel,
  statusKey,
  splitName,
  requireCompany,
  requireHrManager,
  canViewSalary,
  canProcessPayroll,
  requirePayrollAccess
};
