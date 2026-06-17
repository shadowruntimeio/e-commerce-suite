import { Table, Input, InputNumber, Button, Space, Upload, message, Tag } from 'antd'
import { SearchOutlined, UploadOutlined, DownloadOutlined, DollarOutlined } from '@ant-design/icons'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ColumnsType } from 'antd/es/table'

interface CostRow {
  skuCode: string
  productName: string | null
  cost: number | null
  note: string | null
  updatedAt: string | null
}

export default function CostManagementPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['costs', applied, missingOnly],
    queryFn: () =>
      api.get('/costs', { params: { search: applied || undefined, missingOnly: missingOnly || undefined } })
        .then((r) => r.data.data as { items: CostRow[]; total: number; withCost: number; missing: number }),
    placeholderData: keepPreviousData,
  })

  const save = useMutation({
    mutationFn: (v: { skuCode: string; cost: number }) => api.put('/costs', v).then((r) => r.data),
    onSuccess: () => { message.success(t('cost.saved')); qc.invalidateQueries({ queryKey: ['costs'] }) },
    onError: () => message.error(t('cost.saveFailed')),
  })

  const importMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.post('/costs/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
    },
    onSuccess: (res) => {
      const applied = res?.data?.applied ?? 0
      const errs = res?.data?.errors ?? []
      message.success(t('cost.imported', { count: applied }))
      if (errs.length) message.warning(errs.slice(0, 3).join('; '))
      qc.invalidateQueries({ queryKey: ['costs'] })
      qc.invalidateQueries({ queryKey: ['reports-profit-orders'] })
    },
    onError: () => message.error(t('cost.importFailed')),
  })

  const downloadTemplate = async () => {
    const res = await api.get('/costs/template', { responseType: 'blob' })
    const url = URL.createObjectURL(res.data as Blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'sku-cost-template.xlsx'; a.click()
    URL.revokeObjectURL(url)
  }

  const rows = data?.items ?? []

  const columns: ColumnsType<CostRow> = [
    {
      title: t('cost.skuCode'), dataIndex: 'skuCode', width: 200,
      render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)' }}>{v}</span>,
    },
    {
      title: t('cost.product'), dataIndex: 'productName', ellipsis: true,
      render: (v: string | null) => <span style={{ color: 'var(--text-secondary)' }}>{v || '—'}</span>,
    },
    {
      title: t('cost.cost'), dataIndex: 'cost', width: 200, align: 'right',
      render: (v: number | null, r: CostRow) => (
        <InputNumber
          defaultValue={v ?? undefined}
          min={0}
          precision={2}
          placeholder={t('cost.notSet')}
          prefix="₱"
          style={{ width: 150 }}
          status={v === null ? 'warning' : undefined}
          onBlur={(e) => {
            const raw = (e.target as HTMLInputElement).value.replace(/[^0-9.]/g, '')
            const num = Number(raw)
            if (raw !== '' && isFinite(num) && num !== (v ?? NaN)) save.mutate({ skuCode: r.skuCode, cost: num })
          }}
          onPressEnter={(e) => {
            const raw = (e.target as HTMLInputElement).value.replace(/[^0-9.]/g, '')
            const num = Number(raw)
            if (raw !== '' && isFinite(num)) save.mutate({ skuCode: r.skuCode, cost: num })
          }}
        />
      ),
    },
    {
      title: t('cost.status'), width: 110, align: 'center',
      render: (_: unknown, r: CostRow) => r.cost === null
        ? <Tag color="warning">{t('cost.missing')}</Tag>
        : <Tag color="success">{t('cost.set')}</Tag>,
    },
  ]

  return (
    <div>
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, marginBottom: 16 }}>
        <Space wrap size={12}>
          <Input
            placeholder={t('cost.searchPlaceholder')}
            style={{ width: 240 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={() => setApplied(search.trim())}
            allowClear
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={() => setApplied(search.trim())}>{t('common.search')}</Button>
          <Button type={missingOnly ? 'primary' : 'default'} onClick={() => setMissingOnly((v) => !v)}>{t('cost.onlyMissing')}</Button>
          <span style={{ flex: 1 }} />
          <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>{t('cost.template')}</Button>
          <Upload
            accept=".xlsx"
            showUploadList={false}
            beforeUpload={(file) => { importMut.mutate(file as File); return false }}
          >
            <Button icon={<UploadOutlined />} loading={importMut.isPending}>{t('cost.import')}</Button>
          </Upload>
        </Space>
      </div>

      {data && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, color: 'var(--text-secondary)', fontSize: 13 }}>
          <span><DollarOutlined /> {t('cost.summary', { withCost: data.withCost, total: data.total })}</span>
          {data.missing > 0 && <span style={{ color: 'var(--badge-warning-fg)' }}>{t('cost.missingCount', { count: data.missing })}</span>}
        </div>
      )}

      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)' }}>
        <Table<CostRow>
          rowKey="skuCode"
          columns={columns}
          dataSource={rows}
          size="middle"
          loading={isLoading || isFetching}
          sticky={{ offsetHeader: 64 }}
          pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 200], showTotal: (tot) => t('cost.totalRecords', { count: tot }), style: { padding: '12px 20px' } }}
        />
      </div>
    </div>
  )
}
