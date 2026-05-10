import ExcelJS from 'exceljs'
import { prisma, Prisma } from '@ems/db'
import { ADJUSTMENT_REASONS } from '@ems/shared'
import type { AdjustmentReason, InventoryEventType } from '@ems/shared'
import { getCurrentStock, createInventoryEvent } from './inventory.service'

const EVENT_TYPES: InventoryEventType[] = [
  'INBOUND',
  'OUTBOUND',
  'ADJUSTMENT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'RETURN',
]

export type ImportMode = 'absolute' | 'delta'

// Columns per mode. Keep headers in sync with template generation below.
const ABSOLUTE_COLUMNS = ['warehouse_name', 'sku_code', 'product_name', 'category', 'counted_quantity', 'reason', 'notes']
const DELTA_COLUMNS = ['warehouse_name', 'sku_code', 'product_name', 'category', 'event_type', 'quantity', 'reason', 'notes']

export interface ParsedRowAbsolute {
  rowNumber: number
  warehouseName: string
  skuCode: string
  productName?: string
  category?: string
  countedQuantity: number
  reason: AdjustmentReason
  notes?: string
}

export interface ParsedRowDelta {
  rowNumber: number
  warehouseName: string
  skuCode: string
  productName?: string
  category?: string
  eventType: InventoryEventType
  quantity: number
  reason?: AdjustmentReason
  notes?: string
}

export interface PreviewRow {
  rowNumber: number
  warehouseName: string
  warehouseId: string | null
  skuCode: string
  productName: string | null
  categoryBefore: string | null
  categoryAfter: string | null
  quantityBefore: number | null
  quantityAfter: number | null
  delta: number | null
  skuWillBeCreated: boolean
  reason?: AdjustmentReason | null
  eventType?: InventoryEventType | null
  notes?: string | null
  error?: string
}

export interface PreviewResult {
  mode: ImportMode
  totalRows: number
  validRows: number
  errorRows: number
  rows: PreviewRow[]
  token: string
  expiresAt: string
}

// ─── Template generation ─────────────────────────────────────────────────────

