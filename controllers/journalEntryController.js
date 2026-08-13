
const prisma = require('../prisma/client');
const { fiscalYearGuard } = require('../middleware/fiscalYearMiddleware');
const { resolveFiscalYearId } = require('../utils/fiscalYearHelper');

const ACCOUNT_TYPES = {
  ASSET: 'Asset',
  EXPENSE: 'Expense',
  LIABILITY: 'Liability',
  EQUITY: 'Equity',
  REVENUE: 'Revenue'
};

const DEBIT_INCREASE_TYPES = [ACCOUNT_TYPES.ASSET, ACCOUNT_TYPES.EXPENSE];
const CREDIT_INCREASE_TYPES = [ACCOUNT_TYPES.LIABILITY, ACCOUNT_TYPES.EQUITY, ACCOUNT_TYPES.REVENUE];

async function generateEntryNumber() {
  const count = await prisma.journalEntry.count();
  const year = new Date().getFullYear();
  return `JE-${year}-${String(count + 1).padStart(4, '0')}`;
}

async function validateAccount(accountId, companyId) {
  if (!accountId) {
    throw new Error('Account ID is required for each journal line');
  }

  const account = await prisma.chartOfAccount.findFirst({
    where: {
      id: accountId,
      companyId: companyId,
      isActive: true
    }
  });
  
  if (!account) {
    throw new Error(`Account not found with ID: ${accountId}`);
  }
  
  return account;
}

function isBalanced(lines) {
  let totalDebit = 0;
  let totalCredit = 0;
  
  lines.forEach(line => {
    totalDebit += parseFloat(line.debit) || 0;
    totalCredit += parseFloat(line.credit) || 0;
  });
  
  return Math.abs(totalDebit - totalCredit) < 0.01;
}

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

