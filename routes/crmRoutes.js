/**
 * CRM Routes - Bisonstechs ERP
 * Covers legacy lead-centric routes + enterprise CRM module
 */
const express = require('express');
const router  = express.Router();
const { protect }            = require('../middleware/authMiddleware');
const { requirePermission }  = require('../middleware/rbacMiddleware');

// ─── Controllers ─────────────────────────────────────────────────────────────
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

const {
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
} = require('../controllers/crmEnterpriseController');

const erp = require('../controllers/crmErpnextController');

// All routes require authentication
router.use(protect);

// ─── Dashboard ──────────────────────────────────────────────────────────────
router.get('/dashboard',            requirePermission('crm.dashboard.view'), getDashboard);
router.get('/dashboard/enterprise', requirePermission('crm.dashboard.view'), getEnterpriseDashboard);

// ─── Leads ──────────────────────────────────────────────────────────────────
router.get('/leads',                  requirePermission('crm.leads.view'),   getLeads);
router.post('/leads',                 requirePermission('crm.leads.create'), createLead);
router.get('/leads/:id',              requirePermission('crm.leads.view'),   getLeadById);
router.put('/leads/:id',              requirePermission('crm.leads.edit'),   updateLead);
router.patch('/leads/:id',            requirePermission('crm.leads.edit'),   updateLead);
router.delete('/leads/:id',           requirePermission('crm.leads.delete'), deleteLead);
router.post('/leads/bulk/update',     requirePermission('crm.leads.edit'),   bulkUpdateLeads);
router.post('/leads/bulk/board-order',requirePermission('crm.leads.edit'),   updateLeadBoardOrder);
router.post('/leads/:id/note',        requirePermission('crm.leads.edit'),   addLeadNote);
router.post('/leads/:id/convert',     requirePermission('crm.convert.create'), convertLead);
router.post('/leads/export',          requirePermission('crm.leads.print'),  exportLeads);

// ─── Custom Fields (legacy lead) ─────────────────────────────────────────────
router.get('/custom-fields',          requirePermission('crm.custom_fields.view'),   getCustomFields);
router.post('/custom-fields',         requirePermission('crm.custom_fields.create'), createCustomField);
router.put('/custom-fields/reorder',  requirePermission('crm.custom_fields.edit'),   reorderCustomFields);
router.put('/custom-fields/:id',      requirePermission('crm.custom_fields.edit'),   updateCustomField);
router.delete('/custom-fields/:id',   requirePermission('crm.custom_fields.delete'), deleteCustomField);

// ─── Boards ──────────────────────────────────────────────────────────────────
router.get('/boards',         requirePermission('crm.boards.view'),   getBoards);
router.post('/boards',        requirePermission('crm.boards.create'), createBoard);
router.get('/boards/default', requirePermission('crm.boards.view'),   getDefaultBoard);

// ─── Sources ─────────────────────────────────────────────────────────────────
router.get('/sources',               requirePermission('crm.sources.view'),   getSources);
router.get('/sources/:id',           requirePermission('crm.sources.view'),   erp.getLeadSource);
router.post('/sources',              requirePermission('crm.sources.create'), createSource);
router.post('/sources/init-defaults',requirePermission('crm.sources.create'), ensureDefaultSources);
router.put('/sources/:id',           requirePermission('crm.sources.edit'),   updateSource);
router.delete('/sources/:id',        requirePermission('crm.sources.delete'), deleteSource);

// ─── Follow-ups ───────────────────────────────────────────────────────────────
router.get('/follow-ups',              requirePermission('crm.follow_ups.view'),   getFollowUps);
router.post('/follow-ups',             requirePermission('crm.follow_ups.create'), createFollowUp);
router.patch('/follow-ups/:id/complete',requirePermission('crm.follow_ups.edit'),  completeFollowUp);

// ─── Import ──────────────────────────────────────────────────────────────────
router.post('/import/preview',          requirePermission('crm.import.import'), upload.single('file'), previewImport);
router.post('/import/execute',          requirePermission('crm.import.import'), upload.single('file'), importLeads);
router.get('/import/jobs',              requirePermission('crm.import.view'),   getImportJobs);
router.get('/import/mapping-templates', requirePermission('crm.import.view'),   getMappingTemplates);
router.post('/import/mapping-templates',requirePermission('crm.import.import'), saveMappingTemplate);

