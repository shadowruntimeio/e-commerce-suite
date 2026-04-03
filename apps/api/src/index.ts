import 'dotenv/config'
import { buildApp } from './app'

const port = parseInt(process.env.API_PORT ?? '3001', 10)

async function main() {
  const app = await buildApp()
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`API running at http://localhost:${port}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
