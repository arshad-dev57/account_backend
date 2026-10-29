'use strict';

/**
 * The HR reports the Frappe HR workspaces link from their sidebars. Every
 * report reads the same company-scoped tables the document layer writes to, so
 * a number shown here can be traced back to real records; nothing is estimated.
 *
 * A report is `{ doctype, columns, build }`. `columns` drives the table header
 * and `type` tells the UI how to render a cell, exactly like ERPNext Report's
 * `columns` definition.
 */

const prisma = require('../prisma/client');
const { workDateKey } = require('../utils/hrAccess');
const { buildAttendanceReport, ymd } = require('./hrAttendanceReport');

function range(query, fallbackDays = 30) {
  const to = query.to ? new Date(`${String(query.to).slice(0, 10)}T00:00:00.000Z`) : null;
  const from = query.from ? new Date(`${String(query.from).slice(0, 10)}T00:00:00.000Z`) : null;
  if (to && Number.isNaN(to.getTime())) throw badRequest('Invalid "to" date');
  if (from && Number.isNaN(from.getTime())) throw badRequest('Invalid "from" date');
  if (from && to && from > to) throw badRequest('Start date must be before end date');
  const end = to || new Date();
  if (!to && !from) {
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - fallbackDays);
    return { from: start, to: end };
  }
  return { from: from || end, to: end };
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function empName(employee) {
  const user = employee?.user;
  if (!user) return employee?.employeeCode || '';
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || employee?.employeeCode || '';
}

const USER_SELECT = { firstName: true, lastName: true, email: true };

const EMPLOYEE_SELECT = {
  id: true,
  employeeCode: true,
  department: true,
  designation: true,
  joiningDate: true,
  status: true,
  salary: true,
  salaryCurrency: true,
  officeId: true,
  user: { select: USER_SELECT }
};

const EMPLOYEE_LOOKUP = {
  employeeCode: true,
  user: { select: USER_SELECT }
};

function employeeWhere(companyId, query) {
  const where = { companyId };
  if (query.employeeId) where.id = String(query.employeeId);
  if (query.department) where.department = { equals: String(query.department).trim(), mode: 'insensitive' };
  return where;
}

