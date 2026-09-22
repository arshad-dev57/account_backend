# Bisonstechs ERP — Manufacturing Process User Guide

Complete, screen-by-screen, button-by-button guide to the **Manufacturing Module**
as it is actually implemented in this project.

> **How to read this guide**
> This repository is the **backend** for Bisonstechs ERP. It exposes the API
> endpoints (routes) that the app screens and buttons call. Every "screen",
> "button" and "action" described below is tied to a **real route** and the
> **exact behavior** that route implements. If you use the Bisonstechs app
> (web/mobile), each button you click triggers one of these routes. Where a
> button name shown on screen may differ from the route name, we always give
> the route so you can verify it.
>
> All manufacturing API routes live under the base path **`/api/manufacturing`**.

---

## Table of contents

1. [The manufacturing journey at a glance](#1-the-manufacturing-journey-at-a-glance)
2. [Before you start — master data checklist](#2-before-you-start--master-data-checklist)
3. [Step-by-step: from zero to a closed production order](#3-step-by-step)
4. [The purchase → stock flow](#4-the-purchase--stock-flow)
5. [Master data explained](#5-master-data-explained)
6. [Production order lifecycle and statuses](#6-production-order-lifecycle-and-statuses)
7. [Material flow — Required → Reserved → Issued → Consumed → Remaining](#7-material-flow)
8. [Shop-floor operations](#8-shop-floor-operations)
9. [Production output quantities](#9-production-output-quantities)
10. [Quality control](#10-quality-control)
11. [Scrap and rejected — the difference](#11-scrap-and-rejected--the-difference)
12. [By-products](#12-by-products)
13. [Partial production](#13-partial-production)
14. [Close short](#14-close-short)
15. [Costing](#15-costing)
16. [Inventory effect table](#16-inventory-effect-table)
17. [Complete real example + tested scenarios](#17-complete-real-example--tested-scenarios)
18. [Button-by-button guide](#18-button-by-button-guide)
19. [User decision guide — "If this happens → do this"](#19-user-decision-guide)
20. [Assumptions and things verified](#20-assumptions-and-things-verified)

---

## 1. The manufacturing journey at a glance

Manufacturing in Bisonstechs follows one logical path. You do not have to guess —
each step tells you what to prepare, which screen to open, and what happens next.

```
START
 → Create / verify Warehouse
 → Create Raw Material Products
 → Create Finished Product
 → Create Supplier
 → Purchase Order
 → Goods Receipt / GRN
 → Raw Material Stock Available
 → Create Work Center
 → Create Machine
 → Create BOM
 → Create Routing
 → Create Production Order
 → Release Production Order
 → Material Reservation
 → Material Issue
 → Start Production
 → Operation 1 → Operation 2 → Operation 3
 → Report Good / Rejected / Scrap / Downtime
 → Production Output
 → Finished Goods Receipt
 → Quality Inspection
 → PASS ?  YES → Production Completed → Costing → Close
            NO  → Rework → Rework Pending → In Progress → Completed → verify → Complete / Close
```

You can also branch at any point to:
- **Partial production** — produce part of the quantity, continue the same order.
- **Close short** — intentionally stop producing the remaining quantity.
- **Scrap / Rejected** — record production losses.
- **By-products** — receive extra output into a warehouse.

---

## 2. Before you start — master data checklist

Manufacturing can only consume material that **already exists in warehouse
stock**. You must complete these setup steps (in order) before you can produce:

| # | Item | Screen / Route | Needed for |
|---|------|---------------|-----------|
| 1 | Warehouse (Location) | `POST /api/warehouse/locations` | Where raw material is stored and where finished goods are received |
| 2 | Raw Material products | `POST /api/warehouse/products` | The materials that get consumed |
| 3 | Finished Product | `POST /api/warehouse/products` | What you are going to produce |
| 4 | Supplier / Vendor | `POST /api/warehouse/supplier` | Who you buy raw material from |
| 5 | Purchase Order | `POST /api/purchase/orders` | "We intend to buy" |
| 6 | Goods Receipt (GRN) | `POST /api/purchase/goods-receiving` → confirm | "Material physically arrived" |
| 7 | Work Center | `POST /api/manufacturing/work-centers` | Where an operation happens |
| 8 | Machine | `POST /api/manufacturing/machines` | The equipment used (linked to a Work Center) |
| 9 | BOM | `POST /api/manufacturing/boms` | WHAT material is required (the recipe) |
| 10 | Routing | `POST /api/manufacturing/routings` | HOW the product is produced (the steps) |

> **Rule of thumb:** If raw material is not in stock, you cannot reserve it,
> cannot issue it, and operations cannot consume it. Buy and receive it first.

---

## 3. Step-by-step

Below is the ordered, screen-by-screen flow. Each step shows **where** you go,
**what** you fill in, the **button** you click, **before/after status**, the
**inventory effect**, and **what happens next**.

### Step 1 — Create / verify a Warehouse

- **Screen:** Warehouse → Locations
- **Route:** `POST /api/warehouse/locations` (get: `GET /api/warehouse/locations`)
- **Purpose:** A warehouse (called a *Location* in the backend) is the physical
  place that holds stock. **Source warehouse** holds raw materials, **WIP
  warehouse** holds work in progress, **finished goods warehouse** receives the
  products you make.
- **Fields:** `name` (e.g. "Raw Material WH", "Finished Goods WH"),
  `code`, `type` (`Warehouse`), `isActive`, `isDefault`.
- **Action:** Save / Create Location.
- **Status before:** none.
- **Status after:** Location is active.
- **Inventory effect:** Creates a default stock row of 0 for each product when
  the first product–location stock record is needed.
- **What happens next:** Point your Production Order's *source* and *finished
  goods* warehouses at these locations.

### Step 2 — Create Raw Material Products

- **Screen:** Warehouse → Products
- **Route:** `POST /api/warehouse/products`
- **Purpose:** Create the raw materials that will be consumed during
  manufacturing (e.g. Raw Material A, Raw Material B, Packaging Box).
- **Fields (the real ones available on the `Product` record):**
  - `name`, `sku` (unique per company)
  - `productType` (default `Physical`)
  - `categoryName` / `categoryId`
  - `supplierId`, `supplierName`, `supplierSku`
  - `costPrice`, `sellingPrice`, `landingCost`, `taxRate`
  - `stockUnitName` (e.g. kg, pcs, box)
  - `minimumStock`, `maximumStock`, `openingStock`, `reorderPoint`,
    `reorderQty`, `leadTimeDays`, `safetyStock`
  - `barcodeNumber`, `description`
- **Action:** Save / Add Product.
- **Status before:** none.
- **Result:** The product becomes available for purchasing and manufacturing.
- **Next:** Purchase raw materials (Step 4) or create the BOM later.

> **Note:** The fields `Material Type` and `Country` that appear in some
> examples are **not** fields on the `Product` model in this codebase. Use the
> fields listed above; the product `type` is `Physical`.

### Step 3 — Create the Finished Product

- **Screen:** Warehouse → Products
- **Route:** `POST /api/warehouse/products`
- **Purpose:** The product you will produce (e.g. Finished Product A).
- **Fields:** Same as Step 2. Give it the unit your production will use
  (`stockUnitName`).
- **Action:** Save / Add Product.
- **Result:** Finished product exists; later used by BOM, Routing, Production
  Order, and FG receipt.
- **Next:** Supplier (Step 4), or straight to Work Center / BOM / Routing if
  you already have stock.

### Step 4 — Create a Supplier

- **Screen:** Warehouse → Supplier
- **Route:** `POST /api/warehouse/supplier`
- **Purpose:** The vendor you buy raw material from.
- **Fields:** `name` (required), `companyName`, `contactPerson`, `department`,
  `phone`, `email`, `address`, `city`, `country`, `industry`, `businessType`,
  `paymentTerms`, `taxId`, `status`, `isPreferred`, `notes`.
- **Action:** Save / Add Supplier.
- **Result:** Supplier is available when you create a Purchase Order.
- **Next:** Purchase Order (Step 5).

### Step 5 — Purchase Order (intention to buy)

- **Screen:** Purchase → Orders
- **Route:** `POST /api/purchase/orders`
- **Purpose:** Record that you **intend to buy** raw material.
- **Fields:** supplier, items (product, quantity, unit cost), location, notes,
  terms. (`status` defaults to `Approved` on creation.)
- **Action:** Create / Save Purchase Order.
- **Result:** PO exists with status `Approved`. **No stock changes yet.**
- **Inventory effect:** none.
- **Next:** Goods Receipt (Step 6). The PO does **not** put material in stock.

### Step 6 — Goods Receipt / GRN (material arrived)

- **Screen:** Purchase → Goods Receiving (GRN)
- **Route:** `POST /api/purchase/goods-receiving` then
  `POST /api/purchase/goods-receiving/:id/confirm`
- **Purpose:** Physically record that the material arrived at your warehouse.
  This is what moves stock **in**.
- **Fields:** purchase order, items (product, `receivingQuantity`), location,
  receiving date.
- **Action:** Create GRN (draft) → **Confirm** the GRN.
- **Result:** GRN becomes `Fully Received` and supplier material stock increases.
- **Status before:** GRN `Draft`.
- **Status after:** GRN `Fully Received`.
- **Inventory effect:** On-hand (`currentStock`) of the received products
  **increases** in the receiving location.
- **Next:** Verify stock (Step 7). Only now is material available for
  manufacturing.

### Step 7 — Verify raw material stock

- **Screen:** Warehouse → Stock / Locations
- **Route:** `GET /api/warehouse/locations/:id/stock`
- **Purpose:** Confirm the raw materials are physically available before
  planning production.
- **What you check:** each material's on-hand (`currentStock`) and available
  (`availableStock`).
- **Next:** Create the Work Center (Step 8). If stock is 0 → go back to
  Step 5/6, because Release cannot reserve material that is not there.

### Step 8 — Create a Work Center

- **Screen:** Manufacturing → Work Centers
- **Route:** `POST /api/manufacturing/work-centers`
- **Purpose:** A Work Center represents a place/function where an operation is
  performed (e.g. "Cutting", "Assembly", "Packing").
- **Fields:** `workCenterCode` (auto `WC-...`), `name` (required),
  `department`, `locationId`, `factory`, `capacity`, `shift`,
  `efficiency` (default 100), `costPerHour`, `status` (default `Active`).
- **Action:** Save / Add Work Center.
- **Result:** Work Center is `Active` and reusable in Routings and BOMs.
- **Next:** Machine (Step 9).

### Step 9 — Create a Machine

- **Screen:** Manufacturing → Machines
- **Route:** `POST /api/manufacturing/machines`
- **Purpose:** A specific piece of equipment. It is **linked to a Work Center**
  because the machine works inside that center.
- **Fields:** `machineCode` (auto `MC-...`), `name` (required), `serialNumber`,
  `model`, `manufacturer`, `workCenterId`, `locationId`, `purchaseDate`,
  `hourlyOperatingCost`, `capacity`, `efficiency`, `currentStatus`
  (default `Idle`).
- **Action:** Save / Add Machine.
- **Result:** Machine is available to attach to Routing operations.
- **Next:** BOM (Step 10).

### Step 10 — Create a BOM (what material is required)

- **Screen:** Manufacturing → BOMs
- **Route:** `POST /api/manufacturing/boms`
- **Purpose:** The **recipe**. It lists every component (material) and the
  quantity needed to make **one** finished unit.
- **Fields (header):** `bomNumber` (auto `BOM-...`), `productId` (the finished
  product), `version` (default `1.0`), `status` (default `Draft`),
  `effectiveFrom`, `effectiveTo`, `description`, `locationId`.
- **Fields (component lines):** `componentId` (the material),
  `quantity` (per finished unit), `unitOfMeasure`, `scrapPercentage`,
  `substituteMaterial`, `operationSequence`, `workCenterId`, `estimatedCost`,
  `notes`.
- **Action:** Save / Add BOM (add one or more component lines).
- **Result:** BOM is saved (`Draft` by default; set it `Active` when ready so
  the Production Order auto-detects it).
- **Costing note:** `totalEstimatedCost` = sum of component `estimatedCost`.
  The required quantity for an order is computed as
  `required = BOM quantity × planned qty × (1 + scrap% / 100)`.
- **Next:** Routing (Step 11).

### Step 11 — Create a Routing (how the product is produced)

- **Screen:** Manufacturing → Routings
- **Route:** `POST /api/manufacturing/routings`
- **Purpose:** The **process steps**. Lists the ordered operations that turn
  material into the finished product.
- **Fields (header):** `routingNumber` (auto `RT-...`), `productId`,
  `version`, `status` (default `Draft`; pass `Inactive` → stored as `Obsolete`),
  `description`.
- **Fields (operation lines):** `operationName`, `sequence` (order),
  `workCenterId` (required), `machineId`, `setupTime`, `runTime`, `queueTime`,
  `laborRequirement` (workers), `machineRequirement`, `inspectionRequired`,
  `estimatedCost`, `notes`.
- **Action:** Save / Add Routing.
- **Result:** Routing is saved. When a Production Order is created, one **Work
  Order** is created per Routing operation (in `sequence` order, status
  `Pending`).
- **Next:** Production Order (Step 12).

> **BOM vs Routing in one line**
> - **BOM = WHAT material is required** (the recipe).
> - **Routing = HOW the product is produced** (the ordered steps / operations).

### Step 12 — Create a Production Order

- **Screen:** Manufacturing → Production Orders
- **Route:** `POST /api/manufacturing/production-orders`
- **Purpose:** Authorise manufacturing of a quantity of a finished product.
- **Fields:** `productId` (required), `plannedQuantity` (required),
  `startDate`, `dueDate`, `priority` (`Normal` by default; `Medium` is mapped
  to `Normal`), `sourceWarehouseId` (required — raw material warehouse),
  `wipWarehouseId`, `finishedGoodsWarehouseId`, `demandType`,
  `salesOrderReference`, `batchNumber`, `notes`.
- **BOM/Routing auto-fill:** If you do not pass `bomId`/`routingId`, the system
  picks the latest **Active** BOM and Routing for that product.
- **Action:** Save / New Order.
- **Status before:** none.
- **Status after:** `Draft`.
- **Quantity fields on creation:** `producedQuantity = 0`,
  `remainingQuantity = plannedQuantity`, `progress = 0`.
- **Inventory effect:** none (creation reserves nothing).
- **Next:** Release (Step 13).

### Step 13 — Release the Production Order

- **Screen:** Production Order detail → Release
- **Route:** `POST /api/manufacturing/production-orders/:id/release`
- **Purpose:** The single biggest "go" step. Release:
  1. **Reserves material**: for every BOM component it creates a
     **Material Reservation**, reserving `min(available stock, required)`.
     Shortages are recorded in `shortageQuantity`.
  2. **Creates the Work Orders**: one per Routing operation (status `Pending`).
  3. **Creates a WIP record** (status `InProgress`).
  4. Sets the order to `Released`.
- **Requirements:** A `sourceWarehouseId` must be set, otherwise it fails with
  `"Source warehouse is required before releasing a manufacturing order"`.
- **Status before:** `Draft` / `Planned`.
- **Status after:** `Released`.
- **Inventory effect:** Reserves stock — `reservedStock` increases,
  `availableStock` decreases, `currentStock` (on-hand) is unchanged.
- **Next:** Verify reservation (Step 14), then Issue (Step 15).

### Step 14 — Check materials were reserved

- **Screen:** Production Order → Materials
- **Route:** `GET /api/manufacturing/production-orders/:id/materials`
- **Purpose:** See each component's `required`, `reserved`, `issued`, `onHand`,
  `available`, `shortage`, and reservation `status`.
- **What to check:** reservation status should be `Reserved` (or
  `PartiallyReserved` if not all was reserved). If status is `Pending` there is
  a shortage — receive the material first.
- **Next:** Issue the material (Step 15).

### Step 15 — Issue materials

- **Screen:** Production Order → Materials → Issue / "Issue Selected Lines"
- **Route:** `POST /api/manufacturing/production-orders/:id/issue-materials`
- **Purpose:** Physically move the reserved material from the source warehouse
  into production (and to the WIP warehouse). This is what **decreases** raw
  material on-hand stock.
- **How it works:** If you send no lines, the system issues the full remaining
  required quantity of every reservation. You can also send specific
  `lines` with `reservationId`, `componentId`, `issuedQuantity`.
- **Stock check:** If `allowNegativeInventory` is off and issue qty > on-hand,
  it fails with:
  `"Insufficient stock … Reduce Issue Now to {onHand} or receive stock first."`
- **Status before:** order `Released` (or `In Progress`).
- **Status after:** order stays in its status; reservation becomes
  `Completed` (if fully issued) or `PartiallyReserved`; material issues get
  status `Issued` with `inventoryPosted = true`.
- **Inventory effect:** raw material on-hand (`currentStock`) **decreases** and
  its `reservedStock` is reduced by the issued quantity.
- **Next:** Start production (Step 16).

### Step 16 — Start production

- **Screen:** Production Order → Start
- **Route:** `POST /api/manufacturing/production-orders/:id/start`
- **Purpose:** Mark the order as actually in progress.
- **Status before:** `Released`.
- **Status after:** `In Progress` (sets `actualStartDate`).
- **Inventory effect:** none beyond what Issue already did.
- **Next:** Run the operations (Step 17).

### Step 17 — Operations (Work Orders)

- **Screen:** Production Order → Operations / Shop Floor
- **Route:** `GET /api/manufacturing/production-orders/:id/operations`
  and `POST /api/manufacturing/work-orders/:id/{start|pause|resume|complete|report}`
  (also available via `/api/manufacturing/shop-floor/:id/...`)
- **Purpose:** Each Routing operation became a **Work Order**. Run them in
  `sequence` order.
- **Sequence:** Start → Report (Good/Scrap/Rejected/Downtime) → Complete, then
  the next operation.
- **Statuses of a work order:** `Pending` → `In Progress` → (`Paused`) →
  `Completed`.
- **Inventory effect:** none directly (material was already issued).
- **Next:** Report output (Step 18), or Receive FG (Step 19).

> Work Orders are created on **Release**, not on a separate step. There is no
> "create work order" button you press manually — they are spawned from the
> Routing automatically.

### Step 18 — Report production quantities

- **Screen:** Shop Floor / Operation detail → Report
- **Route:** `POST /api/manufacturing/work-orders/:id/report`
- **Fields:** `goodQuantity` (a.k.a. `completedQuantity`), `scrapQuantity`,
  `rejectedQuantity`, `downtime`, optional `employeeId`, `machineId`, `notes`.
- **What happens:** The operation is marked `Completed` when
  `good + scrap + rejected ≥ planned`. Otherwise it stays `In Progress`.
- **Next:** After all operations are reported, the order may auto-complete; you
  still need the FG receipt (Step 19).

### Step 19 — Finished Goods Receipt / Complete & Receive FG

- **Screen:** Production Order → Output → Receive FG ("Complete & Receive FG")
- **Route:** `POST /api/manufacturing/production-orders/:id/complete`
  (alias: `POST /api/manufacturing/production-orders/:id/record-output`)
- **Purpose:** Bring the produced quantity physically into the **finished
  goods warehouse**. This is what **increases** finished goods stock.
- **Fields:** `goodQuantity` (the units received), `warehouseId` (falls back to
  `finishedGoodsWarehouseId`), optional `batchNumber`,
  `scrapQuantity`, `rejectedQuantity`, `reworkQuantity`.
- **Cap rule:** you cannot receive more than what is still remaining
  (`remainingQuantity`) — the system rejects with
  `"Cannot receive X. Remaining quantity is Y."`
- **Status before:** `Released` / `In Progress` / `Paused` / `Partially Completed`.
- **Status after:** `Completed` if `remaining = 0`, otherwise `Partially Completed`.
- **Inventory effect:** finished goods on-hand stock **increases** by
  `goodQuantity`; remaining reservations of raw material are **released** when
  the order is `Completed`.
- **Next:** Quality inspection (Step 20), Costing, and Close.

### Step 20 — Quality Inspection

- **Screen:** Manufacturing → Inspections
- **Route:** `POST /api/manufacturing/inspections`
- **Purpose:** Check the produced quantity against expected quality parameters.
- **Fields:** `productionOrderId`, `productId`, `inspectionType`
  (`Incoming`, `InProcess`, `Final`), `inspectorId` (an HR employee is
  required), `inspectionDate`, `result` (`Pending` default), `qualityParameters`
  (name, expectedValue, actualValue, tolerance, unitOfMeasure, result), `notes`.
- **Result values:** `Pending`, `Passed`, `Failed`, `Rework`, `Scrap`.
- **Action:** Add Inspection → Save Inspection.
- **Next:** If `Failed` → create Rework (Step 21). If `Passed` → complete/close.

### Step 21 — Rework (when quality fails)

- **Screen:** Manufacturing → Rework
- **Route:** `POST /api/manufacturing/rework`
- **Purpose:** Log that a quantity must be reworked and track it to completion.
- **Fields:** `productionOrderId`, `productId`, `workOrderId`, `quantity`
  (`reworkQty`), `reason`, `workCenterId`, `operatorId`, `reworkDate`,
  `estimatedCost`, `actualCost`, `status` (default `Pending`), `notes`.
- **Rework lifecycle:** `Pending` → `In Progress` → `Completed` (set via
  `status` on create/update).
- **Action:** Add Rework → Update (set status) → Complete.
- **Note:** Rework is recorded and costed; reworking happens at the work
  center, then the final quantity is re-inspected.

### Step 22 — Complete, cost, and close

- **Screen:** Production Order detail
- **Route (complete):** already done in Step 19.
- **Route (close):** `POST /api/manufacturing/production-orders/:id/close`
  — moves a `Completed` order to `Closed` (terminal).
- **Route (close short):** `POST /api/manufacturing/production-orders/:id/close-short`
  — closes the remaining quantity with a **mandatory reason**.
- **Costing screen:** `GET /api/manufacturing/production-orders/:id/costing`.

---

## 4. The purchase → stock flow

Manufacturing cannot consume material that does not exist in stock. The chain is:

```
Supplier
   ↓
Purchase Order          "we intend to buy"      (no stock change)
   ↓
PO Created / Approved
   ↓
Goods Receipt / GRN
   ↓
GRN Confirmed           "material physically arrived"   (stock IN)
   ↓
Warehouse Stock IN      "material is now available for manufacturing"
```

**The three different meanings:**

| Document | Meaning | Does it change stock? |
|----------|---------|----------------------|
| **Purchase Order (PO)** | "We intend to buy" — a request/commitment to the supplier | **No** |
| **GRN / Receipt** | "Material physically arrived at our warehouse" | Yes, when **confirmed** |
| **Stock (on-hand)** | "Material is now available for manufacturing" | Result of the confirmed GRN |

**If stock is insufficient** (at Release or Issue):
- At **Release**, the system creates reservations with `shortageQuantity` and
  reserves only what exists. Any unreserved portion is a shortage.
- At **Issue**, if `allowNegativeInventory` is off, the issue is rejected with
  an explicit message telling you what is on-hand and how much to reduce. You
  must receive the material first (another GRN) or reduce the issue quantity.

---

## 5. Master data explained

### Product
A **Product** is any item — a raw material or a finished good. Manufacturing
consumes products (as BOM components) and produces products (the finished
goods). Products carry unit, cost, supplier, reorder and stock settings.

### Warehouse (Location)
A **Warehouse** stores stock. In manufacturing you care about three roles:
- **Source warehouse**: where raw material lives and is issued from.
- **WIP warehouse**: where work-in-progress sits between operations.
- **Finished goods warehouse**: where produced units are received.

A Production Order points at all three. In the backend these are Locations on
the order (`sourceWarehouseId`, `wipWarehouseId`, `finishedGoodsWarehouseId`).

### Work Center
A **Work Center** represents a place or function where an operation is done
(e.g. Cutting, Assembly). It has a `costPerHour`, capacity and efficiency,
which feed labor cost.

### Machine
A **Machine** is the specific equipment (`hourlyOperatingCost`). It is linked
to a **Work Center** because equipment lives inside a center; a work center can
however host operations without a specific machine.

### BOM (Bill of Materials)
The **recipe** — WHAT material is needed to make one finished unit.
Each BOM component has:

| Field | Meaning |
|-------|---------|
| `componentId` | The material (product) |
| `quantity` | Quantity per finished unit |
| `unitOfMeasure` | Unit (kg, pcs, box) |
| `scrapPercentage` | Extra % to add for waste |
| `substituteMaterial` | Optional alternative |
| `operationSequence` | Optional link to an operation |
| `workCenterId` | Optional consumption work center |
| `estimatedCost` | Cost of this component |

Required for an order of qty `Q`:
`required = quantity × Q × (1 + scrap% / 100)`.

### Routing (process steps)
The **production process** — HOW the product is produced.
Each Routing operation has:

| Field | Meaning |
|-------|---------|
| `operationName` | Name of the step |
| `sequence` | Order of the operations |
| `workCenterId` | Where it happens |
| `machineId` | Which machine (optional) |
| `setupTime` / `runTime` / `queueTime` | Time (drives labor/machine cost) |
| `laborRequirement` | Number of workers |
| `machineRequirement` | Whether a machine is needed |
| `inspectionRequired` | Whether QC is required at this op |
| `estimatedCost` | Planned cost of the operation |

> **Make it stick:**
> **BOM = WHAT material is required.**
> **Routing = HOW the product is produced.**

---

## 6. Production order lifecycle and statuses

The Production Order statuses **actually implemented** (see
`utils/manufacturingWorkflow.js`):

| Status | Meaning | How reached | Can do | Cannot do | Inventory |
|--------|---------|-------------|--------|-----------|-----------|
| `Draft` | Created, not yet released | Create Production Order | Edit, Release, Cancel | Issue/Start/Receive | no change |
| `Planned` | Planned variant (same transitions as Draft) | via create/update | Release, Cancel | — | no change |
| `Released` | Material reserved, Work Orders created, order is live | Release | Start, Pause, Issue, Cancel, Complete, Close Short | (changes locked in) | reserved stock created |
| `In Progress` | Production running | Start | Pause, Complete, Issue, Report, Cancel, Close Short | — | raw issued earlier |
| `Paused` | Production on hold | Pause (Hold) | Resume, Complete, Cancel, Close Short, Issue | — | none new |
| `Partially Completed` | Partial output received, more remains | Complete with remaining > 0 | Complete again, Close Short, Cancel | — | FG partly in |
| `Completed` | All planned qty produced & FG received | Complete with remaining = 0 (or auto) | Close | Close Short (unless remaining > 0) | remaining reservations released |
| `Closed` | Final terminal state | Close (from Completed) | nothing | anything | finalized |
| `Closed Short` | Stopped early with reason | Close Short (reason required) | nothing | anything | remaining reservations released |
| `Cancelled` | Aborted; reservations released | Cancel | nothing | anything | reservations released |

**Allowed transitions (enforced):**
- `Draft` → `Released`, `Cancelled`
- `Planned` → `Released`, `Cancelled`
- `Released` → `In Progress`, `Paused`, `Cancelled`, `Partially Completed`, `Completed`, `Closed Short`
- `In Progress` → `Paused`, `Completed`, `Partially Completed`, `Cancelled`, `Closed Short`
- `Paused` → `In Progress`, `Cancelled`, `Completed`, `Partially Completed`, `Closed Short`
- `Partially Completed` → `Partially Completed`, `Completed`, `Closed Short`, `Cancelled`
- `Completed` → `Closed`
- `Closed Short`, `Closed`, `Cancelled` → terminal (no outgoing)

**Important honesty note:** the Production Order itself does **not** have
statuses named `Materials Reserved`, `Materials Issued`, `QC`, or `FG Received`.
Those ideas are represented on **child records**:
- **Material reservation** has its own status: `Reserved`, `PartiallyReserved`,
  `Pending`, `Completed`.
- **Material issue** has status `Issued`.
- **Quality inspection** has a `result` and an `inspectionType`.
- Finished goods receipt is not a status — it is an action (`complete`) that
  posts FG stock and sets the order to `Completed` / `Partially Completed`.

**Auto-completion:** when all Work Orders are `Completed` and `goodQuantity`
produces the full planned quantity, the system can mark the order `Completed`
automatically. When remaining > 0 it does **not** auto-complete (tested).

---

## 7. Material flow

```
Required  →  Reserved  →  Issued  →  Consumed  →  Remaining
```

**Real example — Finished Product A's BOM:**
- Raw Material A = 10 kg
- Raw Material B = 5 kg
- Packaging Box  = 2 pcs

For **10 finished units**:
- Raw A = 10 × 10 = **100 kg**
- Raw B = 10 × 5 = **50 kg**
- Packaging = 10 × 2 = **20 pcs**

How each stage moves:

| Stage | What happens | Stock effect |
|-------|--------------|--------------|
| **Required** | Production Order created; BOM exploded | none |
| **Reserved** | Order Released → reservation line per component | `reservedStock` up, `availableStock` down, on-hand unchanged |
| **Issued** | Issue materials → balance leaves the source warehouse | on-hand (`currentStock`) down, `reservedStock` down |
| **Consumed** | Material issued into production, attached to the order | recorded as issued/consumed |
| **Remaining** | `required − issued`; what is left to issue (if any) | — |

**On-hand vs Reserved vs Issued vs Available:**
- **On-hand (`currentStock`)** — physically in the location.
- **Reserved (`reservedStock`)** — ERP temporarily holds this quantity so
  another process cannot consume it. **Reservation = "held"**, not removed.
- **Available (`availableStock`)** — on-hand minus reserved; what can still be
  promised.
- **Issued (`issuedQuantity`)** — the quantity actually taken out for
  production; reduces on-hand.

---

## 8. Shop-floor operations

Operations run in **sequence order** as defined in the Routing. Each operation
is a Work Order.

**Example — Operation 1 "Raw Material Preparation":**
```
Start
 ↓
Enter Good Qty
 ↓
Enter Scrap
 ↓
Enter Rejected
 ↓
Enter Downtime
 ↓
Report
 ↓
Completed
```
Then Operation 2, then Operation 3, and so on.

**About double counting (important — tested behavior):**
- The order's final **Good / Scrap / Rejected** totals are taken from the
  **last operation that reported output**. If you report `15 good / 2 scrap /
  3 rejected` on Operation 1 and again on Operation 2, the order will not
  double-count; it uses the last operation's output.
- If a later operation is reported **empty** (0 in all output fields), the
  system **inherits the previous completed operation's output** if that previous
  operation was completed with output (so an empty report does not erase the
  numbers). The very first operation with an empty report does **not** inherit
  (there is nothing to inherit).
- Consequence: report the real output on the operation where production
  actually finished; do **not** re-enter the same scrap/rejected numbers on
  every operation to "add them up" — you may mis-state the final result.

---

## 9. Production output quantities

Fields that define the result:

| Quantity | Meaning |
|----------|---------|
| `plannedQuantity` | What you set out to produce |
| `goodQuantity` / `completedQuantity` | Usable units produced |
| `rejectedQuantity` | Units that failed and cannot be sold as-is |
| `scrapQuantity` | Wasted material/units |
| `reworkQuantity` | Units sent for rework |
| `remainingQuantity` | `planned − produced` (what is left) |

**Example — with losses:**
- Planned = 20
- Good = 15, Rejected = 3, Scrap = 2
- Accounted output = 15 + 3 + 2 = 20 → operation is complete
- produced = 15 (good units), remaining = 20 − 15 = **5**

**Example — partial production:**
- Planned = 20, Good = 15 → remaining = 5 → order is **Partially Completed**
- Later receive the remaining 5 → produced = 20, remaining = 0, order **Completed**

**Rule:** `goodQuantity` for the **current** receipt must never exceed the
**remaining quantity** for that receipt (the cap is enforced by the backend).

---

## 10. Quality control

Flow:
```
Production → Quality Inspection → Result
```

**Inspection type** (`inspectionType`):
- `Incoming` — inspecting material that comes in (raw material).
- `InProcess` (`In-Process` input is stored as `InProcess`) — during production.
- `Final` — on the finished output (default).

**Result** (`result`):
- `Pending` — inspection created, not yet decided (default).
- `Passed` — meets the standard.
- `Failed` — does not meet standard → create Rework.
- `Rework` — marked for rework.
- `Scrap` — decided to scrap.

Quality parameters evaluate `expectedValue` vs `actualValue` (with optional
`tolerance`); each parameter is `Pass`/`Fail`.

**Failed quality → Rework:**
```
Failed Quality
 ↓
Rework
 ↓
Rework Qty  →  Reason  →  Rework Cost  →  Rework Pending
 ↓
In Progress
 ↓
Completed
```
Use the **Rework** screen: `POST /api/manufacturing/rework`. Create it (status
`Pending`), then update status to `In Progress`, then `Completed`.

---

## 11. Scrap and rejected — the difference

These are **not** the same:

| Term | Meaning | Where entered |
|------|---------|--------------|
| **Good** | Usable finished units | Work Order `report` (`goodQuantity`) or FG receipt (`goodQuantity`) |
| **Rejected** | Units made but not accepted; flagged at the operation | Work Order `report` (`rejectedQuantity`) or `complete` body |
| **Scrap** | Wasted material/units; cannot be used | Work Order `report` (`scrapQuantity`) **or** the dedicated Scrap record (`record-scrap` / `scrap` resource) with a reason + cost |
| **Rework** | Units that will be fixed and re-inspected | Rework resource (`rework`) |

- **Good (15), Rejected (3), Scrap (2)** → accounted output = 20. Produced
  (good) = 15, remaining = 5.
- **Scrap** in a dedicated scrap record does **not** itself reduce on-hand
  stock in the implemented flow (material was already removed at Issue time);
  it records the loss, its reason and **cost** (added to costing).
- **Rejected** units are not added to good output; they appear as losses.

---

## 12. By-products

A **by-product** is separate output produced alongside the main product — and
unlike scrap it **has value and enters stock**.

Flow:
```
Production → By-product generated → By-product quantity → Warehouse receipt → Stock IN
```
Route: `POST /api/manufacturing/production-orders/:id/record-by-products` (or
the `by-products` resource).
- Fields per line: `productId` (the by-product product), `quantity`,
  `locationId`/`warehouseId` (defaults to the finished goods warehouse),
  `costAllocation`, `batchNumber`, `notes`.
- **Inventory effect:** on-hand stock of the by-product product **increases** in
  the receiving location (`inventoryPosted = true`).

**By-product vs Scrap:** a by-product is received into stock and adds value; a
scrap is a recorded loss with a cost and is not added to sellable stock.

---

## 13. Partial production

**This exact flow is tested** (see `tests/manufacturing-operation-report.test.js`).

Example with **Planned = 20, First production Good = 15**:
- Produced = 15, Remaining = 5, Status = **Partially Completed**.

Then production continues on the **same Production Order** (you do **not**
create a new order for the remaining 5):
- Second production Good = 5
- Produced = 20, Remaining = 0, Status = **Completed**.

Mechanics:
- After a partial receipt, the system resets completed work orders (that have
  `completedQuantity < planned`) back to `In Progress` so operations can
  continue.
- Subsequent receipts are capped at the remaining quantity.

---

## 14. Close short

When the business decides **not** to produce the remaining quantity:

```
Planned = 20, Produced = 15, Remaining = 5
   ↓
Close Short
   ↓
Enter mandatory reason
   ↓
Production Order = Closed Short
```

Route: `POST /api/manufacturing/production-orders/:id/close-short`.
- A **reason is mandatory** — without it the request is rejected.
- Only allowed when remaining > 0 and the order is `Released`, `In Progress`,
  `Paused`, or `Partially Completed` (or `Completed` with remaining > 0).
- Releases the remaining material reservations.
- Sets status to `Closed Short` (terminal) — this is **different** from
  `Completed`.

---

## 15. Costing

Costing screen: `GET /api/manufacturing/production-orders/:id/costing`.

The breakdown returned by the actual implementation:

| Field | Source (backend) |
|-------|------------------|
| `materialCost` | sum of BOM component `estimatedCost` × planned qty |
| `laborCost` | routing operations labor (setup+run hours × work center `costPerHour` × workers) |
| `machineCost` | routing operations machine time × machine `hourlyOperatingCost` (or actual work-order hours) |
| `overhead` | 10% of `laborCost` |
| `additionalCost` | sum of scrap record costs |
| `totalCost` | material + labor + machine + overhead + additional |
| `unitCost` | `totalCost / producedQuantity` (or total if 0 produced) |
| `variance` | `actualTotal − plannedTotal` |

**Planned/estimated vs actual:**
- **BOM estimated/planned cost** is computed from the BOM components and the
  Routing at planned quantity.
- **Actual production costing** uses the same breakdown but can use **actual
  work-order hours** and **scrap costs**; the current implementation reports
  both a `plannedCost` and `actualCost` on the same breakdown, and a global
  variance screen exists at `/api/manufacturing/costing/variance`.

---

## 16. Inventory effect table

| Action | Raw Material Stock | FG Stock | Reservation | Order Status |
|--------|--------------------|----------|-------------|--------------|
| Create MO | No change | No change | None | `Draft` |
| Release | Available decreases (reserved) | No change | Increased | `Released` |
| Issue Material | On-hand decreases | No change | Reduced / Issued | stays `Released`/`In Progress` |
| Report on operation | No change (already issued) | No automatic FG yet | — | `In Progress` |
| Receive FG | — | Increases by good qty | released if `Completed` | `Completed` or `Partially Completed` |
| Scrap (record) | Recorded loss (cost) — not re-posted | — | — | unchanged |
| By-product | — | By-product stock increases | — | unchanged |
| Close Short | — | No new FG | Remaining released | `Closed Short` |

---

## 17. Complete real example + tested scenarios

### End-to-end example — Finished Product A

- **Finished Product A**
- **Raw Material A** (kg), **Raw Material B** (kg), **Packaging Box** (pcs)
- BOM per unit: A = 10 kg, B = 5 kg, Box = 2 pcs

1. **Create products** — Warehouse → Products: Raw A, Raw B, Packaging Box,
   Finished Product A.
2. **Purchase raw materials** — Purchase → Orders: PO for Raw A / B / Box.
3. **GRN / Receipt** — Purchase → Goods Receiving: create + confirm GRN.
4. **Verify warehouse stock** — Warehouse → Stock: on-hand > 0.
5. **Create Work Center** — Manufacturing → Work Centers (e.g. Assembly).
6. **Create Machine** — Manufacturing → Machines (optional, linked to WC).
7. **Create BOM** — Manufacturing → BOMs: components A/B/Box with qty and
   estimated cost.
8. **Create Routing** — Manufacturing → Routings: 3 operations in sequence.
9. **Create Production Order** — Manufacturing → Production Orders: product,
   planned qty, source/FG warehouse.
10. **Release** — reservation + work orders created, status `Released`.
11. **Reserve materials** — done automatically at Release (verify on Materials).
12. **Issue materials** — Issue Selected Lines -> raw on-hand decreases.
13. **Start operations** — Start each Work Order (op 1 → start).
14. **Report quantities** — good/scrap/rejected/downtime.
15. **Complete operations** — complete each op; op 2, op 3.
16. **Output / FG receipt** — Complete & Receive FG -> FG stock increases.
17. **Quality inspection** — Add Inspection (Final), save.
18. **Quality failure** — result `Failed`.
19. **Create rework** — Add Rework.
20. **Rework Pending** — created `Pending`.
21. **Rework In Progress** — update status.
22. **Rework Completed** — update status.
23. **Production Order Completed** — full planned qty produced & FG received.
24. **Verify final list/status** — Production Orders list shows `Completed`.

### Scenario 1 — Full production: 10 / 10 → Completed

Planned 10 → report 10 good → receive FG 10 → remaining 0 → `Completed`.

### Scenario 2 — Partial: 15 / 20, continue the same MO

Planned 20 → report 15 → remaining 5 → status `Partially Completed` → continue
same order → report/receive remaining 5 → produced 20 → `Completed`.

### Scenario 3 — Close short

Planned 20 → produced 15 → remaining 5 → Close Short with reason →
`Closed Short`.

### Scenario 4 — Good + Rejected + Scrap + Close Short

Planned 20 → 15 good + 3 rejected + 2 scrap (accounted output = 20) → produced 15,
remaining 5 → receive remaining (if possible) → then Close Short with reason →
`Closed Short`.

> Practically: if you already processed all 20 units of material but only 15 were
> usable, the remaining "to produce" is 5. You either produce the remaining 5
> good units, or Close Short.

### Scenario 5 — Quality failure + rework

Planned 10 → produced 10 → FG receipt 10 → Quality `Failed` → Rework 10 →
`Pending` → `In Progress` → `Completed` → verification → MO `Completed`.

---

## 18. Button-by-button guide

Each button maps to a real route and behavior.

| Button | Route | When | What it does | Status change | Inventory change | Next |
|--------|-------|------|-------------|---------------|------------------|------|
| **New Order** | `POST /production-orders` | Start | Creates the production order | → `Draft` | none | add planned qty + warehouses, then Release |
| **Save** | `POST`/`PUT` on the resource | While editing draft records | Persists the record | none / draft | none | verify data |
| **Release** | `POST /production-orders/:id/release` | Order is `Draft`/`Planned` and source warehouse set | Reserves material, creates Work Orders + WIP | → `Released` | reserve stock up, available down | check Materials reservation |
| **Start** | `POST /production-orders/:id/start` | Order is `Released` | Marks order in production | → `In Progress` | none | run operations |
| **Hold / Pause** | `POST /production-orders/:id/pause` | `In Progress` | Pauses the order | → `Paused` | none | later Resume |
| **Resume** | `POST /production-orders/:id/resume` | `Paused` | Resumes | → `In Progress` | none | continue ops |
| **Report** | `POST /work-orders/:id/report` | Work order `In Progress` | Records good/scrap/rejected/downtime | op → `Completed` when accounted = planned | none | next op or FG receipt |
| **Complete** (work order) | `POST /work-orders/:id/complete` | Work order in progress | Marks op completed | op → `Completed` | none | next op |
| **Issue Materials / Issue Selected Lines** | `POST /production-orders/:id/issue-materials` | `Released`/`In Progress` | Exports material to production | reservation → `Completed`/`PartiallyReserved` | raw on-hand down | Start ops |
| **Complete & Receive FG** | `POST /production-orders/:id/complete` (or `record-output`) | `Released`/`In Progress`/`Partially Completed` | Receives good qty to FG warehouse | → `Completed` (0 remaining) or `Partially Completed` | FG stock up | Quality / Close |
| **Close** | `POST /production-orders/:id/close` | `Completed` | Final lock | → `Closed` | none | done |
| **Close Short** | `POST /production-orders/:id/close-short` | remaining > 0 (Released/In Progress/Partially Completed) | Stop early; reason required | → `Closed Short` | remaining reservations released | done |
| **Cancel** | `POST /production-orders/:id/cancel` | not terminal | Abort | → `Cancelled` | reservations released | done |
| **Add Inspection** | `POST /inspections` | After production | Create inspection | inspection `Pending` | none | Save Inspection |
| **Save Inspection** | `PUT /inspections/:id` | While editing inspection | Set params/result | result set (Passed/Failed/…) | none | rework if failed |
| **Add Rework** | `POST /rework` | Quality failed | Create rework | rework `Pending` | none | set status |
| **Update** (rework / work order) | `PUT` on the resource | advance rework / edit | Change fields/status | rework → `In Progress`/`Completed` | none | verify |
| **Complete** (rework) | `PUT /rework/:id` with status `Completed` | Rework done | Mark rework complete | rework → `Completed` | none | final quality / close |

> The exact on-screen label for "Hold" is **Pause** in the backend route
> (`/pause`); the UI may label it "Hold". The behavior is the `pause` action.

---

## 19. User decision guide

| If this happens | Do this |
|-----------------|---------|
| No raw material stock | Purchase material and confirm a GRN first |
| Material available but not reserved | Check Release: reservation happens at Release |
| Material reserved but not issued | Go to Materials → Issue |
| Operations not starting | Check order status (Released?), material issue, and Routing |
| Produced less than planned | It is `Partially Completed` — continue the same MO |
| Don't want to produce the remaining | Close Short with a reason |
| Quality failed | Create Rework → Pending → In Progress → Completed |
| Production fully complete | Output → Complete & Receive FG |
| Need extra usable output | Record a By-product (it enters stock) |
| Production wastage | Report Scrap (with reason/cost) |
| Wrong quantity entered on receipt | Note the cap: good ≤ remaining for the current receipt |

---

## 20. Assumptions and things verified

**Verified against the code:**
- Routes: `routes/manufacturingRoutes.js`, `controllers/manufacturingController.js`.
- Statuses/transitions: `utils/manufacturingWorkflow.js` (`ORDER_TRANSITIONS`).
- Inventory mechanics: `warehouse/services/locationService.js`
  (reserve / release / adjust stock).
- Tests: `tests/manufacturing-operation-report.test.js`,
  `tests/manufacturing-warehouse.test.js` (partial, close-short, no double-count,
  warehouse resolution).
- Purchase flow: `warehouse/routes/purchaseOrderRoutes.js`,
  `warehouse/routes/goodsReceivingRoutes.js`.

**Assumptions / notes:**
- This is the **backend**; on-screen button labels are produced by the frontend
  app which is not part of this repo. Every button listed here maps to a real
  route and its exact behavior.
- `Material Type` and `Country` are not product fields in this schema.
- Scrap records do not re-post inventory in the current implementation (material
  is removed at Issue); they record loss + cost.
- Rework records do not automatically change the Production Order status; the
  order is completed via operations + FG receipt.