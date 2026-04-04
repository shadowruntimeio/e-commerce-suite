import type { Job } from 'bullmq'
import { prisma } from '@ems/db'
import { getCurrentStock } from '../modules/inventory/inventory.service'

export async function restockingProcessor(_job: Job): Promise<void> {
  console.log('[restocking] Starting restocking suggestions run')

  // Get all tenants that have active warehouse SKUs with safetyStockDays > 0
  const warehouseSkus = await prisma.warehouseSku.findMany({
    where: { safetyStockDays: { gt: 0 } },
    include: {
      warehouse: { select: { tenantId: true, id: true, name: true } },
      systemSku: { select: { id: true, skuCode: true, systemProductId: true } },
    },
  })

  console.log(`[restocking] Evaluating ${warehouseSkus.length} warehouse SKUs`)

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  for (const wsku of warehouseSkus) {
    try {
      const tenantId = wsku.warehouse.tenantId

      // Get current stock
      const stock = await getCurrentStock(wsku.id)
      const quantityAvailable = stock.quantityAvailable

      // Compute avgDailySales: sum of orderItem.quantity for this systemSkuId over last 30 days ÷ 30
      const salesAggregate = await prisma.orderItem.aggregate({
        where: {
          systemSkuId: wsku.systemSkuId,
          order: {
            tenantId,
            createdAt: { gte: thirtyDaysAgo },
            status: { notIn: ['CANCELLED'] },
          },
        },
        _sum: { quantity: true },
      })

      const totalSold = salesAggregate._sum.quantity ?? 0
      const avgDailySales = totalSold / 30

      if (avgDailySales === 0) {
        // No sales data — skip
        continue
      }

      const daysOfStock = quantityAvailable / avgDailySales

      if (daysOfStock >= wsku.safetyStockDays) {
        // Sufficient stock — no suggestion needed
        continue
      }

      // Check for an existing unexpired PENDING suggestion
      const existingSuggestion = await prisma.restockingSuggestion.findFirst({
        where: {
          tenantId,
          warehouseSkuId: wsku.id,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
      })

      if (existingSuggestion) {
        // Already have an active suggestion — skip
        continue
      }

      // suggestedQty = (safetyStockDays * avgDailySales * 2) - quantityAvailable
      const suggestedQty = Math.ceil(wsku.safetyStockDays * avgDailySales * 2 - quantityAvailable)

      if (suggestedQty <= 0) continue

      await prisma.restockingSuggestion.create({
        data: {
          tenantId,
          warehouseSkuId: wsku.id,
          systemSkuId: wsku.systemSkuId,
          suggestedQty,
          reason: {
            daysOfStock: Math.round(daysOfStock * 100) / 100,
            avgDailySales: Math.round(avgDailySales * 100) / 100,
            currentStock: quantityAvailable,
          },
          expiresAt: sevenDaysFromNow,
          status: 'PENDING',
        },
      })

      console.log(
        `[restocking] Created suggestion for warehouseSku ${wsku.id} (${wsku.systemSku.skuCode}): ` +
        `${suggestedQty} units, daysOfStock=${daysOfStock.toFixed(1)}`
      )
    } catch (err) {
      console.error(`[restocking] Error processing warehouseSku ${wsku.id}:`, err)
    }
  }

  console.log('[restocking] Restocking suggestions run complete')
}
