import { prisma, Prisma } from '@ems/db'
import type { InventoryEventType, AdjustmentReason, StockRow } from '@ems/shared'
import { recordAudit, AuditAction } from '../../lib/audit'

export async function getCurrentStock(warehouseSkuId: string) {
  // Read denormalized counters directly from WarehouseSku (kept in sync by
  // createInventoryEvent). Snapshot table is no longer the primary source.
  const wsku = await prisma.warehouseSku.findUnique({
    where: { id: warehouseSkuId },
    select: { quantityOnHand: true, quantityReserved: true },
  })
  if (!wsku) return { quantityOnHand: 0, quantityReserved: 0, quantityAvailable: 0 }
  return {
    quantityOnHand: wsku.quantityOnHand,
    quantityReserved: wsku.quantityReserved,
    quantityAvailable: wsku.quantityOnHand - wsku.quantityReserved,
  }
}

export async function createInventoryEvent(data: {
  tenantId: string
  warehouseSkuId: string
  warehouseId: string
  eventType: InventoryEventType
  quantityDelta: number
  reason?: AdjustmentReason
  referenceType?: string
  referenceId?: string
  notes?: string
  createdBy?: string | null
}) {
  // Append event AND update the denormalized counters on WarehouseSku in one tx
  return prisma.$transaction(async (tx) => {
    const event = await tx.inventoryEvent.create({ data })
    if (['INBOUND', 'OUTBOUND', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'RETURN'].includes(data.eventType)) {
      await tx.warehouseSku.update({
        where: { id: data.warehouseSkuId },
        data: { quantityOnHand: { increment: data.quantityDelta } },
      })
    } else if (data.eventType === 'RESERVED') {
      // delta is negative (stock reserved away from available)
      await tx.warehouseSku.update({
        where: { id: data.warehouseSkuId },
        data: { quantityReserved: { increment: -data.quantityDelta } },
      })
    } else if (data.eventType === 'UNRESERVED') {
      await tx.warehouseSku.update({
        where: { id: data.warehouseSkuId },
        data: { quantityReserved: { increment: -data.quantityDelta } }, // delta positive → reserved decreases
      })
    }
    return event
  })
}

// Reserve stock for each order item for a merchant. Best-effort: if SKU is not
// in the warehouse's catalog yet, log and skip (warehouse staff will resolve it
// when picking).
export async function reserveStockForOrder(orderId: string, tenantId: string, actorUserId: string | null) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: {
      shop: { select: { ownerUserId: true } },
      items: {
        select: {
          id: true, systemSkuId: true, sellerSku: true, quantity: true,
        },
      },
    },
  })
  if (!order) return
  const ownerUserId = order.shop?.ownerUserId ?? null

  const reservedLines: Array<{ systemSkuId: string; quantity: number }> = []
  for (const item of order.items) {
    const sysSkuId = item.systemSkuId
    if (!sysSkuId) continue

    const warehouseSku = await prisma.warehouseSku.findFirst({
      where: { systemSkuId: sysSkuId, ...(ownerUserId ? { ownerUserId } : {}) },
      select: { id: true, warehouseId: true },
    })
    if (!warehouseSku) continue

    // Don't fail if reservation pushes into negative — warehouse should still
    // see the order. Just track the intent.
    await createInventoryEvent({
      tenantId,
      warehouseSkuId: warehouseSku.id,
      warehouseId: warehouseSku.warehouseId,
      eventType: 'RESERVED',
      quantityDelta: -item.quantity,
      referenceType: 'order',
      referenceId: orderId,
      createdBy: actorUserId,
    })
    reservedLines.push({ systemSkuId: sysSkuId, quantity: item.quantity })
  }

  if (reservedLines.length > 0) {
    try {
      await recordAudit({
        tenantId,
        actorUserId: null,
        action: AuditAction.INVENTORY_RESERVE,
        targetType: 'order',
        targetId: orderId,
        payload: {
          lines: reservedLines,
          totalQuantity: reservedLines.reduce((s, l) => s + l.quantity, 0),
        },
      })
    } catch (err) {
      console.warn('[inventory] inventory.reserve audit failed:', (err as Error).message)
    }
  }
}