const reports = {
  'employee-information': {
    doctype: 'Employee Information',
    filters: ['employee', 'department'],
    columns: [
      { key: 'employeeCode', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'department', label: 'Department' },
      { key: 'designation', label: 'Designation' },
      { key: 'joiningDate', label: 'Date of Joining', type: 'date' },
      { key: 'status', label: 'Status' }
    ],
    async build({ companyId, query }) {
      const rows = await prisma.hrEmployee.findMany({
        where: employeeWhere(companyId, query),
        select: EMPLOYEE_SELECT,
        orderBy: { employeeCode: 'asc' }
      });
      return rows.map((e) => ({
        employeeCode: e.employeeCode,
        employeeName: empName(e),
        department: e.department || '',
        designation: e.designation || '',
        joiningDate: e.joiningDate ? ymd(e.joiningDate) : '',
        status: e.status
      }));
    }
  },

  'employee-exits': {
    doctype: 'Employee Exits',
    filters: ['date'],
    columns: [
      { key: 'employeeCode', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'department', label: 'Department' },
      { key: 'designation', label: 'Designation' },
      { key: 'separationDate', label: 'Separation Date', type: 'date' },
      { key: 'boardingStatus', label: 'Boarding Status' },
      { key: 'status', label: 'Status' }
    ],
    async build({ companyId, from, to }) {
      const rows = await prisma.hrEmployeeSeparation.findMany({
        where: { companyId, separationDate: { gte: from, lte: to } },
        include: { employee: { select: EMPLOYEE_SELECT } },
        orderBy: { separationDate: 'asc' }
      });
      return rows
        .filter((r) => r.employee)
        .map((r) => ({
          employeeCode: r.employee.employeeCode,
          employeeName: empName(r.employee),
          department: r.department || r.employee.department || '',
          designation: r.designation || r.employee.designation || '',
          separationDate: ymd(r.separationDate),
          boardingStatus: r.boardingStatus || '',
          status: r.status
        }));
    }
  },

  'employee-analytics': {
    doctype: 'Employee Analytics',
    filters: ['date'],
    columns: [
      { key: 'month', label: 'Month' },
      { key: 'joined', label: 'Joined', type: 'number' },
      { key: 'exited', label: 'Exited', type: 'number' },
      { key: 'active', label: 'Active at Month End', type: 'number' }
    ],
    async build({ companyId, from, to }) {
      const [employees, separations] = await Promise.all([
        prisma.hrEmployee.findMany({
          where: { companyId },
          select: { id: true, joiningDate: true, status: true }
        }),
        prisma.hrEmployeeSeparation.findMany({
          where: { companyId },
          select: { employeeId: true, separationDate: true }
        })
      ]);

      const exitByEmployee = new Map();
      for (const s of separations) {
        if (!s.employeeId || !s.separationDate) continue;
        const current = exitByEmployee.get(s.employeeId);
        if (!current || s.separationDate > current) exitByEmployee.set(s.employeeId, s.separationDate);
      }

      const months = [];
      const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
      const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
      while (cursor <= last) {
        months.push(new Date(cursor));
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }

      return months.map((month) => {
        const next = new Date(month);
        next.setUTCMonth(next.getUTCMonth() + 1);
        const key = month.toISOString().slice(0, 7);
        const joined = employees.filter((e) => e.joiningDate && ymd(e.joiningDate).slice(0, 7) === key).length;
        const exited = employees.filter((e) => {
          const out = exitByEmployee.get(e.id);
          return out && ymd(out).slice(0, 7) === key;
        }).length;
        const active = employees.filter((e) => {
          if (e.joiningDate && ymd(e.joiningDate) >= ymd(next)) return false;
          const out = exitByEmployee.get(e.id);
          if (out && ymd(out) < ymd(next)) return false;
          return e.status !== 'Left' && e.status !== 'terminated' && e.status !== 'Inactive';
        }).length;
        return {
          month: month.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
          joined,
          exited,
          active
        };
      });
    }
  },

  'recruitment-analytics': {
    doctype: 'Recruitment Analytics',
    filters: ['date'],
    columns: [
      { key: 'jobTitle', label: 'Job Opening' },
      { key: 'openings', label: 'Openings', type: 'number' },
      { key: 'applicants', label: 'Applicants', type: 'number' },
      { key: 'interviews', label: 'Interviews', type: 'number' },
      { key: 'offers', label: 'Offers', type: 'number' },
      { key: 'hired', label: 'Hired', type: 'number' },
      { key: 'status', label: 'Status' }
    ],
    async build({ companyId, from, to }) {
      const openings = await prisma.hrJobOpening.findMany({
        where: { companyId },
        include: {
          applicants: {
            where: { createdAt: { gte: from, lte: to } },
            select: {
              id: true,
              status: true,
              interviews: { select: { id: true } },
              offers: { select: { id: true, status: true, employeeId: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
      return openings.map((opening) => {
        const applicants = opening.applicants || [];
        const offers = applicants.flatMap((a) => a.offers || []);
        return {
          jobTitle: opening.title,
          openings: Number(opening.openings || 0),
          applicants: applicants.length,
          interviews: applicants.reduce((sum, a) => sum + (a.interviews || []).length, 0),
          offers: offers.length,
          hired: offers.filter((o) => o.employeeId || o.status === 'Accepted').length,
          status: opening.status || ''
        };
      });
    }
  },

  'monthly-attendance-sheet': {
    doctype: 'Monthly Attendance Sheet',
    // Exact ERPNext Monthly Attendance Sheet filters.
    filterDefs: [
      {
        key: 'filterBasedOn',
        label: 'Filter Based On',
        type: 'select',
        options: ['Month', 'Date Range'],
        default: 'Month',
        required: true
      },
      {
        key: 'month',
        label: 'Month',
        type: 'select',
        options: [
          { value: '1', label: 'Jan' },
          { value: '2', label: 'Feb' },
          { value: '3', label: 'Mar' },
          { value: '4', label: 'Apr' },
          { value: '5', label: 'May' },
          { value: '6', label: 'June' },
          { value: '7', label: 'July' },
          { value: '8', label: 'Aug' },
          { value: '9', label: 'Sep' },
          { value: '10', label: 'Oct' },
          { value: '11', label: 'Nov' },
          { value: '12', label: 'Dec' }
        ],
        when: { filterBasedOn: 'Month' }
      },
      {
        key: 'year',
        label: 'Year',
        type: 'select',
        options: 'years',
        when: { filterBasedOn: 'Month' }
      },
      {
        key: 'from',
        label: 'Start Date',
        type: 'date',
        when: { filterBasedOn: 'Date Range' }
      },
      {
        key: 'to',
        label: 'End Date',
        type: 'date',
        when: { filterBasedOn: 'Date Range' }
      },
      { key: 'employeeId', label: 'Employee', type: 'link', options: 'employee' },
      { key: 'employmentType', label: 'Employment Type', type: 'link', options: 'employment-type' },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        options: ['', 'Active', 'Inactive', 'Suspended', 'Left'],
        default: 'Active'
      },
      { key: 'company', label: 'Company', type: 'company', required: true },
      { key: 'departmentId', label: 'Department', type: 'link', options: 'department' },
      { key: 'branchId', label: 'Branch', type: 'link', options: 'branch' },
      {
        key: 'groupBy',
        label: 'Group By',
        type: 'select',
        options: ['', 'Branch', 'Grade', 'Department', 'Designation']
      },
      {
        key: 'includeCompanyDescendants',
        label: 'Include Company Descendants',
        type: 'check',
        default: true
      },
      { key: 'summarizedView', label: 'Summarized View', type: 'check', default: false }
    ],
    columns: [],
    async build({ companyId, query }) {
      const now = new Date();
      const filterBasedOn = String(query.filterBasedOn || 'Month');
      let fromStr;
      let toStr;
      if (filterBasedOn === 'Date Range') {
        fromStr = String(query.from || '').slice(0, 10);
        toStr = String(query.to || '').slice(0, 10);
        if (!fromStr || !toStr) {
          const err = new Error('Start Date and End Date are required for Date Range');
          err.status = 400;
          throw err;
        }
      } else {
        const month = Number(query.month || now.getUTCMonth() + 1);
        const year = Number(query.year || now.getUTCFullYear());
        fromStr = `${year}-${String(month).padStart(2, '0')}-01`;
        const last = new Date(Date.UTC(year, month, 0));
        toStr = ymd(last);
      }

      const data = await buildAttendanceReport({
        companyId,
        fromStr,
        toStr,
        employeeId: query.employeeId || null,
        employmentType: query.employmentType || null,
        status: query.status || null,
        branchId: query.branchId || null,
        departmentId: query.departmentId || null
      });

      const summarized = query.summarizedView === true || query.summarizedView === '1' || query.summarizedView === 'true';
      const groupBy = String(query.groupBy || '');

      if (summarized) {
        const byEmp = new Map();
        for (const row of data.rows) {
          if (!byEmp.has(row.employeeId)) {
            byEmp.set(row.employeeId, {
              employeeCode: row.employeeCode,
              employee: row.employee,
              department: row.department,
              branch: row.branch,
              grade: row.grade,
              designation: row.designation,
              present: 0,
              absent: 0,
              leave: 0,
              halfDay: 0,
              holiday: 0,
              weekend: 0,
              workingMinutes: 0
            });
          }
          const bucket = byEmp.get(row.employeeId);
          if (row.status === 'Present' || row.status === 'Late' || row.status === 'Missing checkout') bucket.present += 1;
          else if (row.status === 'Absent') bucket.absent += 1;
          else if (row.status === 'On leave') bucket.leave += 1;
          else if (row.status === 'Half day') bucket.halfDay += 1;
          else if (row.status === 'Holiday') bucket.holiday += 1;
          else if (row.status === 'Weekend') bucket.weekend += 1;
          bucket.workingMinutes += Number(row.workingMinutes || 0);
        }
        const rows = [...byEmp.values()].map((r) => ({
          ...(groupBy === 'Branch' ? { group: r.branch || '—' } : {}),
          ...(groupBy === 'Grade' ? { group: r.grade || '—' } : {}),
          ...(groupBy === 'Department' ? { group: r.department || '—' } : {}),
          ...(groupBy === 'Designation' ? { group: r.designation || '—' } : {}),
          employeeCode: r.employeeCode,
          employee: r.employee,
          department: r.department,
          present: r.present,
          absent: r.absent,
          leave: r.leave,
          halfDay: r.halfDay,
          holiday: r.holiday,
          weekend: r.weekend,
          workingMinutes: r.workingMinutes
        }));
        return {
          columns: [
            ...(groupBy ? [{ key: 'group', label: groupBy }] : []),
            { key: 'employeeCode', label: 'Employee ID' },
            { key: 'employee', label: 'Employee' },
            { key: 'department', label: 'Department' },
            { key: 'present', label: 'Total Present', type: 'number' },
            { key: 'absent', label: 'Total Absent', type: 'number' },
            { key: 'leave', label: 'Total Leave', type: 'number' },
            { key: 'halfDay', label: 'Total Half Day', type: 'number' },
            { key: 'holiday', label: 'Holidays', type: 'number' },
            { key: 'weekend', label: 'Weekends', type: 'number' },
            { key: 'workingMinutes', label: 'Working Minutes', type: 'number' }
          ],
          rows,
          meta: { from: fromStr, to: toStr }
        };
      }

      const dayKeys = [...new Set(data.rows.map((r) => r.date))].sort();
      const byEmp = new Map();
      for (const row of data.rows) {
        if (!byEmp.has(row.employeeId)) {
          byEmp.set(row.employeeId, {
            employeeCode: row.employeeCode,
            employee: row.employee,
            department: row.department,
            branch: row.branch,
            grade: row.grade,
            designation: row.designation,
            days: {}
          });
        }
        byEmp.get(row.employeeId).days[row.date] = row.statusCode;
      }
      const rows = [...byEmp.values()].map((r) => {
        const out = {
          ...(groupBy === 'Branch' ? { group: r.branch || '—' } : {}),
          ...(groupBy === 'Grade' ? { group: r.grade || '—' } : {}),
          ...(groupBy === 'Department' ? { group: r.department || '—' } : {}),
          ...(groupBy === 'Designation' ? { group: r.designation || '—' } : {}),
          employeeCode: r.employeeCode,
          employee: r.employee,
          department: r.department
        };
        for (const day of dayKeys) {
          const d = Number(String(day).slice(8, 10));
          out[`d${d}`] = r.days[day] || '';
        }
        return out;
      });
      return {
        columns: [
          ...(groupBy ? [{ key: 'group', label: groupBy }] : []),
          { key: 'employeeCode', label: 'Employee ID' },
          { key: 'employee', label: 'Employee' },
          { key: 'department', label: 'Department' },
          ...dayKeys.map((day) => {
            const d = Number(String(day).slice(8, 10));
            return { key: `d${d}`, label: String(d) };
          })
        ],
        rows,
        meta: { from: fromStr, to: toStr }
      };
    }
  },

  'shift-attendance': {
    doctype: 'Shift Attendance',
    filters: ['date'],
    columns: [
      { key: 'shift', label: 'Shift Type' },
      { key: 'employees', label: 'Employees', type: 'number' },
      { key: 'present', label: 'Present', type: 'number' },
      { key: 'absent', label: 'Absent', type: 'number' },
      { key: 'late', label: 'Late Entries', type: 'number' },
      { key: 'workingMinutes', label: 'Working Minutes', type: 'number' }
    ],
    async build({ companyId, from, to }) {
      const [attendance, shifts] = await Promise.all([
        prisma.hrAttendance.findMany({
          where: { companyId, workDate: { gte: from, lte: to }, shiftId: { not: null } },
          select: { shiftId: true, status: true, lateEntry: true, workingMinutes: true, employeeId: true }
        }),
        prisma.hrShift.findMany({ where: { companyId }, select: { id: true, name: true } })
      ]);
      const byShift = new Map();
      for (const row of attendance) {
        const key = row.shiftId;
        if (!byShift.has(key)) {
          byShift.set(key, { employees: new Set(), present: 0, absent: 0, late: 0, workingMinutes: 0 });
        }
        const bucket = byShift.get(key);
        bucket.employees.add(row.employeeId);
        const status = String(row.status || '').toLowerCase();
        if (status === 'present' || status === 'half_day' || status === 'late') bucket.present += 1;
        if (status === 'absent') bucket.absent += 1;
        if (row.lateEntry || status === 'late') bucket.late += 1;
        bucket.workingMinutes += Number(row.workingMinutes || 0);
      }
      const names = new Map(shifts.map((s) => [s.id, s.name]));
      return [...byShift.entries()].map(([shiftId, bucket]) => ({
        shift: names.get(shiftId) || '(deleted shift)',
        employees: bucket.employees.size,
        present: bucket.present,
        absent: bucket.absent,
        late: bucket.late,
        workingMinutes: bucket.workingMinutes
      }));
    }
  },

  'employee-leave-balance': {
    doctype: 'Employee Leave Balance',
    filters: ['employee'],
    columns: [
      { key: 'employeeCode', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'leaveType', label: 'Leave Type' },
      { key: 'allocated', label: 'Allocated', type: 'number' },
      { key: 'used', label: 'Used', type: 'number' },
      { key: 'carried', label: 'Carried Forward', type: 'number' },
      { key: 'balance', label: 'Balance Leave', type: 'number' },
      { key: 'expiringOn', label: 'Expiring On', type: 'date' }
    ],
    async build({ companyId, query }) {
      const balances = await prisma.hrLeaveBalance.findMany({
        where: { companyId, ...(query.employeeId ? { employeeId: String(query.employeeId) } : {}) },
        include: {
          leaveType: { select: { name: true } },
          employee: { select: EMPLOYEE_LOOKUP }
        },
        orderBy: [{ employeeId: 'asc' }, { leaveTypeId: 'asc' }]
      });
      return balances
        .filter((b) => b.employee)
        .map((b) => ({
          employeeCode: b.employee.employeeCode,
          employeeName: empName(b.employee),
          leaveType: b.leaveType?.name || '',
          allocated: Number(b.totalLeavesAllocated ?? b.accrued ?? 0),
          used: Number(b.used ?? 0),
          carried: Number(b.carryForwardLeaves ?? b.carried ?? 0),
          balance: Number(b.totalLeavesAllocated ?? b.accrued ?? 0) - Number(b.used ?? 0) + Number(b.carryForwardLeaves ?? b.carried ?? 0),
          expiringOn: b.toDate ? ymd(b.toDate) : ''
        }));
    }
  },

  'employee-leave-balance-summary': {
    doctype: 'Employee Leave Balance Summary',
    filters: ['employee'],
    columns: [
      { key: 'employeeCode', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'totalAllocated', label: 'Total Allocated', type: 'number' },
      { key: 'totalUsed', label: 'Total Used', type: 'number' },
      { key: 'totalBalance', label: 'Total Balance', type: 'number' }
    ],
    async build({ companyId, query }) {
      const balances = await prisma.hrLeaveBalance.findMany({
        where: { companyId, ...(query.employeeId ? { employeeId: String(query.employeeId) } : {}) },
        include: { employee: { select: EMPLOYEE_LOOKUP } }
      });
      const byEmployee = new Map();
      for (const b of balances) {
        if (!b.employee) continue;
        const key = b.employeeId;
        if (!byEmployee.has(key)) {
          byEmployee.set(key, {
            employeeCode: b.employee.employeeCode,
            employeeName: empName(b.employee),
            totalAllocated: 0,
            totalUsed: 0,
            totalBalance: 0
          });
        }
        const row = byEmployee.get(key);
        const allocated = Number(b.totalLeavesAllocated ?? b.accrued ?? 0);
        const used = Number(b.used ?? 0);
        const carried = Number(b.carryForwardLeaves ?? b.carried ?? 0);
        row.totalAllocated += allocated;
        row.totalUsed += used;
        row.totalBalance += allocated - used + carried;
      }
      return [...byEmployee.values()].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
    }
  },

  'employees-working-on-holiday': {
    doctype: 'Employees Working on a Holiday',
    filters: ['date'],
    columns: [
      { key: 'holiday', label: 'Holiday' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'employeeCode', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'status', label: 'Attendance Status' },
      { key: 'workingMinutes', label: 'Working Minutes', type: 'number' }
    ],
    async build({ companyId, from, to }) {
      const holidays = await prisma.hrHoliday.findMany({
        where: { companyId, date: { gte: from, lte: to } },
        orderBy: { date: 'asc' }
      });
      if (!holidays.length) return [];
      const days = new Set(holidays.map((h) => ymd(h.date)));
      const attendance = await prisma.hrAttendance.findMany({
        where: { companyId, workDate: { gte: from, lte: to } },
        include: { employee: { select: EMPLOYEE_LOOKUP } },
        orderBy: { workDate: 'asc' }
      });
      const byDate = new Map(holidays.map((h) => [ymd(h.date), h.name]));
      return attendance
        .filter((a) => days.has(ymd(a.workDate)) && a.employee)
        .map((a) => ({
          holiday: byDate.get(ymd(a.workDate)) || '',
          date: ymd(a.workDate),
          employeeCode: a.employee.employeeCode,
          employeeName: empName(a.employee),
          status: a.status,
          workingMinutes: Number(a.workingMinutes || 0)
        }));
    }
  },

  'unpaid-expense-claim': {
    doctype: 'Unpaid Expense Claim',
    filters: ['employee'],
    columns: [
      { key: 'employeeCode', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'claimDate', label: 'Claim Date', type: 'date' },
      { key: 'status', label: 'Status' },
      { key: 'payable', label: 'Payable Amount', type: 'currency' },
      { key: 'currency', label: 'Currency' }
    ],
    async build({ companyId, query }) {
      const claims = await prisma.hrExpenseClaim.findMany({
        where: {
          companyId,
          status: { in: ['Approved', 'Sanctioned', 'Unpaid', 'Submitted'] },
          ...(query.employeeId ? { employeeId: String(query.employeeId) } : {})
        },
        include: { employee: { select: EMPLOYEE_LOOKUP } },
        orderBy: { claimDate: 'asc' }
      });
      return claims
        .filter((c) => c.employee)
        .map((c) => {
          const sanctioned = Number(c.sanctionedAmount ?? c.approvedAmount ?? c.totalClaimed ?? 0);
          const paid = Number(c.paidAmount ?? 0);
          return {
            employeeCode: c.employee.employeeCode,
            employeeName: empName(c.employee),
            claimDate: ymd(c.claimDate),
            status: c.status,
            payable: Math.max(sanctioned - paid, 0),
            currency: c.currency || ''
          };
        })
        .filter((row) => row.payable > 0);
    }
  },

  'appraisal-overview': {
    doctype: 'Appraisal Overview',
    filters: ['date', 'employee'],
    columns: [
      { key: 'employeeCode', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'cycle', label: 'Appraisal Cycle' },
      { key: 'period', label: 'Period' },
      { key: 'status', label: 'Status' },
      { key: 'rating', label: 'Rating' },
      { key: 'totalScore', label: 'Total Score', type: 'number' },
      { key: 'goalCount', label: 'Goals', type: 'number' }
    ],
    async build({ companyId, query, from, to }) {
      const reviews = await prisma.hrPerformanceReview.findMany({
        where: {
          companyId,
          createdAt: { gte: from, lte: to },
          ...(query.employeeId ? { employeeId: String(query.employeeId) } : {})
        },
        include: {
          cycle: { select: { name: true } },
          employee: { select: EMPLOYEE_LOOKUP }
        },
        orderBy: { createdAt: 'desc' }
      });
      // Goals are their own DocType rows (Goal), linked by employee + cycle.
      const goalRows = await prisma.hrGoal.groupBy({
        by: ['employeeId', 'appraisalCycleId'],
        where: { companyId },
        _count: { id: true }
      });
      const goalCount = new Map(
        goalRows.map((g) => [`${g.employeeId}:${g.appraisalCycleId || ''}`, g._count.id])
      );
      return reviews
        .filter((r) => r.employee)
        .map((r) => ({
          employeeCode: r.employee.employeeCode,
          employeeName: empName(r.employee),
          cycle: r.cycle?.name || '',
          period: r.period || '',
          status: r.status,
          rating: r.rating || '',
          totalScore: Number(r.totalScore ?? r.averageRating ?? 0),
          goalCount: goalCount.get(`${r.employeeId}:${r.appraisalCycleId || ''}`) || 0
        }));
    }
  },

  'employee-ctc-breakup': {
    doctype: 'Employee CTC Break-up',
    filters: ['employee'],
    columns: [
      { key: 'employeeCode', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'structure', label: 'Salary Structure' },
      { key: 'component', label: 'Component' },
      { key: 'type', label: 'Type' },
      { key: 'basis', label: 'Based On' },
      { key: 'amount', label: 'Amount', type: 'currency' },
      { key: 'currency', label: 'Currency' },
      { key: 'effectiveFrom', label: 'Effective From', type: 'date' }
    ],
    async build({ companyId, query }) {
      const assignments = await prisma.hrSalaryStructureAssignment.findMany({
        where: { companyId, ...(query.employeeId ? { employeeId: String(query.employeeId) } : {}) },
        include: {
          salaryStructure: { select: { name: true, currency: true, earnings: true, deductions: true } },
          employee: { select: EMPLOYEE_LOOKUP }
        },
        orderBy: { employeeId: 'asc' }
      });

      // Components are stored as link ids on the structure rows, so resolve the
      // names from the same company-scoped master the structure was built from.
      const componentIds = new Set();
      for (const a of assignments) {
        for (const part of [
          ...(Array.isArray(a.salaryStructure?.earnings) ? a.salaryStructure.earnings : []),
          ...(Array.isArray(a.salaryStructure?.deductions) ? a.salaryStructure.deductions : [])
        ]) {
          if (part?.componentId) componentIds.add(String(part.componentId));
        }
      }
      const components = componentIds.size
        ? await prisma.hrSalaryComponent.findMany({
            where: { companyId, id: { in: [...componentIds] } },
            select: { id: true, name: true }
          })
        : [];
      const componentNames = new Map(components.map((c) => [c.id, c.name]));

      const rows = [];
      for (const a of assignments) {
        if (!a.employee) continue;
        const base = {
          employeeCode: a.employee.employeeCode,
          employeeName: empName(a.employee),
          structure: a.salaryStructure?.name || '',
          currency: a.currency || a.salaryStructure?.currency || '',
          effectiveFrom: a.fromDate ? ymd(a.fromDate) : ''
        };
        const parts = [
          ...(Array.isArray(a.salaryStructure?.earnings) ? a.salaryStructure.earnings : []).map((row) => ({ row, type: 'Earning' })),
          ...(Array.isArray(a.salaryStructure?.deductions) ? a.salaryStructure.deductions : []).map((row) => ({ row, type: 'Deduction' }))
        ];
        if (!parts.length) {
          rows.push({
            ...base,
            component: '(no components configured)',
            type: '',
            basis: '',
            amount: Number(a.base || 0)
          });
          continue;
        }
        for (const { row, type } of parts) {
          const id = row?.componentId ? String(row.componentId) : '';
          rows.push({
            ...base,
            component: componentNames.get(id) || id || '(unnamed component)',
            type,
            basis: row?.amountType || '',
            amount: Number(row?.amount ?? 0)
          });
        }
      }
      return rows;
    }
  },

  'income-tax-deductions': {
    doctype: 'Income Tax Deductions',
    filters: ['date', 'employee'],
    columns: [
      { key: 'employeeCode', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'period', label: 'Pay Period' },
      { key: 'taxable', label: 'Total Taxable Amount', type: 'currency' },
      { key: 'tax', label: 'Income Tax Deducted', type: 'currency' },
      { key: 'currency', label: 'Currency' },
      { key: 'status', label: 'Status' }
    ],
    async build({ companyId, query, from, to }) {
      const items = await prisma.hrPayrollItem.findMany({
        where: {
          companyId,
          period: { gte: ymd(from).slice(0, 7), lte: ymd(to).slice(0, 7) },
          ...(query.employeeId ? { employeeId: String(query.employeeId) } : {})
        },
        include: { employee: { select: EMPLOYEE_LOOKUP } },
        orderBy: { period: 'asc' }
      });
      return items
        .filter((i) => i.employee)
        .map((i) => {
          const breakdown = Array.isArray(i.breakdown) ? i.breakdown : [];
          const taxable = breakdown
            .filter((row) => row && (row.isTaxableComponent === true || row.taxable === true))
            .reduce((sum, row) => sum + Number(row.amount ?? row.value ?? 0), 0);
          return {
            employeeCode: i.employee.employeeCode,
            employeeName: empName(i.employee),
            period: i.period,
            taxable,
            tax: Number(i.customTax || 0),
            currency: i.salarySlipCurrency || '',
            status: i.status
          };
        });
    }
  },

  'employee-birthday': {
    doctype: 'Employee Birthday',
    filters: ['department'],
    columns: [
      { key: 'employeeCode', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'department', label: 'Department' },
      { key: 'dateOfBirth', label: 'Date of Birth', type: 'date' },
      { key: 'upcomingAge', label: 'Age' }
    ],
    async build({ companyId, query }) {
      const employees = await prisma.hrEmployee.findMany({
        where: { ...employeeWhere(companyId, query), status: { in: ['active', 'Active'] }, dateOfBirth: { not: null } },
        select: { ...EMPLOYEE_SELECT, dateOfBirth: true },
        orderBy: { dateOfBirth: 'asc' }
      });
      const today = new Date();
      return employees.map((e) => {
        const dob = e.dateOfBirth ? new Date(e.dateOfBirth) : null;
        const age = dob
          ? today.getUTCFullYear() -
            dob.getUTCFullYear() -
            (today.getUTCMonth() < dob.getUTCMonth() ||
            (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate())
              ? 1
              : 0)
          : null;
        return {
          employeeCode: e.employeeCode,
          employeeName: empName(e),
          department: e.department || '',
          dateOfBirth: dob ? ymd(dob) : null,
          upcomingAge: age
        };
      });
    }
  },

  'income-tax-computation': {
    doctype: 'Income Tax Computation',
    filters: ['employee', 'date'],
    columns: [
      { key: 'employeeCode', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'period', label: 'Period' },
      { key: 'gross', label: 'Gross Pay', type: 'currency' },
      { key: 'taxable', label: 'Taxable Earnings', type: 'currency' },
      { key: 'exemptions', label: 'Declared Exemptions', type: 'currency' },
      { key: 'tax', label: 'Income Tax', type: 'currency' },
      { key: 'currency', label: 'Currency' }
    ],
    async build({ companyId, query, from, to }) {
      const items = await prisma.hrPayrollItem.findMany({
        where: {
          companyId,
          ...(query.employeeId ? { employeeId: String(query.employeeId) } : {}),
          ...(from || to
            ? {
                createdAt: {
                  ...(from ? { gte: from } : {}),
                  ...(to ? { lte: to } : {})
                }
              }
            : {})
        },
        include: { employee: { select: EMPLOYEE_LOOKUP } },
        orderBy: { period: 'asc' }
      });
      const declarations = await prisma.hrTaxExemptionDeclaration
        .findMany({
          where: { companyId, ...(query.employeeId ? { employeeId: String(query.employeeId) } : {}) },
          select: { employeeId: true, totalExemption: true }
        })
        .catch(() => []);
      const declaredByEmployee = new Map(
        (declarations || []).map((d) => [d.employeeId, Number(d.totalExemption || 0)])
      );
      return items
        .filter((i) => i.employee)
        .map((i) => {
          const breakdown = Array.isArray(i.breakdown) ? i.breakdown : [];
          const taxable = breakdown
            .filter((row) => row && (row.isTaxableComponent === true || row.taxable === true))
            .reduce((sum, row) => sum + Number(row.amount ?? row.value ?? 0), 0);
          return {
            employeeCode: i.employee.employeeCode,
            employeeName: empName(i.employee),
            period: i.period,
            gross: Number(i.grossPay || i.gross || 0),
            taxable,
            exemptions: declaredByEmployee.get(i.employeeId) || 0,
            tax: Number(i.customTax || 0),
            currency: i.salarySlipCurrency || ''
          };
        });
    }
  },

  'accrued-earnings': {
    doctype: 'Accrued Earnings Report',
    filters: ['employee', 'date'],
    columns: [
      { key: 'employeeCode', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'component', label: 'Salary Component' },
      { key: 'amount', label: 'Accrued Amount', type: 'currency' },
      { key: 'postingDate', label: 'Posting Date', type: 'date' },
      { key: 'transactionType', label: 'Transaction Type' }
    ],
    async build({ companyId, query, from, to }) {
      const rows = await prisma.hrEmployeeBenefitLedger.findMany({
        where: {
          companyId,
          ...(query.employeeId ? { employeeId: String(query.employeeId) } : {}),
          ...(from || to
            ? {
                postingDate: {
                  ...(from ? { gte: from } : {}),
                  ...(to ? { lte: to } : {})
                }
              }
            : {}),
          transactionType: { equals: 'Accrual', mode: 'insensitive' }
        },
        orderBy: { postingDate: 'asc' }
      });
      const employeeIds = [...new Set(rows.map((r) => r.employeeId).filter(Boolean))];
      const employees = employeeIds.length
        ? await prisma.hrEmployee.findMany({
            where: { companyId, id: { in: employeeIds } },
            select: EMPLOYEE_LOOKUP
          })
        : [];
      const byId = new Map(employees.map((e) => [e.id, e]));
      const componentIds = [...new Set(rows.map((r) => r.salaryComponentId).filter(Boolean))];
      const components = componentIds.length
        ? await prisma.hrSalaryComponent.findMany({
            where: { companyId, id: { in: componentIds } },
            select: { id: true, name: true }
          })
        : [];
      const componentName = new Map(components.map((c) => [c.id, c.name]));
      return rows.map((r) => {
        const emp = r.employeeId ? byId.get(r.employeeId) : null;
        return {
          employeeCode: emp?.employeeCode || '',
          employeeName: emp ? empName(emp) : r.employeeName || '',
          component: (r.salaryComponentId && componentName.get(r.salaryComponentId)) || '',
          amount: Number(r.amount || 0),
          postingDate: r.postingDate ? ymd(r.postingDate) : null,
          transactionType: r.transactionType || ''
        };
      });
    }
  },

  'salary-register': {
    doctype: 'Salary Register',
    filters: ['date', 'employee', 'department'],
    columns: [
      { key: 'employeeCode', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'department', label: 'Department' },
      { key: 'startDate', label: 'Start Date', type: 'date' },
      { key: 'endDate', label: 'End Date', type: 'date' },
      { key: 'grossPay', label: 'Gross Pay', type: 'currency' },
      { key: 'totalDeduction', label: 'Total Deduction', type: 'currency' },
      { key: 'netPay', label: 'Net Pay', type: 'currency' },
      { key: 'status', label: 'Status' }
    ],
    async build({ companyId, query, from, to }) {
      const slipClient = prisma.hrSalarySlip;
      const slips = slipClient
        ? await slipClient.findMany({
            where: {
              companyId,
              ...(query.employeeId ? { employeeId: String(query.employeeId) } : {}),
              ...(from || to
                ? {
                    postingDate: {
                      ...(from ? { gte: from } : {}),
                      ...(to ? { lte: to } : {})
                    }
                  }
                : {})
            },
            orderBy: [{ postingDate: 'asc' }, { employeeName: 'asc' }]
          })
        : [];

      if (slips.length) {
        const employeeIds = [...new Set(slips.map((s) => s.employeeId).filter(Boolean))];
        const employees = employeeIds.length
          ? await prisma.hrEmployee.findMany({
              where: { companyId, id: { in: employeeIds } },
              select: EMPLOYEE_LOOKUP
            })
          : [];
        const byId = new Map(employees.map((e) => [e.id, e]));
        return slips
          .filter((s) => {
            if (!query.department) return true;
            const emp = byId.get(s.employeeId);
            const dept = s.department || emp?.department || '';
            return String(dept).toLowerCase() === String(query.department).toLowerCase();
          })
          .map((s) => {
            const emp = byId.get(s.employeeId);
            return {
              employeeCode: emp?.employeeCode || '',
              employeeName: emp ? empName(emp) : s.employeeName || '',
              department: s.department || emp?.department || '',
              startDate: s.startDate ? ymd(s.startDate) : null,
              endDate: s.endDate ? ymd(s.endDate) : null,
              grossPay: Number(s.grossPay || 0),
              totalDeduction: Number(s.totalDeduction || 0),
              netPay: Number(s.netPay || 0),
              status: s.status
            };
          });
      }

      // Legacy payslips until ERPNext Salary Slip records are created.
      const items = await prisma.hrPayrollItem.findMany({
        where: {
          companyId,
          ...(query.employeeId ? { employeeId: String(query.employeeId) } : {})
        },
        include: { employee: { select: EMPLOYEE_LOOKUP } },
        orderBy: { period: 'asc' }
      });
      return items
        .filter((i) => i.employee)
        .filter((i) => {
          if (!query.department) return true;
          return String(i.employee.department || '').toLowerCase() === String(query.department).toLowerCase();
        })
        .map((i) => ({
          employeeCode: i.employee.employeeCode,
          employeeName: empName(i.employee),
          department: i.employee.department || '',
          startDate: null,
          endDate: null,
          grossPay: Number(i.totalEarning || i.base || 0),
          totalDeduction: Number(i.deductions || 0),
          netPay: Number(i.net || 0),
          status: i.status
        }));
    }
  },

  'vehicle-expenses': {
    doctype: 'Vehicle Expenses',
    filters: ['date'],
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'vehicle', label: 'License Plate' },
      { key: 'employeeCode', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'fuelQty', label: 'Fuel Qty' },
      { key: 'fuelCost', label: 'Fuel Cost', type: 'currency' },
      { key: 'serviceCost', label: 'Service Cost', type: 'currency' },
      { key: 'total', label: 'Total', type: 'currency' }
    ],
    async build({ companyId, from, to }) {
      const logs = await prisma.hrVehicleLog.findMany({
        where: {
          companyId,
          ...(from || to
            ? {
                date: {
                  ...(from ? { gte: from } : {}),
                  ...(to ? { lte: to } : {})
                }
              }
            : {})
        },
        orderBy: { date: 'asc' }
      });
      const vehicleIds = [...new Set(logs.map((l) => l.vehicleId).filter(Boolean))];
      const vehicles = vehicleIds.length
        ? await prisma.hrVehicle.findMany({ where: { companyId, id: { in: vehicleIds } }, select: { id: true, licensePlate: true } })
        : [];
      const vehicleLabel = new Map(vehicles.map((v) => [v.id, v.licensePlate || v.id]));
      const employeeIds = [...new Set(logs.map((l) => l.employeeId).filter(Boolean))];
      const employees = employeeIds.length
        ? await prisma.hrEmployee.findMany({ where: { companyId, id: { in: employeeIds } }, select: EMPLOYEE_LOOKUP })
        : [];
      const byId = new Map(employees.map((e) => [e.id, e]));
      return logs.map((l) => {
        const services = Array.isArray(l.serviceDetail) ? l.serviceDetail : [];
        const serviceCost = services.reduce((sum, row) => sum + Number(row?.expenseAmount || 0), 0);
        const fuelCost = Number(l.price || 0) * Number(l.fuelQty || 0);
        const emp = l.employeeId ? byId.get(l.employeeId) : null;
        return {
          date: l.date ? ymd(l.date) : null,
          vehicle: (l.vehicleId && vehicleLabel.get(l.vehicleId)) || '',
          employeeCode: emp?.employeeCode || '',
          employeeName: emp ? empName(emp) : '',
          fuelQty: Number(l.fuelQty || 0),
          fuelCost,
          serviceCost,
          total: fuelCost + serviceCost
        };
      });
    }
  },

  'employee-hours-utilization': {
    doctype: 'Employee Hours Utilization Based On Timesheet',
    requiresStandardWorkingHours: true,
    filterDefs: [
      { key: 'from', label: 'From Date', type: 'date', required: true },
      { key: 'to', label: 'To Date', type: 'date', required: true },
      { key: 'employeeId', label: 'Employee', type: 'link', options: 'employee' },
      { key: 'departmentId', label: 'Department', type: 'link', options: 'department' },
      { key: 'project', label: 'Project', type: 'data' }
    ],
    columns: [
      { key: 'employee', label: 'Employee' },
      { key: 'department', label: 'Department' },
      { key: 'totalHours', label: 'Total Hours (T)', type: 'number' },
      { key: 'billedHours', label: 'Billed Hours (B)', type: 'number' },
      { key: 'nonBilledHours', label: 'Non-Billed Hours (NB)', type: 'number' },
      { key: 'untrackedHours', label: 'Untracked Hours (U)', type: 'number' },
      { key: 'perUtil', label: '% Utilization (B + NB) / T', type: 'number' },
      { key: 'perUtilBilledOnly', label: '% Utilization (B / T)', type: 'number' }
    ],
    async build({ companyId, query, from, to, standardWorkingHours }) {
      const daySpan = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));
      const totalHoursBudget = Number(standardWorkingHours) * daySpan;
      const sheets = await prisma.hrTimesheet.findMany({
        where: {
          companyId,
          docStatus: { not: 2 },
          ...(query.employeeId ? { employeeId: String(query.employeeId) } : {}),
          startDate: { gte: from, lte: to },
          endDate: { gte: from, lte: to }
        }
      });
      const byEmployee = new Map();
      for (const sheet of sheets) {
        if (!sheet.employeeId) continue;
        const logs = Array.isArray(sheet.timeLogs) ? sheet.timeLogs : [];
        for (const log of logs) {
          if (query.project && String(log?.project || '') !== String(query.project)) continue;
          const cur = byEmployee.get(sheet.employeeId) || {
            employeeId: sheet.employeeId,
            billedHours: 0,
            nonBilledHours: 0
          };
          const hours = Number(log?.hours || 0);
          if (log?.isBillable === true || log?.isBillable === 1) cur.billedHours += hours;
          else cur.nonBilledHours += hours;
          byEmployee.set(sheet.employeeId, cur);
        }
      }
      const employeeIds = [...byEmployee.keys()];
      const employees = employeeIds.length
        ? await prisma.hrEmployee.findMany({
            where: {
              companyId,
              id: { in: employeeIds },
              ...(query.departmentId ? { departmentId: String(query.departmentId) } : {})
            },
            select: {
              ...EMPLOYEE_LOOKUP,
              department: true,
              departmentId: true,
              employeeName: true
            }
          })
        : [];
      const rows = [];
      for (const emp of employees) {
        const stats = byEmployee.get(emp.id);
        if (!stats) continue;
        let untracked = totalHoursBudget - stats.billedHours - stats.nonBilledHours;
        if (untracked < 0) untracked = 0;
        rows.push({
          employee: empName(emp) || emp.employeeName || emp.employeeCode,
          department: emp.department || '',
          totalHours: Number(totalHoursBudget.toFixed(2)),
          billedHours: Number(stats.billedHours.toFixed(2)),
          nonBilledHours: Number(stats.nonBilledHours.toFixed(2)),
          untrackedHours: Number(untracked.toFixed(2)),
          perUtil: totalHoursBudget
            ? Number((((stats.billedHours + stats.nonBilledHours) / totalHoursBudget) * 100).toFixed(2))
            : 0,
          perUtilBilledOnly: totalHoursBudget
            ? Number(((stats.billedHours / totalHoursBudget) * 100).toFixed(2))
            : 0
        });
      }
      rows.sort((a, b) => Number(b.perUtil) - Number(a.perUtil));
      return rows;
    }
  },

  'project-profitability': {
    doctype: 'Project Profitability',
    requiresStandardWorkingHours: true,
    filterDefs: [
      { key: 'from', label: 'Start Date', type: 'date', required: true },
      { key: 'to', label: 'End Date', type: 'date', required: true },
      { key: 'customer', label: 'Customer', type: 'data' },
      { key: 'employeeId', label: 'Employee', type: 'link', options: 'employee' },
      { key: 'project', label: 'Project', type: 'data' }
    ],
    columns: [
      { key: 'customer', label: 'Customer' },
      { key: 'employee', label: 'Employee' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'project', label: 'Project' },
      { key: 'billingAmount', label: 'Bill Amount', type: 'currency' },
      { key: 'costingAmount', label: 'Cost', type: 'currency' },
      { key: 'profit', label: 'Profit', type: 'currency' },
      { key: 'utilization', label: 'Utilization', type: 'number' },
      { key: 'totalBilledHours', label: 'Total Billed Hours', type: 'number' },
      { key: 'startDate', label: 'Start Date', type: 'date' },
      { key: 'endDate', label: 'End Date', type: 'date' }
    ],
    async build({ companyId, query, from, to, standardWorkingHours }) {
      const sheets = await prisma.hrTimesheet.findMany({
        where: {
          companyId,
          docStatus: { not: 2 },
          ...(query.employeeId ? { employeeId: String(query.employeeId) } : {}),
          ...(query.customer ? { customer: { equals: String(query.customer), mode: 'insensitive' } } : {}),
          ...(query.project ? { parentProject: { equals: String(query.project), mode: 'insensitive' } } : {}),
          startDate: { gte: from },
          endDate: { lte: to }
        }
      });
      const daySpan = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));
      const rows = sheets.map((sheet) => {
        const billedHours = Number(sheet.totalBilledHours || sheet.totalBillableHours || 0);
        const billingAmount = Number(sheet.totalBilledAmount || sheet.totalBillableAmount || 0);
        const costingAmount = Number(sheet.totalCostingAmount || 0);
        const utilization = (daySpan * Number(standardWorkingHours)) > 0
          ? billedHours / (daySpan * Number(standardWorkingHours))
          : 0;
        const fractionalCost = costingAmount * utilization;
        return {
          customer: sheet.customer || '',
          employee: sheet.employeeId || '',
          employeeName: sheet.employeeName || '',
          project: sheet.parentProject || '',
          billingAmount,
          costingAmount,
          profit: billingAmount - fractionalCost,
          utilization: Number((utilization * 100).toFixed(2)),
          totalBilledHours: billedHours,
          startDate: sheet.startDate ? ymd(sheet.startDate) : '',
          endDate: sheet.endDate ? ymd(sheet.endDate) : ''
        };
      });
      return rows;
    }
  },

};

