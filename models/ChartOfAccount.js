  // models/ChartOfAccount.js - Prisma Version (FIXED with Validation)

  const prisma = require('../prisma/client');

  // ─── CONSTANTS ─────────────────────────────────────────────────────
  const VALID_ACCOUNT_TYPES = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];
  const DEBIT_BALANCE_TYPES = ['Asset', 'Expense'];
  const CREDIT_BALANCE_TYPES = ['Liability', 'Equity', 'Revenue'];

  class ChartOfAccountModel {
    // ============================================================
    // ✅ VALIDATE ACCOUNT DATA
    // ============================================================
    static validateAccountData(data) {
      const errors = [];

      // ─── Check required fields ────────────────────────────────
      if (!data.code) errors.push('Account code is required');
      if (!data.name) errors.push('Account name is required');
      if (!data.type) errors.push('Account type is required');

      // ─── Check valid type ──────────────────────────────────────
      if (data.type && !VALID_ACCOUNT_TYPES.includes(data.type)) {
        errors.push(`Invalid account type. Must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}`);
      }

      // ─── ✅ Cash/Bank validation ──────────────────────────────
      if (data.name) {
        const nameLower = data.name.toLowerCase();
        const isCashOrBank = nameLower.includes('cash') || 
                            nameLower.includes('bank') || 
                            nameLower.includes('money') ||
                            nameLower.includes('checking') ||
                            nameLower.includes('saving');
        
        if (isCashOrBank && data.type && data.type !== 'Asset') {
          errors.push(`"${data.name}" must be of type "Asset". Current type: "${data.type}"`);
        }
      }

      // ─── ✅ Check opening balance sign ─────────────────────────
      if (data.openingBalance && data.openingBalance !== 0) {
        const balance = parseFloat(data.openingBalance);
        if (data.type === 'Asset' || data.type === 'Expense') {
          // Asset/Expense should have positive or zero balance
          if (balance < 0) {
            errors.push(`"${data.type}" accounts cannot have negative opening balance. Please enter a positive amount.`);
          }
        } else if (data.type === 'Liability' || data.type === 'Equity' || data.type === 'Revenue') {
          // Liability/Equity/Revenue should have positive or zero balance
          if (balance < 0) {
            errors.push(`"${data.type}" accounts cannot have negative opening balance. Please enter a positive amount.`);
          }
        }
      }

      return errors;
    }

    // ============================================================
    // CREATE ACCOUNT
    // ============================================================
    static async create(data) {
      // ─── ✅ Validate data ──────────────────────────────────────
      const errors = this.validateAccountData(data);
      if (errors.length > 0) {
        throw new Error(errors.join('; '));
      }

      // ─── Auto-calculate balanceType ────────────────────────────
      let balanceType = 'Debit';
      if (CREDIT_BALANCE_TYPES.includes(data.type)) {
        balanceType = 'Credit';
      }

      const accountData = {
        code: data.code,
        name: data.name,
        type: data.type,
        parentAccount: data.parentAccount || '',
        openingBalance: data.openingBalance || 0,
        currentBalance: data.openingBalance || 0,
        balanceType: balanceType,
        description: data.description || '',
        taxCode: data.taxCode || 'N/A',
        isActive: data.isActive !== undefined ? data.isActive : true,
        createdBy: data.createdBy
      };

      return await prisma.chartOfAccount.create({
        data: accountData,
        include: {
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });
    }

    // ============================================================
    // UPDATE ACCOUNT - ✅ Fixed with validation
    // ============================================================
    static async update(id, data) {
      // ─── Get existing account ──────────────────────────────────
      const existing = await prisma.chartOfAccount.findUnique({
        where: { id }
      });

      if (!existing) return null;

      // ─── Merge data for validation ─────────────────────────────
      const mergedData = { ...existing, ...data };
      
      // ─── ✅ Validate updated data ──────────────────────────────
      const errors = this.validateAccountData(mergedData);
      if (errors.length > 0) {
        throw new Error(errors.join('; '));
      }

      // ─── Recalculate balanceType if type changed ───────────────
      if (data.type) {
        let balanceType = 'Debit';
        if (CREDIT_BALANCE_TYPES.includes(data.type)) {
          balanceType = 'Credit';
        }
        data.balanceType = balanceType;
      }

      return await prisma.chartOfAccount.update({
        where: { id },
        data,
        include: {
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });
    }

    // ============================================================
    // ✅ FIX: Update account type with balance check
    // ============================================================
    static async updateType(id, newType, userId) {
      const account = await prisma.chartOfAccount.findFirst({
        where: { id, createdBy: userId }
      });

      if (!account) return null;

      // ─── Check if type change affects balance sign ─────────────
      const oldType = account.type;
      const oldIsDebitType = DEBIT_BALANCE_TYPES.includes(oldType);
      const newIsDebitType = DEBIT_BALANCE_TYPES.includes(newType);
      
      // If moving between Debit-type and Credit-type accounts
      if (oldIsDebitType !== newIsDebitType && account.currentBalance !== 0) {
        throw new Error(
          `Cannot change type from "${oldType}" to "${newType}" with non-zero balance. ` +
          `Current balance: ${account.currentBalance}. ` +
          `Please reset balance to zero first or use the "fix" endpoint.`
        );
      }

      // ─── Validate new type ─────────────────────────────────────
      if (!VALID_ACCOUNT_TYPES.includes(newType)) {
        throw new Error(`Invalid account type: ${newType}`);
      }

      // ─── Calculate new balanceType ─────────────────────────────
      let balanceType = 'Debit';
      if (CREDIT_BALANCE_TYPES.includes(newType)) {
        balanceType = 'Credit';
      }

      return await prisma.chartOfAccount.update({
        where: { id },
        data: { 
          type: newType,
          balanceType: balanceType
        }
      });
    }

    // ============================================================
    // GET ALL ACCOUNTS WITH FILTERS
    // ============================================================
    static async findAll(filter = {}, options = {}) {
      const { skip, take, orderBy = { code: 'asc' } } = options;
      
      return await prisma.chartOfAccount.findMany({
        where: filter,
        skip,
        take,
        orderBy,
        include: {
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });
    }

    // ============================================================
    // COUNT ACCOUNTS
    // ============================================================
    static async count(filter = {}) {
      return await prisma.chartOfAccount.count({ where: filter });
    }

    // ============================================================
    // FIND ACCOUNT BY ID
    // ============================================================
    static async findById(id) {
      return await prisma.chartOfAccount.findUnique({
        where: { id },
        include: {
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });
    }

    // ============================================================
    // FIND ACCOUNT BY CODE AND CREATOR
    // ============================================================
    static async findByCodeAndCreator(code, createdBy) {
      return await prisma.chartOfAccount.findUnique({
        where: {
          code_createdBy: {
            code,
            createdBy
          }
        }
      });
    }

    // ============================================================
    // DELETE ACCOUNT
    // ============================================================
    static async delete(id) {
      return await prisma.chartOfAccount.delete({
        where: { id }
      });
    }

    // ============================================================
    // GET ACCOUNT SUMMARY
    // ============================================================
    static async getSummary(accounts) {
      const summary = {
        Assets: 0,
        Liabilities: 0,
        Equity: 0,
        Income: 0,
        Expenses: 0,
        totalBalance: 0
      };

      accounts.forEach((account) => {
        if (summary[account.type] !== undefined) {
          summary[account.type] += account.currentBalance;
        }
        summary.totalBalance += account.currentBalance;
      });

      return summary;
    }

    // ============================================================
    // GET ACCOUNT BY TYPE
    // ============================================================
    static async findByType(type, createdBy) {
      return await prisma.chartOfAccount.findMany({
        where: {
          type,
          createdBy,
          isActive: true
        },
        orderBy: { code: 'asc' }
      });
    }

    // ============================================================
    // GET ACCOUNTS WITH BALANCE
    // ============================================================
    static async getAccountsWithBalance(createdBy) {
      const accounts = await prisma.chartOfAccount.findMany({
        where: {
          createdBy,
          isActive: true
        },
        orderBy: { code: 'asc' }
      });

      const summary = await this.getSummary(accounts);
      return { accounts, summary };
    }

    // ============================================================
    // UPDATE BALANCE
    // ============================================================
    static async updateBalance(id, amount, type = 'add') {
      const account = await prisma.chartOfAccount.findUnique({
        where: { id }
      });

      if (!account) return null;

      let newBalance = account.currentBalance;
      if (type === 'add') {
        newBalance += amount;
      } else if (type === 'subtract') {
        newBalance -= amount;
      } else if (type === 'set') {
        newBalance = amount;
      }

      return await prisma.chartOfAccount.update({
        where: { id },
        data: { currentBalance: newBalance }
      });
    }

    // ============================================================
    // ARCHIVE/DEACTIVATE ACCOUNT
    // ============================================================
    static async toggleActive(id, isActive) {
      return await prisma.chartOfAccount.update({
        where: { id },
        data: { isActive }
      });
    }

    // ============================================================
    // SEARCH ACCOUNTS
    // ============================================================
    static async search(query, createdBy, options = {}) {
      const { skip, take } = options;

      const filter = {
        createdBy,
        OR: [
          { code: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } }
        ]
      };

      const accounts = await prisma.chartOfAccount.findMany({
        where: filter,
        skip,
        take,
        orderBy: { code: 'asc' },
        include: {
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });

      const total = await prisma.chartOfAccount.count({ where: filter });

      return { accounts, total };
    }

    // ============================================================
    // ✅ FIX: Fix account type (Admin/Dev only)
    // ============================================================
    static async fixAccountType(id, newType, userId) {
      const account = await prisma.chartOfAccount.findFirst({
        where: { id, createdBy: userId }
      });

      if (!account) return null;

      // ─── Force change type even with balance ──────────────────
      // This should be used with caution - only by admin/dev
      let balanceType = 'Debit';
      if (CREDIT_BALANCE_TYPES.includes(newType)) {
        balanceType = 'Credit';
      }

      return await prisma.chartOfAccount.update({
        where: { id },
        data: { 
          type: newType,
          balanceType: balanceType
        }
      });
    }
  }

  module.exports = ChartOfAccountModel;