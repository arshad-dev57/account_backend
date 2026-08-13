const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { upload } = require('../config/cloudinary');
const {
  listTickets,
  getTicket,
  createTicket,
  updateTicket,
  deleteTicket
} = require('../controllers/supportTicketController');

router.use(protect);

router.get('/', listTickets);
router.get('/:id', getTicket);
router.post(
  '/',
  upload.fields([
    { name: 'attachment', maxCount: 1 },
    { name: 'screenshot', maxCount: 1 },
  ]),
  createTicket
);
router.put(
  '/:id',
  upload.fields([
    { name: 'attachment', maxCount: 1 },
    { name: 'screenshot', maxCount: 1 },
  ]),
  updateTicket
);
router.delete('/:id', deleteTicket);

module.exports = router;
