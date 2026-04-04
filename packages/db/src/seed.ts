import { PrismaClient, Platform, OrderStatus, WarehouseType, PurchaseOrderStatus } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(__dirname, '../../../.env') })

const prisma = new PrismaClient()

async function hashPassword(password: string) {
  return bcrypt.hash(password, 12)
}

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function daysFromNow(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

async function main() {
  console.log('🌱 Seeding database...')

  // ─── Tenant ───────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { id: 'seed-tenant-1' },
    update: {},
    create: {
      id: 'seed-tenant-1',
      name: 'Demo Store Co.',
      settings: { currency: 'USD', timezone: 'Asia/Shanghai' },
    },
  })

  // ─── Users ────────────────────────────────────────────────────────────────
  const adminUser = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@demo.com',
      passwordHash: await hashPassword('password123'),
      name: 'Eric Zhang',
      role: 'ADMIN',
    },
  })

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'ops@demo.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'ops@demo.com',
      passwordHash: await hashPassword('password123'),
      name: 'Amy Liu',
      role: 'OPERATOR',
    },
  })

  // ─── Shops ────────────────────────────────────────────────────────────────
  const shopSG = await prisma.shop.upsert({
    where: { tenantId_platform_externalShopId: { tenantId: tenant.id, platform: Platform.SHOPEE, externalShopId: '12345001' } },
    update: {},
    create: {
      tenantId: tenant.id,
      platform: Platform.SHOPEE,
      externalShopId: '12345001',
      name: 'Demo Store SG',
      status: 'ACTIVE',
      credentialsEncrypted: {},
      lastSyncAt: daysAgo(0),
    },
  })

  const shopTW = await prisma.shop.upsert({
    where: { tenantId_platform_externalShopId: { tenantId: tenant.id, platform: Platform.SHOPEE, externalShopId: '12345002' } },
    update: {},
    create: {
      tenantId: tenant.id,
      platform: Platform.SHOPEE,
      externalShopId: '12345002',
      name: 'Demo Store TW',
      status: 'ACTIVE',
      credentialsEncrypted: {},
      lastSyncAt: daysAgo(1),
    },
  })

  const shopTikTok = await prisma.shop.upsert({
    where: { tenantId_platform_externalShopId: { tenantId: tenant.id, platform: Platform.TIKTOK, externalShopId: 'TT-99001' } },
    update: {},
    create: {
      tenantId: tenant.id,
      platform: Platform.TIKTOK,
      externalShopId: 'TT-99001',
      name: 'TikTok US Shop',
      status: 'AUTH_EXPIRED',
      credentialsEncrypted: {},
      lastSyncAt: daysAgo(3),
    },
  })

  // ─── Product Categories ───────────────────────────────────────────────────
  const catElec = await prisma.productCategory.create({
    data: { tenantId: tenant.id, name: 'Electronics' },
  }).catch(() => prisma.productCategory.findFirst({ where: { tenantId: tenant.id, name: 'Electronics' } })) as any

  const catHome = await prisma.productCategory.create({
    data: { tenantId: tenant.id, name: 'Home & Living' },
  }).catch(() => prisma.productCategory.findFirst({ where: { tenantId: tenant.id, name: 'Home & Living' } })) as any

  // ─── System Products & SKUs ───────────────────────────────────────────────
  const products = [
    {
      spuCode: 'SPU-TWS-001',
      name: 'ProBuds X3 Wireless Earbuds',
      brand: 'ProAudio',
      weightG: 45,
      categoryId: catElec.id,
      skus: [
        { skuCode: 'SKU-TWS-001-BLK', attributes: { color: 'Midnight Black' }, costPrice: 18.5 },
        { skuCode: 'SKU-TWS-001-WHT', attributes: { color: 'Pearl White' }, costPrice: 18.5 },
        { skuCode: 'SKU-TWS-001-BLU', attributes: { color: 'Ocean Blue' }, costPrice: 19.0 },
      ],
    },
    {
      spuCode: 'SPU-PWB-002',
      name: 'UltraCharge 20000mAh Power Bank',
      brand: 'PowerTech',
      weightG: 380,
      categoryId: catElec.id,
      skus: [
        { skuCode: 'SKU-PWB-002-BLK', attributes: { color: 'Matte Black' }, costPrice: 12.0 },
        { skuCode: 'SKU-PWB-002-WHT', attributes: { color: 'Snow White' }, costPrice: 12.0 },
      ],
    },
    {
      spuCode: 'SPU-KBD-003',
      name: 'MechType 60% Mechanical Keyboard',
      brand: 'KeyMaster',
      weightG: 620,
      categoryId: catElec.id,
      skus: [
        { skuCode: 'SKU-KBD-003-RED', attributes: { switch: 'Red', layout: '60%' }, costPrice: 28.0 },
        { skuCode: 'SKU-KBD-003-BLU', attributes: { switch: 'Blue', layout: '60%' }, costPrice: 28.0 },
      ],
    },
    {
      spuCode: 'SPU-LAM-004',
      name: 'AuraGlow RGB Desk Lamp',
      brand: 'LumiHome',
      weightG: 520,
      categoryId: catHome.id,
      skus: [
        { skuCode: 'SKU-LAM-004-WHT', attributes: { color: 'White', size: 'Standard' }, costPrice: 9.5 },
        { skuCode: 'SKU-LAM-004-BLK', attributes: { color: 'Black', size: 'Standard' }, costPrice: 9.5 },
      ],
    },
    {
      spuCode: 'SPU-CAB-005',
      name: 'BraideX 3-in-1 Charging Cable',
      brand: 'CableKing',
      weightG: 85,
      categoryId: catElec.id,
      skus: [
        { skuCode: 'SKU-CAB-005-1M', attributes: { length: '1m' }, costPrice: 2.8 },
        { skuCode: 'SKU-CAB-005-2M', attributes: { length: '2m' }, costPrice: 3.5 },
      ],
    },
  ]

  const createdSkus: Record<string, string> = {} // skuCode → id

  for (const p of products) {
    let prod = await prisma.systemProduct.findUnique({
      where: { tenantId_spuCode: { tenantId: tenant.id, spuCode: p.spuCode } },
    })
    if (!prod) {
      prod = await prisma.systemProduct.create({
        data: {
          tenantId: tenant.id,
          spuCode: p.spuCode,
          name: p.name,
          brand: p.brand,
          weightG: p.weightG,
          categoryId: p.categoryId,
        },
      })
    }
    for (const s of p.skus) {
      let sku = await prisma.systemSku.findUnique({ where: { skuCode: s.skuCode } })
      if (!sku) {
        sku = await prisma.systemSku.create({
          data: {
            systemProductId: prod.id,
            skuCode: s.skuCode,
            attributes: s.attributes,
            costPrice: s.costPrice,
          },
        })
      }
      createdSkus[s.skuCode] = sku.id
    }
  }

  // ─── Warehouses ───────────────────────────────────────────────────────────
  const wh1 = await prisma.warehouse.upsert({
    where: { id: 'seed-wh-1' },
    update: {},
    create: {
      id: 'seed-wh-1',
      tenantId: tenant.id,
      name: 'Shenzhen Main',
      type: WarehouseType.LOCAL,
      isDefault: true,
      address: { city: 'Shenzhen', country: 'CN', zip: '518000' },
    },
  })

  const wh2 = await prisma.warehouse.upsert({
    where: { id: 'seed-wh-2' },
    update: {},
    create: {
      id: 'seed-wh-2',
      tenantId: tenant.id,
      name: 'Singapore FWZ',
      type: WarehouseType.OVERSEAS,
      isDefault: false,
      address: { city: 'Singapore', country: 'SG', zip: '609930' },
    },
  })

  // ─── WarehouseSkus + Inventory ────────────────────────────────────────────
  const stockData: Record<string, { wh1: number; wh2: number }> = {
    'SKU-TWS-001-BLK': { wh1: 320, wh2: 80 },
    'SKU-TWS-001-WHT': { wh1: 210, wh2: 60 },
    'SKU-TWS-001-BLU': { wh1: 45, wh2: 20 },
    'SKU-PWB-002-BLK': { wh1: 180, wh2: 35 },
    'SKU-PWB-002-WHT': { wh1: 90, wh2: 25 },
    'SKU-KBD-003-RED': { wh1: 55, wh2: 0 },
    'SKU-KBD-003-BLU': { wh1: 30, wh2: 0 },
    'SKU-LAM-004-WHT': { wh1: 140, wh2: 50 },
    'SKU-LAM-004-BLK': { wh1: 12, wh2: 8 }, // low stock
    'SKU-CAB-005-1M': { wh1: 850, wh2: 200 },
    'SKU-CAB-005-2M': { wh1: 640, wh2: 150 },
  }

  for (const [skuCode, stock] of Object.entries(stockData)) {
    const systemSkuId = createdSkus[skuCode]
    if (!systemSkuId) continue

    for (const [whId, qty] of [[wh1.id, stock.wh1], [wh2.id, stock.wh2]] as [string, number][]) {
      if (qty === 0) continue
      let whSku = await prisma.warehouseSku.findUnique({
        where: { systemSkuId_warehouseId: { systemSkuId, warehouseId: whId } },
      })
      if (!whSku) {
        whSku = await prisma.warehouseSku.create({
          data: {
            systemSkuId,
            warehouseId: whId,
            reorderPoint: Math.floor(qty * 0.15),
            safetyStockDays: 14,
          },
        })
        // Seed an initial INBOUND event
        await prisma.inventoryEvent.create({
          data: {
            tenantId: tenant.id,
            warehouseSkuId: whSku.id,
            warehouseId: whId,
            eventType: 'INBOUND',
            quantityDelta: qty,
            referenceType: 'adjustment',
            notes: 'Initial stock seed',
            createdAt: daysAgo(30),
          },
        })
        // Snapshot
        await prisma.inventorySnapshot.create({
          data: {
            warehouseSkuId: whSku.id,
            warehouseId: whId,
            quantityOnHand: qty,
            quantityReserved: 0,
            quantityAvailable: qty,
            snapshotAt: daysAgo(1),
          },
        })
      }
    }
  }

  // ─── Orders ───────────────────────────────────────────────────────────────
  const orderStatuses: OrderStatus[] = [
    OrderStatus.PENDING, OrderStatus.TO_SHIP, OrderStatus.SHIPPED,
    OrderStatus.COMPLETED, OrderStatus.COMPLETED, OrderStatus.COMPLETED,
    OrderStatus.CANCELLED, OrderStatus.AFTER_SALES,
  ]

  const buyers = [
    { name: 'Li Wei', phone: '+65 9123 4567' },
    { name: 'Sarah Tan', phone: '+65 8765 4321' },
    { name: 'Chen Ming', phone: '+886 912 345 678' },
    { name: 'Nur Aisyah', phone: '+60 12-345 6789' },
    { name: 'James Lim', phone: '+65 9876 5432' },
    { name: 'Wang Fang', phone: '+886 923 456 789' },
    { name: 'Priya S.', phone: '+65 8234 5678' },
    { name: 'Kevin Ng', phone: '+60 11-234 5678' },
  ]

  const orderSkus = [
    { skuCode: 'SKU-TWS-001-BLK', name: 'ProBuds X3 - Midnight Black', price: 42.99 },
    { skuCode: 'SKU-TWS-001-WHT', name: 'ProBuds X3 - Pearl White', price: 42.99 },
    { skuCode: 'SKU-PWB-002-BLK', name: 'UltraCharge 20000mAh - Black', price: 29.99 },
    { skuCode: 'SKU-KBD-003-RED', name: 'MechType 60% - Red Switch', price: 69.99 },
    { skuCode: 'SKU-LAM-004-WHT', name: 'AuraGlow RGB Lamp - White', price: 24.99 },
    { skuCode: 'SKU-CAB-005-1M', name: 'BraideX 3-in-1 Cable 1m', price: 8.99 },
    { skuCode: 'SKU-CAB-005-2M', name: 'BraideX 3-in-1 Cable 2m', price: 11.99 },
  ]

  const shops = [shopSG, shopTW, shopTikTok]

  for (let i = 0; i < 60; i++) {
    const shop = shops[i % 3]
    const buyer = buyers[i % buyers.length]
    const status = orderStatuses[i % orderStatuses.length]
    const sku = orderSkus[i % orderSkus.length]
    const qty = (i % 3) + 1
    const subtotal = parseFloat((sku.price * qty).toFixed(2))
    const commission = parseFloat((subtotal * 0.05).toFixed(2))
    const platformOrderId = `ORD-${Date.now()}-${String(i).padStart(4, '0')}`

    const existing = await prisma.order.findFirst({
      where: { tenantId: tenant.id, shopId: shop.id, platformOrderId },
    })
    if (existing) continue

    const order = await prisma.order.create({
      data: {
        tenantId: tenant.id,
        shopId: shop.id,
        platformOrderId,
        status,
        buyerName: buyer.name,
        buyerPhone: buyer.phone,
        shippingAddress: { country: shop.platform === Platform.TIKTOK ? 'US' : 'SG', line1: `${i + 1} Demo St`, city: 'Test City' },
        currency: 'USD',
        subtotal,
        platformCommission: commission,
        shippingFeeBuyer: 2.99,
        shippingFeeSeller: 1.5,
        totalRevenue: subtotal,
        tags: i % 5 === 0 ? ['vip'] : [],
        platformCreatedAt: daysAgo(Math.floor(i / 4)),
        createdAt: daysAgo(Math.floor(i / 4)),
      },
    })

    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        platformSkuId: sku.skuCode,
        productName: sku.name,
        skuName: sku.name,
        quantity: qty,
        unitPrice: sku.price,
        costPriceAtOrder: sku.price * 0.43,
        systemSkuId: createdSkus[sku.skuCode] ?? null,
      },
    })
  }

  // ─── Order Rules ──────────────────────────────────────────────────────────
  const existingRules = await prisma.orderRule.count({ where: { tenantId: tenant.id } })
  if (existingRules === 0) {
    await prisma.orderRule.createMany({
      data: [
        {
          tenantId: tenant.id,
          name: 'Flag high-value orders',
          priority: 100,
          conditions: { operator: 'AND', rules: [{ field: 'totalRevenue', op: 'gte', value: 80 }] },
          actions: [{ type: 'flag_for_review' }, { type: 'add_tag', value: 'high-value' }],
          isActive: true,
        },
        {
          tenantId: tenant.id,
          name: 'Auto-confirm cable orders',
          priority: 80,
          conditions: { operator: 'AND', rules: [{ field: 'totalRevenue', op: 'lt', value: 15 }] },
          actions: [{ type: 'auto_confirm' }, { type: 'assign_warehouse', value: 'seed-wh-1' }],
          isActive: true,
        },
        {
          tenantId: tenant.id,
          name: 'Assign SG orders to Singapore WH',
          priority: 60,
          conditions: { operator: 'AND', rules: [{ field: 'shippingCountry', op: 'eq', value: 'SG' }] },
          actions: [{ type: 'assign_warehouse', value: 'seed-wh-2' }],
          isActive: true,
        },
        {
          tenantId: tenant.id,
          name: 'Tag VIP repeat buyers',
          priority: 40,
          conditions: { operator: 'AND', rules: [{ field: 'tags', op: 'contains', value: 'vip' }] },
          actions: [{ type: 'set_priority', value: 'high' }, { type: 'add_tag', value: 'priority-fulfillment' }],
          isActive: false,
        },
      ],
    })
  }

  // ─── Supplier + Purchase Orders ───────────────────────────────────────────
  let supplier = await prisma.supplier.findFirst({ where: { tenantId: tenant.id } })
  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: {
        tenantId: tenant.id,
        name: 'Shenzhen TechSource Ltd.',
        contact: { email: 'sales@techsource.cn', wechat: 'techsource_sales' },
        paymentTerms: 'NET30',
        leadTimeDays: 12,
      },
    })
  }

  const existingPOs = await prisma.purchaseOrder.count({ where: { tenantId: tenant.id } })
  if (existingPOs === 0) {
    const po1 = await prisma.purchaseOrder.create({
      data: {
        tenantId: tenant.id,
        supplierId: supplier.id,
        warehouseId: wh1.id,
        status: PurchaseOrderStatus.APPROVED,
        totalAmount: 2340.0,
        currency: 'USD',
        eta: daysFromNow(8),
        notes: 'Restock earbuds for Q2 sale season',
        createdBy: adminUser.id,
      },
    })
    await prisma.purchaseOrderItem.createMany({
      data: [
        { purchaseOrderId: po1.id, systemSkuId: createdSkus['SKU-TWS-001-BLK'], quantityOrdered: 500, unitCost: 18.5 },
        { purchaseOrderId: po1.id, systemSkuId: createdSkus['SKU-TWS-001-WHT'], quantityOrdered: 300, unitCost: 18.5 },
      ],
    })

    const po2 = await prisma.purchaseOrder.create({
      data: {
        tenantId: tenant.id,
        supplierId: supplier.id,
        warehouseId: wh1.id,
        status: PurchaseOrderStatus.DRAFT,
        totalAmount: 840.0,
        currency: 'USD',
        eta: daysFromNow(15),
        notes: 'Low stock replenishment for lamps',
        createdBy: adminUser.id,
      },
    })
    await prisma.purchaseOrderItem.createMany({
      data: [
        { purchaseOrderId: po2.id, systemSkuId: createdSkus['SKU-LAM-004-BLK'], quantityOrdered: 200, unitCost: 9.5 },
        { purchaseOrderId: po2.id, systemSkuId: createdSkus['SKU-LAM-004-WHT'], quantityOrdered: 250, unitCost: 9.5 },
      ],
    })

    const po3 = await prisma.purchaseOrder.create({
      data: {
        tenantId: tenant.id,
        supplierId: supplier.id,
        warehouseId: wh1.id,
        status: PurchaseOrderStatus.RECEIVED,
        totalAmount: 1680.0,
        currency: 'USD',
        eta: daysAgo(5),
        createdBy: adminUser.id,
      },
    })
    await prisma.purchaseOrderItem.createMany({
      data: [
        { purchaseOrderId: po3.id, systemSkuId: createdSkus['SKU-CAB-005-1M'], quantityOrdered: 300, quantityReceived: 300, unitCost: 2.8 },
        { purchaseOrderId: po3.id, systemSkuId: createdSkus['SKU-CAB-005-2M'], quantityOrdered: 200, quantityReceived: 200, unitCost: 3.5 },
      ],
    })
  }

  // ─── Restocking Suggestions ───────────────────────────────────────────────
  const existingSugg = await prisma.restockingSuggestion.count({ where: { tenantId: tenant.id } })
  if (existingSugg === 0) {
    const whSkuLampBlk = await prisma.warehouseSku.findUnique({
      where: { systemSkuId_warehouseId: { systemSkuId: createdSkus['SKU-LAM-004-BLK'], warehouseId: wh1.id } },
    })
    const whSkuKbdBlu = await prisma.warehouseSku.findUnique({
      where: { systemSkuId_warehouseId: { systemSkuId: createdSkus['SKU-KBD-003-BLU'], warehouseId: wh1.id } },
    })

    if (whSkuLampBlk) {
      await prisma.restockingSuggestion.create({
        data: {
          tenantId: tenant.id,
          warehouseSkuId: whSkuLampBlk.id,
          systemSkuId: createdSkus['SKU-LAM-004-BLK'],
          suggestedQty: 200,
          reason: { daysOfStock: 4, avgDailySales: 3.2, reorderPoint: 20 },
          expiresAt: daysFromNow(7),
          status: 'PENDING',
        },
      })
    }
    if (whSkuKbdBlu) {
      await prisma.restockingSuggestion.create({
        data: {
          tenantId: tenant.id,
          warehouseSkuId: whSkuKbdBlu.id,
          systemSkuId: createdSkus['SKU-KBD-003-BLU'],
          suggestedQty: 100,
          reason: { daysOfStock: 7, avgDailySales: 1.8, reorderPoint: 15 },
          expiresAt: daysFromNow(7),
          status: 'PENDING',
        },
      })
    }
  }

  // ─── Sales Facts (last 30 days) ───────────────────────────────────────────
  const existingFacts = await prisma.salesFact.count({ where: { tenantId: tenant.id } })
  if (existingFacts === 0) {
    const factEntries = []
    for (let d = 29; d >= 0; d--) {
      const date = daysAgo(d)
      date.setHours(0, 0, 0, 0)

      for (const shop of [shopSG, shopTW, shopTikTok]) {
        const baseOrders = shop.id === shopSG.id ? 12 : shop.id === shopTW.id ? 7 : 5
        const variance = Math.floor(Math.random() * 5)
        const ordersCount = baseOrders + variance
        const unitsSold = ordersCount * 2
        const grossRevenue = parseFloat((unitsSold * 35.5).toFixed(4))
        const commission = parseFloat((grossRevenue * 0.05).toFixed(4))
        const shipping = parseFloat((ordersCount * 1.5).toFixed(4))
        const cogs = parseFloat((unitsSold * 15.0).toFixed(4))
        const profit = parseFloat((grossRevenue - commission - shipping - cogs).toFixed(4))

        factEntries.push({
          tenantId: tenant.id,
          date,
          shopId: shop.id,
          systemSkuId: null,
          ordersCount,
          unitsSold,
          grossRevenue,
          platformCommission: commission,
          shippingCost: shipping,
          cogs,
          profit,
        })
      }
    }
    await prisma.salesFact.createMany({ data: factEntries, skipDuplicates: true })
  }

  // ─── Ad Spend Facts (last 30 days) ────────────────────────────────────────
  const existingAds = await prisma.adSpendFact.count({ where: { tenantId: tenant.id } })
  if (existingAds === 0) {
    const campaigns = [
      { id: 'camp-001', name: 'ProBuds X3 — Search Boost', shopId: shopSG.id, platform: Platform.SHOPEE },
      { id: 'camp-002', name: 'Power Bank — Homepage Banner', shopId: shopSG.id, platform: Platform.SHOPEE },
      { id: 'camp-003', name: 'Cable Bundle — TikTok Discovery', shopId: shopTikTok.id, platform: Platform.TIKTOK },
    ]
    const adEntries = []
    for (let d = 29; d >= 0; d--) {
      const date = daysAgo(d)
      date.setHours(0, 0, 0, 0)
      for (const c of campaigns) {
        const spend = parseFloat((Math.random() * 50 + 20).toFixed(4))
        const revenue = parseFloat((spend * (Math.random() * 3 + 1.5)).toFixed(4))
        adEntries.push({
          tenantId: tenant.id,
          date,
          shopId: c.shopId,
          platform: c.platform,
          campaignId: c.id,
          campaignName: c.name,
          impressions: Math.floor(Math.random() * 5000 + 1000),
          clicks: Math.floor(Math.random() * 300 + 50),
          spend,
          revenueAttributed: revenue,
          roas: parseFloat((revenue / spend).toFixed(4)),
        })
      }
    }
    await prisma.adSpendFact.createMany({ data: adEntries, skipDuplicates: true })
  }

  // ─── CS Inbox ─────────────────────────────────────────────────────────────
  const existingThreads = await prisma.messageThread.count({ where: { tenantId: tenant.id } })
  if (existingThreads === 0) {
    const threads = [
      { buyerName: 'Li Wei', preview: 'Hi, when will my order ship?', hoursAgo: 2, unread: true, shopId: shopSG.id },
      { buyerName: 'Sarah Tan', preview: 'The earbuds have connection issues', hoursAgo: 5, unread: true, shopId: shopSG.id },
      { buyerName: 'Chen Ming', preview: 'Can I change the delivery address?', hoursAgo: 8, unread: false, shopId: shopTW.id },
      { buyerName: 'Nur Aisyah', preview: 'Thank you! The product is great ❤️', hoursAgo: 12, unread: false, shopId: shopSG.id },
      { buyerName: 'James Lim', preview: 'I want to return this item', hoursAgo: 24, unread: true, shopId: shopTikTok.id },
      { buyerName: 'Wang Fang', preview: 'Is this compatible with iPhone?', hoursAgo: 36, unread: false, shopId: shopTW.id },
    ]

    for (let i = 0; i < threads.length; i++) {
      const t = threads[i]
      const lastAt = new Date(Date.now() - t.hoursAgo * 3600 * 1000)
      const thread = await prisma.messageThread.create({
        data: {
          tenantId: tenant.id,
          shopId: t.shopId,
          platformThreadId: `thread-${String(i + 1).padStart(4, '0')}`,
          buyerName: t.buyerName,
          buyerPlatformId: `buyer-${i + 1}`,
          lastMessageAt: lastAt,
          lastMessagePreview: t.preview,
          isRead: !t.unread,
        },
      })

      await prisma.shopMessage.createMany({
        data: [
          {
            tenantId: tenant.id,
            shopId: t.shopId,
            platformThreadId: thread.platformThreadId,
            platformMsgId: `msg-${i}-1`,
            senderType: 'buyer',
            senderName: t.buyerName,
            content: t.preview,
            isRead: !t.unread,
            platformCreatedAt: lastAt,
          },
          ...(i % 2 === 0 ? [{
            tenantId: tenant.id,
            shopId: t.shopId,
            platformThreadId: thread.platformThreadId,
            platformMsgId: `msg-${i}-2`,
            senderType: 'seller',
            senderName: 'Support Team',
            content: 'Thank you for reaching out! We will look into this right away.',
            isRead: true,
            platformCreatedAt: new Date(lastAt.getTime() + 600000),
          }] : []),
        ],
      })
    }
  }

  // ─── First-leg Shipments ──────────────────────────────────────────────────
  const existingShipments = await prisma.firstLegShipment.count({ where: { tenantId: tenant.id } })
  if (existingShipments === 0) {
    await prisma.firstLegShipment.createMany({
      data: [
        {
          tenantId: tenant.id,
          warehouseId: wh1.id,
          trackingNumber: 'SF1234567890',
          carrier: 'SF Express',
          shipmentType: 'SEA',
          originWarehouse: 'Shenzhen Main',
          destination: 'Singapore FWZ',
          departedAt: daysAgo(12),
          estimatedArrival: daysFromNow(3),
          status: 'IN_TRANSIT',
          weightKg: 245.5,
          volumeCbm: 1.82,
          cost: 1240.0,
          currency: 'USD',
          notes: 'Earbuds + power banks, 3 pallets',
        },
        {
          tenantId: tenant.id,
          warehouseId: wh1.id,
          trackingNumber: 'DHL987654321',
          carrier: 'DHL Express',
          shipmentType: 'AIR',
          originWarehouse: 'Shenzhen Main',
          destination: 'Singapore FWZ',
          departedAt: daysAgo(2),
          estimatedArrival: daysFromNow(1),
          status: 'IN_TRANSIT',
          weightKg: 38.2,
          volumeCbm: 0.25,
          cost: 580.0,
          currency: 'USD',
          notes: 'Urgent restock for lamps (air freight)',
        },
        {
          tenantId: tenant.id,
          warehouseId: wh2.id,
          trackingNumber: 'CNE456789012',
          carrier: 'CNE Express',
          shipmentType: 'SEA',
          originWarehouse: 'Shenzhen Main',
          destination: 'Singapore FWZ',
          departedAt: daysAgo(30),
          estimatedArrival: daysAgo(5),
          status: 'ARRIVED',
          weightKg: 310.0,
          volumeCbm: 2.1,
          cost: 1560.0,
          currency: 'USD',
        },
      ],
    })
  }

  // ─── Inventory Daily Snapshots ────────────────────────────────────────────
  const existingInvSnaps = await prisma.inventoryDailySnapshot.count({ where: { tenantId: tenant.id } })
  if (existingInvSnaps === 0) {
    const whSkus = await prisma.warehouseSku.findMany({ where: { warehouseId: wh1.id } })
    const snapEntries = []
    for (let d = 29; d >= 0; d--) {
      const date = daysAgo(d)
      date.setHours(0, 0, 0, 0)
      for (const whs of whSkus) {
        const sku = await prisma.systemSku.findUnique({ where: { id: whs.systemSkuId } })
        const qty = Math.max(0, 200 - d * 2 + Math.floor(Math.random() * 10))
        snapEntries.push({
          tenantId: tenant.id,
          date,
          warehouseSkuId: whs.id,
          warehouseId: wh1.id,
          quantityOnHand: qty,
          inventoryValue: parseFloat((qty * Number(sku?.costPrice ?? 10)).toFixed(4)),
          daysOfStock: parseFloat((qty / Math.max(1, 3.5)).toFixed(2)),
        })
      }
    }
    await prisma.inventoryDailySnapshot.createMany({ data: snapEntries, skipDuplicates: true })
  }

  console.log('✅ Seed complete!')
  console.log(`   Tenant: ${tenant.name}`)
  console.log(`   Login:  admin@demo.com / password123`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
