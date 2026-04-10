import { Input, Button, Space, Table } from 'antd'
import {
  AppstoreOutlined, SyncOutlined, ShopOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'
import { message } from 'antd'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, { bg: string; color: string }> = {
  SHOPEE: { bg: '#FF6633', color: '#fff' },
  TIKTOK: { bg: '#0F172A', color: '#fff' },
  LAZADA: { bg: '#0F146D', color: '#fff' },
}

function PlatformBadge({ platform }: { platform: string }) {
  const s = PLATFORM_COLORS[platform] ?? { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)' }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
      {platform}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const map: Record<string, { bg: string; color: string; label: string }> = {
    ACTIVATE:   { bg: 'var(--badge-success-bg)', color: 'var(--badge-success-fg)', label: t('products.statusActive') },
    ACTIVE:     { bg: 'var(--badge-success-bg)', color: 'var(--badge-success-fg)', label: t('products.statusActive') },
    DEACTIVATE: { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', label: t('products.statusInactive') },
    DRAFT:      { bg: 'var(--badge-warning-bg)', color: 'var(--badge-warning-fg)', label: t('products.statusDraft') },
    DELETED:    { bg: 'var(--badge-error-bg)',   color: 'var(--badge-error-fg)',   label: t('products.statusDeleted') },
  }
  const s = map[status] ?? { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', label: status }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
      {s.label}
    </span>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['products', { search, page }],
    queryFn: () =>
      api.get('/products', { params: { search: search || undefined, page, pageSize } }).then((r) => r.data.data),
  })

  const syncMutation = useMutation({
    mutationFn: async () => {
      const shopsRes = await api.get('/shops')
      const shops = shopsRes.data.data ?? []
      await Promise.all(shops.map((s: any) => api.post(`/shops/${s.id}/sync`)))
    },
    onSuccess: () => {
      void message.success(t('products.syncQueued'))
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['products'] }), 3000)
    },
    onError: () => void message.error(t('products.syncFailed')),
  })

  const items: any[] = data?.items ?? []
  const total: number = data?.total ?? 0

  const columns: ColumnsType<any> = [
    {
      title: t('products.product'),
      dataIndex: 'title',
      render: (title, record) => {
        const imageUrl = (record.platformData as any)?.imageUrl
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={title}
                style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border-light)' }}
              />
            ) : (
              <div style={{
                width: 48, height: 48, borderRadius: 10, flexShrink: 0,
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)', fontSize: 20,
              }}>
                <AppstoreOutlined />
              </div>
            )}
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>
                ID: {record.platformItemId}
              </div>
            </div>
          </div>
        )
      },
    },
    {
      title: t('products.shop'),
      dataIndex: 'shop',
      render: (shop) => shop ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PlatformBadge platform={shop.platform} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
            {shop.name}
          </span>
        </div>
      ) : '—',
    },
    {
      title: t('products.skus'),
      dataIndex: 'onlineSkus',
      width: 70,
      align: 'center',
      render: (skus) => (
        <span style={{ background: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>
          {skus?.length ?? 0}
        </span>
      ),
    },
    {
      title: t('products.price'),
      dataIndex: 'onlineSkus',
      width: 100,
      align: 'right',
      render: (skus) => {
        if (!skus?.length) return <span style={{ color: 'var(--text-muted)' }}>—</span>
        const prices = skus.map((s: any) => Number(s.price)).filter((p: number) => p > 0)
        if (!prices.length) return <span style={{ color: 'var(--text-muted)' }}>—</span>
        const min = Math.min(...prices)
        const max = Math.max(...prices)
        return (
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {min === max ? `$${min.toFixed(2)}` : `$${min.toFixed(2)} – $${max.toFixed(2)}`}
          </span>
        )
      },
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (s) => <StatusBadge status={s} />,
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{t('products.title')}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>{t('products.subtitle')}</p>
        </div>
        <Space>
          <Button
            icon={<SyncOutlined spin={syncMutation.isPending} />}
            loading={syncMutation.isPending}
            onClick={() => syncMutation.mutate()}
            style={{ borderRadius: 8, height: 36, fontWeight: 500 }}
          >
            {t('products.syncProducts')}
          </Button>
        </Space>
      </div>

      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Input.Search
          placeholder={t('products.searchPlaceholder')}
          allowClear
          onSearch={(v) => { setSearch(v); setPage(1) }}
          style={{ width: 280 }}
        />
        <div style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-muted)' }}>
          {t('common.products', { count: total })}
        </div>
      </div>

      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={isLoading}
          size="middle"
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p) => setPage(p),
            showSizeChanger: false,
            showTotal: (tot) => t('common.products', { count: tot }),
            style: { padding: '12px 20px' },
          }}
          locale={{
            emptyText: (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <ShopOutlined style={{ fontSize: 40, color: 'var(--text-muted)', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>{t('products.noProducts')}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{t('products.noProductsHint')}</div>
              </div>
            ),
          }}
        />
      </div>
    </div>
  )
}
