'use strict';

const bcrypt = require('bcryptjs');
const prisma = require('../prisma/client');
const emailService = require('../services/emailService');
const { getCompanyCapacity, buildUpgradeQuote } = require('../utils/companySubscription');
const {
  isEmployeeRole,
  haversineMeters,
  workDateKey,
  isLateCheckIn,
  generateTempPassword,
  statusLabel,
  statusKey,
  splitName,
  requireCompany,
  requireHrManager,
  canViewSalary
} = require('../utils/hrAccess');

const EMPLOYEE_INCLUDE = {
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
      isActive: true
    }
  },
  office: {
    select: {
      id: true,
      name: true,
      address: true,
      latitude: true,
      longitude: true,
      radiusMeters: true,
      isActive: true
    }
  },
  location: true
};

function fullName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'Employee';
}

function serializeEmployee(emp, extras = {}) {
  if (!emp) return null;
  const { hideSalary, ...rest } = extras;
  return {
    id: emp.id,
    userId: emp.userId,
    employeeId: emp.employeeCode,
    employeeCode: emp.employeeCode,
    name: fullName(emp.user),
    firstName: emp.user?.firstName || '',
    lastName: emp.user?.lastName || '',
    email: emp.user?.email || '',
    phone: emp.phone || emp.user?.phone || '',
    department: emp.department,
    designation: emp.designation,
    office: emp.office?.name || '',
    officeId: emp.officeId,
    officeDetails: emp.office || null,
    employmentType: emp.employmentType,
    employeeType: emp.employeeType,
    shift: emp.shiftLabel,
    salary: hideSalary ? undefined : emp.salary,
    joiningDate: emp.joiningDate,
    status: statusLabel(emp.status),
    statusKey: emp.status,
    managerId: emp.managerId || null,
    position: emp.position || '',
    costCenter: emp.costCenter || '',
    trackingEnabled: emp.trackingEnabled !== false,
    profile: emp.profile || {},
    isActive: emp.user?.isActive !== false && emp.status === 'active',
    createdAt: emp.createdAt,
    ...rest
  };
}

function serializeAttendance(row) {
  if (!row) return null;
  const checkIn = row.checkIn ? new Date(row.checkIn) : null;
  const checkOut = row.checkOut ? new Date(row.checkOut) : null;
  let workingMinutes = row.workingMinutes || 0;
  if (checkIn && !checkOut) {
    workingMinutes = Math.max(0, Math.round((Date.now() - checkIn.getTime()) / 60000));
  } else if (checkIn && checkOut) {
    workingMinutes = Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60000));
  }
  return {
    id: row.id,
    employeeId: row.employeeId,
    workDate: row.workDate,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    status: statusLabel(row.status),
    statusKey: row.status,
    source: row.source,
    workingMinutes,
    isCheckedIn: Boolean(row.checkIn) && !row.checkOut
  };
}

async function nextEmployeeCode(companyId) {
  const last = await prisma.hrEmployee.findFirst({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    select: { employeeCode: true }
  });
  const match = String(last?.employeeCode || '').match(/(\d+)\s*$/);
  const next = (match ? Number(match[1]) : 0) + 1;
  return `EMP-${String(next).padStart(3, '0')}`;
}

async function findEmployeeForUser(userId, companyId) {
  return prisma.hrEmployee.findFirst({
    where: { userId, ...(companyId ? { companyId } : {}) },
    include: EMPLOYEE_INCLUDE
  });
}

async function upsertLastLocation({
  companyId,
  employeeId,
  officeId,
  latitude,
  longitude,
  accuracy,
  insideGeofence,
  status
}) {
  return prisma.hrEmployeeLocation.upsert({
    where: { employeeId },
    create: {
      companyId,
      employeeId,
      officeId: officeId || null,
      latitude,
      longitude,
      accuracy: accuracy ?? null,
      insideGeofence: Boolean(insideGeofence),
      status: status || 'offline',
      lastSeenAt: new Date()
    },
    update: {
      officeId: officeId || null,
      latitude,
      longitude,
      accuracy: accuracy ?? null,
      insideGeofence: Boolean(insideGeofence),
      status: status || 'offline',
      lastSeenAt: new Date()
    }
  });
}

