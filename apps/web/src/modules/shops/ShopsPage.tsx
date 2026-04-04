import { useEffect, useState } from 'react'
import { Button, Dropdown, Space, message, Spin } from 'antd'
import {
  SyncOutlined, ShopOutlined, DownOutlined, MoreOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    ACTIVE:       { bg: '#D1FAE5', color: '#065F46', label: 'Active' },
    INACTIVE:     { bg: '#F1F5F9', color: '#475569', label: 'Inactive' },
    AUTH_EXPIRED: { bg: '#FEF3C7', color: '#92400E', label: 'Auth Expired' },
  }
  const s = map[status] ?? { bg: '#F1F5F9', color: '#475569', label: status }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

const PLATFORM_COLORS: Record<string, { bg: string; accent: string; text: string }> = {
  SHOPEE: { bg: '#FF6633', accent: '#E55525', text: '#fff' },
  TIKTOK: { bg: '#0F172A', accent: '#1E293B', text: '#fff' },
  LAZADA: { bg: '#0F146D', accent: '#1A1F8A', text: '#fff' },
}

function getPlatformStyle(platform: string) {
  return PLATFORM_COLORS[platform] ?? { bg: '#6366F1', accent: '#4F46E5', text: '#fff' }
}

// ─── Shop Card ───────────────────────────────────────────────────────────────

function ShopCard({ shop, onSync, syncing }: { shop: any; onSync: () => void; syncing: boolean }) {
  const ps = getPlatformStyle(shop.platform)

  const menuItems = [
    { key: 'edit', label: 'Edit Shop' },
    { key: 'disconnect', label: 'Disconnect', danger: true },
  ]

  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: 12,
      border: '1px solid var(--border)',
      overflow: 'hidden',
      boxShadow: 'var(--card-shadow)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Card header strip */}
      <div style={{ background: ps.bg, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShopOutlined style={{ fontSize: 18, color: ps.text }} />
          </div>
          <div>
            <div style={{ color: ps.text, fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{shop.name}</div>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 }}>{shop.platform}</div>
          </div>
        </div>
        <StatusBadge status={shop.status} />
      </div>

      {/* Card body */}
      <div style={{ padding: '16px 20px', flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>Shop ID</span>
            <span style={{ fontSize: 13, color: '#374151', fontFamily: "'Courier New', monospace" }}>
              {shop.externalShopId ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>Last Sync</span>
            <span style={{ fontSize: 13, color: '#374151' }}>
              {shop.lastSyncAt ? dayjs(shop.lastSyncAt).fromNow() : <span style={{ color: 'var(--text-muted)' }}>Never</span>}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>Token Expires</span>
            <span style={{ fontSize: 13, color: shop.tokenExpiresAt && dayjs(shop.tokenExpiresAt).isBefore(dayjs().add(7, 'day')) ? '#F59E0B' : '#374151' }}>
              {shop.tokenExpiresAt ? dayjs(shop.tokenExpiresAt).format('MMM D, YYYY') : <span style={{ color: 'var(--text-muted)' }}>—</span>}
            </span>
          </div>
        </div>
      </div>

      {/* Card footer */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#FAFAFA' }}>
        <Button
          size="small"
          icon={<SyncOutlined spin={syncing} />}
          loading={syncing}
          onClick={onSync}
          style={{ borderRadius: 8, fontWeight: 500, height: 32 }}
        >
          Sync Now
        </Button>
        <Dropdown menu={{ items: menuItems }} placement="bottomRight" trigger={['click']}>
          <Button type="text" size="small" icon={<MoreOutlined />} style={{ color: 'var(--text-secondary)' }} />
        </Dropdown>
      </div>
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: '64px 40px', textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
        <ShopOutlined style={{ fontSize: 28, color: '#6366F1' }} />
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>No shops connected</div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24, maxWidth: 340, margin: '0 auto 24px' }}>
        Connect your Shopee or TikTok shop to start syncing orders and products.
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {['SHOPEE', 'TIKTOK', 'LAZADA'].map((p) => {
          const ps = getPlatformStyle(p)
          return (
            <div key={p} style={{ background: ps.bg, color: ps.text, padding: '6px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
              {p}
            </div>
          )
        })}
      </div>
      <Button
        type="primary"
        icon={<ThunderboltOutlined />}
        size="large"
        onClick={onConnect}
        style={{ marginTop: 24, background: '#6366F1', border: 'none', borderRadius: 8, fontWeight: 500 }}
      >
        Connect a Shop
      </Button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ShopsPage() {
  const queryClient = useQueryClient()
  const [connectingShopee, setConnectingShopee] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['shops'],
    queryFn: () => api.get('/shops').then((r) => r.data.data),
  })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected') === 'true') {
      void message.success('Shopee shop connected successfully!')
      queryClient.invalidateQueries({ queryKey: ['shops'] })
      window.history.replaceState({}, '', window.location.pathname)
    } else if (params.get('error') === 'oauth_failed') {
      void message.error('Failed to connect Shopee shop. Please try again.')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [queryClient])

  const syncMutation = useMutation({
    mutationFn: (shopId: string) => api.post(`/shops/${shopId}/sync`),
    onSuccess: () => void message.success('Sync job queued'),
    onError: () => void message.error('Failed to queue sync'),
  })

  async function handleConnectShopee() {
    setConnectingShopee(true)
    try {
      const res = await api.get('/shops/shopee/connect')
      const url: string = res.data.data.url
      window.location.href = url
    } catch {
      void message.error('Failed to get Shopee connect URL')
      setConnectingShopee(false)
    }
  }

  const shops: any[] = Array.isArray(data) ? data : (data?.items ?? [])

  const connectMenu = {
    items: [
      { key: 'shopee', label: 'Connect Shopee', onClick: handleConnectShopee },
      { key: 'tiktok', label: 'Connect TikTok', disabled: true },
    ],
  }

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Connected Shops</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>Manage your platform store connections</p>
          </div>
          <Space>
            <Dropdown menu={connectMenu} placement="bottomRight" trigger={['click']}>
              <Button
                type="primary"
                loading={connectingShopee}
                style={{ background: '#6366F1', border: 'none', borderRadius: 8, height: 36, fontWeight: 500, fontSize: 14 }}
              >
                Connect Shop <DownOutlined style={{ fontSize: 11 }} />
              </Button>
            </Dropdown>
          </Space>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <Spin size="large" />
        </div>
      ) : shops.length === 0 ? (
        <EmptyState onConnect={handleConnectShopee} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {shops.map((shop: any) => (
            <ShopCard
              key={shop.id}
              shop={shop}
              onSync={() => syncMutation.mutate(shop.id)}
              syncing={syncMutation.isPending && syncMutation.variables === shop.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
