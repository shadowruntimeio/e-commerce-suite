import { prisma } from '@ems/db'
import type { Prisma } from '@ems/db'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RuleCondition {
  field: string
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in'
  value: unknown
}

export interface RuleConditions {
  operator: 'AND' | 'OR'
  rules: RuleCondition[]
}

export interface RuleAction {
  type: 'add_tag' | 'assign_warehouse' | 'flag_for_review' | 'auto_confirm' | 'set_priority'
  value?: string
}

export interface OrderContext {
  status: string
  platform: string
  shopId: string
  totalRevenue: number
  itemCount: number
  buyerName: string
  currency: string
  tags: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaTransaction = any

// ─── Evaluator (pure — no side effects) ──────────────────────────────────────

function evaluateCondition(condition: RuleCondition, order: OrderContext): boolean {
  const rawValue = (order as unknown as Record<string, unknown>)[condition.field]

  switch (condition.op) {
    case 'eq':
      return rawValue === condition.value
    case 'neq':
      return rawValue !== condition.value
    case 'gt':
      return typeof rawValue === 'number' && rawValue > (condition.value as number)
    case 'gte':
      return typeof rawValue === 'number' && rawValue >= (condition.value as number)
    case 'lt':
      return typeof rawValue === 'number' && rawValue < (condition.value as number)
    case 'lte':
      return typeof rawValue === 'number' && rawValue <= (condition.value as number)
    case 'contains':
      if (typeof rawValue === 'string') {
        return rawValue.toLowerCase().includes(String(condition.value).toLowerCase())
      }
      if (Array.isArray(rawValue)) {
        return rawValue.includes(condition.value)
      }
      return false
    case 'in':
      return Array.isArray(condition.value) && (condition.value as unknown[]).includes(rawValue)
    default:
      return false
  }
}

export function evaluateConditions(conditions: RuleConditions, order: OrderContext): boolean {
  if (!conditions.rules || conditions.rules.length === 0) return true

  if (conditions.operator === 'AND') {
    return conditions.rules.every((rule) => evaluateCondition(rule, order))
  } else {
    return conditions.rules.some((rule) => evaluateCondition(rule, order))
  }
}

// ─── Action applicator (writes to DB) ─────────────────────────────────────────

export async function applyActions(
  actions: RuleAction[],
  order: { id: string; status: string; tags: string[] },
  tx: PrismaTransaction
): Promise<void> {
  const newTags = [...order.tags]
  let newStatus: string | undefined

  for (const action of actions) {
    switch (action.type) {
      case 'add_tag':
        if (action.value && !newTags.includes(action.value)) {
          newTags.push(action.value)
        }
        break

      case 'assign_warehouse':
        if (action.value) {
          const warehouseTag = `warehouse:${action.value}`
          if (!newTags.includes(warehouseTag)) {
            newTags.push(warehouseTag)
          }
        }
        break

      case 'flag_for_review':
        if (!newTags.includes('review')) {
          newTags.push('review')
        }
        break

      case 'auto_confirm':
        if (order.status === 'PENDING') {
          newStatus = 'TO_SHIP'
        }
        break

      case 'set_priority':
        if (action.value) {
          const priorityTag = `priority:${action.value}`
          // Remove any existing priority tags first
          const filtered = newTags.filter((t) => !t.startsWith('priority:'))
          filtered.push(priorityTag)
          newTags.splice(0, newTags.length, ...filtered)
        }
        break
    }
  }

  const updateData: Record<string, unknown> = { tags: newTags }
  if (newStatus) {
    updateData.status = newStatus
  }

  await tx.order.update({
    where: { id: order.id },
    data: updateData as any,
  })
}

// ─── Main runner ──────────────────────────────────────────────────────────────

export async function runRulesForOrder(orderId: string, tenantId: string): Promise<void> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: {
      shop: { select: { platform: true } },
      items: true,
    },
  })

  if (!order) {
    console.warn(`[rules-engine] Order ${orderId} not found for tenant ${tenantId}`)
    return
  }

  const rules = await prisma.orderRule.findMany({
    where: { tenantId, isActive: true },
    orderBy: { priority: 'desc' },
  })

  if (rules.length === 0) return

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

  for (const rule of rules) {
    const conditions = rule.conditions as unknown as RuleConditions
    const actions = rule.actions as unknown as RuleAction[]

    if (evaluateConditions(conditions, context)) {
      await prisma.$transaction(async (tx) => {
        await applyActions(actions, { id: order.id, status: order.status, tags: order.tags }, tx)
      })
      // Stop after first matching rule (firewall style)
      break
    }
  }
}
