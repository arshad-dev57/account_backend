# Bisonstechs ERP — Manufacturing Process Flow (Visual Diagrams)

Visual process maps for the Manufacturing Module. These diagrams match the
actual implemented workflow in this project (verified against
`controllers/manufacturingController.js`, `routes/manufacturingRoutes.js`,
`utils/manufacturingWorkflow.js` and the warehouse purchase/GRN modules).

> **Legend**
> - Rounded box = a **state / step** you act on.
> - Diamond = a **decision**.
> - Solid arrow = the normal path.
> - Dashed arrow = an alternative branch.
> - `(route)` = the API endpoint that performs the step (base `/api/manufacturing`).

---

## 1. The complete manufacturing journey (main flow)

```mermaid
flowchart TD
    A[START] --> B[Create / verify Warehouse<br/><i>(locations)</i>]
    B --> C[Create Raw Material Products<br/><i>(products)</i>]
    C --> D[Create Finished Product<br/><i>(products)</i>]
    D --> E[Create Supplier<br/><i>(warehouse/supplier)</i>]
    E --> F[Purchase Order<br/><i>POST purchase/orders</i>]
    F --> G[Goods Receipt / GRN<br/><i>POST purchase/goods-receiving</i>]
    G --> G1[Confirm GRN]
    G1 --> H[Raw Material Stock Available<br/><i>locations/:id/stock</i>]
    H --> I[Create Work Center<br/><i>POST work-centers</i>]
    I --> J[Create Machine<br/><i>POST machines</i>]
    J --> K[Create BOM<br/><i>POST boms</i>]
    K --> L[Create Routing<br/><i>POST routings</i>]
    L --> M[Create Production Order<br/><i>POST production-orders</i>]
    M --> N[Release Production Order<br/><i>POST production-orders/:id/release</i>]
    N --> O[Material Reservation<br/><i>auto at Release</i>]
    O --> P[Material Issue<br/><i>POST production-orders/:id/issue-materials</i>]
    P --> Q[Start Production<br/><i>POST production-orders/:id/start</i>]
    Q --> R[Operation 1<br/><i>work-orders/:id/start</i>]
    R --> R2[Operation 2]
    R2 --> R3[Operation 3]
    R3 --> S[Report Good / Rejected / Scrap / Downtime<br/><i>work-orders/:id/report</i>]
    S --> T[Production Output]
    T --> U[Finished Goods Receipt<br/><i>POST production-orders/:id/complete</i>]
    U --> V[Quality Inspection<br/><i>POST inspections</i>]
    V --> W{Quality passed?}
    W -- YES --> X[Production Completed]
    X --> Y[Costing<br/><i>GET production-orders/:id/costing</i>]
    Y --> Z[Close<br/><i>POST production-orders/:id/close</i>]
    Z --> END[Order Closed]
    W -- NO --> AA[Rework<br/><i>POST rework</i>]
    AA --> AB[Rework Pending]
    AB --> AC[Rework In Progress]
    AC --> AD[Rework Completed]
    AD --> AE[Final Quality / Production verification]
    AE --> AF[Complete / Close]
    AF --> END

    %% Alternative branches (dashed)
    M -.-> BP[By-product<br/><i>POST production-orders/:id/record-by-products</i>]
    S -.-> SR[Scrap / Rejected<br/><i>record-scrap</i>]
    U -.-> PR[Partial Production<br/>remaining > 0]
    PR -.-> M2[Continue same Production Order]
    M2 -.-> Q
    U -.-> CS[Close Short<br/><i>POST production-orders/:id/close-short</i>]
    CS -.-> CS2[Order Closed Short]
```

---

## 2. Alternative branches

### 2.1 Partial production (Planned 20 → produce 15 → continue → 20)

> Tested in `tests/manufacturing-operation-report.test.js`.

```mermaid
flowchart LR
    A[Planned = 20] --> B[Produced = 15]
    B --> C[Partially Completed<br/>Remaining = 5]
    C --> D[Continue the SAME Production Order<br/><i>do NOT create a new MO</i>]
    D --> E[Produce remaining 5<br/><i>report + Complete & Receive FG</i>]
    E --> F[Produced = 20, Remaining = 0]
    F --> G[Completed]
```

