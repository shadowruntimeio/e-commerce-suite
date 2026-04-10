import { Table, Input, Select, Space, DatePicker, Button } from 'antd'
import {
  SyncOutlined, DownloadOutlined, EyeOutlined, ShoppingCartOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'

// ─── Helpers ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const map: Record<string, { bg: string; color: string; label: string }> = {
    PENDING:     { bg: 'var(--badge-warning-bg)',  color: 'var(--badge-warning-fg)',  label: t('orders.pending') },
    TO_SHIP:     { bg: 'var(--badge-info-bg)',     color: 'var(--badge-info-fg)',     label: t('orders.toShip') },
    SHIPPED:     { bg: 'var(--badge-success-bg)',  color: 'var(--badge-success-fg)',  label: t('orders.shipped') },
    COMPLETED:   { bg: 'var(--badge-success-bg)',  color: 'var(--badge-success-fg)',  label: t('orders.completed') },
    CANCELLED:   { bg: 'var(--badge-neutral-bg)',  color: 'var(--badge-neutral-fg)',  label: t('orders.cancelled') },
    AFTER_SALES: { bg: 'var(--badge-purple-bg)',   color: 'var(--badge-purple-fg)',   label: t('orders.afterSales') },
    UNPAID:      { bg: 'var(--badge-error-bg)',    color: 'var(--badge-error-fg)',    label: t('orders.unpaid') },
  }
  const s = map[status] ?? { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', label: status }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

function PlatformBadge({ platform }: { platform: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    SHOPEE: { bg: '#FF6633', color: '#fff' },
    TIKTOK: { bg: '#0F172A', color: '#fff' },
    LAZADA: { bg: '#0F146D', color: '#fff' },
    MANUAL: { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)' },
  }
  const s = map[platform] ?? { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)' }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: '0.03em' }}>
      {platform}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OrdersPage() {
  const { t } = useTranslation()
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const statusTabs = [
    { key: '', label: t('orders.all') },
    { key: 'UNPAID', label: t('orders.unpaid') },
    { key: 'PENDING', label: t('orders.pending') },
    { key: 'TO_SHIP', label: t('orders.toShip') },
    { key: 'SHIPPED', label: t('orders.shipped') },
    { key: 'COMPLETED', label: t('orders.completed') },
    { key: 'CANCELLED', label: t('orders.cancelled') },
  ]

  const { data, isLoading } = useQuery({
    queryKey: ['orders', { status, search, page }],
    queryFn: () =>
      api.get('/orders', {
        params: { status: status || undefined, search: search || undefined, page, pageSize: 20 },
      }).then((r) => r.data.data),
  })

  const columns: ColumnsType<any> = [
    {
      title: t('orders.orderId'),
      dataIndex: 'platformOrderId',
      width: 160,
      render: (v) => (
        <span style={{ fontFamily: "'Courier New', monospace", color: 'var(--mono-color)', fontSize: 13 }}>{v}</span>
      ),
    },
    {
      title: t('orders.platform'),
      dataIndex: ['shop', 'platform'],
      width: 100,
      render: (v) => v ? <PlatformBadge platform={v} /> : '—',
    },
    { title: t('orders.shop'), dataIndex: ['shop', 'name'], width: 120, ellipsis: true },
    { title: t('orders.buyer'), dataIndex: 'buyerName', width: 140, ellipsis: true },
    {
      title: t('orders.items'),
      dataIndex: 'items',
      width: 60,
      align: 'center',
      render: (items) => (
        <span style={{ background: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', borderRadius: 20, padding: '2px 8px', fontSize: 12, fontWeight: 500 }}>
          {items?.length ?? 0}
        </span>
      ),
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 120,
      render: (s) => <StatusBadge status={s} />,
    },
    {
      title: t('orders.revenue'),
      dataIndex: 'totalRevenue',
      width: 120,
      align: 'right',
      render: (v) => (
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>${Number(v).toFixed(2)}</span>
      ),
    },
    {
      title: t('orders.date'),
      dataIndex: 'createdAt',
      width: 140,
      render: (v) => dayjs(v).format('MMM D, HH:mm'),
    },
    {
      title: '',
      key: 'actions',
      width: 48,
      render: () => (
        <Button type="text" size="small" icon={<EyeOutlined />} style={{ color: 'var(--text-secondary)' }} />
      ),
    },
  ]

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{t('orders.title')}</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>{t('orders.subtitle')}</p>
          </div>
          <Space>
            <Button
              icon={<SyncOutlined />}
              style={{ background: 'var(--accent-gradient)', color: '#fff', border: 'none', borderRadius: 8, height: 36, fontWeight: 600, fontSize: 14, boxShadow: '0 0 16px rgba(204,151,255,0.3)' }}
            >
              {t('common.syncNow')}
            </Button>
          </Space>
        </div>
      </div>

      {/* Status Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {statusTabs.map((tab) => {
          const isActive = status === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => { setStatus(tab.key); setPage(1) }}
              style={{
                background: isActive ? 'var(--tab-active-bg)' : 'var(--bg-surface)',
                color: isActive ? 'var(--tab-active-fg)' : 'var(--text-secondary)',
                border: isActive ? 'var(--tab-active-border)' : '1px solid var(--border)',
                borderRadius: 20,
                padding: '5px 14px',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Filter Bar */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Input.Search
          placeholder={t('orders.searchPlaceholder')}
          allowClear
          onSearch={(v) => { setSearch(v); setPage(1) }}
          style={{ width: 260 }}
        />
        <Select
          allowClear
          placeholder={t('orders.allShops')}
          style={{ width: 180 }}
        />
        <DatePicker.RangePicker style={{ borderRadius: 8 }} />
        <div style={{ marginLeft: 'auto' }}>
          <Button
            icon={<DownloadOutlined />}
            style={{ background: 'var(--header-btn-bg)', color: 'var(--header-btn-color)', border: 'var(--header-btn-border)', borderRadius: 8, height: 36, fontWeight: 500, fontSize: 14 }}
          >
            {t('common.export')}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data?.items ?? []}
          loading={isLoading}
          size="middle"
          style={{ borderRadius: 0 }}
          onRow={() => ({ style: { cursor: 'pointer' } })}
          rowHoverable
          pagination={{
            current: page,
            pageSize: 20,
            total: data?.total ?? 0,
            onChange: (p) => setPage(p),
            showSizeChanger: false,
            showTotal: (total) => t('common.records', { count: total }),
            style: { padding: '12px 20px' },
          }}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: (
              <div style={{ padding: '48px 0', color: 'var(--text-muted)', textAlign: 'center' }}>
                <ShoppingCartOutlined style={{ fontSize: 40, marginBottom: 12, display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>{t('orders.noOrders')}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{t('orders.noOrdersHint')}</div>
              </div>
            ),
          }}
        />
      </div>
    </div>
  )
}
