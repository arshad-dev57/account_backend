# Implementation Plan

## Overview

Implement full Fiscal Year support across the Node.js/Express/Prisma accounting ERP backend. The User IS the Company boundary. Implementation proceeds in waves: schema first, then utilities, then controller/routes, then registration, then transaction guards, then report updates, then Mongoose migrations.

## Tasks

- [x] 1. Update prisma/schema.prisma — add FiscalYear model, FiscalYearAuditLog model, fiscalYearId FK on all transaction tables, type field on JournalEntry, and User relations
  - Add `FiscalYear` model with fields: id (UUID), userId, name (max 100 chars), startDate, endDate, status (default "Open"), closedAt (nullable), closedBy (nullable), periodType (nullable String reserved for future use), createdAt, updatedAt; unique constraint on (userId, name); composite index on (userId, startDate, endDate)
  - Add `FiscalYearAuditLog` model with fields: id (UUID), fiscalYearId, userId, action, details (Json nullable), ipAddress (nullable), createdAt
  - Add nullable `fiscalYearId` String field + `@@index([fiscalYearId])` to models: JournalEntry, Expense, Income, PaymentReceived, PaymentMade, SalesInvoice, PurchaseInvoice, CreditNote, PurchaseReturn, Transaction, FixedAsset, Loan, SalesPaymentReceived, PurchasePaymentMake, AccountsReceivable, AccountsPayable
  - Add `type` field (String, default "Normal") to JournalEntry model
  - Add `fiscalYears FiscalYear[]` and `fiscalYearAuditLogs FiscalYearAuditLog[]` relations to User model
  - Run `npx prisma migrate dev --name add_fiscal_year` to generate and apply migration
  - **Requirements**: Req 1, Req 2, Req 9, Req 14

- [x] 2. Create utils/fiscalYearHelper.js with four exported functions
  - `resolveFiscalYearId(userId, postingDate)` — queries FiscalYear where userId matches, startDate <= postingDate <= endDate; returns id or null; swallows DB errors and returns null (Req 2.3–2.5)
  - `getFiscalYearDateRange(fiscalYear)` — returns { startDate, endDate } from a FiscalYear record (Req 8)
  - `lookupActiveFiscalYear(userId)` — returns Open FiscalYear where startDate <= now <= endDate, or null (Req 8.3)
  - `getFiscalYearOrCalendarFallback(userId, startDateParam, endDateParam, fiscalYearId)` — priority: fiscalYearId lookup > explicit dates > active FY > current calendar year (Req 8.2–8.4)
  - Each function is clearly separated with no cross-dependency so future FiscalPeriod functions can be added without modification (Req 14.2)
  - **Requirements**: Req 2, Req 8, Req 14

- [x] 3. Create middleware/fiscalYearMiddleware.js with fiscalYearGuard function
  - Export `fiscalYearGuard(userId, postingDate, existingDate)` async function
  - Resolves FiscalYear for postingDate using only userId — never reads fiscalYearId from request body
  - If existingDate is provided, also checks existingDate independently; rejects if EITHER date is in a closed FY
  - When FY status is "Closed", throws a plain Error with message: `Cannot post to a closed fiscal year: <FY name>. This period has been locked.`
  - When no FiscalYear found for the date, returns without error (no-op)
  - **Requirements**: Req 5, Req 10

