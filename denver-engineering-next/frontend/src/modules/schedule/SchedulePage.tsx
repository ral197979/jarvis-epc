import {
  Bar, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Legend as RLegend, ResponsiveContainer, Tooltip as RTooltip,
} from 'recharts'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
  Card, CardHeader, CardTitle, KpiCard, Badge, StatusChip, Progress, Button, Icon, DataTable, cn, statusTone, type ColumnDef,
} from '@ds'
import {
  useGantt, useActivities, useWbsNodes, useBaselines, useResourceLoad,
  type GanttTask, type Activity, type WbsNode, type BaselineRow,
} from '@adapters'
import { PageHeader, AiBanner } from '../../components/shared'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ms = (iso: string) => new Date(iso + 'T00:00:00Z').getTime()

function barColor(status: string): string {
  switch (status) {
    case 'Complete': return 'bg-success'
    case 'On Track': return 'bg-secondary'
    case 'At Risk': return 'bg-warning'
    case 'Delayed': return 'bg-danger'
    default: return 'bg-status-gray'
  }
}

export function SchedulePage() {
  return (
    <div>
      <PageHeader
        title="Schedule"
        subtitle="Primavera P6 bridge · critical path · baselines · resource loading"
        actions={<Badge tone="info" dot>P6 linked</Badge>}
      />
      <Tabs defaultValue="gantt">
        <TabsList className="mb-lg flex-wrap">
          <TabsTrigger value="gantt">Gantt</TabsTrigger>
          <TabsTrigger value="activities">Activities</TabsTrigger>
          <TabsTrigger value="wbs">WBS</TabsTrigger>
          <TabsTrigger value="critical">Critical Path</TabsTrigger>
          <TabsTrigger value="baselines">Baselines</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="bridge">P6 Bridge</TabsTrigger>
        </TabsList>
        <TabsContent value="gantt"><GanttTab /></TabsContent>
        <TabsContent value="activities"><ActivitiesTab /></TabsContent>
        <TabsContent value="wbs"><WbsTab /></TabsContent>
        <TabsContent value="critical"><CriticalPathTab /></TabsContent>
        <TabsContent value="baselines"><BaselinesTab /></TabsContent>
        <TabsContent value="resources"><ResourcesTab /></TabsContent>
        <TabsContent value="bridge"><BridgeTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function GanttTab() {
  const { data: tasks = [] } = useGantt()

  if (!tasks.length) return <div className="py-20 text-center text-on-surface-variant">Loading schedule…</div>

  const min = Math.min(...tasks.map((t) => ms(t.start)))
  const max = Math.max(...tasks.map((t) => ms(t.end)))
  const span = Math.max(1, max - min)

  // Month gridlines across the domain
  const ticks: { label: string; leftPct: number }[] = []
  const d = new Date(min)
  d.setUTCDate(1)
  while (d.getTime() <= max) {
    ticks.push({ label: `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`, leftPct: ((d.getTime() - min) / span) * 100 })
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  // "Today" marker — clamp into the domain for the demo dataset
  const todayPct = Math.max(0, Math.min(100, ((Date.now() - min) / span) * 100))

  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Schedule Recovery" value="-14 days" icon="fast_forward" trend={{ direction: 'up', label: 'AI-optimized', tone: 'success' }} />
        <KpiCard label="Path Risk Score" value="0.04" icon="route" hint="Low" />
        <KpiCard label="Milestones At Risk" value={String(tasks.filter((t) => t.milestone && t.status === 'At Risk').length)} icon="flag" critical />
        <KpiCard label="Value Impact" value="$6.3M" icon="payments" trend={{ direction: 'up', label: 'recovery gain', tone: 'success' }} />
      </div>

      <AiBanner text="Dual-sourcing the turbine lot and adding a loop-check crew recovers ~22 days against the historical baseline, protecting the Nov 15 RFSU milestone." action="Run AI Simulation" />

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-outline-variant p-md">
          <h3 className="text-headline-sm font-bold text-primary">2026 Master Schedule</h3>
          <div className="flex items-center gap-3 text-body-sm text-on-surface-variant">
            <Legend color="bg-success" label="Complete" />
            <Legend color="bg-secondary" label="On Track" />
            <Legend color="bg-warning" label="At Risk" />
            <Legend color="bg-danger" label="Delayed" />
          </div>
        </div>

        <div className="custom-scrollbar overflow-x-auto">
          <div className="min-w-[820px]">
            {/* Month header */}
            <div className="flex border-b border-outline-variant bg-background">
              <div className="w-[260px] shrink-0 px-md py-2 font-mono-tag text-label-md uppercase text-on-surface-variant">Task / Track</div>
              <div className="relative flex-1">
                {ticks.map((t) => (
                  <span key={t.label} className="absolute top-2 -translate-x-1/2 font-mono-tag text-label-sm text-on-surface-variant" style={{ left: `${t.leftPct}%` }}>{t.label}</span>
                ))}
              </div>
            </div>

            {/* Rows */}
            <div className="relative">
              {/* gridlines + today */}
              <div className="pointer-events-none absolute inset-0" style={{ marginLeft: 260 }}>
                {ticks.map((t) => (
                  <div key={t.label} className="absolute top-0 bottom-0 w-px bg-outline-variant/50" style={{ left: `${t.leftPct}%` }} />
                ))}
                <div className="absolute top-0 bottom-0 w-0.5 bg-danger/70" style={{ left: `${todayPct}%` }} title="Today" />
              </div>

              {tasks.map((task) => (
                <GanttRow key={task.id} task={task} min={min} span={span} />
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

function GanttRow({ task, min, span }: { task: GanttTask; min: number; span: number }) {
  const leftPct = ((ms(task.start) - min) / span) * 100
  const widthPct = Math.max(0.8, ((ms(task.end) - ms(task.start)) / span) * 100)
  return (
    <div className="flex items-center border-b border-outline-variant hover:bg-surface-container-low/50">
      <div className="w-[260px] shrink-0 px-md py-3">
        <div className="text-body-sm font-semibold text-on-surface">{task.name}</div>
        <div className="flex items-center gap-2">
          <span className="font-mono-tag text-label-sm text-on-surface-variant">{task.track}</span>
          <Badge tone={statusTone(task.status)} className="scale-90">{task.status}</Badge>
        </div>
      </div>
      <div className="relative h-12 flex-1">
        {task.milestone ? (
          <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2" style={{ left: `${leftPct}%` }} title={`${task.name} · ${task.start}`}>
            <div className={cn('h-3.5 w-3.5 rotate-45 border-2 border-white', task.status === 'At Risk' ? 'bg-danger' : 'bg-primary')} />
          </div>
        ) : (
          <div className="absolute top-1/2 h-5 -translate-y-1/2 overflow-hidden rounded" style={{ left: `${leftPct}%`, width: `${widthPct}%` }} title={`${task.start} → ${task.end} · ${task.progressPct}%`}>
            <div className={cn('h-full opacity-30', barColor(task.status))} />
            <div className={cn('absolute inset-y-0 left-0 rounded', barColor(task.status))} style={{ width: `${task.progressPct}%` }} />
            {task.progressPct > 12 && (
              <span className="absolute inset-y-0 left-2 flex items-center font-mono-tag text-[10px] font-bold text-white">{task.progressPct}%</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1"><span className={cn('h-2.5 w-2.5 rounded-sm', color)} /> {label}</span>
}

// ── Float colour helper ──────────────────────────────────────────────────────
function FloatCell({ days }: { days: number }) {
  return <span className={cn('font-mono-tag font-bold', days < 0 ? 'text-danger' : days === 0 ? 'text-warning' : 'text-success')}>{days > 0 ? '+' : ''}{days}d</span>
}

function ActivitiesTab() {
  const { data = [] } = useActivities()
  const cols: ColumnDef<Activity, unknown>[] = [
    { accessorKey: 'id', header: 'ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'name', header: 'Activity' },
    { accessorKey: 'wbs', header: 'WBS', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'start', header: 'Start' },
    { accessorKey: 'finish', header: 'Finish' },
    { accessorKey: 'durationDays', header: 'Dur', cell: (c) => <span className="font-mono-tag">{c.getValue() as number}d</span> },
    { accessorKey: 'pctComplete', header: '%', cell: (c) => <div className="flex items-center gap-2"><Progress value={c.getValue() as number} className="w-16" threshold /> {c.getValue() as number}%</div> },
    { accessorKey: 'floatDays', header: 'Float', cell: (c) => <FloatCell days={c.getValue() as number} /> },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'critical', header: 'Critical', cell: (c) => (c.getValue() as boolean ? <Badge tone="danger">Critical</Badge> : <span className="text-on-surface-variant">—</span>) },
  ]
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Activities</CardTitle>
        <span className="font-mono-tag text-label-md text-on-surface-variant">{data.length} activities · {data.filter((a) => a.critical).length} critical</span>
      </CardHeader>
      <DataTable columns={cols} data={data} stickyFirst />
    </Card>
  )
}

function WbsTab() {
  const { data = [] } = useWbsNodes()
  return (
    <Card className="overflow-hidden">
      <CardHeader><CardTitle>Work Breakdown Structure</CardTitle></CardHeader>
      <ul className="divide-y divide-outline-variant">
        {data.map((n: WbsNode) => (
          <li key={n.id} className="flex items-center gap-3 px-md py-3" style={{ paddingLeft: 16 + n.level * 24 }}>
            <Icon name={n.level === 0 ? 'account_tree' : 'folder'} size={18} className="text-secondary" />
            <span className="font-mono-tag text-label-md text-on-surface-variant">{n.code}</span>
            <span className={cn('flex-1', n.level === 0 ? 'font-bold text-primary' : 'font-medium text-on-surface')}>{n.name}</span>
            <span className="font-mono-tag text-body-sm text-on-surface-variant">{n.budget}</span>
            <div className="flex w-32 items-center gap-2"><Progress value={n.pctComplete} threshold /> <span className="font-mono-tag text-label-md">{n.pctComplete}%</span></div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function CriticalPathTab() {
  const { data = [] } = useActivities()
  const critical = data.filter((a) => a.critical)
  const cols: ColumnDef<Activity, unknown>[] = [
    { accessorKey: 'id', header: 'ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'name', header: 'Driving Activity' },
    { accessorKey: 'finish', header: 'Finish' },
    { accessorKey: 'floatDays', header: 'Total Float', cell: (c) => <FloatCell days={c.getValue() as number} /> },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} /> },
  ]
  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-1 gap-md md:grid-cols-3">
        <Card className="border-l-4 border-l-danger p-md">
          <div className="flex items-center gap-2 text-danger"><Icon name="priority_high" /> <span className="font-bold">High Impact</span></div>
          <p className="mt-1 text-body-sm text-on-surface">Turnover / RFSU drives the critical path · <span className="font-semibold text-danger">+15 days</span> vs baseline.</p>
        </Card>
        <Card className="border-l-4 border-l-warning p-md">
          <div className="flex items-center gap-2 text-warning"><Icon name="warning" /> <span className="font-bold">Near Critical</span></div>
          <p className="mt-1 text-body-sm text-on-surface">Piping & Tie-ins has only <span className="font-semibold">12 days</span> of float.</p>
        </Card>
        <Card className="border-l-4 border-l-secondary p-md">
          <div className="flex items-center gap-2 text-secondary"><Icon name="hub" /> <span className="font-bold">Path Length</span></div>
          <p className="mt-1 text-body-sm text-on-surface"><span className="font-semibold">{critical.length}</span> activities on the longest path to RFSU.</p>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Activity Driving Chain</CardTitle></CardHeader>
        <DataTable columns={cols} data={critical} stickyFirst />
      </Card>
    </div>
  )
}

const blTone: Record<string, 'success' | 'warning' | 'danger'> = { 'On Track': 'success', Recovered: 'success', Slipping: 'danger' }

function BaselinesTab() {
  const { data = [] } = useBaselines()
  const slipped = data.filter((b) => b.varianceDays > 0).length
  const net = data.reduce((s, b) => s + b.varianceDays, 0)
  const cols: ColumnDef<BaselineRow, unknown>[] = [
    { accessorKey: 'id', header: 'ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'activity', header: 'Activity' },
    { accessorKey: 'baselineFinish', header: 'Baseline Finish', cell: (c) => <span className="font-mono-tag text-on-surface-variant line-through">{c.getValue() as string}</span> },
    { accessorKey: 'currentFinish', header: 'Current Finish', cell: (c) => <span className="font-mono-tag font-semibold">{c.getValue() as string}</span> },
    { accessorKey: 'varianceDays', header: 'Variance', cell: (c) => <FloatCell days={c.getValue() as number} /> },
    { accessorKey: 'status', header: 'Status', cell: (c) => <Badge tone={blTone[c.getValue() as string] ?? 'neutral'} dot>{c.getValue() as string}</Badge> },
  ]
  return (
    <div className="space-y-lg">
      <AiBanner text={`Baseline BL-03 vs current: ${slipped} activities slipping, net schedule variance ${net > 0 ? '+' : ''}${net} days on the critical path. Re-baseline recommended after the recovery plan lands.`} action="Propose Re-baseline" />
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Activities Slipped" value={String(slipped)} icon="trending_down" critical={slipped > 0} />
        <KpiCard label="Net Variance" value={`${net > 0 ? '+' : ''}${net} days`} icon="schedule" critical={net > 0} />
        <KpiCard label="Baseline" value="BL-03" icon="flag" hint="Mid-phase review" />
        <KpiCard label="Health Score" value="82%" icon="monitor_heart" trend={{ direction: 'flat', label: 'compliance stable', tone: 'success' }} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Baseline vs Current — Variance</CardTitle></CardHeader>
        <DataTable columns={cols} data={data} stickyFirst />
      </Card>
    </div>
  )
}

function ResourcesTab() {
  const { data = [] } = useResourceLoad()
  const trades = [
    { name: 'Structural Steel', load: 112, tone: 'danger', note: 'Over-allocated', crews: '4 crews' },
    { name: 'Concrete / Formwork', load: 85, tone: 'success', note: 'On track', crews: '6 crews' },
    { name: 'Heavy Equipment', load: 95, tone: 'warning', note: 'At capacity', crews: '12 units' },
  ] as const
  return (
    <div className="grid grid-cols-12 gap-lg">
      <Card className="col-span-12 p-lg lg:col-span-8">
        <h3 className="mb-md text-headline-sm font-bold text-primary">Resource Histogram (FTE-hrs)</h3>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data}>
            <CartesianGrid stroke="#dce9ff" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <RTooltip contentStyle={{ borderRadius: 8, border: '1px solid #c5c6cd', fontSize: 12 }} />
            <RLegend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="planned" name="Planned" fill="#dce9ff" radius={[3, 3, 0, 0]} />
            <Bar dataKey="actual" name="Actual" fill="#0058be" radius={[3, 3, 0, 0]} />
            <Line dataKey="capacity" name="Capacity" stroke="#dc2626" strokeDasharray="5 4" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
      <div className="col-span-12 space-y-2 lg:col-span-4">
        {trades.map((t) => (
          <Card key={t.name} className="p-md">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-on-surface">{t.name}</span>
              <Badge tone={t.tone}>{t.note}</Badge>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-headline-sm font-bold text-primary">{t.load}%</span>
              <span className="font-mono-tag text-label-md text-on-surface-variant">{t.crews}</span>
            </div>
            <Progress className="mt-1" value={Math.min(100, t.load)} threshold />
          </Card>
        ))}
      </div>
    </div>
  )
}

function BridgeTab() {
  const { data: activities = [] } = useActivities()
  const { data: wbs = [] } = useWbsNodes()
  return (
    <div className="grid grid-cols-12 gap-lg">
      <Card className="col-span-12 p-lg lg:col-span-7">
        <div className="mb-md flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-on-primary"><Icon name="hub" /></div>
          <div>
            <h3 className="text-headline-sm font-bold text-primary">Primavera P6 Bridge</h3>
            <div className="text-body-sm text-on-surface-variant">Last sync: today 06:00 · BL-03.02</div>
          </div>
          <Badge tone="success" dot className="ml-auto">Connected</Badge>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="WBS Nodes" value={String(wbs.length)} />
          <Stat label="Activities" value={String(activities.length)} />
          <Stat label="Relationships" value="5,800" />
          <Stat label="Resources" value="12" />
        </div>
        <div className="mt-md flex gap-2">
          <Button variant="accent"><Icon name="sync" size={18} /> Re-sync from P6</Button>
          <Button variant="secondary"><Icon name="upload_file" size={18} /> Import .XER / .XML</Button>
        </div>
      </Card>
      <Card className="col-span-12 p-lg lg:col-span-5">
        <h3 className="mb-md text-headline-sm font-bold text-primary">Import Validation</h3>
        <div className="space-y-2">
          <Warn icon="link_off" label="32 open-ended activities" tone="warning" />
          <Warn icon="trending_down" label="14 negative-float instances" tone="danger" />
          <Warn icon="check_circle" label="Calendars & relationships valid" tone="success" />
        </div>
        <div className="mt-md rounded-lg bg-surface-container-low p-3 text-body-sm text-on-surface-variant">
          <Icon name="lightbulb" size={16} className="mr-1 align-text-bottom text-secondary" />
          AI suggests assigning a finish constraint to the 32 open-ended activities before scheduling.
        </div>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-container-low p-3">
      <div className="font-mono-tag text-label-sm uppercase text-on-surface-variant">{label}</div>
      <div className="mt-0.5 text-headline-sm font-bold text-primary">{value}</div>
    </div>
  )
}

function Warn({ icon, label, tone }: { icon: string; label: string; tone: 'success' | 'warning' | 'danger' }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-outline-variant px-3 py-2 text-body-sm">
      <Icon name={icon} size={18} className={cn(tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-danger')} />
      <span className="text-on-surface">{label}</span>
    </div>
  )
}
