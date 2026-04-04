import { useState } from 'react'
import { Table, Button, Spin } from 'antd'
import { SyncOutlined, FundOutlined, DollarOutlined, LineChartOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
    MANUAL: { bg: '#E2E8F0', color: '#475569' },
  }
  const s = map[platform] ?? { bg: '#E2E8F0', color: '#475569' }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: '0.03em' }}>
      {platform}
    </span>
  )
}

function RoasCell({ value }: { value: number }) {
  const color = value < 1.0 ? '#EF4444' : value >= 3.0 ? '#10B981' : '#F59E0B'
  const bg = value < 1.0 ? '#FEE2E2' : value >= 3.0 ? '#D1FAE5' : '#FEF3C7'
  return (
    <span style={{ background: bg, color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
      {value.toFixed(2)}x
    </span>
  )
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({ title, value, accent, icon }: { title: string; value: string; accent: string; icon: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>{title}</span>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `${accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: accent, fontSize: 18 }}>{icon}</span>
        </div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#0F172A', lineHeight: 1 }}>{value}</div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdsPage() {
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
      title: 'Campaign',
      dataIndex: 'campaignName',
      ellipsis: true,
      render: (v, r) => (
        <span style={{ fontWeight: 500, color: '#0F172A' }}>{v ?? r.campaignId}</span>
      ),
    },
    {
      title: 'Shop',
      dataIndex: 'shopId',
      width: 140,
      ellipsis: true,
      render: (v) => <span style={{ color: '#64748B', fontSize: 13 }}>{v}</span>,
    },
    {
      title: 'Platform',
      dataIndex: 'platform',
      width: 100,
      render: (v) => <PlatformBadge platform={v} />,
    },
    {
      title: 'Impressions',
      dataIndex: 'impressions',
      width: 120,
      align: 'right',
      render: (v: number) => <span style={{ color: '#374151' }}>{v.toLocaleString()}</span>,
    },
    {
      title: 'Clicks',
      dataIndex: 'clicks',
      width: 90,
      align: 'right',
      render: (v: number) => <span style={{ color: '#374151' }}>{v.toLocaleString()}</span>,
    },
    {
      title: 'CTR',
      dataIndex: 'CTR',
      width: 90,
      align: 'right',
      render: (v: number) => <span style={{ color: '#374151' }}>{v.toFixed(2)}%</span>,
    },
    {
      title: 'Spend',
      dataIndex: 'spend',
      width: 110,
      align: 'right',
      render: (v: number) => <span style={{ fontWeight: 600, color: '#EF4444' }}>${v.toFixed(2)}</span>,
    },
    {
      title: 'Revenue',
      dataIndex: 'revenueAttributed',
      width: 110,
      align: 'right',
      render: (v: number) => <span style={{ fontWeight: 600, color: '#10B981' }}>${v.toFixed(2)}</span>,
    },
    {
      title: 'ROAS',
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
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#0F172A' }}>Ads Performance</h1>
            <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: 14 }}>Campaign metrics across all connected platforms</p>
          </div>
          <Button
            icon={<SyncOutlined spin={syncing} />}
            loading={syncing}
            onClick={() => syncMutation.mutate()}
            style={{ background: '#fff', color: '#374151', border: '1px solid #E2E8F0', borderRadius: 8, height: 36, fontWeight: 500, fontSize: 14 }}
          >
            Sync Ads
          </Button>
        </div>
      </div>

      {/* No data alert */}
      {noData && (
        <div style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 12, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <FundOutlined style={{ color: '#6366F1', fontSize: 18, flexShrink: 0 }} />
          <div style={{ color: '#3730A3', fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>Connect ad accounts to see performance data.</span>
            {' '}Link your Shopee or TikTok ad accounts and sync to view campaign metrics here.
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}><Spin size="large" /></div>
      ) : (
        <>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
            <KpiCard title="Total Spend" value={`$${(summary?.totalSpend ?? 0).toFixed(2)}`} accent="#EF4444" icon={<DollarOutlined />} />
            <KpiCard title="Revenue Attributed" value={`$${(summary?.totalRevenue ?? 0).toFixed(2)}`} accent="#10B981" icon={<DollarOutlined />} />
            <KpiCard title="Overall ROAS" value={`${(summary?.overallROAS ?? 0).toFixed(2)}x`} accent="#6366F1" icon={<LineChartOutlined />} />
          </div>

          {/* Table */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#0F172A' }}>Campaigns</span>
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
                showTotal: (total) => `${total.toLocaleString()} records`,
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