### 2.2 Close short (Planned 20 → 15 → stop remaining 5)

```mermaid
flowchart LR
    A[Planned = 20] --> B[Produced = 15]
    B --> C[Remaining = 5]
    C --> D[Close Short<br/><i>POST production-orders/:id/close-short</i>]
    D --> E[Enter mandatory reason]
    E --> F[Closed Short]
    style F fill:#fbb
```

### 2.3 Scrap / Rejected (correct output calculation)

```mermaid
flowchart TD
    A[Production] --> B[Good + Rejected + Scrap<br/>15 + 3 + 2 = 20 accounted]
    B --> C[Correct final output calculation]
    C --> D[Good produced = 15<br/>Remaining = 5]
    D --> E[Inventory / costing impact]
```

### 2.4 By-product (extra output enters stock)

```mermaid
flowchart LR
    A[Production] --> B[By-product generated<br/><i>POST record-by-products</i>]
    B --> C[By-product quantity]
    C --> D[Warehouse receipt<br/><i>defaults to FG warehouse</i>]
    D --> E[Stock increases<br/>on-hand + qty]
```

---

## 3. Production order lifecycle (statuses)

> Matches `ORDER_TRANSITIONS` in `utils/manufacturingWorkflow.js`.

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Released: Release
    Draft --> Cancelled: Cancel
    Planned --> Released: Release
    Planned --> Cancelled: Cancel
    Released --> "In Progress": Start
    Released --> Paused: Pause/Hold
    Released --> Completed: Complete (remaining = 0)
    Released --> "Partially Completed": Complete (remaining > 0)
    Released --> "Closed Short": Close Short
    Released --> Cancelled: Cancel
    "In Progress" --> Paused: Pause/Hold
    "In Progress" --> Completed: Complete (remaining = 0)
    "In Progress" --> "Partially Completed": Complete (remaining > 0)
    "In Progress" --> "Closed Short": Close Short
    "In Progress" --> Cancelled: Cancel
    Paused --> "In Progress": Resume
    Paused --> Completed: Complete (remaining = 0)
    Paused --> "Partially Completed": Complete (remaining > 0)
    Paused --> "Closed Short": Close Short
    "Partially Completed" --> "Partially Completed": Complete again
    "Partially Completed" --> Completed: remaining = 0
    "Partially Completed" --> "Closed Short": Close Short
    "Partially Completed" --> Cancelled: Cancel
    Completed --> Closed: Close
    Closed --> [*]
    "Closed Short" --> [*]
    Cancelled --> [*]
```

**Key facts the diagram shows:**
- `Draft` and `Planned` can only Release or Cancel.
- `Completed` can only go to `Closed` (unless it still has remaining quantity —
  then Close Short is allowed).
- `Closed`, `Closed Short` and `Cancelled` are terminal.

---

## 4. Master diagram — "Complete journey in 30 seconds"

```mermaid
flowchart TB
    subgraph PREPARATION[PREPARATION]
        P1[Products] --> P2[Supplier] --> P3[Purchase] --> P4[GRN] --> P5[Stock]
    end
    subgraph MASTERDATA[MASTER DATA]
        M1[Work Center] --> M2[Machine] --> M3[BOM] --> M4[Routing]
    end
    subgraph PRODUCTION[PRODUCTION]
        N1[Production Order] --> N2[Release] --> N3[Reservation] --> N4[Issue] --> N5[Operations]
    end
    subgraph OUTPUT[OUTPUT]
        O1[Good] --> O2[Rejected] --> O3[Scrap] --> O4[Rework] --> O5[FG Receipt]
    end
    subgraph QUALITY[QUALITY]
        Q1[Inspection] --> Q2{Pass / Fail}
        Q2 -->|Fail| Q3[Rework]
    end
    subgraph FINANCIAL[FINANCIAL]
        F1[Costing] --> F2[Actual Cost] --> F3[Unit Cost]
    end
    subgraph CLOSING[CLOSING]
        C1[Completed] --> C2[Closed]
        C3[Partially Completed] --> C4[Continue]
        C5[Close Short]
    end

    P5 --> MASTERDATA
    MASTERDATA --> PRODUCTION
    PRODUCTION --> OUTPUT
    OUTPUT --> QUALITY
    QUALITY --> FINANCIAL
    FINANCIAL --> CLOSING
