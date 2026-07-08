// controllers/accountsPayableController.js - COMPLETE FIXED VERSION

const prisma = require('../prisma/client');

// ─── HELPER: Get or create Accounts Payable account ──────────────
async function getOrCreatePayableAccount(userId, tx) {
  const db = tx || prisma;
  console.log('🔍 [AP] Getting/Creating Accounts Payable account for user:', userId);

  let apAccount = await db.chartOfAccount.findFirst({
    where: {
      code: '2010',
      createdBy: userId
    }
  });

  if (!apAccount) {
    console.log('📝 [AP] Creating new Accounts Payable account');
    apAccount = await db.chartOfAccount.create({
      data: {
        code: '2010',
        name: 'Accounts Payable',
        type: 'Liability',
        parentAccount: 'Current Liabilities',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Amount due to suppliers',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId
      }
    });
    console.log('✅ [AP] Accounts Payable account created:', apAccount.id);
  } else {
    console.log('✅ [AP] Accounts Payable account found:', apAccount.id);
  }

  return apAccount;
}

// ─── HELPER: Get or create Cash account ──────────────────────────
async function getOrCreateCashAccount(userId, tx) {
  const db = tx || prisma;
  console.log('🔍 [AP] Getting/Creating Cash account for user:', userId);

  let cashAccount = await db.chartOfAccount.findFirst({
    where: {
      code: '1010',
      createdBy: userId
    }
  });

  if (!cashAccount) {
    console.log('📝 [AP] Creating new Cash account');
    cashAccount = await db.chartOfAccount.create({
      data: {
        code: '1010',
        name: 'Cash in Hand',
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Physical cash in office',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId
      }
    });
    console.log('✅ [AP] Cash account created:', cashAccount.id);
  } else {
    console.log('✅ [AP] Cash account found:', cashAccount.id);
  }

  return cashAccount;
}

// ─── HELPER: Get or create Expense account ────────────────────────
async function getOrCreateExpenseAccount(userId, tx) {
  const db = tx || prisma;
  console.log('🔍 [AP] Getting/Creating Expense account for user:', userId);

  let expenseAccount = await db.chartOfAccount.findFirst({
    where: {
      code: '5000',
      createdBy: userId
    }
  });

  if (!expenseAccount) {
    console.log('📝 [AP] Creating new Expense account');
    expenseAccount = await db.chartOfAccount.create({
      data: {
        code: '5000',
        name: 'Expense Account',
        type: 'Expense',
        parentAccount: 'Operating Expenses',
        openingBalance: 0,
        currentBalance: 0,
        description: 'General expenses',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId
      }
    });
    console.log('✅ [AP] Expense account created:', expenseAccount.id);
  } else {
    console.log('✅ [AP] Expense account found:', expenseAccount.id);
  }

  return expenseAccount;
}

// ─── HELPER: Generate bill number ─────────────────────────────────
// FIX: Uses prisma directly (not tx) and orderBy createdAt instead
// of billNumber string to avoid lexicographic sort bugs.
async function generateBillNumber(userId) {
  const year = new Date().getFullYear();
  const prefix = `BILL-${year}-`;

  const lastBill = await prisma.bill.findFirst({
    where: {
      createdBy: userId,
      billNumber: { startsWith: prefix }
    },
    orderBy: { createdAt: 'desc' } // ← date sort, not string sort
  });

  let nextNum = 1;
  if (lastBill) {
    const parts = lastBill.billNumber.split('-');
    const lastNum = parseInt(parts[parts.length - 1]) || 0;
    nextNum = lastNum + 1;
  }

  // Verify uniqueness
  let candidate = `${prefix}${String(nextNum).padStart(4, '0')}`;
  let guard = 0;
  while (guard < 200) {
    const existing = await prisma.bill.findFirst({
      where: { createdBy: userId, billNumber: candidate }
    });
    if (!existing) break;
    nextNum++;
    candidate = `${prefix}${String(nextNum).padStart(4, '0')}`;
    guard++;
  }

  return candidate;
}

