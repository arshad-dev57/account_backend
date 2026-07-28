# Requirements Document

## Introduction

This feature adds full, professional-grade Fiscal Year support to the Node.js/Express accounting ERP backend, following the standards of SAP, Oracle NetSuite, Microsoft Dynamics, Odoo, and QuickBooks.

The current system uses the authenticated User as the sole multi-tenancy boundary (all records carry `createdBy` and `userId` referencing `User.id`). There is no Company model. Therefore, the User IS the Company in this system — each User account represents one independent company with its own isolated accounting data. Fiscal Year configuration must belong to the User-as-Company scope. It must NOT be stored as per-individual-user preferences, and it must never be manually selected by end users on individual transactions.

The implementation introduces:
- A dedicated `FiscalYear` Prisma model owned by the User (company boundary)
- A `fiscalYearId` foreign key on every accounting transaction for efficient filtering
- Automatic fiscal year assignment on every transaction based on the transaction date
- Closed fiscal year protection across all transactional controllers
- Professional year-end closing with retained earnings transfer and opening balance carry-forward
- Fiscal-year-aware filtering across all report controllers
- An audit log for every fiscal year lifecycle event
- Full backward compatibility with all existing accounting logic

**Controllers confirmed to use Mongoose (not Prisma) — must be migrated as part of this feature:**
- `controllers/cashFlowController.js`
- `controllers/equityController.js`

**Out of scope:** Frontend/UI changes. All changes are backend only.

---

## Glossary

- **User_Company**: In this system, a User record IS the company. All accounting data is scoped to `userId`. The term "company" refers to a User account throughout this document.
- **FiscalYear**: A dedicated Prisma model representing a 12-month (or custom) accounting period owned by a User_Company, with a status of `Open` or `Closed`.
- **FY_Name**: A human-readable label for a fiscal year, e.g., `"FY 2025-2026"`.
- **Active_FiscalYear**: The single `FiscalYear` record belonging to a User_Company whose `status` is `"Open"` and whose date range contains today's date.
- **fiscalYearId**: A foreign key field added to every accounting transaction table, referencing the `FiscalYear` record that the transaction belongs to.
- **Year_End_Close**: The accounting process of zeroing all Revenue and Expense account balances, computing net profit/loss, posting it to the Retained Earnings equity account, and carrying forward Asset, Liability, and Equity balances as opening entries in the new fiscal year.
- **Retained_Earnings_Account**: An Equity-type `ChartOfAccount` record (code `3999`, name `"Retained Earnings"`) that receives net profit/loss during year-end close.
- **Opening_Balance_Entry**: A `JournalEntry` with description prefixed `"Opening Balance - FY <name>"` that initialises account balances at the start of a new fiscal year.
- **Closing_Entry**: A `JournalEntry` with description `"Year-End Closing Entry - FY <name>"` that zeroes Revenue and Expense accounts and credits/debits Retained Earnings.
- **Transactional_Controller**: Any controller that creates financial records with a date field, including journal entries, expenses, income, payments received, payments made, sales invoices, purchase invoices, credit notes, purchase returns, bank transactions, fixed assets, loans, and equity entries.
- **FiscalYearAuditLog**: A dedicated Prisma model recording every lifecycle event on a FiscalYear record.
- **Posting_Date**: The `date` field on a transaction that determines which fiscal year it belongs to. Field names vary: `date` (JournalEntry, Expense, Income, Transaction), `paymentDate` (PaymentReceived, PaymentMade), `invoiceDate` (SalesInvoice, PurchaseInvoice), `purchaseDate` (FixedAsset), `disbursementDate` (Loan), `date` (CreditNote), `date` (PurchaseReturn).

---

## Requirements

### Requirement 1: FiscalYear Model and Schema

**User Story:** As a company owner, I want a dedicated FiscalYear entity per company so that all users of the same company share the same accounting periods and no individual user can have their own fiscal year configuration.

#### Acceptance Criteria

1. THE System SHALL create a new Prisma model `FiscalYear` with fields: `id` (UUID), `userId` (String, storing the owning User's id), `name` (String, max 100 characters, e.g., `"FY 2025-2026"`), `startDate` (DateTime, stored at midnight UTC), `endDate` (DateTime, stored at 23:59:59.999 UTC of the last day), `status` (String, default `"Open"`), `closedAt` (DateTime, nullable), `closedBy` (String, nullable, stores the closing User's id as a plain string with no enforced FK relation), `createdAt` (DateTime), `updatedAt` (DateTime).
2. THE `FiscalYear` model SHALL enforce a unique constraint on `(userId, name)` at the database level so no two fiscal years for the same user share the same name.
3. WHEN a new `FiscalYear` is created or updated, THE System SHALL validate at the application level that its `startDate`–`endDate` range does not overlap with any existing `FiscalYear` for the same `userId`. IF an overlap is detected, THE System SHALL return a 409 response with a message identifying the conflicting fiscal year.
4. WHEN a `status` value other than `"Open"` or `"Closed"` is submitted to any fiscal year endpoint, THE System SHALL return a 400 response rejecting the value.
5. THE `startDate` and `endDate` fields SHALL be stored as full DateTime values. WHEN performing Active_FiscalYear lookups, THE System SHALL compare using `startDate <= now <= endDate`, where `now` is the current UTC timestamp, to avoid time-zone boundary bugs.
6. A User_Company SHALL be allowed to have multiple `FiscalYear` records over time to represent historical and future accounting periods.
7. THE `FiscalYear` model SHALL NOT be stored as a field on the `User` model. No `fiscalYearStartMonth`, `fiscalYearStartDay`, or `fiscalYearStatus` fields shall be added to the `User` table.

