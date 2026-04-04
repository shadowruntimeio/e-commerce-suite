import { Card, Table, Button, Tag, Space, Popconfirm, message, Typography } from 'antd'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'

const { Text } = Typography

interface RestockingSuggestion {
  id: string
  suggestedQty: number
  status: string
  createdAt: string
  expiresAt: string
  reason: {
    daysOfStock: number
    avgDailySales: number
    currentStock: number
  }
  systemSku: {
    id: string
    skuCode: string
    attributes: Record<string, unknown>
    systemProduct: {
      id: string
      name: string
      spuCode: string
    }
  }
  warehouseSku: {
    id: string
    safetyStockDays: number
    reorderPoint: number
    warehouse: {
      id: string
      name: string
    }
  }
}

export default function RestockingPage() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['restocking-suggestions'],
    queryFn: () =>
      api.get('/purchase/suggestions').then((r) => r.data.data as RestockingSuggestion[]),
  })

  const acceptMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase/suggestions/${id}/accept`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restocking-suggestions'] })
      void message.success('Purchase order draft created')
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      void message.error(msg ?? 'Failed to create purchase order')
    },
  })

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase/suggestions/${id}/dismiss`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restocking-suggestions'] })
      void message.success('Suggestion dismissed')
    },
    onError: () => void message.error('Failed to dismiss suggestion'),
  })

  const columns: ColumnsType<RestockingSuggestion> = [
    {
      title: 'SKU',
      width: 180,
      render: (_: unknown, record: RestockingSuggestion) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 13 }}>{record.systemSku.skuCode}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.systemSku.systemProduct.name}</Text>
        </Space>
      ),
    },
    {
      title: 'Warehouse',
      dataIndex: ['warehouseSku', 'warehouse', 'name'],
      width: 150,
    },
    {
      title: 'Current Stock',
      width: 140,
      render: (_: unknown, record: RestockingSuggestion) => {
        const { currentStock, daysOfStock } = record.reason
        const color = daysOfStock < 7 ? 'red' : daysOfStock < 14 ? 'orange' : 'green'
        return (
          <Space direction="vertical" size={0}>
            <Tag color={color}>{daysOfStock.toFixed(1)} days</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>{currentStock} units on hand</Text>
          </Space>
        )
      },
    },
    {
      title: 'Avg Daily Sales',
      width: 120,
      render: (_: unknown, record: RestockingSuggestion) => (
        <Text>{record.reason.avgDailySales.toFixed(2)} / day</Text>
      ),
    },
    {
      title: 'Suggested Qty',
      dataIndex: 'suggestedQty',
      width: 110,
      align: 'right' as const,
      render: (v: number) => <Text strong>{v}</Text>,
    },
    {
      title: 'Safety Stock',
      width: 100,
      render: (_: unknown, record: RestockingSuggestion) => (
        <Text type="secondary">{record.warehouseSku.safetyStockDays} days</Text>
      ),
    },
    {
      title: 'Actions',
      width: 180,
      render: (_: unknown, record: RestockingSuggestion) => (
        <Space>
          <Popconfirm
            title="Create a draft purchase order from this suggestion?"
            onConfirm={() => acceptMutation.mutate(record.id)}
          >
            <Button
              type="primary"
              size="small"
              loading={acceptMutation.isPending}
            >
              Create PO
            </Button>
          </Popconfirm>
          <Popconfirm
            title="Dismiss this suggestion?"
            onConfirm={() => dismissMutation.mutate(record.id)}
          >
            <Button size="small" danger loading={dismissMutation.isPending}>
              Dismiss
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Card
      title="Restocking Suggestions"
      extra={
        <Text type="secondary" style={{ fontSize: 13 }}>
          Suggestions are generated nightly based on sales velocity and safety stock levels.
        </Text>
      }
    >
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data ?? []}
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `${t} suggestions` }}
        scroll={{ x: 1000 }}
        locale={{ emptyText: 'No pending restocking suggestions' }}
      />
    </Card>
  )
}
