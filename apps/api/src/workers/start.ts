import { Worker } from 'bullmq'
import { redis } from '../lib/redis'
import { syncOrdersProcessor } from './sync-orders.worker'
import { refreshTokensProcessor } from './refresh-tokens.worker'
import { restockingProcessor } from './restocking.worker'
import { etlProcessor } from './etl.worker'
import { syncAdsProcessor } from './sync-ads.worker'
import { syncMessagesProcessor } from './sync-messages.worker'
import { syncProductsProcessor } from './sync-products.worker'

export function startWorkers() {
  console.log('[workers] Starting BullMQ workers...')

  const orderWorker = new Worker('sync-orders', syncOrdersProcessor, {
    connection: redis,
    concurrency: 5,
    limiter: { max: 900, duration: 3_600_000 },
  })
  orderWorker.on('failed', (job, err) => {
    console.error(`[sync-orders] Job ${job?.id} FAILED:`, err.message)
  })
  orderWorker.on('completed', (job) => {
    console.log(`[sync-orders] Job ${job?.id} completed`)
  })

  new Worker('refresh-tokens', refreshTokensProcessor, {
    connection: redis,
    concurrency: 2,
  })

  new Worker('restocking', restockingProcessor, {
    connection: redis,
    concurrency: 1,
  })

  new Worker('etl', etlProcessor, {
    connection: redis,
    concurrency: 1,
  })

  new Worker('sync-ads', syncAdsProcessor, {
    connection: redis,
    concurrency: 5,
  })

  new Worker('sync-messages', syncMessagesProcessor, {
    connection: redis,
    concurrency: 5,
  })

  const productWorker = new Worker('sync-products', syncProductsProcessor, {
    connection: redis,
    concurrency: 3,
  })
  productWorker.on('failed', (job, err) => {
    console.error(`[sync-products] Job ${job?.id} FAILED:`, err.message)
  })

  console.log('[workers] All workers running')
}
