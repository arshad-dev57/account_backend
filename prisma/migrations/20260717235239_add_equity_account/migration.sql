-- CreateTable
CREATE TABLE "equity_accounts" (
    "id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "opening_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "current_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "additions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "withdrawals" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_by" TEXT NOT NULL,
    "fiscal_year_id" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equity_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equity_accounts_account_code_idx" ON "equity_accounts"("account_code");

-- CreateIndex
CREATE INDEX "equity_accounts_account_type_idx" ON "equity_accounts"("account_type");

-- CreateIndex
CREATE INDEX "equity_accounts_created_by_idx" ON "equity_accounts"("created_by");

-- CreateIndex
CREATE INDEX "equity_accounts_user_id_idx" ON "equity_accounts"("user_id");

-- CreateIndex
CREATE INDEX "equity_accounts_fiscal_year_id_idx" ON "equity_accounts"("fiscal_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "equity_accounts_account_code_created_by_key" ON "equity_accounts"("account_code", "created_by");

-- AddForeignKey
ALTER TABLE "equity_accounts" ADD CONSTRAINT "equity_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_accounts" ADD CONSTRAINT "equity_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_accounts" ADD CONSTRAINT "equity_accounts_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;