- [x] 4. Create controllers/fiscalYearController.js with all handlers
  - `createFiscalYear(req, res)` — validates startDate < endDate (400), checks no overlap (409), creates record with status "Open", writes audit log action="Created" with ipAddress, returns 201
  - `listFiscalYears(req, res)` — returns all FiscalYear for req.user.id sorted by startDate desc
  - `getActiveFiscalYear(req, res)` — returns Open FY where startDate <= now <= endDate, or { data: null }
  - `getFiscalYearById(req, res)` — queries with id AND userId; returns 404 on mismatch (never 403)
  - `updateFiscalYear(req, res)` — rejects if Closed (400); validates no overlap; writes "Updated" audit log
  - `closeFiscalYear(req, res)` — full Year-End Close: (1) reject if already Closed (409); (2) Trial Balance pre-check outside transaction — sum JournalLine debits/credits for posted entries in FY range; if |diff| > 0.01 return 400 with totals; (3) inside Prisma $transaction: aggregate Revenue balances via groupBy, aggregate Expense balances via groupBy, calculate Net_Income, create ClosingEntry JournalEntry with type="ClosingEntry", check for duplicate Opening Balance entries case-insensitively, check next FY is Open, create Opening_Balance_Entry JournalEntry with type="OpeningBalance", update FiscalYear status/closedAt/closedBy, write audit logs for Closed+YearEndClosing+OpeningBalanceCreated; return 200 with { closingEntry, openingEntries, netIncome, closedFiscalYear }
  - `reopenFiscalYear(req, res)` — rejects if already Open (400); clears closedAt/closedBy; writes "Reopened" audit log
  - `getAuditLog(req, res)` — returns FiscalYearAuditLog scoped to userId; optional fiscalYearId filter
  - Locate Retained_Earnings_Account by: type="Equity" AND name icontains "retained earnings" AND userId; if not found return 400
  - **Requirements**: Req 3, Req 6, Req 7, Req 9, Req 10

- [x] 5. Create routes/fiscalYearRoutes.js and register in app.js
  - Define routes: GET / → list, POST / → create, GET /active → getActive, GET /audit-log → getAuditLog, GET /:id → getById, PUT /:id → update, POST /:id/close → close, POST /:id/reopen → reopen, GET /:id/audit-log → getAuditLog for specific FY
  - All routes protected with authMiddleware.protect
  - Add `const fiscalYearRoutes = require('./routes/fiscalYearRoutes')` and `app.use('/api/fiscal-year', fiscalYearRoutes)` to app.js
  - **Requirements**: Req 3, Req 13, Req 14

- [x] 6. Modify controllers/userController.js — registration with auto FiscalYear and Retained Earnings
  - Read existing registration handler fully before modifying
  - Accept optional fields: fiscalYearStartDate, fiscalYearEndDate, fiscalYearName from req.body
  - Wrap in Prisma $transaction: user creation + FiscalYear creation + ChartOfAccount (code "3999", name "Retained Earnings", type "Equity", parentAccount "Shareholders Equity") creation
  - If fiscalYearStartDate/endDate provided use them; derive name as "FY startYear-endYear" or "FY year" for same-year ranges; if absent default to Jan 1 – Dec 31 of current year with name "FY year"
  - fiscalYearName field overrides auto-generated name if provided
  - **Requirements**: Req 4

- [-] 7. Add fiscalYearGuard and resolveFiscalYearId to controllers/journalEntryController.js
  - Import fiscalYearGuard from middleware/fiscalYearMiddleware.js and resolveFiscalYearId from utils/fiscalYearHelper.js
  - In createJournalEntry: call fiscalYearGuard(userId, entryDate) at top before any DB write; then resolveFiscalYearId and pass to JournalEntry.create as fiscalYearId
  - In updateJournalEntry (if exists): call fiscalYearGuard(userId, newDate, existingEntry.date) checking both dates
  - In deleteJournalEntry: fetch existing entry date first; call fiscalYearGuard(userId, existing.date)
  - **Requirements**: Req 5

- [-] 8. Add fiscalYearGuard and resolveFiscalYearId to controllers/expenseController.js
  - In createExpense: call fiscalYearGuard(userId, date) at top; resolve and store fiscalYearId on create
  - In updateExpense: call fiscalYearGuard(userId, newDate, existing.date)
  - In deleteExpense: fetch existing; call fiscalYearGuard(userId, existing.date)
  - **Requirements**: Req 5

