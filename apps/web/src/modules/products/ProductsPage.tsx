import { Input, Select, Button, Space, Checkbox } from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, AppstoreOutlined,
  DownloadOutlined, WarningOutlined, ReloadOutlined, WalletOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, accentColor, icon, trendLabel, trendUp,
}: {
  label: string
  value: string
  sub: string
  accentColor: string
  icon: React.ReactNode
  trendLabel?: string
  trendUp?: boolean
}) {
  return (
    <div style={{
      background: 'var(--kpi-bg)',
      backdropFilter: 'var(--kpi-backdrop)',
      WebkitBackdropFilter: 'var(--kpi-backdrop)',
      border: 'var(--kpi-border)',
      borderRadius: 24,
      boxShadow: 'var(--kpi-shadow)',
      padding: '24px',
      position: 'relative',
      overflow: 'hidden',
      flex: 1,
    }}>
      {/* Ambient blur blob top-right */}
      <div style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 128,
        height: 128,
        background: `${accentColor}1a`,
        filter: 'blur(60px)',
        borderRadius: '50%',
        pointerEvents: 'none',
      }} />

      {/* Top row: icon + trend badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, position: 'relative' }}>
        {/* Icon box */}
        <div style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: `${accentColor}1a`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: accentColor,
          fontSize: 20,
        }}>
          {icon}
        </div>
        {/* Trend badge */}
        {trendLabel && (
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: trendUp ? 'var(--badge-success-fg)' : 'var(--badge-error-fg)',
            background: trendUp ? 'var(--badge-success-bg)' : 'var(--badge-error-bg)',
            border: `1px solid ${trendUp ? 'var(--badge-success-fg)' : 'var(--badge-error-fg)'}22`,
            borderRadius: 999,
            padding: '2px 8px',
          }}>
            {trendLabel}
          </span>
        )}
      </div>

      {/* Label */}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500, position: 'relative' }}>{label}</div>

      {/* Value */}
      <div style={{
        fontSize: 32,
        fontWeight: 900,
        color: 'var(--text-primary)',
        lineHeight: 1.1,
        fontFamily: "'Manrope', sans-serif",
        letterSpacing: '-0.02em',
        position: 'relative',
      }}>
        {value}
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', position: 'relative' }}>{sub}</div>
    </div>
  )
}

// ─── Stock bar ────────────────────────────────────────────────────────────────

function StockBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{
      width: 64,
      height: 6,
      background: 'var(--bg-surface-alt)',
      borderRadius: 9999,
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      <div style={{
        background: color,
        height: '100%',
        width: `${Math.min(100, Math.max(0, pct))}%`,
        borderRadius: 9999,
        transition: 'width 0.4s',
      }} />
    </div>
  )
}

// ─── Status pill ──────────────────────────────────────────────────────────────

function StatusPill({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
        background: 'var(--badge-error-bg)', color: 'var(--badge-error-fg)',
        border: '1px solid var(--badge-error-fg)22',
      }}>
        Out of Stock
      </span>
    )
  }
  if (count < 100) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
        background: 'var(--badge-warning-bg)', color: 'var(--badge-warning-fg)',
        border: '1px solid var(--badge-warning-fg)22',
      }}>
        Low Stock
      </span>
    )
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: 'var(--badge-success-bg)', color: 'var(--badge-success-fg)',
      border: '1px solid var(--badge-success-fg)22',
    }}>
      In Stock
    </span>
  )
}

// ─── Category pill ────────────────────────────────────────────────────────────

function CategoryPill({ name }: { name: string }) {
  return (
    <span style={{
      background: 'var(--badge-info-bg)',
      color: 'var(--badge-info-fg)',
      fontSize: 9,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      padding: '3px 10px',
      borderRadius: 999,
      border: '1px solid var(--badge-info-fg)22',
    }}>
      {name}
    </span>
  )
}

// ─── Product avatar ───────────────────────────────────────────────────────────

const PRODUCT_ICONS: Record<string, string> = {
  'Electronics': '🎧',
  'Home & Living': '💡',
  default: '📦',
}

