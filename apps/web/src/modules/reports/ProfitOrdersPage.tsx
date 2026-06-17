import { Table, DatePicker, Select, Input, Button, Space, Spin, Tabs, Tag } from 'antd'
import { DollarOutlined, RiseOutlined, PercentageOutlined, ShoppingCartOutlined, SearchOutlined, BarChartOutlined } from '@ant-design/icons'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ColumnsType } from 'antd/es/table'

const { RangePicker } = DatePicker

interface ProfitRow {
  id: string
  platformOrderId: string
  shopName: string
  platform: string | null
  createdAt: string
  platformCreatedAt: string | null
  settled: boolean
  settlementAmount: number
  productAmount: number
  platformDiscount: number
  sellerDiscount: number
  buyerPaidShipping: number
  totalRevenue: number
  platformCommission: number
  referralFee: number
  transactionFee: number
  affiliateCommission: number
  refundAdminFee: number
  shippingFeeSeller: number
  cogs: number
  grossProfit: number
  grossMargin: number
}
type Totals = Omit<ProfitRow, 'id' | 'platformOrderId' | 'shopName' | 'platform' | 'createdAt' | 'platformCreatedAt' | 'settled'>

// Money columns in display order — drives both the grouped table columns and
// the totals (合计) row, so the two can never drift out of alignment.
type MoneyKey = keyof Totals
const SETTLEMENT_KEYS: MoneyKey[] = ['settlementAmount']
const SALES_KEYS: MoneyKey[] = ['totalRevenue', 'productAmount', 'platformDiscount', 'sellerDiscount', 'buyerPaidShipping']
const FEE_KEYS: MoneyKey[] = ['platformCommission', 'referralFee', 'transactionFee', 'affiliateCommission', 'refundAdminFee', 'shippingFeeSeller']
const COST_KEYS: MoneyKey[] = ['cogs']
const FLAT_MONEY_KEYS: MoneyKey[] = [...SETTLEMENT_KEYS, ...SALES_KEYS, ...FEE_KEYS, ...COST_KEYS]

