// pos/controllers/posTerminalController.js
const prisma = require('../../prisma/client');

// @desc  Create terminal
// @route POST /api/pos/terminals
const createTerminal = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const createdBy = req.user.id;
    const { name, code, deviceInfo } = req.body;

    if (!name || !code) return res.status(400).json({ success: false, message: 'Terminal name and code are required' });
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Only admins can create terminals' });

    const existing = await prisma.pOSTerminal.findFirst({ where: { code, companyId } });
    if (existing) return res.status(409).json({ success: false, message: `Terminal code "${code}" already exists` });

    const terminal = await prisma.pOSTerminal.create({
      data: { name, code, deviceInfo: deviceInfo || null, companyId, createdBy }
    });
    res.status(201).json({ success: true, data: terminal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  List terminals
// @route GET /api/pos/terminals
const listTerminals = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { status } = req.query;
    const filter = { companyId, isDeleted: false };
    if (status) filter.status = status;

    const terminals = await prisma.pOSTerminal.findMany({
      where: filter,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { shifts: true } }
      }
    });
    res.json({ success: true, data: terminals });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateTerminal = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Only admins can update terminals' });

    const terminal = await prisma.pOSTerminal.findFirst({ where: { id, companyId } });
    if (!terminal) return res.status(404).json({ success: false, message: 'Terminal not found' });

    const { name, code, status, deviceInfo, isActive } = req.body;
    const updated = await prisma.pOSTerminal.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code }),
        ...(status !== undefined && { status }),
        ...(deviceInfo !== undefined && { deviceInfo }),
        ...(isActive !== undefined && { isActive }),
        lastSyncAt: new Date()
      }
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Delete terminal (soft)
// @route DELETE /api/pos/terminals/:id
const deleteTerminal = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Only admins can delete terminals' });
    const { id } = req.params;
    await prisma.pOSTerminal.update({ where: { id }, data: { isDeleted: true, isActive: false } });
    res.json({ success: true, message: 'Terminal disabled' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createTerminal, listTerminals, updateTerminal, deleteTerminal };
