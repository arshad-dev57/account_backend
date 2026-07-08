// controllers/trialBalanceController.js - PostgreSQL Version

const prisma = require('../prisma/client');

// ============================================================
// @desc    Get Trial Balance
// @route   GET /api/trial-balance
// @access  Private
// ============================================================
exports.getTrialBalance = async (req, res) => {
  try {
    const { startDate, endDate, accountType, showZeroBalance } = req.query;
    const userId = req.user.id;

    // ─── Build date filter ──────────────────────────────────────
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        }
      };
    }

    // ─── Get all posted journal entries within date range ──────
    const journalEntries = await prisma.journalEntry.findMany({
      where: {
        createdBy: userId,
        status: 'Posted',
        ...dateFilter
      },
      include: {
        lines: true
      }
    });

    // ─── Get all active accounts ──────────────────────────────────
    let accountsQuery = {
      createdBy: userId,
      isActive: true
    };

    // Filter by account type if specified
    if (accountType && accountType !== 'All') {
      // Map frontend type to backend type
      const typeMap = {
        'Assets': 'Asset',
        'Liabilities': 'Liability',
        'Equity': 'Equity',
        'Income': 'Revenue',
        'Expenses': 'Expense'
      };
      const backendType = typeMap[accountType] || accountType;
      accountsQuery.type = backendType;
    }

    const accounts = await prisma.chartOfAccount.findMany({
      where: accountsQuery,
      orderBy: { code: 'asc' }
    });

    // ─── Calculate debit and credit balances for each account ──
    const trialBalanceData = accounts.map(account => {
      let debitBalance = 0;
      let creditBalance = 0;

      // Calculate from journal entries
      journalEntries.forEach(entry => {
        entry.lines.forEach(line => {
          if (line.accountId === account.id) {
            debitBalance += line.debit || 0;
            creditBalance += line.credit || 0;
          }
        });
      });

      // Add opening balance
      if (account.type === 'Asset' || account.type === 'Expense') {
        debitBalance += account.openingBalance;
      } else {
        creditBalance += account.openingBalance;
      }

      // Determine final balance (Debit or Credit)
      let finalDebitBalance = 0;
      let finalCreditBalance = 0;
      const netBalance = debitBalance - creditBalance;

      if (netBalance > 0) {
        finalDebitBalance = netBalance;
        finalCreditBalance = 0;
      } else if (netBalance < 0) {
        finalDebitBalance = 0;
        finalCreditBalance = Math.abs(netBalance);
      }

      // Map type for frontend display
      const typeMap = {
        'Asset': 'Assets',
        'Liability': 'Liabilities',
        'Equity': 'Equity',
        'Revenue': 'Income',
        'Expense': 'Expenses'
      };

      return {
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        accountType: typeMap[account.type] || account.type,
        backendType: account.type,
        debitBalance: finalDebitBalance,
        creditBalance: finalCreditBalance,
        openingBalance: account.openingBalance,
        currentBalance: account.currentBalance,
      };
    });

    // ─── Filter zero balance accounts if needed ──────────────
    let filteredData = trialBalanceData;
    if (showZeroBalance === 'false') {
      filteredData = trialBalanceData.filter(account =>
        account.debitBalance > 0 || account.creditBalance > 0
      );
    }

    // ─── Calculate totals ──────────────────────────────────────
    const totalDebit = filteredData.reduce((sum, acc) => sum + acc.debitBalance, 0);
    const totalCredit = filteredData.reduce((sum, acc) => sum + acc.creditBalance, 0);
    const difference = Math.abs(totalDebit - totalCredit);
    const isBalanced = difference < 0.01;

    res.status(200).json({
      success: true,
      count: filteredData.length,
      data: filteredData,
      summary: {
        totalDebit,
        totalCredit,
        difference,
        isBalanced,
        message: isBalanced 
          ? '✅ Trial Balance is balanced' 
          : '⚠️ Trial Balance is NOT balanced. Please check entries.'
      },
      period: {
        startDate: startDate || null,
        endDate: endDate || null
      }
    });
  } catch (error) {
    console.error('❌ Get trial balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Get Trial Balance summary only (for dashboard)
// @route   GET /api/trial-balance/summary
// @access  Private
// ============================================================
exports.getTrialBalanceSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    // ─── Build date filter ──────────────────────────────────────
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        }
      };
    }

    // ─── Get all posted journal entries ────────────────────────
    const journalEntries = await prisma.journalEntry.findMany({
      where: {
        createdBy: userId,
        status: 'Posted',
        ...dateFilter
      },
      include: {
        lines: true
      }
    });

    // ─── Get all active accounts ──────────────────────────────────
    const accounts = await prisma.chartOfAccount.findMany({
      where: {
        createdBy: userId,
        isActive: true
      }
    });

    // ─── Calculate totals by account type ──────────────────────
    const totals = {
      Assets: { debit: 0, credit: 0, count: 0 },
      Liabilities: { debit: 0, credit: 0, count: 0 },
      Equity: { debit: 0, credit: 0, count: 0 },
      Income: { debit: 0, credit: 0, count: 0 },
      Expenses: { debit: 0, credit: 0, count: 0 },
    };

    // Map backend type to frontend type
    const typeMap = {
      'Asset': 'Assets',
      'Liability': 'Liabilities',
      'Equity': 'Equity',
      'Revenue': 'Income',
      'Expense': 'Expenses'
    };

    accounts.forEach(account => {
      let debitBalance = 0;
      let creditBalance = 0;

      journalEntries.forEach(entry => {
        entry.lines.forEach(line => {
          if (line.accountId === account.id) {
            debitBalance += line.debit || 0;
            creditBalance += line.credit || 0;
          }
        });
      });

      // Add opening balance
      if (account.type === 'Asset' || account.type === 'Expense') {
        debitBalance += account.openingBalance;
      } else {
        creditBalance += account.openingBalance;
      }

      const netBalance = debitBalance - creditBalance;
      const typeKey = typeMap[account.type] || account.type;

      if (totals[typeKey]) {
        totals[typeKey].count += 1;
        if (netBalance > 0) {
          totals[typeKey].debit += netBalance;
        } else if (netBalance < 0) {
          totals[typeKey].credit += Math.abs(netBalance);
        }
      }
    });

    // ─── Calculate overall totals ──────────────────────────────
    const totalDebit = Object.values(totals).reduce((sum, t) => sum + t.debit, 0);
    const totalCredit = Object.values(totals).reduce((sum, t) => sum + t.credit, 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

    // ─── Calculate percentages for visualization ──────────────
    const grandTotal = totalDebit + totalCredit;
    const totalsWithPercentage = {};
    Object.keys(totals).forEach(key => {
      const t = totals[key];
      const total = t.debit + t.credit;
      totalsWithPercentage[key] = {
        ...t,
        total,
        percentage: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
        isDebitType: ['Assets', 'Expenses'].includes(key),
      };
    });

    res.status(200).json({
      success: true,
      data: {
        totals: totalsWithPercentage,
        summary: {
          totalDebit,
          totalCredit,
          difference: Math.abs(totalDebit - totalCredit),
          isBalanced,
          grandTotal,
          message: isBalanced
            ? '✅ Trial Balance is balanced'
            : '⚠️ Trial Balance is NOT balanced. Please check entries.'
        },
        period: {
          startDate: startDate || null,
          endDate: endDate || null
        }
      },
    });
  } catch (error) {
    console.error('❌ Get trial balance summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Get Trial Balance by account type
// @route   GET /api/trial-balance/type/:type
// @access  Private
// ============================================================
exports.getTrialBalanceByType = async (req, res) => {
  try {
    const { type } = req.params;
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    // ─── Map frontend type to backend type ──────────────────────
    const typeMap = {
      'Assets': 'Asset',
      'Liabilities': 'Liability',
      'Equity': 'Equity',
      'Income': 'Revenue',
      'Expenses': 'Expense'
    };
    const backendType = typeMap[type] || type;

    // ─── Build date filter ──────────────────────────────────────
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        }
      };
    }

    // ─── Get journal entries ────────────────────────────────────
    const journalEntries = await prisma.journalEntry.findMany({
      where: {
        createdBy: userId,
        status: 'Posted',
        ...dateFilter
      },
      include: {
        lines: true
      }
    });

    // ─── Get accounts of specific type ──────────────────────────
    const accounts = await prisma.chartOfAccount.findMany({
      where: {
        createdBy: userId,
        type: backendType,
        isActive: true
      },
      orderBy: { code: 'asc' }
    });

    // ─── Calculate balances ──────────────────────────────────────
    const accountBalances = accounts.map(account => {
      let debitBalance = 0;
      let creditBalance = 0;

      journalEntries.forEach(entry => {
        entry.lines.forEach(line => {
          if (line.accountId === account.id) {
            debitBalance += line.debit || 0;
            creditBalance += line.credit || 0;
          }
        });
      });

      if (account.type === 'Asset' || account.type === 'Expense') {
        debitBalance += account.openingBalance;
      } else {
        creditBalance += account.openingBalance;
      }

      const netBalance = debitBalance - creditBalance;
      let finalDebitBalance = 0;
      let finalCreditBalance = 0;

      if (netBalance > 0) {
        finalDebitBalance = netBalance;
      } else if (netBalance < 0) {
        finalCreditBalance = Math.abs(netBalance);
      }

      const reverseTypeMap = {
        'Asset': 'Assets',
        'Liability': 'Liabilities',
        'Equity': 'Equity',
        'Revenue': 'Income',
        'Expense': 'Expenses'
      };

      return {
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        accountType: reverseTypeMap[account.type] || account.type,
        debitBalance: finalDebitBalance,
        creditBalance: finalCreditBalance,
        netBalance: netBalance,
        openingBalance: account.openingBalance,
        currentBalance: account.currentBalance,
      };
    });

    // ─── Calculate type totals ──────────────────────────────────
    const totalDebit = accountBalances.reduce((sum, acc) => sum + acc.debitBalance, 0);
    const totalCredit = accountBalances.reduce((sum, acc) => sum + acc.creditBalance, 0);
    const netTotal = totalDebit - totalCredit;

    res.status(200).json({
      success: true,
      type: type,
      count: accountBalances.length,
      data: accountBalances,
      summary: {
        totalDebit,
        totalCredit,
        netTotal,
        isDebitType: ['Assets', 'Expenses'].includes(type),
        message: netTotal === 0 
          ? '✅ ${type} are balanced' 
          : '⚠️ ${type} have a net balance of ${Math.abs(netTotal)}'
      }
    });
  } catch (error) {
    console.error('❌ Get trial balance by type error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Export Trial Balance to CSV/Excel
// @route   GET /api/trial-balance/export
// @access  Private
// ============================================================
exports.exportTrialBalance = async (req, res) => {
  try {
    const { startDate, endDate, accountType, showZeroBalance } = req.query;
    const userId = req.user.id;

    // ─── Build date filter ──────────────────────────────────────
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        }
      };
    }

    // ─── Get journal entries ────────────────────────────────────
    const journalEntries = await prisma.journalEntry.findMany({
      where: {
        createdBy: userId,
        status: 'Posted',
        ...dateFilter
      },
      include: {
        lines: true
      }
    });

    // ─── Get accounts ──────────────────────────────────────────
    let accountsQuery = {
      createdBy: userId,
      isActive: true
    };

    if (accountType && accountType !== 'All') {
      const typeMap = {
        'Assets': 'Asset',
        'Liabilities': 'Liability',
        'Equity': 'Equity',
        'Income': 'Revenue',
        'Expenses': 'Expense'
      };
      const backendType = typeMap[accountType] || accountType;
      accountsQuery.type = backendType;
    }

    const accounts = await prisma.chartOfAccount.findMany({
      where: accountsQuery,
      orderBy: { code: 'asc' }
    });

    // ─── Calculate balances ──────────────────────────────────────
    const exportData = accounts.map(account => {
      let debitBalance = 0;
      let creditBalance = 0;

      journalEntries.forEach(entry => {
        entry.lines.forEach(line => {
          if (line.accountId === account.id) {
            debitBalance += line.debit || 0;
            creditBalance += line.credit || 0;
          }
        });
      });

      if (account.type === 'Asset' || account.type === 'Expense') {
        debitBalance += account.openingBalance;
      } else {
        creditBalance += account.openingBalance;
      }

      const netBalance = debitBalance - creditBalance;
      let finalDebitBalance = 0;
      let finalCreditBalance = 0;

      if (netBalance > 0) {
        finalDebitBalance = netBalance;
      } else if (netBalance < 0) {
        finalCreditBalance = Math.abs(netBalance);
      }

      const typeMap = {
        'Asset': 'Assets',
        'Liability': 'Liabilities',
        'Equity': 'Equity',
        'Revenue': 'Income',
        'Expense': 'Expenses'
      };

      return {
        accountCode: account.code,
        accountName: account.name,
        accountType: typeMap[account.type] || account.type,
        openingBalance: account.openingBalance,
        debitBalance: finalDebitBalance,
        creditBalance: finalCreditBalance,
        netBalance: netBalance,
        currentBalance: account.currentBalance,
      };
    });

    // ─── Filter zero balance ──────────────────────────────────
    let filteredData = exportData;
    if (showZeroBalance === 'false') {
      filteredData = exportData.filter(account =>
        account.debitBalance > 0 || account.creditBalance > 0
      );
    }

    // ─── Calculate totals ──────────────────────────────────────
    const totalDebit = filteredData.reduce((sum, acc) => sum + acc.debitBalance, 0);
    const totalCredit = filteredData.reduce((sum, acc) => sum + acc.creditBalance, 0);

    res.status(200).json({
      success: true,
      count: filteredData.length,
      data: filteredData,
      summary: {
        totalDebit,
        totalCredit,
        difference: Math.abs(totalDebit - totalCredit),
        isBalanced: Math.abs(totalDebit - totalCredit) < 0.01
      },
      exportDate: new Date().toISOString(),
      period: {
        startDate: startDate || null,
        endDate: endDate || null
      }
    });
  } catch (error) {
    console.error('❌ Export trial balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Get Trial Balance comparison (period over period)
// @route   GET /api/trial-balance/compare
// @access  Private
// ============================================================
exports.compareTrialBalance = async (req, res) => {
  try {
    const { 
      startDate1, endDate1, 
      startDate2, endDate2 
    } = req.query;
    const userId = req.user.id;

    if (!startDate1 || !endDate1 || !startDate2 || !endDate2) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both date ranges for comparison'
      });
    }

    // ─── Helper function to get balances for a period ──────────
    const getBalancesForPeriod = async (startDate, endDate) => {
      const dateFilter = {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        }
      };

      const journalEntries = await prisma.journalEntry.findMany({
        where: {
          createdBy: userId,
          status: 'Posted',
          ...dateFilter
        },
        include: {
          lines: true
        }
      });

      const accounts = await prisma.chartOfAccount.findMany({
        where: {
          createdBy: userId,
          isActive: true
        }
      });

      const balances = {};
      accounts.forEach(account => {
        let debitBalance = 0;
        let creditBalance = 0;

        journalEntries.forEach(entry => {
          entry.lines.forEach(line => {
            if (line.accountId === account.id) {
              debitBalance += line.debit || 0;
              creditBalance += line.credit || 0;
            }
          });
        });

        if (account.type === 'Asset' || account.type === 'Expense') {
          debitBalance += account.openingBalance;
        } else {
          creditBalance += account.openingBalance;
        }

        const netBalance = debitBalance - creditBalance;
        balances[account.id] = {
          accountId: account.id,
          accountName: account.name,
          accountCode: account.code,
          accountType: account.type,
          debitBalance: netBalance > 0 ? netBalance : 0,
          creditBalance: netBalance < 0 ? Math.abs(netBalance) : 0,
          netBalance: netBalance,
        };
      });

      return balances;
    };

    // ─── Get balances for both periods ──────────────────────────
    const period1Balances = await getBalancesForPeriod(startDate1, endDate1);
    const period2Balances = await getBalancesForPeriod(startDate2, endDate2);

    // ─── Compare balances ──────────────────────────────────────
    const comparison = [];
    const allAccountIds = new Set([
      ...Object.keys(period1Balances),
      ...Object.keys(period2Balances)
    ]);

    allAccountIds.forEach(accountId => {
      const p1 = period1Balances[accountId] || { netBalance: 0, debitBalance: 0, creditBalance: 0 };
      const p2 = period2Balances[accountId] || { netBalance: 0, debitBalance: 0, creditBalance: 0 };
      
      const change = p2.netBalance - p1.netBalance;
      const changePercent = p1.netBalance !== 0 
        ? (change / Math.abs(p1.netBalance)) * 100 
        : 0;

      const typeMap = {
        'Asset': 'Assets',
        'Liability': 'Liabilities',
        'Equity': 'Equity',
        'Revenue': 'Income',
        'Expense': 'Expenses'
      };

      comparison.push({
        accountId: accountId,
        accountCode: p1.accountCode || p2.accountCode || '',
        accountName: p1.accountName || p2.accountName || '',
        accountType: typeMap[p1.accountType || p2.accountType] || '',
        period1: {
          debitBalance: p1.debitBalance,
          creditBalance: p1.creditBalance,
          netBalance: p1.netBalance,
        },
        period2: {
          debitBalance: p2.debitBalance,
          creditBalance: p2.creditBalance,
          netBalance: p2.netBalance,
        },
        change: change,
        changePercent: changePercent,
        direction: change > 0 ? 'increase' : change < 0 ? 'decrease' : 'no_change',
      });
    });

    // ─── Calculate summary ──────────────────────────────────────
    const totalP1Debit = Object.values(period1Balances).reduce((sum, b) => sum + b.debitBalance, 0);
    const totalP1Credit = Object.values(period1Balances).reduce((sum, b) => sum + b.creditBalance, 0);
    const totalP2Debit = Object.values(period2Balances).reduce((sum, b) => sum + b.debitBalance, 0);
    const totalP2Credit = Object.values(period2Balances).reduce((sum, b) => sum + b.creditBalance, 0);

    res.status(200).json({
      success: true,
      count: comparison.length,
      data: comparison,
      summary: {
        period1: {
          startDate: startDate1,
          endDate: endDate1,
          totalDebit: totalP1Debit,
          totalCredit: totalP1Credit,
          difference: Math.abs(totalP1Debit - totalP1Credit),
          isBalanced: Math.abs(totalP1Debit - totalP1Credit) < 0.01
        },
        period2: {
          startDate: startDate2,
          endDate: endDate2,
          totalDebit: totalP2Debit,
          totalCredit: totalP2Credit,
          difference: Math.abs(totalP2Debit - totalP2Credit),
          isBalanced: Math.abs(totalP2Debit - totalP2Credit) < 0.01
        },
        overallChange: {
          debitChange: totalP2Debit - totalP1Debit,
          creditChange: totalP2Credit - totalP1Credit,
          netChange: (totalP2Debit - totalP2Credit) - (totalP1Debit - totalP1Credit)
        }
      }
    });
  } catch (error) {
    console.error('❌ Compare trial balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Get Trial Balance with account hierarchies
// @route   GET /api/trial-balance/hierarchy
// @access  Private
// ============================================================
exports.getTrialBalanceHierarchy = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    // ─── Build date filter ──────────────────────────────────────
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        }
      };
    }

    // ─── Get journal entries ────────────────────────────────────
    const journalEntries = await prisma.journalEntry.findMany({
      where: {
        createdBy: userId,
        status: 'Posted',
        ...dateFilter
      },
      include: {
        lines: true
      }
    });

    // ─── Get accounts ──────────────────────────────────────────
    const accounts = await prisma.chartOfAccount.findMany({
      where: {
        createdBy: userId,
        isActive: true
      },
      orderBy: { code: 'asc' }
    });

    // ─── Build account hierarchy ──────────────────────────────
    const hierarchy = {
      Assets: { accounts: [], totalDebit: 0, totalCredit: 0 },
      Liabilities: { accounts: [], totalDebit: 0, totalCredit: 0 },
      Equity: { accounts: [], totalDebit: 0, totalCredit: 0 },
      Income: { accounts: [], totalDebit: 0, totalCredit: 0 },
      Expenses: { accounts: [], totalDebit: 0, totalCredit: 0 },
    };

    const typeMap = {
      'Asset': 'Assets',
      'Liability': 'Liabilities',
      'Equity': 'Equity',
      'Revenue': 'Income',
      'Expense': 'Expenses'
    };

    accounts.forEach(account => {
      let debitBalance = 0;
      let creditBalance = 0;

      journalEntries.forEach(entry => {
        entry.lines.forEach(line => {
          if (line.accountId === account.id) {
            debitBalance += line.debit || 0;
            creditBalance += line.credit || 0;
          }
        });
      });

      if (account.type === 'Asset' || account.type === 'Expense') {
        debitBalance += account.openingBalance;
      } else {
        creditBalance += account.openingBalance;
      }

      const netBalance = debitBalance - creditBalance;
      let finalDebit = 0;
      let finalCredit = 0;

      if (netBalance > 0) {
        finalDebit = netBalance;
      } else if (netBalance < 0) {
        finalCredit = Math.abs(netBalance);
      }

      const typeKey = typeMap[account.type] || account.type;
      if (hierarchy[typeKey]) {
        hierarchy[typeKey].accounts.push({
          id: account.id,
          code: account.code,
          name: account.name,
          parentAccount: account.parentAccount,
          debitBalance: finalDebit,
          creditBalance: finalCredit,
          netBalance: netBalance,
          openingBalance: account.openingBalance,
          currentBalance: account.currentBalance,
        });
        hierarchy[typeKey].totalDebit += finalDebit;
        hierarchy[typeKey].totalCredit += finalCredit;
      }
    });

    // ─── Calculate grand totals ──────────────────────────────
    const grandTotalDebit = Object.values(hierarchy).reduce((sum, h) => sum + h.totalDebit, 0);
    const grandTotalCredit = Object.values(hierarchy).reduce((sum, h) => sum + h.totalCredit, 0);

    res.status(200).json({
      success: true,
      data: hierarchy,
      summary: {
        grandTotalDebit,
        grandTotalCredit,
        difference: Math.abs(grandTotalDebit - grandTotalCredit),
        isBalanced: Math.abs(grandTotalDebit - grandTotalCredit) < 0.01,
        period: {
          startDate: startDate || null,
          endDate: endDate || null
        }
      }
    });
  } catch (error) {
    console.error('❌ Get trial balance hierarchy error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};