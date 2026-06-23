import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  KpiCard,
  Card,
  CardHeader,
  CardTitle,
  Badge,
  StatusChip,
  Gauge,
  Progress,
  Icon,
  Button,
  DataTable,
  cn,
  type ColumnDef,
} from '@ds'
import {
  useCommissioningKpis,
  useEquipment,
  useTestPacks,
  type Equipment,
  type TestPack,
} from '@adapters'
import { PageHeader, AiBanner } from '../../components/shared'
import { CompletionMatrix } from './CompletionMatrix'
import { DeficiencyRegistry } from './DeficiencyRegistry'
import { PfcManagement } from './PfcManagement'
import { FptExecution } from './FptExecution'
import { IstOrchestration } from './IstOrchestration'
import { TurnoverBuilder } from './TurnoverBuilder'
import { useUi } from '../../lib/store'

export function CommissioningPage() {
  return (
    <div>
      <PageHeader
        title="Commissioning"
        subtitle="Project Alpha · Phase 2 — Systems completion & turnover readiness"
        actions={<Button variant="accent"><Icon name="add" size={18} /> New Punch Item</Button>}
      />
      <Tabs defaultValue="dashboard">
        <TabsList className="mb-lg flex-wrap">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="matrix">Completion Matrix</TabsTrigger>
          <TabsTrigger value="pfc">PFC</TabsTrigger>
          <TabsTrigger value="fpt">FPT Execution</TabsTrigger>
          <TabsTrigger value="ist">IST</TabsTrigger>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
          <TabsTrigger value="deficiencies">Deficiencies</TabsTrigger>
          <TabsTrigger value="turnover">Turnover</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard"><DashboardTab /></TabsContent>
        <TabsContent value="matrix"><CompletionMatrix /></TabsContent>
        <TabsContent value="pfc"><PfcManagement /></TabsContent>
        <TabsContent value="fpt"><FptExecution /></TabsContent>
        <TabsContent value="ist"><IstOrchestration /></TabsContent>
        <TabsContent value="equipment"><EquipmentTab /></TabsContent>
        <TabsContent value="deficiencies"><DeficiencyRegistry /></TabsContent>
        <TabsContent value="turnover"><TurnoverBuilder /></TabsContent>
      </Tabs>
    </div>
  )
}

