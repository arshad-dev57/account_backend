# Design Document: Fiscal Year Support

## Overview

This document describes the technical design for adding professional-grade Fiscal Year support to the Node.js/Express accounting ERP backend. The system uses PostgreSQL with Prisma ORM. There is no Company model — the User IS the company boundary. All records use `userId` for multi-tenancy.

The feature introduces:
- A dedicated `FiscalYear` Prisma model owned by `userId`
- A `fiscalYearId` FK on every transaction model for efficient period-based filtering
- Automatic fiscal year assignment on transaction creation
- Closed fiscal year protection blocking writes to locked periods
- A professional year-end close algorithm (closing entries + opening balance carry-forward)
- Fiscal-year-aware report filtering across all report controllers
- Migration of `cashFlowController.js` and `equityController.js` from Mongoose to Prisma
- Auto-creation of the first `FiscalYear` and `Retained Earnings` account on user registration

**Scope:** Backend only. No frontend changes.

---

## Architecture

The feature follows the existing layered architecture of the application:

```
HTTP Request
    │
    ▼
authMiddleware.protect (JWT → req.user.id)
    │
    ▼
fiscalYearGuard (middleware/fiscalYearMiddleware.js)
    │  — resolves FY for the posting date
    │  — throws if FY is Closed
    ▼
Controller
    │  — calls resolveFiscalYearId() from fiscalYearHelper
    │  — assigns fiscalYearId to new record
    ▼
Prisma ORM → PostgreSQL
    │
    ▼
FiscalYearAuditLog (for lifecycle events)
```

### Key Architectural Decisions

**Decision 1: `fiscalYearId` on transaction tables, not date-range joins at query time.**
Rationale: Adding an indexed FK column allows `WHERE fiscalYearId = ?` on report queries — O(1) index lookup — instead of recomputing date range overlaps on every query execution. This matches the approach used in SAP, NetSuite, and QuickBooks.

**Decision 2: `fiscalYearGuard` is a shared helper, not an Express middleware.**
Rationale: Each transactional controller needs to call the guard with the specific posting-date field for that model (e.g., `date`, `paymentDate`, `invoiceDate`). A single Express middleware cannot know which request-body field to use. A shared helper function called explicitly in each controller is cleaner and easier to test.

**Decision 3: Atomicity via Prisma `$transaction` for year-end close.**
Rationale: Year-end close touches multiple tables (JournalEntry, JournalLine, FiscalYear, FiscalYearAuditLog). Any partial failure must be fully rolled back to prevent an inconsistent accounting state.

**Decision 4: Closing entries are journal entries, not balance mutations.**
Rationale: The `currentBalance` on `ChartOfAccount` records is NOT reset by year-end close. The closing is represented entirely through `JournalEntry` records, preserving the complete audit trail. This matches GAAP double-entry bookkeeping standards.

---

## Components and Interfaces

### 1. New Files

#### `prisma/schema.prisma` — additions

**FiscalYear model:**
```prisma
model FiscalYear {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  name      String    @db.VarChar(100)
  startDate DateTime  @map("start_date")
  endDate   DateTime  @map("end_date")
  status    String    @default("Open")
  closedAt  DateTime? @map("closed_at")
  closedBy  String?   @map("closed_by")  // plain string, no enforced FK
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")

  user      User                @relation("UserFiscalYears", fields: [userId], references: [id])
  auditLogs FiscalYearAuditLog[]

  @@unique([userId, name])
  @@index([userId])
  @@index([userId, startDate, endDate])
  @@index([userId, status])
  @@map("fiscal_years")
}
```

**FiscalYearAuditLog model:**
```prisma
model FiscalYearAuditLog {
  id           String    @id @default(uuid())
  fiscalYearId String    @map("fiscal_year_id")
  userId       String    @map("user_id")
  action       String    // "Created"|"Updated"|"Closed"|"Reopened"|"YearEndClosing"|"OpeningBalanceCreated"
  details      Json?
  ipAddress    String?   @map("ip_address")
  createdAt    DateTime  @default(now()) @map("created_at")

  fiscalYear   FiscalYear @relation(fields: [fiscalYearId], references: [id])
  user         User       @relation("UserFiscalYearAuditLogs", fields: [userId], references: [id])

  @@index([fiscalYearId])
  @@index([userId])
  @@map("fiscal_year_audit_logs")
}
```

