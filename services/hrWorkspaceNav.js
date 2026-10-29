'use strict';

/**
 * The HR navigation reproduces the "Workspace Sidebar" definitions shipped with
 * Frappe HR (the workspace_sidebar documents of github.com/frappe/hrms), including
 * the workspace names, section order and item labels.
 *
 * target:
 *   { kind: 'document', resource }  served by /api/hr/docs/:resource
 *   { kind: 'page', href }          an existing Bisonstechs screen
 *   { kind: 'report' | 'tool' | 'settings' | 'dashboard' }
 *   available: false                ERPNext has it, Bisonstechs does not yet
 */

const workspaces = [
  {
    slug: 'hr-setup',
    label: 'HR Setup',
    module: 'HR Setup',
    icon: 'settings',
    dashboard: 'Human Resource',
    items: [
      { kind: 'document', label: 'Employee', resource: 'employee' },
      { kind: 'page', label: 'Organizational Chart', href: '/hr/org-chart', doctype: 'Organizational Chart' },
      {
        section: 'Masters',
        items: [
          { kind: 'page', label: 'Company', href: '/companies', doctype: 'Company' },
          { kind: 'document', label: 'Branch', resource: 'branch' },
          { kind: 'document', label: 'Department', resource: 'department' },
          { kind: 'document', label: 'Designation', resource: 'designation' },
          { kind: 'document', label: 'Employee Group', resource: 'employee-group' },
          { kind: 'document', label: 'Employee Grade', resource: 'employee-grade' },
          { kind: 'document', label: 'Settings', resource: 'hr-settings', doctype: 'HR Settings' }
        ]
      }
    ]
  },
  {
    slug: 'tenure',
    label: 'Tenure',
    module: 'Tenure',
    icon: 'user-round-cog',
    dashboard: 'Employee Lifecycle',
    items: [
      { kind: 'document', label: 'Employee Onboarding', resource: 'employee-onboarding' },
      { kind: 'document', label: 'Employee Separation', resource: 'employee-separation' },
      {
        section: 'Templates',
        items: [
          { kind: 'document', label: 'Employee Onboarding Template', resource: 'employee-onboarding-template' },
          { kind: 'document', label: 'Employee Separation Template', resource: 'employee-separation-template' }
        ]
      },
      {
        section: 'Grievance',
        items: [
          { kind: 'document', label: 'Grievance Type', resource: 'grievance-type' },
          { kind: 'document', label: 'Employee Grievance', resource: 'employee-grievance' }
        ]
      },
      {
        section: 'Training',
        items: [
          { kind: 'document', label: 'Employee Skill Map', resource: 'employee-skill-map' },
          { kind: 'document', label: 'Training Program', resource: 'training-program' },
          { kind: 'document', label: 'Training Event', resource: 'training-event' },
          { kind: 'document', label: 'Training Feedback', resource: 'training-feedback' },
          { kind: 'document', label: 'Training Result', resource: 'training-result' }
        ]
      },
      {
        section: 'Reports',
        items: [
          { kind: 'report', label: 'Employee Exits', report: 'employee-exits' },
          { kind: 'report', label: 'Employee Birthday', report: 'employee-birthday' },
          { kind: 'report', label: 'Employee Information', report: 'employee-information' },
          { kind: 'report', label: 'Employee Analytics', report: 'employee-analytics' }
        ]
      },
      { kind: 'document', label: 'Settings', resource: 'hr-settings', doctype: 'HR Settings' }
    ]
  },
  {
    slug: 'recruitment',
    label: 'Recruitment',
    module: 'Recruitment',
    icon: 'user-round-search',
    dashboard: 'Recruitment',
    items: [
      { kind: 'tool', label: 'Hiring Pipeline', href: '/hr/recruitment/pipeline', doctype: 'Hiring Pipeline' },
      { kind: 'document', label: 'Job Opening', resource: 'job-opening' },
      { kind: 'document', label: 'Job Applicant', resource: 'job-applicant' },
      { kind: 'document', label: 'Interview', resource: 'interview' },
      { kind: 'document', label: 'Job Offer', resource: 'job-offer' },
      { kind: 'document', label: 'Appointment Letter', resource: 'appointment-letter' },
      {
        section: 'Templates',
        items: [
          { kind: 'document', label: 'Job Opening Template', resource: 'job-opening-template' },
          { kind: 'document', label: 'Job Offer Term Template', resource: 'job-offer-term-template' },
          { kind: 'document', label: 'Appointment Letter Template', resource: 'appointment-letter-template' }
        ]
      },
      {
        section: 'Planning',
        items: [
          { kind: 'document', label: 'Job Requisition', resource: 'job-requisition' },
          { kind: 'document', label: 'Staffing Plan', resource: 'staffing-plan' },
          { kind: 'document', label: 'Employee Referral', resource: 'employee-referral' }
        ]
      },
      {
        section: 'Reports',
        items: [{ kind: 'report', label: 'Recruitment Analytics', report: 'recruitment-analytics' }]
      },
      {
        section: 'Setup',
        items: [
          { kind: 'document', label: 'Skill', resource: 'skill' },
          { kind: 'document', label: 'Interview Type', resource: 'interview-type' },
          { kind: 'tool', label: 'Job Portal', href: '/hr/recruitment/jobs', doctype: 'Job Opening' }
        ]
      },
      { kind: 'document', label: 'Settings', resource: 'hr-settings', doctype: 'HR Settings' }
    ]
  },
  {
    slug: 'shift-and-attendance',
    label: 'Shift & Attendance',
    module: 'Shift and Attendance',
    icon: 'fingerprint',
    dashboard: 'Attendance',
    items: [
      { kind: 'document', label: 'Roster', resource: 'shift-assignment', doctype: 'Roster' },
      {
        section: 'Attendance',
        items: [
          { kind: 'document', label: 'Employee Checkin', resource: 'employee-checkin' },
          { kind: 'document', label: 'Attendance', resource: 'attendance' },
          { kind: 'tool', label: 'Employee Attendance Tool', href: '/hr/attendance/mark', doctype: 'Employee Attendance Tool' },
          { kind: 'document', label: 'Attendance Request', resource: 'attendance-request' }
        ]
      },
      {
        section: 'Shift Assignments',
        items: [
          { kind: 'document', label: 'Shift Assignment', resource: 'shift-assignment' },
          { kind: 'document', label: 'Shift Schedule Assignment', resource: 'shift-schedule-assignment' },
          { kind: 'tool', label: 'Shift Assignment Tool', href: '/hr/shifts/assignment-tool', doctype: 'Shift Assignment Tool' },
          { kind: 'document', label: 'Shift Request', resource: 'shift-request' }
        ]
      },
      {
        section: 'Shift Setup',
        items: [
          { kind: 'document', label: 'Shift Location', resource: 'shift-location' },
          { kind: 'document', label: 'Shift Type', resource: 'shift-type' },
          { kind: 'document', label: 'Shift Schedule', resource: 'shift-schedule' }
        ]
      },
      {
        section: 'Timesheets',
        items: [
          { kind: 'document', label: 'Activity Type', resource: 'activity-type' },
          { kind: 'document', label: 'Timesheet', resource: 'timesheet' }
        ]
      },
      {
        section: 'Overtime',
        items: [
          { kind: 'document', label: 'Overtime Type', resource: 'overtime-type' },
          { kind: 'document', label: 'Overtime Slip', resource: 'overtime-slip' }
        ]
      },
      {
        section: 'Reports',
        items: [
          { kind: 'report', label: 'Monthly Attendance Sheet', report: 'monthly-attendance-sheet' },
          { kind: 'report', label: 'Shift Attendance', report: 'shift-attendance' },
          { kind: 'report', label: 'Employee Hours Utilization Based On Timesheet', report: 'employee-hours-utilization' },
          { kind: 'report', label: 'Project Profitability', report: 'project-profitability' }
        ]
      },
      { kind: 'document', label: 'Settings', resource: 'hr-settings', doctype: 'HR Settings' }
    ]
  },
  {
    slug: 'leaves',
    label: 'Leaves',
    module: 'Leaves',
    icon: 'tree-palm',
    dashboard: 'Leaves',
    items: [
      { kind: 'document', label: 'Leave Application', resource: 'leave-application' },
      { kind: 'document', label: 'Leave Encashment', resource: 'leave-encashment' },
      {
        section: 'Leave Allocations',
        items: [
          { kind: 'document', label: 'Leave Allocation', resource: 'leave-allocation' },
          { kind: 'document', label: 'Leave Policy Assignment', resource: 'leave-policy-assignment' },
          { kind: 'tool', label: 'Leave Control Panel', href: '/hr/leaves/control-panel', doctype: 'Leave Control Panel' }
        ]
      },
      {
        section: 'Holidays',
        items: [
          { kind: 'document', label: 'Holiday List', resource: 'holiday-list' },
          { kind: 'document', label: 'Holiday List Assignment', resource: 'holiday-list-assignment' }
        ]
      },
      {
        section: 'Leave Setup',
        items: [
          { kind: 'document', label: 'Leave Type', resource: 'leave-type' },
          { kind: 'document', label: 'Leave Policy', resource: 'leave-policy' },
          { kind: 'document', label: 'Leave Period', resource: 'leave-period' },
          { kind: 'document', label: 'Leave Block List', resource: 'leave-block-list' }
        ]
      },
      {
        section: 'Reports',
        items: [
          { kind: 'report', label: 'Leave Balance', report: 'employee-leave-balance' },
          { kind: 'report', label: 'Leave Balance Summary', report: 'employee-leave-balance-summary' },
          { kind: 'report', label: 'Employees Working on a Holiday', report: 'employees-working-on-holiday' }
        ]
      },
      { kind: 'document', label: 'Settings', resource: 'hr-settings', doctype: 'HR Settings' }
    ]
  },
  {
    slug: 'expenses',
    label: 'Expenses',
    module: 'Expenses',
    icon: 'receipt',
    dashboard: 'Expense Claims',
    items: [
      {
        section: 'Expenses & Advances',
        items: [
          { kind: 'document', label: 'Expense Claim', resource: 'expense-claim' },
          { kind: 'document', label: 'Employee Advance', resource: 'employee-advance' },
          { kind: 'document', label: 'Expense Claim Type', resource: 'expense-claim-type' }
        ]
      },
      {
        section: 'Travel',
        items: [
          { kind: 'document', label: 'Purpose of Travel', resource: 'purpose-of-travel' },
          { kind: 'document', label: 'Travel Request', resource: 'travel-request' },
          { kind: 'document', label: 'Vehicle Log', resource: 'vehicle-log' },
          { kind: 'document', label: 'Driver', resource: 'driver' },
          { kind: 'document', label: 'Vehicle', resource: 'vehicle' }
        ]
      },
      {
        section: 'Accounting Entries',
        items: [
          { kind: 'page', label: 'Payment Entry', href: '/payments', doctype: 'Payment Entry' },
          { kind: 'page', label: 'Journal Entry', href: '/accounting/journal-entries', doctype: 'Journal Entry' }
        ]
      },
      {
        section: 'Reports',
        items: [
          { kind: 'report', label: 'Unpaid Expense Claim', report: 'unpaid-expense-claim' },
          { kind: 'report', label: 'Vehicle Expenses', report: 'vehicle-expenses' },
          { kind: 'page', label: 'Accounts Receivable', href: '/reports/accounts-receivable', report: 'Accounts Receivable' },
          { kind: 'page', label: 'Accounts Payable', href: '/reports/accounts-payable', report: 'Accounts Payable' },
          { kind: 'page', label: 'General Ledger', href: '/reports/general-ledger', report: 'General Ledger' }
        ]
      },
      { kind: 'document', label: 'Settings', resource: 'hr-settings', doctype: 'HR Settings' }
    ]
  },
  {
    slug: 'performance',
    label: 'Performance',
    module: 'Performance',
    icon: 'target',
    dashboard: 'Performance',
    items: [
      { kind: 'document', label: 'Goal', resource: 'goal' },
      { kind: 'document', label: 'Appraisal Cycle', resource: 'appraisal-cycle' },
      { kind: 'document', label: 'Appraisal', resource: 'appraisal' },
      { kind: 'document', label: 'Employee Performance Feedback', resource: 'performance-feedback' },
      { kind: 'document', label: 'Employee Promotion', resource: 'employee-promotion' },
      {
        section: 'Reports',
        items: [{ kind: 'report', label: 'Appraisal Overview', report: 'appraisal-overview' }]
      },
      {
        section: 'Setup',
        items: [
          { kind: 'document', label: 'Appraisal Template', resource: 'appraisal-template' },
          { kind: 'document', label: 'KRA', resource: 'kra' },
          { kind: 'document', label: 'Employee Feedback Criteria', resource: 'employee-feedback-criteria' }
        ]
      }
    ]
  },
  {
    slug: 'tax-and-benefits',
    label: 'Tax & Benefits',
    module: 'Tax and Benefits',
    icon: 'landmark',
    dashboard: 'Tax and Benefits',
    items: [
      {
        section: 'Income Tax',
        items: [
          { kind: 'document', label: 'Exemption Declaration', resource: 'exemption-declaration' },
          { kind: 'document', label: 'Exemption Submission Proof', resource: 'exemption-proof-submission' }
        ]
      },
      {
        section: 'Flexible Benefits',
        items: [
          { kind: 'document', label: 'Benefit Claim', resource: 'benefit-claim' },
          { kind: 'document', label: 'Benefit Application', resource: 'benefit-application' },
          { kind: 'document', label: 'Benefit Ledger', resource: 'employee-benefit-ledger' }
        ]
      },
      {
        section: 'Gratuity',
        items: [
          { kind: 'document', label: 'Gratuity Rule', resource: 'gratuity-rule' },
          { kind: 'document', label: 'Gratuity', resource: 'gratuity' }
        ]
      },
      {
        section: 'Reports',
        items: [
          { kind: 'report', label: 'Income Tax Computation', report: 'income-tax-computation' },
          { kind: 'report', label: 'Income Tax Deductions', report: 'income-tax-deductions' },
          { kind: 'report', label: 'Accrued Earnings Report', report: 'accrued-earnings' }
        ]
      },
      {
        section: 'Tax & Exemption Setup',
        items: [
          { kind: 'document', label: 'Income Tax Slab', resource: 'income-tax-slab' },
          { kind: 'document', label: 'Exemption Category', resource: 'exemption-category' },
          { kind: 'document', label: 'Employee Benefit', resource: 'employee-benefit' }
        ]
      }
    ]
  },
  {
    slug: 'payroll',
    label: 'Payroll',
    module: 'Payroll',
    icon: 'wallet',
    dashboard: 'Payroll',
    items: [
      { kind: 'document', label: 'Payroll Entry', resource: 'payroll-entry' },
      { kind: 'document', label: 'Salary Structure Assignment', resource: 'salary-structure-assignment' },
      { kind: 'document', label: 'Salary Slip', resource: 'salary-slip' },
      { kind: 'document', label: 'Additional Salary', resource: 'additional-salary' },
      { kind: 'document', label: 'Salary Withholding', resource: 'salary-withholding' },
      {
        section: 'Reports',
        items: [
          { kind: 'report', label: 'Employee CTC Break-up', report: 'employee-ctc-breakup' },
          { kind: 'report', label: 'Salary Register', report: 'salary-register' },
          { kind: 'page', label: 'Accounts Payable', href: '/reports/accounts-payable', report: 'Accounts Payable' },
          { kind: 'page', label: 'General Ledger', href: '/reports/general-ledger', report: 'General Ledger' }
        ]
      },
      {
        section: 'Setup',
        items: [
          { kind: 'document', label: 'Salary Component', resource: 'salary-component' },
          { kind: 'document', label: 'Salary Structure', resource: 'salary-structure' },
          { kind: 'document', label: 'Settings', resource: 'payroll-settings', doctype: 'Payroll Settings' }
        ]
      }
    ]
  }
];

