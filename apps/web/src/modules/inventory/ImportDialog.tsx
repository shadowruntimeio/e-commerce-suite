import { Modal, Upload, Button, message, Table, Alert, Space, Tag, DatePicker, Input, Select } from 'antd'
import { InboxOutlined, DownloadOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnsType } from 'antd/es/table'
import { api } from '../../lib/api'
import { useAuthStore, isMerchant } from '../../store/auth.store'
import dayjs, { type Dayjs } from 'dayjs'

// Merchant submission has an extra step between preview and "done":
//   select → preview → ship (carrier / tracking / shipped-at) → submit
// Admin / warehouse staff still go: select → preview → apply
type Step = 'select' | 'preview' | 'ship'

// Only one import mode is exposed in the UI: delta (+/- adjustment). Absolute
// "stocktake" mode is still wired on the backend but hidden — it's destructive
// to invariants if a buyer ships during the upload window.
const MODE = 'delta'

type PreviewRow = {
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
  reason?: string | null
  eventType?: string | null
  notes?: string | null
  error?: string
}

type PreviewResult = {
  mode: 'absolute' | 'delta'
  totalRows: number
  validRows: number
  errorRows: number
  rows: PreviewRow[]
  token: string
  expiresAt: string
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const merchant = isMerchant(user)
  const [step, setStep] = useState<Step>('select')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [applying, setApplying] = useState(false)
  // Non-merchant uploaders (warehouse / admin) must pick the merchant that
  // owns the imported stock — backend requires it. Merchants skip this; the
  // backend force-binds to their own userId.
  const [ownerUserId, setOwnerUserId] = useState<string | undefined>(undefined)
  // Merchant ship-info form state
  const [shippedAt, setShippedAt] = useState<Dayjs | null>(null)
  const [carrier, setCarrier] = useState('')
  const [trackingNumber, setTrackingNumber] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)

  const { data: merchants } = useQuery({
    enabled: !merchant && open,
    queryKey: ['merchants-for-import'],
    queryFn: async () =>
      (await api.get('/admin/users', { params: { role: 'MERCHANT' } })).data.data as Array<{
        id: string; name: string; email: string
      }>,
  })

  // Single-merchant tenants are the common case today — skip the click.
  useEffect(() => {
    if (!merchant && merchants?.length === 1 && !ownerUserId) {
      setOwnerUserId(merchants[0].id)
    }
  }, [merchant, merchants, ownerUserId])

  function reset() {
    setStep('select')
    setFile(null)
    setPreview(null)
    setUploading(false)
    setApplying(false)
    setOwnerUserId(undefined)
    setShippedAt(null)
    setCarrier('')
    setTrackingNumber('')
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function downloadTemplate() {
    try {
      const res = await api.get('/inventory/import-template', {
        params: { mode: MODE },
        responseType: 'blob',
      })
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `inventory-${MODE}-template.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      void message.error(t('inventory.templateDownloadFailed'))
    }
  }

  async function handleUpload() {
    if (!file) return
    if (!merchant && !ownerUserId) {
      void message.error(t('inventory.merchantRequired'))
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('mode', MODE)
      if (!merchant && ownerUserId) fd.append('ownerUserId', ownerUserId)
      const res = await api.post('/inventory/import/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setPreview(res.data.data)
      setStep('preview')
    } catch (err: any) {
      void message.error(err?.response?.data?.error ?? t('inventory.previewFailed'))
    } finally {
      setUploading(false)
    }
  }

  // Warehouse / admin path: write inventory immediately.
  async function handleApply() {
    if (!preview) return
    setApplying(true)
    try {
      const res = await api.post('/inventory/import/apply', { token: preview.token })
      const { applied, skipped } = res.data.data
      void message.success(t('inventory.applySuccess', { applied, skipped }))
      queryClient.invalidateQueries({ queryKey: ['inventory-stock'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-history'] })
      handleClose()
    } catch (err: any) {
      void message.error(err?.response?.data?.error ?? t('inventory.applyFailed'))
    } finally {
      setApplying(false)
    }
  }

  // Merchant path: submit a shipment that lands in PENDING_REVIEW. Warehouse
  // staff confirms on arrival to actually update stock. Validates that all
  // preview rows target the same warehouse — otherwise the merchant must
  // split the import into one file per warehouse.
  function previewWarehouses(): Array<{ id: string; name: string }> {
    if (!preview) return []
    const seen = new Map<string, string>()
    for (const r of preview.rows) {
      if (r.warehouseId && !seen.has(r.warehouseId)) seen.set(r.warehouseId, r.warehouseName)
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }

  async function handleSubmitShipment() {
    if (!preview) return
    const whs = previewWarehouses()
    if (whs.length !== 1) {
      void message.error(t('inventory.shipmentSingleWarehouseRequired'))
      return
    }
    if (!shippedAt || !carrier.trim() || !trackingNumber.trim()) return
    const items = preview.rows
      .filter((r) => !r.error && r.skuCode && (r.delta ?? 0) > 0)
      .map((r) => ({
        skuCode: r.skuCode,
        productName: r.productName ?? undefined,
        expectedQuantity: r.delta ?? 0,
      }))
    if (items.length === 0) {
      void message.error(t('inventory.shipmentNoValidRows'))
      return
    }
    setApplying(true)
    try {
      await api.post('/inventory/inbound-shipments', {
        warehouseId: whs[0].id,
        shippedAt: shippedAt.toISOString(),
        carrier: carrier.trim(),
        trackingNumber: trackingNumber.trim(),
        items,
      })
      void message.success(t('inventory.shipmentSubmitted', { count: items.length }))
      queryClient.invalidateQueries({ queryKey: ['inbound-shipments'] })
      handleClose()
    } catch (err: any) {
      void message.error(err?.response?.data?.error ?? t('inventory.shipmentSubmitFailed'))
    } finally {
      setApplying(false)
    }
  }

  const columns: ColumnsType<PreviewRow> = [
    { title: '#', dataIndex: 'rowNumber', width: 56, align: 'center' },
    {
      title: t('inventory.warehouse'),
      dataIndex: 'warehouseName',
      render: (v, row) =>
        v ? (
          <span>{v}</span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        ),
    },
    {
      title: t('inventory.sku'),
      dataIndex: 'skuCode',
      render: (v, row) => (
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12 }}>
          {v || <span style={{ color: 'var(--text-muted)' }}>—</span>}
          {row.skuWillBeCreated && (
            <Tag color="blue" style={{ marginLeft: 6, fontSize: 10 }}>
              NEW
            </Tag>
          )}
        </span>
      ),
    },
    {
      title: t('inventory.productName'),
      dataIndex: 'productName',
      ellipsis: true,
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: t('inventory.category'),
      render: (_, row) => {
        if (!row.categoryAfter && !row.categoryBefore) return <span style={{ color: 'var(--text-muted)' }}>—</span>
        if (row.categoryBefore === row.categoryAfter) return row.categoryAfter
        return (
          <span style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{row.categoryBefore ?? '—'}</span>
            {' → '}
            <span style={{ color: '#10B981', fontWeight: 500 }}>{row.categoryAfter ?? '—'}</span>
          </span>
        )
      },
    },
    {
      title: t('inventory.before'),
      dataIndex: 'quantityBefore',
      align: 'right',
      width: 80,
      render: (v) => (v === null ? <span style={{ color: 'var(--text-muted)' }}>—</span> : v),
    },
    {
      title: t('inventory.after'),
      dataIndex: 'quantityAfter',
      align: 'right',
      width: 80,
      render: (v) => (v === null ? <span style={{ color: 'var(--text-muted)' }}>—</span> : <span style={{ fontWeight: 600 }}>{v}</span>),
    },
    {
      title: 'Δ',
      dataIndex: 'delta',
      align: 'right',
      width: 80,
      render: (v) => {
        if (v === null) return <span style={{ color: 'var(--text-muted)' }}>—</span>
        if (v === 0) return <span style={{ color: 'var(--text-muted)' }}>0</span>
        return (
          <span style={{ color: v > 0 ? '#10B981' : '#EF4444', fontWeight: 600 }}>
            {v > 0 ? `+${v}` : v}
          </span>
        )
      },
    },
    {
      title: t('common.status'),
      width: 120,
      render: (_, row) =>
        row.error ? (
          <Tag color="red" style={{ fontSize: 11 }}>
            {row.error}
          </Tag>
        ) : row.delta === 0 ? (
          <Tag color="default" style={{ fontSize: 11 }}>{t('inventory.noChange')}</Tag>
        ) : (
          <Tag color="green" style={{ fontSize: 11 }}>{t('inventory.willApply')}</Tag>
        ),
    },
  ]

  return (
    <Modal
      open={open}
      title={t('inventory.importTitle')}
      onCancel={handleClose}
      footer={null}
      width={step === 'preview' ? 1100 : 560}
      destroyOnClose
    >
      {step === 'select' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 12 }}>
          {/* Template download is the recommended first step — most users
              don't have the right column layout off the cuff. Highlight it
              with the accent gradient so it's the obvious next click. */}
          <div style={{
            background: 'rgba(204,151,255,0.08)',
            border: '1px solid rgba(204,151,255,0.4)',
            borderRadius: 10,
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={downloadTemplate}
              style={{ background: 'var(--accent-gradient)', border: 'none', fontWeight: 600 }}
            >
              {t('inventory.downloadTemplate')}
            </Button>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
              {t('inventory.templateHint')}
            </span>
          </div>

          {!merchant && (
            <div>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                {t('inventory.merchantLabel')} *
              </label>
              <Select
                showSearch
                placeholder={t('inventory.merchantPlaceholder')}
                style={{ width: '100%' }}
                value={ownerUserId}
                onChange={(v) => setOwnerUserId(v)}
                optionFilterProp="label"
                options={(merchants ?? []).map((m) => ({
                  value: m.id,
                  label: `${m.name} (${m.email})`,
                }))}
              />
            </div>
          )}

          <Upload.Dragger
            accept=".xlsx"
            beforeUpload={(f) => {
              setFile(f)
              return false
            }}
            maxCount={1}
            fileList={file ? [{ uid: '1', name: file.name, status: 'done' } as any] : []}
            onRemove={() => setFile(null)}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">{t('inventory.dropFileHint')}</p>
            <p className="ant-upload-hint" style={{ fontSize: 12 }}>
              {t('inventory.xlsxOnly')}
            </p>
          </Upload.Dragger>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={handleClose}>{t('common.cancel')}</Button>
            <Button
              type="primary"
              disabled={!file || (!merchant && !ownerUserId)}
              loading={uploading}
              onClick={handleUpload}
            >
              {t('inventory.previewBtn')}
            </Button>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <Alert
            type={preview.errorRows > 0 ? 'warning' : 'info'}
            showIcon
            message={t('inventory.previewSummary', {
              total: preview.totalRows,
              valid: preview.validRows,
              errors: preview.errorRows,
            })}
          />

          <Table<PreviewRow>
            rowKey="rowNumber"
            columns={columns}
            dataSource={preview.rows}
            size="small"
            scroll={{ y: 380, x: 1000 }}
            pagination={false}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button onClick={() => setStep('select')}>{t('inventory.backBtn')}</Button>
            <Space>
              <Button onClick={handleClose}>{t('common.cancel')}</Button>
              {merchant ? (
                <Button
                  type="primary"
                  disabled={preview.validRows === 0}
                  onClick={() => setStep('ship')}
                  style={{ background: 'var(--accent-gradient)', border: 'none' }}
                >
                  {t('inventory.nextShipBtn')}
                </Button>
              ) : (
                <Button
                  type="primary"
                  loading={applying}
                  disabled={preview.validRows === 0}
                  onClick={handleApply}
                >
                  {t('inventory.applyBtn', { count: preview.validRows })}
                </Button>
              )}
            </Space>
          </div>
        </div>
      )}

      {step === 'ship' && preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
          <Alert
            type="info"
            showIcon
            message={t('inventory.shipFormHint', { count: preview.validRows })}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                {t('inventory.shippedAtLabel')} *
              </label>
              <DatePicker
                value={shippedAt}
                onChange={(d) => setShippedAt(d)}
                style={{ width: '100%' }}
                placeholder={t('inventory.shippedAtPlaceholder')}
                disabledDate={(d) => !!d && d.isAfter(dayjs(), 'day')}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                {t('inventory.warehouseLabel')}
              </label>
              <Input
                value={previewWarehouses().map((w) => w.name).join(', ') || '—'}
                disabled
              />
            </div>
            <div>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                {t('inventory.carrierLabel')} *
              </label>
              <Input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder={t('inventory.carrierPlaceholder')}
                maxLength={60}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                {t('inventory.trackingLabel')} *
              </label>
              <Input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder={t('inventory.trackingPlaceholder')}
                maxLength={80}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button onClick={() => setStep('preview')}>{t('inventory.backBtn')}</Button>
            <Space>
              <Button onClick={handleClose}>{t('common.cancel')}</Button>
              <Button
                type="primary"
                loading={applying}
                disabled={!shippedAt || !carrier.trim() || !trackingNumber.trim()}
                onClick={handleSubmitShipment}
                style={{ background: 'var(--accent-gradient)', border: 'none' }}
              >
                {t('inventory.submitShipmentBtn')}
              </Button>
            </Space>
          </div>
        </div>
      )}
    </Modal>
  )
}
