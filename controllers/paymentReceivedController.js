// controllers/paymentReceivedController.js - FIXED: Atomic transaction + retry logic for paymentNumber

const PaymentReceived = require('../models/PaymentReceived');
const SalesPaymentReceived = require('../warehouse/models/SalesPaymentReceived');
const prisma = require('../prisma/client');
const { fiscalYearGuard } = require('../middleware/fiscalYearMiddleware');
const { resolveFiscalYearId } = require('../utils/fiscalYearHelper');
// ─── HELPER: Get or create Accounts Receivable account ──────────
async function getOrCreateReceivableAccount(userId, companyId, tx) {
  const db = tx || prisma;
  let arAccount = await db.chartOfAccount.findFirst({
    where: { code: '1110',  companyId: companyId }
  });

  if (!arAccount) {
    arAccount = await db.chartOfAccount.create({
      data: {
        code: '1110',
        name: 'Accounts Receivable',
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Amount due from customers',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId
      }
    });
  }
  return arAccount;
}

// ─── HELPER: Get or create Cash account ──────────────────────────
async function getOrCreateCashAccount(userId, companyId, tx) {
  const db = tx || prisma;
  let cashAccount = await db.chartOfAccount.findFirst({
    where: { code: '1010',  companyId: companyId }
  });

  if (!cashAccount) {
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
        createdBy: userId,
        companyId: companyId
      }
    });
  }
  return cashAccount;
}

// ─── HELPER: Validate Customer ──────────────────────────────────
async function validateCustomer(customerId, companyId, tx) {
  const db = tx || prisma;
  if (!customerId) throw new Error('Customer ID is required');

  const customer = await db.customer.findFirst({
    where: { id: customerId, companyId: companyId, isActive: true }
  });

  if (!customer) throw new Error('Customer not found or does not belong to you');
  return customer;
}

// ─── HELPER: Validate Bank Account ──────────────────────────────
async function validateBankAccount(bankAccountId, companyId, tx) {
  const db = tx || prisma;
  if (!bankAccountId) return null;

  const bankAccount = await db.bankAccount.findFirst({
    where: { id: bankAccountId, companyId: companyId, status: 'Active' },
    include: { chartOfAccount: true }
  });

  if (!bankAccount) throw new Error('Bank account not found or does not belong to you');
  return bankAccount;
}

// ─── HELPER: Validate Invoice (warehouse OR sales) ──────────────
async function validateInvoice(invoiceId, companyId, tx) {
  const db = tx || prisma;
  if (!invoiceId) throw new Error('Invoice ID is required');

  const warehouse = await db.warehouseInvoice.findFirst({
    where: {
      id: invoiceId,
      companyId,
      invoiceStatus: { not: 'Paid' },
      isDeleted: false
    }
  });
  if (warehouse) {
    return { source: 'warehouse', invoice: warehouse };
  }

  const sales = await db.salesInvoice.findFirst({
    where: {
      id: invoiceId,
      companyId,
      isDeleted: false,
      isActive: true,
      invoiceStatus: { notIn: ['Cancelled'] }
    },
    include: {
      invoicePayments: {
        where: {
          payment: {
            isActive: true,
            isDeleted: false,
            status: 'Completed'
          }
        },
        select: { amountPaid: true }
      },
      creditNotes: {
        where: { status: { notIn: ['Cancelled', 'Voided'] } },
        select: { amount: true }
      }
    }
  });

  if (sales) {
    const paidFromPayments = (sales.invoicePayments || []).reduce(
      (s, p) => s + (Number(p.amountPaid) || 0),
      0
    );
    const paidAmount = Math.max(Number(sales.paidAmount) || 0, paidFromPayments);
    const credited = (sales.creditNotes || []).reduce(
      (s, c) => s + (Number(c.amount) || 0),
      0
    );
    const outstanding = Math.max(
      0,
      (Number(sales.grandTotal) || 0) - paidAmount - credited
    );
    if (outstanding <= 0) {
      throw new Error('Invoice not found or already paid');
    }
    return {
      source: 'sales',
      invoice: { ...sales, paidAmount, outstanding }
    };
  }

  throw new Error('Invoice not found or already paid');
}

