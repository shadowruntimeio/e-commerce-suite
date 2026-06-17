-- CreateTable
CREATE TABLE "sku_costs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "cost" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sku_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sku_costs_tenantId_idx" ON "sku_costs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "sku_costs_ownerUserId_skuCode_key" ON "sku_costs"("ownerUserId", "skuCode");
