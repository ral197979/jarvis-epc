import { Card, CardHeader, CardTitle, KpiCard, StatusChip, Progress, DataTable, type ColumnDef } from '@ds'
import { usePfc, type PfcItem } from '@adapters'

export function PfcManagement() {
  const { data = [] } = usePfc()
  const signed = data.filter((p) => p.status === 'Signed Off').length
  const inProgress = data.filter((p) => p.status === 'In Progress').length
  const notStarted = data.filter((p) => p.status === 'Not Started').length

  const cols: ColumnDef<PfcItem, unknown>[] = [
    { accessorKey: 'id', header: 'PFC ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'system', header: 'System' },
    { accessorKey: 'equipmentTag', header: 'Equipment', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'description', header: 'Description' },
    {
      id: 'checks',
      header: 'Checksheets',
      cell: (c) => {
        const r = c.row.original
        const pct = r.checksTotal ? Math.round((r.checksComplete / r.checksTotal) * 100) : 0
        return (
          <div className="flex items-center gap-2">
            <Progress value={pct} className="w-24" threshold />
            <span className="font-mono-tag text-label-md text-on-surface-variant">{r.checksComplete}/{r.checksTotal}</span>
          </div>
        )
      },
    },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'signedBy', header: 'Signed By' },
  ]

  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Total PFCs" value={String(data.length)} icon="fact_check" />
        <KpiCard label="Signed Off" value={String(signed)} icon="task_alt" trend={{ direction: 'up', label: 'Ready for FPT', tone: 'success' }} />
        <KpiCard label="In Progress" value={String(inProgress)} icon="pending" />
        <KpiCard label="Not Started" value={String(notStarted)} icon="schedule" critical={notStarted > 0} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Pre-Functional Checks</CardTitle>
          <span className="font-mono-tag text-label-md text-on-surface-variant">Pre-energization sign-off</span>
        </CardHeader>
        <DataTable columns={cols} data={data} stickyFirst />
      </Card>
    </div>
  )
}
