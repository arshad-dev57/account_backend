/**
 * ERPNext CRM parity — Prospects, Appointments, Contracts, Masters, Settings, Email Campaigns, Reports
 */
const prisma = require('../prisma/client');
const { randomUUID } = require('crypto');

function companyId(req) {
  return req.user?.companyId || null;
}
function userId(req) {
  return req.user?.id || null;
}

async function seq(model, companyIdVal, prefix, field) {
  const last = await prisma[model].findFirst({
    where: { companyId: companyIdVal, [field]: { startsWith: prefix } },
    orderBy: { [field]: 'desc' },
    select: { [field]: true },
  });
  let num = 1;
  if (last?.[field]) {
    const n = parseInt(String(last[field]).slice(prefix.length), 10);
    if (Number.isFinite(n) && n > 0) num = n + 1;
  }
  for (let i = 0; i < 8; i++) {
    const candidate = `${prefix}${String(num + i).padStart(5, '0')}`;
    const exists = await prisma[model].findFirst({ where: { [field]: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `${prefix}${Date.now().toString().slice(-5)}`;
}

function crudMaster(modelName, defaults = {}) {
  return {
    list: async (req, res) => {
      try {
        const cid = companyId(req);
        const rows = await prisma[modelName].findMany({
          where: { companyId: cid, ...(req.query.active === '1' ? { isActive: true } : {}) },
          orderBy: modelName === 'crmSalesStage' ? [{ sortOrder: 'asc' }, { name: 'asc' }] : { name: 'asc' },
        });
        return res.json({ success: true, data: rows });
      } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
    },
    get: async (req, res) => {
      try {
        const cid = companyId(req);
        const row = await prisma[modelName].findFirst({
          where: { id: req.params.id, companyId: cid },
        });
        if (!row) return res.status(404).json({ success: false, message: 'Not found' });
        return res.json({ success: true, data: row });
      } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
    },
    create: async (req, res) => {
      try {
        const cid = companyId(req);
        const name = (req.body.name || '').trim();
        if (!name) return res.status(400).json({ success: false, message: 'name is required' });
        const data = { id: randomUUID(), companyId: cid, name, ...defaults, ...req.body, name };
        delete data.companyId;
        const row = await prisma[modelName].create({
          data: { ...data, companyId: cid, id: randomUUID(), updatedAt: new Date() },
        });
        return res.status(201).json({ success: true, data: row });
      } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
    },
    update: async (req, res) => {
      try {
        const cid = companyId(req);
        const existing = await prisma[modelName].findFirst({ where: { id: req.params.id, companyId: cid } });
        if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
        const allowed = ['name', 'description', 'isActive', 'sortOrder', 'parentId', 'website', 'color', 'isDefault'];
        const data = { updatedAt: new Date() };
        for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
        const row = await prisma[modelName].update({ where: { id: req.params.id }, data });
        return res.json({ success: true, data: row });
      } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
    },
    remove: async (req, res) => {
      try {
        const cid = companyId(req);
        const existing = await prisma[modelName].findFirst({ where: { id: req.params.id, companyId: cid } });
        if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
        await prisma[modelName].delete({ where: { id: req.params.id } });
        return res.json({ success: true, message: 'Deleted' });
      } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
    },
  };
}

const salesStages = crudMaster('crmSalesStage', { sortOrder: 0, isActive: true });
const opportunityTypes = crudMaster('crmOpportunityType', { isActive: true });
const marketSegments = crudMaster('crmMarketSegment', { isActive: true });
const territories = crudMaster('crmTerritory', { isActive: true });
const customerGroups = crudMaster('crmCustomerGroup', { isActive: true });
const lostReasons = crudMaster('crmLostReason', { isActive: true });
const competitors = crudMaster('crmCompetitor', { isActive: true });
const leadSources = crudMaster('leadSource', { isActive: true, color: '#014582' });

const seedErpnextMasters = async (req, res) => {
  try {
    const cid = companyId(req);
    const stages = [
      'Prospecting', 'Qualification', 'Needs Analysis', 'Value Proposition',
      'Identifying Decision Makers', 'Perception Analysis', 'Proposal/Price Quote', 'Negotiation/Review',
    ];
    for (let i = 0; i < stages.length; i++) {
      await prisma.crmSalesStage.upsert({
        where: { companyId_name: { companyId: cid, name: stages[i] } },
        update: { sortOrder: i },
        create: { id: randomUUID(), companyId: cid, name: stages[i], sortOrder: i, updatedAt: new Date() },
      });
    }
    for (const name of ['Sales', 'Support', 'Maintenance']) {
      await prisma.crmOpportunityType.upsert({
        where: { companyId_name: { companyId: cid, name } },
        update: {},
        create: { id: randomUUID(), companyId: cid, name, updatedAt: new Date() },
      });
    }
    for (const name of ['Lower Income', 'Middle Income', 'Upper Income', 'Corporate']) {
      await prisma.crmMarketSegment.upsert({
        where: { companyId_name: { companyId: cid, name } },
        update: {},
        create: { id: randomUUID(), companyId: cid, name, updatedAt: new Date() },
      });
    }
    for (const name of ['All Territories', 'Pakistan', 'North', 'South', 'Online']) {
      await prisma.crmTerritory.upsert({
        where: { companyId_name: { companyId: cid, name } },
        update: {},
        create: { id: randomUUID(), companyId: cid, name, updatedAt: new Date() },
      });
    }
    for (const name of ['Commercial', 'Individual', 'Government', 'Non Profit']) {
      await prisma.crmCustomerGroup.upsert({
        where: { companyId_name: { companyId: cid, name } },
        update: {},
        create: { id: randomUUID(), companyId: cid, name, updatedAt: new Date() },
      });
    }
    for (const name of ['Price', 'Competitor', 'No Budget', 'Not Interested', 'Other']) {
      await prisma.crmLostReason.upsert({
        where: { companyId_name: { companyId: cid, name } },
        update: {},
        create: { id: randomUUID(), companyId: cid, name, updatedAt: new Date() },
      });
    }
    const leadSourceNames = [
      'Walk In', 'Cold Calling', 'Advertisement', 'Exhibition',
      'Supplier Reference', 'Mass Mailing', "Customer's Referral",
      'Campaign', 'Word of Mouth', 'Other', 'Social Media',
      'Email Campaign', 'Website',
    ];
    for (const name of leadSourceNames) {
      await prisma.leadSource.upsert({
        where: { companyId_name: { companyId: cid, name } },
        update: {},
        create: { id: randomUUID(), companyId: cid, name, isActive: true, updatedAt: new Date() },
      });
    }
    await prisma.crmSettings.upsert({
      where: { companyId: cid },
      update: {},
      create: { id: randomUUID(), companyId: cid },
    });
    return res.json({ success: true, message: 'ERPNext CRM masters seeded' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CRM Settings ────────────────────────────────────────────────────────────
const getCrmSettings = async (req, res) => {
  try {
    const cid = companyId(req);
    let settings = await prisma.crmSettings.findUnique({ where: { companyId: cid } });
    if (!settings) {
      settings = await prisma.crmSettings.create({ data: { id: randomUUID(), companyId: cid } });
    }
    return res.json({ success: true, data: settings });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateCrmSettings = async (req, res) => {
  try {
    const cid = companyId(req);
    const allowed = [
      'campaignNamingBy', 'allowLeadDuplicationBasedOnEmail', 'autoCreationOfContact',
      'closeOpportunityAfterDays', 'enableOpportunityFromContactUs', 'defaultQuotationValidTillDays',
      'carryForwardCommunication', 'updateTimestampOnNewCommunication',
    ];
    const data = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    const settings = await prisma.crmSettings.upsert({
      where: { companyId: cid },
      update: data,
      create: { id: randomUUID(), companyId: cid, ...data },
    });
    return res.json({ success: true, data: settings });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Prospects ───────────────────────────────────────────────────────────────
const getProspects = async (req, res) => {
  try {
    const cid = companyId(req);
    const search = (req.query.search || '').trim();
    const where = { companyId: cid, isDeleted: false };
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { industry: { contains: search, mode: 'insensitive' } },
        { territory: { contains: search, mode: 'insensitive' } },
      ];
    }
    const rows = await prisma.crmProspect.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        prospectOwner: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { leads: true, opportunities: true } },
      },
    });
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getProspectById = async (req, res) => {
  try {
    const cid = companyId(req);
    const row = await prisma.crmProspect.findFirst({
      where: { id: req.params.id, companyId: cid, isDeleted: false },
      include: {
        prospectOwner: { select: { id: true, firstName: true, lastName: true, email: true } },
        leads: { include: { lead: { select: { id: true, leadNumber: true, fullName: true, status: true, companyName: true, email: true } } } },
        opportunities: { include: { opportunity: { select: { id: true, opportunityNumber: true, name: true, stage: true, status: true, expectedRevenue: true } } } },
      },
    });
    if (!row) return res.status(404).json({ success: false, message: 'Prospect not found' });
    return res.json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createProspect = async (req, res) => {
  try {
    const cid = companyId(req);
    const uid = userId(req);
    const companyName = (req.body.companyName || '').trim();
    if (!companyName) return res.status(400).json({ success: false, message: 'Organization Name is required' });
    const row = await prisma.crmProspect.create({
      data: {
        id: randomUUID(),
        companyId: cid,
        companyName,
        customerGroup: req.body.customerGroup || null,
        noOfEmployees: req.body.noOfEmployees || null,
        annualRevenue: req.body.annualRevenue != null && req.body.annualRevenue !== '' ? parseFloat(req.body.annualRevenue) : null,
        marketSegment: req.body.marketSegment || null,
        industry: req.body.industry || null,
        territory: req.body.territory || null,
        website: req.body.website || null,
        fax: req.body.fax || null,
        prospectOwnerId: req.body.prospectOwnerId || uid,
        notes: req.body.notes || null,
        createdBy: uid,
      },
    });
    if (Array.isArray(req.body.leadIds)) {
      for (const leadId of req.body.leadIds) {
        await prisma.crmProspectLead.create({ data: { id: randomUUID(), prospectId: row.id, leadId } }).catch(() => {});
      }
    }
    return res.status(201).json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateProspect = async (req, res) => {
  try {
    const cid = companyId(req);
    const existing = await prisma.crmProspect.findFirst({ where: { id: req.params.id, companyId: cid } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    const allowed = [
      'companyName', 'customerGroup', 'noOfEmployees', 'annualRevenue', 'marketSegment',
      'industry', 'territory', 'website', 'fax', 'prospectOwnerId', 'notes',
    ];
    const data = { updatedBy: userId(req) };
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    if (data.annualRevenue !== undefined) {
      data.annualRevenue = data.annualRevenue !== null && data.annualRevenue !== '' ? parseFloat(data.annualRevenue) : null;
    }
    const row = await prisma.crmProspect.update({ where: { id: req.params.id }, data });
    return res.json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteProspect = async (req, res) => {
  try {
    const cid = companyId(req);
    await prisma.crmProspect.updateMany({ where: { id: req.params.id, companyId: cid }, data: { isDeleted: true, updatedBy: userId(req) } });
    return res.json({ success: true, message: 'Prospect deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const addLeadToProspect = async (req, res) => {
  try {
    const cid = companyId(req);
    const prospect = await prisma.crmProspect.findFirst({ where: { id: req.params.id, companyId: cid } });
    if (!prospect) return res.status(404).json({ success: false, message: 'Prospect not found' });
    const leadId = req.body.leadId;
    if (!leadId) return res.status(400).json({ success: false, message: 'leadId required' });
    const link = await prisma.crmProspectLead.upsert({
      where: { prospectId_leadId: { prospectId: prospect.id, leadId } },
      update: {},
      create: { id: randomUUID(), prospectId: prospect.id, leadId },
    });
    return res.json({ success: true, data: link });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const makeOpportunityFromProspect = async (req, res) => {
  try {
    const cid = companyId(req);
    const uid = userId(req);
    const prospect = await prisma.crmProspect.findFirst({ where: { id: req.params.id, companyId: cid, isDeleted: false } });
    if (!prospect) return res.status(404).json({ success: false, message: 'Prospect not found' });
    const year = new Date().getFullYear();
    const opportunityNumber = await seq('crmOpportunity', cid, `CRM-OPP-${year}-`, 'opportunityNumber');
    const opp = await prisma.crmOpportunity.create({
      data: {
        companyId: cid,
        createdBy: uid,
        opportunityNumber,
        name: req.body.name || `${prospect.companyName} Opportunity`,
        opportunityFrom: 'Prospect',
        status: 'Open',
        type: req.body.type || 'Sales',
        stage: req.body.stage || 'Prospecting',
        probability: 100,
        source: req.body.source || null,
        industry: prospect.industry,
        marketSegment: prospect.marketSegment,
        territory: prospect.territory,
        website: prospect.website,
        noOfEmployees: prospect.noOfEmployees,
        annualRevenue: prospect.annualRevenue,
        customerGroup: prospect.customerGroup,
        customerName: prospect.companyName,
        assignedToId: prospect.prospectOwnerId || uid,
      },
    });
    await prisma.crmProspectOpportunity.create({
      data: { id: randomUUID(), prospectId: prospect.id, opportunityId: opp.id },
    }).catch(() => {});
    return res.status(201).json({ success: true, data: opp });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Appointments ────────────────────────────────────────────────────────────
const getAppointments = async (req, res) => {
  try {
    const cid = companyId(req);
    const where = { companyId: cid, isDeleted: false };
    if (req.query.status) where.status = req.query.status;
    const rows = await prisma.crmAppointment.findMany({
      where,
      orderBy: { scheduledTime: 'asc' },
      include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
    });
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getAppointmentById = async (req, res) => {
  try {
    const row = await prisma.crmAppointment.findFirst({
      where: { id: req.params.id, companyId: companyId(req), isDeleted: false },
      include: { assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createAppointment = async (req, res) => {
  try {
    const cid = companyId(req);
    const uid = userId(req);
    if (!req.body.scheduledTime || !req.body.customerName) {
      return res.status(400).json({ success: false, message: 'Scheduled Time and Customer Name are required' });
    }
    const row = await prisma.crmAppointment.create({
      data: {
        id: randomUUID(),
        companyId: cid,
        scheduledTime: new Date(req.body.scheduledTime),
        status: req.body.status || 'Open',
        customerName: req.body.customerName,
        customerEmail: req.body.customerEmail || null,
        customerPhone: req.body.customerPhone || null,
        skype: req.body.skype || null,
        details: req.body.details || null,
        appointmentWith: req.body.appointmentWith || null,
        partyId: req.body.partyId || null,
        leadId: req.body.leadId || null,
        customerId: req.body.customerId || null,
        opportunityId: req.body.opportunityId || null,
        assignedToId: req.body.assignedToId || uid,
        createdBy: uid,
      },
    });
    return res.status(201).json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateAppointment = async (req, res) => {
  try {
    const cid = companyId(req);
    const existing = await prisma.crmAppointment.findFirst({ where: { id: req.params.id, companyId: cid } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    const allowed = [
      'scheduledTime', 'status', 'customerName', 'customerEmail', 'customerPhone', 'skype', 'details',
      'appointmentWith', 'partyId', 'leadId', 'customerId', 'opportunityId', 'assignedToId',
    ];
    const data = { updatedBy: userId(req) };
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    if (data.scheduledTime) data.scheduledTime = new Date(data.scheduledTime);
    const row = await prisma.crmAppointment.update({ where: { id: req.params.id }, data });
    return res.json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteAppointment = async (req, res) => {
  try {
    await prisma.crmAppointment.updateMany({
      where: { id: req.params.id, companyId: companyId(req) },
      data: { isDeleted: true, updatedBy: userId(req) },
    });
    return res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Contracts ───────────────────────────────────────────────────────────────
const getContracts = async (req, res) => {
  try {
    const cid = companyId(req);
    const where = { companyId: cid, isDeleted: false };
    if (req.query.status) where.status = req.query.status;
    const rows = await prisma.crmContract.findMany({ where, orderBy: { updatedAt: 'desc' } });
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getContractById = async (req, res) => {
  try {
    const row = await prisma.crmContract.findFirst({
      where: { id: req.params.id, companyId: companyId(req), isDeleted: false },
    });
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createContract = async (req, res) => {
  try {
    const cid = companyId(req);
    const uid = userId(req);
    if (!req.body.partyName) return res.status(400).json({ success: false, message: 'Party Name is required' });
    const year = new Date().getFullYear();
    const contractNumber = await seq('crmContract', cid, `CRM-CT-${year}-`, 'contractNumber');
    const row = await prisma.crmContract.create({
      data: {
        id: randomUUID(),
        companyId: cid,
        contractNumber,
        partyType: req.body.partyType || 'Customer',
        partyName: req.body.partyName,
        partyId: req.body.partyId || null,
        status: req.body.status || 'Unsigned',
        fulfilmentStatus: req.body.fulfilmentStatus || 'N/A',
        startDate: req.body.startDate ? new Date(req.body.startDate) : null,
        endDate: req.body.endDate ? new Date(req.body.endDate) : null,
        signedOn: req.body.signedOn ? new Date(req.body.signedOn) : null,
        signee: req.body.signee || null,
        isSigned: !!req.body.isSigned,
        contractTemplate: req.body.contractTemplate || null,
        contractTerms: req.body.contractTerms || null,
        fulfilmentTerms: req.body.fulfilmentTerms || null,
        fulfilmentDeadline: req.body.fulfilmentDeadline ? new Date(req.body.fulfilmentDeadline) : null,
        documentType: req.body.documentType || null,
        documentName: req.body.documentName || null,
        notes: req.body.notes || null,
        createdBy: uid,
      },
    });
    return res.status(201).json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateContract = async (req, res) => {
  try {
    const cid = companyId(req);
    const existing = await prisma.crmContract.findFirst({ where: { id: req.params.id, companyId: cid } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    const allowed = [
      'partyType', 'partyName', 'partyId', 'status', 'fulfilmentStatus', 'startDate', 'endDate',
      'signedOn', 'signee', 'isSigned', 'contractTemplate', 'contractTerms', 'fulfilmentTerms',
      'fulfilmentDeadline', 'documentType', 'documentName', 'notes',
    ];
    const data = { updatedBy: userId(req) };
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    for (const d of ['startDate', 'endDate', 'signedOn', 'fulfilmentDeadline']) {
      if (data[d]) data[d] = new Date(data[d]);
    }
    const row = await prisma.crmContract.update({ where: { id: req.params.id }, data });
    return res.json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteContract = async (req, res) => {
  try {
    await prisma.crmContract.updateMany({
      where: { id: req.params.id, companyId: companyId(req) },
      data: { isDeleted: true, updatedBy: userId(req) },
    });
    return res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Email Campaigns ─────────────────────────────────────────────────────────
const getEmailCampaigns = async (req, res) => {
  try {
    const rows = await prisma.crmEmailCampaign.findMany({
      where: { companyId: companyId(req), isDeleted: false },
      orderBy: { startDate: 'desc' },
    });
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createEmailCampaign = async (req, res) => {
  try {
    const cid = companyId(req);
    const uid = userId(req);
    if (!req.body.name || !req.body.startDate) {
      return res.status(400).json({ success: false, message: 'Name and Start Date are required' });
    }
    const row = await prisma.crmEmailCampaign.create({
      data: {
        id: randomUUID(),
        companyId: cid,
        name: req.body.name,
        campaignId: req.body.campaignId || null,
        emailCampaignFor: req.body.emailCampaignFor || 'Lead',
        recipientId: req.body.recipientId || null,
        senderId: req.body.senderId || uid,
        startDate: new Date(req.body.startDate),
        endDate: req.body.endDate ? new Date(req.body.endDate) : null,
        status: req.body.status || 'Scheduled',
        notes: req.body.notes || null,
        createdBy: uid,
      },
    });
    return res.status(201).json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateEmailCampaign = async (req, res) => {
  try {
    const cid = companyId(req);
    const existing = await prisma.crmEmailCampaign.findFirst({ where: { id: req.params.id, companyId: cid } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    const allowed = ['name', 'campaignId', 'emailCampaignFor', 'recipientId', 'senderId', 'startDate', 'endDate', 'status', 'notes'];
    const data = { updatedBy: userId(req) };
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    if (data.startDate) data.startDate = new Date(data.startDate);
    if (data.endDate) data.endDate = new Date(data.endDate);
    const row = await prisma.crmEmailCampaign.update({ where: { id: req.params.id }, data });
    return res.json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteEmailCampaign = async (req, res) => {
  try {
    await prisma.crmEmailCampaign.updateMany({
      where: { id: req.params.id, companyId: companyId(req) },
      data: { isDeleted: true, updatedBy: userId(req) },
    });
    return res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Make Quotation from Lead / Opportunity ──────────────────────────────────
const makeQuotationFromLead = async (req, res) => {
  try {
    const cid = companyId(req);
    const uid = userId(req);
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, companyId: cid, isDeleted: false } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    let customerId = lead.convertedCustomerId;
    if (!customerId) {
      // Ensure customer exists for quotation FK
      const customerNumber = `CUST-CRM-${Date.now().toString().slice(-8)}`;
      const customer = await prisma.customer.create({
        data: {
          customerNumber,
          name: lead.companyName || lead.fullName,
          email: lead.email || null,
          phone: lead.phone || lead.mobile || null,
          companyName: lead.companyName || null,
          companyId: cid,
          createdBy: uid,
          territory: lead.territory || null,
        },
      });
      customerId = customer.id;
      await prisma.lead.update({
        where: { id: lead.id },
        data: { convertedCustomerId: customerId, status: 'Quotation', updatedBy: uid },
      });
    } else {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: 'Quotation', updatedBy: uid },
      });
    }

    const settings = await prisma.crmSettings.findUnique({ where: { companyId: cid } }).catch(() => null);
    const validDays = settings?.defaultQuotationValidTillDays || 30;
    const quotationNumber = await seq('quotation', cid, `QTN-${new Date().getFullYear()}-`, 'quotationNumber');
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + validDays);

    const quotation = await prisma.quotation.create({
      data: {
        quotationNumber,
        customerId,
        customerName: lead.companyName || lead.fullName,
        customerEmail: lead.email || null,
        customerPhone: lead.phone || lead.mobile || null,
        customerCompany: lead.companyName || null,
        validUntil,
        status: 'Draft',
        notes: lead.notes || null,
        createdBy: uid,
        companyId: cid,
        leadId: lead.id,
      },
    });

    return res.status(201).json({ success: true, data: quotation });
  } catch (err) {
    console.error('[CRM] makeQuotationFromLead', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const makeQuotationFromOpportunity = async (req, res) => {
  try {
    const cid = companyId(req);
    const uid = userId(req);
    const opp = await prisma.crmOpportunity.findFirst({
      where: { id: req.params.id, companyId: cid, isDeleted: false },
      include: { customer: true, lead: true },
    });
    if (!opp) return res.status(404).json({ success: false, message: 'Opportunity not found' });

    let customerId = opp.customerId;
    if (!customerId) {
      const customerNumber = `CUST-CRM-${Date.now().toString().slice(-8)}`;
      const customer = await prisma.customer.create({
        data: {
          customerNumber,
          name: opp.customerName || opp.name,
          email: opp.contactEmail || null,
          phone: opp.contactMobile || opp.phone || null,
          companyName: opp.customerName || null,
          companyId: cid,
          createdBy: uid,
          territory: opp.territory || null,
        },
      });
      customerId = customer.id;
      await prisma.crmOpportunity.update({
        where: { id: opp.id },
        data: { customerId, status: 'Quotation', updatedBy: uid },
      });
    } else {
      await prisma.crmOpportunity.update({
        where: { id: opp.id },
        data: { status: 'Quotation', updatedBy: uid },
      });
    }

    if (opp.leadId) {
      await prisma.lead.updateMany({
        where: { id: opp.leadId, companyId: cid },
        data: { status: 'Quotation', updatedBy: uid },
      });
    }

    const settings = await prisma.crmSettings.findUnique({ where: { companyId: cid } }).catch(() => null);
    const validDays = settings?.defaultQuotationValidTillDays || 30;
    const quotationNumber = await seq('quotation', cid, `QTN-${new Date().getFullYear()}-`, 'quotationNumber');
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + validDays);

    const quotation = await prisma.quotation.create({
      data: {
        quotationNumber,
        customerId,
        customerName: opp.customerName || opp.name,
        customerEmail: opp.contactEmail || null,
        customerPhone: opp.contactMobile || opp.phone || null,
        customerCompany: opp.customerName || null,
        validUntil,
        status: 'Draft',
        notes: opp.notes || null,
        createdBy: uid,
        companyId: cid,
        leadId: opp.leadId || null,
        opportunityId: opp.id,
        subtotal: opp.expectedRevenue || 0,
        grandTotal: opp.expectedRevenue || 0,
      },
    });

    await prisma.crmOpportunity.update({
      where: { id: opp.id },
      data: { quotationId: quotation.id },
    }).catch(() => {});

    return res.status(201).json({ success: true, data: quotation });
  } catch (err) {
    console.error('[CRM] makeQuotationFromOpportunity', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── ERPNext-style reports ───────────────────────────────────────────────────
const getErpnextReport = async (req, res) => {
  try {
    const cid = companyId(req);
    const type = req.params.type;
    const from = req.query.from ? new Date(req.query.from) : new Date(new Date().getFullYear(), 0, 1);
    const to = req.query.to ? new Date(req.query.to) : new Date();

    if (type === 'lead-details') {
      const where = {
        companyId: cid,
        isDeleted: false,
        createdAt: { gte: from, lte: to },
      };
      if (req.query.status) where.status = String(req.query.status);
      if (req.query.territory) {
        where.territory = { contains: String(req.query.territory), mode: 'insensitive' };
      }
      const leads = await prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          leadNumber: true, fullName: true, companyName: true, status: true, source: true,
          territory: true, jobTitle: true, email: true, phone: true, createdAt: true,
          assignedTo: { select: { firstName: true, lastName: true } },
        },
      });
      return res.json({ success: true, data: { type, rows: leads } });
    }

    if (type === 'sales-pipeline-analytics' || type === 'opportunity-summary-by-sales-stage') {
      const stages = await prisma.crmOpportunity.groupBy({
        by: ['stage'],
        where: { companyId: cid, isDeleted: false, createdAt: { gte: from, lte: to } },
        _count: { stage: true },
        _sum: { expectedRevenue: true, weightedRevenue: true },
      });
      return res.json({
        success: true,
        data: {
          type,
          stages: stages.map((s) => ({
            stage: s.stage,
            count: s._count.stage,
            revenue: s._sum.expectedRevenue || 0,
            weighted: s._sum.weightedRevenue || 0,
          })),
        },
      });
    }

    if (type === 'sales-funnel') {
      const [leads, opps, quotations, converted] = await Promise.all([
        prisma.lead.count({ where: { companyId: cid, isDeleted: false, createdAt: { gte: from, lte: to } } }),
        prisma.crmOpportunity.count({ where: { companyId: cid, isDeleted: false, createdAt: { gte: from, lte: to } } }),
        prisma.quotation.count({ where: { companyId: cid, isDeleted: false, createdAt: { gte: from, lte: to } } }).catch(() => 0),
        prisma.lead.count({ where: { companyId: cid, isDeleted: false, status: 'Converted', createdAt: { gte: from, lte: to } } }),
      ]);
      return res.json({
        success: true,
        data: {
          type,
          funnel: [
            { stage: 'Lead', count: leads },
            { stage: 'Opportunity', count: opps },
            { stage: 'Quotation', count: quotations },
            { stage: 'Converted', count: converted },
          ],
        },
      });
    }

    if (type === 'lead-owner-efficiency') {
      const leads = await prisma.lead.groupBy({
        by: ['assignedToId'],
        where: { companyId: cid, isDeleted: false, createdAt: { gte: from, lte: to } },
        _count: { assignedToId: true },
      });
      const converted = await prisma.lead.groupBy({
        by: ['assignedToId'],
        where: { companyId: cid, isDeleted: false, status: 'Converted', createdAt: { gte: from, lte: to } },
        _count: { assignedToId: true },
      });
      const convMap = Object.fromEntries(converted.map((c) => [c.assignedToId || 'unassigned', c._count.assignedToId]));
      const userIds = leads.map((l) => l.assignedToId).filter(Boolean);
      const users = userIds.length
        ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
        : [];
      const userMap = Object.fromEntries(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
      const rows = leads.map((l) => {
        const key = l.assignedToId || 'unassigned';
        const total = l._count.assignedToId;
        const won = convMap[key] || 0;
        return {
          owner: l.assignedToId ? userMap[l.assignedToId] || l.assignedToId : 'Unassigned',
          total,
          converted: won,
          rate: total ? Math.round((won / total) * 100) : 0,
        };
      });
      return res.json({ success: true, data: { type, rows } });
    }

    if (type === 'campaign-efficiency') {
      const bySource = await prisma.lead.groupBy({
        by: ['source'],
        where: { companyId: cid, isDeleted: false, createdAt: { gte: from, lte: to } },
        _count: { source: true },
      });
      const convertedBySource = await prisma.lead.groupBy({
        by: ['source'],
        where: { companyId: cid, isDeleted: false, status: 'Converted', createdAt: { gte: from, lte: to } },
        _count: { source: true },
      });
      const cmap = Object.fromEntries(convertedBySource.map((c) => [c.source, c._count.source]));
      const rows = bySource.map((s) => ({
        source: s.source,
        leads: s._count.source,
        converted: cmap[s.source] || 0,
        rate: s._count.source ? Math.round(((cmap[s.source] || 0) / s._count.source) * 100) : 0,
      }));
      return res.json({ success: true, data: { type, rows } });
    }

    if (type === 'prospects-engaged-but-not-converted') {
      const leads = await prisma.lead.findMany({
        where: {
          companyId: cid,
          isDeleted: false,
          status: { notIn: ['Converted', 'Do Not Contact'] },
          createdAt: { gte: from, lte: to },
          OR: [{ activities: { some: {} } }, { followUps: { some: {} } }, { crmActivities: { some: {} } }],
        },
        select: {
          leadNumber: true, fullName: true, companyName: true, status: true, source: true,
          email: true, updatedAt: true,
          _count: { select: { activities: true, followUps: true } },
        },
        take: 200,
        orderBy: { updatedAt: 'desc' },
      });
      return res.json({ success: true, data: { type, rows: leads } });
    }

    if (type === 'inactive-customers') {
      const customers = await prisma.customer.findMany({
        where: { companyId: cid, isDeleted: false },
        select: {
          id: true, customerNumber: true, name: true, email: true, phone: true, updatedAt: true, createdAt: true,
        },
        orderBy: { updatedAt: 'asc' },
        take: 100,
      });
      return res.json({ success: true, data: { type, rows: customers } });
    }

    if (type === 'first-response-time-for-opportunity') {
      const opps = await prisma.crmOpportunity.findMany({
        where: { companyId: cid, isDeleted: false, createdAt: { gte: from, lte: to } },
        select: {
          id: true,
          name: true,
          opportunityNumber: true,
          stage: true,
          createdAt: true,
          assignedTo: { select: { firstName: true, lastName: true } },
          activities: {
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { createdAt: true, type: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const rows = opps.map((o) => {
        const first = o.activities?.[0];
        const created = new Date(o.createdAt).getTime();
        const responded = first ? new Date(first.createdAt).getTime() : null;
        const hours =
          responded != null ? Math.round(((responded - created) / 36e5) * 10) / 10 : null;
        return {
          opportunity: o.name || o.opportunityNumber,
          owner: o.assignedTo
            ? `${o.assignedTo.firstName || ''} ${o.assignedTo.lastName || ''}`.trim()
            : 'Unassigned',
          stage: o.stage,
          createdAt: o.createdAt,
          firstResponseAt: first?.createdAt || null,
          firstResponseType: first?.type || null,
          responseTimeHours: hours,
        };
      });
      return res.json({ success: true, data: { type, rows } });
    }

    return res.status(400).json({ success: false, message: `Unknown report type: ${type}` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  // masters
  listSalesStages: salesStages.list, getSalesStage: salesStages.get, createSalesStage: salesStages.create, updateSalesStage: salesStages.update, deleteSalesStage: salesStages.remove,
  listOpportunityTypes: opportunityTypes.list, getOpportunityType: opportunityTypes.get, createOpportunityType: opportunityTypes.create, updateOpportunityType: opportunityTypes.update, deleteOpportunityType: opportunityTypes.remove,
  listMarketSegments: marketSegments.list, getMarketSegment: marketSegments.get, createMarketSegment: marketSegments.create, updateMarketSegment: marketSegments.update, deleteMarketSegment: marketSegments.remove,
  listTerritories: territories.list, getTerritory: territories.get, createTerritory: territories.create, updateTerritory: territories.update, deleteTerritory: territories.remove,
  listCustomerGroups: customerGroups.list, getCustomerGroup: customerGroups.get, createCustomerGroup: customerGroups.create, updateCustomerGroup: customerGroups.update, deleteCustomerGroup: customerGroups.remove,
  listLostReasons: lostReasons.list, getLostReason: lostReasons.get, createLostReason: lostReasons.create, updateLostReason: lostReasons.update, deleteLostReason: lostReasons.remove,
  listCompetitors: competitors.list, getCompetitor: competitors.get, createCompetitor: competitors.create, updateCompetitor: competitors.update, deleteCompetitor: competitors.remove,
  listLeadSources: leadSources.list, getLeadSource: leadSources.get, createLeadSource: leadSources.create, updateLeadSource: leadSources.update, deleteLeadSource: leadSources.remove,
  seedErpnextMasters,
  getCrmSettings, updateCrmSettings,
  getProspects, getProspectById, createProspect, updateProspect, deleteProspect, addLeadToProspect, makeOpportunityFromProspect,
  getAppointments, getAppointmentById, createAppointment, updateAppointment, deleteAppointment,
  getContracts, getContractById, createContract, updateContract, deleteContract,
  getEmailCampaigns, createEmailCampaign, updateEmailCampaign, deleteEmailCampaign,
  makeQuotationFromLead, makeQuotationFromOpportunity,
  getErpnextReport,
};
