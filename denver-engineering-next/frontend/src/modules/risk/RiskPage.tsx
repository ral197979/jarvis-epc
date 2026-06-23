import {
  Tabs, TabsList, TabsTrigger, TabsContent,
  Card, CardHeader, CardTitle, KpiCard, Badge, StatusChip, Button, Icon, DataTable,
  cn, type ColumnDef,
} from '@ds'
import { useRiskEntries, useContingency, type RiskEntry, type ContingencyItem } from '@adapters'
import { PageHeader, AiBanner } from '../../components/shared'

export function RiskPage() {
  return (
    <div>
      <PageHeader
        title="Risk"
        subtitle="Probability × impact matrix · register · contingency"
        actions={<Button variant="accent"><Icon name="add" size={18} /> New Risk</Button>}
      />
      <Tabs defaultValue="matrix">
        <TabsList className="mb-lg">
          <TabsTrigger value="matrix">Matrix</TabsTrigger>
          <TabsTrigger value="register">Register</TabsTrigger>
          <TabsTrigger value="contingency">Contingency</TabsTrigger>
        </TabsList>
        <TabsContent value="matrix"><MatrixTab /></TabsContent>
        <TabsContent value="register"><RegisterTab /></TabsContent>
        <TabsContent value="contingency"><ContingencyTab /></TabsContent>
      </Tabs>
    </div>
  )
}

// 5×5 cell colour by probability(row, 5=top) × impact(col)
function cellColor(p: number, i: number): string {
  const score = p * i
  if (score >= 15) return 'bg-danger/80'
  if (score >= 8) return 'bg-warning/70'
  if (score >= 4) return 'bg-amber-300/70'
  return 'bg-success/60'
}
const PROB = ['V.High', 'High', 'Medium', 'Low', 'V.Low'] // rows top→bottom = p5..p1
const IMPACT = ['Negligible', 'Minor', 'Moderate', 'Major', 'Critical'] // cols = i1..i5

function MatrixTab() {
  const { data = [] } = useRiskEntries()
  const open = data.filter((r) => r.status !== 'Closed')
  const critical = data.filter((r) => r.severity === 'Critical').length

  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Active Risks" value={String(open.length)} icon="warning" trend={{ direction: 'up', label: '+1 this week', tone: 'danger' }} />
        <KpiCard label="Critical Risks" value={String(critical).padStart(2, '0')} icon="priority_high" critical={critical > 0} />
        <KpiCard label="Mitigating" value={String(data.filter((r) => r.status === 'Mitigating').length)} icon="shield" />
        <KpiCard label="Closed" value={String(data.filter((r) => r.status === 'Closed').length)} icon="check_circle" trend={{ direction: 'up', label: 'retired', tone: 'success' }} />
      </div>
      <Card className="p-lg">
        <h3 className="mb-md text-headline-sm font-bold text-primary">Risk Matrix (Probability × Impact)</h3>
        <div className="flex gap-2">
          <div className="flex flex-col justify-around pr-1 font-mono-tag text-label-sm uppercase text-on-surface-variant" style={{ writingMode: 'vertical-rl' }}>Probability</div>
          <div className="flex-1">
            <div className="grid grid-cols-5 gap-1">
              {[5, 4, 3, 2, 1].map((p, rowIdx) =>
                [1, 2, 3, 4, 5].map((i) => {
                  const here = open.filter((r) => r.probability === p && r.impact === i)
                  return (
                    <div key={`${p}-${i}`} className={cn('relative flex h-16 items-center justify-center rounded', cellColor(p, i))}>
                      {rowIdx === 0 && <span className="absolute -top-4 font-mono-tag text-[9px] uppercase text-on-surface-variant">{IMPACT[i - 1]}</span>}
                      {here.map((r) => (
                        <span key={r.id} title={`${r.id} · ${r.title}`} className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-on-primary ring-2 ring-white transition-transform hover:scale-125">
                          {r.id.replace('RK-', '')}
                        </span>
                      ))}
                    </div>
                  )
                }),
              )}
            </div>
            <div className="mt-5 flex justify-between font-mono-tag text-label-sm uppercase text-on-surface-variant"><span>Impact →</span></div>
          </div>
          <div className="flex flex-col justify-around pl-1 font-mono-tag text-label-sm uppercase text-on-surface-variant">
            {PROB.map((l) => <span key={l} className="h-16 leading-[4rem]">{l}</span>)}
          </div>
        </div>
        <div className="mt-md flex flex-wrap gap-3 text-body-sm">
          <Legend cls="bg-success/60" label="Low" /><Legend cls="bg-amber-300/70" label="Medium" /><Legend cls="bg-warning/70" label="High" /><Legend cls="bg-danger/80" label="Critical" />
        </div>
      </Card>
    </div>
  )
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="flex items-center gap-1"><span className={cn('h-3 w-3 rounded-sm', cls)} /> {label}</span>
}

function RegisterTab() {
  const { data = [] } = useRiskEntries()
  const cols: ColumnDef<RiskEntry, unknown>[] = [
    { accessorKey: 'id', header: 'ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'title', header: 'Risk' },
    { accessorKey: 'category', header: 'Category' },
    { id: 'score', header: 'Score', cell: (c) => <span className="font-mono-tag font-bold">{c.row.original.probability * c.row.original.impact}</span> },
    { accessorKey: 'severity', header: 'Severity', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'response', header: 'Response', cell: (c) => <Badge tone="info">{c.getValue() as string}</Badge> },
    { accessorKey: 'owner', header: 'Owner' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} dot /> },
  ]
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Risk Register</CardTitle>
        <Button variant="accent" size="sm"><Icon name="add" size={18} /> Log Risk</Button>
      </CardHeader>
      <DataTable columns={cols} data={data} stickyFirst />
    </Card>
  )
}

const cnTone: Record<string, 'success' | 'warning' | 'danger'> = { Healthy: 'success', Watch: 'warning', Depleted: 'danger' }

function ContingencyTab() {
  const { data = [] } = useContingency()
  const cols: ColumnDef<ContingencyItem, unknown>[] = [
    { accessorKey: 'id', header: 'ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'name', header: 'Reserve' },
    { accessorKey: 'allocated', header: 'Allocated', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'drawn', header: 'Drawn', cell: (c) => <span className="font-mono-tag text-danger">{c.getValue() as string}</span> },
    { accessorKey: 'remaining', header: 'Remaining', cell: (c) => <span className="font-mono-tag font-semibold text-success">{c.getValue() as string}</span> },
    { accessorKey: 'status', header: 'Status', cell: (c) => <Badge tone={cnTone[c.getValue() as string] ?? 'neutral'} dot>{c.getValue() as string}</Badge> },
  ]
  const depleted = data.filter((c) => c.status === 'Depleted').length
  return (
    <div className="space-y-lg">
      {depleted > 0 && (
        <AiBanner text="Scope-change allowance is fully depleted and the procurement reserve is on watch (82% drawn). Forecast zero-balance ~Oct 14 — 12 days before the deck-formwork milestone. Recommend a drawdown request." action="Request Drawdown" />
      )}
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Total Reserve" value="$22.0M" icon="account_balance" />
        <KpiCard label="Drawn" value="$13.5M" icon="payments" hint="61% utilised" />
        <KpiCard label="Remaining" value="$8.5M" icon="savings" trend={{ direction: 'down', label: '39% left', tone: 'danger' }} />
        <KpiCard label="Depleted Reserves" value={String(depleted)} icon="warning" critical={depleted > 0} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Contingency Reserves</CardTitle></CardHeader>
        <DataTable columns={cols} data={data} stickyFirst />
      </Card>
    </div>
  )
}
