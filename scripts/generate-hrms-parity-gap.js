'use strict';

/**
 * One-shot generator for the remaining ERPNext HR DocTypes that were stubbed
 * in the workspace nav. Writes:
 *   - prisma/migrations/20261028140000_hrms_parity_gap/migration.sql
 *   - appends models to prisma/schema.prisma (idempotent marker)
 *   - appends registry entries to services/hrDocumentRegistry.js
 *
 * Run: node scripts/generate-hrms-parity-gap.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MARKER = '// ── Parity gap DocTypes (generated) ───────────────────────────────';
const SCHEMA_MARKER = '// ── Parity gap DocTypes (generated) ─────────────────────────────────';

function table(name, cols, indexes = []) {
  const lines = cols.map((c) => `  "${c}"`).join(',\n');
  // cols already include full SQL fragments
  return [
    `CREATE TABLE IF NOT EXISTS "${name}" (`,
    cols.map((c) => `  ${c}`).join(',\n'),
    ');',
    ...indexes
  ].join('\n');
}

const migrationParts = [];

function addTable(sqlName, columns, indexes) {
  migrationParts.push(
    `CREATE TABLE IF NOT EXISTS "${sqlName}" (\n${columns.map((c) => `  ${c}`).join(',\n')}\n);`
  );
  for (const idx of indexes || []) migrationParts.push(idx);
}

// Shared column sets
const ID = `"id" TEXT NOT NULL`;
const COMPANY = `"company_id" TEXT NOT NULL`;
const TIMESTAMPS = `"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  "updated_at" TIMESTAMP(3) NOT NULL`;
const DOC = `"status" TEXT NOT NULL DEFAULT 'Draft',\n  "doc_status" INTEGER NOT NULL DEFAULT 0`;
const PK = `CONSTRAINT "PK" PRIMARY KEY ("id")`;

addTable(
  'hr_shift_schedules',
  [
    ID,
    COMPANY,
    `"name" TEXT NOT NULL`,
    `"shift_type_id" TEXT`,
    `"frequency" TEXT NOT NULL DEFAULT 'Every Week'`,
    `"repeat_on_days" JSONB NOT NULL DEFAULT '[]'`,
    DOC,
    TIMESTAMPS,
    `CONSTRAINT "hr_shift_schedules_pkey" PRIMARY KEY ("id")`
  ],
  [
    `CREATE UNIQUE INDEX IF NOT EXISTS "hr_shift_schedules_company_id_name_key" ON "hr_shift_schedules"("company_id", "name");`,
    `CREATE INDEX IF NOT EXISTS "hr_shift_schedules_company_id_idx" ON "hr_shift_schedules"("company_id");`
  ]
);

addTable(
  'hr_shift_schedule_assignments',
  [
    ID,
    COMPANY,
    `"employee_id" TEXT NOT NULL`,
    `"employee_name" TEXT NOT NULL DEFAULT ''`,
    `"shift_schedule_id" TEXT`,
    `"shift_location_id" TEXT`,
    `"shift_status" TEXT NOT NULL DEFAULT 'Active'`,
    `"enabled" BOOLEAN NOT NULL DEFAULT true`,
    `"create_shifts_after" DATE`,
    TIMESTAMPS,
    `CONSTRAINT "hr_shift_schedule_assignments_pkey" PRIMARY KEY ("id")`
  ],
  [
    `CREATE INDEX IF NOT EXISTS "hr_shift_schedule_assignments_company_id_employee_id_idx" ON "hr_shift_schedule_assignments"("company_id", "employee_id");`
  ]
);

addTable(
  'hr_purposes_of_travel',
  [
    ID,
    COMPANY,
    `"purpose_of_travel" TEXT NOT NULL`,
    TIMESTAMPS,
    `CONSTRAINT "hr_purposes_of_travel_pkey" PRIMARY KEY ("id")`
  ],
  [
    `CREATE UNIQUE INDEX IF NOT EXISTS "hr_purposes_of_travel_company_id_purpose_of_travel_key" ON "hr_purposes_of_travel"("company_id", "purpose_of_travel");`,
    `CREATE INDEX IF NOT EXISTS "hr_purposes_of_travel_company_id_idx" ON "hr_purposes_of_travel"("company_id");`
  ]
);

addTable(
  'hr_travel_requests',
  [
    ID,
    COMPANY,
    `"employee_id" TEXT NOT NULL`,
    `"employee_name" TEXT NOT NULL DEFAULT ''`,
    `"travel_type" TEXT NOT NULL DEFAULT 'Domestic'`,
    `"travel_funding" TEXT NOT NULL DEFAULT ''`,
    `"travel_proof" TEXT NOT NULL DEFAULT ''`,
    `"purpose_of_travel_id" TEXT`,
    `"details_of_sponsor" TEXT NOT NULL DEFAULT ''`,
    `"description" TEXT NOT NULL DEFAULT ''`,
    `"itinerary" JSONB NOT NULL DEFAULT '[]'`,
    `"costings" JSONB NOT NULL DEFAULT '[]'`,
    `"cost_center" TEXT NOT NULL DEFAULT ''`,
    `"personal_id_type" TEXT NOT NULL DEFAULT ''`,
    `"personal_id_number" TEXT NOT NULL DEFAULT ''`,
    `"name_of_organizer" TEXT NOT NULL DEFAULT ''`,
    `"address_of_organizer" TEXT NOT NULL DEFAULT ''`,
    `"other_details" TEXT NOT NULL DEFAULT ''`,
    DOC,
    TIMESTAMPS,
    `CONSTRAINT "hr_travel_requests_pkey" PRIMARY KEY ("id")`
  ],
  [`CREATE INDEX IF NOT EXISTS "hr_travel_requests_company_id_employee_id_idx" ON "hr_travel_requests"("company_id", "employee_id");`]
);

addTable(
  'hr_vehicles',
  [
    ID,
    COMPANY,
    `"license_plate" TEXT NOT NULL`,
    `"make" TEXT NOT NULL DEFAULT ''`,
    `"model" TEXT NOT NULL DEFAULT ''`,
    `"employee_id" TEXT`,
    `"odometer" DOUBLE PRECISION NOT NULL DEFAULT 0`,
    `"fuel_type" TEXT NOT NULL DEFAULT ''`,
    `"uom" TEXT NOT NULL DEFAULT 'Litre'`,
    `"location" TEXT NOT NULL DEFAULT ''`,
    `"chassis_no" TEXT NOT NULL DEFAULT ''`,
    `"acquisition_date" DATE`,
    `"disabled" BOOLEAN NOT NULL DEFAULT false`,
    TIMESTAMPS,
    `CONSTRAINT "hr_vehicles_pkey" PRIMARY KEY ("id")`
  ],
  [
    `CREATE UNIQUE INDEX IF NOT EXISTS "hr_vehicles_company_id_license_plate_key" ON "hr_vehicles"("company_id", "license_plate");`,
    `CREATE INDEX IF NOT EXISTS "hr_vehicles_company_id_idx" ON "hr_vehicles"("company_id");`
  ]
);

addTable(
  'hr_drivers',
  [
    ID,
    COMPANY,
    `"full_name" TEXT NOT NULL`,
    `"employee_id" TEXT`,
    `"cell_number" TEXT NOT NULL DEFAULT ''`,
    `"license_number" TEXT NOT NULL DEFAULT ''`,
    `"issuing_date" DATE`,
    `"expiry_date" DATE`,
    `"address" TEXT NOT NULL DEFAULT ''`,
    `"status" TEXT NOT NULL DEFAULT 'Active'`,
    TIMESTAMPS,
    `CONSTRAINT "hr_drivers_pkey" PRIMARY KEY ("id")`
  ],
  [
    `CREATE UNIQUE INDEX IF NOT EXISTS "hr_drivers_company_id_full_name_key" ON "hr_drivers"("company_id", "full_name");`,
    `CREATE INDEX IF NOT EXISTS "hr_drivers_company_id_idx" ON "hr_drivers"("company_id");`
  ]
);

addTable(
  'hr_vehicle_logs',
  [
    ID,
    COMPANY,
    `"naming_series" TEXT NOT NULL DEFAULT 'HR-VLOG-.YYYY.-'`,
    `"vehicle_id" TEXT`,
    `"employee_id" TEXT`,
    `"model" TEXT NOT NULL DEFAULT ''`,
    `"make" TEXT NOT NULL DEFAULT ''`,
    `"date" DATE`,
    `"odometer" DOUBLE PRECISION NOT NULL DEFAULT 0`,
    `"last_odometer" DOUBLE PRECISION NOT NULL DEFAULT 0`,
    `"fuel_qty" DOUBLE PRECISION NOT NULL DEFAULT 0`,
    `"price" DOUBLE PRECISION NOT NULL DEFAULT 0`,
    `"supplier" TEXT NOT NULL DEFAULT ''`,
    `"invoice" TEXT NOT NULL DEFAULT ''`,
    `"service_detail" JSONB NOT NULL DEFAULT '[]'`,
    DOC,
    TIMESTAMPS,
    `CONSTRAINT "hr_vehicle_logs_pkey" PRIMARY KEY ("id")`
  ],
  [`CREATE INDEX IF NOT EXISTS "hr_vehicle_logs_company_id_idx" ON "hr_vehicle_logs"("company_id");`]
);

addTable(
  'hr_salary_withholdings',
  [
    ID,
    COMPANY,
    `"employee_id" TEXT NOT NULL`,
    `"employee_name" TEXT NOT NULL DEFAULT ''`,
    `"posting_date" DATE`,
    `"from_date" DATE`,
    `"to_date" DATE`,
    `"status" TEXT NOT NULL DEFAULT 'Draft'`,
    `"doc_status" INTEGER NOT NULL DEFAULT 0`,
    `"reason" TEXT NOT NULL DEFAULT ''`,
    `"are_withheld_salaries_released" BOOLEAN NOT NULL DEFAULT false`,
    `"cycles" JSONB NOT NULL DEFAULT '[]'`,
    TIMESTAMPS,
    `CONSTRAINT "hr_salary_withholdings_pkey" PRIMARY KEY ("id")`
  ],
  [`CREATE INDEX IF NOT EXISTS "hr_salary_withholdings_company_id_employee_id_idx" ON "hr_salary_withholdings"("company_id", "employee_id");`]
);

addTable(
  'hr_employee_benefit_ledgers',
  [
    ID,
    COMPANY,
    `"posting_date" DATE`,
    `"employee_id" TEXT`,
    `"employee_name" TEXT NOT NULL DEFAULT ''`,
    `"salary_component_id" TEXT`,
    `"payroll_period" TEXT NOT NULL DEFAULT ''`,
    `"reference_doctype" TEXT NOT NULL DEFAULT ''`,
    `"reference_document" TEXT NOT NULL DEFAULT ''`,
    `"salary_slip" TEXT NOT NULL DEFAULT ''`,
    `"transaction_type" TEXT NOT NULL DEFAULT ''`,
    `"amount" DOUBLE PRECISION NOT NULL DEFAULT 0`,
    `"remarks" TEXT NOT NULL DEFAULT ''`,
    TIMESTAMPS,
    `CONSTRAINT "hr_employee_benefit_ledgers_pkey" PRIMARY KEY ("id")`
  ],
  [`CREATE INDEX IF NOT EXISTS "hr_employee_benefit_ledgers_company_id_employee_id_idx" ON "hr_employee_benefit_ledgers"("company_id", "employee_id");`]
);

addTable(
  'hr_gratuity_rules',
  [
    ID,
    COMPANY,
    `"name" TEXT NOT NULL`,
    `"disable" BOOLEAN NOT NULL DEFAULT false`,
    `"calculate_gratuity_amount_based_on" TEXT NOT NULL DEFAULT 'Current Slab'`,
    `"total_working_days_per_year" DOUBLE PRECISION NOT NULL DEFAULT 365`,
    `"work_experience_calculation_function" TEXT NOT NULL DEFAULT 'Round off Work Experience'`,
    `"minimum_year_for_gratuity" INTEGER NOT NULL DEFAULT 0`,
    `"applicable_earnings_component" JSONB NOT NULL DEFAULT '[]'`,
    `"gratuity_rule_slabs" JSONB NOT NULL DEFAULT '[]'`,
    TIMESTAMPS,
    `CONSTRAINT "hr_gratuity_rules_pkey" PRIMARY KEY ("id")`
  ],
  [
    `CREATE UNIQUE INDEX IF NOT EXISTS "hr_gratuity_rules_company_id_name_key" ON "hr_gratuity_rules"("company_id", "name");`,
    `CREATE INDEX IF NOT EXISTS "hr_gratuity_rules_company_id_idx" ON "hr_gratuity_rules"("company_id");`
  ]
);

addTable(
  'hr_gratuities',
  [
    ID,
    COMPANY,
    `"employee_id" TEXT NOT NULL`,
    `"employee_name" TEXT NOT NULL DEFAULT ''`,
    `"department" TEXT NOT NULL DEFAULT ''`,
    `"designation" TEXT NOT NULL DEFAULT ''`,
    `"current_work_experience" DOUBLE PRECISION NOT NULL DEFAULT 0`,
    `"posting_date" DATE`,
    `"gratuity_rule_id" TEXT`,
    `"amount" DOUBLE PRECISION NOT NULL DEFAULT 0`,
    `"salary_component_id" TEXT`,
    `"pay_via_salary_slip" BOOLEAN NOT NULL DEFAULT true`,
    `"cost_center" TEXT NOT NULL DEFAULT ''`,
    `"mode_of_payment" TEXT NOT NULL DEFAULT ''`,
    `"expense_account" TEXT NOT NULL DEFAULT ''`,
    `"payable_account" TEXT NOT NULL DEFAULT ''`,
    `"paid_amount" DOUBLE PRECISION NOT NULL DEFAULT 0`,
    DOC,
    TIMESTAMPS,
    `CONSTRAINT "hr_gratuities_pkey" PRIMARY KEY ("id")`
  ],
  [`CREATE INDEX IF NOT EXISTS "hr_gratuities_company_id_employee_id_idx" ON "hr_gratuities"("company_id", "employee_id");`]
);

addTable(
  'hr_exit_interviews',
  [
    ID,
    COMPANY,
    `"naming_series" TEXT NOT NULL DEFAULT 'HR-EXIT-INT-'`,
    `"employee_id" TEXT NOT NULL`,
    `"employee_name" TEXT NOT NULL DEFAULT ''`,
    `"email" TEXT NOT NULL DEFAULT ''`,
    `"status" TEXT NOT NULL DEFAULT 'Pending'`,
    `"date" DATE`,
    `"department" TEXT NOT NULL DEFAULT ''`,
    `"designation" TEXT NOT NULL DEFAULT ''`,
    `"reports_to" TEXT NOT NULL DEFAULT ''`,
    `"date_of_joining" DATE`,
    `"relieving_date" DATE`,
    `"ref_doctype" TEXT NOT NULL DEFAULT ''`,
    `"questionnaire_email_sent" BOOLEAN NOT NULL DEFAULT false`,
    `"reference_document_name" TEXT NOT NULL DEFAULT ''`,
    `"interviewers" JSONB NOT NULL DEFAULT '[]'`,
    `"interview_summary" TEXT NOT NULL DEFAULT ''`,
    `"employee_status" TEXT NOT NULL DEFAULT ''`,
    `"doc_status" INTEGER NOT NULL DEFAULT 0`,
    TIMESTAMPS,
    `CONSTRAINT "hr_exit_interviews_pkey" PRIMARY KEY ("id")`
  ],
  [`CREATE INDEX IF NOT EXISTS "hr_exit_interviews_company_id_employee_id_idx" ON "hr_exit_interviews"("company_id", "employee_id");`]
);

addTable(
  'hr_full_and_final_statements',
  [
    ID,
    COMPANY,
    `"employee_id" TEXT NOT NULL`,
    `"employee_name" TEXT NOT NULL DEFAULT ''`,
    `"transaction_date" DATE`,
    `"status" TEXT NOT NULL DEFAULT 'Unpaid'`,
    `"doc_status" INTEGER NOT NULL DEFAULT 0`,
    `"date_of_joining" DATE`,
    `"relieving_date" DATE`,
    `"designation" TEXT NOT NULL DEFAULT ''`,
    `"department" TEXT NOT NULL DEFAULT ''`,
    `"payables" JSONB NOT NULL DEFAULT '[]'`,
    `"receivables" JSONB NOT NULL DEFAULT '[]'`,
    `"assets_allocated" JSONB NOT NULL DEFAULT '[]'`,
    `"total_asset_recovery_cost" DOUBLE PRECISION NOT NULL DEFAULT 0`,
    `"total_payable_amount" DOUBLE PRECISION NOT NULL DEFAULT 0`,
    `"total_receivable_amount" DOUBLE PRECISION NOT NULL DEFAULT 0`,
    TIMESTAMPS,
    `CONSTRAINT "hr_full_and_final_statements_pkey" PRIMARY KEY ("id")`
  ],
  [`CREATE INDEX IF NOT EXISTS "hr_full_and_final_statements_company_id_employee_id_idx" ON "hr_full_and_final_statements"("company_id", "employee_id");`]
);

addTable(
  'hr_compensatory_leave_requests',
  [
    ID,
    COMPANY,
    `"employee_id" TEXT NOT NULL`,
    `"employee_name" TEXT NOT NULL DEFAULT ''`,
    `"department" TEXT NOT NULL DEFAULT ''`,
    `"leave_type_id" TEXT`,
    `"leave_allocation_id" TEXT`,
    `"work_from_date" DATE`,
    `"work_end_date" DATE`,
    `"half_day" BOOLEAN NOT NULL DEFAULT false`,
    `"half_day_date" DATE`,
    `"reason" TEXT NOT NULL DEFAULT ''`,
    DOC,
    TIMESTAMPS,
    `CONSTRAINT "hr_compensatory_leave_requests_pkey" PRIMARY KEY ("id")`
  ],
  [`CREATE INDEX IF NOT EXISTS "hr_compensatory_leave_requests_company_id_employee_id_idx" ON "hr_compensatory_leave_requests"("company_id", "employee_id");`]
);

addTable(
  'hr_leave_adjustments',
  [
    ID,
    COMPANY,
    `"naming_series" TEXT NOT NULL DEFAULT 'HR-LAD-.YYYY.-'`,
    `"employee_id" TEXT NOT NULL`,
    `"employee_name" TEXT NOT NULL DEFAULT ''`,
    `"leave_type_id" TEXT`,
    `"leave_allocation_id" TEXT`,
    `"leaves_to_adjust" DOUBLE PRECISION NOT NULL DEFAULT 0`,
    `"posting_date" DATE`,
    `"reason_for_adjustment" TEXT NOT NULL DEFAULT ''`,
    DOC,
    TIMESTAMPS,
    `CONSTRAINT "hr_leave_adjustments_pkey" PRIMARY KEY ("id")`
  ],
  [`CREATE INDEX IF NOT EXISTS "hr_leave_adjustments_company_id_employee_id_idx" ON "hr_leave_adjustments"("company_id", "employee_id");`]
);

addTable(
  'hr_daily_work_summary_groups',
  [
    ID,
    COMPANY,
    `"name" TEXT NOT NULL`,
    `"enabled" BOOLEAN NOT NULL DEFAULT true`,
    `"users" JSONB NOT NULL DEFAULT '[]'`,
    `"send_emails_at" TEXT NOT NULL DEFAULT '17:00'`,
    `"holiday_list_id" TEXT`,
    `"subject" TEXT NOT NULL DEFAULT 'What did you work on today?'`,
    `"message" TEXT NOT NULL DEFAULT ''`,
    TIMESTAMPS,
    `CONSTRAINT "hr_daily_work_summary_groups_pkey" PRIMARY KEY ("id")`
  ],
  [
    `CREATE UNIQUE INDEX IF NOT EXISTS "hr_daily_work_summary_groups_company_id_name_key" ON "hr_daily_work_summary_groups"("company_id", "name");`,
    `CREATE INDEX IF NOT EXISTS "hr_daily_work_summary_groups_company_id_idx" ON "hr_daily_work_summary_groups"("company_id");`
  ]
);

addTable(
  'hr_daily_work_summaries',
  [
    ID,
    COMPANY,
    `"daily_work_summary_group_id" TEXT`,
    `"status" TEXT NOT NULL DEFAULT 'Open'`,
    `"email_sent_to" TEXT NOT NULL DEFAULT ''`,
    `"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    `"updated_at" TIMESTAMP(3) NOT NULL`,
    `CONSTRAINT "hr_daily_work_summaries_pkey" PRIMARY KEY ("id")`
  ],
  [`CREATE INDEX IF NOT EXISTS "hr_daily_work_summaries_company_id_idx" ON "hr_daily_work_summaries"("company_id");`]
);

const migrationSql =
  `-- Remaining ERPNext HR DocTypes that were previously stubbed in the workspace nav.\n` +
  `-- Additive only.\n\n` +
  migrationParts.join('\n\n') +
  '\n';

fs.writeFileSync(
  path.join(ROOT, 'prisma/migrations/20261028140000_hrms_parity_gap/migration.sql'),
  migrationSql
);

const prismaModels = `
${SCHEMA_MARKER}

model HrShiftSchedule {
  id           String   @id @default(uuid())
  companyId    String   @map("company_id")
  name         String
  shiftTypeId  String?  @map("shift_type_id")
  frequency    String   @default("Every Week")
  repeatOnDays Json     @default("[]") @map("repeat_on_days")
  status       String   @default("Draft")
  docStatus    Int      @default(0) @map("doc_status")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@unique([companyId, name])
  @@index([companyId])
  @@map("hr_shift_schedules")
}

model HrShiftScheduleAssignment {
  id               String    @id @default(uuid())
  companyId        String    @map("company_id")
  employeeId       String    @map("employee_id")
  employeeName     String    @default("") @map("employee_name")
  shiftScheduleId  String?   @map("shift_schedule_id")
  shiftLocationId  String?   @map("shift_location_id")
  shiftStatus      String    @default("Active") @map("shift_status")
  enabled          Boolean   @default(true)
  createShiftsAfter DateTime? @map("create_shifts_after") @db.Date
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")

  @@index([companyId, employeeId])
  @@map("hr_shift_schedule_assignments")
}

model HrPurposeOfTravel {
  id              String   @id @default(uuid())
  companyId       String   @map("company_id")
  purposeOfTravel String   @map("purpose_of_travel")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@unique([companyId, purposeOfTravel])
  @@index([companyId])
  @@map("hr_purposes_of_travel")
}

model HrTravelRequest {
  id                 String   @id @default(uuid())
  companyId          String   @map("company_id")
  employeeId         String   @map("employee_id")
  employeeName       String   @default("") @map("employee_name")
  travelType         String   @default("Domestic") @map("travel_type")
  travelFunding      String   @default("") @map("travel_funding")
  travelProof        String   @default("") @map("travel_proof")
  purposeOfTravelId  String?  @map("purpose_of_travel_id")
  detailsOfSponsor   String   @default("") @map("details_of_sponsor")
  description        String   @default("")
  itinerary          Json     @default("[]")
  costings           Json     @default("[]")
  costCenter         String   @default("") @map("cost_center")
  personalIdType     String   @default("") @map("personal_id_type")
  personalIdNumber   String   @default("") @map("personal_id_number")
  nameOfOrganizer    String   @default("") @map("name_of_organizer")
  addressOfOrganizer String   @default("") @map("address_of_organizer")
  otherDetails       String   @default("") @map("other_details")
  status             String   @default("Draft")
  docStatus          Int      @default(0) @map("doc_status")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  @@index([companyId, employeeId])
  @@map("hr_travel_requests")
}

model HrVehicle {
  id              String    @id @default(uuid())
  companyId       String    @map("company_id")
  licensePlate    String    @map("license_plate")
  make            String    @default("")
  model           String    @default("")
  employeeId      String?   @map("employee_id")
  odometer        Float     @default(0)
  fuelType        String    @default("") @map("fuel_type")
  uom             String    @default("Litre")
  location        String    @default("")
  chassisNo       String    @default("") @map("chassis_no")
  acquisitionDate DateTime? @map("acquisition_date") @db.Date
  disabled        Boolean   @default(false)
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@unique([companyId, licensePlate])
  @@index([companyId])
  @@map("hr_vehicles")
}

model HrDriver {
  id            String    @id @default(uuid())
  companyId     String    @map("company_id")
  fullName      String    @map("full_name")
  employeeId    String?   @map("employee_id")
  cellNumber    String    @default("") @map("cell_number")
  licenseNumber String    @default("") @map("license_number")
  issuingDate   DateTime? @map("issuing_date") @db.Date
  expiryDate    DateTime? @map("expiry_date") @db.Date
  address       String    @default("")
  status        String    @default("Active")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  @@unique([companyId, fullName])
  @@index([companyId])
  @@map("hr_drivers")
}

model HrVehicleLog {
  id            String    @id @default(uuid())
  companyId     String    @map("company_id")
  namingSeries  String    @default("HR-VLOG-.YYYY.-") @map("naming_series")
  vehicleId     String?   @map("vehicle_id")
  employeeId    String?   @map("employee_id")
  model         String    @default("")
  make          String    @default("")
  date          DateTime? @db.Date
  odometer      Float     @default(0)
  lastOdometer  Float     @default(0) @map("last_odometer")
  fuelQty       Float     @default(0) @map("fuel_qty")
  price         Float     @default(0)
  supplier      String    @default("")
  invoice       String    @default("")
  serviceDetail Json      @default("[]") @map("service_detail")
  status        String    @default("Draft")
  docStatus     Int       @default(0) @map("doc_status")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  @@index([companyId])
  @@map("hr_vehicle_logs")
}

model HrSalaryWithholding {
  id                         String    @id @default(uuid())
  companyId                  String    @map("company_id")
  employeeId                 String    @map("employee_id")
  employeeName               String    @default("") @map("employee_name")
  postingDate                DateTime? @map("posting_date") @db.Date
  fromDate                   DateTime? @map("from_date") @db.Date
  toDate                     DateTime? @map("to_date") @db.Date
  status                     String    @default("Draft")
  docStatus                  Int       @default(0) @map("doc_status")
  reason                     String    @default("")
  areWithheldSalariesReleased Boolean  @default(false) @map("are_withheld_salaries_released")
  cycles                     Json      @default("[]")
  createdAt                  DateTime  @default(now()) @map("created_at")
  updatedAt                  DateTime  @updatedAt @map("updated_at")

  @@index([companyId, employeeId])
  @@map("hr_salary_withholdings")
}

model HrEmployeeBenefitLedger {
  id                 String    @id @default(uuid())
  companyId          String    @map("company_id")
  postingDate        DateTime? @map("posting_date") @db.Date
  employeeId         String?   @map("employee_id")
  employeeName       String    @default("") @map("employee_name")
  salaryComponentId  String?   @map("salary_component_id")
  payrollPeriod      String    @default("") @map("payroll_period")
  referenceDoctype   String    @default("") @map("reference_doctype")
  referenceDocument  String    @default("") @map("reference_document")
  salarySlip         String    @default("") @map("salary_slip")
  transactionType    String    @default("") @map("transaction_type")
  amount             Float     @default(0)
  remarks            String    @default("")
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  @@index([companyId, employeeId])
  @@map("hr_employee_benefit_ledgers")
}

model HrGratuityRule {
  id                               String   @id @default(uuid())
  companyId                        String   @map("company_id")
  name                             String
  disable                          Boolean  @default(false)
  calculateGratuityAmountBasedOn   String   @default("Current Slab") @map("calculate_gratuity_amount_based_on")
  totalWorkingDaysPerYear          Float    @default(365) @map("total_working_days_per_year")
  workExperienceCalculationFunction String  @default("Round off Work Experience") @map("work_experience_calculation_function")
  minimumYearForGratuity           Int      @default(0) @map("minimum_year_for_gratuity")
  applicableEarningsComponent      Json     @default("[]") @map("applicable_earnings_component")
  gratuityRuleSlabs                Json     @default("[]") @map("gratuity_rule_slabs")
  createdAt                        DateTime @default(now()) @map("created_at")
  updatedAt                        DateTime @updatedAt @map("updated_at")

  @@unique([companyId, name])
  @@index([companyId])
  @@map("hr_gratuity_rules")
}

model HrGratuity {
  id                    String    @id @default(uuid())
  companyId             String    @map("company_id")
  employeeId            String    @map("employee_id")
  employeeName          String    @default("") @map("employee_name")
  department            String    @default("")
  designation           String    @default("")
  currentWorkExperience Float     @default(0) @map("current_work_experience")
  postingDate           DateTime? @map("posting_date") @db.Date
  gratuityRuleId        String?   @map("gratuity_rule_id")
  amount                Float     @default(0)
  salaryComponentId     String?   @map("salary_component_id")
  payViaSalarySlip      Boolean   @default(true) @map("pay_via_salary_slip")
  costCenter            String    @default("") @map("cost_center")
  modeOfPayment         String    @default("") @map("mode_of_payment")
  expenseAccount        String    @default("") @map("expense_account")
  payableAccount        String    @default("") @map("payable_account")
  paidAmount            Float     @default(0) @map("paid_amount")
  status                String    @default("Draft")
  docStatus             Int       @default(0) @map("doc_status")
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")

  @@index([companyId, employeeId])
  @@map("hr_gratuities")
}

model HrExitInterview {
  id                      String    @id @default(uuid())
  companyId               String    @map("company_id")
  namingSeries            String    @default("HR-EXIT-INT-") @map("naming_series")
  employeeId              String    @map("employee_id")
  employeeName            String    @default("") @map("employee_name")
  email                   String    @default("")
  status                  String    @default("Pending")
  date                    DateTime? @db.Date
  department              String    @default("")
  designation             String    @default("")
  reportsTo               String    @default("") @map("reports_to")
  dateOfJoining           DateTime? @map("date_of_joining") @db.Date
  relievingDate           DateTime? @map("relieving_date") @db.Date
  refDoctype              String    @default("") @map("ref_doctype")
  questionnaireEmailSent  Boolean   @default(false) @map("questionnaire_email_sent")
  referenceDocumentName   String    @default("") @map("reference_document_name")
  interviewers            Json      @default("[]")
  interviewSummary        String    @default("") @map("interview_summary")
  employeeStatus          String    @default("") @map("employee_status")
  docStatus               Int       @default(0) @map("doc_status")
  createdAt               DateTime  @default(now()) @map("created_at")
  updatedAt               DateTime  @updatedAt @map("updated_at")

  @@index([companyId, employeeId])
  @@map("hr_exit_interviews")
}

model HrFullAndFinalStatement {
  id                      String    @id @default(uuid())
  companyId               String    @map("company_id")
  employeeId              String    @map("employee_id")
  employeeName            String    @default("") @map("employee_name")
  transactionDate         DateTime? @map("transaction_date") @db.Date
  status                  String    @default("Unpaid")
  docStatus               Int       @default(0) @map("doc_status")
  dateOfJoining           DateTime? @map("date_of_joining") @db.Date
  relievingDate           DateTime? @map("relieving_date") @db.Date
  designation             String    @default("")
  department              String    @default("")
  payables                Json      @default("[]")
  receivables             Json      @default("[]")
  assetsAllocated         Json      @default("[]") @map("assets_allocated")
  totalAssetRecoveryCost  Float     @default(0) @map("total_asset_recovery_cost")
  totalPayableAmount      Float     @default(0) @map("total_payable_amount")
  totalReceivableAmount   Float     @default(0) @map("total_receivable_amount")
  createdAt               DateTime  @default(now()) @map("created_at")
  updatedAt               DateTime  @updatedAt @map("updated_at")

  @@index([companyId, employeeId])
  @@map("hr_full_and_final_statements")
}

model HrCompensatoryLeaveRequest {
  id                 String    @id @default(uuid())
  companyId          String    @map("company_id")
  employeeId         String    @map("employee_id")
  employeeName       String    @default("") @map("employee_name")
  department         String    @default("")
  leaveTypeId        String?   @map("leave_type_id")
  leaveAllocationId  String?   @map("leave_allocation_id")
  workFromDate       DateTime? @map("work_from_date") @db.Date
  workEndDate        DateTime? @map("work_end_date") @db.Date
  halfDay            Boolean   @default(false) @map("half_day")
  halfDayDate        DateTime? @map("half_day_date") @db.Date
  reason             String    @default("")
  status             String    @default("Draft")
  docStatus          Int       @default(0) @map("doc_status")
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  @@index([companyId, employeeId])
  @@map("hr_compensatory_leave_requests")
}

model HrLeaveAdjustment {
  id                   String    @id @default(uuid())
  companyId            String    @map("company_id")
  namingSeries         String    @default("HR-LAD-.YYYY.-") @map("naming_series")
  employeeId           String    @map("employee_id")
  employeeName         String    @default("") @map("employee_name")
  leaveTypeId          String?   @map("leave_type_id")
  leaveAllocationId    String?   @map("leave_allocation_id")
  leavesToAdjust       Float     @default(0) @map("leaves_to_adjust")
  postingDate          DateTime? @map("posting_date") @db.Date
  reasonForAdjustment  String    @default("") @map("reason_for_adjustment")
  status               String    @default("Draft")
  docStatus            Int       @default(0) @map("doc_status")
  createdAt            DateTime  @default(now()) @map("created_at")
  updatedAt            DateTime  @updatedAt @map("updated_at")

  @@index([companyId, employeeId])
  @@map("hr_leave_adjustments")
}

model HrDailyWorkSummaryGroup {
  id            String   @id @default(uuid())
  companyId     String   @map("company_id")
  name          String
  enabled       Boolean  @default(true)
  users         Json     @default("[]")
  sendEmailsAt  String   @default("17:00") @map("send_emails_at")
  holidayListId String?  @map("holiday_list_id")
  subject       String   @default("What did you work on today?")
  message       String   @default("")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@unique([companyId, name])
  @@index([companyId])
  @@map("hr_daily_work_summary_groups")
}

model HrDailyWorkSummary {
  id                        String   @id @default(uuid())
  companyId                 String   @map("company_id")
  dailyWorkSummaryGroupId   String?  @map("daily_work_summary_group_id")
  status                    String   @default("Open")
  emailSentTo               String   @default("") @map("email_sent_to")
  createdAt                 DateTime @default(now()) @map("created_at")
  updatedAt                 DateTime @updatedAt @map("updated_at")

  @@index([companyId])
  @@map("hr_daily_work_summaries")
}
`;

const schemaPath = path.join(ROOT, 'prisma/schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');
if (!schema.includes(SCHEMA_MARKER)) {
  schema = schema.trimEnd() + '\n' + prismaModels;
  fs.writeFileSync(schemaPath, schema);
  console.log('Appended Prisma models');
} else {
  console.log('Prisma models already present — skipped');
}

const registryEntries = `
  ${MARKER}
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
    statuses: ['Unpaid', 'Paid', 'Cancelled'],
    actions: [
      { key: 'submit', label: 'Submit', from: ['Unpaid'], to: 'Unpaid', action: 'edit' },
      { key: 'pay', label: 'Mark Paid', from: ['Unpaid'], to: 'Paid', action: 'edit' },
      { key: 'cancel', label: 'Cancel', from: ['Unpaid', 'Paid'], to: 'Cancelled', action: 'edit' }
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
`;

const registryPath = path.join(ROOT, 'services/hrDocumentRegistry.js');
let registrySrc = fs.readFileSync(registryPath, 'utf8');
if (!registrySrc.includes(MARKER)) {
  // Insert before closing `};` of registry object (the one before MANAGER_ONLY)
  const needle = `\n};\n\n// Documents that must never be created`;
  if (!registrySrc.includes(needle)) {
    throw new Error('Could not locate registry insertion point');
  }
  registrySrc = registrySrc.replace(needle, `,${registryEntries}};\n\n// Documents that must never be created`);
  // Expand MANAGER_ONLY
  registrySrc = registrySrc.replace(
    `'employee-feedback-criteria'\n]);`,
    `'employee-feedback-criteria',\n  'shift-schedule', 'purpose-of-travel', 'vehicle', 'driver', 'gratuity-rule',\n  'daily-work-summary-group'\n]);`
  );
  fs.writeFileSync(registryPath, registrySrc);
  console.log('Appended registry entries');
} else {
  console.log('Registry entries already present — skipped');
}

console.log('Done. Migration + schema + registry ready.');
