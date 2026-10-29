'use strict';

/**
 * ERPNext Manufacturing DocTypes → Bisonstechs Prisma models.
 * Field `n` = Prisma column; `l` = ERPNext desk label.
 *
 * Naming:
 *   Work Order  = ManufacturingProductionOrder
 *   Job Card    = ManufacturingWorkOrder
 *   Workstation = ManufacturingWorkCenter
 */

const DRAFT_ACTIVE = [
  { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Active', action: 'edit' },
  { key: 'obsolete', label: 'Mark Obsolete', from: ['Active'], to: 'Obsolete', action: 'edit' }
];

const WORK_ORDER_FLOW = [
  { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Not Started', action: 'edit' },
  { key: 'start', label: 'Start', from: ['Not Started', 'Draft', 'Planned', 'Released'], to: 'In Process', action: 'edit' },
  { key: 'complete', label: 'Complete', from: ['In Process', 'In Progress', 'Released'], to: 'Completed', action: 'edit' },
  { key: 'stop', label: 'Stop', from: ['In Process', 'In Progress'], to: 'Stopped', action: 'edit' },
  { key: 'cancel', label: 'Cancel', from: ['Draft', 'Not Started', 'Planned', 'Released', 'In Process', 'In Progress', 'Stopped', 'Paused'], to: 'Cancelled', action: 'edit' }
];

const JOB_CARD_FLOW = [
  { key: 'start', label: 'Start Job', from: ['Open', 'Material Transferred', 'To Manufacture'], to: 'Work In Progress', action: 'edit' },
  { key: 'complete', label: 'Complete', from: ['Work In Progress', 'On Hold'], to: 'Completed', action: 'edit' },
  { key: 'hold', label: 'Pause', from: ['Work In Progress'], to: 'On Hold', action: 'edit' },
  { key: 'resume', label: 'Resume', from: ['On Hold'], to: 'Work In Progress', action: 'edit' },
  {
    key: 'cancel',
    label: 'Cancel',
    from: ['Open', 'Work In Progress', 'On Hold', 'Partially Transferred', 'Material Transferred', 'To Manufacture', 'Submitted'],
    to: 'Cancelled',
    action: 'edit'
  }
];

const registry = {
  bom: {
    model: 'manufacturingBOM',
    doctype: 'BOM',
    workspace: 'manufacturing',
    section: 'Setup',
    titleField: 'bomNumber',
    numberField: 'bomNumber',
    numberPrefix: 'BOM',
    unique: ['bomNumber'],
    statuses: ['Draft', 'Active', 'Obsolete'],
    actions: DRAFT_ACTIVE,
    columns: ['bomNumber', 'productName', 'quantity', 'status', 'totalEstimatedCost', 'isDefault'],
    search: ['bomNumber', 'productName'],
    include: { components: true },
    children: {
      components: {
        relation: 'components',
        model: 'manufacturingBOMComponent',
        foreignKey: 'bomId',
        mapRow: (row) => ({
          componentId: row.componentId,
          componentName: row.componentName || '',
          quantity: Number(row.quantity) || 0,
          unitOfMeasure: row.unitOfMeasure || 'Nos',
          rate: Number(row.rate) || 0,
          estimatedCost: Number(row.estimatedCost || row.amount) || 0,
          bomNo: row.bomNo || null,
          sourceWarehouse: row.sourceWarehouse || null,
          doNotExplode: Boolean(row.doNotExplode),
          percentage: Number(row.percentage) || 0,
          scrapPercentage: Number(row.scrapPercentage) || 0,
          sequence: Number(row.sequence) || 0,
          notes: row.notes || null
        })
      }
    },
    // Exact live ERPNext BOM form (desk/manufacturing/bom) field order + labels
    fields: [
      // ── Production Item ──────────────────────────────────────────────
      { tab: 'Production Item', n: 'companyId', l: 'Company', t: 'company', r: true },
      { tab: 'Production Item', n: 'productId', l: 'Item to Manufacture', t: 'link', o: 'product', r: true },
      {
        tab: 'Production Item',
        n: 'quantity',
        l: 'Quantity (Output Qty)',
        t: 'float',
        r: true,
        d: 1,
        when: [{ field: 'productId', truthy: true }]
      },
      {
        tab: 'Production Item',
        n: 'uom',
        l: 'Unit Of Measure',
        t: 'data',
        d: 'Nos',
        ro: true,
        when: [{ field: 'productId', truthy: true }]
      },
      {
        tab: 'Production Item',
        s: 'Cost Allocation / Process Loss',
        n: 'costAllocationPer',
        l: '% Cost Allocation',
        t: 'float',
        d: 100,
        ro: true
      },
      {
        tab: 'Production Item',
        n: 'costAllocation',
        l: 'Cost Allocation',
        t: 'currency',
        d: 0,
        ro: true
      },
      { tab: 'Production Item', n: 'processLossPercentage', l: '% Process Loss', t: 'float', d: 0 },
      { tab: 'Production Item', n: 'processLossQty', l: 'Process Loss Qty', t: 'float', d: 0, ro: true },
      {
        tab: 'Production Item',
        s: 'Operations',
        n: 'withOperations',
        l: 'With Operations',
        t: 'bool',
        d: false,
        when: [{ field: 'isPhantomBom', equals: false }]
      },
      {
        tab: 'Production Item',
        n: 'trackSemiFinishedGoods',
        l: 'Produce Item per Operation',
        t: 'bool',
        d: false,
        when: [{ field: 'withOperations', equals: true }]
      },
      {
        tab: 'Production Item',
        n: 'transferMaterialAgainst',
        l: 'Transfer Material Against',
        t: 'select',
        o: ['', 'Work Order', 'Job Card'],
        d: 'Work Order',
        when: [
          { field: 'withOperations', equals: true },
          { field: 'trackSemiFinishedGoods', equals: false }
        ]
      },
      {
        tab: 'Production Item',
        n: 'routingId',
        l: 'Routing',
        t: 'link',
        o: 'routing',
        when: [{ field: 'withOperations', equals: true }]
      },
      {
        tab: 'Production Item',
        n: 'fgBasedOperatingCost',
        l: 'Finished Goods based Operating Cost',
        t: 'bool',
        d: false
      },
      {
        tab: 'Production Item',
        n: 'operatingCostPerBomQuantity',
        l: 'Operating Cost Per BOM Quantity',
        t: 'currency',
        d: 0,
        when: [{ field: 'fgBasedOperatingCost', equals: true }]
      },
      {
        tab: 'Production Item',
        n: 'operations',
        l: 'Operations',
        t: 'table',
        when: [{ field: 'withOperations', equals: true }],
        rows: [
          { n: 'operation', l: 'Operation', t: 'data', r: true },
          { n: 'sequenceId', l: 'Sequence ID', t: 'int', d: 1 },
          { n: 'finishedGood', l: 'Output Item', t: 'link', o: 'product' },
          { n: 'finishedGoodQty', l: 'Output Qty', t: 'float', d: 0 },
          { n: 'bomNo', l: 'Output Item BOM', t: 'link', o: 'bom' },
          { n: 'workstationType', l: 'Workstation Type', t: 'data' },
          { n: 'workstation', l: 'Workstation', t: 'data' },
          { n: 'timeInMins', l: 'Operation Time', t: 'float', r: true, d: 0 }
        ]
      },
      {
        tab: 'Production Item',
        n: 'components',
        l: 'Components',
        t: 'table',
        r: true,
        rows: [
          { n: 'componentId', l: 'Item Code', t: 'link', o: 'product', r: true },
          { n: 'quantity', l: 'Qty', t: 'float', r: true, d: 0 },
          { n: 'unitOfMeasure', l: 'UOM', t: 'data', d: 'Nos', r: true },
          { n: 'rate', l: 'Rate', t: 'currency', d: 0, r: true },
          { n: 'estimatedCost', l: 'Amount', t: 'currency', d: 0, ro: true }
        ]
      },
      {
        tab: 'Production Item',
        n: 'secondaryItems',
        l: 'Secondary Items',
        t: 'table',
        rows: [
          { n: 'itemCode', l: 'Item Code', t: 'link', o: 'product', r: true },
          { n: 'qty', l: 'Qty', t: 'float', d: 0 },
          { n: 'rate', l: 'Rate', t: 'currency', d: 0 },
          { n: 'amount', l: 'Amount', t: 'currency', d: 0, ro: true }
        ]
      },

      // ── BOM Configuration ───────────────────────────────────────────
      { tab: 'BOM Configuration', n: 'isActive', l: 'Is Active', t: 'bool', d: true },
      { tab: 'BOM Configuration', n: 'isDefault', l: 'Is Default', t: 'bool', d: false },
      {
        tab: 'BOM Configuration',
        n: 'setRateOfSubAssemblyItemBasedOnBom',
        l: 'Set rate of sub-assembly item based on BOM',
        t: 'bool',
        d: true
      },
      { tab: 'BOM Configuration', n: 'isPhantomBom', l: 'Is Phantom BOM', t: 'bool', d: false },
      {
        tab: 'BOM Configuration',
        n: 'allowAlternativeItem',
        l: 'Allow Alternative Item',
        t: 'bool',
        d: false
      },
      {
        tab: 'BOM Configuration',
        s: 'Quality Inspection',
        n: 'inspectionRequired',
        l: 'Quality Inspection Required',
        t: 'bool',
        d: false,
        when: [{ field: 'isPhantomBom', equals: false }]
      },
      {
        tab: 'BOM Configuration',
        n: 'qualityInspectionTemplate',
        l: 'Quality Inspection Template',
        t: 'data',
        when: [{ field: 'inspectionRequired', equals: true }]
      },
      {
        tab: 'BOM Configuration',
        s: 'Default Warehouse',
        n: 'defaultSourceWarehouse',
        l: 'Default Source Warehouse',
        t: 'data'
      },
      { tab: 'BOM Configuration', n: 'defaultTargetWarehouse', l: 'Default Target Warehouse', t: 'data' },
      {
        tab: 'BOM Configuration',
        s: 'Consume Components',
        n: 'backflushBasedOn',
        l: 'Based On',
        t: 'select',
        o: ['', 'BOM', 'Material Transferred for Manufacture'],
        d: 'BOM'
      },

      // ── Costing ─────────────────────────────────────────────────────
      {
        tab: 'Costing',
        n: 'operatingCost',
        l: 'Operating Cost',
        t: 'currency',
        d: 0,
        ro: true,
        when: [{ field: 'isPhantomBom', equals: false }]
      },
      { tab: 'Costing', n: 'rawMaterialCost', l: 'Raw Material Cost', t: 'currency', d: 0, ro: true },
      {
        tab: 'Costing',
        n: 'secondaryItemsCost',
        l: 'Secondary Items Cost',
        t: 'currency',
        d: 0,
        ro: true,
        when: [{ field: 'isPhantomBom', equals: false }]
      },
      { tab: 'Costing', n: 'totalEstimatedCost', l: 'Total Cost', t: 'currency', d: 0, ro: true },

      // ── More Info ───────────────────────────────────────────────────
      {
        tab: 'More Info',
        s: 'Cost Configuration',
        n: 'rmCostAsPer',
        l: 'Rate Of Materials Based On',
        t: 'select',
        o: ['Valuation Rate', 'Last Purchase Rate', 'Price List'],
        d: 'Valuation Rate',
        when: [{ field: 'isPhantomBom', equals: false }]
      },
      {
        tab: 'More Info',
        n: 'buyingPriceList',
        l: 'Price List',
        t: 'data',
        when: [{ field: 'rmCostAsPer', equals: 'Price List' }]
      },
      { tab: 'More Info', n: 'currency', l: 'Currency', t: 'data', r: true, d: 'PKR' },
      { tab: 'More Info', n: 'conversionRate', l: 'Conversion Rate', t: 'float', r: true, d: 1 },
      {
        tab: 'More Info',
        s: 'Production Item Info',
        n: 'productName',
        l: 'Item Name',
        t: 'data',
        ro: true
      },
      { tab: 'More Info', n: 'description', l: 'Item Description', t: 'longText', ro: true },
      {
        tab: 'More Info',
        n: 'project',
        l: 'Project',
        t: 'data',
        when: [{ field: 'isPhantomBom', equals: false }]
      },

      // ── Exploded Items (ERPNext: only after save) ────────────────────
      {
        tab: 'Exploded Items',
        n: 'explodedItems',
        l: 'Exploded Items',
        t: 'table',
        ro: true,
        when: [{ field: 'bomNumber', truthy: true }],
        rows: [
          { n: 'itemCode', l: 'Item Code', t: 'data' },
          { n: 'itemName', l: 'Item Name', t: 'data' },
          { n: 'qty', l: 'Qty', t: 'float', d: 0 },
          { n: 'uom', l: 'UOM', t: 'data' },
          { n: 'rate', l: 'Rate', t: 'currency', d: 0 },
          { n: 'amount', l: 'Amount', t: 'currency', d: 0 }
        ]
      },

      // System-only (hidden — not on ERPNext form)
      { n: 'bomNumber', l: 'ID', t: 'data', ro: true, hidden: true },
      { n: 'effectiveFrom', l: 'Effective From', t: 'date', d: 'today', hidden: true },
      { n: 'version', l: 'Version', t: 'data', d: '1.0', hidden: true }
    ]
  },

  routing: {
    model: 'manufacturingRouting',
    doctype: 'Routing',
    workspace: 'manufacturing',
    section: 'Setup',
    titleField: 'routingNumber',
    numberField: 'routingNumber',
    numberPrefix: 'RT',
    unique: ['routingNumber'],
    statuses: ['Draft', 'Active', 'Obsolete'],
    actions: DRAFT_ACTIVE,
    columns: ['routingNumber', 'productName', 'version', 'status', 'totalEstimatedTime'],
    search: ['routingNumber', 'productName'],
    include: { operations: true },
    children: {
      operations: {
        relation: 'operations',
        model: 'manufacturingRoutingOperation',
        foreignKey: 'routingId',
        mapRow: (row) => ({
          sequence: Number(row.sequence) || 1,
          operationName: row.operationName,
          workCenterId: row.workCenterId,
          setupTime: Number(row.setupTime) || 0,
          runTime: Number(row.runTime) || 0,
          estimatedCost: Number(row.estimatedCost) || 0,
          description: row.description || null,
          notes: row.notes || null
        })
      }
    },
    fields: [
      { n: 'routingNumber', l: 'Routing Name', t: 'data', ro: true },
      { n: 'productId', l: 'Item', t: 'link', o: 'product', r: true },
      { n: 'productName', l: 'Item Name', t: 'data', ro: true },
      { n: 'version', l: 'Version', t: 'data', d: '1.0' },
      { n: 'status', l: 'Disabled', t: 'select', o: ['Draft', 'Active', 'Obsolete'], d: 'Draft' },
      { n: 'description', l: 'Description', t: 'longText' },
      {
        s: 'Operations',
        n: 'operations',
        l: 'Operations',
        t: 'table',
        rows: [
          { n: 'sequence', l: 'Seq', t: 'int', r: true, d: 1 },
          { n: 'operationName', l: 'Operation', t: 'data', r: true },
          { n: 'workCenterId', l: 'Workstation', t: 'link', o: 'workstation', r: true },
          { n: 'setupTime', l: 'Setup Time', t: 'float', d: 0 },
          { n: 'runTime', l: 'Operating Time', t: 'float', d: 0 },
          { n: 'estimatedCost', l: 'Operating Cost', t: 'currency', d: 0 }
        ]
      },
      { n: 'totalEstimatedTime', l: 'Total Time', t: 'float', d: 0, ro: true },
      { n: 'totalEstimatedCost', l: 'Total Cost', t: 'currency', d: 0, ro: true },
      { n: 'notes', l: 'Notes', t: 'longText' }
    ]
  },

  operation: {
    model: 'manufacturingOperation',
    doctype: 'Operation',
    workspace: 'manufacturing',
    section: 'Setup',
    titleField: 'name',
    unique: ['name'],
    columns: ['name', 'workstationId', 'description', 'disabled'],
    search: ['name', 'description'],
    fields: [
      { n: 'name', l: 'Operation', t: 'data', r: true },
      { n: 'workstationId', l: 'Default Workstation', t: 'link', o: 'workstation' },
      { n: 'description', l: 'Description', t: 'longText' },
      { n: 'batchSize', l: 'Batch Size', t: 'float', d: 1 },
      { n: 'totalOperationTime', l: 'Total Operation Time', t: 'float', d: 0 },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false }
    ]
  },

  workstation: {
    model: 'manufacturingWorkCenter',
    doctype: 'Workstation',
    workspace: 'manufacturing',
    section: 'Setup',
    titleField: 'name',
    numberField: 'workCenterCode',
    numberPrefix: 'WS',
    unique: ['workCenterCode'],
    columns: ['workCenterCode', 'name', 'workstationTypeId', 'status', 'costPerHour'],
    search: ['workCenterCode', 'name'],
    fields: [
      { n: 'workCenterCode', l: 'ID', t: 'data', ro: true },
      { n: 'name', l: 'Workstation Name', t: 'data', r: true },
      { n: 'workstationTypeId', l: 'Workstation Type', t: 'link', o: 'workstation-type' },
      { n: 'department', l: 'Plant Floor / Department', t: 'data' },
      { n: 'status', l: 'Status', t: 'select', o: ['Active', 'Inactive', 'Maintenance', 'Off'], d: 'Active' },
      { n: 'capacity', l: 'Production Capacity', t: 'float', d: 0 },
      { n: 'efficiency', l: 'Efficiency %', t: 'float', d: 100 },
      { s: 'Working Hours', n: 'costPerHour', l: 'Hour Rate', t: 'currency', d: 0 },
      { n: 'description', l: 'Description', t: 'longText' },
      { n: 'notes', l: 'Notes', t: 'longText' }
    ]
  },

  'workstation-type': {
    model: 'manufacturingWorkstationType',
    doctype: 'Workstation Type',
    workspace: 'manufacturing',
    section: 'Setup',
    titleField: 'name',
    unique: ['name'],
    columns: ['name', 'hourRate', 'description'],
    search: ['name'],
    fields: [
      { n: 'name', l: 'Workstation Type', t: 'data', r: true },
      { n: 'hourRate', l: 'Hour Rate', t: 'currency', d: 0 },
      { n: 'hourRateElectricity', l: 'Hour Rate Electricity', t: 'currency', d: 0 },
      { n: 'hourRateConsumable', l: 'Hour Rate Consumable', t: 'currency', d: 0 },
      { n: 'hourRateRent', l: 'Hour Rate Rent', t: 'currency', d: 0 },
      { n: 'hourRateLabour', l: 'Hour Rate Labour', t: 'currency', d: 0 },
      { n: 'description', l: 'Description', t: 'longText' }
    ]
  },

  'work-order': {
    model: 'manufacturingProductionOrder',
    doctype: 'Work Order',
    workspace: 'manufacturing',
    titleField: 'orderNumber',
    numberField: 'orderNumber',
    numberPrefix: 'MFG-WO',
    statuses: ['Draft', 'Not Started', 'In Process', 'Completed', 'Stopped', 'Cancelled', 'Planned', 'Released', 'In Progress', 'Paused', 'Closed'],
    actions: WORK_ORDER_FLOW,
    columns: ['orderNumber', 'productName', 'plannedQuantity', 'producedQuantity', 'status', 'startDate'],
    search: ['orderNumber', 'productName'],
    fields: [
      { n: 'orderNumber', l: 'Work Order', t: 'data', ro: true },
      {
        n: 'status',
        l: 'Status',
        t: 'select',
        o: ['Draft', 'Not Started', 'In Process', 'Completed', 'Stopped', 'Cancelled', 'Planned', 'Released', 'In Progress', 'Paused', 'Closed'],
        d: 'Draft',
        ro: true
      },
      { n: 'productId', l: 'Item To Manufacture', t: 'link', o: 'product', r: true },
      { n: 'productName', l: 'Item Name', t: 'data', ro: true },
      { n: 'bomId', l: 'BOM No', t: 'link', o: 'bom', r: true },
      { n: 'routingId', l: 'Routing', t: 'link', o: 'routing' },
      { n: 'plannedQuantity', l: 'Qty To Manufacture', t: 'float', r: true, d: 1 },
      { n: 'producedQuantity', l: 'Manufactured Qty', t: 'float', d: 0, ro: true },
      { n: 'scrapQuantity', l: 'Process Loss Qty', t: 'float', d: 0, ro: true },
      { n: 'remainingQuantity', l: 'Qty', t: 'float', d: 0, hidden: true },
      { s: 'Time', n: 'startDate', l: 'Planned Start Date', t: 'datetime', r: true },
      { n: 'dueDate', l: 'Planned End Date', t: 'datetime', r: true },
      { n: 'actualStartDate', l: 'Actual Start Date', t: 'datetime', ro: true },
      { n: 'actualEndDate', l: 'Actual End Date', t: 'datetime', ro: true },
      { n: 'priority', l: 'Priority', t: 'select', o: ['Low', 'Normal', 'High', 'Urgent'], d: 'Normal' },
      { n: 'notes', l: 'Project / Notes', t: 'longText' },
      { n: 'description', l: 'Description', t: 'longText' }
    ]
  },

  'job-card': {
    model: 'manufacturingWorkOrder',
    doctype: 'Job Card',
    workspace: 'manufacturing',
    titleField: 'workOrderNumber',
    numberField: 'workOrderNumber',
    numberPrefix: 'PO-JOB',
    statuses: [
      'Open',
      'Work In Progress',
      'Partially Transferred',
      'Material Transferred',
      'On Hold',
      'Submitted',
      'To Manufacture',
      'Cancelled',
      'Completed'
    ],
    actions: JOB_CARD_FLOW,
    columns: ['workOrderNumber', 'productionOrderId', 'operationName', 'workCenterId', 'plannedQuantity', 'status'],
    search: ['workOrderNumber', 'operationName', 'productionItem', 'itemName'],
    // Exact live ERPNext Job Card form (desk/manufacturing/job-card)
    fields: [
      // ── Details (default tab) ───────────────────────────────────────
      { n: 'productionOrderId', l: 'Work Order', t: 'link', o: 'work-order', r: true },
      { n: 'operationName', l: 'Operation', t: 'link', o: 'operation', r: true },
      { n: 'plannedQuantity', l: 'Qty to Manufacture', t: 'float', d: 0 },
      { n: 'workCenterId', l: 'Workstation', t: 'link', o: 'workstation', r: true },
      { n: 'stockUom', l: 'Stock UOM', t: 'data', ro: true },
      {
        n: 'productionItem',
        l: 'Final Product',
        t: 'link',
        o: 'product',
        ro: true,
        when: [{ field: 'finishedGood', truthy: false }]
      },
      {
        n: 'bomNo',
        l: 'Final BOM',
        t: 'link',
        o: 'bom',
        ro: true,
        when: [{ field: 'finishedGood', truthy: false }]
      },
      { n: 'employeeId', l: 'Employee', t: 'link', o: 'employee', ro: true },
      { n: 'companyId', l: 'Company', t: 'company', r: true },
      {
        n: 'namingSeries',
        l: 'Naming Series',
        t: 'select',
        o: ['PO-JOB.#####'],
        d: 'PO-JOB.#####',
        r: true
      },
      { n: 'postingDate', l: 'Posting Date', t: 'date', d: 'today' },

      {
        s: 'Semi Finished Good / Finished Good',
        n: 'finishedGood',
        l: 'Item to Manufacture',
        t: 'link',
        o: 'product',
        ro: true
      },
      { n: 'semiFgBom', l: 'Manufacturing BOM', t: 'link', o: 'bom', ro: true },

      {
        s: 'Warehouse',
        n: 'workstationType',
        l: 'Workstation Type',
        t: 'link',
        o: 'workstation-type'
      },
      { n: 'sourceWarehouse', l: 'Source Warehouse', t: 'data' },
      {
        n: 'skipMaterialTransfer',
        l: 'Skip Material Transfer to WIP',
        t: 'bool',
        d: false,
        when: [{ field: 'finishedGood', truthy: true }]
      },
      {
        n: 'backflushFromWipWarehouse',
        l: 'Backflush Materials from WIP Warehouse',
        t: 'bool',
        d: false,
        when: [
          { field: 'finishedGood', truthy: true },
          { field: 'skipMaterialTransfer', equals: true }
        ]
      },
      { n: 'wipWarehouse', l: 'WIP Warehouse', t: 'data' },
      {
        n: 'targetWarehouse',
        l: 'Target Warehouse',
        t: 'data',
        when: [{ field: 'trackSemiFinishedGoods', equals: true }]
      },

      { s: 'Progress', n: 'pendingQty', l: 'Pending qty', t: 'float', d: 0 },
      {
        n: 'scrapQuantity',
        l: 'Process Loss qty',
        t: 'float',
        d: 0,
        ro: true,
        when: [{ field: 'scrapQuantity', truthy: true }]
      },
      {
        n: 'completedQuantity',
        l: 'Total Completed qty',
        t: 'float',
        d: 0,
        ro: true,
        when: [{ field: 'isSubcontracted', equals: false }]
      },
      {
        n: 'manufacturedQty',
        l: 'Manufactured Qty',
        t: 'float',
        d: 0,
        ro: true,
        when: [{ field: 'finishedGood', truthy: true }]
      },
      {
        n: 'transferredQty',
        l: 'Transferred Raw Materials',
        t: 'float',
        d: 0,
        ro: true,
        when: [{ field: 'items', truthy: true }]
      },

      // ── Raw Materials ───────────────────────────────────────────────
      {
        tab: 'Raw Materials',
        n: 'items',
        l: 'Items',
        t: 'table',
        rows: [
          { n: 'itemCode', l: 'Item Code', t: 'link', o: 'product', r: true },
          { n: 'sourceWarehouse', l: 'Source Warehouse', t: 'data' },
          { n: 'requiredQty', l: 'Required Qty', t: 'float', d: 0 },
          { n: 'transferredQty', l: 'Transferred Qty', t: 'float', d: 0, ro: true },
          { n: 'consumedQty', l: 'Consumed Qty', t: 'float', d: 0, ro: true }
        ]
      },
      {
        tab: 'Raw Materials',
        s: 'Quality Inspection',
        n: 'qualityInspectionTemplate',
        l: 'Quality Inspection Template',
        t: 'data'
      },
      {
        tab: 'Raw Materials',
        n: 'qualityInspection',
        l: 'Quality Inspection',
        t: 'data',
        when: [{ field: 'workOrderNumber', truthy: true }]
      },

      // ── Time logs ───────────────────────────────────────────────────
      {
        tab: 'Time logs',
        s: 'Scheduled Time',
        n: 'expectedStartDate',
        l: 'Expected Start Date',
        t: 'datetime'
      },
      {
        tab: 'Time logs',
        n: 'timeRequired',
        l: 'Expected Time Required (In Mins)',
        t: 'float',
        d: 0
      },
      { tab: 'Time logs', n: 'expectedEndDate', l: 'Expected End Date', t: 'datetime' },
      {
        tab: 'Time logs',
        n: 'scheduledTimeLogs',
        l: 'Scheduled Time Logs',
        t: 'table',
        ro: true,
        rows: [
          { n: 'fromTime', l: 'From Time', t: 'datetime' },
          { n: 'toTime', l: 'To Time', t: 'datetime' },
          { n: 'timeInMins', l: 'Time (In Mins)', t: 'float', d: 0 }
        ]
      },
      {
        tab: 'Time logs',
        s: 'Actual Time',
        n: 'startTime',
        l: 'Actual Start Date',
        t: 'datetime',
        ro: true
      },
      { tab: 'Time logs', n: 'totalTimeInMins', l: 'Total Time in Mins', t: 'float', d: 0, ro: true },
      { tab: 'Time logs', n: 'endTime', l: 'Actual End Date', t: 'datetime', ro: true },
      {
        tab: 'Time logs',
        n: 'timeLogs',
        l: 'Time Logs',
        t: 'table',
        rows: [
          { n: 'employee', l: 'Employee', t: 'link', o: 'employee' },
          { n: 'fromTime', l: 'From Time', t: 'datetime' },
          { n: 'toTime', l: 'To Time', t: 'datetime' },
          { n: 'timeInMins', l: 'Time In Mins', t: 'float', d: 0 },
          { n: 'completedQty', l: 'Completed Qty', t: 'float', d: 0 },
          { n: 'operation', l: 'Sub Operation', t: 'data' }
        ]
      },

      // ── Sub Operations ──────────────────────────────────────────────
      {
        tab: 'Sub Operations',
        n: 'subOperations',
        l: 'Sub Operations',
        t: 'table',
        ro: true,
        rows: [
          { n: 'subOperation', l: 'Operation', t: 'data' },
          { n: 'completedQty', l: 'Completed Qty', t: 'float', d: 0 },
          { n: 'completedTime', l: 'Completed Time', t: 'data' },
          { n: 'status', l: 'Status', t: 'data' }
        ]
      },

      // ── Secondary Items ─────────────────────────────────────────────
      {
        tab: 'Secondary Items',
        n: 'secondaryItems',
        l: 'Secondary Items',
        t: 'table',
        rows: [
          {
            n: 'secondaryItemType',
            l: 'Type',
            t: 'select',
            o: ['', 'By-product', 'Co-product', 'Scrap'],
            r: true
          },
          { n: 'itemCode', l: 'Secondary Item Code', t: 'link', o: 'product', r: true },
          { n: 'itemName', l: 'Secondary Item Name', t: 'data' },
          { n: 'stockQty', l: 'Qty', t: 'float', d: 0, r: true }
        ]
      },

      // ── Corrective Operation ────────────────────────────────────────
      {
        tab: 'Corrective Operation',
        n: 'forJobCard',
        l: 'For Job Card',
        t: 'link',
        o: 'job-card',
        ro: true,
        when: [{ field: 'isCorrectiveJobCard', equals: true }]
      },
      {
        tab: 'Corrective Operation',
        n: 'isCorrectiveJobCard',
        l: 'Is Corrective Job Card',
        t: 'bool',
        d: false,
        ro: true,
        when: [{ field: 'isCorrectiveJobCard', equals: true }]
      },
      {
        tab: 'Corrective Operation',
        n: 'hourRate',
        l: 'Hour Rate',
        t: 'currency',
        d: 0,
        when: [{ field: 'isCorrectiveJobCard', equals: true }]
      },
      {
        tab: 'Corrective Operation',
        n: 'forOperation',
        l: 'For Operation',
        t: 'data',
        when: [{ field: 'isCorrectiveJobCard', equals: true }]
      },

      // ── More Info ───────────────────────────────────────────────────
      { tab: 'More Info', n: 'itemName', l: 'Item Name', t: 'data', ro: true },
      {
        tab: 'More Info',
        n: 'requestedQty',
        l: 'Requested Qty',
        t: 'float',
        d: 0,
        ro: true,
        when: [{ field: 'isCorrectiveJobCard', equals: false }]
      },
      {
        tab: 'More Info',
        n: 'isSubcontracted',
        l: 'Is Subcontracted',
        t: 'bool',
        d: false,
        ro: true,
        when: [{ field: 'isCorrectiveJobCard', equals: false }]
      },
      { tab: 'More Info', n: 'project', l: 'Project', t: 'data' },
      { tab: 'More Info', n: 'notes', l: 'Remarks', t: 'longText' },
      {
        tab: 'More Info',
        s: 'Status and Reference',
        n: 'status',
        l: 'Status',
        t: 'select',
        o: [
          'Open',
          'Work In Progress',
          'Partially Transferred',
          'Material Transferred',
          'On Hold',
          'Submitted',
          'To Manufacture',
          'Cancelled',
          'Completed'
        ],
        d: 'Open',
        ro: true
      },
      { tab: 'More Info', n: 'operationRowId', l: 'Operation Row ID', t: 'int' },
      { tab: 'More Info', n: 'sequence', l: 'Sequence Id', t: 'int', d: 0, ro: true },

      // System
      { n: 'workOrderNumber', l: 'ID', t: 'data', ro: true, hidden: true },
      { n: 'trackSemiFinishedGoods', l: 'Produce Item per Operation', t: 'bool', d: false, hidden: true }
    ]
  },

  'production-plan': {
    model: 'manufacturingProductionPlan',
    doctype: 'Production Plan',
    workspace: 'manufacturing',
    section: 'Material Planning',
    titleField: 'name',
    numberField: 'name',
    numberPrefix: 'MFG-PP',
    statuses: ['Draft', 'Submitted', 'Not Started', 'In Process', 'Completed', 'Closed', 'Cancelled', 'Material Requested'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Submitted', 'Not Started', 'In Process'], to: 'Cancelled', action: 'edit' }
    ],
    columns: ['name', 'postingDate', 'status', 'getItemsFrom', 'totalPlannedQty'],
    search: ['name'],
    // Exact live ERPNext Production Plan form — single page, no extra tabs
    fields: [
      {
        n: 'namingSeries',
        l: 'Naming Series',
        t: 'select',
        o: ['MFG-PP-.YYYY.-'],
        d: 'MFG-PP-.YYYY.-',
        r: true
      },
      { n: 'companyId', l: 'Company', t: 'company', r: true },
      {
        n: 'getItemsFrom',
        l: 'Get Items From',
        t: 'select',
        o: ['', 'Sales Order', 'Material Request'],
        d: ''
      },
      { n: 'postingDate', l: 'Posting Date', t: 'date', r: true, d: 'today' },
      { n: 'reserveStock', l: 'Reserve Stock', t: 'bool', d: false },

      {
        s: 'Filters',
        n: 'itemCode',
        l: 'Item Code',
        t: 'link',
        o: 'product',
        when: [{ field: 'getItemsFrom', truthy: true }]
      },
      {
        n: 'customer',
        l: 'Customer',
        t: 'data',
        when: [{ field: 'getItemsFrom', equals: 'Sales Order' }]
      },
      {
        n: 'warehouse',
        l: 'Warehouse',
        t: 'data',
        when: [{ field: 'getItemsFrom', equals: 'Material Request' }]
      },
      {
        n: 'project',
        l: 'Project',
        t: 'data',
        when: [{ field: 'getItemsFrom', equals: 'Sales Order' }]
      },
      {
        n: 'salesOrderStatus',
        l: 'Sales Order Status',
        t: 'select',
        o: ['', 'To Deliver and Bill', 'To Bill', 'To Deliver'],
        when: [{ field: 'getItemsFrom', equals: 'Sales Order' }]
      },
      {
        n: 'fromDate',
        l: 'From Date',
        t: 'date',
        when: [{ field: 'getItemsFrom', truthy: true }]
      },
      {
        n: 'toDate',
        l: 'To Date',
        t: 'date',
        when: [{ field: 'getItemsFrom', truthy: true }]
      },
      {
        n: 'fromDeliveryDate',
        l: 'From Delivery Date',
        t: 'date',
        when: [{ field: 'getItemsFrom', equals: 'Sales Order' }]
      },
      {
        n: 'toDeliveryDate',
        l: 'To Delivery Date',
        t: 'date',
        when: [{ field: 'getItemsFrom', equals: 'Sales Order' }]
      },

      {
        s: 'Sales Orders',
        n: 'combineItems',
        l: 'Consolidate Sales Order Items',
        t: 'bool',
        d: false,
        when: [{ field: 'getItemsFrom', equals: 'Sales Order' }]
      },
      {
        n: 'salesOrders',
        l: 'Sales Orders',
        t: 'table',
        when: [{ field: 'getItemsFrom', equals: 'Sales Order' }],
        rows: [
          { n: 'salesOrder', l: 'Sales Order', t: 'data', r: true },
          { n: 'salesOrderDate', l: 'Date', t: 'date' },
          { n: 'customer', l: 'Customer', t: 'data' },
          { n: 'grandTotal', l: 'Grand Total', t: 'currency', d: 0 }
        ]
      },
      {
        s: 'Material Request Detail',
        n: 'materialRequests',
        l: 'Material Requests',
        t: 'table',
        when: [{ field: 'getItemsFrom', equals: 'Material Request' }],
        rows: [
          { n: 'materialRequest', l: 'Material Request', t: 'data', r: true },
          { n: 'materialRequestDate', l: 'Date', t: 'date' },
          { n: 'status', l: 'Status', t: 'data' }
        ]
      },

      {
        s: 'Select Items to Manufacture',
        n: 'poItems',
        l: 'Assembly Items',
        t: 'table',
        r: true,
        rows: [
          { n: 'itemCode', l: 'Item Code', t: 'link', o: 'product', r: true },
          { n: 'bomNo', l: 'BOM No', t: 'link', o: 'bom' },
          { n: 'plannedQty', l: 'Planned Qty', t: 'float', r: true, d: 0 },
          { n: 'stockUom', l: 'UOM', t: 'data', d: 'Nos' },
          { n: 'warehouse', l: 'Finished Goods Warehouse', t: 'data' },
          { n: 'plannedStartDate', l: 'Planned Start Date', t: 'datetime' }
        ]
      },

      {
        s: 'Sub Assembly Items',
        n: 'subAssemblyWarehouse',
        l: 'Sub Assembly Warehouse',
        t: 'data'
      },
      {
        n: 'skipAvailableSubAssemblyItem',
        l: 'Consider Projected Qty in Calculation',
        t: 'bool',
        d: true
      },
      {
        n: 'combineSubItems',
        l: 'Consolidate Sub Assembly Items',
        t: 'bool',
        d: false
      },
      {
        n: 'subAssemblyItems',
        l: 'Sub Assembly Items',
        t: 'table',
        rows: [
          { n: 'productionItem', l: 'Production Item', t: 'data' },
          { n: 'itemCode', l: 'Item Code', t: 'link', o: 'product', r: true },
          { n: 'bomNo', l: 'BOM No', t: 'link', o: 'bom' },
          { n: 'qty', l: 'Qty', t: 'float', d: 0 },
          { n: 'bomLevel', l: 'BOM Level', t: 'int', d: 1 },
          { n: 'scheduleDate', l: 'Schedule Date', t: 'datetime' },
          { n: 'warehouse', l: 'Warehouse', t: 'data' }
        ]
      },

      {
        s: 'For Raw Materials',
        n: 'includeNonStockItems',
        l: 'Include Non Stock Items',
        t: 'bool',
        d: true
      },
      {
        n: 'includeSubcontractedItems',
        l: 'Include Subcontracted Items',
        t: 'bool',
        d: true
      },
      {
        n: 'considerMinimumOrderQty',
        l: 'Consider Minimum Order Qty',
        t: 'bool',
        d: false
      },
      {
        n: 'includeSafetyStock',
        l: 'Include Safety Stock in Required Qty Calculation',
        t: 'bool',
        d: false
      },
      {
        n: 'ignoreExistingOrderedQty',
        l: 'Consider Projected Qty in Calculation (RM)',
        t: 'bool',
        d: true
      },
      {
        n: 'rawMaterialGroupWarehouse',
        l: 'Raw Material Group Warehouse',
        t: 'data'
      },
      { n: 'forWarehouse', l: 'For Warehouse', t: 'data' },
      {
        n: 'mrItems',
        l: 'Raw Materials',
        t: 'table',
        rows: [
          { n: 'itemCode', l: 'Item Code', t: 'link', o: 'product', r: true },
          { n: 'warehouse', l: 'Warehouse', t: 'data' },
          { n: 'requiredQty', l: 'Required Qty', t: 'float', d: 0 },
          { n: 'quantity', l: 'Qty to Order / Transfer', t: 'float', d: 0 },
          { n: 'uom', l: 'UOM', t: 'data', d: 'Nos' }
        ]
      },

      {
        s: 'Other Details',
        n: 'totalPlannedQty',
        l: 'Total Planned Qty',
        t: 'float',
        d: 0,
        ro: true
      },
      { n: 'totalProducedQty', l: 'Total Produced Qty', t: 'float', d: 0, ro: true },
      {
        n: 'status',
        l: 'Status',
        t: 'select',
        o: ['Draft', 'Submitted', 'Not Started', 'In Process', 'Completed', 'Closed', 'Cancelled', 'Material Requested'],
        d: 'Draft',
        ro: true
      },

      { n: 'name', l: 'Name', t: 'data', ro: true, hidden: true }
    ]
  },

  'master-production-schedule': {
    model: 'manufacturingMPS',
    doctype: 'Master Production Schedule',
    workspace: 'manufacturing',
    section: 'Material Planning',
    titleField: 'mpsNumber',
    numberField: 'mpsNumber',
    numberPrefix: 'MPS',
    columns: ['mpsNumber', 'productName', 'week', 'year', 'plannedQuantity', 'status'],
    search: ['mpsNumber', 'productName'],
    fields: [
      { n: 'mpsNumber', l: 'Name', t: 'data', ro: true },
      { n: 'productId', l: 'Item', t: 'link', o: 'product', r: true },
      { n: 'productName', l: 'Item Name', t: 'data', ro: true },
      { n: 'week', l: 'Week', t: 'data', r: true },
      { n: 'month', l: 'Month', t: 'data' },
      { n: 'year', l: 'Year', t: 'int', r: true },
      { n: 'plannedQuantity', l: 'Planned Qty', t: 'float', d: 0 },
      { n: 'actualQuantity', l: 'Actual Qty', t: 'float', d: 0, ro: true },
      { n: 'status', l: 'Status', t: 'select', o: ['Planned', 'InProgress', 'Completed'], d: 'Planned' },
      { n: 'notes', l: 'Notes', t: 'longText' }
    ]
  },

  'downtime-entry': {
    model: 'manufacturingDowntimeEntry',
    doctype: 'Downtime Entry',
    workspace: 'manufacturing',
    section: 'Tools',
    titleField: 'name',
    numberField: 'name',
    numberPrefix: 'DT',
    columns: ['name', 'workstationId', 'fromTime', 'toTime', 'stopReason'],
    search: ['name', 'stopReason'],
    fields: [
      { n: 'name', l: 'ID', t: 'data', ro: true },
      { n: 'workstationId', l: 'Workstation', t: 'link', o: 'workstation', r: true },
      { n: 'operatorId', l: 'Operator', t: 'data' },
      { n: 'fromTime', l: 'From Time', t: 'datetime', r: true },
      { n: 'toTime', l: 'To Time', t: 'datetime', r: true },
      { n: 'stopReason', l: 'Stop Reason', t: 'data' },
      { n: 'remarks', l: 'Remarks', t: 'longText' }
    ]
  },

  'plant-floor': {
    model: 'manufacturingPlantFloor',
    doctype: 'Plant Floor',
    workspace: 'manufacturing',
    section: 'Setup',
    titleField: 'name',
    unique: ['name'],
    columns: ['name', 'warehouse', 'disabled'],
    search: ['name'],
    fields: [
      { n: 'name', l: 'Floor Name', t: 'data', r: true },
      { n: 'warehouse', l: 'Warehouse', t: 'data' },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false }
    ]
  },

  'manufacturing-settings': {
    model: 'manufacturingSetting',
    doctype: 'Manufacturing Settings',
    workspace: 'manufacturing',
    titleField: null,
    singleton: true,
    columns: ['companyId'],
    search: [],
    settingsJson: true,
    fields: [
      {
        s: 'Overproduction',
        n: 'overproductionPercentageForWorkOrder',
        l: 'Overproduction Percentage For Work Order',
        t: 'float',
        d: 0
      },
      {
        n: 'overproductionPercentageForSalesOrder',
        l: 'Overproduction Percentage For Sales Order',
        t: 'float',
        d: 0
      },
      {
        s: 'Capacity Planning',
        n: 'disableCapacityPlanning',
        l: 'Disable Capacity Planning',
        t: 'bool',
        d: false
      },
      { n: 'allowOvertime', l: 'Allow Overtime', t: 'bool', d: false },
      {
        s: 'Job Card',
        n: 'jobCardExcessTransfer',
        l: 'Allow Excess Material Transfer / Consumption',
        t: 'bool',
        d: false
      },
      {
        n: 'addCorrectiveOperationCostInFinishedGood',
        l: 'Add Corrective Operation Cost in Finished Good Valuation',
        t: 'bool',
        d: false
      }
    ]
  },

  'stock-entry': {
    model: 'manufacturingStockEntry',
    doctype: 'Stock Entry',
    workspace: 'manufacturing',
    titleField: 'name',
    numberField: 'name',
    numberPrefix: 'MAT-STE',
    statuses: ['Draft', 'Submitted', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Submitted'], to: 'Cancelled', action: 'edit' }
    ],
    columns: ['name', 'purpose', 'postingDate', 'workOrderId', 'status'],
    search: ['name', 'purpose'],
    fields: [
      { n: 'name', l: 'ID', t: 'data', ro: true },
      {
        n: 'purpose',
        l: 'Purpose',
        t: 'select',
        o: [
          'Material Transfer for Manufacture',
          'Material Consumption for Manufacture',
          'Manufacture',
          'Material Transfer',
          'Material Issue'
        ],
        d: 'Material Transfer for Manufacture',
        r: true
      },
      { n: 'workOrderId', l: 'Work Order', t: 'link', o: 'work-order' },
      { n: 'bomId', l: 'BOM No', t: 'link', o: 'bom' },
      { n: 'postingDate', l: 'Posting Date', t: 'date', r: true, d: 'today' },
      { n: 'fromWarehouse', l: 'Source Warehouse', t: 'data' },
      { n: 'toWarehouse', l: 'Target Warehouse', t: 'data' },
      { n: 'fgCompletedQty', l: 'For Quantity', t: 'float', d: 0 },
      { n: 'status', l: 'Status', t: 'select', o: ['Draft', 'Submitted', 'Cancelled'], d: 'Draft', ro: true },
      {
        s: 'Items',
        n: 'items',
        l: 'Items',
        t: 'table',
        rows: [
          { n: 'itemCode', l: 'Item Code', t: 'data', r: true },
          { n: 'itemName', l: 'Item Name', t: 'data' },
          { n: 'qty', l: 'Qty', t: 'float', r: true, d: 1 },
          { n: 'uom', l: 'UOM', t: 'data', d: 'Nos' },
          { n: 'sWarehouse', l: 'Source Warehouse', t: 'data' },
          { n: 'tWarehouse', l: 'Target Warehouse', t: 'data' }
        ]
      },
      { n: 'remarks', l: 'Remarks', t: 'longText' }
    ]
  },

  'item-lead-time': {
    model: 'manufacturingItemLeadTime',
    doctype: 'Item Lead Time',
    workspace: 'manufacturing',
    section: 'Material Planning',
    titleField: 'name',
    numberField: 'name',
    numberPrefix: 'ILT',
    columns: ['name', 'itemName', 'leadTimeDays', 'safetyStockDays'],
    search: ['name', 'itemName'],
    fields: [
      { n: 'name', l: 'ID', t: 'data', ro: true },
      { n: 'itemId', l: 'Item', t: 'link', o: 'product', r: true },
      { n: 'itemName', l: 'Item Name', t: 'data', ro: true },
      { n: 'leadTimeDays', l: 'Lead Time (Days)', t: 'float', d: 0, r: true },
      { n: 'safetyStockDays', l: 'Safety Stock Days', t: 'float', d: 0 },
      { n: 'notes', l: 'Notes', t: 'longText' }
    ]
  },

  'sales-forecast': {
    model: 'manufacturingSalesForecast',
    doctype: 'Sales Forecast',
    workspace: 'manufacturing',
    section: 'Material Planning',
    titleField: 'name',
    numberField: 'name',
    numberPrefix: 'SF',
    statuses: ['Draft', 'Submitted', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Submitted'], to: 'Cancelled', action: 'edit' }
    ],
    columns: ['name', 'fromDate', 'toDate', 'status'],
    search: ['name'],
    fields: [
      { n: 'name', l: 'Name', t: 'data', ro: true },
      { n: 'fromDate', l: 'From Date', t: 'date', r: true },
      { n: 'toDate', l: 'To Date', t: 'date', r: true },
      { n: 'status', l: 'Status', t: 'select', o: ['Draft', 'Submitted', 'Cancelled'], d: 'Draft', ro: true },
      {
        s: 'Items',
        n: 'items',
        l: 'Forecast Items',
        t: 'table',
        rows: [
          { n: 'itemCode', l: 'Item Code', t: 'data', r: true },
          { n: 'itemName', l: 'Item Name', t: 'data' },
          { n: 'forecastQty', l: 'Forecast Qty', t: 'float', d: 0 },
          { n: 'actualQty', l: 'Actual Qty', t: 'float', d: 0 }
        ]
      },
      { n: 'notes', l: 'Notes', t: 'longText' }
    ]
  },

  'bom-creator': {
    model: 'manufacturingBomCreator',
    doctype: 'BOM Creator',
    workspace: 'manufacturing',
    section: 'Tools',
    titleField: 'name',
    numberField: 'name',
    numberPrefix: 'BOM-C',
    statuses: ['Draft', 'Submitted', 'Completed', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
      { key: 'complete', label: 'Create BOM', from: ['Submitted'], to: 'Completed', action: 'edit' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Submitted'], to: 'Cancelled', action: 'edit' }
    ],
    columns: ['name', 'designName', 'itemName', 'qty', 'status'],
    search: ['name', 'designName', 'itemName'],
    fields: [
      { n: 'name', l: 'ID', t: 'data', ro: true },
      { n: 'designName', l: 'Design Name', t: 'data' },
      { n: 'itemId', l: 'Finished Good', t: 'link', o: 'product', r: true },
      { n: 'itemName', l: 'Item Name', t: 'data', ro: true },
      { n: 'qty', l: 'Qty', t: 'float', d: 1, r: true },
      { n: 'routingId', l: 'Routing', t: 'link', o: 'routing' },
      { n: 'status', l: 'Status', t: 'select', o: ['Draft', 'Submitted', 'Completed', 'Cancelled'], d: 'Draft', ro: true },
      {
        s: 'Items',
        n: 'items',
        l: 'Raw Materials',
        t: 'table',
        rows: [
          { n: 'itemCode', l: 'Item Code', t: 'data', r: true },
          { n: 'itemName', l: 'Item Name', t: 'data' },
          { n: 'qty', l: 'Qty', t: 'float', d: 1 },
          { n: 'uom', l: 'UOM', t: 'data', d: 'Nos' }
        ]
      },
      {
        s: 'Operations',
        n: 'operations',
        l: 'Operations',
        t: 'table',
        rows: [
          { n: 'operation', l: 'Operation', t: 'data', r: true },
          { n: 'workstation', l: 'Workstation', t: 'data' },
          { n: 'timeInMins', l: 'Time (Mins)', t: 'float', d: 0 }
        ]
      },
      { n: 'remarks', l: 'Remarks', t: 'longText' }
    ]
  },

  'bom-update-tool': {
    model: 'manufacturingBomUpdateTool',
    doctype: 'BOM Update Tool',
    workspace: 'manufacturing',
    section: 'Tools',
    titleField: 'name',
    numberField: 'name',
    numberPrefix: 'BOM-UT',
    statuses: ['Draft', 'Completed'],
    actions: [{ key: 'complete', label: 'Update', from: ['Draft'], to: 'Completed', action: 'edit' }],
    columns: ['name', 'currentBomId', 'newBomId', 'replaceBom', 'status'],
    search: ['name'],
    fields: [
      { n: 'name', l: 'ID', t: 'data', ro: true },
      { n: 'currentBomId', l: 'Current BOM', t: 'link', o: 'bom', r: true },
      { n: 'newBomId', l: 'New BOM', t: 'link', o: 'bom', r: true },
      { n: 'replaceBom', l: 'Replace BOM', t: 'bool', d: false },
      { n: 'status', l: 'Status', t: 'select', o: ['Draft', 'Completed'], d: 'Draft', ro: true },
      { n: 'notes', l: 'Notes', t: 'longText' }
    ]
  }
};

module.exports = { registry };
