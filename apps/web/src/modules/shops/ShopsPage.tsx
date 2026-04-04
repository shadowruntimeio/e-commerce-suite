import { useEffect, useState } from 'react'
import { Card, Table, Tag, Button, Space, message } from 'antd'
import { SyncOutlined, ShopOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import dayjs from 'dayjs'

export default function ShopsPage() {
  const queryClient = useQueryClient()
  const [connectingShopee, setConnectingShopee] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['shops'],
    queryFn: () => api.get('/shops').then(r => r.data.data),
  })

  // Show success/error messages from OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected') === 'true') {
      message.success('Shopee shop connected successfully!')
      queryClient.invalidateQueries({ queryKey: ['shops'] })
      // Clean the URL so the message doesn't repeat on refresh
      const cleanUrl = window.location.pathname
      window.history.replaceState({}, '', cleanUrl)
    } else if (params.get('error') === 'oauth_failed') {
      message.error('Failed to connect Shopee shop. Please try again.')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [queryClient])

  const syncMutation = useMutation({
    mutationFn: (shopId: string) => api.post(`/shops/${shopId}/sync`),
    onSuccess: () => message.success('Sync job queued'),
    onError: () => message.error('Failed to queue sync'),
  })

  async function handleConnectShopee() {
    setConnectingShopee(true)
    try {
      const res = await api.get('/shops/shopee/connect')
      const url: string = res.data.data.url
      window.location.href = url
    } catch {
      message.error('Failed to get Shopee connect URL')
      setConnectingShopee(false)
    }
  }

  return (
    <Card
      title="Connected Shops"
      extra={
        <Button
          type="primary"
          icon={<ShopOutlined />}
          loading={connectingShopee}
          onClick={handleConnectShopee}
        >
          Connect Shopee
        </Button>
      }
    >
      <Table
        rowKey="id"
        dataSource={data ?? []}
        loading={isLoading}
        size="small"
        columns={[
          { title: 'Name', dataIndex: 'name' },
          {
            title: 'Platform',
            dataIndex: 'platform',
            render: (v) => <Tag color="blue">{v}</Tag>,
          },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (v) => (
              <Tag color={v === 'ACTIVE' ? 'green' : v === 'AUTH_EXPIRED' ? 'orange' : 'red'}>
                {v}
              </Tag>
            ),
          },
          {
            title: 'Token Expires',
            dataIndex: 'tokenExpiresAt',
            render: (v) => (v ? dayjs(v).format('MM/DD/YYYY') : '-'),
          },
          {
            title: 'Last Sync',
            dataIndex: 'lastSyncAt',
            render: (v) => (v ? dayjs(v).format('MM/DD HH:mm') : 'Never'),
          },
          {
            title: 'Actions',
            key: 'actions',
            render: (_, record: { id: string }) => (
              <Space>
                <Button
                  size="small"
                  icon={<SyncOutlined />}
                  loading={syncMutation.isPending && syncMutation.variables === record.id}
                  onClick={() => syncMutation.mutate(record.id)}
                >
                  Sync Now
                </Button>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  )
}
