import {
  Tabs, TabsList, TabsTrigger, TabsContent,
  Card, CardHeader, CardTitle, KpiCard, StatusChip, Badge, Button, Icon, DataTable,
  cn, type ColumnDef,
} from '@ds'
import {
  useSafetyIncidents, useTrainingRecords, useSafetyAudits, useSiteAccess,
  type SafetyIncident, type TrainingRecord, type SafetyAudit, type SiteAccessBadge,
} from '@adapters'
import { PageHeader, AiBanner } from '../../components/shared'

export function SafetyPage() {
  return (
    <div>
      <PageHeader
        title="Safety"
        subtitle="Incident management · training compliance · HSE risk"
        actions={<Button variant="accent"><Icon name="add" size={18} /> Report Incident</Button>}
      />
      <Tabs defaultValue="overview">
        <TabsList className="mb-lg">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="incidents">Incident Registry</TabsTrigger>
          <TabsTrigger value="training">Training Compliance</TabsTrigger>
          <TabsTrigger value="audits">Audits</TabsTrigger>
          <TabsTrigger value="access">Site Access</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="incidents"><IncidentsTab /></TabsContent>
        <TabsContent value="training"><TrainingTab /></TabsContent>
        <TabsContent value="audits"><AuditsTab /></TabsContent>
        <TabsContent value="access"><SiteAccessTab /></TabsContent>
      </Tabs>
    </div>
  )
}

const TREND = [2, 1, 3, 0, 2, 1, 4, 2, 1, 0, 1, 2]

