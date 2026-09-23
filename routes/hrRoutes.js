const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const hr = require('../controllers/hrController');

router.use(protect);

router.get('/me', hr.getMe);
router.get('/dashboard', hr.dashboardStats);

router.get('/offices', hr.listOffices);
router.post('/offices', hr.createOffice);
router.put('/offices/:id', hr.updateOffice);

router.get('/employees', hr.listEmployees);
router.post('/employees', hr.createEmployee);
router.get('/employees/:id', hr.getEmployee);
router.put('/employees/:id', hr.updateEmployee);
router.delete('/employees/:id', hr.deleteEmployee);

router.get('/attendance', hr.listAttendance);
router.put('/attendance', hr.upsertAttendance);
router.post('/attendance/adjust', hr.upsertAttendance);
router.get('/attendance/me', hr.myAttendance);
router.post('/attendance/check-in', hr.checkIn);
router.post('/attendance/check-out', hr.checkOut);

router.post('/tracking', hr.trackingEvent);
router.get('/tracking', hr.liveTracking);

const wf = require('../controllers/hrWorkforceController');

router.get('/leaves', wf.listLeaves);
router.get('/leaves/me', wf.myLeaves);
router.post('/leaves', wf.createLeave);
router.put('/leaves/:id', wf.updateLeave);

router.get('/overtime', wf.listOvertime);
router.post('/overtime', wf.createOvertime);
router.put('/overtime/:id', wf.updateOvertime);

router.get('/tasks', wf.listTasks);
router.post('/tasks', wf.createTask);
router.put('/tasks/:id', wf.updateTask);

router.get('/performance', wf.listReviews);
router.post('/performance', wf.createReview);
router.put('/performance/:id', wf.updateReview);

const pp = require('../controllers/hrPayrollPeriodController');

router.get('/payroll/periods', pp.listPeriods);
router.post('/payroll/periods/ensure', pp.ensurePeriod);
router.get('/payroll/periods/:id', pp.getPeriod);
router.get('/payroll/periods/:id/validation', pp.getValidation);
router.post('/payroll/periods/:id/validate', pp.validatePeriod);
router.post('/payroll/periods/:id/calculate', pp.calculatePeriod);
router.get('/payroll/periods/:id/review', pp.getReview);
router.get('/payroll/periods/:id/register', pp.getRegister);
router.patch('/payroll/periods/:id/status', pp.transitionPeriod);

router.get('/payroll/me', wf.myPayroll);
router.get('/payroll/report', wf.payrollReport);
router.get('/payroll/run', wf.getPayrollRun);
router.put('/payroll/run', wf.savePayrollRun);
router.get('/payroll/payslip-pdf', wf.getPayslipPdf);
router.get('/payroll/bank-export', wf.exportBankFile);
router.post('/payroll/send-email', wf.sendEmailPayslip);
router.post('/payroll/send-whatsapp', wf.sendWhatsAppPayslip);
router.post('/payroll/bulk-send', wf.bulkSendPayslips);
router.patch('/payroll/:id/adjust', wf.adjustPayrollItem);
router.get('/payroll/:id', wf.getPayroll);
router.get('/payroll', wf.listPayroll);
router.post('/payroll/generate', wf.generatePayroll);
router.post('/payroll/bulk-status', wf.bulkPayrollStatus);
router.post('/payroll/item', wf.createPayrollItem);
router.put('/payroll/:id', wf.updatePayroll);

router.get('/org-chart', wf.orgChart);
router.get('/notifications', wf.notifications);
router.get('/settings', wf.getSettings);
router.put('/settings', wf.saveSettings);

const hcm = require('../controllers/hrHcmController');

router.get('/hcm/bootstrap', hcm.bootstrap);
router.get('/hcm/analytics', hcm.analytics);
router.get('/hcm/audit', hcm.listAudit);
router.get('/hcm/ess', hcm.myEss);
router.get('/hcm/team', hcm.myTeam);

const cc = require('../controllers/hrCostCenterController');

router.get('/cost-centers', cc.list);
router.get('/cost-centers/reports/summary', cc.summaryReport);
router.get('/cost-centers/reports/gl', cc.glReport);
router.get('/cost-centers/:id', cc.getById);
router.post('/cost-centers', cc.create);
router.put('/cost-centers/:id', cc.update);
router.patch('/cost-centers/:id/status', cc.setStatus);

router.get('/org/departments', hcm.listDepartments);
router.post('/org/departments', hcm.saveDepartment);
router.get('/org/designations', hcm.listDesignations);
router.post('/org/designations', hcm.saveDesignation);

