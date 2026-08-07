// tax/routes/taxRoutes.js
// Tax Management Routes for International Tax System

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const taxController = require('../controller/taxController');

// Apply authentication middleware to all routes
router.use(protect);

// ============================================================
// TAX JURISDICTION ROUTES
// ============================================================
router.get('/jurisdictions', taxController.getTaxJurisdictions);
router.post('/jurisdictions', taxController.createTaxJurisdiction);

// ============================================================
// TAX TYPE ROUTES
// ============================================================
router.get('/types', taxController.getTaxTypes);
router.post('/types', taxController.createTaxType);

// ============================================================
// TAX RATE ROUTES
// ============================================================
router.get('/rates/:jurisdictionId', taxController.getTaxRates);
router.post('/rates', taxController.createTaxRate);

// ============================================================
// TAX RULE ROUTES
// ============================================================
router.get('/rules/:taxRateId', taxController.getTaxRules);
router.post('/rules', taxController.createTaxRule);

// ============================================================
// TAX EXEMPTION TYPE ROUTES
// ============================================================
router.get('/exemption-types', taxController.getTaxExemptionTypes);
router.post('/exemption-types', taxController.createTaxExemptionType);

// ============================================================
// TAX EXEMPTION ROUTES
// ============================================================
router.get('/exemptions/customer/:customerId', taxController.getCustomerTaxExemptions);
router.post('/exemptions', taxController.createTaxExemption);

// ============================================================
// TAX CALCULATION ROUTES
// ============================================================
router.post('/calculate', taxController.calculateTax);

// ============================================================
// TAX REPORTING ROUTES
// ============================================================
router.get('/reports/liability', taxController.getTaxLiabilityReport);
router.get('/audit/:transactionId', taxController.getTaxAuditTrail);

module.exports = router;
