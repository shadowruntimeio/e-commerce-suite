import 'dotenv/config'
import { Worker } from 'bullmq'
import { redis } from '../lib/redis'
import { syncOrdersProcessor } from './sync-orders.worker'
import { refreshTokensProcessor } from './refresh-tokens.worker'
import { restockingProcessor } from './restocking.worker'
import { etlProcessor } from './etl.worker'
import { syncAdsProcessor } from './sync-ads.worker'
import { syncMessagesProcessor } from './sync-messages.worker'

console.log('Starting BullMQ workers...')

new Worker('sync-orders', syncOrdersProcessor, {
  connection: redis,
  concurrency: 5,
  limiter: { max: 900, duration: 3_600_000 }, // 900 per hour per queue
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

console.log('Workers running')
