'use strict';

const router = require('express').Router();
const { protect } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/backupController');

router.use(protect);

router.get('/companies', ctrl.listBackupCompanies);
router.post('/', ctrl.createCompanyBackup);
router.get('/', ctrl.listCompanyBackups);
router.get('/:id', ctrl.getCompanyBackup);
router.get('/:id/download', ctrl.downloadCompanyBackup);
router.post('/:id/validate', ctrl.validateCompanyBackup);
router.post('/:id/restore', ctrl.restoreCompanyBackupHandler);
router.delete('/:id', ctrl.deleteCompanyBackup);

module.exports = router;
