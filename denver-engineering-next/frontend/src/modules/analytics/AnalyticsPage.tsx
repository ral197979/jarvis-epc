import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RTooltip,
} from 'recharts'
import {
  Card,
  CardHeader,
  CardTitle,
  KpiCard,
  Gauge,
  Progress,
  cn,
  statusTone,
  toneDot,
  Tabs, TabsList, TabsTrigger, TabsContent,
  Badge, StatusChip,
} from '@ds'
import { useProjects, useEvmTrend, useCommissioningKpis, useScenarios, type Project } from '@adapters'
import { PageHeader, AiBanner } from '../../components/shared'

const HEATMAP_DIMS: { key: keyof Project; label: string }[] = [
  { key: 'budgetStatus', label: 'Budget' },
  { key: 'scheduleStatus', label: 'Schedule' },
  { key: 'safetyStatus', label: 'Safety' },
]

const disciplines = [
  { name: 'Mechanical', pct: 84 },
  { name: 'Electrical', pct: 62 },
  { name: 'Controls', pct: 41 },
]

const resourceData = [
  { month: 'Jul', Engineering: 42, Construction: 88, Commissioning: 12 },
  { month: 'Aug', Engineering: 38, Construction: 96, Commissioning: 24 },
  { month: 'Sep', Engineering: 30, Construction: 92, Commissioning: 48 },
  { month: 'Oct', Engineering: 22, Construction: 70, Commissioning: 76 },
  { month: 'Nov', Engineering: 16, Construction: 48, Commissioning: 92 },
]