---

### Requirement 2: fiscalYearId on All Transaction Tables

**User Story:** As a developer, I want every accounting transaction to carry a `fiscalYearId` so that reports can filter by fiscal year using a simple indexed foreign key lookup rather than recomputing date ranges on every query.

#### Acceptance Criteria

1. THE System SHALL add a nullable `fiscalYearId` (FK to `FiscalYear`) field to each of the following Prisma models: `JournalEntry`, `Expense`, `Income`, `PaymentReceived`, `PaymentMade`, `SalesInvoice`, `PurchaseInvoice`, `CreditNote`, `PurchaseReturn`, `Transaction`, `FixedAsset`, `Loan`, `SalesPaymentReceived`, `PurchasePaymentMake`, `AccountsReceivable`, `AccountsPayable`.
2. THE `fiscalYearId` field SHALL be nullable to maintain backward compatibility with existing records that predate this feature.
3. WHEN a new transaction is created, THE System SHALL automatically resolve the correct `FiscalYear` record by looking up the `FiscalYear` where `userId = req.user.id`, `startDate <= Posting_Date`, and `endDate >= Posting_Date` (using the Posting_Date field as defined in the Glossary for each model: `date` for JournalEntry, Expense, Income, Transaction, CreditNote, PurchaseReturn; `paymentDate` for PaymentReceived, PaymentMade; `invoiceDate` for SalesInvoice, PurchaseInvoice; `purchaseDate` for FixedAsset; `disbursementDate` for Loan), and assign its `id` to `fiscalYearId`.
4. IF no matching `FiscalYear` is found for the Posting_Date, THE System SHALL allow the transaction to proceed with `fiscalYearId = null`.
5. IF a database error occurs during the `FiscalYear` lookup, THE System SHALL allow the transaction to proceed with `fiscalYearId = null` rather than blocking the transaction.
6. THE `fiscalYearId` field SHALL have a database index on each transaction table for efficient report filtering.

---

### Requirement 3: FiscalYear CRUD and Configuration API

**User Story:** As a company owner, I want to create, view, and manage fiscal years through API endpoints so that I can configure my accounting periods before the year begins.

#### Acceptance Criteria

1. WHEN a user sends `POST /api/fiscal-year` with `{ name, startDate, endDate }`, THE `fiscalYearController` SHALL create a new `FiscalYear` record with `status = "Open"`, associate it with `req.user.id`, and return a 201 response with the created record.
2. IF `startDate` is after `endDate`, THE System SHALL return a 400 response with the message `"startDate must be before endDate"`.
3. IF a `FiscalYear` already exists for this user with overlapping `startDate`/`endDate`, THE System SHALL return a 409 response with the message `"A fiscal year already exists for this date range"`.
4. WHEN a user sends `GET /api/fiscal-year`, THE `fiscalYearController` SHALL return all `FiscalYear` records for the authenticated user, sorted by `startDate` descending.
5. WHEN a user sends `GET /api/fiscal-year/active`, THE `fiscalYearController` SHALL return the single `FiscalYear` record for the authenticated user whose `status = "Open"` and whose date range contains today's date, or `null` if none exists.
6. WHEN a user sends `GET /api/fiscal-year/:id`, THE `fiscalYearController` SHALL return the specified `FiscalYear` record if it belongs to the authenticated user, or a 404 if not found.
7. WHEN a user sends `PUT /api/fiscal-year/:id` on an `Open` fiscal year, THE System SHALL allow updating `name`, `startDate`, and `endDate`, and return the updated record.
8. IF a user attempts to update a `Closed` fiscal year, THE System SHALL return a 400 response with the message `"Cannot modify a closed fiscal year"`.

---

### Requirement 4: Automatic FiscalYear Creation During Registration

**User Story:** As a new user registering a company, I want the system to automatically create my first fiscal year so that I can start recording transactions immediately without manual setup.

#### Acceptance Criteria

