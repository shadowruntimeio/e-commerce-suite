import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import { authRoutes } from './modules/auth/auth.routes'
import { shopRoutes } from './modules/shops/shop.routes'
import { productRoutes } from './modules/products/product.routes'
import { orderRoutes } from './modules/orders/order.routes'
import { rulesRoutes } from './modules/orders/rules.routes'
import { inventoryRoutes } from './modules/inventory/inventory.routes'
import { warehouseRoutes } from './modules/warehouses/warehouse.routes'
import { purchaseRoutes } from './modules/purchase/purchase.routes'
import { restockingRoutes } from './modules/purchase/restocking.routes'
import { dashboardRoutes } from './modules/dashboard/dashboard.routes'
import { reportsRoutes } from './modules/reports/reports.routes'
import { adsRoutes } from './modules/ads/ads.routes'
import { csRoutes } from './modules/cs/cs.routes'
import { logisticsRoutes } from './modules/logistics/logistics.routes'
import { tiktokWebhookRoutes } from './modules/webhooks/tiktok.webhook'
import { authenticate } from './middleware/authenticate'

export async function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  })

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  })

  await app.register(sensible)

  // Public routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' })
  await app.register(tiktokWebhookRoutes, { prefix: '/api/v1/webhooks' })

  // Protected routes — authenticate middleware applied per-route
  await app.register(shopRoutes, { prefix: '/api/v1/shops' })
  await app.register(productRoutes, { prefix: '/api/v1/products' })
  await app.register(orderRoutes, { prefix: '/api/v1/orders' })
  await app.register(rulesRoutes, { prefix: '/api/v1/orders/rules' })
  await app.register(inventoryRoutes, { prefix: '/api/v1/inventory' })
  await app.register(warehouseRoutes, { prefix: '/api/v1/warehouses' })
  await app.register(purchaseRoutes, { prefix: '/api/v1/purchase' })
  await app.register(restockingRoutes, { prefix: '/api/v1/purchase/suggestions' })
  await app.register(dashboardRoutes, { prefix: '/api/v1/dashboard' })
  await app.register(reportsRoutes, { prefix: '/api/v1/reports' })
  await app.register(adsRoutes, { prefix: '/api/v1/ads' })
  await app.register(csRoutes, { prefix: '/api/v1/cs' })
  await app.register(logisticsRoutes, { prefix: '/api/v1/logistics' })

  app.get('/health', async () => ({ status: 'ok' }))

  return app
}