// Bisonstechs-only capabilities that must stay reachable after the rebuild.
// Attendance itself is now linked from the Shift & Attendance workspace, exactly
// like the ERPNext sidebar does, so it is not repeated here.
const trackingLinks = [{ label: 'Live Tracking', href: '/hr/live-tracking' }];

// Every ERPNext workspace sidebar starts with a "Home" link to the workspace
// itself, and the workspaces that ship a Dashboard also link it. Both are
// generated instead of repeated by hand so the item order stays verifiable
// against the source JSON.
const WITH_DASHBOARD = new Set(['hr-setup', 'tenure', 'recruitment', 'shift-and-attendance', 'expenses', 'payroll']);

for (const ws of workspaces) {
  const items = [{ kind: 'home', label: 'Home', href: `/hr/${ws.slug}` }, ...ws.items];
  if (WITH_DASHBOARD.has(ws.slug)) {
    // Shift & Attendance lists its Roster page before the Dashboard
    const at = ws.slug === 'shift-and-attendance' ? 2 : 1;
    items.splice(at, 0, { kind: 'dashboard', label: 'Dashboard', href: `/hr/${ws.slug}/dashboard`, doctype: ws.dashboard });
  }
  for (const item of items) {
    if (item.section && !item.kind) {
      item.kind = 'section';
      item.label = item.section;
    }
  }
  ws.items = items;
}

