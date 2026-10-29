'use strict';

/**
 * Declarative registry of the HRMS documents that mirror the inspected
 * ERPNext/Frappe HR doctypes (source: github.com/frappe/hrms workspace
 * sidebars + doctype JSON, fields/statuses taken from those definitions).
 *
 * Every entry is served by services/hrDocumentService.js through
 * /api/hr/docs/:resource — one code path, company-scoped, with backend
 * enforced required fields, link validation and status transitions.
 */

const EMPLOYEE = { n: 'employeeId', l: 'Employee', t: 'employee', r: true };
const COMPANY_FIELD = { n: 'company', l: 'Company', t: 'computed:companyName', ro: true };
const REASON = { n: 'reason', l: 'Reason', t: 'longText' };
const NOTES = { n: 'notes', l: 'Notes', t: 'longText' };
const DRAFT_FLOW = [
  { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
  { key: 'cancel', label: 'Cancel', from: ['Submitted'], to: 'Cancelled', action: 'edit' },
  { key: 'amend', label: 'Amend', from: ['Cancelled'], to: 'Draft', action: 'edit' }
];

const registry = {
  // ── Payroll ───────────────────────────────────────────────────────────
  'salary-component': {
    // Exact ERPNext Salary Component tabs: Overview → Accounts → Condition & Formula → Flexible Benefits.
    model: 'hrSalaryComponent', doctype: 'Salary Component', workspace: 'payroll',
    section: 'Setup', titleField: 'name', unique: ['name'],
    columns: ['name', 'abbr', 'type', 'dependsOnPaymentDays', 'disabled'],
    search: ['name', 'abbr', 'componentCategory'],
    fields: [
      { tab: 'Overview', n: 'name', l: 'Name', t: 'data', r: true },
      { n: 'abbr', l: 'Abbr', t: 'data', r: true },
      { n: 'type', l: 'Type', t: 'select', r: true, o: ['Earning', 'Deduction', 'Employer Contribution'], d: 'Earning' },
      { n: 'description', l: 'Description', t: 'longText' },
      { n: 'dependsOnPaymentDays', l: 'Depends on Payment Days', t: 'bool', d: true },
      {
        n: 'isTaxableComponent', l: 'Is Tax Applicable', t: 'bool', d: true,
        when: { field: 'type', equals: 'Earning' }
      },
      {
        n: 'deductFullTaxOnSelectedPayrollDate', l: 'Deduct Full Tax on Selected Payroll Date', t: 'bool', d: false,
        when: [{ field: 'isTaxableComponent', equals: true }, { field: 'type', equals: 'Earning' }]
      },
      {
        n: 'variableBasedOnTaxableSalary', l: 'Variable Based On Taxable Salary', t: 'bool', d: false,
        when: { field: 'type', equals: 'Deduction' },
        hint: 'If enabled, the component will be considered as a tax component and the amount will be auto-calculated as per the configured income tax slabs'
      },
      {
        n: 'isIncomeTaxComponent', l: 'Is Income Tax Component', t: 'bool', d: false,
        when: { field: 'type', equals: 'Deduction' },
        hint: 'If enabled, the component will be considered in the Income Tax Deductions report'
      },
      {
        n: 'exemptedFromIncomeTax', l: 'Exempted from Income Tax', t: 'bool', d: false,
        when: [{ field: 'type', equals: 'Deduction' }, { field: 'variableBasedOnTaxableSalary', equals: false }],
        hint: 'If checked, the full amount will be deducted from taxable income before calculating income tax without any declaration or proof submission.'
      },
      { n: 'roundToNearestIntegral', l: 'Round to the Nearest Integer', t: 'bool', d: false },
      {
        n: 'statisticalComponent', l: 'Statistical Component', t: 'bool', d: false,
        when: { field: 'type', notEquals: 'Employer Contribution' },
        hint: "If enabled, the value specified or calculated in this component will not contribute to the earnings or deductions. However, it's value can be referenced by other components that can be added or deducted."
      },
      {
        n: 'accrualComponent', l: 'Accrual Component', t: 'bool', d: false,
        when: { field: 'type', equals: 'Earning' },
        hint: 'If enabled, this component allows to accrue amounts without adding them to earnings. The accrued balance is tracked in the Employee Benefit Ledger and can be paid out later as needed.'
      },
      {
        n: 'doNotIncludeInTotal', l: 'Do Not Include in Total', t: 'bool', d: false,
        when: { field: 'type', notEquals: 'Employer Contribution' }
      },
      {
        n: 'doNotIncludeInAccounts', l: 'Do Not Include in Accounting Entries', t: 'bool', d: false,
        when: { field: 'doNotIncludeInTotal', equals: true },
        hint: 'If enabled, the amount will be excluded from accounting entries during Journal Entry creation.'
      },
      {
        n: 'removeIfZeroValued', l: 'Remove if Zero Valued', t: 'bool', d: true,
        when: [{ field: 'statisticalComponent', equals: false }, { field: 'type', notEquals: 'Employer Contribution' }],
        hint: 'If enabled, the component will not be displayed in the salary slip if the amount is zero'
      },
      {
        n: 'arrearComponent', l: 'Arrear Component', t: 'bool', d: false,
        when: { field: 'type', notEquals: 'Employer Contribution' },
        hint: 'If enabled, this component will be included in arrear calculations'
      },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false },
      {
        s: 'Accounts', n: 'accounts', l: 'Accounts', t: 'table',
        rows: [
          { n: 'companyId', l: 'Company', t: 'company' },
          { n: 'account', l: 'Account', t: 'account', hint: 'Default Bank / Cash account will be automatically updated in Salary Journal Entry when this mode is selected.' },
          {
            n: 'liabilityAccount', l: 'Liability Account', t: 'account',
            hint: 'Liability account credited for employer contributions. Applicable only for Employer Contribution components, where Account is debited as the expense.'
          }
        ]
      },
      // Legacy single-account fields kept for older payroll journals.
      { n: 'expenseAccount', l: 'Expense Account', t: 'account', hidden: true },
      { n: 'payableAccount', l: 'Payable Account', t: 'account', hidden: true },
      { n: 'componentCategory', l: 'Component Category', t: 'data', hidden: true },
      {
        tab: 'Condition & Formula', s: 'Condition and Formula', n: 'condition', l: 'Condition', t: 'longText',
        hint: 'Python expression evaluated when this component is applied on a salary slip.'
      },
      {
        n: 'amount', l: 'Amount', t: 'currency', d: 0,
        when: { field: 'amountBasedOnFormula', equals: false }
      },
      { n: 'amountBasedOnFormula', l: 'Amount based on formula', t: 'bool', d: false },
      {
        n: 'formula', l: 'Formula', t: 'longText',
        when: { field: 'amountBasedOnFormula', equals: true },
        hint: 'Python expression, e.g. base * 0.4'
      },
      {
        tab: 'Flexible Benefits', s: 'Flexible Benefits', n: 'isFlexibleBenefit', l: 'Is Flexible Benefit', t: 'bool', d: false,
        when: { field: 'type', notEquals: 'Employer Contribution' }
      },
      {
        n: 'payoutMethod', l: 'Payout Method', t: 'select',
        o: ['', 'Accrue and payout at end of payroll period', 'Accrue per cycle, pay only on claim', 'Allow claim for full benefit amount'],
        when: { field: 'isFlexibleBenefit', equals: true },
        reqWhen: { field: 'isFlexibleBenefit', equals: true }
      },
      {
        n: 'finalCycleAccrualPayout', l: 'Payout Unclaimed Amount in Final Payroll Cycle', t: 'bool', d: false,
        when: [
          { field: 'isFlexibleBenefit', equals: true },
          { field: 'payoutMethod', equals: 'Accrue per cycle, pay only on claim' }
        ]
      },
      {
        n: 'maxBenefitAmount', l: 'Max Benefit Amount (Yearly)', t: 'currency', d: 0,
        when: { field: 'isFlexibleBenefit', equals: true },
        hint: 'If greater than zero, this sets the maximum benefit amount assignable to any employee'
      }
    ],
    beforeWrite: 'prepareSalaryComponent'
  },
  'salary-structure': {
    model: 'hrSalaryStructure', doctype: 'Salary Structure', workspace: 'payroll',
    section: 'Setup', titleField: 'name', unique: ['name'], statuses: ['Draft', 'Submitted', 'Cancelled'],
    actions: DRAFT_FLOW,
    columns: ['name', 'payrollFrequencyType', 'status', 'disabled'],
    search: ['name'],
    fields: [
      { n: 'name', l: 'Name', t: 'data', r: true },
      COMPANY_FIELD,
      { n: 'currency', l: 'Currency', t: 'currencyCode' },
      { n: 'payrollFrequencyType', l: 'Salary Slip Based on Timesheet Frequency', t: 'select', o: ['Monthly', 'Fortnight', 'Weekly', 'Daily'], d: 'Monthly' },
      { n: 'modeOfPayment', l: 'Mode of Payment', t: 'data' },
      { n: 'paymentAccount', l: 'Payment Account', t: 'account' },
      { n: 'leaveEncashmentComponentId', l: 'Leave Encashment Component', t: 'link', o: 'salary-component' },
      { n: 'maxBenefits', l: 'Max Benefits (Amount)', t: 'currency', d: 0 },
      {
        n: 'earnings', l: 'Earnings', t: 'table', rows: [
          { n: 'componentId', l: 'Salary Component', t: 'link', o: 'salary-component', r: true },
          { n: 'amountType', l: 'Condition/Formula Type', t: 'select', o: ['Amount', 'Percentage of Base', 'Percentage of CTC', 'Formula'], d: 'Amount' },
          { n: 'amount', l: 'Amount', t: 'currency', d: 0 },
          { n: 'formula', l: 'Formula', t: 'data' },
          { n: 'condition', l: 'Condition', t: 'data' },
          { n: 'defaultAmount', l: 'Default Amount (per day)', t: 'currency', d: 0 },
          { n: 'dependsOnPaymentDays', l: 'Depends on Payment Days', t: 'bool', d: true },
          { n: 'statisticalComponent', l: 'Statistical', t: 'bool', d: false }
        ]
      },
      {
        n: 'deductions', l: 'Deductions', t: 'table', rows: [
          { n: 'componentId', l: 'Salary Component', t: 'link', o: 'salary-component', r: true },
          { n: 'amountType', l: 'Condition/Formula Type', t: 'select', o: ['Amount', 'Percentage of Base', 'Percentage of CTC', 'Formula'], d: 'Amount' },
          { n: 'amount', l: 'Amount', t: 'currency', d: 0 },
          { n: 'formula', l: 'Formula', t: 'data' },
          { n: 'condition', l: 'Condition', t: 'data' },
          { n: 'roundToNearestIntegral', l: 'Round to the Nearest Integral', t: 'bool', d: true }
        ]
      },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false },
      NOTES
    ]
  },
  'salary-structure-assignment': {
    model: 'hrSalaryStructureAssignment', doctype: 'Salary Structure Assignment', workspace: 'payroll',
    section: null, titleField: null, statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    onSubmitted: 'syncEmployeeSalaryFromAssignment',
    columns: ['employeeId', 'salaryStructureId', 'base', 'fromDate', 'status'],
    search: [], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      { n: 'designation', l: 'Designation', t: 'computed:designation', ro: true },
      { n: 'salaryStructureId', l: 'Salary Structure', t: 'link', o: 'salary-structure', r: true },
      { n: 'base', l: 'Base (Amount)', t: 'currency', r: true, d: 0 },
      { n: 'incomeTaxSlabId', l: 'Income Tax Slab', t: 'link', o: 'income-tax-slab' },
      { n: 'fromDate', l: 'From Date', t: 'date', r: true },
      { n: 'payableAccount', l: 'Payroll Payable Account', t: 'account' },
      { n: 'costCenter', l: 'Cost Center', t: 'costCenter' },
      { n: 'currency', l: 'Currency', t: 'currencyCode' },
      { n: 'variable', l: 'Variable Values', t: 'keyValue', hint: 'Referenced by structure formulas, e.g. house_rent_allowance' },
      NOTES
    ],
    requiredIfAbsent: null,
    preventDuplicate: { fields: ['employeeId', 'salaryStructureId', 'fromDate'], message: 'This employee already has this salary structure assigned from that date' }
  },
  'additional-salary': {
    model: 'hrBonus', doctype: 'Additional Salary', workspace: 'payroll',
    section: null, titleField: 'reason', statuses: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
      { key: 'approve', label: 'Approve', from: ['Submitted', 'Draft'], to: 'Approved', action: 'approve' },
      { key: 'reject', label: 'Reject', from: ['Submitted'], to: 'Rejected', action: 'approve' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Submitted', 'Approved'], to: 'Cancelled', action: 'edit' }
    ],
    onApproved: 'applyAdditionalSalaryToPayroll',
    columns: ['employeeId', 'reason', 'amount', 'additionalType', 'status'],
    search: ['reason'], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'additionalType', l: 'Type', t: 'select', o: ['Salary', 'Bonus', 'Deduction'], d: 'Salary' },
      { n: 'salaryComponentId', l: 'Salary Component', t: 'link', o: 'salary-component', r: true },
      { n: 'amount', l: 'Amount', t: 'currency', r: true, min: 0 },
      { n: 'fromDate', l: 'From Date', t: 'date' },
      { n: 'toDate', l: 'To Date', t: 'date' },
      { n: 'period', l: 'Payroll Payable / Period', t: 'data', hint: 'YYYY-MM to book it in one salary slip' },
      { n: 'reason', l: 'Additional Salary Description', t: 'data', r: true },
      NOTES
    ]
  },
  // ── Tax & Benefits ────────────────────────────────────────────────────
  'income-tax-slab': {
    model: 'hrIncomeTaxSlab', doctype: 'Income Tax Slab', workspace: 'tax-and-benefits',
    section: 'Setup', titleField: 'name', unique: ['name'], statuses: ['Draft', 'Submitted', 'Cancelled'],
    actions: DRAFT_FLOW,
    columns: ['name', 'effectiveDate', 'standardTaxExemptionAmount', 'status'],
    search: ['name'],
    fields: [
      { n: 'name', l: 'Name', t: 'data', r: true },
      COMPANY_FIELD,
      { n: 'currency', l: 'Currency', t: 'currencyCode' },
      { n: 'effectiveDate', l: 'Effective From', t: 'date', r: true },
      { n: 'standardTaxExemptionAmount', l: 'Standard Exemption Amount', t: 'currency', d: 0 },
      { n: 'considerGrossPayAsTaxable', l: 'Consider Gross Pay for Taxable', t: 'bool', d: true },
      {
        n: 'slabs', l: 'Taxable Salary Slabs', t: 'table', rows: [
          { n: 'fromAmount', l: 'From Amount', t: 'currency', r: true },
          { n: 'toAmount', l: 'To Amount', t: 'currency' },
          { n: 'percent', l: '% Tax on Income', t: 'float', d: 0 },
          { n: 'flatTaxAmount', l: 'Flat Tax Amount', t: 'currency', d: 0 }
        ]
      },
      {
        n: 'otherCharges', l: 'Other Charges', t: 'table', rows: [
          { n: 'name', l: 'Name', t: 'data', r: true },
          { n: 'description', l: 'Description', t: 'data' },
          { n: 'percent', l: '% of Annual Taxable Income', t: 'float', d: 0 },
          { n: 'flatAmount', l: 'Flat Amount', t: 'currency', d: 0 }
        ]
      },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false }
    ]
  },
  'exemption-category': {
    model: 'hrTaxExemptionCategory', doctype: 'Employee Tax Exemption Category', workspace: 'tax-and-benefits',
    section: 'Setup', titleField: 'name', unique: ['name'], columns: ['name', 'maxExemptionAmount', 'disabled'],
    search: ['name'],
    fields: [
      { n: 'name', l: 'Name', t: 'data', r: true },
      { n: 'maxExemptionAmount', l: 'Max Exemption Amount', t: 'currency', r: true, d: 0 },
      { n: 'maxExemptionAmountBasedOn', l: 'Max Exemption Based On', t: 'select', o: ['Amount', 'Percentage of Basic Salary'], d: 'Amount' },
      { n: 'declarationSection', l: 'Declaration Section', t: 'select', o: ['Employee Tax Exemption Declaration', 'Employee Tax Exemption Proof Submission'], d: 'Employee Tax Exemption Declaration' },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false }
    ]
  },
  'exemption-declaration': {
    model: 'hrTaxExemptionDeclaration', doctype: 'Employee Tax Exemption Declaration', workspace: 'tax-and-benefits',
    statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    columns: ['employeeId', 'totalExemption', 'status'], search: [], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'payrollPeriodId', l: 'Payroll Period', t: 'link', o: 'leave-period' },
      { n: 'currency', l: 'Currency', t: 'currencyCode' },
      {
        n: 'declarations', l: 'Declarations', t: 'table', rows: [
          { n: 'categoryId', l: 'Tax Exemption Category', t: 'link', o: 'exemption-category', r: true },
          { n: 'subCategory', l: 'Sub Category / Mode of Payment', t: 'data' },
          { n: 'maxAmount', l: 'Max Amount', t: 'currency', d: 0 },
          { n: 'amount', l: 'Amount', t: 'currency', r: true, d: 0 },
          { n: 'remarks', l: 'Remarks', t: 'data' }
        ]
      },
      { n: 'totalExemption', l: 'Total Exemption Amount', t: 'currency', d: 0, computedFrom: 'declarations' },
      NOTES
    ]
  },
  'exemption-proof-submission': {
    model: 'hrTaxExemptionProofSubmission', doctype: 'Employee Tax Exemption Proof Submission', workspace: 'tax-and-benefits',
    statuses: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
      { key: 'approve', label: 'Approve', from: ['Submitted'], to: 'Approved', action: 'approve' },
      { key: 'reject', label: 'Reject', from: ['Submitted'], to: 'Rejected', action: 'approve' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Submitted'], to: 'Cancelled', action: 'edit' }
    ],
    columns: ['employeeId', 'totalSubmitted', 'status'], search: [], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'declarationId', l: 'Tax Exemption Declaration', t: 'link', o: 'exemption-declaration' },
      { n: 'payrollPeriodId', l: 'Payroll Period', t: 'link', o: 'leave-period' },
      {
        n: 'submissions', l: 'Proof Submission Details', t: 'table', rows: [
          { n: 'categoryId', l: 'Tax Exemption Category', t: 'link', o: 'exemption-category', r: true },
          { n: 'amount', l: 'Amount', t: 'currency', r: true, d: 0 },
          { n: 'attachment', l: 'Attachment', t: 'data' },
          { n: 'remarks', l: 'Remarks', t: 'data' }
        ]
      },
      { n: 'totalSubmitted', l: 'Total Submitted Exemption', t: 'currency', d: 0, computedFrom: 'submissions' }
    ]
  },
  'employee-benefit': {
    model: 'hrEmployeeBenefit', doctype: 'Employee Benefit Application Detail (master)', workspace: 'tax-and-benefits',
    section: 'Setup', titleField: 'name', unique: ['name'], columns: ['name', 'type', 'maxAmount', 'disabled'],
    search: ['name'],
    fields: [
      { n: 'name', l: 'Benefit', t: 'data', r: true },
      { n: 'salaryComponentId', l: 'Salary Component', t: 'link', o: 'salary-component', r: true },
      { n: 'type', l: 'Type of Benefit', t: 'select', o: ['cash', 'perquisite'], d: 'cash' },
      { n: 'maxAmount', l: 'Max Amount Payable (Yearly)', t: 'currency', d: 0 },
      { n: 'maxAmountBasedOn', l: 'Max Amount Based On', t: 'select', o: ['Amount', 'Percentage of CTC'], d: 'Amount' },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false }
    ]
  },
  'benefit-application': {
    model: 'hrEmployeeBenefitApplication', doctype: 'Employee Benefit Application', workspace: 'tax-and-benefits',
    statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    columns: ['employeeId', 'totalAmount', 'status'], search: [], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'payrollPeriodId', l: 'Payroll Period', t: 'link', o: 'leave-period' },
      { n: 'currency', l: 'Currency', t: 'currencyCode' },
      { n: 'maxBenefits', l: 'Max Benefits (Amount)', t: 'currency', d: 0 },
      {
        n: 'benefits', l: 'Flexible Benefits', t: 'table', rows: [
          { n: 'componentId', l: 'Salary Component', t: 'link', o: 'salary-component', r: true },
          { n: 'maxAmountPerRequirement', l: 'Max Amount Payable', t: 'currency', d: 0 },
          { n: 'amount', l: 'Amount', t: 'currency', r: true, d: 0 }
        ]
      },
      { n: 'totalAmount', l: 'Total Amount', t: 'currency', d: 0, computedFrom: 'benefits' }
    ]
  },
  'benefit-claim': {
    model: 'hrEmployeeBenefitClaim', doctype: 'Employee Benefit Claim', workspace: 'tax-and-benefits',
    statuses: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Paid', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
      { key: 'approve', label: 'Approve', from: ['Submitted'], to: 'Approved', action: 'approve' },
      { key: 'reject', label: 'Reject', from: ['Submitted'], to: 'Rejected', action: 'approve' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Submitted', 'Approved'], to: 'Cancelled', action: 'edit' }
    ],
    columns: ['employeeId', 'amount', 'claimedOn', 'status'], search: [], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'benefitApplicationId', l: 'Benefit Application', t: 'link', o: 'benefit-application' },
      { n: 'salaryComponentId', l: 'Claim Benefit For', t: 'link', o: 'salary-component', r: true },
      { n: 'amount', l: 'Claim Amount', t: 'currency', r: true, min: 0 },
      { n: 'claimedOn', l: 'Claimed On', t: 'date', r: true },
      { n: 'expenseProof', l: 'Attach Expense Proof', t: 'data' },
      { n: 'payrollItemId', l: 'Salary Slip (Overpayment Adjustment)', t: 'data', ro: true }
    ]
  },
  // ── Leaves ────────────────────────────────────────────────────────────
  'leave-type': {
    model: 'hrLeaveType', doctype: 'Leave Type', workspace: 'leaves', section: 'Setup',
    titleField: 'name', unique: ['name'], columns: ['name', 'paid', 'annualQuota', 'carryForward', 'encashable'],
    search: ['name'],
    fields: [
      { n: 'name', l: 'Leave Type Name', t: 'data', r: true },
      { n: 'paid', l: 'Is Paid Leave', t: 'bool', d: true },
      { n: 'annualQuota', l: 'Max Leaves Allowed (year)', t: 'int', d: 14, min: 0 },
      { n: 'carryForward', l: 'Is Carry Forward Leave', t: 'bool', d: false },
      { n: 'maxCarryForward', l: 'Max Carry Forward', t: 'int', d: 0, min: 0 },
      { n: 'earnedLeave', l: 'Earned Leave', t: 'bool', d: false },
      { n: 'encashable', l: 'Encashment Capacity', t: 'bool', d: false },
      { n: 'allowNegative', l: 'Allow Negative Balance', t: 'bool', d: false },
      { n: 'maxAllowanceForLop', l: 'Max Allowed LWP days', t: 'int', d: 0, min: 0 },
      { n: 'unit', l: 'Unit', t: 'select', o: ['day', 'hour'], d: 'day' }
    ]
  },
  'leave-period': {
    model: 'hrLeavePeriod', doctype: 'Leave Period', workspace: 'leaves', section: 'Setup',
    titleField: 'name', unique: ['name'], columns: ['name', 'startDate', 'endDate'],
    search: ['name'],
    fields: [
      { n: 'name', l: 'Leave Period', t: 'data', r: true },
      { n: 'startDate', l: 'Start Date', t: 'date', r: true },
      { n: 'endDate', l: 'End Date', t: 'date', r: true }
    ],
    validate: 'leavePeriodDates'
  },
  'leave-policy': {
    model: 'hrLeavePolicy', doctype: 'Leave Policy', workspace: 'leaves', section: 'Setup',
    titleField: 'name', unique: ['name'], statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    columns: ['name', 'status'], search: ['name'],
    fields: [
      { n: 'name', l: 'Leave Policy Name', t: 'data', r: true },
      { n: 'description', l: 'Description', t: 'longText' },
      {
        n: 'details', l: 'Leave Policy Details', t: 'table', rows: [
          { n: 'leaveTypeId', l: 'Leave Type', t: 'link', o: 'leave-type', r: true },
          { n: 'annualAllocation', l: 'Annual Allocation', t: 'float', r: true, d: 0, min: 0 }
        ]
      }
    ]
  },
  'leave-policy-assignment': {
    model: 'hrLeavePolicyAssignment', doctype: 'Leave Policy Assignment', workspace: 'leaves',
    statuses: ['Draft', 'Submitted', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
      { key: 'cancel', label: 'Cancel', from: ['Submitted'], to: 'Cancelled', action: 'edit' }
    ],
    onSubmitted: 'allocateLeavesFromPolicyAssignment',
    columns: ['employeeId', 'leavePolicyId', 'leavePeriodId', 'status'], search: [], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'leavePolicyId', l: 'Leave Policy', t: 'link', o: 'leave-policy', r: true },
      { n: 'leavePeriodId', l: 'Leave Period', t: 'link', o: 'leave-period', r: true },
      { n: 'allocateOnDaysBeforeStart', l: 'Allocate on Days Before Start', t: 'int', d: 0, min: 0 },
      { n: 'fromDate', l: 'Effective From', t: 'date' },
      { n: 'toDate', l: 'Effective To', t: 'date' },
      NOTES
    ],
    preventDuplicate: { fields: ['employeeId', 'leavePolicyId', 'leavePeriodId'], message: 'This policy is already assigned to the employee for that leave period' }
  },
  'leave-allocation': {
    // Exact ERPNext Leave Allocation (HR-LAL series + Allocation / Earned schedule / Notes).
    model: 'hrLeaveBalance', doctype: 'Leave Allocation', workspace: 'leaves',
    titleField: 'employeeName',
    statuses: ['Draft', 'Open', 'Submitted', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft', 'Open'], to: 'Submitted', action: 'edit' },
      { key: 'cancel', label: 'Cancel', from: ['Open', 'Submitted'], to: 'Cancelled', action: 'edit' }
    ],
    columns: ['employeeId', 'leaveTypeId', 'totalLeavesAllocated', 'fromDate', 'toDate', 'status'],
    search: ['employeeName'], employeeScoped: true,
    fields: [
      { n: 'namingSeries', l: 'Series', t: 'select', o: ['HR-LAL-.YYYY.-'], d: 'HR-LAL-.YYYY.-', r: true },
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      COMPANY_FIELD,
      { n: 'leaveTypeId', l: 'Leave Type', t: 'link', o: 'leave-type', r: true },
      { n: 'fromDate', l: 'From Date', t: 'date', r: true },
      { n: 'toDate', l: 'To Date', t: 'date', r: true },
      { s: 'Allocation', n: 'newLeaves', l: 'New Leaves Allocated', t: 'float', d: 0, min: 0 },
      {
        n: 'carryForward', l: 'Add unused leaves from previous allocations', t: 'bool', d: false
      },
      {
        n: 'unusedLeaves', l: 'Unused leaves', t: 'float', d: 0, ro: true,
        when: { field: 'carryForward', equals: true }
      },
      { n: 'totalLeavesAllocated', l: 'Total Leaves Allocated', t: 'float', d: 0, ro: true, r: true },
      {
        n: 'totalLeavesEncashed', l: 'Total Leaves Encashed', t: 'float', d: 0, ro: true,
        when: { field: 'totalLeavesEncashed', notEquals: 0 }
      },
      { n: 'compensatoryRequestId', l: 'Compensatory Leave Request', t: 'link', o: 'compensatory-leave-request', ro: true },
      { n: 'leavePeriodId', l: 'Leave Period', t: 'link', o: 'leave-period', ro: true },
      { n: 'leavePolicyId', l: 'Leave Policy', t: 'link', o: 'leave-policy', ro: true, hidden: true },
      { n: 'policyAssignmentId', l: 'Leave Policy Assignment', t: 'link', o: 'leave-policy-assignment', ro: true },
      {
        n: 'carryForwardLeaves', l: 'Carry Forwarded Leaves', t: 'float', d: 0, ro: true,
        when: { field: 'carryForwardLeaves', notEquals: 0 }
      },
      { n: 'expired', l: 'Expired', t: 'bool', d: false, ro: true, hidden: true },
      { n: 'year', l: 'Year', t: 'int', hidden: true },
      {
        s: 'Earned Leave Schedule', n: 'earnedLeaveSchedule', l: 'Earned Leave Schedule', t: 'table', ro: true,
        rows: [
          { n: 'date', l: 'Date', t: 'date' },
          { n: 'leaves', l: 'Leaves', t: 'float', d: 0 },
          { n: 'isAllocated', l: 'Is Allocated', t: 'bool', d: false }
        ]
      },
      { s: 'Notes', n: 'reason', l: 'Description', t: 'longText' }
    ],
    beforeWrite: 'normalizeLeaveAllocation'
  },
  'leave-application': {
    // Exact ERPNext Leave Application (Dates & Reason / Approval / Other Details).
    model: 'hrLeave', doctype: 'Leave Application', workspace: 'leaves',
    titleField: 'employeeName',
    statuses: ['Open', 'Approved', 'Rejected', 'Cancelled'],
    actions: [
      { key: 'approve', label: 'Approve', from: ['Open'], to: 'Approved', action: 'approve' },
      { key: 'reject', label: 'Reject', from: ['Open'], to: 'Rejected', action: 'approve' },
      { key: 'cancel', label: 'Cancel', from: ['Open', 'Approved'], to: 'Cancelled', action: 'edit' }
    ],
    onApproved: 'applyApprovedLeave', onCancelled: 'revertApprovedLeave',
    columns: ['employeeId', 'type', 'fromDate', 'toDate', 'days', 'status'],
    search: ['employeeName', 'reason'], employeeScoped: true,
    fields: [
      { n: 'namingSeries', l: 'Series', t: 'select', o: ['HR-LAP-.YYYY.-'], d: 'HR-LAP-.YYYY.-', r: true },
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      { n: 'leaveTypeId', l: 'Leave Type', t: 'link', o: 'leave-type', r: true },
      { n: 'type', l: 'Leave Type Label', t: 'computed:leaveType', ro: true, hidden: true },
      COMPANY_FIELD,
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      { s: 'Dates & Reason', n: 'fromDate', l: 'From Date', t: 'date', r: true },
      { n: 'toDate', l: 'To Date', t: 'date', r: true },
      { n: 'halfDay', l: 'Half Day', t: 'bool', d: false },
      {
        n: 'halfDayDate', l: 'Half Day Date', t: 'date',
        when: [
          { field: 'halfDay', equals: true },
          { field: 'fromDate', truthy: true },
          { field: 'toDate', truthy: true }
        ]
      },
      { n: 'days', l: 'Total Leave Days', t: 'float', d: 0, ro: true },
      { n: 'reason', l: 'Reason', t: 'longText' },
      { n: 'leaveBalanceBefore', l: 'Leave Balance Before Application', t: 'float', d: 0, ro: true },
      { s: 'Approval', n: 'approverId', l: 'Leave Approver', t: 'userLink' },
      { n: 'approverName', l: 'Leave Approver Name', t: 'data', ro: true },
      { n: 'followViaEmail', l: 'Follow via Email', t: 'bool', d: true },
      { n: 'appliedOn', l: 'Posting Date', t: 'date', r: true, d: 'today' },
      { s: 'Other Details', n: 'salarySlipId', l: 'Salary Slip', t: 'link', o: 'salary-slip' },
      { n: 'color', l: 'Color', t: 'data' },
      { n: 'leavePeriodId', l: 'Leave Period', t: 'link', o: 'leave-period', hidden: true },
      { n: 'hours', l: 'Hours', t: 'float', d: 0, hidden: true },
      { n: 'explanation', l: 'Explanation (LWP)', t: 'longText', hidden: true },
      { n: 'forwardingNote', l: 'Forwarding Note', t: 'longText', hidden: true }
    ],
    beforeWrite: 'validateLeaveApplication'
  },
  'leave-encashment': {
    // Exact ERPNext Leave Encashment (Accounting / Dimensions / Payroll / More Info).
    model: 'hrLeaveEncashment', doctype: 'Leave Encashment', workspace: 'leaves',
    titleField: 'employeeName',
    statuses: ['Draft', 'Submitted', 'Unpaid', 'Paid', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
      { key: 'pay', label: 'Mark Paid', from: ['Submitted', 'Unpaid'], to: 'Paid', action: 'pay' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Submitted', 'Unpaid'], to: 'Cancelled', action: 'edit' }
    ],
    onSubmitted: 'reserveEncashmentDays',
    columns: ['employeeId', 'leaveTypeId', 'encashmentDays', 'payableAmount', 'status'],
    search: ['employeeName'], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      COMPANY_FIELD,
      { n: 'leavePeriodId', l: 'Leave Period', t: 'link', o: 'leave-period', r: true },
      { n: 'leaveTypeId', l: 'Leave Type', t: 'link', o: 'leave-type', r: true },
      { n: 'leaveBalanceId', l: 'Leave Allocation', t: 'link', o: 'leave-allocation', ro: true },
      { n: 'allocatableLeave', l: 'Leave Balance', t: 'float', d: 0, ro: true },
      {
        n: 'actualEncashableDays', l: 'Actual Encashable Days', t: 'float', d: 0, ro: true,
        hint: 'Number of leaves eligible for encashment based on leave type settings'
      },
      { n: 'encashmentDays', l: 'Encashment Days', t: 'float', min: 0 },
      { n: 'payableAmount', l: 'Encashment Amount', t: 'currency', d: 0, ro: true },
      { n: 'dailyRate', l: 'Daily Rate', t: 'currency', d: 0, hidden: true },
      {
        s: 'Accounting', n: 'payViaPaymentEntry', l: 'Pay via Payment Entry', t: 'bool', d: false,
        hint: 'Process leave encashment via a separate Payment Entry instead of Salary Slip'
      },
      {
        n: 'expenseAccount', l: 'Expense Account', t: 'account',
        when: { field: 'payViaPaymentEntry', equals: true },
        reqWhen: { field: 'payViaPaymentEntry', equals: true }
      },
      {
        n: 'payableAccount', l: 'Payable Account', t: 'account',
        when: { field: 'payViaPaymentEntry', equals: true },
        reqWhen: { field: 'payViaPaymentEntry', equals: true }
      },
      {
        n: 'postingDate', l: 'Posting Date', t: 'date', d: 'today',
        when: { field: 'payViaPaymentEntry', equals: true }
      },
      {
        n: 'currency', l: 'Currency', t: 'currencyCode', ro: true,
        when: 'employeeId'
      },
      {
        n: 'paidAmount', l: 'Paid Amount', t: 'currency', d: 0, ro: true,
        when: { field: 'payViaPaymentEntry', equals: true },
        hint: 'Amount paid against this encashment'
      },
      {
        s: 'Accounting Dimensions', n: 'costCenter', l: 'Cost Center', t: 'costCenter',
        reqWhen: { field: 'payViaPaymentEntry', equals: true }
      },
      { s: 'Payroll', n: 'effectiveDate', l: 'Encashment Date', t: 'date', r: true, d: 'today' },
      { n: 'additionalSalaryId', l: 'Additional Salary', t: 'link', o: 'additional-salary', ro: true },
      { n: 'salaryComponentId', l: 'Salary Component', t: 'link', o: 'salary-component', hidden: true },
      { s: 'More Info', n: 'reason', l: 'Notes', t: 'longText' }
    ],
    beforeWrite: 'prepareLeaveEncashment'
  },
  'leave-block-list': {
    model: 'hrLeaveBlockList', doctype: 'Leave Block List', workspace: 'leaves', section: 'Setup',
    titleField: 'name', unique: ['name'], columns: ['name', 'fromDate', 'toDate', 'locked'],
    search: ['name'],
    fields: [
      { n: 'name', l: 'Leave Block List Name', t: 'data', r: true },
      { n: 'fromDate', l: 'Block Starts', t: 'date', r: true },
      { n: 'toDate', l: 'Block Ends', t: 'date', r: true },
      { n: 'blockDescription', l: 'Reason for blocking', t: 'longText' },
      {
        n: 'dates', l: 'Block Days', t: 'table', rows: [
          { n: 'date', l: 'Date', t: 'date', r: true },
          { n: 'reason', l: 'Reason', t: 'data' }
        ]
      },
      { n: 'allowedEmployeeIds', l: 'Allow Users', t: 'multiEmployee' },
      { n: 'locked', l: 'Locked', t: 'bool', d: false }
    ]
  },
  'holiday-list': {
    model: 'hrHolidayList', doctype: 'Holiday List', workspace: 'leaves', section: 'Setup',
    titleField: 'name', unique: ['name'], hrWriteOnly: true,
    columns: ['name', 'fromDate', 'toDate', 'totalHolidays', 'weeklyOff'],
    search: ['name'],
    buttons: [
      { key: 'getWeeklyOffDates', label: 'Add to Holidays', hook: 'addWeeklyOffDates' },
      { key: 'clearHolidays', label: 'Clear Table', hook: 'clearHolidayTable' }
    ],
    beforeWrite: 'normalizeHolidayList',
    onCreated: 'syncHolidayRows',
    onUpdated: 'syncHolidayRows',
    onDeleting: 'removeHolidayRows',
    fields: [
      { n: 'name', l: 'Holiday List Name', t: 'data', r: true },
      { n: 'fromDate', l: 'From Date', t: 'date', r: true },
      { n: 'toDate', l: 'To Date', t: 'date', r: true },
      { n: 'totalHolidays', l: 'Total Holidays', t: 'float', ro: true },
      {
        s: 'Add Weekly Holidays', n: 'weeklyOff', l: 'Weekly Off', t: 'select',
        o: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      },
      { s: 'Add Weekly Holidays', n: 'isHalfDay', l: 'Is Half Day', t: 'bool', d: false },
      { s: 'Add Local Holidays', n: 'country', l: 'Country', t: 'data' },
      { s: 'Add Local Holidays', n: 'subdivision', l: 'Subdivision', t: 'data', when: 'country' },
      {
        s: 'Holidays', n: 'holidays', l: 'Holidays', t: 'table', rows: [
          { n: 'holidayDate', l: 'Date', t: 'date', r: true },
          { n: 'weeklyOff', l: 'Weekly Off', t: 'bool', d: false },
          { n: 'description', l: 'Description', t: 'longText', r: true },
          { n: 'isHalfDay', l: 'Is Half Day', t: 'bool', d: false }
        ]
      },
      { n: 'color', l: 'Color', t: 'data' }
    ]
  },
  // ── Shift and Attendance ──────────────────────────────────────────────
  'shift-type': {
    model: 'hrShift', doctype: 'Shift Type', workspace: 'shift-and-attendance', section: 'Setup',
    titleField: 'name', unique: ['name'], columns: ['name', 'startTime', 'endTime', 'enableAutoAttendance'],
    search: ['name'],
    fields: [
      { n: 'name', l: 'Name', t: 'data', r: true },
      { n: 'startTime', l: 'Start Time', t: 'time', r: true },
      { n: 'endTime', l: 'End Time', t: 'time', r: true },
      { n: 'holidayListId', l: 'Holiday List', t: 'link', o: 'holiday-list' },
      { n: 'rosterColor', l: 'Roster Color', t: 'select', d: 'Blue', o: ['Blue', 'Cyan', 'Fuchsia', 'Green', 'Lime', 'Orange', 'Pink', 'Red', 'Violet', 'Yellow'] },
      { n: 'enableAutoAttendance', l: 'Enable Auto Attendance', t: 'bool', d: false },
      { n: 'determineCheckInAndCheckOut', l: 'Determine Check-in and Check-out', t: 'select', d: 'Alternating entries as IN and OUT during the same shift', o: ['Alternating entries as IN and OUT during the same shift', 'Strictly based on Log Type in Employee Checkin'], when: 'enableAutoAttendance' },
      { n: 'workingHoursCalculationBasedOn', l: 'Working Hours Calculation Based On', t: 'select', d: 'First Check-in and Last Check-out', o: ['First Check-in and Last Check-out', 'Every Valid Check-in and Check-out'], when: 'enableAutoAttendance' },
      { n: 'firstCheckinThresholdMinutes', l: 'Begin check-in before shift start time (in minutes)', t: 'int', d: 60, min: 0, when: 'enableAutoAttendance' },
      { n: 'lastCheckoutThresholdMinutes', l: 'Allow check-out after shift end time (in minutes)', t: 'int', d: 60, min: 0, when: 'enableAutoAttendance' },
      { n: 'markAutoAttendanceOnHolidays', l: 'Mark Auto Attendance on Holidays', t: 'bool', d: false, when: 'enableAutoAttendance' },
      { n: 'workingHoursThresholdForHalfDay', l: 'Working Hours Threshold for Half Day', t: 'float', d: 0, when: 'enableAutoAttendance' },
      { n: 'workingHoursThresholdForAbsent', l: 'Working Hours Threshold for Absent', t: 'float', d: 0, when: 'enableAutoAttendance' },
      { n: 'processAttendanceAfter', l: 'Process Attendance After', t: 'date', when: 'enableAutoAttendance', reqWhen: { field: 'enableAutoAttendance', equals: true } },
      { n: 'lastSyncOfCheckin', l: 'Last Sync of Checkin', t: 'datetime', when: 'enableAutoAttendance' },
      { n: 'autoUpdateLastSync', l: 'Automatically update Last Sync of Checkin', t: 'bool', d: false, when: 'enableAutoAttendance' },
      { n: 'enableLateEntryMarking', l: 'Enable Late Entry Marking', t: 'bool', d: false },
      { n: 'graceMinutes', l: 'Late Entry Grace Period', t: 'int', d: 0, min: 0, when: 'enableLateEntryMarking' },
      { n: 'enableEarlyExitMarking', l: 'Enable Early Exit Marking', t: 'bool', d: false },
      { n: 'earlyExitGraceMinutes', l: 'Early Exit Grace Period', t: 'int', d: 0, min: 0, when: 'enableEarlyExitMarking' },
      { n: 'allowOvertime', l: 'Allow Overtime', t: 'bool', d: false },
      { n: 'overtimeTypeId', l: 'Overtime Type', t: 'link', o: 'overtime-type', when: 'allowOvertime', reqWhen: { field: 'allowOvertime', equals: true } },
      // Legacy Bisonstechs columns retained for roster/attendance engines.
      { n: 'breakMinutes', l: 'Break (minutes)', t: 'int', d: 60, min: 0, hidden: true },
      { n: 'workingDays', l: 'Repeat on Days', t: 'multiSelect', o: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], hidden: true },
      { n: 'isNight', l: 'Night Shift', t: 'bool', d: false, hidden: true },
      { n: 'isFlexible', l: 'Flexible', t: 'bool', d: false, hidden: true },
      { n: 'calculateOvertime', l: 'Calculate Overtime', t: 'bool', d: false, hidden: true },
      { n: 'overtimeAfterHours', l: 'Overtime After (hours)', t: 'float', d: 8, min: 0, hidden: true },
      { n: 'workingHours', l: 'Working Hours', t: 'float', d: 0, hidden: true },
      { n: 'status', l: 'Status', t: 'select', o: ['Active', 'Inactive'], d: 'Active', hidden: true }
    ],
    beforeWrite: 'validateShiftType'
  },
  'shift-location': {
    model: 'hrOffice', doctype: 'Shift Location (Branch)', workspace: 'shift-and-attendance', section: 'Setup',
    titleField: 'name', unique: ['name'], columns: ['name', 'address', 'isActive'],
    search: ['name', 'address'],
    fields: [
      { n: 'name', l: 'Location', t: 'data', r: true },
      { n: 'address', l: 'Address', t: 'longText' },
      { n: 'latitude', l: 'Latitude', t: 'float' },
      { n: 'longitude', l: 'Longitude', t: 'float' },
      { n: 'radiusMeters', l: 'Geofence Radius (m)', t: 'int', d: 150, min: 10 },
      { n: 'isActive', l: 'Active', t: 'bool', d: true }
    ]
  },
  'shift-assignment': {
    model: 'hrRoster', doctype: 'Shift Assignment', workspace: 'shift-and-attendance',
    statuses: ['Active', 'Inactive'],
    actions: [
      { key: 'deactivate', label: 'Deactivate', from: ['Active'], to: 'Inactive', action: 'edit' },
      { key: 'activate', label: 'Activate', from: ['Inactive'], to: 'Active', action: 'edit' }
    ],
    columns: ['employeeId', 'shiftId', 'workDate', 'status'], search: [], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      { n: 'shiftId', l: 'Shift Type', t: 'link', o: 'shift-type', r: true },
      { n: 'workDate', l: 'Assign to Date', t: 'date', r: true },
      { n: 'status', l: 'Status', t: 'select', o: ['Active', 'Inactive'], d: 'Active' }
    ],
    preventDuplicate: { fields: ['employeeId', 'workDate'], message: 'This employee already has a shift assigned for that date' }
  },
  'shift-request': {
    model: 'hrShiftRequest', doctype: 'Shift Request', workspace: 'shift-and-attendance',
    statuses: ['Draft', 'Approved', 'Rejected', 'Cancelled'],
    actions: [
      { key: 'approve', label: 'Approve', from: ['Draft'], to: 'Approved', action: 'approve' },
      { key: 'reject', label: 'Reject', from: ['Draft'], to: 'Rejected', action: 'approve' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Approved'], to: 'Cancelled', action: 'edit' }
    ],
    onApproved: 'assignShiftFromRequest',
    columns: ['employeeId', 'shiftId', 'fromDate', 'toDate', 'status'], search: [], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      { n: 'shiftId', l: 'Shift Type', t: 'link', o: 'shift-type', r: true },
      { n: 'fromDate', l: 'From Date', t: 'date', r: true },
      { n: 'toDate', l: 'To Date', t: 'date', r: true },
      { n: 'approverId', l: 'Approver', t: 'userLink' },
      { n: 'approverName', l: 'Approver Name', t: 'computed:approverName', ro: true },
      REASON
    ]
  },
  'attendance-request': {
    // Exact ERPNext Attendance Request fields from live hrms-rje-xre Doc.
    model: 'hrAttendanceCorrection', doctype: 'Attendance Request', workspace: 'shift-and-attendance',
    statuses: ['Open', 'Approved', 'Rejected', 'Cancelled'],
    actions: [
      { key: 'approve', label: 'Approve', from: ['Open'], to: 'Approved', action: 'approve' },
      { key: 'reject', label: 'Reject', from: ['Open'], to: 'Rejected', action: 'approve' },
      { key: 'cancel', label: 'Cancel', from: ['Open', 'Approved'], to: 'Cancelled', action: 'edit' }
    ],
    onApproved: 'applyAttendanceRequest',
    columns: ['employeeId', 'fromDate', 'toDate', 'reason', 'status'], search: ['reason', 'explanation'], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      COMPANY_FIELD,
      { n: 'fromDate', l: 'From Date', t: 'date', r: true },
      { n: 'toDate', l: 'To Date', t: 'date', r: true },
      { n: 'halfDay', l: 'Half Day', t: 'bool', d: false },
      {
        n: 'halfDayDate', l: 'Half Day Date', t: 'date',
        when: { field: 'halfDay', equals: true },
        reqWhen: { field: 'halfDay', equals: true }
      },
      {
        n: 'includeHolidays', l: 'Include Holidays', t: 'bool', d: false,
        hint: 'Select if any of the days selected for request are holidays'
      },
      {
        n: 'shiftId', l: 'Shift', t: 'link', o: 'shift-type',
        hint: 'Note: Shift will not be overwritten in existing attendance records'
      },
      {
        s: 'Reason', n: 'reason', l: 'Reason', t: 'select', r: true,
        o: ['Work From Home', 'On Duty'], d: 'Work From Home'
      },
      { n: 'explanation', l: 'Explanation', t: 'longText' },
      // Legacy columns kept for the pre-ERPNext NOT NULL constraints / approve hook.
      { n: 'action', l: 'Action', t: 'select', o: ['Make Attendance', 'Explain Absence'], d: 'Make Attendance', hidden: true },
      { n: 'attendanceStatus', l: 'Attendance Status', t: 'data', hidden: true },
      { n: 'requestType', l: 'Legacy Request Type', t: 'data', hidden: true },
      { n: 'workDate', l: 'Date (legacy)', t: 'date', hidden: true },
      { n: 'proposedIn', l: 'Proposed Check-in', t: 'data', hidden: true },
      { n: 'proposedOut', l: 'Proposed Check-out', t: 'data', hidden: true },
      { n: 'justifyAttendanceForLeaveDays', l: 'Justify attendance for leave days', t: 'bool', d: false, hidden: true },
      { n: 'explainHalfDayStatus', l: 'Explain half-day status', t: 'bool', d: false, hidden: true },
      { n: 'approverId', l: 'Approver', t: 'userLink', hidden: true }
    ],
    beforeWrite: 'normalizeAttendanceRequest'
  },
  attendance: {
    model: 'hrAttendance', doctype: 'Attendance', workspace: 'shift-and-attendance', section: 'Attendance',
    titleField: null, employeeScoped: true,
    statuses: ['Present', 'Absent', 'On Leave', 'Half Day', 'Work From Home'],
    columns: ['employeeId', 'workDate', 'status', 'shiftId', 'checkIn', 'checkOut'],
    search: [],
    fields: [
      EMPLOYEE,
      { n: 'workDate', l: 'Attendance Date', t: 'date', r: true },
      {
        n: 'status', l: 'Status', t: 'select', r: true, d: 'Present',
        o: ['Present', 'Absent', 'On Leave', 'Half Day', 'Work From Home']
      },
      { n: 'shiftId', l: 'Shift', t: 'link', o: 'shift-type' },
      { n: 'checkIn', l: 'In Time', t: 'datetime' },
      { n: 'checkOut', l: 'Out Time', t: 'datetime' },
      { n: 'workingMinutes', l: 'Working Hours (minutes)', t: 'int', d: 0, ro: true },
      { n: 'lateEntry', l: 'Late Entry', t: 'bool', d: false },
      { n: 'earlyExit', l: 'Early Exit', t: 'bool', d: false },
      { n: 'overtimeHours', l: 'Overtime Hours', t: 'float', d: 0 },
      { n: 'overtimeTypeId', l: 'Overtime Type', t: 'link', o: 'overtime-type' },
      { n: 'source', l: 'Attendance Source', t: 'select', d: 'manual', o: ['manual', 'geofence', 'mobile', 'attendance-tool', 'employee-checkin'] },
      { n: 'remarks', l: 'Remarks', t: 'longText' }
    ]
  },
  'employee-checkin': {
    model: 'hrEmployeeCheckin', doctype: 'Employee Checkin', workspace: 'shift-and-attendance',
    columns: ['employeeId', 'logType', 'logTime', 'source'], search: [], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'logTime', l: 'Time', t: 'datetime', r: true },
      { n: 'logType', l: 'Log Type', t: 'select', o: ['IN', 'OUT'], d: 'IN', r: true },
      { n: 'shiftId', l: 'Shift', t: 'link', o: 'shift-type' },
      { n: 'latitude', l: 'Latitude', t: 'float' },
      { n: 'longitude', l: 'Longitude', t: 'float' },
      { n: 'accuracy', l: 'Accuracy', t: 'float' },
      { n: 'deviceInfo', l: 'Device ID', t: 'data' },
      { n: 'source', l: 'Source', t: 'select', o: ['mobile', 'geofence', 'manual', 'attendance-tool'], d: 'manual' }
    ],
    onCreated: 'processAutoAttendance'
  },
  'overtime-type': {
    // Exact ERPNext Overtime Type (autoname Prompt + Basic / calculation / Pay Rate Multipliers).
    model: 'hrOvertimeType', doctype: 'Overtime Type', workspace: 'shift-and-attendance', section: 'Overtime',
    titleField: 'name', unique: ['name'],
    columns: ['name', 'maxHoursPerDay', 'salaryComponentId', 'overtimeCalculationMethod'],
    search: ['name'],
    fields: [
      // ERPNext Prompt name — shown as the document title field above sections.
      { n: 'name', l: 'Overtime Type', t: 'data', r: true },
      { s: 'Basic', n: 'maxHoursPerDay', l: 'Maximum Overtime Hours Allowed Per Day', t: 'float', d: 0, min: 0 },
      {
        n: 'salaryComponentId', l: 'Overtime Salary Component', t: 'link', o: 'salary-component', r: true,
        hint: 'Overtime earnings will be booked under this salary component for payout.'
      },
      {
        // Unlabeled Section Break in ERPNext (section_break_xxdv).
        s: '', n: 'overtimeCalculationMethod', l: 'Overtime Amount Calculation', t: 'select',
        d: 'Salary Component Based', o: ['Salary Component Based', 'Fixed Hourly Rate'],
        hint: 'Fixed Hourly Rate: a fixed, manually entered hourly rate. Salary Component Based: (sum of selected component amounts) ÷ (Payment Days) ÷ (Standard Daily Hours).'
      },
      {
        n: 'applicableSalaryComponents', l: 'Applicable Salary Components', t: 'table',
        when: { field: 'overtimeCalculationMethod', equals: 'Salary Component Based' },
        reqWhen: { field: 'overtimeCalculationMethod', equals: 'Salary Component Based' },
        hint: 'Select the salary components whose total will be used from the salary slip to calculate the hourly overtime rate.',
        rows: [{ n: 'salaryComponentId', l: 'Salary Component', t: 'link', o: 'salary-component', r: true }]
      },
      {
        n: 'hourlyRate', l: 'Hourly Rate', t: 'currency', d: 0,
        when: { field: 'overtimeCalculationMethod', equals: 'Fixed Hourly Rate' },
        reqWhen: { field: 'overtimeCalculationMethod', equals: 'Fixed Hourly Rate' }
      },
      { s: 'Pay Rate Multipliers', n: 'standardMultiplier', l: 'Standard Multiplier', t: 'float', d: 1, r: true },
      {
        n: 'applicableForPublicHoliday', l: 'Apply for Public Holiday', t: 'bool', d: false,
        hint: 'Enable this to use a specific multiplier for public holidays. If unchecked, the standard multiplier will be used instead.'
      },
      {
        n: 'publicHolidayMultiplier', l: 'Public Holiday Multiplier', t: 'float', d: 0,
        when: { field: 'applicableForPublicHoliday', equals: true },
        reqWhen: { field: 'applicableForPublicHoliday', equals: true }
      },
      {
        n: 'applicableForWeekend', l: 'Apply for Weekend', t: 'bool', d: false,
        hint: 'Enable this to use a specific multiplier for weekends. If unchecked, the standard multiplier will be used instead.'
      },
      {
        n: 'weekendMultiplier', l: 'Weekend Multiplier', t: 'float', d: 0,
        when: { field: 'applicableForWeekend', equals: true },
        reqWhen: { field: 'applicableForWeekend', equals: true }
      },
      // Legacy flags kept for older attendance engines — not on the ERPNext form.
      { n: 'includeHolidays', l: 'Enable Overtime based on Holiday', t: 'bool', d: false, hidden: true },
      { n: 'includeWeekOffDays', l: 'Enable Overtime based on Week Off', t: 'bool', d: false, hidden: true },
      { n: 'payRateMultipliers', l: 'Pay Rate Multipliers (legacy)', t: 'keyValue', hidden: true },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false, hidden: true }
    ]
  },
  'overtime-slip': {
    // Exact ERPNext Overtime Slip + Overtime Details child table.
    model: 'hrOvertime', doctype: 'Overtime Slip', workspace: 'shift-and-attendance', section: 'Overtime',
    statuses: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Paid', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
      { key: 'approve', label: 'Approve', from: ['Submitted'], to: 'Approved', action: 'approve' },
      { key: 'reject', label: 'Reject', from: ['Submitted'], to: 'Rejected', action: 'approve' },
      { key: 'pay', label: 'Mark Paid', from: ['Approved'], to: 'Paid', action: 'pay' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Submitted', 'Approved'], to: 'Cancelled', action: 'edit' }
    ],
    onApproved: 'applyOvertimeSlipToPayroll',
    columns: ['employeeId', 'postingDate', 'startDate', 'endDate', 'totalOvertimeDuration', 'status'],
    search: ['employeeName', 'reason'], employeeScoped: true,
    fields: [
      { n: 'postingDate', l: 'Posting Date', t: 'date', r: true, d: 'today' },
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      COMPANY_FIELD,
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      { n: 'startDate', l: 'Start Date', t: 'date', r: true },
      { n: 'endDate', l: 'End Date', t: 'date', r: true },
      { n: 'salarySlipId', l: 'Salary Slip', t: 'link', o: 'salary-slip', ro: true },
      { n: 'totalOvertimeDuration', l: 'Total Overtime Duration', t: 'float', d: 0, ro: true },
      { n: 'payrollEntryId', l: 'Payroll Entry', t: 'link', o: 'payroll-entry', ro: true, when: 'payrollEntryId' },
      { n: 'submittedViaPayrollEntry', l: 'Submitted via Payroll Entry', t: 'bool', d: false, hidden: true },
      {
        n: 'overtimeDetails', l: 'Overtime Details', t: 'table', r: true, rows: [
          { n: 'referenceDocument', l: 'Reference Document', t: 'link', o: 'attendance', ro: true },
          { n: 'date', l: 'Date', t: 'date', r: true },
          { n: 'overtimeTypeId', l: 'Overtime Type', t: 'link', o: 'overtime-type', r: true },
          { n: 'overtimeDuration', l: 'Overtime Duration', t: 'float', r: true, d: 0 },
          { n: 'standardWorkingHours', l: 'Standard Working Hours', t: 'float', r: true, d: 8 },
          {
            n: 'maximumOvertimeHoursAllowed', l: 'Maximum Overtime Hours Allowed', t: 'float', ro: true, d: 0,
            fetchFrom: 'overtimeTypeId.maxHoursPerDay'
          }
        ]
      },
      // Legacy single-day columns kept for payroll apply + older rows.
      { n: 'overtimeTypeId', l: 'Overtime Type', t: 'link', o: 'overtime-type', hidden: true },
      { n: 'workDate', l: 'For Period (date)', t: 'date', hidden: true },
      { n: 'hours', l: 'Hours', t: 'float', d: 0, hidden: true },
      { n: 'payRateMultiplier', l: 'Pay Rate Multiplier', t: 'float', d: 1, hidden: true },
      { n: 'rate', l: 'Rate', t: 'currency', d: 0, hidden: true },
      { n: 'amount', l: 'Amount', t: 'currency', d: 0, hidden: true },
      { n: 'reason', l: 'Reason', t: 'longText', hidden: true }
    ],
    beforeWrite: 'computeOvertimeAmount'
  },
  // ── Expenses ──────────────────────────────────────────────────────────
  'expense-claim-type': {
    model: 'hrExpenseClaimType', doctype: 'Expense Claim Type', workspace: 'expenses', section: 'Setup',
    titleField: 'name', unique: ['name'], columns: ['name', 'expenseAccount', 'requiresProof', 'disabled'],
    search: ['name'],
    fields: [
      { n: 'name', l: 'Expense Claim Type', t: 'data', r: true },
      { n: 'description', l: 'Description', t: 'longText' },
      { n: 'expenseAccount', l: 'Expense Account', t: 'account' },
      { n: 'requiresProof', l: 'Requires Proof (Attach Receipt)', t: 'bool', d: true },
      { n: 'isAdvance', l: 'Is Advance', t: 'bool', d: false },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false }
    ]
  },
  'expense-claim': {
    model: 'hrExpenseClaim', doctype: 'Expense Claim', workspace: 'expenses',
    statuses: ['Draft', 'Submitted', 'Approved', 'Unpaid', 'Partially Paid', 'Paid', 'Rejected', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
      { key: 'approve', label: 'Approve', from: ['Submitted', 'Draft'], to: 'Approved', action: 'approve' },
      { key: 'reject', label: 'Reject', from: ['Submitted'], to: 'Rejected', action: 'approve' },
      { key: 'pay', label: 'Mark Paid', from: ['Approved', 'Unpaid', 'Partially Paid'], to: 'Paid', action: 'pay' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Submitted', 'Approved', 'Unpaid'], to: 'Cancelled', action: 'edit' }
    ],
    onApproved: 'postExpenseClaimJournal',
    columns: ['employeeId', 'claimDate', 'totalClaimed', 'reimbursement', 'status'],
    search: ['reasonForRejection'], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'expenseApproverId', l: 'Expense Approver', t: 'userLink' },
      { n: 'claimDate', l: 'Claim Date', t: 'date', r: true },
      {
        n: 'expenses', l: 'Expenses', t: 'table', rows: [
          { n: 'expenseTypeId', l: 'Expense Claim Type', t: 'link', o: 'expense-claim-type', r: true },
          { n: 'expenseDate', l: 'Expense Date', t: 'date', r: true },
          { n: 'amount', l: 'Expense Amount', t: 'currency', r: true, d: 0 },
          { n: 'description', l: 'Description', t: 'data' },
          { n: 'receipt', l: 'Attach Receipt', t: 'data' }
        ]
      },
      {
        n: 'advances', l: 'Advance Payments', t: 'table', rows: [
          { n: 'advanceId', l: 'Employee Advance', t: 'link', o: 'employee-advance', r: true },
          { n: 'allocatedAmount', l: 'Adjusted Amount', t: 'currency', d: 0 }
        ]
      },
      { n: 'totalClaimed', l: 'Total Claimed Amount', t: 'currency', d: 0, readOnly: true },
      { n: 'approvedAmount', l: 'Approved Amount', t: 'currency', d: 0 },
      { n: 'sanctionedAmount', l: 'Sanctioned Amount', t: 'currency', d: 0, readOnly: true },
      { n: 'totalAdvance', l: 'Advance Outstanding', t: 'currency', d: 0, readOnly: true },
      { n: 'reimbursement', l: 'Amount Reimbursed', t: 'currency', d: 0, readOnly: true },
      { n: 'currency', l: 'Currency', t: 'currencyCode' },
      { n: 'expenseAccount', l: 'Expense Account', t: 'account' },
      { n: 'payableAccount', l: 'Payable Account', t: 'account' },
      { n: 'costCenter', l: 'Cost Center', t: 'costCenter' },
      { n: 'reasonForRejection', l: 'Reason for Rejection', t: 'longText' }
    ],
    beforeWrite: 'computeExpenseClaimTotals'
  },
  'employee-advance': {
    model: 'hrLoan', doctype: 'Employee Advance', workspace: 'expenses',
    statuses: ['Draft', 'Submitted', 'Paid', 'Partially Paid', 'Unpaid', 'Claimed', 'Returned', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
      { key: 'approve', label: 'Approve', from: ['Draft', 'Submitted'], to: 'Paid', action: 'approve' },
      { key: 'return', label: 'Return Advance', from: ['Paid', 'Unpaid'], to: 'Returned', action: 'approve' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Submitted'], to: 'Cancelled', action: 'edit' }
    ],
    columns: ['employeeId', 'amount', 'paidAmount', 'claimedAmount', 'status'],
    search: ['reason'], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'kind', l: 'Type', t: 'data', d: 'advance', hidden: true },
      { n: 'amount', l: 'Advance Amount', t: 'currency', r: true, min: 0 },
      { n: 'advanceAccountId', l: 'Advance Account', t: 'account' },
      { n: 'expenseAccount', l: 'Booking Account', t: 'account' },
      { n: 'repaymentMethod', l: 'Repayment Method', t: 'select', o: ['Salary Deduction', 'Return'], d: 'Salary Deduction' },
      { n: 'offsetAgainstSalary', l: 'Offset against Salary Component', t: 'bool', d: true },
      { n: 'paidAmount', l: 'Total Advance Paid', t: 'currency', d: 0, readOnly: true },
      { n: 'claimedAmount', l: 'Total Advance Claimed', t: 'currency', d: 0, readOnly: true },
      { n: 'returnedAmount', l: 'Total Advance Returned', t: 'currency', d: 0, readOnly: true },
      REASON
    ]
  },
  // ── Tenure ────────────────────────────────────────────────────────────
  'employee-onboarding': {
    model: 'hrEmployeeOnboarding', doctype: 'Employee Onboarding', workspace: 'tenure',
    statuses: ['Draft', 'Pending', 'In Process', 'Completed', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Pending', action: 'edit' },
      { key: 'start', label: 'Start', from: ['Pending'], to: 'In Process', action: 'edit' },
      { key: 'complete', label: 'Complete', from: ['In Process', 'Pending'], to: 'Completed', action: 'approve' }
    ],
    onSubmitted: 'createEmployeeFromOnboarding',
    columns: ['firstName', 'lastName', 'department', 'dateOfJoining', 'boardingStatus', 'status'],
    search: ['firstName', 'lastName', 'email'],
    fields: [
      { n: 'firstName', l: 'First Name', t: 'data', r: true },
      { n: 'lastName', l: 'Last Name', t: 'data' },
      { n: 'email', l: 'Email', t: 'data' },
      { n: 'jobOfferId', l: 'Job Offer', t: 'link', o: 'job-offer' },
      { n: 'dateOfJoining', l: 'Date of Joining', t: 'date', r: true },
      { n: 'offerDate', l: 'Offer Date', t: 'date' },
      { n: 'department', l: 'Department', t: 'link', o: 'department' },
      { n: 'designation', l: 'Designation', t: 'link', o: 'designation' },
      { n: 'grade', l: 'Employee Grade', t: 'link', o: 'employee-grade' },
      { n: 'employmentType', l: 'Employment Type', t: 'link', o: 'employment-type' },
      {
        n: 'activities', l: 'Onboarding Activities', t: 'table', rows: [
          { n: 'activity', l: 'Activity Name', t: 'data', r: true },
          { n: 'requiredForApproving', l: 'Required for Approval', t: 'bool', d: false },
          { n: 'role', l: 'Role', t: 'data' },
          { n: 'ownerId', l: 'Owner', t: 'userLink' },
          { n: 'taskTimeoutHours', l: 'Duration (hours)', t: 'int', d: 4 },
          { n: 'completed', l: 'Completed', t: 'bool', d: false }
        ]
      },
      { n: 'employeeId', l: 'Created Employee', t: 'employee', ro: true }
    ]
  },
  'employee-separation': {
    model: 'hrEmployeeSeparation', doctype: 'Employee Separation', workspace: 'tenure',
    statuses: ['Draft', 'Pending', 'In Process', 'Completed', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Pending', action: 'edit' },
      { key: 'start', label: 'Start', from: ['Pending'], to: 'In Process', action: 'edit' },
      { key: 'complete', label: 'Complete', from: ['In Process', 'Pending'], to: 'Completed', action: 'approve' }
    ],
    onCompleted: 'markEmployeeSeparated',
    columns: ['employeeId', 'separationDate', 'boardingStatus', 'status'], search: [], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      { n: 'designation', l: 'Designation', t: 'computed:designation', ro: true },
      { n: 'separationDate', l: 'Separation Date', t: 'date', r: true },
      REASON,
      {
        n: 'activities', l: 'Separation Activities', t: 'table', rows: [
          { n: 'activity', l: 'Activity Name', t: 'data', r: true },
          { n: 'role', l: 'Role', t: 'data' },
          { n: 'ownerId', l: 'Owner', t: 'userLink' },
          { n: 'completed', l: 'Completed', t: 'bool', d: false }
        ]
      }
    ]
  },
  'grievance-type': {
    model: 'hrGrievanceType', doctype: 'Grievance Type', workspace: 'tenure', section: 'Setup',
    titleField: 'name', unique: ['name'], columns: ['name', 'documentType', 'disabled'], search: ['name'],
    fields: [
      { n: 'name', l: 'Grievance Based On Document Type', t: 'data', r: true },
      { n: 'documentType', l: 'Related Document Type', t: 'data' },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false }
    ]
  },
  'employee-grievance': {
    model: 'hrEmployeeGrievance', doctype: 'Employee Grievance', workspace: 'tenure',
    statuses: ['Open', 'Investigated', 'Resolved', 'Invalid', 'Cancelled'],
    actions: [
      { key: 'investigate', label: 'Mark Investigated', from: ['Open'], to: 'Investigated', action: 'approve' },
      { key: 'resolve', label: 'Resolve', from: ['Open', 'Investigated'], to: 'Resolved', action: 'approve' },
      { key: 'invalid', label: 'Mark Invalid', from: ['Open', 'Investigated'], to: 'Invalid', action: 'approve' },
      { key: 'cancel', label: 'Cancel', from: ['Open', 'Investigated'], to: 'Cancelled', action: 'edit' }
    ],
    columns: ['subject', 'grievanceType', 'fillingDate', 'status'], search: ['subject', 'description'],
    fields: [
      { n: 'subject', l: 'Subject', t: 'data', r: true },
      { n: 'grievanceType', l: 'Grievance Based On Document Type', t: 'link', o: 'grievance-type' },
      { n: 'raisedByEmployeeId', l: 'Raised By', t: 'employee' },
      { n: 'employeeAgainstId', l: 'Grievance Against Employee', t: 'employee' },
      { n: 'reportedTo', l: 'Reports To', t: 'employee' },
      { n: 'fillingDate', l: 'Filing Date', t: 'date', r: true },
      { n: 'date', l: 'Date', t: 'date' },
      { n: 'description', l: 'Description', t: 'longText' },
      { n: 'resolvedBy', l: 'Resolved By', t: 'data' },
      { n: 'resolutionDate', l: 'Resolution Date', t: 'date' },
      { n: 'resolutionDetails', l: 'Resolution Details', t: 'longText' }
    ]
  },
  'employee-transfer': {
    model: 'hrEmployeeTransfer', doctype: 'Employee Transfer', workspace: 'tenure',
    statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    onSubmitted: 'applyEmployeeTransfer',
    columns: ['employeeId', 'transferDate', 'toDepartment', 'toDesignation', 'status'], search: ['reason'], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'transferDate', l: 'Transfer Date', t: 'date', r: true },
      { n: 'fromDepartment', l: 'Department', t: 'computed:department', ro: true },
      { n: 'toDepartment', l: 'New Department', t: 'link', o: 'department' },
      { n: 'fromDesignation', l: 'Designation', t: 'computed:designation', ro: true },
      { n: 'toDesignation', l: 'New Designation', t: 'link', o: 'designation' },
      { n: 'fromBranch', l: 'Branch', t: 'computed:office', ro: true },
      { n: 'toBranch', l: 'New Branch', t: 'link', o: 'office' },
      { n: 'newEmployeeId', l: 'New Employee ID', t: 'data' },
      REASON,
      { n: 'remark', l: 'Remark', t: 'longText' }
    ]
  },
  'employee-promotion': {
    model: 'hrEmployeePromotion', doctype: 'Employee Promotion', workspace: 'tenure',
    statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    onSubmitted: 'applyEmployeePromotion',
    columns: ['employeeId', 'promotionDate', 'toDesignation', 'ctc', 'status'], search: ['reason'], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'promotionDate', l: 'Promotion Date', t: 'date', r: true },
      { n: 'promotionFor', l: 'Promotion For', t: 'data' },
      { n: 'promotionBy', l: 'Promoted By', t: 'data' },
      { n: 'fromDepartment', l: 'Department', t: 'computed:department', ro: true },
      { n: 'toDepartment', l: 'New Department', t: 'link', o: 'department' },
      { n: 'fromDesignation', l: 'Designation', t: 'computed:designation', ro: true },
      { n: 'toDesignation', l: 'New Designation', t: 'link', o: 'designation' },
      { n: 'fromGrade', l: 'Grade', t: 'computed:grade', ro: true },
      { n: 'toGrade', l: 'New Grade', t: 'link', o: 'employee-grade' },
      { n: 'ctc', l: 'Current CTC', t: 'currency', d: 0 },
      { n: 'salaryStructureId', l: 'Applicable Salary Structure', t: 'link', o: 'salary-structure' },
      { n: 'voucherNumber', l: 'Voucher No', t: 'data' },
      REASON
    ]
  },
  'employee-skill-map': {
    model: 'hrEmployeeSkillMap', doctype: 'Employee Skill Map', workspace: 'tenure', section: 'Setup',
    columns: ['employeeId'], search: [], employeeScoped: true,
    fields: [
      { n: 'employeeId', l: 'Employee', t: 'employee', r: true },
      {
        n: 'skills', l: 'Employee Skills', t: 'table', rows: [
          { n: 'group', l: 'Skill Group', t: 'data' },
          { n: 'skill', l: 'Skill', t: 'data', r: true },
          { n: 'evaluationScale', l: 'Evaluation Scale', t: 'data' },
          { n: 'proficiency', l: 'Proficiency', t: 'int', d: 0 }
        ]
      },
      {
        n: 'trainings', l: 'Trainings', t: 'table', rows: [
          { n: 'program', l: 'Training Program', t: 'link', o: 'training-program' },
          { n: 'event', l: 'Training Event', t: 'data' },
          { n: 'date', l: 'Date Attended', t: 'date' },
          { n: 'hours', l: 'Hours', t: 'float', d: 0 }
        ]
      }
    ]
  },
  'training-program': {
    model: 'hrTrainingProgram', doctype: 'Training Program', workspace: 'tenure', section: 'Setup',
    titleField: 'name', unique: ['name'], columns: ['name', 'trainerName', 'disabled'], search: ['name'],
    fields: [
      { n: 'name', l: 'Program Name', t: 'data', r: true },
      { n: 'trainerName', l: 'Trainer Name', t: 'data' },
      { n: 'trainerEmail', l: 'Trainer Email', t: 'data' },
      { n: 'description', l: 'Training Method', t: 'longText' },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false }
    ]
  },
  'training-event': {
    model: 'hrTrainingEvent', doctype: 'Training Event', workspace: 'tenure', section: 'Setup',
    titleField: 'eventName', unique: ['eventName'], statuses: ['Draft', 'Open', 'Completed', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Open', action: 'edit' },
      { key: 'complete', label: 'Complete', from: ['Open'], to: 'Completed', action: 'approve' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Open'], to: 'Cancelled', action: 'edit' }
    ],
    columns: ['eventName', 'trainingProgramId', 'startTime', 'status'], search: ['eventName', 'location'],
    fields: [
      { n: 'eventName', l: 'Event Name', t: 'data', r: true },
      { n: 'trainingProgramId', l: 'Training Program', t: 'link', o: 'training-program' },
      { n: 'startTime', l: 'Start Time', t: 'datetime', r: true },
      { n: 'endTime', l: 'End Time', t: 'datetime' },
      { n: 'location', l: 'Location', t: 'data' },
      { n: 'trainerName', l: 'Trainer Name', t: 'data' },
      { n: 'courseFee', l: 'Course Fee', t: 'currency', d: 0 },
      { n: 'description', l: 'Notes', t: 'longText' },
      {
        n: 'employees', l: 'Employees', t: 'table', rows: [
          { n: 'employeeId', l: 'Employee', t: 'employee', r: true },
          { n: 'level', l: 'Level', t: 'data' },
          { n: 'status', l: 'Status', t: 'select', o: ['Open', 'Attend', 'Not Attend'], d: 'Open' },
          { n: 'hours', l: 'Hours', t: 'float', d: 0 }
        ]
      }
    ]
  },
  // ── Recruitment ───────────────────────────────────────────────────────
  'job-opening': {
    model: 'hrJobOpening', doctype: 'Job Opening', workspace: 'recruitment',
    statuses: ['Open', 'Closed'],
    actions: [
      { key: 'close', label: 'Close', from: ['Open'], to: 'Closed', action: 'edit' },
      { key: 'reopen', label: 'Reopen', from: ['Closed'], to: 'Open', action: 'edit' }
    ],
    columns: ['title', 'department', 'designation', 'openings', 'applied', 'status'],
    search: ['title', 'description'],
    fields: [
      { n: 'title', l: 'Job Title', t: 'data', r: true },
      { n: 'departmentId', l: 'Department', t: 'link', o: 'department' },
      { n: 'department', l: 'Department Name', t: 'computed:department', ro: true },
      { n: 'designationId', l: 'Designation', t: 'link', o: 'designation' },
      { n: 'designation', l: 'Designation Name', t: 'computed:designation', ro: true },
      { n: 'employmentType', l: 'Employment Type', t: 'link', o: 'employment-type' },
      { n: 'location', l: 'Location', t: 'link', o: 'office' },
      { n: 'openings', l: 'No of Positions', t: 'int', d: 1, min: 1 },
      { n: 'startDate', l: 'Latest Post Date', t: 'date' },
      { n: 'lowerGrade', l: 'Lower Grade', t: 'link', o: 'employee-grade' },
      { n: 'upperGrade', l: 'Upper Grade', t: 'link', o: 'employee-grade' },
      { n: 'published', l: 'Published', t: 'bool', d: false },
      { n: 'hiringManager', l: 'Hiring Manager', t: 'data' },
      { n: 'description', l: 'Description', t: 'longText' },
      { n: 'instructions', l: 'Instructions', t: 'longText' }
    ]
  },
  'job-applicant': {
    model: 'hrJobApplicant', doctype: 'Job Applicant', workspace: 'recruitment',
    titleField: 'applicantName',
    statuses: ['Open', 'Replied', 'Shortlisted', 'Rejected', 'Hold', 'Accepted'],
    actions: [
      { key: 'shortlist', label: 'Shortlist', from: ['Open', 'Replied'], to: 'Shortlisted', action: 'edit' },
      { key: 'hold', label: 'Keep On Hold', from: ['Open', 'Shortlisted'], to: 'Hold', action: 'edit' },
      { key: 'accept', label: 'Accept', from: ['Open', 'Shortlisted', 'Replied'], to: 'Accepted', action: 'approve' },
      { key: 'reject', label: 'Reject', from: ['Open', 'Shortlisted', 'Replied', 'Hold'], to: 'Rejected', action: 'approve' }
    ],
    kanban: { field: 'status', order: ['Open', 'Replied', 'Shortlisted', 'Hold', 'Accepted', 'Rejected'] },
    columns: ['applicantName', 'emailId', 'jobTitle', 'status'],
    search: ['applicantName', 'emailId', 'phoneNo'],
    fields: [
      { n: 'applicantName', l: 'Applicant Name', t: 'data', r: true },
      { n: 'emailId', l: 'Email', t: 'data' },
      { n: 'phoneNo', l: 'Phone', t: 'data' },
      { n: 'jobOpeningId', l: 'Job Opening', t: 'link', o: 'job-opening' },
      { n: 'jobTitle', l: 'Job Title', t: 'computed:jobTitle', ro: true },
      { n: 'designation', l: 'Designation', t: 'link', o: 'designation' },
      { n: 'source', l: 'Source', t: 'data' },
      { n: 'country', l: 'Country', t: 'data' },
      { n: 'city', l: 'City', t: 'data' },
      { n: 'rating', l: 'Rating', t: 'float', d: 0 },
      { n: 'referredBy', l: 'Referred By', t: 'data' },
      { n: 'resumeUrl', l: 'Resume Attachment', t: 'data' },
      { n: 'note', l: 'Note', t: 'longText' }
    ]
  },
  'interview-type': {
    model: 'hrInterviewType', doctype: 'Interview Type', workspace: 'recruitment', section: 'Setup',
    titleField: 'name', unique: ['name'], columns: ['name', 'disabled'], search: ['name'],
    fields: [
      { n: 'name', l: 'Interview Type', t: 'data', r: true },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false }
    ]
  },
  interview: {
    model: 'hrInterview', doctype: 'Interview', workspace: 'recruitment',
    statuses: ['Pending', 'Under Review', 'Cleared', 'Rejected', 'Cancelled'],
    actions: [
      { key: 'review', label: 'Start Review', from: ['Pending'], to: 'Under Review', action: 'edit' },
      { key: 'clear', label: 'Mark Cleared', from: ['Pending', 'Under Review'], to: 'Cleared', action: 'approve' },
      { key: 'reject', label: 'Mark Rejected', from: ['Pending', 'Under Review'], to: 'Rejected', action: 'approve' },
      { key: 'cancel', label: 'Cancel', from: ['Pending', 'Under Review'], to: 'Cancelled', action: 'edit' }
    ],
    columns: ['jobApplicantId', 'scheduledOn', 'interviewType', 'averageRating', 'status'],
    search: ['summary'], employeeScoped: false,
    fields: [
      { n: 'jobApplicantId', l: 'Job Applicant', t: 'link', o: 'job-applicant', r: true },
      { n: 'jobOpeningId', l: 'Job Opening', t: 'link', o: 'job-opening' },
      { n: 'designation', l: 'Job Title', t: 'computed:jobTitle', ro: true },
      { n: 'scheduledOn', l: 'Scheduled On', t: 'date', r: true },
      { n: 'fromTime', l: 'From Time', t: 'datetime' },
      { n: 'toTime', l: 'To Time', t: 'datetime' },
      { n: 'interviewType', l: 'Interview Type', t: 'link', o: 'interview-type' },
      {
        n: 'interviewers', l: 'Interviewers', t: 'table', rows: [
          { n: 'interviewer', l: 'Interviewer', t: 'employee' },
          { n: 'skill', l: 'Skill', t: 'data' }
        ]
      },
      { n: 'result', l: 'Result', t: 'data', ro: true },
      { n: 'averageRating', l: 'Average Rating', t: 'float', d: 0, ro: true },
      { n: 'summary', l: 'Summary', t: 'longText' }
    ]
  },
  'job-offer': {
    model: 'hrJobOffer', doctype: 'Job Offer', workspace: 'recruitment',
    statuses: ['Draft', 'Ready to Send', 'Awaiting Response', 'Accepted', 'Rejected', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Ready to Send', action: 'edit' },
      { key: 'send', label: 'Send to Applicant', from: ['Ready to Send'], to: 'Awaiting Response', action: 'edit' },
      { key: 'accept', label: 'Accept', from: ['Awaiting Response', 'Ready to Send'], to: 'Accepted', action: 'approve' },
      { key: 'reject', label: 'Reject', from: ['Awaiting Response'], to: 'Rejected', action: 'approve' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Ready to Send', 'Awaiting Response'], to: 'Cancelled', action: 'edit' }
    ],
    onAccepted: 'createOnboardingFromJobOffer',
    columns: ['jobApplicantId', 'designation', 'offerDate', 'ctc', 'status'], search: [],
    fields: [
      { n: 'jobApplicantId', l: 'Job Applicant', t: 'link', o: 'job-applicant', r: true },
      { n: 'offerDate', l: 'Offer Date', t: 'date', r: true },
      { n: 'expectedJoiningDate', l: 'Expected Joining Date', t: 'date' },
      { n: 'designation', l: 'Designation', t: 'link', o: 'designation' },
      { n: 'department', l: 'Department', t: 'link', o: 'department' },
      { n: 'grade', l: 'Grade', t: 'link', o: 'employee-grade' },
      { n: 'employmentType', l: 'Employment Type', t: 'link', o: 'employment-type' },
      { n: 'branch', l: 'Branch', t: 'link', o: 'office' },
      { n: 'reportsTo', l: 'Reports To', t: 'employee' },
      { n: 'salaryStructureId', l: 'Salary Structure', t: 'link', o: 'salary-structure' },
      { n: 'ctc', l: 'Cost to Company (CTC)', t: 'currency', d: 0 },
      {
        n: 'components', l: 'CTC Break-up', t: 'table', rows: [
          { n: 'salaryComponentId', l: 'Salary Component', t: 'link', o: 'salary-component', r: true },
          { n: 'yearlyAmount', l: 'Yearly Amount', t: 'currency', d: 0 }
        ]
      },
      {
        n: 'terms', l: 'Additional Terms', t: 'table', rows: [
          { n: 'term', l: 'Offer Term', t: 'data', r: true },
          { n: 'value', l: 'Value', t: 'data' }
        ]
      },
      { n: 'offerTerms', l: 'Note', t: 'longText' }
    ]
  },
  'job-requisition': {
    model: 'hrJobRequisition', doctype: 'Job Requisition', workspace: 'recruitment', section: 'Planning',
    statuses: ['Pending', 'Open & Approved', 'Rejected', 'On Hold', 'Filled', 'Cancelled'],
    actions: [
      { key: 'approve', label: 'Approve', from: ['Pending'], to: 'Open & Approved', action: 'approve' },
      { key: 'reject', label: 'Reject', from: ['Pending'], to: 'Rejected', action: 'approve' },
      { key: 'hold', label: 'On Hold', from: ['Pending'], to: 'On Hold', action: 'edit' },
      { key: 'create-opening', label: 'Create Job Opening', from: ['Open & Approved'], to: 'Filled', action: 'edit' }
    ],
    onApproved: 'createFromJobRequisition',
    columns: ['subject', 'department', 'designation', 'noOfPositions', 'status'],
    search: ['subject', 'description'],
    fields: [
      { n: 'subject', l: 'Job Title', t: 'data', r: true },
      { n: 'department', l: 'Department', t: 'link', o: 'department' },
      { n: 'designation', l: 'Designation', t: 'link', o: 'designation' },
      { n: 'employmentType', l: 'Employment Type', t: 'link', o: 'employment-type' },
      { n: 'noOfPositions', l: 'No of Positions', t: 'int', d: 1, min: 1 },
      { n: 'expectedBy', l: 'Expected By', t: 'date' },
      { n: 'requestedBy', l: 'Requested By', t: 'data' },
      { n: 'requestedById', l: 'Requested By (Employee)', t: 'employee' },
      { n: 'description', l: 'Description', t: 'longText' },
      { n: 'jobDescription', l: 'Job Description', t: 'longText' },
      REASON,
      { n: 'approvedBy', l: 'Approved By', t: 'data', ro: true }
    ]
  },
  // ── Performance ───────────────────────────────────────────────────────
  kra: {
    model: 'hrKra', doctype: 'KRA', workspace: 'performance', section: 'Setup',
    titleField: 'name', unique: ['name'], columns: ['name', 'type', 'unit', 'isActive'], search: ['name'],
    fields: [
      { n: 'name', l: 'Title', t: 'data', r: true },
      { n: 'type', l: 'Type', t: 'select', o: ['Goal', 'Parameter'], d: 'Goal' },
      { n: 'unit', l: 'Unit', t: 'data' },
      { n: 'isActive', l: 'Active', t: 'bool', d: true }
    ]
  },
  'appraisal-template': {
    model: 'hrAppraisalTemplate', doctype: 'Appraisal Template', workspace: 'performance', section: 'Setup',
    titleField: 'name', unique: ['name'], columns: ['name', 'appraisalCriteria', 'disabled'], search: ['name'],
    fields: [
      { n: 'name', l: 'Appraisal Template', t: 'data', r: true },
      { n: 'appraisalCriteria', l: 'Criteria based on', t: 'select', o: ['KRA-based', 'Goal-based'], d: 'KRA-based' },
      { n: 'description', l: 'Description', t: 'longText' },
      {
        n: 'goals', l: 'Goals', t: 'table', rows: [
          { n: 'kraId', l: 'KRA / Goal', t: 'link', o: 'kra', r: true },
          { n: 'perWeightage', l: 'Weightage (%)', t: 'float', d: 0, min: 0 }
        ]
      },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false }
    ]
  },
  'appraisal-cycle': {
    model: 'hrAppraisalCycle', doctype: 'Appraisal Cycle', workspace: 'performance',
    statuses: ['Not Started', 'In Progress', 'Completed'],
    actions: [
      { key: 'start', label: 'Create Appraisals', from: ['Not Started'], to: 'In Progress', action: 'edit' },
      { key: 'complete', label: 'Close Cycle', from: ['In Progress'], to: 'Completed', action: 'edit' }
    ],
    onStarted: 'createAppraisalsFromCycle',
    columns: ['name', 'startDate', 'endDate', 'status'], search: ['name'],
    fields: [
      { n: 'name', l: 'Cycle Name', t: 'data', r: true },
      { n: 'startDate', l: 'Start Date', t: 'date', r: true },
      { n: 'endDate', l: 'End Date', t: 'date', r: true },
      { n: 'appraisalTemplateId', l: 'Appraisal Template', t: 'link', o: 'appraisal-template' },
      { n: 'ratingMethod', l: 'Ratings Method', t: 'select', o: ['Rating Percentage', 'Out of 5', 'Out of 10', 'On the Scale'], d: 'Out of 5' },
      { n: 'kraBasedOn', l: 'KRA Based On', t: 'select', o: ['Appraisal Template', 'Goal Management'], d: 'Appraisal Template' },
      { n: 'department', l: 'Department', t: 'link', o: 'department' },
      { n: 'designation', l: 'Designation', t: 'link', o: 'designation' },
      { n: 'branch', l: 'Branch', t: 'link', o: 'office' },
      { n: 'createAppraisalsForAll', l: 'Create Appraisals for all employees', t: 'bool', d: false },
      { n: 'perDayGoalsAllocation', l: 'Allocate Goals for appraisal date only', t: 'bool', d: true },
      { n: 'feedbackReminderDays', l: 'Feedback Reminder (days before)', t: 'int', d: 0, min: 0 },
      {
        n: 'appraisees', l: 'Appraisees', t: 'table', rows: [
          { n: 'employeeId', l: 'Employee', t: 'employee', r: true },
          { n: 'appraiser', l: 'Appraiser', t: 'employee' },
          { n: 'appraisalDate', l: 'Appraisal Date', t: 'date' },
          { n: 'hold', l: 'On Hold', t: 'bool', d: false }
        ]
      }
    ]
  },
  appraisal: {
    model: 'hrPerformanceReview', doctype: 'Appraisal', workspace: 'performance',
    statuses: ['Draft', 'Self Evaluation', 'Feedback Pending', 'Completed', 'Cancelled'],
    actions: [
      { key: 'self-evaluate', label: 'Self Evaluation', from: ['Draft'], to: 'Self Evaluation', action: 'edit' },
      { key: 'complete', label: 'Complete', from: ['Self Evaluation', 'Draft'], to: 'Completed', action: 'approve' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Self Evaluation'], to: 'Cancelled', action: 'edit' }
    ],
    columns: ['employeeId', 'period', 'averageRating', 'status'], search: ['goals'], employeeScoped: true,
    fields: [
      EMPLOYEE,
      { n: 'appraisalCycleId', l: 'Appraisal Cycle', t: 'link', o: 'appraisal-cycle' },
      { n: 'appraisalTemplateId', l: 'Appraisal Template', t: 'link', o: 'appraisal-template' },
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      { n: 'designation', l: 'Designation', t: 'computed:designation', ro: true },
      { n: 'period', l: 'Start / End', t: 'data', r: true },
      {
        n: 'kraAssessments', l: 'KRA vs Goals', t: 'table', rows: [
          { n: 'kra', l: 'KRA / Goal', t: 'data', r: true },
          { n: 'goal', l: 'Goal', t: 'data' },
          { n: 'perWeightage', l: '% Weightage', t: 'float', d: 0 },
          { n: 'score', l: 'Score', t: 'float', d: 0 },
          { n: 'rating', l: 'Rating', t: 'float', d: 0 }
        ]
      },
      {
        n: 'selfRatings', l: 'Self Ratings', t: 'table', rows: [
          { n: 'kra', l: 'KRA / Goal', t: 'data', r: true },
          { n: 'rating', l: 'Rating', t: 'float', d: 0 },
          { n: 'comments', l: 'Comments', t: 'data' }
        ]
      },
      { n: 'totalScore', l: 'Total Score', t: 'float', d: 0, ro: true },
      { n: 'maxScore', l: 'Max Total Score', t: 'float', d: 0, ro: true },
      { n: 'averageRating', l: 'Average Rating', t: 'float', d: 0, ro: true },
      { n: 'goals', l: 'Employee Comments', t: 'longText' },
      { n: 'remarks', l: 'Remarks', t: 'longText' },
      { n: 'recommendPromotion', l: 'Recommend for this Income Promotion', t: 'bool', d: false }
    ]
  },
  goal: {
    model: 'hrGoal', doctype: 'Goal', workspace: 'performance',
    statuses: ['Pending', 'In Progress', 'Completed', 'Archived', 'Closed'],
    actions: [
      { key: 'start', label: 'Start', from: ['Pending'], to: 'In Progress', action: 'edit' },
      { key: 'complete', label: 'Complete', from: ['In Progress', 'Pending'], to: 'Completed', action: 'edit' },
      { key: 'archive', label: 'Archive', from: ['Completed', 'In Progress'], to: 'Archived', action: 'edit' }
    ],
    columns: ['title', 'employeeId', 'weight', 'progress', 'status'], search: ['title', 'kpi'], employeeScoped: true,
    fields: [
      { n: 'title', l: 'Goal', t: 'data', r: true },
      { n: 'employeeId', l: 'Employee', t: 'employee' },
      { n: 'department', l: 'Department', t: 'data' },
      { n: 'designation', l: 'Designation', t: 'data' },
      { n: 'parentGoalId', l: 'Parent Goal', t: 'link', o: 'goal' },
      { n: 'kraId', l: 'KRA', t: 'link', o: 'kra' },
      { n: 'appraisalCycleId', l: 'Appraisal Cycle', t: 'link', o: 'appraisal-cycle' },
      { n: 'startDate', l: 'Start Date', t: 'date' },
      { n: 'endDate', l: 'End Date', t: 'date' },
      { n: 'weight', l: 'Weightage', t: 'float', d: 0, min: 0 },
      { n: 'kpi', l: 'Key Result Area / KPI', t: 'data' },
      { n: 'target', l: 'Target', t: 'data' },
      { n: 'progress', l: '% Progress Complete', t: 'float', d: 0, min: 0, max: 100 },
      { n: 'description', l: 'Description', t: 'longText' }
    ]
  },
  'performance-feedback': {
    model: 'hrFeedback', doctype: 'Employee Performance Feedback', workspace: 'performance',
    statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    columns: ['employeeId', 'reviewerName', 'score', 'cycle'], search: ['comments'], employeeScoped: true,
    fields: [
      { n: 'employeeId', l: 'For Employee', t: 'employee', r: true },
      { n: 'appraisalId', l: 'Appraisal', t: 'link', o: 'appraisal' },
      { n: 'appraisalCycleId', l: 'Appraisal Cycle', t: 'link', o: 'appraisal-cycle' },
      { n: 'reviewerEmployeeId', l: 'Reviewer', t: 'employee' },
      { n: 'reviewerName', l: 'Reviewer Name', t: 'computed:reviewer', ro: true },
      { n: 'relation', l: 'Relation', t: 'select', o: ['manager', 'peer', 'self', 'subordinate'], d: 'manager' },
      {
        n: 'ratings', l: 'Feedback Ratings', t: 'table', rows: [
          { n: 'criteria', l: 'Criteria', t: 'data', r: true },
          { n: 'rating', l: 'Rating', t: 'float', d: 0 },
          { n: 'weight', l: 'Weightage', t: 'float', d: 0 }
        ]
      },
      { n: 'score', l: 'Total Score', t: 'float', d: 0 },
      { n: 'comments', l: 'Overall Comments', t: 'longText' },
      { n: 'cycle', l: 'Cycle Label', t: 'data' }
    ]
  },
  // ── HR Setup ──────────────────────────────────────────────────────────
  // Field order, labels, mandatory flags, defaults, options and conditional
  // visibility below are taken from the live ERPNext DocType definitions saved
  // in erpnext-reference/employee.json and erpnext-reference/setup-masters.json.
  employee: {
    model: 'hrEmployee', doctype: 'Employee', workspace: 'hr-setup',
    titleField: 'employeeName', selfScoped: true, hrWriteOnly: true,
    columns: ['employeeName', 'employeeCode', 'department', 'designation', 'status'],
    search: ['employeeName'],
    beforeWrite: 'normalizeEmployee',
    onCreated: 'provisionEmployeeUser',
    onUpdated: 'provisionEmployeeUser',
    fields: [
      // Overview (ERPNext tab "Overview", untitled section basic_information)
      { s: 'Overview', n: 'employeeCode', l: 'Employee ID', t: 'data', ro: true, hint: 'Generated from the series when the record is created' },
      { s: 'Overview', n: 'namingSeries', l: 'Series', t: 'select', o: ['HR-EMP-'], d: 'HR-EMP-' },
      { s: 'Overview', n: 'firstName', l: 'First Name', t: 'data', r: true },
      { s: 'Overview', n: 'middleName', l: 'Middle Name', t: 'data' },
      { s: 'Overview', n: 'lastName', l: 'Last Name', t: 'data' },
      { s: 'Overview', n: 'employeeName', l: 'Full Name', t: 'data', ro: true },
      { s: 'Overview', n: 'genderId', l: 'Gender', t: 'link', o: 'gender', r: true },
      { s: 'Overview', n: 'dateOfBirth', l: 'Date of Birth', t: 'date', r: true },
      { s: 'Overview', n: 'salutationId', l: 'Salutation', t: 'link', o: 'salutation' },
      { s: 'Overview', n: 'joiningDate', l: 'Date of Joining', t: 'date', r: true },
      // ERPNext keeps the image on a hidden field in this version of the form
      { s: 'Overview', n: 'image', l: 'Image', t: 'attachImage', hidden: true },
      {
        s: 'Overview', n: 'status', l: 'Status', t: 'select', r: true, d: 'Active',
        o: ['Active', 'Inactive', 'Suspended', 'Left']
      },
      // User Details
      {
        s: 'User Details', n: 'userId', l: 'User ID', t: 'userLink',
        hint: 'System User (login) ID. If set, it will become default for all HR forms.'
      },
      {
        s: 'User Details', n: 'createUserPermission', l: 'Create User Permission', t: 'bool', d: true,
        hint: 'This will restrict user access to other employee records',
        when: [{ any: ['userId', 'createUserAutomatically'] }]
      },
      {
        // ERPNext: eval:doc.__islocal && !doc.user_id — only while the record is new
        s: 'User Details', n: 'createUserAutomatically', l: 'Create User Automatically', t: 'bool', d: false,
        hint: 'Creates a User account for this employee using the Preferred, Company, or Personal email.',
        when: [{ field: '__islocal', truthy: true }, { field: 'userId', equals: '' }]
      },
      // Company Details
      { s: 'Company Details', ...COMPANY_FIELD },
      { s: 'Company Details', n: 'departmentId', l: 'Department', t: 'link', o: 'department' },
      { s: 'Company Details', n: 'employeeNumber', l: 'Employee Number', t: 'data' },
      { s: 'Company Details', n: 'designationId', l: 'Designation', t: 'link', o: 'designation' },
      { s: 'Company Details', n: 'managerId', l: 'Reports to', t: 'link', o: 'employee' },
      { s: 'Company Details', n: 'officeId', l: 'Branch', t: 'link', o: 'branch' },
      // Address & Contacts
      { s: 'Address & Contacts', n: 'phone', l: 'Mobile', t: 'data' },
      { s: 'Address & Contacts', n: 'companyEmail', l: 'Company Email', t: 'data', hint: 'Provide Email Address registered in company' },
      { s: 'Address & Contacts', n: 'personalEmail', l: 'Personal Email', t: 'data' },
      {
        s: 'Address & Contacts', n: 'preferedContactEmail', l: 'Preferred Contact Email', t: 'select',
        o: ['Company Email', 'Personal Email', 'User ID']
      },
      { s: 'Address & Contacts', n: 'preferedEmail', l: 'Preferred Email', t: 'data', ro: true },
      { s: 'Address & Contacts', n: 'unsubscribed', l: 'Unsubscribed', t: 'bool', d: false },
      { s: 'Address', n: 'currentAddress', l: 'Current Address', t: 'longText' },
      { s: 'Address', n: 'currentAccommodationType', l: 'Current Address Is', t: 'select', o: ['Rented', 'Owned'] },
      { s: 'Address', n: 'permanentAddress', l: 'Permanent Address', t: 'longText' },
      { s: 'Address', n: 'permanentAccommodationType', l: 'Permanent Address Is', t: 'select', o: ['Rented', 'Owned'] },
      { s: 'Emergency Contact', n: 'personToBeContacted', l: 'Emergency Contact Name', t: 'data' },
      { s: 'Emergency Contact', n: 'emergencyPhoneNumber', l: 'Emergency Phone', t: 'data' },
      { s: 'Emergency Contact', n: 'relation', l: 'Relation', t: 'data' },
      // Attendance & Leaves
      { s: 'Attendance & Leaves', n: 'attendanceDeviceId', l: 'Attendance Device ID (Biometric/RF tag ID)', t: 'data' },
      { s: 'Attendance & Leaves', n: 'holidayListId', l: 'Holiday List', t: 'link', o: 'holiday-list', hint: 'Applicable Holiday List' },
      // Salary
      { s: 'Salary', n: 'ctC', l: 'Cost to Company (CTC)', t: 'currency', d: 0 },
      { s: 'Salary', n: 'salaryCurrency', l: 'Salary Currency', t: 'currencyCode' },
      { s: 'Salary', n: 'salaryMode', l: 'Salary Mode', t: 'select', o: ['Bank', 'Cash', 'Cheque'] },
      {
        s: 'Bank Details', n: 'bankName', l: 'Bank Name', t: 'data',
        when: { field: 'salaryMode', equals: 'Bank' }
      },
      {
        s: 'Bank Details', n: 'accountNumber', l: 'Bank A/C No.', t: 'data',
        when: { field: 'salaryMode', equals: 'Bank' }
      },
      {
        s: 'Bank Details', n: 'iban', l: 'IBAN', t: 'data',
        when: { field: 'salaryMode', equals: 'Bank' }
      },
      // Personal Details
      { s: 'Personal Details', n: 'maritalStatus', l: 'Marital Status', t: 'select', o: ['Single', 'Married', 'Divorced', 'Widowed'] },
      {
        s: 'Personal Details', n: 'familyBackground', l: 'Family Background', t: 'longText',
        hint: 'Here you can maintain family details like name and occupation of parent, spouse and children'
      },
      { s: 'Personal Details', n: 'bloodGroup', l: 'Blood Group', t: 'select', o: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
      {
        s: 'Personal Details', n: 'healthDetails', l: 'Health Details', t: 'longText',
        hint: 'Here you can maintain height, weight, allergies, medical concerns etc'
      },
      { s: 'Passport Details', n: 'passportNumber', l: 'Passport Number', t: 'data' },
      { s: 'Passport Details', n: 'validUpto', l: 'Valid Up To', t: 'date' },
      { s: 'Passport Details', n: 'dateOfIssue', l: 'Date of Issue', t: 'date' },
      { s: 'Passport Details', n: 'placeOfIssue', l: 'Place of Issue', t: 'data' },
      {
        s: 'Profile', n: 'bio', l: 'Bio / Cover Letter', t: 'longText',
        hint: 'Short biography for website and other publications.'
      },
      {
        s: 'Educational Qualification', n: 'education', l: 'Education', t: 'table', rows: [
          { n: 'schoolUniv', l: 'School/University', t: 'longText' },
          { n: 'qualification', l: 'Qualification', t: 'data' },
          { n: 'level', l: 'Level', t: 'select', o: ['Graduate', 'Post Graduate', 'Under Graduate'] },
          { n: 'yearOfPassing', l: 'Year of Passing', t: 'int' },
          { n: 'classPer', l: 'Class / Percentage', t: 'data' },
          { n: 'majOptSubj', l: 'Major/Optional Subjects', t: 'longText' }
        ]
      },
      {
        s: 'Previous Work Experience', n: 'externalWorkHistory', l: 'External Work History', t: 'table', rows: [
          { n: 'companyName', l: 'Company', t: 'data' },
          { n: 'designation', l: 'Designation', t: 'data' },
          { n: 'salary', l: 'Salary', t: 'currency' },
          { n: 'address', l: 'Address', t: 'longText' },
          { n: 'contact', l: 'Contact', t: 'data' },
          { n: 'totalExperience', l: 'Total Experience', t: 'data' }
        ]
      },
      {
        s: 'History In Company', n: 'internalWorkHistory', l: 'Internal Work History', t: 'table', rows: [
          { n: 'branchId', l: 'Branch', t: 'link', o: 'branch' },
          { n: 'departmentId', l: 'Department', t: 'link', o: 'department' },
          { n: 'designationId', l: 'Designation', t: 'link', o: 'designation' },
          { n: 'fromDate', l: 'From Date', t: 'date' },
          { n: 'toDate', l: 'To Date', t: 'date' }
        ]
      },
      // Joining
      { s: 'Joining', n: 'scheduledConfirmationDate', l: 'Offer Date', t: 'date' },
      { s: 'Joining', n: 'finalConfirmationDate', l: 'Confirmation Date', t: 'date' },
      { s: 'Joining', n: 'contractEndDate', l: 'Contract End Date', t: 'date' },
      { s: 'Joining', n: 'noticeNumberOfDays', l: 'Notice (days)', t: 'int' },
      { s: 'Joining', n: 'dateOfRetirement', l: 'Date Of Retirement', t: 'date' },
      // Exit
      { s: 'Exit', n: 'resignationLetterDate', l: 'Resignation Letter Date', t: 'date' },
      {
        s: 'Exit', n: 'relievingDate', l: 'Relieving Date', t: 'date',
        reqWhen: { field: 'status', equals: 'Left' }
      },
      { s: 'Exit', n: 'heldOn', l: 'Exit Interview Held On', t: 'date' },
      { s: 'Exit', n: 'newWorkplace', l: 'New Workplace', t: 'data' },
      { s: 'Exit', n: 'leaveEncashed', l: 'Leave Encashed?', t: 'select', o: ['Yes', 'No'] },
      {
        s: 'Exit', n: 'encashmentDate', l: 'Encashment Date', t: 'date',
        when: { field: 'leaveEncashed', equals: 'Yes' }
      },
      { s: 'Feedback', n: 'reasonForLeaving', l: 'Reason for Leaving', t: 'longText' },
      { s: 'Feedback', n: 'feedback', l: 'Feedback', t: 'longText' }
    ]
  },
  department: {
    // Exact ERPNext Department + HRMS custom fields (from live
    // hrms-rje-xre.nvi.frappe.cloud/desk/.../department/new + hrms/setup.py).
    model: 'hrDepartment', doctype: 'Department', workspace: 'hr-setup', section: 'Masters',
    titleField: 'name', unique: ['name'], hrWriteOnly: true,
    columns: ['name', 'parentId', 'leaveBlockListId', 'isGroup', 'disabled'], search: ['name'],
    fields: [
      { n: 'name', l: 'Department', t: 'data', r: true },
      // ERPNext parent_department set_query: is_group = 1
      { n: 'parentId', l: 'Parent Department', t: 'link', o: 'department', linkQuery: { isGroup: true } },
      { n: 'companyId', l: 'Company', t: 'company', r: true },
      { n: 'isGroup', l: 'Is Group', t: 'bool', d: false },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false },
      { n: 'costCenterId', l: 'Payroll Cost Center', t: 'costCenter' },
      {
        n: 'leaveBlockListId', l: 'Leave Block List', t: 'link', o: 'leave-block-list',
        hint: 'Days for which Holidays are blocked for this department.'
      },
      {
        s: 'Approvers', n: 'shiftRequestApprovers', l: 'Shift Request Approver', t: 'table',
        sectionHint: 'The first Approver in the list will be set as the default Approver.',
        rows: [{ n: 'approverId', l: 'Approver', t: 'userLink', r: true }]
      },
      {
        n: 'leaveApprovers', l: 'Leave Approver', t: 'table',
        rows: [{ n: 'approverId', l: 'Approver', t: 'userLink', r: true }]
      },
      {
        n: 'expenseApprovers', l: 'Expense Approver', t: 'table',
        rows: [{ n: 'approverId', l: 'Approver', t: 'userLink', r: true }]
      }
    ],
    beforeWrite: 'normalizeDepartment'
  },
  designation: {
    // Exact ERPNext Designation + HRMS fields from live desk + hrms/setup.py.
    model: 'hrDesignation', doctype: 'Designation', workspace: 'hr-setup', section: 'Masters',
    titleField: 'name', unique: ['name'], hrWriteOnly: true,
    columns: ['name', 'appraisalTemplateId'], search: ['name', 'description'],
    fields: [
      { n: 'name', l: 'Designation', t: 'data', r: true },
      { n: 'description', l: 'Description', t: 'longText' },
      { n: 'appraisalTemplateId', l: 'Appraisal Template', t: 'link', o: 'appraisal-template' },
      {
        s: 'Skills', n: 'skills', l: 'Skills', t: 'table', rows: [
          { n: 'skillId', l: 'Skill', t: 'link', o: 'skill', r: true }
        ]
      }
    ]
  },
  branch: {
    model: 'hrOffice', doctype: 'Branch', workspace: 'hr-setup', section: 'Masters',
    titleField: 'name', unique: ['name'], hrWriteOnly: true,
    columns: ['name', 'address', 'isActive'], search: ['name', 'address'],
    fields: [
      { n: 'name', l: 'Branch', t: 'data', r: true },
      { n: 'address', l: 'Address', t: 'longText' },
      { n: 'latitude', l: 'Latitude', t: 'float', d: 0 },
      { n: 'longitude', l: 'Longitude', t: 'float', d: 0 },
      { n: 'radiusMeters', l: 'Geofence Radius (meters)', t: 'int', d: 150, min: 0 },
      { n: 'isActive', l: 'Is Active', t: 'bool', d: true }
    ],
    beforeWrite: 'normalizeBranch'
  },
  gender: {
    model: 'hrGender', doctype: 'Gender', workspace: 'hr-setup', section: 'Masters',
    titleField: 'gender', unique: ['gender'], hrWriteOnly: true,
    columns: ['gender'], search: ['gender'],
    // ERPNext names the record from this field, so an empty value cannot be saved
    fields: [{ n: 'gender', l: 'Gender', t: 'data', r: true }]
  },
  salutation: {
    model: 'hrSalutation', doctype: 'Salutation', workspace: 'hr-setup', section: 'Masters',
    titleField: 'salutation', unique: ['salutation'], hrWriteOnly: true,
    columns: ['salutation'], search: ['salutation'],
    fields: [{ n: 'salutation', l: 'Salutation', t: 'data', r: true }]
  },
  'employee-grade': {
    // Exact ERPNext Employee Grade: Name + Default Salary Structure (+ fetched currency / base pay).
    model: 'hrEmployeeGrade', doctype: 'Employee Grade', workspace: 'hr-setup', section: 'Setup',
    titleField: 'name', unique: ['name'], columns: ['name', 'defaultSalaryStructureId', 'defaultBasePay'], search: ['name'],
    fields: [
      { n: 'name', l: 'Name', t: 'data', r: true },
      { n: 'defaultSalaryStructureId', l: 'Default Salary Structure', t: 'link', o: 'salary-structure' },
      {
        n: 'currency', l: 'Currency', t: 'currencyCode', ro: true, hidden: true,
        fetchFrom: 'defaultSalaryStructureId.currency'
      },
      {
        n: 'defaultBasePay', l: 'Default Base Pay', t: 'currency', d: 0,
        when: { field: 'defaultSalaryStructureId' }
      }
    ]
  },
  'employee-group': {
    model: 'hrEmployeeGroup', doctype: 'Employee Group', workspace: 'hr-setup', section: 'Setup',
    titleField: 'name', unique: ['name'], columns: ['name', 'disabled'], search: ['name'],
    fields: [
      { n: 'name', l: 'Employee Group', t: 'data', r: true },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false }
    ]
  },
  'employment-type': {
    model: 'hrEmploymentType', doctype: 'Employment Type', workspace: 'hr-setup', section: 'Setup',
    titleField: 'name', unique: ['name'], columns: ['name', 'leaveDaysPerYear', 'disabled'], search: ['name'],
    fields: [
      { n: 'name', l: 'Employment Type', t: 'data', r: true },
      { n: 'enabledForLeavePolicy', l: 'Enabled for Leave Policy', t: 'bool', d: true },
      { n: 'includeHolidaysInTotalDays', l: 'Include Holidays in Total Days', t: 'bool', d: false },
      { n: 'leaveDaysPerYear', l: 'Company Leaver / Annual Days', t: 'float', d: 0 },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false }
    ]
  },
  // ── Recruitment (ERPNext fields from hrms/hr/doctype) ────────────────────
  'skill': {
    model: 'hrSkill', doctype: 'Skill', workspace: 'recruitment', section: 'Setup',
    titleField: 'skillName', unique: ['skillName'], columns: ['skillName', 'description'], search: ['skillName'],
    fields: [
      { n: 'skillName', l: 'Skill Name', t: 'data', r: true },
      { n: 'description', l: 'Description', t: 'longText' }
    ]
  },
  'offer-term': {
    model: 'hrOfferTerm', doctype: 'Offer Term', workspace: 'recruitment', section: 'Setup',
    titleField: 'offerTerm', unique: ['offerTerm'], columns: ['offerTerm'], search: ['offerTerm'],
    fields: [{ n: 'offerTerm', l: 'Offer Term', t: 'data', r: true }]
  },
  'job-opening-template': {
    model: 'hrJobOpeningTemplate', doctype: 'Job Opening Template', workspace: 'recruitment', section: 'Setup',
    titleField: 'templateTitle', unique: ['templateTitle'],
    columns: ['templateTitle', 'departmentId', 'designationId', 'lowerRange', 'upperRange'],
    search: ['templateTitle', 'description'],
    fields: [
      { n: 'templateTitle', l: 'Template Title', t: 'data', r: true },
      { n: 'departmentId', l: 'Department', t: 'link', o: 'department' },
      { n: 'designationId', l: 'Designation', t: 'link', o: 'designation' },
      { n: 'employmentTypeId', l: 'Employment Type', t: 'link', o: 'employment-type' },
      { n: 'locationId', l: 'Location', t: 'link', o: 'branch' },
      { n: 'currency', l: 'Currency', t: 'currencyCode' },
      { n: 'lowerRange', l: 'Lower Range', t: 'currency', d: 0 },
      { n: 'upperRange', l: 'Upper Range', t: 'currency', d: 0 },
      { n: 'salaryPer', l: 'Salary Paid Per', t: 'select', o: ['Month', 'Year'], d: 'Month' },
      { n: 'publishSalaryRange', l: 'Publish Salary Range', t: 'bool', d: false },
      { n: 'description', l: 'Description', t: 'longText' }
    ]
  },
  'job-offer-term-template': {
    model: 'hrJobOfferTermTemplate', doctype: 'Job Offer Term Template', workspace: 'recruitment', section: 'Setup',
    titleField: 'title', unique: ['title'], columns: ['title'], search: ['title'],
    fields: [
      { n: 'title', l: 'Title', t: 'data' },
      {
        n: 'offerTerms', l: 'Offer Terms', t: 'table', rows: [
          { n: 'offerTermId', l: 'Offer Term', t: 'link', o: 'offer-term', r: true },
          { n: 'value', l: 'Value / Description', t: 'longText', r: true }
        ]
      }
    ]
  },
  'appointment-letter-template': {
    model: 'hrAppointmentLetterTemplate', doctype: 'Appointment Letter Template', workspace: 'recruitment', section: 'Setup',
    titleField: 'templateName', unique: ['templateName'], columns: ['templateName'], search: ['templateName'],
    fields: [
      { n: 'templateName', l: 'Template Name', t: 'data', r: true },
      { n: 'introduction', l: 'Introduction', t: 'longText', r: true },
      {
        n: 'terms', l: 'Terms', t: 'table', rows: [
          { n: 'title', l: 'Title', t: 'data', r: true },
          { n: 'description', l: 'Description', t: 'longText', r: true }
        ]
      },
      { n: 'closingNotes', l: 'Closing Notes', t: 'longText' }
    ]
  },
  'appointment-letter': {
    model: 'hrAppointmentLetter', doctype: 'Appointment Letter', workspace: 'recruitment',
    titleField: 'applicantName', columns: ['applicantName', 'appointmentDate', 'jobApplicantId'],
    search: ['applicantName'], beforeWrite: 'prepareAppointmentLetter',
    fields: [
      { n: 'jobApplicantId', l: 'Job Applicant', t: 'link', o: 'job-applicant', r: true },
      { n: 'applicantName', l: 'Applicant Name', t: 'data', r: true, fetchFrom: 'jobApplicantId.applicantName' },
      { n: 'appointmentDate', l: 'Appointment Date', t: 'date', r: true },
      { n: 'templateId', l: 'Appointment Letter Template', t: 'link', o: 'appointment-letter-template', r: true },
      { n: 'introduction', l: 'Introduction', t: 'longText', r: true, fetchFrom: 'templateId.introduction' },
      {
        n: 'terms', l: 'Terms', t: 'table', fetchFrom: 'templateId.terms', rows: [
          { n: 'title', l: 'Title', t: 'data', r: true },
          { n: 'description', l: 'Description', t: 'longText', r: true }
        ]
      },
      { n: 'closingNotes', l: 'Closing Notes', t: 'longText', fetchFrom: 'templateId.closingNotes' }
    ]
  },
  'staffing-plan': {
    model: 'hrStaffingPlan', doctype: 'Staffing Plan', workspace: 'recruitment',
    columns: ['departmentId', 'fromDate', 'toDate', 'totalEstimatedBudget'],
    beforeWrite: 'computeStaffingPlanTotals',
    fields: [
      COMPANY_FIELD,
      { n: 'departmentId', l: 'Department', t: 'link', o: 'department' },
      { n: 'fromDate', l: 'From Date', t: 'date', r: true },
      { n: 'toDate', l: 'To Date', t: 'date', r: true },
      {
        n: 'staffingDetails', l: 'Staffing Details', t: 'table', r: true, rows: [
          { n: 'designationId', l: 'Designation', t: 'link', o: 'designation', r: true },
          { n: 'vacancies', l: 'Vacancies', t: 'int', d: 0 },
          { n: 'estimatedCostPerPosition', l: 'Estimated Cost Per Position', t: 'currency', d: 0 },
          { n: 'totalEstimatedCost', l: 'Total Estimated Cost', t: 'currency', ro: true, d: 0 },
          { n: 'currentCount', l: 'Current Count', t: 'int', ro: true, d: 0 },
          { n: 'currentOpenings', l: 'Current Openings', t: 'int', ro: true, d: 0 },
          { n: 'numberOfPositions', l: 'Number Of Positions', t: 'int', ro: true, d: 0 }
        ]
      },
      { n: 'totalEstimatedBudget', l: 'Total Estimated Budget', t: 'currency', ro: true, d: 0 }
    ]
  },
  'employee-referral': {
    model: 'hrEmployeeReferral', doctype: 'Employee Referral', workspace: 'recruitment',
    titleField: 'fullName', columns: ['fullName', 'forDesignationId', 'email', 'status'],
    search: ['fullName', 'email'], beforeWrite: 'prepareEmployeeReferral',
    fields: [
      { n: 'firstName', l: 'First Name', t: 'data', r: true },
      { n: 'lastName', l: 'Last Name', t: 'data', r: true },
      { n: 'fullName', l: 'Full Name', t: 'data', ro: true },
      { n: 'date', l: 'Date', t: 'date', r: true },
      { n: 'status', l: 'Status', t: 'select', r: true, d: 'Pending', o: ['Pending', 'In Process', 'Accepted', 'Rejected', 'Cancelled'] },
      { n: 'forDesignationId', l: 'For Designation', t: 'link', o: 'designation', r: true },
      { n: 'email', l: 'Email', t: 'data', r: true },
      { n: 'contactNo', l: 'Contact No.', t: 'data' },
      { n: 'resumeLink', l: 'Resume Link', t: 'data' },
      { n: 'currentEmployer', l: 'Current Employer', t: 'data' },
      { n: 'currentJobTitle', l: 'Current Job Title', t: 'data' },
      { n: 'resume', l: 'Resume', t: 'data' },
      { n: 'referrerEmployeeId', l: 'Referrer', t: 'employee', r: true },
      { n: 'referrerName', l: 'Referrer Name', t: 'data', ro: true, fetchFrom: 'referrerEmployeeId.employeeName' },
      { n: 'isApplicableForReferralBonus', l: 'Is Applicable for Referral Bonus', t: 'bool', d: true },
      { n: 'referralPaymentStatus', l: 'Referral Bonus Payment Status', t: 'select', o: ['Unpaid', 'Paid'] },
      { n: 'departmentId', l: 'Department', t: 'link', o: 'department' },
      { n: 'qualificationReason', l: 'Why is this Candidate Qualified for this Position?', t: 'longText' },
      { n: 'workReferences', l: 'Work References', t: 'longText' }
    ]
  },
  // ── Employee lifecycle templates + training records ─────────────────────
  'employee-onboarding-template': {
    model: 'hrEmployeeOnboardingTemplate', doctype: 'Employee Onboarding Template', workspace: 'tenure', section: 'Templates',
    titleField: 'title', unique: ['title'], columns: ['title', 'departmentId', 'designationId'], search: ['title'],
    fields: [
      { n: 'title', l: 'Title', t: 'data', r: true },
      { n: 'departmentId', l: 'Department', t: 'link', o: 'department' },
      { n: 'designationId', l: 'Designation', t: 'link', o: 'designation' },
      { n: 'employeeGradeId', l: 'Employee Grade', t: 'link', o: 'employee-grade' },
      {
        n: 'activities', l: 'Activities', t: 'table', rows: [
          { n: 'activityName', l: 'Activity Name', t: 'data', r: true },
          { n: 'role', l: 'Role', t: 'data' },
          { n: 'beginOn', l: 'Begin On (Days)', t: 'int', d: 0 },
          { n: 'duration', l: 'Duration (Days)', t: 'int', d: 0 },
          { n: 'taskWeight', l: 'Task Weight', t: 'float', d: 0 },
          { n: 'requiredForEmployeeCreation', l: 'Required for Employee Creation', t: 'bool', d: false },
          { n: 'description', l: 'Description', t: 'longText' }
        ]
      }
    ]
  },
  'employee-separation-template': {
    model: 'hrEmployeeSeparationTemplate', doctype: 'Employee Separation Template', workspace: 'tenure', section: 'Templates',
    titleField: 'title', unique: ['title'], columns: ['title', 'departmentId', 'designationId'], search: ['title'],
    fields: [
      { n: 'title', l: 'Title', t: 'data', r: true },
      { n: 'departmentId', l: 'Department', t: 'link', o: 'department' },
      { n: 'designationId', l: 'Designation', t: 'link', o: 'designation' },
      { n: 'employeeGradeId', l: 'Employee Grade', t: 'link', o: 'employee-grade' },
      {
        n: 'activities', l: 'Activities', t: 'table', rows: [
          { n: 'activityName', l: 'Activity Name', t: 'data', r: true },
          { n: 'role', l: 'Role', t: 'data' },
          { n: 'beginOn', l: 'Begin On (Days)', t: 'int', d: 0 },
          { n: 'duration', l: 'Duration (Days)', t: 'int', d: 0 },
          { n: 'taskWeight', l: 'Task Weight', t: 'float', d: 0 },
          { n: 'requiredForEmployeeCreation', l: 'Required for Employee Creation', t: 'bool', d: false },
          { n: 'description', l: 'Description', t: 'longText' }
        ]
      }
    ]
  },
  'training-feedback': {
    model: 'hrTrainingFeedback', doctype: 'Training Feedback', workspace: 'tenure', section: 'Training',
    titleField: 'employeeName',
    statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    columns: ['employeeId', 'eventName', 'status'], search: ['employeeName', 'eventName'],
    beforeWrite: 'prepareTrainingFeedback',
    fields: [
      { n: 'employeeId', l: 'Employee', t: 'employee', r: true },
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      { n: 'department', l: 'Department', t: 'link', o: 'department', fetchFrom: 'employeeId.departmentId' },
      { n: 'course', l: 'Course', t: 'data' },
      { n: 'trainingEventId', l: 'Training Event', t: 'link', o: 'training-event', r: true },
      { n: 'eventName', l: 'Event Name', t: 'data', ro: true, fetchFrom: 'trainingEventId.eventName' },
      { n: 'trainerName', l: 'Trainer Name', t: 'data', ro: true, fetchFrom: 'trainingEventId.trainerName' },
      { n: 'feedback', l: 'Feedback', t: 'longText', r: true }
    ]
  },
  'training-result': {
    model: 'hrTrainingResult', doctype: 'Training Result', workspace: 'tenure', section: 'Training',
    statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    columns: ['trainingEventId', 'status'], search: [],
    beforeWrite: 'prepareTrainingResult',
    fields: [
      { n: 'trainingEventId', l: 'Training Event', t: 'link', o: 'training-event', r: true },
      {
        n: 'employees', l: 'Employees', t: 'table', rows: [
          { n: 'employeeId', l: 'Employee', t: 'employee' },
          { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
          { n: 'department', l: 'Department', t: 'link', o: 'department', fetchFrom: 'employeeId.departmentId' },
          { n: 'hours', l: 'Hours', t: 'float', d: 0 },
          { n: 'grade', l: 'Grade', t: 'data' },
          { n: 'comments', l: 'Comments', t: 'longText' }
        ]
      },
      { n: 'employeeEmails', l: 'Employee Emails', t: 'longText', hidden: true }
    ]
  },
  // ── Leaves: Holiday List Assignment ─────────────────────────────────────
  'holiday-list-assignment': {
    model: 'hrHolidayListAssignment', doctype: 'Holiday List Assignment', workspace: 'leaves', section: 'Holidays',
    titleField: 'employeeName',
    statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    columns: ['applicableFor', 'assignedToId', 'holidayListId', 'fromDate', 'status'],
    search: ['employeeName'],
    beforeWrite: 'prepareHolidayListAssignment',
    onSubmitted: 'applyHolidayListAssignment',
    fields: [
      { n: 'applicableFor', l: 'Applicable For', t: 'select', r: true, d: 'Employee', o: ['Employee', 'Company'] },
      {
        n: 'assignedToId', l: 'Assigned To', t: 'employee',
        when: { field: 'applicableFor', equals: 'Employee' },
        reqWhen: { field: 'applicableFor', equals: 'Employee' }
      },
      {
        n: 'assignedToCompanyId', l: 'Assigned To', t: 'link', o: 'company',
        when: { field: 'applicableFor', equals: 'Company' },
        reqWhen: { field: 'applicableFor', equals: 'Company' }
      },
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, hidden: true, fetchFrom: 'assignedToId.employeeName' },
      { n: 'employeeCompanyId', l: 'Employee Company', t: 'data', ro: true, hidden: true, fetchFrom: 'assignedToId.companyId' },
      { n: 'holidayListId', l: 'Holiday List', t: 'link', o: 'holiday-list', r: true },
      { n: 'fromDate', l: 'Assignment Starts From', t: 'date', r: true },
      { n: 'holidayListStart', l: 'Holiday List Start', t: 'date', ro: true, fetchFrom: 'holidayListId.fromDate' },
      { n: 'holidayListEnd', l: 'Holiday List End', t: 'date', ro: true, fetchFrom: 'holidayListId.toDate' }
    ]
  },
  // ── Performance master ──────────────────────────────────────────────────
  'employee-feedback-criteria': {
    model: 'hrEmployeeFeedbackCriteria', doctype: 'Employee Feedback Criteria', workspace: 'performance',
    section: 'Setup', titleField: 'criteria', unique: ['criteria'], columns: ['criteria'], search: ['criteria'],
    fields: [{ n: 'criteria', l: 'Criteria', t: 'data', r: true }]
  },
  // ── Parity gap DocTypes (generated) ───────────────────────────────
  'shift-schedule': {
    model: 'hrShiftSchedule', doctype: 'Shift Schedule', workspace: 'shift-and-attendance',
    section: 'Shift Setup', titleField: 'name', unique: ['name'],
    statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    columns: ['name', 'shiftTypeId', 'frequency', 'status'], search: ['name'],
    fields: [
      { n: 'name', l: 'Name', t: 'data', r: true },
      { n: 'shiftTypeId', l: 'Shift Type', t: 'link', o: 'shift-type', r: true },
      { n: 'frequency', l: 'Frequency', t: 'select', r: true, d: 'Every Week', o: ['Every Week', 'Every 2 Weeks', 'Every 3 Weeks', 'Every 4 Weeks'] },
      {
        n: 'repeatOnDays', l: 'Repeat On Days', t: 'table', r: true, rows: [
          { n: 'day', l: 'Day', t: 'select', r: true, o: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] }
        ]
      }
    ]
  },
  'shift-schedule-assignment': {
    model: 'hrShiftScheduleAssignment', doctype: 'Shift Schedule Assignment', workspace: 'shift-and-attendance',
    section: 'Shift Assignments', titleField: 'employeeName', employeeScoped: true,
    columns: ['employeeId', 'shiftScheduleId', 'shiftStatus', 'enabled'], search: ['employeeName'],
    fields: [
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      COMPANY_FIELD,
      { n: 'shiftScheduleId', l: 'Shift Schedule', t: 'link', o: 'shift-schedule', r: true },
      { n: 'shiftLocationId', l: 'Shift Location', t: 'link', o: 'shift-location' },
      { n: 'shiftStatus', l: 'Shift Status', t: 'select', d: 'Active', o: ['Active', 'Inactive'] },
      { n: 'enabled', l: 'Enabled', t: 'bool', d: true },
      { n: 'createShiftsAfter', l: 'Create Shifts After', t: 'date', when: { field: 'enabled', equals: true }, reqWhen: { field: 'enabled', equals: true } }
    ]
  },
  'purpose-of-travel': {
    model: 'hrPurposeOfTravel', doctype: 'Purpose of Travel', workspace: 'expenses', section: 'Travel',
    titleField: 'purposeOfTravel', unique: ['purposeOfTravel'],
    columns: ['purposeOfTravel'], search: ['purposeOfTravel'],
    fields: [{ n: 'purposeOfTravel', l: 'Purpose of Travel', t: 'data', r: true }]
  },
  'travel-request': {
    model: 'hrTravelRequest', doctype: 'Travel Request', workspace: 'expenses', section: 'Travel',
    titleField: 'employeeName', employeeScoped: true,
    statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    columns: ['employeeId', 'travelType', 'purposeOfTravelId', 'status'], search: ['employeeName'],
    fields: [
      { n: 'travelType', l: 'Travel Type', t: 'select', r: true, o: ['Domestic', 'International'] },
      { n: 'travelFunding', l: 'Travel Funding', t: 'select', o: ['', 'Require Full Funding', 'Fully Sponsored', 'Partially Sponsored, Require Partial Funding'] },
      { n: 'travelProof', l: 'Copy of Invitation/Announcement', t: 'data' },
      { n: 'purposeOfTravelId', l: 'Purpose of Travel', t: 'link', o: 'purpose-of-travel', r: true },
      { n: 'detailsOfSponsor', l: 'Details of Sponsor (Name, Location)', t: 'data' },
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      COMPANY_FIELD,
      { n: 'description', l: 'Description', t: 'longText' },
      {
        n: 'itinerary', l: 'Travel Itinerary', t: 'table', rows: [
          { n: 'travelFrom', l: 'Travel From', t: 'data' },
          { n: 'travelTo', l: 'Travel To', t: 'data' },
          { n: 'modeOfTravel', l: 'Mode of Travel', t: 'select', o: ['', 'Flight', 'Train', 'Taxi', 'Rented Car', 'Bus', 'Other'] },
          { n: 'mealPreference', l: 'Meal Preference', t: 'select', o: ['', 'Vegetarian', 'Non-Vegetarian', 'Vegan'] },
          { n: 'travelAdvanceRequired', l: 'Travel Advance Required', t: 'bool', d: false },
          { n: 'advanceAmount', l: 'Advance Amount', t: 'currency', d: 0 },
          { n: 'departureDate', l: 'Departure Date', t: 'date' },
          { n: 'arrivalDate', l: 'Arrival Date', t: 'date' },
          { n: 'lodgingRequired', l: 'Lodging Required', t: 'bool', d: false },
          { n: 'preferredAreaForLodging', l: 'Preferred Area for Lodging', t: 'data' }
        ]
      },
      {
        n: 'costings', l: 'Costing Details', t: 'table', rows: [
          { n: 'expenseType', l: 'Expense Type', t: 'data' },
          { n: 'sponsoredAmount', l: 'Sponsored Amount', t: 'currency', d: 0 },
          { n: 'fundedAmount', l: 'Funded Amount', t: 'currency', d: 0 },
          { n: 'totalAmount', l: 'Total Amount', t: 'currency', d: 0 },
          { n: 'comments', l: 'Comments', t: 'data' }
        ]
      },
      { n: 'costCenter', l: 'Cost Center', t: 'costCenter' },
      { n: 'personalIdType', l: 'Personal ID Type', t: 'data' },
      { n: 'personalIdNumber', l: 'Personal ID No', t: 'data' },
      { n: 'nameOfOrganizer', l: 'Name of Organizer', t: 'data' },
      { n: 'addressOfOrganizer', l: 'Address of Organizer', t: 'longText' },
      { n: 'otherDetails', l: 'Other Details', t: 'longText' }
    ]
  },
  'vehicle': {
    model: 'hrVehicle', doctype: 'Vehicle', workspace: 'expenses', section: 'Travel',
    titleField: 'licensePlate', unique: ['licensePlate'],
    columns: ['licensePlate', 'make', 'model', 'employeeId', 'disabled'], search: ['licensePlate', 'make', 'model'],
    fields: [
      { n: 'licensePlate', l: 'License Plate', t: 'data', r: true },
      { n: 'make', l: 'Make', t: 'data' },
      { n: 'model', l: 'Model', t: 'data' },
      { n: 'employeeId', l: 'Employee', t: 'employee' },
      { n: 'odometer', l: 'Odometer Value', t: 'float', d: 0 },
      { n: 'fuelType', l: 'Fuel Type', t: 'select', o: ['', 'Petrol', 'Diesel', 'Natural Gas', 'Electric'] },
      { n: 'uom', l: 'Fuel UOM', t: 'data', d: 'Litre' },
      { n: 'location', l: 'Location', t: 'data' },
      { n: 'chassisNo', l: 'Chassis No', t: 'data' },
      { n: 'acquisitionDate', l: 'Acquisition Date', t: 'date' },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false }
    ]
  },
  'driver': {
    model: 'hrDriver', doctype: 'Driver', workspace: 'expenses', section: 'Travel',
    titleField: 'fullName', unique: ['fullName'],
    columns: ['fullName', 'employeeId', 'cellNumber', 'status'], search: ['fullName', 'licenseNumber'],
    fields: [
      { n: 'fullName', l: 'Full Name', t: 'data', r: true },
      { n: 'employeeId', l: 'Employee', t: 'employee' },
      { n: 'cellNumber', l: 'Cell Number', t: 'data' },
      { n: 'licenseNumber', l: 'License Number', t: 'data' },
      { n: 'issuingDate', l: 'Issuing Date', t: 'date' },
      { n: 'expiryDate', l: 'Expiry Date', t: 'date' },
      { n: 'address', l: 'Address', t: 'longText' },
      { n: 'status', l: 'Status', t: 'select', d: 'Active', o: ['Active', 'Inactive', 'Suspended', 'Left'] }
    ]
  },
  'vehicle-log': {
    model: 'hrVehicleLog', doctype: 'Vehicle Log', workspace: 'expenses', section: 'Travel',
    statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    columns: ['vehicleId', 'employeeId', 'date', 'odometer', 'status'], search: [],
    fields: [
      { n: 'namingSeries', l: 'Series', t: 'select', r: true, d: 'HR-VLOG-.YYYY.-', o: ['HR-VLOG-.YYYY.-'] },
      { n: 'vehicleId', l: 'License Plate', t: 'link', o: 'vehicle', r: true },
      { n: 'employeeId', l: 'Employee', t: 'employee', r: true },
      { n: 'model', l: 'Model', t: 'data', ro: true, fetchFrom: 'vehicleId.model' },
      { n: 'make', l: 'Make', t: 'data', ro: true, fetchFrom: 'vehicleId.make' },
      { n: 'date', l: 'Date', t: 'date' },
      { n: 'odometer', l: 'Odometer', t: 'float', d: 0 },
      { n: 'lastOdometer', l: 'Last Odometer Value', t: 'float', d: 0, ro: true },
      { n: 'fuelQty', l: 'Fuel Qty', t: 'float', d: 0 },
      { n: 'price', l: 'Fuel Price', t: 'currency', d: 0 },
      { n: 'supplier', l: 'Supplier', t: 'data' },
      { n: 'invoice', l: 'Invoice Ref', t: 'data' },
      {
        n: 'serviceDetail', l: 'Service Details', t: 'table', rows: [
          { n: 'serviceItem', l: 'Service Item', t: 'data' },
          { n: 'type', l: 'Type', t: 'select', o: ['', 'Service', 'Inspection', 'Change'] },
          { n: 'frequency', l: 'Frequency', t: 'select', o: ['', 'Mileage', 'Monthly', 'Quarterly', 'Half Yearly', 'Yearly'] },
          { n: 'expenseAmount', l: 'Expense', t: 'currency', d: 0 }
        ]
      }
    ]
  },
  'salary-withholding': {
    model: 'hrSalaryWithholding', doctype: 'Salary Withholding', workspace: 'payroll',
    titleField: 'employeeName', employeeScoped: true,
    statuses: ['Draft', 'Withheld', 'Released', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Withheld', action: 'edit' },
      { key: 'release', label: 'Release', from: ['Withheld'], to: 'Released', action: 'edit' },
      { key: 'cancel', label: 'Cancel', from: ['Withheld', 'Released'], to: 'Cancelled', action: 'edit' },
      { key: 'amend', label: 'Amend', from: ['Cancelled'], to: 'Draft', action: 'edit' }
    ],
    columns: ['employeeId', 'fromDate', 'toDate', 'status'], search: ['employeeName'],
    fields: [
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      COMPANY_FIELD,
      { n: 'postingDate', l: 'Posting Date', t: 'date' },
      { n: 'fromDate', l: 'From Date', t: 'date', r: true },
      { n: 'toDate', l: 'To Date', t: 'date' },
      { n: 'areWithheldSalariesReleased', l: 'Are Withheld Salaries Released', t: 'bool', d: false, ro: true },
      REASON,
      {
        n: 'cycles', l: 'Payroll Cycles', t: 'table', rows: [
          { n: 'fromDate', l: 'From Date', t: 'date' },
          { n: 'toDate', l: 'To Date', t: 'date' },
          { n: 'isSalaryReleased', l: 'Is Salary Released', t: 'bool', d: false }
        ]
      }
    ]
  },
  'employee-benefit-ledger': {
    model: 'hrEmployeeBenefitLedger', doctype: 'Employee Benefit Ledger', workspace: 'tax-and-benefits',
    section: 'Flexible Benefits', titleField: 'employeeName', employeeScoped: true,
    columns: ['employeeId', 'salaryComponentId', 'transactionType', 'amount', 'postingDate'], search: ['employeeName'],
    fields: [
      { n: 'postingDate', l: 'Posting Date', t: 'date' },
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      { n: 'salaryComponentId', l: 'Salary Component', t: 'link', o: 'salary-component' },
      COMPANY_FIELD,
      { n: 'payrollPeriod', l: 'Payroll Period', t: 'data' },
      { n: 'referenceDoctype', l: 'Reference Doctype', t: 'data' },
      { n: 'referenceDocument', l: 'Reference Document', t: 'data' },
      { n: 'salarySlip', l: 'Salary Slip', t: 'data' },
      { n: 'transactionType', l: 'Transaction Type', t: 'select', o: ['', 'Accrual', 'Claim'] },
      { n: 'amount', l: 'Amount', t: 'currency', d: 0 },
      { n: 'remarks', l: 'Remarks', t: 'longText' }
    ]
  },
  'gratuity-rule': {
    model: 'hrGratuityRule', doctype: 'Gratuity Rule', workspace: 'tax-and-benefits', section: 'Gratuity',
    titleField: 'name', unique: ['name'],
    columns: ['name', 'calculateGratuityAmountBasedOn', 'disable'], search: ['name'],
    fields: [
      { n: 'name', l: 'Name', t: 'data', r: true },
      { n: 'disable', l: 'Disable', t: 'bool', d: false },
      { n: 'calculateGratuityAmountBasedOn', l: 'Calculate Gratuity Amount Based On', t: 'select', r: true, d: 'Current Slab', o: ['Current Slab', 'Sum of all previous slabs'] },
      { n: 'totalWorkingDaysPerYear', l: 'Total working Days Per Year', t: 'float', d: 365 },
      { n: 'workExperienceCalculationFunction', l: 'Work Experience Calculation Method', t: 'select', d: 'Round off Work Experience', o: ['Round off Work Experience', 'Take Exact Completed Years', 'Manual'] },
      { n: 'minimumYearForGratuity', l: 'Minimum Year for Gratuity', t: 'int', d: 0 },
      {
        n: 'applicableEarningsComponent', l: 'Applicable Earnings Component', t: 'table', r: true, rows: [
          { n: 'salaryComponentId', l: 'Salary Component', t: 'link', o: 'salary-component', r: true }
        ]
      },
      {
        n: 'gratuityRuleSlabs', l: 'Current Work Experience', t: 'table', r: true, rows: [
          { n: 'fromYear', l: 'From (Year)', t: 'float', d: 0 },
          { n: 'toYear', l: 'To (Year)', t: 'float', d: 0 },
          { n: 'fractionOfApplicableEarnings', l: 'Fraction of Applicable Earnings', t: 'float', d: 0 }
        ]
      }
    ]
  },
  'gratuity': {
    model: 'hrGratuity', doctype: 'Gratuity', workspace: 'tax-and-benefits', section: 'Gratuity',
    titleField: 'employeeName', employeeScoped: true,
    statuses: ['Draft', 'Submitted', 'Cancelled', 'Paid'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
      { key: 'pay', label: 'Mark Paid', from: ['Submitted'], to: 'Paid', action: 'edit' },
      { key: 'cancel', label: 'Cancel', from: ['Submitted', 'Paid'], to: 'Cancelled', action: 'edit' },
      { key: 'amend', label: 'Amend', from: ['Cancelled'], to: 'Draft', action: 'edit' }
    ],
    columns: ['employeeId', 'postingDate', 'amount', 'status'], search: ['employeeName'],
    fields: [
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      { n: 'designation', l: 'Designation', t: 'computed:designation', ro: true },
      { n: 'currentWorkExperience', l: 'Current Work Experience', t: 'float', d: 0 },
      { n: 'postingDate', l: 'Posting date', t: 'date', r: true },
      { n: 'gratuityRuleId', l: 'Gratuity Rule', t: 'link', o: 'gratuity-rule', r: true },
      { n: 'amount', l: 'Total Amount', t: 'currency', d: 0 },
      { n: 'salaryComponentId', l: 'Salary Component', t: 'link', o: 'salary-component' },
      { n: 'payViaSalarySlip', l: 'Pay via Salary Slip', t: 'bool', d: true },
      { n: 'costCenter', l: 'Cost Center', t: 'costCenter' },
      { n: 'modeOfPayment', l: 'Mode of Payment', t: 'data' },
      { n: 'expenseAccount', l: 'Expense Account', t: 'account' },
      { n: 'payableAccount', l: 'Payable Account', t: 'account' },
      { n: 'paidAmount', l: 'Paid Amount', t: 'currency', d: 0, ro: true }
    ]
  },
  'exit-interview': {
    model: 'hrExitInterview', doctype: 'Exit Interview', workspace: 'tenure', section: 'Exit',
    titleField: 'employeeName', employeeScoped: true,
    statuses: ['Pending', 'Scheduled', 'Completed', 'Cancelled'],
    actions: [
      { key: 'schedule', label: 'Schedule', from: ['Pending'], to: 'Scheduled', action: 'edit' },
      { key: 'complete', label: 'Complete', from: ['Scheduled'], to: 'Completed', action: 'edit' },
      { key: 'cancel', label: 'Cancel', from: ['Pending', 'Scheduled'], to: 'Cancelled', action: 'edit' }
    ],
    columns: ['employeeId', 'date', 'status', 'employeeStatus'], search: ['employeeName'],
    fields: [
      { n: 'namingSeries', l: 'Naming Series', t: 'select', d: 'HR-EXIT-INT-', o: ['HR-EXIT-INT-'] },
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      { n: 'email', l: 'Email ID', t: 'data', ro: true, fetchFrom: 'employeeId.companyEmail' },
      COMPANY_FIELD,
      { n: 'date', l: 'Date', t: 'date', reqWhen: { field: 'status', equals: 'Scheduled' } },
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      { n: 'designation', l: 'Designation', t: 'computed:designation', ro: true },
      { n: 'reportsTo', l: 'Reports To', t: 'data', ro: true },
      { n: 'dateOfJoining', l: 'Date of Joining', t: 'date', ro: true, fetchFrom: 'employeeId.dateOfJoining' },
      { n: 'relievingDate', l: 'Relieving Date', t: 'date', ro: true, fetchFrom: 'employeeId.relievingDate' },
      { n: 'refDoctype', l: 'Reference Document Type', t: 'data' },
      { n: 'questionnaireEmailSent', l: 'Questionnaire Email Sent', t: 'bool', d: false, ro: true },
      { n: 'referenceDocumentName', l: 'Reference Document Name', t: 'data' },
      {
        n: 'interviewers', l: 'Interviewers', t: 'table', rows: [
          { n: 'user', l: 'User / Interviewer', t: 'data', r: true }
        ]
      },
      { n: 'interviewSummary', l: 'Interview Summary', t: 'longText' },
      { n: 'employeeStatus', l: 'Final Decision', t: 'select', o: ['', 'Employee Retained', 'Exit Confirmed'], reqWhen: { field: 'status', equals: 'Completed' } }
    ]
  },
  'full-and-final-statement': {
    model: 'hrFullAndFinalStatement', doctype: 'Full and Final Statement', workspace: 'tenure', section: 'Exit',
    titleField: 'employeeName', employeeScoped: true,
    statuses: ['Draft', 'Unpaid', 'Paid', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Unpaid', action: 'edit' },
      { key: 'pay', label: 'Mark Paid', from: ['Unpaid'], to: 'Paid', action: 'edit' },
      { key: 'cancel', label: 'Cancel', from: ['Draft', 'Unpaid', 'Paid'], to: 'Cancelled', action: 'edit' },
      { key: 'amend', label: 'Amend', from: ['Cancelled'], to: 'Draft', action: 'edit' }
    ],
    columns: ['employeeId', 'transactionDate', 'totalPayableAmount', 'totalReceivableAmount', 'status'],
    search: ['employeeName'],
    fields: [
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      { n: 'transactionDate', l: 'Transaction Date', t: 'date', r: true },
      COMPANY_FIELD,
      { n: 'dateOfJoining', l: 'Date of Joining', t: 'date', ro: true, fetchFrom: 'employeeId.dateOfJoining' },
      { n: 'relievingDate', l: 'Relieving Date', t: 'date', ro: true, fetchFrom: 'employeeId.relievingDate' },
      { n: 'designation', l: 'Designation', t: 'computed:designation', ro: true },
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      {
        n: 'payables', l: 'Payables', t: 'table', rows: [
          { n: 'component', l: 'Component', t: 'data' },
          { n: 'referenceDocumentType', l: 'Reference Document Type', t: 'data' },
          { n: 'referenceDocument', l: 'Reference Document', t: 'data' },
          { n: 'amount', l: 'Amount', t: 'currency', d: 0 },
          { n: 'paidAmount', l: 'Paid / Claimed Amount', t: 'currency', d: 0 },
          { n: 'status', l: 'Status', t: 'select', o: ['', 'Unsettled', 'Settled'] },
          { n: 'account', l: 'Account', t: 'account' }
        ]
      },
      {
        n: 'receivables', l: 'Receivables', t: 'table', rows: [
          { n: 'component', l: 'Component', t: 'data' },
          { n: 'referenceDocumentType', l: 'Reference Document Type', t: 'data' },
          { n: 'referenceDocument', l: 'Reference Document', t: 'data' },
          { n: 'amount', l: 'Amount', t: 'currency', d: 0 },
          { n: 'paidAmount', l: 'Paid / Claimed Amount', t: 'currency', d: 0 },
          { n: 'status', l: 'Status', t: 'select', o: ['', 'Unsettled', 'Settled'] },
          { n: 'account', l: 'Account', t: 'account' }
        ]
      },
      {
        n: 'assetsAllocated', l: 'Assets Allocated', t: 'table', rows: [
          { n: 'referenceDocumentType', l: 'Reference Document Type', t: 'data' },
          { n: 'referenceDocument', l: 'Reference Document', t: 'data' },
          { n: 'date', l: 'Date', t: 'date' },
          { n: 'actualCost', l: 'Actual Cost', t: 'currency', d: 0 },
          { n: 'cost', l: 'Cost', t: 'currency', d: 0 },
          { n: 'account', l: 'Account', t: 'account' },
          { n: 'action', l: 'Action', t: 'select', o: ['', 'Return', 'Recover Cost'] },
          { n: 'status', l: 'Status', t: 'select', o: ['', 'Owned', 'Returned'] }
        ]
      },
      { n: 'totalAssetRecoveryCost', l: 'Total Asset Recovery Cost', t: 'currency', d: 0, ro: true },
      { n: 'totalPayableAmount', l: 'Total Payable Amount', t: 'currency', d: 0, ro: true },
      { n: 'totalReceivableAmount', l: 'Total Receivable Amount', t: 'currency', d: 0, ro: true }
    ]
  },
  'compensatory-leave-request': {
    model: 'hrCompensatoryLeaveRequest', doctype: 'Compensatory Leave Request', workspace: 'leaves',
    section: 'Leave Allocations', titleField: 'employeeName', employeeScoped: true,
    statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    columns: ['employeeId', 'workFromDate', 'workEndDate', 'leaveTypeId', 'status'], search: ['employeeName'],
    fields: [
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      { n: 'leaveTypeId', l: 'Leave Type', t: 'link', o: 'leave-type' },
      { n: 'leaveAllocationId', l: 'Leave Allocation', t: 'link', o: 'leave-allocation', ro: true },
      { n: 'workFromDate', l: 'Work From Date', t: 'date', r: true },
      { n: 'workEndDate', l: 'Work End Date', t: 'date', r: true },
      { n: 'halfDay', l: 'Half Day', t: 'bool', d: false },
      { n: 'halfDayDate', l: 'Half Day Date', t: 'date', when: { field: 'halfDay', equals: true } },
      { n: 'reason', l: 'Reason', t: 'longText', r: true }
    ]
  },
  'leave-adjustment': {
    model: 'hrLeaveAdjustment', doctype: 'Leave Adjustment', workspace: 'leaves',
    section: 'Leave Allocations', titleField: 'employeeName', employeeScoped: true,
    statuses: ['Draft', 'Submitted', 'Cancelled'], actions: DRAFT_FLOW,
    columns: ['employeeId', 'leaveTypeId', 'leavesToAdjust', 'postingDate', 'status'], search: ['employeeName'],
    fields: [
      { n: 'namingSeries', l: 'Series', t: 'select', r: true, d: 'HR-LAD-.YYYY.-', o: ['HR-LAD-.YYYY.-'] },
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      COMPANY_FIELD,
      { n: 'leaveTypeId', l: 'Leave Type', t: 'link', o: 'leave-type', r: true },
      { n: 'leaveAllocationId', l: 'Leave Allocation', t: 'link', o: 'leave-allocation' },
      { n: 'leavesToAdjust', l: 'Leaves to Adjust', t: 'float', r: true, d: 0 },
      { n: 'postingDate', l: 'Posting Date', t: 'date' },
      { n: 'reasonForAdjustment', l: 'Reason for Adjustment', t: 'longText' }
    ]
  },
  'daily-work-summary-group': {
    model: 'hrDailyWorkSummaryGroup', doctype: 'Daily Work Summary Group', workspace: 'tenure',
    section: 'Work Summary', titleField: 'name', unique: ['name'],
    columns: ['name', 'enabled', 'sendEmailsAt'], search: ['name'],
    fields: [
      { n: 'name', l: 'Name', t: 'data', r: true },
      { n: 'enabled', l: 'Enabled', t: 'bool', d: true },
      {
        n: 'users', l: 'Users', t: 'table', r: true, rows: [
          { n: 'user', l: 'User', t: 'data', r: true }
        ]
      },
      { n: 'sendEmailsAt', l: 'Send Emails At', t: 'select', d: '17:00', o: ['00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00'] },
      { n: 'holidayListId', l: 'Holiday List', t: 'link', o: 'holiday-list' },
      { n: 'subject', l: 'Subject', t: 'data', d: 'What did you work on today?' },
      { n: 'message', l: 'Message', t: 'longText' }
    ]
  },
  'daily-work-summary': {
    model: 'hrDailyWorkSummary', doctype: 'Daily Work Summary', workspace: 'tenure',
    section: 'Work Summary',
    columns: ['dailyWorkSummaryGroupId', 'status'], search: [],
    fields: [
      { n: 'dailyWorkSummaryGroupId', l: 'Daily Work Summary Group', t: 'link', o: 'daily-work-summary-group', ro: true },
      { n: 'status', l: 'Status', t: 'select', d: 'Open', o: ['Open', 'Sent'], ro: true },
      { n: 'emailSentTo', l: 'Email Sent To', t: 'longText', ro: true }
    ]
  },

  // ── Settings / Timesheet / Payroll Entry / Salary Slip ──────────────────
  'hr-settings': {
    model: 'hrSettingsDoc', doctype: 'HR Settings', workspace: 'hr-setup', section: 'Masters',
    titleField: 'empCreatedBy',
    columns: ['empCreatedBy', 'retirementAge', 'allowEmployeeCheckin', 'autoAttendance'],
    search: [],
    fields: [
      { s: 'Employee Settings', n: 'empCreatedBy', l: 'Employee Naming By', t: 'select', d: 'Naming Series', o: ['Naming Series', 'Employee Number', 'Full Name'] },
      { n: 'employeeNameFormat', l: 'Employee Name Format', t: 'data' },
      {
        n: 'standardWorkingHours', l: 'Standard Working Hours', t: 'float', d: 0,
        hint: 'Used by Employee Hours Utilization and Project Profitability reports.'
      },
      { n: 'retirementAge', l: 'Retirement Age (In Years)', t: 'float', d: 60 },
      { n: 'empCreatedOn', l: 'Employee Records Created On', t: 'data' },
      { s: 'Reminders', n: 'sendWorkAnniversaryReminders', l: 'Work Anniversaries', t: 'bool', d: false },
      { n: 'sendBirthdayReminders', l: 'Birthdays', t: 'bool', d: false },
      { n: 'sendHolidayReminders', l: 'Holidays', t: 'bool', d: false },
      { n: 'frequency', l: 'Holiday Reminder Frequency', t: 'select', d: 'Monthly', o: ['Weekly', 'Monthly'] },
      { s: 'Leave Settings', n: 'leaveApprovalNotification', l: 'Leave Approval Notification', t: 'bool', d: true },
      { n: 'leaveStatusNotification', l: 'Leave Status Notification', t: 'bool', d: true },
      { n: 'allowMultipleLeaveApps', l: 'Allow Multiple Leave Applications for Same Day', t: 'bool', d: false },
      { n: 'restrictBackdatedLeave', l: 'Restrict Backdated Leave Application', t: 'bool', d: false },
      { n: 'showLeavesOfPastYears', l: 'Show Leaves of Past Years', t: 'bool', d: false },
      { s: 'Expense Settings', n: 'expenseApproverMandatory', l: 'Expense Approver Mandatory In Expense Claim', t: 'bool', d: true },
      { s: 'Attendance / Checkin', n: 'allowEmployeeCheckin', l: 'Allow Employee Checkin from Mobile App', t: 'bool', d: true },
      { n: 'allowGeolocation', l: 'Allow Geolocation Tracking', t: 'bool', d: true },
      { n: 'autoAttendance', l: 'Auto Attendance', t: 'bool', d: false },
      { n: 'checkinRadius', l: 'Check-in Radius (meters)', t: 'float', d: 0 },
      { s: 'Exit', n: 'exitQuestionnaireWebhook', l: 'Exit Questionnaire Webhook / Form', t: 'data' }
    ]
  },
  'payroll-settings': {
    model: 'hrPayrollSettings', doctype: 'Payroll Settings', workspace: 'payroll', section: 'Setup',
    titleField: 'roleToPayrollManager',
    columns: ['emailSalarySlip', 'considerUnmarkedAttendance', 'sendSummaryEmail'],
    search: [],
    fields: [
      { n: 'deductionMaxLeaveDays', l: 'Max Working Days for Leave Deduction', t: 'int', d: 0 },
      { n: 'considerUnmarkedAttendance', l: 'Consider Unmarked Attendance as Absent', t: 'bool', d: true },
      { n: 'includeHolidaysInLeaveBalance', l: 'Include Holidays in Leave Balance Calculation', t: 'bool', d: false },
      { n: 'emailSalarySlip', l: 'Email Salary Slip to Employee', t: 'bool', d: true },
      { n: 'roleToPayrollManager', l: 'Role Allowed to Submit / Cancel Payroll', t: 'data' },
      { n: 'processPayrollAccount', l: 'Process Payroll Accounting Entry Based On', t: 'data' },
      { n: 'sendSummaryEmail', l: 'Send Payroll Entry Summary Email', t: 'bool', d: false }
    ]
  },
  'activity-type': {
    // ERPNext Activity Type — defaults seeded: Planning, Research, Proposal Writing, Execution, Communication.
    model: 'hrActivityType', doctype: 'Activity Type', workspace: 'shift-and-attendance', section: 'Timesheets',
    titleField: 'activityType', unique: ['activityType'],
    columns: ['activityType', 'costingRate', 'billingRate', 'disabled'], search: ['activityType'],
    fields: [
      { n: 'activityType', l: 'Activity Type', t: 'data', r: true },
      { n: 'costingRate', l: 'Default Costing Rate', t: 'currency', d: 0 },
      { n: 'billingRate', l: 'Default Billing Rate', t: 'currency', d: 0 },
      { n: 'disabled', l: 'Disabled', t: 'bool', d: false }
    ]
  },
  'timesheet': {
    // Exact ERPNext Timesheet (Projects) — Details tab + Billing tab.
    // field_order from frappe/erpnext develop timesheet.json.
    model: 'hrTimesheet', doctype: 'Timesheet', workspace: 'shift-and-attendance', section: 'Timesheets',
    titleField: 'employeeName', employeeScoped: true,
    statuses: ['Draft', 'Submitted', 'Partially Billed', 'Billed', 'Payslip', 'Completed', 'Cancelled'],
    actions: DRAFT_FLOW,
    columns: ['employeeId', 'startDate', 'endDate', 'totalHours', 'perBilled', 'status'],
    search: ['employeeName', 'title', 'customer'],
    fields: [
      { tab: 'Details', n: 'namingSeries', l: 'Series', t: 'select', o: ['TS-.YYYY.-'], d: 'TS-.YYYY.-', r: true },
      COMPANY_FIELD,
      { n: 'customer', l: 'Customer', t: 'data' },
      { n: 'currency', l: 'Currency', t: 'currencyCode' },
      { n: 'exchangeRate', l: 'Exchange Rate', t: 'float', d: 1 },
      { n: 'salesInvoice', l: 'Sales Invoice', t: 'data', ro: true },
      { n: 'parentProject', l: 'Project', t: 'data' },
      { n: 'title', l: 'Title', t: 'data', hidden: true },
      { s: 'Employee Detail', n: 'employeeId', l: 'Employee', t: 'employee' },
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName', when: 'employeeId' },
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      { n: 'userId', l: 'User', t: 'userLink', ro: true },
      { n: 'startDate', l: 'Start Date', t: 'date', ro: true },
      { n: 'endDate', l: 'End Date', t: 'date', ro: true },
      {
        // Unlabeled section break before time_logs in ERPNext.
        s: '', n: 'timeLogs', l: 'Time Sheets', t: 'table', r: true, rows: [
          // Default list-view columns first (ERPNext grid).
          { n: 'activityTypeId', l: 'Activity Type', t: 'link', o: 'activity-type' },
          { n: 'fromTime', l: 'From Time', t: 'datetime' },
          { n: 'hours', l: 'Hrs', t: 'float', d: 0 },
          { n: 'project', l: 'Project', t: 'data' },
          { n: 'isBillable', l: 'Is Billable', t: 'bool', d: false },
          // Expanded row fields.
          { n: 'description', l: 'Description', t: 'data' },
          { n: 'expectedHours', l: 'Expected Hrs', t: 'float', d: 0 },
          { n: 'toTime', l: 'To Time', t: 'datetime' },
          { n: 'completed', l: 'Completed', t: 'bool', d: false },
          { n: 'projectName', l: 'Project Name', t: 'data', ro: true },
          { n: 'task', l: 'Task', t: 'data' },
          { n: 'billingHours', l: 'Billing Hours', t: 'float', d: 0, when: { field: 'isBillable', equals: true } },
          { n: 'billingRate', l: 'Billing Rate', t: 'currency', d: 0 },
          { n: 'billingAmount', l: 'Billing Amount', t: 'currency', d: 0, ro: true },
          { n: 'costingRate', l: 'Costing Rate', t: 'currency', d: 0 },
          { n: 'costingAmount', l: 'Costing Amount', t: 'currency', d: 0, ro: true },
          { n: 'salesInvoice', l: 'Sales Invoice', t: 'data', ro: true }
        ]
      },
      { s: '', n: 'totalHours', l: 'Total Working Hours', t: 'float', d: 0, ro: true },
      {
        tab: 'Billing', s: 'Billing Details', n: 'totalBillableHours', l: 'Total Billable Hours', t: 'float', d: 0, ro: true
      },
      { n: 'totalBillableAmount', l: 'Total Billable Amount', t: 'currency', d: 0, ro: true },
      { n: 'totalCostingAmount', l: 'Total Costing Amount', t: 'currency', d: 0, ro: true },
      { n: 'totalBilledHours', l: 'Total Billed Hours', t: 'float', d: 0, ro: true },
      { n: 'totalBilledAmount', l: 'Total Billed Amount', t: 'currency', d: 0, ro: true },
      { n: 'perBilled', l: '% Amount Billed', t: 'float', d: 0, ro: true },
      { s: '', n: 'note', l: 'Note', t: 'longText' }
    ],
    beforeWrite: 'normalizeTimesheet'
  },
  'payroll-entry': {
    model: 'hrPayrollEntry', doctype: 'Payroll Entry', workspace: 'payroll',
    statuses: ['Draft', 'Submitted', 'Cancelled', 'Failed', 'Queued'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Draft'], to: 'Submitted', action: 'edit' },
      { key: 'cancel', label: 'Cancel', from: ['Submitted', 'Queued', 'Failed'], to: 'Cancelled', action: 'edit' },
      { key: 'amend', label: 'Amend', from: ['Cancelled'], to: 'Draft', action: 'edit' }
    ],
    columns: ['postingDate', 'payrollFrequency', 'startDate', 'endDate', 'numberOfEmployees', 'status'],
    search: [],
    fields: [
      { s: 'Select Employees', n: 'postingDate', l: 'Posting Date', t: 'date', r: true },
      COMPANY_FIELD,
      { n: 'currency', l: 'Currency', t: 'currencyCode', r: true },
      { n: 'exchangeRate', l: 'Exchange Rate', t: 'float', d: 1, r: true },
      { n: 'payrollPayableAccount', l: 'Payroll Payable Account', t: 'account', r: true },
      { n: 'salarySlipBasedOnTimesheet', l: 'Salary Slip Based on Timesheet', t: 'bool', d: false },
      { n: 'payrollFrequency', l: 'Payroll Frequency', t: 'select', d: 'Monthly', o: ['', 'Monthly', 'Fortnightly', 'Weekly', 'Daily', 'Bimonthly'], when: { field: 'salarySlipBasedOnTimesheet', equals: false } },
      { n: 'startDate', l: 'Start Date', t: 'date', r: true },
      { n: 'endDate', l: 'End Date', t: 'date', r: true },
      { n: 'deductTaxForUnsubmittedProof', l: 'Deduct Tax For Unsubmitted Tax Exemption Proof', t: 'bool', d: false },
      { s: 'Filter Employees', n: 'branchId', l: 'Branch', t: 'link', o: 'branch' },
      { n: 'departmentId', l: 'Department', t: 'link', o: 'department' },
      { n: 'designationId', l: 'Designation', t: 'link', o: 'designation' },
      { n: 'gradeId', l: 'Grade', t: 'link', o: 'employee-grade' },
      { n: 'numberOfEmployees', l: 'Number Of Employees', t: 'int', d: 0, ro: true },
      {
        n: 'employees', l: 'Employees', t: 'table', rows: [
          { n: 'employeeId', l: 'Employee', t: 'employee', r: true },
          { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true },
          { n: 'department', l: 'Department', t: 'data', ro: true },
          { n: 'designation', l: 'Designation', t: 'data', ro: true },
          { n: 'isActive', l: 'Is Active', t: 'bool', d: true }
        ]
      },
      { n: 'validateAttendance', l: 'Validate Attendance', t: 'bool', d: false },
      { s: 'Accounting', n: 'costCenter', l: 'Cost Center', t: 'costCenter', r: true },
      { n: 'project', l: 'Project', t: 'data' },
      { n: 'paymentAccount', l: 'Payment Account', t: 'account' },
      { n: 'bankAccount', l: 'Bank Account', t: 'data' },
      { n: 'salarySlipsCreated', l: 'Salary Slips Created', t: 'bool', d: false, ro: true },
      { n: 'salarySlipsSubmitted', l: 'Salary Slips Submitted', t: 'bool', d: false, ro: true },
      { n: 'errorMessage', l: 'Error Message', t: 'longText', ro: true }
    ]
  },
  'salary-slip': {
    model: 'hrSalarySlip', doctype: 'Salary Slip', workspace: 'payroll',
    titleField: 'employeeName', employeeScoped: true,
    statuses: ['Draft', 'Submitted', 'Cancelled'],
    actions: DRAFT_FLOW,
    columns: ['employeeId', 'postingDate', 'startDate', 'endDate', 'grossPay', 'netPay', 'status'],
    search: ['employeeName'],
    fields: [
      EMPLOYEE,
      { n: 'employeeName', l: 'Employee Name', t: 'data', ro: true, fetchFrom: 'employeeId.employeeName' },
      COMPANY_FIELD,
      { n: 'department', l: 'Department', t: 'computed:department', ro: true },
      { n: 'designation', l: 'Designation', t: 'computed:designation', ro: true },
      { n: 'branch', l: 'Branch', t: 'data', ro: true },
      { n: 'postingDate', l: 'Posting Date', t: 'date', r: true },
      { n: 'currency', l: 'Currency', t: 'currencyCode', r: true },
      { n: 'exchangeRate', l: 'Exchange Rate', t: 'float', d: 1, r: true },
      { n: 'payrollFrequency', l: 'Payroll Frequency', t: 'select', d: 'Monthly', o: ['', 'Monthly', 'Fortnightly', 'Weekly', 'Daily', 'Bimonthly'] },
      { n: 'startDate', l: 'Start Date', t: 'date' },
      { n: 'endDate', l: 'End Date', t: 'date' },
      { n: 'salaryStructureId', l: 'Salary Structure', t: 'link', o: 'salary-structure', r: true },
      { n: 'payrollEntryId', l: 'Payroll Entry', t: 'link', o: 'payroll-entry' },
      { n: 'salaryWithholdingId', l: 'Salary Withholding', t: 'link', o: 'salary-withholding' },
      { n: 'modeOfPayment', l: 'Mode of Payment', t: 'data' },
      { n: 'salarySlipBasedOnTimesheet', l: 'Salary Slip Based on Timesheet', t: 'bool', d: false },
      { s: 'Attendance & Leaves', n: 'totalWorkingDays', l: 'Working Days', t: 'float', d: 0, r: true },
      { n: 'unmarkedDays', l: 'Unmarked Days', t: 'float', d: 0 },
      { n: 'leaveWithoutPay', l: 'Leave Without Pay', t: 'float', d: 0 },
      { n: 'absentDays', l: 'Absent Days', t: 'float', d: 0 },
      { n: 'paymentDays', l: 'Payment Days', t: 'float', d: 0, r: true },
      { n: 'totalWorkingHours', l: 'Total Working Hours', t: 'float', d: 0 },
      { n: 'hourRate', l: 'Hour Rate', t: 'currency', d: 0 },
      {
        s: 'Earnings & Deductions', n: 'earnings', l: 'Earnings', t: 'table', rows: [
          { n: 'salaryComponentId', l: 'Component', t: 'link', o: 'salary-component' },
          { n: 'abbr', l: 'Abbr', t: 'data' },
          { n: 'amount', l: 'Amount', t: 'currency', d: 0 },
          { n: 'defaultAmount', l: 'Default Amount', t: 'currency', d: 0 },
          { n: 'dependsOnPaymentDays', l: 'Depends on Payment Days', t: 'bool', d: false }
        ]
      },
      {
        n: 'deductions', l: 'Deductions', t: 'table', rows: [
          { n: 'salaryComponentId', l: 'Component', t: 'link', o: 'salary-component' },
          { n: 'abbr', l: 'Abbr', t: 'data' },
          { n: 'amount', l: 'Amount', t: 'currency', d: 0 },
          { n: 'defaultAmount', l: 'Default Amount', t: 'currency', d: 0 },
          { n: 'dependsOnPaymentDays', l: 'Depends on Payment Days', t: 'bool', d: false }
        ]
      },
      { s: 'Totals', n: 'grossPay', l: 'Gross Pay', t: 'currency', d: 0, ro: true },
      { n: 'totalDeduction', l: 'Total Deduction', t: 'currency', d: 0, ro: true },
      { n: 'netPay', l: 'Net Pay', t: 'currency', d: 0, ro: true },
      { n: 'roundedTotal', l: 'Rounded Total', t: 'currency', d: 0, ro: true },
      { n: 'yearToDate', l: 'Year To Date', t: 'currency', d: 0, ro: true },
      { n: 'monthToDate', l: 'Month To Date', t: 'currency', d: 0, ro: true },
      { n: 'totalInWords', l: 'Total in Words', t: 'data', ro: true },
      { n: 'bankName', l: 'Bank Name', t: 'data' },
      { n: 'bankAccountNo', l: 'Bank Account No', t: 'data' }
    ]
  },
};

