// controllers/journalEntryController.js - COMPLETE PROFESSIONAL VERSION WITH BANK SYNC

const prisma = require('../prisma/client');

// ─── CONSTANTS ─────────────────────────────────────────────────────
const ACCOUNT_TYPES = {
  ASSET: 'Asset',
  EXPENSE: 'Expense',
  LIABILITY: 'Liability',
  EQUITY: 'Equity',
  REVENUE: 'Revenue'
};

const DEBIT_INCREASE_TYPES = [ACCOUNT_TYPES.ASSET, ACCOUNT_TYPES.EXPENSE];
const CREDIT_INCREASE_TYPES = [ACCOUNT_TYPES.LIABILITY, ACCOUNT_TYPES.EQUITY, ACCOUNT_TYPES.REVENUE];

// ─── Helper: Generate entry number ──────────────────────────────
async function generateEntryNumber() {
  const count = await prisma.journalEntry.count();
  const year = new Date().getFullYear();
  return `JE-${year}-${String(count + 1).padStart(4, '0')}`;
}

// ─── Helper: Validate and get account ────────────────────────────
async function validateAccount(accountId, userId) {
  if (!accountId) {
    throw new Error('Account ID is required for each journal line');
  }

  const account = await prisma.chartOfAccount.findFirst({
    where: {
      id: accountId,
      createdBy: userId,
      isActive: true
    }
  });
  
  if (!account) {
    throw new Error(`Account not found with ID: ${accountId}`);
  }
  
  return account;
}

// ─── Helper: Check if entry is balanced ──────────────────────────
function isBalanced(lines) {
  let totalDebit = 0;
  let totalCredit = 0;
  
  lines.forEach(line => {
    totalDebit += parseFloat(line.debit) || 0;
    totalCredit += parseFloat(line.credit) || 0;
  });
  
  return Math.abs(totalDebit - totalCredit) < 0.01;
}

// ─── Helper: Calculate balance change based on account type ──────
function calculateBalanceChange(accountType, debit, credit) {
  let change = 0;
  
  if (debit > 0) {
    if (DEBIT_INCREASE_TYPES.includes(accountType)) {
      change = debit;
    } else {
      change = -debit;
    }
  } else if (credit > 0) {
    if (DEBIT_INCREASE_TYPES.includes(accountType)) {
      change = -credit;
    } else {
      change = credit;
    }
  }
  
  return change;
}

// ─── Helper: Check account balance before posting ────────────────
async function checkAccountBalance(accountId, debit, credit, userId) {
  const account = await prisma.chartOfAccount.findFirst({
    where: {
      id: accountId,
      createdBy: userId
    }
  });

  if (!account) return null;

  if (debit > 0) {
    if (!DEBIT_INCREASE_TYPES.includes(account.type)) {
      if (account.currentBalance < debit) {
        return {
          insufficient: true,
          accountName: account.name,
          currentBalance: account.currentBalance,
          required: debit,
          type: account.type,
          message: `Cannot debit "${account.name}" (${account.type}). Available balance: ${account.currentBalance}, Required: ${debit}`
        };
      }
    }
  }

  if (credit > 0) {
    if (DEBIT_INCREASE_TYPES.includes(account.type)) {
      if (account.currentBalance < credit) {
        return {
          insufficient: true,
          accountName: account.name,
          currentBalance: account.currentBalance,
          required: credit,
          type: account.type,
          message: `Cannot credit "${account.name}" (${account.type}). Available balance: ${account.currentBalance}, Required: ${credit}`
        };
      }
    }
  }

  return {
    insufficient: false,
    account: account
  };
}

// ─── ✅ NEW HELPER: Update Bank Account balance ──────────────────
async function updateBankAccountBalance(accountId, userId) {
  // Check if this account is linked to a bank account
  const bankAccount = await prisma.bankAccount.findFirst({
    where: {
      chartOfAccountId: accountId,
      createdBy: userId
    },
    include: {
      chartOfAccount: true
    }
  });

  if (!bankAccount) {
    return null; // Not a bank account, skip
  }

  // Get current balance from chart of account
  const chartAccount = await prisma.chartOfAccount.findFirst({
    where: {
      id: accountId,
      createdBy: userId
    }
  });

  if (!chartAccount) {
    return null;
  }

  // Sync bank account balance with chart of account balance
  const updatedBankAccount = await prisma.bankAccount.update({
    where: { id: bankAccount.id },
    data: { currentBalance: chartAccount.currentBalance }
  });

  return updatedBankAccount;
}

// ─── ✅ NEW HELPER: Update all bank accounts in a journal entry ──
async function updateBankAccountsForJournalEntry(journalEntryId, userId) {
  // Get all journal lines for this entry
  const journalLines = await prisma.journalLine.findMany({
    where: {
      journalId: journalEntryId
    },
    include: {
      account: true
    }
  });

  const updatedBankAccounts = [];
  for (const line of journalLines) {
    const result = await updateBankAccountBalance(line.accountId, userId);
    if (result) {
      updatedBankAccounts.push(result);
    }
  }

  return updatedBankAccounts;
}

