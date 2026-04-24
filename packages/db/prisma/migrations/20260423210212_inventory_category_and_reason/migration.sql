-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM ('STOCKTAKE_CORRECTION', 'DAMAGE', 'LOSS', 'EXPIRY', 'FOUND', 'SYSTEM_ERROR', 'OTHER');

-- AlterTable: add reason to inventory ledger (nullable; app layer enforces for ADJUSTMENT)
ALTER TABLE "inventory_events" ADD COLUMN "reason" "AdjustmentReason";

-- AlterTable: add timestamps to product_categories
ALTER TABLE "product_categories" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "product_categories" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AddForeignKey: tenant scoping for product_categories
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex: enforce unique category name per tenant (drives import auto-create lookup)
CREATE UNIQUE INDEX "product_categories_tenantId_name_key" ON "product_categories"("tenantId", "name");

-- CreateIndex: tenant lookup
CREATE INDEX "product_categories_tenantId_idx" ON "product_categories"("tenantId");