- [-] 9. Add fiscalYearGuard and resolveFiscalYearId to controllers/incomeController.js
  - In createIncome: call fiscalYearGuard(userId, date) at top; resolve and store fiscalYearId on create
  - In updateIncome: call fiscalYearGuard(userId, newDate, existing.date)
  - In deleteIncome: fetch existing; call fiscalYearGuard(userId, existing.date)
  - **Requirements**: Req 5

- [-] 10. Add fiscalYearGuard and resolveFiscalYearId to controllers/paymentReceivedController.js
  - Guard create (paymentDate), update (both dates), delete (existing paymentDate)
  - Store fiscalYearId on create
  - **Requirements**: Req 5

- [ ] 11. Add fiscalYearGuard and resolveFiscalYearId to controllers/paymentMadeController.js
  - Guard create (paymentDate), update (both dates), delete (existing paymentDate)
  - Store fiscalYearId on create
  - **Requirements**: Req 5

- [~] 12. Add fiscalYearGuard and resolveFiscalYearId to controllers/creditNoteController.js
  - Guard create (date), update (both dates), delete (existing date)
  - Store fiscalYearId on create
  - **Requirements**: Req 5

- [~] 13. Add fiscalYearGuard and resolveFiscalYearId to controllers/fixedAssetController.js
  - Guard create (purchaseDate), update (both dates), delete (existing purchaseDate)
  - Store fiscalYearId on create
  - **Requirements**: Req 5

- [~] 14. Add fiscalYearGuard and resolveFiscalYearId to controllers/loanController.js
  - Guard create (disbursementDate), update (both dates), delete (existing disbursementDate)
  - Store fiscalYearId on create
  - **Requirements**: Req 5

- [~] 15. Add fiscalYearGuard and resolveFiscalYearId to controllers/transactionController.js
  - Guard create (date), update (both dates), delete (existing date)
  - Store fiscalYearId on create
  - **Requirements**: Req 5

- [~] 16. Add fiscalYearGuard and resolveFiscalYearId to warehouse/controller/salesInvoiceController.js
  - Guard create (invoiceDate), update (both dates), delete (existing invoiceDate)
  - Store fiscalYearId on create
  - **Requirements**: Req 5

- [~] 17. Add fiscalYearGuard and resolveFiscalYearId to warehouse/controller/purchaseInvoiceController.js
  - Guard create (invoiceDate), update (both dates), delete (existing invoiceDate)
  - Store fiscalYearId on create
  - **Requirements**: Req 5

- [~] 18. Add fiscalYearGuard and resolveFiscalYearId to warehouse/controller/salesPaymentController.js
  - Guard create/update/delete using payment date field
  - Store fiscalYearId on create
  - **Requirements**: Req 5

- [~] 19. Add fiscalYearGuard and resolveFiscalYearId to warehouse/controller/purchasePaymentController.js
  - Guard create/update/delete using payment date field
  - Store fiscalYearId on create
  - **Requirements**: Req 5

- [~] 20. Add fiscalYearGuard and resolveFiscalYearId to warehouse/controller/purchaseReturnController.js
  - Guard create/update/delete using date field
  - Store fiscalYearId on create
  - **Requirements**: Req 5

- [~] 21. Update controllers/trialBalanceController.js — add fiscalYearId filtering
  - Accept fiscalYearId query param; use getFiscalYearOrCalendarFallback to resolve effective date range
  - Apply date filter to journal entry queries when date range is resolved
  - Do not exclude Opening Balance or Closing Entry journal entries from totals
  - Apply to all existing exported functions (getTrialBalance, getTrialBalanceSummary, etc.)
  - **Requirements**: Req 8

- [~] 22. Update controllers/generalLedgerController.js — add fiscalYearId filtering
  - Accept fiscalYearId query param in getAccountSummaries and getAccountTransactions
  - Use getFiscalYearOrCalendarFallback to resolve date range
  - Opening Balance journal entries are included automatically as they are standard JournalEntry records
  - **Requirements**: Req 8

