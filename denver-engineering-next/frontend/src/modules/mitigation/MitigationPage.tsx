import { useState } from 'react'
import {
  Card, CardHeader, CardTitle, KpiCard, Badge, StatusChip, Progress, Button, Icon, DataTable,
  cn, type ColumnDef,
} from '@ds'
import { useMitigationPlans, useResourceShifts, type MitigationPlan, type ResourceShift } from '@adapters'
import { PageHeader, AiBanner } from '../../components/shared'

const sevTone: Record<string, 'warning' | 'danger'> = { Medium: 'warning', High: 'warning', Critical: 'danger' }

export function MitigationPage() {
  const { data: plans = [] } = useMitigationPlans()
  const { data: shifts = [] } = useResourceShifts()
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const statusOf = (p: MitigationPlan) => overrides[p.id] ?? p.status
  const act = (id: string, status: string) => {
    setBusy(id)
    setTimeout(() => {
      setOverrides((prev) => ({ ...prev, [id]: status }))
      setBusy(null)
    }, 900)
  }

  const proposed = plans.filter((p) => statusOf(p) === 'Proposed')
  const recoverable = proposed.reduce((s, p) => s + Math.abs(Math.min(0, p.scheduleImpactDays)), 0)

  const shiftCols: ColumnDef<ResourceShift, unknown>[] = [
    { accessorKey: 'resource', header: 'Resource', cell: (c) => <span className="font-semibold text-primary">{c.getValue() as string}</span> },
    { accessorKey: 'count', header: 'Qty', cell: (c) => <span className="font-mono-tag">×{c.getValue() as number}</span> },
    { accessorKey: 'from', header: 'From' },
    {
      id: 'arrow', header: '',
      cell: () => <Icon name="arrow_forward" size={16} className="text-secondary" />,
    },
    { accessorKey: 'to', header: 'To' },
    { accessorKey: 'eta', header: 'ETA' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} dot /> },
  ]

  return (
    <div className="space-y-lg">
      <PageHeader
        title="AI Mitigation Hub"
        subtitle="Disruption response · resource reallocation · shift execution"
        actions={<Badge tone="info" dot>Live optimization</Badge>}
      />

      <AiBanner
        text={`${proposed.length} mitigation plans staged against active disruptions on Gulf Coast LNG. Executing all proposed plans recovers ~${recoverable} days of critical-path float for a combined +$2.6M.`}
        action="Execute All"
      />

      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Active Disruptions" value={String(plans.length)} icon="crisis_alert" critical />
        <KpiCard label="Mitigations Proposed" value={String(proposed.length)} icon="auto_fix_high" />
        <KpiCard label="Days Recoverable" value={`${recoverable}`} icon="fast_forward" trend={{ direction: 'up', label: 'critical path', tone: 'success' }} />
        <KpiCard label="Crews Reallocating" value={String(shifts.reduce((s, x) => s + x.count, 0))} icon="groups" />
      </div>

      {/* Mitigation plans */}
      <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
        {plans.map((p) => {
          const st = statusOf(p)
          return (
            <Card key={p.id} className={cn('flex flex-col p-lg', st === 'Executed' && 'border-success', st === 'Dismissed' && 'opacity-60')}>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono-tag text-label-md text-on-surface-variant">{p.id}</span>
                <Badge tone={sevTone[p.severity] ?? 'warning'}>{p.severity}</Badge>
              </div>
              <div className="text-body-sm font-semibold text-danger">⚠ {p.trigger}</div>
              <p className="mt-2 flex-1 text-body-sm text-on-surface">{p.recommendation}</p>

              <div className="mt-md grid grid-cols-3 gap-2 border-t border-outline-variant pt-md text-center">
                <Metric label="Schedule" value={`${p.scheduleImpactDays}d`} good={p.scheduleImpactDays < 0} />
                <Metric label="Cost" value={p.costImpact} good={p.costImpact.startsWith('-')} />
                <div>
                  <div className="font-mono-tag text-label-sm uppercase text-on-surface-variant">Confidence</div>
                  <div className="mt-1 flex items-center justify-center gap-1"><Progress value={p.confidence} className="w-10" threshold /> <span className="font-mono-tag text-body-sm">{p.confidence}%</span></div>
                </div>
              </div>

              <div className="mt-md">
                {st === 'Proposed' ? (
                  <div className="flex gap-2">
                    <Button variant="accent" size="sm" className="flex-1" disabled={busy === p.id} onClick={() => act(p.id, 'Executed')}>
                      {busy === p.id ? <><Icon name="progress_activity" size={16} className="animate-spin" /> Executing…</> : <><Icon name="bolt" size={16} /> Execute Plan</>}
                    </Button>
                    <Button variant="secondary" size="sm" disabled={busy === p.id} onClick={() => act(p.id, 'Dismissed')}>Dismiss</Button>
                  </div>
                ) : (
                  <Badge tone={st === 'Executed' ? 'success' : 'neutral'} dot className="w-full justify-center py-1.5">{st}</Badge>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      {/* Resource reallocation */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Resource Reallocation</CardTitle>
          <span className="font-mono-tag text-label-md text-on-surface-variant">{shifts.length} shifts in motion</span>
        </CardHeader>
        <DataTable columns={shiftCols} data={shifts} />
      </Card>
    </div>
  )
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div>
      <div className="font-mono-tag text-label-sm uppercase text-on-surface-variant">{label}</div>
      <div className={cn('mt-0.5 font-mono-tag font-bold', good ? 'text-success' : 'text-danger')}>{value}</div>
    </div>
  )
}
