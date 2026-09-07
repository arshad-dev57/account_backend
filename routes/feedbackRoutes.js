const express = require('express');
const router = express.Router();
const { protectOnly } = require('../middleware/authMiddleware');
const { submitFeedback } = require('../controllers/feedbackController');

router.post('/submit', protectOnly, submitFeedback);

module.exports = router;
