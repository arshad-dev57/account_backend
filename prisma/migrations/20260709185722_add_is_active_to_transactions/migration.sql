-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "is_deleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "transactions_is_active_idx" ON "transactions"("is_active");
