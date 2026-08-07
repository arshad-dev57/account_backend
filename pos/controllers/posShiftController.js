// pos/controllers/posShiftController.js
const POSShiftModel = require('../models/POSShift');

const openShift = async (req, res) => {
  try {
    const { terminalId, openingCash, notes } = req.body;
    if (!terminalId || openingCash === undefined) {
      return res.status(400).json({ success: false, message: 'terminalId and openingCash are required' });
    }
    const shift = await POSShiftModel.openShift({
      terminalId, cashierId: req.user.id, companyId: req.user.companyId, openingCash: parseFloat(openingCash), notes
    });
    res.status(201).json({ success: true, data: shift });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const closeShift = async (req, res) => {
  try {
    const { shiftId } = req.params;
    const { actualCash, notes } = req.body;
    if (actualCash === undefined) return res.status(400).json({ success: false, message: 'actualCash is required' });
    const shift = await POSShiftModel.closeShift({
      shiftId, cashierId: req.user.id, companyId: req.user.companyId, actualCash: parseFloat(actualCash), notes, role: req.user.role
    });
    res.json({ success: true, data: shift });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const suspendShift = async (req, res) => {
  try {
    const { shiftId } = req.params;
    const shift = await POSShiftModel.suspendShift({ shiftId, cashierId: req.user.id, companyId: req.user.companyId });
    res.json({ success: true, data: shift });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const resumeShift = async (req, res) => {
  try {
    const { shiftId } = req.params;
    const shift = await POSShiftModel.resumeShift({ shiftId, cashierId: req.user.id, companyId: req.user.companyId });
    res.json({ success: true, data: shift });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const reopenShift = async (req, res) => {
  try {
    const { shiftId } = req.params;
    if (!['manager','admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only managers or admins can reopen shifts' });
    }
    const shift = await POSShiftModel.reopenShift({ shiftId, companyId: req.user.companyId, approvedBy: req.user.id, role: req.user.role });
    res.json({ success: true, data: shift });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const recordCashFlow = async (req, res) => {
  try {
    const { shiftId, type, amount, reason, approvedBy } = req.body;
    if (!shiftId || !type || !amount || !reason) {
      return res.status(400).json({ success: false, message: 'shiftId, type, amount, reason are required' });
    }
    if (!['CASH_IN','CASH_OUT'].includes(type)) {
      return res.status(400).json({ success: false, message: 'type must be CASH_IN or CASH_OUT' });
    }
    const record = await POSShiftModel.recordCashTransaction({
      shiftId, type, amount: parseFloat(amount), reason, approvedBy: approvedBy || null,
      companyId: req.user.companyId, createdBy: req.user.id
    });
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getCurrentShift = async (req, res) => {
  try {
    const shift = await POSShiftModel.getCurrentShift(req.user.id, req.user.companyId);
    const stats = shift ? await POSShiftModel.getShiftStats(shift.id, req.user.companyId) : null;
    res.json({ success: true, data: shift, stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getShiftHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20, cashierId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const result = await POSShiftModel.getHistory(req.user.companyId, { skip, take: parseInt(limit), cashierId });
    res.json({ success: true, ...result, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { openShift, closeShift, suspendShift, resumeShift, reopenShift, recordCashFlow, getCurrentShift, getShiftHistory };
