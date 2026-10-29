'use strict';

/**
 * End-to-end check of the rebuilt HRMS against the real database: it boots the
 * Express app, creates a throw-away company with an HR admin, a manager and an
 * employee, then walks the ERPNext workflows (component → structure →
 * assignment, policy → allocation → application) and the authorization rules.
 * Everything it writes is deleted again.
 *
 * Run: node tests/hrms-live.test.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const prisma = require('../prisma/client');
const app = require('../app');

const STAFF = 'hrms-e2e@example.com';
const created = { companyIds: [], userIds: [] };

const results = [];
function check(name, fn) {
  results.push([name, fn]);
}

let server;
let base;
let hrToken;
let employeeToken;
let otherToken;

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
    throw new Error(`${label || url} → ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return res.body.data;
}

async function seed() {
  const company = await prisma.company.create({
    data: { name: 'HRMS E2E Co', email: STAFF, isActive: true }
  });
  created.companyIds.push(company.id);

  const mk = async (first, last, email, role) =>
    prisma.user.create({
      data: {
        firstName: first,
        lastName: last,
        email,
        password: await bcrypt.hash('test-password', 10),
        role,
        companyId: company.id,
        isActive: true
      }
    });

  const hr = await mk('Hr', 'Admin', `hr+${STAFF}`, 'hr_manager');
  const employeeUser = await mk('Emp', 'Lee', `emp+${STAFF}`, 'employee');
  created.userIds.push(hr.id, employeeUser.id);

  await prisma.hrEmployee.create({
    data: {
      companyId: company.id,
      userId: employeeUser.id,
      employeeCode: 'E2E-0001',
      profile: { name: 'Emp Lee' },
      status: 'active',
      salary: 120000,
      salaryCurrency: 'PKR',
      joiningDate: new Date('2024-01-01'),
      department: 'Engineering',
      designation: 'Developer'
    }
  });

  return { companyId: company.id, hrToken: sign(hr.id), employeeToken: sign(employeeUser.id) };
}

function sign(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '2h' });
}

async function seedSecondCompany() {
  const company = await prisma.company.create({ data: { name: 'HRMS E2E Other', email: `other+${STAFF}`, isActive: true } });
  created.companyIds.push(company.id);
  const user = await prisma.user.create({
    data: {
      firstName: 'Other',
      lastName: 'Admin',
      email: `other-admin+${STAFF}`,
      password: await bcrypt.hash('test-password', 10),
      role: 'admin',
      companyId: company.id,
      isActive: true
    }
  });
  created.userIds.push(user.id);
  return { companyId: company.id, token: sign(user.id) };
}

async function run() {
  const first = await seed();
  const second = await seedSecondCompany();
  hrToken = first.hrToken;
  otherToken = second.token;

  const employeeRow = await prisma.hrEmployee.findFirst({ where: { companyId: first.companyId } });

  check('workspace tree and Home number cards', async () => {
    const data = await expectOk('GET', '/api/hr/workspaces', hrToken, null, first.companyId);
    assert.strictEqual(data.workspaces.length, 9);
    assert.strictEqual(data.workspaces[0].items[0].kind, 'home');
    const names = data.workspaces.map((w) => w.label);
    assert.deepStrictEqual(names.slice(0, 3), ['HR Setup', 'Tenure', 'Recruitment']);

    const home = await expectOk('GET', '/api/hr/workspaces/leaves/dashboard', hrToken, null, first.companyId);
    assert.strictEqual(home.numberCards.length, 3);
    assert.strictEqual(home.numberCards[0].label, 'Number of Employees on Leave (Today)');
    assert.strictEqual(home.numberCards[0].value, 0);
    assert.ok(Array.isArray(home.chart.points));
  });

  let componentId;
  check('salary component master', async () => {
    const row = await expectOk(
      'POST',
      '/api/hr/docs/salary-component',
      hrToken,
      { name: 'E2E Basic Pay', type: 'Earning', componentCategory: 'Fixed', dependsOnPaymentDays: true },
      first.companyId
    );
    componentId = row.id;
    assert.strictEqual(row.type, 'Earning');
    const dup = await request('POST', '/api/hr/docs/salary-component', hrToken, { name: 'E2E Basic Pay', type: 'Earning' }, first.companyId);
    assert.strictEqual(dup.status, 400, 'duplicate component name must be rejected');
  });

  let structureId;
  check('salary structure with child tables and submit lifecycle', async () => {
    const deduction = await expectOk(
      'POST',
      '/api/hr/docs/salary-component',
      hrToken,
      { name: 'E2E Tax', type: 'Deduction' },
      first.companyId
    );
    const row = await expectOk(
      'POST',
      '/api/hr/docs/salary-structure',
      hrToken,
      {
        name: 'E2E Monthly Structure',
        currency: 'PKR',
        payrollFrequencyType: 'Monthly',
        earnings: [{ componentId: componentId, amountType: 'Amount', amount: 100000, dependsOnPaymentDays: true }],
        deductions: [{ componentId: deduction.id, amountType: 'Percentage of Base', amount: 5 }]
      },
      first.companyId
    );
    structureId = row.id;
    assert.strictEqual(row.status, 'Draft');
    assert.strictEqual(row.earnings.length, 1);

    const edited = await request('PUT', `/api/hr/docs/salary-structure/${structureId}`, hrToken, { modeOfPayment: 'Bank' }, first.companyId);
    assert.strictEqual(edited.status, 200);

    const submitted = await expectOk('POST', `/api/hr/docs/salary-structure/${structureId}/action/submit`, hrToken, {}, first.companyId);
    assert.strictEqual(submitted.status, 'Submitted');

    const locked = await request('PUT', `/api/hr/docs/salary-structure/${structureId}`, hrToken, { modeOfPayment: 'Cash' }, first.companyId);
    assert.strictEqual(locked.status, 400, 'a submitted document must not be editable');
    assert.match(locked.body.message, /no longer be edited/);
  });

  check('salary structure assignment syncs the employee salary on submit', async () => {
    const row = await expectOk(
      'POST',
      '/api/hr/docs/salary-structure-assignment',
      hrToken,
      { employeeId: employeeRow.id, salaryStructureId: structureId, base: 130000, fromDate: '2026-01-01', currency: 'PKR' },
      first.companyId
    );
    const submitted = await expectOk('POST', `/api/hr/docs/salary-structure-assignment/${row.id}/action/submit`, hrToken, {}, first.companyId);
    assert.strictEqual(submitted.status, 'Submitted');
    const fresh = await prisma.hrEmployee.findUnique({ where: { id: employeeRow.id } });
    assert.strictEqual(fresh.salary, 130000, 'assignment must write the employee salary');

    const dup = await request(
      'POST',
      '/api/hr/docs/salary-structure-assignment',
      hrToken,
      { employeeId: employeeRow.id, salaryStructureId: structureId, base: 130000, fromDate: '2026-01-01' },
      first.companyId
    );
    assert.strictEqual(dup.status, 400, 'duplicate assignment must be rejected');
  });

  let leaveTypeId;
  let periodId;
  check('leave policy chain allocates balances on submit', async () => {
    leaveTypeId = (await expectOk('POST', '/api/hr/docs/leave-type', hrToken, { name: 'E2E Casual', paid: true, annualQuota: 10 }, first.companyId)).id;
    const encash = await expectOk('POST', '/api/hr/docs/leave-type', hrToken, { name: 'E2E Earned', paid: true, encashable: true }, first.companyId);
    periodId = (await expectOk(
      'POST',
      '/api/hr/docs/leave-period',
      hrToken,
      { name: 'E2E 2026', startDate: '2026-01-01', endDate: '2026-12-31' },
      first.companyId
    )).id;
    const policy = await expectOk(
      'POST',
      '/api/hr/docs/leave-policy',
      hrToken,
      { name: 'E2E Policy', details: [{ leaveTypeId, annualAllocation: 12 }] },
      first.companyId
    );
    await expectOk('POST', `/api/hr/docs/leave-policy/${policy.id}/action/submit`, hrToken, {}, first.companyId);

    const assignment = await expectOk(
      'POST',
      '/api/hr/docs/leave-policy-assignment',
      hrToken,
      { employeeId: employeeRow.id, leavePolicyId: policy.id, leavePeriodId: periodId, fromDate: '2026-01-01', toDate: '2026-12-31', allocateOnDaysBeforeStart: 0 },
      first.companyId
    );
    await expectOk('POST', `/api/hr/docs/leave-policy-assignment/${assignment.id}/action/submit`, hrToken, {}, first.companyId);

    const balances = await prisma.hrLeaveBalance.findMany({ where: { companyId: first.companyId, employeeId: employeeRow.id } });
    assert.ok(balances.length >= 1, 'policy assignment must create leave allocations');
    const casual = balances.find((b) => b.leaveTypeId === leaveTypeId);
    assert.ok(casual.totalLeavesAllocated > 0, 'allocation must carry the policy quota');
    void encash;
  });

  check('leave application validates the balance in the backend', async () => {
    const over = await request(
      'POST',
      '/api/hr/docs/leave-application',
      hrToken,
      { employeeId: employeeRow.id, leaveTypeId, fromDate: '2026-03-02', toDate: '2026-03-30', reason: 'too long' },
      first.companyId
    );
    assert.strictEqual(over.status, 400, 'over-budget leave must be rejected');
    assert.match(over.body.message, /leave day\(s\) available/);

    const ok = await expectOk(
      'POST',
      '/api/hr/docs/leave-application',
      hrToken,
      { employeeId: employeeRow.id, leaveTypeId, fromDate: '2026-03-02', toDate: '2026-03-06', reason: 'family' },
      first.companyId
    );
    assert.strictEqual(ok.status, 'Open');
    assert.strictEqual(ok.days, 5);

    const overlap = await request(
      'POST',
      '/api/hr/docs/leave-application',
      hrToken,
      { employeeId: employeeRow.id, leaveTypeId, fromDate: '2026-03-04', toDate: '2026-03-05', reason: 'overlap' },
      first.companyId
    );
    assert.strictEqual(overlap.status, 400, 'overlapping applications must be rejected');

    const approved = await expectOk('POST', `/api/hr/docs/leave-application/${ok.id}/action/approve`, hrToken, {}, first.companyId);
    assert.strictEqual(approved.status, 'Approved');

    const balance = await prisma.hrLeaveBalance.findFirst({ where: { companyId: first.companyId, employeeId: employeeRow.id, leaveTypeId } });
    assert.ok(balance.used >= 5, 'approving must consume the allocation');

    const attendance = await prisma.hrAttendance.findMany({ where: { companyId: first.companyId, employeeId: employeeRow.id, status: 'On Leave' } });
    assert.strictEqual(attendance.length, 5, 'approved leave must mark those days in attendance');

    const reverted = await expectOk('POST', `/api/hr/docs/leave-application/${ok.id}/action/cancel`, hrToken, {}, first.companyId);
    assert.strictEqual(reverted.status, 'Cancelled');
    const afterCancel = await prisma.hrLeaveBalance.findFirst({ where: { companyId: first.companyId, employeeId: employeeRow.id, leaveTypeId } });
    assert.strictEqual(afterCancel.used, 0, 'cancelling must release the allocation');
  });

  check('employees only reach their own documents', async () => {
    const employeeUser = await prisma.user.findFirst({ where: { email: `emp+${STAFF}` } });
    employeeToken = sign(employeeUser.id);
    const own = await expectOk('GET', '/api/hr/docs/leave-application', employeeToken, null, first.companyId);
    assert.ok(own.rows.length >= 1, 'the employee must see their own leave');
    assert.ok(own.rows.every((r) => r.employeeId === employeeRow.id), 'the list must only contain their own rows');

    const managerDoc = await request('GET', '/api/hr/docs/shift-type', employeeToken, null, first.companyId);
    assert.ok([403, 404].includes(managerDoc.status), `employee must not list setup documents (${managerDoc.status})`);

    const otherEmployee = await prisma.hrEmployee.create({
      data: { companyId: first.companyId, employeeCode: 'E2E-0002', status: 'active', salary: 50000, salaryCurrency: 'PKR' }
    });
    const foreign = await request(
      'POST',
      '/api/hr/docs/leave-application',
      employeeToken,
      { employeeId: otherEmployee.id, leaveTypeId, fromDate: '2026-05-04', toDate: '2026-05-05', reason: 'nope' },
      first.companyId
    );
    assert.strictEqual(foreign.status, 403, 'an employee cannot apply on behalf of someone else');
    await prisma.hrEmployee.delete({ where: { id: otherEmployee.id } });
  });

  check('companies are isolated at the document layer', async () => {
    const peek = await request('GET', `/api/hr/docs/salary-structure/${structureId}`, otherToken, null, second.companyId);
    assert.strictEqual(peek.status, 404, 'another company must not read this record');

    const list = await expectOk('GET', '/api/hr/docs/salary-structure', otherToken, null, second.companyId);
    assert.strictEqual(list.total, 0);

    const foreignComponent = await request(
      'POST',
      '/api/hr/docs/salary-structure',
      otherToken,
      { name: 'Cross-tenant structure', currency: 'PKR', earnings: [{ componentId, amount: 1 }] },
      second.companyId
    );
    assert.strictEqual(foreignComponent.status, 400, 'links to another company must be rejected');
  });

  check('legacy HR endpoints still answer after the status vocabulary change', async () => {
    const leaves = await expectOk('GET', '/api/hr/leaves', hrToken, null, first.companyId);
    assert.ok(Array.isArray(leaves.rows || leaves));
    const corrections = await expectOk('GET', '/api/hr/attendance/corrections', hrToken, null, first.companyId);
    assert.ok(Array.isArray(corrections.rows || corrections));
    const shifts = await expectOk('GET', '/api/hr/shift-plans', hrToken, null, first.companyId);
    assert.ok(Array.isArray(shifts.rows || shifts));
    const holidays = await expectOk('GET', '/api/hr/holiday-calendar', hrToken, null, first.companyId);
    assert.ok(Array.isArray(holidays.rows || holidays));
  });

  check('legacy HR writes are gated by the permission catalog', async () => {
    const office = { name: 'Gate Office', latitude: 24.86, longitude: 67.01 };
    const denied = await request('POST', '/api/hr/offices', employeeToken, office, first.companyId);
    assert.strictEqual(denied.status, 403, 'an employee without grants must not create offices');
    assert.strictEqual(denied.body.code, 'PERMISSION_DENIED');
    assert.ok(
      String(denied.body.requiredPermission || '').endsWith('hr.offices.create'),
      'the denial must name the missing permission'
    );

    const payrollDenied = await request('POST', '/api/hr/payroll/generate', employeeToken, {}, first.companyId);
    assert.strictEqual(payrollDenied.status, 403, 'payroll processing needs the payroll grant');

    const allowed = await expectOk('POST', '/api/hr/offices', hrToken, office, first.companyId);
    assert.ok(allowed, 'the HR manager role still reaches the endpoint');
    await prisma.hrOffice.deleteMany({ where: { companyId: first.companyId, name: office.name } });
  });

  check('employee check-ins mark auto attendance for the shift', async () => {
    const shift = await expectOk(
      'POST',
      '/api/hr/docs/shift-type',
      hrToken,
      {
        name: 'Auto E2E Shift',
        startTime: '09:00',
        endTime: '17:00',
        breakMinutes: 60,
        graceMinutes: 15,
        enableLateEntryMarking: true,
        enableEarlyExitMarking: true,
        enableAutoAttendance: true,
        firstCheckinThresholdMinutes: 60,
        lastCheckoutThresholdMinutes: 60
      },
      first.companyId
    );
    const emp = await prisma.hrEmployee.findFirst({
      where: { companyId: first.companyId, employeeCode: 'E2E-0001' }
    });
    await prisma.hrEmployee.update({ where: { id: emp.id }, data: { defaultShiftId: shift.id } });

    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
    const log = async (logType, hhmm) =>
      expectOk(
        'POST',
        '/api/hr/docs/employee-checkin',
        hrToken,
        { employeeId: emp.id, logType, logTime: `${day}T${hhmm}:00+05:00`, source: 'mobile' },
        first.companyId
      );

    await log('IN', '09:05');
    await log('OUT', '17:30');

    const attendance = await prisma.hrAttendance.findFirst({
      where: { companyId: first.companyId, employeeId: emp.id, workDate: new Date(`${day}T00:00:00.000Z`) }
    });
    assert.ok(attendance, 'the check-ins must create the day attendance');
    assert.strictEqual(attendance.status, 'present', '09:05 is inside the 15 minute grace');
    assert.strictEqual(attendance.workingMinutes, 445, 'five hours twenty five worked minus the break');
    assert.strictEqual(attendance.shiftId, shift.id);

    // a log outside the thresholds must not touch attendance
    const before = await prisma.hrAttendance.findUnique({ where: { id: attendance.id } });
    await log('IN', '07:00');
    const after = await prisma.hrAttendance.findUnique({ where: { id: attendance.id } });
    assert.strictEqual(new Date(after.checkIn).getTime(), new Date(before.checkIn).getTime());
  });

  check('live tracking still records and returns pings', async () => {
    const emp = await prisma.hrEmployee.findFirst({ where: { companyId: first.companyId, userId: { not: null } } });
    await expectOk(
      'POST',
      '/api/hr/tracking',
      employeeToken,
      { event: 'heartbeat', latitude: 24.86, longitude: 67.01, accuracy: 12, battery: 80 },
      first.companyId
    );
    const stored = await prisma.hrEmployeeLocation.findFirst({ where: { companyId: first.companyId, employeeId: emp.id } });
    assert.ok(stored, 'a tracking ping must persist');
    const live = await expectOk('GET', '/api/hr/tracking', hrToken, null, first.companyId);
    assert.ok(Array.isArray(live.live), 'live tracking must return the tracked roster');
    assert.strictEqual(live.live[0].employeeCode, 'E2E-0001');
  });

  check('the Reports section computes from the records just created', async () => {
    const index = await expectOk('GET', '/api/hr/reports', hrToken, null, first.companyId);
    const names = index.reports.map((r) => r.name);
    for (const expected of [
      'employee-information',
      'employee-analytics',
      'monthly-attendance-sheet',
      'shift-attendance',
      'employee-leave-balance',
      'employee-ctc-breakup'
    ]) {
      assert.ok(names.includes(expected), `${expected} must be offered`);
    }

    const employees = await expectOk('GET', '/api/hr/reports/employee-information', hrToken, null, first.companyId);
    assert.strictEqual(employees.doctype, 'Employee Information');
    assert.deepStrictEqual(employees.columns.map((c) => c.key), [
      'employeeCode',
      'employeeName',
      'department',
      'designation',
      'joiningDate',
      'status'
    ]);
    assert.strictEqual(employees.total, 1);
    assert.strictEqual(employees.rows[0].employeeCode, 'E2E-0001');
    assert.strictEqual(employees.rows[0].employeeName, 'Emp Lee');
    assert.strictEqual(employees.rows[0].department, 'Engineering');

    const ctc = await expectOk('GET', '/api/hr/reports/employee-ctc-breakup', hrToken, null, first.companyId);
    const components = ctc.rows.map((r) => r.component).sort();
    assert.deepStrictEqual(components, ['E2E Basic Pay', 'E2E Tax'], 'component links resolve to their master names');
    assert.deepStrictEqual(ctc.rows.map((r) => r.type).sort(), ['Deduction', 'Earning']);
    assert.strictEqual(ctc.rows.find((r) => r.component === 'E2E Basic Pay').amount, 100000);
    assert.strictEqual(ctc.rows.find((r) => r.component === 'E2E Tax').basis, 'Percentage of Base');

    const balance = await expectOk('GET', '/api/hr/reports/employee-leave-balance', hrToken, null, first.companyId);
    const casual = balance.rows.find((r) => r.leaveType === 'E2E Casual');
    assert.ok(casual, 'the allocation created by the policy must appear');
    assert.ok(casual.allocated > 0);
    assert.strictEqual(casual.used, 0, 'the cancelled application released the days');
    assert.strictEqual(casual.employeeCode, 'E2E-0001');

    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
    const sheet = await expectOk(
      'GET',
      `/api/hr/reports/monthly-attendance-sheet?from=${day}&to=${day}`,
      hrToken,
      null,
      first.companyId
    );
    assert.deepStrictEqual(sheet.filters.available, ['date', 'employee', 'department']);
    assert.strictEqual(sheet.filters.from, day);
    assert.strictEqual(sheet.filters.to, day);
    const today = sheet.rows.find((r) => r.date === day && r.employeeCode === 'E2E-0001');
    assert.ok(today, 'the auto-attendance row must show in the sheet');
    assert.strictEqual(today.workingMinutes, 445);
    assert.strictEqual(today.employee, 'Emp Lee');

    // a report only honours the filters it declares, and says so in its payload
    assert.deepStrictEqual(employees.filters.available, ['employee', 'department']);
    assert.strictEqual(employees.filters.date, false, 'the roster is not date bound');
    const unfiltered = await expectOk(
      'GET',
      `/api/hr/reports/employee-information?from=1900-01-01&to=1900-01-02`,
      hrToken,
      null,
      first.companyId
    );
    assert.strictEqual(unfiltered.total, 1, 'a date filter this report does not declare must not change the rows');
    const mine = await expectOk(
      'GET',
      `/api/hr/reports/employee-information?employeeId=${employeeRow.id}`,
      hrToken,
      null,
      first.companyId
    );
    assert.strictEqual(mine.total, 1);
    const otherEmployee = await expectOk(
      'GET',
      `/api/hr/reports/employee-information?employeeId=does-not-exist`,
      hrToken,
      null,
      first.companyId
    );
    assert.strictEqual(otherEmployee.total, 0, 'a declared employee filter must scope the rows');
    const byDepartment = await expectOk(
      'GET',
      `/api/hr/reports/employee-information?department=Finance`,
      hrToken,
      null,
      first.companyId
    );
    assert.strictEqual(byDepartment.total, 0, 'the department filter must reach the query');

    const shiftReport = await expectOk('GET', '/api/hr/reports/shift-attendance', hrToken, null, first.companyId);
    assert.deepStrictEqual(shiftReport.filters.available, ['date'], 'shift attendance is grouped by shift, not filtered by employee');
    const auto = shiftReport.rows.find((r) => r.shift === 'Auto E2E Shift');
    assert.ok(auto, 'shift attendance must group the check-in attendance by shift');
    assert.strictEqual(auto.employees, 1);
    assert.strictEqual(auto.present, 1);

    const analytics = await expectOk('GET', '/api/hr/reports/employee-analytics', hrToken, null, first.companyId);
    assert.ok(analytics.total >= 1, 'analytics reports one row per month in the range');
    assert.ok(analytics.rows.every((r) => typeof r.active === 'number'));

    const badRange = await request(
      'GET',
      '/api/hr/reports/shift-attendance?from=2026-03-10&to=2026-03-01',
      hrToken,
      null,
      first.companyId
    );
    assert.strictEqual(badRange.status, 400, 'a reversed range must be rejected');
    const notADate = await request('GET', '/api/hr/reports/shift-attendance?to=not-a-date', hrToken, null, first.companyId);
    assert.strictEqual(notADate.status, 400, 'an unparseable date must be rejected');
    const tooLong = await request(
      'GET',
      '/api/hr/reports/monthly-attendance-sheet?from=2026-01-01&to=2026-12-31',
      hrToken,
      null,
      first.companyId
    );
    assert.strictEqual(tooLong.status, 400, 'the attendance sheet keeps its bounded range');
    assert.match(tooLong.body.message, /93 days/);

    const missing = await request('GET', '/api/hr/reports/employee-birthday', hrToken, null, first.companyId);
    assert.strictEqual(missing.status, 404, 'a report the registry cannot compute must not silently return rows');

    const other = await expectOk('GET', '/api/hr/reports/employee-information', otherToken, null, second.companyId);
    assert.strictEqual(other.total, 0, 'another company must see none of these employees');
    const otherCtc = await expectOk('GET', '/api/hr/reports/employee-ctc-breakup', otherToken, null, second.companyId);
    assert.strictEqual(otherCtc.total, 0);

    const denied = await request('GET', '/api/hr/reports/employee-information', employeeToken, null, first.companyId);
    assert.strictEqual(denied.status, 403, 'an employee must not reach the HR reports');
  });

  check('sidebar report links only point at reports that exist', async () => {
    const data = await expectOk('GET', '/api/hr/workspaces', hrToken, null, first.companyId);
    const links = [];
    const walk = (items) => {
      for (const item of items || []) {
        if (item.kind === 'report') links.push(item);
        walk(item.items);
      }
    };
    for (const ws of data.workspaces) walk(ws.items);
    assert.ok(links.length >= 15, 'the workspaces must link the ERPNext report list');
    for (const link of links.filter((l) => l.available)) {
      assert.match(link.href, new RegExp(`^/hr/[a-z-]+/report/${link.report}$`), `${link.label} href`);
    }
    for (const unbuilt of ['employee-birthday', 'income-tax-computation', 'accrued-earnings']) {
      const link = links.find((l) => l.report === unbuilt);
      assert.ok(link, `${unbuilt} must still be listed as an ERPNext report`);
      assert.strictEqual(link.available, false, `${unbuilt} cannot be computed from the stored data`);
    }
  });

  check('sidebar structure matches the inspected ERPNext workspaces', async () => {
    const data = await expectOk('GET', '/api/hr/workspaces', hrToken, null, first.companyId);
    // Sections and the dashboard link were read off https://hrms-rje-xre.nvi.frappe.cloud
    // workspace by workspace; the tree below is that observation, item for item.
    const expected = {
      'hr-setup': { dashboard: true, sections: ['Masters'] },
      tenure: { dashboard: true, sections: ['Templates', 'Grievance', 'Training', 'Reports'] },
      recruitment: { dashboard: true, sections: ['Templates', 'Planning', 'Reports', 'Setup'] },
      'shift-and-attendance': {
        dashboard: true,
        sections: ['Attendance', 'Shift Assignments', 'Shift Setup', 'Timesheets', 'Overtime', 'Reports']
      },
      leaves: { dashboard: false, sections: ['Leave Allocations', 'Holidays', 'Leave Setup', 'Reports'] },
      expenses: { dashboard: true, sections: ['Expenses & Advances', 'Travel', 'Accounting Entries', 'Reports'] },
      performance: { dashboard: false, sections: ['Reports', 'Setup'] },
      'tax-and-benefits': {
        dashboard: false,
        sections: ['Income Tax', 'Flexible Benefits', 'Gratuity', 'Reports', 'Tax & Exemption Setup']
      },
      payroll: { dashboard: true, sections: ['Reports', 'Setup'] }
    };
    for (const ws of data.workspaces) {
      const want = expected[ws.slug];
      assert.ok(want, `${ws.slug} was not inspected in ERPNext`);
      assert.deepStrictEqual(ws.items.filter((i) => i.kind === 'section').map((i) => i.section), want.sections, `${ws.slug} sections`);
      const hasDashboard = ws.items.some((i) => i.kind === 'dashboard');
      assert.strictEqual(hasDashboard, want.dashboard, `${ws.slug} dashboard link`);
      assert.strictEqual(ws.items[0].kind, 'home', `${ws.slug} must open with Home`);
    }

    const shift = data.workspaces.find((ws) => ws.slug === 'shift-and-attendance');
    const attendanceSection = shift.items.find((i) => i.section === 'Attendance');
    assert.deepStrictEqual(
      attendanceSection.items.map((i) => i.label),
      ['Employee Checkin', 'Attendance', 'Employee Attendance Tool', 'Attendance Request']
    );
    const reportsSection = shift.items.find((i) => i.section === 'Reports');
    assert.deepStrictEqual(
      reportsSection.items.map((i) => [i.label, i.available]),
      [
        ['Monthly Attendance Sheet', true],
        ['Shift Attendance', true],
        ['Employee Hours Utilization Based On Timesheet', false],
        ['Project Profitability', false]
      ]
    );

    const payroll = data.workspaces.find((ws) => ws.slug === 'payroll');
    assert.deepStrictEqual(
      payroll.items.find((i) => i.section === 'Reports').items.map((i) => i.label),
      ['Employee CTC Break-up', 'Salary Register', 'Accounts Payable', 'General Ledger']
    );
    assert.ok(
      payroll.items.some((i) => i.label === 'Salary Withholding' && i.available === false),
      'Salary Withholding is an ERPNext payroll document and must be listed'
    );

    // employees lose the setup-style blocks, header included
    const asEmployee = await expectOk('GET', '/api/hr/workspaces', employeeToken, null, first.companyId);
    const setupBlock = (name) => /setup|masters|tools|settings/i.test(name) || name === 'Reports';
    for (const ws of asEmployee.workspaces) {
      const sections = ws.items.filter((i) => i.kind === 'section').map((i) => i.section);
      assert.deepStrictEqual(sections.filter(setupBlock), [], `${ws.slug} setup sections`);
      assert.deepStrictEqual(ws.extraDocuments, [], `${ws.slug} must not expose manager-only masters`);
    }
    const tenure = asEmployee.workspaces.find((ws) => ws.slug === 'tenure');
    assert.ok(tenure.items.some((i) => i.label === 'Employee Onboarding'), 'the employee keeps the non-setup links');
    const asManager = await expectOk('GET', '/api/hr/workspaces', hrToken, null, first.companyId);
    const managerTenure = asManager.workspaces.find((ws) => ws.slug === 'tenure');
    assert.ok(managerTenure.items.some((i) => i.section === 'Reports'), 'the HR manager keeps the Reports block');
  });

  check('descriptors drive the form and the backend validates the same fields', async () => {
    const list = await expectOk('GET', '/api/hr/docs/salary-structure', hrToken, null, first.companyId);
    assert.strictEqual(list.doctype, 'Salary Structure');

    const missing = await request('POST', '/api/hr/docs/salary-structure', hrToken, { currency: 'PKR' }, first.companyId);
    assert.strictEqual(missing.status, 400);
    assert.ok(Array.isArray(missing.body.errors), 'field errors must be reported per field');

    const badCurrency = await request('POST', '/api/hr/docs/expense-claim', hrToken, { employeeId: employeeRow.id, claimDate: '2026-03-01', currency: 'ZZZ' }, first.companyId);
    assert.strictEqual(badCurrency.status, 400, 'unknown currency codes must be rejected');

    const employees = await expectOk('GET', '/api/hr/link-options/employee', employeeToken, null, first.companyId);
    assert.ok(employees.every((o) => o.id !== undefined && typeof o.label === 'string'));
    assert.strictEqual(employees.length, 1, 'an employee may only see employees of their own company');

    const components = await expectOk('GET', '/api/hr/link-options/salary-component', hrToken, null, first.companyId);
    assert.ok(components.length >= 2);
  });

  check('ERPNext depends_on conditions hide fields on both sides of the wire', async () => {
    const meta = await expectOk('GET', '/api/hr/docs/attendance-request/meta', hrToken, null, first.companyId);
    const conditional = meta.descriptor.fields.find((f) => f.n === 'attendanceStatus');
    assert.deepStrictEqual(
      conditional.when,
      [{ field: 'action', equals: 'Make Attendance', truthy: false }],
      'a conditional field ships machine-readable clauses the browser can evaluate'
    );

    const hidden = await expectOk(
      'POST',
      '/api/hr/docs/attendance-request',
      hrToken,
      {
        employeeId: employeeRow.id,
        fromDate: '2026-04-01',
        toDate: '2026-04-01',
        action: 'Explain Absence',
        attendanceStatus: 'Work From Home',
        reason: 'E2E absent'
      },
      first.companyId
    );
    const hiddenRow = await prisma.hrAttendanceCorrection.findUnique({ where: { id: hidden.id } });
    assert.strictEqual(
      hiddenRow.attendanceStatus,
      'Present',
      'a value submitted for a field the condition hides is not stored'
    );

    const shown = await expectOk(
      'POST',
      '/api/hr/docs/attendance-request',
      hrToken,
      {
        employeeId: employeeRow.id,
        fromDate: '2026-04-02',
        toDate: '2026-04-02',
        action: 'Make Attendance',
        attendanceStatus: 'Work From Home',
        reason: 'E2E wfh'
      },
      first.companyId
    );
    const shownRow = await prisma.hrAttendanceCorrection.findUnique({ where: { id: shown.id } });
    assert.strictEqual(shownRow.attendanceStatus, 'Work From Home', 'while the condition holds the value is stored');

    // ERPNext gates the overtime type the same way
    const shiftMeta = await expectOk('GET', '/api/hr/docs/shift-type/meta', hrToken, null, first.companyId);
    const overtimeField = shiftMeta.descriptor.fields.find((f) => f.n === 'overtimeTypeId');
    assert.deepStrictEqual(overtimeField.when, [{ field: 'calculateOvertime', truthy: true }]);
    const shift = await expectOk(
      'POST',
      '/api/hr/docs/shift-type',
      hrToken,
      {
        name: 'E2E Conditional Shift',
        startTime: '09:00:00',
        endTime: '17:00:00',
        enableAutoAttendance: false,
        firstCheckinThresholdMinutes: 45
      },
      first.companyId
    );
    const shiftRow = await prisma.hrShift.findUnique({ where: { id: shift.id } });
    assert.strictEqual(
      shiftRow.firstCheckinThresholdMinutes,
      0,
      'a value submitted while the condition is false is not stored'
    );
  });

  check('recruitment, lifecycle and training documents run their ERPNext hooks', async () => {
    const designation = await expectOk(
      'POST',
      '/api/hr/docs/designation',
      hrToken,
      { name: 'E2E Engineer' },
      first.companyId
    );

    const applicant = await expectOk(
      'POST',
      '/api/hr/docs/job-applicant',
      hrToken,
      { applicantName: 'E2E Applicant', emailId: 'applicant@example.com' },
      first.companyId
    );
    const letterTemplate = await expectOk(
      'POST',
      '/api/hr/docs/appointment-letter-template',
      hrToken,
      {
        templateName: 'E2E Letter',
        introduction: 'Intro text',
        terms: [{ title: 'Term', description: 'Desc' }],
        closingNotes: 'Bye'
      },
      first.companyId
    );
    const letter = await expectOk(
      'POST',
      '/api/hr/docs/appointment-letter',
      hrToken,
      { jobApplicantId: applicant.id, templateId: letterTemplate.id, appointmentDate: '2026-05-01' },
      first.companyId
    );
    assert.strictEqual(letter.applicantName, 'E2E Applicant', 'applicant name comes from the linked applicant');
    assert.strictEqual(letter.introduction, 'Intro text', 'template introduction is copied onto the letter');
    assert.strictEqual(letter.terms.length, 1, 'template terms are copied onto the letter');

    const referral = await expectOk(
      'POST',
      '/api/hr/docs/employee-referral',
      hrToken,
      {
        firstName: 'Ref',
        lastName: 'Erral',
        date: '2026-05-01',
        forDesignationId: designation.id,
        email: 'referral@example.com',
        referrerEmployeeId: employeeRow.id
      },
      first.companyId
    );
    assert.strictEqual(referral.fullName, 'Ref Erral');
    assert.strictEqual(referral.referrerName, 'Emp Lee');

    const plan = await expectOk(
      'POST',
      '/api/hr/docs/staffing-plan',
      hrToken,
      {
        fromDate: '2026-01-01',
        toDate: '2026-12-31',
        staffingDetails: [
          { designationId: designation.id, vacancies: 3, estimatedCostPerPosition: 1000 }
        ]
      },
      first.companyId
    );
    assert.strictEqual(plan.totalEstimatedBudget, 3000, 'staffing budget sums the line costs');
    assert.strictEqual(plan.staffingDetails[0].totalEstimatedCost, 3000);
    assert.strictEqual(plan.staffingDetails[0].numberOfPositions, 3, 'positions include current staff and openings');

    const holidayList = await expectOk(
      'POST',
      '/api/hr/docs/holiday-list',
      hrToken,
      { name: 'E2E Holidays', fromDate: '2026-01-01', toDate: '2026-12-31' },
      first.companyId
    );
    const assignment = await expectOk(
      'POST',
      '/api/hr/docs/holiday-list-assignment',
      hrToken,
      {
        applicableFor: 'Employee',
        assignedToId: employeeRow.id,
        holidayListId: holidayList.id,
        fromDate: '2026-02-01'
      },
      first.companyId
    );
    assert.strictEqual(assignment.employeeName, 'Emp Lee');
    assert.strictEqual(assignment.holidayListStart, '2026-01-01');
    await expectOk(
      'POST',
      `/api/hr/docs/holiday-list-assignment/${assignment.id}/action/submit`,
      hrToken,
      {},
      first.companyId
    );
    const assignedEmployee = await prisma.hrEmployee.findUnique({ where: { id: employeeRow.id } });
    assert.strictEqual(assignedEmployee.holidayListId, holidayList.id, 'submitting the assignment writes the employee list');

    const event = await expectOk(
      'POST',
      '/api/hr/docs/training-event',
      hrToken,
      {
        eventName: 'E2E Training',
        trainerName: 'Trainer X',
        startTime: '2026-06-01T09:00',
        endTime: '2026-06-01T17:00',
        employees: [{ employeeId: employeeRow.id, status: 'Attend', hours: 8 }]
      },
      first.companyId
    );
    const feedback = await expectOk(
      'POST',
      '/api/hr/docs/training-feedback',
      hrToken,
      { employeeId: employeeRow.id, trainingEventId: event.id, feedback: 'Good' },
      first.companyId
    );
    assert.strictEqual(feedback.employeeName, 'Emp Lee', 'feedback copies the employee name');
    assert.strictEqual(feedback.eventName, 'E2E Training', 'feedback copies the event name');
    await expectOk(
      'POST',
      `/api/hr/docs/training-feedback/${feedback.id}/action/submit`,
      hrToken,
      {},
      first.companyId
    );
    const duplicate = await request(
      'POST',
      '/api/hr/docs/training-feedback',
      hrToken,
      { employeeId: employeeRow.id, trainingEventId: event.id, feedback: 'Again' },
      first.companyId
    );
    assert.strictEqual(duplicate.status, 400, 'a second submitted feedback for the same event is rejected');

    const result = await expectOk(
      'POST',
      '/api/hr/docs/training-result',
      hrToken,
      { trainingEventId: event.id },
      first.companyId
    );
    assert.strictEqual(result.employees.length, 1, 'training result copies the event participants');
    assert.strictEqual(result.employees[0].employeeName, 'Emp Lee');
  });
}

async function cleanup() {
  for (const id of created.companyIds) {
    await prisma.hrAuditLog.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrAttendanceCorrection.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrShift.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrEmployeeCheckin.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrAttendance.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrLeaveBalance.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrLeave.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrLeavePolicyAssignment.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrLeavePolicy.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrLeavePeriod.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrLeaveType.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrEmployeeLocation.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrExpenseClaim.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrSalaryStructureAssignment.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrSalaryStructure.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrSalaryComponent.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrTrainingFeedback.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrTrainingResult.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrTrainingEvent.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrAppointmentLetter.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrAppointmentLetterTemplate.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrHolidayListAssignment.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrHolidayList.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrEmployeeReferral.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrStaffingPlan.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrJobApplicant.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrDesignation.deleteMany({ where: { companyId: id } }).catch(() => {});
    await prisma.hrEmployee.deleteMany({ where: { companyId: id } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: { in: created.companyIds } } }).catch(() => {});
}

(async () => {
  await new Promise((resolve) => {
    server = app.listen(0);
    server.once('listening', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  let failed = 0;
  let setupError = null;
  try {
    await run();
  } catch (error) {
    setupError = error;
  }

  if (setupError) {
    console.error('setup failed:', setupError.message);
    failed = results.length || 1;
  } else {
    for (const [name, fn] of results) {
      try {
        await fn();
        console.log(`  ✓ ${name}`);
      } catch (error) {
        failed += 1;
        console.error(`  ✗ ${name}\n    ${error.message}`);
      }
    }
  }

  await cleanup();
  server.close();
  await prisma.$disconnect();

  const total = results.length;
  console.log(`\n${total - failed}/${total} live HRMS checks passed`);
  process.exitCode = failed ? 1 : 0;
})();
