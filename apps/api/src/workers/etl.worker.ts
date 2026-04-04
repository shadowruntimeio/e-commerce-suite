import type { Job } from 'bullmq'
import { prisma, Prisma } from '@ems/db'

const Decimal = Prisma.Decimal
type Decimal = InstanceType<typeof Prisma.Decimal>

export async function etlProcessor(_job: Job): Promise<void> {
  console.log('[etl] Starting nightly ETL run')

  const tenants = await prisma.tenant.findMany({ select: { id: true } })

  // Yesterday UTC midnight → midnight
  const now = new Date()
  const yesterdayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
  const yesterdayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dateKey = yesterdayStart // date column value

  for (const tenant of tenants) {
    try {
      await processSalesFacts(tenant.id, dateKey, yesterdayStart, yesterdayEnd)
    } catch (err) {
      console.error(`[etl] Sales facts error for tenant ${tenant.id}:`, err)
    }

    try {
      await processInventorySnapshots(tenant.id, dateKey)
    } catch (err) {
      console.error(`[etl] Inventory snapshots error for tenant ${tenant.id}:`, err)
    }
  }

  console.log('[etl] Nightly ETL run complete')
}

async function processSalesFacts(
  tenantId: string,
  dateKey: Date,
  from: Date,
  to: Date
): Promise<void> {
  // Get all orders for yesterday grouped by shopId + systemSkuId via order items
  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      createdAt: { gte: from, lt: to },
      status: { notIn: ['CANCELLED'] },
    },
    select: {
      id: true,
      shopId: true,
      totalRevenue: true,
      platformCommission: true,
      shippingFeeSeller: true,
      items: {
        select: {
          systemSkuId: true,
          quantity: true,
          costPriceAtOrder: true,
        },
      },
    },
  })

  // Build aggregation map: key = "shopId|systemSkuId"
  type FactAccum = {
    shopId: string
    systemSkuId: string | null
    ordersCount: number
    unitsSold: number
    grossRevenue: Decimal
    platformCommission: Decimal
    shippingCost: Decimal
    cogs: Decimal
  }

  const map = new Map<string, FactAccum>()

  const dec = (v: unknown) => new Decimal(String(v ?? 0))

  for (const order of orders) {
    // Group per systemSkuId within each order
    const skuGroups = new Map<string | null, { qty: number; cogs: Decimal }>()

    for (const item of order.items) {
      const skuId = item.systemSkuId ?? null
      const existing = skuGroups.get(skuId) ?? { qty: 0, cogs: new Decimal(0) }
      existing.qty += item.quantity
      existing.cogs = existing.cogs.add(dec(item.costPriceAtOrder).mul(item.quantity))
      skuGroups.set(skuId, existing)
    }

    // If order has no items, still record it under systemSkuId=null
    if (order.items.length === 0) {
      skuGroups.set(null, { qty: 0, cogs: new Decimal(0) })
    }

    // Distribute revenue/commission/shipping proportionally (by sku group qty / total qty)
    const totalQty = order.items.reduce((s, i) => s + i.quantity, 0) || 1
    const orderRevenue = dec(order.totalRevenue)
    const orderCommission = dec(order.platformCommission)
    const orderShipping = dec(order.shippingFeeSeller)

    for (const [skuId, grp] of skuGroups) {
      const share = grp.qty / totalQty
      const mapKey = `${order.shopId}|${skuId ?? '__null__'}`
      const existing = map.get(mapKey) ?? {
        shopId: order.shopId,
        systemSkuId: skuId,
        ordersCount: 0,
        unitsSold: 0,
        grossRevenue: new Decimal(0),
        platformCommission: new Decimal(0),
        shippingCost: new Decimal(0),
        cogs: new Decimal(0),
      }
      existing.ordersCount += 1
      existing.unitsSold += grp.qty
      existing.grossRevenue = existing.grossRevenue.add(orderRevenue.mul(share))
      existing.platformCommission = existing.platformCommission.add(orderCommission.mul(share))
      existing.shippingCost = existing.shippingCost.add(orderShipping.mul(share))
      existing.cogs = existing.cogs.add(grp.cogs)
      map.set(mapKey, existing)
    }
  }

  // Upsert each fact
  for (const fact of map.values()) {
    const profit = fact.grossRevenue
      .sub(fact.platformCommission)
      .sub(fact.shippingCost)
      .sub(fact.cogs)

    await prisma.salesFact.upsert({
      where: {
        tenantId_date_shopId_systemSkuId: {
          tenantId,
          date: dateKey,
          shopId: fact.shopId,
          systemSkuId: fact.systemSkuId ?? '',
        },
      },
      update: {
        ordersCount: fact.ordersCount,
        unitsSold: fact.unitsSold,
        grossRevenue: fact.grossRevenue,
        platformCommission: fact.platformCommission,
        shippingCost: fact.shippingCost,
        cogs: fact.cogs,
        profit,
      },
      create: {
        tenantId,
        date: dateKey,
        shopId: fact.shopId,
        systemSkuId: fact.systemSkuId ?? '',
        ordersCount: fact.ordersCount,
        unitsSold: fact.unitsSold,
        grossRevenue: fact.grossRevenue,
        platformCommission: fact.platformCommission,
        shippingCost: fact.shippingCost,
        cogs: fact.cogs,
        profit,
      },
    })
  }

  console.log(`[etl] Sales facts: tenant ${tenantId}, ${map.size} groups upserted`)
}

async function processInventorySnapshots(tenantId: string, dateKey: Date): Promise<void> {
  const warehouseSkus = await prisma.warehouseSku.findMany({
    where: { warehouse: { tenantId } },
    include: {
      warehouse: { select: { id: true } },
      inventorySnapshots: {
        orderBy: { snapshotAt: 'desc' },
        take: 1,
      },
      systemSku: { select: { costPrice: true } },
    },
  })

  // Compute avgDailySales for daysOfStock calculation
  const thirtyDaysAgo = new Date(dateKey.getTime() - 30 * 24 * 60 * 60 * 1000)

  for (const wsku of warehouseSkus) {
    const latest = wsku.inventorySnapshots[0]
    if (!latest) continue

    const quantityOnHand = latest.quantityOnHand
    const costPrice = wsku.systemSku.costPrice
    const inventoryValue = new Decimal(String(costPrice)).mul(quantityOnHand)

    // Compute avgDailySales
    const salesAgg = await prisma.orderItem.aggregate({
      where: {
        systemSkuId: wsku.systemSkuId,
        order: {
          tenantId,
          createdAt: { gte: thirtyDaysAgo, lt: dateKey },
          status: { notIn: ['CANCELLED'] },
        },
      },
      _sum: { quantity: true },
    })
    const totalSold = salesAgg._sum.quantity ?? 0
    const avgDailySales = totalSold / 30
    const daysOfStock = avgDailySales > 0
      ? new Decimal(quantityOnHand).div(avgDailySales).toDecimalPlaces(2)
      : new Decimal(0)

    await prisma.inventoryDailySnapshot.upsert({
      where: {
        tenantId_date_warehouseSkuId: {
          tenantId,
          date: dateKey,
          warehouseSkuId: wsku.id,
        },
      },
      update: { quantityOnHand, inventoryValue, daysOfStock },
      create: {
        tenantId,
        date: dateKey,
        warehouseSkuId: wsku.id,
        warehouseId: wsku.warehouseId,
        quantityOnHand,
        inventoryValue,
        daysOfStock,
      },
    })
  }

  console.log(`[etl] Inventory snapshots: tenant ${tenantId}, ${warehouseSkus.length} skus`)
}
