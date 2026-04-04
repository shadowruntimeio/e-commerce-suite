import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'

export async function restockingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET / — list PENDING suggestions for tenant
  app.get('/', async (request) => {
    const suggestions = await prisma.restockingSuggestion.findMany({
      where: {
        tenantId: request.user.tenantId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      include: {
        systemSku: {
          select: {
            id: true,
            skuCode: true,
            attributes: true,
            systemProduct: { select: { id: true, name: true, spuCode: true } },
          },
        },
        warehouseSku: {
          select: {
            id: true,
            safetyStockDays: true,
            reorderPoint: true,
            warehouse: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    return { success: true, data: suggestions }
  })

  // POST /:id/accept — create a PurchaseOrder draft from the suggestion
  app.post('/:id/accept', async (request, reply) => {
    const { id } = request.params as { id: string }

    const suggestion = await prisma.restockingSuggestion.findFirst({
      where: { id, tenantId: request.user.tenantId, status: 'PENDING' },
      include: {
        warehouseSku: { select: { warehouseId: true, systemSkuId: true } },
        systemSku: { select: { costPrice: true } },
      },
    })

    if (!suggestion) {
      return reply.status(404).send({ success: false, error: 'Suggestion not found or already actioned' })
    }

    // Find any active supplier for the tenant, or create PO without one
    const supplier = await prisma.supplier.findFirst({
      where: { tenantId: request.user.tenantId, isActive: true },
    })

    if (!supplier) {
      return reply.status(400).send({
        success: false,
        error: 'No active supplier found. Please create a supplier before accepting restocking suggestions.',
      })
    }

    const unitCost = Number(suggestion.systemSku.costPrice) || 0
    const totalAmount = suggestion.suggestedQty * unitCost

    const [po] = await prisma.$transaction([
      prisma.purchaseOrder.create({
        data: {
          tenantId: request.user.tenantId,
          supplierId: supplier.id,
          warehouseId: suggestion.warehouseSku.warehouseId,
          status: 'DRAFT',
          totalAmount,
          currency: 'USD',
          notes: `Auto-generated from restocking suggestion ${suggestion.id}`,
          createdBy: request.user.userId,
          items: {
            create: [
              {
                systemSkuId: suggestion.systemSkuId,
                quantityOrdered: suggestion.suggestedQty,
                unitCost,
              },
            ],
          },
        },
        include: { items: true, supplier: true, warehouse: true },
      }),
      prisma.restockingSuggestion.update({
        where: { id },
        data: { status: 'accepted' },
      }),
    ])

    return reply.status(201).send({ success: true, data: po })
  })

  // POST /:id/dismiss — set suggestion status to rejected
  app.post('/:id/dismiss', async (request, reply) => {
    const { id } = request.params as { id: string }

    const suggestion = await prisma.restockingSuggestion.findFirst({
      where: { id, tenantId: request.user.tenantId, status: 'PENDING' },
    })

    if (!suggestion) {
      return reply.status(404).send({ success: false, error: 'Suggestion not found or already actioned' })
    }

    const updated = await prisma.restockingSuggestion.update({
      where: { id },
      data: { status: 'rejected' },
    })

    return { success: true, data: updated }
  })
}