1. WHEN a new `User` is created via the registration flow, THE System SHALL automatically create the first `FiscalYear` record for that user.
2. IF the registration request body contains `fiscalYearStartDate` and `fiscalYearEndDate` fields, THE System SHALL use those values to create the first `FiscalYear` (name derived as `"FY <startYear>-<endYear>"` or `"FY <year>"` for calendar-year ranges). IF those fields are absent or null, THE System SHALL default to `startDate = Jan 1` and `endDate = Dec 31` of the current calendar year, with `name = "FY <year>"`.
3. THE System SHALL accept an optional `fiscalYearName` field in the registration body to override the auto-generated name; if not provided, the name is auto-generated from the date range.
4. THE first `FiscalYear` creation SHALL occur within the same database transaction as user creation so that no user exists without a fiscal year.
5. THE System SHALL automatically create a default `Retained Earnings` `ChartOfAccount` (code `3999`, type `"Equity"`, parentAccount `"Shareholders Equity"`, name `"Retained Earnings"`) for the new user if one does not already exist, within the same registration transaction.

---

### Requirement 5: Closed Fiscal Year Protection

**User Story:** As a company owner, I want the system to block any financial transaction whose posting date falls in a closed fiscal year so that closed-period data remains immutable and auditable.

#### Acceptance Criteria

1. WHEN any Transactional_Controller attempts to create or post a transaction and the resolved `FiscalYear` for the transaction's Posting_Date has `status = "Closed"`, THE System SHALL return a 400 response with a message that includes the fiscal year name and states that the period has been locked, without persisting any part of the transaction.
2. THE protection SHALL apply to all of the following operations:
   - Creating a `JournalEntry`
   - Posting a `JournalEntry`
   - Editing (PUT/PATCH) a `JournalEntry` whose existing Posting_Date OR new Posting_Date falls in a closed fiscal year
   - Deleting a `JournalEntry` whose Posting_Date falls in a closed fiscal year
   - Creating an `Expense`
   - Editing (PUT/PATCH) an `Expense` whose `date` falls in a closed fiscal year
   - Deleting an `Expense` whose `date` falls in a closed fiscal year
   - Creating an `Income`
   - Editing (PUT/PATCH) an `Income` record whose `date` falls in a closed fiscal year
   - Deleting an `Income` record whose `date` falls in a closed fiscal year
   - Creating a `SalesInvoice`
   - Editing (PUT/PATCH) a `SalesInvoice` whose `invoiceDate` falls in a closed fiscal year
   - Deleting a `SalesInvoice` whose `invoiceDate` falls in a closed fiscal year
   - Creating a `PurchaseInvoice`
   - Editing (PUT/PATCH) a `PurchaseInvoice` whose `invoiceDate` falls in a closed fiscal year
   - Deleting a `PurchaseInvoice` whose `invoiceDate` falls in a closed fiscal year
   - Recording a `PaymentReceived`
   - Editing (PUT/PATCH) a `PaymentReceived` whose `paymentDate` falls in a closed fiscal year
   - Deleting a `PaymentReceived` whose `paymentDate` falls in a closed fiscal year
   - Recording a `PaymentMade`
   - Editing (PUT/PATCH) a `PaymentMade` whose `paymentDate` falls in a closed fiscal year
   - Deleting a `PaymentMade` whose `paymentDate` falls in a closed fiscal year
   - Recording a `SalesPaymentReceived`
   - Creating or modifying a `SalesPaymentReceived` whose payment date falls in a closed fiscal year
   - Recording a `PurchasePaymentMake`
   - Creating or modifying a `PurchasePaymentMake` whose payment date falls in a closed fiscal year
   - Creating a `CreditNote`
   - Creating a `PurchaseReturn`
   - Editing (PUT/PATCH) a `PurchaseReturn` whose `date` falls in a closed fiscal year
   - Deleting a `PurchaseReturn` whose `date` falls in a closed fiscal year
   - Creating a `Transaction` (bank transaction)
   - Purchasing a `FixedAsset`
   - Creating a `Loan`
   - Any `StockMovement` or warehouse inventory operation that auto-generates a `JournalEntry` dated in a closed fiscal year
3. WHEN no `FiscalYear` record exists for the transaction date (i.e., `fiscalYearId` resolves to `null`), THE System SHALL allow the transaction to proceed without restriction.
4. THE System SHALL implement the fiscal year status check as a shared helper function `fiscalYearGuard(userId, postingDate)` in `middleware/fiscalYearMiddleware.js`. WHEN the matching `FiscalYear` has `status = "Closed"`, THE function SHALL throw a standardised error object that controllers catch and convert to the 400 response described in criterion 1.
5. IF the `fiscalYearGuard` function determines the fiscal year is closed, THE System SHALL not write any data to the database for that request — the entire transaction is rejected with no partial side-effects.
6. THE `fiscalYearGuard` function in `middleware/fiscalYearMiddleware.js` SHALL accept a second optional parameter `existingDate` (for edit/delete operations) so that both the existing record's Posting_Date AND the new Posting_Date (if changed) are each checked independently — if either falls in a closed fiscal year, the operation is rejected.

---

### Requirement 6: Year-End Close

