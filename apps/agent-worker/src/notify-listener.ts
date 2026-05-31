import { Client } from 'pg'

/**
 * Single-connection LISTEN client for the ai_task_new channel.
 *
 * The Prisma pool can't be used for LISTEN — it returns idle connections to
 * the pool after each query, but LISTEN requires a connection that stays
 * dedicated for the lifetime of the subscription. So we keep one separate
 * `pg.Client` alongside Prisma.
 *
 * Auto-reconnects with exponential backoff on disconnect. The main loop still
 * polls every 30s as a safety net, so even if this listener is down we don't
 * stop processing tasks — they just take up to 30s longer to pick up.
 */
export interface NotifyListener {
  /** A promise that resolves the next time ANY notification arrives. */
  wait(): Promise<void>
  stop(): Promise<void>
}

const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 30_000

export async function startNotifyListener(channel = 'ai_task_new'): Promise<NotifyListener> {
  // One pending resolver at a time. Every notification flips it; callers
  // re-acquire via wait() to listen for the next one.
  let resolveNext: (() => void) | null = null
  function wakeUp() {
    if (resolveNext) {
      const r = resolveNext
      resolveNext = null
      r()
    }
  }

  let stopped = false
  let client: Client | null = null
  let reconnectTimer: NodeJS.Timeout | null = null

  async function connect(backoffMs = BACKOFF_INITIAL_MS): Promise<void> {
    if (stopped) return
    const c = new Client({ connectionString: process.env.DATABASE_URL })
    c.on('error', (err) => {
      // pg emits 'error' on connection loss. The 'end' handler below schedules
      // the reconnect; we just log here.
      console.warn(`[agent-worker] LISTEN client error: ${err.message}`)
    })
    c.on('end', () => {
      // Connection closed (server killed it, network blip, etc). Reconnect
      // unless we were intentionally stopped.
      if (stopped) return
      console.warn('[agent-worker] LISTEN connection ended; reconnecting...')
      client = null
      scheduleReconnect(backoffMs)
    })
    c.on('notification', (msg) => {
      if (msg.channel === channel) {
        wakeUp()
      }
    })

    try {
      await c.connect()
      await c.query(`LISTEN ${channel}`)
      client = c
      console.log(`[agent-worker] LISTEN on "${channel}" active`)
      // Reset backoff after a successful connection.
      backoffMs = BACKOFF_INITIAL_MS
    } catch (err) {
      const msg = (err as Error).message
      console.warn(`[agent-worker] LISTEN connect failed: ${msg}; retry in ${backoffMs}ms`)
      try { await c.end() } catch { /* best effort */ }
      scheduleReconnect(backoffMs)
    }
  }

  function scheduleReconnect(backoffMs: number) {
    if (stopped || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      const nextBackoff = Math.min(backoffMs * 2, BACKOFF_MAX_MS)
      void connect(nextBackoff)
    }, backoffMs)
  }

  await connect()

  return {
    wait: () =>
      new Promise<void>((resolve) => {
        // If a notification arrives between waits, we lose it — but the main
        // loop always tries a claim BEFORE waiting, so any missed wake-up is
        // covered by the immediate post-poll claim attempt. Worst case the
        // 30s fallback poll picks up the task.
        resolveNext = resolve
      }),
    stop: async () => {
      stopped = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (client) {
        try { await client.end() } catch { /* best effort */ }
        client = null
      }
      if (resolveNext) resolveNext() // unblock any pending wait()
    },
  }
}
