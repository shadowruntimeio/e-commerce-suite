import { Input, Select, Button, Space, Checkbox } from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, AppstoreOutlined,
  DownloadOutlined, WarningOutlined, ReloadOutlined, WalletOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, accentColor, icon,
}: {
  label: string
  value: string
  sub: string
  accentColor: string
  icon: React.ReactNode
}) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: 12,
      padding: '20px 24px',
      position: 'relative',
      overflow: 'hidden',
      boxShadow: 'var(--card-shadow)',
      flex: 1,
    }}>
      {/* Left accent bar */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: 4, height: '100%', background: accentColor, borderRadius: '12px 0 0 12px' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>{value}</div>
        </div>
        <div style={{ fontSize: 22, color: accentColor, opacity: 0.25 }}>{icon}</div>
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>{sub}</div>
    </div>
  )
}

// ─── Stock dot indicator ──────────────────────────────────────────────────────

function StockStatus({ count }: { count: number }) {
  if (count === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#EF4444', fontSize: 12, fontWeight: 600 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF4444' }} />
      Out of Stock
    </div>
  )
  if (count < 20) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#F97316', fontSize: 12, fontWeight: 600 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F97316' }} />
      Low Stock ({count})
    </div>
  )
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#6366F1', fontSize: 12, fontWeight: 600 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366F1' }} />
      In Stock ({count})
    </div>
  )
}

// ─── Category pill ────────────────────────────────────────────────────────────

function CategoryPill({ name }: { name: string }) {
  return (
    <span style={{
      background: '#EEF2FF',
      color: '#4338CA',
      fontSize: 10,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      padding: '3px 8px',
      borderRadius: 20,
    }}>
      {name}
    </span>
  )
}

// ─── Product avatar placeholder ───────────────────────────────────────────────

const PRODUCT_ICONS: Record<string, string> = {
  'Electronics': '🎧',
  'Home & Living': '💡',
  default: '📦',
}