**User Story:** As a company owner, I want to perform a professional year-end close so that Revenue and Expense accounts are zeroed, Net Profit/Loss is transferred to Retained Earnings, and the new fiscal year starts with correct opening balances for Assets, Liabilities, and Equity.

#### Acceptance Criteria

1. BEFORE executing any year-end close operations, THE System SHALL perform a Trial Balance validation: it SHALL sum all `JournalLine` debits and all `JournalLine` credits for posted journal entries within the fiscal year's `startDate`–`endDate` range. IF the absolute difference between total debits and total credits exceeds 0.01 (accounting for floating-point tolerance), THE System SHALL return a 400 response with the message `'Cannot close fiscal year: Trial Balance is not balanced. Total Debits: <X>, Total Credits: <Y>, Difference: <Z>'` and SHALL NOT proceed with any closing operations.
2. WHEN a user sends `POST /api/fiscal-year/:id/close`, THE `fiscalYearController` SHALL perform the complete year-end close for the specified fiscal year.
3. IF the fiscal year's `status` is already `"Closed"`, THE System SHALL return a 409 response and perform no further operations.
4. THE close operation SHALL be rejected with a 400 response if another fiscal year for the same user has overlapping dates and is still `"Open"`, as this indicates the sequence is out of order.
5. DURING year-end close, THE System SHALL aggregate the net balance of all `Revenue`-type `ChartOfAccount` records by summing `JournalLine` credits minus debits for journal entries with `status = "Posted"` and `date` within the fiscal year's `startDate`–`endDate`. Accounts with a net balance of zero SHALL be excluded from the closing entry lines.
6. DURING year-end close, THE System SHALL aggregate the net balance of all `Expense`-type `ChartOfAccount` records by summing `JournalLine` debits minus credits for journal entries with `status = "Posted"` and `date` within the fiscal year's `startDate`–`endDate`. Accounts with a net balance of zero SHALL be excluded from the closing entry lines.
7. THE System SHALL calculate `Net_Income = total Revenue net balance − total Expense net balance`.
8. THE System SHALL create a single `Closing_Entry` `JournalEntry` with description `"Year-End Closing Entry - FY <name>"`, status `"Posted"`, dated on the fiscal year's `endDate`, and lines that: debit each Revenue account with a positive net balance (to zero its credit balance), credit each Expense account with a positive net balance (to zero its debit balance), and post the Net_Income difference to the Retained_Earnings_Account (credit if Net_Income is positive, debit if Net_Income is negative).
9. THE System SHALL locate the `Retained_Earnings_Account` by querying for a `ChartOfAccount` where `userId = req.user.id`, `type = "Equity"`, and `name` matches a case-insensitive contains search for `"retained earnings"`. IF none is found, THE System SHALL return a 400 response with a message instructing the user to create a Retained Earnings equity account, and SHALL NOT persist any part of the close operation.
10. AFTER creating the Closing_Entry, THE System SHALL create a single Opening_Balance_Entry `JournalEntry` for the next fiscal year (if one exists with `startDate` immediately following this fiscal year's `endDate`) carrying forward: all `Asset`-type accounts at their closing balances as debits, all `Liability`-type accounts at their closing balances as credits, all `Equity`-type accounts at their closing balances as credits. IF no next fiscal year exists, THE System SHALL skip Opening_Balance_Entry creation without error.
11. BEFORE creating Opening_Balance_Entry records, THE System SHALL check for an existing `JournalEntry` whose description starts with `"Opening Balance - FY <next_fy_name>"` (case-insensitive prefix match) for the same `userId`. IF one already exists, THE System SHALL skip creating new opening entries and SHALL NOT create duplicates. THE System SHALL ALSO verify that the target next `FiscalYear` has `status = 'Open'`; IF the next fiscal year is already `'Closed'`, THE System SHALL skip Opening_Balance_Entry creation and log a warning in the audit log without failing the entire close operation.
12. ALL operations (Closing_Entry creation, Opening_Balance_Entry creation, `FiscalYear.status` update to `"Closed"`, `FiscalYear.closedAt` timestamp, `FiscalYear.closedBy` assignment to `req.user.id`, and audit log entries) SHALL execute atomically within a single Prisma `$transaction`. IF any step fails, ALL changes SHALL be rolled back.
13. ON success, THE System SHALL return a 200 response with `{ closingEntry, openingEntries, netIncome, closedFiscalYear }`.

---

### Requirement 7: Reopen a Closed Fiscal Year

**User Story:** As a company owner, I want to be able to reopen a closed fiscal year in exceptional cases so that corrections can be made under strict audit control.

#### Acceptance Criteria

1. WHEN a user sends `POST /api/fiscal-year/:id/reopen`, THE `fiscalYearController` SHALL set the fiscal year's `status` back to `"Open"`, clear `closedAt` and `closedBy`, and return the updated record.
2. IF the fiscal year is already `"Open"`, THE System SHALL return a 400 response with the message `"Fiscal year is already open"`.
3. WHEN a fiscal year is reopened, THE System SHALL log the reopen event to `FiscalYearAuditLog` with `action = "Reopened"`.

---

### Requirement 8: Fiscal-Year-Aware Report Filtering

**User Story:** As a company owner, I want all financial reports to support filtering by fiscal year so that I can view period-specific data aligned with my company's accounting calendar, with the active fiscal year as the default.

#### Acceptance Criteria

1. THE following report endpoints SHALL accept an optional `fiscalYearId` query parameter: `GET /api/trial-balance`, `GET /api/general-ledger/accounts`, `GET /api/general-ledger/:accountId/transactions`, `GET /api/balance-sheet`, `GET /api/reports/profit-loss` (reportsController), `GET /api/warehouse/reports/profit-loss` (plReportController), `GET /api/reports/cash-flow`, `GET /api/accounts-receivable`, `GET /api/accounts-payable`.
2. WHEN a `fiscalYearId` is provided, THE System SHALL look up the `FiscalYear` record, extract its `startDate` and `endDate`, and use those as the date filter for the report query, ignoring any separately provided `startDate`/`endDate` parameters.
3. WHEN no `fiscalYearId` is provided and no `startDate`/`endDate` are provided, THE System SHALL default to the Active_FiscalYear's date range for the authenticated user. IF no Active_FiscalYear exists, THE System SHALL fall back to the current calendar year.
4. WHEN explicit `startDate`/`endDate` parameters are provided without `fiscalYearId`, THE System SHALL use those dates (preserving backward compatibility).
5. THE Balance Sheet report SHALL use the fiscal year's `endDate` as the "as of" date when a `fiscalYearId` is provided, replacing the existing `asOfDate` parameter.
6. THE `utils/balanceSheetHelper.js` SHALL be updated to accept `startDate` and `endDate` parameters so it computes retained earnings from income/expense within the fiscal year range rather than hardcoding the calendar year.
7. THE `controllers/cashFlowController.js` SHALL be migrated from Mongoose to Prisma and updated to support `fiscalYearId` filtering.
8. THE `controllers/equityController.js` SHALL be migrated from Mongoose to Prisma and updated to support `fiscalYearId` filtering.
9. WHEN an Opening_Balance_Entry `JournalEntry` is created during year-end close, THE System SHALL ensure that `JournalLine` records for that entry are created with valid `accountId` references so that the General Ledger report (`GET /api/general-ledger/:accountId/transactions`) automatically includes the opening balance lines without any additional processing.
10. THE Trial Balance report SHALL include Opening_Balance_Entry journal entries in its debit/credit calculations — there SHALL be no special exclusion of opening balance entries from Trial Balance totals except for the existing `hasOBEntry` de-duplication logic already present in `trialBalanceController.js`.

---

### Requirement 9: FiscalYear Audit Log

**User Story:** As a company owner, I want every fiscal year lifecycle action to be recorded in an audit log so that I have a complete, tamper-evident history of who did what and when.

#### Acceptance Criteria

1. THE System SHALL create a `FiscalYearAuditLog` Prisma model with fields: `id` (UUID), `fiscalYearId` (FK to FiscalYear), `userId` (FK to User), `action` (String), `details` (Json, nullable), `ipAddress` (String, nullable), `createdAt` (DateTime).
2. THE `action` field SHALL record one of: `"Created"`, `"Updated"`, `"Closed"`, `"Reopened"`, `"YearEndClosing"`, `"OpeningBalanceCreated"`.
3. THE `details` JSON field SHALL capture the before/after state or relevant metadata for each action (e.g., for `"Closed"`: `{ netIncome, closingEntryId, openingEntriesCount }`).
4. WHEN a `FiscalYear` is created, THE System SHALL write an audit log entry with `action = "Created"`.
5. WHEN a `FiscalYear` is updated, THE System SHALL write an audit log entry with `action = "Updated"` and the changed fields in `details`.
6. WHEN a `FiscalYear` is closed, THE System SHALL write audit log entries with `action = "Closed"`, `action = "YearEndClosing"`, and `action = "OpeningBalanceCreated"` within the same transaction.
7. WHEN a `FiscalYear` is reopened, THE System SHALL write an audit log entry with `action = "Reopened"`.
8. THE `ipAddress` SHALL be extracted from `req.ip` or `req.headers['x-forwarded-for']` and stored if available.
9. THE audit log SHALL be append-only. No update or delete operations shall be permitted on `FiscalYearAuditLog` records.

---

### Requirement 10: Multi-Tenant Isolation

**User Story:** As a company owner, I want complete isolation of my fiscal years and accounting data from all other companies so that no data leakage or cross-company reference is possible.

#### Acceptance Criteria

1. EVERY `FiscalYear` record SHALL have a `userId` field. ALL queries to `FiscalYear` SHALL include `WHERE userId = req.user.id`.
2. THE `fiscalYearId` assigned to a transaction SHALL always reference a `FiscalYear` that belongs to the same `userId` as the transaction. THE System SHALL validate this before assignment.
3. IF a `fiscalYearId` from a different user is passed in a request body, THE System SHALL ignore it and resolve the correct fiscal year from the authenticated user's own records.
4. ALL `FiscalYearAuditLog` queries SHALL be scoped to `userId = req.user.id`.
5. THE `GET /api/fiscal-year` endpoint SHALL never return fiscal year records belonging to a different user.
6. THE `fiscalYearController` SHALL verify ownership on every route that accepts a `:id` parameter (GET by id, PUT, POST close, POST reopen) by querying `FiscalYear` with both `id = req.params.id` AND `userId = req.user.id`. IF the record is not found or belongs to a different user, THE System SHALL return a 404 response (not a 403) to avoid leaking the existence of another user's fiscal year.
7. THE `fiscalYearGuard` middleware function SHALL resolve the fiscal year internally using only `userId = req.user.id` — it SHALL never accept a `fiscalYearId` from the request body or query string to determine whether a period is locked.

---

### Requirement 11: Backward Compatibility

**User Story:** As a developer, I want the fiscal year feature to be an additive accounting layer so that all existing workflows continue to function identically for users who have not yet configured fiscal years.

#### Acceptance Criteria

1. ALL existing API endpoints SHALL continue to function exactly as before when no `fiscalYearId` query parameter is provided.
2. THE `fiscalYearId` field on all transaction tables SHALL be nullable, so existing records without a fiscal year assignment are not affected.
3. IF no `Active_FiscalYear` exists for a user, ALL report endpoints SHALL fall back to existing date-range behavior without error.
4. THE closed-fiscal-year protection check SHALL be a no-op (allow the transaction) when no matching `FiscalYear` record exists for the transaction date.
5. THE year-end close operation SHALL NOT modify or delete any existing journal entry lines — it only creates new `Closing_Entry` and `Opening_Balance_Entry` journal entries.
6. THE `currentBalance` field on `ChartOfAccount` records SHALL NOT be reset to zero by the year-end close. The closing is represented entirely through journal entries, preserving the audit trail.

---

### Requirement 12: Performance

**User Story:** As a developer, I want fiscal year filtering on reports to be efficient so that large datasets do not cause slow report generation.

#### Acceptance Criteria

1. THE `fiscalYearId` column SHALL have a database index on every transaction table where it is added.
2. WHEN a `fiscalYearId` filter is applied, THE System SHALL use `WHERE fiscalYearId = ?` rather than recomputing date ranges from the fiscal year configuration on every row.
3. THE `FiscalYear` lookup for automatic `fiscalYearId` assignment SHALL use an indexed query on `(userId, startDate, endDate)`.
4. THE year-end close aggregation queries SHALL use Prisma `aggregate` or `groupBy` operations rather than fetching all journal lines into memory.

---

### Requirement 13: Complete File Change Map

**User Story:** As a developer, I want a definitive list of every file that requires changes so that implementation can proceed without missing any affected component.

#### Acceptance Criteria

**New Files (to be created):**
1. `prisma/migrations/<timestamp>_add_fiscal_year/migration.sql` — migration adding `FiscalYear`, `FiscalYearAuditLog`, and `fiscalYearId` columns.
2. `controllers/fiscalYearController.js` — CRUD, open, close, reopen, year-end close logic.
3. `routes/fiscalYearRoutes.js` — route definitions for all fiscal year API endpoints.
4. `middleware/fiscalYearMiddleware.js` — `fiscalYearGuard` shared protection function.
5. `utils/fiscalYearHelper.js` — helper for resolving `fiscalYearId` from a date and userId, and for extracting date ranges from a fiscal year record.

**Modified Files (Prisma Schema):**
6. `prisma/schema.prisma` — add `FiscalYear` model, `FiscalYearAuditLog` model, `fiscalYearId` field to all transaction models, relations on `User`.

**Modified Files (App Bootstrap):**
7. `app.js` — register `fiscalYearRoutes` under `/api/fiscal-year`.
8. `controllers/userController.js` — call fiscal year + retained earnings auto-creation in the user registration handler.

**Modified Files (Transactional Controllers — add `fiscalYearGuard` and auto-assign `fiscalYearId`):**
9. `controllers/journalEntryController.js`
10. `controllers/expenseController.js`
11. `controllers/incomeController.js`
12. `controllers/paymentReceivedController.js`
13. `controllers/paymentMadeController.js`
14. `controllers/fixedAssetController.js`
15. `controllers/loanController.js`
16. `controllers/creditNoteController.js`
17. `controllers/transactionController.js`
18. `warehouse/controller/salesInvoiceController.js`
19. `warehouse/controller/purchaseInvoiceController.js`
20. `warehouse/controller/salesPaymentController.js`
21. `warehouse/controller/purchasePaymentController.js`
22. `warehouse/controller/purchaseReturnController.js` (if it creates accounting entries)
23. `warehouse/controller/salesReturnController.js` (if it exists and creates accounting entries) — add `fiscalYearGuard` on create/edit/delete

> **Note:** All transactional controllers listed above must guard CREATE, EDIT (PUT/PATCH), and DELETE operations. Adding the guard only to CREATE handlers is insufficient — edit and delete operations on records whose Posting_Date falls in a closed fiscal year must also be blocked.

> **Note:** THE `fiscalYearGuard` helper SHALL be called at the TOP of every create, update, and delete handler in every Transactional_Controller, before any database read or write operations.

**Modified Files (Report Controllers — add `fiscalYearId` filtering):**
23. `controllers/trialBalanceController.js`
24. `controllers/generalLedgerController.js`
25. `controllers/balanceSheetController.js`
26. `controllers/reportsController.js` (Profit & Loss, etc.)
27. `controllers/plReportController.js`
28. `controllers/dashboardController.js`
29. `controllers/accountsReceivableController.js`
30. `controllers/accountsPayableController.js`

**Modified Files (Mongoose → Prisma Migration + Fiscal Year):**
31. `controllers/cashFlowController.js` — migrate from Mongoose to Prisma; add `fiscalYearId` filtering.
32. `controllers/equityController.js` — migrate from Mongoose to Prisma; add `fiscalYearId` filtering.

**Modified Files (Utilities):**
33. `utils/balanceSheetHelper.js` — accept `startDate`/`endDate` parameters; remove hardcoded calendar-year range for retained earnings.

---

### Requirement 14: Fiscal Period Future Compatibility

**User Story:** As a developer, I want the Fiscal Year implementation to be structured so that monthly Fiscal Period support can be added in the future without requiring changes to existing APIs, database schemas, or controller logic.

#### Acceptance Criteria

1. THE `FiscalYear` Prisma model SHALL include a nullable `periodType` field (String, default `null`) reserved for future use. It SHALL have no effect on current business logic and SHALL be ignored by all current controllers and helpers.
2. THE `utils/fiscalYearHelper.js` module SHALL be structured with clearly separated functions (one for date-range resolution, one for status lookup, one for guard logic) so that future Fiscal Period logic can be added as new functions without modifying existing ones.
3. THE fiscal year API routes SHALL be namespaced under `/api/fiscal-year/` so that a future `/api/fiscal-period/` namespace can be added independently.
4. NO current controller, report, or migration SHALL reference `periodType` in its WHERE clauses or business logic — it is a reserved schema field only.

---

### Requirement A1: Journal Entry Type

**User Story:** As a developer, I want every JournalEntry to carry a machine-readable `type` field so that the system can identify opening balance and closing entries reliably without parsing description strings.

#### Acceptance Criteria

1. THE System SHALL add a `type` field (String, default `"Normal"`) to the `JournalEntry` Prisma model.
2. THE `type` field SHALL only accept one of the following values: `"Normal"`, `"OpeningBalance"`, `"ClosingEntry"`, `"System"`. Any other value submitted via an API request SHALL be rejected with a 400 response.
3. ALL user-created journal entries (via `POST /api/journal-entries`) SHALL have `type = "Normal"` and the field SHALL NOT be user-settable via that endpoint.
4. THE Closing_Entry `JournalEntry` created during Year-End Close SHALL have `type = "ClosingEntry"`.
5. THE Opening_Balance_Entry `JournalEntry` created during Year-End Close SHALL have `type = "OpeningBalance"`.
6. THE System SHALL identify Opening Balance and Closing Entry journal entries using the `type` field. The `description` field SHALL NOT be used as the primary identification mechanism for these special entry types.

---

### Requirement A2: Draft Journal Validation Before Fiscal Year Close

**User Story:** As a company owner, I want the system to prevent closing a fiscal year when unposted journal entries exist so that no draft data is accidentally locked inside a closed period.

#### Acceptance Criteria

1. BEFORE performing any Year-End Close operations, THE System SHALL query for any `JournalEntry` records belonging to `req.user.id` whose `date` falls within the fiscal year's `startDate`–`endDate` and whose `status` is not `"Posted"`.
2. IF one or more such draft or unposted journal entries exist, THE System SHALL return a 400 response with the message `"Cannot close fiscal year because unposted journal entries exist."` and SHALL perform no closing operations.
3. THE unposted journal entry check SHALL run AFTER the Trial Balance balance check (Req 6, criterion 1) but BEFORE any closing calculations or writes.

---

### Requirement A3: Precise Financial Calculations

**User Story:** As a developer, I want all accounting arithmetic to use precise decimal calculations so that floating-point rounding errors never cause a Trial Balance to appear unbalanced or Net Income to be miscalculated.

#### Acceptance Criteria

1. THE System SHALL use Prisma's `Decimal` type (via `new Prisma.Decimal(value)` and `.add()`, `.sub()`, `.mul()`, `.toFixed()` operations) for all accounting calculations within the Year-End Close flow.
2. Native JavaScript floating-point arithmetic (`+`, `-`, `*`, `/` on `Number`) SHALL NOT be used for the following calculations: Trial Balance debit/credit aggregation, Revenue net balance aggregation, Expense net balance aggregation, Net Income calculation, Opening Balance amounts, Closing Entry line amounts, and Retained Earnings transfer amount.
3. Final values written to the database (journal line `debit`/`credit` fields, which are `Float` in the schema) SHALL be converted from `Decimal` to `Number` using `.toNumber()` only at the point of database write, after all arithmetic is complete.

---

### Requirement A4: Fiscal Year Lookup Optimisation

**User Story:** As a developer, I want the `resolveFiscalYearId` helper to avoid redundant database queries within the same request so that creating transactions does not cause N+1 lookups.

#### Acceptance Criteria

1. THE `resolveFiscalYearId(userId, postingDate)` function in `utils/fiscalYearHelper.js` SHALL accept an optional third parameter `cachedFiscalYear` (a `FiscalYear` object previously resolved for the same user and date range). IF provided and the `postingDate` falls within the cached fiscal year's `startDate`–`endDate`, THE function SHALL return the cached fiscal year's `id` without querying the database.
2. WHEN a controller creates multiple related accounting records within one request (e.g., a journal entry and its associated income record), it SHALL resolve the `FiscalYear` once and pass the cached result to subsequent `resolveFiscalYearId` calls.
3. THIS optimisation SHALL NOT change any business logic, guard behaviour, or the resulting `fiscalYearId` assignment.

---

### Requirement A5: Fiscal Year Reopen Reason

**User Story:** As a company owner, I want to record a reason when I reopen a closed fiscal year so that the audit log captures the justification for overriding a locked period.

#### Acceptance Criteria

1. THE `POST /api/fiscal-year/:id/reopen` endpoint SHALL accept an optional `reason` field in the request body.
2. IF `reason` is provided, THE System SHALL store it in the `details` JSON field of the `FiscalYearAuditLog` record created for the `"Reopened"` action, as `{ reason: "<value>" }`.
3. IF `reason` is omitted, THE System SHALL proceed with reopening normally and store `details = null` (or an empty object) in the audit log.

---

### Requirement A6: Opening Balance Detection Using Type Field

**User Story:** As a developer, I want opening balance detection to use the `type` field on JournalEntry rather than description string matching so that the check is reliable and not fragile against description changes.

#### Acceptance Criteria

1. WHEN checking for existing Opening_Balance_Entry records before creating new ones during Year-End Close, THE System SHALL primarily query for `JournalEntry` records with `type = "OpeningBalance"` and `fiscalYearId = <nextFiscalYear.id>` and `createdBy = userId`.
2. AS a backward-compatibility fallback, IF the `type`-based query returns zero results, THE System SHALL also check for `JournalEntry` records whose `description` starts with `"Opening Balance - FY"` (case-insensitive) for the same `userId` scoped to the next fiscal year's date range, to handle entries created before this feature.
3. IF either the type-based check OR the description-based fallback finds an existing entry, THE System SHALL skip creating new opening balance entries and not create duplicates.

---

### Requirement A7: Fiscal Year Close Execution Order

**User Story:** As a developer, I want the Year-End Close to follow a strictly defined execution sequence so that partial state is never committed and every step is auditable.

#### Acceptance Criteria

1. THE Year-End Close handler (`POST /api/fiscal-year/:id/close`) SHALL execute all operations within a single Prisma `$transaction` in the following order:
   - Step 1: Validate Trial Balance (total debits vs total credits within 0.01 tolerance). Return 400 if unbalanced — no further steps.
   - Step 2: Validate no unposted journal entries exist in the fiscal year date range. Return 400 if any found — no further steps.
   - Step 3: Aggregate Revenue account net balances using Decimal arithmetic.
   - Step 4: Aggregate Expense account net balances using Decimal arithmetic.
   - Step 5: Calculate Net Income using Decimal arithmetic.
   - Step 6: Create the Closing_Entry `JournalEntry` (type = `"ClosingEntry"`, status = `"Posted"`).
   - Step 7: If a next FiscalYear exists and is Open and no opening balance entry exists for it: create the Opening_Balance_Entry `JournalEntry` (type = `"OpeningBalance"`, status = `"Posted"`).
   - Step 8: Update `FiscalYear.status = "Closed"`.
   - Step 9: Set `FiscalYear.closedAt = now` and `FiscalYear.closedBy = req.user.id`.
   - Step 10: Create all `FiscalYearAuditLog` records (`"YearEndClosing"`, `"Closed"`, and conditionally `"OpeningBalanceCreated"`).
   - Step 11: Prisma commits the transaction.
2. Steps 1 and 2 SHALL run OUTSIDE the Prisma `$transaction` (as read-only pre-checks) to avoid holding locks during validation. All write operations (steps 6–10) SHALL execute INSIDE the `$transaction`.
3. IF any step inside the transaction throws an error, Prisma SHALL roll back ALL changes and the handler SHALL return a 500 response with the error message.
