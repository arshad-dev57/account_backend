'use strict';

const {
  requireCompany,
  requireHrManager
} = require('../utils/hrAccess');
const periodService = require('../services/hrPayrollPeriodService');
const payrollEngine = require('../services/hrPayrollEngine');

exports.listPeriods = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    const data = await periodService.listPayPeriods(companyId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[hr] listPeriods', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.ensurePeriod = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const periodKey = String(req.body.periodKey || req.body.period || payrollEngine.currentPeriod());
    const row = await periodService.ensurePayPeriod(companyId, periodKey, {
      payDate: req.body.payDate,
      branchId: req.body.branchId || null,
      frequency: req.body.frequency
    });
    res.json({ success: true, data: row });
  } catch (error) {
    console.error('[hr] ensurePeriod', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPeriod = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    const data = await periodService.getPayPeriod(companyId, req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Pay period not found' });
    }
    res.json({
      success: true,
      data,
      period: data.periodKey,
      periodLabel: payrollEngine.periodLabel(data.periodKey)
    });
  } catch (error) {
    console.error('[hr] getPeriod', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.validatePeriod = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const mode = String(req.body.mode || req.query.mode || 'all').toLowerCase();
    const validation = await periodService.validatePayPeriodForPeriod(
      companyId,
      req.params.id,
      mode
    );
    res.json({ success: true, ...validation });
  } catch (error) {
    console.error('[hr] validatePeriod', error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.getValidation = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    const mode = String(req.query.mode || 'all').toLowerCase();
    const validation = await periodService.validatePayPeriodForPeriod(
      companyId,
      req.params.id,
      mode
    );
    res.json({ success: true, ...validation });
  } catch (error) {
    console.error('[hr] getValidation', error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.calculatePeriod = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const mode = String(req.body.mode || 'all').toLowerCase();
    const force = req.body.force === true;
    const result = await periodService.calculatePayPeriod({
      companyId,
      payPeriodId: req.params.id,
      initiatedById: req.user?.id,
      mode,
      force
    });
    res.json({
      success: true,
      data: result.items,
      payPeriod: result.payPeriod,
      run: result.run,
      validation: result.validation,
      period: result.payPeriod.periodKey,
      periodLabel: payrollEngine.periodLabel(result.payPeriod.periodKey),
      summary: result.summary
    });
  } catch (error) {
    console.error('[hr] calculatePeriod', error);
    if (error.code === 'VALIDATION_FAILED') {
      return res.status(400).json({
        success: false,
        message: error.message,
        validation: error.validation
      });
    }
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.getReview = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    const data = await periodService.getPayrollReview(companyId, req.params.id);
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('[hr] getReview', error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.getRegister = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    const data = await periodService.getPayRegister(companyId, req.params.id);
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('[hr] getRegister', error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.transitionPeriod = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const status = String(req.body.status || '').toUpperCase();
    const data = await periodService.updatePayPeriodStatus(companyId, req.params.id, status);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[hr] transitionPeriod', error);
    res.status(error.code === 'INVALID_PERIOD_STATUS' ? 400 : 500).json({
      success: false,
      message: error.message
    });
  }
};