function DashboardTab() {
  const activeProjectId = useUi((s) => s.activeProjectId)
  const { data: kpis } = useCommissioningKpis()
  const { data: packs } = useTestPacks(activeProjectId)

  const disciplines = [
    { name: 'Mechanical', pct: 84 },
    { name: 'Electrical', pct: 62 },
    { name: 'Controls', pct: 41 },
  ]
  const contractors = [
    { name: 'MechCo', pass: 92, closeDays: 3.1, safety: 'A', status: 'Optimized' },
    { name: 'SparkElec', pass: 74, closeDays: 6.8, safety: 'B', status: 'Attention' },
    { name: 'CtrlSys', pass: 58, closeDays: 9.2, safety: 'C', status: 'Blocking' },
  ]

  return (
    <div className="space-y-lg">
      <AiBanner
        text="Electrical completion (62%) lags mechanical (84%). At the current loop-check rate, IST sequencing slips ~9 days past the Oct turnover target."
        action="Recommend Crew"
      />

      <div className="grid grid-cols-1 gap-md md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-lg">
          <div className="mb-2 font-mono-tag text-label-md uppercase text-on-surface-variant">Overall Completion</div>
          <div className="text-headline-md font-bold text-primary">{kpis?.overallCompletion ?? 0}%</div>
          <Progress className="mt-2" value={kpis?.overallCompletion ?? 0} threshold />
        </Card>
        <KpiCard label="Systems Complete" value={`${kpis?.systemsComplete ?? 0}/${kpis?.systemsTotal ?? 0}`} icon="checklist" hint="Mechanically + functionally complete" />
        <KpiCard label="Systems At Risk" value={String(kpis?.systemsAtRisk ?? 0)} icon="warning" trend={{ direction: 'up', label: '+3 this week', tone: 'danger' }} />
        <KpiCard label="Critical Deficiencies" value={String(kpis?.criticalDeficiencies ?? 0)} icon="report_problem" critical />
      </div>

      <div className="grid grid-cols-12 gap-lg">
        {/* Discipline heatmap */}
        <Card className="col-span-12 p-lg lg:col-span-8">
          <h3 className="mb-md text-headline-sm font-bold text-primary">Discipline Completion Heatmap</h3>
          <div className="space-y-md">
            {disciplines.map((d) => (
              <div key={d.name}>
                <div className="mb-1 flex items-center justify-between text-body-sm">
                  <span className="font-semibold text-on-surface">{d.name}</span>
                  <span className="font-mono-tag text-on-surface-variant">{d.pct}%</span>
                </div>
                <div className="flex gap-1">
                  {Array.from({ length: 20 }).map((_, i) => {
                    const filled = i < Math.round(d.pct / 5)
                    const tone = d.pct < 50 ? 'bg-danger' : d.pct < 75 ? 'bg-warning' : 'bg-success'
                    return <div key={i} className={cn('h-6 flex-1 rounded-sm', filled ? tone : 'bg-surface-container-high')} />
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-lg border-t border-outline-variant pt-md">
            <h4 className="mb-3 text-body-md font-bold text-primary">Contractor Performance Matrix</h4>
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="border-b border-outline-variant font-mono-tag text-label-md uppercase text-on-surface-variant">
                  <th className="py-2">Contractor</th><th>Pass Rate</th><th>Close (days)</th><th>Safety</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {contractors.map((c) => (
                  <tr key={c.name} className="border-b border-outline-variant">
                    <td className="py-2.5 font-semibold text-primary">{c.name}</td>
                    <td><div className="flex items-center gap-2"><Progress value={c.pass} className="w-20" /> {c.pass}%</div></td>
                    <td className="font-mono-tag">{c.closeDays}</td>
                    <td className="font-mono-tag">{c.safety}</td>
                    <td><StatusChip status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Readiness forecast */}
        <Card className="col-span-12 flex flex-col items-center p-lg lg:col-span-4">
          <h3 className="mb-md self-start text-headline-sm font-bold text-primary">Turnover Readiness</h3>
          <Gauge value={kpis?.readinessForecast ?? 0} size={150} label="Forecast" />
          <p className="mt-md text-center text-body-sm text-on-surface-variant">
            AI-projected readiness at the current burn rate. Forecast turnover: <span className="font-semibold text-primary">Oct 2024</span>.
          </p>
          <div className="mt-md w-full space-y-2">
            <ReadyRow label="MC Certificates" value="450 / 450" tone="success" />
            <ReadyRow label="Handover Packages" value="12 / 18" tone="warning" />
            <ReadyRow label="Vendor Data" value="8 missing" tone="danger" />
          </div>
        </Card>
      </div>

      {/* Test pack register */}
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Test Pack Register</CardTitle></CardHeader>
        <DataTable
          columns={testPackCols}
          data={packs ?? []}
          stickyFirst
        />
      </Card>
    </div>
  )
}

const testPackCols: ColumnDef<TestPack, unknown>[] = [
  { accessorKey: 'id', header: 'Pack ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
  { accessorKey: 'discipline', header: 'Discipline' },
  { accessorKey: 'testType', header: 'Test Type' },
  { accessorKey: 'preparedBy', header: 'Prepared By' },
  { accessorKey: 'date', header: 'Date' },
  { accessorKey: 'qaSignature', header: 'QA/QC', cell: (c) => <StatusChip status={c.getValue() as string} /> },
  { accessorKey: 'progressPct', header: 'Progress', cell: (c) => <div className="flex items-center gap-2"><Progress value={c.getValue() as number} className="w-24" threshold /> <span className="font-mono-tag">{c.getValue() as number}%</span></div> },
]

function ReadyRow({ label, value, tone }: { label: string; value: string; tone: 'success' | 'warning' | 'danger' }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2 text-body-sm">
      <span className="text-on-surface">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  )
}

function EquipmentTab() {
  const activeProjectId = useUi((s) => s.activeProjectId)
  const { data } = useEquipment(activeProjectId)
  const cols: ColumnDef<Equipment, unknown>[] = [
    { accessorKey: 'tag', header: 'Tag', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'name', header: 'Equipment' },
    { accessorKey: 'system', header: 'System' },
    { accessorKey: 'vendor', header: 'Vendor' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'completionPct', header: 'Completion', cell: (c) => <div className="flex items-center gap-2"><Progress value={c.getValue() as number} className="w-24" threshold /> {c.getValue() as number}%</div> },
    { accessorKey: 'openPunch', header: 'Open Punch', cell: (c) => (c.getValue() as number) > 0 ? <Badge tone="warning">{c.getValue() as number}</Badge> : <Badge tone="success">0</Badge> },
  ]
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Equipment Records</CardTitle>
        <span className="font-mono-tag text-label-md text-on-surface-variant">{data?.length ?? 0} assets</span>
      </CardHeader>
      <DataTable columns={cols} data={data ?? []} stickyFirst onRowClick={() => {}} />
    </Card>
  )
}