// ─── HELPER: Validate bank account ────────────────────────────────
async function validateBankAccount(bankAccountId, userId, tx) {
  const db = tx || prisma;
  if (!bankAccountId) return null;

  const bankAccount = await db.bankAccount.findFirst({
    where: {
      id: bankAccountId,
      createdBy: userId,
      status: 'Active'
    },
    include: {
      chartOfAccount: true
    }
  });

  if (!bankAccount) {
    throw new Error('Bank account not found or does not belong to you');
  }
  return bankAccount;
}

// ─── HELPER: Determine bill status ───────────────────────────────
function determineBillStatus(totalAmount, paidAmount, dueDate) {
  const outstanding = totalAmount - paidAmount;
  if (outstanding <= 0) return 'Paid';
  if (paidAmount > 0 && outstanding > 0) return 'Partial';
  if (new Date(dueDate) < new Date() && outstanding > 0) return 'Overdue';
  return 'Unpaid';
}

// ============================================================
// ✅ SUPPLIER FUNCTIONS
// ============================================================

// @desc    Get all suppliers
// @route   GET /api/accounts-payable/suppliers
// @access  Private
exports.getSuppliers = async (req, res) => {
  console.log('📦 [AP] getSuppliers called');

  try {
    const { search, status } = req.query;
    const userId = req.user.id;

    const filter = { createdBy: userId };

    if (search) {
      filter.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (status === 'active') {
      filter.status = 'active';
    } else if (status === 'inactive') {
      filter.status = 'inactive';
    }

    const suppliers = await prisma.supplier.findMany({
      where: filter,
      orderBy: { name: 'asc' },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    const bills = await prisma.bill.findMany({
      where: {
        createdBy: userId,
        status: { not: 'Paid' }
      }
    });

    const suppliersWithOutstanding = suppliers.map(supplier => {
      const supplierBills = bills.filter(bill => bill.vendorId === supplier.id);
      const totalAmount = supplierBills.reduce((sum, bill) => sum + bill.totalAmount, 0);
      const paidAmount = supplierBills.reduce((sum, bill) => sum + bill.paidAmount, 0);
      const outstandingAmount = totalAmount - paidAmount;

      return {
        ...supplier,
        totalAmount,
        paidAmount,
        outstandingAmount,
        billCount: supplierBills.length,
      };
    });

    res.status(200).json({
      success: true,
      count: suppliersWithOutstanding.length,
      data: suppliersWithOutstanding,
    });
  } catch (error) {
    console.error('❌ [AP] Get suppliers error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single supplier
// @route   GET /api/accounts-payable/suppliers/:id
// @access  Private
exports.getSupplier = async (req, res) => {
  console.log('📦 [AP] getSupplier called');

  try {
    const { id } = req.params;
    const userId = req.user.id;

    const supplier = await prisma.supplier.findFirst({
      where: {
        id,
        createdBy: userId
      },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    const bills = await prisma.bill.findMany({
      where: {
        vendorId: supplier.id,
        createdBy: userId
      },
      orderBy: { date: 'desc' }
    });

    const totalAmount = bills.reduce((sum, bill) => sum + bill.totalAmount, 0);
    const paidAmount = bills.reduce((sum, bill) => sum + bill.paidAmount, 0);
    const outstandingAmount = totalAmount - paidAmount;

    res.status(200).json({
      success: true,
      data: {
        ...supplier,
        bills,
        totalAmount,
        paidAmount,
        outstandingAmount,
      },
    });
  } catch (error) {
    console.error('❌ [AP] Get supplier error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// BILL CRUD
// ============================================================

// @desc    Create bill
// @route   POST /api/accounts-payable/bills
// @access  Private
exports.createBill = async (req, res) => {
  console.log('📦 [AP] createBill called');

  try {
    const {
      supplierId,
      date,
      dueDate,
      items,
      discount,
      notes,
    } = req.body;

    const userId = req.user.id;

    // ─── Validate supplier ──────────────────────────────────────
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        createdBy: userId
      }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found. Please add supplier from warehouse first.',
      });
    }

    // ─── Calculate totals ───────────────────────────────────────
    let subtotal = 0;
    let taxTotal = 0;

    const processedItems = items.map(item => {
      const amount = item.quantity * item.unitPrice;
      const taxAmount = amount * ((item.taxRate || 0) / 100);
      subtotal += amount;
      taxTotal += taxAmount;

      return {
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: amount,
        taxRate: item.taxRate || 0,
        taxAmount: taxAmount,
      };
    });

    const totalAmount = subtotal + taxTotal - (discount || 0);
    const finalDueDate = dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const status = determineBillStatus(totalAmount, 0, finalDueDate);

    // FIX: Generate bill number OUTSIDE transaction, fresh on every retry
    const MAX_RETRIES = 5;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // ← Fresh number generated before each transaction attempt
        const billNumber = await generateBillNumber(userId);

        const result = await prisma.$transaction(async (tx) => {
          // ─── Create bill ──────────────────────────────────────
          const bill = await tx.bill.create({
            data: {
              billNumber,
              vendorId: supplier.id,
              vendorName: supplier.name,
              date: date ? new Date(date) : new Date(),
              dueDate: finalDueDate,
              items: processedItems,
              subtotal,
              taxTotal,
              discount: discount || 0,
              totalAmount,
              paidAmount: 0,
              outstanding: totalAmount,
              status: status,
              notes: notes || '',
              posted: true,
              postedAt: new Date(),
              createdBy: userId
            },
            include: {
              vendor: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true
                }
              },
              creator: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true
                }
              }
            }
          });

          console.log(`✅ [AP] Bill created: ${bill.billNumber}`);

          // ─── Create journal entry ──────────────────────────────
          const apAccount = await getOrCreatePayableAccount(userId, tx);
          const expenseAccount = await getOrCreateExpenseAccount(userId, tx);

          await tx.journalEntry.create({
            data: {
              entryNumber: `JE-${Date.now()}`,
              date: new Date(),
              description: `Bill ${bill.billNumber} - ${supplier.name}`,
              reference: bill.billNumber,
              status: 'Posted',
              createdBy: userId,
              postedBy: userId,
              postedAt: new Date(),
              lines: {
                create: [
                  {
                    accountId: expenseAccount.id,
                    accountName: expenseAccount.name,
                    accountCode: expenseAccount.code,
                    debit: totalAmount,
                    credit: 0,
                    isReconciled: false
                  },
                  {
                    accountId: apAccount.id,
                    accountName: apAccount.name,
                    accountCode: apAccount.code,
                    debit: 0,
                    credit: totalAmount,
                    isReconciled: false
                  }
                ]
              }
            }
          });

          // ─── Update AP account balance ────────────────────────
          await tx.chartOfAccount.update({
            where: { id: apAccount.id },
            data: {
              currentBalance: {
                increment: totalAmount
              }
            }
          });

          return bill;
        });

        return res.status(201).json({
          success: true,
          data: result,
          message: 'Bill created successfully. AP balance updated.',
        });

      } catch (error) {
        lastError = error;
        if (error.code === 'P2002' && attempt < MAX_RETRIES) {
          console.warn(`⚠️ [AP] billNumber collision, retrying (attempt ${attempt}/${MAX_RETRIES})`);
          continue;
        }
        break;
      }
    }

    console.error('❌ [AP] Create bill error:', lastError);
    return res.status(500).json({
      success: false,
      message: lastError ? lastError.message : 'Failed to create bill',
    });

  } catch (error) {
    console.error('❌ [AP] Create bill error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get all bills
// @route   GET /api/accounts-payable/bills
// @access  Private
exports.getBills = async (req, res) => {
  console.log('📦 [AP] getBills called');

  try {
    const { supplierId, status, startDate, endDate } = req.query;
    const userId = req.user.id;

    const filter = { createdBy: userId };

    if (supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: {
          id: supplierId,
          createdBy: userId
        }
      });
      if (supplier) {
        filter.vendorId = supplierId;
      }
    }

    if (status) {
      filter.status = status;
    }

    if (startDate && endDate) {
      filter.date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    const bills = await prisma.bill.findMany({
      where: filter,
      orderBy: { date: 'desc' },
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        paymentsMade: {
          select: {
            id: true,
            paymentNumber: true,
            amount: true,
            paymentDate: true,
            status: true
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      count: bills.length,
      data: bills,
    });
  } catch (error) {
    console.error('❌ [AP] Get bills error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single bill
// @route   GET /api/accounts-payable/bills/:id
// @access  Private
exports.getBill = async (req, res) => {
  console.log('📦 [AP] getBill called');

  try {
    const { id } = req.params;
    const userId = req.user.id;

    const bill = await prisma.bill.findFirst({
      where: {
        id,
        createdBy: userId
      },
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            address: true
          }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        paymentsMade: {
          select: {
            id: true,
            paymentNumber: true,
            amount: true,
            paymentDate: true,
            status: true
          }
        }
      }
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found',
      });
    }

    res.status(200).json({
      success: true,
      data: bill,
    });
  } catch (error) {
    console.error('❌ [AP] Get bill error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Update bill
// @route   PUT /api/accounts-payable/bills/:id
// @access  Private
exports.updateBill = async (req, res) => {
  console.log('📦 [AP] updateBill called');

  try {
    const { id } = req.params;
    const userId = req.user.id;

    const existing = await prisma.bill.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found',
      });
    }

    if (existing.status === 'Paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update a paid bill',
      });
    }

    const {
      date,
      dueDate,
      items,
      discount,
      notes,
      status,
    } = req.body;

    let subtotal = existing.subtotal;
    let taxTotal = existing.taxTotal;
    let totalAmount = existing.totalAmount;
    let processedItems = existing.items;

    if (items && items.length > 0) {
      subtotal = 0;
      taxTotal = 0;
      processedItems = items.map(item => {
        const amount = item.quantity * item.unitPrice;
        const taxAmount = amount * ((item.taxRate || 0) / 100);
        subtotal += amount;
        taxTotal += taxAmount;

        return {
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: amount,
          taxRate: item.taxRate || 0,
          taxAmount: taxAmount,
        };
      });
      totalAmount = subtotal + taxTotal - (discount || existing.discount || 0);
    }

    const updateData = {
      date: date ? new Date(date) : existing.date,
      dueDate: dueDate ? new Date(dueDate) : existing.dueDate,
      items: processedItems,
      subtotal,
      taxTotal,
      discount: discount !== undefined ? discount : existing.discount,
      totalAmount,
      notes: notes !== undefined ? notes : existing.notes,
      status: status || existing.status,
    };

    if (totalAmount !== existing.totalAmount) {
      updateData.status = determineBillStatus(totalAmount, existing.paidAmount, updateData.dueDate);
    }

    const updated = await prisma.bill.update({
      where: { id },
      data: updateData,
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Bill updated successfully',
    });
  } catch (error) {
    console.error('❌ [AP] Update bill error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Delete bill
// @route   DELETE /api/accounts-payable/bills/:id
// @access  Private
exports.deleteBill = async (req, res) => {
  console.log('📦 [AP] deleteBill called');

  try {
    const { id } = req.params;
    const userId = req.user.id;

    const bill = await prisma.bill.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found',
      });
    }

    if (bill.status === 'Paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete a paid bill',
      });
    }

    const payments = await prisma.paymentMade.findMany({
      where: {
        billId: id,
        createdBy: userId
      }
    });

    if (payments.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete bill with existing payments',
      });
    }

    await prisma.bill.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'Bill deleted successfully',
    });
  } catch (error) {
    console.error('❌ [AP] Delete bill error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// PAYMENT FUNCTIONS
// ============================================================

// @desc    Record payment against bill
// @route   POST /api/accounts-payable/payments
// @access  Private
exports.recordPayment = async (req, res) => {
  console.log('📦 [AP] recordPayment called');

  try {
    const {
      billId,
      amount,
      paymentDate,
      paymentMethod,
      reference,
      bankAccountId,
    } = req.body;

    const userId = req.user.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be greater than zero'
      });
    }

    const MAX_RETRIES = 5;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          // ─── Get bill ──────────────────────────────────────────
          const bill = await tx.bill.findFirst({
            where: { id: billId, createdBy: userId },
            include: { vendor: true }
          });

          if (!bill) {
            const err = new Error('Bill not found');
            err.statusCode = 404;
            throw err;
          }

          // ─── Validate amount ──────────────────────────────────
          const outstanding = bill.totalAmount - bill.paidAmount;
          if (amount > outstanding) {
            const err = new Error(`Payment amount cannot exceed outstanding balance of ${outstanding}`);
            err.statusCode = 400;
            throw err;
          }

          // ─── Update bill ──────────────────────────────────────
          const newPaidAmount = bill.paidAmount + amount;
          const newOutstanding = bill.totalAmount - newPaidAmount;
          const newStatus = determineBillStatus(bill.totalAmount, newPaidAmount, bill.dueDate);

          const updatedBill = await tx.bill.update({
            where: { id: billId },
            data: {
              paidAmount: newPaidAmount,
              outstanding: newOutstanding,
              status: newStatus
            }
          });

          // ─── Get accounts ─────────────────────────────────────
          const apAccount = await getOrCreatePayableAccount(userId, tx);
          let debitAccount;
          let bankAccountData = null;

          if (bankAccountId && bankAccountId !== 'null' && bankAccountId !== 'NULL' && bankAccountId !== '') {
            bankAccountData = await validateBankAccount(bankAccountId, userId, tx);
            if (bankAccountData && bankAccountData.chartOfAccount) {
              debitAccount = bankAccountData.chartOfAccount;
            }
          }

          if (!debitAccount) {
            debitAccount = await getOrCreateCashAccount(userId, tx);
          }

          // ─── Create journal entry for payment ─────────────────
          await tx.journalEntry.create({
            data: {
              entryNumber: `JE-${Date.now()}`,
              date: paymentDate ? new Date(paymentDate) : new Date(),
              description: `Payment made for ${bill.billNumber} to ${bill.vendor.name}`,
              reference: reference || `PAY-${bill.billNumber}`,
              status: 'Posted',
              createdBy: userId,
              postedBy: userId,
              postedAt: new Date(),
              lines: {
                create: [
                  {
                    accountId: apAccount.id,
                    accountName: apAccount.name,
                    accountCode: apAccount.code,
                    debit: amount,
                    credit: 0,
                    isReconciled: false
                  },
                  {
                    accountId: debitAccount.id,
                    accountName: debitAccount.name,
                    accountCode: debitAccount.code,
                    debit: 0,
                    credit: amount,
                    isReconciled: false
                  }
                ]
              }
            }
          });

          // ─── Update AP account balance (decrease) ─────────────
          await tx.chartOfAccount.update({
            where: { id: apAccount.id },
            data: { currentBalance: { decrement: amount } }
          });

          // ─── Update bank/cash balance (decrease) ──────────────
          if (bankAccountData) {
            const newBankBalance = bankAccountData.currentBalance - amount;
            await tx.bankAccount.update({
              where: { id: bankAccountData.id },
              data: { currentBalance: newBankBalance }
            });
            if (bankAccountData.chartOfAccountId) {
              await tx.chartOfAccount.update({
                where: { id: bankAccountData.chartOfAccountId },
                data: { currentBalance: newBankBalance }
              });
            }
          } else if (debitAccount) {
            await tx.chartOfAccount.update({
              where: { id: debitAccount.id },
              data: { currentBalance: { decrement: amount } }
            });
          }

          // ─── Create payment record ─────────────────────────────
          const paymentNumber = `PMT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

          const paymentRecord = await tx.paymentMade.create({
            data: {
              paymentNumber,
              paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
              supplierId: bill.vendorId,
              supplierName: bill.vendor.name,
              billId: bill.id,
              billNumber: bill.billNumber,
              billAmount: bill.totalAmount,
              amount: amount,
              paymentMethod: paymentMethod || 'Bank Transfer',
              reference: reference || '',
              bankAccountId: bankAccountData?.id || null,
              bankAccountName: bankAccountData?.accountName || '',
              notes: '',
              status: 'Cleared',
              createdBy: userId
            }
          });

          return { updatedBill, paymentRecord };
        });

        return res.status(200).json({
          success: true,
          data: {
            bill: {
              id: result.updatedBill.id,
              billNumber: result.updatedBill.billNumber,
              paidAmount: result.updatedBill.paidAmount,
              outstanding: result.updatedBill.outstanding,
              status: result.updatedBill.status,
            },
            payment: {
              id: result.paymentRecord.id,
              paymentNumber: result.paymentRecord.paymentNumber,
              amount: result.paymentRecord.amount,
              date: result.paymentRecord.paymentDate,
              method: result.paymentRecord.paymentMethod,
              reference: result.paymentRecord.reference,
            },
          },
          message: 'Payment recorded successfully. AP balance updated.',
        });

      } catch (error) {
        lastError = error;
        if (error.code === 'P2002' && attempt < MAX_RETRIES) {
          console.warn(`⚠️ [AP] paymentNumber collision, retrying (attempt ${attempt}/${MAX_RETRIES})`);
          continue;
        }
        break;
      }
    }

    const statusCode = lastError && lastError.statusCode ? lastError.statusCode : 500;
    return res.status(statusCode).json({
      success: false,
      message: lastError ? lastError.message : 'Failed to record payment'
    });

  } catch (error) {
    console.error('❌ [AP] Record payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// SUMMARY & REPORTS
// ============================================================

// @desc    Get AP summary
// @route   GET /api/accounts-payable/summary
// @access  Private
exports.getSummary = async (req, res) => {
  console.log('📦 [AP] getSummary called');

  try {
    const userId = req.user.id;

    const bills = await prisma.bill.findMany({
      where: {
        createdBy: userId,
        status: { not: 'Paid' }
      }
    });

    const totalOutstanding = bills.reduce(
      (sum, bill) => sum + (bill.totalAmount - bill.paidAmount),
      0
    );

    const now = new Date();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const overdue = bills
      .filter(bill => bill.dueDate < now && bill.status !== 'Paid')
      .reduce((sum, bill) => sum + (bill.totalAmount - bill.paidAmount), 0);

    const dueThisWeek = bills
      .filter(bill => bill.dueDate >= now && bill.dueDate <= endOfWeek && bill.status !== 'Paid')
      .reduce((sum, bill) => sum + (bill.totalAmount - bill.paidAmount), 0);

    const dueThisMonth = bills
      .filter(bill => bill.dueDate >= now && bill.dueDate <= endOfMonth && bill.status !== 'Paid')
      .reduce((sum, bill) => sum + (bill.totalAmount - bill.paidAmount), 0);

    const activeSuppliers = await prisma.supplier.count({
      where: {
        createdBy: userId,
        status: 'active'
      }
    });

    res.status(200).json({
      success: true,
      data: {
        totalOutstanding,
        overdue,
        dueThisWeek,
        dueThisMonth,
        activeSuppliers,
      },
    });
  } catch (error) {
    console.error('❌ [AP] Get AP summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get aged payables report
// @route   GET /api/accounts-payable/aged
// @access  Private
exports.getAgedPayables = async (req, res) => {
  console.log('📦 [AP] getAgedPayables called');

  try {
    const userId = req.user.id;

    const bills = await prisma.bill.findMany({
      where: {
        createdBy: userId,
        status: { not: 'Paid' }
      },
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        }
      }
    });

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const supplierMap = new Map();

    for (const bill of bills) {
      const outstanding = bill.totalAmount - (bill.paidAmount || 0);
      if (outstanding <= 0) continue;

      const supplierId = bill.vendorId || 'unknown';
      const supplierName = bill.vendor?.name || 'Unknown Supplier';

      if (!supplierMap.has(supplierId)) {
        supplierMap.set(supplierId, {
          id: supplierId,
          name: supplierName,
          email: bill.vendor?.email || '',
          phone: bill.vendor?.phone || '',
          bills: [],
          current: 0,
          days1to30: 0,
          days31to60: 0,
          days61to90: 0,
          days90plus: 0,
          totalOutstanding: 0,
        });
      }

      const supplier = supplierMap.get(supplierId);
      const dueDate = new Date(bill.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      const daysPastDue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));

      if (daysPastDue <= 0) {
        supplier.current += outstanding;
      } else if (daysPastDue <= 30) {
        supplier.days1to30 += outstanding;
      } else if (daysPastDue <= 60) {
        supplier.days31to60 += outstanding;
      } else if (daysPastDue <= 90) {
        supplier.days61to90 += outstanding;
      } else {
        supplier.days90plus += outstanding;
      }

      supplier.totalOutstanding += outstanding;
      supplier.bills.push({
        id: bill.id,
        billNumber: bill.billNumber,
        date: bill.date,
        dueDate: bill.dueDate,
        amount: bill.totalAmount,
        paidAmount: bill.paidAmount || 0,
        outstanding,
        daysPastDue: Math.max(0, daysPastDue),
      });
    }

    const suppliers = Array.from(supplierMap.values()).sort(
      (a, b) => b.totalOutstanding - a.totalOutstanding
    );

    const summary = suppliers.reduce(
      (acc, v) => ({
        current: acc.current + v.current,
        days1to30: acc.days1to30 + v.days1to30,
        days31to60: acc.days31to60 + v.days31to60,
        days61to90: acc.days61to90 + v.days61to90,
        days90plus: acc.days90plus + v.days90plus,
        totalOutstanding: acc.totalOutstanding + v.totalOutstanding,
      }),
      { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, totalOutstanding: 0 }
    );

    res.status(200).json({
      success: true,
      data: { suppliers, summary },
    });
  } catch (error) {
    console.error('❌ [AP] Get aged payables error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get unpaid bills for supplier
// @route   GET /api/accounts-payable/bills/unpaid/:supplierId
// @access  Private
exports.getUnpaidBills = async (req, res) => {
  console.log('📦 [AP] getUnpaidBills called');

  try {
    const { supplierId } = req.params;
    const userId = req.user.id;

    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        createdBy: userId
      }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    const bills = await prisma.bill.findMany({
      where: {
        vendorId: supplierId,
        createdBy: userId,
        status: { not: 'Paid' }
      },
      orderBy: { dueDate: 'asc' },
      include: {
        paymentsMade: {
          select: {
            id: true,
            paymentNumber: true,
            amount: true,
            paymentDate: true,
            status: true
          }
        }
      }
    });

    const unpaidBills = bills.map(bill => ({
      id: bill.id,
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
    console.error('❌ [AP] Get unpaid bills error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Mark overdue bills (cron job)
// @route   POST /api/accounts-payable/bills/mark-overdue
// @access  Private (Admin)
exports.markOverdueBills = async (req, res) => {
  console.log('📦 [AP] markOverdueBills called');

  try {
    const userId = req.user.id;

    const result = await prisma.bill.updateMany({
      where: {
        createdBy: userId,
        dueDate: { lt: new Date() },
        status: { in: ['Unpaid', 'Partial'] }
      },
      data: {
        status: 'Overdue'
      }
    });

    res.status(200).json({
      success: true,
      message: `${result.count} bills marked as overdue`,
      count: result.count,
    });
  } catch (error) {
    console.error('❌ [AP] Mark overdue bills error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};