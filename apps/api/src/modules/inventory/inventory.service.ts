import { prisma } from '@ems/db'
import type { InventoryEventType } from '@ems/shared'

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
  referenceType?: string
  referenceId?: string
  notes?: string
  createdBy?: string
}) {
  return prisma.inventoryEvent.create({ data })
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
