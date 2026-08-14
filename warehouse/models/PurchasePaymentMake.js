// warehouse/models/PurchasePaymentMake.js - COMPLETE CORRECTED

const prisma = require('../../prisma/client');
const BalanceCalculator = require('../../utils/balanceCalculator');
const { getOrCreateApAccount } = require('../../utils/apAccountHelper');
const { getOrCreateCashAccount } = require('../../utils/cashAccountHelper');

// ─── Generate Payment Number ──────────────────────────────
function generatePaymentNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PP-${year}${month}${day}-${random}`;
}

async function findAPAccount(tx, companyId, userId) {
  return getOrCreateApAccount(userId || 'SYSTEM', companyId, tx);
}

// ─── Helper: Find Bank Account ──────────────────────────────
async function findBankAccount(tx, companyId, bankAccountId) {
  return await tx.bankAccount.findFirst({
    where: {
      id: bankAccountId,
      companyId: companyId,
      status: 'Active'
    }
  });
}

// ─── Helper: Find Cash in Hand (COA 1001) ──────────────────────
async function findCashAccount(tx, companyId, userId) {
  return getOrCreateCashAccount(userId || 'SYSTEM', companyId, tx);
}

class PurchasePaymentMakeModel {
  // ============================================================
  // GET SUPPLIER INVOICES (Unpaid & Partially Paid)
  // ============================================================
  static async getSupplierInvoices(supplierId, companyId, userId = null) {
    const companyScope = companyId
      ? {
          OR: [
            { companyId },
            ...(userId ? [{ companyId: null, createdBy: userId }] : []),
          ]
        }
      : userId
        ? { createdBy: userId }
        : {};

    // Resolve supplier so we can also match invoices by name
    // (avoids empty list when supplierId drifted / duplicates)
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        ...(companyId ? { companyId } : {})
      },
      select: { id: true, name: true }
    });

    const supplierMatch = supplier?.name
      ? {
          OR: [
            { supplierId },
            { supplierName: { equals: supplier.name, mode: 'insensitive' } },
          ]
        }
      : { supplierId };

    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        AND: [
          supplierMatch,
          { isActive: true },
          { isDeleted: false },
          // Only real payable invoices (no Draft)
          {
            invoiceStatus: {
              in: ['Posted', 'Partially Paid']
            }
          },
          {
            paymentStatus: { notIn: ['Paid', 'paid'] }
          },
          companyScope,
        ]
      },
      orderBy: { invoiceDate: 'asc' },
      include: {
        items: true,
        supplier: true
      }
    });

    // Recalculate outstanding so UI always shows remaining balance
    return invoices
      .map((inv) => {
        const outstanding =
          Number(inv.outstanding) > 0
            ? Number(inv.outstanding)
            : Math.max(
                0,
                Number(inv.grandTotal || 0) - Number(inv.paidAmount || 0)
              );
        return {
          ...inv,
          outstanding,
          payable: outstanding > 0
        };
      })
      .filter((inv) => inv.outstanding > 0);
  }

  // ============================================================
  // MAKE PAYMENT AGAINST INVOICES - ✅ FIXED
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
        createdBy,
        companyId,
        fiscalYearId
      } = data;

      // ─── Validation ──────────────────────────────────────────
      if (!supplierId) {
        throw new Error('Supplier is required');
      }

      if (!invoicePayments || invoicePayments.length === 0) {
        throw new Error('At least one invoice must be selected');
      }

      if (!amount || amount <= 0) {
        throw new Error('Payment amount must be greater than 0');
      }

      // ─── Validate Supplier ──────────────────────────────────
      const supplier = await tx.supplier.findFirst({
        where: {
          id: supplierId,
          companyId: companyId,
          status: 'active'
        }
      });

      if (!supplier) {
        throw new Error('Supplier not found');
      }

      // ─── Validate Bank Account ──────────────────────────────
      if (paymentMethod === 'Bank Transfer' || paymentMethod === 'Cheque') {
        if (!bankAccountId) {
          throw new Error('Bank account is required for this payment method');
        }

        const bankAccount = await findBankAccount(tx, companyId, bankAccountId);
        if (!bankAccount) {
          throw new Error('Bank account not found');
        }
      }

      // ─── Validate Invoices ──────────────────────────────────
      let totalPaidAmount = 0;
      const validatedInvoices = [];

      for (const inv of invoicePayments) {
        const invoice = await tx.purchaseInvoice.findFirst({
          where: {
            id: inv.invoiceId,
            supplierId: supplierId,
            companyId: companyId,
            isActive: true,
            isDeleted: false,
            invoiceStatus: {
              in: ['Posted', 'Partially Paid']
            }
          },
          include: {
            purchasePayments: {
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

        const totalPaidFromPayments =
          invoice.purchasePayments?.reduce((sum, ip) => sum + ip.amountPaid, 0) || 0;
        const totalPaid = Math.max(totalPaidFromPayments, Number(invoice.paidAmount) || 0);
        const currentOutstanding =
          Number(invoice.outstanding) > 0
            ? Number(invoice.outstanding)
            : Math.max(0, Number(invoice.grandTotal) - totalPaid);

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

      // ─── Validate Total Amount ──────────────────────────────
      if (Math.abs(totalPaidAmount - amount) > 0.01) {
        throw new Error('Total paid amount does not match invoice amounts');
      }

      // ─── Get AP Account ──────────────────────────────────────
      const apAccount = await findAPAccount(tx, companyId);
      if (!apAccount) {
        throw new Error('Accounts Payable account not found. Please create an account with code "2000" or name "Accounts Payable".');
      }

      // ─── Resolve credit account (Cash / Bank) — never AP ──────
      let creditAccount = null;

      if (bankAccountId && (paymentMethod === 'Bank Transfer' || paymentMethod === 'Cheque' || paymentMethod === 'Online Payment')) {
        const bankAccount = await findBankAccount(tx, companyId, bankAccountId);
        if (bankAccount?.chartOfAccountId) {
          creditAccount = await tx.chartOfAccount.findUnique({
            where: { id: bankAccount.chartOfAccountId }
          });
        }
      }

      if (!creditAccount) {
        creditAccount = await findCashAccount(tx, companyId, createdBy);
      }

      if (!creditAccount) {
        throw new Error('Cash in Hand account not found. Cannot record cash payment.');
      }

      const debitAccountId = creditAccount.id;
      const debitAccountName = creditAccount.name;
      const debitAccountCode = creditAccount.code;

      // ─── Create Journal Entry ────────────────────────────────
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
          companyId: companyId,
          fiscalYearId: fiscalYearId,
          lines: {
            create: [
              {
                accountId: apAccount.id,
                accountName: apAccount.name,
                accountCode: apAccount.code,
                debit: amount,
                credit: 0
              },
              {
                accountId: debitAccountId,
                accountName: debitAccountName,
                accountCode: debitAccountCode,
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

      // Keep Chart of Accounts in sync with payment JE
      await BalanceCalculator.applyJournalLines(tx, journalEntry.lines);

      // ─── Create Payment Record ───────────────────────────────
      const payment = await tx.purchasePaymentMake.create({
        data: {
          paymentNumber,
          paymentDate: new Date(),
          supplierId: supplierId,
          supplierName: supplier.name,
          amount: amount,
          paymentMethod: paymentMethod || 'Cash',
          reference: reference || '',
          bankAccountId: bankAccountId || null,
          bankAccountName: bankAccountName || 'Cash',
          notes: notes || '',
          status: 'Completed',
          journalEntryId: journalEntry.id,
          createdBy: createdBy,
          companyId: companyId,
          fiscalYearId: fiscalYearId,
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

      // ─── Update Each Invoice ──────────────────────────────────
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

        await tx.purchaseInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: newPaidAmount,
            outstanding: Math.max(0, newOutstanding),
            invoiceStatus: invoiceStatus,
            paymentStatus: newOutstanding <= 0 ? 'Paid' : 'Partial'
          }
        });

        await tx.accountsPayable.updateMany({
          where: { invoiceId: invoice.id },
          data: {
            paidAmount: newPaidAmount,
            outstanding: Math.max(0, newOutstanding),
            status: newOutstanding <= 0 ? 'Paid' : 'Current'
          }
        });
      }

      // ─── Update Bank Account Balance ─────────────────────────
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
                items: true
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
        },
        updater: {
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
  // GET ALL PAYMENTS WITH FILTERS - ✅ FIXED
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { paymentDate: 'desc' } } = options;

    // ✅ FIXED: Map userId to createdBy if present
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }

    return await prisma.purchasePaymentMake.findMany({
      where: {
        ...cleanFilter,
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
        supplier: true,
        bankAccount: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // COUNT PAYMENTS - ✅ FIXED
  // ============================================================
  static async count(filter = {}) {
    // ✅ FIXED: Map userId to createdBy if present
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }

    return await prisma.purchasePaymentMake.count({
      where: {
        ...cleanFilter,
        isActive: true,
        isDeleted: false
      }
    });
  }

  // ============================================================
  // GET PAYMENT STATS - ✅ FIXED
  // ============================================================
  static async getStats(companyId) {
    // ✅ FIXED: Use companyId instead of userId
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const baseFilter = {
      isActive: true,
      isDeleted: false,
      companyId: companyId
    };

    const [todayPayments, todayAmount, monthPayments, monthAmount, totalPayments, totalAmount] = await Promise.all([
      prisma.purchasePaymentMake.count({
        where: {
          ...baseFilter,
          paymentDate: { gte: today }
        }
      }),
      prisma.purchasePaymentMake.aggregate({
        where: {
          ...baseFilter,
          paymentDate: { gte: today }
        },
        _sum: { amount: true }
      }),
      prisma.purchasePaymentMake.count({
        where: {
          ...baseFilter,
          paymentDate: { gte: startOfMonth }
        }
      }),
      prisma.purchasePaymentMake.aggregate({
        where: {
          ...baseFilter,
          paymentDate: { gte: startOfMonth }
        },
        _sum: { amount: true }
      }),
      prisma.purchasePaymentMake.count({
        where: baseFilter
      }),
      prisma.purchasePaymentMake.aggregate({
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
  // CANCEL PAYMENT - ✅ FIXED
  // ============================================================
  static async cancelPayment(id, userId, companyId, reason = '') {
    return await prisma.$transaction(async (tx) => {
      const payment = await tx.purchasePaymentMake.findUnique({
        where: { id },
        include: {
          invoicePayments: {
            include: {
              invoice: {
                include: {
                  purchasePayments: {
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
        const totalPaidFromPayments =
          invoice.purchasePayments?.reduce((sum, ip) => sum + ip.amountPaid, 0) || 0;
        const totalPaid = Math.max(totalPaidFromPayments, Number(invoice.paidAmount) || 0);
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

        await tx.purchaseInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: Math.max(0, newPaidAmount),
            outstanding: Math.max(0, newOutstanding),
            invoiceStatus: invoiceStatus,
            paymentStatus: newPaidAmount <= 0 ? 'Unpaid' : (newOutstanding <= 0 ? 'Paid' : 'Partial')
          }
        });

        await tx.accountsPayable.updateMany({
          where: { invoiceId: invoice.id },
          data: {
            paidAmount: Math.max(0, newPaidAmount),
            outstanding: Math.max(0, newOutstanding),
            status: newOutstanding <= 0 ? 'Paid' : 'Current'
          }
        });
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
            companyId: companyId,
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
          updatedBy: userId,
          notes: payment.notes ? `${payment.notes}\nCancelled: ${reason || 'No reason'}` : `Cancelled: ${reason || 'No reason'}`
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
}

module.exports = PurchasePaymentMakeModel;