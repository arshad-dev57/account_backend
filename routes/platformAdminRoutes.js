const router = require('express').Router();
const { protectOnly } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/platformAdminController');
const { getSubscriptionStats } = require('../controllers/subscriptionController');

router.get('/stats', protectOnly, ctrl.getStats);
router.get('/subscription-stats', protectOnly, getSubscriptionStats);
router.get('/companies', protectOnly, ctrl.listCompanies);
router.get('/companies/:id', protectOnly, ctrl.getCompany);
router.put('/companies/:id/status', protectOnly, ctrl.updateCompanyStatus);
router.put('/companies/:id/subscription', protectOnly, ctrl.updateCompanySubscription);

module.exports = router;