**`fiscalYearId` added to each transaction model (example for JournalEntry):**
```prisma
fiscalYearId  String?    @map("fiscal_year_id")
fiscalYear    FiscalYear? @relation(fields: [fiscalYearId], references: [id])

@@index([fiscalYearId])
```

The same pattern applies to: `Expense`, `Income`, `PaymentReceived`, `PaymentMade`, `SalesInvoice`, `PurchaseInvoice`, `CreditNote`, `PurchaseReturn`, `Transaction`, `FixedAsset`, `Loan`, `SalesPaymentReceived`, `PurchasePaymentMake`, `AccountsReceivable`, `AccountsPayable`.

**User model additions** (relations only, no new scalar fields):
```prisma
fiscalYears      FiscalYear[]         @relation("UserFiscalYears")
fiscalYearLogs   FiscalYearAuditLog[] @relation("UserFiscalYearAuditLogs")
```

---

#### `utils/fiscalYearHelper.js`

Two exported functions:

**`resolveFiscalYearId(userId, postingDate)`**
- Queries `FiscalYear` where `userId = userId` AND `startDate <= postingDate` AND `endDate >= postingDate`
- Returns the matching fiscal year's `id`, or `null` if none found
- On any database error, logs the error and returns `null` (non-blocking)
- Uses the composite index `(userId, startDate, endDate)` for performance

```js
// Signature
async function resolveFiscalYearId(userId, postingDate) → String | null
```

**`getFiscalYearDateRange(userId, fiscalYearId)`**
- Queries `FiscalYear` by `id` where `userId = userId`
- Returns `{ startDate, endDate }` for use in report date filters
- Throws a 404-like error if the fiscal year does not belong to the user

```js
// Signature
async function getFiscalYearDateRange(userId, fiscalYearId) → { startDate: Date, endDate: Date }
```

**`getActiveFiscalYear(userId)`**
- Queries `FiscalYear` where `userId = userId`, `status = "Open"`, `startDate <= now`, `endDate >= now`
- Returns the active fiscal year record, or `null`

```js
// Signature
async function getActiveFiscalYear(userId) → FiscalYear | null
```

**`getReportDateRange(userId, query)`**
- Accepts the report request query object (`{ fiscalYearId, startDate, endDate }`)
- Priority: fiscalYearId → explicit startDate/endDate → active fiscal year → current calendar year
- Returns `{ startDate: Date, endDate: Date }`
- Used by all report controllers to resolve their date range consistently

```js
// Signature
async function getReportDateRange(userId, query) → { startDate: Date, endDate: Date }
```

---

#### `middleware/fiscalYearMiddleware.js`

**`fiscalYearGuard(userId, postingDate)`**

This is a shared async helper — not an Express middleware function. Controllers call it explicitly with the posting date field for their model.

```js
// Signature
async function fiscalYearGuard(userId, postingDate) → void  // throws on closed period
```

Logic:
1. Call `resolveFiscalYearId(userId, postingDate)` to find the matching fiscal year ID
2. If `null` — return immediately (no FY means no restriction, per Requirement 5.3)
3. Fetch the `FiscalYear` record by the resolved ID
4. If `status === "Closed"` — throw `{ status: 400, message: "Period locked: fiscal year '${fy.name}' is closed. No transactions can be posted to a closed period." }`
5. If `status === "Open"` — return immediately (allow the transaction)

Controllers catch this error and return the 400 response:
```js
try {
  await fiscalYearGuard(userId, postingDate);
} catch (err) {
  if (err.status === 400) return res.status(400).json({ success: false, message: err.message });
  throw err;
}
```

---
