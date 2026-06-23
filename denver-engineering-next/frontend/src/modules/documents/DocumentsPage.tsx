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
import { useDocuments, type DocumentRecord } from '@adapters'
import { PageHeader } from '../../components/shared'

const typeIcon: Record<string, string> = {
  Plan: 'description',
  Procedure: 'menu_book',
  Report: 'summarize',
  Transmittal: 'forward_to_inbox',
}

export function DocumentsPage() {
  const { data } = useDocuments()

  const cols: ColumnDef<DocumentRecord, unknown>[] = [
    { accessorKey: 'id', header: 'Doc ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    {
      accessorKey: 'title',
      header: 'Title',
      cell: (c) => (
        <span className="flex items-center gap-2">
          <Icon name={typeIcon[c.row.original.type] ?? 'description'} size={18} className="text-on-surface-variant" />
          {c.getValue() as string}
        </span>
      ),
    },
    { accessorKey: 'type', header: 'Type' },
    { accessorKey: 'rev', header: 'Rev' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'owner', header: 'Owner' },
    { accessorKey: 'updated', header: 'Updated' },
  ]

  return (
    <div className="space-y-lg">
      <PageHeader
        title="Document Control"
        subtitle="Register · versioning · approval workflow · transmittals"
        actions={<Button variant="accent"><Icon name="upload_file" size={18} /> Upload</Button>}
      />

      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Controlled Docs" value="3,402" icon="folder_managed" />
        <KpiCard label="Pending Approval" value="28" icon="pending_actions" />
        <KpiCard label="Transmittals (30d)" value="64" icon="send" />
        <KpiCard label="Superseded" value="412" icon="history" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Document Register</CardTitle>
          <Input icon="search" placeholder="Search documents…" className="w-56" />
        </CardHeader>
        <DataTable columns={cols} data={data ?? []} stickyFirst />
      </Card>
    </div>
  )
}