// ─── Google Sheets ────────────────────────────────────────────────────────────
router.get('/google-sheets/auth-url',                                    requirePermission('crm.google_sheets.view'),   getAuthUrl);
router.get('/google-sheets/callback',                                    handleOAuthCallback);
router.get('/google-sheets/connections',                                 requirePermission('crm.google_sheets.view'),   getConnections);
router.delete('/google-sheets/connections/:id',                          requirePermission('crm.google_sheets.delete'), disconnectConnection);
router.get('/google-sheets/connections/:connectionId/spreadsheets',      requirePermission('crm.google_sheets.view'),   listSpreadsheets);
router.get('/google-sheets/connections/:connectionId/sheets/:spreadsheetId', requirePermission('crm.google_sheets.view'), getSheetNames);
router.get('/google-sheets/connections/:connectionId/preview',           requirePermission('crm.google_sheets.view'),   previewSheet);
router.put('/google-sheets/connections/:id/config',                      requirePermission('crm.google_sheets.edit'),   updateConnectionConfig);
router.post('/google-sheets/connections/:id/sync',                       requirePermission('crm.google_sheets.edit'),   syncNow);

// ─── Contacts ────────────────────────────────────────────────────────────────
router.get('/contacts',               requirePermission('crm.contacts.view'),   getContacts);
router.post('/contacts',              requirePermission('crm.contacts.create'), createContact);
router.post('/contacts/export',       requirePermission('crm.contacts.print'),  exportContacts);
router.get('/contacts/:id',           requirePermission('crm.contacts.view'),   getContactById);
router.put('/contacts/:id',           requirePermission('crm.contacts.edit'),   updateContact);
router.patch('/contacts/:id',         requirePermission('crm.contacts.edit'),   updateContact);
router.delete('/contacts/:id',        requirePermission('crm.contacts.delete'), deleteContact);

// ─── Opportunities ────────────────────────────────────────────────────────────
router.get('/opportunities',                        requirePermission('crm.opportunities.view'),   getOpportunities);
router.post('/opportunities',                       requirePermission('crm.opportunities.create'), createOpportunity);
router.post('/opportunities/export',                requirePermission('crm.opportunities.print'),  exportOpportunities);
router.post('/opportunities/bulk/update',           requirePermission('crm.opportunities.edit'),   bulkUpdateOpportunities);
router.get('/opportunities/:id',                    requirePermission('crm.opportunities.view'),   getOpportunityById);
router.put('/opportunities/:id',                    requirePermission('crm.opportunities.edit'),   updateOpportunity);
router.patch('/opportunities/:id',                  requirePermission('crm.opportunities.edit'),   updateOpportunity);
router.patch('/opportunities/:id/stage',            requirePermission('crm.pipeline.edit'),        updateOpportunityStage);
router.delete('/opportunities/:id',                 requirePermission('crm.opportunities.delete'), deleteOpportunity);

// ─── Activities ───────────────────────────────────────────────────────────────
router.get('/activities',                    requirePermission('crm.activities.view'),   getActivities);
router.post('/activities',                   requirePermission('crm.activities.create'), createActivity);
router.get('/activities/:id',                requirePermission('crm.activities.view'),   getActivityById);
router.put('/activities/:id',                requirePermission('crm.activities.edit'),   updateActivity);
router.patch('/activities/:id',              requirePermission('crm.activities.edit'),   updateActivity);
router.patch('/activities/:id/complete',     requirePermission('crm.activities.edit'),   completeActivity);
router.delete('/activities/:id',             requirePermission('crm.activities.delete'), deleteActivity);

// ─── Tasks ────────────────────────────────────────────────────────────────────
router.get('/tasks',                  requirePermission('crm.tasks.view'),   getTasks);
router.post('/tasks',                 requirePermission('crm.tasks.create'), createTask);
router.get('/tasks/:id',              requirePermission('crm.tasks.view'),   getTaskById);
router.put('/tasks/:id',              requirePermission('crm.tasks.edit'),   updateTask);
router.patch('/tasks/:id',            requirePermission('crm.tasks.edit'),   updateTask);
router.patch('/tasks/:id/complete',   requirePermission('crm.tasks.edit'),   completeTask);
router.delete('/tasks/:id',           requirePermission('crm.tasks.delete'), deleteTask);