// ============================================================
// @desc    Create and Post Journal Entry (Direct Post)
// @route   POST /api/journal-entries
// @access  Private
// ============================================================
const createJournalEntry = async (req, res) => {
  try {
    const { date, description, reference, lines } = req.body;
    const userId = req.user.id;

    console.log('📝 Creating and posting journal entry:', { date, description, reference, lines });

    if (!lines || lines.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one journal line is required',
      });
    }

    const validatedLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (!line.accountId || line.accountId === '' || line.accountId === 'null') {
        return res.status(400).json({
          success: false,
          message: `Account ID is required for line ${i + 1}`,
        });
      }

      const account = await validateAccount(line.accountId, userId);
      
      validatedLines.push({
        accountId: line.accountId,
        accountName: account.name,
        accountCode: account.code,
        accountType: account.type,
        currentBalance: account.currentBalance,
        debit: parseFloat(line.debit) || 0,
        credit: parseFloat(line.credit) || 0,
        isReconciled: line.isReconciled || false,
      });
    }

    if (!isBalanced(validatedLines)) {
      const totalDebit = validatedLines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = validatedLines.reduce((sum, l) => sum + l.credit, 0);
      return res.status(400).json({
        success: false,
        message: `Total Debit (${totalDebit}) must equal Total Credit (${totalCredit})`,
      });
    }

    const balanceErrors = [];
    for (const line of validatedLines) {
      if (line.debit > 0 || line.credit > 0) {
        const result = await checkAccountBalance(line.accountId, line.debit, line.credit, userId);
        if (result && result.insufficient) {
          balanceErrors.push(result.message);
        }
      }
    }

    if (balanceErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Balance validation failed',
        errors: balanceErrors,
      });
    }

    const entryNumber = await generateEntryNumber();

    const result = await prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          entryNumber,
          date: date ? new Date(date) : new Date(),
          description: description || '',
          reference: reference || '',
          status: 'Posted',
          postedBy: userId,
          postedAt: new Date(),
          createdBy: userId,
          lines: {
            create: validatedLines.map(line => ({
              accountId: line.accountId,
              accountName: line.accountName,
              accountCode: line.accountCode,
              debit: line.debit,
              credit: line.credit,
              isReconciled: line.isReconciled || false,
            }))
          }
        },
        include: {
          lines: true
        }
      });

      const balanceUpdates = [];
      
      for (const line of validatedLines) {
        const balanceChange = calculateBalanceChange(
          line.accountType,
          line.debit,
          line.credit
        );

        if (balanceChange !== 0) {
          await tx.chartOfAccount.update({
            where: { id: line.accountId },
            data: {
              currentBalance: {
                increment: balanceChange
              }
            }
          });
        }

        const updatedAccount = await tx.chartOfAccount.findUnique({
          where: { id: line.accountId }
        });

        balanceUpdates.push({
          account: line.accountName,
          accountCode: line.accountCode,
          accountType: line.accountType,
          oldBalance: line.currentBalance,
          debit: line.debit,
          credit: line.credit,
          change: balanceChange,
          newBalance: updatedAccount.currentBalance,
          effect: balanceChange > 0 ? 'Increased' : 'Decreased'
        });
      }

      return { entry, balanceUpdates };
    });

    // ─── ✅ UPDATE BANK ACCOUNT BALANCES ──────────────────────────
    const bankAccountUpdates = await updateBankAccountsForJournalEntry(result.entry.id, userId);
    
    if (bankAccountUpdates.length > 0) {
      console.log(`🏦 Updated ${bankAccountUpdates.length} bank account(s)`);
    }

    const completeEntry = await prisma.journalEntry.findUnique({
      where: { id: result.entry.id },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        poster: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        lines: {
          include: {
            account: {
              select: { id: true, code: true, name: true, type: true, currentBalance: true }
            }
          }
        }
      }
    });

    console.log('✅ Journal entry created and posted:', completeEntry.entryNumber);

    res.status(201).json({
      success: true,
      message: 'Journal entry posted successfully',
      data: completeEntry,
      balanceUpdates: result.balanceUpdates,
      bankAccountUpdates: bankAccountUpdates.length > 0 ? bankAccountUpdates : undefined
    });
  } catch (error) {
    console.error('❌ Create journal entry error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server Error',
    });
  }
};

