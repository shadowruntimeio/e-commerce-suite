import type { FastifyRequest } from 'fastify'
import { prisma, type Prisma, type PrismaClient } from '@ems/db'

export const AuditAction = {
  // Auth / users
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DEACTIVATE: 'user.deactivate',
  USER_REACTIVATE: 'user.reactivate',
  USER_LOGIN: 'user.login',
  // Orders
  ORDER_MERCHANT_CONFIRM: 'order.merchant_confirm',
  ORDER_MERCHANT_CANCEL: 'order.merchant_cancel',
  ORDER_AUTO_CONFIRM: 'order.auto_confirm',
  ORDER_STATUS_UPDATE: 'order.status_update',
  // Inventory
  INVENTORY_ADJUST: 'inventory.adjust',
  INVENTORY_RESERVE: 'inventory.reserve',
  INVENTORY_RELEASE: 'inventory.release',
  INVENTORY_INBOUND: 'inventory.inbound',
  INVENTORY_OUTBOUND: 'inventory.outbound',
  INVENTORY_ADJUSTED: 'inventory.adjusted',
  INVENTORY_IMPORT_APPLIED: 'inventory.import_applied',
  INBOUND_SHIPMENT_SUBMIT: 'inbound_shipment.submit',
  INBOUND_SHIPMENT_CONFIRM: 'inbound_shipment.confirm',
  INBOUND_SHIPMENT_REJECT: 'inbound_shipment.reject',
  // PO
  PO_CREATE: 'po.create',
  PO_APPROVE: 'po.approve',
  PO_REJECT: 'po.reject',
  // Returns
  RETURN_CREATE: 'return.create',
  RETURN_INTAKE: 'return.intake',
  RETURN_INSPECT: 'return.inspect',
  // Shops / products
  SHOP_CREATE: 'shop.create',
  SHOP_UPDATE: 'shop.update',
  PRODUCT_CREATE: 'product.create',
  PRODUCT_UPDATE: 'product.update',
} as const

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction]

export interface AuditEntry {
  tenantId: string
  actorUserId?: string | null
  action: AuditActionValue | string
  targetType?: string
  targetId?: string
  payload?: Record<string, unknown>
  ip?: string
  userAgent?: string
}

type Client = PrismaClient | Prisma.TransactionClient

/**
 * Write an audit log entry. Pass a transaction client to keep the write in
 * the same transaction as the underlying change — if the audit fails, the
 * caller's transaction will roll back.
 */
export async function recordAudit(entry: AuditEntry, client: Client = prisma): Promise<void> {
  await client.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      payload: (entry.payload as Prisma.InputJsonValue) ?? {},
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    },
  })
}

/** Convenience: pull tenantId/actor/ip/ua off the request. */
export function auditFromRequest(
  request: FastifyRequest,
  partial: Omit<AuditEntry, 'tenantId' | 'actorUserId' | 'ip' | 'userAgent'>
): AuditEntry {
  return {
    tenantId: request.user.tenantId,
    actorUserId: request.user.userId,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? undefined,
    ...partial,
  }
}
