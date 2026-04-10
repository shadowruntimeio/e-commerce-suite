import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'

export async function reportsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /reports/sales
  app.get('/sales', async (request) => {
    const tenantId = request.user.tenantId
    const { dateFrom, dateTo, shopId } = request.query as {
      dateFrom?: string
      dateTo?: string
      shopId?: string
    }

    const from = dateFrom ? new Date(dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const to = dateTo ? new Date(dateTo) : new Date()

    // Try SalesFact first
    const hasFacts = await prisma.salesFact.count({ where: { tenantId } })

    if (hasFacts > 0) {
      const facts = await prisma.salesFact.findMany({
        where: {
          tenantId,
          date: { gte: from, lte: to },
          ...(shopId ? { shopId } : {}),
        },
        orderBy: { date: 'asc' },
      })

      // Group by date
      const byDate = new Map<string, {
        date: string
        ordersCount: number
        unitsSold: number
        grossRevenue: number
        profit: number
        platformCommission: number
      }>()

      for (const f of facts) {
        const key = f.date.toISOString().slice(0, 10)
        const existing = byDate.get(key) ?? {
          date: key,
          ordersCount: 0,
          unitsSold: 0,
          grossRevenue: 0,
          profit: 0,
          platformCommission: 0,
        }
        existing.ordersCount += f.ordersCount
        existing.unitsSold += f.unitsSold
        existing.grossRevenue += Number(f.grossRevenue)
        existing.profit += Number(f.profit)
        existing.platformCommission += Number(f.platformCommission)
        byDate.set(key, existing)
      }

      const rows = Array.from(byDate.values())
      const totals = rows.reduce(
        (acc, r) => ({
          ordersCount: acc.ordersCount + r.ordersCount,
          unitsSold: acc.unitsSold + r.unitsSold,
          grossRevenue: acc.grossRevenue + r.grossRevenue,
          profit: acc.profit + r.profit,
          platformCommission: acc.platformCommission + r.platformCommission,
        }),
        { ordersCount: 0, unitsSold: 0, grossRevenue: 0, profit: 0, platformCommission: 0 }
      )

      return { success: true, data: { rows, totals } }
    }

    // Fallback: query orders table
    const where = {
      tenantId,
      createdAt: { gte: from, lte: to },
      status: { notIn: ['CANCELLED'] as any[] },
      ...(shopId ? { shopId } : {}),
    }

    const orders = await prisma.order.findMany({
      where,
      select: {
        createdAt: true,
        totalRevenue: true,
        platformCommission: true,
        shippingFeeSeller: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    const byDate = new Map<string, {
      date: string
      ordersCount: number
      unitsSold: number
      grossRevenue: number
      profit: number
      platformCommission: number
    }>()

    for (const o of orders) {
      const key = o.createdAt.toISOString().slice(0, 10)
      const existing = byDate.get(key) ?? {
        date: key,
        ordersCount: 0,
        unitsSold: 0,
        grossRevenue: 0,
        profit: 0,
        platformCommission: 0,
      }
      existing.ordersCount += 1
      existing.grossRevenue += Number(o.totalRevenue)
      existing.platformCommission += Number(o.platformCommission)
      existing.profit += Number(o.totalRevenue) - Number(o.platformCommission) - Number(o.shippingFeeSeller)
      byDate.set(key, existing)
    }

    const rows = Array.from(byDate.values())
    const totals = rows.reduce(
      (acc, r) => ({
        ordersCount: acc.ordersCount + r.ordersCount,
        unitsSold: acc.unitsSold + r.unitsSold,
        grossRevenue: acc.grossRevenue + r.grossRevenue,
        profit: acc.profit + r.profit,
        platformCommission: acc.platformCommission + r.platformCommission,
      }),
      { ordersCount: 0, unitsSold: 0, grossRevenue: 0, profit: 0, platformCommission: 0 }
    )

    return { success: true, data: { rows, totals } }
  })

  // GET /reports/profit
  app.get('/profit', async (request) => {
    const tenantId = request.user.tenantId
    const { dateFrom, dateTo, shopId } = request.query as {
      dateFrom?: string
      dateTo?: string
      shopId?: string
    }

    const from = dateFrom ? new Date(dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const to = dateTo ? new Date(dateTo) : new Date()

    const facts = await prisma.salesFact.findMany({
      where: {
        tenantId,
        date: { gte: from, lte: to },
        systemSkuId: { not: null },
        ...(shopId ? { shopId } : {}),
      },
    })

    // Aggregate by systemSkuId
    const bySkuId = new Map<string, {
      systemSkuId: string
      unitsSold: number
      grossRevenue: number
      cogs: number
      platformCommission: number
      shippingCost: number
      profit: number
    }>()

    for (const f of facts) {
      const skuId = f.systemSkuId!
      const existing = bySkuId.get(skuId) ?? {
        systemSkuId: skuId,
        unitsSold: 0,
        grossRevenue: 0,
        cogs: 0,
        platformCommission: 0,
        shippingCost: 0,
        profit: 0,
      }
      existing.unitsSold += f.unitsSold
      existing.grossRevenue += Number(f.grossRevenue)
      existing.cogs += Number(f.cogs)
      existing.platformCommission += Number(f.platformCommission)
      existing.shippingCost += Number(f.shippingCost)
      existing.profit += Number(f.profit)
      bySkuId.set(skuId, existing)
    }

    // Fetch sku info
    const skuIds = Array.from(bySkuId.keys())
    const skus = await prisma.systemSku.findMany({
      where: { id: { in: skuIds } },
      include: { systemProduct: { select: { name: true } } },
    })
    const skuMap = new Map(skus.map((s: any) => [s.id, s]))

    const rows = Array.from(bySkuId.values())
      .map((agg) => {
        const sku = skuMap.get(agg.systemSkuId)
        const profitMargin = agg.grossRevenue > 0 ? (agg.profit / agg.grossRevenue) * 100 : 0
        return {
          systemSkuId: agg.systemSkuId,
          skuCode: sku?.skuCode ?? agg.systemSkuId,
          productName: sku?.systemProduct?.name ?? '',
          unitsSold: agg.unitsSold,
          grossRevenue: agg.grossRevenue,
          cogs: agg.cogs,
          platformCommission: agg.platformCommission,
          shippingCost: agg.shippingCost,
          profit: agg.profit,
          profitMargin: Math.round(profitMargin * 100) / 100,
        }
      })
      .sort((a, b) => b.profit - a.profit)

    return { success: true, data: rows }
  })

  // GET /reports/inventory-age
  app.get('/inventory-age', async (request) => {
    const tenantId = request.user.tenantId

    // Get most recent date for each warehouseSkuId
    const snapshots = await prisma.inventoryDailySnapshot.findMany({
      where: { tenantId },
      orderBy: { date: 'desc' },
      distinct: ['warehouseSkuId'],
    })

    const warehouseSkuIds = snapshots.map((s: any) => s.warehouseSkuId)
    const warehouseSkus = await prisma.warehouseSku.findMany({
      where: { id: { in: warehouseSkuIds } },
      include: {
        warehouse: { select: { name: true } },
        systemSku: { select: { skuCode: true, systemProduct: { select: { name: true } } } },
      },
    })
    const wskuMap = new Map(warehouseSkus.map((w: any) => [w.id, w]))

    const rows = snapshots.map((snap: any) => {
      const wsku = wskuMap.get(snap.warehouseSkuId)
      const days = Number(snap.daysOfStock)
      let ageCategory: string
      if (days <= 30) ageCategory = '0-30d'
      else if (days <= 60) ageCategory = '31-60d'
      else if (days <= 90) ageCategory = '61-90d'
      else ageCategory = '90d+'

      return {
        warehouseSkuId: snap.warehouseSkuId,
        skuCode: wsku?.systemSku?.skuCode ?? snap.warehouseSkuId,
        productName: wsku?.systemSku?.systemProduct?.name ?? '',
        warehouse: wsku?.warehouse?.name ?? '',
        quantityOnHand: snap.quantityOnHand,
        inventoryValue: Number(snap.inventoryValue),
        daysOfStock: days,
        ageCategory,
      }
    })

    return { success: true, data: rows }
  })

  // GET /reports/dashboard-stats
  app.get('/dashboard-stats', async (request) => {
    const tenantId = request.user.tenantId
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    try {
      const hasFacts = await prisma.salesFact.count({
        where: { tenantId, date: { gte: thirtyDaysAgo } },
      })

      if (hasFacts > 0) {
        const facts = await prisma.salesFact.findMany({
          where: { tenantId, date: { gte: thirtyDaysAgo } },
          orderBy: { date: 'asc' },
        })

        const byDate = new Map<string, { date: string; revenue: number; profit: number }>()
        for (const f of facts) {
          const key = f.date.toISOString().slice(0, 10)
          const existing = byDate.get(key) ?? { date: key, revenue: 0, profit: 0 }
          existing.revenue += Number(f.grossRevenue)
          existing.profit += Number(f.profit)
          byDate.set(key, existing)
        }

        return { success: true, data: Array.from(byDate.values()) }
      }
    } catch (_err) {
      // fall through
    }

    // Fallback: query orders directly
    const orders = await prisma.order.findMany({
      where: {
        tenantId,
        createdAt: { gte: thirtyDaysAgo },
        status: { notIn: ['CANCELLED'] as any[] },
      },
      select: { createdAt: true, totalRevenue: true, platformCommission: true, shippingFeeSeller: true },
      orderBy: { createdAt: 'asc' },
    })

    const byDate = new Map<string, { date: string; revenue: number; profit: number }>()
    for (const o of orders) {
      const key = o.createdAt.toISOString().slice(0, 10)
      const existing = byDate.get(key) ?? { date: key, revenue: 0, profit: 0 }
      existing.revenue += Number(o.totalRevenue)
      existing.profit += Number(o.totalRevenue) - Number(o.platformCommission) - Number(o.shippingFeeSeller)
      byDate.set(key, existing)
    }

    return { success: true, data: Array.from(byDate.values()) }
  })
}
