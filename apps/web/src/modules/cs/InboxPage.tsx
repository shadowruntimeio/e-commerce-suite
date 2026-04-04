import { useState } from 'react'
import { Alert, Badge, Button, Select, Switch, Typography } from 'antd'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

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

export default function InboxPage() {
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
      api
        .get('/cs/threads', {
          params: {
            ...(filterShopId ? { shopId: filterShopId } : {}),
            ...(unreadOnly ? { isRead: 'false' } : {}),
            pageSize: 50,
          },
        })
        .then((r) => r.data.data),
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
    if (!thread.isRead) {
      readMutation.mutate(thread.id)
    }
  }

  const selectedThread = threads.find((t) => t.id === selectedThreadId)
  const messages: Message[] = messagesQuery.data ?? []
  const noThreads = !threadsQuery.isLoading && threads.length === 0

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 112px)', gap: 0, border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
      {/* Left Panel */}
      <div style={{ width: 300, borderRight: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', background: '#fff' }}>
        {/* Filter Bar */}
        <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Select
            placeholder="All shops"
            allowClear
            style={{ width: '100%' }}
            value={filterShopId}
            onChange={setFilterShopId}
            options={(shopsData ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch size="small" checked={unreadOnly} onChange={setUnreadOnly} />
            <span style={{ fontSize: 13 }}>Unread only</span>
          </div>
        </div>

        {/* Thread List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {noThreads ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#8c8c8c', fontSize: 13 }}>
              No messages yet. Connect a shop to start syncing messages.
            </div>
          ) : (
            threads.map((thread) => (
              <div
                key={thread.id}
                onClick={() => handleSelectThread(thread)}
                style={{
                  padding: '10px 14px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f5f5f5',
                  background: selectedThreadId === thread.id ? '#e6f4ff' : '#fff',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography.Text strong style={{ fontSize: 13 }}>
                    {!thread.isRead && (
                      <Badge dot style={{ marginRight: 6 }} />
                    )}
                    {thread.buyerName ?? 'Unknown Buyer'}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {dayjs(thread.lastMessageAt).fromNow()}
                  </Typography.Text>
                </div>
                <div style={{ fontSize: 12, color: '#595959', marginTop: 2 }}>
                  {thread.shop?.name ?? thread.shopId}
                </div>
                {thread.lastMessagePreview && (
                  <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {thread.lastMessagePreview}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fafafa' }}>
        {selectedThread ? (
          <>
            {/* Thread Header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', background: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Typography.Text strong>{selectedThread.buyerName ?? 'Unknown Buyer'}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                — {selectedThread.shop?.name}
              </Typography.Text>
              {!selectedThread.isRead && (
                <Button size="small" onClick={() => readMutation.mutate(selectedThread.id)}>
                  Mark as Read
                </Button>
              )}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messagesQuery.isLoading ? (
                <div style={{ textAlign: 'center', color: '#8c8c8c' }}>Loading messages...</div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#8c8c8c' }}>No messages in this thread</div>
              ) : (
                messages.map((msg) => {
                  const isSeller = msg.senderType === 'seller'
                  return (
                    <div
                      key={msg.id}
                      style={{
                        display: 'flex',
                        justifyContent: isSeller ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          maxWidth: '70%',
                          padding: '8px 12px',
                          borderRadius: isSeller ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                          background: isSeller ? '#1677ff' : '#fff',
                          color: isSeller ? '#fff' : '#000',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                          fontSize: 13,
                        }}
                      >
                        {!isSeller && msg.senderName && (
                          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2, color: '#595959' }}>
                            {msg.senderName}
                          </div>
                        )}
                        <div>{msg.content}</div>
                        <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7, textAlign: 'right' }}>
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
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8c8c8c' }}>
            {noThreads ? (
              <Alert
                type="info"
                showIcon
                message="No messages yet"
                description="Connect a shop to start syncing messages."
              />
            ) : (
              <span>Select a conversation to view messages</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
