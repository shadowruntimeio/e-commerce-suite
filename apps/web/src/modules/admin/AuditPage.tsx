import { useState } from 'react'
import { Card, Table, Tag, Input, Space } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import dayjs from 'dayjs'

interface AuditEntry {
  id: string
  action: string
  targetType: string | null
  targetId: string | null
  payload: Record<string, unknown>
  ip: string | null
  createdAt: string
  actor: { id: string; name: string; email: string; role: string } | null
}

export default function AuditPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const pageSize = 30
  const [actionFilter, setActionFilter] = useState('')

  const q = useQuery({
    queryKey: ['audit', page, pageSize, actionFilter],
    queryFn: async () => {
      const params: Record<string, string> = { page: String(page), pageSize: String(pageSize) }
      if (actionFilter) params.action = actionFilter
      const res = await api.get('/audit', { params })
      return res.data.data as { items: AuditEntry[]; total: number; totalPages: number }
    },
  })

  const columns = [
    {
      title: t('audit.time'), dataIndex: 'createdAt', key: 'createdAt',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
      width: 180,
    },
    {
      title: t('audit.actor'), key: 'actor',
      render: (_: unknown, e: AuditEntry) =>
        e.actor ? (
          <Space>
            <span>{e.actor.name}</span>
            <Tag>{t(`nav.role.${e.actor.role}`)}</Tag>
          </Space>
        ) : <Tag color="default">{t('audit.system')}</Tag>,
    },
    { title: t('audit.action'), dataIndex: 'action', key: 'action', render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: t('audit.target'), key: 'target',
      render: (_: unknown, e: AuditEntry) =>
        e.targetType ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.targetType}: {e.targetId?.slice(-8)}</span> : '—',
    },
    {
      title: t('audit.payload'), dataIndex: 'payload', key: 'payload',
      render: (p: Record<string, unknown>) => (
        <pre style={{ margin: 0, fontSize: 11, maxWidth: 480, overflow: 'auto' }}>
          {JSON.stringify(p, null, 0)}
        </pre>
      ),
    },
    { title: t('audit.ip'), dataIndex: 'ip', key: 'ip', width: 120 },
  ]

  return (
    <Card
      title={t('audit.title')}
      extra={
        <Input.Search
          placeholder={t('audit.filterPlaceholder')}
          onSearch={(v) => { setActionFilter(v); setPage(1) }}
          allowClear
          style={{ width: 320 }}
        />
      }
    >
      <Table
        rowKey="id"
        loading={q.isLoading}
        dataSource={q.data?.items ?? []}
        columns={columns}
        pagination={{
          current: page,
          total: q.data?.total ?? 0,
          pageSize,
          onChange: setPage,
          showSizeChanger: false,
        }}
      />
    </Card>
  )
}
