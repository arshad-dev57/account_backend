
const taxCalculationService = require('../services/taxCalculationService');
const prisma = require('../../prisma/client');

const getTaxJurisdictions = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    
    const jurisdictions = await prisma.taxJurisdiction.findMany({
      where: { companyId },
      include: {
        parent: true,
        children: true,
        taxRates: {
          include: { taxType: true },
          where: { isActive: true }
        }
      },
      orderBy: { level: 'asc' }
    });

    res.json({ success: true, data: jurisdictions });
  } catch (error) {
    console.error('Get tax jurisdictions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create tax jurisdiction
const createTaxJurisdiction = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { code, name, level, parentId, countryCode } = req.body;

    const jurisdiction = await prisma.taxJurisdiction.create({
      data: {
        code,
        name,
        level,
        parentId,
        countryCode,
        companyId
      }
    });

    res.status(201).json({ success: true, data: jurisdiction });
  } catch (error) {
    console.error('Create tax jurisdiction error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Tax Type Management
 */

// Get all tax types
const getTaxTypes = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    
    const taxTypes = await prisma.taxType.findMany({
      where: { companyId, isActive: true },
      orderBy: { code: 'asc' }
    });

    res.json({ success: true, data: taxTypes });
  } catch (error) {
    console.error('Get tax types error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create tax type
const createTaxType = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { code, name, description, calculationType, isCompound } = req.body;

    const taxType = await prisma.taxType.create({
      data: {
        code,
        name,
        description,
        calculationType,
        isCompound,
        companyId
      }
    });

    res.status(201).json({ success: true, data: taxType });
  } catch (error) {
    console.error('Create tax type error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Tax Rate Management
 */

// Get tax rates for a jurisdiction
const getTaxRates = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { jurisdictionId } = req.params;
    
    const taxRates = await prisma.taxRate.findMany({
      where: { companyId, jurisdictionId, isActive: true },
      include: {
        taxType: true,
        jurisdiction: true,
        taxRules: true
      },
      orderBy: { effectiveFrom: 'desc' }
    });

    res.json({ success: true, data: taxRates });
  } catch (error) {
    console.error('Get tax rates error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create tax rate
const createTaxRate = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { jurisdictionId, taxTypeId, rate, effectiveFrom, effectiveTo, isDefault } = req.body;

    const taxRate = await prisma.taxRate.create({
      data: {
        jurisdictionId,
        taxTypeId,
        rate,
        effectiveFrom: new Date(effectiveFrom),
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
        isDefault,
        companyId
      },
      include: {
        taxType: true,
        jurisdiction: true
      }
    });

    res.status(201).json({ success: true, data: taxRate });
  } catch (error) {
    console.error('Create tax rate error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Tax Rule Management
 */

// Get tax rules
const getTaxRules = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { taxRateId } = req.params;
    
    const taxRules = await prisma.taxRule.findMany({
      where: { companyId, taxRateId, isActive: true },
      include: {
        taxRate: {
          include: { taxType: true, jurisdiction: true }
        }
      },
      orderBy: { priority: 'desc' }
    });

    res.json({ success: true, data: taxRules });
  } catch (error) {
    console.error('Get tax rules error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create tax rule
const createTaxRule = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      name,
      taxRateId,
      productCategoryId,
      productId,
      customerGroupId,
      pricingModel,
      exemptionAllowed,
      compoundOn,
      priority
    } = req.body;

    const taxRule = await prisma.taxRule.create({
      data: {
        name,
        taxRateId,
        productCategoryId,
        productId,
        customerGroupId,
        pricingModel,
        exemptionAllowed,
        compoundOn,
        priority,
        companyId
      },
      include: {
        taxRate: {
          include: { taxType: true, jurisdiction: true }
        }
      }
    });

    res.status(201).json({ success: true, data: taxRule });
  } catch (error) {
    console.error('Create tax rule error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Tax Exemption Management
 */

// Get tax exemption types
const getTaxExemptionTypes = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    
    const exemptionTypes = await prisma.taxExemptionType.findMany({
      where: { companyId, isActive: true },
      orderBy: { code: 'asc' }
    });

    res.json({ success: true, data: exemptionTypes });
  } catch (error) {
    console.error('Get tax exemption types error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create tax exemption type
const createTaxExemptionType = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { code, name, description, percentage, requiresCertificate } = req.body;

    const exemptionType = await prisma.taxExemptionType.create({
      data: {
        code,
        name,
        description,
        percentage,
        requiresCertificate,
        companyId
      }
    });

    res.status(201).json({ success: true, data: exemptionType });
  } catch (error) {
    console.error('Create tax exemption type error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get customer tax exemptions
const getCustomerTaxExemptions = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { customerId } = req.params;
    
    const exemptions = await prisma.taxExemption.findMany({
      where: { companyId, customerId, isActive: true },
      include: {
        exemptionType: true,
        customer: true,
        approver: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: exemptions });
  } catch (error) {
    console.error('Get customer tax exemptions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create tax exemption
const createTaxExemption = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const {
      exemptionTypeId,
      customerId,
      productId,
      productCategoryId,
      certificateNumber,
      certificateIssuedAt,
      certificateExpiresAt
    } = req.body;

    const exemption = await prisma.taxExemption.create({
      data: {
        exemptionTypeId,
        customerId,
        productId,
        productCategoryId,
        certificateNumber,
        certificateIssuedAt: certificateIssuedAt ? new Date(certificateIssuedAt) : null,
        certificateExpiresAt: certificateExpiresAt ? new Date(certificateExpiresAt) : null,
        approvedBy: userId,
        approvedAt: new Date(),
        companyId
      },
      include: {
        exemptionType: true,
        customer: true,
        product: true
      }
    });

    res.status(201).json({ success: true, data: exemption });
  } catch (error) {
    console.error('Create tax exemption error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Tax Calculation
 */

// Calculate tax for a transaction
const calculateTax = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      items,
      customer,
      shippingAddress,
      billingAddress,
      currency,
      transactionType,
      transactionId
    } = req.body;

    const result = await taxCalculationService.calculateTax({
      items,
      customer,
      shippingAddress,
      billingAddress,
      currency,
      companyId,
      transactionType,
      transactionId
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Calculate tax error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Tax Reporting
 */

// Get tax liability report
const getTaxLiabilityReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { startDate, endDate, jurisdictionId, taxTypeId } = req.query;

    const where = { companyId };
    if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
    if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) };
    if (jurisdictionId) where.jurisdictionId = jurisdictionId;
    if (taxTypeId) where.taxTypeId = taxTypeId;

    const taxTransactions = await prisma.taxTransaction.findMany({
      where,
      include: {
        jurisdiction: true,
        taxType: true,
        taxRateRelation: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Aggregate by jurisdiction and tax type
    const report = taxTransactions.reduce((acc, tx) => {
      const key = `${tx.jurisdictionId}-${tx.taxTypeId}`;
      if (!acc[key]) {
        acc[key] = {
          jurisdiction: tx.jurisdiction?.name,
          taxType: tx.taxType?.name,
          taxRate: tx.taxRateRelation?.rate ?? tx.taxRate,
          taxableAmount: 0,
          taxAmount: 0,
          exemptionAmount: 0,
          transactionCount: 0
        };
      }
      acc[key].taxableAmount += tx.taxableAmount;
      acc[key].taxAmount += tx.taxAmount;
      acc[key].exemptionAmount += tx.exemptionAmount;
      acc[key].transactionCount += 1;
      return acc;
    }, {});

    res.json({ 
      success: true, 
      data: {
        summary: Object.values(report),
        transactions: taxTransactions
      }
    });
  } catch (error) {
    console.error('Get tax liability report error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get tax audit trail
const getTaxAuditTrail = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { transactionId } = req.params;
    
    const transactions = await prisma.taxTransaction.findMany({
      where: {
        companyId,
        OR: [
          { transactionId },
          { transactionId: { contains: transactionId } }
        ]
      },
      include: {
        jurisdiction: true,
        taxType: true,
        taxRateRelation: true
      },
      orderBy: { createdAt: 'asc' }
    });

    res.json({ success: true, data: transactions });
  } catch (error) {
    console.error('Get tax audit trail error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const { COUNTRY_PACKS, getCountryPack } = require('../data/countryPacks');

const getTaxContext = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const now = new Date();

    let profile = await prisma.companyTaxProfile.findUnique({
      where: { companyId },
      include: { defaultJurisdiction: true }
    });

    const rates = await prisma.taxRate.findMany({
      where: {
        companyId,
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }]
      },
      include: { taxType: true, jurisdiction: true },
      orderBy: [{ isDefault: 'desc' }, { rate: 'desc' }]
    });

    const defaultRate = rates.find((r) => r.isDefault) || rates[0] || null;

    res.json({
      success: true,
      data: {
        configured: Boolean(profile),
        profile,
        countryPacks: COUNTRY_PACKS.map((p) => ({
          countryCode: p.countryCode,
          name: p.name,
          regime: p.regime,
          pricingModel: p.pricingModel,
          filingFrequency: p.filingFrequency
        })),
        defaultRate,
        rates: rates.map((r) => ({
          id: r.id,
          rate: r.rate,
          isDefault: r.isDefault,
          taxTypeCode: r.taxType?.code,
          taxTypeName: r.taxType?.name,
          jurisdictionId: r.jurisdictionId,
          jurisdictionName: r.jurisdiction?.name,
          pricingModel: profile?.pricingModel || 'exclusive'
        })),
        pricingModel: profile?.pricingModel || 'exclusive',
        regime: profile?.regime || null,
        countryCode: profile?.countryCode || null,
        enabled: Boolean(profile?.taxEnabled)
      }
    });
  } catch (error) {
    console.error('Get tax context error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getTaxOverview = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const [profile, jurisdictions, taxTypes, taxRates, exemptions, recent] = await Promise.all([
      prisma.companyTaxProfile.findUnique({ where: { companyId }, include: { defaultJurisdiction: true } }),
      prisma.taxJurisdiction.count({ where: { companyId, isActive: true } }),
      prisma.taxType.count({ where: { companyId, isActive: true } }),
      prisma.taxRate.count({ where: { companyId, isActive: true } }),
      prisma.taxExemption.count({ where: { companyId, isActive: true } }),
      prisma.taxTransaction.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { taxType: true, jurisdiction: true }
      }),
    ]);

    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const monthAgg = await prisma.taxTransaction.aggregate({
      where: { companyId, createdAt: { gte: start } },
      _sum: { taxAmount: true, taxableAmount: true, exemptionAmount: true },
      _count: true
    });

    res.json({
      success: true,
      data: {
        profile,
        counts: { jurisdictions, taxTypes, taxRates, exemptions },
        enabled: Boolean(profile?.taxEnabled),
        thisMonth: {
          taxAmount: monthAgg._sum.taxAmount || 0,
          taxableAmount: monthAgg._sum.taxableAmount || 0,
          exemptionAmount: monthAgg._sum.exemptionAmount || 0,
          transactions: monthAgg._count || 0
        },
        recent
      }
    });
  } catch (error) {
    console.error('Get tax overview error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const upsertTaxProfile = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      countryCode,
      regime,
      pricingModel,
      taxRegistrationNumber,
      filingFrequency,
      defaultJurisdictionId,
      recoverInputTax,
      taxEnabled
    } = req.body;

    const data = {
      countryCode,
      regime,
      pricingModel,
      taxRegistrationNumber,
      filingFrequency,
      defaultJurisdictionId: defaultJurisdictionId || null,
      recoverInputTax: recoverInputTax !== false,
      ...(typeof taxEnabled === 'boolean' ? { taxEnabled } : {})
    };

    const profile = await prisma.companyTaxProfile.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
      include: { defaultJurisdiction: true }
    });

    if (defaultJurisdictionId) {
      await prisma.taxJurisdiction.updateMany({
        where: { companyId },
        data: { isDefault: false }
      });
      await prisma.taxJurisdiction.update({
        where: { id: defaultJurisdictionId },
        data: { isDefault: true }
      });
    }

    res.json({ success: true, data: profile });
  } catch (error) {
    console.error('Upsert tax profile error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const setupCountryPack = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { countryCode, taxRegistrationNumber, replaceExisting } = req.body;
    const pack = getCountryPack(countryCode);
    if (!pack) {
      return res.status(400).json({ success: false, message: 'Unknown country pack' });
    }

    if (replaceExisting) {
      await prisma.taxTransaction.deleteMany({ where: { companyId } });
      await prisma.taxRule.deleteMany({ where: { companyId } });
      await prisma.taxExemption.deleteMany({ where: { companyId } });
      await prisma.taxExemptionType.deleteMany({ where: { companyId } });
      await prisma.taxRate.deleteMany({ where: { companyId } });
      await prisma.taxType.deleteMany({ where: { companyId } });
      await prisma.companyTaxProfile.deleteMany({ where: { companyId } });
      await prisma.taxJurisdiction.deleteMany({ where: { companyId } });
    }

    const existing = await prisma.taxJurisdiction.findFirst({
      where: { companyId, countryCode: pack.countryCode }
    });
    if (existing && !replaceExisting) {
      return res.status(409).json({
        success: false,
        message: 'Tax setup already exists for this country. Pass replaceExisting to reset.'
      });
    }

    const jurisdiction = await prisma.taxJurisdiction.create({
      data: {
        code: pack.countryCode,
        name: pack.name,
        level: 'Country',
        countryCode: pack.countryCode,
        isDefault: true,
        companyId
      }
    });

    const types = [];
    for (const t of pack.types) {
      const taxType = await prisma.taxType.create({
        data: {
          code: t.code,
          name: t.name,
          calculationType: 'percentage',
          isCompound: false,
          companyId
        }
      });
      types.push(taxType);
      await prisma.taxRate.create({
        data: {
          jurisdictionId: jurisdiction.id,
          taxTypeId: taxType.id,
          rate: t.rate,
          effectiveFrom: new Date(),
          isDefault: t === pack.types[0],
          companyId
        }
      });
    }

    for (const e of pack.exemptions) {
      await prisma.taxExemptionType.create({
        data: {
          code: e.code,
          name: e.name,
          percentage: e.percentage,
          requiresCertificate: e.requiresCertificate,
          companyId
        }
      });
    }

    const profile = await prisma.companyTaxProfile.upsert({
      where: { companyId },
      create: {
        companyId,
        countryCode: pack.countryCode,
        regime: pack.regime,
        pricingModel: pack.pricingModel,
        filingFrequency: pack.filingFrequency,
        taxRegistrationNumber: taxRegistrationNumber || null,
        defaultJurisdictionId: jurisdiction.id,
        recoverInputTax: pack.recoverInputTax,
        taxEnabled: true
      },
      update: {
        countryCode: pack.countryCode,
        regime: pack.regime,
        pricingModel: pack.pricingModel,
        filingFrequency: pack.filingFrequency,
        taxRegistrationNumber: taxRegistrationNumber || undefined,
        defaultJurisdictionId: jurisdiction.id,
        recoverInputTax: pack.recoverInputTax,
        taxEnabled: true
      },
      include: { defaultJurisdiction: true }
    });

    res.status(201).json({
      success: true,
      data: { profile, jurisdiction, types: types.length, exemptions: pack.exemptions.length }
    });
  } catch (error) {
    console.error('Setup country pack error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllTaxRates = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const taxRates = await prisma.taxRate.findMany({
      where: { companyId },
      include: { taxType: true, jurisdiction: true, taxRules: true },
      orderBy: [{ isActive: 'desc' }, { isDefault: 'desc' }, { rate: 'desc' }]
    });
    res.json({ success: true, data: taxRates });
  } catch (error) {
    console.error('Get all tax rates error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllTaxRules = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const taxRules = await prisma.taxRule.findMany({
      where: { companyId },
      include: { taxRate: { include: { taxType: true, jurisdiction: true } } },
      orderBy: { priority: 'desc' }
    });
    res.json({ success: true, data: taxRules });
  } catch (error) {
    console.error('Get all tax rules error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllTaxExemptions = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const exemptions = await prisma.taxExemption.findMany({
      where: { companyId },
      include: { exemptionType: true, customer: true, product: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: exemptions });
  } catch (error) {
    console.error('Get all tax exemptions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateTaxJurisdiction = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const { name, level, parentId, countryCode, isDefault, isActive } = req.body;
    const existing = await prisma.taxJurisdiction.findFirst({ where: { id, companyId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Jurisdiction not found' });

    if (isDefault) {
      await prisma.taxJurisdiction.updateMany({ where: { companyId }, data: { isDefault: false } });
    }

    const jurisdiction = await prisma.taxJurisdiction.update({
      where: { id },
      data: {
        name,
        level,
        parentId: parentId || null,
        countryCode,
        isDefault: isDefault ?? existing.isDefault,
        isActive: isActive ?? existing.isActive
      }
    });
    res.json({ success: true, data: jurisdiction });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateTaxType = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const existing = await prisma.taxType.findFirst({ where: { id, companyId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Tax type not found' });
    const taxType = await prisma.taxType.update({
      where: { id },
      data: {
        name: req.body.name,
        description: req.body.description,
        calculationType: req.body.calculationType,
        isCompound: req.body.isCompound,
        isActive: req.body.isActive
      }
    });
    res.json({ success: true, data: taxType });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateTaxRate = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const existing = await prisma.taxRate.findFirst({ where: { id, companyId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Tax rate not found' });

    if (req.body.isDefault) {
      await prisma.taxRate.updateMany({
        where: { companyId, jurisdictionId: existing.jurisdictionId },
        data: { isDefault: false }
      });
    }

    const taxRate = await prisma.taxRate.update({
      where: { id },
      data: {
        rate: req.body.rate,
        effectiveFrom: req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : undefined,
        effectiveTo: req.body.effectiveTo ? new Date(req.body.effectiveTo) : req.body.effectiveTo === null ? null : undefined,
        isDefault: req.body.isDefault,
        isActive: req.body.isActive
      },
      include: { taxType: true, jurisdiction: true }
    });
    res.json({ success: true, data: taxRate });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const setTaxEnabled = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const enabled = req.body.enabled === true;

    const profile = await prisma.companyTaxProfile.upsert({
      where: { companyId },
      create: {
        companyId,
        taxEnabled: enabled,
        countryCode: 'US',
        regime: 'SALES_TAX',
        pricingModel: 'exclusive'
      },
      update: { taxEnabled: enabled },
      include: { defaultJurisdiction: true }
    });

    res.json({
      success: true,
      data: profile,
      message: enabled
        ? 'Taxation is now ON across POS, sales, purchases, inventory and accounting.'
        : 'Taxation is now OFF. Tax will not be calculated or shown in any document flow.'
    });
  } catch (error) {
    console.error('Set tax enabled error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getTaxJurisdictions,
  createTaxJurisdiction,
  updateTaxJurisdiction,
  getTaxTypes,
  createTaxType,
  updateTaxType,
  getTaxRates,
  getAllTaxRates,
  createTaxRate,
  updateTaxRate,
  getTaxRules,
  getAllTaxRules,
  createTaxRule,
  getTaxExemptionTypes,
  createTaxExemptionType,
  getCustomerTaxExemptions,
  getAllTaxExemptions,
  createTaxExemption,
  calculateTax,
  getTaxLiabilityReport,
  getTaxAuditTrail,
  getTaxContext,
  getTaxOverview,
  upsertTaxProfile,
  setupCountryPack,
  setTaxEnabled
};
