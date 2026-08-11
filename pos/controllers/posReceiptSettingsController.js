const prisma = require('../../prisma/client');

const CATEGORY = 'pos_receipt';
const NAME = 'template';

const DEFAULTS = {
  storeName: '',
  storeAddress: '',
  phone: '',
  email: '',
  website: '',
  taxId: '',
  showLogo: true,
  showAddress: true,
  showPhone: true,
  showEmail: true,
  showWebsite: true,
  showTaxId: true,
  showBarcode: true,
  showSku: true,
  showLoyalty: true,
  showCashier: true,
  showTerminal: true,
  receiptHeader: 'TAX INVOICE / SALES RECEIPT',
  receiptFooter: 'Thank you for shopping with us! Please visit again.',
  receiptReturnPolicy:
    'Returns accepted within 7 days with this original receipt. Opened, used or clearance items are non-refundable. Please inspect goods before leaving the store.',
  receiptNotes:
    'This is a computer-generated receipt and is valid without a signature. Please retain this copy for warranty, returns and accounting records.',
  copyLabel: 'ORIGINAL CUSTOMER COPY',
  servedByPrefix: 'You were served by',
  poweredBy: 'Powered by BisonTechs POS',
  thermalPaperWidthMm: 80,
};

function canEdit(user) {
  return ['admin', 'manager', 'owner', 'superadmin'].includes(
    String(user?.role || '').toLowerCase()
  );
}

function settingWhere(user) {
  if (user.companyId) {
    return { category: CATEGORY, name: NAME, companyId: user.companyId };
  }
  return { category: CATEGORY, name: NAME, createdBy: user.id, companyId: null };
}

function mergeTemplate(metadata) {
  const src = metadata && typeof metadata === 'object' ? metadata : {};
  const width = Number(src.thermalPaperWidthMm) === 58 ? 58 : 80;
  return {
    ...DEFAULTS,
    ...src,
    thermalPaperWidthMm: width,
    showLogo: src.showLogo !== false,
    showAddress: src.showAddress !== false,
    showPhone: src.showPhone !== false,
    showEmail: src.showEmail !== false,
    showWebsite: src.showWebsite !== false,
    showTaxId: src.showTaxId !== false,
    showBarcode: src.showBarcode !== false,
    showSku: src.showSku !== false,
    showLoyalty: src.showLoyalty !== false,
    showCashier: src.showCashier !== false,
    showTerminal: src.showTerminal !== false,
  };
}

async function findSetting(user) {
  return prisma.setting.findFirst({ where: settingWhere(user) });
}

exports.getReceiptSettings = async (req, res) => {
  try {
    const row = await findSetting(req.user);
    res.json({
      success: true,
      data: mergeTemplate(row?.metadata),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateReceiptSettings = async (req, res) => {
  try {
    if (!canEdit(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can edit the POS receipt template',
      });
    }

    const next = mergeTemplate(req.body || {});
    const existing = await findSetting(req.user);

    let row;
    if (existing) {
      row = await prisma.setting.update({
        where: { id: existing.id },
        data: {
          metadata: next,
          updatedBy: req.user.id,
          isActive: true,
        },
      });
    } else {
      row = await prisma.setting.create({
        data: {
          category: CATEGORY,
          name: NAME,
          metadata: next,
          isDefault: true,
          displayOrder: 0,
          isActive: true,
          createdBy: req.user.id,
          updatedBy: req.user.id,
          companyId: req.user.companyId || null,
        },
      });
    }

    res.json({
      success: true,
      message: 'Receipt template saved',
      data: mergeTemplate(row.metadata),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
