-- CreateTable
CREATE TABLE "order_settlements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "settlementAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "revenueAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "feeAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "adjustmentAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "grossSalesAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "afterDiscountSubtotal" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "sellerDiscountAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "platformDiscountAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "customerPaymentAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "customerPaidShippingFee" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "platformCommissionAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "referralFeeAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "transactionFeeAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "affiliateCommission" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "affiliateCommissionBeforePit" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "affiliatePartnerCommission" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "refundAdminFeeAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "shippingFeeAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "salesTaxAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "statementId" TEXT,
    "statementTime" TIMESTAMP(3),
    "raw" JSONB NOT NULL DEFAULT '{}',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_settlements_orderId_key" ON "order_settlements"("orderId");

-- CreateIndex
CREATE INDEX "order_settlements_tenantId_idx" ON "order_settlements"("tenantId");

-- AddForeignKey
ALTER TABLE "order_settlements"
  ADD CONSTRAINT "order_settlements_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
