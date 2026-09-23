'use strict';

const prisma = require('../prisma/client');
const { requireCompany, canManageHr } = require('../utils/hrAccess');
const { writeAudit } = require('../utils/hrAudit');

function wrap(fn) {
  return async (req, res) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      await fn(req, res, companyId);
    } catch (error) {
      console.error('[hr-template-controller]', error);
      res.status(500).json({ success: false, message: error.message || 'Internal Server Error' });
    }
  };
}

/**
 * List HR document templates by type/status
 */
exports.listTemplates = wrap(async (req, res, companyId) => {
  const { templateType, status } = req.query;
  const where = { companyId };

  if (templateType) where.templateType = templateType;
  if (status) where.status = status;

  let rows = await prisma.hrDocumentTemplate.findMany({
    where,
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }]
  });

  // If empty for this tenant, seed default system templates
  if (rows.length === 0 && !templateType) {
    await seedDefaultTemplates(companyId);
    rows = await prisma.hrDocumentTemplate.findMany({
      where: { companyId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }]
    });
  }

  res.json({ success: true, data: rows });
});

/**
 * Get single template by ID
 */
exports.getTemplate = wrap(async (req, res, companyId) => {
  const { id } = req.params;
  const tpl = await prisma.hrDocumentTemplate.findFirst({
    where: { id, companyId },
    include: { versions: { orderBy: { versionNumber: 'desc' } } }
  });

  if (!tpl) {
    return res.status(404).json({ success: false, message: 'Template not found' });
  }

  res.json({ success: true, data: tpl });
});

/**
 * Create a new document template
 */
exports.createTemplate = wrap(async (req, res, companyId) => {
  if (!canManageHr(req)) {
    return res.status(403).json({ success: false, message: 'HR manager permission required' });
  }

  const body = req.body || {};
  if (!body.name || !body.templateType) {
    return res.status(400).json({ success: false, message: 'Template name and type are required' });
  }

  const tpl = await prisma.hrDocumentTemplate.create({
    data: {
      companyId,
      templateType: String(body.templateType),
      name: String(body.name),
      description: String(body.description || ''),
      contentBody: String(body.contentBody || ''),
      headerHtml: String(body.headerHtml || ''),
      footerHtml: String(body.footerHtml || ''),
      isDefault: Boolean(body.isDefault || false),
      version: 1,
      status: 'Published'
    }
  });

  // Create Version 1 snapshot
  await prisma.hrDocumentTemplateVersion.create({
    data: {
      templateId: tpl.id,
      versionNumber: 1,
      contentBody: tpl.contentBody,
      headerHtml: tpl.headerHtml,
      footerHtml: tpl.footerHtml,
      createdBy: req.user?.firstName || 'HR Manager',
      changeSummary: 'Initial version created'
    }
  });

  await writeAudit(companyId, req.user.id, 'create', 'hr_template', tpl.id, `Created template ${tpl.name}`);
  res.json({ success: true, data: tpl });
});

/**
 * Update draft / template
 */
exports.updateTemplate = wrap(async (req, res, companyId) => {
  if (!canManageHr(req)) {
    return res.status(403).json({ success: false, message: 'HR manager permission required' });
  }

  const { id } = req.params;
  const body = req.body || {};

  const existing = await prisma.hrDocumentTemplate.findFirst({ where: { id, companyId } });
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Template not found' });
  }

  // If marked as default, unmark other defaults for this templateType
  if (body.isDefault) {
    await prisma.hrDocumentTemplate.updateMany({
      where: { companyId, templateType: existing.templateType, id: { not: id } },
      data: { isDefault: false }
    });
  }

  const updated = await prisma.hrDocumentTemplate.update({
    where: { id },
    data: {
      name: body.name !== undefined ? String(body.name) : undefined,
      description: body.description !== undefined ? String(body.description) : undefined,
      contentBody: body.contentBody !== undefined ? String(body.contentBody) : undefined,
      headerHtml: body.headerHtml !== undefined ? String(body.headerHtml) : undefined,
      footerHtml: body.footerHtml !== undefined ? String(body.footerHtml) : undefined,
      isDefault: body.isDefault !== undefined ? Boolean(body.isDefault) : undefined,
      status: body.status !== undefined ? String(body.status) : undefined
    }
  });

  await writeAudit(companyId, req.user.id, 'update', 'hr_template', id, `Updated template ${updated.name}`);
  res.json({ success: true, data: updated });
});

/**
 * Publish template as new version (increments version counter and stores snapshot)
 */
