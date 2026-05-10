import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { requireRoles } from '../../middleware/authorize'
import { recordAudit, AuditAction } from '../../lib/audit'
import { createInventoryEvent } from './inventory.service'

/**
 * Merchant-submitted inbound shipments. Flow:
 *
 *   merchant uploads xlsx -> previews -> POST /inbound-shipments
 *     (status=PENDING_REVIEW; no inventory change)
 *   warehouse staff sees pending list -> opens detail -> optionally edits
 *     per-item confirmedQuantity -> POST /confirm
 *     (writes INBOUND inventory events for each confirmed line)
 *   warehouse may also POST /reject (no inventory change)
 *
 * Quantity adjustments at confirm time emit a MerchantNotification so the
 * submitting merchant sees a banner / inbox entry.
 *
 * WAREHOUSE_STAFF and ADMIN keep the legacy direct-write import path; this
 * gate only applies when the caller is a MERCHANT.
 */

const itemSchema = z.object({
  systemSkuId: z.string().min(1),
  expectedQuantity: z.number().int().min(0),
})

const submitSchema = z.object({
  warehouseId: z.string().min(1),
  shippedAt: z.string().min(1),       // ISO date
  carrier: z.string().min(1),
  trackingNumber: z.string().min(1),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1),
})

const confirmItemSchema = z.object({
  itemId: z.string(),
  confirmedQuantity: z.number().int().min(0),
})

const confirmSchema = z.object({
  items: z.array(confirmItemSchema).min(1),
})

const rejectSchema = z.object({
  reason: z.string().min(1).max(500),
})