function OverviewTab() {
  const { data: incidents = [] } = useSafetyIncidents()
  const open = incidents.filter((i) => i.status !== 'Closed').length
  const lti = incidents.filter((i) => i.type === 'LTI').length
  const recordables = incidents.filter((i) => i.type === 'Recordable' || i.type === 'LTI').length
  return (
    <div className="space-y-lg">
      {lti > 0 && (
        <AiBanner
          text={`${lti} lost-time incident under investigation on the Gulf Coast site. TRIR is trending up — AI flags MV switchgear work zone as the dominant near-miss cluster. Recommend a focused stand-down.`}
          action="Schedule Stand-Down"
        />
      )}
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="TRIR (12-mo)" value="0.84" icon="health_and_safety" trend={{ direction: 'down', label: 'below 1.0 target', tone: 'success' }} />
        <KpiCard label="Open Incidents" value={String(open)} icon="report" critical={open > 0} />
        <KpiCard label="Lost-Time Injuries" value={String(lti)} icon="personal_injury" critical={lti > 0} />
        <KpiCard label="Days Since LTI" value="18" icon="event_available" />
      </div>
      <div className="grid grid-cols-12 gap-lg">
        <Card className="col-span-12 p-lg lg:col-span-8">
          <h3 className="mb-md text-headline-sm font-bold text-primary">Incident Trend (12 mo)</h3>
          <div className="flex h-40 items-end gap-2">
            {TREND.map((v, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div className={cn('w-full rounded-t-sm', v >= 3 ? 'bg-danger' : v >= 2 ? 'bg-warning' : 'bg-secondary')} style={{ height: `${(v / 4) * 100 || 4}%` }} />
                <span className="font-mono-tag text-[9px] text-on-surface-variant">{['J','F','M','A','M','J','J','A','S','O','N','D'][i]}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="col-span-12 p-lg lg:col-span-4">
          <h3 className="mb-md text-headline-sm font-bold text-primary">By Classification</h3>
          <div className="space-y-2">
            <ClassRow label="Near Miss" value={incidents.filter((i) => i.type === 'Near Miss').length} tone="info" />
            <ClassRow label="First Aid" value={incidents.filter((i) => i.type === 'First Aid').length} tone="neutral" />
            <ClassRow label="Recordable" value={incidents.filter((i) => i.type === 'Recordable').length} tone="warning" />
            <ClassRow label="Lost-Time (LTI)" value={lti} tone="danger" />
          </div>
          <div className="mt-md rounded-lg bg-surface-container-low p-3 text-body-sm text-on-surface-variant">
            <Icon name="verified_user" size={16} className="mr-1 align-text-bottom text-secondary" />
            {recordables} recordable case(s) this period · OSHA log current.
          </div>
        </Card>
      </div>
    </div>
  )
}

function ClassRow({ label, value, tone }: { label: string; value: number; tone: 'info' | 'neutral' | 'warning' | 'danger' }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2 text-body-sm">
      <span className="text-on-surface">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  )
}

const typeTone: Record<string, 'info' | 'neutral' | 'warning' | 'danger'> = {
  'Near Miss': 'info', 'First Aid': 'neutral', Recordable: 'warning', LTI: 'danger',
}

function IncidentsTab() {
  const { data = [] } = useSafetyIncidents()
  const cols: ColumnDef<SafetyIncident, unknown>[] = [
    { accessorKey: 'id', header: 'ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'title', header: 'Description' },
    { accessorKey: 'type', header: 'Type', cell: (c) => <Badge tone={typeTone[c.getValue() as string] ?? 'neutral'}>{c.getValue() as string}</Badge> },
    { accessorKey: 'severity', header: 'Severity', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'project', header: 'Project', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'reportedBy', header: 'Reported By' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} dot /> },
    { accessorKey: 'date', header: 'Date' },
  ]
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Incident Registry</CardTitle>
        <Button variant="accent" size="sm"><Icon name="add" size={18} /> Log Incident</Button>
      </CardHeader>
      <DataTable columns={cols} data={data} stickyFirst />
    </Card>
  )
}

const trTone: Record<string, 'success' | 'warning' | 'danger'> = { Valid: 'success', Expiring: 'warning', Expired: 'danger' }

function TrainingTab() {
  const { data = [] } = useTrainingRecords()
  const expired = data.filter((t) => t.status === 'Expired').length
  const expiring = data.filter((t) => t.status === 'Expiring').length
  const compliance = data.length ? Math.round((data.filter((t) => t.status === 'Valid').length / data.length) * 100) : 0
  const cols: ColumnDef<TrainingRecord, unknown>[] = [
    { accessorKey: 'person', header: 'Person', cell: (c) => <span className="font-semibold text-primary">{c.getValue() as string}</span> },
    { accessorKey: 'role', header: 'Role' },
    { accessorKey: 'course', header: 'Course' },
    { accessorKey: 'expires', header: 'Expires' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <Badge tone={trTone[c.getValue() as string] ?? 'neutral'} dot>{c.getValue() as string}</Badge> },
  ]
  return (
    <div className="space-y-lg">
      {expired > 0 && (
        <AiBanner text={`${expired} certification expired (SparkElec Arc Flash). ${expiring} expiring within 30 days. Crews with expired training should be blocked from energized work until renewed.`} action="Notify Supervisors" />
      )}
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Training Compliance" value={`${compliance}%`} icon="school" trend={{ direction: compliance >= 80 ? 'up' : 'down', label: 'workforce certified', tone: compliance >= 80 ? 'success' : 'danger' }} />
        <KpiCard label="Expiring (30d)" value={String(expiring)} icon="schedule" />
        <KpiCard label="Expired" value={String(expired)} icon="warning" critical={expired > 0} />
        <KpiCard label="Courses Tracked" value={String(new Set(data.map((t) => t.course)).size)} icon="menu_book" />
      </div>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Workforce Training Records</CardTitle></CardHeader>
        <DataTable columns={cols} data={data} />
      </Card>
    </div>
  )
}

const auditTone: Record<string, 'success' | 'warning' | 'danger'> = { Closed: 'success', Open: 'warning', 'Action Required': 'danger' }

function AuditsTab() {
  const { data = [] } = useSafetyAudits()
  const openFindings = data.reduce((s, a) => s + a.openFindings, 0)
  const avg = data.length ? Math.round(data.reduce((s, a) => s + a.score, 0) / data.length) : 0
  const cols: ColumnDef<SafetyAudit, unknown>[] = [
    { accessorKey: 'id', header: 'ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'title', header: 'Audit' },
    { accessorKey: 'area', header: 'Area' },
    { accessorKey: 'auditor', header: 'Auditor' },
    { accessorKey: 'date', header: 'Date' },
    { accessorKey: 'score', header: 'Score', cell: (c) => <span className={cn('font-mono-tag font-bold', (c.getValue() as number) >= 95 ? 'text-success' : (c.getValue() as number) >= 85 ? 'text-warning' : 'text-danger')}>{c.getValue() as number}%</span> },
    { accessorKey: 'openFindings', header: 'Findings', cell: (c) => (c.getValue() as number) > 0 ? <Badge tone="warning">{c.getValue() as number}</Badge> : <Badge tone="success">0</Badge> },
    { accessorKey: 'status', header: 'Status', cell: (c) => <Badge tone={auditTone[c.getValue() as string] ?? 'neutral'} dot>{c.getValue() as string}</Badge> },
  ]
  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Audits (90d)" value={String(data.length)} icon="fact_check" />
        <KpiCard label="Avg Score" value={`${avg}%`} icon="grade" trend={{ direction: 'up', label: 'above 90% target', tone: 'success' }} />
        <KpiCard label="Open Findings" value={String(openFindings)} icon="report" critical={openFindings > 0} />
        <KpiCard label="Action Required" value={String(data.filter((a) => a.status === 'Action Required').length)} icon="warning" critical={data.some((a) => a.status === 'Action Required')} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Safety Audits</CardTitle>
          <Button variant="accent" size="sm"><Icon name="add" size={18} /> New Audit</Button>
        </CardHeader>
        <DataTable columns={cols} data={data} stickyFirst />
      </Card>
    </div>
  )
}

const accessTone: Record<string, 'success' | 'warning' | 'danger'> = { Active: 'success', Expiring: 'warning', Suspended: 'danger' }

function SiteAccessTab() {
  const { data = [] } = useSiteAccess()
  const active = data.filter((b) => b.status === 'Active').length
  const cols: ColumnDef<SiteAccessBadge, unknown>[] = [
    { accessorKey: 'id', header: 'Badge', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'person', header: 'Holder', cell: (c) => <span className="font-semibold text-primary">{c.getValue() as string}</span> },
    { accessorKey: 'company', header: 'Company' },
    { accessorKey: 'role', header: 'Role' },
    { accessorKey: 'inducted', header: 'Inducted' },
    { accessorKey: 'zones', header: 'Access Zones' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <Badge tone={accessTone[c.getValue() as string] ?? 'neutral'} dot>{c.getValue() as string}</Badge> },
  ]
  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Active Badges" value={String(active)} icon="badge" />
        <KpiCard label="On Site Now" value="38" icon="groups" hint="across 3 zones" />
        <KpiCard label="Expiring (7d)" value={String(data.filter((b) => b.status === 'Expiring').length)} icon="schedule" />
        <KpiCard label="Suspended" value={String(data.filter((b) => b.status === 'Suspended').length)} icon="block" critical={data.some((b) => b.status === 'Suspended')} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Site Access Authorization</CardTitle>
          <Button variant="accent" size="sm"><Icon name="add" size={18} /> Issue Badge</Button>
        </CardHeader>
        <DataTable columns={cols} data={data} stickyFirst />
      </Card>
    </div>
  )
}
