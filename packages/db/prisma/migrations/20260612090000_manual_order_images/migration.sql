-- CreateTable
CREATE TABLE "manual_order_images" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_order_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manual_order_images_orderId_idx" ON "manual_order_images"("orderId");

-- AddForeignKey
ALTER TABLE "manual_order_images"
  ADD CONSTRAINT "manual_order_images_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
