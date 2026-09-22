'use strict';

const prisma = require('../prisma/client');
const { workDateKey } = require('../utils/hrAccess');

function ymd(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function parseRange(fromStr, toStr) {
  const from = workDateKey(new Date(fromStr));
  const to = workDateKey(new Date(toStr));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    const err = new Error('Invalid date range');
    err.status = 400;
    throw err;
  }
  if (from > to) {
    const err = new Error('Start date must be before end date');
    err.status = 400;
    throw err;
  }
  const maxDays = 93;
  const diff = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  if (diff > maxDays) {
    const err = new Error(`Date range cannot exceed ${maxDays} days`);
    err.status = 400;
    throw err;
  }
  return { from, to, dayCount: diff };
}

function eachDay(from, to) {
  const days = [];
  const cur = new Date(from);
  while (cur <= to) {
    days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

function fullName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'Employee';
}

function classifyDay({ date, employeeId, attendance, onLeave, holiday }) {
  const a = attendance;
  const weekend = date.getUTCDay() === 0;
  if (holiday) return 'Holiday';
  if (weekend) return 'Weekend';
  if (onLeave) return 'On leave';
  if (a?.checkIn && a?.checkOut && Number(a.workingMinutes || 0) < 240) return 'Half day';
  if (a?.checkIn && !a.checkOut) return 'Missing checkout';
  if (String(a?.status || '').toLowerCase() === 'late') return 'Late';
  if (a?.checkIn) return 'Present';
  return 'Absent';
}

function summarizeRows(rows) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  const workingRows = rows.filter((r) => Number(r.workingMinutes || 0) > 0);
  const totalWorkingMinutes = workingRows.reduce((s, r) => s + Number(r.workingMinutes || 0), 0);
  return {
    totalDays: rows.length,
    present: count('Present'),
    late: count('Late'),
    absent: count('Absent'),
    halfDay: count('Half day'),
    onLeave: count('On leave'),
    holiday: count('Holiday'),
    weekend: count('Weekend'),
    missingCheckout: count('Missing checkout'),
    totalWorkingMinutes,
    avgWorkingMinutes: workingRows.length
      ? Math.round(totalWorkingMinutes / workingRows.length)
      : 0
  };
}

async function buildAttendanceReport({ companyId, fromStr, toStr, employeeId, department }) {
  const { from, to, dayCount } = parseRange(fromStr, toStr);
  const days = eachDay(from, to);

  const employeeWhere = { companyId, status: { not: 'terminated' } };
  if (employeeId) employeeWhere.id = String(employeeId);
  if (department) {
    employeeWhere.department = { equals: String(department).trim(), mode: 'insensitive' };
  }

  const employees = await prisma.hrEmployee.findMany({
    where: employeeWhere,
    include: { user: { select: { firstName: true, lastName: true } } },
    orderBy: { employeeCode: 'asc' }
  });

  if (employeeId && !employees.length) {
    const err = new Error('Employee not found');
    err.status = 404;
    throw err;
  }

  const [attendanceRows, leaves, holidays] = await Promise.all([
    prisma.hrAttendance.findMany({
      where: {
        companyId,
        workDate: { gte: from, lte: to },
        ...(employeeId ? { employeeId: String(employeeId) } : {})
      }
    }),
    prisma.hrLeave.findMany({
      where: {
        companyId,
        status: 'Approved',
        fromDate: { lte: to },
        toDate: { gte: from },
        ...(employeeId ? { employeeId: String(employeeId) } : {})
      }
    }),
    prisma.hrHoliday.findMany({
      where: {
        companyId,
        date: { gte: from, lte: to }
      }
    })
  ]);

  const attMap = new Map();
  attendanceRows.forEach((r) => {
    attMap.set(`${r.employeeId}:${ymd(r.workDate)}`, r);
  });

  const leaveSet = new Set();
  leaves.forEach((leave) => {
    const start = workDateKey(leave.fromDate);
    const end = workDateKey(leave.toDate);
    const cur = new Date(start);
    while (cur <= end) {
      leaveSet.add(`${leave.employeeId}:${ymd(cur)}`);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  });

  const holidaySet = new Set(holidays.map((h) => ymd(h.date)));

  const rows = [];
  employees.forEach((emp) => {
    days.forEach((date) => {
      const key = ymd(date);
      const a = attMap.get(`${emp.id}:${key}`);
      const status = classifyDay({
        date,
        employeeId: emp.id,
        attendance: a,
        onLeave: leaveSet.has(`${emp.id}:${key}`),
        holiday: holidaySet.has(key)
      });
      rows.push({
        date: key,
        dayName: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        employee: fullName(emp.user),
        department: emp.department || '',
        designation: emp.designation || '',
        status,
        checkIn: a?.checkIn || null,
        checkOut: a?.checkOut || null,
        workingMinutes: Number(a?.workingMinutes || 0),
        source: a?.source || null
      });
    });
  });

  const summary = summarizeRows(rows);
  const primary = employees.length === 1 ? employees[0] : null;

  return {
    from: ymd(from),
    to: ymd(to),
    dayCount,
    employeeCount: employees.length,
    employee: primary
      ? {
          id: primary.id,
          employeeCode: primary.employeeCode,
          name: fullName(primary.user),
          department: primary.department || '',
          designation: primary.designation || ''
        }
      : null,
    summary,
    rows
  };
}

module.exports = {
  buildAttendanceReport,
  summarizeRows,
  ymd
};
