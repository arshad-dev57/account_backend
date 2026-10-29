'use strict';

/**
 * Exact ERPNext Manufacturing workspace sidebar
 * (erpnext/manufacturing/workspace/manufacturing/manufacturing.json → sidebar_items).
 *
 * Naming:
 *   Work Order  = ManufacturingProductionOrder
 *   Job Card    = ManufacturingWorkOrder
 *   Workstation = ManufacturingWorkCenter
 */

const workspaces = [
  {
    slug: 'manufacturing',
    label: 'Manufacturing',
    module: 'Manufacturing',
    icon: 'factory',
    dashboard: 'Manufacturing',
    items: [
      { kind: 'home', label: 'Home', href: '/manufacturing/manufacturing' },
      { kind: 'dashboard', label: 'Dashboard', href: '/manufacturing/manufacturing/dashboard' },
      { kind: 'document', label: 'BOM', resource: 'bom' },
      { kind: 'document', label: 'Work Order', resource: 'work-order' },
      { kind: 'document', label: 'Job Card', resource: 'job-card' },
      { kind: 'document', label: 'Stock Entry', resource: 'stock-entry', doctype: 'Stock Entry' },
      { kind: 'page', label: 'Shop Floor', href: '/manufacturing/manufacturing/shop-floor', doctype: 'Shop Floor' },
      {
        section: 'Material Planning',
        items: [
          { kind: 'document', label: 'Item Lead Time', resource: 'item-lead-time', doctype: 'Item Lead Time' },
          { kind: 'document', label: 'Production Plan', resource: 'production-plan' },
          {
            kind: 'report',
            label: 'Forecasting',
            report: 'forecasting',
            doctype: 'Exponential Smoothing Forecasting'
          },
          { kind: 'document', label: 'Master Production Schedule', resource: 'master-production-schedule' },
          { kind: 'document', label: 'Sales Forecast', resource: 'sales-forecast', doctype: 'Sales Forecast' },
          { kind: 'report', label: 'Production Planning Report', report: 'production-planning-report' }
        ]
      },
      {
        section: 'Tools',
        items: [
          { kind: 'document', label: 'BOM Creator', resource: 'bom-creator' },
          { kind: 'document', label: 'BOM Update Tool', resource: 'bom-update-tool' },
          {
            kind: 'page',
            label: 'BOM Comparison Tool',
            href: '/manufacturing/manufacturing/bom-comparison-tool',
            doctype: 'BOM Comparison Tool'
          },
          { kind: 'document', label: 'Downtime Entry', resource: 'downtime-entry' }
        ]
      },
      {
        section: 'Reports',
        items: [
          { kind: 'report', label: 'Production Planning Report', report: 'production-planning-report' },
          { kind: 'report', label: 'Work Order Summary', report: 'work-order-summary' },
          { kind: 'report', label: 'Quality Inspection Summary', report: 'quality-inspection-summary' },
          { kind: 'report', label: 'Downtime Analysis', report: 'downtime-analysis' },
          { kind: 'report', label: 'Job Card Summary', report: 'job-card-summary' },
          { kind: 'report', label: 'BOM Search', report: 'bom-search' },
          { kind: 'report', label: 'Production Analytics', report: 'production-analytics' },
          { kind: 'report', label: 'BOM Operations Time', report: 'bom-operations-time' },
          { kind: 'report', label: 'Work Order Consumed Materials', report: 'work-order-consumed-materials' }
        ]
      },
      {
        section: 'Setup',
        items: [
          { kind: 'page', label: 'Item', href: '/warehouse/products', doctype: 'Item' },
          { kind: 'page', label: 'Warehouse', href: '/warehouse/locations', doctype: 'Warehouse' },
          { kind: 'document', label: 'Operation', resource: 'operation' },
          { kind: 'document', label: 'Workstation', resource: 'workstation' },
          { kind: 'document', label: 'Workstation Type', resource: 'workstation-type' },
          { kind: 'document', label: 'Plant Floor', resource: 'plant-floor' },
          { kind: 'document', label: 'Routing', resource: 'routing' }
        ]
      },
      { kind: 'document', label: 'Settings', resource: 'manufacturing-settings', doctype: 'Manufacturing Settings' }
    ]
  }
];

module.exports = { workspaces };
