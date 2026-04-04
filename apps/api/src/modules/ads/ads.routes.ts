import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { syncAdsQueue } from '../../lib/queues'

export async function adsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /ads — list ad spend grouped by shop
  app.get('/', async (request) => {
    const tenantId = request.user.tenantId
    const { dateFrom, dateTo, shopId } = request.query as {
      dateFrom?: string
      dateTo?: string
      shopId?: string
    }

    const from = dateFrom ? new Date(dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const to = dateTo ? new Date(dateTo) : new Date()

    const facts = await prisma.adSpendFact.findMany({
      where: {
        tenantId,
        date: { gte: from, lte: to },
        ...(shopId ? { shopId } : {}),
      },
    })

    // Group by shopId
    const byShop = new Map<string, {
      shopId: string
      totalSpend: number
      totalRevenue: number
      impressions: number
      clicks: number
    }>()

    for (const f of facts) {
      const existing = byShop.get(f.shopId) ?? {
        shopId: f.shopId,
        totalSpend: 0,
        totalRevenue: 0,
        impressions: 0,
        clicks: 0,
      }
      existing.totalSpend += Number(f.spend)
      existing.totalRevenue += Number(f.revenueAttributed)
      existing.impressions += f.impressions
      existing.clicks += f.clicks
      byShop.set(f.shopId, existing)
    }

    const rows = Array.from(byShop.values()).map((g) => ({
      ...g,
      overallROAS: g.totalSpend > 0 ? g.totalRevenue / g.totalSpend : 0,
      CTR: g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0,
    }))

    return { success: true, data: rows }
  })

  // GET /ads/campaigns — list campaign-level data
  app.get('/campaigns', async (request) => {
    const tenantId = request.user.tenantId
    const { dateFrom, dateTo, shopId } = request.query as {
      dateFrom?: string
      dateTo?: string
      shopId?: string
    }

    const from = dateFrom ? new Date(dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const to = dateTo ? new Date(dateTo) : new Date()

    const facts = await prisma.adSpendFact.findMany({
      where: {
        tenantId,
        date: { gte: from, lte: to },
        ...(shopId ? { shopId } : {}),
      },
      orderBy: { date: 'desc' },
    })

    // Group by campaignId
    const byCampaign = new Map<string, {
      campaignId: string
      campaignName: string | null
      shopId: string
      platform: string
      impressions: number
      clicks: number
      spend: number
      revenueAttributed: number
      roas: number
    }>()

    for (const f of facts) {
      const existing = byCampaign.get(f.campaignId) ?? {
        campaignId: f.campaignId,
        campaignName: f.campaignName ?? null,
        shopId: f.shopId,
        platform: f.platform,
        impressions: 0,
        clicks: 0,
        spend: 0,
        revenueAttributed: 0,
        roas: 0,
      }
      existing.impressions += f.impressions
      existing.clicks += f.clicks
      existing.spend += Number(f.spend)
      existing.revenueAttributed += Number(f.revenueAttributed)
      byCampaign.set(f.campaignId, existing)
    }

    const rows = Array.from(byCampaign.values()).map((g) => ({
      ...g,
      roas: g.spend > 0 ? g.revenueAttributed / g.spend : 0,
      CTR: g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0,
    }))

    return { success: true, data: rows }
  })

  // POST /ads/sync — queue sync-ads jobs for all active shops
  app.post('/sync', async (request, reply) => {
    const tenantId = request.user.tenantId

    const activeShops = await prisma.shop.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { id: true, tenantId: true },
    })

    for (const shop of activeShops) {
      await syncAdsQueue.add(
        'sync-ads',
        { shopId: shop.id, tenantId: shop.tenantId },
        { jobId: `sync-ads-${shop.id}-${Math.floor(Date.now() / 60000)}` }
      )
    }

    return reply.status(202).send({ success: true, data: { queued: activeShops.length } })
  })
}
