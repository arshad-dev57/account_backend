
const prisma = require('../../prisma/client');

class TaxCalculationService {
  
  /**
   * @param {Object} params - Calculation parameters
   * @param {Array} params.items - Line items with product info, quantity, price
   * @param {Object} params.customer - Customer information
   * @param {Object} params.shippingAddress -   
   * @param {Object} params.billingAddress -  
   * @param {String} params.currency  
   * @param {String} params.companyId 
   * @param {String} params.transactionType 
   * @param {String} params.transactionId 
   * @returns {Promise<Object>} 
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

    const persist = Boolean(transactionId);
    const profile = await this.getCompanyProfile(companyId);

    if (!profile?.taxEnabled) {
      const itemTaxes = (items || []).map((item) => {
        const lineTotal = (item.quantity || 0) * (item.unitPrice || 0);
        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal,
          pricingModel: 'exclusive',
          taxCalculations: [],
          totalTax: 0,
          totalWithTax: lineTotal
        };
      });
      const subtotal = itemTaxes.reduce((s, i) => s + i.lineTotal, 0);
      return {
        enabled: false,
        jurisdiction: null,
        itemTaxes,
        compoundTaxes: [],
        totals: { subtotal, totalTax: 0, totalWithTax: subtotal, taxesByType: {}, exemptions: {} },
        currency,
        pricingModel: 'exclusive',
        regime: null
      };
    }

    // Determine tax jurisdiction based on shipping address
    const jurisdiction = await this.determineJurisdiction(shippingAddress, companyId, profile);
    
    // Get applicable tax rules for the jurisdiction
    let taxRules = await this.getApplicableTaxRules(jurisdiction, items, customer, companyId);

    // If no product/category rules exist, apply the company's default rates
    if (!taxRules.length) {
      taxRules = await this.buildDefaultRules(jurisdiction, companyId, profile);
    }
    
    // Check for customer exemptions
    const customerExemptions = await this.getCustomerExemptions(customer?.id, companyId);
    
    // Check for product exemptions
    const productExemptions = await this.getProductExemptions(items.map(i => i.productId), companyId);

    const defaultPricingModel = profile?.pricingModel || 'exclusive';
    
    // Calculate taxes for each item
    const itemTaxes = await Promise.all(
      items.map(item => this.calculateItemTax(
        item,
        taxRules,
        customerExemptions,
        productExemptions,
        jurisdiction,
        currency,
        defaultPricingModel
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
    
    if (persist) {
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
    }
    
    return {
      jurisdiction,
      itemTaxes,
      compoundTaxes,
      totals,
      currency,
      pricingModel: defaultPricingModel,
      regime: profile?.regime || null
    };
  }

  async getCompanyProfile(companyId) {
    return prisma.companyTaxProfile.findUnique({
      where: { companyId },
      include: { defaultJurisdiction: true }
    });
  }

  async buildDefaultRules(jurisdiction, companyId, profile) {
    if (!jurisdiction) return [];

    const now = new Date();
    const rates = await prisma.taxRate.findMany({
      where: {
        companyId,
        isActive: true,
        jurisdictionId: jurisdiction.id,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }]
      },
      include: { taxType: true, jurisdiction: true },
      orderBy: [{ isDefault: 'desc' }, { rate: 'desc' }]
    });

    const chosen = rates.filter((r) => r.isDefault);
    const apply = chosen.length ? chosen : rates.slice(0, 1);

    return apply.map((taxRate) => ({
      productId: null,
      productCategoryId: null,
      exemptionAllowed: true,
      pricingModel: profile?.pricingModel || 'exclusive',
      isCompound: taxRate.taxType?.isCompound || false,
      compoundOn: null,
      taxRate
    }));
  }

  /**
   * Determine tax jurisdiction based on address
   */
  async determineJurisdiction(address, companyId, profile) {
    if (profile?.defaultJurisdiction) {
      if (!address?.country) return profile.defaultJurisdiction;
    }

    if (!address) {
      const fallback = await prisma.taxJurisdiction.findFirst({
        where: { companyId, isDefault: true, isActive: true }
      });
      if (fallback) return fallback;
      return prisma.taxJurisdiction.findFirst({
        where: { companyId, isActive: true },
        orderBy: { createdAt: 'asc' }
      });
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

    if (jurisdiction) return jurisdiction;

    return prisma.taxJurisdiction.findFirst({
      where: { companyId, isDefault: true, isActive: true }
    });
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
          effectiveFrom: { lte: new Date() },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }]
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
  async calculateItemTax(item, taxRules, customerExemptions, productExemptions, jurisdiction, currency, defaultPricingModel = 'exclusive') {
    const { productId, quantity, unitPrice, pricingModel = defaultPricingModel } = item;
    
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

    const valid = taxTransactions.filter((t) => t.transactionId && t.jurisdictionId && t.taxTypeId && t.taxRateId);
    if (valid.length > 0) {
      await prisma.taxTransaction.createMany({
        data: valid,
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

  async recordFromDocument({ companyId, transactionId, transactionType, items, customerId, currency }) {
    try {
      await this.calculateTax({
        items: (items || []).map((item) => ({
          productId: item.productId,
          categoryId: item.categoryId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          pricingModel: item.pricingModel || 'exclusive'
        })),
        customer: customerId ? { id: customerId } : null,
        companyId,
        transactionType,
        transactionId,
        currency
      });
    } catch (error) {
      console.error('Tax ledger recording failed:', error.message);
    }
  }
}

module.exports = new TaxCalculationService();
