import { useEffect, useState } from 'react'
import { Button, Dropdown, Space, message, Spin, Input, Form } from 'antd'
import {
  SyncOutlined, ShopOutlined, DownOutlined, MoreOutlined,
  ThunderboltOutlined, KeyOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { useAuthStore, isMerchant } from '../../store/auth.store'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const map: Record<string, { bg: string; color: string; label: string }> = {
    ACTIVE:       { bg: 'var(--badge-success-bg)', color: 'var(--badge-success-fg)', label: t('shops.statusActive') },
    INACTIVE:     { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', label: t('shops.statusInactive') },
    AUTH_EXPIRED: { bg: 'var(--badge-warning-bg)', color: 'var(--badge-warning-fg)', label: t('shops.statusAuthExpired') },
  }
  const s = map[status] ?? { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', label: status }
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
  return PLATFORM_COLORS[platform] ?? { bg: '#9c48ea', accent: '#cc97ff', text: '#fff' }
}

// ─── Shop Card ───────────────────────────────────────────────────────────────

function ShopCard({ shop, onSync, syncing, onDisconnect }: { shop: any; onSync: () => void; syncing: boolean; onDisconnect: () => void }) {
  const { t } = useTranslation()
  const ps = getPlatformStyle(shop.platform)

  const menuItems = [
    { key: 'edit', label: t('shops.editShop') },
    { key: 'disconnect', label: t('shops.disconnect'), danger: true, onClick: onDisconnect },
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
      <div style={{ background: ps.bg, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ShopOutlined style={{ fontSize: 18, color: ps.text }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: ps.text, fontWeight: 700, fontSize: 15, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shop.name}</div>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 }}>{shop.platform}</div>
          </div>
        </div>
        <StatusBadge status={shop.status} />
      </div>

      {/* Card body */}
      <div style={{ padding: '16px 20px', flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{t('shops.shopId')}</span>
            <span style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: "'Courier New', monospace" }}>
              {shop.externalShopId ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{t('shops.lastSync')}</span>
            <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
              {shop.lastSyncAt ? dayjs(shop.lastSyncAt).fromNow() : <span style={{ color: 'var(--text-muted)' }}>{t('shops.never')}</span>}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{t('shops.tokenExpires')}</span>
            <span style={{ fontSize: 13, color: shop.tokenExpiresAt && dayjs(shop.tokenExpiresAt).isBefore(dayjs().add(7, 'day')) ? '#F59E0B' : '#374151' }}>
              {shop.tokenExpiresAt ? dayjs(shop.tokenExpiresAt).format('MMM D, YYYY') : <span style={{ color: 'var(--text-muted)' }}>—</span>}
            </span>
          </div>
        </div>
      </div>

      {/* Card footer */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-surface)' }}>
        <Button
          size="small"
          icon={<SyncOutlined spin={syncing} />}
          loading={syncing}
          onClick={onSync}
          style={{ borderRadius: 8, fontWeight: 500, height: 32 }}
        >
          {t('common.syncNow')}
        </Button>
        <Dropdown menu={{ items: menuItems }} placement="bottomRight" trigger={['click']}>
          <Button type="text" size="small" icon={<MoreOutlined />} style={{ color: 'var(--text-secondary)' }} />
        </Dropdown>
      </div>
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ onConnectShopee, onConnectTikTok }: { onConnectShopee: () => void; onConnectTikTok: () => void }) {
  const { t } = useTranslation()
  const platforms = [
    { key: 'SHOPEE', onClick: onConnectShopee },
    { key: 'TIKTOK', onClick: onConnectTikTok },
  ]

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: '64px 40px', textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: 'rgba(204,151,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
        <ShopOutlined style={{ fontSize: 28, color: '#cc97ff' }} />
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{t('shops.noShops')}</div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24, maxWidth: 340, margin: '0 auto 24px' }}>
        {t('shops.noShopsHint')}
      </div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        {platforms.map(({ key, onClick }) => {
          const ps = getPlatformStyle(key)
          return (
            <Button
              key={key}
              size="large"
              onClick={onClick}
              style={{ background: ps.bg, color: ps.text, border: 'none', borderRadius: 8, fontWeight: 600, height: 40, paddingInline: 24 }}
            >
              {t('shops.connectPlatform', { platform: key.charAt(0) + key.slice(1).toLowerCase() })}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

// ─── TikTok app credentials card (merchant-only) ─────────────────────────────
// Each merchant owns their own TikTok partner app and configures its key/secret
// here. Stored on user.settings.tiktok; secret encrypted server-side.

function TikTokAppCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [appKey, setAppKey] = useState('')
  const [appSecret, setAppSecret] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['tiktok-app'],
    queryFn: () => api.get('/shops/tiktok/app').then((r) => r.data.data as { appKey: string; hasAppSecret: boolean }),
  })

  useEffect(() => {
    if (data) {
      setAppKey(data.appKey ?? '')
      setAppSecret('') // never prefill the secret
    }
  }, [data])

  const saveMutation = useMutation({
    mutationFn: (body: { appKey: string; appSecret?: string }) => api.put('/shops/tiktok/app', body),
    onSuccess: () => {
      void message.success(t('shops.tiktokAppSaved'))
      queryClient.invalidateQueries({ queryKey: ['tiktok-app'] })
      setEditing(false)
      setAppSecret('')
    },
    onError: (err: any) => {
      void message.error(err?.response?.data?.error ?? t('shops.tiktokAppSaveFailed'))
    },
  })

  const configured = !!data?.appKey && !!data?.hasAppSecret

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '16px 20px',
      marginBottom: 20,
      boxShadow: 'var(--card-shadow)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(204,151,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <KeyOutlined style={{ fontSize: 18, color: '#cc97ff' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{t('shops.tiktokAppTitle')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {isLoading ? '…' : configured
                ? t('shops.tiktokAppConfigured', { appKey: data!.appKey })
                : t('shops.tiktokAppNotConfigured')}
            </div>
          </div>
        </div>
        {!editing && (
          <Button size="small" onClick={() => setEditing(true)} style={{ borderRadius: 8 }}>
            {configured ? t('common.edit') : t('shops.tiktokAppConfigure')}
          </Button>
        )}
      </div>

      {editing && (
        <Form
          layout="vertical"
          onFinish={() => {
            const body: { appKey: string; appSecret?: string } = { appKey: appKey.trim() }
            if (appSecret.trim()) body.appSecret = appSecret.trim()
            saveMutation.mutate(body)
          }}
          style={{ marginTop: 16 }}
        >
          <Form.Item label={t('shops.tiktokAppKey')} required>
            <Input value={appKey} onChange={(e) => setAppKey(e.target.value)} placeholder="e.g. 6jo845bnqg9jg" autoComplete="off" />
          </Form.Item>
          <Form.Item
            label={t('shops.tiktokAppSecret')}
            help={configured ? t('shops.tiktokAppSecretHelp') : undefined}
            required={!configured}
          >
            <Input.Password
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={configured ? '••••••••' : t('shops.tiktokAppSecretPlaceholder')}
              autoComplete="new-password"
            />
          </Form.Item>
          <Space>
            {(() => {
              const disabled = !appKey.trim() || (!configured && !appSecret.trim())
              return (
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={saveMutation.isPending}
                  disabled={disabled}
                  // When disabled, fall back to antd's default styling so the
                  // text doesn't render dark-on-dark against the gradient.
                  style={disabled ? undefined : { background: 'var(--accent-gradient)', border: 'none', color: '#fff' }}
                >
                  {t('common.save')}
                </Button>
              )
            })()}
            <Button onClick={() => { setEditing(false); setAppSecret(''); setAppKey(data?.appKey ?? '') }}>{t('common.cancel')}</Button>
          </Space>
        </Form>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ShopsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [connectingShopee, setConnectingShopee] = useState(false)
  const [connectingTikTok, setConnectingTikTok] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['shops'],
    queryFn: () => api.get('/shops').then((r) => r.data.data),
  })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected') === 'true') {
      void message.success(t('shops.connectedSuccess'))
      queryClient.invalidateQueries({ queryKey: ['shops'] })
      window.history.replaceState({}, '', window.location.pathname)
    } else if (params.get('error') === 'oauth_failed') {
      void message.error(t('shops.connectedFailed'))
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [queryClient])

  const syncMutation = useMutation({
    mutationFn: (shopId: string) => api.post(`/shops/${shopId}/sync`),
    onSuccess: () => void message.success(t('shops.syncQueued')),
    onError: () => void message.error(t('shops.syncFailed')),
  })

  const disconnectMutation = useMutation({
    mutationFn: (shopId: string) => api.delete(`/shops/${shopId}`),
    onSuccess: () => {
      void message.success(t('shops.disconnected'))
      queryClient.invalidateQueries({ queryKey: ['shops'] })
    },
    onError: () => void message.error(t('shops.disconnectFailed')),
  })

  async function handleConnectShopee() {
    setConnectingShopee(true)
    try {
      const res = await api.get('/shops/shopee/connect')
      const url: string = res.data.data.url
      window.location.href = url
    } catch {
      void message.error(t('shops.connectShopeeError'))
      setConnectingShopee(false)
    }
  }

  async function handleConnectTikTok() {
    setConnectingTikTok(true)
    try {
      const res = await api.get('/shops/tiktok/connect')
      const url: string = res.data.data.url
      window.location.href = url
    } catch (err: any) {
      const code = err?.response?.data?.error
      if (code === 'TIKTOK_APP_NOT_CONFIGURED') {
        void message.error(t('shops.tiktokAppRequired'))
      } else {
        void message.error(t('shops.connectTiktokError'))
      }
      setConnectingTikTok(false)
    }
  }

  const shops: any[] = Array.isArray(data) ? data : (data?.items ?? [])

  const connectMenu = {
    items: [
      { key: 'shopee', label: t('shops.connectShopee'), onClick: handleConnectShopee },
      { key: 'tiktok', label: t('shops.connectTiktok'), onClick: handleConnectTikTok },
    ],
  }

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>{t('shops.subtitle')}</p>
          </div>
          <Space>
            <Dropdown menu={connectMenu} placement="bottomRight" trigger={['click']}>
              <Button
                type="primary"
                loading={connectingShopee || connectingTikTok}
                style={{ background: 'var(--accent-gradient)', border: 'none', borderRadius: 8, height: 36, fontWeight: 500, fontSize: 14 }}
              >
                {t('shops.connectShop')} <DownOutlined style={{ fontSize: 11 }} />
              </Button>
            </Dropdown>
          </Space>
        </div>
      </div>

      {/* Per-merchant TikTok app config */}
      {isMerchant(user) && <TikTokAppCard />}

      {/* Content */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <Spin size="large" />
        </div>
      ) : shops.length === 0 ? (
        <EmptyState onConnectShopee={handleConnectShopee} onConnectTikTok={handleConnectTikTok} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {shops.map((shop: any) => (
            <ShopCard
              key={shop.id}
              shop={shop}
              onSync={() => syncMutation.mutate(shop.id)}
              syncing={syncMutation.isPending && syncMutation.variables === shop.id}
              onDisconnect={() => disconnectMutation.mutate(shop.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
