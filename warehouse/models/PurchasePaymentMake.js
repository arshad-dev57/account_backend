// warehouse/models/PurchasePaymentMake.js - COMPLETE

const prisma = require('../../prisma/client');

// ─── Generate Payment Number ──────────────────────────────
function generatePaymentNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PP-${year}${month}${day}-${random}`;
}

// ─── Helper: Find AP Account ──────────────────────────────
// userId aur createdBy dono se try karta hai, code aur name dono se
async function findAPAccount(tx, userId) {
  // First try: userId field se (payment model convention)
  let account = await tx.chartOfAccount.findFirst({
    where: {
      userId: userId,
      isActive: true,
      OR: [
        { code: '2000' },
        { name: { contains: 'Accounts Payable', mode: 'insensitive' } }
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
          { code: '2000' },
          { name: { contains: 'Accounts Payable', mode: 'insensitive' } }
        ]
      }
    });
  }

  return account;
}

// ─── Helper: Find Cash/Bank Account for journal entry ────
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

class PurchasePaymentMakeModel {
  // ============================================================
  // GET SUPPLIER INVOICES (Unpaid & Partially Paid)
  // ============================================================
  static async getSupplierInvoices(supplierId, userId) {
    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        supplierId: supplierId,
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
        items: true,
        supplier: true
      }
    });

    return invoices;
  }

  // ============================================================
  // MAKE PAYMENT AGAINST INVOICES
  // ============================================================
  static async makePayment(data) {
    const paymentNumber = generatePaymentNumber();

    return await prisma.$transaction(async (tx) => {
      const {
        supplierId,
        supplierName,
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
      if (!supplierId) {
        throw new Error('Supplier is required');
      }

      if (!invoicePayments || invoicePayments.length === 0) {
        throw new Error('At least one invoice must be selected');
      }

      if (!amount || amount <= 0) {
        throw new Error('Payment amount must be greater than 0');
      }

      // ─── Validate Supplier ──────────────────────────────
      const supplier = await tx.supplier.findFirst({
        where: {
          id: supplierId,
          userId: userId,
          status: 'active'
        }
      });

      if (!supplier) {
        throw new Error('Supplier not found');
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

        // ─── Check Bank Account Balance ────────────────────
        if (bankAccount.currentBalance < amount) {
          throw new Error(
            `Insufficient balance in bank account. Available: ${bankAccount.currentBalance}, Required: ${amount}`
          );
        }
      }

      // ─── Validate Invoices ──────────────────────────────
      let totalPaidAmount = 0;
      const validatedInvoices = [];

      for (const inv of invoicePayments) {
        const invoice = await tx.purchaseInvoice.findFirst({
          where: {
            id: inv.invoiceId,
            supplierId: supplierId,
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

      // ─── Get AP Account ───────────────────────────────────
      const apAccount = await findAPAccount(tx, userId);

      if (!apAccount) {
        throw new Error(
          'Accounts Payable account not found. ' +
          'Please create an account with code "2000" or name "Accounts Payable" in Chart of Accounts.'
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

      // ─── Resolve Credit Account for Journal Entry ────────
      // Bank account linked hoga to uska GL account use karo,
      // warna Cash account dhundo, warna AP account fallback
      let creditAccountId = apAccount.id;
      let creditAccountName = 'Cash';
      let creditAccountCode = '1100';

      if (bankAccount) {
        // Bank account ke saath linked GL account ho sakta hai
        if (bankAccount.chartOfAccountId) {
          const bankGLAccount = await tx.chartOfAccount.findUnique({
            where: { id: bankAccount.chartOfAccountId }
          });
          if (bankGLAccount) {
            creditAccountId = bankGLAccount.id;
            creditAccountName = bankGLAccount.name;
            creditAccountCode = bankGLAccount.code;
          }
        } else {
          // Bank account name/code directly use karo
          creditAccountName = bankAccount.accountName || 'Bank Account';
          creditAccountCode = bankAccount.accountCode || '1110';
          creditAccountId = apAccount.id; // fallback, journal mein account link chahiye
        }
      } else {
        // Cash payment — Cash account dhundo
        const cashAccount = await findCashAccount(tx, userId);
        if (cashAccount) {
          creditAccountId = cashAccount.id;
          creditAccountName = cashAccount.name;
          creditAccountCode = cashAccount.code;
        }
      }

      // ─── Create Journal Entry ────────────────────────────
      const entryNumber = `JE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      const journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber,
          date: new Date(),
          description: `Purchase payment made to ${supplier.name} (${paymentNumber})`,
          reference: paymentNumber,
          status: 'Posted',
          createdBy: createdBy,
          postedBy: createdBy,
          postedAt: new Date(),
          userId: userId,
          lines: {
            create: [
              // Debit: Accounts Payable
              {
                accountId: apAccount.id,
                accountName: apAccount.name,
                accountCode: apAccount.code,
                debit: amount,
                credit: 0
              },
              // Credit: Bank/Cash Account
              {
                accountId: creditAccountId,
                accountName: creditAccountName,
                accountCode: creditAccountCode,
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

      // ─── Get AP Record for first invoice ─────────────────
      const firstInvoice = validatedInvoices[0].invoice;
      const apRecord = await tx.accountsPayable.findFirst({
        where: {
          invoiceId: firstInvoice.id
        }
      });

      // ─── Create Payment Record ───────────────────────────
      const payment = await tx.purchasePaymentMake.create({
        data: {
          paymentNumber,
          paymentDate: new Date(),
          supplierId: supplierId,
          supplierName: supplier.name,
          amount: amount,
          paymentMethod: paymentMethod || 'Cash',
          reference: reference || '',
          bankAccountId: bankAccount?.id || null,
          bankAccountName: bankAccount?.accountName || 'Cash',
          notes: notes || '',
          status: 'Completed',
          journalEntryId: journalEntry.id,
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
          supplier: true,
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

        await tx.purchaseInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: newPaidAmount,
            outstanding: newOutstanding,
            invoiceStatus: invoiceStatus,
            paymentStatus: newOutstanding <= 0 ? 'Paid' : 'Partial'
          }
        });

        // ─── Update Accounts Payable ────────────────────────
        await tx.accountsPayable.updateMany({
          where: { invoiceId: invoice.id },
          data: {
            paidAmount: newPaidAmount,
            outstanding: newOutstanding,
            status: newOutstanding <= 0 ? 'Paid' : 'Current'
          }
        });
      }

      // ─── Update Bank Account Balance (DECREASE) ──────────
      if (bankAccountId) {
        await tx.bankAccount.update({
          where: { id: bankAccountId },
          data: {
            currentBalance: {
              decrement: amount
            }
          }
        });
      }

      // ─── Update Supplier Outstanding Balance ─────────────
      // We need to update supplier's outstanding balance
      // This could be stored in a supplier field or calculated on the fly
      // For now, we'll update it if the supplier has a balance field
      try {
        const totalOutstanding = await tx.purchaseInvoice.aggregate({
          where: {
            supplierId: supplierId,
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

        // If supplier has an outstandingBalance field (you may need to add it)
        // For now, we'll skip this as it's not in the current schema
        // You can add it if needed
      } catch (error) {
        // Supplier outstanding balance field may not exist
        // Skip gracefully
      }

      return payment;
    });
  }

  // ============================================================
  // GET PAYMENT BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.purchasePaymentMake.findUnique({
      where: { id },
      include: {
        invoicePayments: {
          include: {
            invoice: {
              include: {
                items: true,
                supplier: true
              }
            }
          }
        },
        supplier: true,
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
    return await prisma.purchasePaymentMake.findUnique({
      where: { paymentNumber },
      include: {
        invoicePayments: {
          include: {
            invoice: true
          }
        },
        supplier: true,
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

    return await prisma.purchasePaymentMake.findMany({
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
              select: { 
                id: true, 
                invoiceNumber: true, 
                grandTotal: true, 
                outstanding: true,
                supplierInvoiceNo: true
              }
            }
          }
        },
        supplier: true,
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
    return await prisma.purchasePaymentMake.count({
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

    const todayPayments = await prisma.purchasePaymentMake.count({
      where: {
        ...baseFilter,
        paymentDate: { gte: today }
      }
    });

    const todayAmount = await prisma.purchasePaymentMake.aggregate({
      where: {
        ...baseFilter,
        paymentDate: { gte: today }
      },
      _sum: { amount: true }
    });

    const monthPayments = await prisma.purchasePaymentMake.count({
      where: {
        ...baseFilter,
        paymentDate: { gte: startOfMonth }
      }
    });

    const monthAmount = await prisma.purchasePaymentMake.aggregate({
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
      const payment = await tx.purchasePaymentMake.findUnique({
        where: { id },
        include: {
          invoicePayments: {
            include: {
              invoice: true
            }
          },
          supplier: true,
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

        await tx.purchaseInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: newPaidAmount,
            outstanding: newOutstanding,
            invoiceStatus: invoiceStatus,
            paymentStatus: newPaidAmount <= 0 ? 'Unpaid' : 'Partial'
          }
        });

        await tx.accountsPayable.updateMany({
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

      // ─── Update Bank Account Balance (INCREASE back) ──────
      if (payment.bankAccountId) {
        await tx.bankAccount.update({
          where: { id: payment.bankAccountId },
          data: {
            currentBalance: {
              increment: payment.amount
            }
          }
        });
      }

      // ─── Update Payment Status ─────────────────────────────
      const cancelledPayment = await tx.purchasePaymentMake.update({
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
          supplier: true,
          bankAccount: true
        }
      });

      return cancelledPayment;
    });
  }

  // ============================================================
  // PRINT PAYMENT VOUCHER DATA
  // ============================================================
  static async getVoucherData(id) {
    const payment = await prisma.purchasePaymentMake.findUnique({
      where: { id },
      include: {
        invoicePayments: {
          include: {
            invoice: {
              include: {
                items: true,
                supplier: true
              }
            }
          }
        },
        supplier: true,
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

    if (!payment) {
      throw new Error('Payment not found');
    }

    // Calculate total invoice amounts
    const invoiceTotal = payment.invoicePayments.reduce(
      (sum, inv) => sum + inv.invoice.grandTotal,
      0
    );

    return {
      payment,
      invoiceTotal,
      totalPaid: payment.amount,
      invoiceCount: payment.invoicePayments.length
    };
  }
}

module.exports = PurchasePaymentMakeModel;