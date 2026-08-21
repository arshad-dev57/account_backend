// pos/models/POSShift.js — Shift & Cash Drawer Management
const prisma = require('../../prisma/client');

class POSShiftModel {

  // ============================================================
  // OPEN SHIFT
  // ============================================================
  static async openShift({ terminalId, cashierId, companyId, openingCash, notes }) {
    // Check if cashier already has an open shift
    const existing = await prisma.pOSShift.findFirst({
      where: { cashierId, companyId, status: { in: ['Open', 'Suspended'] } }
    });
    if (existing) throw new Error('You already have an open or suspended shift. Please close it first.');

    // Verify terminal exists & is active
    const terminal = await prisma.pOSTerminal.findFirst({
      where: { id: terminalId, companyId, isActive: true, isDeleted: false }
    });
    if (!terminal) throw new Error('Terminal not found or inactive');

    // Prevent two cashiers opening the same terminal
    const terminalBusy = await prisma.pOSShift.findFirst({
      where: {
        terminalId,
        companyId,
        status: { in: ['Open', 'Suspended'] }
      },
      include: {
        cashier: { select: { firstName: true, lastName: true } }
      }
    });
    if (terminalBusy) {
      const name = `${terminalBusy.cashier?.firstName || ''} ${terminalBusy.cashier?.lastName || ''}`.trim();
      throw new Error(
        `Terminal is already in use${name ? ` by ${name}` : ''}. Close or suspend that shift first.`
      );
    }

    const shift = await prisma.pOSShift.create({
      data: { terminalId, cashierId, companyId, openingCash, notes: notes || null, status: 'Open' },
      include: {
        terminal: {
          include: {
            location: { select: { id: true, name: true, code: true, type: true } },
          },
        },
        cashier: { select: { id:true, firstName:true, lastName:true, email:true } },
      },
    });

    await prisma.pOSAuditLog.create({
      data: { action: 'Shift Open', details: `Shift opened on terminal ${terminal.name} with opening cash ${openingCash}`, companyId, createdBy: cashierId }
    });

    return shift;
  }

  // ============================================================
  // CLOSE SHIFT
  // ============================================================
  static async closeShift({ shiftId, cashierId, companyId, actualCash, notes, role }) {
    const shift = await prisma.pOSShift.findFirst({ where: { id: shiftId, companyId } });
    if (!shift) throw new Error('Shift not found');
    if (shift.status === 'Closed') throw new Error('Shift is already closed');

    // Only cashier who owns it or manager/admin can close
    if (shift.cashierId !== cashierId && !['manager','admin'].includes(role)) {
      throw new Error('You are not authorized to close this shift');
    }

    // Calculate expected cash
    const cashIn  = await prisma.pOSCashTransaction.aggregate({ where: { shiftId, type: 'CASH_IN'  }, _sum: { amount: true } });
    const cashOut = await prisma.pOSCashTransaction.aggregate({ where: { shiftId, type: 'CASH_OUT' }, _sum: { amount: true } });
    const cashSales = await prisma.pOSSalePayment.aggregate({
      where: { posSale: { shiftId }, paymentMethod: { equals: 'Cash', mode: 'insensitive' } },
      _sum: { amount: true }
    });
    const refunds = await prisma.pOSReturn.aggregate({
      where: { shiftId, refundMethod: { contains: 'cash', mode: 'insensitive' } },
      _sum: { refundedAmount: true }
    });

    const expectedCash = shift.openingCash
      + (cashIn._sum.amount  || 0)
      + (cashSales._sum.amount || 0)
      - (cashOut._sum.amount || 0)
      - (refunds._sum.refundedAmount || 0);

    const difference = actualCash - expectedCash;

    const updatedShift = await prisma.pOSShift.update({
      where: { id: shiftId },
      data: { status: 'Closed', closedAt: new Date(), closingCash: actualCash, expectedCash, actualCash, difference, notes: notes || shift.notes },
      include: { terminal: true, cashier: { select: { id:true, firstName:true, lastName:true } } }
    });

    await prisma.pOSAuditLog.create({
      data: { action: 'Shift Close', details: `Shift closed. Expected: ${expectedCash.toFixed(2)}, Actual: ${actualCash}, Difference: ${difference.toFixed(2)}`, companyId, createdBy: cashierId }
    });

    return updatedShift;
  }

  // ============================================================
  // SUSPEND SHIFT
  // ============================================================
  static async suspendShift({ shiftId, cashierId, companyId }) {
    const shift = await prisma.pOSShift.findFirst({ where: { id: shiftId, companyId } });
    if (!shift) throw new Error('Shift not found');
    if (shift.status !== 'Open') throw new Error('Only open shifts can be suspended');
    if (shift.cashierId !== cashierId) throw new Error('You cannot suspend another cashier\'s shift');

    return prisma.pOSShift.update({
      where: { id: shiftId },
      data: { status: 'Suspended', suspendedAt: new Date() }
    });
  }

