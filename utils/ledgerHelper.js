/**
 * Ledger Helper Utility
 * Handles ledger-specific operations like opening balance checks
 * Centralizes ledger logic for consistency across the application
 */

const prisma = require('../prisma/client');

class LedgerHelper {
  /**
   * Check if accounts have opening balance entries (batch query)
   * @param {string[]} accountIds - Array of account IDs to check
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Map of accountId -> boolean
   */
  static async hasOpeningBalanceEntries(accountIds, userId) {
    if (!accountIds || accountIds.length === 0) return {};
    
    const entries = await prisma.journalLine.findMany({
      where: {
        accountId: { in: accountIds },
        journal: {
          createdBy: userId,
          description: {
            contains: 'Opening Balance'
          },
          status: 'Posted'
        }
      },
      select: {
        accountId: true
      }
    });
    
    const result = {};
    entries.forEach(entry => {
      result[entry.accountId] = true;
    });
    accountIds.forEach(id => {
      if (!result[id]) result[id] = false;
    });
    return result;
  }

  /**
   * Check if single account has opening balance entry
   * @param {string} accountId - Account ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Whether account has opening balance entry
   */
  static async hasSingleOpeningBalanceEntry(accountId, userId) {
    const entry = await prisma.journalLine.findFirst({
      where: {
        accountId: accountId,
        journal: {
          createdBy: userId,
          description: {
            contains: 'Opening Balance'
          },
          status: 'Posted'
        }
      }
    });
    return entry !== null;
  }

  /**
   * Get opening balance from journal entries (batch query)
   * @param {string[]} accountIds - Array of account IDs
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Map of accountId -> { totalDebit, totalCredit }
   */
  static async getOpeningBalancesFromJournal(accountIds, userId) {
    if (!accountIds || accountIds.length === 0) return {};
    
    const lines = await prisma.journalLine.findMany({
      where: {
        accountId: { in: accountIds },
        journal: {
          createdBy: userId,
          description: {
            contains: 'Opening Balance'
          },
          status: 'Posted'
        }
      }
    });

    const result = {};
    accountIds.forEach(id => {
      result[id] = { totalDebit: 0, totalCredit: 0 };
    });
    
    lines.forEach(line => {
      if (result[line.accountId]) {
        result[line.accountId].totalDebit += line.debit || 0;
        result[line.accountId].totalCredit += line.credit || 0;
      }
    });

    return result;
  }

  /**
   * Get opening balance from journal entries for single account
   * @param {string} accountId - Account ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} { totalDebit, totalCredit }
   */
  static async getSingleOpeningBalanceFromJournal(accountId, userId) {
    const lines = await prisma.journalLine.findMany({
      where: {
        accountId: accountId,
        journal: {
          createdBy: userId,
          description: {
            contains: 'Opening Balance'
          },
          status: 'Posted'
        }
      }
    });

    let totalDebit = 0;
    let totalCredit = 0;
    lines.forEach(line => {
      totalDebit += line.debit || 0;
      totalCredit += line.credit || 0;
    });

    return { totalDebit, totalCredit };
  }

  /**
   * Build date filter for journal entries
   * @param {string} startDate - Start date (ISO string)
   * @param {string} endDate - End date (ISO string)
   * @returns {Object} Prisma date filter object
   */
  static buildDateFilter(startDate, endDate) {
    if (startDate && endDate) {
      return {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        }
      };
    }
    return {};
  }

  /**
   * Build fiscal year filter for journal entries
   * @param {string} fiscalYearId - Fiscal year ID
   * @returns {Object} Prisma fiscal year filter object
   */
  static buildFiscalYearFilter(fiscalYearId) {
    if (fiscalYearId) {
      return {
        fiscalYearId: fiscalYearId
      };
    }
    return {};
  }

  /**
   * Filter ledger entries by search term
   * @param {Array} entries - Array of ledger entries
   * @param {string} searchTerm - Search term
   * @returns {Array} Filtered entries
   */
  static filterBySearch(entries, searchTerm) {
    if (!searchTerm) return entries;
    
    const term = searchTerm.toLowerCase();
    return entries.filter(entry =>
      entry.description.toLowerCase().includes(term) ||
      (entry.reference && entry.reference.toLowerCase().includes(term)) ||
      entry.id.toLowerCase().includes(term) ||
      (entry.accountName && entry.accountName.toLowerCase().includes(term)) ||
      (entry.accountCode && entry.accountCode.toLowerCase().includes(term))
    );
  }

  /**
   * Sort ledger entries
   * @param {Array} entries - Array of ledger entries
   * @param {string} sortBy - Field to sort by (date, debit, credit, balance, accountName)
   * @param {string} sortOrder - Sort order (asc, desc)
   * @returns {Array} Sorted entries
   */
  static sortEntries(entries, sortBy = 'date', sortOrder = 'desc') {
    const sortDirection = sortOrder === 'desc' ? -1 : 1;
    
    return entries.sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return sortDirection * (new Date(a.date) - new Date(b.date));
        case 'debit':
          return sortDirection * (a.debit - b.debit);
        case 'credit':
          return sortDirection * (a.credit - b.credit);
        case 'balance':
          return sortDirection * (a.balance - b.balance);
        case 'accountName':
          return sortDirection * a.accountName.localeCompare(b.accountName);
        default:
          return sortDirection * (new Date(a.date) - new Date(b.date));
      }
    });
  }

  /**
   * Paginate array data
   * @param {Array} data - Array to paginate
   * @param {number} page - Page number (1-based)
   * @param {number} limit - Items per page
   * @returns {Object} Paginated result with metadata
   */
  static paginate(data, page = 1, limit = 20) {
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const totalCount = data.length;
    const totalPages = Math.ceil(totalCount / limitNum);
    const skip = (pageNum - 1) * limitNum;
    
    const paginatedData = data.slice(skip, skip + limitNum);
    
    return {
      data: paginatedData,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        pages: totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
        nextPage: pageNum < totalPages ? pageNum + 1 : null,
        prevPage: pageNum > 1 ? pageNum - 1 : null,
        startIndex: skip + 1,
        endIndex: Math.min(skip + limitNum, totalCount),
      }
    };
  }

  /**
   * Calculate summary statistics for ledger entries
   * @param {Array} entries - Array of ledger entries
   * @returns {Object} Summary statistics
   */
  static calculateSummary(entries) {
    const totalDebit = entries.reduce((sum, entry) => sum + (entry.debit || 0), 0);
    const totalCredit = entries.reduce((sum, entry) => sum + (entry.credit || 0), 0);
    const netDifference = totalDebit - totalCredit;
    const isBalanced = Math.abs(netDifference) < 0.01;
    
    return {
      totalDebit,
      totalCredit,
      netDifference,
      isBalanced,
    };
  }
}

module.exports = LedgerHelper;
