/**
 * CRM Enterprise Controller — Bisonstechs ERP
 * Contacts, Opportunities, Activities, Tasks, Calendar, Campaigns,
 * Accounts, Reports, Custom Fields, Import/Export, Enterprise Dashboard
 */
const prisma = require('../prisma/client');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getCompanyId = (req) => req.user?.companyId || null;
const getUserId   = (req) => req.user?.id || null;

function paginate(query) {
  const page  = Math.max(1, parseInt(query.page  || '1'));
  const limit = Math.min(200, Math.max(1, parseInt(query.limit || '50')));
  return { skip: (page - 1) * limit, take: limit, page, limit };
}

async function generateSequence(model, companyId, prefix, field = 'opportunityNumber') {
  const last = await prisma[model].findFirst({
    where:   { companyId, [field]: { startsWith: prefix } },
    orderBy: { [field]: 'desc' },
    select:  { [field]: true },
  });
  let num = 1;
  if (last?.[field]) {
    const n = parseInt(last[field].replace(new RegExp(`^${prefix}`), ''), 10);
    if (Number.isFinite(n) && n > 0) num = n + 1;
  }
  for (let i = 0; i < 5; i++) {
    const candidate = `${prefix}${String(num + i).padStart(5, '0')}`;
    const exists = await prisma[model].findFirst({ where: { [field]: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `${prefix}${Date.now().toString().slice(-8)}`;
}

function dateFilter(query) {
  const f = {};
  if (query.dateFrom) f.gte = new Date(query.dateFrom);
  if (query.dateTo)   f.lte = new Date(query.dateTo);
  return Object.keys(f).length ? f : null;
}

const userSelect = { id: true, firstName: true, lastName: true, email: true };
const contactSelect = {
  id: true, fullName: true, firstName: true, lastName: true, email: true,
  phone: true, designation: true, contactType: true, status: true,
};

// ─── Enterprise Dashboard ─────────────────────────────────────────────────────

const getEnterpriseDashboard = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ success: false, message: 'Company context required' });

    const { dateFrom, dateTo, assignedToId } = req.query;
    const df = dateFilter({ dateFrom, dateTo });
    const createdAtFilter = df ? { createdAt: df } : {};
    const assignFilter    = assignedToId ? { assignedToId } : {};

    const leadWhere = { companyId, isDeleted: false, ...createdAtFilter, ...assignFilter };
    const now       = new Date();
    const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow  = new Date(today.getTime() + 86400000);

    const [
      totalLeads,
      leadStatusCounts,
      totalCustomers,
      totalContacts,
      openOpps,
      wonOpps,
      lostOpps,
      pipelineAgg,
      weightedAgg,
      upcomingFollowUps,
      overdueActivities,
      overdueTasks,
      todayTasks,
      recentLeads,
      recentOpps,
      recentActivities,
      leadSourceCounts,
      conversionData,
    ] = await Promise.all([
      // Lead counts
      prisma.lead.count({ where: leadWhere }),
      prisma.lead.groupBy({
        by: ['status'],
        where: leadWhere,
        _count: { status: true },
      }),
      // Customers & contacts
      prisma.customer.count({ where: { companyId, isDeleted: false } }),
      prisma.crmContact.count({ where: { companyId, isDeleted: false } }),
      // Opportunities
      prisma.crmOpportunity.count({ where: { companyId, isDeleted: false, stage: { notIn: ['Won', 'Lost'] }, ...assignFilter } }),
      prisma.crmOpportunity.count({ where: { companyId, isDeleted: false, stage: 'Won', ...assignFilter } }),
      prisma.crmOpportunity.count({ where: { companyId, isDeleted: false, stage: 'Lost', ...assignFilter } }),
      prisma.crmOpportunity.aggregate({ where: { companyId, isDeleted: false, stage: { notIn: ['Won', 'Lost'] } }, _sum: { expectedRevenue: true } }),
      prisma.crmOpportunity.aggregate({ where: { companyId, isDeleted: false, stage: { notIn: ['Won', 'Lost'] } }, _sum: { weightedRevenue: true } }),
      // Follow-ups upcoming
      prisma.leadFollowUp.findMany({
        where: { companyId, status: 'Pending', followUpDate: { gte: now } },
        orderBy: { followUpDate: 'asc' },
        take: 10,
        select: {
          id: true, followUpDate: true, followUpTime: true, type: true, notes: true,
          lead: { select: { id: true, fullName: true, status: true } },
          assignedTo: { select: userSelect },
        },
      }),
      // Overdue activities
      prisma.crmActivity.count({ where: { companyId, status: 'Open', dueAt: { lt: now }, ...assignFilter } }),
      // Overdue tasks
      prisma.crmTask.count({ where: { companyId, isDeleted: false, status: { notIn: ['Completed', 'Cancelled'] }, dueAt: { lt: now }, ...assignFilter } }),
      // Today tasks
      prisma.crmTask.count({ where: { companyId, isDeleted: false, status: { notIn: ['Completed', 'Cancelled'] }, dueAt: { gte: today, lt: tomorrow }, ...assignFilter } }),
      // Recent leads
      prisma.lead.findMany({
        where: { companyId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, leadNumber: true, fullName: true, status: true, source: true, createdAt: true, assignedTo: { select: userSelect } },
      }),
      // Recent opportunities
      prisma.crmOpportunity.findMany({
        where: { companyId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, opportunityNumber: true, name: true, stage: true, expectedRevenue: true, probability: true, expectedClosingDate: true, assignedTo: { select: userSelect } },
      }),
      // Recent CRM activities
      prisma.crmActivity.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, type: true, subject: true, status: true, dueAt: true, createdAt: true, creator: { select: userSelect } },
      }),
      // Lead sources
      prisma.lead.groupBy({ by: ['source'], where: leadWhere, _count: { source: true } }),
      // Conversion data
      prisma.lead.count({ where: { ...leadWhere, status: 'Converted' } }),
    ]);

    const statusMap = {};
    for (const s of leadStatusCounts) statusMap[s.status] = s._count.status;

    // Map legacy + new statuses
    const qualifiedCount  = (statusMap['Qualified']  || 0);
    const unqualifiedCount = (statusMap['Unqualified'] || 0);
    const nurturingCount  = (statusMap['Nurturing']   || 0);
    const interestedCount = (statusMap['Interested']  || 0) + qualifiedCount;
    const followUpCount   = statusMap['Follow-up']    || 0;
    const negotiationCount = statusMap['Negotiation'] || 0;
    const convertedCount  = statusMap['Converted']    || 0;

    const conversionRate = totalLeads > 0 ? +((conversionData / totalLeads) * 100).toFixed(1) : 0;

    return res.json({
      success: true,
      data: {
        leads: {
          total: totalLeads,
          new: statusMap['New'] || 0,
          contacted: statusMap['Contacted'] || 0,
          qualified: qualifiedCount,
          unqualified: unqualifiedCount,
          nurturing: nurturingCount,
          // Legacy mapped
          interested: interestedCount,
          followUp: followUpCount,
          negotiation: negotiationCount,
          converted: convertedCount,
          lost: statusMap['Lost'] || 0,
          statusBreakdown: leadStatusCounts.map(s => ({ status: s.status, count: s._count.status })),
          sourceBreakdown: leadSourceCounts.map(s => ({ source: s.source, count: s._count.source })),
          conversionRate,
        },
        customers: { total: totalCustomers },
        contacts:  { total: totalContacts },
        opportunities: {
          open: openOpps,
          won:  wonOpps,
          lost: lostOpps,
          pipelineValue:  pipelineAgg._sum.expectedRevenue || 0,
          weightedValue:  weightedAgg._sum.weightedRevenue || 0,
        },
        activities: {
          overdue: overdueActivities,
          recent: recentActivities,
        },
        tasks: {
          overdue: overdueTasks,
          today:   todayTasks,
        },
        upcomingFollowUps,
        recentLeads,
        recentOpportunities: recentOpps,
      },
    });
  } catch (err) {
    console.error('[CRM Enterprise] getEnterpriseDashboard error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Contacts ─────────────────────────────────────────────────────────────────

const getContacts = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { skip, take, page, limit } = paginate(req.query);
    const { search, status, assignedToId, customerId, leadId, contactType } = req.query;

    const where = { companyId, isDeleted: false };
    if (status)       where.status       = status;
    if (assignedToId) where.assignedToId = assignedToId;
    if (customerId)   where.customerId   = customerId;
    if (leadId)       where.leadId       = leadId;
    if (contactType)  where.contactType  = contactType;
    if (search) {
      where.OR = [
        { fullName:    { contains: search, mode: 'insensitive' } },
        { email:       { contains: search, mode: 'insensitive' } },
        { phone:       { contains: search, mode: 'insensitive' } },
        { designation: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, contacts] = await Promise.all([
      prisma.crmContact.count({ where }),
      prisma.crmContact.findMany({
        where, skip, take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, fullName: true, firstName: true, lastName: true, email: true, phone: true,
          mobile: true, whatsapp: true, designation: true, department: true, contactType: true,
          city: true, country: true, status: true, isPrimary: true, tags: true,
          customerId: true, leadId: true, assignedToId: true, createdAt: true, updatedAt: true,
          assignedTo: { select: userSelect },
          customer: { select: { id: true, name: true, customerNumber: true } },
          _count: { select: { opportunities: true, activities: true, tasks: true } },
        },
      }),
    ]);

    return res.json({ success: true, data: { contacts, total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getContactById = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const contact = await prisma.crmContact.findFirst({
      where: { id: req.params.id, companyId },
      include: {
        assignedTo: { select: userSelect },
        creator:    { select: userSelect },
        customer:   { select: { id: true, name: true, customerNumber: true } },
        lead:       { select: { id: true, fullName: true, leadNumber: true, status: true } },
        opportunities: { where: { isDeleted: false }, orderBy: { createdAt: 'desc' }, take: 10,
          select: { id: true, opportunityNumber: true, name: true, stage: true, expectedRevenue: true } },
        activities: { orderBy: { createdAt: 'desc' }, take: 20,
          select: { id: true, type: true, subject: true, status: true, dueAt: true, createdAt: true } },
        tasks: { where: { isDeleted: false }, orderBy: { dueAt: 'asc' }, take: 10,
          select: { id: true, title: true, status: true, dueAt: true, priority: true } },
      },
    });
    if (!contact) return res.status(404).json({ success: false, message: 'Contact not found' });
    return res.json({ success: true, data: contact });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createContact = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId    = getUserId(req);
    const {
      firstName, lastName, fullName, designation, department, email, phone, mobile,
      whatsapp, linkedinUrl, address, city, country, contactType, assignedToId,
      isPrimary, notes, tags, status, customFields, customerId, leadId,
    } = req.body;

    if (!firstName) return res.status(400).json({ success: false, message: 'firstName is required' });
    const name = fullName || [firstName, lastName].filter(Boolean).join(' ');

    const contact = await prisma.crmContact.create({
      data: {
        companyId, createdBy: userId,
        firstName, lastName: lastName || null, fullName: name,
        designation: designation || null, department: department || null,
        email: email || null, phone: phone || null, mobile: mobile || null,
        whatsapp: whatsapp || null, linkedinUrl: linkedinUrl || null,
        address: address || null, city: city || null, country: country || null,
        contactType: contactType || 'Contact',
        assignedToId: assignedToId || null,
        isPrimary: !!isPrimary, notes: notes || null,
        tags: tags || [], status: status || 'Active',
        customFields: customFields || {},
        customerId: customerId || null, leadId: leadId || null,
      },
      include: { assignedTo: { select: userSelect } },
    });
    return res.status(201).json({ success: true, data: contact, message: 'Contact created' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateContact = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.crmContact.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Contact not found' });

    const allowed = [
      'firstName', 'lastName', 'fullName', 'designation', 'department', 'email', 'phone', 'mobile',
      'whatsapp', 'linkedinUrl', 'address', 'city', 'country', 'contactType', 'assignedToId',
      'isPrimary', 'notes', 'tags', 'status', 'customFields', 'customerId', 'leadId',
    ];
    const data = { updatedBy: getUserId(req) };
    for (const k of allowed) { if (req.body[k] !== undefined) data[k] = req.body[k]; }

    const contact = await prisma.crmContact.update({
      where: { id: req.params.id }, data,
      include: { assignedTo: { select: userSelect } },
    });
    return res.json({ success: true, data: contact });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteContact = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.crmContact.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Contact not found' });
    await prisma.crmContact.update({ where: { id: req.params.id }, data: { isDeleted: true, updatedBy: getUserId(req) } });
    return res.json({ success: true, message: 'Contact deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const exportContacts = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const ExcelJS = require('exceljs');
    const contacts = await prisma.crmContact.findMany({
      where: { companyId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Contacts');
    ws.addRow(['Full Name', 'Email', 'Phone', 'Mobile', 'Designation', 'Department', 'Contact Type', 'City', 'Country', 'Status', 'Created At']);
    ws.getRow(1).font = { bold: true };
    for (const c of contacts) {
      ws.addRow([c.fullName, c.email || '', c.phone || '', c.mobile || '', c.designation || '', c.department || '', c.contactType, c.city || '', c.country || '', c.status, c.createdAt.toISOString().slice(0, 10)]);
    }
    res.setHeader('Content-Disposition', `attachment; filename="crm-contacts-${Date.now()}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Opportunities ────────────────────────────────────────────────────────────

const getOpportunities = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { skip, take, page, limit } = paginate(req.query);
    const { search, stage, assignedToId, customerId, leadId } = req.query;
    const df = dateFilter(req.query);

    const where = { companyId, isDeleted: false };
    if (stage)        where.stage        = stage;
    if (assignedToId) where.assignedToId = assignedToId;
    if (customerId)   where.customerId   = customerId;
    if (leadId)       where.leadId       = leadId;
    if (df)           where.createdAt    = df;
    if (search) {
      where.OR = [
        { name:               { contains: search, mode: 'insensitive' } },
        { opportunityNumber:  { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, opportunities] = await Promise.all([
      prisma.crmOpportunity.count({ where }),
      prisma.crmOpportunity.findMany({
        where, skip, take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, opportunityNumber: true, name: true, stage: true,
          expectedRevenue: true, probability: true, weightedRevenue: true,
          expectedClosingDate: true, source: true, type: true, salesTeam: true,
          customerId: true, contactId: true, leadId: true, assignedToId: true,
          tags: true, createdAt: true, updatedAt: true,
          assignedTo: { select: userSelect },
          customer: { select: { id: true, name: true, customerNumber: true } },
          contact:  { select: contactSelect },
          _count:   { select: { activities: true, tasks: true } },
        },
      }),
    ]);

    return res.json({ success: true, data: { opportunities, total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getOpportunityById = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const opp = await prisma.crmOpportunity.findFirst({
      where: { id: req.params.id, companyId },
      include: {
        assignedTo: { select: userSelect },
        creator:    { select: userSelect },
        customer:   { select: { id: true, name: true, customerNumber: true } },
        contact:    { select: contactSelect },
        lead:       { select: { id: true, fullName: true, leadNumber: true, status: true } },
        activities: { orderBy: { createdAt: 'desc' }, take: 20,
          select: { id: true, type: true, subject: true, status: true, dueAt: true, createdAt: true } },
        tasks: { where: { isDeleted: false }, orderBy: { dueAt: 'asc' }, take: 10,
          select: { id: true, title: true, status: true, dueAt: true, priority: true } },
      },
    });
    if (!opp) return res.status(404).json({ success: false, message: 'Opportunity not found' });
    return res.json({ success: true, data: opp });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const ERPNEXT_SALES_STAGES = [
  'Prospecting', 'Qualification', 'Needs Analysis', 'Value Proposition',
  'Identifying Decision Makers', 'Perception Analysis', 'Proposal/Price Quote', 'Negotiation/Review',
  // legacy
  'Proposal', 'Negotiation', 'Won', 'Lost',
];

const createOpportunity = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId    = getUserId(req);
    const b = req.body;
    const name = b.name;
    const expectedRevenue = b.expectedRevenue ?? b.amount;
    const customerId = b.customerId ?? b.accountId;
    const expectedClosingDate = b.expectedClosingDate ?? b.expectedCloseDate;

    if (!name) return res.status(400).json({ success: false, message: 'name is required' });
    const year = new Date().getFullYear();
    const opportunityNumber = await generateSequence('crmOpportunity', companyId, `CRM-OPP-${year}-`);
    const rev = parseFloat(expectedRevenue) || 0;
    const prob = parseInt(b.probability, 10);
    const probability = Number.isFinite(prob) ? prob : 100;

    const opp = await prisma.crmOpportunity.create({
      data: {
        companyId, createdBy: userId, opportunityNumber, name,
        customerId: customerId || null, contactId: b.contactId || null, leadId: b.leadId || null,
        source: b.source || null, type: b.type || 'Sales',
        status: b.status || 'Open',
        opportunityFrom: b.opportunityFrom || (b.leadId ? 'Lead' : customerId ? 'Customer' : null),
        assignedToId: b.assignedToId || null, salesTeam: b.salesTeam || null,
        expectedRevenue: rev, probability,
        currency: b.currency || 'PKR',
        weightedRevenue: (rev * probability) / 100,
        expectedClosingDate: expectedClosingDate ? new Date(expectedClosingDate) : null,
        stage: b.stage || 'Prospecting',
        transactionDate: b.transactionDate ? new Date(b.transactionDate) : new Date(),
        description: b.description || null, competitors: b.competitors || null, notes: b.notes || null,
        tags: b.tags || [], customFields: b.customFields || {},
        lostReason: b.lostReason || null, wonReason: b.wonReason || null,
        quotationId: b.quotationId || null, salesOrderId: b.salesOrderId || null,
        noOfEmployees: b.noOfEmployees || null,
        annualRevenue: b.annualRevenue != null && b.annualRevenue !== '' ? parseFloat(b.annualRevenue) : null,
        customerGroup: b.customerGroup || null, industry: b.industry || null,
        marketSegment: b.marketSegment || null, website: b.website || null,
        city: b.city || null, state: b.state || null, country: b.country || null,
        territory: b.territory || null, campaign: b.campaign || null,
        customerName: b.customerName || null, contactPerson: b.contactPerson || null,
        contactEmail: b.contactEmail || null, contactMobile: b.contactMobile || null,
        whatsapp: b.whatsapp || null, phone: b.phone || null, phoneExt: b.phoneExt || null,
        jobTitle: b.jobTitle || null,
      },
      include: { assignedTo: { select: userSelect } },
    });

    // ERPNext: when opportunity created from Lead, mark lead status Opportunity
    if (b.leadId) {
      await prisma.lead.updateMany({
        where: { id: b.leadId, companyId, status: { notIn: ['Converted', 'Do Not Contact'] } },
        data: { status: 'Opportunity', updatedBy: userId },
      }).catch(() => {});
    }

    return res.status(201).json({ success: true, data: opp, message: 'Opportunity created' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateOpportunity = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.crmOpportunity.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Opportunity not found' });

    const body = { ...req.body };
    if (body.amount !== undefined && body.expectedRevenue === undefined) body.expectedRevenue = body.amount;
    if (body.accountId !== undefined && body.customerId === undefined) body.customerId = body.accountId;
    if (body.expectedCloseDate !== undefined && body.expectedClosingDate === undefined) body.expectedClosingDate = body.expectedCloseDate;

    const allowed = [
      'name', 'customerId', 'contactId', 'leadId', 'source', 'type', 'status', 'opportunityFrom',
      'assignedToId', 'salesTeam', 'expectedRevenue', 'probability', 'expectedClosingDate', 'stage',
      'currency', 'transactionDate', 'description', 'competitors', 'notes', 'tags', 'customFields',
      'lostReason', 'wonReason', 'quotationId', 'salesOrderId',
      'noOfEmployees', 'annualRevenue', 'customerGroup', 'industry', 'marketSegment', 'website',
      'city', 'state', 'country', 'territory', 'campaign', 'customerName',
      'contactPerson', 'contactEmail', 'contactMobile', 'whatsapp', 'phone', 'phoneExt', 'jobTitle',
    ];
    const data = { updatedBy: getUserId(req) };
    for (const k of allowed) { if (body[k] !== undefined) data[k] = body[k]; }
    if (data.annualRevenue !== undefined) data.annualRevenue = data.annualRevenue !== null && data.annualRevenue !== '' ? parseFloat(data.annualRevenue) : null;
    if (data.transactionDate) data.transactionDate = new Date(data.transactionDate);

    // Recompute weighted
    const rev  = data.expectedRevenue !== undefined ? parseFloat(data.expectedRevenue)    : undefined;
    const prob = data.probability     !== undefined ? parseInt(data.probability)           : undefined;
    if (rev !== undefined || prob !== undefined) {
      const cur = await prisma.crmOpportunity.findUnique({ where: { id: req.params.id }, select: { expectedRevenue: true, probability: true } });
      const finalRev  = rev  ?? cur.expectedRevenue;
      const finalProb = prob ?? cur.probability;
      data.weightedRevenue = (finalRev * finalProb) / 100;
    }
    if (data.expectedClosingDate) data.expectedClosingDate = new Date(data.expectedClosingDate);

    const opp = await prisma.crmOpportunity.update({
      where: { id: req.params.id }, data,
      include: { assignedTo: { select: userSelect } },
    });
    return res.json({ success: true, data: opp });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateOpportunityStage = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { stage, lostReason, wonReason } = req.body;
    const validStages = ERPNEXT_SALES_STAGES;
    if (!stage || !validStages.includes(stage)) {
      return res.status(400).json({ success: false, message: `stage must be one of: ${validStages.join(', ')}` });
    }
    const existing = await prisma.crmOpportunity.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Opportunity not found' });

    const data = { stage, updatedBy: getUserId(req) };
    if (lostReason) data.lostReason = lostReason;
    if (wonReason)  data.wonReason  = wonReason;

    const opp = await prisma.crmOpportunity.update({ where: { id: req.params.id }, data });
    return res.json({ success: true, data: opp });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteOpportunity = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.crmOpportunity.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Opportunity not found' });
    await prisma.crmOpportunity.update({ where: { id: req.params.id }, data: { isDeleted: true, updatedBy: getUserId(req) } });
    return res.json({ success: true, message: 'Opportunity deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const bulkUpdateOpportunities = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { ids, stage, assignedToId } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: 'ids required' });
    const data = { updatedBy: getUserId(req) };
    if (stage)        data.stage        = stage;
    if (assignedToId) data.assignedToId = assignedToId;
    await prisma.crmOpportunity.updateMany({ where: { id: { in: ids }, companyId }, data });
    return res.json({ success: true, message: `${ids.length} opportunities updated` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const exportOpportunities = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const ExcelJS = require('exceljs');
    const opps = await prisma.crmOpportunity.findMany({
      where: { companyId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Opportunities');
    ws.addRow(['Opp #', 'Name', 'Stage', 'Expected Revenue', 'Probability %', 'Weighted Revenue', 'Closing Date', 'Source', 'Created At']);
    ws.getRow(1).font = { bold: true };
    for (const o of opps) {
      ws.addRow([o.opportunityNumber, o.name, o.stage, o.expectedRevenue, o.probability, o.weightedRevenue || '', o.expectedClosingDate?.toISOString().slice(0, 10) || '', o.source || '', o.createdAt.toISOString().slice(0, 10)]);
    }
    res.setHeader('Content-Disposition', `attachment; filename="crm-opportunities-${Date.now()}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Activities ───────────────────────────────────────────────────────────────

const getActivities = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { skip, take, page, limit } = paginate(req.query);
    const { type, status, assignedToId, leadId, customerId, contactId, opportunityId } = req.query;
    const df = dateFilter(req.query);

    const where = { companyId };
    if (type)          where.type          = type;
    if (status)        where.status        = status;
    if (assignedToId)  where.assignedToId  = assignedToId;
    if (leadId)        where.leadId        = leadId;
    if (customerId)    where.customerId    = customerId;
    if (contactId)     where.contactId     = contactId;
    if (opportunityId) where.opportunityId = opportunityId;
    if (df)            where.dueAt         = df;

    const [total, activities] = await Promise.all([
      prisma.crmActivity.count({ where }),
      prisma.crmActivity.findMany({
        where, skip, take,
        orderBy: { dueAt: 'asc' },
        select: {
          id: true, type: true, subject: true, description: true, status: true, priority: true,
          startAt: true, dueAt: true, durationMins: true, outcome: true, reminderAt: true,
          leadId: true, customerId: true, contactId: true, opportunityId: true,
          assignedToId: true, createdAt: true,
          assignedTo: { select: userSelect },
          creator:    { select: userSelect },
        },
      }),
    ]);

    return res.json({ success: true, data: { activities, total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getActivityById = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const activity = await prisma.crmActivity.findFirst({
      where: { id: req.params.id, companyId },
      include: {
        assignedTo: { select: userSelect },
        creator:    { select: userSelect },
        lead:    { select: { id: true, fullName: true, leadNumber: true } },
        contact: { select: contactSelect },
        opportunity: { select: { id: true, opportunityNumber: true, name: true, stage: true } },
      },
    });
    if (!activity) return res.status(404).json({ success: false, message: 'Activity not found' });
    return res.json({ success: true, data: activity });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createActivity = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId    = getUserId(req);
    const {
      type, subject, description, leadId, customerId, contactId, opportunityId,
      assignedToId, startAt, dueAt, durationMins, priority, status, outcome, reminderAt,
    } = req.body;

    if (!type || !subject) return res.status(400).json({ success: false, message: 'type and subject required' });

    const activity = await prisma.crmActivity.create({
      data: {
        companyId, createdBy: userId,
        type, subject,
        description: description || null,
        leadId: leadId || null, customerId: customerId || null,
        contactId: contactId || null, opportunityId: opportunityId || null,
        assignedToId: assignedToId || userId,
        startAt: startAt ? new Date(startAt) : null,
        dueAt:   dueAt   ? new Date(dueAt)   : null,
        durationMins: durationMins ? parseInt(durationMins) : null,
        priority: priority || 'Medium', status: status || 'Open',
        outcome: outcome || null,
        reminderAt: reminderAt ? new Date(reminderAt) : null,
      },
      include: { assignedTo: { select: userSelect } },
    });
    return res.status(201).json({ success: true, data: activity, message: 'Activity created' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateActivity = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.crmActivity.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Activity not found' });

    const allowed = [
      'type', 'subject', 'description', 'leadId', 'customerId', 'contactId', 'opportunityId',
      'assignedToId', 'startAt', 'dueAt', 'durationMins', 'priority', 'status', 'outcome', 'reminderAt',
    ];
    const data = { updatedBy: getUserId(req) };
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        if (['startAt', 'dueAt', 'reminderAt'].includes(k)) data[k] = req.body[k] ? new Date(req.body[k]) : null;
        else data[k] = req.body[k];
      }
    }

    const activity = await prisma.crmActivity.update({
      where: { id: req.params.id }, data,
      include: { assignedTo: { select: userSelect } },
    });
    return res.json({ success: true, data: activity });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const completeActivity = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.crmActivity.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Activity not found' });
    const { outcome } = req.body;
    const data = { status: 'Completed', updatedBy: getUserId(req) };
    if (outcome) data.outcome = outcome;
    const activity = await prisma.crmActivity.update({ where: { id: req.params.id }, data });
    return res.json({ success: true, data: activity });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteActivity = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.crmActivity.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Activity not found' });
    await prisma.crmActivity.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: 'Activity deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Tasks ────────────────────────────────────────────────────────────────────

const getTasks = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { skip, take, page, limit } = paginate(req.query);
    const { status, assignedToId, leadId, customerId, contactId, opportunityId, priority } = req.query;
    const df = dateFilter(req.query);

    const where = { companyId, isDeleted: false };
    if (status)        where.status        = status;
    if (assignedToId)  where.assignedToId  = assignedToId;
    if (leadId)        where.leadId        = leadId;
    if (customerId)    where.customerId    = customerId;
    if (contactId)     where.contactId     = contactId;
    if (opportunityId) where.opportunityId = opportunityId;
    if (priority)      where.priority      = priority;
    if (df)            where.dueAt         = df;

    const [total, tasks] = await Promise.all([
      prisma.crmTask.count({ where }),
      prisma.crmTask.findMany({
        where, skip, take,
        orderBy: { dueAt: 'asc' },
        select: {
          id: true, title: true, description: true, status: true, priority: true,
          dueAt: true, reminderAt: true, checklist: true,
          leadId: true, customerId: true, contactId: true, opportunityId: true,
          assignedToId: true, createdAt: true, updatedAt: true,
          assignedTo: { select: userSelect },
          creator:    { select: userSelect },
        },
      }),
    ]);

    return res.json({ success: true, data: { tasks, total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getTaskById = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const task = await prisma.crmTask.findFirst({
      where: { id: req.params.id, companyId },
      include: {
        assignedTo: { select: userSelect },
        creator:    { select: userSelect },
        lead:    { select: { id: true, fullName: true, leadNumber: true } },
        contact: { select: contactSelect },
        opportunity: { select: { id: true, opportunityNumber: true, name: true } },
      },
    });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    return res.json({ success: true, data: task });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createTask = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId    = getUserId(req);
    const { title, description, leadId, customerId, contactId, opportunityId, assignedToId, dueAt, priority, status, checklist, reminderAt } = req.body;

    if (!title) return res.status(400).json({ success: false, message: 'title is required' });

    const task = await prisma.crmTask.create({
      data: {
        companyId, createdBy: userId, title,
        description: description || null,
        leadId: leadId || null, customerId: customerId || null,
        contactId: contactId || null, opportunityId: opportunityId || null,
        assignedToId: assignedToId || userId,
        dueAt: dueAt ? new Date(dueAt) : null,
        priority: priority || 'Medium', status: status || 'Open',
        checklist: checklist || [],
        reminderAt: reminderAt ? new Date(reminderAt) : null,
      },
      include: { assignedTo: { select: userSelect } },
    });
    return res.status(201).json({ success: true, data: task, message: 'Task created' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateTask = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.crmTask.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Task not found' });

    const allowed = ['title', 'description', 'leadId', 'customerId', 'contactId', 'opportunityId', 'assignedToId', 'dueAt', 'priority', 'status', 'checklist', 'reminderAt'];
    const data = { updatedBy: getUserId(req) };
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        if (['dueAt', 'reminderAt'].includes(k)) data[k] = req.body[k] ? new Date(req.body[k]) : null;
        else data[k] = req.body[k];
      }
    }

    const task = await prisma.crmTask.update({ where: { id: req.params.id }, data, include: { assignedTo: { select: userSelect } } });
    return res.json({ success: true, data: task });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const completeTask = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.crmTask.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Task not found' });
    const task = await prisma.crmTask.update({ where: { id: req.params.id }, data: { status: 'Completed', updatedBy: getUserId(req) } });
    return res.json({ success: true, data: task });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteTask = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.crmTask.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Task not found' });
    await prisma.crmTask.update({ where: { id: req.params.id }, data: { isDeleted: true, updatedBy: getUserId(req) } });
    return res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Calendar Feed ────────────────────────────────────────────────────────────

const getCalendarFeed = async (req, res) => {
  try {
    const companyId  = getCompanyId(req);
    const { dateFrom, dateTo, assignedToId } = req.query;
    const start = dateFrom ? new Date(dateFrom) : new Date();
    const end   = dateTo   ? new Date(dateTo)   : new Date(start.getTime() + 30 * 86400000);

    const baseFilter  = assignedToId ? { assignedToId } : {};
    const dateRange   = { gte: start, lte: end };

    const [activities, tasks, followUps] = await Promise.all([
      prisma.crmActivity.findMany({
        where: { companyId, dueAt: dateRange, ...baseFilter },
        select: { id: true, type: true, subject: true, status: true, dueAt: true, startAt: true, priority: true, assignedTo: { select: userSelect } },
      }),
      prisma.crmTask.findMany({
        where: { companyId, isDeleted: false, dueAt: dateRange, ...baseFilter },
        select: { id: true, title: true, status: true, dueAt: true, priority: true, assignedTo: { select: userSelect } },
      }),
      prisma.leadFollowUp.findMany({
        where: { companyId, followUpDate: dateRange, ...(assignedToId ? { assignedToId } : {}) },
        select: { id: true, type: true, followUpDate: true, status: true, notes: true,
          lead: { select: { id: true, fullName: true } },
          assignedTo: { select: userSelect },
        },
      }),
    ]);

    const events = [
      ...activities.map(a => ({ id: a.id, kind: 'activity', title: a.subject, date: a.dueAt, startAt: a.startAt, status: a.status, priority: a.priority, type: a.type, assignedTo: a.assignedTo })),
      ...tasks.map(t => ({ id: t.id, kind: 'task', title: t.title, date: t.dueAt, status: t.status, priority: t.priority, assignedTo: t.assignedTo })),
      ...followUps.map(f => ({ id: f.id, kind: 'followup', title: `Follow-up: ${f.lead?.fullName || ''}`, date: f.followUpDate, status: f.status, type: f.type, assignedTo: f.assignedTo })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    return res.json({ success: true, data: { events, from: start, to: end } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Campaigns ────────────────────────────────────────────────────────────────

const getCampaigns = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { skip, take, page, limit } = paginate(req.query);
    const { status, type } = req.query;

    const where = { companyId, isDeleted: false };
    if (status) where.status = status;
    if (type)   where.type   = type;

    const [total, campaigns] = await Promise.all([
      prisma.crmCampaign.count({ where }),
      prisma.crmCampaign.findMany({
        where, skip, take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return res.json({ success: true, data: { campaigns, total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getCampaignById = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const campaign = await prisma.crmCampaign.findFirst({ where: { id: req.params.id, companyId } });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    // Performance stats — lead count from source
    const stats = campaign.sourceId
      ? await prisma.lead.count({ where: { companyId, sourceId: campaign.sourceId, isDeleted: false } })
      : 0;

    return res.json({ success: true, data: { ...campaign, stats: { leadsGenerated: stats } } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createCampaign = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId    = getUserId(req);
    const { name, type, status, startDate, endDate, budget, expectedRevenue, actualRevenue, targetAudience, sourceId, description, assignedUserIds } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });

    const campaign = await prisma.crmCampaign.create({
      data: {
        companyId, createdBy: userId, name,
        type: type || 'Email', status: status || 'Draft',
        startDate: startDate ? new Date(startDate) : null,
        endDate:   endDate   ? new Date(endDate)   : null,
        budget: budget ? parseFloat(budget) : null,
        expectedRevenue: expectedRevenue ? parseFloat(expectedRevenue) : null,
        actualRevenue:   actualRevenue   ? parseFloat(actualRevenue)   : null,
        targetAudience: targetAudience || null,
        sourceId: sourceId || null,
        description: description || null,
        assignedUserIds: assignedUserIds || [],
      },
    });
    return res.status(201).json({ success: true, data: campaign, message: 'Campaign created' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateCampaign = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.crmCampaign.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const allowed = ['name', 'type', 'status', 'startDate', 'endDate', 'budget', 'expectedRevenue', 'actualRevenue', 'targetAudience', 'sourceId', 'description', 'assignedUserIds'];
    const data = { updatedBy: getUserId(req) };
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        if (['startDate', 'endDate'].includes(k)) data[k] = req.body[k] ? new Date(req.body[k]) : null;
        else data[k] = req.body[k];
      }
    }

    const campaign = await prisma.crmCampaign.update({ where: { id: req.params.id }, data });
    return res.json({ success: true, data: campaign });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteCampaign = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.crmCampaign.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Campaign not found' });
    await prisma.crmCampaign.update({ where: { id: req.params.id }, data: { isDeleted: true, updatedBy: getUserId(req) } });
    return res.json({ success: true, message: 'Campaign deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Lead Sources (update / delete) ──────────────────────────────────────────

const updateSource = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.leadSource.findFirst({ where: { id: req.params.id, companyId }, select: { id: true, isDefault: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Lead source not found' });

    const { name, color, isActive } = req.body;
    const data = {};
    if (name     !== undefined) data.name     = name;
    if (color    !== undefined) data.color    = color;
    if (isActive !== undefined) data.isActive = isActive;

    const source = await prisma.leadSource.update({ where: { id: req.params.id }, data });
    return res.json({ success: true, data: source });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, message: 'Source with this name already exists' });
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteSource = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.leadSource.findFirst({ where: { id: req.params.id, companyId }, select: { id: true, isDefault: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Lead source not found' });
    if (existing.isDefault) return res.status(400).json({ success: false, message: 'Cannot delete a default source' });
    await prisma.leadSource.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: 'Lead source deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Accounts (Customer CRM view) ─────────────────────────────────────────────

const getAccounts = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { skip, take, page, limit } = paginate(req.query);
    const { search, status } = req.query;

    const where = { companyId, isDeleted: false };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name:           { contains: search, mode: 'insensitive' } },
        { email:          { contains: search, mode: 'insensitive' } },
        { customerNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, accounts] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where, skip, take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, customerNumber: true, name: true, email: true, phone: true,
          companyName: true, customerType: true, status: true, territory: true,
          totalSpent: true, outstandingBalance: true, createdAt: true,
          _count: { select: { crmContacts: true, crmOpportunities: true } },
        },
      }),
    ]);

    return res.json({ success: true, data: { accounts, total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getAccountById = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const account = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId },
      include: {
        crmContacts: {
          where: { isDeleted: false },
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: contactSelect,
        },
        crmOpportunities: {
          where: { isDeleted: false },
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: { id: true, opportunityNumber: true, name: true, stage: true, expectedRevenue: true, expectedClosingDate: true },
        },
        crmActivities: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: { id: true, type: true, subject: true, status: true, dueAt: true, createdAt: true },
        },
        _count: { select: { crmContacts: true, crmOpportunities: true, crmActivities: true } },
      },
    });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    return res.json({ success: true, data: account });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Account / Customer CRUD ──────────────────────────────────────────────────

const generateCustomerNumber = async (companyId) => {
  const year = new Date().getFullYear();
  const prefix = `CUST-${year}-`;
  const last = await prisma.customer.findFirst({
    where: { companyId, customerNumber: { startsWith: prefix } },
    orderBy: { customerNumber: 'desc' },
    select: { customerNumber: true },
  });
  const seq = last ? (parseInt(last.customerNumber.split('-').pop() || '0') + 1) : 1;
  return `${prefix}${String(seq).padStart(5, '0')}`;
};

const createAccount = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = req.user?.id;
    const {
      name, customerType, customerGroup, territory, defaultCurrency, language,
      email, phone, mobile, website, industry, marketSegment,
      taxId, notes, fromLeadId,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Customer Name is required' });

    const customerNumber = await generateCustomerNumber(companyId);
    const customer = await prisma.customer.create({
      data: {
        customerNumber,
        name: name.trim(),
        customerType: customerType || 'Individual',
        territory: territory || null,
        email: email || null,
        phone: phone || null,
        taxId: taxId || null,
        notes: notes || null,
        companyId,
        createdBy: userId,
        // Extended ERPNext fields stored in address JSON if no dedicated columns
        address: {
          customerGroup: customerGroup || null,
          defaultCurrency: defaultCurrency || null,
          language: language || null,
          mobile: mobile || null,
          website: website || null,
          industry: industry || null,
          marketSegment: marketSegment || null,
          fromLeadId: fromLeadId || null,
        },
      },
    });
    return res.status(201).json({ success: true, data: customer });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateAccount = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = req.user?.id;
    const existing = await prisma.customer.findFirst({ where: { id: req.params.id, companyId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Account not found' });

    const {
      name, customerType, territory, email, phone, taxId, notes,
      customerGroup, defaultCurrency, language, mobile, website, industry, marketSegment,
    } = req.body;

    const updated = await prisma.customer.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name: name.trim() }),
        ...(customerType !== undefined && { customerType }),
        ...(territory !== undefined && { territory }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(taxId !== undefined && { taxId }),
        ...(notes !== undefined && { notes }),
        updatedBy: userId,
        // Merge extra fields into address JSON
        address: {
          ...(existing.address || {}),
          ...(customerGroup !== undefined && { customerGroup }),
          ...(defaultCurrency !== undefined && { defaultCurrency }),
          ...(language !== undefined && { language }),
          ...(mobile !== undefined && { mobile }),
          ...(website !== undefined && { website }),
          ...(industry !== undefined && { industry }),
          ...(marketSegment !== undefined && { marketSegment }),
        },
      },
    });
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteAccount = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing = await prisma.customer.findFirst({ where: { id: req.params.id, companyId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Account not found' });
    await prisma.customer.update({ where: { id: req.params.id }, data: { isDeleted: true } });
    return res.json({ success: true, message: 'Customer deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Reports ──────────────────────────────────────────────────────────────────

const getReport = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { type }  = req.params;
    const df        = dateFilter(req.query);
    const assignedToId = req.query.assignedToId;

    const leadWhere = { companyId, isDeleted: false };
    if (df) leadWhere.createdAt = df;
    if (assignedToId) leadWhere.assignedToId = assignedToId;

    switch (type) {
      case 'lead-analysis': {
        const [statusBreakdown, priorityBreakdown, totalLeads] = await Promise.all([
          prisma.lead.groupBy({ by: ['status'], where: leadWhere, _count: { status: true } }),
          prisma.lead.groupBy({ by: ['priority'], where: leadWhere, _count: { priority: true } }),
          prisma.lead.count({ where: leadWhere }),
        ]);
        return res.json({ success: true, data: { type, totalLeads, statusBreakdown, priorityBreakdown } });
      }

      case 'source': {
        const rows = await prisma.lead.groupBy({ by: ['source'], where: leadWhere, _count: { source: true }, orderBy: { _count: { source: 'desc' } } });
        return res.json({ success: true, data: { type, rows: rows.map(r => ({ source: r.source, count: r._count.source })) } });
      }

      case 'conversion': {
        const [total, converted] = await Promise.all([
          prisma.lead.count({ where: leadWhere }),
          prisma.lead.count({ where: { ...leadWhere, status: 'Converted' } }),
        ]);
        const byMonth = await prisma.$queryRaw`
          SELECT DATE_TRUNC('month', created_at) as month,
                 COUNT(*) as total,
                 COUNT(*) FILTER (WHERE status = 'Converted') as converted
          FROM crm_leads
          WHERE company_id = ${companyId} AND is_deleted = false
          GROUP BY month ORDER BY month ASC
        `;
        return res.json({ success: true, data: { type, total, converted, conversionRate: total > 0 ? +((converted / total) * 100).toFixed(1) : 0, byMonth } });
      }

      case 'pipeline': {
        const stages = await prisma.crmOpportunity.groupBy({
          by: ['stage'],
          where: { companyId, isDeleted: false, ...(assignedToId ? { assignedToId } : {}) },
          _count: { stage: true },
          _sum: { expectedRevenue: true, weightedRevenue: true },
        });
        return res.json({ success: true, data: { type, stages: stages.map(s => ({ stage: s.stage, count: s._count.stage, revenue: s._sum.expectedRevenue, weighted: s._sum.weightedRevenue })) } });
      }

      case 'opportunity': {
        const oppWhere = { companyId, isDeleted: false };
        if (df) oppWhere.createdAt = df;
        if (assignedToId) oppWhere.assignedToId = assignedToId;
        const [total, won, lost, openAgg] = await Promise.all([
          prisma.crmOpportunity.count({ where: oppWhere }),
          prisma.crmOpportunity.count({ where: { ...oppWhere, stage: 'Won' } }),
          prisma.crmOpportunity.count({ where: { ...oppWhere, stage: 'Lost' } }),
          prisma.crmOpportunity.aggregate({ where: { ...oppWhere, stage: { notIn: ['Won', 'Lost'] } }, _sum: { expectedRevenue: true, weightedRevenue: true } }),
        ]);
        return res.json({ success: true, data: { type, total, won, lost, open: total - won - lost, pipelineValue: openAgg._sum.expectedRevenue || 0, weightedValue: openAgg._sum.weightedRevenue || 0 } });
      }

      case 'salesperson': {
        const byPerson = await prisma.lead.groupBy({
          by: ['assignedToId'],
          where: { ...leadWhere, assignedToId: { not: null } },
          _count: { assignedToId: true },
        });
        const ids = byPerson.map(r => r.assignedToId).filter(Boolean);
        const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: userSelect });
        const userMap = Object.fromEntries(users.map(u => [u.id, u]));
        const rows = byPerson.map(r => ({
          user: userMap[r.assignedToId] || { id: r.assignedToId },
          leadCount: r._count.assignedToId,
        }));
        return res.json({ success: true, data: { type, rows } });
      }

      case 'activity': {
        const actWhere = { companyId };
        if (df) actWhere.createdAt = df;
        const breakdown = await prisma.crmActivity.groupBy({ by: ['type', 'status'], where: actWhere, _count: { type: true } });
        return res.json({ success: true, data: { type, breakdown } });
      }

      case 'campaign': {
        const campaigns = await prisma.crmCampaign.findMany({ where: { companyId, isDeleted: false }, orderBy: { createdAt: 'desc' } });
        return res.json({ success: true, data: { type, campaigns } });
      }

      default:
        return res.status(400).json({ success: false, message: `Unknown report type: ${type}. Valid: lead-analysis, source, conversion, pipeline, opportunity, salesperson, activity, campaign` });
    }
  } catch (err) {
    console.error('[CRM Enterprise] getReport error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CRM Custom Fields ────────────────────────────────────────────────────────

const getCrmCustomFields = async (req, res) => {
  try {
    const companyId   = getCompanyId(req);
    const { entityType } = req.query;
    const where = { companyId };
    if (entityType) where.entityType = entityType;
    const fields = await prisma.crmCustomField.findMany({ where, orderBy: [{ entityType: 'asc' }, { sortOrder: 'asc' }] });
    return res.json({ success: true, data: fields });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createCrmCustomField = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { entityType, fieldKey, fieldName, fieldType, options, isRequired, isVisible, sortOrder, defaultValue } = req.body;
    if (!entityType || !fieldKey || !fieldName || !fieldType) {
      return res.status(400).json({ success: false, message: 'entityType, fieldKey, fieldName, fieldType required' });
    }
    const validTypes = ['lead', 'contact', 'account', 'opportunity', 'activity', 'campaign'];
    if (!validTypes.includes(entityType)) return res.status(400).json({ success: false, message: `entityType must be one of: ${validTypes.join(', ')}` });

    const field = await prisma.crmCustomField.create({
      data: {
        companyId, entityType,
        fieldKey: fieldKey.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase(),
        fieldName, fieldType,
        options: options || [], isRequired: !!isRequired, isVisible: isVisible !== false,
        sortOrder: sortOrder || 0, defaultValue: defaultValue || null,
      },
    });
    return res.status(201).json({ success: true, data: field });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, message: 'A field with this key already exists for this entity type' });
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateCrmCustomField = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.crmCustomField.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Custom field not found' });

    const { fieldName, options, isRequired, isVisible, sortOrder, defaultValue } = req.body;
    const field = await prisma.crmCustomField.update({
      where: { id: req.params.id },
      data: { fieldName, options, isRequired, isVisible, sortOrder, defaultValue },
    });
    return res.json({ success: true, data: field });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteCrmCustomField = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing  = await prisma.crmCustomField.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Custom field not found' });
    await prisma.crmCustomField.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: 'Custom field deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Dashboard
  getEnterpriseDashboard,
  // Contacts
  getContacts, getContactById, createContact, updateContact, deleteContact, exportContacts,
  // Opportunities
  getOpportunities, getOpportunityById, createOpportunity, updateOpportunity,
  updateOpportunityStage, deleteOpportunity, bulkUpdateOpportunities, exportOpportunities,
  // Activities
  getActivities, getActivityById, createActivity, updateActivity, completeActivity, deleteActivity,
  // Tasks
  getTasks, getTaskById, createTask, updateTask, completeTask, deleteTask,
  // Calendar
  getCalendarFeed,
  // Campaigns
  getCampaigns, getCampaignById, createCampaign, updateCampaign, deleteCampaign,
  // Sources
  updateSource, deleteSource,
  // Accounts
  getAccounts, getAccountById, createAccount, updateAccount, deleteAccount,
  // Reports
  getReport,
  // CRM Custom Fields
  getCrmCustomFields, createCrmCustomField, updateCrmCustomField, deleteCrmCustomField,
};
