import { Button, Spin } from 'antd'
import { PlusOutlined, BankOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'

// ─── Type badge ──────────────────────────────────────────────────────────────

const TYPE_MAP: Record<string, { bg: string; color: string }> = {
  OWNED:    { bg: '#EEF2FF', color: '#4338CA' },
  RENTED:   { bg: '#F5F3FF', color: '#5B21B6' },
  BONDED:   { bg: '#ECFDF5', color: '#065F46' },
  VIRTUAL:  { bg: '#F1F5F9', color: '#475569' },
}

function TypeBadge({ type }: { type: string }) {
  const s = TYPE_MAP[type] ?? { bg: '#F1F5F9', color: '#475569' }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
      {type}
    </span>
  )
}

// ─── Warehouse Card ───────────────────────────────────────────────────────────

const ICON_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4']

function WarehouseCard({ warehouse, index }: { warehouse: any; index: number }) {
  const color = ICON_COLORS[index % ICON_COLORS.length]

  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      border: '1px solid #E2E8F0',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: `${color}18`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <BankOutlined style={{ fontSize: 20, color }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{warehouse.name}</span>
            {warehouse.isDefault && (
              <span style={{ background: '#D1FAE5', color: '#065F46', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                Default
              </span>
            )}
          </div>
          <div style={{ marginTop: 4 }}>
            <TypeBadge type={warehouse.type} />
          </div>
        </div>
      </div>

      {/* Details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #F1F5F9', paddingTop: 14 }}>
        {warehouse.address && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 500, width: 60, flexShrink: 0 }}>Address</span>
            <span style={{ fontSize: 13, color: '#374151' }}>{warehouse.address}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 500, width: 60, flexShrink: 0 }}>SKUs</span>
          <span style={{ background: '#F1F5F9', color: '#475569', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
            0
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WarehousesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouses').then((r) => r.data.data),
  })

  const warehouses: any[] = Array.isArray(data) ? data : (data?.items ?? [])

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#0F172A' }}>Warehouses</h1>
            <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: 14 }}>Manage your storage locations and stock</p>
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            style={{ background: '#6366F1', border: 'none', borderRadius: 8, height: 36, fontWeight: 500, fontSize: 14 }}
          >
            Add Warehouse
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <Spin size="large" />
        </div>
      ) : warehouses.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', padding: '64px 40px', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <BankOutlined style={{ fontSize: 26, color: '#6366F1' }} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#0F172A', marginBottom: 6 }}>No warehouses yet</div>
          <div style={{ fontSize: 14, color: '#64748B' }}>Add your first warehouse to start tracking inventory</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 20 }}>
          {warehouses.map((wh: any, i: number) => (
            <WarehouseCard key={wh.id} warehouse={wh} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