// ✅ FIXED: Added companyId parameter
async function checkAccountBalance(accountId, debit, credit, companyId) {
  const account = await prisma.chartOfAccount.findFirst({
    where: {
      id: accountId,
      companyId: companyId
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

// ✅ FIXED: Added companyId parameter
async function updateBankAccountBalance(accountId, companyId) {
  // Check if this account is linked to a bank account
  const bankAccount = await prisma.bankAccount.findFirst({
    where: {
      chartOfAccountId: accountId,
      companyId: companyId
    },
    include: {
      chartOfAccount: true
    }
  });

  if (!bankAccount) {
    return null; 
  }

  const chartAccount = await prisma.chartOfAccount.findFirst({
    where: {
      id: accountId,
      companyId: companyId
    }
  });

  if (!chartAccount) {
    return null;
  }

  const updatedBankAccount = await prisma.bankAccount.update({
    where: { id: bankAccount.id },
    data: { currentBalance: chartAccount.currentBalance }
  });

  return updatedBankAccount;
}

// ✅ FIXED: Added companyId parameter
async function updateBankAccountsForJournalEntry(journalEntryId, companyId) {
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
    // ✅ FIXED: Pass companyId to updateBankAccountBalance
    const result = await updateBankAccountBalance(line.accountId, companyId);
    if (result) {
      updatedBankAccounts.push(result);
    }
  }

  return updatedBankAccounts;
}

const createJournalEntry = async (req, res) => {
  try {
    const { date, description, reference, lines } = req.body;
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const postingDate = date ? new Date(date) : new Date();

    console.log('📝 Creating and posting journal entry:', { date, description, reference, lines });

    try {
      await fiscalYearGuard(userId, postingDate);
    } catch (err) {
      if (err.code === 'FISCAL_YEAR_CLOSED') {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }
    const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

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
      // ✅ FIXED: Pass companyId to validateAccount
      const account = await validateAccount(line.accountId, companyId);
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
        // ✅ FIXED: Pass companyId to checkAccountBalance
        const result = await checkAccountBalance(line.accountId, line.debit, line.credit, companyId);
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
          date: postingDate,
          description: description || '',
          reference: reference || '',
          status: 'Posted',
          postedBy: userId,
          postedAt: new Date(),
          createdBy: userId,
          companyId: companyId,
          fiscalYearId,
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

    // ✅ FIXED: Pass companyId to updateBankAccountsForJournalEntry
    const bankAccountUpdates = await updateBankAccountsForJournalEntry(result.entry.id, companyId);
    
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
// GET JOURNAL ENTRIES
// ============================================================
const getJournalEntries = async (req, res) => {
  try {
    const {
      search,
      startDate,
      endDate,
      page = 1,
      limit = 10,
      status
    } = req.query;

    console.log('getJournalEntries called with params:', { search, startDate, endDate, page, limit, status });

    const userId = req.user.id;
    const companyId = req.user.companyId;
    const filter = {
      companyId: companyId
    };

    // Only filter by status if explicitly provided
    if (status && status !== 'All') {
      filter.status = status;
    }

    const searchTerm = typeof search === 'string' ? search.trim() : '';
    if (searchTerm) {
      filter.OR = [
        { entryNumber: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } },
        { reference: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.date = { gte: start, lte: end };
    }

    const [journalEntries, total, lineSums, statusCounts] = await Promise.all([
      prisma.journalEntry.findMany({
        where: filter,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
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
      prisma.journalEntry.count({ where: filter }),
      prisma.journalLine.aggregate({
        where: { journal: filter },
        _sum: { debit: true, credit: true }
      }),
      prisma.journalEntry.groupBy({
        by: ['status'],
        where: filter,
        _count: { _all: true }
      })
    ]);

    const totalDebit = Number(lineSums._sum?.debit || 0);
    const totalCredit = Number(lineSums._sum?.credit || 0);
    const statusCount = (statusName) => {
      const row = statusCounts.find((item) => item.status === statusName);
      if (!row) return 0;
      if (typeof row._count === 'number') return row._count;
      return row._count?._all || 0;
    };
    const postedCount = statusCount('Posted');
    const draftCount = statusCount('Draft');
    const totalPages = Math.max(1, Math.ceil(total / limitNum) || 1);
    const hasNext = pageNum < totalPages && skip + journalEntries.length < total;
    const hasPrev = pageNum > 1;

    const pagination = {
      total,
      page: pageNum,
      limit: limitNum,
      pages: totalPages,
      hasNext,
      hasPrev,
      nextPage: hasNext ? pageNum + 1 : null,
      prevPage: hasPrev ? pageNum - 1 : null,
      startIndex: total === 0 ? 0 : skip + 1,
      endIndex: Math.min(skip + journalEntries.length, total)
    };

    res.status(200).json({
      success: true,
      count: journalEntries.length,
      total,
      page: pageNum,
      pages: totalPages,
      limit: limitNum,
      hasNext,
      hasPrev,
      data: journalEntries,
      pagination,
      summary: {
        totalDebit,
        totalCredit,
        difference: Math.abs(totalDebit - totalCredit),
        postedCount,
        draftCount,
      },
      stats: {
        totalDebit,
        totalCredit,
        difference: Math.abs(totalDebit - totalCredit),
        postedCount,
        draftCount,
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

const getJournalEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const companyId = req.user.companyId;
    
    const journalEntry = await prisma.journalEntry.findFirst({
      where: {
        id,
        companyId: companyId
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
// DELETE JOURNAL ENTRY (Reverse Post)
// ============================================================
const deleteJournalEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const companyId = req.user.companyId;
    
    const existing = await prisma.journalEntry.findFirst({
      where: {
        id,
        companyId: companyId
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

    try {
      await fiscalYearGuard(userId, existing.date);
    } catch (err) {
      if (err.code === 'FISCAL_YEAR_CLOSED') {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }

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

    const bankAccountUpdates = await updateBankAccountsForJournalEntry(id, companyId);
    
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

const getJournalEntryStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    
    const [total, posted] = await Promise.all([
      prisma.journalEntry.count({ where: { companyId: companyId } }),
      prisma.journalEntry.count({ where: { companyId: companyId, status: 'Posted' } })
    ]);

    const financial = await prisma.journalLine.aggregate({
      where: {
        journal: {
          companyId: companyId,
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

const getJournalEntriesByAccount = async (req, res) => {
  try {
    const { accountId } = req.params;
    const userId = req.user.id;
    const companyId = req.user.companyId;
    
    const entries = await prisma.journalEntry.findMany({
      where: {
        companyId: companyId,
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

const postJournalEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const existing = await prisma.journalEntry.findFirst({
      where: {
        id,
        companyId: companyId,
        status: 'Draft'
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Journal entry not found or already posted',
      });
    }

    const updated = await prisma.journalEntry.update({
      where: { id },
      data: {
        status: 'Posted',
        postedBy: userId,
        postedAt: new Date()
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

    res.status(200).json({
      success: true,
      message: 'Journal entry posted successfully',
      data: updated
    });
  } catch (error) {
    console.error('❌ Post journal entry error:', error);
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
  getJournalEntriesByAccount,
  postJournalEntry
};