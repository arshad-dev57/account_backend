const express = require('express');
const {
  createJournalEntry,
  getJournalEntries,
  getJournalEntry,
  updateJournalEntry,
  postJournalEntry,
  deleteJournalEntry,
} = require('../controllers/journalEntryController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes are protected
router.use(protect);

// Main routes with pagination support
router.route('/')
  .get(getJournalEntries)  // Supports pagination: ?page=1&limit=20
  .post(createJournalEntry);

// Single entry routes
router.route('/:id')
  .get(getJournalEntry)
  .put(updateJournalEntry)
  .delete(deleteJournalEntry);

// Post journal entry (Draft to Posted)
router.route('/:id/post')
  .post(postJournalEntry);

module.exports = router;