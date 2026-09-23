'use strict';

const prisma = require('../prisma/client');
const { requireCompany, requireHrManager, canManageHr } = require('../utils/hrAccess');
const { writeAudit } = require('../utils/hrAudit');
const { cloudinary } = require('../config/hrDocumentUpload');

function fullName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'User';
}

function ymd(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function asDate(value) {
  const key = ymd(value);
  return key ? new Date(`${key}T00:00:00.000Z`) : null;
}

function wrap(fn) {
  return async (req, res) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      await fn(req, res, companyId);
    } catch (error) {
      console.error('[hr-document-upload]', error);
      res.status(500).json({ success: false, message: error.message || 'Internal Server Error' });
    }
  };
}

/**
 * Handle multipart document upload or JSON fileUrl fallback
 */
exports.uploadDocument = wrap(async (req, res, companyId) => {
  if (!canManageHr(req)) {
    return res.status(403).json({ success: false, message: 'HR access permissions required' });
  }

  const file = req.file;
  const body = req.body || {};

  let fileUrl = body.fileUrl || '';
  let fileName = body.fileName || '';
  let fileSize = Number(body.fileSize || 0);
  let mimeType = body.mimeType || '';
  let cloudinaryPublicId = '';

  if (file) {
    fileUrl = file.path || file.secure_url || fileUrl;
    fileName = file.originalname || fileName;
    fileSize = file.size || fileSize;
    mimeType = file.mimetype || mimeType;
    cloudinaryPublicId = file.filename || file.public_id || '';
  }

  if (!fileUrl && !file) {
    return res.status(400).json({ success: false, message: 'Document file or file URL is required' });
  }

  const title = String(body.title || fileName || 'HR Document').trim();

  const doc = await prisma.hrDocument.create({
    data: {
      companyId,
      employeeId: body.employeeId || null,
      title,
      category: String(body.category || 'HR'),
      reference: String(body.reference || ''),
      fileUrl,
      fileName,
      fileSize,
      mimeType,
      cloudinaryPublicId,
      issueDate: asDate(body.issueDate),
      expiresAt: asDate(body.expiresAt),
      documentNumber: String(body.documentNumber || ''),
      issuingAuthority: String(body.issuingAuthority || ''),
      status: String(body.status || 'Uploaded'),
      notes: String(body.notes || ''),
      version: 1
    },
    include: {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          user: { select: { firstName: true, lastName: true, email: true } }
        }
      }
    }
  });

  await writeAudit(companyId, req.user.id, 'create', 'document', doc.id, doc.title);

  res.json({
    success: true,
    data: {
      ...doc,
      issueDate: ymd(doc.issueDate),
      expiresAt: ymd(doc.expiresAt),
      employeeName: doc.employee ? fullName(doc.employee.user) : 'Company Document'
    }
  });
});

/**
 * Replace document with a new version
 */
