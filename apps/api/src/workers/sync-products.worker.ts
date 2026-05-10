import type { Job } from 'bullmq'
import { prisma } from '@ems/db'
import { TikTokAdapter, encryptCredentials as encryptTikTokCredentials, decryptCredentials as decryptTikTokCredentials } from '../platform/tiktok/tiktok.adapter'
import type { TikTokCredentials } from '../platform/tiktok/tiktok.adapter'
import { getShopTikTokAppCreds } from '../platform/tiktok/tiktok-app-creds'
import type { PlatformAdapter, PlatformProduct } from '../platform/adapter.interface'

interface SyncProductsJob {
  shopId: string
  tenantId: string
}

async function getAdapter(shop: { id: string; platform: string }): Promise<PlatformAdapter> {
  switch (shop.platform) {
    case 'TIKTOK': {
      const appCreds = await getShopTikTokAppCreds(shop.id)
      return new TikTokAdapter(appCreds)
    }
    default: throw new Error(`Product sync not supported for platform: ${shop.platform}`)
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

  const adapter = await getAdapter(shop)

  // Backfill shop_cipher for TikTok shops where it's missing
  if (shop.platform === 'TIKTOK') {
    const creds = decryptTikTokCredentials(shop.credentialsEncrypted as TikTokCredentials)
    if (!creds.shopCipher) {
      console.log(`[sync-products] shop_cipher missing for shop ${shop.id}, fetching from /authorization/202309/shops`)
      try {
        const cipher = await (adapter as TikTokAdapter).fetchShopCipher(creds.accessToken, shop.externalShopId)
        if (cipher) {
          const updated = encryptTikTokCredentials({
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken,
            shopCipher: cipher,
          })
          await prisma.shop.update({
            where: { id: shop.id },
            data: { credentialsEncrypted: updated as any },
          })
          const refreshed = await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } })
          Object.assign(shop, refreshed)
          console.log(`[sync-products] shop_cipher backfilled for shop ${shop.id}`)
        } else {
          console.warn(`[sync-products] No matching shop found in /authorization/202309/shops for externalShopId=${shop.externalShopId}`)
        }
      } catch (err) {
        console.warn(`[sync-products] Failed to backfill shop_cipher for shop ${shop.id}: ${(err as Error).message}`)
      }
    }
  }

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
