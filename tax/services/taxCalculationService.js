// tax/services/taxCalculationService.js
// Professional International Tax Calculation Engine for Global ERP

const prisma = require('../../prisma/client');

/**
 * Tax Calculation Engine
 * Handles complex international tax scenarios including:
 * - Multi-jurisdiction support
 * - Tax-inclusive vs tax-exclusive pricing
 * - Compound taxes
 * - Tax exemptions
 * - Multi-currency support
 * - Various tax types (VAT, GST, Sales Tax, Excise, etc.)
 */

class TaxCalculationService {
  
  /**
   * Calculate taxes for a transaction
   * @param {Object} params - Calculation parameters
   * @param {Array} params.items - Line items with product info, quantity, price
   * @param {Object} params.customer - Customer information
   * @param {Object} params.shippingAddress - Shipping address for jurisdiction
   * @param {Object} params.billingAddress - Billing address
   * @param {String} params.currency - Transaction currency
   * @param {String} params.companyId - Company ID
   * @param {String} params.transactionType - POSSale, SalesInvoice, Order
   * @param {String} params.transactionId - Transaction ID
   * @returns {Promise<Object>} Tax calculation result
   */
  async calculateTax(params) {
    const {
      items,
      customer,
      shippingAddress,
      billingAddress,
      currency = 'USD',
      companyId,
      transactionType,
      transactionId
    } = params;

    // Determine tax jurisdiction based on shipping address
    const jurisdiction = await this.determineJurisdiction(shippingAddress, companyId);
    
    // Get applicable tax rules for the jurisdiction
    const taxRules = await this.getApplicableTaxRules(jurisdiction, items, customer, companyId);
    
    // Check for customer exemptions
    const customerExemptions = await this.getCustomerExemptions(customer?.id, companyId);
    
    // Check for product exemptions
    const productExemptions = await this.getProductExemptions(items.map(i => i.productId), companyId);
    
    // Calculate taxes for each item
    const itemTaxes = await Promise.all(
      items.map(item => this.calculateItemTax(
        item,
        taxRules,
        customerExemptions,
        productExemptions,
        jurisdiction,
        currency
      ))
    );
    
    // Calculate compound taxes if applicable
    const compoundTaxes = await this.calculateCompoundTaxes(
      itemTaxes,
      taxRules,
      jurisdiction,
      companyId
    );
    
    // Aggregate totals
    const totals = this.aggregateTaxTotals(itemTaxes, compoundTaxes);
    
    // Record tax transactions for audit trail
    await this.recordTaxTransactions({
      transactionId,
      transactionType,
      itemTaxes,
      compoundTaxes,
      totals,
      jurisdiction,
      currency,
      companyId
    });
    
    return {
      jurisdiction,
      itemTaxes,
      compoundTaxes,
      totals,
      currency
    };
  }

  /**
   * Determine tax jurisdiction based on address
   */
  async determineJurisdiction(address, companyId) {
    if (!address) {
      // Default to company's primary jurisdiction
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        include: { taxJurisdictions: { where: { isDefault: true } } }
      });
      
