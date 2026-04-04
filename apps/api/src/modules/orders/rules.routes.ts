import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import {
  evaluateConditions,
  type RuleConditions,
  type RuleAction,
  type OrderContext,
} from './rules-engine'

const conditionSchema = z.object({
  field: z.string(),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in']),
  value: z.unknown(),
})

const conditionsSchema = z.object({
  operator: z.enum(['AND', 'OR']),
  rules: z.array(conditionSchema),
})

const actionSchema = z.object({
  type: z.enum(['add_tag', 'assign_warehouse', 'flag_for_review', 'auto_confirm', 'set_priority']),
  value: z.string().optional(),
})

const createRuleSchema = z.object({
  name: z.string().min(1),
  priority: z.number().int().default(0),
  shopId: z.string().optional(),
  conditions: conditionsSchema,
  actions: z.array(actionSchema).min(1),
  isActive: z.boolean().default(true),
})

const updateRuleSchema = createRuleSchema.partial()

const testRuleSchema = z.object({
  conditions: conditionsSchema,
  actions: z.array(actionSchema),
  orderId: z.string(),
})

export async function rulesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /rules — list all rules for tenant
  app.get('/', async (request) => {
    const rules = await prisma.orderRule.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { priority: 'desc' },
    })
    return { success: true, data: rules }
  })

  // POST /rules — create a rule
  app.post('/', async (request, reply) => {
    const body = createRuleSchema.parse(request.body)
    const rule = await prisma.orderRule.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        tenantId: request.user.tenantId,
        name: body.name,
        priority: body.priority,
        shopId: body.shopId,
        conditions: body.conditions as any,
        actions: body.actions as any,
        isActive: body.isActive,
      },
    })
    return reply.status(201).send({ success: true, data: rule })
  })

  // PUT /rules/:id — update a rule
  app.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = updateRuleSchema.parse(request.body)

    const existing = await prisma.orderRule.findFirst({
      where: { id, tenantId: request.user.tenantId },
    })
    if (!existing) {
      return reply.status(404).send({ success: false, error: 'Rule not found' })
    }

    const rule = await prisma.orderRule.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.shopId !== undefined ? { shopId: body.shopId } : {}),
        ...(body.conditions !== undefined ? { conditions: body.conditions as any } : {}),
        ...(body.actions !== undefined ? { actions: body.actions as any } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      } as any,
    })
    return { success: true, data: rule }
  })

  // DELETE /rules/:id — delete a rule
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await prisma.orderRule.findFirst({
      where: { id, tenantId: request.user.tenantId },
    })
    if (!existing) {
      return reply.status(404).send({ success: false, error: 'Rule not found' })
    }
    await prisma.orderRule.delete({ where: { id } })
    return { success: true, data: { message: 'Rule deleted' } }
  })

  // POST /rules/test — dry-run a rule against an order (no DB writes)
  app.post('/test', async (request, reply) => {
    const body = testRuleSchema.parse(request.body)

    const order = await prisma.order.findFirst({
      where: { id: body.orderId, tenantId: request.user.tenantId },
      include: {
        shop: { select: { platform: true } },
        items: true,
      },
    })
    if (!order) {
      return reply.status(404).send({ success: false, error: 'Order not found' })
    }

    const context: OrderContext = {
      status: order.status,
      platform: order.shop.platform,
      shopId: order.shopId,
      totalRevenue: Number(order.totalRevenue),
      itemCount: order.items.length,
      buyerName: order.buyerName ?? '',
      currency: order.currency,
      tags: order.tags,
    }

    const matched = evaluateConditions(body.conditions as RuleConditions, context)
    return {
      success: true,
      data: {
        matched,
        context,
        actions: matched ? body.actions : [],
        message: matched ? 'Rule would match and apply actions (dry-run)' : 'Rule would NOT match',
      },
    }
  })
}
