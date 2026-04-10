import type { Job } from 'bullmq'
import { prisma } from '@ems/db'
import { TikTokAdapter } from '../platform/tiktok/tiktok.adapter'
import type { PlatformAdapter, PlatformProduct } from '../platform/adapter.interface'

interface SyncProductsJob {
  shopId: string
  tenantId: string
}

function getAdapter(platform: string): PlatformAdapter {
  switch (platform) {
    case 'TIKTOK': return new TikTokAdapter()
    default: throw new Error(`Product sync not supported for platform: ${platform}`)
  }
}

export async function syncProductsProcessor(job: Job<SyncProductsJob>) {
  const { shopId, tenantId } = job.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shop = await prisma.shop.findFirst({ where: { id: shopId, tenantId } }) as any
  if (!shop) throw new Error(`Shop ${shopId} not found`)

  if (!['TIKTOK'].includes(shop.platform)) {
    console.log(`[sync-products] Product sync not yet supported for ${shop.platform}`)
    return
  }

  console.log(`[sync-products] Starting product sync for shop ${shop.name} (${shop.platform})`)

  const adapter = getAdapter(shop.platform)
  const products: PlatformProduct[] = await adapter.syncProducts(shop)

  console.log(`[sync-products] Fetched ${products.length} products for shop ${shop.id}`)

  for (const product of products) {
    await upsertProduct(shopId, product)
  }

  console.log(`[sync-products] Completed product sync for shop ${shop.id}: ${products.length} products processed`)
}

async function upsertProduct(shopId: string, product: PlatformProduct): Promise<void> {
  const onlineProduct = await prisma.onlineProduct.upsert({
    where: {
      shopId_platformItemId: {
        shopId,
        platformItemId: product.platformItemId,
      },
    },
    update: {
      title: product.title,
      status: product.status,
      platformData: product.platformData as any,
    },
    create: {
      shopId,
      platformItemId: product.platformItemId,
      title: product.title,
      status: product.status,
      platformData: product.platformData as any,
    },
  })

  for (const sku of product.skus) {
    await prisma.onlineSku.upsert({
      where: {
        onlineProductId_platformSkuId: {
          onlineProductId: onlineProduct.id,
          platformSkuId: sku.platformSkuId,
        },
      },
      update: {
        price: sku.price,
      },
      create: {
        onlineProductId: onlineProduct.id,
        platformSkuId: sku.platformSkuId,
        price: sku.price,
      },
    })
  }
}
