-- AlterTable
ALTER TABLE "users" ADD COLUMN     "created_by" TEXT;

-- CreateIndex
CREATE INDEX "users_created_by_idx" ON "users"("created_by");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
