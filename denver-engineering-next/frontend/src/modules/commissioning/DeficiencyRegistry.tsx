import { useState } from 'react'
import {
  Card,
  KpiCard,
  Badge,
  StatusChip,
  Button,
  Icon,
  Input,
  Select,
  Drawer,
  DrawerContent,
  DataTable,
  Divider,
  type ColumnDef,
} from '@ds'
import { useDeficiencies, useUpdateDeficiencyStatus, type Deficiency } from '@adapters'
import { useUi } from '../../lib/store'
import { LogDeficiencyDialog } from './LogDeficiencyDialog'

const catTone = { A: 'danger', B: 'warning', C: 'neutral' } as const

export function DeficiencyRegistry() {
  const activeProjectId = useUi((s) => s.activeProjectId)
  const { data } = useDeficiencies(activeProjectId)
  const updateStatus = useUpdateDeficiencyStatus(activeProjectId)
  const [selected, setSelected] = useState<Deficiency | null>(null)
  const [logOpen, setLogOpen] = useState(false)

  const setStatus = (deficiency: Deficiency, status: string) =>
    updateStatus.mutate({ deficiency, status }, { onSuccess: () => setSelected(null) })

  const open = data?.filter((d) => d.status !== 'Closed').length ?? 0
  const critical = data?.filter((d) => d.category === 'A').length ?? 0

  const cols: ColumnDef<Deficiency, unknown>[] = [
    { accessorKey: 'id', header: 'ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'description', header: 'Description', cell: (c) => <span className="line-clamp-1 max-w-sm">{c.getValue() as string}</span> },
    { accessorKey: 'category', header: 'Cat', cell: (c) => <Badge tone={catTone[c.getValue() as 'A' | 'B' | 'C']}>Cat {c.getValue() as string}</Badge> },
    { accessorKey: 'severity', header: 'Severity', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'system', header: 'System' },
    { accessorKey: 'contractor', header: 'Contractor' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} dot /> },
    { accessorKey: 'loggedAt', header: 'Logged' },
  ]

  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Open Deficiencies" value={String(open)} icon="report" trend={{ direction: 'up', label: '+12% MoM', tone: 'danger' }} />
        <KpiCard label="Critical (Cat A)" value={String(critical).padStart(2, '0')} icon="priority_high" critical />
        <KpiCard label="Avg Days to Close" value="4.2" icon="schedule" />
        <KpiCard label="Contractor Perf" value="94%" icon="verified" trend={{ direction: 'up', label: 'On Target', tone: 'success' }} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant p-md">
          <Input icon="search" placeholder="Search deficiencies…" className="w-64" />
          <Select defaultValue=""><option value="">All Disciplines</option><option>Mechanical</option><option>Electrical</option><option>Controls</option></Select>
          <Select defaultValue=""><option value="">All Severities</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></Select>
          <Button variant="accent" className="ml-auto" onClick={() => setLogOpen(true)}><Icon name="add" size={18} /> Log Deficiency</Button>
        </div>
        <DataTable columns={cols} data={data ?? []} stickyFirst onRowClick={setSelected} />
        <div className="flex items-center justify-between border-t border-outline-variant p-md text-body-sm text-on-surface-variant">
          <span>Showing 1–{data?.length ?? 0} of {data?.length ?? 0} records</span>
          <div className="flex gap-1">
            <Button variant="secondary" size="sm"><Icon name="chevron_left" size={18} /></Button>
            <Button variant="secondary" size="sm"><Icon name="chevron_right" size={18} /></Button>
          </div>
        </div>
      </Card>

      {/* Detail drawer */}
      <Drawer open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        {selected && (
          <DrawerContent title={selected.id} subtitle={selected.system} width={480}>
            <div className="space-y-lg p-md">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone={catTone[selected.category]}>Cat {selected.category}</Badge>
                  <StatusChip status={selected.severity} />
                  <StatusChip status={selected.status} dot />
                </div>
                <p className="text-body-md text-on-surface">{selected.description}</p>
              </div>

              <div>
                <div className="mb-2 font-mono-tag text-label-md uppercase text-on-surface-variant">Work History</div>
                <ol className="relative space-y-3 border-l border-outline-variant pl-4">
                  {['Logged', 'Assigned', 'Repair', 'Closed'].map((step, i) => (
                    <li key={step} className="relative">
                      <span className={`absolute -left-[21px] top-1 h-3 w-3 rounded-full ${i < 2 ? 'bg-secondary' : 'bg-surface-container-high'}`} />
                      <div className="text-body-sm font-semibold text-on-surface">{step}</div>
                      <div className="text-body-sm text-on-surface-variant">{i < 2 ? `${selected.loggedAt}` : 'Pending'}</div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-lg bg-secondary/10 p-3">
                <div className="mb-1 font-mono-tag text-label-md uppercase text-secondary">Root Cause Analysis</div>
                <p className="text-body-sm text-on-surface">Instrument calibration drifted beyond tolerance during transport. Recommend full loop recalibration before retest.</p>
              </div>

              <Divider />
              <div className="flex gap-2">
                <Button variant="accent" className="flex-1" disabled={updateStatus.isPending} onClick={() => setStatus(selected, 'closed')}>
                  {updateStatus.isPending ? 'Saving…' : 'Approve & Close'}
                </Button>
                <Button variant="secondary" className="flex-1" disabled={updateStatus.isPending} onClick={() => setStatus(selected, 'open')}>
                  Reopen
                </Button>
              </div>
            </div>
          </DrawerContent>
        )}
      </Drawer>

      <LogDeficiencyDialog open={logOpen} onOpenChange={setLogOpen} projectId={activeProjectId} />
    </div>
  )
}