// ─── Calendar ─────────────────────────────────────────────────────────────────
router.get('/calendar', requirePermission('crm.calendar.view'), getCalendarFeed);

// ─── Campaigns ────────────────────────────────────────────────────────────────
router.get('/campaigns',        requirePermission('crm.campaigns.view'),   getCampaigns);
router.post('/campaigns',       requirePermission('crm.campaigns.create'), createCampaign);
router.get('/campaigns/:id',    requirePermission('crm.campaigns.view'),   getCampaignById);
router.put('/campaigns/:id',    requirePermission('crm.campaigns.edit'),   updateCampaign);
router.patch('/campaigns/:id',  requirePermission('crm.campaigns.edit'),   updateCampaign);
router.delete('/campaigns/:id', requirePermission('crm.campaigns.delete'), deleteCampaign);

// ─── Accounts / Customers ──────────────────────────────────────────────────────
router.get('/accounts',        requirePermission('crm.accounts.view'),   getAccounts);
router.post('/accounts',       requirePermission('crm.accounts.view'),   createAccount);
router.get('/accounts/:id',    requirePermission('crm.accounts.view'),   getAccountById);
router.put('/accounts/:id',    requirePermission('crm.accounts.view'),   updateAccount);
router.delete('/accounts/:id', requirePermission('crm.accounts.view'),   deleteAccount);

// ─── Reports ──────────────────────────────────────────────────────────────────
// type: lead-analysis | source | conversion | pipeline | opportunity | salesperson | activity | campaign
router.get('/reports/:type', requirePermission('crm.reports.view'), getReport);

// ─── CRM Enterprise Custom Fields ──────────────────────────────────────────────
router.get('/crm-custom-fields',        requirePermission('crm.custom_fields.view'),   getCrmCustomFields);
router.post('/crm-custom-fields',       requirePermission('crm.custom_fields.create'), createCrmCustomField);
router.put('/crm-custom-fields/:id',    requirePermission('crm.custom_fields.edit'),   updateCrmCustomField);
router.delete('/crm-custom-fields/:id', requirePermission('crm.custom_fields.delete'), deleteCrmCustomField);

// ─── ERPNext parity: Masters ──────────────────────────────────────────────────
const MV = requirePermission('crm.dashboard.view');
const ME = requirePermission('crm.leads.edit');
router.post('/masters/seed', ME, erp.seedErpnextMasters);

router.get('/sales-stages', MV, erp.listSalesStages);
router.get('/sales-stages/:id', MV, erp.getSalesStage);
router.post('/sales-stages', ME, erp.createSalesStage);
router.put('/sales-stages/:id', ME, erp.updateSalesStage);
router.delete('/sales-stages/:id', ME, erp.deleteSalesStage);

router.get('/opportunity-types', MV, erp.listOpportunityTypes);
router.get('/opportunity-types/:id', MV, erp.getOpportunityType);
router.post('/opportunity-types', ME, erp.createOpportunityType);
router.put('/opportunity-types/:id', ME, erp.updateOpportunityType);
router.delete('/opportunity-types/:id', ME, erp.deleteOpportunityType);

router.get('/market-segments', MV, erp.listMarketSegments);
router.get('/market-segments/:id', MV, erp.getMarketSegment);
router.post('/market-segments', ME, erp.createMarketSegment);
router.put('/market-segments/:id', ME, erp.updateMarketSegment);
router.delete('/market-segments/:id', ME, erp.deleteMarketSegment);

router.get('/territories', MV, erp.listTerritories);
router.get('/territories/:id', MV, erp.getTerritory);
router.post('/territories', ME, erp.createTerritory);
router.put('/territories/:id', ME, erp.updateTerritory);
router.delete('/territories/:id', ME, erp.deleteTerritory);

router.get('/customer-groups', MV, erp.listCustomerGroups);
router.get('/customer-groups/:id', MV, erp.getCustomerGroup);
router.post('/customer-groups', ME, erp.createCustomerGroup);
router.put('/customer-groups/:id', ME, erp.updateCustomerGroup);
router.delete('/customer-groups/:id', ME, erp.deleteCustomerGroup);

