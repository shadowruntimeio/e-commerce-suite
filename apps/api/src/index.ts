import { config } from 'dotenv'
import { resolve } from 'node:path'
// Load from repo root .env regardless of cwd (Turbo runs from apps/api/)
config({ path: resolve(__dirname, '../../../.env') })
config() // fallback to local .env if present
import { buildApp } from './app'
import { startScheduler } from './workers/scheduler'
import { startWorkers } from './workers/start'

const port = parseInt(process.env.PORT ?? process.env.API_PORT ?? '3001', 10)

async function main() {
  const app = await buildApp()
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`API running at http://localhost:${port}`)

  try {
    startWorkers()
    startScheduler()
  } catch (err) {
    console.warn('[startup] Workers/scheduler failed to start (Redis may be unavailable):', (err as Error).message)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
