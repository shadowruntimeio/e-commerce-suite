import type { Job } from 'bullmq'

export async function syncMessagesProcessor(job: Job<{ shopId: string; tenantId: string }>) {
  console.log(`[sync-messages] Message sync for shop ${job.data.shopId} — Shopee/TikTok Chat API integration pending`)
}
