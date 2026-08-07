// tax/controller/taxController.js
// Tax Management Controller for International Tax System

const taxCalculationService = require('../services/taxCalculationService');
const prisma = require('../../prisma/client');

/**
 * Tax Jurisdiction Management
 */

// Get all tax jurisdictions for a company
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
        taxRate: true
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
          taxRate: tx.taxRate,
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
        taxRate: true
      },
      orderBy: { createdAt: 'asc' }
    });

    res.json({ success: true, data: transactions });
  } catch (error) {
    console.error('Get tax audit trail error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  // Jurisdictions
  getTaxJurisdictions,
  createTaxJurisdiction,
  
  // Tax Types
  getTaxTypes,
  createTaxType,
  
  // Tax Rates
  getTaxRates,
  createTaxRate,
  
  // Tax Rules
  getTaxRules,
  createTaxRule,
  
  // Exemptions
  getTaxExemptionTypes,
  createTaxExemptionType,
  getCustomerTaxExemptions,
  createTaxExemption,
  
  // Calculation
  calculateTax,
  
  // Reporting
  getTaxLiabilityReport,
  getTaxAuditTrail
};
