// warehouse/models/SalesPaymentReceived.js - COMPLETE WITH AUTO-CREATE

const prisma = require('../../prisma/client');
const BalanceCalculator = require('../../utils/balanceCalculator');

// ─── Generate Payment Number ──────────────────────────────
function generatePaymentNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `SP-${year}${month}${day}-${random}`;
}

// ─── Helper: Find or Create AR Account ───────────────────────
async function findOrCreateARAccount(tx, companyId, userId) {
  // First try to find existing account
  let account = await tx.chartOfAccount.findFirst({
    where: {
      companyId: companyId,
      isActive: true,
      OR: [
        { code: '1200' },
        { name: { contains: 'Accounts Receivable', mode: 'insensitive' } }
      ]
    }
  });

  // If not found, create it
  if (!account) {
    account = await tx.chartOfAccount.create({
      data: {
        code: '1200',
        name: 'Accounts Receivable',
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Debit',
        description: 'Accounts Receivable - Money owed by customers',
        isActive: true,
        createdBy: userId || 'SYSTEM',
        companyId: companyId
      }
    });
    console.log('✅ Created Accounts Receivable account');
  }

  return account;
}

// ─── Helper: Find or Create Cash Account ──────────────────────
async function findOrCreateCashAccount(tx, companyId, userId) {
  // First try to find existing account
  let account = await tx.chartOfAccount.findFirst({
    where: {
      companyId: companyId,
      isActive: true,
      OR: [
        { code: '1100' },
        { name: { contains: 'Cash', mode: 'insensitive' } }
      ]
    }
  });

  // If not found, create it
  if (!account) {
    account = await tx.chartOfAccount.create({
      data: {
        code: '1100',
        name: 'Cash',
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Debit',
        description: 'Cash on hand',
        isActive: true,
        createdBy: userId || 'SYSTEM',
        companyId: companyId
      }
    });
    console.log('✅ Created Cash account');
  }

  return account;
}

