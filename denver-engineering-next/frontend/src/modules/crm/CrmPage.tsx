import {
  KpiCard,
  Card,
  CardHeader,
  CardTitle,
  StatusChip,
  Progress,
  Button,
  Icon,
  DataTable,
  type ColumnDef,
} from '@ds'
import { useLeads, useFunnel, type Lead } from '@adapters'
import { PageHeader } from '../../components/shared'

export function CrmPage() {
  const { data: leads } = useLeads()
  const { data: funnel } = useFunnel()

  const cols: ColumnDef<Lead, unknown>[] = [
    { accessorKey: 'name', header: 'Opportunity', cell: (c) => <span className="font-semibold text-primary">{c.getValue() as string}</span> },
    { accessorKey: 'client', header: 'Client' },
    { accessorKey: 'estValue', header: 'Est. Value', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'probability', header: 'Win %', cell: (c) => <div className="flex items-center gap-2"><Progress value={c.getValue() as number} className="w-20" /> {c.getValue() as number}%</div> },
    { accessorKey: 'owner', header: 'Owner' },
    { accessorKey: 'stage', header: 'Stage', cell: (c) => <StatusChip status={c.getValue() as string} /> },
  ]

  return (
    <div className="space-y-lg">
      <PageHeader
        title="CRM — Lead Pipeline"
        subtitle="Opportunities, bid tracking & forecasting"
        actions={<Button variant="accent"><Icon name="add" size={18} /> New Lead</Button>}
      />

      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Total Pipeline" value="$1.24B" icon="trending_up" trend={{ direction: 'up', label: '+12%', tone: 'success' }} />
        <KpiCard label="Sales Velocity" value="42 days" icon="speed" />
        <KpiCard label="Avg Win Probability" value="38%" icon="percent" />
        <KpiCard label="New Leads (30d)" value="14" icon="person_add" trend={{ direction: 'down', label: '-2%', tone: 'danger' }} />
      </div>

      {/* Funnel */}
      <Card className="p-lg">
        <h3 className="mb-md text-headline-sm font-bold text-primary">Opportunity Funnel</h3>
        <div className="flex flex-col gap-2 md:flex-row">
          {funnel?.map((f, i) => (
            <div key={f.stage} className="flex-1">
              <div
                className="rounded-lg p-md text-white"
                style={{ background: ['#0058be', '#2170e4', '#3b82f6', '#16a34a'][i], opacity: 1 - i * 0.08 }}
              >
                <div className="font-mono-tag text-label-sm uppercase opacity-80">{f.stage}</div>
                <div className="text-headline-md font-bold">{f.count}</div>
                <div className="text-body-sm opacity-90">{f.value}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Active Leads</CardTitle></CardHeader>
        <DataTable columns={cols} data={leads ?? []} />
      </Card>
    </div>
  )
}
