'use strict';

const prisma = require('../prisma/client');
const { requireCompany, requireHrManager, canManageHr } = require('../utils/hrAccess');
const { writeAudit } = require('../utils/hrAudit');
const { cloudinary } = require('../config/hrAssetUpload');

function wrap(fn) {
  return async (req, res) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      await fn(req, res, companyId);
    } catch (error) {
      console.error('[hr-print-setting]', error);
      res.status(500).json({ success: false, message: error.message || 'Internal Server Error' });
    }
  };
}

/**
 * Get or initialize HR print settings & signatories for active tenant company
 */
exports.getPrintSettings = wrap(async (req, res, companyId) => {
  let setting = await prisma.hrPrintSetting.findUnique({
    where: { companyId },
    include: {
      signatories: {
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }]
      }
    }
  });

  if (!setting) {
    // Fetch company info for defaults
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    setting = await prisma.hrPrintSetting.create({
      data: {
        companyId,
        companyName: company?.name || 'Company Name',
        companyAddress: company?.address || '',
        companyPhone: company?.phone || '',
        companyEmail: company?.email || '',
        companyWebsite: company?.website || '',
        taxRegistrationNumber: company?.taxRegistrationNumber || ''
      },
      include: { signatories: true }
    });

    // Create 3 default signatories
    await prisma.hrSignatory.createMany({
      data: [
        { settingId: setting.id, companyId, label: 'Prepared By', name: 'HR Officer', designation: 'HR Assistant', alignment: 'left', displayOrder: 1 },
        { settingId: setting.id, companyId, label: 'Reviewed By', name: 'HR Manager', designation: 'Head of HR', alignment: 'center', displayOrder: 2 },
        { settingId: setting.id, companyId, label: 'Approved By', name: 'Director', designation: 'Managing Director', alignment: 'right', displayOrder: 3 }
      ]
    });

    setting = await prisma.hrPrintSetting.findUnique({
      where: { companyId },
      include: { signatories: { orderBy: { displayOrder: 'asc' } } }
    });
  }

  res.json({ success: true, data: setting });
});

/**
 * Update HR print settings, page setup, colors, margins, and payslip settings
 */