function KpiCard({ title, value, prefix, accent }: { title: string; value: string; prefix: React.ReactNode; accent: string }) {
  return (
    <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--kpi-bg)', borderRadius: 16, border: 'var(--kpi-border)', backdropFilter: 'var(--kpi-backdrop)', boxShadow: 'var(--kpi-shadow)', padding: '20px 24px' }}>
      <div style={{ position: 'absolute', top: -24, right: -24, width: 96, height: 96, borderRadius: '50%', background: accent, filter: 'blur(48px)', opacity: 0.15, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{title}</span>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `${accent}22`, border: `1px solid ${accent}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: accent, fontSize: 18 }}>{prefix}</span>
        </div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, fontFamily: "'Manrope', sans-serif" }}>{value}</div>
    </div>
  )
}

const money = (v: number | undefined) => `₱ ${(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function MarginBadge({ value }: { value: number }) {
  const color = value >= 20 ? 'var(--badge-success-fg)' : value >= 10 ? 'var(--badge-warning-fg)' : 'var(--badge-error-fg)'
  const bg = value >= 20 ? 'var(--badge-success-bg)' : value >= 10 ? 'var(--badge-warning-bg)' : 'var(--badge-error-bg)'
  return <span style={{ background: bg, color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{value.toFixed(2)}%</span>
}

export default function ProfitOrdersPage() {
  const { t } = useTranslation()
  const [platform, setPlatform] = useState<'TIKTOK' | 'SHOPEE'>('TIKTOK')
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().subtract(30, 'day'), dayjs()])
  const [shopId, setShopId] = useState<string | undefined>(undefined)
  const [settled, setSettled] = useState<'true' | 'false' | undefined>(undefined)
  const [sku, setSku] = useState('')
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState({ sku: '', search: '' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const { data: shops = [] } = useQuery({
    queryKey: ['shops'],
    queryFn: () => api.get('/shops').then((r) => r.data.data as Array<{ id: string; name: string; platform: string }>),
  })

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['reports-profit-orders', platform, dateRange[0].format('YYYY-MM-DD'), dateRange[1].format('YYYY-MM-DD'), shopId, settled, applied.sku, applied.search, page, pageSize],
    queryFn: () =>
      api.get('/reports/profit-orders', {
        params: {
          platform,
          dateFrom: dateRange[0].startOf('day').toISOString(),
          dateTo: dateRange[1].endOf('day').toISOString(),
          shopId,
          settled,
          sku: applied.sku || undefined,
          search: applied.search || undefined,
          page,
          pageSize,
        },
      }).then((r) => r.data.data as { items: ProfitRow[]; totals: Totals; total: number; page: number; pageSize: number; totalPages: number }),
    placeholderData: keepPreviousData,
  })

  const rows = data?.items ?? []
  const totals = data?.totals
  const platformShops = shops.filter((s) => s.platform === platform)

  const applyFilters = () => { setPage(1); setApplied({ sku: sku.trim(), search: search.trim() }) }
  const resetFilters = () => {
    setDateRange([dayjs().subtract(30, 'day'), dayjs()])
    setShopId(undefined); setSettled(undefined); setSku(''); setSearch(''); setApplied({ sku: '', search: '' }); setPage(1)
  }

  const numCol = (key: MoneyKey, opts: { strong?: boolean } = {}) => ({
    title: t(`profitReport.${key}`),
    dataIndex: key,
    width: 130,
    align: 'right' as const,
    render: (v: number) => <span style={{ color: 'var(--text-primary)', fontWeight: opts.strong ? 700 : 400 }}>{money(v)}</span>,
  })

  const columns: ColumnsType<ProfitRow> = [
    {
      title: t('profitReport.platformOrderId'),
      dataIndex: 'platformOrderId',
      width: 210,
      fixed: 'left',
      render: (v: string, r: ProfitRow) => (
        <span>
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--accent-primary)' }}>{v}</span>
          {!r.settled && <Tag style={{ marginLeft: 6, fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>{t('profitReport.estimated')}</Tag>}
        </span>
      ),
    },
    { title: t('profitReport.shop'), dataIndex: 'shopName', width: 160, render: (v: string) => <span style={{ color: 'var(--text-primary)' }}>{v}</span> },
    {
      title: t('profitReport.payoutTime'), dataIndex: 'platformCreatedAt', width: 150,
      render: (_: unknown, r: ProfitRow) => <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{dayjs(r.platformCreatedAt ?? r.createdAt).format('YYYY-MM-DD HH:mm')}</span>,
    },
    { title: t('profitReport.groupSettlement'), children: [numCol('settlementAmount', { strong: true })] },
    { title: t('profitReport.groupSales'), children: SALES_KEYS.map((k) => numCol(k, { strong: k === 'totalRevenue' })) },
    { title: t('profitReport.groupFees'), children: FEE_KEYS.map((k) => numCol(k)) },
    { title: t('profitReport.groupCost'), children: COST_KEYS.map((k) => numCol(k)) },
    {
      title: t('profitReport.groupProfit'),
      children: [
        {
          title: t('profitReport.grossProfit'), dataIndex: 'grossProfit', width: 140, align: 'right' as const, fixed: 'right' as const,
          sorter: (a: ProfitRow, b: ProfitRow) => a.grossProfit - b.grossProfit,
          render: (v: number) => <span style={{ color: v >= 0 ? 'var(--badge-success-fg)' : 'var(--badge-error-fg)', fontWeight: 700 }}>{money(v)}</span>,
        },
        {
          title: t('profitReport.grossMargin'), dataIndex: 'grossMargin', width: 110, align: 'right' as const, fixed: 'right' as const,
          sorter: (a: ProfitRow, b: ProfitRow) => a.grossMargin - b.grossMargin,
          render: (v: number) => <MarginBadge value={v ?? 0} />,
        },
      ],
    },
  ]

  return (
    <div>
      <Tabs
        activeKey={platform}
        onChange={(k) => { setPlatform(k as 'TIKTOK' | 'SHOPEE'); setShopId(undefined); setPage(1) }}
        items={[{ key: 'TIKTOK', label: 'TikTok' }, { key: 'SHOPEE', label: 'Shopee' }]}
        style={{ marginBottom: 8 }}
      />

      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, marginBottom: 16 }}>
        <Space wrap size={12}>
          <RangePicker value={dateRange} allowClear={false} onChange={(vals) => { if (vals && vals[0] && vals[1]) { setDateRange([vals[0], vals[1]]); setPage(1) } }} />
          <Select allowClear placeholder={t('profitReport.allShops')} style={{ minWidth: 200 }} value={shopId} onChange={(v) => { setShopId(v); setPage(1) }} options={platformShops.map((s) => ({ value: s.id, label: s.name }))} />
          <Select
            allowClear
            placeholder={t('profitReport.settleStatus')}
            style={{ minWidth: 140 }}
            value={settled}
            onChange={(v) => { setSettled(v); setPage(1) }}
            options={[
              { value: 'true', label: t('profitReport.settled') },
              { value: 'false', label: t('profitReport.unsettled') },
            ]}
          />
          <Input placeholder={t('profitReport.skuPlaceholder')} style={{ width: 160 }} value={sku} onChange={(e) => setSku(e.target.value)} onPressEnter={applyFilters} allowClear />
          <Input placeholder={t('profitReport.orderPlaceholder')} style={{ width: 200 }} value={search} onChange={(e) => setSearch(e.target.value)} onPressEnter={applyFilters} allowClear />
          <Button type="primary" icon={<SearchOutlined />} onClick={applyFilters}>{t('common.search')}</Button>
          <Button onClick={resetFilters}>{t('common.reset')}</Button>
        </Space>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
        <KpiCard title={t('profitReport.totalRevenue')} value={money(totals?.totalRevenue)} prefix={<DollarOutlined />} accent="var(--accent-primary)" />
        <KpiCard title={t('profitReport.cogs')} value={money(totals?.cogs)} prefix={<ShoppingCartOutlined />} accent="#F59E0B" />
        <KpiCard title={t('profitReport.grossProfit')} value={money(totals?.grossProfit)} prefix={<RiseOutlined />} accent="#10B981" />
        <KpiCard title={t('profitReport.grossMargin')} value={`${(totals?.grossMargin ?? 0).toFixed(2)}%`} prefix={<PercentageOutlined />} accent={(totals?.grossMargin ?? 0) >= 20 ? '#10B981' : (totals?.grossMargin ?? 0) >= 10 ? '#F59E0B' : '#EF4444'} />
      </div>

      {/* No overflow:hidden here — a clipping ancestor would break the table's
          position:sticky header. Corner rounding is handled by the inner Table. */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}><Spin size="large" /></div>
        ) : (
          <Table<ProfitRow>
            rowKey="id"
            columns={columns}
            dataSource={rows}
            size="middle"
            loading={isFetching}
            scroll={{ x: 'max-content' }}
            // Pin the (grouped) header below the app's 64px sticky top bar while
            // the page scrolls. Window is the scroll container here.
            sticky={{ offsetHeader: 64 }}
            pagination={{
              current: data?.page ?? 1,
              pageSize: data?.pageSize ?? pageSize,
              total: data?.total ?? 0,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100, 200],
              onChange: (p, ps) => { setPage(p); setPageSize(ps) },
              showTotal: (tot) => t('profitReport.totalRecords', { count: tot }),
              style: { padding: '12px 20px' },
            }}
            summary={() => totals ? (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={3}><strong>{t('profitReport.totalRow')}</strong></Table.Summary.Cell>
                  {FLAT_MONEY_KEYS.map((k, i) => (
                    <Table.Summary.Cell key={k} index={3 + i} align="right">
                      <span style={{ fontWeight: k === 'settlementAmount' || k === 'totalRevenue' ? 700 : 400 }}>{money(totals[k])}</span>
                    </Table.Summary.Cell>
                  ))}
                  <Table.Summary.Cell index={3 + FLAT_MONEY_KEYS.length} align="right">
                    <strong style={{ color: totals.grossProfit >= 0 ? 'var(--badge-success-fg)' : 'var(--badge-error-fg)' }}>{money(totals.grossProfit)}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4 + FLAT_MONEY_KEYS.length} align="right"><strong>{(totals.grossMargin ?? 0).toFixed(2)}%</strong></Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            ) : null}
            locale={{
              emptyText: (
                <div style={{ padding: '48px 0', textAlign: 'center' }}>
                  <BarChartOutlined style={{ fontSize: 40, color: 'var(--text-muted)', display: 'block', margin: '0 auto 12px' }} />
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>{t('profitReport.empty')}</div>
                </div>
              ),
            }}
          />
        )}
      </div>
    </div>
  )
}
