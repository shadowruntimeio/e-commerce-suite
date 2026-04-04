import type { Job } from 'bullmq'

export async function syncAdsProcessor(job: Job<{ shopId: string; tenantId: string }>) {
  // Shopee Ads API and TikTok Ads API integration goes here in Phase 3.2
  // Stub: log and return — no actual API call yet
  console.log(`[sync-ads] Ads sync for shop ${job.data.shopId} — API integration pending credentials`)
}
