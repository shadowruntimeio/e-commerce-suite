// Usage: node warehouse-lookup.mjs <warehouse_name>
// Returns whether a warehouse exists for the current tenant by name. Useful
// for diagnosing inventory imports / shipment routing.
import { prisma, requireTenantId, getArg, emit, closePrismaAnd } from './_lib.mjs'

const tenantId = requireTenantId()
const name = getArg('name', 2)

try {
  const exact = await prisma.warehouse.findFirst({
    where: { tenantId, name },
    select: { id: true, name: true, type: true, isActive: true, isDefault: true },
  })

  if (exact) {
    emit({ ok: true, exists: true, ...exact })
  } else {
    const similar = await prisma.warehouse.findMany({
      where: { tenantId, name: { contains: name, mode: 'insensitive' } },
      take: 5,
      select: { name: true, type: true, isActive: true },
    })
    const all = await prisma.warehouse.findMany({
      where: { tenantId, isActive: true },
      take: 10,
      select: { name: true, type: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    })
    emit({
      ok: true,
      exists: false,
      query: name,
      similar,
      allActive: all,                // so the agent can suggest the right value
    })
  }
  await closePrismaAnd(0)
} catch (err) {
  emit({ ok: false, error: String(err.message ?? err) })
  await closePrismaAnd(1)
}