// Registered DocTypes the ERPNext sidebars do not link — they are reached from
// the forms that use them. They stay out of the sidebar above and are surfaced
// here instead.
const extraDocuments = {
  // ERPNext keeps Gender and Salutation in the Contacts module, so the HR Setup
  // sidebar never links them; the documents still exist because Employee links
  // to them, so they are offered as masters here.
  'hr-setup': [
    { label: 'Employment Type', resource: 'employment-type' },
    { label: 'Gender', resource: 'gender' },
    { label: 'Salutation', resource: 'salutation' }
  ],
  // Exit Interview / Full & Final / Daily Work Summary exist as DocTypes in
  // Frappe HR but are not linked from the cloud Tenure sidebar — reachable via
  // search / related forms, mirrored here as linked masters.
  tenure: [
    { label: 'Employee Transfer', resource: 'employee-transfer' },
    { label: 'Exit Interview', resource: 'exit-interview' },
    { label: 'Full and Final Statement', resource: 'full-and-final-statement' },
    { label: 'Daily Work Summary Group', resource: 'daily-work-summary-group' },
    { label: 'Daily Work Summary', resource: 'daily-work-summary' }
  ],
  // Offer Term is only reachable through the Job Offer Term Template link in
  // ERPNext (no workspace sidebar entry), so it is offered as a linked master.
  recruitment: [{ label: 'Offer Term', resource: 'offer-term' }],
  // Compensatory Leave / Leave Adjustment are real DocTypes without Tenure/
  // Leaves sidebar entries on the inspected cloud instance.
  leaves: [
    { label: 'Compensatory Leave Request', resource: 'compensatory-leave-request' },
    { label: 'Leave Adjustment', resource: 'leave-adjustment' }
  ]
};

function resources() {
  const out = [];
  for (const ws of workspaces) {
    for (const item of ws.items) {
      if (item.section) {
        for (const child of item.items) if (child.resource && child.available !== false) out.push(child.resource);
      } else if (item.resource && item.available !== false) out.push(item.resource);
    }
  }
  for (const extra of Object.values(extraDocuments)) out.push(...extra.map((d) => d.resource));
  return [...new Set(out)];
}

module.exports = { workspaces, trackingLinks, extraDocuments, resources };
