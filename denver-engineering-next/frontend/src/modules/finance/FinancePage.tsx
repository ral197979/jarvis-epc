import {
  LineChart,
  Line,
  Bar,
  ComposedChart,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip as RTooltip,
  Legend,
  CartesianGrid,
} from 'recharts'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
  Card,
  CardHeader,
  CardTitle,
  KpiCard,
  StatusChip,
  Badge,
  Button,
  Icon,
  DataTable,
  cn,
  type ColumnDef,
} from '@ds'
import {
  useEvmSummary, useEvmTrend, useWbs, useCashFlow, useDrawdowns,
  type WbsLine, type DrawdownRequest,
} from '@adapters'
import { PageHeader, CriticalAlert, AiBanner } from '../../components/shared'
import { useUi } from '../../lib/store'

export function FinancePage() {
  return (
    <div>
      <PageHeader title="Finance / EVM" subtitle="Earned value · cash flow · drawdowns" />
      <Tabs defaultValue="evm">
        <TabsList className="mb-lg">
          <TabsTrigger value="evm">EVM</TabsTrigger>
          <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
          <TabsTrigger value="drawdowns">Drawdowns</TabsTrigger>
        </TabsList>
        <TabsContent value="evm"><EvmTab /></TabsContent>
        <TabsContent value="cashflow"><CashFlowTab /></TabsContent>
        <TabsContent value="drawdowns"><DrawdownsTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function EvmTab() {
  const activeProjectId = useUi((s) => s.activeProjectId)
  const { data: evm } = useEvmSummary(activeProjectId)
  const { data: trend } = useEvmTrend(activeProjectId)
  const { data: wbs } = useWbs()

  const cols: ColumnDef<WbsLine, unknown>[] = [
    { accessorKey: 'id', header: 'WBS', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'discipline', header: 'Discipline' },
    { accessorKey: 'bac', header: 'Budget (BAC)', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'ev', header: 'Earned (EV)', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'ac', header: 'Actual (AC)', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'cpi', header: 'CPI', cell: (c) => <Indexed v={c.getValue() as number} /> },
    { accessorKey: 'spi', header: 'SPI', cell: (c) => <Indexed v={c.getValue() as number} /> },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} /> },
  ]

  return (
    <div className="space-y-lg">

      {/* EVM core metrics */}
      <div className="grid grid-cols-2 gap-md xl:grid-cols-5">
        <Metric label="Planned Value (PV)" value={evm?.pv} />
        <Metric label="Earned Value (EV)" value={evm?.ev} />
        <Metric label="Actual Cost (AC)" value={evm?.ac} />
        <Metric label="CPI" value={evm ? evm.cpi.toFixed(2) : '—'} tag={evm && evm.cpi < 1 ? 'OVER BUDGET' : 'ON BUDGET'} tone={evm && evm.cpi < 1 ? 'danger' : 'success'} />
        <Metric label="SPI" value={evm ? evm.spi.toFixed(2) : '—'} tag={evm && evm.spi < 1 ? 'BEHIND' : 'ON SCHEDULE'} tone={evm && evm.spi < 1 ? 'info' : 'success'} />
      </div>

      <div className="grid grid-cols-12 gap-lg">
        {/* Cumulative trends */}
        <Card className="col-span-12 p-lg lg:col-span-8">
          <h3 className="mb-md text-headline-sm font-bold text-primary">Cumulative Value Trends ($M)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trend ?? []}>
              <CartesianGrid stroke="#dce9ff" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <RTooltip contentStyle={{ borderRadius: 8, border: '1px solid #c5c6cd', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="pv" name="Planned Value" stroke="#64748b" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="ev" name="Earned Value" stroke="#0058be" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="ac" name="Actual Cost" stroke="#dc2626" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Forecasts */}
        <Card className="col-span-12 bg-primary p-lg text-white lg:col-span-4">
          <h3 className="mb-md text-headline-sm font-bold">Forecasts (EAC)</h3>
          <Forecast label="Estimate at Completion (EAC)" value={evm?.eac} sub="+12% vs BAC" tone="danger" />
          <Forecast label="Estimate to Complete (ETC)" value={evm?.etc} />
          <Forecast label="Variance at Completion (VAC)" value={evm?.vac} tone="danger" />
          <div className="mt-md rounded-lg border border-white/20 bg-white/10 p-3 text-body-sm">
            <Icon name="smart_toy" filled size={16} className="mr-1 align-text-bottom text-secondary-fixed" />
            I&C (WBS-400) is the primary CPI drag at 0.89. Re-baselining the loop-check scope recovers ~$0.4M.
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Discipline / WBS Breakdown</CardTitle></CardHeader>
        <DataTable columns={cols} data={wbs ?? []} stickyFirst />
      </Card>

      <CriticalAlert
        title="Critical Budget Variance Detected"
        body="Mechanical (WBS-200) and I&C (WBS-400) are trending to a combined -$1.42M variance at completion."
        action="Initiate RFC"
      />
    </div>
  )
}

