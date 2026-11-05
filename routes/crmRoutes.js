/**
 * CRM Routes - Bisonstechs ERP
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

const {
  getLeads, getLeadById, createLead, updateLead, deleteLead,
  bulkUpdateLeads, updateLeadBoardOrder, addLeadNote, convertLead,
  getDashboard, getCustomFields, createCustomField, updateCustomField, deleteCustomField, reorderCustomFields,
  getBoards, createBoard, getDefaultBoard,
  getSources, createSource, ensureDefaultSources,
  getFollowUps, createFollowUp, completeFollowUp,
  exportLeads,
} = require('../controllers/crmLeadController');

const {
  upload, previewImport, importLeads, getImportJobs, getMappingTemplates, saveMappingTemplate,
} = require('../controllers/crmImportController');

const {
  getAuthUrl, handleOAuthCallback, getConnections, disconnectConnection,
  listSpreadsheets, getSheetNames, previewSheet, updateConnectionConfig, syncNow,
} = require('../controllers/crmGoogleSheetsController');

// All routes require authentication
router.use(protect);

// ─── Dashboard ──────────────────────────────────────────────────────────────
router.get('/dashboard', getDashboard);

// ─── Leads ──────────────────────────────────────────────────────────────────
router.get('/leads', getLeads);
router.post('/leads', createLead);
router.get('/leads/:id', getLeadById);
router.put('/leads/:id', updateLead);
router.patch('/leads/:id', updateLead);
router.delete('/leads/:id', deleteLead);
router.post('/leads/bulk/update', bulkUpdateLeads);
router.post('/leads/bulk/board-order', updateLeadBoardOrder);
router.post('/leads/:id/note', addLeadNote);
router.post('/leads/:id/convert', convertLead);
router.post('/leads/export', exportLeads);

// ─── Custom Fields ───────────────────────────────────────────────────────────
router.get('/custom-fields', getCustomFields);
router.post('/custom-fields', createCustomField);
router.put('/custom-fields/reorder', reorderCustomFields);
router.put('/custom-fields/:id', updateCustomField);
router.delete('/custom-fields/:id', deleteCustomField);

// ─── Boards ──────────────────────────────────────────────────────────────────
router.get('/boards', getBoards);
router.post('/boards', createBoard);
router.get('/boards/default', getDefaultBoard);

// ─── Sources ─────────────────────────────────────────────────────────────────
router.get('/sources', getSources);
router.post('/sources', createSource);
router.post('/sources/init-defaults', ensureDefaultSources);

// ─── Follow-ups ───────────────────────────────────────────────────────────────
router.get('/follow-ups', getFollowUps);
router.post('/follow-ups', createFollowUp);
router.patch('/follow-ups/:id/complete', completeFollowUp);

// ─── Import ──────────────────────────────────────────────────────────────────
router.post('/import/preview', upload.single('file'), previewImport);
router.post('/import/execute', upload.single('file'), importLeads);
router.get('/import/jobs', getImportJobs);
router.get('/import/mapping-templates', getMappingTemplates);
router.post('/import/mapping-templates', saveMappingTemplate);

// ─── Google Sheets ────────────────────────────────────────────────────────────
router.get('/google-sheets/auth-url', getAuthUrl);
router.get('/google-sheets/callback', handleOAuthCallback);
router.get('/google-sheets/connections', getConnections);
router.delete('/google-sheets/connections/:id', disconnectConnection);
router.get('/google-sheets/connections/:connectionId/spreadsheets', listSpreadsheets);
router.get('/google-sheets/connections/:connectionId/sheets/:spreadsheetId', getSheetNames);
router.get('/google-sheets/connections/:connectionId/preview', previewSheet);
router.put('/google-sheets/connections/:id/config', updateConnectionConfig);
router.post('/google-sheets/connections/:id/sync', syncNow);

module.exports = router;