  // ============================================================
  // RESUME SHIFT
  // ============================================================
  static async resumeShift({ shiftId, cashierId, companyId }) {
    const shift = await prisma.pOSShift.findFirst({ where: { id: shiftId, companyId } });
    if (!shift) throw new Error('Shift not found');
    if (shift.status !== 'Suspended') throw new Error('Only suspended shifts can be resumed');
    if (shift.cashierId !== cashierId) throw new Error('You cannot resume another cashier\'s shift');

    return prisma.pOSShift.update({
      where: { id: shiftId },
      data: { status: 'Open', resumedAt: new Date() }
    });
  }

  // ============================================================
  // REOPEN SHIFT (Manager/Admin only)
  // ============================================================
  static async reopenShift({ shiftId, companyId, approvedBy, role }) {
    if (!['manager','admin'].includes(role)) throw new Error('Only managers or admins can reopen shifts');
    const shift = await prisma.pOSShift.findFirst({ where: { id: shiftId, companyId } });
    if (!shift) throw new Error('Shift not found');
    if (shift.status !== 'Closed') throw new Error('Only closed shifts can be reopened');

    const updated = await prisma.pOSShift.update({
      where: { id: shiftId },
      data: { status: 'Open', closedAt: null, approvedBy, resumedAt: new Date() }
    });

    await prisma.pOSAuditLog.create({
      data: { action: 'Shift Reopen', details: `Shift ${shiftId} reopened by manager`, companyId, createdBy: approvedBy }
    });

    return updated;
  }

  // ============================================================
  // CASH IN / OUT
  // ============================================================
  static async recordCashTransaction({ shiftId, type, amount, reason, approvedBy, companyId, createdBy }) {
    const shift = await prisma.pOSShift.findFirst({ where: { id: shiftId, companyId, status: 'Open' } });
    if (!shift) throw new Error('No active open shift found');

    const record = await prisma.pOSCashTransaction.create({
      data: { shiftId, type, amount, reason, approvedBy: approvedBy || null, companyId, createdBy }
    });

    await prisma.pOSAuditLog.create({
      data: { action: 'Cash Adjustment', details: `${type}: ${amount} — Reason: ${reason}`, companyId, createdBy }
    });

    return record;
  }

  // ============================================================
  // GET CURRENT SHIFT
  // ============================================================
  static async getCurrentShift(cashierId, companyId) {
    return prisma.pOSShift.findFirst({
      where: { cashierId, companyId, status: { in: ['Open','Suspended'] } },
      include: {
        terminal: {
          include: {
            location: { select: { id: true, name: true, code: true, type: true } },
          },
        },
        cashier: { select: { id:true, firstName:true, lastName:true } },
        cashTransactions: { orderBy: { createdAt: 'desc' }, take: 20 },
        sales: { where: { status: 'Completed' }, select: { id:true, grandTotal:true, createdAt:true } }
      }
    });
  }

  // ============================================================
  // SHIFT HISTORY
  // ============================================================
  static async getHistory(companyId, options = {}) {
    const { skip, take = 20, cashierId, locationId } = options;
    const { normalizeLocationId } = require('../../utils/accountingLocationHelper');
    const locId = normalizeLocationId(locationId);
    const filter = { companyId };
    if (cashierId) filter.cashierId = cashierId;
    if (locId) filter.terminal = { locationId: locId };

    const [shifts, total] = await Promise.all([
      prisma.pOSShift.findMany({
        where: filter, skip, take,
        orderBy: { openedAt: 'desc' },
        include: {
          terminal: {
            select: {
              id: true,
              name: true,
              code: true,
              locationId: true,
              location: { select: { id: true, name: true, code: true, type: true } },
            },
          },
          cashier: { select: { id:true, firstName:true, lastName:true } },
          _count: { select: { sales: true, returns: true } }
        }
      }),
      prisma.pOSShift.count({ where: filter })
    ]);

    return { shifts, total };
  }

  // ============================================================
  // SHIFT STATS (for dashboard)
  // ============================================================
  static async getShiftStats(shiftId, companyId) {
    const [sales, returns, cashFlow] = await Promise.all([
      prisma.pOSSale.aggregate({ where: { shiftId, companyId, status: 'Completed' }, _sum: { grandTotal: true }, _count: { id: true } }),
      prisma.pOSReturn.aggregate({ where: { shiftId, companyId }, _sum: { refundedAmount: true }, _count: { id: true } }),
      prisma.pOSCashTransaction.groupBy({ by: ['type'], where: { shiftId }, _sum: { amount: true } })
    ]);
    return { sales, returns, cashFlow };
  }
}

module.exports = POSShiftModel;