exports.updatePrintSettings = wrap(async (req, res, companyId) => {
  if (!canManageHr(req)) {
    return res.status(403).json({ success: false, message: 'HR manager permission required' });
  }

  const body = req.body || {};

  const updated = await prisma.hrPrintSetting.upsert({
    where: { companyId },
    create: {
      companyId,
      companyName: String(body.companyName || ''),
      companyAddress: String(body.companyAddress || ''),
      companyPhone: String(body.companyPhone || ''),
      companyEmail: String(body.companyEmail || ''),
      companyWebsite: String(body.companyWebsite || ''),
      registrationNo: String(body.registrationNo || ''),
      paperSize: String(body.paperSize || 'A4'),
      orientation: String(body.orientation || 'portrait'),
      marginTop: Number(body.marginTop ?? 15),
      marginBottom: Number(body.marginBottom ?? 15),
      marginLeft: Number(body.marginLeft ?? 15),
      marginRight: Number(body.marginRight ?? 15),
      fontFamily: String(body.fontFamily || 'Inter'),
      primaryColor: String(body.primaryColor || '#014582'),
      headerSubtitle: String(body.headerSubtitle || ''),
      footerText: String(body.footerText || ''),
      showLogo: Boolean(body.showLogo ?? true),
      showStamp: Boolean(body.showStamp ?? true),
      showPageNumbers: Boolean(body.showPageNumbers ?? true),
      showFooter: Boolean(body.showFooter ?? true),
      payslipTitle: String(body.payslipTitle || 'PAYSLIP STATEMENT'),
      showEarningsBreakdown: Boolean(body.showEarningsBreakdown ?? true),
      showDeductionsBreakdown: Boolean(body.showDeductionsBreakdown ?? true),
      showAttendanceSummary: Boolean(body.showAttendanceSummary ?? true),
      showYtdTotals: Boolean(body.showYtdTotals ?? false),
      payslipNotes: String(body.payslipNotes || ''),
      offerPrefix: String(body.offerPrefix || 'OFR-'),
      appointmentPrefix: String(body.appointmentPrefix || 'APT-'),
      salaryCertPrefix: String(body.salaryCertPrefix || 'SAL-'),
      experiencePrefix: String(body.experiencePrefix || 'EXP-')
    },
    update: {
      companyName: body.companyName !== undefined ? String(body.companyName) : undefined,
      companyAddress: body.companyAddress !== undefined ? String(body.companyAddress) : undefined,
      companyPhone: body.companyPhone !== undefined ? String(body.companyPhone) : undefined,
      companyEmail: body.companyEmail !== undefined ? String(body.companyEmail) : undefined,
      companyWebsite: body.companyWebsite !== undefined ? String(body.companyWebsite) : undefined,
      registrationNo: body.registrationNo !== undefined ? String(body.registrationNo) : undefined,
      paperSize: body.paperSize !== undefined ? String(body.paperSize) : undefined,
      orientation: body.orientation !== undefined ? String(body.orientation) : undefined,
      marginTop: body.marginTop !== undefined ? Number(body.marginTop) : undefined,
      marginBottom: body.marginBottom !== undefined ? Number(body.marginBottom) : undefined,
      marginLeft: body.marginLeft !== undefined ? Number(body.marginLeft) : undefined,
      marginRight: body.marginRight !== undefined ? Number(body.marginRight) : undefined,
      fontFamily: body.fontFamily !== undefined ? String(body.fontFamily) : undefined,
      primaryColor: body.primaryColor !== undefined ? String(body.primaryColor) : undefined,
      headerSubtitle: body.headerSubtitle !== undefined ? String(body.headerSubtitle) : undefined,
      footerText: body.footerText !== undefined ? String(body.footerText) : undefined,
      showLogo: body.showLogo !== undefined ? Boolean(body.showLogo) : undefined,
      showStamp: body.showStamp !== undefined ? Boolean(body.showStamp) : undefined,
      showPageNumbers: body.showPageNumbers !== undefined ? Boolean(body.showPageNumbers) : undefined,
      showFooter: body.showFooter !== undefined ? Boolean(body.showFooter) : undefined,
      payslipTitle: body.payslipTitle !== undefined ? String(body.payslipTitle) : undefined,
      showEarningsBreakdown: body.showEarningsBreakdown !== undefined ? Boolean(body.showEarningsBreakdown) : undefined,
      showDeductionsBreakdown: body.showDeductionsBreakdown !== undefined ? Boolean(body.showDeductionsBreakdown) : undefined,
      showAttendanceSummary: body.showAttendanceSummary !== undefined ? Boolean(body.showAttendanceSummary) : undefined,
      showYtdTotals: body.showYtdTotals !== undefined ? Boolean(body.showYtdTotals) : undefined,
      payslipNotes: body.payslipNotes !== undefined ? String(body.payslipNotes) : undefined,
      offerPrefix: body.offerPrefix !== undefined ? String(body.offerPrefix) : undefined,
      appointmentPrefix: body.appointmentPrefix !== undefined ? String(body.appointmentPrefix) : undefined,
      salaryCertPrefix: body.salaryCertPrefix !== undefined ? String(body.salaryCertPrefix) : undefined,
      experiencePrefix: body.experiencePrefix !== undefined ? String(body.experiencePrefix) : undefined
    },
    include: { signatories: { orderBy: { displayOrder: 'asc' } } }
  });

  await writeAudit(companyId, req.user.id, 'update', 'hr_print_setting', updated.id, 'Updated HR print settings');
  res.json({ success: true, data: updated });
});

/**
 * Handle multipart upload for HR Branding assets (primaryLogo, secondaryLogo, officialStamp)
 */
exports.uploadBrandingAssets = wrap(async (req, res, companyId) => {
  if (!canManageHr(req)) {
    return res.status(403).json({ success: false, message: 'HR manager permission required' });
  }

  const files = req.files || {};
  const updateData = {};

  if (files.primaryLogo && files.primaryLogo[0]) {
    updateData.primaryLogo = files.primaryLogo[0].path || files.primaryLogo[0].secure_url;
  }
  if (files.secondaryLogo && files.secondaryLogo[0]) {
    updateData.secondaryLogo = files.secondaryLogo[0].path || files.secondaryLogo[0].secure_url;
  }
  if (files.officialStamp && files.officialStamp[0]) {
    updateData.officialStamp = files.officialStamp[0].path || files.officialStamp[0].secure_url;
  }

  const updated = await prisma.hrPrintSetting.upsert({
    where: { companyId },
    create: { companyId, ...updateData },
    update: updateData,
    include: { signatories: true }
  });

  await writeAudit(companyId, req.user.id, 'upload', 'hr_branding', updated.id, 'Uploaded HR branding assets');
  res.json({ success: true, data: updated });
});

/**
 * Remove specific HR branding asset
 */
