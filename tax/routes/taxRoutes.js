// tax/routes/taxRoutes.js
// Tax Management Routes for International Tax System

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const taxController = require('../controller/taxController');

router.use(protect);

router.get('/context', taxController.getTaxContext);
router.get('/overview', taxController.getTaxOverview);
router.put('/profile', taxController.upsertTaxProfile);
router.put('/enabled', taxController.setTaxEnabled);
router.post('/setup', taxController.setupCountryPack);

router.get('/jurisdictions', taxController.getTaxJurisdictions);
router.post('/jurisdictions', taxController.createTaxJurisdiction);
router.put('/jurisdictions/:id', taxController.updateTaxJurisdiction);

router.get('/types', taxController.getTaxTypes);
router.post('/types', taxController.createTaxType);
router.put('/types/:id', taxController.updateTaxType);

router.get('/rates', taxController.getAllTaxRates);
router.get('/rates/:jurisdictionId', taxController.getTaxRates);
router.post('/rates', taxController.createTaxRate);
router.put('/rates/:id', taxController.updateTaxRate);

router.get('/rules', taxController.getAllTaxRules);
router.get('/rules/:taxRateId', taxController.getTaxRules);
router.post('/rules', taxController.createTaxRule);

router.get('/exemption-types', taxController.getTaxExemptionTypes);
router.post('/exemption-types', taxController.createTaxExemptionType);

router.get('/exemptions', taxController.getAllTaxExemptions);
router.get('/exemptions/customer/:customerId', taxController.getCustomerTaxExemptions);
router.post('/exemptions', taxController.createTaxExemption);

router.post('/calculate', taxController.calculateTax);

router.get('/reports/liability', taxController.getTaxLiabilityReport);
router.get('/audit/:transactionId', taxController.getTaxAuditTrail);

module.exports = router;
