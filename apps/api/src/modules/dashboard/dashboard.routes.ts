import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const tenantId = request.user.tenantId

    const now = new Date()
    const today = new Date(now); today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const activeShopFilter = { shop: { status: { not: 'INACTIVE' as const } } }
    const notCancelled = { status: { notIn: ['CANCELLED'] as any[] } }

    // Buyer-intent window: use platformCreatedAt when present, else fall back to createdAt
    const inWindow = (gte: Date, lt?: Date) => ({
      OR: [
        { platformCreatedAt: { gte, ...(lt ? { lt } : {}) } },
        { platformCreatedAt: null, createdAt: { gte, ...(lt ? { lt } : {}) } },
      ],
    })

    const [
      pendingOrders,
      toShipOrders,
      todayOrdersCount,
      yesterdayOrdersCount,
      thisMonthOrdersCount,
      shops,
      todayRevenueAgg,
      yesterdayRevenueAgg,
      thisMonthRevenueAgg,
    ] = await Promise.all([
      prisma.order.count({ where: { tenantId, status: 'PENDING', ...activeShopFilter } }),
      prisma.order.count({ where: { tenantId, status: 'TO_SHIP', ...activeShopFilter } }),
      prisma.order.count({ where: { tenantId, ...activeShopFilter, ...inWindow(today) } }),
      prisma.order.count({ where: { tenantId, ...activeShopFilter, ...inWindow(yesterday, today) } }),
      prisma.order.count({ where: { tenantId, ...activeShopFilter, ...inWindow(monthStart) } }),
      prisma.shop.count({ where: { tenantId, status: 'ACTIVE' } }),
      prisma.order.aggregate({
        where: { tenantId, ...activeShopFilter, ...notCancelled, ...inWindow(today) },
        _sum: { totalRevenue: true },
      }),
      prisma.order.aggregate({
        where: { tenantId, ...activeShopFilter, ...notCancelled, ...inWindow(yesterday, today) },
        _sum: { totalRevenue: true },
      }),
      prisma.order.aggregate({
        where: { tenantId, ...activeShopFilter, ...notCancelled, ...inWindow(monthStart) },
        _sum: { totalRevenue: true },
      }),
    ])

    const todayRevenue = Number(todayRevenueAgg._sum?.totalRevenue ?? 0)
    const yesterdayRevenue = Number(yesterdayRevenueAgg._sum?.totalRevenue ?? 0)
    const thisMonthRevenue = Number(thisMonthRevenueAgg._sum?.totalRevenue ?? 0)

    const pctChange = (cur: number, prev: number): number | null => {
      if (prev === 0) return cur === 0 ? 0 : null
      return ((cur - prev) / prev) * 100
    }

    return {
      success: true,
      data: {
        pendingOrders,
        toShipOrders,
        todayOrdersCount,
        todayRevenue,
        yesterdayOrdersCount,
        yesterdayRevenue,
        thisMonthOrdersCount,
        thisMonthRevenue,
        ordersTrendPct: pctChange(todayOrdersCount, yesterdayOrdersCount),
        revenueTrendPct: pctChange(todayRevenue, yesterdayRevenue),
        activeShops: shops,
      },
    }
  })
}
