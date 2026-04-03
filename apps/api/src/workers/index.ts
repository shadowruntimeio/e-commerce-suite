import 'dotenv/config'
import { Worker } from 'bullmq'
import { redis } from '../lib/redis'
import { syncOrdersProcessor } from './sync-orders.worker'
import { refreshTokensProcessor } from './refresh-tokens.worker'

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

console.log('Workers running')
