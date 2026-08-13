const prisma = require('../prisma/client');

const ADMIN_ROLES = ['admin', 'owner', 'superadmin', 'manager'];

function isStaff(user) {
  return ADMIN_ROLES.includes(String(user?.role || '').toLowerCase());
}

async function nextTicketNumber(tx = prisma) {
  const count = await tx.supportTicket.count();
  return `ST-${String(count + 1).padStart(5, '0')}`;
}

function serializeTicket(ticket) {
  if (!ticket) return null;
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    title: ticket.title,
    description: ticket.description,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    stepsToReproduce: ticket.stepsToReproduce,
    attachmentUrl: ticket.attachmentUrl,
    adminResponse: ticket.adminResponse,
    module: ticket.module,
    userId: ticket.userId,
    companyId: ticket.companyId,
    resolvedAt: ticket.resolvedAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    user: ticket.user
      ? {
          id: ticket.user.id,
          firstName: ticket.user.firstName,
          lastName: ticket.user.lastName,
          email: ticket.user.email
        }
      : undefined
  };
}

// ─── List tickets ────────────────────────────────────────────
const listTickets = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { status, priority, category, search, page = 1, limit = 20 } = req.query;

    const where = {};

    if (isStaff(req.user) && companyId) {
      where.companyId = companyId;
    } else if (isStaff(req.user) && !companyId) {
      // platform staff without company — all tickets
    } else {
      where.userId = userId;
    }

    if (status && status !== 'all') where.status = String(status);
    if (priority && priority !== 'all') where.priority = String(priority);
    if (category && category !== 'all') where.category = String(category);

    if (search && String(search).trim()) {
      const q = String(search).trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { ticketNumber: { contains: q, mode: 'insensitive' } },
      ];
    }

    const take = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      }),
      prisma.supportTicket.count({ where }),
    ]);

    const openCount = await prisma.supportTicket.count({
      where: { ...where, status: 'Open' }
    });

    res.status(200).json({
      success: true,
      data: tickets.map(serializeTicket),
      meta: {
        total,
        page: Math.max(parseInt(page, 10) || 1, 1),
        limit: take,
        openCount
      }
    });
  } catch (error) {
    console.error('listTickets error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Get one ─────────────────────────────────────────────────
const getTicket = async (req, res) => {
  try {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const staff = isStaff(req.user);
    const sameCompany =
      ticket.companyId && req.user.companyId && ticket.companyId === req.user.companyId;
    if (!staff && ticket.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    if (staff && ticket.companyId && req.user.companyId && !sameCompany) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }

    res.status(200).json({ success: true, data: serializeTicket(ticket) });
  } catch (error) {
    console.error('getTicket error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Create ──────────────────────────────────────────────────
const createTicket = async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      priority,
      stepsToReproduce,
      steps,
      type,
      module
    } = req.body;

    if (!title?.trim() || !description?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Title and description are required'
      });
    }

    const attachmentUrl =
      req.file?.path ||
      req.file?.secure_url ||
      (Array.isArray(req.files) && req.files[0]?.path) ||
      req.files?.attachment?.[0]?.path ||
      req.files?.screenshot?.[0]?.path ||
      null;

    const ticketNumber = await nextTicketNumber();

    const ticket = await prisma.supportTicket.create({
      data: {
        ticketNumber,
        title: String(title).trim(),
        description: String(description).trim(),
        category: String(category || type || 'General').trim() || 'General',
        priority: String(priority || 'Medium').trim() || 'Medium',
        status: 'Open',
        stepsToReproduce: String(stepsToReproduce || steps || '').trim() || null,
        attachmentUrl,
        module: module ? String(module).trim() : null,
        userId: req.user.id,
        companyId: req.user.companyId || null
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: serializeTicket(ticket),
      message: 'Support ticket created successfully'
    });
  } catch (error) {
    console.error('createTicket error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Update ──────────────────────────────────────────────────
const updateTicket = async (req, res) => {
  try {
    const existing = await prisma.supportTicket.findUnique({
      where: { id: req.params.id }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const staff = isStaff(req.user);
    if (!staff && existing.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }

    const {
      title,
      description,
      category,
      priority,
      status,
      stepsToReproduce,
      adminResponse,
      module
    } = req.body;

    const data = {};

    if (!staff) {
      // Users can only edit their open tickets' content
      if (!['Open'].includes(existing.status)) {
        return res.status(400).json({
          success: false,
          message: 'Only open tickets can be edited'
        });
      }
      if (title !== undefined) data.title = String(title).trim();
      if (description !== undefined) data.description = String(description).trim();
      if (category !== undefined) data.category = String(category).trim();
      if (priority !== undefined) data.priority = String(priority).trim();
      if (stepsToReproduce !== undefined) {
        data.stepsToReproduce = String(stepsToReproduce).trim() || null;
      }
      if (module !== undefined) data.module = String(module).trim() || null;
      if (status === 'Closed') {
        data.status = 'Closed';
        data.resolvedAt = new Date();
      }
    } else {
      if (title !== undefined) data.title = String(title).trim();
      if (description !== undefined) data.description = String(description).trim();
      if (category !== undefined) data.category = String(category).trim();
      if (priority !== undefined) data.priority = String(priority).trim();
      if (stepsToReproduce !== undefined) {
        data.stepsToReproduce = String(stepsToReproduce).trim() || null;
      }
      if (module !== undefined) data.module = String(module).trim() || null;
      if (adminResponse !== undefined) {
        data.adminResponse = String(adminResponse).trim() || null;
      }
      if (status !== undefined) {
        data.status = String(status).trim();
        if (['Resolved', 'Closed'].includes(data.status)) {
          data.resolvedAt = new Date();
        }
      }
    }

    const attachmentUrl =
      req.file?.path ||
      req.files?.attachment?.[0]?.path ||
      req.files?.screenshot?.[0]?.path;
    if (attachmentUrl) data.attachmentUrl = attachmentUrl;

    const ticket = await prisma.supportTicket.update({
      where: { id: existing.id },
      data,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: serializeTicket(ticket),
      message: 'Ticket updated successfully'
    });
  } catch (error) {
    console.error('updateTicket error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Delete ──────────────────────────────────────────────────
const deleteTicket = async (req, res) => {
  try {
    const existing = await prisma.supportTicket.findUnique({
      where: { id: req.params.id }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const staff = isStaff(req.user);
    if (!staff && existing.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    if (!staff && existing.status !== 'Open') {
      return res.status(400).json({
        success: false,
        message: 'Only open tickets can be deleted'
      });
    }

    await prisma.supportTicket.delete({ where: { id: existing.id } });

    res.status(200).json({ success: true, message: 'Ticket deleted' });
  } catch (error) {
    console.error('deleteTicket error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  listTickets,
  getTicket,
  createTicket,
  updateTicket,
  deleteTicket
};
