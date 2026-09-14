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

router.get('/payroll/me', wf.myPayroll);
router.get('/payroll/report', wf.payrollReport);
router.get('/payroll/run', wf.getPayrollRun);
router.put('/payroll/run', wf.savePayrollRun);
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

router.get('/documents', hcm.listDocuments);
router.post('/documents', hcm.saveDocument);

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

module.exports = router;
