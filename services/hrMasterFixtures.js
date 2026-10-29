'use strict';

/**
 * ERPNext / Frappe HRMS default masters.
 *
 * Departments are created when a Company is saved
 * (erpnext/setup/doctype/company/company.py → create_default_departments).
 * Designations and Employment Types come from setup fixtures
 * (erpnext setup wizard designation.txt + hrms/setup.py).
 *
 * Idempotent: missing names are inserted; existing rows are left alone so
 * tenants can rename or add more after the defaults land.
 */

const prisma = require('../prisma/client');

const ROOT_DEPARTMENT = 'All Departments';

const CHILD_DEPARTMENTS = [
  'Accounts',
  'Marketing',
  'Sales',
  'Purchase',
  'Operations',
  'Production',
  'Dispatch',
  'Customer Service',
  'Human Resources',
  'Management',
  'Quality Management',
  'Research & Development',
  'Legal'
];

const DEFAULT_DESIGNATIONS = [
  'Accountant',
  'Administrative Assistant',
  'Administrative Officer',
  'Analyst',
  'Associate',
  'Business Analyst',
  'Business Development Manager',
  'Consultant',
  'Chief Executive Officer',
  'Chief Financial Officer',
  'Chief Operating Officer',
  'Chief Technology Officer',
  'Customer Service Representative',
  'Designer',
  'Engineer',
  'Executive Assistant',
  'Finance Manager',
  'HR Manager',
  'Head of Marketing and Sales',
  'Manager',
  'Managing Director',
  'Marketing Manager',
  'Marketing Specialist',
  'President',
  'Product Manager',
  'Project Manager',
  'Researcher',
  'Sales Representative',
  'Secretary',
  'Software Developer',
  'Vice President'
];

const DEFAULT_EMPLOYMENT_TYPES = [
  'Full-time',
  'Part-time',
  'Probation',
  'Contract',
  'Commission',
  'Piecework',
  'Intern',
  'Apprentice'
];

const DEFAULT_GENDERS = ['Male', 'Female', 'Other'];

const DEFAULT_SALUTATIONS = ['Mr', 'Ms', 'Mrs', 'Dr', 'Mx'];

// ERPNext Projects setup defaults (docs.frappe.io/erpnext/activity-type).
const DEFAULT_ACTIVITY_TYPES = [
  'Planning',
  'Research',
  'Proposal Writing',
  'Execution',
  'Communication'
];

async function ensureDepartments(companyId) {
  let root = await prisma.hrDepartment.findFirst({
    where: { companyId, name: ROOT_DEPARTMENT }
  });
  if (!root) {
    root = await prisma.hrDepartment.create({
      data: { companyId, name: ROOT_DEPARTMENT, isGroup: true, parentId: null }
    });
  } else if (!root.isGroup) {
    root = await prisma.hrDepartment.update({
      where: { id: root.id },
      data: { isGroup: true }
    });
  }

  const existing = await prisma.hrDepartment.findMany({
    where: { companyId },
    select: { id: true, name: true, parentId: true }
  });
  const byName = new Map(existing.map((row) => [row.name, row]));

  for (const name of CHILD_DEPARTMENTS) {
    const row = byName.get(name);
    if (!row) {
      await prisma.hrDepartment.create({
        data: { companyId, name, parentId: root.id, isGroup: false }
      });
      continue;
    }
    if (!row.parentId) {
      await prisma.hrDepartment.update({
        where: { id: row.id },
        data: { parentId: root.id }
      });
    }
  }

  return { root: ROOT_DEPARTMENT, children: CHILD_DEPARTMENTS.length };
}

async function ensureNamedRows(model, companyId, names, field = 'name', extra = {}) {
  const client = prisma[model];
  if (!client) return 0;
  const existing = await client.findMany({
    where: { companyId },
    select: { [field]: true }
  });
  const have = new Set(existing.map((row) => String(row[field] || '')));
  let created = 0;
  for (const name of names) {
    if (have.has(name)) continue;
    await client.create({ data: { companyId, [field]: name, ...extra } });
    created += 1;
  }
  return created;
}

/**
 * Seed ERPNext HR masters for a company. Safe to call repeatedly.
 */
async function ensureHrMasterFixtures(companyId) {
  if (!companyId) return { skipped: true };
  const departments = await ensureDepartments(companyId);
  const designations = await ensureNamedRows('hrDesignation', companyId, DEFAULT_DESIGNATIONS);
  const employmentTypes = await ensureNamedRows('hrEmploymentType', companyId, DEFAULT_EMPLOYMENT_TYPES);
  const genders = await ensureNamedRows('hrGender', companyId, DEFAULT_GENDERS, 'gender');
  const salutations = await ensureNamedRows('hrSalutation', companyId, DEFAULT_SALUTATIONS, 'salutation');
  const activityTypes = await ensureNamedRows(
    'hrActivityType',
    companyId,
    DEFAULT_ACTIVITY_TYPES,
    'activityType'
  );
  return { departments, designations, employmentTypes, genders, salutations, activityTypes };
}

const FIXTURE_RESOURCES = new Set([
  'department',
  'designation',
  'employment-type',
  'gender',
  'salutation',
  'activity-type'
]);

function resourceNeedsFixtures(resource) {
  return FIXTURE_RESOURCES.has(resource);
}

module.exports = {
  ROOT_DEPARTMENT,
  CHILD_DEPARTMENTS,
  DEFAULT_DESIGNATIONS,
  DEFAULT_EMPLOYMENT_TYPES,
  DEFAULT_GENDERS,
  DEFAULT_SALUTATIONS,
  DEFAULT_ACTIVITY_TYPES,
  ensureHrMasterFixtures,
  resourceNeedsFixtures
};
