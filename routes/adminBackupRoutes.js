'use strict';

const router = require('express').Router();
const { protectOnly } = require('../middleware/authMiddleware');
const platformOwner = require('../middleware/platformOwnerMiddleware');
const ctrl = require('../controllers/adminBackupController');

// Cron can call run-scheduled without user JWT when X-Cron-Secret matches
router.post('/run-scheduled', (req, res, next) => {
  const cronSecret = process.env.BACKUP_CRON_SECRET || process.env.CRON_SECRET;
  const provided = req.headers['x-cron-secret'];
  if (cronSecret && provided && provided === cronSecret) {
    return ctrl.runScheduled(req, res);
  }
  return protectOnly(req, res, () => platformOwner(req, res, () => ctrl.runScheduled(req, res)));
});

router.use(protectOnly, platformOwner);

router.post('/full', ctrl.createFullBackup);
router.get('/', ctrl.listAdminBackups);
router.get('/schedule', ctrl.getSchedule);
router.put('/schedule', ctrl.updateSchedule);
router.get('/:id', ctrl.getAdminBackup);
router.get('/:id/download', ctrl.downloadAdminBackup);
router.post('/:id/restore', ctrl.restoreAdminBackup);
router.delete('/:id', ctrl.deleteAdminBackup);

module.exports = router;