router.get('/shift-plans', hcm.listShifts);
router.post('/shift-plans', hcm.saveShift);
router.get('/holiday-calendar', hcm.listHolidays);
router.post('/holiday-calendar', hcm.saveHoliday);

router.get('/leave-types', hcm.listLeaveTypes);
router.post('/leave-types', hcm.saveLeaveType);
router.get('/leave-balances', hcm.leaveBalances);

router.get('/attendance/report', hcm.attendanceReport);
router.get('/attendance/summary', hcm.attendanceSummary);
router.get('/attendance/corrections', hcm.listCorrections);
router.post('/attendance/corrections', hcm.createCorrection);
router.put('/attendance/corrections/:id', hcm.updateCorrection);

router.get('/roster', hcm.listRoster);
router.post('/roster', hcm.saveRoster);

router.get('/loans', hcm.listLoans);
router.post('/loans', hcm.saveLoan);
router.put('/loans/:id', hcm.updateLoan);
router.get('/bonuses', hcm.listBonuses);
router.post('/bonuses', hcm.saveBonus);
router.put('/bonuses/:id', hcm.updateBonus);

const docUpload = require('../controllers/hrDocumentUploadController');
const { hrDocumentUpload } = require('../config/hrDocumentUpload');

router.get('/documents', hcm.listDocuments);
router.post('/documents', hcm.saveDocument);
router.post('/documents/upload', hrDocumentUpload.single('file'), docUpload.uploadDocument);
router.post('/documents/:id/replace', hrDocumentUpload.single('file'), docUpload.replaceDocument);
router.get('/documents/:id/versions', docUpload.getDocumentVersions);
router.get('/documents/:id/download', docUpload.downloadDocument);
router.patch('/documents/:id/status', hcm.updateDocumentStatus);
router.delete('/documents/:id', docUpload.deleteDocument);

router.get('/lifecycle', hcm.listLifecycle);
router.post('/lifecycle', hcm.saveLifecycle);

router.get('/employees/:id/dossier', hcm.employeeDossier);
router.put('/employees/:id/profile', hcm.updateProfile);

router.get('/approvals', hcm.listApprovals);
router.put('/approvals/:id', hcm.updateApproval);

router.get('/goals', hcm.listGoals);
router.post('/goals', hcm.saveGoal);
router.get('/feedback', hcm.listFeedback);
router.post('/feedback', hcm.saveFeedback);

// ============================================================
// DEDICATED HR PRINT, BRANDING, SIGNATORY & TEMPLATE ROUTES
// ============================================================
const printCtrl = require('../controllers/hrPrintSettingController');
const templateCtrl = require('../controllers/hrDocumentTemplateController');
const generatorCtrl = require('../controllers/hrDocumentGeneratorController');
const { hrAssetUpload } = require('../config/hrAssetUpload');

// Print Settings & Branding
router.get('/print-settings', printCtrl.getPrintSettings);
router.put('/print-settings', printCtrl.updatePrintSettings);
router.post(
  '/print-settings/branding',
  hrAssetUpload.fields([
    { name: 'primaryLogo', maxCount: 1 },
    { name: 'secondaryLogo', maxCount: 1 },
    { name: 'officialStamp', maxCount: 1 }
  ]),
  printCtrl.uploadBrandingAssets
);
router.delete('/print-settings/branding/:assetKey', printCtrl.removeBrandingAsset);

// Dynamic Signature Library
router.post(
  '/print-settings/signatories',
  hrAssetUpload.fields([
    { name: 'signature', maxCount: 1 },
    { name: 'stamp', maxCount: 1 }
  ]),
  printCtrl.createSignatory
);
router.patch(
  '/print-settings/signatories/:id',
  hrAssetUpload.fields([
    { name: 'signature', maxCount: 1 },
    { name: 'stamp', maxCount: 1 }
  ]),
  printCtrl.updateSignatory
);
router.delete('/print-settings/signatories/:id', printCtrl.deleteSignatory);

// Document & Letter Templates
router.get('/templates', templateCtrl.listTemplates);
router.get('/templates/:id', templateCtrl.getTemplate);
router.post('/templates', templateCtrl.createTemplate);
router.patch('/templates/:id', templateCtrl.updateTemplate);
router.post('/templates/:id/publish', templateCtrl.publishTemplate);
router.post('/templates/:id/duplicate', templateCtrl.duplicateTemplate);

// Document Generator & Snapshots
router.post('/documents/generate', generatorCtrl.generateDocument);
router.get('/documents/generated/:id', generatorCtrl.getGeneratedDocument);

module.exports = router;
