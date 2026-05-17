import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { requireRoles, requireCapabilities } from '../../middleware/authorize'
import { recordAudit, AuditAction } from '../../lib/audit'
import {
  getCurrentStock,
  createInventoryEvent,
  getStockList,
  getStockDetail,
  adjustStock,
  StockConflictError,
} from './inventory.service'
import { z } from 'zod'
import multipart from '@fastify/multipart'
import { ADJUSTMENT_REASONS } from '@ems/shared'
import { generateTemplate, previewImport, applyImport } from './import.service'
import ExcelJS from 'exceljs'

const ADJUSTMENT_REASON_ENUM = z.enum(ADJUSTMENT_REASONS as [string, ...string[]])

const adjustmentSchema = z.object({
  warehouseSkuId: z.string(),
  expectedQuantity: z.number().int(),
  mode: z.enum(['absolute', 'delta']),
  value: z.number().int(),
  reason: ADJUSTMENT_REASON_ENUM,
  notes: z.string().max(500).optional(),
}).refine(
  (data) => data.reason !== 'OTHER' || (data.notes && data.notes.trim().length > 0),
  { message: 'notes is required when reason is OTHER', path: ['notes'] }
)

const writerRoles = ['ADMIN', 'WAREHOUSE_STAFF', 'MERCHANT'] as const

