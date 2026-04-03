import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'

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

  app.get('/', async (request) => {
    const { page = 1, pageSize = 20, search } = request.query as { page?: number; pageSize?: number; search?: string }
    const where = {
      tenantId: request.user.tenantId,
      isActive: true,
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    }
    const [items, total] = await Promise.all([
      prisma.systemProduct.findMany({
        where,
        include: { skus: true, category: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.systemProduct.count({ where }),
    ])
    return { success: true, data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } }
  })

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const product = await prisma.systemProduct.findFirst({
      where: { id, tenantId: request.user.tenantId },
      include: { skus: { include: { warehouseSkus: { include: { warehouse: true } } } }, category: true },
    })
    if (!product) return reply.status(404).send({ success: false, error: 'Product not found' })
    return { success: true, data: product }
  })

  app.post('/', async (request, reply) => {
    const body = createProductSchema.parse(request.body)
    const product = await prisma.systemProduct.create({
      data: {
        tenantId: request.user.tenantId,
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
    return reply.status(201).send({ success: true, data: product })
  })
}
