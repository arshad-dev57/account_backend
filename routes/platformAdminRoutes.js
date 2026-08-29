const router = require('express').Router();
const { protect } = require('../middleware/authMiddleware');
const platformOwner = require('../middleware/platformOwnerMiddleware');
const ctrl = require('../controllers/platformAdminController');

router.get('/stats', protect, platformOwner, ctrl.getStats);
router.get('/companies', protect, platformOwner, ctrl.listCompanies);
router.get('/companies/:id', protect, platformOwner, ctrl.getCompany);
router.put('/companies/:id/status', protect, platformOwner, ctrl.updateCompanyStatus);

module.exports = router;