function ProductAvatar({ category }: { category?: string }) {
  const emoji = PRODUCT_ICONS[category ?? ''] ?? PRODUCT_ICONS.default
  return (
    <div style={{
      width: 56,
      height: 56,
      borderRadius: 16,
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 24,
      flexShrink: 0,
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
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text-primary)',
          }}>
            {t('products.title')}
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>{t('products.subtitle')}</p>
        </div>
        <Space>
          <Button
            icon={<DownloadOutlined />}
            style={{
              borderRadius: 10, height: 40, fontWeight: 600,
              border: '1px solid var(--border)',
              background: 'var(--bg-btn)', color: 'var(--text-secondary)',
            }}
          >
            {t('products.exportCsv')}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            style={{
              background: 'var(--accent-gradient)',
              border: 'none', borderRadius: 10, height: 40, fontWeight: 600,
            }}
          >
            {t('products.addProduct')}
          </Button>
        </Space>
      </div>

      {/* ── KPI cards ── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
        <KpiCard
          label={t('products.totalProducts')}
          value={String(total)}
          sub={t('products.totalSkus', { count: totalSkus })}
          accentColor="#cc97ff"
          icon={<AppstoreOutlined />}
          trendLabel="+4.2%"
          trendUp={true}
        />
        <KpiCard
          label={t('products.stockAlerts')}
          value={`${lowStockCount}`}
          sub={t('products.lowInventoryDetected')}
          accentColor="#53ddfc"
          icon={<WarningOutlined />}
          trendLabel={lowStockCount > 0 ? 'Needs attention' : undefined}
          trendUp={false}
        />
        <KpiCard
          label={t('products.activeListings')}
          value={`${items.filter((p: any) => p.isActive).length}`}
          sub={t('products.activeListingsCount')}
          accentColor="#ff6daf"
          icon={<ReloadOutlined />}
        />
        <KpiCard
          label={t('products.avgCostPerSku')}
          value={items.length > 0
            ? `$${(items.flatMap((p: any) => p.skus ?? []).reduce((s: number, sk: any) => s + Number(sk.costPrice ?? 0), 0) / Math.max(totalSkus, 1)).toFixed(2)}`
            : '—'}
          sub={t('products.weightedAvgCost')}
          accentColor="#f59e0b"
          icon={<WalletOutlined />}
        />
      </div>

      {/* ── Filter bar ── */}
      <div style={{
        background: 'var(--bg-surface)',
        borderRadius: 14,
        border: '1px solid var(--border-light)',
        padding: '12px 20px',
        marginBottom: 16,
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('products.category')}:</span>
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
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('common.status')}:</span>
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
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {t('products.showingOf', { shown: items.length, total })}
          </span>
        </div>
      </div>

      {/* ── Table container ── */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 24,
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}>
        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '40px 2fr 140px 160px 90px 180px 80px',
          padding: '14px 24px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-light)',
        }}>
          {[null, t('products.product'), t('products.skuCode'), t('products.category'), t('products.skus'), t('products.stockStatus'), ''].map((h, i) => (
            <div key={i} style={{
              fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
              letterSpacing: '0.08em', textAlign: i === 4 ? 'center' : 'left',
              textTransform: 'uppercase',
            }}>
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
          const stockQty = skuCount * 50
          const stockPct = Math.min(100, (stockQty / 500) * 100)
          const sampleSkuCode = product.skus?.[0]?.skuCode ?? '—'
          const barColor = stockQty === 0 ? 'var(--badge-error-fg)' : stockQty < 100 ? 'var(--badge-warning-fg)' : 'var(--badge-info-fg)'

          return (
            <div
              key={product.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 2fr 140px 160px 90px 180px 80px',
                padding: '16px 24px',
                alignItems: 'center',
                borderBottom: idx < items.length - 1 ? '1px solid var(--border-light)' : 'none',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--row-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div><Checkbox /></div>

              {/* Product cell */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <ProductAvatar category={product.category?.name} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{product.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{product.brand ?? 'No brand'}</div>
                </div>
              </div>

              {/* SKU code */}
              <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--mono-color)' }}>{sampleSkuCode}</div>

              {/* Category */}
              <div>
                {product.category?.name
                  ? <CategoryPill name={product.category.name} />
                  : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                }
              </div>

              {/* SKU count */}
              <div style={{ textAlign: 'center' }}>
                <span style={{
                  background: 'var(--badge-purple-bg)', color: 'var(--badge-purple-fg)',
                  borderRadius: 999, padding: '3px 12px', fontSize: 12, fontWeight: 700,
                  border: '1px solid var(--badge-purple-fg)22',
                }}>
                  {skuCount}
                </span>
              </div>

              {/* Stock */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <StockBar pct={stockPct} color={barColor} />
                <StatusPill count={stockQty} />
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <Button type="text" size="small" icon={<EditOutlined />} style={{ color: 'var(--text-muted)', borderRadius: 8 }} />
                <Button type="text" size="small" icon={<DeleteOutlined />} style={{ color: 'var(--badge-error-fg)', borderRadius: 8 }} />
              </div>
            </div>
          )
        })}

        {/* Pagination footer */}
        <div style={{
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid var(--border-light)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('common.itemsPerPage')}: <strong style={{ color: 'var(--text-secondary)' }}>{pageSize}</strong>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{
                padding: '6px 14px', borderRadius: 8,
                border: '1px solid var(--border)',
                fontSize: 12, fontWeight: 600,
                cursor: page === 1 ? 'not-allowed' : 'pointer',
                background: 'var(--bg-btn)',
                color: page === 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                opacity: page === 1 ? 0.5 : 1,
              }}
            >
              {t('common.previous')}
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                style={{
                  width: 34, height: 34, borderRadius: 8, border: 'none',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: page === p ? 'var(--accent-gradient)' : 'transparent',
                  color: page === p ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              style={{
                padding: '6px 14px', borderRadius: 8,
                border: '1px solid var(--border)',
                fontSize: 12, fontWeight: 600,
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                background: 'var(--bg-btn)',
                color: page >= totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
                opacity: page >= totalPages ? 0.5 : 1,
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
