/**
 * Demo data for the merchant profit report (利润报表).
 *
 * Creates (idempotently) a MERCHANT user, a TikTok shop they own, and a spread
 * of platform orders with line items + cost prices so /reports/profit-orders
 * has something to render locally. Re-running wipes and recreates only the demo
 * shop's orders so totals stay deterministic.
 *
 *   pnpm --filter @ems/api exec tsx scripts/seed-profit-demo.ts
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(__dirname, '../../../.env') })

// Hard guard: this script writes fake merchant/shop/orders. Refuse to run
// against anything that isn't an obviously-local database so it can never
// pollute a staging/production DB.
const DB_URL = process.env.DATABASE_URL ?? ''
if (!/@(localhost|127\.0\.0\.1|::1)[:/]/.test(DB_URL)) {
  console.error('[seed-profit-demo] Refusing to run: DATABASE_URL is not local.')
  console.error('  This script seeds MOCK data and must only target a local dev DB.')
  process.exit(1)
}

const prisma = new PrismaClient()

const TENANT_ID = 'seed-tenant-1'
const SHOP_ID = 'seed-profit-shop-1'

async function main() {
  // Tenant must exist (created by the base seed).
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: { id: TENANT_ID, name: 'Demo Store Co.', settings: { currency: 'PHP', timezone: 'Asia/Manila' } },
  })

  // ─── Merchant user ─────────────────────────────────────────────────────────
  const merchant = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: TENANT_ID, email: 'merchant@demo.com' } },
    update: { role: 'MERCHANT', isActive: true },
    create: {
      tenantId: TENANT_ID,
      email: 'merchant@demo.com',
      passwordHash: await bcrypt.hash('password123', 12),
      name: 'Demo Merchant',
      role: 'MERCHANT',
    },
  })

  // ─── TikTok shop owned by the merchant ───────────────────────────────────────
  await prisma.shop.upsert({
    where: { id: SHOP_ID },
    update: { ownerUserId: merchant.id, status: 'ACTIVE' },
    create: {
      id: SHOP_ID,
      tenantId: TENANT_ID,
      ownerUserId: merchant.id,
      platform: 'TIKTOK',
      externalShopId: 'demo-tiktok-shop',
      name: 'tongmengmeng TikTok Shop',
      status: 'ACTIVE',
    },
  })

  // ─── Reset demo orders, then create a fresh spread ───────────────────────────
  await prisma.order.deleteMany({ where: { shopId: SHOP_ID } })

  const products = [
    { name: 'Wireless Earbuds Pro', sku: 'WEP-001', price: 599, cost: 180 },
    { name: 'Phone Case Clear', sku: 'PCC-002', price: 149, cost: 35 },
    { name: 'USB-C Fast Charger', sku: 'UFC-003', price: 329, cost: 95 },
    { name: 'Bluetooth Speaker Mini', sku: 'BSM-004', price: 899, cost: 320 },
    { name: 'Screen Protector 2pk', sku: 'SP2-005', price: 99, cost: 18 },
  ]

  const ORDER_COUNT = 24
  for (let i = 0; i < ORDER_COUNT; i++) {
    const p = products[i % products.length]
    const qty = (i % 3) + 1
    const subtotal = p.price * qty
    const sellerDiscount = Math.round(subtotal * 0.05 * 100) / 100
    const platformDiscount = Math.round(subtotal * 0.03 * 100) / 100
    const shippingFeeBuyer = [0, 33, 50, 13][i % 4]
    // Buyer's total payment after discounts + buyer-paid shipping.
    const totalRevenue = subtotal - sellerDiscount - platformDiscount + shippingFeeBuyer
    // Demo settlement-style fees (real search-synced orders carry 0 until the
    // Finance API sync lands; seeded here so the fee columns are demonstrable).
    const platformCommission = Math.round(subtotal * 0.06 * 100) / 100
    const shippingFeeSeller = [0, 5, 6, 13][i % 4]
    const daysAgo = i % 28
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 - (i % 12) * 3600 * 1000)

    const order = await prisma.order.create({
      data: {
        tenantId: TENANT_ID,
        shopId: SHOP_ID,
        platformOrderId: `5840${String(100000000000 + i * 7654321).slice(0, 12)}`,
        status: 'COMPLETED',
        currency: 'PHP',
        subtotal,
        platformDiscount,
        sellerDiscount,
        shippingFeeBuyer,
        shippingFeeSeller,
        platformCommission,
        totalRevenue,
        merchantConfirmStatus: 'CONFIRMED',
        merchantConfirmedAt: createdAt,
        isManual: false,
        firstSellerSku: p.sku,
        platformCreatedAt: createdAt,
        createdAt,
        items: {
          create: [
            {
              platformSkuId: `${p.sku}-PLAT`,
              sellerSku: p.sku,
              productName: p.name,
              quantity: qty,
              unitPrice: p.price,
              costPriceAtOrder: p.cost,
            },
          ],
        },
      },
    })

    // Half the orders are "settled" — mimic what the TikTok Finance API sync
    // would write, so the settlement-backed columns are demonstrable locally.
    // The other half stay unsettled (report shows the "estimated" tag).
    if (i % 2 === 0) {
      const commission = Math.round(subtotal * 0.06 * 100) / 100
      const referral = Math.round(subtotal * 0.02 * 100) / 100
      const transaction = Math.round(totalRevenue * 0.02 * 100) / 100
      const affiliate = Math.round(subtotal * 0.03 * 100) / 100
      const fees = commission + referral + transaction + affiliate + shippingFeeSeller
      const settlementAmount = Math.round((totalRevenue - fees) * 100) / 100
      await prisma.orderSettlement.create({
        data: {
          tenantId: TENANT_ID,
          orderId: order.id,
          currency: 'PHP',
          settlementAmount,
          revenueAmount: totalRevenue,
          feeAmount: Math.round(-fees * 100) / 100,
          adjustmentAmount: 0,
          grossSalesAmount: subtotal,
          afterDiscountSubtotal: Math.round((subtotal - sellerDiscount) * 100) / 100,
          sellerDiscountAmount: sellerDiscount,
          platformDiscountAmount: platformDiscount,
          customerPaymentAmount: totalRevenue,
          customerPaidShippingFee: shippingFeeBuyer,
          platformCommissionAmount: commission,
          referralFeeAmount: referral,
          transactionFeeAmount: transaction,
          affiliateCommission: affiliate,
          affiliateCommissionBeforePit: affiliate,
          affiliatePartnerCommission: 0,
          refundAdminFeeAmount: 0,
          shippingFeeAmount: shippingFeeSeller,
          salesTaxAmount: 0,
          statementId: `STMT-${1000 + i}`,
          statementTime: createdAt,
        },
      })
    }
  }

  const count = await prisma.order.count({ where: { shopId: SHOP_ID } })
  console.log('Profit-report demo seed complete!')
  console.log(`   Merchant login: merchant@demo.com / password123`)
  console.log(`   Shop: tongmengmeng TikTok Shop (${count} orders)`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