// ─── HELPER: Generate next payment number (used inside retry loop) ──
async function generatePaymentNumber(companyId, tx) {
  const year = new Date().getFullYear();
  const prefix = `PMT-${year}-`;

  const lastPayment = await tx.paymentReceived.findFirst({
    where: { companyId: companyId, paymentNumber: { startsWith: prefix } },
    orderBy: { paymentNumber: 'desc' }
  });

  if (!lastPayment) return `${prefix}0001`;

  const parts = lastPayment.paymentNumber.split('-');
  const lastNum = parseInt(parts[parts.length - 1]) || 0;
  const nextNum = lastNum + 1;
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

// ============================================================
// @desc    Record payment received
// @route   POST /api/accounts-receivable/payments
// @access  Private
// ============================================================
const recordPayment = async (req, res) => {
  try {
    const {
      customerId,
      invoiceId,
      amount,
      paymentDate,
      paymentMethod,
      reference,
      bankAccountId,
      notes
    } = req.body;

    const userId = req.user.id;
    const companyId = req.user.companyId;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📦 [recordPayment] START');
    console.log('  userId     :', userId);
    console.log('  companyId  :', companyId);
    console.log('  customerId :', customerId);
    console.log('  invoiceId  :', invoiceId);
    console.log('  amount     :', amount);
    console.log('  paymentMethod:', paymentMethod);
    console.log('  bankAccountId:', bankAccountId);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!companyId) {
      console.error('❌ [recordPayment] companyId is missing from req.user');
      return res.status(400).json({ success: false, message: 'Company ID not found in session. Please re-login.' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be greater than zero'
      });
    }

    // Detect sales vs warehouse early (outside warehouse-only transaction path)
    const invoiceProbe = await validateInvoice(invoiceId, companyId);
    if (invoiceProbe.source === 'sales') {
      console.log('📦 [recordPayment] Routing to Sales payment flow');

      const postingDate = paymentDate ? new Date(paymentDate) : new Date();
      try {
        await fiscalYearGuard(userId, postingDate);
      } catch (err) {
        if (err.code === 'FISCAL_YEAR_CLOSED') {
          return res.status(400).json({ success: false, message: err.message });
        }
        throw err;
      }

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, companyId }
      });
      if (!customer) {
        return res.status(404).json({ success: false, message: 'Customer not found' });
      }

      if (amount > invoiceProbe.invoice.outstanding) {
        return res.status(400).json({
          success: false,
          message: `Payment amount cannot exceed outstanding balance of ${invoiceProbe.invoice.outstanding}`,
          outstanding: invoiceProbe.invoice.outstanding
        });
      }

      let bankAccountName = paymentMethod === 'Cash' ? 'Cash in Hand' : '';
      if (bankAccountId) {
        const ba = await prisma.bankAccount.findFirst({
          where: { id: bankAccountId, companyId, status: 'Active' }
        });
        if (ba) bankAccountName = ba.accountName;
      }

      const payment = await SalesPaymentReceived.receivePayment({
        customerId: customer.id,
        customerName: customer.name,
        amount,
        paymentMethod: paymentMethod || 'Cash',
        bankAccountId: bankAccountId || null,
        bankAccountName,
        reference: reference || '',
        notes: notes || '',
        invoicePayments: [
          {
            invoiceId: invoiceProbe.invoice.id,
            invoiceNumber: invoiceProbe.invoice.invoiceNumber,
            amountPaid: amount
          },
        ],
        userId,
        createdBy: userId,
        companyId
      });

      try {
      } catch (_) {
        /* ignore cache errors */
      }

      return res.status(201).json({
        success: true,
        message: 'Payment recorded successfully',
        data: payment,
        source: 'sales'
      });
    }

    // ─── Fiscal year guard ─────────────────────────────────────────
    const postingDate = paymentDate ? new Date(paymentDate) : new Date();
    console.log('🗓️  [recordPayment] postingDate:', postingDate);
    try {
      await fiscalYearGuard(userId, postingDate);
      console.log('✅ [recordPayment] Fiscal year guard passed');
    } catch (err) {
      console.error('❌ [recordPayment] Fiscal year guard failed:', err.message);
      if (err.code === 'FISCAL_YEAR_CLOSED') {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }

    const MAX_RETRIES = 5;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`🔄 [recordPayment] Transaction attempt ${attempt}/${MAX_RETRIES}`);
      try {
        const result = await prisma.$transaction(async (tx) => {
          // 1. Validate customer
          console.log('  [tx] Step 1: validateCustomer...');
          const customer = await validateCustomer(customerId, companyId, tx);
          console.log('  [tx] Customer found:', customer.id, customer.name);

          // 2. Validate invoice (warehouse)
          console.log('  [tx] Step 2: validateInvoice...');
          const resolved = await validateInvoice(invoiceId, companyId, tx);
          const invoice = resolved.invoice;
          console.log('  [tx] Invoice found:', invoice.id, invoice.invoiceNumber, '| grandTotal:', invoice.grandTotal, '| paidAmount:', invoice.paidAmount);

          // 3. Validate amount vs outstanding
          const outstanding = invoice.grandTotal - invoice.paidAmount;
          console.log('  [tx] Step 3: outstanding =', outstanding, '| requested amount =', amount);
          if (amount > outstanding) {
            const err = new Error(
              `Payment amount cannot exceed outstanding balance of ${outstanding}`
            );
            err.statusCode = 400;
            err.outstanding = outstanding;
            throw err;
          }

          // 4. Validate bank account (if applicable)
          let bankAccount = null;
          let bankChartAccount = null;
          console.log('  [tx] Step 4: validate bank account (method:', paymentMethod, ', bankAccountId:', bankAccountId, ')');
          if (paymentMethod !== 'Cash' && bankAccountId) {
            bankAccount = await validateBankAccount(bankAccountId, companyId, tx);
            if (bankAccount) bankChartAccount = bankAccount.chartOfAccount;
            console.log('  [tx] Bank account found:', bankAccount?.id, bankAccount?.accountName);
          }

          // 5. Get/create AR + Cash accounts
          console.log('  [tx] Step 5: getOrCreate AR + Cash accounts...');
          const arAccount = await getOrCreateReceivableAccount(userId, companyId, tx);
          const cashAccount = await getOrCreateCashAccount(userId, companyId, tx);
          console.log('  [tx] AR account:', arAccount?.id, arAccount?.code);
          console.log('  [tx] Cash account:', cashAccount?.id, cashAccount?.code);

          // 6. Determine debit account
          let debitAccount = cashAccount;
          if (paymentMethod !== 'Cash' && bankChartAccount) {
            debitAccount = bankChartAccount;
          }

          // 7. Update invoice paid amount
          const newPaidAmount = invoice.paidAmount + amount;
          const newOutstanding = invoice.grandTotal - newPaidAmount;
          const newStatus = newOutstanding <= 0 ? 'Paid' : 'Partial';

          const updatedInvoice = await tx.warehouseInvoice.update({
            where: { id: invoice.id },
            data: { paidAmount: newPaidAmount, invoiceStatus: newStatus }
          });

          // 8. Generate payment number FRESH inside this transaction
          console.log('  [tx] Step 8: generatePaymentNumber...');
          const paymentNumber = await generatePaymentNumber(companyId, tx);
          console.log('  [tx] paymentNumber:', paymentNumber);

          // 8a. Resolve fiscal year id for this posting date
          console.log('  [tx] Step 8a: resolveFiscalYearId...');
          const fyId = await resolveFiscalYearId(userId, postingDate);
          console.log('  [tx] fiscalYearId:', fyId);

          const paymentData = {
            paymentNumber,
            paymentDate: paymentDate || new Date(),
            customerId: customer.id,
            customerName: customer.name,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            invoiceAmount: invoice.grandTotal,
            amount,
            paymentMethod: paymentMethod || 'Cash',
            reference: reference || '',
            bankAccountId: bankAccountId || null,
            bankAccountName: bankAccount
              ? bankAccount.accountName
              : (paymentMethod === 'Cash' ? 'Cash in Hand' : ''),
            notes: notes || '',
            status: paymentMethod === 'Cheque' ? 'Pending' : 'Cleared',
            clearedDate: paymentMethod === 'Cheque' ? null : new Date(),
            createdBy: userId,
            companyId: companyId,
            fiscalYearId: fyId
          };

          console.log('  [tx] Step 9: Creating payment record with data:');
          console.log(JSON.stringify(paymentData, null, 2));

          // 9. Create payment record
          const payment = await tx.paymentReceived.create({
            data: paymentData,
            include: {
              customer: { select: { id: true, name: true, email: true, phone: true } },
              creator: { select: { id: true, firstName: true, lastName: true, email: true } }
            }
          });
          console.log('  [tx] ✅ Payment created:', payment.id, payment.paymentNumber);

          // 10. Create journal entry
          const journalEntry = await tx.journalEntry.create({
            data: {
              entryNumber: `JE-${Date.now()}`,
              date: paymentDate || new Date(),
              description: `Payment received for ${invoice.invoiceNumber} from ${customer.name}`,
              reference: reference || payment.paymentNumber,
              status: 'Posted',
              createdBy: userId,
              postedBy: userId,
              postedAt: new Date(),
              lines: {
                create: [
                  {
                    accountId: debitAccount.id,
                    accountName: debitAccount.name,
                    accountCode: debitAccount.code,
                    debit: amount,
                    credit: 0,
                    isReconciled: false
                  },
                  {
                    accountId: arAccount.id,
                    accountName: arAccount.name,
                    accountCode: arAccount.code,
                    debit: 0,
                    credit: amount,
                    isReconciled: false
                  }
                ]
              }
            }
          });

          // 11. Update bank/cash account balance
          if (paymentMethod !== 'Cash' && bankAccount && bankAccountId) {
            const newBalance = bankAccount.currentBalance + amount;
            await tx.bankAccount.update({
              where: { id: bankAccountId },
              data: { currentBalance: newBalance }
            });
            if (bankChartAccount) {
              await tx.chartOfAccount.update({
                where: { id: bankChartAccount.id },
                data: { currentBalance: newBalance }
              });
            }
          } else if (cashAccount) {
            await tx.chartOfAccount.update({
              where: { id: cashAccount.id },
              data: { currentBalance: { increment: amount } }
            });
          }

          // 12. Update AR account balance
          await tx.chartOfAccount.update({
            where: { id: arAccount.id },
            data: { currentBalance: { decrement: amount } }
          });

          return { payment, journalEntry, updatedInvoice, debitAccount };
        });

        // ✅ Success — transaction committed, payment IS in the database
        return res.status(201).json({
          success: true,
          message: 'Payment recorded successfully! Journal entry created.',
          data: {
            payment: result.payment,
            journalEntry: result.journalEntry,
            invoice: {
              id: result.updatedInvoice.id,
              invoiceNumber: result.updatedInvoice.invoiceNumber,
              paidAmount: result.updatedInvoice.paidAmount,
              outstanding: result.updatedInvoice.grandTotal - result.updatedInvoice.paidAmount,
              status: result.updatedInvoice.invoiceStatus
            },
            balanceUpdate: {
              account: result.debitAccount.name,
              accountType: result.debitAccount.type,
              change: amount
            }
          }
        });

      } catch (error) {
        lastError = error;

        console.error(`❌ [recordPayment] Transaction attempt ${attempt} FAILED:`);
        console.error('  message   :', error.message);
        console.error('  code      :', error.code);
        console.error('  statusCode:', error.statusCode);
        console.error('  stack     :', error.stack);

        // Prisma unique constraint violation on paymentNumber → retry
        if (error.code === 'P2002' && attempt < MAX_RETRIES) {
          console.warn(`⚠️ [AR] paymentNumber collision, retrying (attempt ${attempt}/${MAX_RETRIES})`);
          continue;
        }

        // Any other error → stop retrying
        break;
      }
    }

    // If we get here, all retries failed or a non-retryable error occurred
    console.error('❌ [recordPayment] All retries exhausted. lastError:', lastError?.message);
    const statusCode = lastError && lastError.statusCode ? lastError.statusCode : 500;
    const response = { success: false, message: lastError ? lastError.message : 'Failed to record payment' };
    if (lastError && lastError.outstanding !== undefined) {
      response.outstanding = lastError.outstanding;
    }
    return res.status(statusCode).json(response);

  } catch (error) {
    console.error('❌ [AR] Record payment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// @desc    Get all payments
// @route   GET /api/accounts-receivable/payments
// @access  Private
// ============================================================
const getPayments = async (req, res) => {
  try {
    const { customerId, invoiceId, status, startDate, endDate, search, page = 1, limit = 20 } = req.query;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const filter = { companyId: companyId };

    if (customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId: companyId} });
      if (customer) filter.customerId = customerId;
    }

    if (invoiceId) {
      const invoice = await prisma.warehouseInvoice.findFirst({ where: { id: invoiceId, companyId: companyId} });
      if (invoice) filter.invoiceId = invoiceId;
    }

    if (status) filter.status = status;

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.paymentDate = { gte: start, lte: end };
    }

    if (search) {
      filter.OR = [
        { paymentNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } }
      ];
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const [payments, total] = await Promise.all([
      prisma.paymentReceived.findMany({
        where: filter,
        skip,
        take: limitNum,
        orderBy: { paymentDate: 'desc' },
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
          creator: { select: { id: true, firstName: true, lastName: true, email: true } }
        }
      }),
      prisma.paymentReceived.count({ where: filter })
    ]);

    res.status(200).json({
      success: true,
      count: payments.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: payments
    });

  } catch (error) {
    console.error('❌ [AR] Get payments error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// @desc    Get single payment
// ============================================================
const getPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const payment = await prisma.paymentReceived.findFirst({
      where: { id, companyId: companyId},
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true, address: true } },
        creator: { select: { id: true, firstName: true, lastName: true, email: true } },
        invoice: {
          select: { id: true, invoiceNumber: true, grandTotal: true, paidAmount: true, invoiceStatus: true }
        }
      }
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    res.status(200).json({ success: true, data: payment });
  } catch (error) {
    console.error('❌ [AR] Get payment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// @desc    Get unpaid invoices for customer
// ============================================================
const getUnpaidInvoices = async (req, res) => {
  try {
    const { customerId } = req.params;
    const companyId = req.user.companyId;
    const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId: companyId} });
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const [warehouseInvoices, salesInvoices] = await Promise.all([
      prisma.warehouseInvoice.findMany({
        where: {
          customerId,
          companyId,
          isDeleted: false,
          invoiceStatus: { notIn: ['Paid', 'Cancelled'] }
        },
        orderBy: { dueDate: 'asc' }
      }),
      prisma.salesInvoice.findMany({
        where: {
          customerId,
          companyId,
          isDeleted: false,
          isActive: true,
          invoiceStatus: { notIn: ['Cancelled'] }
        },
        include: {
          invoicePayments: {
            where: {
              payment: { isActive: true, isDeleted: false, status: 'Completed' }
            },
            select: { amountPaid: true }
          },
          creditNotes: {
            where: { status: { notIn: ['Cancelled', 'Voided'] } },
            select: { amount: true }
          }
        },
        orderBy: { dueDate: 'asc' }
      }),
    ]);

    const unpaidInvoices = [
      ...warehouseInvoices.map((invoice) => {
        const outstanding = (invoice.grandTotal || 0) - (invoice.paidAmount || 0);
        return {
          id: invoice.id,
          source: 'warehouse',
          invoiceNumber: invoice.invoiceNumber,
          date: invoice.invoiceDate,
          dueDate: invoice.dueDate,
          totalAmount: invoice.grandTotal,
          paidAmount: invoice.paidAmount,
          outstanding,
          status: invoice.invoiceStatus
        };
      }),
      ...salesInvoices.map((invoice) => {
        const paidFromPayments = (invoice.invoicePayments || []).reduce(
          (s, p) => s + (Number(p.amountPaid) || 0),
          0
        );
        const paidAmount = Math.max(Number(invoice.paidAmount) || 0, paidFromPayments);
        const credited = (invoice.creditNotes || []).reduce(
          (s, c) => s + (Number(c.amount) || 0),
          0
        );
        const outstanding = Math.max(
          0,
          (Number(invoice.grandTotal) || 0) - paidAmount - credited
        );
        return {
          id: invoice.id,
          source: 'sales',
          invoiceNumber: invoice.invoiceNumber,
          date: invoice.invoiceDate,
          dueDate: invoice.dueDate,
          totalAmount: invoice.grandTotal,
          paidAmount,
          outstanding,
          status: outstanding <= 0 ? 'Paid' : paidAmount > 0 ? 'Partial' : 'Unpaid'
        };
      }),
    ].filter((inv) => inv.outstanding > 0);

    const totalOutstanding = unpaidInvoices.reduce((sum, inv) => sum + inv.outstanding, 0);

    res.status(200).json({
      success: true,
      count: unpaidInvoices.length,
      totalOutstanding,
      data: unpaidInvoices
    });
  } catch (error) {
    console.error('❌ [AR] Get unpaid invoices error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// @desc    Get payment summary
// ============================================================
const getSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const filter = { companyId: companyId };

    if (startDate && endDate) {
      filter.paymentDate = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const [totalReceived, thisWeek, thisMonth, today, pending] = await Promise.all([
      prisma.paymentReceived.aggregate({ where: filter, _sum: { amount: true } }),
      prisma.paymentReceived.aggregate({
        where: {
          ...filter,
          paymentDate: { gte: new Date(new Date().setDate(new Date().getDate() - new Date().getDay())) }
        },
        _sum: { amount: true }
      }),
      prisma.paymentReceived.aggregate({
        where: { ...filter, paymentDate: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
        _sum: { amount: true }
      }),
      prisma.paymentReceived.aggregate({
        where: {
          ...filter,
          paymentDate: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) }
        },
        _sum: { amount: true }
      }),
      prisma.paymentReceived.count({ where: { ...filter, status: 'Pending' } })
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalReceived: totalReceived._sum.amount || 0,
        thisWeek: thisWeek._sum.amount || 0,
        thisMonth: thisMonth._sum.amount || 0,
        today: today._sum.amount || 0,
        pending,
        byMethod: await PaymentReceived.getByMethod(userId)
      }
    });
  } catch (error) {
    console.error('❌ [AR] Get summary error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Helper: Reverse journal entry on payment deletion ──────────
async function reversePaymentJournalEntry(payment, userId, tx) {
  const journalEntry = await tx.journalEntry.findFirst({
    where: { reference: payment.paymentNumber, description: { contains: 'Payment received' } },
    include: { lines: true }
  });

  if (!journalEntry) return null;

  const reversalEntry = await tx.journalEntry.create({
    data: {
      entryNumber: `REV-${Date.now()}`,
      date: new Date(),
      description: `Reverse payment ${payment.paymentNumber}`,
      reference: `REV-${payment.id}`,
      status: 'Posted',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      lines: {
        create: journalEntry.lines.map(line => ({
          accountId: line.accountId,
          accountName: line.accountName,
          accountCode: line.accountCode,
          debit: line.credit,
          credit: line.debit,
          isReconciled: false
        }))
      }
    }
  });

  const debitLine = journalEntry.lines.find(line => line.debit > 0);
  if (debitLine) {
    await tx.chartOfAccount.update({
      where: { id: debitLine.accountId },
      data: { currentBalance: { decrement: payment.amount } }
    });
  }

  const creditLine = journalEntry.lines.find(line => line.credit > 0);
  if (creditLine) {
    await tx.chartOfAccount.update({
      where: { id: creditLine.accountId },
      data: { currentBalance: { increment: payment.amount } }
    });
  }

  return reversalEntry;
}

// ============================================================
// @desc    DELETE payment (with reversal)
// ============================================================
const deletePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const payment = await prisma.paymentReceived.findFirst({
      where: { id, companyId: companyId},
      include: { customer: true }
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    // ─── Fiscal year guard ─────────────────────────────────────────
    try {
      await fiscalYearGuard(userId, payment.paymentDate);
    } catch (err) {
      if (err.code === 'FISCAL_YEAR_CLOSED') {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }

    await prisma.$transaction(async (tx) => {
      await reversePaymentJournalEntry(payment, userId, tx);

      const invoice = await tx.warehouseInvoice.findUnique({ where: { id: payment.invoiceId } });

      if (invoice) {
        const newPaidAmount = invoice.paidAmount - payment.amount;
        const newStatus = newPaidAmount <= 0 ? 'Unpaid' : 'Partial';

        await tx.warehouseInvoice.update({
          where: { id: invoice.id },
          data: { paidAmount: newPaidAmount, invoiceStatus: newStatus }
        });
      }

      await tx.paymentReceived.delete({ where: { id } });
    });

    res.status(200).json({ success: true, message: 'Payment deleted and journal entry reversed successfully' });
  } catch (error) {
    console.error('❌ [AR] Delete payment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// @desc    Clear cheque payment
// ============================================================
const clearChequePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const payment = await prisma.paymentReceived.findFirst({ where: { id, companyId: companyId} });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    if (payment.status === 'Cleared') {
      return res.status(400).json({ success: false, message: 'Payment already cleared' });
    }

    if (payment.paymentMethod !== 'Cheque') {
      return res.status(400).json({ success: false, message: 'Only cheque payments can be cleared' });
    }

    const updated = await PaymentReceived.updateStatus(id, 'Cleared', userId);

    res.status(200).json({ success: true, message: 'Cheque payment cleared successfully', data: updated });
  } catch (error) {
    console.error('❌ [AR] Clear cheque error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  recordPayment,
  getPayments,
  getPayment,
  getUnpaidInvoices,
  getSummary,
  deletePayment,
  clearChequePayment
};