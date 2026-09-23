'use strict';

const prisma = require('../prisma/client');
const { requireCompany, canManageHr } = require('../utils/hrAccess');
const { writeAudit } = require('../utils/hrAudit');

function fullName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'Employee';
}

function ymd(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function wrap(fn) {
  return async (req, res) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      await fn(req, res, companyId);
    } catch (error) {
      console.error('[hr-document-generator]', error);
      res.status(500).json({ success: false, message: error.message || 'Internal Server Error' });
    }
  };
}

/**
 * Generate historical document snapshot for an employee
 */
exports.generateDocument = wrap(async (req, res, companyId) => {
  if (!canManageHr(req)) {
    return res.status(403).json({ success: false, message: 'HR manager permission required' });
  }

  const { employeeId, templateId, documentType, customTitle, notes } = req.body || {};

  if (!employeeId) {
    return res.status(400).json({ success: false, message: 'Employee ID is required' });
  }

  // Fetch employee details
  const employee = await prisma.hrEmployee.findFirst({
    where: { id: employeeId, companyId },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, phone: true } },
      office: { select: { name: true } },
      costCenterRef: { select: { name: true, code: true } }
    }
  });

  if (!employee) {
    return res.status(404).json({ success: false, message: 'Employee not found' });
  }

  // Fetch HR print settings & signatories
  let printSetting = await prisma.hrPrintSetting.findUnique({
    where: { companyId },
    include: { signatories: { where: { isActive: true }, orderBy: { displayOrder: 'asc' } } }
  });

  if (!printSetting) {
    printSetting = await prisma.hrPrintSetting.create({
      data: { companyId },
      include: { signatories: true }
    });
  }

  // Fetch template (if templateId provided or search default for documentType)
  let template = null;
  if (templateId) {
    template = await prisma.hrDocumentTemplate.findFirst({ where: { id: templateId, companyId } });
  } else if (documentType) {
    template = await prisma.hrDocumentTemplate.findFirst({
      where: { companyId, templateType: documentType, isDefault: true }
    });
    if (!template) {
      template = await prisma.hrDocumentTemplate.findFirst({
        where: { companyId, templateType: documentType }
      });
    }
  }

  // Calculate next document number
  const typeKey = (documentType || template?.templateType || 'AppointmentLetter').toLowerCase();
  let prefix = 'HR-';
  let seqKey = 'appointmentSeq';

  if (typeKey.includes('appointment')) {
    prefix = printSetting.appointmentPrefix || 'APT-';
    seqKey = 'appointmentSeq';
  } else if (typeKey.includes('offer')) {
    prefix = printSetting.offerPrefix || 'OFR-';
    seqKey = 'offerSeq';
  } else if (typeKey.includes('salary')) {
    prefix = printSetting.salaryCertPrefix || 'SAL-';
    seqKey = 'salaryCertSeq';
  } else if (typeKey.includes('experience')) {
    prefix = printSetting.experiencePrefix || 'EXP-';
    seqKey = 'experienceSeq';
  }

  const year = new Date().getFullYear();
  const currentSeq = printSetting[seqKey] || 1001;
  const documentNumber = `${prefix}${year}-${String(currentSeq).padStart(5, '0')}`;

  // Increment sequence
  await prisma.hrPrintSetting.update({
    where: { companyId },
    data: { [seqKey]: currentSeq + 1 }
  });

  const empName = fullName(employee.user);
  const title = customTitle || `${template?.name || documentType || 'HR Document'} - ${empName}`;

  // Freeze full data snapshot
  const snapshotDataJson = {
    generatedAt: new Date().toISOString(),
    generatedBy: fullName(req.user),
    documentNumber,
    documentType: documentType || template?.templateType || 'Custom',
    title,
    employee: {
      id: employee.id,
      code: employee.employeeCode,
      name: empName,
      email: employee.user?.email || '',
      phone: employee.user?.phone || '',
      designation: employee.designation || 'Staff',
      department: employee.department || 'General',
      office: employee.office?.name || '',
      costCenter: employee.costCenterRef?.name || '',
      joiningDate: ymd(employee.joiningDate),
      salary: employee.salary != null ? Number(employee.salary) : 0,
      currency: employee.currency || 'PKR'
    },
    branding: {
      companyName: printSetting.companyName || 'Bisonstechs ERP',
      companyAddress: printSetting.companyAddress || '',
      companyPhone: printSetting.companyPhone || '',
      companyEmail: printSetting.companyEmail || '',
      companyWebsite: printSetting.companyWebsite || '',
      registrationNo: printSetting.registrationNo || '',
      primaryLogo: printSetting.primaryLogo || '',
      secondaryLogo: printSetting.secondaryLogo || '',
      officialStamp: printSetting.officialStamp || '',
      primaryColor: printSetting.primaryColor || '#014582',
      fontFamily: printSetting.fontFamily || 'Inter',
      headerSubtitle: printSetting.headerSubtitle || '',
      footerText: printSetting.footerText || ''
    },
    template: {
      id: template?.id || null,
      name: template?.name || 'Standard HR Template',
      version: template?.version || 1,
      contentBody: template?.contentBody || '',
      headerHtml: template?.headerHtml || '',
      footerHtml: template?.footerHtml || ''
    },
    signatories: printSetting.signatories || []
  };

  // Create Generated Document Snapshot
  const generatedDoc = await prisma.hrGeneratedDocument.create({
    data: {
      companyId,
      employeeId: employee.id,
      templateId: template?.id || null,
      templateVersionNumber: template?.version || 1,
      documentType: documentType || template?.templateType || 'Custom',
      documentNumber,
      title,
      snapshotDataJson,
      status: 'Generated',
      generatedBy: fullName(req.user)
    }
  });

  // Also attach to central Employee Documents repository (`HrDocument`) so it appears in dossier
  await prisma.hrDocument.create({
    data: {
      companyId,
      employeeId: employee.id,
      title,
      category: 'Employment',
      reference: documentNumber,
      fileUrl: `/hr/documents/generated/${generatedDoc.id}`,
      documentNumber,
      issuingAuthority: printSetting.companyName || 'HR Department',
      status: 'Verified',
      notes: notes || `Generated via HR Document System (Ref: ${documentNumber})`,
      verifiedBy: fullName(req.user),
      verifiedAt: new Date(),
      version: 1
    }
  });

  await writeAudit(companyId, req.user.id, 'generate', 'hr_generated_document', generatedDoc.id, `Generated ${title} (${documentNumber})`);

  res.json({
    success: true,
    data: generatedDoc
  });
});

/**
 * Get generated document snapshot
 */
exports.getGeneratedDocument = wrap(async (req, res, companyId) => {
  const { id } = req.params;
  const doc = await prisma.hrGeneratedDocument.findFirst({
    where: { id, companyId }
  });

  if (!doc) {
    return res.status(404).json({ success: false, message: 'Generated document snapshot not found' });
  }

  res.json({ success: true, data: doc });
});