function Metric({ label, value, tag, tone }: { label: string; value?: string; tag?: string; tone?: 'danger' | 'success' | 'info' }) {
  const tagColor = tone === 'danger' ? 'text-danger' : tone === 'info' ? 'text-info' : 'text-success'
  return (
    <Card className="p-lg">
      <div className="font-mono-tag text-label-md uppercase text-on-surface-variant">{label}</div>
      <div className="mt-1 text-headline-md font-bold text-primary">{value ?? '—'}</div>
      {tag && <div className={cn('mt-0.5 text-body-sm font-bold', tagColor)}>{tag}</div>}
    </Card>
  )
}

function Forecast({ label, value, sub, tone }: { label: string; value?: string; sub?: string; tone?: 'danger' }) {
  return (
    <div className="border-b border-white/10 py-2 last:border-0">
      <div className="text-body-sm text-on-primary/70">{label}</div>
      <div className="flex items-baseline justify-between">
        <span className={cn('text-headline-sm font-bold', tone === 'danger' ? 'text-error-container' : 'text-white')}>{value ?? '—'}</span>
        {sub && <span className="text-body-sm text-error-container">{sub}</span>}
      </div>
    </div>
  )
}

function Indexed({ v }: { v: number }) {
  return <span className={cn('font-mono-tag font-bold', v < 0.95 ? 'text-danger' : v < 1 ? 'text-warning' : 'text-success')}>{v.toFixed(2)}</span>
}

function CashFlowTab() {
  const { data = [] } = useCashFlow()
  const minNet = Math.min(...data.map((d) => d.net), 0)
  return (
    <div className="space-y-lg">
      <AiBanner text="Cumulative cash position is negative through Q2 (peak -$9M in May) driven by long-lead milestone payments. A drawdown against the procurement reserve smooths the trough before the deck-formwork milestone." action="Open Drawdowns" />
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Inflow (YTD)" value={`$${data.reduce((s, d) => s + d.inflow, 0)}M`} icon="south_west" trend={{ direction: 'up', label: 'milestone billing', tone: 'success' }} />
        <KpiCard label="Outflow (YTD)" value={`$${data.reduce((s, d) => s + d.outflow, 0)}M`} icon="north_east" />
        <KpiCard label="Peak Negative" value={`$${minNet}M`} icon="trending_down" critical />
        <KpiCard label="Current Net" value={`$${data.length ? data[data.length - 1].net : 0}M`} icon="account_balance_wallet" critical={(data[data.length - 1]?.net ?? 0) < 0} />
      </div>
      <Card className="p-lg">
        <h3 className="mb-md text-headline-sm font-bold text-primary">Cash Flow ($M) — Inflow vs Outflow + Net Position</h3>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data}>
            <CartesianGrid stroke="#dce9ff" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <RTooltip contentStyle={{ borderRadius: 8, border: '1px solid #c5c6cd', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="inflow" name="Inflow" fill="#16a34a" radius={[3, 3, 0, 0]} />
            <Bar dataKey="outflow" name="Outflow" fill="#0058be" radius={[3, 3, 0, 0]} />
            <Line dataKey="net" name="Net (cumulative)" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
    </div>
  )
}

const ddTone: Record<string, 'info' | 'success' | 'danger'> = { Review: 'info', Approved: 'success', Rejected: 'danger' }

function DrawdownsTab() {
  const { data = [] } = useDrawdowns()
  const review = data.filter((d) => d.status === 'Review').length
  const cols: ColumnDef<DrawdownRequest, unknown>[] = [
    { accessorKey: 'id', header: 'Request', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'description', header: 'Description' },
    { accessorKey: 'area', header: 'Impact Area' },
    { accessorKey: 'amount', header: 'Amount', cell: (c) => <span className="font-mono-tag font-semibold">{c.getValue() as string}</span> },
    { accessorKey: 'date', header: 'Date' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <Badge tone={ddTone[c.getValue() as string] ?? 'neutral'} dot>{c.getValue() as string}</Badge> },
  ]
  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Requests" value={String(data.length)} icon="request_quote" />
        <KpiCard label="Awaiting Review" value={String(review)} icon="hourglass_top" critical={review > 0} />
        <KpiCard label="Approved (YTD)" value={String(data.filter((d) => d.status === 'Approved').length)} icon="check_circle" trend={{ direction: 'up', label: 'released', tone: 'success' }} />
        <KpiCard label="Reserve Drawn" value="$13.5M" icon="payments" hint="61% utilised" />
      </div>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Drawdown Requests</CardTitle>
          <Button variant="accent" size="sm"><Icon name="add" size={18} /> New Request</Button>
        </CardHeader>
        <DataTable columns={cols} data={data} stickyFirst />
      </Card>
    </div>
  )
}
