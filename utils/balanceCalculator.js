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
}

module.exports = BalanceCalculator;
