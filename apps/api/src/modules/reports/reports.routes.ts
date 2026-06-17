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

    const activeShops = await prisma.shop.findMany({
      where: { tenantId, status: { not: 'INACTIVE' } },
      select: { id: true },
    })
    const activeShopIds = activeShops.map((s) => s.id)
    const shopIdFilter = shopId
      ? { shopId: activeShopIds.includes(shopId) ? shopId : '__none__' }
      : { shopId: { in: activeShopIds } }

    // Try SalesFact first
    const hasFacts = await prisma.salesFact.count({ where: { tenantId } })

    if (hasFacts > 0) {
      const facts = await prisma.salesFact.findMany({
        where: {
          tenantId,
          date: { gte: from, lte: to },
          ...shopIdFilter,
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
      shop: { status: { not: 'INACTIVE' as const } },
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

    const activeShops = await prisma.shop.findMany({
      where: { tenantId, status: { not: 'INACTIVE' } },
      select: { id: true },
    })
    const activeShopIds = activeShops.map((s) => s.id)
    const shopIdFilter = shopId
      ? { shopId: activeShopIds.includes(shopId) ? shopId : '__none__' }
      : { shopId: { in: activeShopIds } }

    const facts = await prisma.salesFact.findMany({
      where: {
        tenantId,
        date: { gte: from, lte: to },
        systemSkuId: { not: null },
        ...shopIdFilter,
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
        const sku: any = skuMap.get(agg.systemSkuId)
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

  // GET /reports/profit-orders
  // Order-level profit report (Qianyi-style 利润报表). MERCHANT + ADMIN only —
  // warehouse staff never see merchant finances. Each row is one platform order
  // with its revenue breakdown, platform fees, COGS (from order items), and the
  // derived gross profit + margin. Settlement-accurate fee columns (platform
  // commission, transaction/affiliate fees, etc.) are populated by the TikTok
  // Finance API sync; until a shop is re-authorized with finance scope those
  // fields stay at their order-time values (often 0), and the report degrades
  // gracefully to revenue − COGS.
  app.get('/profit-orders', async (request, reply) => {
    if (request.user.role === 'WAREHOUSE_STAFF') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
    const tenantId = request.user.tenantId
    const q = request.query as {
      dateFrom?: string
      dateTo?: string
      shopId?: string
      platform?: string
      sku?: string
      search?: string
      settled?: string
      page?: string
      pageSize?: string
    }
    const page = Math.max(1, Number(q.page ?? 1))
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 50)))

    const dateRange: { gte?: Date; lte?: Date } = {}
    if (q.dateFrom) {
      const d = new Date(q.dateFrom)
      if (!isNaN(d.getTime())) dateRange.gte = d
    }
    if (q.dateTo) {
      const d = new Date(q.dateTo)
      if (!isNaN(d.getTime())) dateRange.lte = d
    }
    const hasDateFilter = dateRange.gte !== undefined || dateRange.lte !== undefined

    // Shop scope: merchants are force-scoped to shops they own. Platform orders
    // only (manual orders carry no platform fees / settlement).
    const shopFilter: Record<string, unknown> = { status: { not: 'INACTIVE' as const } }
    if (request.user.role === 'MERCHANT') {
      shopFilter.ownerUserId = request.user.userId
    }
    if (q.platform) shopFilter.platform = q.platform as any

    const where: Record<string, unknown> = {
      tenantId,
      isManual: false,
      shop: shopFilter,
      ...(q.shopId ? { shopId: q.shopId } : {}),
      ...(hasDateFilter ? { createdAt: dateRange } : {}),
      ...(q.sku
        ? { items: { some: { sellerSku: { contains: q.sku, mode: 'insensitive' as const } } } }
        : {}),
      ...(q.search ? { platformOrderId: { contains: q.search } } : {}),
      // Settlement filter: settled = has an OrderSettlement row; unsettled = none.
      ...(q.settled === 'true'
        ? { settlement: { isNot: null } }
        : q.settled === 'false'
          ? { settlement: { is: null } }
          : {}),
    }

    // Load the full matched set (capped) so per-row figures, totals, and the
    // settlement-vs-order-time preference all stay consistent. Each row prefers
    // TikTok Finance settlement data when it's been synced, falling back to the
    // order-time payment estimate otherwise. Order volumes per window are modest;
    // the cap is a backstop against a pathologically wide filter.
    const ROW_CAP = 10000
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          shop: { select: { name: true, platform: true } },
          items: { select: { quantity: true, costPriceAtOrder: true } },
          settlement: true,
        },
        take: ROW_CAP,
        orderBy: [{ platformCreatedAt: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.order.count({ where }),
    ])

    const computeRow = (o: typeof orders[number]) => {
      const cogs = o.items.reduce((s, it) => s + Number(it.costPriceAtOrder) * it.quantity, 0)
      const s = o.settlement
      const settled = !!s

      // Revenue/fee figures: settlement when present, else order-time estimate.
      const productAmount = settled ? Number(s!.grossSalesAmount) : Number(o.subtotal)
      const platformDiscount = settled ? Number(s!.platformDiscountAmount) : Number(o.platformDiscount)
      const sellerDiscount = settled ? Number(s!.sellerDiscountAmount) : Number(o.sellerDiscount)
      const buyerPaidShipping = settled ? Number(s!.customerPaidShippingFee) : Number(o.shippingFeeBuyer)
      const totalRevenue = settled ? Number(s!.revenueAmount) : Number(o.totalRevenue)
      const platformCommission = settled ? Number(s!.platformCommissionAmount) : Number(o.platformCommission)
      const referralFee = settled ? Number(s!.referralFeeAmount) : 0
      const transactionFee = settled ? Number(s!.transactionFeeAmount) : 0
      const affiliateCommission = settled ? Number(s!.affiliateCommission) : 0
      const refundAdminFee = settled ? Number(s!.refundAdminFeeAmount) : 0
      const shippingFeeSeller = settled ? Number(s!.shippingFeeAmount) : Number(o.shippingFeeSeller)
      const settlementAmount = settled ? Number(s!.settlementAmount) : 0

      // When settled, settlementAmount is already net of every platform fee, so
      // profit = payout − COGS. Otherwise approximate from the fields we have.
      const grossProfit = settled
        ? settlementAmount - cogs
        : totalRevenue - platformCommission - shippingFeeSeller - cogs
      const marginBase = settled ? totalRevenue : totalRevenue
      const grossMargin = marginBase > 0 ? (grossProfit / marginBase) * 100 : 0

      return {
        id: o.id,
        platformOrderId: o.platformOrderId,
        shopName: o.shop?.name ?? '',
        platform: o.shop?.platform ?? null,
        createdAt: o.createdAt,
        platformCreatedAt: o.platformCreatedAt,
        settled,
        settlementAmount,
        // revenue breakdown
        productAmount,
        platformDiscount,
        sellerDiscount,
        buyerPaidShipping,
        totalRevenue,
        // fees
        platformCommission,
        referralFee,
        transactionFee,
        affiliateCommission,
        refundAdminFee,
        shippingFeeSeller,
        // cost + profit
        cogs,
        grossProfit,
        grossMargin: Math.round(grossMargin * 100) / 100,
      }
    }

    const allRows = orders.map(computeRow)

    // Totals fold over the whole matched set; page slice is in-memory so totals
    // and rows are always derived from the same figures.
    const sum = (k: keyof (typeof allRows)[number]) =>
      allRows.reduce((acc, r) => acc + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0)
    const totalRevenueSum = sum('totalRevenue')
    const totalGrossProfit = sum('grossProfit')
    const totals = {
      settlementAmount: sum('settlementAmount'),
      productAmount: sum('productAmount'),
      platformDiscount: sum('platformDiscount'),
      sellerDiscount: sum('sellerDiscount'),
      buyerPaidShipping: sum('buyerPaidShipping'),
      totalRevenue: totalRevenueSum,
      platformCommission: sum('platformCommission'),
      referralFee: sum('referralFee'),
      transactionFee: sum('transactionFee'),
      affiliateCommission: sum('affiliateCommission'),
      refundAdminFee: sum('refundAdminFee'),
      shippingFeeSeller: sum('shippingFeeSeller'),
      cogs: sum('cogs'),
      grossProfit: totalGrossProfit,
      grossMargin: totalRevenueSum > 0 ? Math.round((totalGrossProfit / totalRevenueSum) * 10000) / 100 : 0,
    }

    const items = allRows.slice((page - 1) * pageSize, page * pageSize)

    return {
      success: true,
      data: { items, totals, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    }
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
      const wsku: any = wskuMap.get(snap.warehouseSkuId)
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

    const activeShops = await prisma.shop.findMany({
      where: { tenantId, status: { not: 'INACTIVE' } },
      select: { id: true },
    })
    const activeShopIds = activeShops.map((s) => s.id)

    try {
      const hasFacts = await prisma.salesFact.count({
        where: { tenantId, date: { gte: thirtyDaysAgo }, shopId: { in: activeShopIds } },
      })

      if (hasFacts > 0) {
        const facts = await prisma.salesFact.findMany({
          where: { tenantId, date: { gte: thirtyDaysAgo }, shopId: { in: activeShopIds } },
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
        status: { notIn: ['CANCELLED'] as any[] },
        shop: { status: { not: 'INACTIVE' } },
        OR: [
          { platformCreatedAt: { gte: thirtyDaysAgo } },
          { platformCreatedAt: null, createdAt: { gte: thirtyDaysAgo } },
        ],
      },
      select: { createdAt: true, platformCreatedAt: true, totalRevenue: true, platformCommission: true, shippingFeeSeller: true },
    })

    const byDate = new Map<string, { date: string; revenue: number; profit: number }>()
    for (const o of orders) {
      const when = o.platformCreatedAt ?? o.createdAt
      const key = when.toISOString().slice(0, 10)
      const existing = byDate.get(key) ?? { date: key, revenue: 0, profit: 0 }
      existing.revenue += Number(o.totalRevenue)
      existing.profit += Number(o.totalRevenue) - Number(o.platformCommission) - Number(o.shippingFeeSeller)
      byDate.set(key, existing)
    }

    const rows = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
    return { success: true, data: rows }
  })
}