const REPORTS = reports;

const FILTER_KEYS = ['date', 'employee', 'department'];

function yearOptions() {
  const year = new Date().getUTCFullYear();
  return Array.from({ length: 8 }, (_, i) => String(year - i));
}

function resolveFilterDefs(report) {
  if (Array.isArray(report.filterDefs) && report.filterDefs.length) {
    return report.filterDefs.map((def) => {
      if (def.options === 'years') return { ...def, options: yearOptions() };
      return def;
    });
  }
  const declared = report.filters || [];
  const defs = [];
  if (declared.includes('date')) {
    defs.push({ key: 'from', label: 'From', type: 'date' });
    defs.push({ key: 'to', label: 'To', type: 'date' });
  }
  if (declared.includes('employee')) {
    defs.push({ key: 'employeeId', label: 'Employee', type: 'link', options: 'employee' });
  }
  if (declared.includes('department')) {
    defs.push({ key: 'department', label: 'Department', type: 'data' });
  }
  return defs;
}

async function loadStandardWorkingHours(companyId) {
  const settings = await prisma.hrSettingsDoc.findUnique({ where: { companyId } });
  return Number(settings?.standardWorkingHours || 0);
}

/**
 * The declared `filters` / `filterDefs` list is the report's contract: a filter
 * the report does not declare is dropped before the builder runs.
 */
