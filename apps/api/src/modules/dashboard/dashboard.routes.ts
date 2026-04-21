import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const tenantId = request.user.tenantId
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const activeShopFilter = { shop: { status: { not: 'INACTIVE' as const } } }

    const [
      pendingOrders,
      toShipOrders,
      todayOrdersCount,
      shops,
    ] = await Promise.all([
      prisma.order.count({ where: { tenantId, status: 'PENDING', ...activeShopFilter } }),
      prisma.order.count({ where: { tenantId, status: 'TO_SHIP', ...activeShopFilter } }),
      prisma.order.count({ where: { tenantId, createdAt: { gte: today }, ...activeShopFilter } }),
      prisma.shop.count({ where: { tenantId, status: 'ACTIVE' } }),
    ])

    const todayRevenue = await prisma.order.aggregate({
      where: { tenantId, createdAt: { gte: today }, status: { notIn: ['CANCELLED'] }, ...activeShopFilter },
      _sum: { totalRevenue: true },
    })

    return {
      success: true,
      data: {
        pendingOrders,
        toShipOrders,
        todayOrdersCount,
        todayRevenue: todayRevenue._sum.totalRevenue ?? 0,
        activeShops: shops,
      },
    }
  })
}
