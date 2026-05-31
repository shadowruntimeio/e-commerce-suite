// Usage: node sku-lookup.mjs <sku_code>
// Returns whether a SKU code exists in the current tenant's catalog, and if
// so the SystemSku id + product name. Use this to verify entries in a user's
// inventory-import CSV before declaring it a system bug.
import { prisma, requireTenantId, getArg, emit, closePrismaAnd } from './_lib.mjs'

const tenantId = requireTenantId()
const skuCode = getArg('skuCode', 2)

try {
  const sku = await prisma.systemSku.findFirst({
    where: {
      skuCode,
      systemProduct: { tenantId },
    },
    select: {
      id: true,
      skuCode: true,
      systemProduct: { select: { id: true, spuCode: true, name: true } },
    },
  })

  if (!sku) {
    // Try a near-match: case-insensitive, plus a couple of common typos.
    const similar = await prisma.systemSku.findMany({
      where: {
        systemProduct: { tenantId },
        skuCode: { contains: skuCode, mode: 'insensitive' },
      },
      take: 5,
      select: { skuCode: true, systemProduct: { select: { name: true } } },
    })
    emit({
      ok: true,
      exists: false,
      query: skuCode,
      similar: similar.map((s) => ({ skuCode: s.skuCode, product: s.systemProduct?.name })),
    })
  } else {
    emit({
      ok: true,
      exists: true,
      systemSkuId: sku.id,
      skuCode: sku.skuCode,
      productId: sku.systemProduct?.id,
      productSpuCode: sku.systemProduct?.spuCode,
      productName: sku.systemProduct?.name,
    })
  }
  await closePrismaAnd(0)
} catch (err) {
  emit({ ok: false, error: String(err.message ?? err) })
  await closePrismaAnd(1)
}
