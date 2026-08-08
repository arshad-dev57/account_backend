// controllers/pdfReportSettingsController.js
// Dedicated PDF report branding — NOT stored in profile / businessDetails

const prisma = require('../prisma/client');

function parseBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.toLowerCase().trim();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
  }
  return fallback;
}

function scopeKeyFor(user) {
  if (user.companyId) return `company:${user.companyId}`;
  return `user:${user.id}`;
}

function serialize(row) {
  if (!row) {
    return {
      companyName: '',
      companyAddress: '',
      logo: '',
      signature: '',
      showLogo: true,
      showSignature: true,
      showCompanyName: true,
      showAddress: true,
      showPageNumbers: true,
      layout: 'classic',
      logoPosition: 'left',
      headerSubtitle: '',
      footerText: 'Confidential - For Internal Use Only',
      accentColor: '#014582',
      signatureLabel: 'Authorized Signature',
    };
  }

  return {
    id: row.id,
    companyName: row.companyName || '',
    companyAddress: row.companyAddress || '',
    logo: row.logo || '',
    signature: row.signature || '',
    showLogo: row.showLogo !== false,
    showSignature: row.showSignature !== false,
    showCompanyName: row.showCompanyName !== false,
    showAddress: row.showAddress !== false,
    showPageNumbers: row.showPageNumbers !== false,
    layout: row.layout || 'classic',
    logoPosition: row.logoPosition || 'left',
    headerSubtitle: row.headerSubtitle || '',
    footerText: row.footerText || 'Confidential - For Internal Use Only',
    accentColor: row.accentColor || '#014582',
    signatureLabel: row.signatureLabel || 'Authorized Signature',
    updatedAt: row.updatedAt,
  };
}

function normalizeLayout(value, fallback = 'classic') {
  return ['classic', 'modern', 'minimal'].includes(value) ? value : fallback;
}

function normalizePosition(value, fallback = 'left') {
  return ['left', 'center', 'right'].includes(value) ? value : fallback;
}

function normalizeColor(value, fallback = '#014582') {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value)
    ? value
    : fallback;
}

// GET /api/pdf-report-settings
exports.getPdfReportSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const scopeKey = scopeKeyFor(user);
    const row = await prisma.pdfReportSetting.findUnique({
      where: { scopeKey },
    });

    res.status(200).json({
      success: true,
      data: serialize(row),
    });
  } catch (error) {
    console.error('Error getting PDF report settings:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// PUT /api/pdf-report-settings
exports.updatePdfReportSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    const body = req.body || {};

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    let logo = body.logo;
    let signature = body.signature;

    if (req.files) {
      if (req.files.logo && req.files.logo[0]) {
        logo = req.files.logo[0].path;
      }
      if (req.files.signature && req.files.signature[0]) {
        signature = req.files.signature[0].path;
      }
    }

    const scopeKey = scopeKeyFor(user);
    const existing = await prisma.pdfReportSetting.findUnique({
      where: { scopeKey },
    });

    const payload = {
      companyId: user.companyId || null,
      userId: user.id,
      companyName:
        body.companyName !== undefined
          ? String(body.companyName)
          : existing?.companyName || '',
      companyAddress:
        body.companyAddress !== undefined
          ? String(body.companyAddress)
          : existing?.companyAddress || '',
      logo: logo || existing?.logo || '',
      signature: signature || existing?.signature || '',
      showLogo: parseBool(body.showLogo, existing?.showLogo ?? true),
      showSignature: parseBool(
        body.showSignature,
        existing?.showSignature ?? true
      ),
      showCompanyName: parseBool(
        body.showCompanyName,
        existing?.showCompanyName ?? true
      ),
      showAddress: parseBool(body.showAddress, existing?.showAddress ?? true),
      showPageNumbers: parseBool(
        body.showPageNumbers,
        existing?.showPageNumbers ?? true
      ),
      layout: normalizeLayout(body.layout, existing?.layout || 'classic'),
      logoPosition: normalizePosition(
        body.logoPosition,
        existing?.logoPosition || 'left'
      ),
      headerSubtitle:
        body.headerSubtitle !== undefined
          ? String(body.headerSubtitle)
          : existing?.headerSubtitle || '',
      footerText:
        body.footerText !== undefined
          ? String(body.footerText)
          : existing?.footerText || 'Confidential - For Internal Use Only',
      accentColor: normalizeColor(
        body.accentColor,
        existing?.accentColor || '#014582'
      ),
      signatureLabel:
        body.signatureLabel !== undefined
          ? String(body.signatureLabel)
          : existing?.signatureLabel || 'Authorized Signature',
    };

    const row = await prisma.pdfReportSetting.upsert({
      where: { scopeKey },
      create: {
        scopeKey,
        ...payload,
      },
      update: payload,
    });

    res.status(200).json({
      success: true,
      message: 'PDF report settings saved successfully',
      data: serialize(row),
    });
  } catch (error) {
    console.error('Error updating PDF report settings:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};