// Documents that must never be created by a plain "employee" role.
const MANAGER_ONLY = new Set([
  'salary-structure', 'income-tax-slab', 'exemption-category', 'employee-benefit',
  'job-opening', 'job-applicant', 'interview', 'job-offer', 'job-requisition',
  'appraisal-template', 'appraisal-cycle', 'employee-grade', 'employee-group',
  'employment-type', 'leave-policy', 'leave-block-list', 'expense-claim-type',
  'grievance-type', 'training-program', 'overtime-type', 'shift-type', 'shift-location',
  'employee-transfer', 'employee-promotion', 'leave-type', 'leave-period',
  'branch', 'department', 'designation', 'gender', 'salutation',
  'skill', 'offer-term', 'job-opening-template', 'job-offer-term-template',
  'appointment-letter-template', 'appointment-letter', 'staffing-plan',
  'employee-onboarding-template', 'employee-separation-template',
  'employee-feedback-criteria',
  'shift-schedule', 'purpose-of-travel', 'vehicle', 'driver', 'gratuity-rule',
  'daily-work-summary-group',
  'hr-settings', 'payroll-settings', 'activity-type', 'payroll-entry'
]);

// Statuses already stored by the pre-ERPNext endpoints, mapped to the ERPNext
// vocabulary so old records keep a meaningful state in the new screens.
const LEGACY_STATUS_ALIASES = {
  // Employee keeps the ERPNext status words in the form and the legacy status
  // keys in the column, so stored rows are shown with the ERPNext label.
  employee: {
    active: 'Active',
    inactive: 'Inactive',
    suspended: 'Suspended',
    terminated: 'Left',
    on_leave: 'Suspended'
  },
  'attendance-request': { Pending: 'Open' },
  'leave-application': { Pending: 'Open' },
  'overtime-slip': { Pending: 'Draft' },
  'additional-salary': { Pending: 'Draft' },
  'shift-assignment': { Scheduled: 'Active' },
  goal: { Open: 'Pending' },
  attendance: {
    present: 'Present',
    Present: 'Present',
    absent: 'Absent',
    Absent: 'Absent',
    on_leave: 'On Leave',
    'On Leave': 'On Leave',
    half_day: 'Half Day',
    'Half Day': 'Half Day',
    wfh: 'Work From Home',
    'Work From Home': 'Work From Home'
  }
};

module.exports = { registry, MANAGER_ONLY, EMPLOYEE, LEGACY_STATUS_ALIASES };
