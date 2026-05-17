import { useState } from 'react'
import { Select, Switch } from 'antd'
import { MessageOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

// ─── Types ───────────────────────────────────────────────────────────────────

interface Thread {
  id: string
  shopId: string
  buyerName: string | null
  lastMessageAt: string
  lastMessagePreview: string | null
  isRead: boolean
  tags: string[]
  shop?: { name: string; platform: string }
}

interface Message {
  id: string
  senderType: string
  senderName: string | null
  content: string
  messageType: string
  platformCreatedAt: string
}

interface Shop {
  id: string
  name: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#cc97ff', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899']

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
  const color = getAvatarColor(name)
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.36, flexShrink: 0,
    }}>
      {initials}
    </div>
  )
}

function PlatformBadge({ platform }: { platform: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    SHOPEE: { bg: '#FF6633', color: '#fff' },
    TIKTOK: { bg: '#0F172A', color: '#fff' },
    LAZADA: { bg: '#0F146D', color: '#fff' },
    MANUAL: { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)' },
  }
  const s = map[platform] ?? { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)' }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' }}>
      {platform}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InboxPage() {
  const { t } = useTranslation()
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [filterShopId, setFilterShopId] = useState<string | undefined>(undefined)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const queryClient = useQueryClient()

  const { data: shopsData } = useQuery<Shop[]>({
    queryKey: ['shops-list'],
    queryFn: () => api.get('/shops').then((r) => r.data.data?.items ?? r.data.data ?? []),
  })

  const threadsQuery = useQuery<{ items: Thread[]; total: number }>({
    queryKey: ['cs-threads', filterShopId, unreadOnly],
    queryFn: () =>
      api.get('/cs/threads', {
        params: {
          ...(filterShopId ? { shopId: filterShopId } : {}),
          ...(unreadOnly ? { isRead: 'false' } : {}),
          pageSize: 50,
        },
      }).then((r) => r.data.data),
  })

  const threads: Thread[] = threadsQuery.data?.items ?? []

  const messagesQuery = useQuery<Message[]>({
    queryKey: ['cs-messages', selectedThreadId],
    queryFn: () =>
      api.get(`/cs/threads/${selectedThreadId}/messages`).then((r) => r.data.data),
    enabled: !!selectedThreadId,
  })

  const readMutation = useMutation({
    mutationFn: (threadId: string) => api.post(`/cs/threads/${threadId}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cs-threads'] })
      queryClient.invalidateQueries({ queryKey: ['cs-messages', selectedThreadId] })
    },
  })

  const handleSelectThread = (thread: Thread) => {
    setSelectedThreadId(thread.id)
    if (!thread.isRead) readMutation.mutate(thread.id)
  }

  const selectedThread = threads.find((t) => t.id === selectedThreadId)
  const messages: Message[] = messagesQuery.data ?? []
  const noThreads = !threadsQuery.isLoading && threads.length === 0

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 16 }}>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>{t('cs.subtitle')}</p>
      </div>

      {/* Two-panel layout */}
      <div style={{
        display: 'flex',
        height: 'calc(100vh - 210px)',
        gap: 0,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid var(--border)',
      }}>
        {/* ── Left panel ── */}
        <div style={{ width: 320, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', flexShrink: 0 }}>
          {/* Filter bar */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Select
              placeholder={t('orders.allShops')}
              allowClear
              style={{ width: '100%' }}
              value={filterShopId}
              onChange={setFilterShopId}
              options={(shopsData ?? []).map((s) => ({ value: s.id, label: s.name }))}
              size="small"
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Switch size="small" checked={unreadOnly} onChange={setUnreadOnly} style={{ background: unreadOnly ? 'var(--accent-primary)' : undefined }} />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('cs.unreadOnly')}</span>
            </div>
          </div>

          {/* Thread list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {noThreads ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                <MessageOutlined style={{ fontSize: 28, display: 'block', margin: '0 auto 8px', color: 'var(--text-muted)' }} />
                {t('cs.noMessages')}
              </div>
            ) : (
              threads.map((thread) => {
                const isSelected = selectedThreadId === thread.id
                const name = thread.buyerName ?? t('cs.unknownBuyer')
                return (
                  <div
                    key={thread.id}
                    onClick={() => handleSelectThread(thread)}
                    style={{
                      padding: '12px 14px',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--bg-surface)',
                      background: isSelected ? 'var(--tab-active-bg)' : 'var(--bg-card)',
                      borderLeft: isSelected ? '3px solid var(--accent-primary)' : '3px solid transparent',
                      transition: 'background 0.1s',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <Avatar name={name} size={36} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontWeight: thread.isRead ? 500 : 700, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {name}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            {!thread.isRead && (
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-primary)' }} />
                            )}
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {dayjs(thread.lastMessageAt).fromNow()}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          {thread.shop?.platform && <PlatformBadge platform={thread.shop.platform} />}
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {thread.shop?.name ?? thread.shopId}
                          </span>
                        </div>
                        {thread.lastMessagePreview && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {thread.lastMessagePreview}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', minWidth: 0 }}>
          {selectedThread ? (
            <>
              {/* Thread header */}
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={selectedThread.buyerName ?? t('cs.unknownBuyer')} size={36} />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>
                    {selectedThread.buyerName ?? t('cs.unknownBuyer')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    {selectedThread.shop?.platform && <PlatformBadge platform={selectedThread.shop.platform} />}
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{selectedThread.shop?.name}</span>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {messagesQuery.isLoading ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 40 }}>{t('cs.loadingMessages')}</div>
                ) : messages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 40 }}>{t('cs.noMessagesInThread')}</div>
                ) : (
                  messages.map((msg) => {
                    const isSeller = msg.senderType === 'seller'
                    return (
                      <div key={msg.id} style={{ display: 'flex', justifyContent: isSeller ? 'flex-end' : 'flex-start' }}>
                        <div style={{
                          maxWidth: '68%',
                          padding: '10px 14px',
                          borderRadius: isSeller ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                          background: isSeller ? '#cc97ff' : 'var(--bg-card)',
                          color: isSeller ? '#fff' : 'var(--text-primary)',
                          boxShadow: 'var(--card-shadow)',
                          fontSize: 14,
                          lineHeight: 1.5,
                        }}>
                          {!isSeller && msg.senderName && (
                            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: 'var(--accent-primary)' }}>
                              {msg.senderName}
                            </div>
                          )}
                          <div>{msg.content}</div>
                          <div style={{ fontSize: 10, marginTop: 5, opacity: 0.6, textAlign: 'right' }}>
                            {dayjs(msg.platformCreatedAt).format('HH:mm')}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <MessageOutlined style={{ fontSize: 48, color: 'var(--text-muted)', marginBottom: 16 }} />
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>{t('cs.selectConversation')}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{t('cs.selectHint')}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
