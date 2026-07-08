// warehouse/models/SalesPaymentReceived.js - COMPLETE

const prisma = require('../../prisma/client');

// ─── Generate Payment Number ──────────────────────────────
function generatePaymentNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `SP-${year}${month}${day}-${random}`;
}

// ─── Helper: Find AR Account (same as SalesInvoice.js) ───────
// userId aur createdBy dono se try karta hai, code aur name dono se
async function findARAccount(tx, userId) {
  // First try: userId field se (payment model convention)
  let account = await tx.chartOfAccount.findFirst({
    where: {
      userId: userId,
      isActive: true,
      OR: [
        { code: '1200' },
        { name: { contains: 'Accounts Receivable', mode: 'insensitive' } }
      ]
    }
  });

  // Second try: createdBy field se (invoice model convention)
  if (!account) {
    account = await tx.chartOfAccount.findFirst({
      where: {
        createdBy: userId,
        isActive: true,
        OR: [
          { code: '1200' },
          { name: { contains: 'Accounts Receivable', mode: 'insensitive' } }
        ]
      }
    });
  }

  return account;
}

// ─── Helper: Find Cash/Bank Account for journal entry ────────
async function findCashAccount(tx, userId) {
  // userId se try
  let account = await tx.chartOfAccount.findFirst({
    where: {
      userId: userId,
      isActive: true,
      OR: [
        { code: '1100' },
        { name: { contains: 'Cash', mode: 'insensitive' } }
      ]
    }
  });

  // createdBy se try
  if (!account) {
    account = await tx.chartOfAccount.findFirst({
      where: {
        createdBy: userId,
        isActive: true,
        OR: [
          { code: '1100' },
          { name: { contains: 'Cash', mode: 'insensitive' } }
        ]
      }
    });
  }

  return account;
}