async function markAttendance({
  companyId,
  employeeId,
  latitude,
  longitude,
  action,
  source = 'geofence'
}) {
  const workDate = workDateKey();
  let row = await prisma.hrAttendance.findUnique({
    where: { employeeId_workDate: { employeeId, workDate } }
  });

  if (action === 'check_in') {
    if (row?.checkIn && !row.checkOut) {
      return { attendance: row, created: false, message: 'Already checked in today' };
    }
    if (row?.checkOut) {
      return { attendance: row, created: false, message: 'Already completed attendance today' };
    }
    const late = isLateCheckIn();
    row = await prisma.hrAttendance.create({
      data: {
        companyId,
        employeeId,
        workDate,
        checkIn: new Date(),
        checkInLat: latitude ?? null,
        checkInLng: longitude ?? null,
        status: late ? 'late' : 'present',
        source
      }
    });
    return {
      attendance: row,
      created: true,
      autoCheckedIn: true,
      message: late ? 'Checked in (late)' : 'Checked in'
    };
  }

  if (action === 'check_out') {
    if (!row?.checkIn) {
      return { attendance: row, created: false, message: 'Not checked in yet' };
    }
    if (row.checkOut) {
      return { attendance: row, created: false, message: 'Already checked out' };
    }
    const checkOut = new Date();
    const workingMinutes = Math.max(
      0,
      Math.round((checkOut.getTime() - new Date(row.checkIn).getTime()) / 60000)
    );
    row = await prisma.hrAttendance.update({
      where: { id: row.id },
      data: {
        checkOut,
        checkOutLat: latitude ?? null,
        checkOutLng: longitude ?? null,
        workingMinutes,
        source
      }
    });
    return {
      attendance: row,
      created: true,
      autoCheckedOut: true,
      message: 'Checked out'
    };
  }

  return { attendance: row, created: false, message: 'No attendance change' };
}