// ============================================================
// @desc    Get all journal entries
// @route   GET /api/journal-entries
// @access  Private
// ============================================================
const getJournalEntries = async (req, res) => {
  try {
    const {
      search,
      startDate,
      endDate,
      page = 1,
      limit = 10
    } = req.query;

    const userId = req.user.id;
    const filter = { 
      createdBy: userId,
      status: 'Posted'
    };

    if (startDate && endDate) {
      filter.date = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    if (search) {
      filter.OR = [
        { entryNumber: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const [journalEntries, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where: filter,
        orderBy: { date: 'desc' },
        skip,
        take: limitNum,
        include: {
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          },
          poster: {
            select: { id: true, firstName: true, lastName: true, email: true }
          },
          lines: {
            include: {
              account: {
                select: { id: true, code: true, name: true, type: true, currentBalance: true }
              }
            }
          }
        }
      }),
      prisma.journalEntry.count({ where: filter })
    ]);

    let totalDebit = 0;
    let totalCredit = 0;

    const allEntries = await prisma.journalEntry.findMany({
      where: filter,
      include: { lines: true }
    });

    allEntries.forEach(entry => {
      const entryDebit = entry.lines.reduce((sum, line) => sum + line.debit, 0);
      const entryCredit = entry.lines.reduce((sum, line) => sum + line.credit, 0);
      totalDebit += entryDebit;
      totalCredit += entryCredit;
    });

    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      count: journalEntries.length,
      total: total,
      page: pageNum,
      pages: totalPages,
      data: journalEntries,
      summary: {
        totalDebit,
        totalCredit,
        difference: Math.abs(totalDebit - totalCredit),
        postedCount: total
      }
    });
  } catch (error) {
    console.error('❌ Get journal entries error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Get single journal entry
// @route   GET /api/journal-entries/:id
// @access  Private
// ============================================================
const getJournalEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const journalEntry = await prisma.journalEntry.findFirst({
      where: {
        id,
        createdBy: userId
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        poster: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        lines: {
          include: {
            account: {
              select: { id: true, code: true, name: true, type: true, currentBalance: true }
            }
          }
        }
      }
    });

    if (!journalEntry) {
      return res.status(404).json({
        success: false,
        message: 'Journal entry not found',
      });
    }

    res.status(200).json({
      success: true,
      data: journalEntry,
    });
  } catch (error) {
    console.error('❌ Get journal entry error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Delete journal entry (Reverse Post)
// @route   DELETE /api/journal-entries/:id
// @access  Private
// ============================================================
const deleteJournalEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const existing = await prisma.journalEntry.findFirst({
      where: {
        id,
        createdBy: userId
      },
      include: {
        lines: {
          include: {
            account: true
          }
        }
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Journal entry not found',
      });
    }

    // ─── Reverse balance changes ──────────────────────────────
    await prisma.$transaction(async (tx) => {
      for (const line of existing.lines) {
        const reverseChange = calculateBalanceChange(
          line.account.type,
          -line.debit,
          -line.credit
        );

        if (reverseChange !== 0) {
          await tx.chartOfAccount.update({
            where: { id: line.accountId },
            data: {
              currentBalance: {
                increment: reverseChange
              }
            }
          });
        }
      }

      // Delete lines and entry
      await tx.journalLine.deleteMany({
        where: { journalId: id }
      });

      await tx.journalEntry.delete({
        where: { id }
      });
    });

    // ─── ✅ UPDATE BANK ACCOUNT BALANCES AFTER DELETION ──────────
    const bankAccountUpdates = await updateBankAccountsForJournalEntry(id, userId);
    
    if (bankAccountUpdates.length > 0) {
      console.log(`🏦 Updated ${bankAccountUpdates.length} bank account(s) after deletion`);
    }

    res.status(200).json({
      success: true,
      message: 'Journal entry deleted and balances reversed successfully',
      bankAccountUpdates: bankAccountUpdates.length > 0 ? bankAccountUpdates : undefined
    });
  } catch (error) {
    console.error('❌ Delete journal entry error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Get journal entry stats
// @route   GET /api/journal-entries/stats
// @access  Private
// ============================================================
const getJournalEntryStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const [total, posted] = await Promise.all([
      prisma.journalEntry.count({ where: { createdBy: userId } }),
      prisma.journalEntry.count({ where: { createdBy: userId, status: 'Posted' } })
    ]);

    const financial = await prisma.journalLine.aggregate({
      where: {
        journal: {
          createdBy: userId,
          status: 'Posted'
        }
      },
      _sum: {
        debit: true,
        credit: true
      }
    });

    res.status(200).json({
      success: true,
      data: {
        total,
        posted,
        totalDebit: financial._sum.debit || 0,
        totalCredit: financial._sum.credit || 0
      }
    });
  } catch (error) {
    console.error('❌ Get journal entry stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Get journal entries by account
// @route   GET /api/journal-entries/account/:accountId
// @access  Private
// ============================================================
const getJournalEntriesByAccount = async (req, res) => {
  try {
    const { accountId } = req.params;
    const userId = req.user.id;

    const entries = await prisma.journalEntry.findMany({
      where: {
        createdBy: userId,
        status: 'Posted',
        lines: {
          some: {
            accountId: accountId
          }
        }
      },
      include: {
        lines: {
          include: {
            account: true
          }
        }
      },
      orderBy: { date: 'desc' }
    });

    res.status(200).json({
      success: true,
      count: entries.length,
      data: entries
    });
  } catch (error) {
    console.error('❌ Get journal entries by account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

module.exports = {
  createJournalEntry,
  getJournalEntries,
  getJournalEntry,
  deleteJournalEntry,
  getJournalEntryStats,
  getJournalEntriesByAccount
};