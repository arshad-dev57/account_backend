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

router.route('/')
  .get(getJournalEntries)
  .post(createJournalEntry);

router.route('/:id')
  .get(getJournalEntry)
  .put(updateJournalEntry)
  .delete(deleteJournalEntry);

router.route('/:id/post')
  .post(postJournalEntry);

module.exports = router;