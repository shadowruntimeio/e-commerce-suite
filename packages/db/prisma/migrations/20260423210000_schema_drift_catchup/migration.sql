-- Catchup migration: formalizes schema fields that were added to schema.prisma
-- and applied to local DB via `prisma db push`, but never had a migration file.

-- AlterTable: mapping to external platforms' warehouse IDs
ALTER TABLE "warehouses" ADD COLUMN "platformWarehouseIds" JSONB NOT NULL DEFAULT '{}';

-- AlterTable: denormalized first seller SKU on Order for fast sort/filter
ALTER TABLE "orders" ADD COLUMN "firstSellerSku" TEXT;

-- CreateIndex: supports sort/filter by firstSellerSku
CREATE INDEX "orders_tenantId_firstSellerSku_idx" ON "orders"("tenantId", "firstSellerSku");

-- AlterTable: seller-defined SKU code on order line items (for picking)
ALTER TABLE "order_items" ADD COLUMN "sellerSku" TEXT;