export function AnalyticsPage() {
  return (
    <div>
      <PageHeader title="Analytics" subtitle="Cross-portfolio insights · scenario modeling" />
      <Tabs defaultValue="overview">
        <TabsList className="mb-lg">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="scenarios">Scenario Modeler</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="scenarios"><ScenarioModelerTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function OverviewTab() {
  const { data: projects = [] } = useProjects()
  const { data: trend = [] } = useEvmTrend()
  const { data: cx } = useCommissioningKpis()

  const avgProgress = projects.length
    ? Math.round(projects.reduce((s, p) => s + p.progressPct, 0) / projects.length)
    : 0
  const atRisk = projects.filter((p) => p.health !== 'healthy').length
  const cashflow = trend.map((d) => ({ month: d.month.toUpperCase(), Planned: d.pv, Actual: d.ac, Earned: d.ev }))

  return (
    <div className="space-y-lg">

      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Active Projects" value={String(projects.length)} icon="account_tree" />
        <KpiCard label="Avg Progress" value={`${avgProgress}%`} icon="donut_large" />
        <KpiCard label="At-Risk Projects" value={String(atRisk)} icon="warning" critical={atRisk > 0} />
        <KpiCard label="Cx Readiness" value={`${cx?.readinessForecast ?? 0}%`} icon="precision_manufacturing" trend={{ direction: 'up', label: 'Forecast Oct 24', tone: 'success' }} />
      </div>

      <div className="grid grid-cols-12 gap-lg">
        {/* Portfolio health heatmap */}
        <Card className="col-span-12 overflow-hidden lg:col-span-8">
          <CardHeader><CardTitle>Portfolio Health Heatmap</CardTitle></CardHeader>
          <div className="custom-scrollbar overflow-x-auto p-md">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="font-mono-tag text-label-md uppercase text-on-surface-variant">
                  <th className="px-2 py-2">Project</th>
                  {HEATMAP_DIMS.map((d) => <th key={d.label} className="px-2 py-2 text-center">{d.label}</th>)}
                  <th className="px-2 py-2 text-center">Quality</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-t border-outline-variant">
                    <td className="px-2 py-2">
                      <div className="font-semibold text-primary">{p.name}</div>
                      <div className="font-mono-tag text-label-sm text-on-surface-variant">{p.code}</div>
                    </td>
                    {HEATMAP_DIMS.map((d) => {
                      const val = String(p[d.key])
                      const tone = statusTone(val)
                      return (
                        <td key={d.label} className="px-2 py-2 text-center">
                          <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-body-sm font-medium', 'bg-background')}>
                            <span className={cn('h-2 w-2 rounded-full', toneDot[tone])} />
                            {val}
                          </span>
                        </td>
                      )
                    })}
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2"><Progress value={p.qualityPct} className="w-20" threshold /> <span className="font-mono-tag">{p.qualityPct}%</span></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Commissioning readiness */}
        <Card className="col-span-12 flex flex-col items-center p-lg lg:col-span-4">
          <h3 className="mb-md self-start text-headline-sm font-bold text-primary">Commissioning Readiness</h3>
          <Gauge value={cx?.readinessForecast ?? 0} size={140} label="Forecast" />
          <div className="mt-lg w-full space-y-md">
            {disciplines.map((d) => (
              <div key={d.name}>
                <div className="mb-1 flex justify-between text-body-sm"><span className="font-semibold text-on-surface">{d.name}</span><span className="font-mono-tag text-on-surface-variant">{d.pct}%</span></div>
                <Progress value={d.pct} threshold />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-12 gap-lg">
        {/* Cash flow / cumulative value */}
        <Card className="col-span-12 p-lg lg:col-span-8">
          <h3 className="mb-md text-headline-sm font-bold text-primary">Portfolio Cash Flow ($M)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={cashflow}>
              <defs>
                <linearGradient id="gPlanned" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#64748b" stopOpacity={0.3} /><stop offset="95%" stopColor="#64748b" stopOpacity={0} /></linearGradient>
                <linearGradient id="gActual" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0058be" stopOpacity={0.35} /><stop offset="95%" stopColor="#0058be" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="#dce9ff" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <RTooltip contentStyle={{ borderRadius: 8, border: '1px solid #c5c6cd', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="Planned" stroke="#64748b" fill="url(#gPlanned)" strokeWidth={2} />
              <Area type="monotone" dataKey="Actual" stroke="#0058be" fill="url(#gActual)" strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* Resource loading */}
        <Card className="col-span-12 p-lg lg:col-span-4">
          <h3 className="mb-md text-headline-sm font-bold text-primary">Resource Loading (FTE)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={resourceData}>
              <CartesianGrid stroke="#dce9ff" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <RTooltip contentStyle={{ borderRadius: 8, border: '1px solid #c5c6cd', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="Engineering" stackId="a" fill="#0058be" />
              <Bar dataKey="Construction" stackId="a" fill="#2170e4" />
              <Bar dataKey="Commissioning" stackId="a" fill="#16a34a" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  )
}

const riskTone: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  Low: 'success', Medium: 'warning', High: 'danger', Critical: 'danger',
}
const recDot: Record<string, string> = {
  Recommended: 'bg-success', Modeled: 'bg-info', Rejected: 'bg-status-gray',
}

function ScenarioModelerTab() {
  const { data = [] } = useScenarios()
  const recommended = data.filter((s) => s.status === 'Recommended').length

  return (
    <div className="space-y-lg">
      <AiBanner
        text="2026 expansion stress-test: under an 18% vendor-reliability shock, schedule confidence drops 92% → 68% and Site D-202 moves to CRITICAL. Two mitigations recover the timeline."
        action="Run Stress Test"
      />
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Scenarios Modeled" value={String(data.length)} icon="science" />
        <KpiCard label="Recommended" value={String(recommended)} icon="recommend" trend={{ direction: 'up', label: 'ready to action', tone: 'success' }} />
        <KpiCard label="Predicted Delay" value="+14 days" icon="schedule" critical />
        <KpiCard label="Schedule Confidence" value="68%" icon="query_stats" trend={{ direction: 'down', label: 'from 92%', tone: 'danger' }} />
      </div>

      <div className="grid grid-cols-1 gap-md lg:grid-cols-2">
        {data.map((s) => (
          <Card key={s.id} className="p-lg">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono-tag text-label-md text-on-surface-variant">{s.id}</span>
              <StatusChip status={s.status} />
            </div>
            <h3 className="text-headline-sm font-bold text-primary">{s.name}</h3>
            <p className="mt-1 text-body-sm text-on-surface-variant">{s.description}</p>
            <div className="mt-md grid grid-cols-3 gap-2 border-t border-outline-variant pt-md text-center">
              <Metric label="Cost" value={s.costImpact} danger={s.costImpact.startsWith('+')} />
              <Metric label="Schedule" value={`${s.scheduleImpactDays > 0 ? '+' : ''}${s.scheduleImpactDays}d`} danger={s.scheduleImpactDays > 0} />
              <div>
                <div className="font-mono-tag text-label-sm uppercase text-on-surface-variant">Risk</div>
                <div className="mt-0.5"><Badge tone={riskTone[s.riskLevel] ?? 'neutral'}>{s.riskLevel}</Badge></div>
              </div>
            </div>
            <div className="mt-md flex items-start gap-2 rounded-lg bg-surface-container-low p-3 text-body-sm">
              <span className={cn('mt-0.5 h-2 w-2 shrink-0 rounded-full', recDot[s.status] ?? 'bg-status-gray')} />
              <span className="text-on-surface-variant">{s.recommendation}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function Metric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <div className="font-mono-tag text-label-sm uppercase text-on-surface-variant">{label}</div>
      <div className={`mt-0.5 font-mono-tag font-bold ${danger ? 'text-danger' : 'text-success'}`}>{value}</div>
    </div>
  )
}
