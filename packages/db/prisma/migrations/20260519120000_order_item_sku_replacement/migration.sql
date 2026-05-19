-- AlterTable: snapshot original SKU on order_items so the warehouse UI and
-- shipping label can render an old→new diff after a merchant SKU replacement.
ALTER TABLE "order_items" ADD COLUMN "originalSellerSku" TEXT;
ALTER TABLE "order_items" ADD COLUMN "originalSystemSkuId" TEXT;
ALTER TABLE "order_items" ADD COLUMN "originalSkuName" TEXT;
ALTER TABLE "order_items" ADD COLUMN "originalProductName" TEXT;
ALTER TABLE "order_items" ADD COLUMN "replacedAt" TIMESTAMP(3);
ALTER TABLE "order_items" ADD COLUMN "replacedByUserId" TEXT;

-- AddForeignKey: who performed the replacement
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_replacedByUserId_fkey" FOREIGN KEY ("replacedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
