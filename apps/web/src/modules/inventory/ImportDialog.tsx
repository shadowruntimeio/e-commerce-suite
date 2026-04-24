import { Modal, Radio, Upload, Button, message, Table, Alert, Space, Tag } from 'antd'
import { InboxOutlined, DownloadOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnsType } from 'antd/es/table'
import { api } from '../../lib/api'

type Mode = 'absolute' | 'delta'
type Step = 'select' | 'preview'

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
  mode: Mode
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
  const [step, setStep] = useState<Step>('select')
  const [mode, setMode] = useState<Mode>('absolute')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)

  function reset() {
    setStep('select')
    setFile(null)
    setPreview(null)
    setUploading(false)
    setApplying(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function downloadTemplate() {
    try {
      const res = await api.get('/inventory/import-template', {
        params: { mode },
        responseType: 'blob',
      })
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `inventory-${mode}-template.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      void message.error(t('inventory.templateDownloadFailed'))
    }
  }

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('mode', mode)
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
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
              {t('inventory.importMode')}
            </label>
            <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
              <Space direction="vertical">
                <Radio value="absolute">
                  <div style={{ fontWeight: 500 }}>{t('inventory.modeAbsoluteTitle')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {t('inventory.modeAbsoluteDesc')}
                  </div>
                </Radio>
                <Radio value="delta">
                  <div style={{ fontWeight: 500 }}>{t('inventory.modeDeltaTitle')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {t('inventory.modeDeltaDesc')}
                  </div>
                </Radio>
              </Space>
            </Radio.Group>
          </div>

          <div>
            <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
              {t('inventory.downloadTemplate')}
            </Button>
            <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
              {t('inventory.templateHint')}
            </span>
          </div>

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
            <Button type="primary" disabled={!file} loading={uploading} onClick={handleUpload}>
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
              <Button
                type="primary"
                loading={applying}
                disabled={preview.validRows === 0}
                onClick={handleApply}
              >
                {t('inventory.applyBtn', { count: preview.validRows })}
              </Button>
            </Space>
          </div>
        </div>
      )}
    </Modal>
  )
}