export async function inventoryRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } })
  app.addHook('preHandler', authenticate)

  // Main list: paginated stock rows with filters
  app.get('/stock', async (request) => {
    const q = request.query as {
      warehouseId?: string
      categoryId?: string
      skuSearch?: string
      lowStockOnly?: string
      ownerUserId?: string
      page?: string
      pageSize?: string
    }
    const page = Math.max(1, Number(q.page ?? 1))
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 50)))
    // MERCHANT users always force-scoped to their own inventory
    const ownerUserId = request.user.role === 'MERCHANT'
      ? request.user.userId
      : (q.ownerUserId || undefined)
    const { items, total } = await getStockList({
      tenantId: request.user.tenantId,
      warehouseId: q.warehouseId,
      categoryId: q.categoryId,
      skuSearch: q.skuSearch?.trim() || undefined,
      lowStockOnly: q.lowStockOnly === 'true',
      ownerUserId,
      page,
      pageSize,
    })
    return {
      success: true,
      data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    }
  })

  app.get('/stock/:warehouseSkuId', async (request, reply) => {
    const { warehouseSkuId } = request.params as { warehouseSkuId: string }
    const detail = await getStockDetail(warehouseSkuId, request.user.tenantId)
    if (!detail) return reply.status(404).send({ success: false, error: 'Stock row not found' })
    return { success: true, data: detail }
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

  // Adjustment history with filters
  app.get('/history', async (request) => {
    const q = request.query as {
      warehouseId?: string
      categoryId?: string
      skuSearch?: string
      userId?: string
      reason?: string
      from?: string
      to?: string
      page?: string
      pageSize?: string
    }
    const page = Math.max(1, Number(q.page ?? 1))
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 50)))

    const where: any = {
      tenantId: request.user.tenantId,
      eventType: 'ADJUSTMENT',
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.reason ? { reason: q.reason as any } : {}),
      ...(q.userId ? { createdBy: q.userId } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
      ...(q.categoryId || q.skuSearch
        ? {
            warehouseSku: {
              systemSku: {
                ...(q.skuSearch
                  ? {
                      OR: [
                        { skuCode: { contains: q.skuSearch, mode: 'insensitive' } },
                        { systemProduct: { name: { contains: q.skuSearch, mode: 'insensitive' } } },
                      ],
                    }
                  : {}),
                ...(q.categoryId ? { systemProduct: { categoryId: q.categoryId } } : {}),
              },
            },
          }
        : {}),
    }

    const [events, total] = await Promise.all([
      prisma.inventoryEvent.findMany({
        where,
        include: {
          warehouse: { select: { id: true, name: true } },
          warehouseSku: {
            select: {
              id: true,
              systemSku: {
                select: {
                  skuCode: true,
                  systemProduct: { select: { name: true, category: { select: { name: true } } } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.inventoryEvent.count({ where }),
    ])

    // Resolve createdBy -> user name in one batch
    const userIds = Array.from(new Set(events.map((e) => e.createdBy).filter((v): v is string => !!v)))
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : []
    const userMap = new Map(users.map((u) => [u.id, u]))

    const items = events.map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      createdBy: e.createdBy,
      createdByName: e.createdBy ? userMap.get(e.createdBy)?.name ?? null : null,
      warehouseId: e.warehouseId,
      warehouseName: e.warehouse.name,
      warehouseSkuId: e.warehouseSkuId,
      skuCode: e.warehouseSku.systemSku.skuCode,
      productName: e.warehouseSku.systemSku.systemProduct.name,
      categoryName: e.warehouseSku.systemSku.systemProduct.category?.name ?? null,
      eventType: e.eventType,
      quantityDelta: e.quantityDelta,
      reason: e.reason,
      notes: e.notes,
    }))

    return {
      success: true,
      data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    }
  })

  // Export current stock as xlsx, honoring the same filters as the list endpoint.
  app.get('/export', async (request, reply) => {
    const q = request.query as {
      warehouseId?: string
      categoryId?: string
      skuSearch?: string
      lowStockOnly?: string
    }
    // Reuse getStockList but pull all pages (cap at 10k for safety)
    const { items } = await getStockList({
      tenantId: request.user.tenantId,
      warehouseId: q.warehouseId,
      categoryId: q.categoryId,
      skuSearch: q.skuSearch?.trim() || undefined,
      lowStockOnly: q.lowStockOnly === 'true',
      page: 1,
      pageSize: 10000,
    })

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'EMS'
    workbook.created = new Date()
    const sheet = workbook.addWorksheet('Stock')
    sheet.columns = [
      { header: 'warehouse_name', key: 'warehouseName', width: 20 },
      { header: 'sku_code', key: 'skuCode', width: 20 },
      { header: 'product_name', key: 'productName', width: 28 },
      { header: 'category', key: 'categoryName', width: 16 },
      { header: 'on_hand', key: 'quantityOnHand', width: 10 },
      { header: 'reserved', key: 'quantityReserved', width: 10 },
      { header: 'available', key: 'quantityAvailable', width: 10 },
      { header: 'reorder_point', key: 'reorderPoint', width: 12 },
      { header: 'last_updated', key: 'lastEventAt', width: 22 },
    ]
    sheet.getRow(1).font = { bold: true }
    for (const row of items) {
      sheet.addRow({
        warehouseName: row.warehouseName,
        skuCode: row.skuCode,
        productName: row.productName,
        categoryName: row.categoryName ?? '',
        quantityOnHand: row.quantityOnHand,
        quantityReserved: row.quantityReserved,
        quantityAvailable: row.quantityAvailable,
        reorderPoint: row.reorderPoint,
        lastEventAt: row.lastEventAt ?? '',
      })
    }
    const buf = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer)
    const stamp = new Date().toISOString().slice(0, 10)
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', `attachment; filename="stock-${stamp}.xlsx"`)
    return reply.send(buf)
  })

  // Generate xlsx import template with data-validation dropdowns populated from
  // the tenant's current warehouses and categories.
  app.get('/import-template', async (request, reply) => {
    const { mode = 'absolute' } = request.query as { mode?: 'absolute' | 'delta' }
    if (mode !== 'absolute' && mode !== 'delta') {
      return reply.status(400).send({ success: false, error: 'mode must be "absolute" or "delta"' })
    }
    const [warehouses, categories] = await Promise.all([
      prisma.warehouse.findMany({
        where: { tenantId: request.user.tenantId, isActive: true },
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.productCategory.findMany({
        where: { tenantId: request.user.tenantId },
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
    ])
    const buffer = await generateTemplate({
      mode,
      warehouseNames: warehouses.map((w) => w.name),
      categoryNames: categories.map((c) => c.name),
      // Merchants get a simplified template — every row is treated as INBOUND.
      hideEventType: request.user.role === 'MERCHANT',
    })
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', `attachment; filename="inventory-${mode}-template.xlsx"`)
    return reply.send(buffer)
  })

  // Step 1: parse xlsx and return a diff preview + token. Does not write.
  app.post('/import/preview', { preHandler: requireRoles([...writerRoles]) }, async (request, reply) => {
    const parts = request.parts()
    let fileBuffer: Buffer | undefined
    let mode: 'absolute' | 'delta' = 'absolute'
    let ownerUserId: string | undefined
    for await (const part of parts) {
      if (part.type === 'file') fileBuffer = await part.toBuffer()
      else if (part.fieldname === 'mode') mode = (part.value as string) === 'delta' ? 'delta' : 'absolute'
      else if (part.fieldname === 'ownerUserId') ownerUserId = part.value as string
    }
    if (!fileBuffer) return reply.status(400).send({ success: false, error: 'No file uploaded' })
    if (request.user.role === 'MERCHANT') ownerUserId = request.user.userId
    if (!ownerUserId) return reply.status(400).send({ success: false, error: 'ownerUserId (merchant) is required' })
    try {
      const result = await previewImport({
        tenantId: request.user.tenantId,
        userId: request.user.userId,
        ownerUserId,
        mode,
        buffer: fileBuffer,
      })
      return { success: true, data: result }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(400).send({ success: false, error: msg })
    }
  })

  // Step 2: apply a previously-previewed import by token.
  app.post('/import/apply', { preHandler: requireRoles([...writerRoles]) }, async (request, reply) => {
    const { token } = (request.body ?? {}) as { token?: string }
    if (!token) return reply.status(400).send({ success: false, error: 'token is required' })
    try {
      const result = await applyImport({
        tenantId: request.user.tenantId,
        userId: request.user.userId,
        token,
      })
      await recordAudit({
        tenantId: request.user.tenantId,
        actorUserId: request.user.userId,
        action: AuditAction.INVENTORY_IMPORT_APPLIED,
        targetType: 'inventory_import',
        payload: { applied: result.applied, skipped: result.skipped },
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? undefined,
      })
      return { success: true, data: result }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(400).send({ success: false, error: msg })
    }
  })

  // Legacy CSV import removed in sub-account migration. Use /import/preview + /import/apply.
  app.post('/import-legacy-removed', { preHandler: requireRoles([...writerRoles]) }, async (_request, reply) => {
    return reply.status(410).send({ success: false, error: 'Legacy CSV import removed. Use /import/preview + /import/apply.' })
  })

  // Single-row adjustment with reason + optimistic lock
  app.post('/adjust', { preHandler: requireCapabilities(['INVENTORY_ADJUST']) }, async (request, reply) => {
    const body = adjustmentSchema.parse(request.body)
    try {
      const event = await adjustStock({
        tenantId: request.user.tenantId,
        warehouseSkuId: body.warehouseSkuId,
        expectedQuantity: body.expectedQuantity,
        mode: body.mode,
        value: body.value,
        reason: body.reason as any,
        notes: body.notes,
        userId: request.user.userId,
      })
      await recordAudit({
        tenantId: request.user.tenantId,
        actorUserId: request.user.userId,
        action: AuditAction.INVENTORY_ADJUST,
        targetType: 'warehouse_sku',
        targetId: body.warehouseSkuId,
        payload: {
          mode: body.mode, value: body.value, reason: body.reason, notes: body.notes,
          expectedQuantity: body.expectedQuantity,
        },
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? undefined,
      })
      return { success: true, data: event }
    } catch (err) {
      if (err instanceof StockConflictError) {
        return reply.status(409).send({
          success: false,
          error: 'Stock was modified by someone else. Please refresh and try again.',
          data: { currentQuantity: err.currentQuantity },
        })
      }
      throw err
    }
  })
}
