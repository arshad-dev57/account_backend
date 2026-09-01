const prisma = require('../../prisma/client');

function normalizePosMode(value) {
  return value === 'restaurant' ? 'restaurant' : 'retail';
}

/** GET /api/pos/settings */
exports.getSettings = async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'No company linked to user' });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { posMode: true, posModeConfigured: true, name: true },
    });

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    return res.json({
      success: true,
      data: {
        posMode: company.posMode || 'retail',
        posModeConfigured: Boolean(company.posModeConfigured),
        companyName: company.name || '',
      },
    });
  } catch (err) {
    console.error('[posSettings.getSettings]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load POS settings' });
  }
};

/** PATCH /api/pos/settings — admin sets retail vs restaurant */
exports.updateSettings = async (req, res) => {
  try {
    const role = (req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'owner' && role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Only administrators can configure POS type' });
    }

    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'No company linked to user' });
    }

    const { posMode } = req.body || {};
    if (!posMode || !['retail', 'restaurant'].includes(posMode)) {
      return res.status(400).json({
        success: false,
        message: 'posMode must be "retail" or "restaurant"',
      });
    }

    const company = await prisma.company.update({
      where: { id: companyId },
      data: {
        posMode: normalizePosMode(posMode),
        posModeConfigured: true,
      },
      select: { posMode: true, posModeConfigured: true, name: true },
    });

    return res.json({
      success: true,
      message: 'POS type saved',
      data: {
        posMode: company.posMode,
        posModeConfigured: Boolean(company.posModeConfigured),
        companyName: company.name || '',
      },
    });
  } catch (err) {
    console.error('[posSettings.updateSettings]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update POS settings' });
  }
};
