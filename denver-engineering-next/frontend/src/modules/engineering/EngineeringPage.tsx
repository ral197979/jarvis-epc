import {
  KpiCard,
  Card,
  CardHeader,
  CardTitle,
  StatusChip,
  Button,
  Icon,
  Input,
  DataTable,
  type ColumnDef,
} from '@ds'
import { useDrawings, type DrawingRecord } from '@adapters'
import { PageHeader } from '../../components/shared'
import { useUi } from '../../lib/store'

export function EngineeringPage() {
  const activeProjectId = useUi((s) => s.activeProjectId)
  const { data } = useDrawings(activeProjectId)

  const cols: ColumnDef<DrawingRecord, unknown>[] = [
    { accessorKey: 'id', header: 'Doc ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'title', header: 'Title' },
    { accessorKey: 'discipline', header: 'Discipline' },
    { accessorKey: 'rev', header: 'Rev' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'reviewer', header: 'Reviewer' },
    { accessorKey: 'due', header: 'Due' },
  ]

  return (
    <div className="space-y-lg">
      <PageHeader
        title="Engineering"
        subtitle="Drawing register · RFIs · submittals · revision tracking"
        actions={<Button variant="accent"><Icon name="upload" size={18} /> Upload Drawing</Button>}
      />

      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Drawings" value="1,284" icon="draft" />
        <KpiCard label="Open RFIs" value="23" icon="quiz" trend={{ direction: 'down', label: '-4 this week', tone: 'success' }} />
        <KpiCard label="Submittals In Review" value="41" icon="rate_review" />
        <KpiCard label="Overdue Reviews" value="6" icon="warning" critical />
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Document Register</CardTitle>
          <Input icon="search" placeholder="Search…" className="w-56" />
        </CardHeader>
        <DataTable columns={cols} data={data ?? []} stickyFirst />
      </Card>
    </div>
  )
}
