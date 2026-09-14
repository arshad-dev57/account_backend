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
  canViewSalary,
  attendanceStatusKey
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
    payBasis: (emp.profile && typeof emp.profile === 'object' && emp.profile.payBasis) || 'monthly',
    probationEndDate: emp.profile?.probationEndDate || null,
    confirmationDate: emp.profile?.confirmationDate || null,
    contractEndDate: emp.profile?.contractEndDate || null,
    terminationDate: emp.profile?.terminationDate || null,
    bankName: emp.profile?.bankName || '',
    bankAccount: emp.profile?.bankAccount || '',
    bankBranch: emp.profile?.bankBranch || '',
    emergencyContact: emp.profile?.emergencyContact || '',
    emergencyPhone: emp.profile?.emergencyPhone || '',
    payGrade: emp.profile?.payGrade || '',
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

function gpsAccuracyBuffer(accuracy) {
  const meters = Number(accuracy);
  if (!Number.isFinite(meters) || meters <= 0) return 60;
  return Math.min(120, Math.max(40, meters));
}

function officeDistance(office, latitude, longitude) {
  if (!office || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const lat = Number(office.latitude);
  const lng = Number(office.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return haversineMeters(latitude, longitude, lat, lng);
}

function isInsideOffice(office, distance, accuracy) {
  if (!office || !Number.isFinite(distance)) return false;
  const radius = Number(office.radiusMeters || office.radius || 150) || 150;
  return distance <= radius + gpsAccuracyBuffer(accuracy);
}

async function resolveGeofence({ companyId, employee, latitude, longitude, accuracy }) {
  const empty = { office: null, inside: false, distance: null };
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return empty;

  const offices = await prisma.hrOffice.findMany({
    where: { companyId, isActive: true },
    select: {
      id: true,
      name: true,
      address: true,
      latitude: true,
      longitude: true,
      radiusMeters: true,
      isActive: true
    }
  });
  if (!offices.length) {
    const assigned = employee?.office || null;
    const distance = officeDistance(assigned, latitude, longitude);
    return {
      office: assigned,
      inside: isInsideOffice(assigned, distance, accuracy),
      distance
    };
  }

  const ranked = offices
    .map((office) => ({ office, distance: officeDistance(office, latitude, longitude) }))
    .filter((row) => Number.isFinite(row.distance))
    .sort((a, b) => a.distance - b.distance);

  if (!ranked.length) return empty;

  const assignedId = employee?.officeId || employee?.office?.id;
  const assignedHit = ranked.find((row) => row.office.id === assignedId && isInsideOffice(row.office, row.distance, accuracy));
  const anyHit = ranked.find((row) => isInsideOffice(row.office, row.distance, accuracy));
  const chosen = assignedHit || anyHit || ranked[0];

  return {
    office: chosen.office,
    inside: isInsideOffice(chosen.office, chosen.distance, accuracy),
    distance: chosen.distance
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
    // Employees need lat/lng/radius so the phone can match the office zone.

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
      password,
      payBasis
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
          phone: String(phone || '').trim(),
          profile: {
            payBasis: ['monthly', 'hourly', 'daily'].includes(String(payBasis || '').toLowerCase())
              ? String(payBasis).toLowerCase()
              : 'monthly'
          }
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
      status,
      payBasis,
      // Enterprise profile fields
      probationEndDate,
      confirmationDate,
      contractEndDate,
      terminationDate,
      bankName,
      bankAccount,
      bankBranch,
      emergencyContact,
      emergencyPhone,
      payGrade,
    } = req.body;

    const names = rawFirst
      ? { firstName: rawFirst, lastName: rawLast || rawFirst }
      : name ? splitName(name) : null;

    const nextStatus = status != null ? statusKey(status) : existing.status;

    // Build merged profile object (always carry forward existing values)
    const existingProfile = existing.profile && typeof existing.profile === 'object' ? existing.profile : {};
    const profileUpdates = {};
    if (payBasis != null) {
      profileUpdates.payBasis = ['monthly', 'hourly', 'daily'].includes(String(payBasis).toLowerCase())
        ? String(payBasis).toLowerCase() : 'monthly';
    }
    const profileDateFields = { probationEndDate, confirmationDate, contractEndDate, terminationDate };
    const profileStrFields = { bankName, bankAccount, bankBranch, emergencyContact, emergencyPhone, payGrade };
    Object.entries(profileDateFields).forEach(([k, v]) => {
      if (v !== undefined) profileUpdates[k] = v ? String(v).slice(0, 10) : null;
    });
    Object.entries(profileStrFields).forEach(([k, v]) => {
      if (v !== undefined) profileUpdates[k] = v ? String(v).trim() : null;
    });
    const hasProfileUpdate = Object.keys(profileUpdates).length > 0;

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
          phone: phone != null ? String(phone).trim() : undefined,
          ...(hasProfileUpdate ? { profile: { ...existingProfile, ...profileUpdates } } : {})
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

/** Soft-delete: deactivate login + mark employee inactive (keeps attendance/payroll history). */
exports.deleteEmployee = async (req, res) => {
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

    const employee = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.userId },
        data: { isActive: false }
      });
      return tx.hrEmployee.update({
        where: { id: existing.id },
        data: { status: 'inactive', trackingEnabled: false },
        include: EMPLOYEE_INCLUDE
      });
    });

    res.json({
      success: true,
      message: 'Employee deactivated. Login disabled; history kept.',
      data: serializeEmployee(employee)
    });
  } catch (error) {
    console.error('[hr] deleteEmployee', error);
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

/**
 * HR manual attendance create/update for a given employee + date.
 * Body: { employeeId, date, status, checkIn?, checkOut? }
 * Times may be ISO or "HH:mm" (applied on work date Asia/Karachi).
 */
exports.upsertAttendance = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;

    const employeeId = String(req.body.employeeId || '').trim();
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'employeeId is required' });
    }

    const employee = await prisma.hrEmployee.findFirst({
      where: { id: employeeId, companyId },
      include: EMPLOYEE_INCLUDE
    });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const workDate = req.body.date ? workDateKey(new Date(req.body.date)) : workDateKey();
    const status = attendanceStatusKey(req.body.status || 'present');

    const combineTime = (value) => {
      if (value == null || value === '') return null;
      const raw = String(value).trim();
      if (/^\d{1,2}:\d{2}/.test(raw)) {
        const ymd = workDate.toISOString().slice(0, 10);
        return new Date(`${ymd}T${raw.length === 5 ? `${raw}:00` : raw}.000Z`);
      }
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    let checkIn = combineTime(req.body.checkIn);
    let checkOut = combineTime(req.body.checkOut);

    if (status === 'absent' || status === 'weekly_off' || status === 'holiday') {
      checkIn = null;
      checkOut = null;
    }

    let workingMinutes = 0;
    if (checkIn && checkOut) {
      workingMinutes = Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60000));
    }

    const row = await prisma.hrAttendance.upsert({
      where: {
        employeeId_workDate: { employeeId, workDate }
      },
      create: {
        companyId,
        employeeId,
        workDate,
        checkIn,
        checkOut,
        status,
        source: 'hr_manual',
        workingMinutes
      },
      update: {
        checkIn,
        checkOut,
        status,
        source: 'hr_manual',
        workingMinutes
      },
      include: { employee: { include: EMPLOYEE_INCLUDE } }
    });

    res.json({
      success: true,
      message: 'Attendance updated',
      data: {
        ...serializeAttendance(row),
        employee: serializeEmployee(row.employee)
      }
    });
  } catch (error) {
    console.error('[hr] upsertAttendance', error);
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
  const geo = await resolveGeofence({
    companyId,
    employee,
    latitude,
    longitude,
    accuracy
  });
  const office = geo.office;
  const inside = geo.inside;
  const distance = geo.distance;

  if (action === 'check_in' && Number.isFinite(distance) && !inside) {
    const officeName = office?.name || 'the office zone';
    const radius = office?.radiusMeters || 150;
    return res.status(400).json({
      success: false,
      message: `You are ${Math.round(distance)}m from ${officeName} (${radius}m zone). Indoor GPS can drift — move closer to the office pin, or increase the office radius on web.`
    });
  }

  if (action === 'check_in' && !office) {
    return res.status(400).json({
      success: false,
      message: 'No office zone found. Create an office on HR → Offices and drop the map pin on the building.'
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
      officeId: office?.id || employee.officeId,
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

    const geo = await resolveGeofence({
      companyId,
      employee,
      latitude,
      longitude,
      accuracy: req.body.accuracy
    });
    const office = geo.office;
    const distance = geo.distance;
    const inside = geo.inside;

    let attendanceResult = { attendance: null, message: 'Location updated' };
    const todayRow = await prisma.hrAttendance.findUnique({
      where: {
        employeeId_workDate: { employeeId: employee.id, workDate: workDateKey() }
      }
    });
    const alreadyIn = Boolean(todayRow?.checkIn) && !todayRow?.checkOut;

    if (inside && event !== 'exit' && !alreadyIn) {
      attendanceResult = await markAttendance({
        companyId,
        employeeId: employee.id,
        latitude,
        longitude,
        action: 'check_in',
        source: 'geofence'
      });
    } else if (event === 'exit' && alreadyIn && !inside) {
      attendanceResult = await markAttendance({
        companyId,
        employeeId: employee.id,
        latitude,
        longitude,
        action: 'check_out',
        source: 'geofence'
      });
    } else {
      attendanceResult.attendance = todayRow;
      if (!office) {
        attendanceResult.message = 'No office zone found. Create an office on web and set the map pin.';
      } else if (inside) {
        attendanceResult.message = alreadyIn
          ? `Inside ${office.name}`
          : `Inside ${office.name} — checking in`;
      } else {
        attendanceResult.message = `Outside ${office.name} — ${Math.round(distance || 0)}m away (${office.radiusMeters || 150}m zone)`;
      }
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
      officeId: office?.id || employee.officeId,
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
          officeName: office?.name || null,
          officeRadius: office?.radiusMeters || null,
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
        office: { select: { name: true, latitude: true, longitude: true, radiusMeters: true } }
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
          const office = row.office || row.employee.office;
          const officeLat = office ? Number(office.latitude) : null;
          const officeLng = office ? Number(office.longitude) : null;
          const officeRadius = office ? Number(office.radiusMeters || 150) : null;
          const pingLat = Number(row.latitude);
          const pingLng = Number(row.longitude);
          const distanceMeters =
            Number.isFinite(pingLat) &&
            Number.isFinite(pingLng) &&
            Number.isFinite(officeLat) &&
            Number.isFinite(officeLng)
              ? Math.round(haversineMeters(pingLat, pingLng, officeLat, officeLng))
              : null;
          const gpsSuspect = Number.isFinite(distanceMeters) && distanceMeters > 200000;
          return {
            employeeId: row.employeeId,
            employeeCode: row.employee.employeeCode,
            employeeName: fullName(row.employee.user),
            department: row.employee.department,
            designation: row.employee.designation,
            officeName: office?.name || '',
            officeLatitude: officeLat,
            officeLongitude: officeLng,
            officeRadius,
            latitude: pingLat,
            longitude: pingLng,
            distanceMeters,
            gpsSuspect,
            insideGeofence: row.insideGeofence,
            status: online ? row.status : 'offline',
            lastPingAt: row.lastSeenAt,
            locationLabel: gpsSuspect
              ? `GPS ${Math.round(distanceMeters / 1000)}km from ${office?.name || 'office'} (likely simulator)`
              : row.insideGeofence
                ? (office?.name || 'Office')
                : distanceMeters != null
                  ? `${distanceMeters}m from ${office?.name || 'office'}`
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