class SalesPaymentReceivedModel {
  // ============================================================
  // GET CUSTOMER INVOICES (Unpaid & Partially Paid)
  // ============================================================
  static async getCustomerInvoices(customerId, userId) {
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        customerId: customerId,
        userId: userId,
        isActive: true,
        isDeleted: false,
        invoiceStatus: {
          in: ['Posted', 'Partially Paid']
        },
        outstanding: {
          gt: 0
        }
      },
      orderBy: {
        invoiceDate: 'asc'
      },
      include: {
        items: true
      }
    });

    return invoices;
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
        createdBy
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
          userId: userId,
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
            userId: userId,
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
            userId: userId,
            isActive: true,
            isDeleted: false,
            invoiceStatus: {
              in: ['Posted', 'Partially Paid']
            }
          }
        });

        if (!invoice) {
          throw new Error(`Invoice ${inv.invoiceNumber} not found or cannot be paid`);
        }

        if (invoice.outstanding <= 0) {
          throw new Error(`Invoice ${inv.invoiceNumber} is already fully paid`);
        }

        if (inv.amountPaid > invoice.outstanding) {
          throw new Error(
            `Amount ${inv.amountPaid} exceeds outstanding amount ${invoice.outstanding} for invoice ${inv.invoiceNumber}`
          );
        }

        totalPaidAmount += inv.amountPaid;
        validatedInvoices.push({
          invoice,
          amountPaid: inv.amountPaid
        });
      }

      // ─── Validate Total Amount ──────────────────────────
      if (Math.abs(totalPaidAmount - amount) > 0.01) {
        throw new Error('Total paid amount does not match invoice amounts');
      }

      // ─── Get AR Account ───────────────────────────────────
      // ✅ FIXED: name-based fallback + userId/createdBy dual search
      const arAccount = await findARAccount(tx, userId);

      if (!arAccount) {
        throw new Error(
          'Accounts Receivable account not found. ' +
          'Please create an account with code "1200" or name "Accounts Receivable" in Chart of Accounts.'
        );
      }

      // ─── Get Bank Account ────────────────────────────────
      let bankAccount = null;
      if (bankAccountId) {
        bankAccount = await tx.bankAccount.findFirst({
          where: {
            id: bankAccountId,
            userId: userId,
            status: 'Active'
          }
        });

        if (!bankAccount) {
          throw new Error('Bank account not found');
        }
      }

      // ─── Resolve Debit Account for Journal Entry ─────────
      // Bank account linked hoga to uska GL account use karo,
      // warna Cash account dhundo, warna AR account fallback
      let debitAccountId = arAccount.id;
      let debitAccountName = 'Cash';
      let debitAccountCode = '1100';

      if (bankAccount) {
        // Bank account ke saath linked GL account ho sakta hai
        if (bankAccount.chartOfAccountId) {
          const bankGLAccount = await tx.chartOfAccount.findUnique({
            where: { id: bankAccount.chartOfAccountId }
          });
          if (bankGLAccount) {
            debitAccountId = bankGLAccount.id;
            debitAccountName = bankGLAccount.name;
            debitAccountCode = bankGLAccount.code;
          }
        } else {
          // Bank account name/code directly use karo
          debitAccountName = bankAccount.accountName || 'Bank Account';
          debitAccountCode = bankAccount.accountCode || '1110';
          debitAccountId = arAccount.id; // fallback, journal mein account link chahiye
        }
      } else {
        // Cash payment — Cash account dhundo
        const cashAccount = await findCashAccount(tx, userId);
        if (cashAccount) {
          debitAccountId = cashAccount.id;
          debitAccountName = cashAccount.name;
          debitAccountCode = cashAccount.code;
        }
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
          userId: userId,
          lines: {
            create: [
              // Debit: Bank/Cash Account
              {
                accountId: debitAccountId,
                accountName: debitAccountName,
                accountCode: debitAccountCode,
                debit: amount,
                credit: 0
              },
              // Credit: Accounts Receivable
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
          userId: userId,
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
      for (const inv of validatedInvoices) {
        const invoice = inv.invoice;
        const newPaidAmount = invoice.paidAmount + inv.amountPaid;
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
            outstanding: newOutstanding,
            invoiceStatus: invoiceStatus,
            paymentStatus: newOutstanding <= 0 ? 'Paid' : 'Partial'
          }
        });

        // ─── Update Accounts Receivable ─────────────────────
        await tx.accountsReceivable.updateMany({
          where: { invoiceId: invoice.id },
          data: {
            paidAmount: newPaidAmount,
            outstanding: newOutstanding,
            status: newOutstanding <= 0 ? 'Paid' : 'Current'
          }
        });
      }

      // ─── Update Customer Outstanding Balance ─────────────
      const totalOutstanding = await tx.salesInvoice.aggregate({
        where: {
          customerId: customerId,
          userId: userId,
          isActive: true,
          isDeleted: false,
          invoiceStatus: {
            in: ['Posted', 'Partially Paid']
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
  static async getStats(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const baseFilter = {
      isActive: true,
      isDeleted: false,
      userId: userId
    };

    const todayPayments = await prisma.salesPaymentReceived.count({
      where: {
        ...baseFilter,
        paymentDate: { gte: today }
      }
    });

    const todayAmount = await prisma.salesPaymentReceived.aggregate({
      where: {
        ...baseFilter,
        paymentDate: { gte: today }
      },
      _sum: { amount: true }
    });

    const monthPayments = await prisma.salesPaymentReceived.count({
      where: {
        ...baseFilter,
        paymentDate: { gte: startOfMonth }
      }
    });

    const monthAmount = await prisma.salesPaymentReceived.aggregate({
      where: {
        ...baseFilter,
        paymentDate: { gte: startOfMonth }
      },
      _sum: { amount: true }
    });

    return {
      today: {
        count: todayPayments,
        amount: todayAmount._sum.amount || 0
      },
      month: {
        count: monthPayments,
        amount: monthAmount._sum.amount || 0
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
              invoice: true
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
      for (const invPayment of payment.invoicePayments) {
        const invoice = invPayment.invoice;
        const newPaidAmount = invoice.paidAmount - invPayment.amountPaid;
        const newOutstanding = invoice.grandTotal - newPaidAmount;

        let invoiceStatus = invoice.invoiceStatus;
        if (newPaidAmount <= 0) {
          invoiceStatus = 'Posted';
        } else if (newPaidAmount > 0) {
          invoiceStatus = 'Partially Paid';
        }

        await tx.salesInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: newPaidAmount,
            outstanding: newOutstanding,
            invoiceStatus: invoiceStatus,
            paymentStatus: newPaidAmount <= 0 ? 'Unpaid' : 'Partial'
          }
        });

        await tx.accountsReceivable.updateMany({
          where: { invoiceId: invoice.id },
          data: {
            paidAmount: newPaidAmount,
            outstanding: newOutstanding,
            status: newOutstanding <= 0 ? 'Paid' : 'Current'
          }
        });
      }

      // ─── Reverse Journal Entry ─────────────────────────────
      if (payment.journalEntry) {
        const reverseEntryNumber = `REV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

        await tx.journalEntry.create({
          data: {
            entryNumber: reverseEntryNumber,
            date: new Date(),
            description: `Reversal of payment #${payment.paymentNumber}`,
            reference: payment.paymentNumber,
            status: 'Posted',
            createdBy: userId,
            postedBy: userId,
            postedAt: new Date(),
            userId: payment.userId,
            lines: {
              create: payment.journalEntry.lines.map(line => ({
                accountId: line.accountId,
                accountName: line.accountName,
                accountCode: line.accountCode,
                debit: line.credit,
                credit: line.debit
              }))
            }
          }
        });
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
          userId: payment.userId,
          isActive: true,
          isDeleted: false,
          invoiceStatus: {
            in: ['Posted', 'Partially Paid']
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
          updatedBy: userId
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