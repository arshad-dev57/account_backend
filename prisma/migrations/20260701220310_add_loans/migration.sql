-- CreateTable
CREATE TABLE "loan_payments" (
    "id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'EMI',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "reference" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "loan_number" TEXT NOT NULL,
    "loan_type" TEXT NOT NULL,
    "lender_name" TEXT NOT NULL,
    "lender_id" TEXT,
    "loan_amount" DOUBLE PRECISION NOT NULL,
    "disbursement_date" TIMESTAMP(3) NOT NULL,
    "interest_rate" DOUBLE PRECISION NOT NULL,
    "tenure_months" INTEGER NOT NULL,
    "emi_amount" DOUBLE PRECISION NOT NULL,
    "total_paid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outstanding_balance" DOUBLE PRECISION NOT NULL,
    "next_payment_date" TIMESTAMP(3),
    "last_payment_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Active',
    "purpose" TEXT NOT NULL DEFAULT '',
    "collateral" TEXT NOT NULL DEFAULT '',
    "account_number" TEXT NOT NULL DEFAULT '',
    "bank_account_id" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loan_payments_loan_id_idx" ON "loan_payments"("loan_id");

-- CreateIndex
CREATE INDEX "loan_payments_date_idx" ON "loan_payments"("date");

-- CreateIndex
CREATE INDEX "loan_payments_status_idx" ON "loan_payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "loans_loan_number_key" ON "loans"("loan_number");

-- CreateIndex
CREATE INDEX "loans_loan_number_idx" ON "loans"("loan_number");

-- CreateIndex
CREATE INDEX "loans_lender_id_idx" ON "loans"("lender_id");

-- CreateIndex
CREATE INDEX "loans_bank_account_id_idx" ON "loans"("bank_account_id");

-- CreateIndex
CREATE INDEX "loans_status_idx" ON "loans"("status");

-- CreateIndex
CREATE INDEX "loans_loan_type_idx" ON "loans"("loan_type");

-- CreateIndex
CREATE INDEX "loans_created_by_idx" ON "loans"("created_by");

-- AddForeignKey
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_lender_id_fkey" FOREIGN KEY ("lender_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
