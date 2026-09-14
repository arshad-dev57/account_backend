-- Manufacturing module tables


-- CreateTable
CREATE TABLE "manufacturing_boms" (
    "id" TEXT NOT NULL,
    "bom_number" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "description" TEXT,
    "notes" TEXT,
    "total_estimated_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "location_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_boms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_bom_components" (
    "id" TEXT NOT NULL,
    "bom_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "component_name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_of_measure" TEXT NOT NULL,
    "scrap_percentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "substitute_material" TEXT,
    "operation_sequence" INTEGER,
    "work_center_id" TEXT,
    "estimated_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "manufacturing_bom_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_routings" (
    "id" TEXT NOT NULL,
    "routing_number" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "description" TEXT,
    "notes" TEXT,
    "total_estimated_time" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_estimated_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_routings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_routing_operations" (
    "id" TEXT NOT NULL,
    "routing_id" TEXT NOT NULL,
    "operation_name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "work_center_id" TEXT NOT NULL,
    "machine_id" TEXT,
    "description" TEXT,
    "setup_time" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "run_time" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "queue_time" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "labor_requirement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "machine_requirement" BOOLEAN NOT NULL DEFAULT false,
    "inspection_required" BOOLEAN NOT NULL DEFAULT false,
    "estimated_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "manufacturing_routing_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_work_centers" (
    "id" TEXT NOT NULL,
    "work_center_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "location_id" TEXT,
    "factory" TEXT,
    "capacity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "working_hours" JSONB,
    "shift" TEXT,
    "efficiency" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "cost_per_hour" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "description" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_work_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_machines" (
    "id" TEXT NOT NULL,
    "machine_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serial_number" TEXT,
    "model" TEXT,
    "manufacturer" TEXT,
    "work_center_id" TEXT,
    "location_id" TEXT,
    "purchase_date" TIMESTAMP(3),
    "installation_date" TIMESTAMP(3),
    "current_status" TEXT NOT NULL DEFAULT 'Idle',
    "hourly_operating_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maintenance_schedule" JSONB,
    "capacity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "efficiency" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "description" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_production_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "bom_id" TEXT,
    "bom_version" TEXT,
    "routing_id" TEXT,
    "planned_quantity" DOUBLE PRECISION NOT NULL,
    "produced_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scrap_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rework_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remaining_quantity" DOUBLE PRECISION NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "actual_start_date" TIMESTAMP(3),
    "actual_end_date" TIMESTAMP(3),
    "source_warehouse_id" TEXT,
    "wip_warehouse_id" TEXT,
    "finished_goods_warehouse_id" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'Normal',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "description" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "location_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_work_orders" (
    "id" TEXT NOT NULL,
    "work_order_number" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "operation_name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "work_center_id" TEXT NOT NULL,
    "machine_id" TEXT,
    "employee_id" TEXT,
    "planned_quantity" DOUBLE PRECISION NOT NULL,
    "completed_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rejected_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scrap_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "start_time" TIMESTAMP(3),
    "end_time" TIMESTAMP(3),
    "downtime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_material_reservations" (
    "id" TEXT NOT NULL,
    "reservation_number" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "component_name" TEXT NOT NULL,
    "required_quantity" DOUBLE PRECISION NOT NULL,
    "available_quantity" DOUBLE PRECISION NOT NULL,
    "reserved_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shortage_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "location_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_material_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_material_issues" (
    "id" TEXT NOT NULL,
    "issue_number" TEXT NOT NULL,
    "reservation_id" TEXT,
    "production_order_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "component_name" TEXT NOT NULL,
    "issued_quantity" DOUBLE PRECISION NOT NULL,
    "unit_of_measure" TEXT NOT NULL,
    "from_location_id" TEXT NOT NULL,
    "to_location_id" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Issued',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_material_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_material_consumptions" (
    "id" TEXT NOT NULL,
    "material_issue_id" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "component_name" TEXT NOT NULL,
    "required_quantity" DOUBLE PRECISION NOT NULL,
    "consumed_quantity" DOUBLE PRECISION NOT NULL,
    "variance_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit_of_measure" TEXT NOT NULL,
    "consumption_date" TIMESTAMP(3) NOT NULL,
    "work_order_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_material_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_wips" (
    "id" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "current_operation" TEXT,
    "work_center_id" TEXT,
    "location_id" TEXT,
    "start_time" TIMESTAMP(3) NOT NULL,
    "expected_completion" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'InProgress',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_wips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_scraps" (
    "id" TEXT NOT NULL,
    "scrap_number" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "work_order_id" TEXT,
    "product_id" TEXT,
    "product_name" TEXT,
    "material_id" TEXT,
    "material_name" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_of_measure" TEXT NOT NULL,
    "reason" TEXT,
    "work_center_id" TEXT,
    "machine_id" TEXT,
    "operator_id" TEXT,
    "scrap_date" TIMESTAMP(3) NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_scraps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_by_products" (
    "id" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_of_measure" TEXT NOT NULL,
    "location_id" TEXT,
    "received_date" TIMESTAMP(3) NOT NULL,
    "cost_allocation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_by_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_reworks" (
    "id" TEXT NOT NULL,
    "rework_number" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "work_order_id" TEXT,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_of_measure" TEXT NOT NULL,
    "reason" TEXT,
    "work_center_id" TEXT,
    "operator_id" TEXT,
    "rework_date" TIMESTAMP(3) NOT NULL,
    "estimated_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actual_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_reworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_quality_inspections" (
    "id" TEXT NOT NULL,
    "inspection_number" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "work_order_id" TEXT,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "operation_name" TEXT,
    "inspector_id" TEXT NOT NULL,
    "inspection_date" TIMESTAMP(3) NOT NULL,
    "inspection_type" TEXT NOT NULL,
    "result" TEXT NOT NULL DEFAULT 'Pending',
    "parameters" JSONB,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_quality_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_quality_parameters" (
    "id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "parameter_name" TEXT NOT NULL,
    "expected_value" DOUBLE PRECISION NOT NULL,
    "actual_value" DOUBLE PRECISION NOT NULL,
    "tolerance" DOUBLE PRECISION,
    "unit_of_measure" TEXT NOT NULL,
    "result" TEXT NOT NULL DEFAULT 'Pass',
    "notes" TEXT,

    CONSTRAINT "manufacturing_quality_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_maintenance_requests" (
    "id" TEXT NOT NULL,
    "request_number" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "request_type" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'Normal',
    "description" TEXT,
    "requested_date" TIMESTAMP(3) NOT NULL,
    "requested_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_maintenance_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "request_id" TEXT,
    "machine_id" TEXT NOT NULL,
    "technician_id" TEXT,
    "description" TEXT,
    "scheduled_start" TIMESTAMP(3),
    "scheduled_end" TIMESTAMP(3),
    "actual_start" TIMESTAMP(3),
    "actual_end" TIMESTAMP(3),
    "downtime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Scheduled',
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_maintenance_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_subcontract_vendors" (
    "id" TEXT NOT NULL,
    "vendor_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capacity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lead_time_days" INTEGER NOT NULL DEFAULT 0,
    "quality_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cost_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "delivery_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_subcontract_vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_subcontract_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "production_order_id" TEXT,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_of_measure" TEXT NOT NULL,
    "unit_cost" DOUBLE PRECISION NOT NULL,
    "total_cost" DOUBLE PRECISION NOT NULL,
    "order_date" TIMESTAMP(3) NOT NULL,
    "expected_delivery_date" TIMESTAMP(3) NOT NULL,
    "actual_delivery_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_subcontract_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_subcontract_materials_sent" (
    "id" TEXT NOT NULL,
    "subcontract_order_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "material_name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_of_measure" TEXT NOT NULL,
    "sent_date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "manufacturing_subcontract_materials_sent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_subcontract_materials_received" (
    "id" TEXT NOT NULL,
    "subcontract_order_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "material_name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_of_measure" TEXT NOT NULL,
    "received_date" TIMESTAMP(3) NOT NULL,
    "quality_status" TEXT NOT NULL DEFAULT 'Accepted',
    "notes" TEXT,

    CONSTRAINT "manufacturing_subcontract_materials_received_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_mrps" (
    "id" TEXT NOT NULL,
    "mrp_number" TEXT NOT NULL,
    "run_date" TIMESTAMP(3) NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Calculated',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_mrps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_mrp_items" (
    "id" TEXT NOT NULL,
    "mrp_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "material_name" TEXT NOT NULL,
    "required_quantity" DOUBLE PRECISION NOT NULL,
    "available_quantity" DOUBLE PRECISION NOT NULL,
    "reserved_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "incoming_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shortage_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "suggested_purchase_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "suggested_production_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "manufacturing_mrp_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_mps" (
    "id" TEXT NOT NULL,
    "mps_number" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "month" TEXT,
    "year" INTEGER NOT NULL,
    "planned_quantity" DOUBLE PRECISION NOT NULL,
    "actual_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "location_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Planned',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_mps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_demands" (
    "id" TEXT NOT NULL,
    "demand_number" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "demand_type" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "required_date" TIMESTAMP(3) NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'Normal',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_demands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_product_costs" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "material_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "labor_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "machine_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overhead_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subcontract_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cost_type" TEXT NOT NULL DEFAULT 'Standard',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_product_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_cost_variances" (
    "id" TEXT NOT NULL,
    "product_cost_id" TEXT NOT NULL,
    "production_order_id" TEXT,
    "variance_type" TEXT NOT NULL,
    "standard_cost" DOUBLE PRECISION NOT NULL,
    "actual_cost" DOUBLE PRECISION NOT NULL,
    "variance_amount" DOUBLE PRECISION NOT NULL,
    "variance_percentage" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "variance_date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "manufacturing_cost_variances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_boms_bom_number_key" ON "manufacturing_boms"("bom_number");

-- CreateIndex
CREATE INDEX "manufacturing_boms_bom_number_idx" ON "manufacturing_boms"("bom_number");

-- CreateIndex
CREATE INDEX "manufacturing_boms_product_id_idx" ON "manufacturing_boms"("product_id");

-- CreateIndex
CREATE INDEX "manufacturing_boms_status_idx" ON "manufacturing_boms"("status");

-- CreateIndex
CREATE INDEX "manufacturing_boms_company_id_idx" ON "manufacturing_boms"("company_id");

-- CreateIndex
CREATE INDEX "manufacturing_boms_location_id_idx" ON "manufacturing_boms"("location_id");

-- CreateIndex
CREATE INDEX "manufacturing_bom_components_bom_id_idx" ON "manufacturing_bom_components"("bom_id");

-- CreateIndex
CREATE INDEX "manufacturing_bom_components_component_id_idx" ON "manufacturing_bom_components"("component_id");

-- CreateIndex
CREATE INDEX "manufacturing_bom_components_work_center_id_idx" ON "manufacturing_bom_components"("work_center_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_routings_routing_number_key" ON "manufacturing_routings"("routing_number");

-- CreateIndex
CREATE INDEX "manufacturing_routings_routing_number_idx" ON "manufacturing_routings"("routing_number");

-- CreateIndex
CREATE INDEX "manufacturing_routings_product_id_idx" ON "manufacturing_routings"("product_id");

-- CreateIndex
CREATE INDEX "manufacturing_routings_status_idx" ON "manufacturing_routings"("status");

-- CreateIndex
CREATE INDEX "manufacturing_routings_company_id_idx" ON "manufacturing_routings"("company_id");

-- CreateIndex
CREATE INDEX "manufacturing_routing_operations_routing_id_idx" ON "manufacturing_routing_operations"("routing_id");

-- CreateIndex
CREATE INDEX "manufacturing_routing_operations_work_center_id_idx" ON "manufacturing_routing_operations"("work_center_id");

-- CreateIndex
CREATE INDEX "manufacturing_routing_operations_machine_id_idx" ON "manufacturing_routing_operations"("machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_work_centers_work_center_code_key" ON "manufacturing_work_centers"("work_center_code");

-- CreateIndex
CREATE INDEX "manufacturing_work_centers_work_center_code_idx" ON "manufacturing_work_centers"("work_center_code");

-- CreateIndex
CREATE INDEX "manufacturing_work_centers_location_id_idx" ON "manufacturing_work_centers"("location_id");

-- CreateIndex
CREATE INDEX "manufacturing_work_centers_status_idx" ON "manufacturing_work_centers"("status");

-- CreateIndex
CREATE INDEX "manufacturing_work_centers_company_id_idx" ON "manufacturing_work_centers"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_machines_machine_code_key" ON "manufacturing_machines"("machine_code");

-- CreateIndex
CREATE INDEX "manufacturing_machines_machine_code_idx" ON "manufacturing_machines"("machine_code");

-- CreateIndex
CREATE INDEX "manufacturing_machines_work_center_id_idx" ON "manufacturing_machines"("work_center_id");

-- CreateIndex
CREATE INDEX "manufacturing_machines_location_id_idx" ON "manufacturing_machines"("location_id");

-- CreateIndex
CREATE INDEX "manufacturing_machines_current_status_idx" ON "manufacturing_machines"("current_status");

-- CreateIndex
CREATE INDEX "manufacturing_machines_company_id_idx" ON "manufacturing_machines"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_production_orders_order_number_key" ON "manufacturing_production_orders"("order_number");

-- CreateIndex
CREATE INDEX "manufacturing_production_orders_order_number_idx" ON "manufacturing_production_orders"("order_number");

-- CreateIndex
CREATE INDEX "manufacturing_production_orders_product_id_idx" ON "manufacturing_production_orders"("product_id");

-- CreateIndex
CREATE INDEX "manufacturing_production_orders_status_idx" ON "manufacturing_production_orders"("status");

-- CreateIndex
CREATE INDEX "manufacturing_production_orders_start_date_idx" ON "manufacturing_production_orders"("start_date");

-- CreateIndex
CREATE INDEX "manufacturing_production_orders_due_date_idx" ON "manufacturing_production_orders"("due_date");

-- CreateIndex
CREATE INDEX "manufacturing_production_orders_company_id_idx" ON "manufacturing_production_orders"("company_id");

-- CreateIndex
CREATE INDEX "manufacturing_production_orders_location_id_idx" ON "manufacturing_production_orders"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_work_orders_work_order_number_key" ON "manufacturing_work_orders"("work_order_number");

-- CreateIndex
CREATE INDEX "manufacturing_work_orders_work_order_number_idx" ON "manufacturing_work_orders"("work_order_number");

-- CreateIndex
CREATE INDEX "manufacturing_work_orders_production_order_id_idx" ON "manufacturing_work_orders"("production_order_id");

-- CreateIndex
CREATE INDEX "manufacturing_work_orders_work_center_id_idx" ON "manufacturing_work_orders"("work_center_id");

-- CreateIndex
CREATE INDEX "manufacturing_work_orders_status_idx" ON "manufacturing_work_orders"("status");

-- CreateIndex
CREATE INDEX "manufacturing_work_orders_company_id_idx" ON "manufacturing_work_orders"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_material_reservations_reservation_number_key" ON "manufacturing_material_reservations"("reservation_number");

-- CreateIndex
CREATE INDEX "manufacturing_material_reservations_reservation_number_idx" ON "manufacturing_material_reservations"("reservation_number");

-- CreateIndex
CREATE INDEX "manufacturing_material_reservations_production_order_id_idx" ON "manufacturing_material_reservations"("production_order_id");

-- CreateIndex
CREATE INDEX "manufacturing_material_reservations_component_id_idx" ON "manufacturing_material_reservations"("component_id");

-- CreateIndex
CREATE INDEX "manufacturing_material_reservations_status_idx" ON "manufacturing_material_reservations"("status");

-- CreateIndex
CREATE INDEX "manufacturing_material_reservations_company_id_idx" ON "manufacturing_material_reservations"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_material_issues_issue_number_key" ON "manufacturing_material_issues"("issue_number");

-- CreateIndex
CREATE INDEX "manufacturing_material_issues_issue_number_idx" ON "manufacturing_material_issues"("issue_number");

-- CreateIndex
CREATE INDEX "manufacturing_material_issues_reservation_id_idx" ON "manufacturing_material_issues"("reservation_id");

-- CreateIndex
CREATE INDEX "manufacturing_material_issues_production_order_id_idx" ON "manufacturing_material_issues"("production_order_id");

-- CreateIndex
CREATE INDEX "manufacturing_material_issues_component_id_idx" ON "manufacturing_material_issues"("component_id");

-- CreateIndex
CREATE INDEX "manufacturing_material_issues_company_id_idx" ON "manufacturing_material_issues"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_material_consumptions_material_issue_id_key" ON "manufacturing_material_consumptions"("material_issue_id");

-- CreateIndex
CREATE INDEX "manufacturing_material_consumptions_material_issue_id_idx" ON "manufacturing_material_consumptions"("material_issue_id");

-- CreateIndex
CREATE INDEX "manufacturing_material_consumptions_production_order_id_idx" ON "manufacturing_material_consumptions"("production_order_id");

-- CreateIndex
CREATE INDEX "manufacturing_material_consumptions_component_id_idx" ON "manufacturing_material_consumptions"("component_id");

-- CreateIndex
CREATE INDEX "manufacturing_material_consumptions_company_id_idx" ON "manufacturing_material_consumptions"("company_id");

-- CreateIndex
CREATE INDEX "manufacturing_wips_production_order_id_idx" ON "manufacturing_wips"("production_order_id");

-- CreateIndex
CREATE INDEX "manufacturing_wips_product_id_idx" ON "manufacturing_wips"("product_id");

-- CreateIndex
CREATE INDEX "manufacturing_wips_status_idx" ON "manufacturing_wips"("status");

-- CreateIndex
CREATE INDEX "manufacturing_wips_company_id_idx" ON "manufacturing_wips"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_scraps_scrap_number_key" ON "manufacturing_scraps"("scrap_number");

-- CreateIndex
CREATE INDEX "manufacturing_scraps_scrap_number_idx" ON "manufacturing_scraps"("scrap_number");

-- CreateIndex
CREATE INDEX "manufacturing_scraps_production_order_id_idx" ON "manufacturing_scraps"("production_order_id");

-- CreateIndex
CREATE INDEX "manufacturing_scraps_scrap_date_idx" ON "manufacturing_scraps"("scrap_date");

-- CreateIndex
CREATE INDEX "manufacturing_scraps_company_id_idx" ON "manufacturing_scraps"("company_id");

-- CreateIndex
CREATE INDEX "manufacturing_by_products_production_order_id_idx" ON "manufacturing_by_products"("production_order_id");

-- CreateIndex
CREATE INDEX "manufacturing_by_products_product_id_idx" ON "manufacturing_by_products"("product_id");

-- CreateIndex
CREATE INDEX "manufacturing_by_products_company_id_idx" ON "manufacturing_by_products"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_reworks_rework_number_key" ON "manufacturing_reworks"("rework_number");

-- CreateIndex
CREATE INDEX "manufacturing_reworks_rework_number_idx" ON "manufacturing_reworks"("rework_number");

-- CreateIndex
CREATE INDEX "manufacturing_reworks_production_order_id_idx" ON "manufacturing_reworks"("production_order_id");

-- CreateIndex
CREATE INDEX "manufacturing_reworks_status_idx" ON "manufacturing_reworks"("status");

-- CreateIndex
CREATE INDEX "manufacturing_reworks_company_id_idx" ON "manufacturing_reworks"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_quality_inspections_inspection_number_key" ON "manufacturing_quality_inspections"("inspection_number");

-- CreateIndex
CREATE INDEX "manufacturing_quality_inspections_inspection_number_idx" ON "manufacturing_quality_inspections"("inspection_number");

-- CreateIndex
CREATE INDEX "manufacturing_quality_inspections_production_order_id_idx" ON "manufacturing_quality_inspections"("production_order_id");

-- CreateIndex
CREATE INDEX "manufacturing_quality_inspections_inspection_date_idx" ON "manufacturing_quality_inspections"("inspection_date");

-- CreateIndex
CREATE INDEX "manufacturing_quality_inspections_result_idx" ON "manufacturing_quality_inspections"("result");

-- CreateIndex
CREATE INDEX "manufacturing_quality_inspections_company_id_idx" ON "manufacturing_quality_inspections"("company_id");

-- CreateIndex
CREATE INDEX "manufacturing_quality_parameters_inspection_id_idx" ON "manufacturing_quality_parameters"("inspection_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_maintenance_requests_request_number_key" ON "manufacturing_maintenance_requests"("request_number");

-- CreateIndex
CREATE INDEX "manufacturing_maintenance_requests_request_number_idx" ON "manufacturing_maintenance_requests"("request_number");

-- CreateIndex
CREATE INDEX "manufacturing_maintenance_requests_machine_id_idx" ON "manufacturing_maintenance_requests"("machine_id");

-- CreateIndex
CREATE INDEX "manufacturing_maintenance_requests_status_idx" ON "manufacturing_maintenance_requests"("status");

-- CreateIndex
CREATE INDEX "manufacturing_maintenance_requests_company_id_idx" ON "manufacturing_maintenance_requests"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_maintenance_orders_order_number_key" ON "manufacturing_maintenance_orders"("order_number");

-- CreateIndex
CREATE INDEX "manufacturing_maintenance_orders_order_number_idx" ON "manufacturing_maintenance_orders"("order_number");

-- CreateIndex
CREATE INDEX "manufacturing_maintenance_orders_request_id_idx" ON "manufacturing_maintenance_orders"("request_id");

-- CreateIndex
CREATE INDEX "manufacturing_maintenance_orders_machine_id_idx" ON "manufacturing_maintenance_orders"("machine_id");

-- CreateIndex
CREATE INDEX "manufacturing_maintenance_orders_status_idx" ON "manufacturing_maintenance_orders"("status");

-- CreateIndex
CREATE INDEX "manufacturing_maintenance_orders_company_id_idx" ON "manufacturing_maintenance_orders"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_subcontract_vendors_vendor_code_key" ON "manufacturing_subcontract_vendors"("vendor_code");

-- CreateIndex
CREATE INDEX "manufacturing_subcontract_vendors_vendor_code_idx" ON "manufacturing_subcontract_vendors"("vendor_code");

-- CreateIndex
CREATE INDEX "manufacturing_subcontract_vendors_status_idx" ON "manufacturing_subcontract_vendors"("status");

-- CreateIndex
CREATE INDEX "manufacturing_subcontract_vendors_company_id_idx" ON "manufacturing_subcontract_vendors"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_subcontract_orders_order_number_key" ON "manufacturing_subcontract_orders"("order_number");

-- CreateIndex
CREATE INDEX "manufacturing_subcontract_orders_order_number_idx" ON "manufacturing_subcontract_orders"("order_number");

-- CreateIndex
CREATE INDEX "manufacturing_subcontract_orders_vendor_id_idx" ON "manufacturing_subcontract_orders"("vendor_id");

-- CreateIndex
CREATE INDEX "manufacturing_subcontract_orders_production_order_id_idx" ON "manufacturing_subcontract_orders"("production_order_id");

-- CreateIndex
CREATE INDEX "manufacturing_subcontract_orders_status_idx" ON "manufacturing_subcontract_orders"("status");

-- CreateIndex
CREATE INDEX "manufacturing_subcontract_orders_company_id_idx" ON "manufacturing_subcontract_orders"("company_id");

-- CreateIndex
CREATE INDEX "manufacturing_subcontract_materials_sent_subcontract_order__idx" ON "manufacturing_subcontract_materials_sent"("subcontract_order_id");

-- CreateIndex
CREATE INDEX "manufacturing_subcontract_materials_received_subcontract_or_idx" ON "manufacturing_subcontract_materials_received"("subcontract_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_mrps_mrp_number_key" ON "manufacturing_mrps"("mrp_number");

-- CreateIndex
CREATE INDEX "manufacturing_mrps_mrp_number_idx" ON "manufacturing_mrps"("mrp_number");

-- CreateIndex
CREATE INDEX "manufacturing_mrps_run_date_idx" ON "manufacturing_mrps"("run_date");

-- CreateIndex
CREATE INDEX "manufacturing_mrps_company_id_idx" ON "manufacturing_mrps"("company_id");

-- CreateIndex
CREATE INDEX "manufacturing_mrp_items_mrp_id_idx" ON "manufacturing_mrp_items"("mrp_id");

-- CreateIndex
CREATE INDEX "manufacturing_mrp_items_material_id_idx" ON "manufacturing_mrp_items"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_mps_mps_number_key" ON "manufacturing_mps"("mps_number");

-- CreateIndex
CREATE INDEX "manufacturing_mps_mps_number_idx" ON "manufacturing_mps"("mps_number");

-- CreateIndex
CREATE INDEX "manufacturing_mps_product_id_idx" ON "manufacturing_mps"("product_id");

-- CreateIndex
CREATE INDEX "manufacturing_mps_week_idx" ON "manufacturing_mps"("week");

-- CreateIndex
CREATE INDEX "manufacturing_mps_year_idx" ON "manufacturing_mps"("year");

-- CreateIndex
CREATE INDEX "manufacturing_mps_company_id_idx" ON "manufacturing_mps"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_demands_demand_number_key" ON "manufacturing_demands"("demand_number");

-- CreateIndex
CREATE INDEX "manufacturing_demands_demand_number_idx" ON "manufacturing_demands"("demand_number");

-- CreateIndex
CREATE INDEX "manufacturing_demands_product_id_idx" ON "manufacturing_demands"("product_id");

-- CreateIndex
CREATE INDEX "manufacturing_demands_required_date_idx" ON "manufacturing_demands"("required_date");

-- CreateIndex
CREATE INDEX "manufacturing_demands_status_idx" ON "manufacturing_demands"("status");

-- CreateIndex
CREATE INDEX "manufacturing_demands_company_id_idx" ON "manufacturing_demands"("company_id");

-- CreateIndex
CREATE INDEX "manufacturing_product_costs_product_id_idx" ON "manufacturing_product_costs"("product_id");

-- CreateIndex
CREATE INDEX "manufacturing_product_costs_cost_type_idx" ON "manufacturing_product_costs"("cost_type");

-- CreateIndex
CREATE INDEX "manufacturing_product_costs_status_idx" ON "manufacturing_product_costs"("status");

-- CreateIndex
CREATE INDEX "manufacturing_product_costs_company_id_idx" ON "manufacturing_product_costs"("company_id");

-- CreateIndex
CREATE INDEX "manufacturing_cost_variances_product_cost_id_idx" ON "manufacturing_cost_variances"("product_cost_id");

-- CreateIndex
CREATE INDEX "manufacturing_cost_variances_production_order_id_idx" ON "manufacturing_cost_variances"("production_order_id");

-- CreateIndex
CREATE INDEX "manufacturing_cost_variances_variance_type_idx" ON "manufacturing_cost_variances"("variance_type");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_settings_company_id_key" ON "manufacturing_settings"("company_id");

-- AddForeignKey
ALTER TABLE "manufacturing_boms" ADD CONSTRAINT "manufacturing_boms_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_boms" ADD CONSTRAINT "manufacturing_boms_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_boms" ADD CONSTRAINT "manufacturing_boms_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_boms" ADD CONSTRAINT "manufacturing_boms_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_boms" ADD CONSTRAINT "manufacturing_boms_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_bom_components" ADD CONSTRAINT "manufacturing_bom_components_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "manufacturing_boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_bom_components" ADD CONSTRAINT "manufacturing_bom_components_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_bom_components" ADD CONSTRAINT "manufacturing_bom_components_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "manufacturing_work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_routings" ADD CONSTRAINT "manufacturing_routings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_routings" ADD CONSTRAINT "manufacturing_routings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_routings" ADD CONSTRAINT "manufacturing_routings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_routings" ADD CONSTRAINT "manufacturing_routings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_routing_operations" ADD CONSTRAINT "manufacturing_routing_operations_routing_id_fkey" FOREIGN KEY ("routing_id") REFERENCES "manufacturing_routings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_routing_operations" ADD CONSTRAINT "manufacturing_routing_operations_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "manufacturing_work_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_routing_operations" ADD CONSTRAINT "manufacturing_routing_operations_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "manufacturing_machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_work_centers" ADD CONSTRAINT "manufacturing_work_centers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_work_centers" ADD CONSTRAINT "manufacturing_work_centers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_work_centers" ADD CONSTRAINT "manufacturing_work_centers_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_work_centers" ADD CONSTRAINT "manufacturing_work_centers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_machines" ADD CONSTRAINT "manufacturing_machines_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "manufacturing_work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_machines" ADD CONSTRAINT "manufacturing_machines_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_machines" ADD CONSTRAINT "manufacturing_machines_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_machines" ADD CONSTRAINT "manufacturing_machines_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_machines" ADD CONSTRAINT "manufacturing_machines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_production_orders" ADD CONSTRAINT "manufacturing_production_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_production_orders" ADD CONSTRAINT "manufacturing_production_orders_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "manufacturing_boms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_production_orders" ADD CONSTRAINT "manufacturing_production_orders_routing_id_fkey" FOREIGN KEY ("routing_id") REFERENCES "manufacturing_routings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_production_orders" ADD CONSTRAINT "manufacturing_production_orders_source_warehouse_id_fkey" FOREIGN KEY ("source_warehouse_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_production_orders" ADD CONSTRAINT "manufacturing_production_orders_wip_warehouse_id_fkey" FOREIGN KEY ("wip_warehouse_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_production_orders" ADD CONSTRAINT "manufacturing_production_orders_finished_goods_warehouse_i_fkey" FOREIGN KEY ("finished_goods_warehouse_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_production_orders" ADD CONSTRAINT "manufacturing_production_orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_production_orders" ADD CONSTRAINT "manufacturing_production_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_production_orders" ADD CONSTRAINT "manufacturing_production_orders_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_production_orders" ADD CONSTRAINT "manufacturing_production_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_work_orders" ADD CONSTRAINT "manufacturing_work_orders_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "manufacturing_production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_work_orders" ADD CONSTRAINT "manufacturing_work_orders_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "manufacturing_work_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_work_orders" ADD CONSTRAINT "manufacturing_work_orders_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "manufacturing_machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_work_orders" ADD CONSTRAINT "manufacturing_work_orders_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_work_orders" ADD CONSTRAINT "manufacturing_work_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_work_orders" ADD CONSTRAINT "manufacturing_work_orders_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_work_orders" ADD CONSTRAINT "manufacturing_work_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_reservations" ADD CONSTRAINT "manufacturing_material_reservations_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "manufacturing_production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_reservations" ADD CONSTRAINT "manufacturing_material_reservations_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_reservations" ADD CONSTRAINT "manufacturing_material_reservations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_reservations" ADD CONSTRAINT "manufacturing_material_reservations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_reservations" ADD CONSTRAINT "manufacturing_material_reservations_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_reservations" ADD CONSTRAINT "manufacturing_material_reservations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_issues" ADD CONSTRAINT "manufacturing_material_issues_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "manufacturing_material_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_issues" ADD CONSTRAINT "manufacturing_material_issues_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "manufacturing_production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_issues" ADD CONSTRAINT "manufacturing_material_issues_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_issues" ADD CONSTRAINT "manufacturing_material_issues_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_issues" ADD CONSTRAINT "manufacturing_material_issues_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_issues" ADD CONSTRAINT "manufacturing_material_issues_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_issues" ADD CONSTRAINT "manufacturing_material_issues_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_issues" ADD CONSTRAINT "manufacturing_material_issues_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_consumptions" ADD CONSTRAINT "manufacturing_material_consumptions_material_issue_id_fkey" FOREIGN KEY ("material_issue_id") REFERENCES "manufacturing_material_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_consumptions" ADD CONSTRAINT "manufacturing_material_consumptions_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "manufacturing_production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_consumptions" ADD CONSTRAINT "manufacturing_material_consumptions_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_consumptions" ADD CONSTRAINT "manufacturing_material_consumptions_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "manufacturing_work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_consumptions" ADD CONSTRAINT "manufacturing_material_consumptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_material_consumptions" ADD CONSTRAINT "manufacturing_material_consumptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_wips" ADD CONSTRAINT "manufacturing_wips_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "manufacturing_production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_wips" ADD CONSTRAINT "manufacturing_wips_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_wips" ADD CONSTRAINT "manufacturing_wips_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "manufacturing_work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_wips" ADD CONSTRAINT "manufacturing_wips_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_wips" ADD CONSTRAINT "manufacturing_wips_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_wips" ADD CONSTRAINT "manufacturing_wips_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_wips" ADD CONSTRAINT "manufacturing_wips_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_scraps" ADD CONSTRAINT "manufacturing_scraps_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "manufacturing_production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_scraps" ADD CONSTRAINT "manufacturing_scraps_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "manufacturing_work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_scraps" ADD CONSTRAINT "manufacturing_scraps_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_scraps" ADD CONSTRAINT "manufacturing_scraps_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_scraps" ADD CONSTRAINT "manufacturing_scraps_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "manufacturing_work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_scraps" ADD CONSTRAINT "manufacturing_scraps_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "manufacturing_machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_scraps" ADD CONSTRAINT "manufacturing_scraps_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_scraps" ADD CONSTRAINT "manufacturing_scraps_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_scraps" ADD CONSTRAINT "manufacturing_scraps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_by_products" ADD CONSTRAINT "manufacturing_by_products_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "manufacturing_production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_by_products" ADD CONSTRAINT "manufacturing_by_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_by_products" ADD CONSTRAINT "manufacturing_by_products_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_by_products" ADD CONSTRAINT "manufacturing_by_products_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_by_products" ADD CONSTRAINT "manufacturing_by_products_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_reworks" ADD CONSTRAINT "manufacturing_reworks_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "manufacturing_production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_reworks" ADD CONSTRAINT "manufacturing_reworks_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "manufacturing_work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_reworks" ADD CONSTRAINT "manufacturing_reworks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_reworks" ADD CONSTRAINT "manufacturing_reworks_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "manufacturing_work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_reworks" ADD CONSTRAINT "manufacturing_reworks_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_reworks" ADD CONSTRAINT "manufacturing_reworks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_reworks" ADD CONSTRAINT "manufacturing_reworks_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_reworks" ADD CONSTRAINT "manufacturing_reworks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_quality_inspections" ADD CONSTRAINT "manufacturing_quality_inspections_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "manufacturing_production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_quality_inspections" ADD CONSTRAINT "manufacturing_quality_inspections_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "manufacturing_work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_quality_inspections" ADD CONSTRAINT "manufacturing_quality_inspections_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_quality_inspections" ADD CONSTRAINT "manufacturing_quality_inspections_inspector_id_fkey" FOREIGN KEY ("inspector_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_quality_inspections" ADD CONSTRAINT "manufacturing_quality_inspections_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_quality_inspections" ADD CONSTRAINT "manufacturing_quality_inspections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_quality_parameters" ADD CONSTRAINT "manufacturing_quality_parameters_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "manufacturing_quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_maintenance_requests" ADD CONSTRAINT "manufacturing_maintenance_requests_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "manufacturing_machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_maintenance_requests" ADD CONSTRAINT "manufacturing_maintenance_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_maintenance_requests" ADD CONSTRAINT "manufacturing_maintenance_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_maintenance_requests" ADD CONSTRAINT "manufacturing_maintenance_requests_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_maintenance_requests" ADD CONSTRAINT "manufacturing_maintenance_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_maintenance_orders" ADD CONSTRAINT "manufacturing_maintenance_orders_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "manufacturing_maintenance_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_maintenance_orders" ADD CONSTRAINT "manufacturing_maintenance_orders_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "manufacturing_machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_maintenance_orders" ADD CONSTRAINT "manufacturing_maintenance_orders_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_maintenance_orders" ADD CONSTRAINT "manufacturing_maintenance_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_maintenance_orders" ADD CONSTRAINT "manufacturing_maintenance_orders_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_maintenance_orders" ADD CONSTRAINT "manufacturing_maintenance_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_subcontract_vendors" ADD CONSTRAINT "manufacturing_subcontract_vendors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_subcontract_vendors" ADD CONSTRAINT "manufacturing_subcontract_vendors_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_subcontract_vendors" ADD CONSTRAINT "manufacturing_subcontract_vendors_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_subcontract_orders" ADD CONSTRAINT "manufacturing_subcontract_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "manufacturing_subcontract_vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_subcontract_orders" ADD CONSTRAINT "manufacturing_subcontract_orders_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "manufacturing_production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_subcontract_orders" ADD CONSTRAINT "manufacturing_subcontract_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_subcontract_orders" ADD CONSTRAINT "manufacturing_subcontract_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_subcontract_orders" ADD CONSTRAINT "manufacturing_subcontract_orders_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_subcontract_orders" ADD CONSTRAINT "manufacturing_subcontract_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_subcontract_materials_sent" ADD CONSTRAINT "manufacturing_subcontract_materials_sent_subcontract_order_fkey" FOREIGN KEY ("subcontract_order_id") REFERENCES "manufacturing_subcontract_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_subcontract_materials_sent" ADD CONSTRAINT "manufacturing_subcontract_materials_sent_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_subcontract_materials_received" ADD CONSTRAINT "manufacturing_subcontract_materials_received_subcontract_o_fkey" FOREIGN KEY ("subcontract_order_id") REFERENCES "manufacturing_subcontract_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_subcontract_materials_received" ADD CONSTRAINT "manufacturing_subcontract_materials_received_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_mrps" ADD CONSTRAINT "manufacturing_mrps_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_mrps" ADD CONSTRAINT "manufacturing_mrps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_mrp_items" ADD CONSTRAINT "manufacturing_mrp_items_mrp_id_fkey" FOREIGN KEY ("mrp_id") REFERENCES "manufacturing_mrps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_mrp_items" ADD CONSTRAINT "manufacturing_mrp_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_mps" ADD CONSTRAINT "manufacturing_mps_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_mps" ADD CONSTRAINT "manufacturing_mps_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_mps" ADD CONSTRAINT "manufacturing_mps_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_mps" ADD CONSTRAINT "manufacturing_mps_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_mps" ADD CONSTRAINT "manufacturing_mps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_demands" ADD CONSTRAINT "manufacturing_demands_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_demands" ADD CONSTRAINT "manufacturing_demands_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_demands" ADD CONSTRAINT "manufacturing_demands_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_demands" ADD CONSTRAINT "manufacturing_demands_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_product_costs" ADD CONSTRAINT "manufacturing_product_costs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_product_costs" ADD CONSTRAINT "manufacturing_product_costs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_product_costs" ADD CONSTRAINT "manufacturing_product_costs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_product_costs" ADD CONSTRAINT "manufacturing_product_costs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_cost_variances" ADD CONSTRAINT "manufacturing_cost_variances_product_cost_id_fkey" FOREIGN KEY ("product_cost_id") REFERENCES "manufacturing_product_costs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_cost_variances" ADD CONSTRAINT "manufacturing_cost_variances_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "manufacturing_production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_settings" ADD CONSTRAINT "manufacturing_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
