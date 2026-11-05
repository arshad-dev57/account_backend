/**
 * CRM Lead Import Controller - Excel, CSV, and field mapping
 */
const prisma = require('../prisma/client');
const XLSX = require('xlsx');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Use disk storage in /tmp
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, os.tmpdir()),
  filename: (req, file, cb) => cb(null, `crm_import_${Date.now()}_${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB

function getCompanyId(req) {
  return req.user?.companyId || null;
}

function normalizePhone(phone) {
  if (!phone) return null;
  return String(phone).replace(/[^0-9+]/g, '').replace(/^00/, '+') || null;
}

function detectDuplicateKey(row) {
  return [row.phone, row.whatsapp, row.email].filter(Boolean);
}

async function parseSpreadsheet(filePath, fileExt) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const headers = data.length > 0 ? Object.keys(data[0]) : [];
  return { headers, data, sheetNames: wb.SheetNames, sheetName };
}

// Preview uploaded file
const previewImport = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const { headers, data, sheetNames } = await parseSpreadsheet(req.file.path, path.extname(req.file.originalname));
    const preview = data.slice(0, 20);

    // Clean up temp file
    fs.unlink(req.file.path, () => {});

    // Get existing CRM fields for mapping suggestions
    const crmFields = await prisma.leadCustomField.findMany({
      where: { companyId },
      select: { fieldKey: true, fieldName: true, fieldType: true },
    });

    const coreFields = [
      { fieldKey: 'fullName', fieldName: 'Full Name', fieldType: 'text' },
      { fieldKey: 'firstName', fieldName: 'First Name', fieldType: 'text' },
      { fieldKey: 'lastName', fieldName: 'Last Name', fieldType: 'text' },
      { fieldKey: 'email', fieldName: 'Email', fieldType: 'email' },
      { fieldKey: 'phone', fieldName: 'Phone', fieldType: 'phone' },
      { fieldKey: 'whatsapp', fieldName: 'WhatsApp', fieldType: 'phone' },
      { fieldKey: 'companyName', fieldName: 'Company', fieldType: 'text' },
      { fieldKey: 'city', fieldName: 'City', fieldType: 'text' },
      { fieldKey: 'state', fieldName: 'State', fieldType: 'text' },
      { fieldKey: 'country', fieldName: 'Country', fieldType: 'country' },
      { fieldKey: 'source', fieldName: 'Lead Source', fieldType: 'text' },
      { fieldKey: 'status', fieldName: 'Lead Status', fieldType: 'status' },
      { fieldKey: 'priority', fieldName: 'Priority', fieldType: 'select' },
      { fieldKey: 'interest', fieldName: 'Interest / Product', fieldType: 'text' },
      { fieldKey: 'budget', fieldName: 'Budget', fieldType: 'currency' },
      { fieldKey: 'notes', fieldName: 'Notes / Remarks', fieldType: 'textarea' },
      { fieldKey: 'tags', fieldName: 'Tags', fieldType: 'text' },
    ];

    // Auto-suggest mapping
    const autoMapping = {};
    const allFields = [...coreFields, ...crmFields];
    for (const header of headers) {
      const hLow = header.toLowerCase().replace(/[\s_\-]/g, '');
      for (const f of allFields) {
        const fLow = f.fieldName.toLowerCase().replace(/[\s_\-]/g, '');
        const kLow = f.fieldKey.toLowerCase().replace(/[\s_\-]/g, '');
        if (hLow === fLow || hLow === kLow || fLow.includes(hLow) || hLow.includes(kLow)) {
          autoMapping[header] = f.fieldKey;
          break;
        }
      }
    }

    return res.json({
      success: true,
      data: { headers, preview, sheetNames, totalRows: data.length, autoMapping, availableFields: allFields },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Full import with mapping
const importLeads = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = req.user.id;
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const { mapping, duplicateAction = 'SKIP', sheetName } = req.body;
    const mappingObj = typeof mapping === 'string' ? JSON.parse(mapping) : mapping;

    const { headers, data } = await parseSpreadsheet(req.file.path, path.extname(req.file.originalname));
    const fileName = req.file.originalname;
    const fileSize = req.file.size;

    // Create import job record
    const importJob = await prisma.leadImportJob.create({
      data: { companyId, fileName, fileType: path.extname(fileName).slice(1), fileSize, status: 'PROCESSING', totalRows: data.length, duplicateAction, mapping: mappingObj, createdBy: userId, startedAt: new Date() },
    });

    // Clean up temp file
    fs.unlink(req.file.path, () => {});

    // Get existing leads for duplicate checking
    const existingLeads = await prisma.lead.findMany({
      where: { companyId, isDeleted: false },
      select: { id: true, phone: true, whatsapp: true, email: true },
    });

    const existingPhones = new Set(existingLeads.map(l => normalizePhone(l.phone)).filter(Boolean));
    const existingWhatsapp = new Set(existingLeads.map(l => normalizePhone(l.whatsapp)).filter(Boolean));
    const existingEmails = new Set(existingLeads.map(l => l.email?.toLowerCase()).filter(Boolean));

    let importedCount = 0, updatedCount = 0, skippedCount = 0, failedCount = 0;
    const errors = [];
    const customFields = await prisma.leadCustomField.findMany({ where: { companyId }, select: { fieldKey: true, fieldType: true } });
    const customFieldKeys = new Set(customFields.map(f => f.fieldKey));

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      try {
        // Apply mapping
        const lead = {};
        const customData = {};
        for (const [header, fieldKey] of Object.entries(mappingObj)) {
          if (!fieldKey || fieldKey === '__skip__') continue;
          const val = row[header];
          if (val === '' || val === null || val === undefined) continue;
          if (customFieldKeys.has(fieldKey)) {
            customData[fieldKey] = String(val);
          } else {
            lead[fieldKey] = val;
          }
        }

        // Collect unmapped fields into customFields
        for (const [header, val] of Object.entries(row)) {
          if (!mappingObj[header] && val !== '' && val !== null) {
            const cleanKey = header.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
            customData[`unmapped_${cleanKey}`] = String(val);
          }
        }

        const phone = normalizePhone(lead.phone);
        const whatsapp = normalizePhone(lead.whatsapp);
        const email = lead.email?.toString().toLowerCase() || null;

        // Duplicate check
        const isDuplicate =
          (phone && existingPhones.has(phone)) ||
          (whatsapp && existingWhatsapp.has(whatsapp)) ||
          (email && existingEmails.has(email));

        if (isDuplicate) {
          if (duplicateAction === 'SKIP') {
            skippedCount++;
            continue;
          } else if (duplicateAction === 'UPDATE') {
            // Find and update existing
            const existing = existingLeads.find(l =>
              (phone && normalizePhone(l.phone) === phone) ||
              (email && l.email?.toLowerCase() === email)
            );
            if (existing) {
              await prisma.lead.update({
                where: { id: existing.id },
                data: { ...lead, phone, whatsapp, email, customFields: { ...customData }, updatedBy: userId, source: lead.source || 'Excel Import' },
              });
              updatedCount++;
              continue;
            }
          }
          // IMPORT_ANYWAY: fall through to create
        }

        // Build lead name
        const fullName = lead.fullName || [lead.firstName, lead.lastName].filter(Boolean).join(' ') || `Imported Lead ${i + 1}`;
        const leadNumber = await generateLeadNumber(companyId);

        await prisma.lead.create({
          data: {
            leadNumber, companyId, createdBy: userId,
            fullName, firstName: lead.firstName || null, lastName: lead.lastName || null,
            email, phone, whatsapp,
            companyName: lead.companyName || null, city: lead.city || null,
            state: lead.state || null, country: lead.country || 'Pakistan',
            source: lead.source || 'Excel Import', status: lead.status || 'New',
            priority: lead.priority || 'Medium', budget: lead.budget ? parseFloat(lead.budget) : null,
            interest: lead.interest || null, notes: lead.notes || null,
            tags: lead.tags ? String(lead.tags).split(',').map(t => t.trim()) : [],
            customFields: customData,
          },
        });

        if (phone) existingPhones.add(phone);
        if (whatsapp) existingWhatsapp.add(whatsapp);
        if (email) existingEmails.add(email);
        importedCount++;
      } catch (rowErr) {
        failedCount++;
        errors.push({ row: i + 2, error: rowErr.message });
      }
    }

    // Update import job
    await prisma.leadImportJob.update({
      where: { id: importJob.id },
      data: { status: 'COMPLETED', importedRows: importedCount, updatedRows: updatedCount, skippedDuplicates: skippedCount, failedRows: failedCount, errors: errors.slice(0, 50), completedAt: new Date() },
    });

    await prisma.leadActivity.create({
      data: { leadId: null, companyId, userId, type: 'imported', title: 'Leads imported', description: `Imported ${importedCount} leads from ${fileName}`, metadata: { importJobId: importJob.id, fileName, importedCount, skippedCount } },
    }).catch(() => {});

    return res.json({
      success: true,
      data: { importJobId: importJob.id, importedCount, updatedCount, skippedCount, failedCount, totalRows: data.length, errors: errors.slice(0, 20) },
      message: `Import complete: ${importedCount} imported, ${skippedCount} skipped, ${failedCount} failed`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

async function generateLeadNumber(companyId) {
  const last = await prisma.lead.findFirst({ where: { companyId, leadNumber: { startsWith: 'LEAD-' } }, orderBy: { leadNumber: 'desc' }, select: { leadNumber: true } });
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

// Get import jobs history
const getImportJobs = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const jobs = await prisma.leadImportJob.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return res.json({ success: true, data: jobs });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Mapping templates
const getMappingTemplates = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const templates = await prisma.leadImportMapping.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
    return res.json({ success: true, data: templates });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const saveMappingTemplate = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { templateName, fileType, mapping } = req.body;
    if (!templateName || !mapping) return res.status(400).json({ success: false, message: 'templateName and mapping required' });
    const template = await prisma.leadImportMapping.upsert({
      where: { companyId_templateName: { companyId, templateName } },
      update: { mapping, fileType },
      create: { companyId, templateName, fileType, mapping },
    });
    return res.json({ success: true, data: template });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { upload, previewImport, importLeads, getImportJobs, getMappingTemplates, saveMappingTemplate };

