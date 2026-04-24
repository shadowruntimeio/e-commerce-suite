// One-off generator for a test stock-import xlsx. Pulls all distinct sellerSku
// values from order_items, sets quantity=100 for each against the single
// existing warehouse, and writes a file that matches the "absolute" import mode
// template (warehouse_name, sku_code, product_name, category, counted_quantity,
// reason, notes).

import ExcelJS from 'exceljs'
import { prisma } from '@ems/db'
import { resolve } from 'path'

async function main() {
  const warehouse = await prisma.warehouse.findFirst({ where: { isActive: true } })
  if (!warehouse) throw new Error('No warehouse found')

  // Distinct sellerSku with one representative productName/skuName per SKU.
  const items = await prisma.orderItem.findMany({
    where: { sellerSku: { not: null } },
    select: { sellerSku: true, productName: true, skuName: true },
  })
  const bySku = new Map<string, { productName: string; skuName: string | null }>()
  for (const it of items) {
    if (!it.sellerSku) continue
    if (!bySku.has(it.sellerSku)) {
      bySku.set(it.sellerSku, { productName: it.productName, skuName: it.skuName })
    }
  }

  const rows = [...bySku.entries()].sort(([a], [b]) => a.localeCompare(b))
  console.log(`Warehouse: ${warehouse.name} (${warehouse.id})`)
  console.log(`Distinct sellerSku count: ${rows.length}`)

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'EMS'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Stocktake')
  sheet.addRow(['warehouse_name', 'sku_code', 'product_name', 'category', 'counted_quantity', 'reason', 'notes'])
  sheet.getRow(1).font = { bold: true }
  sheet.columns.forEach((c) => { c.width = 22 })
  sheet.getColumn(3).width = 60 // product_name

  for (const [sku, info] of rows) {
    // Trim extremely long Malay product descriptions so the xlsx stays readable;
    // the importer will overwrite the product name on existing products anyway.
    const productName = info.productName.length > 100 ? `${info.productName.slice(0, 97)}...` : info.productName
    sheet.addRow([
      warehouse.name,
      sku,
      productName,
      '',            // category — leave blank (allowed)
      100,           // counted_quantity
      'STOCKTAKE_CORRECTION',
      info.skuName ?? '',
    ])
  }

  const outPath = resolve(process.cwd(), 'stock-test-import.xlsx')
  await workbook.xlsx.writeFile(outPath)
  console.log(`Wrote ${outPath}`)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
