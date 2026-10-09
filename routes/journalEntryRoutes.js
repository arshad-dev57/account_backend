const express = require('express');
const {
  createJournalEntry,
  getJournalEntries,
  getJournalEntry,
  deleteJournalEntry,
  getJournalEntryStats
} = require('../controllers/journalEntryController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');

const router = express.Router();

// All routes are protected
router.use(protect);

// Main routes with pagination support
router.route('/')
  .get(requirePermission('accounting.journal_entries.view'), getJournalEntries)  // Supports pagination: ?page=1&limit=20
  .post(requirePermission('accounting.journal_entries.create'), createJournalEntry);

// Single entry routes
router.route('/:id')
  .get(requirePermission('accounting.journal_entries.view'), getJournalEntry)
  .delete(requirePermission('accounting.journal_entries.delete'), deleteJournalEntry);

// Post journal entry (Draft to Posted)
router.route('/:id/post')
  .post(requirePermission('accounting.journal_entries.post'));

module.exports = router;