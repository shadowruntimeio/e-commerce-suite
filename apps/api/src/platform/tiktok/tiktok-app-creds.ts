import { prisma } from '@ems/db'
import { encrypt, decrypt } from '../../lib/encryption'
import type { TikTokAppCreds } from './tiktok.adapter'

/**
 * Each MERCHANT user can configure their own TikTok app (in Partner Center)
 * and supply the resulting app_key + app_secret here. These are stored on
 * `User.settings.tiktok` — secret is encrypted at rest.
 *
 * Resolution order: merchant's own creds → env fallback (TIKTOK_APP_KEY /
 * TIKTOK_APP_SECRET). The env fallback is kept so the existing deployment
 * keeps working for shops connected before per-merchant apps existed.
 */

export interface UserTikTokSettings {
  appKey?: string
  /** AES-GCM encrypted secret blob (iv:tag:ct hex). */
  appSecretEncrypted?: string
}

function envFallback(): TikTokAppCreds {
  return {
    appKey: process.env.TIKTOK_APP_KEY ?? '',
    appSecret: process.env.TIKTOK_APP_SECRET ?? '',
  }
}

function readUserSettings(settings: unknown): UserTikTokSettings | undefined {
  if (!settings || typeof settings !== 'object') return undefined
  const tt = (settings as Record<string, unknown>).tiktok
  if (!tt || typeof tt !== 'object') return undefined
  return tt as UserTikTokSettings
}

/**
 * Decrypt-and-validate a merchant's TikTok app creds. Returns null if either
 * field is missing — caller should decide whether to fall back to env.
 */
export function decryptUserTikTokCreds(settings: unknown): TikTokAppCreds | null {
  const tt = readUserSettings(settings)
  if (!tt?.appKey || !tt?.appSecretEncrypted) return null
  try {
    return { appKey: tt.appKey, appSecret: decrypt(tt.appSecretEncrypted) }
  } catch {
    return null
  }
}

/**
 * Encrypt a plaintext secret for storage on `User.settings.tiktok`.
 */
export function buildUserTikTokSettings(appKey: string, plainSecret: string): UserTikTokSettings {
  return { appKey, appSecretEncrypted: encrypt(plainSecret) }
}

/**
 * Resolve the TikTok app creds for a merchant user (by id), falling back to
 * env on missing/partial config. Used by the OAuth connect endpoint where the
 * caller is a logged-in merchant.
 */
export async function getMerchantTikTokAppCreds(userId: string): Promise<TikTokAppCreds> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { settings: true },
  })
  return decryptUserTikTokCreds(user?.settings) ?? envFallback()
}

/**
 * Resolve the TikTok app creds tied to a shop (via shop.ownerUserId). Used
 * by background workers (sync, refresh) and the OAuth callback when only the
 * shop / state is known.
 */
export async function getShopTikTokAppCreds(shopId: string): Promise<TikTokAppCreds> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { owner: { select: { settings: true } } },
  })
  return decryptUserTikTokCreds(shop?.owner.settings) ?? envFallback()
}
