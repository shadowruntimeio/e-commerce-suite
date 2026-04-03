import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import { authRoutes } from './modules/auth/auth.routes'
import { shopRoutes } from './modules/shops/shop.routes'
import { productRoutes } from './modules/products/product.routes'
import { orderRoutes } from './modules/orders/order.routes'
import { inventoryRoutes } from './modules/inventory/inventory.routes'
import { warehouseRoutes } from './modules/warehouses/warehouse.routes'
import { purchaseRoutes } from './modules/purchase/purchase.routes'
import { dashboardRoutes } from './modules/dashboard/dashboard.routes'
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

  // Protected routes — authenticate middleware applied per-route
  await app.register(shopRoutes, { prefix: '/api/v1/shops' })
  await app.register(productRoutes, { prefix: '/api/v1/products' })
  await app.register(orderRoutes, { prefix: '/api/v1/orders' })
  await app.register(inventoryRoutes, { prefix: '/api/v1/inventory' })
  await app.register(warehouseRoutes, { prefix: '/api/v1/warehouses' })
  await app.register(purchaseRoutes, { prefix: '/api/v1/purchase' })
  await app.register(dashboardRoutes, { prefix: '/api/v1/dashboard' })

  app.get('/health', async () => ({ status: 'ok' }))

  return app
}