```

---

## 5. Purchase → stock flow

```mermaid
flowchart TD
    S[Supplier] --> PO[Purchase Order<br/><i>POST /api/purchase/orders</i>]
    PO --> POA[PO Created / Approved<br/><b>intent to buy - no stock change</b>]
    POA --> GRN[Goods Receipt / GRN<br/><i>POST /api/purchase/goods-receiving</i>]
    GRN --> GRNC[Confirm GRN<br/><i>POST /api/purchase/goods-receiving/:id/confirm</i>]
    GRNC --> STK[Warehouse Stock IN<br/><b>material physically arrived</b>]
    STK --> AV[Raw material available for manufacturing]
```

**Plain-English meanings:**
- **Purchase Order** = "we intend to buy"
- **GRN / Receipt** = "material physically arrived"
- **Stock** = "material is now available for manufacturing"

---

## 6. Material flow

```mermaid
flowchart LR
    A[Required] --> B[Reserved]
    B --> C[Issued]
    C --> D[Consumed]
    D --> E[Remaining]
```

Example (Finished Product A, BOM: Raw A = 10 kg, Raw B = 5 kg, Box = 2 pcs) for 10 units:

```mermaid
flowchart LR
    A[Release] --> B[Reservation<br/>A 100 kg, B 50 kg, Box 20 pcs]
    B --> C[Issue<br/>material leaves source warehouse]
    C --> D[On-hand decreases<br/>reserved reduced]
    D --> E[Remaining = required - issued]
```

---

## 7. Quality control flow

```mermaid
flowchart TD
    A[Production] --> B[Quality Inspection<br/><i>Incoming / InProcess / Final</i>]
    B --> C{Result}
    C -->|Passed| D[Accepted]
    C -->|Failed| E[Rework]
    C -->|Rework| E
    C -->|Scrap| F[Recorded as scrap]
    C -->|Pending| G[Still under review]
    E --> H[Rework Pending]
    H --> I[Rework In Progress]
    I --> J[Rework Completed]
    J --> K[Final verification]
```

---

## 8. Shop-floor operation (per operation)

```mermaid
flowchart TD
    A[Work Order Pending] --> B[Start<br/><i>work-orders/:id/start</i>]
    B --> C[Enter Good Qty]
    C --> D[Enter Scrap]
    D --> E[Enter Rejected]
    E --> F[Enter Downtime]
    F --> G[Report<br/><i>work-orders/:id/report</i>]
    G --> H{Good + Scrap + Rejected >= Planned?}
    H -- Yes --> I[Operation Completed]
    H -- No --> J[Still In Progress]
    I --> K[Next operation in sequence]
```

---

## 9. ASCII fallback (no renderer)

```
START
  |
  v
Warehouse --> Raw Material --> Finished Product --> Supplier
  |---> Purchase Order ---> Goods Receipt/GRN (confirm) ---> Raw Stock
  |---> Work Center ---> Machine ---> BOM ---> Routing
  |---> Production Order ---> Release ---> Reservation ---> Issue
  |---> Start Production ---> Op1 ---> Op2 ---> Op3
  |---> Report Good/Rejected/Scrap/Downtime
  |---> Production Output ---> FG Receipt
  |---> Quality Inspection
  |        |-- Passed --> Completed --> Costing --> Close
  |        |-- Failed --> Rework (Pending --> In Progress --> Completed)
  |---> (partial) Partially Completed --> Continue same MO --> Completed
  |---> (stop)   Close Short (reason) --> Closed Short
  |---> (scrap)  Scrap / Rejected recorded
  |---> (extra)  By-product --> warehouse stock IN
```