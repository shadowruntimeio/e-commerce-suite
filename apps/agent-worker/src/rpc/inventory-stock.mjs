// Usage: node inventory-stock.mjs <sku_code>
// Returns current on-hand / reserved / available stock and the last few
// inventory events for a SKU across all of the tenant's warehouses.
// Diagnoses "库存对不上" / "数量不一致" complaints by showing recent INBOUND /
// OUTBOUND / ADJUSTMENT events.
import { prisma, requireTenantId, getArg, emit, closePrismaAnd } from './_lib.mjs'

const tenantId = requireTenantId()
const skuCode = getArg('skuCode', 2)

try {
  const sku = await prisma.systemSku.findFirst({
    where: { skuCode, systemProduct: { tenantId } },
    select: { id: true, skuCode: true, systemProduct: { select: { name: true } } },
  })
  if (!sku) {
    emit({ ok: true, exists: false, query: skuCode })
    await closePrismaAnd(0)
  }

  // Per-warehouse stock counters.
  const stock = await prisma.warehouseSku.findMany({
    where: { systemSkuId: sku.id },
    select: {
      quantityOnHand: true,
      quantityReserved: true,
      warehouse: { select: { id: true, name: true, type: true } },
    },
  })

  // Last 10 events across all warehouses for this SKU — best signal for
  // "where did the stock go" investigations.
  const events = await prisma.inventoryEvent.findMany({
    where: { tenantId, warehouseSku: { systemSkuId: sku.id } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      eventType: true,
      quantityDelta: true,
      referenceType: true,
      referenceId: true,
      createdAt: true,
      warehouse: { select: { name: true } },
    },
  })

  emit({
    ok: true,
    exists: true,
    skuCode: sku.skuCode,
    productName: sku.systemProduct?.name,
    perWarehouse: stock.map((s) => ({
      warehouse: s.warehouse.name,
      type: s.warehouse.type,
      onHand: s.quantityOnHand,
      reserved: s.quantityReserved,
      available: s.quantityOnHand - s.quantityReserved,
    })),
    recentEvents: events,
  })
  await closePrismaAnd(0)
} catch (err) {
  emit({ ok: false, error: String(err.message ?? err) })
  await closePrismaAnd(1)
}
