/**
 * Seed mock data for the sub-account demo:
 *  - 2 merchants (Acme + Bravo)
 *  - 1 manual shop per merchant
 *  - 1 product + sku per merchant
 *  - WarehouseSku (with starting stock) for each merchant SKU
 *  - 2 mock orders per merchant (PENDING_CONFIRM)
 *
 * Run: pnpm tsx scripts/mock-merchant-flow.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../../../.env') })
import { prisma } from '@ems/db'

async function ensureUser(opts: {
  email: string
  name: string
  role: 'MERCHANT' | 'WAREHOUSE_STAFF'
  tenantId: string
  passwordHash: string
  capabilities?: string[]
  settings?: Record<string, unknown>
}) {
  return prisma.user.upsert({
    where: { tenantId_email: { tenantId: opts.tenantId, email: opts.email } },
    update: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: {
      tenantId: opts.tenantId,
      email: opts.email,
      name: opts.name,
      role: opts.role,
      passwordHash: opts.passwordHash,
      capabilities: (opts.capabilities ?? []) as any,
      settings: (opts.settings ?? {}) as any,
    } as any,
  })
}

async function main() {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: 'seed-tenant-1' } })
  const admin = await prisma.user.findFirstOrThrow({ where: { tenantId: tenant.id, role: 'ADMIN' } })
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { tenantId: tenant.id } })

  const passwordHash = admin.passwordHash // reuse admin's hash for fixture simplicity

  // ── Merchants ──
  const merchantA = await ensureUser({
    email: 'merchant-a@demo.com', name: 'Acme Merchant', role: 'MERCHANT',
    tenantId: tenant.id, passwordHash,
    settings: { autoConfirmHours: 12 },
  })
  const merchantB = await ensureUser({
    email: 'merchant-b@demo.com', name: 'Bravo Merchant', role: 'MERCHANT',
    tenantId: tenant.id, passwordHash,
    settings: { autoConfirmHours: 24 },
  })

  // ── Shops (manual platform — no real OAuth) ──
  for (const [merchant, shopName, externalId] of [
    [merchantA, 'Acme Manual Shop', 'manual-acme-1'],
    [merchantB, 'Bravo Manual Shop', 'manual-bravo-1'],
  ] as const) {
    await prisma.shop.upsert({
      where: {
        tenantId_platform_externalShopId: {
          tenantId: tenant.id, platform: 'MANUAL', externalShopId: externalId,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        ownerUserId: merchant.id,
        platform: 'MANUAL',
        externalShopId: externalId,
        name: shopName,
        status: 'ACTIVE',
      },
    })
  }

  // ── Products + SKUs (per merchant, isolated) ──
  for (const [merchant, spu, name, skuCode] of [
    [merchantA, 'ACME-WIDGET', 'Acme Widget', 'ACME-WIDGET-RED'],
    [merchantB, 'BRAVO-GADGET', 'Bravo Gadget', 'BRAVO-GADGET-BLUE'],
  ] as const) {
    const product = await prisma.systemProduct.upsert({
      where: { ownerUserId_spuCode: { ownerUserId: merchant.id, spuCode: spu } },
      update: {},
      create: {
        tenantId: tenant.id,
        ownerUserId: merchant.id,
        spuCode: spu,
        name,
      },
    })
    let sku = await prisma.systemSku.findFirst({
      where: { systemProductId: product.id, skuCode },
    })
    if (!sku) {
      sku = await prisma.systemSku.create({
        data: {
          systemProductId: product.id,
          skuCode,
          attributes: { color: skuCode.includes('RED') ? 'red' : 'blue' },
          costPrice: 5,
        },
      })
    }
    let wsku = await prisma.warehouseSku.findFirst({
      where: { systemSkuId: sku.id, warehouseId: warehouse.id },
    })
    if (!wsku) {
      wsku = await prisma.warehouseSku.create({
        data: {
          systemSkuId: sku.id,
          warehouseId: warehouse.id,
          ownerUserId: merchant.id,
          quantityOnHand: 100,
        },
      })
      // Record initial inbound event for audit/history
      await prisma.inventoryEvent.create({
        data: {
          tenantId: tenant.id,
          warehouseSkuId: wsku.id,
          warehouseId: warehouse.id,
          eventType: 'INBOUND',
          quantityDelta: 100,
          referenceType: 'seed',
          notes: 'Initial demo stock',
        },
      })
    }
  }

  // ── Mock orders (2 per merchant) ──
  const shops = await prisma.shop.findMany({
    where: { tenantId: tenant.id, platform: 'MANUAL' },
    include: { owner: { select: { settings: true } } },
  })
  for (const shop of shops) {
    const sku = await prisma.systemSku.findFirstOrThrow({
      where: { systemProduct: { ownerUserId: shop.ownerUserId } },
    })
    for (let i = 1; i <= 2; i++) {
      const platformOrderId = `mock-${shop.externalShopId}-${i}-${Date.now()}`
      const settings = shop.owner.settings as { autoConfirmHours?: number } | null
      const hours = settings?.autoConfirmHours ?? 24
      await prisma.order.create({
        data: {
          shopId: shop.id,
          tenantId: tenant.id,
          platformOrderId,
          status: 'PENDING',
          buyerName: `Buyer ${i}`,
          buyerPhone: `13800000${i.toString().padStart(3, '0')}`,
          shippingAddress: { line1: '123 Mock St', city: 'Demo City' },
          currency: 'USD',
          subtotal: 50,
          totalRevenue: 50,
          merchantConfirmStatus: 'PENDING_CONFIRM',
          merchantConfirmExpiresAt: new Date(Date.now() + hours * 60 * 60 * 1000),
          firstSellerSku: sku.skuCode,
          items: {
            create: [{
              platformSkuId: `${sku.skuCode}-platform`,
              sellerSku: sku.skuCode,
              productName: 'Mock Item',
              quantity: 2,
              unitPrice: 25,
              systemSkuId: sku.id,
            }],
          },
        },
      })
    }
  }

  console.log('Mock data seeded:')
  console.log('  Admin:    admin@demo.com / password123')
  console.log('  Merchant: merchant-a@demo.com / password123')
  console.log('  Merchant: merchant-b@demo.com / password123')
  console.log('  Use the existing wh@demo.com warehouse account')
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