class SalesPaymentReceivedModel {
  // ============================================================
  // GET CUSTOMER INVOICES (Unpaid & Partially Paid)
  // ============================================================
  static async getCustomerInvoices(customerId, companyId) {
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        customerId: customerId,
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        invoiceStatus: {
          notIn: ['Paid', 'Cancelled']
        }
      },
      orderBy: {
        invoiceDate: 'asc'
      },
      include: {
        items: true,
        invoicePayments: {
          where: {
            payment: {
              isActive: true,
              isDeleted: false,
              status: 'Completed'
            }
          }
        }
      }
    });

    const invoicesWithOutstanding = invoices.map(invoice => {
      const totalPaid = invoice.invoicePayments?.reduce((sum, ip) => sum + ip.amountPaid, 0) || 0;
      const outstanding = invoice.grandTotal - totalPaid;
      
      return {
        ...invoice,
        paidAmount: totalPaid,
        outstanding: Math.max(0, outstanding)
      };
    });

    return invoicesWithOutstanding.filter(inv => inv.outstanding > 0);
  }

  // ============================================================
  // RECEIVE PAYMENT AGAINST INVOICES
  // ============================================================
  static async receivePayment(data) {
    const paymentNumber = generatePaymentNumber();

    return await prisma.$transaction(async (tx) => {
      const {
        customerId,
        customerName,
        amount,
        paymentMethod,
        bankAccountId,
        bankAccountName,
        reference,
        notes,
        invoicePayments,
        userId,
        createdBy,
        companyId
      } = data;

      // ─── Validation ──────────────────────────────────────
      if (!customerId) {
        throw new Error('Customer is required');
      }

      if (!invoicePayments || invoicePayments.length === 0) {
        throw new Error('At least one invoice must be selected');
      }

      if (!amount || amount <= 0) {
        throw new Error('Payment amount must be greater than 0');
      }

      // ─── Validate Customer ──────────────────────────────
      const customer = await tx.customer.findFirst({
        where: {
          id: customerId,
          companyId: companyId,
          isActive: true,
          isDeleted: false
        }
      });

      if (!customer) {
        throw new Error('Customer not found');
      }

      // ─── Validate Bank Account ──────────────────────────
      if (paymentMethod === 'Bank Transfer' || paymentMethod === 'Cheque') {
        if (!bankAccountId) {
          throw new Error('Bank account is required for this payment method');
        }

        const bankAccount = await tx.bankAccount.findFirst({
          where: {
            id: bankAccountId,
            companyId: companyId,
            status: 'Active'
          }
        });

        if (!bankAccount) {
          throw new Error('Bank account not found');
        }
      }

      // ─── Validate Invoices ──────────────────────────────
      let totalPaidAmount = 0;
      const validatedInvoices = [];

      for (const inv of invoicePayments) {
        const invoice = await tx.salesInvoice.findFirst({
          where: {
            id: inv.invoiceId,
            customerId: customerId,
            companyId: companyId,
            isActive: true,
            isDeleted: false,
            invoiceStatus: {
              notIn: ['Paid', 'Cancelled']
            }
          },
          include: {
            invoicePayments: {
              where: {
                payment: {
                  isActive: true,
                  isDeleted: false,
                  status: 'Completed'
                }
              }
            }
          }
        });

        if (!invoice) {
          throw new Error(`Invoice ${inv.invoiceNumber} not found or cannot be paid`);
        }

        const totalPaid = invoice.invoicePayments?.reduce((sum, ip) => sum + ip.amountPaid, 0) || 0;
        const currentOutstanding = invoice.grandTotal - totalPaid;

        if (currentOutstanding <= 0) {
          throw new Error(`Invoice ${inv.invoiceNumber} is already fully paid`);
        }

        if (inv.amountPaid > currentOutstanding) {
          throw new Error(
            `Amount ${inv.amountPaid} exceeds outstanding amount ${currentOutstanding} for invoice ${inv.invoiceNumber}`
          );
        }

        totalPaidAmount += inv.amountPaid;
        validatedInvoices.push({
          invoice,
          amountPaid: inv.amountPaid,
          currentOutstanding,
          totalPaid
        });
      }

      // ─── Validate Total Amount ──────────────────────────
      if (Math.abs(totalPaidAmount - amount) > 0.01) {
        throw new Error('Total paid amount does not match invoice amounts');
      }

      // ─── Get or Create AR Account ─────────────────────────
      // ✅ Auto-creates if not found
      const arAccount = await findOrCreateARAccount(tx, companyId, userId);

      // ─── Get or Create Cash Account ────────────────────────
      // ✅ Auto-creates if not found
      const cashAccount = await findOrCreateCashAccount(tx, companyId, userId);

      // ─── Get Bank Account ────────────────────────────────
      let bankAccount = null;
      if (bankAccountId) {
        bankAccount = await tx.bankAccount.findFirst({
          where: {
            id: bankAccountId,
            companyId: companyId,
            status: 'Active'
          }
        });

        if (!bankAccount) {
          throw new Error('Bank account not found');
        }
      }

      // ─── Resolve Debit Account for Journal Entry ─────────
      let debitAccountId = arAccount.id;
      let debitAccountName = 'Cash';
      let debitAccountCode = '1100';

      if (bankAccount) {
        if (bankAccount.chartOfAccountId) {
          const bankGLAccount = await tx.chartOfAccount.findUnique({
            where: { id: bankAccount.chartOfAccountId }
          });
          if (bankGLAccount) {
            debitAccountId = bankGLAccount.id;
            debitAccountName = bankGLAccount.name;
            debitAccountCode = bankGLAccount.code;
          } else {
            debitAccountId = cashAccount.id;
            debitAccountName = cashAccount.name;
            debitAccountCode = cashAccount.code;
          }
        } else {
          // Bank has no linked GL — fall back to Cash (never debit AR)
          debitAccountId = cashAccount.id;
          debitAccountName = cashAccount.name;
          debitAccountCode = cashAccount.code;
        }
      } else {
        debitAccountId = cashAccount.id;
        debitAccountName = cashAccount.name;
        debitAccountCode = cashAccount.code;
      }

      // ─── Create Journal Entry ────────────────────────────
      const entryNumber = `JE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      const journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber,
          date: new Date(),
          description: `Sales payment received from ${customer.name} (${paymentNumber})`,
          reference: paymentNumber,
          status: 'Posted',
          createdBy: createdBy,
          postedBy: createdBy,
          postedAt: new Date(),
          companyId: companyId,
          fiscalYearId: data.fiscalYearId,
          lines: {
            create: [
              {
                accountId: debitAccountId,
                accountName: debitAccountName,
                accountCode: debitAccountCode,
                debit: amount,
                credit: 0
              },
              {
                accountId: arAccount.id,
                accountName: arAccount.name,
                accountCode: arAccount.code,
                debit: 0,
                credit: amount
              }
            ]
          }
        },
        include: {
          lines: {
            include: {
              account: true
            }
          }
        }
      });

      // Keep Chart of Accounts balances in sync with the JE
      await BalanceCalculator.applyJournalLines(tx, journalEntry.lines);

      // ─── Get AR Record for first invoice ─────────────────
      const firstInvoice = validatedInvoices[0].invoice;
      const arRecord = await tx.accountsReceivable.findFirst({
        where: {
          invoiceId: firstInvoice.id
        }
      });

      // ─── Create Payment Record ───────────────────────────
      const payment = await tx.salesPaymentReceived.create({
        data: {
          paymentNumber,
          paymentDate: new Date(),
          customerId: customerId,
          customerName: customer.name,
          amount: amount,
          paymentMethod: paymentMethod || 'Cash',
          reference: reference || '',
          bankAccountId: bankAccount?.id || null,
          bankAccountName: bankAccount?.accountName || 'Cash',
          notes: notes || '',
          status: 'Completed',
          journalEntryId: journalEntry.id,
          arRecordId: arRecord?.id || null,
          createdBy: createdBy,
          companyId: companyId,
          fiscalYearId: data.fiscalYearId,
          invoicePayments: {
            create: invoicePayments.map(inv => ({
              invoiceId: inv.invoiceId,
              invoiceNumber: inv.invoiceNumber,
              amountPaid: inv.amountPaid
            }))
          }
        },
        include: {
          invoicePayments: {
            include: {
              invoice: true
            }
          },
          customer: true,
          bankAccount: true,
          journalEntry: {
            include: {
              lines: {
                include: {
                  account: true
                }
              }
            }
          }
        }
      });

      // ─── Update Each Invoice ─────────────────────────────
      const orderIdsToSync = new Set();
      for (const inv of validatedInvoices) {
        const invoice = inv.invoice;
        const newPaidAmount = inv.totalPaid + inv.amountPaid;
        const newOutstanding = invoice.grandTotal - newPaidAmount;

        let invoiceStatus = invoice.invoiceStatus;
        if (newOutstanding <= 0) {
          invoiceStatus = 'Paid';
        } else if (newPaidAmount > 0) {
          invoiceStatus = 'Partially Paid';
        }

        await tx.salesInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: newPaidAmount,
            outstanding: Math.max(0, newOutstanding),
            invoiceStatus: invoiceStatus,
            paymentStatus: newOutstanding <= 0 ? 'Paid' : 'Partial'
          }
        });

        await tx.accountsReceivable.updateMany({
          where: { invoiceId: invoice.id },
          data: {
            paidAmount: newPaidAmount,
            outstanding: Math.max(0, newOutstanding),
            status: newOutstanding <= 0 ? 'Paid' : 'Current'
          }
        });

        if (invoice.orderId) {
          orderIdsToSync.add(invoice.orderId);
        }
      }

      // ─── Sync linked sales orders (payment + lift Draft) ──
      const Order = require('./Order');
      for (const orderId of orderIdsToSync) {
        await Order.syncFromInvoices(orderId, tx);
      }

      // ─── Update Customer Outstanding Balance ─────────────
      const totalOutstanding = await tx.salesInvoice.aggregate({
        where: {
          customerId: customerId,
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          invoiceStatus: {
            notIn: ['Paid', 'Cancelled']
          }
        },
        _sum: {
          outstanding: true
        }
      });

      await tx.customer.update({
        where: { id: customerId },
        data: {
          outstandingBalance: totalOutstanding._sum.outstanding || 0
        }
      });

      // ─── Update Bank Account Balance ─────────────────────
      if (bankAccountId) {
        await tx.bankAccount.update({
          where: { id: bankAccountId },
          data: {
            currentBalance: {
              increment: amount
            }
          }
        });
      }

      return payment;
    });
  }

  // ============================================================
  // GET PAYMENT BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.salesPaymentReceived.findUnique({
      where: { id },
      include: {
        invoicePayments: {
          include: {
            invoice: {
              include: {
                items: true
              }
            }
          }
        },
        customer: true,
        bankAccount: true,
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // GET PAYMENT BY NUMBER
  // ============================================================
  static async findByPaymentNumber(paymentNumber) {
    return await prisma.salesPaymentReceived.findUnique({
      where: { paymentNumber },
      include: {
        invoicePayments: {
          include: {
            invoice: true
          }
        },
        customer: true,
        bankAccount: true,
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        }
      }
    });
  }

  // ============================================================
  // GET ALL PAYMENTS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { paymentDate: 'desc' } } = options;

    return await prisma.salesPaymentReceived.findMany({
      where: {
        ...filter,
        isActive: true,
        isDeleted: false
      },
      skip,
      take,
      orderBy,
      include: {
        invoicePayments: {
          include: {
            invoice: {
              select: { id: true, invoiceNumber: true, grandTotal: true, outstanding: true }
            }
          }
        },
        customer: true,
        bankAccount: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // COUNT PAYMENTS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.salesPaymentReceived.count({
      where: {
        ...filter,
        isActive: true,
        isDeleted: false
      }
    });
  }

  // ============================================================
  // GET PAYMENT STATS
  // ============================================================
  static async getStats(companyId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const baseFilter = {
      isActive: true,
      isDeleted: false,
      companyId: companyId
    };

    const [todayPayments, todayAmount, monthPayments, monthAmount, totalPayments, totalAmount] = await Promise.all([
      prisma.salesPaymentReceived.count({
        where: {
          ...baseFilter,
          paymentDate: { gte: today }
        }
      }),
      prisma.salesPaymentReceived.aggregate({
        where: {
          ...baseFilter,
          paymentDate: { gte: today }
        },
        _sum: { amount: true }
      }),
      prisma.salesPaymentReceived.count({
        where: {
          ...baseFilter,
          paymentDate: { gte: startOfMonth }
        }
      }),
      prisma.salesPaymentReceived.aggregate({
        where: {
          ...baseFilter,
          paymentDate: { gte: startOfMonth }
        },
        _sum: { amount: true }
      }),
      prisma.salesPaymentReceived.count({
        where: baseFilter
      }),
      prisma.salesPaymentReceived.aggregate({
        where: baseFilter,
        _sum: { amount: true }
      })
    ]);

    return {
      today: {
        count: todayPayments || 0,
        amount: todayAmount._sum.amount || 0
      },
      month: {
        count: monthPayments || 0,
        amount: monthAmount._sum.amount || 0
      },
      total: {
        count: totalPayments || 0,
        amount: totalAmount._sum.amount || 0
      }
    };
  }

  // ============================================================
  // CANCEL PAYMENT
  // ============================================================
  static async cancelPayment(id, userId, reason = '') {
    return await prisma.$transaction(async (tx) => {
      const payment = await tx.salesPaymentReceived.findUnique({
        where: { id },
        include: {
          invoicePayments: {
            include: {
              invoice: {
                include: {
                  invoicePayments: {
                    where: {
                      payment: {
                        isActive: true,
                        isDeleted: false,
                        status: 'Completed'
                      }
                    }
                  }
                }
              }
            }
          },
          customer: true,
          bankAccount: true,
          journalEntry: {
            include: {
              lines: true
            }
          }
        }
      });

      if (!payment) {
        throw new Error('Payment not found');
      }

      if (payment.status === 'Cancelled') {
        throw new Error('Payment already cancelled');
      }

      // ─── Reverse Invoice Payments ──────────────────────────
      const orderIdsToSync = new Set();
      for (const invPayment of payment.invoicePayments) {
        const invoice = invPayment.invoice;
        const totalPaid = invoice.invoicePayments?.reduce((sum, ip) => sum + ip.amountPaid, 0) || 0;
        const newPaidAmount = totalPaid - invPayment.amountPaid;
        const newOutstanding = invoice.grandTotal - newPaidAmount;

        let invoiceStatus = invoice.invoiceStatus;
        if (newPaidAmount <= 0) {
          invoiceStatus = 'Posted';
        } else if (newPaidAmount > 0 && newOutstanding > 0) {
          invoiceStatus = 'Partially Paid';
        } else if (newOutstanding <= 0) {
          invoiceStatus = 'Paid';
        }

        await tx.salesInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: Math.max(0, newPaidAmount),
            outstanding: Math.max(0, newOutstanding),
            invoiceStatus: invoiceStatus,
            paymentStatus: newPaidAmount <= 0 ? 'Unpaid' : (newOutstanding <= 0 ? 'Paid' : 'Partial')
          }
        });

        await tx.accountsReceivable.updateMany({
          where: { invoiceId: invoice.id },
          data: {
            paidAmount: Math.max(0, newPaidAmount),
            outstanding: Math.max(0, newOutstanding),
            status: newOutstanding <= 0 ? 'Paid' : 'Current'
          }
        });

        if (invoice.orderId) orderIdsToSync.add(invoice.orderId);
      }

      const Order = require('./Order');
      for (const orderId of orderIdsToSync) {
        await Order.syncFromInvoices(orderId, tx);
      }

      // ─── Reverse Journal Entry ─────────────────────────────
      if (payment.journalEntry) {
        const reverseEntryNumber = `REV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

        const reverseEntry = await tx.journalEntry.create({
          data: {
            entryNumber: reverseEntryNumber,
            date: new Date(),
            description: `Reversal of payment #${payment.paymentNumber}`,
            reference: payment.paymentNumber,
            status: 'Posted',
            createdBy: userId,
            postedBy: userId,
            postedAt: new Date(),
            companyId: payment.companyId,
            fiscalYearId: payment.fiscalYearId,
            lines: {
              create: payment.journalEntry.lines.map(line => ({
                accountId: line.accountId,
                accountName: line.accountName,
                accountCode: line.accountCode,
                debit: line.credit,
                credit: line.debit
              }))
            }
          },
          include: { lines: true }
        });

        await BalanceCalculator.applyJournalLines(tx, reverseEntry.lines);
      }

      // ─── Update Bank Account Balance ──────────────────────
      if (payment.bankAccountId) {
        await tx.bankAccount.update({
          where: { id: payment.bankAccountId },
          data: {
            currentBalance: {
              decrement: payment.amount
            }
          }
        });
      }

      // ─── Update Customer Outstanding Balance ──────────────
      const totalOutstanding = await tx.salesInvoice.aggregate({
        where: {
          customerId: payment.customerId,
          companyId: payment.companyId,
          isActive: true,
          isDeleted: false,
          invoiceStatus: {
            notIn: ['Paid', 'Cancelled']
          }
        },
        _sum: {
          outstanding: true
        }
      });

      await tx.customer.update({
        where: { id: payment.customerId },
        data: {
          outstandingBalance: totalOutstanding._sum.outstanding || 0
        }
      });

      // ─── Update Payment Status ─────────────────────────────
      const cancelledPayment = await tx.salesPaymentReceived.update({
        where: { id },
        data: {
          status: 'Cancelled',
          updatedBy: userId,
          notes: payment.notes ? `${payment.notes}\nCancelled: ${reason || 'No reason'}` : `Cancelled: ${reason || 'No reason'}`
        },
        include: {
          invoicePayments: {
            include: {
              invoice: true
            }
          },
          customer: true,
          bankAccount: true
        }
      });

      return cancelledPayment;
    });
  }
}

module.exports = SalesPaymentReceivedModel;