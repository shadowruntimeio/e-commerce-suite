import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { z } from 'zod'
import multipart from '@fastify/multipart'
import ExcelJS from 'exceljs'

// Merchant SKU cost management. Costs are keyed by sellerSku (skuCode) per
// merchant; the profit report reads them live to compute COGS. MERCHANT manages
// their own; ADMIN may target a merchant via ?ownerUserId=. WAREHOUSE blocked.

const upsertSchema = z.object({
  skuCode: z.string().min(1),
  cost: z.number().min(0),
  note: z.string().max(500).optional(),
})

function resolveOwner(request: { user: { role: string; userId: string } }, ownerUserIdParam?: string): string | null {
  if (request.user.role === 'MERCHANT') return request.user.userId
  if (request.user.role === 'ADMIN') return ownerUserIdParam || null
  return null // WAREHOUSE_STAFF
}

export async function costRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } })
  app.addHook('preHandler', authenticate)

  // GET /costs — SKUs appearing in the merchant's orders, joined with any cost.
  app.get('/', async (request, reply) => {
    const q = request.query as { ownerUserId?: string; search?: string; missingOnly?: string }
    const ownerUserId = resolveOwner(request, q.ownerUserId)
    if (!ownerUserId) return reply.status(403).send({ success: false, error: 'Forbidden' })

    const orderScope = {
      tenantId: request.user.tenantId,
      OR: [
        { shop: { ownerUserId } },
        { isManual: true, createdByUserId: ownerUserId },
      ],
    }

    // Distinct (sellerSku, productName) from this merchant's order items, plus
    // all cost rows (some may not appear in orders, e.g. pre-entered).
    const [items, costs] = await Promise.all([
      prisma.orderItem.findMany({
        where: { order: orderScope, sellerSku: { not: null } },
        select: { sellerSku: true, productName: true },
        distinct: ['sellerSku'],
        take: 5000,
      }),
      prisma.skuCost.findMany({ where: { ownerUserId }, select: { skuCode: true, cost: true, note: true, updatedAt: true } }),
    ])

    const costMap = new Map(costs.map((c) => [c.skuCode, c]))
    const seen = new Set<string>()
    const rows: Array<{ skuCode: string; productName: string | null; cost: number | null; note: string | null; updatedAt: Date | null }> = []
    for (const it of items) {
      const code = it.sellerSku!
      if (seen.has(code)) continue
      seen.add(code)
      const c = costMap.get(code)
      rows.push({ skuCode: code, productName: it.productName ?? null, cost: c ? Number(c.cost) : null, note: c?.note ?? null, updatedAt: c?.updatedAt ?? null })
    }
    // Include cost rows that don't appear in any order item.
    for (const c of costs) {
      if (seen.has(c.skuCode)) continue
      rows.push({ skuCode: c.skuCode, productName: null, cost: Number(c.cost), note: c.note ?? null, updatedAt: c.updatedAt })
    }

    let filtered = rows
    if (q.search) {
      const s = q.search.toLowerCase()
      filtered = filtered.filter((r) => r.skuCode.toLowerCase().includes(s) || (r.productName ?? '').toLowerCase().includes(s))
    }
    if (q.missingOnly === 'true') filtered = filtered.filter((r) => r.cost === null)
    filtered.sort((a, b) => a.skuCode.localeCompare(b.skuCode))

    const withCost = rows.filter((r) => r.cost !== null).length
    return { success: true, data: { items: filtered, total: filtered.length, withCost, missing: rows.length - withCost } }
  })

  // PUT /costs — upsert a single SKU cost.
  app.put('/', async (request, reply) => {
    const ownerUserId = resolveOwner(request, (request.query as { ownerUserId?: string }).ownerUserId)
    if (!ownerUserId) return reply.status(403).send({ success: false, error: 'Forbidden' })
    const parsed = upsertSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' })
    const { skuCode, cost, note } = parsed.data
    const row = await prisma.skuCost.upsert({
      where: { ownerUserId_skuCode: { ownerUserId, skuCode } },
      create: { tenantId: request.user.tenantId, ownerUserId, skuCode, cost, note },
      update: { cost, note },
    })
    return { success: true, data: { skuCode: row.skuCode, cost: Number(row.cost) } }
  })

  // DELETE /costs/:skuCode — clear a SKU's cost.
  app.delete('/:skuCode', async (request, reply) => {
    const ownerUserId = resolveOwner(request, (request.query as { ownerUserId?: string }).ownerUserId)
    if (!ownerUserId) return reply.status(403).send({ success: false, error: 'Forbidden' })
    const { skuCode } = request.params as { skuCode: string }
    await prisma.skuCost.deleteMany({ where: { ownerUserId, skuCode } })
    return { success: true }
  })

  // GET /costs/template — XLSX template (skuCode, cost).
  app.get('/template', async (request, reply) => {
    const wb = new ExcelJS.Workbook()
    wb.creator = 'EMS'
    const sheet = wb.addWorksheet('Costs')
    sheet.columns = [
      { header: 'skuCode', key: 'skuCode', width: 24 },
      { header: 'cost', key: 'cost', width: 16 },
    ]
    sheet.addRow({ skuCode: 'EXAMPLE-SKU-1', cost: 12.5 })
    const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer)
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', 'attachment; filename="sku-cost-template.xlsx"')
    return reply.send(buf)
  })

  // POST /costs/import — bulk upsert from an XLSX with columns skuCode, cost.
  app.post('/import', async (request, reply) => {
    const ownerUserId = resolveOwner(request, (request.query as { ownerUserId?: string }).ownerUserId)
    if (!ownerUserId) return reply.status(403).send({ success: false, error: 'Forbidden' })
    if (!request.isMultipart()) return reply.status(400).send({ success: false, error: 'multipart/form-data required' })

    let fileBuffer: Buffer | undefined
    for await (const part of request.parts()) {
      if (part.type === 'file') fileBuffer = await part.toBuffer()
    }
    if (!fileBuffer) return reply.status(400).send({ success: false, error: 'file required' })

    const wb = new ExcelJS.Workbook()
    try {
      await wb.xlsx.load(fileBuffer as unknown as ArrayBuffer)
    } catch {
      return reply.status(400).send({ success: false, error: 'Invalid XLSX file' })
    }
    const sheet = wb.worksheets[0]
    if (!sheet) return reply.status(400).send({ success: false, error: 'Empty workbook' })

    // Locate columns by header (row 1).
    const header = sheet.getRow(1)
    let skuCol = 0, costCol = 0
    header.eachCell((cell, col) => {
      const v = String(cell.value ?? '').trim().toLowerCase()
      if (v === 'skucode' || v === 'sku' || v === 'sku_code') skuCol = col
      if (v === 'cost' || v === 'costprice' || v === 'cost_price') costCol = col
    })
    if (!skuCol || !costCol) return reply.status(400).send({ success: false, error: 'Header must include "skuCode" and "cost" columns' })

    const updates: Array<{ skuCode: string; cost: number }> = []
    const errors: string[] = []
    sheet.eachRow((row, idx) => {
      if (idx === 1) return
      const skuCode = String(row.getCell(skuCol).value ?? '').trim()
      if (!skuCode) return
      const rawCost = row.getCell(costCol).value
      const cost = typeof rawCost === 'number' ? rawCost : Number(String(rawCost ?? '').replace(/[^0-9.-]/g, ''))
      if (!isFinite(cost) || cost < 0) { errors.push(`Row ${idx}: invalid cost for ${skuCode}`); return }
      updates.push({ skuCode, cost })
    })

    let applied = 0
    for (const u of updates) {
      await prisma.skuCost.upsert({
        where: { ownerUserId_skuCode: { ownerUserId, skuCode: u.skuCode } },
        create: { tenantId: request.user.tenantId, ownerUserId, skuCode: u.skuCode, cost: u.cost },
        update: { cost: u.cost },
      })
      applied++
    }
    return { success: true, data: { applied, errors } }
  })
}