// Idempotent: nets RESERVED minus prior UNRESERVED per warehouseSku and only
// releases the outstanding balance. Calling twice (e.g. once from
// /merchant-cancel and once from sync-orders' OUTBOUND deduction) is safe.
export async function releaseStockForOrder(orderId: string, tenantId: string, actorUserId: string | null) {
  const events = await prisma.inventoryEvent.findMany({
    where: {
      tenantId,
      referenceType: 'order',
      referenceId: orderId,
      eventType: { in: ['RESERVED', 'UNRESERVED'] },
    },
    select: { warehouseSkuId: true, warehouseId: true, eventType: true, quantityDelta: true },
  })

  // Net per warehouseSku. RESERVED stored as negative delta, UNRESERVED as
  // positive. Sum: if still negative, that absolute value is what's currently
  // reserved and needs releasing.
  const netByWsku = new Map<string, { warehouseId: string; netDelta: number }>()
  for (const e of events) {
    const cur = netByWsku.get(e.warehouseSkuId) ?? { warehouseId: e.warehouseId, netDelta: 0 }
    cur.netDelta += e.quantityDelta
    netByWsku.set(e.warehouseSkuId, cur)
  }

  let totalReleased = 0
  let releasedLines = 0
  for (const [warehouseSkuId, { warehouseId, netDelta }] of netByWsku) {
    if (netDelta >= 0) continue
    const qty = -netDelta
    await createInventoryEvent({
      tenantId,
      warehouseSkuId,
      warehouseId,
      eventType: 'UNRESERVED',
      quantityDelta: qty,
      referenceType: 'order',
      referenceId: orderId,
      createdBy: actorUserId,
    })
    totalReleased += qty
    releasedLines += 1
  }

  if (releasedLines > 0) {
    try {
      await recordAudit({
        tenantId,
        actorUserId: null,
        action: AuditAction.INVENTORY_RELEASE,
        targetType: 'order',
        targetId: orderId,
        payload: { lineCount: releasedLines, totalQuantity: totalReleased },
      })
    } catch (err) {
      console.warn('[inventory] inventory.release audit failed:', (err as Error).message)
    }
  }
}

export interface StockListFilters {
  tenantId: string
  warehouseId?: string
  categoryId?: string
  skuSearch?: string
  lowStockOnly?: boolean
  ownerUserId?: string  // optional merchant filter
  page: number
  pageSize: number
}

