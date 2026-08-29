// pos/controllers/posTerminalController.js
const prisma = require('../../prisma/client');

/**
 * Ensure each location has at least one active POS terminal.
 * Used so cashiers assigned to a warehouse can open a shift without
 * waiting for an admin to manually create a terminal.
 */
async function ensureTerminalsForLocations(companyId, createdBy, locationIds) {
  const ids = [...new Set((locationIds || []).map(String).filter(Boolean))];
  if (!ids.length) return [];

  const locations = await prisma.location.findMany({
    where: { companyId, isDeleted: false, id: { in: ids } },
    select: { id: true, name: true, code: true, type: true },
  });

  const created = [];
  for (const loc of locations) {
    const existing = await prisma.pOSTerminal.findFirst({
      where: { companyId, locationId: loc.id, isDeleted: false },
      select: { id: true },
    });
    if (existing) continue;

    const baseCode = String(loc.code || loc.name || 'POS')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 8) || 'POS';
    let code = `${baseCode}-T1`;
    let n = 1;
    while (await prisma.pOSTerminal.findFirst({ where: { companyId, code } })) {
      n += 1;
      code = `${baseCode}-T${n}`;
      if (n > 50) {
        code = `T-${loc.id.slice(0, 8).toUpperCase()}`;
        break;
      }
    }

    const terminal = await prisma.pOSTerminal.create({
      data: {
        name: `${loc.name} Counter`,
        code,
        companyId,
        createdBy,
        locationId: loc.id,
        isActive: true,
        status: 'Active',
      },
      include: {
        location: { select: { id: true, name: true, code: true, type: true } },
        creator: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { shifts: true } },
      },
    });
    created.push(terminal);
    console.log(`[terminals] auto-created ${code} for location ${loc.name} (${loc.id})`);
  }
  return created;
}

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

    // Non-admin users only see terminals at their assigned locations
    const scope = req.locationScope;
    let allowedLocationIds = null;
    if (scope && !scope.isAdmin) {
      const allowed = Array.isArray(scope.ids) ? scope.ids : [];
      if (allowed.length === 0) {
        return res.json({ success: true, data: [] });
      }
      if (locId && !allowed.includes(locId)) {
        return res.status(403).json({ success: false, message: 'You do not have access to this location' });
      }
      if (!locId) {
        filter.locationId = { in: allowed };
      }
      allowedLocationIds = locId ? [locId] : allowed;
    } else if (locId) {
      allowedLocationIds = [locId];
    }

    let terminals = await prisma.pOSTerminal.findMany({
      where: filter,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, firstName: true, lastName: true } },
        location: { select: { id: true, name: true, code: true, type: true } },
        _count: { select: { shifts: true } }
      }
    });

    // Extra safety: drop any terminal whose location is outside user scope
    let visible = scope && !scope.isAdmin
      ? terminals.filter((t) => t.locationId && (scope.ids || []).includes(t.locationId))
      : terminals;

    // Auto-create a default terminal when a location has none yet
    // (common after assigning a warehouse to a new cashier)
    if (allowedLocationIds && allowedLocationIds.length) {
      const covered = new Set(visible.map((t) => t.locationId).filter(Boolean));
      const missing = allowedLocationIds.filter((id) => !covered.has(id));
      if (missing.length) {
        const created = await ensureTerminalsForLocations(companyId, req.user.id, missing);
        if (created.length) {
          visible = [...created, ...visible];
        }
      }
    }

    res.json({ success: true, data: visible });
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
