/**
 * CRM Lead Controller - Bisonstechs ERP
 * Full CRUD + dynamic fields + board operations + follow-ups + activities
 */
const prisma = require('../prisma/client');

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function generateLeadNumber(companyId) {
  const last = await prisma.lead.findFirst({
    where: { companyId, leadNumber: { startsWith: 'LEAD-' } },
    orderBy: { leadNumber: 'desc' },
    select: { leadNumber: true },
  });
  let num = 1;
  if (last?.leadNumber) {
    const n = parseInt(last.leadNumber.replace(/^LEAD-/i, ''), 10);
    if (Number.isFinite(n) && n > 0) num = n + 1;
  }
  for (let i = 0; i < 5; i++) {
    const candidate = `LEAD-${String(num + i).padStart(5, '0')}`;
    const exists = await prisma.lead.findFirst({ where: { leadNumber: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `LEAD-${Date.now().toString().slice(-8)}`;
}

function getCompanyId(req) {
  return req.user?.companyId || null;
}

function buildLeadSelect(includeRelations = true) {
  const base = {
    id: true, leadNumber: true, companyId: true, fullName: true, firstName: true, lastName: true,
    email: true, phone: true, whatsapp: true, companyName: true, city: true, state: true,
    country: true, source: true, sourceId: true, status: true, stage: true, priority: true,
    budget: true, currency: true, interest: true, score: true, assignedToId: true, notes: true,
    tags: true, customFields: true, boardId: true, boardOrder: true, isDeleted: true,
    convertedAt: true, convertedById: true, convertedCustomerId: true, title: true,
    createdBy: true, updatedBy: true, createdAt: true, updatedAt: true,
  };
  if (!includeRelations) return base;
  return {
    ...base,
    assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
    creator: { select: { id: true, firstName: true, lastName: true, email: true } },
    leadSource: { select: { id: true, name: true, color: true } },
    _count: { select: { activities: true, followUps: true } },
  };
}

async function logActivity(prisma, { leadId, companyId, userId, type, title, description, metadata }) {
  try {
    await prisma.leadActivity.create({
      data: { leadId, companyId, userId, type, title, description: description || null, metadata: metadata || null },
    });
  } catch (e) {
    console.warn('[CRM] Activity log failed:', e.message);
  }
}

// ─── Leads CRUD ────────────────────────────────────────────────────────────

const getLeads = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ success: false, message: 'Company context required' });

    const {
      page = 1, limit = 50, status, source, assignedToId, search, boardId,
      priority, tags, sortBy = 'createdAt', sortDir = 'desc', isDeleted = '0',
      dateFrom, dateTo,
    } = req.query;

    const where = {
      companyId,
      isDeleted: isDeleted === '1',
    };

    if (status) where.status = status;
    if (source) where.source = source;
    if (assignedToId) where.assignedToId = assignedToId;
    if (boardId) where.boardId = boardId;
    if (priority) where.priority = priority;
    if (tags) where.tags = { hasSome: Array.isArray(tags) ? tags : [tags] };

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { whatsapp: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { leadNumber: { contains: search, mode: 'insensitive' } },
        { interest: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        select: buildLeadSelect(true),
        orderBy: { [sortBy]: sortDir },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
    ]);

    return res.json({
      success: true,
      data: { leads, total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) {
    console.error('[CRM] getLeads error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getLeadById = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const lead = await prisma.lead.findFirst({
      where: { id, companyId },
      select: {
        ...buildLeadSelect(true),
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true, type: true, title: true, description: true, metadata: true, createdAt: true,
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        followUps: {
          orderBy: { followUpDate: 'asc' },
          select: {
            id: true, followUpDate: true, followUpTime: true, type: true, status: true,
            notes: true, completedAt: true, createdAt: true,
            assignedTo: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        convertedCustomer: { select: { id: true, name: true, customerNumber: true } },
      },
    });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    return res.json({ success: true, data: lead });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createLead = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ success: false, message: 'Company context required' });
    const userId = req.user.id;

    const {
      firstName, lastName, fullName, email, phone, whatsapp, companyName, city, state, country,
      source, sourceId, status, priority, budget, currency, interest, assignedToId, notes,
      tags, customFields, boardId, boardOrder, title, stage,
    } = req.body;

    const name = fullName || [firstName, lastName].filter(Boolean).join(' ') || 'Unnamed Lead';
    if (!name.trim()) return res.status(400).json({ success: false, message: 'Lead name is required' });

    const leadNumber = await generateLeadNumber(companyId);

    const lead = await prisma.lead.create({
      data: {
        leadNumber, companyId, createdBy: userId,
        firstName: firstName || null, lastName: lastName || null,
        fullName: name, email: email || null, phone: phone || null,
        whatsapp: whatsapp || null, companyName: companyName || null,
        city: city || null, state: state || null, country: country || 'Pakistan',
        source: source || 'Manual Entry', sourceId: sourceId || null,
        status: status || 'New', stage: stage || null, priority: priority || 'Medium',
        budget: budget ? parseFloat(budget) : null, currency: currency || 'PKR',
        interest: interest || null, assignedToId: assignedToId || null,
        notes: notes || null, tags: tags || [], customFields: customFields || {},
        boardId: boardId || null, boardOrder: boardOrder ? parseInt(boardOrder) : 0,
        title: title || null,
      },
      select: buildLeadSelect(true),
    });

    await prisma.leadActivity.create({
      data: {
        leadId: lead.id, companyId, userId,
        type: 'created', title: 'Lead created',
        description: `Lead "${lead.fullName}" was created`,
      },
    }).catch(() => {});

    return res.status(201).json({ success: true, data: lead, message: 'Lead created successfully' });
  } catch (err) {
    console.error('[CRM] createLead error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateLead = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const userId = req.user.id;

    const existing = await prisma.lead.findFirst({ where: { id, companyId }, select: { id: true, status: true, assignedToId: true, fullName: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Lead not found' });

    const {
      firstName, lastName, fullName, email, phone, whatsapp, companyName, city, state, country,
      source, sourceId, status, priority, budget, currency, interest, assignedToId, notes,
      tags, customFields, boardId, boardOrder, title, stage,
    } = req.body;

    const updateData = { updatedBy: userId };
    if (fullName !== undefined) updateData.fullName = fullName;
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (whatsapp !== undefined) updateData.whatsapp = whatsapp;
    if (companyName !== undefined) updateData.companyName = companyName;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (country !== undefined) updateData.country = country;
    if (source !== undefined) updateData.source = source;
    if (sourceId !== undefined) updateData.sourceId = sourceId;
    if (status !== undefined) updateData.status = status;
    if (stage !== undefined) updateData.stage = stage;
    if (priority !== undefined) updateData.priority = priority;
    if (budget !== undefined) updateData.budget = budget ? parseFloat(budget) : null;
    if (currency !== undefined) updateData.currency = currency;
    if (interest !== undefined) updateData.interest = interest;
    if (assignedToId !== undefined) updateData.assignedToId = assignedToId;
    if (notes !== undefined) updateData.notes = notes;
    if (tags !== undefined) updateData.tags = tags;
    if (customFields !== undefined) updateData.customFields = customFields;
    if (boardId !== undefined) updateData.boardId = boardId;
    if (boardOrder !== undefined) updateData.boardOrder = parseInt(boardOrder);
    if (title !== undefined) updateData.title = title;

    const lead = await prisma.lead.update({ where: { id }, data: updateData, select: buildLeadSelect(true) });

    // Log relevant changes
    const activities = [];
    if (status !== undefined && status !== existing.status) {
      activities.push({ type: 'status_changed', title: 'Status changed', description: `Status changed from "${existing.status}" to "${status}"` });
    }
    if (assignedToId !== undefined && assignedToId !== existing.assignedToId) {
      activities.push({ type: 'assigned', title: 'Lead assigned', description: `Lead reassigned to a different user` });
    }
    for (const act of activities) {
      await prisma.leadActivity.create({ data: { leadId: id, companyId, userId, ...act } }).catch(() => {});
    }

    return res.json({ success: true, data: lead, message: 'Lead updated successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteLead = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const existing = await prisma.lead.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Lead not found' });
    await prisma.lead.update({ where: { id }, data: { isDeleted: true, updatedBy: req.user.id } });
    return res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const bulkUpdateLeads = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { ids, status, assignedToId, priority, tags } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids array required' });
    }
    const updateData = { updatedBy: req.user.id };
    if (status !== undefined) updateData.status = status;
    if (assignedToId !== undefined) updateData.assignedToId = assignedToId;
    if (priority !== undefined) updateData.priority = priority;
    if (tags !== undefined) updateData.tags = tags;

    await prisma.lead.updateMany({ where: { id: { in: ids }, companyId }, data: updateData });
    return res.json({ success: true, message: `${ids.length} leads updated` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateLeadBoardOrder = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { updates } = req.body; // Array of { id, status, boardOrder, boardId }
    if (!Array.isArray(updates)) return res.status(400).json({ success: false, message: 'updates array required' });

    await prisma.$transaction(
      updates.map(u =>
        prisma.lead.updateMany({
          where: { id: u.id, companyId },
          data: {
            status: u.status !== undefined ? u.status : undefined,
            boardOrder: u.boardOrder !== undefined ? parseInt(u.boardOrder) : undefined,
            boardId: u.boardId !== undefined ? u.boardId : undefined,
            updatedBy: req.user.id,
          },
        })
      )
    );
    return res.json({ success: true, message: 'Board updated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const addLeadNote = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const { note, type = 'note_added' } = req.body;
    if (!note) return res.status(400).json({ success: false, message: 'note required' });

    const existing = await prisma.lead.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Lead not found' });

    const activity = await prisma.leadActivity.create({
      data: { leadId: id, companyId, userId: req.user.id, type, title: type === 'call_logged' ? 'Call logged' : 'Note added', description: note },
      select: { id: true, type: true, title: true, description: true, createdAt: true, user: { select: { id: true, firstName: true, lastName: true } } },
    });
    return res.status(201).json({ success: true, data: activity });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const convertLead = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const { createNewCustomer = true, existingCustomerId, customerData } = req.body;

    const lead = await prisma.lead.findFirst({ where: { id, companyId }, select: buildLeadSelect(false) });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (lead.convertedAt) return res.status(400).json({ success: false, message: 'Lead already converted' });

    let customerId = existingCustomerId;

    if (createNewCustomer && !existingCustomerId) {
      // Check for duplicate customer
      if (lead.email) {
        const dup = await prisma.customer.findFirst({ where: { email: lead.email, companyId } });
        if (dup) return res.status(409).json({ success: false, message: 'A customer with this email already exists', existingCustomer: { id: dup.id, name: dup.name } });
      }
      // Generate customer number
      const lastCust = await prisma.customer.findFirst({ where: { customerNumber: { startsWith: 'CUST-' } }, orderBy: { customerNumber: 'desc' }, select: { customerNumber: true } });
      let custNum = 1;
      if (lastCust?.customerNumber) {
        const n = parseInt(lastCust.customerNumber.replace(/^CUST-/i, ''), 10);
        if (Number.isFinite(n) && n > 0) custNum = n + 1;
      }
      const customerNumber = `CUST-${String(custNum).padStart(5, '0')}`;
      const newCustomer = await prisma.customer.create({
        data: {
          customerNumber, name: lead.fullName,
          email: lead.email || null, phone: lead.phone || null,
          companyName: lead.companyName || null, companyId,
          createdBy: req.user.id,
          address: lead.city ? { city: lead.city, state: lead.state, country: lead.country } : undefined,
          notes: lead.notes || null,
          ...customerData,
        },
      });
      customerId = newCustomer.id;
    }

    await prisma.lead.update({
      where: { id },
      data: { status: 'Converted', convertedAt: new Date(), convertedById: req.user.id, convertedCustomerId: customerId, updatedBy: req.user.id },
    });

    await prisma.leadActivity.create({
      data: { leadId: id, companyId, userId: req.user.id, type: 'converted', title: 'Lead converted', description: `Lead converted to customer`, metadata: { customerId } },
    }).catch(() => {});

    return res.json({ success: true, message: 'Lead converted successfully', customerId });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Dashboard/Analytics ───────────────────────────────────────────────────

const getDashboard = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ success: false, message: 'Company context required' });

    const { dateFrom, dateTo } = req.query;
    const dateFilter = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) dateFilter.lte = new Date(dateTo);
    const createdAtFilter = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};

    const [total, statusCounts, sourceCounts, recentActivity, upcomingFollowUps, addedOverTime] = await Promise.all([
      prisma.lead.count({ where: { companyId, isDeleted: false, ...createdAtFilter } }),
      prisma.lead.groupBy({ by: ['status'], where: { companyId, isDeleted: false, ...createdAtFilter }, _count: { status: true } }),
      prisma.lead.groupBy({ by: ['source'], where: { companyId, isDeleted: false, ...createdAtFilter }, _count: { source: true } }),
      prisma.leadActivity.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, type: true, title: true, description: true, createdAt: true, leadId: true, user: { select: { id: true, firstName: true, lastName: true } } },
      }),
      prisma.leadFollowUp.findMany({
        where: { companyId, status: 'Pending', followUpDate: { gte: new Date() } },
        orderBy: { followUpDate: 'asc' },
        take: 10,
        select: { id: true, followUpDate: true, followUpTime: true, type: true, notes: true, lead: { select: { id: true, fullName: true, status: true } }, assignedTo: { select: { id: true, firstName: true, lastName: true } } },
      }),
      prisma.$queryRaw`
        SELECT DATE_TRUNC('day', created_at) as date, COUNT(*) as count
        FROM crm_leads
        WHERE company_id = ${companyId} AND is_deleted = false
        AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY date ASC
      `,
    ]);

    const statusMap = {};
    for (const s of statusCounts) statusMap[s.status] = s._count.status;

    return res.json({
      success: true,
      data: {
        totals: {
          total,
          new: statusMap['New'] || 0,
          contacted: statusMap['Contacted'] || 0,
          interested: statusMap['Interested'] || 0,
          followUp: statusMap['Follow-up'] || 0,
          negotiation: statusMap['Negotiation'] || 0,
          converted: statusMap['Converted'] || 0,
          lost: statusMap['Lost'] || 0,
        },
        conversionRate: total > 0 ? (((statusMap['Converted'] || 0) / total) * 100).toFixed(1) : 0,
        statusBreakdown: statusCounts.map(s => ({ status: s.status, count: s._count.status })),
        sourceBreakdown: sourceCounts.map(s => ({ source: s.source, count: s._count.source })),
        recentActivity,
        upcomingFollowUps,
        addedOverTime,
      },
    });
  } catch (err) {
    console.error('[CRM] getDashboard error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Custom Fields ─────────────────────────────────────────────────────────

const getCustomFields = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const fields = await prisma.leadCustomField.findMany({
      where: { companyId },
      orderBy: { sortOrder: 'asc' },
    });
    return res.json({ success: true, data: fields });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createCustomField = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { fieldKey, fieldName, fieldType, description, defaultValue, placeholder, isRequired, options, sortOrder, width } = req.body;
    if (!fieldKey || !fieldName || !fieldType) {
      return res.status(400).json({ success: false, message: 'fieldKey, fieldName, fieldType are required' });
    }
    const key = fieldKey.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    const field = await prisma.leadCustomField.create({
      data: { companyId, fieldKey: key, fieldName, fieldType, description, defaultValue, placeholder, isRequired: !!isRequired, options: options || [], sortOrder: sortOrder || 0, width: width || 160 },
    });
    return res.status(201).json({ success: true, data: field });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, message: 'A field with this key already exists' });
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateCustomField = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const existing = await prisma.leadCustomField.findFirst({ where: { id, companyId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Custom field not found' });
    if (existing.isSystem) return res.status(400).json({ success: false, message: 'System fields cannot be modified' });
    const { fieldName, description, defaultValue, placeholder, isRequired, options, sortOrder, width, isVisible } = req.body;
    const field = await prisma.leadCustomField.update({ where: { id }, data: { fieldName, description, defaultValue, placeholder, isRequired, options, sortOrder, width, isVisible } });
    return res.json({ success: true, data: field });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteCustomField = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const existing = await prisma.leadCustomField.findFirst({ where: { id, companyId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Custom field not found' });
    if (existing.isSystem) return res.status(400).json({ success: false, message: 'System fields cannot be deleted' });
    await prisma.leadCustomField.delete({ where: { id } });
    return res.json({ success: true, message: 'Field deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const reorderCustomFields = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { orders } = req.body; // [{id, sortOrder}]
    await prisma.$transaction(orders.map(o => prisma.leadCustomField.updateMany({ where: { id: o.id, companyId }, data: { sortOrder: o.sortOrder } })));
    return res.json({ success: true, message: 'Fields reordered' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Lead Boards ──────────────────────────────────────────────────────────

const getBoards = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const boards = await prisma.leadBoard.findMany({
      where: { companyId },
      include: { columns: { orderBy: { sortOrder: 'asc' } }, _count: { select: { leads: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ success: true, data: boards });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createBoard = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { name, description, color, columnsConfig } = req.body;
    const defaultColumns = [
      { name: 'New', statusKey: 'New', color: '#6b7280', sortOrder: 0 },
      { name: 'Contacted', statusKey: 'Contacted', color: '#3b82f6', sortOrder: 1 },
      { name: 'Interested', statusKey: 'Interested', color: '#f59e0b', sortOrder: 2 },
      { name: 'Follow-up', statusKey: 'Follow-up', color: '#8b5cf6', sortOrder: 3 },
      { name: 'Negotiation', statusKey: 'Negotiation', color: '#ef4444', sortOrder: 4 },
      { name: 'Converted', statusKey: 'Converted', color: '#10b981', sortOrder: 5 },
      { name: 'Lost', statusKey: 'Lost', color: '#6b7280', sortOrder: 6 },
    ];
    const board = await prisma.leadBoard.create({
      data: { companyId, name, description, color: color || '#014582', createdBy: req.user.id, columnsConfig: columnsConfig || [], columns: { create: defaultColumns } },
      include: { columns: { orderBy: { sortOrder: 'asc' } } },
    });
    return res.status(201).json({ success: true, data: board });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getOrCreateDefaultBoard = async (companyId, userId) => {
  let board = await prisma.leadBoard.findFirst({ where: { companyId, isDefault: true }, include: { columns: { orderBy: { sortOrder: 'asc' } } } });
  if (!board) {
    board = await prisma.leadBoard.create({
      data: {
        companyId, name: 'Main Pipeline', isDefault: true, color: '#014582', createdBy: userId,
        columns: {
          create: [
            { name: 'New', statusKey: 'New', color: '#6b7280', sortOrder: 0 },
            { name: 'Contacted', statusKey: 'Contacted', color: '#3b82f6', sortOrder: 1 },
            { name: 'Interested', statusKey: 'Interested', color: '#f59e0b', sortOrder: 2 },
            { name: 'Follow-up', statusKey: 'Follow-up', color: '#8b5cf6', sortOrder: 3 },
            { name: 'Negotiation', statusKey: 'Negotiation', color: '#ef4444', sortOrder: 4 },
            { name: 'Converted', statusKey: 'Converted', color: '#10b981', sortOrder: 5 },
            { name: 'Lost', statusKey: 'Lost', color: '#6b7280', sortOrder: 6 },
          ],
        },
      },
      include: { columns: { orderBy: { sortOrder: 'asc' } } },
    });
  }
  return board;
};

const getDefaultBoard = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const board = await getOrCreateDefaultBoard(companyId, req.user.id);
    return res.json({ success: true, data: board });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Lead Sources ──────────────────────────────────────────────────────────

const getSources = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const sources = await prisma.leadSource.findMany({ where: { companyId, isActive: true }, orderBy: { name: 'asc' } });
    return res.json({ success: true, data: sources });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createSource = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'name required' });
    const source = await prisma.leadSource.create({ data: { companyId, name, color: color || '#10b981' } });
    return res.status(201).json({ success: true, data: source });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, message: 'Source with this name already exists' });
    return res.status(500).json({ success: false, message: err.message });
  }
};

const initDefaultSources = async (companyId) => {
  const defaults = ['Google Sheets', 'Excel Import', 'Website', 'Facebook', 'Instagram', 'WhatsApp', 'Manual Entry', 'Referral', 'Other'];
  for (const name of defaults) {
    await prisma.leadSource.upsert({ where: { companyId_name: { companyId, name } }, update: {}, create: { companyId, name } });
  }
};

const ensureDefaultSources = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    await initDefaultSources(companyId);
    return res.json({ success: true, message: 'Default sources initialized' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Follow-ups ────────────────────────────────────────────────────────────

const getFollowUps = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { status, assignedToId, leadId, upcoming } = req.query;
    const where = { companyId };
    if (status) where.status = status;
    if (assignedToId) where.assignedToId = assignedToId;
    if (leadId) where.leadId = leadId;
    if (upcoming === '1') where.followUpDate = { gte: new Date() };

    const followUps = await prisma.leadFollowUp.findMany({
      where,
      orderBy: { followUpDate: 'asc' },
      select: {
        id: true, followUpDate: true, followUpTime: true, type: true, status: true, notes: true,
        completedAt: true, createdAt: true,
        lead: { select: { id: true, fullName: true, status: true, phone: true, companyName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return res.json({ success: true, data: followUps });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createFollowUp = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { leadId, followUpDate, followUpTime, type, notes, assignedToId } = req.body;
    if (!leadId || !followUpDate) return res.status(400).json({ success: false, message: 'leadId and followUpDate required' });

    const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    const followUp = await prisma.leadFollowUp.create({
      data: { leadId, companyId, followUpDate: new Date(followUpDate), followUpTime, type: type || 'Phone Call', notes, assignedToId: assignedToId || req.user.id, createdBy: req.user.id },
      select: { id: true, followUpDate: true, type: true, status: true, notes: true },
    });
    await prisma.leadActivity.create({
      data: { leadId, companyId, userId: req.user.id, type: 'followup_scheduled', title: 'Follow-up scheduled', description: `${type || 'Phone Call'} follow-up scheduled for ${followUpDate}` },
    }).catch(() => {});
    return res.status(201).json({ success: true, data: followUp });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const completeFollowUp = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const { notes } = req.body;
    const fu = await prisma.leadFollowUp.findFirst({ where: { id, companyId }, select: { id: true, leadId: true } });
    if (!fu) return res.status(404).json({ success: false, message: 'Follow-up not found' });
    await prisma.leadFollowUp.update({ where: { id }, data: { status: 'Completed', completedAt: new Date(), completedById: req.user.id, notes: notes || undefined } });
    await prisma.leadActivity.create({
      data: { leadId: fu.leadId, companyId, userId: req.user.id, type: 'followup_completed', title: 'Follow-up completed', description: notes || 'Follow-up marked as completed' },
    }).catch(() => {});
    return res.json({ success: true, message: 'Follow-up completed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Export Leads ──────────────────────────────────────────────────────────

const exportLeads = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { ids, status, format = 'xlsx' } = req.body;
    const ExcelJS = require('exceljs');

    const where = { companyId, isDeleted: false };
    if (ids?.length) where.id = { in: ids };
    if (status) where.status = status;

    const leads = await prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' } });
    const customFields = await prisma.leadCustomField.findMany({ where: { companyId, isVisible: true }, orderBy: { sortOrder: 'asc' } });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Leads');

    const coreHeaders = ['Lead #', 'Full Name', 'Email', 'Phone', 'WhatsApp', 'Company', 'City', 'Country', 'Source', 'Status', 'Priority', 'Budget', 'Interest', 'Created At'];
    const customHeaders = customFields.map(f => f.fieldName);
    ws.addRow([...coreHeaders, ...customHeaders]);
    ws.getRow(1).font = { bold: true };

    for (const lead of leads) {
      const customValues = customFields.map(f => {
        const val = lead.customFields?.[f.fieldKey];
        return Array.isArray(val) ? val.join(', ') : (val ?? '');
      });
      ws.addRow([
        lead.leadNumber, lead.fullName, lead.email || '', lead.phone || '', lead.whatsapp || '',
        lead.companyName || '', lead.city || '', lead.country || '', lead.source, lead.status,
        lead.priority, lead.budget || '', lead.interest || '',
        lead.createdAt.toISOString().slice(0, 10),
        ...customValues,
      ]);
    }

    res.setHeader('Content-Disposition', `attachment; filename="leads-export-${Date.now()}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getLeads, getLeadById, createLead, updateLead, deleteLead,
  bulkUpdateLeads, updateLeadBoardOrder, addLeadNote, convertLead,
  getDashboard, getCustomFields, createCustomField, updateCustomField, deleteCustomField, reorderCustomFields,
  getBoards, createBoard, getDefaultBoard,
  getSources, createSource, ensureDefaultSources,
  getFollowUps, createFollowUp, completeFollowUp,
  exportLeads,
};