router.get('/lost-reasons', MV, erp.listLostReasons);
router.get('/lost-reasons/:id', MV, erp.getLostReason);
router.post('/lost-reasons', ME, erp.createLostReason);
router.put('/lost-reasons/:id', ME, erp.updateLostReason);
router.delete('/lost-reasons/:id', ME, erp.deleteLostReason);

router.get('/competitors', MV, erp.listCompetitors);
router.get('/competitors/:id', MV, erp.getCompetitor);
router.post('/competitors', ME, erp.createCompetitor);
router.put('/competitors/:id', ME, erp.updateCompetitor);
router.delete('/competitors/:id', ME, erp.deleteCompetitor);

router.get('/lead-sources', MV, erp.listLeadSources);
router.get('/lead-sources/:id', MV, erp.getLeadSource);
router.post('/lead-sources', ME, erp.createLeadSource);
router.put('/lead-sources/:id', ME, erp.updateLeadSource);
router.delete('/lead-sources/:id', ME, erp.deleteLeadSource);

// ─── CRM Settings (ERPNext) ───────────────────────────────────────────────────
router.get('/crm-settings', MV, erp.getCrmSettings);
router.put('/crm-settings', ME, erp.updateCrmSettings);

// ─── Prospects ────────────────────────────────────────────────────────────────
router.get('/prospects', requirePermission('crm.leads.view'), erp.getProspects);
router.post('/prospects', requirePermission('crm.leads.create'), erp.createProspect);
router.get('/prospects/:id', requirePermission('crm.leads.view'), erp.getProspectById);
router.put('/prospects/:id', requirePermission('crm.leads.edit'), erp.updateProspect);
router.delete('/prospects/:id', requirePermission('crm.leads.delete'), erp.deleteProspect);
router.post('/prospects/:id/leads', requirePermission('crm.leads.edit'), erp.addLeadToProspect);
router.post('/prospects/:id/make-opportunity', requirePermission('crm.opportunities.create'), erp.makeOpportunityFromProspect);

// ─── Appointments ─────────────────────────────────────────────────────────────
router.get('/appointments', requirePermission('crm.calendar.view'), erp.getAppointments);
router.post('/appointments', requirePermission('crm.calendar.view'), erp.createAppointment);
router.get('/appointments/:id', requirePermission('crm.calendar.view'), erp.getAppointmentById);
router.put('/appointments/:id', requirePermission('crm.calendar.view'), erp.updateAppointment);
router.delete('/appointments/:id', requirePermission('crm.calendar.view'), erp.deleteAppointment);

// ─── Contracts ────────────────────────────────────────────────────────────────
router.get('/contracts', requirePermission('crm.accounts.view'), erp.getContracts);
router.post('/contracts', requirePermission('crm.accounts.view'), erp.createContract);
router.get('/contracts/:id', requirePermission('crm.accounts.view'), erp.getContractById);
router.put('/contracts/:id', requirePermission('crm.accounts.view'), erp.updateContract);
router.delete('/contracts/:id', requirePermission('crm.accounts.view'), erp.deleteContract);

// ─── Email Campaigns ──────────────────────────────────────────────────────────
router.get('/email-campaigns', requirePermission('crm.campaigns.view'), erp.getEmailCampaigns);
router.post('/email-campaigns', requirePermission('crm.campaigns.create'), erp.createEmailCampaign);
router.put('/email-campaigns/:id', requirePermission('crm.campaigns.edit'), erp.updateEmailCampaign);
router.delete('/email-campaigns/:id', requirePermission('crm.campaigns.delete'), erp.deleteEmailCampaign);

// ─── Create Quotation from Lead / Opportunity ─────────────────────────────────
router.post('/leads/:id/make-quotation', requirePermission('crm.convert.create'), erp.makeQuotationFromLead);
router.post('/opportunities/:id/make-quotation', requirePermission('crm.opportunities.create'), erp.makeQuotationFromOpportunity);

// ─── ERPNext named reports ────────────────────────────────────────────────────
router.get('/erpnext-reports/:type', requirePermission('crm.reports.view'), erp.getErpnextReport);

module.exports = router;
