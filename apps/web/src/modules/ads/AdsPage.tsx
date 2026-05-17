import { useState } from 'react'
import { Table, Button, Spin } from 'antd'
import { SyncOutlined, FundOutlined, DollarOutlined, LineChartOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Campaign {
  campaignId: string
  campaignName: string | null
  shopId: string
  platform: string
  impressions: number
  clicks: number
  spend: number
  revenueAttributed: number
  roas: number
  CTR: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function RoasCell({ value }: { value: number }) {
  const color = value < 1.0 ? 'var(--badge-error-fg)' : value >= 3.0 ? 'var(--badge-success-fg)' : 'var(--badge-warning-fg)'
  const bg = value < 1.0 ? 'var(--badge-error-bg)' : value >= 3.0 ? 'var(--badge-success-bg)' : 'var(--badge-warning-bg)'
  return (
    <span style={{ background: bg, color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
      {value.toFixed(2)}x
    </span>
  )
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({ title, value, accent, icon }: { title: string; value: string; accent: string; icon: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--kpi-bg)', borderRadius: 20, border: 'var(--kpi-border)', backdropFilter: 'var(--kpi-backdrop)', boxShadow: 'var(--kpi-shadow)', padding: '20px 24px' }}>
      <div style={{ position: 'absolute', top: -24, right: -24, width: 96, height: 96, borderRadius: '50%', background: accent, filter: 'blur(48px)', opacity: 0.15, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{title}</span>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `${accent}22`, border: `1px solid ${accent}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: accent, fontSize: 18 }}>{icon}</span>
        </div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, fontFamily: "'Manrope', sans-serif" }}>{value}</div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdsPage() {
  const { t } = useTranslation()
  const [syncing, setSyncing] = useState(false)
  const queryClient = useQueryClient()

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ['ads-campaigns'],
    queryFn: () => api.get('/ads/campaigns').then((r) => r.data.data),
  })

  const { data: summary } = useQuery<{ totalSpend: number; totalRevenue: number; overallROAS: number }>({
    queryKey: ['ads-summary'],
    queryFn: () =>
      api.get('/ads').then((r) => {
        const rows: any[] = r.data.data ?? []
        const totalSpend = rows.reduce((s, x) => s + (x.totalSpend ?? 0), 0)
        const totalRevenue = rows.reduce((s, x) => s + (x.totalRevenue ?? 0), 0)
        return {
          totalSpend,
          totalRevenue,
          overallROAS: totalSpend > 0 ? totalRevenue / totalSpend : 0,
        }
      }),
  })

  const syncMutation = useMutation({
    mutationFn: () => api.post('/ads/sync'),
    onMutate: () => setSyncing(true),
    onSettled: () => {
      setSyncing(false)
      queryClient.invalidateQueries({ queryKey: ['ads-campaigns'] })
      queryClient.invalidateQueries({ queryKey: ['ads-summary'] })
    },
  })

  const noData = !isLoading && campaigns.length === 0

  const columns: ColumnsType<Campaign> = [
    {
      title: t('ads.campaign'),
      dataIndex: 'campaignName',
      ellipsis: true,
      render: (v, r) => (
        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{v ?? r.campaignId}</span>
      ),
    },
    {
      title: t('orders.shop'),
      dataIndex: 'shopId',
      width: 140,
      ellipsis: true,
      render: (v) => <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{v}</span>,
    },
    {
      title: t('ads.platform'),
      dataIndex: 'platform',
      width: 100,
      render: (v) => <PlatformBadge platform={v} />,
    },
    {
      title: t('ads.impressions'),
      dataIndex: 'impressions',
      width: 120,
      align: 'right',
      render: (v: number) => <span style={{ color: 'var(--text-primary)' }}>{v.toLocaleString()}</span>,
    },
    {
      title: t('ads.clicks'),
      dataIndex: 'clicks',
      width: 90,
      align: 'right',
      render: (v: number) => <span style={{ color: 'var(--text-primary)' }}>{v.toLocaleString()}</span>,
    },
    {
      title: 'CTR',
      dataIndex: 'CTR',
      width: 90,
      align: 'right',
      render: (v: number) => <span style={{ color: 'var(--text-primary)' }}>{v.toFixed(2)}%</span>,
    },
    {
      title: t('ads.spend'),
      dataIndex: 'spend',
      width: 110,
      align: 'right',
      render: (v: number) => <span style={{ fontWeight: 600, color: '#EF4444' }}>${v.toFixed(2)}</span>,
    },
    {
      title: t('ads.revenue'),
      dataIndex: 'revenueAttributed',
      width: 110,
      align: 'right',
      render: (v: number) => <span style={{ fontWeight: 600, color: '#10B981' }}>${v.toFixed(2)}</span>,
    },
    {
      title: t('ads.roas'),
      dataIndex: 'roas',
      width: 100,
      align: 'right',
      sorter: (a, b) => a.roas - b.roas,
      render: (v: number) => <RoasCell value={v} />,
    },
  ]

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>{t('ads.subtitle')}</p>
          </div>
          <Button
            icon={<SyncOutlined spin={syncing} />}
            loading={syncing}
            onClick={() => syncMutation.mutate()}
            style={{ background: 'var(--accent-gradient)', color: '#fff', border: 'none', borderRadius: 8, height: 36, fontWeight: 600, fontSize: 14, boxShadow: '0 0 16px rgba(204,151,255,0.3)' }}
          >
            {t('ads.sync')}
          </Button>
        </div>
      </div>

      {/* No data alert */}
      {noData && (
        <div style={{ background: 'var(--badge-purple-bg)', border: '1px solid rgba(var(--accent-primary-raw, 204,151,255),0.3)', borderRadius: 12, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <FundOutlined style={{ color: 'var(--accent-primary)', fontSize: 18, flexShrink: 0 }} />
          <div style={{ color: 'var(--text-primary)', fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>{t('ads.noData')}</span>
            {' '}{t('ads.noDataHint')}
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}><Spin size="large" /></div>
      ) : (
        <>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
            <KpiCard title={t('ads.totalSpend')} value={`$${(summary?.totalSpend ?? 0).toFixed(2)}`} accent="#EF4444" icon={<DollarOutlined />} />
            <KpiCard title={t('ads.revenueAttributed')} value={`$${(summary?.totalRevenue ?? 0).toFixed(2)}`} accent="#10B981" icon={<DollarOutlined />} />
            <KpiCard title={t('ads.overallROAS')} value={`${(summary?.overallROAS ?? 0).toFixed(2)}x`} accent="#6366F1" icon={<LineChartOutlined />} />
          </div>

          {/* Table */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{t('ads.campaigns')}</span>
            </div>
            <Table
              rowKey="campaignId"
              columns={columns}
              dataSource={campaigns}
              size="middle"
              style={{ borderRadius: 0 }}
              pagination={{
                pageSize: 20,
                showSizeChanger: false,
                showTotal: (total) => t('common.records', { count: total }),
                style: { padding: '12px 20px' },
              }}
              scroll={{ x: 'max-content' }}
            />
          </div>
        </>
      )}
    </div>
  )
}