export async function inboundShipmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // ─── Merchant: submit a new shipment ─────────────────────────────────────
  app.post('/', { preHandler: requireRoles(['MERCHANT']) }, async (request, reply) => {
    const parsed = submitSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.message })
    const { warehouseId, shippedAt, carrier, trackingNumber, notes, items } = parsed.data

    // All listed SKUs must belong to this merchant.
    const skus = await prisma.systemSku.findMany({
      where: { id: { in: items.map((i) => i.systemSkuId) } },
      include: { systemProduct: { select: { ownerUserId: true, tenantId: true } } },
    })
    if (skus.length !== items.length) {
      return reply.status(400).send({ success: false, error: 'One or more SKUs not found' })
    }
    for (const sku of skus) {
      if (sku.systemProduct.tenantId !== request.user.tenantId || sku.systemProduct.ownerUserId !== request.user.userId) {
        return reply.status(403).send({ success: false, error: `SKU ${sku.id} is not owned by this merchant` })
      }
    }

    const wh = await prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId: request.user.tenantId, isActive: true },
      select: { id: true },
    })
    if (!wh) return reply.status(400).send({ success: false, error: 'Warehouse not found or inactive' })

    const shipment = await prisma.inboundShipment.create({
      data: {
        tenantId: request.user.tenantId,
        ownerUserId: request.user.userId,
        warehouseId,
        shippedAt: new Date(shippedAt),
        carrier,
        trackingNumber,
        notes: notes ?? null,
        items: {
          create: items.map((i) => ({
            systemSkuId: i.systemSkuId,
            expectedQuantity: i.expectedQuantity,
          })),
        },
      },
      include: { items: true },
    })

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.INBOUND_SHIPMENT_SUBMIT,
      targetType: 'inbound_shipment',
      targetId: shipment.id,
      payload: { warehouseId, itemCount: items.length, status: 'PENDING_REVIEW' },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true, data: shipment }
  })

  // ─── List shipments ──────────────────────────────────────────────────────
  // MERCHANT sees only own; WAREHOUSE_STAFF / ADMIN see all (defaults to
  // PENDING_REVIEW when no status filter given).
  app.get('/', async (request) => {
    const { status, ownerUserId } = request.query as { status?: string; ownerUserId?: string }
    const where: Record<string, unknown> = { tenantId: request.user.tenantId }
    if (request.user.role === 'MERCHANT') where.ownerUserId = request.user.userId
    else if (ownerUserId) where.ownerUserId = ownerUserId
    if (status) where.status = status
    else if (request.user.role !== 'MERCHANT') where.status = 'PENDING_REVIEW'

    const shipments = await prisma.inboundShipment.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      take: 100,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        warehouse: { select: { id: true, name: true } },
        items: {
          include: { systemSku: { include: { systemProduct: { select: { name: true } } } } },
        },
        reviewer: { select: { id: true, name: true } },
      },
    })
    return { success: true, data: shipments }
  })

  // ─── Detail ──────────────────────────────────────────────────────────────
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const shipment = await prisma.inboundShipment.findFirst({
      where: {
        id,
        tenantId: request.user.tenantId,
        ...(request.user.role === 'MERCHANT' ? { ownerUserId: request.user.userId } : {}),
      },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        warehouse: { select: { id: true, name: true } },
        reviewer: { select: { id: true, name: true } },
        items: {
          include: { systemSku: { include: { systemProduct: { select: { name: true } } } } },
        },
      },
    })
    if (!shipment) return reply.status(404).send({ success: false, error: 'Shipment not found' })
    return { success: true, data: shipment }
  })

  // ─── Warehouse: confirm shipment with per-item quantities ────────────────
  app.post('/:id/confirm', { preHandler: requireRoles(['ADMIN', 'WAREHOUSE_STAFF']) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = confirmSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.message })

    const shipment = await prisma.inboundShipment.findFirst({
      where: { id, tenantId: request.user.tenantId, status: 'PENDING_REVIEW' },
      include: { items: { include: { systemSku: true } } },
    })
    if (!shipment) return reply.status(404).send({ success: false, error: 'Shipment not found or already reviewed' })

    // Map confirmed qtys onto the existing items; any item not present in the
    // payload keeps its expectedQuantity (warehouse implicitly accepted as-is).
    const updates = new Map(parsed.data.items.map((i) => [i.itemId, i.confirmedQuantity]))
    const adjustments: Array<{ itemId: string; productName: string; expected: number; confirmed: number }> = []

    await prisma.$transaction(async (tx) => {
      for (const item of shipment.items) {
        const confirmedQty = updates.has(item.id) ? updates.get(item.id)! : item.expectedQuantity
        await tx.inboundShipmentItem.update({
          where: { id: item.id },
          data: { confirmedQuantity: confirmedQty },
        })
        if (confirmedQty !== item.expectedQuantity) {
          adjustments.push({
            itemId: item.id,
            productName: item.systemSku.skuCode,
            expected: item.expectedQuantity,
            confirmed: confirmedQty,
          })
        }

        if (confirmedQty > 0) {
          // Find or create the WarehouseSku row for this (sku, warehouse).
          const wsku = await tx.warehouseSku.upsert({
            where: { systemSkuId_warehouseId: { systemSkuId: item.systemSkuId, warehouseId: shipment.warehouseId } },
            update: {},
            create: {
              systemSkuId: item.systemSkuId,
              warehouseId: shipment.warehouseId,
              ownerUserId: shipment.ownerUserId,
            },
          })
          // Inventory event lives outside this tx via createInventoryEvent's
          // own transaction — we'll write it after this loop. Defer to keep
          // ordering linear: events written below.
        }
      }

      await tx.inboundShipment.update({
        where: { id: shipment.id },
        data: {
          status: 'CONFIRMED',
          reviewedAt: new Date(),
          reviewedByUserId: request.user.userId,
        },
      })
    })

    // Write inventory events outside the prisma.$transaction (createInventoryEvent
    // opens its own). Events are idempotent; the shipment row is now CONFIRMED
    // so even on partial failure here, a retry sees CONFIRMED and won't
    // double-write — but for robustness check shipment status before each event.
    for (const item of shipment.items) {
      const confirmedQty = updates.has(item.id) ? updates.get(item.id)! : item.expectedQuantity
      if (confirmedQty <= 0) continue
      const wsku = await prisma.warehouseSku.findUnique({
        where: { systemSkuId_warehouseId: { systemSkuId: item.systemSkuId, warehouseId: shipment.warehouseId } },
      })
      if (!wsku) continue
      await createInventoryEvent({
        tenantId: shipment.tenantId,
        warehouseSkuId: wsku.id,
        warehouseId: shipment.warehouseId,
        eventType: 'INBOUND',
        quantityDelta: confirmedQty,
        referenceType: 'inbound_shipment',
        referenceId: shipment.id,
        notes: `Inbound shipment ${shipment.trackingNumber} (${shipment.carrier})`,
        createdBy: request.user.userId,
      })
    }

    if (adjustments.length > 0) {
      await prisma.merchantNotification.create({
        data: {
          tenantId: shipment.tenantId,
          userId: shipment.ownerUserId,
          type: 'SHIPMENT_QUANTITY_ADJUSTED',
          title: `Inbound shipment ${shipment.trackingNumber} confirmed with adjustments`,
          body: `${adjustments.length} SKU${adjustments.length === 1 ? '' : 's'} had quantity changes during confirmation.`,
          payload: { shipmentId: shipment.id, adjustments },
        },
      })
    }

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.INBOUND_SHIPMENT_CONFIRM,
      targetType: 'inbound_shipment',
      targetId: shipment.id,
      payload: { confirmed: true, adjustments: adjustments.length },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true, data: { id: shipment.id, adjustments: adjustments.length } }
  })

  // ─── Warehouse: reject shipment ───────────────────────────────────────────
  app.post('/:id/reject', { preHandler: requireRoles(['ADMIN', 'WAREHOUSE_STAFF']) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = rejectSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.message })

    const shipment = await prisma.inboundShipment.findFirst({
      where: { id, tenantId: request.user.tenantId, status: 'PENDING_REVIEW' },
    })
    if (!shipment) return reply.status(404).send({ success: false, error: 'Shipment not found or already reviewed' })

    await prisma.inboundShipment.update({
      where: { id: shipment.id },
      data: {
        status: 'REJECTED',
        rejectReason: parsed.data.reason,
        reviewedAt: new Date(),
        reviewedByUserId: request.user.userId,
      },
    })

    await prisma.merchantNotification.create({
      data: {
        tenantId: shipment.tenantId,
        userId: shipment.ownerUserId,
        type: 'SHIPMENT_REJECTED',
        title: `Inbound shipment ${shipment.trackingNumber} rejected`,
        body: parsed.data.reason,
        payload: { shipmentId: shipment.id, reason: parsed.data.reason },
      },
    })

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.INBOUND_SHIPMENT_REJECT,
      targetType: 'inbound_shipment',
      targetId: shipment.id,
      payload: { rejected: true, reason: parsed.data.reason },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true, data: { id: shipment.id } }
  })
}
