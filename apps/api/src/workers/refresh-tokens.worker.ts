import type { Job } from 'bullmq'
import { prisma } from '@ems/db'

export async function refreshTokensProcessor(job: Job) {
  const expiryThreshold = new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours from now
  const expiringShops = await prisma.shop.findMany({
    where: {
      tokenExpiresAt: { lt: expiryThreshold },
      status: 'ACTIVE',
    },
  })
  console.log(`[refresh-tokens] Found ${expiringShops.length} shops with expiring tokens`)
  // Platform-specific token refresh will be implemented per adapter in Phase 2
}
