-- CreateTable
CREATE TABLE "sales_facts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shopId" TEXT NOT NULL,
    "systemSkuId" TEXT,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "unitsSold" INTEGER NOT NULL DEFAULT 0,
    "grossRevenue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "platformCommission" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "shippingCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cogs" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "profit" DECIMAL(14,4) NOT NULL DEFAULT 0,

    CONSTRAINT "sales_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_daily_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "warehouseSkuId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "inventoryValue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "daysOfStock" DECIMAL(8,2) NOT NULL DEFAULT 0,

    CONSTRAINT "inventory_daily_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_spend_facts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shopId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "spend" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "revenueAttributed" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "roas" DECIMAL(8,4) NOT NULL DEFAULT 0,

    CONSTRAINT "ad_spend_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "platformThreadId" TEXT NOT NULL,
    "platformMsgId" TEXT NOT NULL,
    "senderType" TEXT NOT NULL,
    "senderName" TEXT,
    "content" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "platformMetadata" JSONB NOT NULL DEFAULT '{}',
    "platformCreatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_threads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "platformThreadId" TEXT NOT NULL,
    "buyerName" TEXT,
    "buyerPlatformId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "lastMessagePreview" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "first_leg_shipments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "trackingNumber" TEXT,
    "carrier" TEXT,
    "shipmentType" TEXT NOT NULL DEFAULT 'SEA',
    "originWarehouse" TEXT,
    "destination" TEXT,
    "departedAt" TIMESTAMP(3),
    "estimatedArrival" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "weightKg" DECIMAL(10,3),
    "volumeCbm" DECIMAL(10,4),
    "cost" DECIMAL(14,4),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "first_leg_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_facts_tenantId_date_idx" ON "sales_facts"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "sales_facts_tenantId_date_shopId_systemSkuId_key" ON "sales_facts"("tenantId", "date", "shopId", "systemSkuId");

-- CreateIndex
CREATE INDEX "inventory_daily_snapshots_tenantId_date_idx" ON "inventory_daily_snapshots"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_daily_snapshots_tenantId_date_warehouseSkuId_key" ON "inventory_daily_snapshots"("tenantId", "date", "warehouseSkuId");

-- CreateIndex
CREATE INDEX "ad_spend_facts_tenantId_date_idx" ON "ad_spend_facts"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ad_spend_facts_tenantId_date_shopId_campaignId_key" ON "ad_spend_facts"("tenantId", "date", "shopId", "campaignId");

-- CreateIndex
CREATE INDEX "shop_messages_tenantId_isRead_idx" ON "shop_messages"("tenantId", "isRead");

-- CreateIndex
CREATE INDEX "shop_messages_tenantId_platformThreadId_idx" ON "shop_messages"("tenantId", "platformThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "shop_messages_shopId_platformMsgId_key" ON "shop_messages"("shopId", "platformMsgId");

-- CreateIndex
CREATE INDEX "message_threads_tenantId_isRead_lastMessageAt_idx" ON "message_threads"("tenantId", "isRead", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_threads_shopId_platformThreadId_key" ON "message_threads"("shopId", "platformThreadId");

-- CreateIndex
CREATE INDEX "first_leg_shipments_tenantId_status_idx" ON "first_leg_shipments"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "shop_messages" ADD CONSTRAINT "shop_messages_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "first_leg_shipments" ADD CONSTRAINT "first_leg_shipments_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
