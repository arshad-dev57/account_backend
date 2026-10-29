const express = require('express');
const router = express.Router();
const hr = require('../controllers/hrController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const { isHrAdminRole } = require('../utils/hrAccess');

// Every write and status transition is checked against its key in the central
// permission catalog. The legacy HR admin roles keep passing until the grants
// are configured on every deployed role, so existing teams are not locked out
// by this change.
const can = (key) => async (req, res, next) => {
  if (isHrAdminRole(req.user?.role)) return next();
  return requirePermission(key)(req, res, next);
};

router.use(protect);

router.get('/me', hr.getMe);
router.get('/dashboard', hr.dashboardStats);

router.get('/offices', hr.listOffices);
router.post('/offices', can('hr.offices.create'), hr.createOffice);
router.put('/offices/:id', can('hr.offices.edit'), hr.updateOffice);

router.get('/employees', hr.listEmployees);
router.post('/employees', can('hr.employees.create'), hr.createEmployee);
router.get('/employees/:id', hr.getEmployee);
router.put('/employees/:id', can('hr.employees.edit'), hr.updateEmployee);
router.post('/employees/:id/grant-access', can('hr.employees.edit'), hr.grantApplicationAccess);
router.post('/employees/:id/revoke-access', can('hr.employees.edit'), hr.revokeApplicationAccess);
router.delete('/employees/:id', can('hr.employees.delete'), hr.deleteEmployee);

router.get('/attendance', hr.listAttendance);
router.put('/attendance', can('hr.attendance.edit'), hr.upsertAttendance);
router.post('/attendance/adjust', can('hr.attendance.edit'), hr.upsertAttendance);
router.get('/attendance/me', hr.myAttendance);
router.post('/attendance/check-in', hr.checkIn);
router.post('/attendance/check-out', hr.checkOut);

router.post('/tracking', hr.trackingEvent);
router.get('/tracking', can('hr.live_tracking.view'), hr.liveTracking);

const hrDocs = require('../controllers/hrDocumentController');
const hrReports = require('../controllers/hrReportController');

// ERPNext-shaped workspaces and document endpoints
router.use(['/workspaces', '/docs', '/link-options'], hrDocs.loadPermissions);
router.get('/workspaces', hrDocs.workspaces);
router.get('/workspaces/:slug/dashboard', hrDocs.dashboard);
router.get('/workspaces/:slug/charts', hrDocs.charts);
router.get('/docs', hrDocs.documents);
router.get('/link-options/:target', hrDocs.options);
router.get('/docs/:resource', hrDocs.list);
router.post('/docs/:resource', hrDocs.create);
router.get('/docs/:resource/meta', hrDocs.document);
router.get('/docs/:resource/:id', hrDocs.detail);
router.put('/docs/:resource/:id', hrDocs.update);
router.delete('/docs/:resource/:id', hrDocs.remove);
router.get('/docs/:resource/:id/timeline', hrDocs.timeline);
router.post('/docs/:resource/:id/comment', hrDocs.comment);
router.post('/docs/:resource/:id/action/:key', hrDocs.action);
router.post('/docs/:resource/:id/button/:key', hrDocs.button);

// The reports each workspace sidebar links under "Reports"
router.get('/reports', hrReports.index);
router.get('/reports/:report', hrReports.run);

// ERPNext Shift Assignment Tool (Single)
const shiftTool = require('../controllers/hrShiftAssignmentToolController');
router.use('/tools/shift-assignment', shiftTool.loadPermissions);
router.post('/tools/shift-assignment/employees', can('hr.shifts.create'), shiftTool.getEmployees);
router.post('/tools/shift-assignment/bulk-assign', can('hr.shifts.create'), shiftTool.bulkAssign);
router.post('/tools/shift-assignment/process-requests', can('hr.shifts.edit'), shiftTool.processRequests);

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
router.post('/payroll/periods/ensure', can('hr.payroll.create'), pp.ensurePeriod);
router.get('/payroll/periods/:id', pp.getPeriod);
router.get('/payroll/periods/:id/validation', pp.getValidation);
router.post('/payroll/periods/:id/validate', can('hr.payroll.approve'), pp.validatePeriod);
router.post('/payroll/periods/:id/calculate', can('hr.payroll.create'), pp.calculatePeriod);
router.get('/payroll/periods/:id/review', pp.getReview);
router.get('/payroll/periods/:id/register', pp.getRegister);
router.patch('/payroll/periods/:id/status', can('hr.payroll.approve'), pp.transitionPeriod);

router.get('/payroll/me', wf.myPayroll);
router.get('/payroll/report', wf.payrollReport);
router.get('/payroll/run', wf.getPayrollRun);
router.put('/payroll/run', can('hr.payroll.create'), wf.savePayrollRun);
router.get('/payroll/payslip-pdf', wf.getPayslipPdf);
router.get('/payroll/bank-export', wf.exportBankFile);
router.post('/payroll/send-email', can('hr.payroll.create'), wf.sendEmailPayslip);
router.post('/payroll/send-whatsapp', can('hr.payroll.create'), wf.sendWhatsAppPayslip);
router.post('/payroll/bulk-send', can('hr.payroll.create'), wf.bulkSendPayslips);
router.patch('/payroll/:id/adjust', can('hr.payroll.edit'), wf.adjustPayrollItem);
router.get('/payroll/:id', wf.getPayroll);
router.get('/payroll', wf.listPayroll);
router.post('/payroll/generate', can('hr.payroll.create'), wf.generatePayroll);
router.post('/payroll/bulk-status', can('hr.payroll.approve'), wf.bulkPayrollStatus);
router.post('/payroll/item', can('hr.salary.create'), wf.createPayrollItem);
router.put('/payroll/:id', can('hr.salary.edit'), wf.updatePayroll);

router.get('/org-chart', wf.orgChart);
router.get('/notifications', wf.notifications);
router.get('/settings', wf.getSettings);
router.put('/settings', can('hr.settings.edit'), wf.saveSettings);

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
router.post('/org/departments', can('hr.departments.create'), hcm.saveDepartment);
router.get('/org/designations', hcm.listDesignations);
router.post('/org/designations', can('hr.departments.create'), hcm.saveDesignation);

router.get('/shift-plans', hcm.listShifts);
router.post('/shift-plans', can('hr.shifts.create'), hcm.saveShift);
router.get('/holiday-calendar', hcm.listHolidays);
router.post('/holiday-calendar', can('hr.holidays.create'), hcm.saveHoliday);

router.get('/leave-types', hcm.listLeaveTypes);
router.post('/leave-types', can('hr.leave_policies.create'), hcm.saveLeaveType);
router.get('/leave-balances', hcm.leaveBalances);

router.get('/attendance/report', hcm.attendanceReport);
router.get('/attendance/summary', hcm.attendanceSummary);
router.get('/attendance/corrections', hcm.listCorrections);
router.post('/attendance/corrections', hcm.createCorrection);
router.put('/attendance/corrections/:id', can('hr.attendance.approve'), hcm.updateCorrection);

router.get('/roster', hcm.listRoster);
router.post('/roster', can('hr.roster.create'), hcm.saveRoster);

router.get('/loans', hcm.listLoans);
router.post('/loans', can('hr.loans.create'), hcm.saveLoan);
router.put('/loans/:id', can('hr.loans.edit'), hcm.updateLoan);
router.get('/bonuses', hcm.listBonuses);
router.post('/bonuses', can('hr.bonuses.create'), hcm.saveBonus);
router.put('/bonuses/:id', can('hr.bonuses.edit'), hcm.updateBonus);

const docUpload = require('../controllers/hrDocumentUploadController');
const { hrDocumentUpload } = require('../config/hrDocumentUpload');

router.get('/documents', hcm.listDocuments);
router.post('/documents', can('hr.documents.create'), hcm.saveDocument);
router.post('/documents/upload', can('hr.documents.create'), hrDocumentUpload.single('file'), docUpload.uploadDocument);
router.post('/documents/:id/replace', can('hr.documents.edit'), hrDocumentUpload.single('file'), docUpload.replaceDocument);
router.get('/documents/:id/versions', docUpload.getDocumentVersions);
router.get('/documents/:id/download', docUpload.downloadDocument);
router.patch('/documents/:id/status', can('hr.documents.edit'), hcm.updateDocumentStatus);
router.delete('/documents/:id', can('hr.documents.delete'), docUpload.deleteDocument);

router.get('/lifecycle', hcm.listLifecycle);
router.post('/lifecycle', can('hr.lifecycle.create'), hcm.saveLifecycle);

router.get('/employees/:id/dossier', hcm.employeeDossier);
router.put('/employees/:id/profile', hcm.updateProfile);

router.get('/approvals', hcm.listApprovals);
router.put('/approvals/:id', can('hr.approvals.approve'), hcm.updateApproval);

router.get('/goals', hcm.listGoals);
router.post('/goals', can('hr.performance.create'), hcm.saveGoal);
router.get('/feedback', hcm.listFeedback);
router.post('/feedback', can('hr.performance.create'), hcm.saveFeedback);

// ============================================================
// DEDICATED HR PRINT, BRANDING, SIGNATORY & TEMPLATE ROUTES
// ============================================================
const printCtrl = require('../controllers/hrPrintSettingController');
const templateCtrl = require('../controllers/hrDocumentTemplateController');
const generatorCtrl = require('../controllers/hrDocumentGeneratorController');
const { hrAssetUpload } = require('../config/hrAssetUpload');

// Print Settings & Branding
router.get('/print-settings', printCtrl.getPrintSettings);
router.put('/print-settings', can('hr.settings.edit'), printCtrl.updatePrintSettings);
router.post(
  '/print-settings/branding',
  can('hr.settings.edit'),
  hrAssetUpload.fields([
    { name: 'primaryLogo', maxCount: 1 },
    { name: 'secondaryLogo', maxCount: 1 },
    { name: 'officialStamp', maxCount: 1 }
  ]),
  printCtrl.uploadBrandingAssets
);
router.delete('/print-settings/branding/:assetKey', can('hr.settings.edit'), printCtrl.removeBrandingAsset);

// Dynamic Signature Library
router.post(
  '/print-settings/signatories',
  can('hr.settings.edit'),
  hrAssetUpload.fields([
    { name: 'signature', maxCount: 1 },
    { name: 'stamp', maxCount: 1 }
  ]),
  printCtrl.createSignatory
);
router.patch(
  '/print-settings/signatories/:id',
  can('hr.settings.edit'),
  hrAssetUpload.fields([
    { name: 'signature', maxCount: 1 },
    { name: 'stamp', maxCount: 1 }
  ]),
  printCtrl.updateSignatory
);
router.delete('/print-settings/signatories/:id', can('hr.settings.edit'), printCtrl.deleteSignatory);

// Document & Letter Templates
router.get('/templates', templateCtrl.listTemplates);
router.get('/templates/:id', templateCtrl.getTemplate);
router.post('/templates', can('hr.documents.create'), templateCtrl.createTemplate);
router.patch('/templates/:id', can('hr.documents.edit'), templateCtrl.updateTemplate);
router.post('/templates/:id/publish', can('hr.documents.edit'), templateCtrl.publishTemplate);
router.post('/templates/:id/duplicate', can('hr.documents.create'), templateCtrl.duplicateTemplate);

// Document Generator & Snapshots
router.post('/documents/generate', can('hr.documents.create'), generatorCtrl.generateDocument);
router.get('/documents/generated/:id', generatorCtrl.getGeneratedDocument);

module.exports = router;