exports.removeBrandingAsset = wrap(async (req, res, companyId) => {
  if (!canManageHr(req)) {
    return res.status(403).json({ success: false, message: 'HR manager permission required' });
  }

  const { assetKey } = req.params; // 'primaryLogo' | 'secondaryLogo' | 'officialStamp'
  if (!['primaryLogo', 'secondaryLogo', 'officialStamp'].includes(assetKey)) {
    return res.status(400).json({ success: false, message: 'Invalid asset key' });
  }

  const updated = await prisma.hrPrintSetting.update({
    where: { companyId },
    data: { [assetKey]: '' },
    include: { signatories: true }
  });

  await writeAudit(companyId, req.user.id, 'remove', 'hr_branding', updated.id, `Removed ${assetKey}`);
  res.json({ success: true, data: updated });
});

/**
 * Create a new Signatory block with optional signature & stamp uploads
 */
exports.createSignatory = wrap(async (req, res, companyId) => {
  if (!canManageHr(req)) {
    return res.status(403).json({ success: false, message: 'HR manager permission required' });
  }

  let setting = await prisma.hrPrintSetting.findUnique({ where: { companyId } });
  if (!setting) {
    setting = await prisma.hrPrintSetting.create({ data: { companyId } });
  }

  const files = req.files || {};
  const body = req.body || {};

  let signatureUrl = body.signatureUrl || '';
  let stampUrl = body.stampUrl || '';

  if (files.signature && files.signature[0]) {
    signatureUrl = files.signature[0].path || files.signature[0].secure_url;
  }
  if (files.stamp && files.stamp[0]) {
    stampUrl = files.stamp[0].path || files.stamp[0].secure_url;
  }

  const count = await prisma.hrSignatory.count({ where: { companyId } });

  const signatory = await prisma.hrSignatory.create({
    data: {
      settingId: setting.id,
      companyId,
      label: String(body.label || 'Authorized Signatory'),
      name: String(body.name || ''),
      designation: String(body.designation || ''),
      signatureUrl,
      stampUrl,
      alignment: String(body.alignment || 'left'),
      displayOrder: Number(body.displayOrder || count + 1),
      isActive: Boolean(body.isActive ?? true)
    }
  });

  await writeAudit(companyId, req.user.id, 'create', 'hr_signatory', signatory.id, `Added signatory: ${signatory.label}`);
  res.json({ success: true, data: signatory });
});

/**
 * Update signatory block or signature image
 */
exports.updateSignatory = wrap(async (req, res, companyId) => {
  if (!canManageHr(req)) {
    return res.status(403).json({ success: false, message: 'HR manager permission required' });
  }

  const { id } = req.params;
  const existing = await prisma.hrSignatory.findFirst({ where: { id, companyId } });
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Signatory not found' });
  }

  const files = req.files || {};
  const body = req.body || {};

  let signatureUrl = body.signatureUrl !== undefined ? body.signatureUrl : existing.signatureUrl;
  let stampUrl = body.stampUrl !== undefined ? body.stampUrl : existing.stampUrl;

  if (files.signature && files.signature[0]) {
    signatureUrl = files.signature[0].path || files.signature[0].secure_url;
  }
  if (files.stamp && files.stamp[0]) {
    stampUrl = files.stamp[0].path || files.stamp[0].secure_url;
  }

  const updated = await prisma.hrSignatory.update({
    where: { id },
    data: {
      label: body.label !== undefined ? String(body.label) : undefined,
      name: body.name !== undefined ? String(body.name) : undefined,
      designation: body.designation !== undefined ? String(body.designation) : undefined,
      signatureUrl,
      stampUrl,
      alignment: body.alignment !== undefined ? String(body.alignment) : undefined,
      displayOrder: body.displayOrder !== undefined ? Number(body.displayOrder) : undefined,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined
    }
  });

  await writeAudit(companyId, req.user.id, 'update', 'hr_signatory', id, `Updated signatory: ${updated.label}`);
  res.json({ success: true, data: updated });
});

/**
 * Delete signatory block
 */
exports.deleteSignatory = wrap(async (req, res, companyId) => {
  if (!canManageHr(req)) {
    return res.status(403).json({ success: false, message: 'HR manager permission required' });
  }

  const { id } = req.params;
  const existing = await prisma.hrSignatory.findFirst({ where: { id, companyId } });
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Signatory not found' });
  }

  await prisma.hrSignatory.delete({ where: { id } });
  await writeAudit(companyId, req.user.id, 'delete', 'hr_signatory', id, `Deleted signatory: ${existing.label}`);
  res.json({ success: true, message: 'Signatory deleted' });
});
