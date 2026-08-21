// pos/controllers/posTerminalController.js
const prisma = require('../../prisma/client');

// @desc  Create terminal
// @route POST /api/pos/terminals
const createTerminal = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const createdBy = req.user.id;
    const { name, code, deviceInfo, locationId } = req.body;
    const { normalizeLocationId } = require('../../utils/accountingLocationHelper');
    const locId = normalizeLocationId(locationId);

    if (!name || !code) return res.status(400).json({ success: false, message: 'Terminal name and code are required' });
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Only admins can create terminals' });
    if (!locId) {
      return res.status(400).json({
        success: false,
        message: 'locationId (warehouse/shop) is required for terminal',
      });
    }

    const location = await prisma.location.findFirst({
      where: { id: locId, companyId, isDeleted: false, isActive: true },
      select: { id: true },
    });
    if (!location) {
      return res.status(400).json({ success: false, message: 'Location not found' });
    }

    const existing = await prisma.pOSTerminal.findFirst({ where: { code, companyId } });
    if (existing) return res.status(409).json({ success: false, message: `Terminal code "${code}" already exists` });

    const terminal = await prisma.pOSTerminal.create({
      data: {
        name,
        code,
        deviceInfo: deviceInfo || null,
        companyId,
        createdBy,
        locationId: locId,
      },
      include: {
        location: { select: { id: true, name: true, code: true, type: true } },
      },
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
    const { status, locationId } = req.query;
    const { normalizeLocationId } = require('../../utils/accountingLocationHelper');
    const locId = normalizeLocationId(locationId);
    const filter = { companyId, isDeleted: false };
    if (status) filter.status = status;
    if (locId) filter.locationId = locId;

    const terminals = await prisma.pOSTerminal.findMany({
      where: filter,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, firstName: true, lastName: true } },
        location: { select: { id: true, name: true, code: true, type: true } },
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

    const { name, code, status, deviceInfo, isActive, locationId } = req.body;
    const { normalizeLocationId } = require('../../utils/accountingLocationHelper');
    const data = {
      ...(name !== undefined && { name }),
      ...(code !== undefined && { code }),
      ...(status !== undefined && { status }),
      ...(deviceInfo !== undefined && { deviceInfo }),
      ...(isActive !== undefined && { isActive }),
      lastSyncAt: new Date()
    };

    if (locationId !== undefined) {
      const locId = normalizeLocationId(locationId);
      if (!locId) {
        return res.status(400).json({ success: false, message: 'Valid locationId is required' });
      }
      const location = await prisma.location.findFirst({
        where: { id: locId, companyId, isDeleted: false },
        select: { id: true },
      });
      if (!location) {
        return res.status(400).json({ success: false, message: 'Location not found' });
      }
      data.locationId = locId;
    }

    const updated = await prisma.pOSTerminal.update({
      where: { id },
      data,
      include: {
        location: { select: { id: true, name: true, code: true, type: true } },
      },
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
