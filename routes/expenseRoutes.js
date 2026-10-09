// routes/expenseRoutes.js - UPDATED

const express = require('express');
const router = express.Router();
const {
  createExpense,
  getExpenses,
  getExpense,
  updateExpense,
  deleteExpense,
  getSummary,
  postExpense,
  getExpenseAccounts,
} = require('../controllers/expenseController');
const { listDimensions } = require('../controllers/budgetController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const { expenseUpload } = require('../config/expenseUpload');
const prisma = require('../prisma/client');

router.use(protect);

router.get('/accounts', getExpenseAccounts);
router.get('/dimensions', listDimensions);

router.post('/upload', expenseUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const fileUrl = req.file.path || req.file.secure_url || req.file.url;
    return res.status(201).json({
      success: true,
      data: {
        fileUrl,
        fileName: req.file.originalname || '',
        fileSize: req.file.size || 0,
        mimeType: req.file.mimetype || '',
        cloudinaryPublicId: req.file.filename || req.file.public_id || '',
      },
    });
  } catch (error) {
    console.error('Expense upload error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/:id/attachments', expenseUpload.single('file'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const expense = await prisma.expense.findFirst({
      where: { id: req.params.id, companyId },
      select: { id: true },
    });
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const fileUrl = req.file.path || req.file.secure_url || req.file.url;
    const row = await prisma.expenseAttachment.create({
      data: {
        expenseId: expense.id,
        companyId,
        fileUrl,
        fileName: req.file.originalname || '',
        fileSize: req.file.size || 0,
        mimeType: req.file.mimetype || '',
        cloudinaryPublicId: req.file.filename || req.file.public_id || '',
      },
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error('Expense attachment error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', requirePermission('accounting.expenses.create'), createExpense);
router.get('/', requirePermission('accounting.expenses.view'), getExpenses);
router.get('/summary', requirePermission('accounting.expenses.view'), getSummary);
router.get('/:id', requirePermission('accounting.expenses.view'), getExpense);
router.put('/:id', requirePermission('accounting.expenses.edit'), updateExpense);
router.delete('/:id', requirePermission('accounting.expenses.delete'), deleteExpense);
router.post('/:id/post', requirePermission('accounting.expenses.post'), postExpense);

module.exports = router;