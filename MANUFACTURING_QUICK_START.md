# Bisonstechs ERP — Manufacturing Quick Start

The short version. For the full details see `MANUFACTURING_USER_GUIDE.md` and
`MANUFACTURING_PROCESS_FLOW.md`. All manufacturing routes are under
`/api/manufacturing`.

**Golden rule:** manufacturing can only consume material that is already in
warehouse stock. Buy it and confirm the GRN before you plan production.

---

## 1. What you need to set up first (in order)

1. **Warehouse** — `POST /api/warehouse/locations` (source, WIP, finished goods).
2. **Raw Material products** — `POST /api/warehouse/products`.
3. **Finished Product** — `POST /api/warehouse/products`.
4. **Supplier** — `POST /api/warehouse/supplier`.
5. **Purchase Order** — `POST /api/purchase/orders` ("we intend to buy").
6. **Goods Receipt / GRN** — `POST /api/purchase/goods-receiving` then
   confirm (`/confirm`). This puts material in stock.
7. **Work Center** — `POST /work-centers`.
8. **Machine** — `POST /machines` (optional, linked to a Work Center).
9. **BOM** — `POST /boms` (WHAT material, the recipe).
10. **Routing** — `POST /routings` (HOW to produce, the steps).

---

## 2. Run a production order

| Step | Action | Route (under `/api/manufacturing`) |
|------|--------|-----------------------------------|
| 1 | Create Production Order | `POST /production-orders` → `Draft` |
| 2 | **Release** | `POST /production-orders/:id/release` → reservations + Work Orders → `Released` |
| 3 | Check Materials reserved | `GET /production-orders/:id/materials` |
| 4 | **Issue materials** | `POST /production-orders/:id/issue-materials` → raw stock leaves warehouse |
| 5 | **Start** | `POST /production-orders/:id/start` → `In Progress` |
| 6 | Run operations (op1 → opN) | `POST /work-orders/:id/start`, `/report`, `/complete` |
| 7 | **Complete & Receive FG** | `POST /production-orders/:id/complete` → FG stock increases → `Completed` or `Partially Completed` |
| 8 | Quality Inspection | `POST /inspections` |
| 9 | If failed → **Rework** | `POST /rework` (Pending → In Progress → Completed) |
| 10 | **Close** | `POST /production-orders/:id/close` → `Closed` |

---

## 3. The 4 ways a production order can end

- **Completed → Closed** — full planned qty produced and FG received.
- **Partially Completed → continue** — produced part now, finish the rest on the
  **same** order.
- **Closed Short** — decide not to produce the remaining qty; reason (mandatory).
- **Cancelled** — abort; reservations are released.

---

## 4. Quick decision guide

| Situation | Do |
|-----------|----|
| No raw stock | Purchase + confirm GRN first |
| Reserved but not issued | Materials → Issue |
| Produced less than planned | `Partially Completed` — continue same MO |
| Don't want remaining | Close Short (reason) |
| Quality failed | Rework → Pending → In Progress → Completed |
| Production fully complete | Output → Complete & Receive FG |
| Extra usable output | By-product (enters stock) |
| Wastage | Report Scrap (reason + cost) |

---

## 5. Quick status reference

**Production Order:** `Draft` → `Released` → `In Progress` / `Paused` →
`Partially Completed` → `Completed` → `Closed` (or `Closed Short`, `Cancelled`).

**Work Order (operation):** `Pending` → `In Progress` → (`Paused`) → `Completed`.

**Reservation:** `Pending` → `Reserved` / `PartiallyReserved` → `Completed`.

**Inspection result:** `Pending` → `Passed` / `Failed` / `Rework` / `Scrap`.

**Rework:** `Pending` → `In Progress` → `Completed`.

---

## 6. Key numbers to remember

- Required material = `BOM qty × planned × (1 + scrap% / 100)`.
- Good received per receipt **≤ remaining** for that receipt.
- Issue check: issuing more than on-hand fails unless negative inventory is
  enabled.
- `Complete & Receive FG` posts finished goods stock **into** the FG warehouse.