async function runReport(name, { companyId, query = {} }) {
  const report = REPORTS[name];
  if (!report) {
    const error = new Error(`Unknown HR report: ${name}`);
    error.status = 404;
    throw error;
  }

  const filterDefs = resolveFilterDefs(report);
  const allowedKeys = new Set(filterDefs.map((def) => def.key));
  // Always allow company for tenant context.
  allowedKeys.add('company');

  const applied = {};
  for (const def of filterDefs) {
    const raw = query[def.key];
    if (raw === undefined || raw === null || raw === '') {
      if (def.default !== undefined && def.default !== null) applied[def.key] = def.default;
      continue;
    }
    if (def.type === 'check') {
      applied[def.key] = raw === true || raw === '1' || raw === 'true';
    } else {
      applied[def.key] = raw;
    }
  }

  // Defaults for month/year when using Month mode.
  const now = new Date();
  if (allowedKeys.has('month') && !applied.month) applied.month = String(now.getUTCMonth() + 1);
  if (allowedKeys.has('year') && !applied.year) applied.year = String(now.getUTCFullYear());
  if (allowedKeys.has('filterBasedOn') && !applied.filterBasedOn) applied.filterBasedOn = 'Month';
  if (allowedKeys.has('status') && applied.status === undefined) applied.status = 'Active';
  if (allowedKeys.has('includeCompanyDescendants') && applied.includeCompanyDescendants === undefined) {
    applied.includeCompanyDescendants = true;
  }

  const usesDate =
    allowedKeys.has('from') ||
    allowedKeys.has('to') ||
    (report.filters || []).includes('date') ||
    applied.filterBasedOn === 'Month';

  let from;
  let to;
  if (applied.filterBasedOn === 'Month' && applied.month && applied.year) {
    const month = Number(applied.month);
    const year = Number(applied.year);
    from = new Date(Date.UTC(year, month - 1, 1));
    to = new Date(Date.UTC(year, month, 0));
    applied.from = ymd(from);
    applied.to = ymd(to);
  } else {
    const spanned = range({ from: applied.from || query.from, to: applied.to || query.to });
    from = spanned.from;
    to = spanned.to;
    if (usesDate) {
      applied.from = ymd(from);
      applied.to = ymd(to);
    }
  }

  let standardWorkingHours = 0;
  if (report.requiresStandardWorkingHours) {
    standardWorkingHours = await loadStandardWorkingHours(companyId);
    if (!(standardWorkingHours > 0)) {
      const message =
        report.doctype === 'Project Profitability'
          ? 'The metrics for this report are calculated based on the Standard Working Hours. Please set Standard Working Hours in HR Settings.'
          : 'The metrics for this report are calculated based on Standard Working Hours. Please set Standard Working Hours in HR Settings.';
      const error = new Error(message);
      error.status = 400;
      error.code = 'STANDARD_WORKING_HOURS_REQUIRED';
      error.hrSettingsPath = '/hr/hr-setup/hr-settings';
      error.extra = {
        code: 'STANDARD_WORKING_HOURS_REQUIRED',
        hrSettingsPath: '/hr/hr-setup/hr-settings',
        filterDefs,
        doctype: report.doctype
      };
      throw error;
    }
  }

  const built = await report.build({
    companyId,
    query: applied,
    from,
    to,
    standardWorkingHours
  });

  const dynamic = built && !Array.isArray(built) && Array.isArray(built.rows);
  const rows = dynamic ? built.rows : built;
  const columns = dynamic && built.columns?.length ? built.columns : report.columns;

  return {
    report: name,
    doctype: report.doctype,
    columns,
    filterDefs,
    requiresStandardWorkingHours: Boolean(report.requiresStandardWorkingHours),
    filters: {
      available: FILTER_KEYS.filter((key) => (report.filters || []).includes(key)),
      values: applied,
      date: usesDate,
      from: usesDate ? applied.from || ymd(from) : null,
      to: usesDate ? applied.to || ymd(to) : null,
      employeeId: applied.employeeId || null,
      department: applied.department || applied.departmentId || null
    },
    total: Array.isArray(rows) ? rows.length : 0,
    rows: Array.isArray(rows) ? rows : []
  };
}

function reportNames() {
  return Object.keys(REPORTS);
}

module.exports = { runReport, reportNames, reports: REPORTS, empName, workDateKey };
