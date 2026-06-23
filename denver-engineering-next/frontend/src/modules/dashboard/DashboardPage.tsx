import { useNavigate } from 'react-router-dom'
import {
  BarChart,
  Bar,
  XAxis,
  ResponsiveContainer,
  Tooltip as RTooltip,
  Legend,
  CartesianGrid,
} from 'recharts'
import {
  KpiCard,
  Card,
  CardHeader,
  CardTitle,
  Badge,
  StatusChip,
  Button,
  Icon,
  DataTable,
  type ColumnDef,
} from '@ds'
import {
  usePortfolioKpis,
  useProjects,
  usePortfolioInsights,
  usePortfolioRisks,
  useEvmTrend,
  type Project,
} from '@adapters'

export function DashboardPage() {
  const navigate = useNavigate()
  const { data: kpis } = usePortfolioKpis()
  const { data: projects } = useProjects()
  const { data: insights } = usePortfolioInsights()
  const { data: risks } = usePortfolioRisks()
  const { data: trend } = useEvmTrend()
  const revenueData = (trend ?? []).map((d) => ({ month: d.month.toUpperCase(), Revenue: Math.round(d.ev * 90), Cost: Math.round(d.ac * 78) }))

  const columns: ColumnDef<Project, unknown>[] = [
    { accessorKey: 'code', header: 'Project ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'budgetStatus', header: 'Budget', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'scheduleStatus', header: 'Schedule', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'safetyStatus', header: 'Safety', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'qualityPct', header: 'Quality', cell: (c) => <Badge tone="success">{c.getValue() as number}%</Badge> },
    {
      id: 'action',
      header: 'Action',
      cell: (c) => (
        <button onClick={() => navigate(`/projects/${c.row.original.id}`)} className="font-semibold text-secondary hover:underline">
          View Details
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-lg">
      {/* KPI row */}
      <div className="grid grid-cols-1 gap-md md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Contract Value" value={kpis?.totalContractValue ?? '—'} icon="payments" trend={{ direction: 'up', label: '+12% from Q3', tone: 'success' }} />
        <KpiCard label="Actual Cost" value={kpis?.actualCost ?? '—'} icon="account_balance" hint={kpis?.actualCostPct} />
        <KpiCard label="Revenue (YTD)" value={kpis?.revenueYtd ?? '—'} icon="insights" trend={{ direction: 'flat', label: 'On Target', tone: 'success' }} />
        <KpiCard label="Variance (CV)" value={kpis?.costVariance ?? '—'} icon="warning" critical trend={{ direction: 'down', label: kpis?.costVariancePct ?? '', tone: 'danger' }} />
      </div>

      {/* Bento grid */}
      <div className="grid grid-cols-12 gap-lg">
        <div className="col-span-12 space-y-lg lg:col-span-8">
          {/* Portfolio map */}
          <Card className="flex h-[360px] flex-col overflow-hidden">
            <CardHeader>
              <CardTitle>Active Projects Portfolio</CardTitle>
              <div className="flex gap-3 text-body-sm font-semibold">
                <span className="flex items-center gap-1 text-success"><span className="h-2 w-2 rounded-full bg-success" /> {kpis?.onTrack ?? 0} On Track</span>
                <span className="flex items-center gap-1 text-danger"><span className="h-2 w-2 rounded-full bg-danger" /> {kpis?.atRisk ?? 0} At Risk</span>
              </div>
            </CardHeader>
            <div className="relative flex-1 bg-[radial-gradient(circle_at_30%_30%,#dce9ff,transparent_60%),radial-gradient(circle_at_70%_70%,#e5eeff,transparent_55%)]">
              <div className="absolute inset-0 opacity-[0.15]" style={{ backgroundImage: 'linear-gradient(#091426 1px,transparent 1px),linear-gradient(90deg,#091426 1px,transparent 1px)', backgroundSize: '32px 32px' }} />
              {projects?.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => navigate(`/projects/${p.id}`)}
                  title={`${p.name} · ${p.region}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${15 + i * 17}%`, top: `${30 + (i % 3) * 18}%` }}
                >
                  <span className={`block h-3.5 w-3.5 rounded-full ring-4 ring-white ${p.health === 'critical' ? 'bg-danger' : p.health === 'at-risk' ? 'bg-warning' : 'bg-success'} animate-pulse`} />
                </button>
              ))}
              <div className="absolute left-4 top-4 max-w-xs rounded-lg border border-outline-variant bg-white/90 p-sm shadow-md backdrop-blur-md">
                <div className="font-mono-tag text-label-sm uppercase text-on-surface-variant">Currently Viewing</div>
                <div className="font-bold">Gulf Coast LNG Terminal</div>
                <div className="mt-1 flex items-center gap-2">
                  <Badge tone="danger">CRITICAL</Badge>
                  <span className="text-body-sm text-on-surface-variant">Cost Variance: -$12.4M</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Project health table */}
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>Project Health Index</CardTitle></CardHeader>
            <DataTable columns={columns} data={projects ?? []} stickyFirst />
          </Card>
        </div>

        {/* Right column */}
        <div className="col-span-12 space-y-lg lg:col-span-4">
          {/* AI insights */}
          <div className="relative overflow-hidden rounded-xl bg-primary p-lg text-white shadow-lg">
            <div className="relative z-10">
              <div className="mb-md flex items-center gap-2">
                <Icon name="smart_toy" filled className="text-secondary-fixed" />
                <h3 className="text-headline-sm font-bold">AI Assistant Insights</h3>
              </div>
              {insights?.slice(0, 1).map((i) => (
                <div key={i.id} className="rounded-lg border border-white/20 bg-white/10 p-md backdrop-blur-sm">
                  <p className="text-body-md italic leading-relaxed">“{i.body} {i.recommendation}”</p>
                </div>
              ))}
              <div className="mt-md flex gap-2">
                <Button variant="accent" size="sm">Action Recommendation</Button>
                <Button size="sm" className="bg-white/10 hover:bg-white/20">Dismiss</Button>
              </div>
            </div>
            <Icon name="monitoring" className="absolute -bottom-6 -right-6 text-[160px] opacity-20" />
          </div>

          {/* Risk profile */}
          <Card className="p-lg">
            <h3 className="mb-md text-headline-sm font-bold text-primary">Portfolio Risk Profile</h3>
            <RiskRow icon="report_problem" tone="danger" label="Open Risks" sub="Across all regions" value={kpis?.openRisks ?? 0} />
            <RiskRow icon="rule_folder" tone="warning" label="Open NCRs" sub="Non-conformance reports" value={kpis?.openNcrs ?? 0} />
            <div className="mt-lg border-t border-outline-variant pt-md">
              <div className="mb-2 font-mono-tag text-label-sm uppercase text-on-surface-variant">Risk Exposure Heatmap</div>
              <div className="flex h-6 gap-1">
                {['bg-success', 'bg-success', 'bg-success', 'bg-warning', 'bg-warning', 'bg-danger', 'bg-danger'].map((c, i) => (
                  <div key={i} className={`flex-1 rounded-sm ${c}`} />
                ))}
              </div>
              <div className="mt-2 flex justify-between font-mono-tag text-label-sm text-on-surface-variant"><span>LOW</span><span>CRITICAL</span></div>
            </div>
            <div className="mt-md space-y-1.5">
              {risks?.slice(0, 3).map((r) => (
                <div key={r.id} className="flex items-center justify-between text-body-sm">
                  <span className="truncate text-on-surface">{r.title}</span>
                  <StatusChip status={r.severity} />
                </div>
              ))}
            </div>
          </Card>

          {/* Revenue vs Cost chart */}
          <Card className="p-lg">
            <h3 className="mb-md text-headline-sm font-bold text-primary">Revenue vs Cost Trend</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={revenueData} barGap={2}>
                <CartesianGrid vertical={false} stroke="#dce9ff" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                <RTooltip contentStyle={{ borderRadius: 8, border: '1px solid #c5c6cd', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Revenue" fill="#2170e4" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Cost" fill="#091426" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </div>
    </div>
  )
}

function RiskRow({ icon, tone, label, sub, value }: { icon: string; tone: 'danger' | 'warning'; label: string; sub: string; value: number }) {
  const bg = tone === 'danger' ? 'bg-error-container text-danger' : 'bg-warning-container text-warning'
  const text = tone === 'danger' ? 'text-danger' : 'text-warning'
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bg}`}><Icon name={icon} /></div>
        <div>
          <div className="font-bold text-on-surface">{label}</div>
          <div className="text-body-sm text-on-surface-variant">{sub}</div>
        </div>
      </div>
      <div className={`text-headline-sm font-bold ${text}`}>{value}</div>
    </div>
  )
}
