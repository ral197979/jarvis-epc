import { useParams, useNavigate } from 'react-router-dom'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Card,
  CardHeader,
  CardTitle,
  Badge,
  StatusChip,
  Icon,
  Avatar,
  Progress,
  KpiCard,
  DataTable,
  EmptyState,
  type ColumnDef,
} from '@ds'
import {
  useProject,
  useMilestones,
  useDeliverables,
  useProjectRisks,
  useTeam,
  useActivity,
  type Deliverable,
  type Risk,
} from '@adapters'

export function ProjectWorkspace() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data: project, isLoading } = useProject(id)

  if (isLoading) return <div className="py-20 text-center text-on-surface-variant">Loading workspace…</div>
  if (!project) return <EmptyState icon="search_off" title="Project not found" description={id} />

  const healthTone = project.health === 'critical' ? 'danger' : project.health === 'at-risk' ? 'warning' : 'success'

  return (
    <div>
      {/* Breadcrumb + header */}
      <button onClick={() => navigate('/projects')} className="mb-2 flex items-center gap-1 text-body-sm font-semibold text-secondary hover:underline">
        <Icon name="arrow_back" size={16} /> Projects
      </button>
      <div className="mb-lg flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono-tag text-label-md uppercase text-on-surface-variant">{project.code} · {project.region}</div>
          <h1 className="mt-0.5 text-headline-md font-bold text-primary">{project.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone={healthTone}>{project.health === 'critical' ? 'Critical' : project.health === 'at-risk' ? 'At Risk' : 'Healthy'}</Badge>
            <span className="text-body-sm text-on-surface-variant">{project.client} · {project.phase}</span>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="mb-lg grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Progress" value={`${project.progressPct}%`} icon="donut_large" />
        <KpiCard label="Contract Value" value={project.contractValue} icon="payments" />
        <KpiCard label="Schedule" value={project.scheduleStatus} icon="event" />
        <KpiCard label="Quality" value={`${project.qualityPct}%`} icon="verified" />
      </div>

      <Tabs defaultValue="summary">
        <TabsList className="mb-lg overflow-x-auto">
          {['summary', 'milestones', 'deliverables', 'risks', 'team', 'activity'].map((t) => (
            <TabsTrigger key={t} value={t} className="capitalize">{t}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="summary"><SummaryTab projectId={id} progress={project.progressPct} /></TabsContent>
        <TabsContent value="milestones"><MilestonesTab projectId={id} /></TabsContent>
        <TabsContent value="deliverables"><DeliverablesTab projectId={id} /></TabsContent>
        <TabsContent value="risks"><RisksTab projectId={id} /></TabsContent>
        <TabsContent value="team"><TeamTab projectId={id} /></TabsContent>
        <TabsContent value="activity"><ActivityTab projectId={id} /></TabsContent>
      </Tabs>
    </div>
  )
}

function SummaryTab({ projectId, progress }: { projectId: string; progress: number }) {
  const { data: milestones } = useMilestones(projectId)
  const { data: activity } = useActivity(projectId)
  return (
    <div className="grid grid-cols-12 gap-lg">
      <Card className="col-span-12 p-lg lg:col-span-8">
        <h3 className="mb-md text-headline-sm font-bold text-primary">Phase Progression</h3>
        <Progress value={progress} threshold height={12} />
        <div className="mt-lg space-y-3">
          {milestones?.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <Icon
                name={m.status === 'Complete' ? 'check_circle' : m.status === 'In Progress' ? 'pending' : 'radio_button_unchecked'}
                className={m.status === 'Complete' ? 'text-success' : m.status === 'At Risk' ? 'text-danger' : 'text-on-surface-variant'}
              />
              <div className="flex-1">
                <div className="text-body-md font-semibold text-on-surface">{m.name}</div>
                <div className="text-body-sm text-on-surface-variant">{m.date} · {m.owner}</div>
              </div>
              <StatusChip status={m.status} />
            </div>
          ))}
        </div>
      </Card>
      <Card className="col-span-12 p-lg lg:col-span-4">
        <h3 className="mb-md text-headline-sm font-bold text-primary">Recent Activity</h3>
        <ActivityFeed projectId={projectId} compact data={activity} />
      </Card>
    </div>
  )
}

function MilestonesTab({ projectId }: { projectId: string }) {
  const { data } = useMilestones(projectId)
  return (
    <Card className="overflow-hidden">
      <CardHeader><CardTitle>Milestones</CardTitle></CardHeader>
      <div className="divide-y divide-outline-variant">
        {data?.map((m) => (
          <div key={m.id} className="flex items-center justify-between px-md py-3">
            <div className="flex items-center gap-3">
              <span className="font-mono-tag text-label-md text-on-surface-variant">{m.id}</span>
              <span className="font-semibold text-on-surface">{m.name}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-body-sm text-on-surface-variant">{m.date}</span>
              <StatusChip status={m.status} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function DeliverablesTab({ projectId }: { projectId: string }) {
  const { data } = useDeliverables(projectId)
  const cols: ColumnDef<Deliverable, unknown>[] = [
    { accessorKey: 'id', header: 'ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'name', header: 'Deliverable' },
    { accessorKey: 'discipline', header: 'Discipline' },
    { accessorKey: 'rev', header: 'Rev' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'due', header: 'Due' },
  ]
  return <Card className="overflow-hidden"><DataTable columns={cols} data={data ?? []} stickyFirst /></Card>
}

function RisksTab({ projectId }: { projectId: string }) {
  const { data } = useProjectRisks(projectId)
  const cols: ColumnDef<Risk, unknown>[] = [
    { accessorKey: 'id', header: 'ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'title', header: 'Risk' },
    { accessorKey: 'category', header: 'Category' },
    { accessorKey: 'severity', header: 'Severity', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { id: 'score', header: 'P×I', cell: (c) => <span className="font-mono-tag">{c.row.original.probability}×{c.row.original.impact}</span> },
    { accessorKey: 'owner', header: 'Owner' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <Badge dot tone="info">{c.getValue() as string}</Badge> },
  ]
  return <Card className="overflow-hidden"><DataTable columns={cols} data={data ?? []} stickyFirst /></Card>
}

function TeamTab({ projectId }: { projectId: string }) {
  const { data } = useTeam(projectId)
  return (
    <div className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-3">
      {data?.map((m) => (
        <Card key={m.id} className="flex items-center gap-3 p-md">
          <Avatar name={m.name} className="h-12 w-12 text-body-md" />
          <div className="flex-1">
            <div className="font-semibold text-primary">{m.name}</div>
            <div className="text-body-sm text-on-surface-variant">{m.role}</div>
            <div className="mt-1"><Progress value={m.allocationPct} /></div>
          </div>
          <span className="font-mono-tag text-label-md text-on-surface-variant">{m.allocationPct}%</span>
        </Card>
      ))}
    </div>
  )
}

function ActivityTab({ projectId }: { projectId: string }) {
  const { data } = useActivity(projectId)
  return <Card className="p-lg"><ActivityFeed projectId={projectId} data={data} /></Card>
}

function ActivityFeed({ data, compact }: { projectId: string; compact?: boolean; data?: { id: string; actor: string; action: string; target: string; at: string; icon: string }[] }) {
  return (
    <ul className={compact ? 'space-y-3' : 'space-y-4'}>
      {data?.map((a) => (
        <li key={a.id} className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
            <Icon name={a.icon} size={18} />
          </div>
          <div className="flex-1 text-body-sm">
            <span className="font-semibold text-on-surface">{a.actor}</span> {a.action}{' '}
            <span className="font-mono-tag text-secondary">{a.target}</span>
            <div className="text-body-sm text-on-surface-variant">{a.at}</div>
          </div>
        </li>
      ))}
    </ul>
  )
}
