import { Button, Spin, Modal, Input, Select, message } from 'antd'
import { PlusOutlined, BankOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'

// ─── Type badge ──────────────────────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: 'LOCAL', labelKey: 'warehouses.typeLocal' },
  { value: 'OVERSEAS', labelKey: 'warehouses.typeOverseas' },
  { value: 'THREE_PL', labelKey: 'warehouses.type3pl' },
]

const TYPE_MAP: Record<string, { bg: string; color: string }> = {
  LOCAL:     { bg: 'var(--badge-purple-bg)',  color: 'var(--badge-purple-fg)' },
  OVERSEAS:  { bg: 'var(--badge-info-bg)',    color: 'var(--badge-info-fg)' },
  THREE_PL:  { bg: 'var(--badge-success-bg)', color: 'var(--badge-success-fg)' },
}

function TypeBadge({ type }: { type: string }) {
  const s = TYPE_MAP[type] ?? { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)' }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
      {type}
    </span>
  )
}

// ─── Warehouse Card ───────────────────────────────────────────────────────────

const ICON_COLORS = ['#cc97ff', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4']

function WarehouseCard({ warehouse, index, t }: { warehouse: any; index: number; t: (key: string) => string }) {
  const color = ICON_COLORS[index % ICON_COLORS.length]
  const addr = warehouse.address
  const addressStr = addr
    ? typeof addr === 'string' ? addr : [addr.city, addr.country].filter(Boolean).join(', ')
    : null

  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: 12,
      border: '1px solid var(--border)',
      boxShadow: 'var(--card-shadow)',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: `${color}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <BankOutlined style={{ fontSize: 20, color }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{warehouse.name}</span>
            {warehouse.isDefault && (
              <span style={{ background: 'var(--badge-success-bg)', color: 'var(--badge-success-fg)', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                {t('warehouses.default')}
              </span>
            )}
          </div>
          <div style={{ marginTop: 4 }}>
            <TypeBadge type={warehouse.type} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-light)', paddingTop: 14 }}>
        {addressStr && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, width: 60, flexShrink: 0 }}>{t('warehouses.address')}</span>
            <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{addressStr}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WarehousesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState('LOCAL')
  const [address, setAddress] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouses').then((r) => r.data.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; type: string; address?: Record<string, string> }) =>
      api.post('/warehouses', data),
    onSuccess: () => {
      void message.success(t('warehouses.created'))
      queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      setShowModal(false)
      setName('')
      setType('LOCAL')
      setAddress('')
    },
    onError: () => void message.error(t('warehouses.createFailed')),
  })

  const warehouses: any[] = Array.isArray(data) ? data : (data?.items ?? [])

  function handleCreate() {
    if (!name.trim()) return void message.warning(t('warehouses.nameRequired'))
    createMutation.mutate({
      name: name.trim(),
      type,
      address: address.trim() ? { address: address.trim() } : undefined,
    })
  }

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{t('warehouses.title')}</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>{t('warehouses.subtitle')}</p>
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setShowModal(true)}
            style={{ background: 'var(--accent-gradient)', border: 'none', borderRadius: 8, height: 36, fontWeight: 600 }}
          >
            {t('warehouses.addWarehouse')}
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}><Spin size="large" /></div>
      ) : warehouses.length === 0 ? (
        <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: '64px 40px', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(204,151,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <BankOutlined style={{ fontSize: 26, color: '#cc97ff' }} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{t('warehouses.noWarehouses')}</div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>{t('warehouses.noWarehousesHint')}</div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowModal(true)}
            style={{ background: 'var(--accent-gradient)', border: 'none', borderRadius: 8 }}>
            {t('warehouses.addWarehouse')}
          </Button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 20 }}>
          {warehouses.map((wh: any, i: number) => (
            <WarehouseCard key={wh.id} warehouse={wh} index={i} t={t} />
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal
        open={showModal}
        title={t('warehouses.createTitle')}
        onCancel={() => setShowModal(false)}
        onOk={handleCreate}
        confirmLoading={createMutation.isPending}
        okText={t('common.create')}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{t('warehouses.name')} *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('warehouses.namePlaceholder')} />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{t('warehouses.type')}</label>
            <Select value={type} onChange={setType} options={TYPE_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) }))} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{t('warehouses.address')}</label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t('warehouses.addressPlaceholder')} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
