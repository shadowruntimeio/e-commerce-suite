import { Table, Input, Select, Button, Space, message, Modal } from 'antd'
import { InboxOutlined, UploadOutlined, DownloadOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'

// ─── Event type color map ────────────────────────────────────────────────────

const EVENT_TYPE_MAP: Record<string, { bg: string; color: string; labelKey: string }> = {
  INBOUND:       { bg: 'var(--badge-success-bg)', color: 'var(--badge-success-fg)', labelKey: 'inventory.inbound' },
  OUTBOUND:      { bg: 'var(--badge-error-bg)',   color: 'var(--badge-error-fg)',   labelKey: 'inventory.outbound' },
  ADJUSTMENT:    { bg: 'var(--badge-warning-bg)', color: 'var(--badge-warning-fg)', labelKey: 'inventory.adjustment' },
  RESERVED:      { bg: 'var(--badge-info-bg)',    color: 'var(--badge-info-fg)',    labelKey: 'inventory.reserved' },
  UNRESERVED:    { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', labelKey: 'inventory.unreserved' },
  TRANSFER_IN:   { bg: 'var(--badge-info-bg)',    color: 'var(--badge-info-fg)',    labelKey: 'inventory.transferIn' },
  TRANSFER_OUT:  { bg: 'var(--badge-purple-bg)',  color: 'var(--badge-purple-fg)',  labelKey: 'inventory.transferOut' },
  RETURN:        { bg: 'var(--badge-warning-bg)', color: 'var(--badge-warning-fg)', labelKey: 'inventory.return' },
}

function EventTypeBadge({ type }: { type: string }) {
  const { t } = useTranslation()
  const s = EVENT_TYPE_MAP[type] ?? { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', labelKey: type }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {t(s.labelKey)}
    </span>
  )
}

// ─── CSV template ────────────────────────────────────────────────────────────

const CSV_TEMPLATE = `sku_code,event_type,quantity,notes
SKU-001,INBOUND,100,Initial stock
SKU-002,INBOUND,50,Supplier delivery
SKU-001,OUTBOUND,10,Order fulfillment`

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'inventory-import-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InventoryPage() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [eventType, setEventType] = useState<string | undefined>()
  const [uploading, setUploading] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; errors: string[]; totalRows: number } | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [selectedWarehouse, setSelectedWarehouse] = useState<string | undefined>()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-events', { search, eventType }],
    queryFn: () =>
      api.get('/inventory/events', { params: { limit: 50, eventType: eventType || undefined } }).then((r) => r.data.data),
  })

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouses').then((r) => r.data.data),
  })

  const warehouseOptions = (Array.isArray(warehouses) ? warehouses : []).map((w: any) => ({
    value: w.id,
    label: w.name,
  }))

  const filtered = (data ?? []).filter((row: any) => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      (row.warehouseSkuId ?? '').toLowerCase().includes(s) ||
      (row.referenceType ?? '').toLowerCase().includes(s) ||
      (row.notes ?? '').toLowerCase().includes(s)
    )
  })

  function handleFileSelect(file: File) {
    setSelectedFile(file)
    setShowImportModal(true)
  }

  async function handleImport() {
    if (!selectedFile || !selectedWarehouse) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('warehouseId', selectedWarehouse)
      const res = await api.post('/inventory/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const result = res.data.data
      setShowImportModal(false)
      setSelectedFile(null)
      setSelectedWarehouse(undefined)
      setImportResult(result)
      if (result.imported > 0) {
        void message.success(t('inventory.importSuccess', { count: result.imported }))
        queryClient.invalidateQueries({ queryKey: ['inventory-events'] })
      }
      if (result.errors.length > 0) {
        void message.warning(t('inventory.importRowErrors', { count: result.errors.length }))
      }
    } catch (err: any) {
      void message.error(err?.response?.data?.error ?? t('inventory.importFailed'))
    } finally {
      setUploading(false)
    }
  }

  const columns: ColumnsType<any> = [
    {
      title: t('inventory.eventType'),
      dataIndex: 'eventType',
      render: (v) => <EventTypeBadge type={v} />,
    },
    {
      title: t('inventory.sku'),
      dataIndex: 'warehouseSkuId',
      render: (v) => (
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: 'var(--mono-color)' }}>{v}</span>
      ),
    },
    {
      title: t('inventory.warehouse'),
      dataIndex: ['warehouseSku', 'warehouse', 'name'],
      render: (v) => v ? (
        <span style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 6, fontSize: 12, border: '1px solid var(--border-light)' }}>
          {v}
        </span>
      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: t('inventory.quantity'),
      dataIndex: 'quantityDelta',
      align: 'right',
      render: (v) => (
        <span style={{ color: v > 0 ? '#10B981' : '#EF4444', fontWeight: 600, fontSize: 14 }}>
          {v > 0 ? `+${v}` : v}
        </span>
      ),
    },
    {
      title: t('inventory.reference'),
      dataIndex: 'referenceType',
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: t('inventory.notes'),
      dataIndex: 'notes',
      ellipsis: true,
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: t('inventory.date'),
      dataIndex: 'createdAt',
      render: (v) => (
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{dayjs(v).format('MMM D, HH:mm')}</span>
      ),
    },
  ]

  return (
    <div>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{t('inventory.title')}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>{t('inventory.subtitle')}</p>
        </div>
        <Space>
          <Button icon={<DownloadOutlined />} onClick={downloadTemplate} style={{ borderRadius: 8, height: 36, fontWeight: 500 }}>
            {t('inventory.downloadTemplate')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFileSelect(file)
              e.target.value = ''
            }}
          />
          <Button
            type="primary"
            icon={<UploadOutlined />}
            onClick={() => fileInputRef.current?.click()}
            style={{ background: 'var(--accent-gradient)', border: 'none', borderRadius: 8, height: 36, fontWeight: 500 }}
          >
            {t('inventory.importCsv')}
          </Button>
        </Space>
      </div>

      {/* Filter Bar */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Input.Search placeholder={t('inventory.searchPlaceholder')} allowClear onSearch={setSearch} style={{ width: 280 }} />
        <Select
          allowClear
          placeholder={t('inventory.allEventTypes')}
          style={{ width: 180 }}
          onChange={setEventType}
          options={Object.entries(EVENT_TYPE_MAP).map(([k, v]) => ({ value: k, label: t(v.labelKey) }))}
        />
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={isLoading}
          size="middle"
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => t('common.records', { count: total }), style: { padding: '12px 20px' } }}
          locale={{
            emptyText: (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <InboxOutlined style={{ fontSize: 40, color: 'var(--text-muted)', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>{t('inventory.noEvents')}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{t('inventory.noEventsHint')}</div>
              </div>
            ),
          }}
        />
      </div>

      {/* Import modal — select warehouse before uploading */}
      <Modal
        open={showImportModal}
        title={t('inventory.importTitle')}
        onCancel={() => { setShowImportModal(false); setSelectedFile(null); setSelectedWarehouse(undefined) }}
        onOk={handleImport}
        okText={t('common.import')}
        okButtonProps={{ disabled: !selectedWarehouse, loading: uploading }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{t('common.file')}</label>
            <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{selectedFile?.name}</div>
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{t('inventory.targetWarehouse')} *</label>
            <Select
              value={selectedWarehouse}
              onChange={setSelectedWarehouse}
              placeholder={t('inventory.selectWarehouse')}
              style={{ width: '100%' }}
              options={warehouseOptions}
              notFoundContent={<span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('inventory.noWarehousesHint')}</span>}
            />
          </div>
        </div>
      </Modal>

      {/* Import result modal */}
      <Modal
        open={!!importResult}
        title={t('inventory.importResult')}
        onCancel={() => setImportResult(null)}
        onOk={() => setImportResult(null)}
        okText={t('common.ok')}
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        {importResult && (
          <div>
            <p>{t('inventory.importedOf', { imported: importResult.imported, total: importResult.totalRows })}</p>
            {importResult.errors.length > 0 && (
              <div>
                <p style={{ color: '#EF4444', fontWeight: 600 }}>{t('inventory.errors', { count: importResult.errors.length })}</p>
                <div style={{ maxHeight: 200, overflow: 'auto', background: 'var(--bg-surface)', borderRadius: 8, padding: 12, fontSize: 12 }}>
                  {importResult.errors.map((e, i) => (
                    <div key={i} style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>{e}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
