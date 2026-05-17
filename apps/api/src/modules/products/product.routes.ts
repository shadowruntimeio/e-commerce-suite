import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { recordAudit, AuditAction } from '../../lib/audit'

const createProductSchema = z.object({
  spuCode: z.string().min(1),
  name: z.string().min(1),
  categoryId: z.string().optional(),
  brand: z.string().optional(),
  weightG: z.number().int().optional(),
  skus: z.array(z.object({
    skuCode: z.string().min(1),
    attributes: z.record(z.string()),
    costPrice: z.number().min(0).default(0),
  })).min(1),
})

export async function productRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // List synced platform products (OnlineProduct) from connected shops
  app.get('/', async (request) => {
    const q = request.query as { page?: string; pageSize?: string; search?: string; status?: string; shopId?: string }
    const page = parseInt(q.page ?? '1', 10)
    const pageSize = parseInt(q.pageSize ?? '20', 10)

    const shopFilter: Record<string, unknown> = {
      tenantId: request.user.tenantId,
      status: { not: 'INACTIVE' },
    }
    if (request.user.role === 'MERCHANT') {
      shopFilter.ownerUserId = request.user.userId
    }
    const where: Record<string, unknown> = { shop: shopFilter }
    if (q.search) {
      where.title = { contains: q.search, mode: 'insensitive' }
    }
    if (q.status) {
      where.status = q.status
    }
    if (q.shopId) {
      where.shopId = q.shopId
    }

    const [items, total] = await Promise.all([
      prisma.onlineProduct.findMany({
        where,
        include: {
          onlineSkus: true,
          shop: { select: { id: true, name: true, platform: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.onlineProduct.count({ where }),
    ])
    return { success: true, data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } }
  })

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const where: Record<string, unknown> = { id, tenantId: request.user.tenantId }
    if (request.user.role === 'MERCHANT') where.ownerUserId = request.user.userId
    const product = await prisma.systemProduct.findFirst({
      where,
      include: { skus: { include: { warehouseSkus: { include: { warehouse: true } } } }, category: true },
    })
    if (!product) return reply.status(404).send({ success: false, error: 'Product not found' })
    return { success: true, data: product }
  })

  const createProductSchemaWithOwner = createProductSchema.extend({
    ownerUserId: z.string().optional(), // required for ADMIN/WAREHOUSE_STAFF; defaulted for MERCHANT
  })

  app.post('/', async (request, reply) => {
    const body = createProductSchemaWithOwner.parse(request.body)
    let ownerUserId = body.ownerUserId
    if (request.user.role === 'MERCHANT') {
      ownerUserId = request.user.userId
    } else if (!ownerUserId) {
      return reply.status(400).send({ success: false, error: 'ownerUserId required when creating on behalf of a merchant' })
    } else {
      const owner = await prisma.user.findFirst({
        where: { id: ownerUserId, tenantId: request.user.tenantId, role: 'MERCHANT' },
      })
      if (!owner) return reply.status(400).send({ success: false, error: 'Invalid merchant owner' })
    }

    const product = await prisma.systemProduct.create({
      data: {
        tenantId: request.user.tenantId,
        ownerUserId,
        spuCode: body.spuCode,
        name: body.name,
        categoryId: body.categoryId,
        brand: body.brand,
        weightG: body.weightG,
        skus: {
          create: body.skus.map((sku) => ({
            skuCode: sku.skuCode,
            attributes: sku.attributes,
            costPrice: sku.costPrice,
          })),
        },
      },
      include: { skus: true },
    })
    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.PRODUCT_CREATE,
      targetType: 'product',
      targetId: product.id,
      payload: { spuCode: body.spuCode, name: body.name, skuCount: body.skus.length, ownerUserId },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })
    return reply.status(201).send({ success: true, data: product })
  })
}
