'use strict';

const router = require('express').Router();
const { protectOnly } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/companyController');

router.get('/mine', protectOnly, ctrl.listMyCompanies);
router.post('/', protectOnly, ctrl.createCompany);
router.put('/active', protectOnly, ctrl.setPrimaryCompany);
router.get('/consolidated-dashboard', protectOnly, ctrl.consolidatedDashboard);
router.get('/business-config', protectOnly, ctrl.getBusinessConfig);
router.patch('/business-config', protectOnly, ctrl.updateBusinessConfig);

module.exports = router;
