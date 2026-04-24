import { Table, Input, Select, Button, Space, DatePicker } from 'antd'
import { ArrowLeftOutlined, InboxOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { Dayjs } from 'dayjs'

const REASONS = ['STOCKTAKE_CORRECTION', 'DAMAGE', 'LOSS', 'EXPIRY', 'FOUND', 'SYSTEM_ERROR', 'OTHER'] as const

type HistoryRow = {
  id: string
  createdAt: string
  createdBy: string | null
  createdByName: string | null
  warehouseId: string
  warehouseName: string
  warehouseSkuId: string
  skuCode: string
  productName: string
  categoryName: string | null
  eventType: string
  quantityDelta: number
  reason: string | null
  notes: string | null
}

export default function HistoryPage() {
  const { t } = useTranslation()
  const [warehouseId, setWarehouseId] = useState<string | undefined>()
  const [categoryId, setCategoryId] = useState<string | undefined>()
  const [reason, setReason] = useState<string | undefined>()
  const [skuSearch, setSkuSearch] = useState('')
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [page, setPage] = useState(1)
  const pageSize = 50

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouses').then((r) => r.data.data),
  })
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get('/categories').then((r) => r.data.data),
  })

  const from = dateRange?.[0]?.startOf('day').toISOString()
  const to = dateRange?.[1]?.endOf('day').toISOString()

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-history', { warehouseId, categoryId, reason, skuSearch, from, to, page }],
    queryFn: () =>
      api
        .get('/inventory/history', {
          params: {
            warehouseId: warehouseId || undefined,
            categoryId: categoryId || undefined,
            reason: reason || undefined,
            skuSearch: skuSearch.trim() || undefined,
            from,
            to,
            page,
            pageSize,
          },
        })
        .then((r) => r.data.data as { items: HistoryRow[]; total: number; page: number; pageSize: number }),
  })

  const warehouseOptions = (Array.isArray(warehouses) ? warehouses : []).map((w: any) => ({ value: w.id, label: w.name }))
  const categoryOptions = (Array.isArray(categories) ? categories : []).map((c: any) => ({ value: c.id, label: c.name }))

  const columns: ColumnsType<HistoryRow> = [
    {
      title: t('inventory.date'),
      dataIndex: 'createdAt',
      width: 150,
      render: (v) => <span style={{ fontSize: 13 }}>{dayjs(v).format('YYYY-MM-DD HH:mm')}</span>,
    },
    {
      title: t('inventory.user'),
      dataIndex: 'createdByName',
      width: 120,
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: t('inventory.warehouse'),
      dataIndex: 'warehouseName',
      width: 120,
    },
    {
      title: t('inventory.sku'),
      dataIndex: 'skuCode',
      render: (v) => <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12 }}>{v}</span>,
    },
    {
      title: t('inventory.productName'),
      dataIndex: 'productName',
      ellipsis: true,
    },
    {
      title: t('inventory.category'),
      dataIndex: 'categoryName',
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Δ',
      dataIndex: 'quantityDelta',
      align: 'right',
      width: 80,
      render: (v) => (
        <span style={{ color: v > 0 ? '#10B981' : '#EF4444', fontWeight: 600 }}>
          {v > 0 ? `+${v}` : v}
        </span>
      ),
    },
    {
      title: t('inventory.reason'),
      dataIndex: 'reason',
      width: 140,
      render: (v) =>
        v ? (
          <span style={{ fontSize: 12 }}>{t(`inventory.reason_${v}`)}</span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        ),
    },
    {
      title: t('inventory.notes'),
      dataIndex: 'notes',
      ellipsis: true,
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <Space align="center" size={12}>
            <Link to="/inventory">
              <Button icon={<ArrowLeftOutlined />} type="text" />
            </Link>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{t('inventory.historyTitle')}</h1>
              <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>{t('inventory.historySubtitle')}</p>
            </div>
          </Space>
        </div>
      </div>

      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          padding: '16px 20px',
          marginBottom: 16,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <Select
          allowClear
          placeholder={t('inventory.allWarehouses')}
          value={warehouseId}
          style={{ width: 180 }}
          onChange={(v) => { setWarehouseId(v); setPage(1) }}
          options={warehouseOptions}
        />
        <Select
          allowClear
          placeholder={t('inventory.allCategories')}
          value={categoryId}
          style={{ width: 180 }}
          onChange={(v) => { setCategoryId(v); setPage(1) }}
          options={categoryOptions}
        />
        <Select
          allowClear
          placeholder={t('inventory.allReasons')}
          value={reason}
          style={{ width: 200 }}
          onChange={(v) => { setReason(v); setPage(1) }}
          options={REASONS.map((r) => ({ value: r, label: t(`inventory.reason_${r}`) }))}
        />
        <Input.Search
          placeholder={t('inventory.skuSearchPlaceholder')}
          allowClear
          onSearch={(v) => { setSkuSearch(v); setPage(1) }}
          style={{ width: 220 }}
        />
        <DatePicker.RangePicker
          value={dateRange as any}
          onChange={(v) => { setDateRange(v as [Dayjs | null, Dayjs | null]); setPage(1) }}
        />
      </div>

      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <Table<HistoryRow>
          rowKey="id"
          columns={columns}
          dataSource={data?.items ?? []}
          loading={isLoading}
          size="middle"
          scroll={{ x: 1100 }}
          pagination={{
            current: data?.page ?? page,
            pageSize: data?.pageSize ?? pageSize,
            total: data?.total ?? 0,
            showSizeChanger: false,
            showTotal: (total) => t('common.records', { count: total }),
            onChange: (p) => setPage(p),
            style: { padding: '12px 20px' },
          }}
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
    </div>
  )
}