      return company?.taxJurisdictions[0] || null;
    }

    // Try to match jurisdiction by address components
    const { country, state, city, postalCode } = address;
    
    // Start with country level
    let jurisdiction = await prisma.taxJurisdiction.findFirst({
      where: {
        companyId,
        countryCode: country,
        level: 'Country',
        isActive: true
      }
    });

    // Try state/province level
    if (state && jurisdiction) {
      const stateJurisdiction = await prisma.taxJurisdiction.findFirst({
        where: {
          companyId,
          parentId: jurisdiction.id,
          code: state,
          level: 'State',
          isActive: true
        }
      });
      if (stateJurisdiction) jurisdiction = stateJurisdiction;
    }

    // Try city level
    if (city && jurisdiction) {
      const cityJurisdiction = await prisma.taxJurisdiction.findFirst({
        where: {
          companyId,
          parentId: jurisdiction.id,
          name: { contains: city, mode: 'insensitive' },
          level: 'City',
          isActive: true
        }
      });
      if (cityJurisdiction) jurisdiction = cityJurisdiction;
    }

    return jurisdiction;
  }

  /**
   * Get applicable tax rules for jurisdiction and items
   */
  async getApplicableTaxRules(jurisdiction, items, customer, companyId) {
    if (!jurisdiction) return [];

    const productIds = items.map(i => i.productId);
    const categoryIds = [...new Set(items.map(i => i.categoryId).filter(Boolean))];
    
    const rules = await prisma.taxRule.findMany({
      where: {
        companyId,
        isActive: true,
        taxRate: {
          jurisdictionId: jurisdiction.id,
          isActive: true,
          OR: [
            { effectiveFrom: { lte: new Date() } },
            { effectiveTo: null },
            { effectiveTo: { gte: new Date() } }
          ]
        },
        OR: [
          { productId: { in: productIds } },
          { productCategoryId: { in: categoryIds } },
          { productId: null, productCategoryId: null } // General rule
        ]
      },
      include: {
        taxRate: {
          include: {
            taxType: true,
            jurisdiction: true
          }
        }
      },
      orderBy: { priority: 'desc' }
    });

    return rules;
  }

  /**
   * Get customer tax exemptions
   */
  async getCustomerExemptions(customerId, companyId) {
    if (!customerId) return [];

    const exemptions = await prisma.taxExemption.findMany({
      where: {
        companyId,
        customerId,
        isActive: true,
        OR: [
          { certificateExpiresAt: null },
          { certificateExpiresAt: { gte: new Date() } }
        ]
      },
      include: {
        exemptionType: true
      }
    });

    return exemptions;
  }

  /**
   * Get product tax exemptions
   */
  async getProductExemptions(productIds, companyId) {
    if (!productIds || productIds.length === 0) return [];

    const exemptions = await prisma.taxExemption.findMany({
      where: {
        companyId,
        productId: { in: productIds },
        isActive: true
      },
      include: {
        exemptionType: true
      }
    });

    return exemptions;
  }

  /**
   * Calculate tax for a single item
   */
  async calculateItemTax(item, taxRules, customerExemptions, productExemptions, jurisdiction, currency) {
    const { productId, quantity, unitPrice, pricingModel = 'exclusive' } = item;
    
    // Find applicable rules for this item
    const applicableRules = taxRules.filter(rule => 
      !rule.productId || rule.productId === productId ||
      !rule.productCategoryId || rule.productCategoryId === item.categoryId
    );

    // Check for product exemption
    const productExemption = productExemptions.find(e => e.productId === productId);
    
    // Calculate line total before tax
    const lineTotal = quantity * unitPrice;
    
    const taxCalculations = [];

    for (const rule of applicableRules) {
      const { taxRate, exemptionAllowed } = rule;
      const { taxType } = taxRate;
      
      // Check if exemption applies
      let exemptionPercentage = 0;
      
      if (exemptionAllowed) {
        // Check customer exemption for this tax type
        const customerExemption = customerExemptions.find(e => 
          e.exemptionType.code === taxType.code
        );
        
        if (customerExemption) {
          exemptionPercentage = customerExemption.exemptionType.percentage;
        }
        
        // Check product exemption
        if (productExemption) {
          exemptionPercentage = Math.max(exemptionPercentage, productExemption.exemptionType.percentage);
        }
      }

      // Calculate taxable amount
      let taxableAmount = lineTotal;
      taxableAmount = taxableAmount * (1 - exemptionPercentage / 100);

      // Calculate tax based on pricing model
      let taxAmount = 0;
      
      if (pricingModel === 'inclusive') {
        // Tax-inclusive: calculate tax backwards
        // Formula: tax = (price * rate) / (1 + rate)
        const divisor = 1 + (taxRate.rate / 100);
        taxAmount = (lineTotal * (taxRate.rate / 100)) / divisor;
      } else {
        // Tax-exclusive: calculate tax normally
        taxAmount = taxableAmount * (taxRate.rate / 100);
      }

      // Apply rounding based on jurisdiction rules
      taxAmount = this.roundTaxAmount(taxAmount, jurisdiction);

      taxCalculations.push({
        taxRateId: taxRate.id,
        taxTypeId: taxType.id,
        taxTypeCode: taxType.code,
        taxTypeName: taxType.name,
        taxRate: taxRate.rate,
        taxableAmount,
        exemptionPercentage,
        exemptionAmount: (lineTotal - taxableAmount),
        taxAmount,
        isCompound: taxType.isCompound,
        pricingModel: rule.pricingModel
      });
    }

    const totalTax = taxCalculations.reduce((sum, t) => sum + t.taxAmount, 0);

    return {
      productId,
      quantity,
      unitPrice,
      lineTotal,
      pricingModel,
      taxCalculations,
      totalTax,
      totalWithTax: pricingModel === 'inclusive' ? lineTotal : lineTotal + totalTax
    };
  }

  /**
   * Calculate compound taxes (tax on tax)
   */
  async calculateCompoundTaxes(itemTaxes, taxRules, jurisdiction, companyId) {
    const compoundTaxes = [];

    for (const itemTax of itemTaxes) {
      for (const taxCalc of itemTax.taxCalculations) {
        if (!taxCalc.isCompound || !taxCalc.compoundOn) continue;

        // Find the base tax to compound on
        const baseTax = itemTax.taxCalculations.find(t => t.taxTypeCode === taxCalc.compoundOn);
        
        if (baseTax) {
          // Calculate compound tax on the base tax amount
          const compoundAmount = baseTax.taxAmount * (taxCalc.taxRate / 100);
          
          compoundTaxes.push({
            productId: itemTax.productId,
            baseTaxId: baseTax.taxRateId,
            compoundTaxId: taxCalc.taxRateId,
            baseTaxAmount: baseTax.taxAmount,
            compoundRate: taxCalc.taxRate,
            compoundAmount: this.roundTaxAmount(compoundAmount, jurisdiction)
          });
        }
      }
    }

    return compoundTaxes;
  }

  /**
   * Aggregate tax totals
   */
  aggregateTaxTotals(itemTaxes, compoundTaxes) {
    const totals = {
      subtotal: 0,
      totalTax: 0,
      totalWithTax: 0,
      taxesByType: {},
      exemptions: {}
    };

    for (const itemTax of itemTaxes) {
      totals.subtotal += itemTax.lineTotal;
      totals.totalTax += itemTax.totalTax;
      totals.totalWithTax += itemTax.totalWithTax;

      // Aggregate by tax type
      for (const taxCalc of itemTax.taxCalculations) {
        if (!totals.taxesByType[taxCalc.taxTypeCode]) {
          totals.taxesByType[taxCalc.taxTypeCode] = {
            taxTypeName: taxCalc.taxTypeName,
            taxRate: taxCalc.taxRate,
            taxableAmount: 0,
            taxAmount: 0,
            exemptionAmount: 0
          };
        }

        totals.taxesByType[taxCalc.taxTypeCode].taxableAmount += taxCalc.taxableAmount;
        totals.taxesByType[taxCalc.taxTypeCode].taxAmount += taxCalc.taxAmount;
        totals.taxesByType[taxCalc.taxTypeCode].exemptionAmount += taxCalc.exemptionAmount;
      }
    }

    // Add compound taxes
    for (const compoundTax of compoundTaxes) {
      totals.totalTax += compoundTax.compoundAmount;
      totals.totalWithTax += compoundTax.compoundAmount;
    }

    return totals;
  }

  /**
   * Round tax amount based on jurisdiction rules
   */
  roundTaxAmount(amount, jurisdiction) {
    // Default: round to 2 decimal places
    // Can be customized per jurisdiction
    const precision = 2;
    const factor = Math.pow(10, precision);
    return Math.round(amount * factor) / factor;
  }

  /**
   * Record tax transactions for audit trail
   */
  async recordTaxTransactions(params) {
    const {
      transactionId,
      transactionType,
      itemTaxes,
      compoundTaxes,
      totals,
      jurisdiction,
      currency,
      companyId
    } = params;

    const taxTransactions = [];

    // Record item taxes
    for (const itemTax of itemTaxes) {
      for (const taxCalc of itemTax.taxCalculations) {
        taxTransactions.push({
          transactionId,
          transactionType,
          jurisdictionId: jurisdiction?.id,
          taxTypeId: taxCalc.taxTypeId,
          taxRateId: taxCalc.taxRateId,
          taxableAmount: taxCalc.taxableAmount,
          taxRate: taxCalc.taxRate,
          taxAmount: taxCalc.taxAmount,
          exemptionAmount: taxCalc.exemptionAmount,
          isCompound: taxCalc.isCompound,
          currency,
          companyId
        });
      }
    }

    // Record compound taxes
    for (const compoundTax of compoundTaxes) {
      taxTransactions.push({
        transactionId,
        transactionType,
        jurisdictionId: jurisdiction?.id,
        taxTypeId: compoundTax.compoundTaxId,
        taxRateId: compoundTax.compoundTaxId,
        taxableAmount: compoundTax.baseTaxAmount,
        taxRate: compoundTax.compoundRate,
        taxAmount: compoundTax.compoundAmount,
        exemptionAmount: 0,
        isCompound: true,
        currency,
        companyId
      });
    }

    // Bulk insert tax transactions
    if (taxTransactions.length > 0) {
      await prisma.taxTransaction.createMany({
        data: taxTransactions,
        skipDuplicates: true
      });
    }
  }

  /**
   * Reverse tax transactions (for refunds/returns)
   */
  async reverseTaxTransactions(transactionId, companyId) {
    await prisma.taxTransaction.updateMany({
      where: {
        transactionId,
        companyId
      },
      data: {
        // Mark as reversed - you might want to add a status field
        // For now, we'll create reversal entries
      }
    });

    // Create reversal entries
    const originalTransactions = await prisma.taxTransaction.findMany({
      where: { transactionId, companyId }
    });

    const reversalTransactions = originalTransactions.map(t => ({
      transactionId: `${transactionId}-REVERSAL`,
      transactionType: 'Reversal',
      jurisdictionId: t.jurisdictionId,
      taxTypeId: t.taxTypeId,
      taxRateId: t.taxRateId,
      taxableAmount: -t.taxableAmount,
      taxRate: t.taxRate,
      taxAmount: -t.taxAmount,
      exemptionAmount: -t.exemptionAmount,
      isCompound: t.isCompound,
      currency: t.currency,
      companyId
    }));

    await prisma.taxTransaction.createMany({
      data: reversalTransactions
    });
  }
}

module.exports = new TaxCalculationService();
