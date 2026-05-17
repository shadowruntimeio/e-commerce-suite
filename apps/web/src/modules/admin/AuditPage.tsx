import { useMemo, useState } from 'react'
import { Card, Table, Tag, Select, Space, Tabs } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import dayjs from 'dayjs'
import zhLocale from '../../locales/zh'
import enLocale from '../../locales/en'

type AuditKind = 'system' | 'user'

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
  const [kind, setKind] = useState<AuditKind>('user')
  const [page, setPage] = useState(1)
  const pageSize = 30
  const [actionFilter, setActionFilter] = useState('')

  // Action/target codes contain dots (e.g. order.merchant_confirm), which
  // collide with i18next's default key separator. Pull the lookup tables in
  // bulk via returnObjects and index them as plain JS maps instead.
  const actionLabels = t('audit.actions', { returnObjects: true }) as Record<string, string>
  const targetLabels = t('audit.targets', { returnObjects: true }) as Record<string, string>

  // For the filter we want the user to search across both languages so they
  // can type "登录" or "login" and still find user.login. Build options from
  // the raw locale objects (i18next's getResource isn't reliable until both
  // bundles are loaded), and tag each option with a haystack of code + zh +
  // en labels for filterOption to match against.
  const actionOptions = useMemo(() => {
    const zhMap = zhLocale.audit.actions as Record<string, string>
    const enMap = enLocale.audit.actions as Record<string, string>
    const codes = Array.from(new Set([...Object.keys(zhMap), ...Object.keys(enMap)])).sort()
    return codes.map((code) => ({
      value: code,
      label: actionLabels[code] ?? code,
      haystack: [code, zhMap[code], enMap[code]].filter(Boolean).join(' ').toLowerCase(),
    }))
  }, [actionLabels])

  const q = useQuery({
    queryKey: ['audit', kind, page, pageSize, actionFilter],
    queryFn: async () => {
      const params: Record<string, string> = { page: String(page), pageSize: String(pageSize), kind }
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
    ...(kind === 'system' ? [] : [{
      title: t('audit.actor'), key: 'actor',
      render: (_: unknown, e: AuditEntry) =>
        e.actor ? (
          <Space>
            <span>{e.actor.name}</span>
            <Tag>{t(`nav.role.${e.actor.role}`)}</Tag>
          </Space>
        ) : <Tag color="default">{t('audit.system')}</Tag>,
    }]),
    { title: t('audit.action'), dataIndex: 'action', key: 'action',
      render: (v: string) => <Tag color="blue">{actionLabels[v] ?? v}</Tag>,
    },
    { title: t('audit.target'), key: 'target',
      render: (_: unknown, e: AuditEntry) =>
        e.targetType ? (
          <span style={{ fontSize: 12 }}>
            {targetLabels[e.targetType] ?? e.targetType}
            <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', marginLeft: 6 }}>
              {e.targetId?.slice(-8)}
            </span>
          </span>
        ) : '—',
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
        <Select
          showSearch
          allowClear
          placeholder={t('audit.filterPlaceholder')}
          style={{ width: 320 }}
          value={actionFilter || undefined}
          onChange={(v: string | undefined) => { setActionFilter(v ?? ''); setPage(1) }}
          options={actionOptions}
          optionRender={(option) => (
            <Space size={8}>
              <span>{option.data.label}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>
                {option.data.value}
              </span>
            </Space>
          )}
          filterOption={(input, option) =>
            !!option && (option as { haystack: string }).haystack.includes(input.toLowerCase())
          }
        />
      }
    >
      <Tabs
        activeKey={kind}
        onChange={(k) => { setKind(k as AuditKind); setPage(1) }}
        items={[
          { key: 'user', label: t('audit.tabUser') },
          { key: 'system', label: t('audit.tabSystem') },
        ]}
      />
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
