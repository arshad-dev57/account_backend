/**
 * Balance Calculator Utility
 * Handles balance calculations for different account types
 * Centralizes balance logic for consistency across the application
 */

class BalanceCalculator {
  /**
   * Calculate closing balance based on account type
   * @param {Object} params - Calculation parameters
   * @param {number} params.openingBalance - Opening balance
   * @param {number} params.totalDebit - Total debits
   * @param {number} params.totalCredit - Total credits
   * @param {string} params.accountType - Account type (Asset, Liability, Equity, Revenue, Expense)
   * @returns {number} Calculated closing balance
   */
  static calculateClosingBalance({ openingBalance, totalDebit, totalCredit, accountType }) {
    if (accountType === 'Asset' || accountType === 'Expense') {
      return openingBalance + totalDebit - totalCredit;
    } else {
      // Liability, Equity, Revenue
      return openingBalance + totalCredit - totalDebit;
    }
  }

  /**
   * Calculate effective opening balance from journal entries
   * @param {Object} params - Opening balance parameters
   * @param {number} params.totalDebit - Total debits from opening balance entries
   * @param {number} params.totalCredit - Total credits from opening balance entries
   * @param {string} params.accountType - Account type
   * @returns {number} Effective opening balance
   */
  static calculateEffectiveOpeningBalance({ totalDebit, totalCredit, accountType }) {
    if (accountType === 'Asset' || accountType === 'Expense') {
      return totalDebit - totalCredit;
    } else {
      return totalCredit - totalDebit;
    }
  }

  /**
   * Calculate running balance for ledger entries
   * @param {Object} params - Running balance parameters
   * @param {number} params.currentBalance - Current running balance
   * @param {number} params.debit - Current debit amount
   * @param {number} params.credit - Current credit amount
   * @param {string} params.accountType - Account type
   * @returns {number} New running balance
   */
  static calculateRunningBalance({ currentBalance, debit, credit, accountType }) {
    if (accountType === 'Asset' || accountType === 'Expense') {
      return currentBalance + debit - credit;
    } else {
      return currentBalance + credit - debit;
    }
  }

  /**
   * Calculate account balance from debit/credit totals
   * @param {Object} params - Balance parameters
   * @param {number} params.debit - Total debits
   * @param {number} params.credit - Total credits
   * @param {string} params.accountType - Account type
   * @returns {number} Account balance
   */
  static calculateAccountBalance({ debit, credit, accountType }) {
    if (accountType === 'Asset' || accountType === 'Expense') {
      return debit - credit;
    } else {
      return credit - debit;
    }
  }

  /**
   * Determine balance type (Debit or Credit)
   * @param {number} balance - Balance amount
   * @returns {string} 'Debit' or 'Credit'
   */
  static getBalanceType(balance) {
    return balance >= 0 ? 'Debit' : 'Credit';
  }

  /**
   * Check if trial balance is balanced
   * @param {number} totalDebit - Total debits
   * @param {number} totalCredit - Total credits
   * @param {number} tolerance - Tolerance for floating point comparison (default: 0.01)
   * @returns {boolean} Whether trial balance is balanced
   */
  static isTrialBalanceBalanced(totalDebit, totalCredit, tolerance = 0.01) {
    const difference = Math.abs(totalDebit - totalCredit);
    return difference < tolerance;
  }

  /**
   * Calculate net difference for trial balance
   * @param {number} totalDebit - Total debits
   * @param {number} totalCredit - Total credits
   * @returns {number} Net difference
   */
  static calculateNetDifference(totalDebit, totalCredit) {
    return totalDebit - totalCredit;
  }

  /**
   * Normalize type aliases (Income → Revenue)
   */
  static normalizeAccountType(type) {
    if (type === 'Income') return 'Revenue';
    return type || 'Asset';
  }

  /**
   * Apply one journal line to ChartOfAccount.currentBalance (inside a Prisma tx).
   */
  static async applyJournalLine(tx, { accountId, debit = 0, credit = 0 }) {
    if (!accountId) return null;
    const account = await tx.chartOfAccount.findUnique({ where: { id: accountId } });
    if (!account) return null;

    const accountType = this.normalizeAccountType(account.type);
    const newBalance = this.calculateRunningBalance({
      currentBalance: Number(account.currentBalance || 0),
      debit: Number(debit || 0),
      credit: Number(credit || 0),
      accountType
    });

    return tx.chartOfAccount.update({
      where: { id: accountId },
      data: { currentBalance: newBalance }
    });
  }

  /**
   * Apply many journal lines to COA balances.
   */
  static async applyJournalLines(tx, lines = []) {
    for (const line of lines) {
      await this.applyJournalLine(tx, {
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit
      });
    }
  }
}

module.exports = BalanceCalculator;
