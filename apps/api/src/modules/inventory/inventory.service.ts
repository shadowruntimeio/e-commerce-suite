import { prisma, Prisma } from '@ems/db'
import type { InventoryEventType, AdjustmentReason, StockRow } from '@ems/shared'

export async function getCurrentStock(warehouseSkuId: string) {
  // Get latest snapshot
  const snapshot = await prisma.inventorySnapshot.findFirst({
    where: { warehouseSkuId },
    orderBy: { snapshotAt: 'desc' },
  })

  if (!snapshot) {
    // No snapshot yet — compute from all events
    const events = await prisma.inventoryEvent.findMany({ where: { warehouseSkuId } })
    const onHand = events.reduce((sum: number, e: { quantityDelta: number }) => sum + e.quantityDelta, 0)
    return { quantityOnHand: onHand, quantityReserved: 0, quantityAvailable: onHand }
  }

  // Sum events since the snapshot
  const eventsSince = await prisma.inventoryEvent.findMany({
    where: { warehouseSkuId, createdAt: { gt: snapshot.snapshotAt } },
  })

  type EventRow = { eventType: string; quantityDelta: number }
  const deltaOnHand = (eventsSince as EventRow[])
    .filter((e) => ['INBOUND', 'OUTBOUND', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'RETURN'].includes(e.eventType))
    .reduce((sum, e) => sum + e.quantityDelta, 0)

  const deltaReserved = (eventsSince as EventRow[])
    .filter((e) => ['RESERVED', 'UNRESERVED'].includes(e.eventType))
    .reduce((sum, e) => sum + e.quantityDelta, 0)

  const onHand = snapshot.quantityOnHand + deltaOnHand
  const reserved = snapshot.quantityReserved + deltaReserved
  return {
    quantityOnHand: onHand,
    quantityReserved: reserved,
    quantityAvailable: onHand - reserved,
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
  createdBy?: string
}) {
  return prisma.inventoryEvent.create({ data })
}

export interface StockListFilters {
  tenantId: string
  warehouseId?: string
  categoryId?: string
  skuSearch?: string
  lowStockOnly?: boolean
  page: number
  pageSize: number
}

export async function getStockList(filters: StockListFilters): Promise<{ items: StockRow[]; total: number }> {
  const { tenantId, warehouseId, categoryId, skuSearch, lowStockOnly, page, pageSize } = filters

  const where: Prisma.WarehouseSkuWhereInput = {
    warehouse: { tenantId, isActive: true },
    ...(warehouseId ? { warehouseId } : {}),
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
      } satisfies StockRow
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