function ProductAvatar({ category, name }: { category?: string; name: string }) {
  const emoji = PRODUCT_ICONS[category ?? ''] ?? PRODUCT_ICONS.default
  return (
    <div style={{
      width: 44, height: 44, borderRadius: 10,
      background: 'var(--bg-surface)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 20, flexShrink: 0,
    }}>
      {emoji}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20

  const { data, isLoading } = useQuery({
    queryKey: ['products', { search, page }],
    queryFn: () =>
      api.get('/products', { params: { search: search || undefined, page, pageSize } }).then((r) => r.data.data),
  })

  const items: any[] = data?.items ?? []
  const total: number = data?.total ?? 0
  const totalPages = Math.ceil(total / pageSize)

  const totalSkus = items.reduce((sum: number, p: any) => sum + (p.skus?.length ?? 0), 0)
  const lowStockCount = items.filter((p: any) => (p.skus?.length ?? 0) < 3).length

  const { t } = useTranslation()

  return (
    <div>
      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{t('products.title')}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>{t('products.subtitle')}</p>
        </div>
        <Space>
          <Button
            icon={<DownloadOutlined />}
            style={{ borderRadius: 10, height: 38, fontWeight: 600, border: '1px solid var(--border)' }}
          >
            {t('products.exportCsv')}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            style={{ background: '#6366F1', border: 'none', borderRadius: 10, height: 38, fontWeight: 600, boxShadow: '0 4px 12px rgba(99,102,241,0.3)' }}
          >
            {t('products.addProduct')}
          </Button>
        </Space>
      </div>

      {/* ── KPI cards ── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <KpiCard
          label={t('products.totalProducts')}
          value={String(total)}
          sub={t('products.totalSkus', { count: totalSkus })}
          accentColor="#6366F1"
          icon={<AppstoreOutlined />}
        />
        <KpiCard
          label={t('products.stockAlerts')}
          value={`${lowStockCount} Items`}
          sub={t('products.lowInventoryDetected')}
          accentColor="#F97316"
          icon={<WarningOutlined />}
        />
        <KpiCard
          label={t('products.activeListings')}
          value={`${items.filter((p: any) => p.isActive).length}`}
          sub={t('products.activeListingsCount')}
          accentColor="#10B981"
          icon={<ReloadOutlined />}
        />
        <KpiCard
          label={t('products.avgCostPerSku')}
          value={items.length > 0
            ? `$${(items.flatMap((p: any) => p.skus ?? []).reduce((s: number, sk: any) => s + Number(sk.costPrice ?? 0), 0) / Math.max(totalSkus, 1)).toFixed(2)}`
            : '—'}
          sub={t('products.weightedAvgCost')}
          accentColor="#8B5CF6"
          icon={<WalletOutlined />}
        />
      </div>

      {/* ── Filter bar ── */}
      <div style={{
        background: 'var(--bg-filter)',
        borderRadius: 12,
        padding: '12px 20px',
        marginBottom: 16,
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('products.category')}:</span>
          <Select
            allowClear
            placeholder={t('products.allCategories')}
            style={{ width: 160 }}
            variant="filled"
            options={[
              { value: 'Electronics', label: 'Electronics' },
              { value: 'Home & Living', label: 'Home & Living' },
            ]}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('common.status')}:</span>
          <Select
            allowClear
            placeholder={t('products.allStatuses')}
            style={{ width: 150 }}
            variant="filled"
            options={[
              { value: 'true', label: t('common.active') },
              { value: 'false', label: t('common.inactive') },
            ]}
          />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <Input.Search
            placeholder={t('products.searchPlaceholder')}
            allowClear
            onSearch={(v) => { setSearch(v); setPage(1) }}
            style={{ width: 220 }}
            variant="filled"
          />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('products.showingOf', { shown: items.length, total })}
          </span>
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 12,
        boxShadow: 'var(--card-shadow-lg)',
        overflow: 'hidden',
      }}>
        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '40px 2fr 140px 160px 90px 150px 80px',
          padding: '12px 24px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-light)',
        }}>
          {[null, t('products.product'), t('products.skuCode'), t('products.category'), t('products.skus'), t('products.stockStatus'), ''].map((h, i) => (
            <div key={i} style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textAlign: i === 4 ? 'center' : 'left' }}>
              {h === null ? <Checkbox /> : h}
            </div>
          ))}
        </div>

        {/* Rows */}
        {isLoading ? (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)' }}>{t('common.loading')}</div>
        ) : items.length === 0 ? (
          <div style={{ padding: '64px 0', textAlign: 'center' }}>
            <AppstoreOutlined style={{ fontSize: 40, color: 'var(--text-muted)', display: 'block', margin: '0 auto 12px' }} />
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>{t('products.noProducts')}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{t('products.noProductsHint')}</div>
          </div>
        ) : items.map((product: any, idx: number) => {
          const skuCount = product.skus?.length ?? 0
          const sampleSkuCode = product.skus?.[0]?.skuCode ?? '—'
          return (
            <div
              key={product.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 2fr 140px 160px 90px 150px 80px',
                padding: '16px 24px',
                alignItems: 'center',
                background: idx % 2 === 1 ? 'var(--bg-surface-alt)' : 'var(--bg-card)',
                transition: 'background 0.15s',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--row-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 1 ? 'var(--bg-surface-alt)' : 'var(--bg-card)')}
            >
              <div><Checkbox /></div>

              {/* Product cell */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <ProductAvatar category={product.category?.name} name={product.name} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{product.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{product.brand ?? 'No brand'}</div>
                </div>
              </div>

              {/* SKU code */}
              <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)' }}>{sampleSkuCode}</div>

              {/* Category */}
              <div>
                {product.category?.name
                  ? <CategoryPill name={product.category.name} />
                  : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                }
              </div>

              {/* SKU count */}
              <div style={{ textAlign: 'center' }}>
                <span style={{ background: '#EEF2FF', color: '#4338CA', borderRadius: 20, padding: '3px 12px', fontSize: 12, fontWeight: 700 }}>
                  {skuCount}
                </span>
              </div>

              {/* Stock */}
              <StockStatus count={skuCount * 50} />

              {/* Actions */}
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <Button type="text" size="small" icon={<EditOutlined />} style={{ color: 'var(--text-muted)', borderRadius: 8 }} />
                <Button type="text" size="small" icon={<DeleteOutlined />} style={{ color: '#EF4444', borderRadius: 8 }} />
              </div>
            </div>
          )
        })}

        {/* Pagination footer */}
        <div style={{
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid var(--border-light)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('common.itemsPerPage')}: <strong style={{ color: 'var(--text-primary)' }}>{pageSize}</strong>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{
                padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
                fontSize: 12, fontWeight: 700, cursor: page === 1 ? 'not-allowed' : 'pointer',
                background: 'var(--bg-card)', color: page === 1 ? 'var(--text-muted)' : 'var(--text-primary)',
              }}
            >
              {t('common.previous')}
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                style={{
                  width: 32, height: 32, borderRadius: 8, border: 'none',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: page === p ? '#6366F1' : 'transparent',
                  color: page === p ? '#fff' : 'var(--text-primary)',
                }}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              style={{
                padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
                fontSize: 12, fontWeight: 700, cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                background: 'var(--bg-card)', color: page >= totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
              }}
            >
              {t('common.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