exports.listOffices = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;

    const offices = await prisma.hrOffice.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: true } } }
    });

    res.json({
      success: true,
      data: offices.map((o) => ({
        id: o.id,
        name: o.name,
        address: o.address,
        latitude: o.latitude,
        longitude: o.longitude,
        radius: o.radiusMeters,
        radiusMeters: o.radiusMeters,
        status: o.isActive ? 'Active' : 'Inactive',
        isActive: o.isActive,
        employeeCount: o._count.employees
      }))
    });
  } catch (error) {
    console.error('[hr] listOffices', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createOffice = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;

    const { name, address, latitude, longitude, radius, radiusMeters, isActive } = req.body;
    if (!name || latitude == null || longitude == null) {
      return res.status(400).json({
        success: false,
        message: 'Office name, latitude and longitude are required'
      });
    }

    const office = await prisma.hrOffice.create({
      data: {
        companyId,
        name: String(name).trim(),
        address: String(address || '').trim(),
        latitude: Number(latitude),
        longitude: Number(longitude),
        radiusMeters: parseInt(radiusMeters || radius || 150, 10),
        isActive: isActive !== false
      }
    });

    res.status(201).json({ success: true, data: office });
  } catch (error) {
    console.error('[hr] createOffice', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateOffice = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;

    const existing = await prisma.hrOffice.findFirst({
      where: { id: req.params.id, companyId }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Office not found' });
    }

    const { name, address, latitude, longitude, radius, radiusMeters, isActive, status } = req.body;
    const office = await prisma.hrOffice.update({
      where: { id: existing.id },
      data: {
        name: name != null ? String(name).trim() : undefined,
        address: address != null ? String(address).trim() : undefined,
        latitude: latitude != null ? Number(latitude) : undefined,
        longitude: longitude != null ? Number(longitude) : undefined,
        radiusMeters:
          radiusMeters != null || radius != null
            ? parseInt(radiusMeters || radius, 10)
            : undefined,
        isActive:
          isActive != null
            ? Boolean(isActive)
            : status
              ? String(status).toLowerCase() === 'active'
              : undefined
      }
    });

    res.json({ success: true, data: office });
  } catch (error) {
    console.error('[hr] updateOffice', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listEmployees = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;

    const employees = await prisma.hrEmployee.findMany({
      where: { companyId },
      include: EMPLOYEE_INCLUDE,
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: employees.map((e) => serializeEmployee(e, { hideSalary: !canViewSalary(req.user) }))
    });
  } catch (error) {
    console.error('[hr] listEmployees', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createEmployee = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;

    const {
      name,
      firstName: rawFirst,
      lastName: rawLast,
      email,
      phone,
      department,
      designation,
      officeId,
      employmentType,
      employeeType,
      shift,
      salary,
      joiningDate,
      status,
      password
    } = req.body;

    const { firstName, lastName } = rawFirst
      ? { firstName: rawFirst, lastName: rawLast || rawFirst }
      : splitName(name);

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !firstName) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required'
      });
    }

    const providedPassword = String(password || '').trim();
    if (providedPassword && providedPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    const capacity = await getCompanyCapacity(prisma, companyId);
    if (!capacity.canAddUser) {
      const upgrade = buildUpgradeQuote(capacity, { addUsers: 1 });
      return res.status(402).json({
        success: false,
        code: 'SUBSCRIPTION_UPGRADE_REQUIRED',
        reason: 'user_seat',
        message: `User seat limit reached (${capacity.usedUsers}/${capacity.licensedUsers}). Upgrade to add another employee.`,
        data: { capacity, upgrade }
      });
    }

    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true, email: true }
    });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        code: 'EMAIL_EXISTS',
        message: `A user already exists with this email (${normalizedEmail}).`
      });
    }

    if (officeId) {
      const office = await prisma.hrOffice.findFirst({
        where: { id: officeId, companyId }
      });
      if (!office) {
        return res.status(400).json({ success: false, message: 'Selected office was not found' });
      }
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        trialStartDate: true,
        trialEndDate: true,
        subscriptionStartDate: true,
        subscriptionEndDate: true
      }
    });

    const loginPassword = providedPassword || generateTempPassword();
    const hashedPassword = await bcrypt.hash(loginPassword, 10);
    const employeeCode = await nextEmployeeCode(companyId);
    const currentUserId = req.user.id || req.user._id;

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firstName,
          lastName,
          email: normalizedEmail,
          password: hashedPassword,
          phone: String(phone || '').trim(),
          role: 'employee',
          createdBy: currentUserId,
          companyId,
          subscriptionPlan: company?.subscriptionPlan || 'trial',
          subscriptionStatus: company?.subscriptionStatus || 'active',
          subscriptionStartDate: company?.subscriptionStartDate || new Date(),
          subscriptionEndDate: company?.subscriptionEndDate || null,
          trialStartDate: company?.trialStartDate || null,
          trialEndDate: company?.trialEndDate || null,
          isActive: statusKey(status) !== 'terminated' && statusKey(status) !== 'inactive'
        }
      });

      const employee = await tx.hrEmployee.create({
        data: {
          companyId,
          userId: user.id,
          employeeCode,
          department: String(department || '').trim(),
          designation: String(designation || '').trim(),
          officeId: officeId || null,
          employmentType: String(employmentType || 'Full Time'),
          employeeType: String(employeeType || 'Office Employee'),
          shiftLabel: String(shift || ''),
          salary: Number(salary || 0),
          joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
          status: statusKey(status),
          phone: String(phone || '').trim()
        },
        include: EMPLOYEE_INCLUDE
      });

      return { user, employee };
    });

    let emailSent = false;
    try {
      const invitedBy = [req.user.firstName, req.user.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || req.user.email;
      await emailService.sendTeamInviteEmail({
        to: normalizedEmail,
        firstName,
        lastName,
        loginEmail: normalizedEmail,
        password: loginPassword,
        roleLabel: 'Employee',
        companyName: company?.name || 'BisonsTechs',
        invitedBy
      });
      emailSent = true;
    } catch (emailError) {
      console.error('[hr] invite email failed:', emailError.message);
    }

    res.status(201).json({
      success: true,
      emailSent,
      passwordSetByHr: Boolean(providedPassword),
      temporaryPassword: providedPassword || emailSent ? undefined : loginPassword,
      message: providedPassword
        ? emailSent
          ? 'Employee created. Share the password you set, or they can use the login email we sent.'
          : 'Employee created. Share the email and password you set — they will open the employee dashboard only.'
        : emailSent
          ? 'Employee created as a user. Login details sent to their email. They will open the employee dashboard only.'
          : 'Employee created, but the invite email could not be sent. Share the temporary password manually.',
      data: serializeEmployee(created.employee)
    });
  } catch (error) {
    console.error('[hr] createEmployee', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateEmployee = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;

    const existing = await prisma.hrEmployee.findFirst({
      where: { id: req.params.id, companyId },
      include: EMPLOYEE_INCLUDE
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const {
      name,
      firstName: rawFirst,
      lastName: rawLast,
      phone,
      department,
      designation,
      officeId,
      employmentType,
      employeeType,
      shift,
      salary,
      joiningDate,
      status
    } = req.body;

    const names = rawFirst
      ? { firstName: rawFirst, lastName: rawLast || rawFirst }
      : name
        ? splitName(name)
        : null;

    const nextStatus = status != null ? statusKey(status) : existing.status;

    const employee = await prisma.$transaction(async (tx) => {
      if (names || phone != null || status != null) {
        await tx.user.update({
          where: { id: existing.userId },
          data: {
            ...(names ? { firstName: names.firstName, lastName: names.lastName } : {}),
            ...(phone != null ? { phone: String(phone).trim() } : {}),
            isActive: nextStatus !== 'terminated' && nextStatus !== 'inactive'
          }
        });
      }

      return tx.hrEmployee.update({
        where: { id: existing.id },
        data: {
          department: department != null ? String(department).trim() : undefined,
          designation: designation != null ? String(designation).trim() : undefined,
          officeId: officeId !== undefined ? officeId || null : undefined,
          employmentType: employmentType != null ? String(employmentType) : undefined,
          employeeType: employeeType != null ? String(employeeType) : undefined,
          shiftLabel: shift != null ? String(shift) : undefined,
          salary: salary != null ? Number(salary) : undefined,
          joiningDate: joiningDate ? new Date(joiningDate) : undefined,
          status: nextStatus,
          phone: phone != null ? String(phone).trim() : undefined
        },
        include: EMPLOYEE_INCLUDE
      });
    });

    res.json({ success: true, data: serializeEmployee(employee) });
  } catch (error) {
    console.error('[hr] updateEmployee', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getEmployee = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;

    const employee = await prisma.hrEmployee.findFirst({
      where: { id: req.params.id, companyId },
      include: EMPLOYEE_INCLUDE
    });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const isSelf = employee.userId === (req.user.id || req.user._id);
    if (!isSelf && !requireHrManager(req, res)) return;

    const today = await prisma.hrAttendance.findUnique({
      where: {
        employeeId_workDate: { employeeId: employee.id, workDate: workDateKey() }
      }
    });

    res.json({
      success: true,
      data: serializeEmployee(employee, { attendance: serializeAttendance(today) })
    });
  } catch (error) {
    console.error('[hr] getEmployee', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;

    const employee = await findEmployeeForUser(req.user.id || req.user._id, companyId);
    if (!employee) {
      return res.status(404).json({
        success: false,
        code: 'NOT_AN_EMPLOYEE',
        message: 'No employee profile is linked to this user'
      });
    }

    const today = await prisma.hrAttendance.findUnique({
      where: {
        employeeId_workDate: { employeeId: employee.id, workDate: workDateKey() }
      }
    });

    res.json({
      success: true,
      data: serializeEmployee(employee, {
        attendance: serializeAttendance(today),
        lastLocation: employee.location
          ? {
              latitude: employee.location.latitude,
              longitude: employee.location.longitude,
              insideGeofence: employee.location.insideGeofence,
              status: employee.location.status,
              lastSeenAt: employee.location.lastSeenAt
            }
          : null
      })
    });
  } catch (error) {
    console.error('[hr] getMe', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.dashboardStats = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;

    const selected = req.query.date ? workDateKey(new Date(req.query.date)) : workDateKey();
    const weekKeys = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(selected.getTime());
      d.setUTCDate(d.getUTCDate() - i);
      weekKeys.push(d);
    }
    const weekStart = weekKeys[0];
    const toYmd = (value) => {
      const d = value instanceof Date ? value : new Date(value);
      return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
    };

    const [employees, todayRows, weekRows, liveCount] = await Promise.all([
      prisma.hrEmployee.findMany({
        where: { companyId, status: { not: 'terminated' } },
        select: { status: true, employeeType: true, department: true }
      }),
      prisma.hrAttendance.findMany({
        where: { companyId, workDate: selected },
        include: { employee: { include: EMPLOYEE_INCLUDE } },
        orderBy: { checkIn: 'asc' },
        take: 50
      }),
      prisma.hrAttendance.findMany({
        where: {
          companyId,
          workDate: { gte: weekStart, lte: selected }
        },
        select: { workDate: true, status: true, checkIn: true }
      }),
      prisma.hrEmployeeLocation.count({ where: { companyId } })
    ]);

    const total = employees.length;
    const onLeave = employees.filter((e) => e.status === 'on_leave').length;
    const fieldStaff = employees.filter((e) =>
      String(e.employeeType || '').toLowerCase().includes('field')
    ).length;
    const late = todayRows.filter((r) => r.status === 'late').length;
    const present = todayRows.filter((r) => r.checkIn).length;
    const working = todayRows.filter((r) => r.checkIn && !r.checkOut).length;
    const absent = Math.max(0, total - present - onLeave);

    const deptMap = new Map();
    employees.forEach((e) => {
      const name = e.department || 'Unassigned';
      deptMap.set(name, (deptMap.get(name) || 0) + 1);
    });

    const byDay = new Map(weekKeys.map((key) => [toYmd(key), { present: 0, late: 0 }]));
    weekRows.forEach((row) => {
      const bucket = byDay.get(toYmd(row.workDate));
      if (!bucket) return;
      if (row.checkIn) bucket.present += 1;
      if (row.status === 'late') bucket.late += 1;
    });

    const weekly = weekKeys.map((key) => {
      const ymd = toYmd(key);
      const bucket = byDay.get(ymd) || { present: 0, late: 0 };
      return {
        day: key.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
        date: ymd,
        present: bucket.present,
        late: bucket.late,
        absent: Math.max(0, total - bucket.present),
        leave: 0,
        onTime: Math.max(0, bucket.present - bucket.late)
      };
    });

    res.json({
      success: true,
      data: {
        totalEmployees: total,
        present,
        late,
        absent,
        onLeave,
        fieldStaff,
        working,
        liveCount,
        officeStaff: Math.max(0, total - fieldStaff),
        departments: Array.from(deptMap.entries()).map(([name, value]) => ({ name, value })),
        weekly,
        attendance: todayRows.map((row) => ({
          ...serializeAttendance(row),
          employee: serializeEmployee(row.employee)
        }))
      }
    });
  } catch (error) {
    console.error('[hr] dashboardStats', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listAttendance = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;

    const workDate = req.query.date ? workDateKey(new Date(req.query.date)) : workDateKey();
    const rows = await prisma.hrAttendance.findMany({
      where: { companyId, workDate },
      include: {
        employee: { include: EMPLOYEE_INCLUDE }
      },
      orderBy: { checkIn: 'asc' }
    });

    res.json({
      success: true,
      data: rows.map((row) => ({
        ...serializeAttendance(row),
        employee: serializeEmployee(row.employee)
      }))
    });
  } catch (error) {
    console.error('[hr] listAttendance', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.myAttendance = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;

    const employee = await findEmployeeForUser(req.user.id || req.user._id, companyId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }

    const today = await prisma.hrAttendance.findUnique({
      where: {
        employeeId_workDate: { employeeId: employee.id, workDate: workDateKey() }
      }
    });

    res.json({
      success: true,
      data: {
        employee: serializeEmployee(employee),
        attendance: serializeAttendance(today)
      }
    });
  } catch (error) {
    console.error('[hr] myAttendance', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

async function runCheckAction(req, res, action) {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const employee = await findEmployeeForUser(req.user.id || req.user._id, companyId);
  if (!employee) {
    return res.status(404).json({ success: false, message: 'Employee profile not found' });
  }

  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const accuracy = req.body.accuracy != null ? Number(req.body.accuracy) : null;
  const office = employee.office;
  let inside = false;
  let distance = null;

  if (office && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    distance = haversineMeters(latitude, longitude, office.latitude, office.longitude);
    inside = distance <= (office.radiusMeters || 150);
  }

  if (action === 'check_in' && office && Number.isFinite(distance) && !inside) {
    return res.status(400).json({
      success: false,
      message: `You are ${Math.round(distance)}m outside ${office.name}. Move inside the office geofence to check in.`
    });
  }

  const result = await markAttendance({
    companyId,
    employeeId: employee.id,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    action,
    source: req.body.source || 'manual'
  });

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    await upsertLastLocation({
      companyId,
      employeeId: employee.id,
      officeId: employee.officeId,
      latitude,
      longitude,
      accuracy,
      insideGeofence: inside,
      status: result.attendance?.checkIn && !result.attendance?.checkOut
        ? (inside ? 'working' : 'field')
        : inside
          ? 'inside'
          : 'outside'
    });
  }

  res.json({
    success: true,
    message: result.message,
    data: {
      attendance: serializeAttendance(result.attendance),
      insideGeofence: inside,
      distanceMeters: distance != null ? Math.round(distance) : null
    }
  });
}

exports.checkIn = async (req, res) => {
  try {
    await runCheckAction(req, res, 'check_in');
  } catch (error) {
    console.error('[hr] checkIn', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.checkOut = async (req, res) => {
  try {
    await runCheckAction(req, res, 'check_out');
  } catch (error) {
    console.error('[hr] checkOut', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Phone shares last-known GPS while tracking is on (enter/exit/move/heartbeat).
 * Office geofence is only for auto check-in / check-out. Last location is upserted — no ping history.
 */
exports.trackingEvent = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;

    const employee = await findEmployeeForUser(req.user.id || req.user._id, companyId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }

    const event = String(req.body.event || 'heartbeat').toLowerCase();

    if (event === 'stop') {
      await prisma.hrEmployeeLocation.updateMany({
        where: { employeeId: employee.id },
        data: { status: 'offline', lastSeenAt: new Date() }
      });
      return res.json({
        success: true,
        data: {
          event: 'stop',
          message: 'Location tracking stopped',
          tracked: { status: 'offline' }
        }
      });
    }

    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ success: false, message: 'Valid latitude and longitude are required' });
    }

    const office = employee.office;
    let distance = null;
    let inside = false;
    if (office) {
      distance = haversineMeters(latitude, longitude, office.latitude, office.longitude);
      inside = distance <= (office.radiusMeters || 150);
    }

    let attendanceResult = { attendance: null, message: 'Location updated' };
    if (event === 'enter' && inside) {
      attendanceResult = await markAttendance({
        companyId,
        employeeId: employee.id,
        latitude,
        longitude,
        action: 'check_in',
        source: 'geofence'
      });
    } else if (event === 'exit') {
      attendanceResult = await markAttendance({
        companyId,
        employeeId: employee.id,
        latitude,
        longitude,
        action: 'check_out',
        source: 'geofence'
      });
    } else {
      attendanceResult.attendance = await prisma.hrAttendance.findUnique({
        where: {
          employeeId_workDate: { employeeId: employee.id, workDate: workDateKey() }
        }
      });
      attendanceResult.message = inside ? 'Inside office' : 'Live location updated';
    }

    const checkedIn = Boolean(attendanceResult.attendance?.checkIn) && !attendanceResult.attendance?.checkOut;
    const status = checkedIn
      ? (inside ? 'working' : 'field')
      : inside
        ? 'inside'
        : 'outside';

    const tracked = employee.trackingEnabled === false
      ? { lastSeenAt: null, status: 'untracked' }
      : await upsertLastLocation({
      companyId,
      employeeId: employee.id,
      officeId: employee.officeId,
      latitude,
      longitude,
      accuracy: req.body.accuracy != null ? Number(req.body.accuracy) : null,
      insideGeofence: inside,
      status
    });

    res.json({
      success: true,
      data: {
        event,
        message: attendanceResult.message,
        autoCheckedIn: Boolean(attendanceResult.autoCheckedIn),
        autoCheckedOut: Boolean(attendanceResult.autoCheckedOut),
        attendance: serializeAttendance(attendanceResult.attendance),
        tracked: {
          insideGeofence: inside,
          distanceMeters: distance != null ? Math.round(distance) : null,
          status,
          lastSeenAt: tracked.lastSeenAt
        }
      }
    });
  } catch (error) {
    console.error('[hr] trackingEvent', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.liveTracking = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;

    const rows = await prisma.hrEmployeeLocation.findMany({
      where: { companyId },
      include: {
        employee: { include: EMPLOYEE_INCLUDE },
        office: { select: { name: true } }
      },
      orderBy: { lastSeenAt: 'desc' }
    });

    const today = workDateKey();
    const attendances = await prisma.hrAttendance.findMany({
      where: {
        companyId,
        workDate: today,
        employeeId: { in: rows.map((r) => r.employeeId) }
      }
    });
    const attMap = new Map(attendances.map((a) => [a.employeeId, a]));
    const onlineMs = 12 * 60 * 1000;

    res.json({
      success: true,
      data: {
        live: rows
          .filter((row) => String(row.status || '').toLowerCase() !== 'offline')
          .filter((row) => row.employee?.trackingEnabled !== false)
          .map((row) => {
          const att = attMap.get(row.employeeId);
          const age = Date.now() - new Date(row.lastSeenAt).getTime();
          const online = age <= onlineMs && String(row.status || '').toLowerCase() !== 'offline';
          return {
            employeeId: row.employeeId,
            employeeCode: row.employee.employeeCode,
            employeeName: fullName(row.employee.user),
            department: row.employee.department,
            designation: row.employee.designation,
            officeName: row.office?.name || row.employee.office?.name || '',
            latitude: row.latitude,
            longitude: row.longitude,
            insideGeofence: row.insideGeofence,
            status: online ? row.status : 'offline',
            lastPingAt: row.lastSeenAt,
            locationLabel: row.insideGeofence
              ? (row.office?.name || 'Office')
              : 'In the field',
            checkIn: att?.checkIn || null,
            attendanceStatus: att ? statusLabel(att.status) : 'Absent'
          };
        }).filter((row) => row.status !== 'offline')
      }
    });
  } catch (error) {
    console.error('[hr] liveTracking', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.attachEmployeeToLoginUser = async function attachEmployeeToLoginUser(userId) {
  if (!userId) return null;
  try {
    const employee = await prisma.hrEmployee.findUnique({
      where: { userId: String(userId) },
      include: EMPLOYEE_INCLUDE
    });
    if (!employee) return null;
    return serializeEmployee(employee);
  } catch (error) {
    console.error('[hr] attachEmployeeToLoginUser', error.message);
    return null;
  }
};