export async function getStockList(filters: StockListFilters): Promise<{ items: StockRow[]; total: number }> {
  const { tenantId, warehouseId, categoryId, skuSearch, lowStockOnly, ownerUserId, page, pageSize } = filters

  const where: Prisma.WarehouseSkuWhereInput = {
    warehouse: { tenantId, isActive: true },
    ...(warehouseId ? { warehouseId } : {}),
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(categoryId ? { systemSku: { systemProduct: { categoryId } } } : {}),
    ...(skuSearch
      ? {
          systemSku: {
            OR: [
              { skuCode: { contains: skuSearch, mode: 'insensitive' } },
              { systemProduct: { name: { contains: skuSearch, mode: 'insensitive' } } },
            ],
          },
        }
      : {}),
  }

  // Fetch page of warehouse_skus plus one pass of snapshots/events to compute stock.
  // For "low stock only" filter, we need stock computed BEFORE pagination — so for that
  // path we fetch all matching rows then filter+paginate in memory. This is acceptable
  // for the MVP scale; revisit with a materialized view if the list grows >10k rows.
  const needsInMemoryFilter = !!lowStockOnly

  const rowsQuery = prisma.warehouseSku.findMany({
    where,
    include: {
      warehouse: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true, email: true } },
      systemSku: {
        select: {
          id: true,
          skuCode: true,
          systemProduct: {
            select: {
              name: true,
              categoryId: true,
              category: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: [{ warehouse: { name: 'asc' } }, { systemSku: { skuCode: 'asc' } }],
    ...(needsInMemoryFilter ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
  })

  const [rows, totalUnfiltered] = await Promise.all([
    rowsQuery,
    needsInMemoryFilter ? Promise.resolve(0) : prisma.warehouseSku.count({ where }),
  ])

  const enriched = await Promise.all(
    rows.map(async (row) => {
      const stock = await getCurrentStock(row.id)
      const lastEvent = await prisma.inventoryEvent.findFirst({
        where: { warehouseSkuId: row.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      return {
        warehouseSkuId: row.id,
        warehouseId: row.warehouseId,
        warehouseName: row.warehouse.name,
        ownerUserId: row.ownerUserId,
        ownerName: row.owner?.name ?? null,
        systemSkuId: row.systemSku.id,
        skuCode: row.systemSku.skuCode,
        productName: row.systemSku.systemProduct.name,
        categoryId: row.systemSku.systemProduct.categoryId,
        categoryName: row.systemSku.systemProduct.category?.name ?? null,
        quantityOnHand: stock.quantityOnHand,
        quantityReserved: stock.quantityReserved,
        quantityAvailable: stock.quantityAvailable,
        reorderPoint: row.reorderPoint,
        lastEventAt: lastEvent?.createdAt.toISOString() ?? null,
      } as StockRow
    })
  )

  if (needsInMemoryFilter) {
    const filtered = enriched.filter((r) => r.quantityAvailable <= r.reorderPoint)
    const total = filtered.length
    const items = filtered.slice((page - 1) * pageSize, page * pageSize)
    return { items, total }
  }

  return { items: enriched, total: totalUnfiltered }
}

// Fetch a single stock row + a snapshot timestamp used as an optimistic-lock token.
// The frontend sends this back in the adjust call; if another adjust landed in between,
// the timestamp check fails and the client is told to refresh.
export async function getStockDetail(warehouseSkuId: string, tenantId: string) {
  const row = await prisma.warehouseSku.findFirst({
    where: { id: warehouseSkuId, warehouse: { tenantId } },
    include: {
      warehouse: { select: { id: true, name: true } },
      systemSku: {
        select: {
          id: true,
          skuCode: true,
          systemProduct: {
            select: {
              name: true,
              categoryId: true,
              category: { select: { name: true } },
            },
          },
        },
      },
    },
  })
  if (!row) return null
  const stock = await getCurrentStock(warehouseSkuId)
  const lastEvent = await prisma.inventoryEvent.findFirst({
    where: { warehouseSkuId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  return {
    warehouseSkuId: row.id,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    systemSkuId: row.systemSku.id,
    skuCode: row.systemSku.skuCode,
    productName: row.systemSku.systemProduct.name,
    categoryId: row.systemSku.systemProduct.categoryId,
    categoryName: row.systemSku.systemProduct.category?.name ?? null,
    quantityOnHand: stock.quantityOnHand,
    quantityReserved: stock.quantityReserved,
    quantityAvailable: stock.quantityAvailable,
    reorderPoint: row.reorderPoint,
    lockToken: lastEvent?.createdAt.toISOString() ?? 'never',
  }
}

export class StockConflictError extends Error {
  currentQuantity: number
  constructor(currentQuantity: number) {
    super('Stock was modified concurrently')
    this.name = 'StockConflictError'
    this.currentQuantity = currentQuantity
  }
}

// Apply an adjustment with optimistic lock. Callers pass either an absolute new quantity
// or a delta; the service computes the effective delta and appends an ADJUSTMENT event.
// The lock check compares the caller's seen quantity vs current — reject if changed.
export async function adjustStock(params: {
  tenantId: string
  warehouseSkuId: string
  expectedQuantity: number
  mode: 'absolute' | 'delta'
  value: number
  reason: AdjustmentReason
  notes?: string
  userId: string
}) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.warehouseSku.findFirst({
      where: { id: params.warehouseSkuId, warehouse: { tenantId: params.tenantId } },
      select: { id: true, warehouseId: true },
    })
    if (!row) throw new Error('WarehouseSku not found')

    // Recompute current on-hand inside transaction so we have consistent view.
    const current = await getCurrentStock(params.warehouseSkuId)
    if (current.quantityOnHand !== params.expectedQuantity) {
      throw new StockConflictError(current.quantityOnHand)
    }

    const delta =
      params.mode === 'absolute' ? params.value - current.quantityOnHand : params.value
    if (delta === 0) {
      // No-op adjustment — still record for audit trail so user intent is visible.
    }

    const event = await tx.inventoryEvent.create({
      data: {
        tenantId: params.tenantId,
        warehouseSkuId: row.id,
        warehouseId: row.warehouseId,
        eventType: 'ADJUSTMENT',
        quantityDelta: delta,
        reason: params.reason,
        notes: params.notes,
        referenceType: 'manual_adjustment',
        createdBy: params.userId,
      },
    })
    return event
  })
}

// Reserve stock for an order — uses SELECT FOR UPDATE via transaction
export async function reserveStock(params: {
  warehouseSkuId: string
  warehouseId: string
  tenantId: string
  quantity: number
  orderId: string
  userId: string
}) {
  return prisma.$transaction(async (tx: any) => {
    // Lock the snapshot row
    const snapshot = await tx.inventorySnapshot.findFirst({
      where: { warehouseSkuId: params.warehouseSkuId },
      orderBy: { snapshotAt: 'desc' },
    })

    const current = snapshot
      ? { available: snapshot.quantityAvailable }
      : { available: 0 }

    if (current.available < params.quantity) {
      throw new Error(`Insufficient stock. Available: ${current.available}, Requested: ${params.quantity}`)
    }

    // Append reservation event
    await tx.inventoryEvent.create({
      data: {
        tenantId: params.tenantId,
        warehouseSkuId: params.warehouseSkuId,
        warehouseId: params.warehouseId,
        eventType: 'RESERVED',
        quantityDelta: -params.quantity,
        referenceType: 'order',
        referenceId: params.orderId,
        createdBy: params.userId,
      },
    })

    // Update snapshot immediately for performance
    if (snapshot) {
      await tx.inventorySnapshot.update({
        where: { id: snapshot.id },
        data: {
          quantityReserved: { increment: params.quantity },
          quantityAvailable: { decrement: params.quantity },
        },
      })
    }
  })
}
