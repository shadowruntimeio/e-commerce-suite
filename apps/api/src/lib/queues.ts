import { Queue } from 'bullmq'
import { redis } from './redis'

const connection = redis

export const syncOrdersQueue = new Queue('sync-orders', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
})

export const syncProductsQueue = new Queue('sync-products', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
})

export const refreshTokensQueue = new Queue('refresh-tokens', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
})

export const restockingQueue = new Queue('restocking', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  },
})

export const etlQueue = new Queue('etl', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  },
})

export const syncAdsQueue = new Queue('sync-ads', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
})

export const syncMessagesQueue = new Queue('sync-messages', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
})