exports.publishTemplate = wrap(async (req, res, companyId) => {
  if (!canManageHr(req)) {
    return res.status(403).json({ success: false, message: 'HR manager permission required' });
  }

  const { id } = req.params;
  const body = req.body || {};

  const existing = await prisma.hrDocumentTemplate.findFirst({ where: { id, companyId } });
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Template not found' });
  }

  const nextVersion = existing.version + 1;

  const updated = await prisma.hrDocumentTemplate.update({
    where: { id },
    data: {
      version: nextVersion,
      status: 'Published',
      contentBody: body.contentBody !== undefined ? String(body.contentBody) : existing.contentBody,
      headerHtml: body.headerHtml !== undefined ? String(body.headerHtml) : existing.headerHtml,
      footerHtml: body.footerHtml !== undefined ? String(body.footerHtml) : existing.footerHtml
    }
  });

  await prisma.hrDocumentTemplateVersion.create({
    data: {
      templateId: id,
      versionNumber: nextVersion,
      contentBody: updated.contentBody,
      headerHtml: updated.headerHtml,
      footerHtml: updated.footerHtml,
      createdBy: req.user?.firstName || 'HR Manager',
      changeSummary: String(body.changeSummary || `Published version ${nextVersion}`)
    }
  });

  await writeAudit(companyId, req.user.id, 'publish', 'hr_template', id, `Published version ${nextVersion} of ${updated.name}`);
  res.json({ success: true, data: updated });
});

/**
 * Duplicate an existing template
 */
exports.duplicateTemplate = wrap(async (req, res, companyId) => {
  if (!canManageHr(req)) {
    return res.status(403).json({ success: false, message: 'HR manager permission required' });
  }

  const { id } = req.params;
  const existing = await prisma.hrDocumentTemplate.findFirst({ where: { id, companyId } });
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Original template not found' });
  }

  const dup = await prisma.hrDocumentTemplate.create({
    data: {
      companyId,
      templateType: existing.templateType,
      name: `${existing.name} (Copy)`,
      description: existing.description,
      contentBody: existing.contentBody,
      headerHtml: existing.headerHtml,
      footerHtml: existing.footerHtml,
      isDefault: false,
      version: 1,
      status: 'Draft'
    }
  });

  await prisma.hrDocumentTemplateVersion.create({
    data: {
      templateId: dup.id,
      versionNumber: 1,
      contentBody: dup.contentBody,
      headerHtml: dup.headerHtml,
      footerHtml: dup.footerHtml,
      createdBy: req.user?.firstName || 'HR Manager',
      changeSummary: `Duplicated from ${existing.name}`
    }
  });

  await writeAudit(companyId, req.user.id, 'duplicate', 'hr_template', dup.id, `Duplicated ${existing.name}`);
  res.json({ success: true, data: dup });
});

/**
 * Seed default HR templates if company has none
 */
async function seedDefaultTemplates(companyId) {
  const defaults = [
    {
      templateType: 'AppointmentLetter',
      name: 'Standard Appointment Letter',
      description: 'Official employment appointment contract for new joiners',
      isDefault: true,
      contentBody: `Dear {{employee.name}},

We are pleased to appoint you as {{employee.designation}} in the {{employee.department}} department at Bisonstechs ERP, effective from {{employee.joiningDate}}.

Your monthly gross remuneration will be {{employee.salary}} PKR subject to statutory deductions.

Please sign below to accept this appointment.

Sincerely,
HR Department`
    },
    {
      templateType: 'SalaryCertificate',
      name: 'Standard Salary Certificate',
      description: 'Official income proof and salary verification document',
      isDefault: true,
      contentBody: `TO WHOM IT MAY CONCERN

This is to certify that {{employee.name}} (Employee Code: {{employee.code}}) is employed with us as {{employee.designation}} since {{employee.joiningDate}}.

Their current gross monthly salary is {{employee.salary}} PKR.

This certificate is issued upon employee request for verification purposes.

Authorized Signatory`
    },
    {
      templateType: 'ExperienceLetter',
      name: 'Experience & Service Certificate',
      description: 'Relieving and experience verification certificate',
      isDefault: true,
      contentBody: `TO WHOM IT MAY CONCERN

This is to certify that {{employee.name}} was employed with Bisonstechs ERP as {{employee.designation}} from {{employee.joiningDate}} to {{employee.exitDate}}.

During their tenure, we found them dedicated and professional. We wish them success in future endeavors.

HR Department`
    }
  ];

  for (const item of defaults) {
    const tpl = await prisma.hrDocumentTemplate.create({
      data: {
        companyId,
        templateType: item.templateType,
        name: item.name,
        description: item.description,
        contentBody: item.contentBody,
        isDefault: item.isDefault,
        version: 1,
        status: 'Published'
      }
    });

    await prisma.hrDocumentTemplateVersion.create({
      data: {
        templateId: tpl.id,
        versionNumber: 1,
        contentBody: item.contentBody,
        createdBy: 'System Seed'
      }
    });
  }
}
