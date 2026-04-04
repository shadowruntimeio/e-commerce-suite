import { useState } from 'react'
import { Alert, Button, Card, Col, Row, Spin, Statistic, Table, Tag } from 'antd'
import { LineChartOutlined, SyncOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'

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

  const roasColor = (roas: number) => {
    if (roas < 1.0) return '#ff4d4f'
    if (roas > 5.0) return '#52c41a'
    return undefined
  }

  const columns: ColumnsType<Campaign> = [
    { title: 'Campaign', dataIndex: 'campaignName', render: (v, r) => v ?? r.campaignId, ellipsis: true },
    { title: 'Shop', dataIndex: 'shopId', width: 120, ellipsis: true },
    { title: 'Platform', dataIndex: 'platform', width: 100, render: (v) => <Tag>{v}</Tag> },
    {
      title: 'Impressions',
      dataIndex: 'impressions',
      width: 120,
      align: 'right',
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: 'Clicks',
      dataIndex: 'clicks',
      width: 90,
      align: 'right',
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: 'CTR %',
      dataIndex: 'CTR',
      width: 90,
      align: 'right',
      render: (v: number) => `${v.toFixed(2)}%`,
    },
    {
      title: 'Spend',
      dataIndex: 'spend',
      width: 110,
      align: 'right',
      render: (v: number) => `$${v.toFixed(2)}`,
    },
    {
      title: 'Revenue',
      dataIndex: 'revenueAttributed',
      width: 110,
      align: 'right',
      render: (v: number) => `$${v.toFixed(2)}`,
    },
    {
      title: 'ROAS',
      dataIndex: 'roas',
      width: 90,
      align: 'right',
      render: (v: number) => (
        <span style={{ color: roasColor(v), fontWeight: 600 }}>{v.toFixed(2)}x</span>
      ),
      sorter: (a, b) => a.roas - b.roas,
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <LineChartOutlined /> Ads Performance
        </h2>
        <Button
          type="primary"
          icon={<SyncOutlined spin={syncing} />}
          onClick={() => syncMutation.mutate()}
          loading={syncing}
        >
          Sync Ads
        </Button>
      </div>

      {noData && (
        <Alert
          type="info"
          showIcon
          message="No ad data available"
          description="Connect Shopee/TikTok ad accounts to see data here"
          style={{ marginBottom: 16 }}
        />
      )}

      {isLoading ? (
        <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
      ) : (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={8}>
              <Card>
                <Statistic
                  title="Total Spend"
                  value={(summary?.totalSpend ?? 0).toFixed(2)}
                  prefix="$"
                  valueStyle={{ color: '#faad14' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card>
                <Statistic
                  title="Attributed Revenue"
                  value={(summary?.totalRevenue ?? 0).toFixed(2)}
                  prefix="$"
                  valueStyle={{ color: '#1677ff' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card>
                <Statistic
                  title="Overall ROAS"
                  value={(summary?.overallROAS ?? 0).toFixed(2)}
                  suffix="x"
                  valueStyle={{ color: (summary?.overallROAS ?? 0) >= 1 ? '#52c41a' : '#ff4d4f' }}
                />
              </Card>
            </Col>
          </Row>

          <Card title="Campaigns">
            <Table
              rowKey="campaignId"
              columns={columns}
              dataSource={campaigns}
              size="small"
              pagination={{ pageSize: 20 }}
            />
          </Card>
        </>
      )}
    </div>
  )
}
