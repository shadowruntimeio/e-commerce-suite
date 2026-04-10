import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { getCurrentStock, createInventoryEvent } from './inventory.service'
import { z } from 'zod'
import multipart from '@fastify/multipart'

const adjustmentSchema = z.object({
  warehouseSkuId: z.string(),
  warehouseId: z.string(),
  quantityDelta: z.number().int(),
  notes: z.string().optional(),
})

export async function inventoryRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } })
  app.addHook('preHandler', authenticate)

  app.get('/stock/:warehouseSkuId', async (request, reply) => {
    const { warehouseSkuId } = request.params as { warehouseSkuId: string }
    const stock = await getCurrentStock(warehouseSkuId)
    return { success: true, data: stock }
  })

  app.get('/events', async (request) => {
    const { warehouseSkuId, limit = 50 } = request.query as { warehouseSkuId?: string; limit?: number }
    const events = await prisma.inventoryEvent.findMany({
      where: {
        tenantId: request.user.tenantId,
        ...(warehouseSkuId ? { warehouseSkuId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
    })
    return { success: true, data: events }
  })

  // CSV import: bulk inventory events
  app.post('/import', async (request, reply) => {
    const parts = request.parts()
    let fileBuffer: Buffer | undefined
    let warehouseId: string | undefined

    for await (const part of parts) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer()
      } else if (part.fieldname === 'warehouseId') {
        warehouseId = part.value as string
      }
    }

    if (!fileBuffer) return reply.status(400).send({ success: false, error: 'No file uploaded' })
    if (!warehouseId) return reply.status(400).send({ success: false, error: 'Warehouse is required' })

    // Verify warehouse exists and belongs to tenant
    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId: request.user.tenantId },
    })
    if (!warehouse) return reply.status(400).send({ success: false, error: 'Warehouse not found' })

    const text = fileBuffer.toString('utf-8')
    const lines = text.split(/\r?\n/).filter((l) => l.trim())

    if (lines.length < 2) {
      return reply.status(400).send({ success: false, error: 'CSV must have a header row and at least one data row' })
    }

    const header = lines[0].split(',').map((h) => h.trim().toLowerCase())
    const requiredCols = ['sku_code', 'event_type', 'quantity']
    for (const col of requiredCols) {
      if (!header.includes(col)) {
        return reply.status(400).send({ success: false, error: `Missing required column: ${col}` })
      }
    }

    const skuIdx = header.indexOf('sku_code')
    const typeIdx = header.indexOf('event_type')
    const qtyIdx = header.indexOf('quantity')
    const notesIdx = header.indexOf('notes')

    const validTypes = ['INBOUND', 'OUTBOUND', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'RETURN']
    const errors: string[] = []
    let imported = 0

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim())
      const skuCode = cols[skuIdx]
      const eventType = cols[typeIdx]?.toUpperCase()
      const quantity = parseInt(cols[qtyIdx], 10)
      const notes = notesIdx >= 0 ? cols[notesIdx] : undefined

      if (!skuCode || !eventType || isNaN(quantity)) {
        errors.push(`Row ${i + 1}: missing or invalid data`)
        continue
      }

      if (!validTypes.includes(eventType)) {
        errors.push(`Row ${i + 1}: invalid event_type "${eventType}"`)
        continue
      }

      // Find or auto-create system SKU by code
      let systemSku = await prisma.systemSku.findUnique({ where: { skuCode } })
      if (!systemSku) {
        // Create a minimal system product + SKU
        const product = await prisma.systemProduct.create({
          data: {
            tenantId: request.user.tenantId,
            spuCode: skuCode,
            name: skuCode,
          },
        })
        systemSku = await prisma.systemSku.create({
          data: {
            systemProductId: product.id,
            skuCode,
            attributes: {},
            costPrice: 0,
          },
        })
        console.log(`[inventory/import] Auto-created SKU: ${skuCode}`)
      }

      // Find or create warehouseSku
      let warehouseSku = await prisma.warehouseSku.findUnique({
        where: { systemSkuId_warehouseId: { systemSkuId: systemSku.id, warehouseId: warehouse.id } },
      })
      if (!warehouseSku) {
        warehouseSku = await prisma.warehouseSku.create({
          data: { systemSkuId: systemSku.id, warehouseId: warehouse.id },
        })
      }

      const delta = ['OUTBOUND', 'TRANSFER_OUT'].includes(eventType) ? -Math.abs(quantity) : Math.abs(quantity)

      await createInventoryEvent({
        tenantId: request.user.tenantId,
        warehouseSkuId: warehouseSku.id,
        warehouseId: warehouse.id,
        eventType: eventType as any,
        quantityDelta: delta,
        notes: notes || `CSV import row ${i + 1}`,
        referenceType: 'csv_import',
        createdBy: request.user.userId,
      })
      imported++
    }

    return {
      success: true,
      data: { imported, errors, totalRows: lines.length - 1 },
    }
  })

  app.post('/adjust', async (request) => {
    const body = adjustmentSchema.parse(request.body)
    const event = await createInventoryEvent({
      tenantId: request.user.tenantId,
      warehouseSkuId: body.warehouseSkuId,
      warehouseId: body.warehouseId,
      eventType: 'ADJUSTMENT',
      quantityDelta: body.quantityDelta,
      notes: body.notes,
      createdBy: request.user.userId,
    })
    return { success: true, data: event }
  })
}
