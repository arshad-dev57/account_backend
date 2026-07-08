/*
  Warnings:

  - You are about to drop the column `posted_at` on the `credit_notes` table. All the data in the column will be lost.
  - You are about to drop the column `posted_by` on the `credit_notes` table. All the data in the column will be lost.
  - You are about to drop the column `warehouse_invoice_id` on the `credit_notes` table. All the data in the column will be lost.
  - You are about to drop the `invoice_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `invoices` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "credit_notes" DROP CONSTRAINT "credit_notes_original_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "credit_notes" DROP CONSTRAINT "credit_notes_posted_by_fkey";

-- DropForeignKey
ALTER TABLE "credit_notes" DROP CONSTRAINT "credit_notes_warehouse_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_items" DROP CONSTRAINT "invoice_items_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_created_by_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_customer_id_fkey";

-- AlterTable
ALTER TABLE "credit_notes" DROP COLUMN "posted_at",
DROP COLUMN "posted_by",
DROP COLUMN "warehouse_invoice_id";

-- DropTable
DROP TABLE "invoice_items";

-- DropTable
DROP TABLE "invoices";

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "warehouse_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
