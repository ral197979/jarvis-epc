import {
  Tabs, TabsList, TabsTrigger, TabsContent,
  Card, CardHeader, CardTitle, KpiCard, StatusChip, Badge, Progress, Button, Icon, Input, DataTable,
  cn, type ColumnDef,
} from '@ds'
import {
  useMaterials, useRequisitions, useReceiving,
  type MaterialItem, type Requisition, type ReceivingRecord,
} from '@adapters'
import { PageHeader, AiBanner } from '../../components/shared'

export function InventoryPage() {
  return (
    <div>
      <PageHeader
        title="Inventory & Materials"
        subtitle="Warehouse operations · materials registry · requisitions · receiving"
        actions={<Button variant="accent"><Icon name="qr_code_scanner" size={18} /> Scan Asset</Button>}
      />
      <Tabs defaultValue="overview">
        <TabsList className="mb-lg flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="materials">Materials Registry</TabsTrigger>
          <TabsTrigger value="requisitions">Requisitions</TabsTrigger>
          <TabsTrigger value="receiving">Receiving</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="materials"><MaterialsTab /></TabsContent>
        <TabsContent value="requisitions"><RequisitionsTab /></TabsContent>
        <TabsContent value="receiving"><ReceivingTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function OverviewTab() {
  const { data: materials = [] } = useMaterials()
  const low = materials.filter((m) => m.status !== 'In Stock').length
  const sites = [
    { name: 'Denver', turnover: 9.2, tone: 'bg-success' },
    { name: 'Houston', turnover: 11.4, tone: 'bg-success' },
    { name: 'Cheyenne', turnover: 6.1, tone: 'bg-warning' },
    { name: 'Supplier Transit', turnover: 8.8, tone: 'bg-info' },
  ]
  return (
    <div className="space-y-lg">
      <AiBanner text="AI pooling identified $242k of redistribution savings — 42 SKUs are critically low while sister sites hold surplus. Recommend 3 inter-site stock transfers." action="Execute Transfers" />
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Active SKUs" value="12,482" icon="inventory_2" trend={{ direction: 'up', label: '+3%', tone: 'success' }} />
        <KpiCard label="Critical Low Stock" value={String(42)} icon="warning" critical />
        <KpiCard label="Inbound (24h)" value="158" icon="local_shipping" hint="trucks scheduled" />
        <KpiCard label="On-Hand Value" value="$412M" icon="savings" trend={{ direction: 'up', label: '99.2% accuracy', tone: 'success' }} />
      </div>
      <div className="grid grid-cols-12 gap-lg">
        <Card className="col-span-12 p-lg lg:col-span-8">
          <h3 className="mb-md text-headline-sm font-bold text-primary">Inventory Turnover by Site</h3>
          <div className="space-y-md">
            {sites.map((s) => (
              <div key={s.name}>
                <div className="mb-1 flex justify-between text-body-sm"><span className="font-semibold text-on-surface">{s.name}</span><span className="font-mono-tag text-on-surface-variant">{s.turnover}x</span></div>
                <div className="h-6 w-full overflow-hidden rounded bg-surface-container-high">
                  <div className={cn('h-full rounded', s.tone)} style={{ width: `${(s.turnover / 12) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="col-span-12 p-lg lg:col-span-4">
          <h3 className="mb-md text-headline-sm font-bold text-primary">Stock Health</h3>
          <div className="space-y-3">
            <HealthRow label="In Stock" value={materials.length - low} tone="success" />
            <HealthRow label="Low / Reorder" value={materials.filter((m) => m.status === 'Low').length} tone="warning" />
            <HealthRow label="Out of Stock" value={materials.filter((m) => m.status === 'Out').length} tone="danger" />
          </div>
          <div className="mt-lg rounded-lg bg-surface-container-low p-3 text-body-sm text-on-surface-variant">
            <Icon name="savings" size={16} className="mr-1 align-text-bottom text-secondary" />
            AI redistribution savings this quarter: <span className="font-semibold text-primary">$2.4M</span>.
          </div>
        </Card>
      </div>
    </div>
  )
}

function HealthRow({ label, value, tone }: { label: string; value: number; tone: 'success' | 'warning' | 'danger' }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2 text-body-sm">
      <span className="flex items-center gap-2 text-on-surface"><span className={cn('h-2 w-2 rounded-full', tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : 'bg-danger')} /> {label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  )
}

function MaterialsTab() {
  const { data = [] } = useMaterials()
  const cols: ColumnDef<MaterialItem, unknown>[] = [
    { accessorKey: 'id', header: 'Asset ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'description', header: 'Component' },
    { accessorKey: 'category', header: 'Category' },
    { accessorKey: 'location', header: 'Location', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    {
      id: 'stock',
      header: 'Inventory',
      cell: (c) => {
        const r = c.row.original
        const pct = r.onHand ? Math.round((r.available / r.onHand) * 100) : 0
        return (
          <div className="flex items-center gap-2">
            <Progress value={pct} className="w-24" threshold />
            <span className="font-mono-tag text-label-md text-on-surface-variant">{r.available}/{r.onHand} {r.uom}</span>
          </div>
        )
      },
    },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} /> },
  ]
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Parts & Materials Registry</CardTitle>
        <Input icon="search" placeholder="Search materials…" className="w-56" />
      </CardHeader>
      <DataTable columns={cols} data={data} stickyFirst />
    </Card>
  )
}

const reqTone: Record<string, string> = { Draft: 'neutral', Submitted: 'info', Approved: 'purple', Issued: 'success' }

function RequisitionsTab() {
  const { data = [] } = useRequisitions()
  const cols: ColumnDef<Requisition, unknown>[] = [
    { accessorKey: 'id', header: 'REQ ID', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'item', header: 'Asset' },
    { accessorKey: 'qty', header: 'Qty', cell: (c) => <span className="font-mono-tag">{c.getValue() as number}</span> },
    { accessorKey: 'requestedBy', header: 'Requestor' },
    { accessorKey: 'project', header: 'Project', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'status', header: 'Status', cell: (c) => <Badge tone={(reqTone[c.getValue() as string] ?? 'neutral') as never} dot>{c.getValue() as string}</Badge> },
    { accessorKey: 'date', header: 'Date' },
  ]
  return (
    <div className="space-y-lg">
      <AiBanner text="REQ-3002 (MV Cable) flagged Critical (priority 94%). AI sourcing suggests an internal transfer from Houston — 85% cheaper than expedited buy." action="Approve Transfer" />
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Recent Requisitions</CardTitle>
          <Button variant="accent" size="sm"><Icon name="add" size={18} /> New Requisition</Button>
        </CardHeader>
        <DataTable columns={cols} data={data} stickyFirst />
      </Card>
    </div>
  )
}

function ReceivingTab() {
  const { data = [] } = useReceiving()
  const cols: ColumnDef<ReceivingRecord, unknown>[] = [
    { accessorKey: 'id', header: 'GRN', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'po', header: 'PO #', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'item', header: 'Item' },
    {
      id: 'qty',
      header: 'Received',
      cell: (c) => {
        const r = c.row.original
        const pct = r.qtyExpected ? Math.round((r.qtyReceived / r.qtyExpected) * 100) : 0
        return (
          <div className="flex items-center gap-2">
            <Progress value={pct} className="w-24" threshold />
            <span className="font-mono-tag text-label-md text-on-surface-variant">{r.qtyReceived}/{r.qtyExpected}</span>
          </div>
        )
      },
    },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} dot /> },
    { accessorKey: 'date', header: 'Date' },
  ]
  const discrepancies = data.filter((r) => r.status === 'Discrepancy' || r.status === 'Partial').length
  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Inbound Today" value="12" icon="local_shipping" hint="trucks" />
        <KpiCard label="Open Discrepancies" value={String(discrepancies)} icon="error" critical={discrepancies > 0} />
        <KpiCard label="Receiving Efficiency" value="92%" icon="speed" trend={{ direction: 'up', label: 'On target', tone: 'success' }} />
        <KpiCard label="Floor Technicians" value="4" icon="engineering" hint="2 active · 1 on break" />
      </div>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Live Receiving Queue</CardTitle></CardHeader>
        <DataTable columns={cols} data={data} stickyFirst />
      </Card>
    </div>
  )
}
