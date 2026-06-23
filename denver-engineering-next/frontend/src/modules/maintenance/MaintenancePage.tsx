import {
  Tabs, TabsList, TabsTrigger, TabsContent,
  Card, CardHeader, CardTitle, KpiCard, Badge, StatusChip, Progress, Button, Icon, DataTable,
  cn, type ColumnDef,
} from '@ds'
import {
  useMaintenanceTasks, useAssetRecords, useLifecycle,
  type MaintenanceTask, type AssetRecord, type LifecycleRow,
} from '@adapters'
import { PageHeader, AiBanner } from '../../components/shared'

export function MaintenancePage() {
  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle="Planning · asset register · lifecycle forecast"
        actions={<Button variant="accent"><Icon name="add" size={18} /> Work Order</Button>}
      />
      <Tabs defaultValue="planning">
        <TabsList className="mb-lg">
          <TabsTrigger value="planning">Planning</TabsTrigger>
          <TabsTrigger value="assets">Asset Register</TabsTrigger>
          <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
        </TabsList>
        <TabsContent value="planning"><PlanningTab /></TabsContent>
        <TabsContent value="assets"><AssetsTab /></TabsContent>
        <TabsContent value="lifecycle"><LifecycleTab /></TabsContent>
      </Tabs>
    </div>
  )
}

const typeTone: Record<string, 'info' | 'warning' | 'purple'> = { Preventive: 'info', Corrective: 'warning', Predictive: 'purple' }

function PlanningTab() {
  const { data = [] } = useMaintenanceTasks()
  const overdue = data.filter((t) => t.status === 'Overdue').length
  const cols: ColumnDef<MaintenanceTask, unknown>[] = [
    { accessorKey: 'id', header: 'WO', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'asset', header: 'Asset' },
    { accessorKey: 'type', header: 'Type', cell: (c) => <Badge tone={typeTone[c.getValue() as string] ?? 'neutral'}>{c.getValue() as string}</Badge> },
    { accessorKey: 'assignedTo', header: 'Assigned' },
    { accessorKey: 'priority', header: 'Priority', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'due', header: 'Due' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} dot /> },
  ]
  return (
    <div className="space-y-lg">
      {overdue > 0 && (
        <AiBanner text={`${overdue} corrective work order is overdue (MV switchgear). Structural Health Index holds at 98%, but specialized-contractor utilization is at 100% — schedule risk on the next preventive cycle.`} action="Rebalance Crews" />
      )}
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Budget Remaining" value="$12.4M" icon="account_balance" trend={{ direction: 'down', label: '-2.4% MoM', tone: 'danger' }} />
        <KpiCard label="Active Work Orders" value={String(data.length)} icon="build" hint={`${data.filter((t) => t.priority === 'High').length} high priority`} />
        <KpiCard label="Overdue" value={String(overdue)} icon="warning" critical={overdue > 0} />
        <KpiCard label="Structural Health" value="98%" icon="monitor_heart" trend={{ direction: 'flat', label: 'Stable', tone: 'success' }} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Work Orders</CardTitle></CardHeader>
        <DataTable columns={cols} data={data} stickyFirst />
      </Card>
    </div>
  )
}

const condTone: Record<string, 'success' | 'warning' | 'danger'> = { Good: 'success', Fair: 'warning', Poor: 'danger' }

function AssetsTab() {
  const { data = [] } = useAssetRecords()
  const cols: ColumnDef<AssetRecord, unknown>[] = [
    { accessorKey: 'tag', header: 'Asset ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'name', header: 'Component' },
    { accessorKey: 'category', header: 'Category' },
    { accessorKey: 'installed', header: 'Installed' },
    { accessorKey: 'nextService', header: 'Next Service' },
    { accessorKey: 'criticality', header: 'Criticality', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'condition', header: 'Condition', cell: (c) => <Badge tone={condTone[c.getValue() as string] ?? 'neutral'} dot>{c.getValue() as string}</Badge> },
  ]
  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Registered Assets" value={String(data.length)} icon="inventory_2" />
        <KpiCard label="Asset Value" value="$680M" icon="savings" />
        <KpiCard label="Critical Assets" value={String(data.filter((a) => a.criticality === 'High').length)} icon="priority_high" />
        <KpiCard label="Health Status" value="Optimized" icon="check_circle" trend={{ direction: 'up', label: 'SHM live', tone: 'success' }} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Final Asset Register</CardTitle>
          <span className="font-mono-tag text-label-md text-on-surface-variant">SHM connected</span>
        </CardHeader>
        <DataTable columns={cols} data={data} stickyFirst />
      </Card>
    </div>
  )
}

const riskTone: Record<string, 'success' | 'warning' | 'danger'> = { Low: 'success', Medium: 'warning', High: 'danger' }

function LifecycleTab() {
  const { data = [] } = useLifecycle()
  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Asset Health Index" value="88.4%" icon="ecg_heart" trend={{ direction: 'up', label: '+1.2%', tone: 'success' }} />
        <KpiCard label="5-Yr Cost Forecast" value="$14.2M" icon="trending_up" />
        <KpiCard label="Components At Risk" value={String(data.filter((l) => l.risk !== 'Low').length)} icon="warning" critical={data.some((l) => l.risk === 'High')} />
        <KpiCard label="Earliest Replacement" value={String(Math.min(...data.map((l) => l.replaceYear)))} icon="event_repeat" />
      </div>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Component Health Matrix</CardTitle></CardHeader>
        <div className="divide-y divide-outline-variant">
          {data.map((l: LifecycleRow) => (
            <div key={l.id} className="flex items-center gap-4 px-md py-3">
              <div className="flex-1">
                <div className="font-semibold text-on-surface">{l.component}</div>
                <div className="font-mono-tag text-label-sm text-on-surface-variant">Age {l.ageYears}y of {l.expectedLifeYears}y · replace {l.replaceYear}</div>
              </div>
              <div className="flex w-40 items-center gap-2">
                <Progress value={l.remainingPct} threshold />
                <span className={cn('w-10 text-right font-mono-tag text-body-sm', l.remainingPct < 40 ? 'text-danger' : l.remainingPct < 75 ? 'text-warning' : 'text-success')}>{l.remainingPct}%</span>
              </div>
              <Badge tone={riskTone[l.risk] ?? 'neutral'}>{l.risk}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