export async function generateTemplate(opts: {
  mode: ImportMode
  warehouseNames: string[]
  categoryNames: string[]
  // When true (merchant accounts), drop the event_type column from the delta
  // template — uploads default to INBOUND. Has no effect in absolute mode.
  hideEventType?: boolean
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'EMS'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(opts.mode === 'absolute' ? 'Stocktake' : 'Adjustment')
  const deltaHeaders = opts.hideEventType
    ? DELTA_COLUMNS.filter((c) => c !== 'event_type')
    : DELTA_COLUMNS
  const headers = opts.mode === 'absolute' ? ABSOLUTE_COLUMNS : deltaHeaders
  sheet.addRow(headers)
  sheet.getRow(1).font = { bold: true }
  sheet.columns.forEach((col) => { col.width = 18 })

  // Hidden reference sheet holds list values — cleaner than inlining in formulae
  // since inline list strings are capped at 255 chars (Excel limit).
  const ref = workbook.addWorksheet('_ref', { state: 'hidden' })
  const writeList = (columnLetter: string, values: string[]) => {
    values.forEach((v, i) => { ref.getCell(`${columnLetter}${i + 1}`).value = v })
  }
  writeList('A', opts.warehouseNames)
  writeList('B', opts.categoryNames)
  writeList('C', EVENT_TYPES)
  writeList('D', ADJUSTMENT_REASONS)

  const applyValidation = (col: string, listCol: string, count: number) => {
    if (count === 0) return
    for (let row = 2; row <= 1000; row++) {
      sheet.getCell(`${col}${row}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`=_ref!$${listCol}$1:$${listCol}$${count}`],
        showErrorMessage: true,
        errorStyle: 'error',
      }
    }
  }

  if (opts.mode === 'absolute') {
    // warehouse_name=A, sku_code=B, product_name=C, category=D, counted_quantity=E, reason=F, notes=G
    applyValidation('A', 'A', opts.warehouseNames.length)
    applyValidation('D', 'B', opts.categoryNames.length)
    applyValidation('F', 'D', ADJUSTMENT_REASONS.length)
  } else if (opts.hideEventType) {
    // warehouse_name=A, sku_code=B, product_name=C, category=D, quantity=E, reason=F, notes=G
    applyValidation('A', 'A', opts.warehouseNames.length)
    applyValidation('D', 'B', opts.categoryNames.length)
    applyValidation('F', 'D', ADJUSTMENT_REASONS.length)
  } else {
    // warehouse_name=A, sku_code=B, product_name=C, category=D, event_type=E, quantity=F, reason=G, notes=H
    applyValidation('A', 'A', opts.warehouseNames.length)
    applyValidation('D', 'B', opts.categoryNames.length)
    applyValidation('E', 'C', EVENT_TYPES.length)
    applyValidation('G', 'D', ADJUSTMENT_REASONS.length)
  }

  const buf = (await workbook.xlsx.writeBuffer()) as ArrayBuffer
  return Buffer.from(buf)
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

function normalizeHeader(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, '_')
}

function cellString(c: ExcelJS.CellValue): string {
  if (c === null || c === undefined) return ''
  if (typeof c === 'string') return c.trim()
  if (typeof c === 'number' || typeof c === 'boolean') return String(c)
  if (c instanceof Date) return c.toISOString()
  // Rich text or formula result — try .text / .result
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const any = c as any
  if (any?.richText) return (any.richText as Array<{ text: string }>).map((r) => r.text).join('').trim()
  if (any?.result !== undefined) return String(any.result).trim()
  if (any?.text) return String(any.text).trim()
  return String(c).trim()
}

function cellNumber(c: ExcelJS.CellValue): number | null {
  const s = cellString(c)
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export async function parseWorkbook(buffer: Buffer, mode: ImportMode): Promise<{ rows: ParsedRowAbsolute[] | ParsedRowDelta[]; errors: Array<{ row: number; error: string }> }> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as any)
  const sheet = workbook.worksheets.find((s) => s.name !== '_ref') ?? workbook.worksheets[0]
  if (!sheet) throw new Error('Workbook has no sheet')

  const expected = mode === 'absolute' ? ABSOLUTE_COLUMNS : DELTA_COLUMNS
  const headerRow = sheet.getRow(1)
  const headers: string[] = []
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = normalizeHeader(cell.value)
  })

  const colIdx: Record<string, number> = {}
  for (const col of expected) {
    const idx = headers.indexOf(col)
    if (idx === -1) {
      // event_type is optional in delta mode — merchant templates omit it and
      // we default the row to INBOUND below.
      if (mode === 'delta' && col === 'event_type') continue
      throw new Error(`Missing required column: ${col}`)
    }
    colIdx[col] = idx
  }

  const rows: any[] = []
  const errors: Array<{ row: number; error: string }> = []

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    if (row.cellCount === 0) continue

    const warehouseName = cellString(row.getCell(colIdx.warehouse_name).value)
    const skuCode = cellString(row.getCell(colIdx.sku_code).value)
    if (!warehouseName && !skuCode) continue // fully blank row

    const productName = cellString(row.getCell(colIdx.product_name).value) || undefined
    const category = cellString(row.getCell(colIdx.category).value) || undefined
    const reason = (cellString(row.getCell(colIdx.reason).value).toUpperCase() || undefined) as AdjustmentReason | undefined
    const notes = cellString(row.getCell(colIdx.notes).value) || undefined

    if (!warehouseName) { errors.push({ row: r, error: 'warehouse_name is required' }); continue }
    if (!skuCode) { errors.push({ row: r, error: 'sku_code is required' }); continue }
    if (reason && !ADJUSTMENT_REASONS.includes(reason as AdjustmentReason)) {
      errors.push({ row: r, error: `invalid reason "${reason}"` })
      continue
    }

    if (mode === 'absolute') {
      const counted = cellNumber(row.getCell(colIdx.counted_quantity).value)
      if (counted === null || !Number.isInteger(counted) || counted < 0) {
        errors.push({ row: r, error: 'counted_quantity must be a non-negative integer' })
        continue
      }
      if (!reason) { errors.push({ row: r, error: 'reason is required' }); continue }
      rows.push({
        rowNumber: r,
        warehouseName,
        skuCode,
        productName,
        category,
        countedQuantity: counted,
        reason,
        notes,
      } satisfies ParsedRowAbsolute)
    } else {
      const hasEventTypeCol = colIdx.event_type !== undefined
      const eventType: InventoryEventType = hasEventTypeCol
        ? (cellString(row.getCell(colIdx.event_type).value).toUpperCase() as InventoryEventType)
        : 'INBOUND'
      const qty = cellNumber(row.getCell(colIdx.quantity).value)
      if (hasEventTypeCol && (!eventType || !EVENT_TYPES.includes(eventType))) {
        errors.push({ row: r, error: `invalid event_type "${eventType}"` })
        continue
      }
      if (qty === null || !Number.isInteger(qty) || qty <= 0) {
        errors.push({ row: r, error: 'quantity must be a positive integer' })
        continue
      }
      rows.push({
        rowNumber: r,
        warehouseName,
        skuCode,
        productName,
        category,
        eventType,
        quantity: qty,
        reason,
        notes,
      } satisfies ParsedRowDelta)
    }
  }

  return { rows, errors }
}

// ─── Preview ─────────────────────────────────────────────────────────────────

// Small in-memory cache of parsed import sessions, keyed by a random token. The
// apply endpoint looks up the token + reruns writes in a single transaction.
// 10-minute TTL is long enough for a user to review the diff and confirm, short
// enough that memory doesn't bloat if they walk away.
const previewCache = new Map<string, { tenantId: string; userId: string; ownerUserId: string; mode: ImportMode; rows: any[]; expiresAt: number }>()

function cleanPreviewCache() {
  const now = Date.now()
  for (const [key, val] of previewCache) {
    if (val.expiresAt < now) previewCache.delete(key)
  }
}

function randomToken(): string {
  return [...Array(32)].map(() => Math.random().toString(36)[2] ?? '0').join('')
}

export async function previewImport(opts: {
  tenantId: string
  userId: string
  ownerUserId: string
  mode: ImportMode
  buffer: Buffer
}): Promise<PreviewResult> {
  cleanPreviewCache()
  const { rows, errors } = await parseWorkbook(opts.buffer, opts.mode)

  // Batch-resolve warehouses and SKUs to avoid N queries
  const warehouseNames = Array.from(new Set(rows.map((r: any) => r.warehouseName)))
  const skuCodes = Array.from(new Set(rows.map((r: any) => r.skuCode)))

  const warehouses = await prisma.warehouse.findMany({
    where: { tenantId: opts.tenantId, name: { in: warehouseNames } },
    select: { id: true, name: true },
  })
  const warehouseMap = new Map(warehouses.map((w) => [w.name, w.id]))

  const skus = await prisma.systemSku.findMany({
    where: {
      skuCode: { in: skuCodes },
      systemProduct: { tenantId: opts.tenantId, ownerUserId: opts.ownerUserId },
    },
    include: {
      systemProduct: { include: { category: { select: { name: true } } } },
    },
  })
  const skuMap = new Map(skus.map((s) => [s.skuCode, s]))

  const previewRows: PreviewRow[] = []

  for (const parsed of rows) {
    const p = parsed as ParsedRowAbsolute | ParsedRowDelta
    const warehouseId = warehouseMap.get(p.warehouseName) ?? null
    const sku = skuMap.get(p.skuCode) ?? null
    const categoryAfter = p.category ?? (sku?.systemProduct.category?.name ?? null)
    const categoryBefore = sku?.systemProduct.category?.name ?? null

    if (!warehouseId) {
      previewRows.push({
        rowNumber: p.rowNumber,
        warehouseName: p.warehouseName,
        warehouseId: null,
        skuCode: p.skuCode,
        productName: sku?.systemProduct.name ?? null,
        categoryBefore,
        categoryAfter,
        quantityBefore: null,
        quantityAfter: null,
        delta: null,
        skuWillBeCreated: !sku,
        reason: (p as any).reason ?? null,
        eventType: (p as any).eventType ?? null,
        notes: p.notes ?? null,
        error: `Warehouse "${p.warehouseName}" not found`,
      })
      continue
    }

    let quantityBefore: number | null = null
    let delta = 0
    if (sku) {
      const wsku = await prisma.warehouseSku.findUnique({
        where: { systemSkuId_warehouseId: { systemSkuId: sku.id, warehouseId } },
      })
      if (wsku) {
        const s = await getCurrentStock(wsku.id)
        quantityBefore = s.quantityOnHand
      } else {
        quantityBefore = 0
      }
    } else {
      quantityBefore = 0
    }

    if (opts.mode === 'absolute') {
      const target = (p as ParsedRowAbsolute).countedQuantity
      delta = target - (quantityBefore ?? 0)
    } else {
      const d = p as ParsedRowDelta
      delta = ['OUTBOUND', 'TRANSFER_OUT'].includes(d.eventType) ? -Math.abs(d.quantity) : Math.abs(d.quantity)
    }
    const quantityAfter = (quantityBefore ?? 0) + delta

    previewRows.push({
      rowNumber: p.rowNumber,
      warehouseName: p.warehouseName,
      warehouseId,
      skuCode: p.skuCode,
      productName: p.productName ?? sku?.systemProduct.name ?? p.skuCode,
      categoryBefore,
      categoryAfter,
      quantityBefore,
      quantityAfter,
      delta,
      skuWillBeCreated: !sku,
      reason: (p as any).reason ?? null,
      eventType: (p as any).eventType ?? 'ADJUSTMENT',
      notes: p.notes ?? null,
    })
  }

  // Append parse-errors as error rows so the UI shows them
  for (const e of errors) {
    previewRows.push({
      rowNumber: e.row,
      warehouseName: '',
      warehouseId: null,
      skuCode: '',
      productName: null,
      categoryBefore: null,
      categoryAfter: null,
      quantityBefore: null,
      quantityAfter: null,
      delta: null,
      skuWillBeCreated: false,
      error: e.error,
    })
  }

  previewRows.sort((a, b) => a.rowNumber - b.rowNumber)

  const validRows = previewRows.filter((r) => !r.error).length
  const errorRows = previewRows.length - validRows

  const token = randomToken()
  const expiresAt = Date.now() + 10 * 60 * 1000
  previewCache.set(token, {
    tenantId: opts.tenantId,
    userId: opts.userId,
    ownerUserId: opts.ownerUserId,
    mode: opts.mode,
    rows: previewRows,
    expiresAt,
  })

  return {
    mode: opts.mode,
    totalRows: previewRows.length,
    validRows,
    errorRows,
    rows: previewRows,
    token,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

// ─── Apply ───────────────────────────────────────────────────────────────────

export async function applyImport(opts: { tenantId: string; userId: string; token: string }): Promise<{ applied: number; skipped: number }> {
  cleanPreviewCache()
  const session = previewCache.get(opts.token)
  if (!session) throw new Error('Preview expired or not found. Please re-upload.')
  if (session.tenantId !== opts.tenantId) throw new Error('Preview token does not match current session')

  const rows = session.rows as PreviewRow[]
  let applied = 0
  let skipped = 0

  for (const row of rows) {
    if (row.error || !row.warehouseId) { skipped++; continue }

    // Resolve or auto-create category
    let categoryId: string | null = null
    if (row.categoryAfter) {
      const cat = await prisma.productCategory.upsert({
        where: { tenantId_name: { tenantId: opts.tenantId, name: row.categoryAfter } },
        update: {},
        create: { tenantId: opts.tenantId, name: row.categoryAfter },
      })
      categoryId = cat.id
    }

    // Find or create SystemProduct + SystemSku (scoped to merchant)
    let sku = await prisma.systemSku.findFirst({
      where: {
        skuCode: row.skuCode,
        systemProduct: { tenantId: opts.tenantId, ownerUserId: session.ownerUserId },
      },
      include: { systemProduct: true },
    })
    if (!sku) {
      const product = await prisma.systemProduct.create({
        data: {
          tenantId: opts.tenantId,
          ownerUserId: session.ownerUserId,
          spuCode: row.skuCode,
          name: row.productName ?? row.skuCode,
          categoryId,
        },
      })
      sku = await prisma.systemSku.create({
        data: {
          systemProductId: product.id,
          skuCode: row.skuCode,
          attributes: {},
          costPrice: new Prisma.Decimal(0),
        },
        include: { systemProduct: true },
      })
    } else {
      // Update name/category on existing product if caller provided them
      const updates: Prisma.SystemProductUpdateInput = {}
      if (row.productName && row.productName !== sku.systemProduct.name) updates.name = row.productName
      if (categoryId !== sku.systemProduct.categoryId) updates.category = categoryId ? { connect: { id: categoryId } } : { disconnect: true }
      if (Object.keys(updates).length > 0) {
        await prisma.systemProduct.update({ where: { id: sku.systemProductId }, data: updates })
      }
    }

    // Find or create WarehouseSku
    let wsku = await prisma.warehouseSku.findUnique({
      where: { systemSkuId_warehouseId: { systemSkuId: sku.id, warehouseId: row.warehouseId } },
    })
    if (!wsku) {
      wsku = await prisma.warehouseSku.create({
        data: {
          systemSkuId: sku.id,
          warehouseId: row.warehouseId,
          ownerUserId: session.ownerUserId,
        },
      })
    }

    const delta = row.delta ?? 0
    if (delta === 0 && session.mode === 'absolute') {
      // No change — skip event (absolute mode tolerates matches)
      applied++
      continue
    }

    await createInventoryEvent({
      tenantId: opts.tenantId,
      warehouseSkuId: wsku.id,
      warehouseId: row.warehouseId,
      eventType: (row.eventType ?? 'ADJUSTMENT') as InventoryEventType,
      quantityDelta: delta,
      reason: (row.reason as AdjustmentReason | undefined) ?? (session.mode === 'absolute' ? 'STOCKTAKE_CORRECTION' : undefined),
      notes: row.notes ?? (session.mode === 'absolute' ? 'Import (absolute)' : 'Import (delta)'),
      referenceType: session.mode === 'absolute' ? 'import_absolute' : 'import_delta',
      createdBy: opts.userId,
    })
    applied++
  }

  previewCache.delete(opts.token)
  return { applied, skipped }
}