exports.replaceDocument = wrap(async (req, res, companyId) => {
  if (!canManageHr(req)) {
    return res.status(403).json({ success: false, message: 'HR access permissions required' });
  }

  const documentId = req.params.id;
  const existingDoc = await prisma.hrDocument.findFirst({
    where: { id: documentId, companyId }
  });

  if (!existingDoc) {
    return res.status(404).json({ success: false, message: 'Original document not found' });
  }

  const file = req.file;
  const body = req.body || {};

  let fileUrl = body.fileUrl || existingDoc.fileUrl;
  let fileName = body.fileName || existingDoc.fileName;
  let fileSize = Number(body.fileSize || existingDoc.fileSize);
  let mimeType = body.mimeType || existingDoc.mimeType;
  let cloudinaryPublicId = existingDoc.cloudinaryPublicId;

  if (file) {
    fileUrl = file.path || file.secure_url || fileUrl;
    fileName = file.originalname || fileName;
    fileSize = file.size || fileSize;
    mimeType = file.mimetype || mimeType;
    cloudinaryPublicId = file.filename || file.public_id || '';
  }

  const nextVersion = (existingDoc.version || 1) + 1;

  const newDoc = await prisma.hrDocument.create({
    data: {
      companyId,
      employeeId: body.employeeId || existingDoc.employeeId,
      title: String(body.title || existingDoc.title),
      category: String(body.category || existingDoc.category),
      reference: String(body.reference || existingDoc.reference),
      fileUrl,
      fileName,
      fileSize,
      mimeType,
      cloudinaryPublicId,
      issueDate: body.issueDate ? asDate(body.issueDate) : existingDoc.issueDate,
      expiresAt: body.expiresAt ? asDate(body.expiresAt) : existingDoc.expiresAt,
      documentNumber: String(body.documentNumber || existingDoc.documentNumber),
      issuingAuthority: String(body.issuingAuthority || existingDoc.issuingAuthority),
      status: 'Uploaded',
      notes: String(body.notes || `Replaced version ${existingDoc.version}`),
      version: nextVersion,
      previousVersionId: existingDoc.id
    },
    include: {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          user: { select: { firstName: true, lastName: true, email: true } }
        }
      }
    }
  });

  // Optionally mark previous version status as Superseded
  await prisma.hrDocument.update({
    where: { id: existingDoc.id },
    data: { status: 'Superseded' }
  });

  await writeAudit(companyId, req.user.id, 'replace', 'document', newDoc.id, `Replaced ${existingDoc.title} with v${nextVersion}`);

  res.json({
    success: true,
    data: {
      ...newDoc,
      issueDate: ymd(newDoc.issueDate),
      expiresAt: ymd(newDoc.expiresAt),
      employeeName: newDoc.employee ? fullName(newDoc.employee.user) : 'Company Document'
    }
  });
});

/**
 * Get version history chain for a document
 */
exports.getDocumentVersions = wrap(async (req, res, companyId) => {
  const documentId = req.params.id;

  const doc = await prisma.hrDocument.findFirst({
    where: { id: documentId, companyId }
  });

  if (!doc) {
    return res.status(404).json({ success: false, message: 'Document not found' });
  }

  // Find root document by stepping up previousVersionId
  let rootId = doc.id;
  let curr = doc;
  while (curr.previousVersionId) {
    const prev = await prisma.hrDocument.findFirst({
      where: { id: curr.previousVersionId, companyId }
    });
    if (!prev) break;
    rootId = prev.id;
    curr = prev;
  }

  // Find all documents in chain (either rootId, or previousVersionId matching chain)
  const allRelated = await prisma.hrDocument.findMany({
    where: {
      companyId,
      OR: [
        { id: rootId },
        { previousVersionId: rootId },
        { title: doc.title, employeeId: doc.employeeId }
      ]
    },
    orderBy: { version: 'desc' }
  });

  res.json({
    success: true,
    data: allRelated.map((r) => ({
      ...r,
      issueDate: ymd(r.issueDate),
      expiresAt: ymd(r.expiresAt)
    }))
  });
});

/**
 * Download document URL helper
 */
exports.downloadDocument = wrap(async (req, res, companyId) => {
  const documentId = req.params.id;
  const doc = await prisma.hrDocument.findFirst({
    where: { id: documentId, companyId }
  });

  if (!doc) {
    return res.status(404).json({ success: false, message: 'Document not found' });
  }

  if (!doc.fileUrl) {
    return res.status(404).json({ success: false, message: 'No file attached to this document record' });
  }

  res.json({
    success: true,
    data: {
      id: doc.id,
      title: doc.title,
      fileName: doc.fileName || `${doc.title}.pdf`,
      fileUrl: doc.fileUrl,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize
    }
  });
});

/**
 * Delete document
 */
exports.deleteDocument = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;

  const documentId = req.params.id;
  const doc = await prisma.hrDocument.findFirst({
    where: { id: documentId, companyId }
  });

  if (!doc) {
    return res.status(404).json({ success: false, message: 'Document not found' });
  }

  // If Cloudinary ID exists, attempt background deletion
  if (doc.cloudinaryPublicId) {
    cloudinary.uploader.destroy(doc.cloudinaryPublicId).catch((err) => {
      console.warn('[Cloudinary Delete Error]', err.message);
    });
  }

  await prisma.hrDocument.delete({ where: { id: documentId } });
  await writeAudit(companyId, req.user.id, 'delete', 'document', documentId, doc.title);

  res.json({ success: true, message: 'Document deleted successfully' });
});