- [~] 23. Update controllers/balanceSheetController.js and utils/balanceSheetHelper.js — fiscalYearId support
  - In balanceSheetController: accept fiscalYearId param; when provided use FY endDate as asOfDate and FY startDate as period start
  - In buildBalanceSheetFromLedger: replace hardcoded `new Date(reportDate.getFullYear(), 0, 1)` with an explicit startDate parameter; default to start of year if not provided for backward compatibility
  - **Requirements**: Req 8

- [~] 24. Update controllers/reportsController.js — add fiscalYearId to P&L and cash flow
  - Accept fiscalYearId query param in getProfitLossStatement and any cash flow functions
  - Use getFiscalYearOrCalendarFallback to resolve effective date range before getDateRange logic
  - When fiscalYearId resolves, override the period's start/end dates
  - **Requirements**: Req 8

- [~] 25. Update controllers/plReportController.js — add fiscalYearId param
  - Accept fiscalYearId query param in getProfitLossStatement, getSummary, getTrendData, getCashFlowStatement, getBalanceSheet
  - Use getFiscalYearOrCalendarFallback to resolve date range
  - **Requirements**: Req 8

- [~] 26. Update controllers/dashboardController.js — scope to active fiscal year
  - In getDashboardSummary: call lookupActiveFiscalYear(userId); if found use FY startDate as the floor for revenue/expense/KPI queries instead of start of current month; fall back to current month/year when no active FY
  - **Requirements**: Req 8

- [~] 27. Update controllers/accountsReceivableController.js — add fiscalYearId param
  - Accept fiscalYearId query param in list/summary endpoints
  - Use getFiscalYearOrCalendarFallback to resolve date range filter on invoice date
  - **Requirements**: Req 8

- [~] 28. Update controllers/accountsPayableController.js — add fiscalYearId param
  - Accept fiscalYearId query param in list/summary endpoints
  - Use getFiscalYearOrCalendarFallback to resolve date range filter
  - **Requirements**: Req 8

- [~] 29. Rewrite controllers/cashFlowController.js from Mongoose to Prisma with fiscalYearId filtering
  - Remove all Mongoose/MongoDB syntax ($gte, $lte, $eq, Model.find() etc.)
  - Replace with prisma.income.findMany, prisma.expense.findMany, prisma.bankAccount etc.
  - Add fiscalYearId query param; use getFiscalYearOrCalendarFallback for date range
  - Preserve all existing cash flow categories (operating, investing, financing)
  - **Requirements**: Req 8

- [~] 30. Rewrite controllers/equityController.js from Mongoose to Prisma with fiscalYearId filtering
  - Remove all Mongoose/MongoDB syntax
  - Replace with Prisma queries for chartOfAccount, journalEntry
  - Add fiscalYearId query param; use getFiscalYearOrCalendarFallback for date range
  - Preserve existing equity account CRUD and journal entry creation logic
  - **Requirements**: Req 8

## Notes

- Tasks 1–6 must execute in order (each depends on the previous).
- Tasks 7–20 can execute in parallel after Task 3 (fiscalYearMiddleware) and Task 1 (schema migration) are complete.
- Tasks 21–28 can execute in parallel after Task 2 (fiscalYearHelper) is complete.
- Tasks 29–30 can execute in parallel after Task 2 is complete.
- All controller modifications must call fiscalYearGuard at the TOP of the handler, before any DB reads or writes.
- Never reset currentBalance on ChartOfAccount — year-end close is journal-entry based only.
- The fiscalYearId FK is nullable on all tables for backward compatibility.

## Task Dependency Graph

```
1 (schema) → 2 (helper) → 3 (middleware) → 4 (controller) → 5 (routes+app)
                                         ↘
                                           6 (registration)
                         ↓ (after 3 + 1 migration)
          7,8,9,10,11,12,13,14,15,16,17,18,19,20 (transaction guards — parallel)
         ↓ (after 2)
          21,22,23,24,25,26,27,28 (report controllers — parallel)
          29,30 (mongoose migrations — parallel)
```
