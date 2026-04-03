const PaymentMade = require('../models/PaymentMade');
const Bill = require('../models/Bill');
const Vendor = require('../models/Vendor');
const BankAccount = require('../models/BankAccount');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

// Helper: Get or create Accounts Payable account
async function getOrCreatePayableAccount(userId) {
  let apAccount = await ChartOfAccount.findOne({ 
    code: '2010',
    createdBy: userId  // 👈 Only find account created by this user
  });
  
  if (!apAccount) {
    apAccount = await ChartOfAccount.create({
      code: '2010',
      name: 'Accounts Payable',
      type: 'Liabilities',
      parentAccount: 'Current Liabilities',
      openingBalance: 0,
      description: 'Amount due to vendors',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  // ✅ FIX: Ensure account has code
  if (!apAccount.code) {
    apAccount.code = '2010';
    await apAccount.save();
  }
  return apAccount;
}

// Helper: Get or create Cash account
async function getOrCreateCashAccount(userId) {
  let cashAccount = await ChartOfAccount.findOne({ 
    code: '1010',
    createdBy: userId  // 👈 Only find account created by this user
  });
  
  if (!cashAccount) {
    cashAccount = await ChartOfAccount.create({
      code: '1010',
      name: 'Cash in Hand',
      type: 'Assets',
      parentAccount: 'Current Assets',
      openingBalance: 0,
      description: 'Physical cash in office',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  // ✅ FIX: Ensure account has code
  if (!cashAccount.code) {
    cashAccount.code = '1010';
    await cashAccount.save();
  }
  return cashAccount;
}

// @desc    Record payment made to vendor
// @route   POST /api/payments-made
// @access  Private
exports.recordPayment = async (req, res) => {
  try {
    const {
      vendorId,
      billId,
      amount,
      paymentDate,
      paymentMethod,
      reference,
      bankAccountId,
      notes,
    } = req.body;

    // 1. Validate bill - must belong to user
    const bill = await Bill.findOne({
      _id: billId,
      createdBy: req.user.id  // 👈 Only allow if user owns this bill
    });
    
    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found',
      });
    }

    // 2. Validate payment amount
    const outstanding = bill.totalAmount - bill.paidAmount;
    if (amount > outstanding) {
      return res.status(400).json({
        success: false,
        message: `Payment amount cannot exceed outstanding balance of ${outstanding}`,
      });
    }

    // 3. Get vendor details - must belong to user
    const vendor = await Vendor.findOne({
      _id: vendorId,
      createdBy: req.user.id  // 👈 Only allow if user owns this vendor
    });
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found',
      });
    }

    // 4. Get bank account if selected - must belong to user
    let bankAccount = null;
    let bankChartAccount = null;
    if (bankAccountId && paymentMethod === 'Bank Transfer') {
      bankAccount = await BankAccount.findOne({
        _id: bankAccountId,
        createdBy: req.user.id  // 👈 Only find bank account created by this user
      });
      if (bankAccount) {
        bankChartAccount = await ChartOfAccount.findOne({
          _id: bankAccount.chartOfAccountId,
          createdBy: req.user.id  // 👈 Only find chart account created by this user
        });
        // ✅ FIX: Ensure bank chart account has code
        if (bankChartAccount && !bankChartAccount.code) {
          bankChartAccount.code = '1020';
          await bankChartAccount.save();
        }
      }
    }

    // 5. Get accounts for journal entry
    const apAccount = await getOrCreatePayableAccount(req.user.id);
    const cashAccount = await getOrCreateCashAccount(req.user.id);

    // 6. Generate payment number manually if pre-save hook is not working
    const count = await PaymentMade.countDocuments({ createdBy: req.user.id });
    const year = new Date().getFullYear();
    const paymentNumber = `PMT-${year}-${String(count + 1).padStart(4, '0')}`;

    // 7. Create payment record with paymentNumber
    const payment = await PaymentMade.create({
      paymentNumber: paymentNumber,
      paymentDate: paymentDate || new Date(),
      vendorId,
      vendorName: vendor.name,
      billId,
      billNumber: bill.billNumber,
      billAmount: bill.totalAmount,
      amount,
      paymentMethod,
      reference: reference || '',
      bankAccountId: bankAccountId || null,
      bankAccountName: bankAccount ? bankAccount.accountName : (paymentMethod === 'Cash' ? 'Cash in Hand' : ''),
      notes: notes || '',
      status: paymentMethod === 'Cheque' ? 'Pending' : 'Cleared',
      createdBy: req.user.id,
    });

    // 8. Update bill
    bill.paidAmount += amount;
    await bill.save();

    // 9. Create journal entry with ensured account codes
    const paymentAccount = bankChartAccount ? bankChartAccount : cashAccount;
    
    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: paymentDate || new Date(),
      description: `Payment made for ${bill.billNumber} to ${vendor.name}`,
      reference: reference || payment.paymentNumber,
      lines: [
        {
          accountId: apAccount._id,
          accountName: apAccount.name,
          accountCode: apAccount.code || '2010',
          debit: amount,
          credit: 0,
        },
        {
          accountId: paymentAccount._id,
          accountName: paymentAccount.name,
          accountCode: paymentAccount.code || (paymentMethod === 'Cash' ? '1010' : '1020'),
          debit: 0,
          credit: amount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });

    // 10. Update bank account balance
    if (bankAccountId && bankAccount) {
      bankAccount.currentBalance -= amount;
      await bankAccount.save();
      
      if (bankChartAccount) {
        await ChartOfAccount.findOneAndUpdate(
          { 
            _id: bankChartAccount._id,
            createdBy: req.user.id  // 👈 Only update if user owns this account
          },
          {
            currentBalance: bankAccount.currentBalance,
          }
        );
      }
    }

    // 11. Update cash account balance if cash payment
    if (paymentMethod === 'Cash') {
      const cashChartAccount = await ChartOfAccount.findOne({
        _id: cashAccount._id,
        createdBy: req.user.id  // 👈 Only find chart account created by this user
      });
      if (cashChartAccount) {
        cashChartAccount.currentBalance -= amount;
        await cashChartAccount.save();
      }
    }

    res.status(201).json({
      success: true,
      data: {
        payment,
        bill: {
          id: bill._id,
          billNumber: bill.billNumber,
          paidAmount: bill.paidAmount,
          outstanding: bill.totalAmount - bill.paidAmount,
          status: bill.status,
        },
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get all payments
// @route   GET /api/payments-made
// @access  Private
exports.getPayments = async (req, res) => {
  try {
    const { vendorId, billId, status, startDate, endDate, search } = req.query;
    let query = {
      createdBy: req.user.id  // 👈 Only show payments created by this user
    };

    if (vendorId) {
      // Verify vendor belongs to user
      const vendor = await Vendor.findOne({
        _id: vendorId,
        createdBy: req.user.id
      });
      if (vendor) {
        query.vendorId = vendorId;
      }
    }
    
    if (billId) {
      // Verify bill belongs to user
      const bill = await Bill.findOne({
        _id: billId,
        createdBy: req.user.id
      });
      if (bill) {
        query.billId = billId;
      }
    }
    
    if (status) query.status = status;
    if (startDate && endDate) {
      query.paymentDate = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    if (search) {
      query.$or = [
        { paymentNumber: { $regex: search, $options: 'i' } },
        { vendorName: { $regex: search, $options: 'i' } },
        { billNumber: { $regex: search, $options: 'i' } },
        { reference: { $regex: search, $options: 'i' } },
      ];
    }

    const payments = await PaymentMade.find(query)
      .populate('vendorId', 'name email phone')
      .populate('billId', 'billNumber totalAmount')
      .sort({ paymentDate: -1, createdAt: -1 });

    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single payment
// @route   GET /api/payments-made/:id
// @access  Private
exports.getPayment = async (req, res) => {
  try {
    const payment = await PaymentMade.findOne({
      _id: req.params.id,
      createdBy: req.user.id  // 👈 Only allow if user owns this payment
    })
      .populate('vendorId', 'name email phone address')
      .populate('billId', 'billNumber date dueDate items totalAmount');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get unpaid bills for vendor
// @route   GET /api/payments-made/bills/unpaid/:vendorId
// @access  Private
exports.getUnpaidBills = async (req, res) => {
  try {
    const { vendorId } = req.params;
    
    // Verify vendor belongs to user
    const vendor = await Vendor.findOne({
      _id: vendorId,
      createdBy: req.user.id  // 👈 Only allow if user owns this vendor
    });
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found',
      });
    }
    
    const bills = await Bill.find({
      vendorId,
      status: { $ne: 'Paid' },
      createdBy: req.user.id,  // 👈 Only show bills created by this user
    }).sort({ dueDate: 1 });

    const unpaidBills = bills.map(bill => ({
      id: bill._id,
      billNumber: bill.billNumber,
      date: bill.date,
      dueDate: bill.dueDate,
      totalAmount: bill.totalAmount,
      paidAmount: bill.paidAmount,
      outstanding: bill.totalAmount - bill.paidAmount,
      status: bill.status,
    }));

    res.status(200).json({
      success: true,
      count: unpaidBills.length,
      data: unpaidBills,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get payment summary
// @route   GET /api/payments-made/summary
// @access  Private
exports.getSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let dateFilter = {
      createdBy: req.user.id  // 👈 Only show payments created by this user
    };

    if (startDate && endDate) {
      dateFilter.paymentDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const totalPaid = await PaymentMade.aggregate([
      { $match: dateFilter },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const thisWeek = await PaymentMade.aggregate([
      { $match: { 
        paymentDate: { $gte: startOfWeek },
        createdBy: req.user.id  // 👈 Only show payments created by this user
      } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const thisMonth = await PaymentMade.aggregate([
      { $match: { 
        paymentDate: { $gte: startOfMonth },
        createdBy: req.user.id  // 👈 Only show payments created by this user
      } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const today = await PaymentMade.aggregate([
      { $match: { 
        paymentDate: { $gte: startOfDay },
        createdBy: req.user.id  // 👈 Only show payments created by this user
      } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const pending = await PaymentMade.countDocuments({ 
      status: 'Pending',
      createdBy: req.user.id  // 👈 Only count payments created by this user
    });

    res.status(200).json({
      success: true,
      data: {
        totalPaid: totalPaid[0]?.total || 0,
        thisWeek: thisWeek[0]?.total || 0,
        thisMonth: thisMonth[0]?.total || 0,
        today: today[0]?.total || 0,
        pending,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};