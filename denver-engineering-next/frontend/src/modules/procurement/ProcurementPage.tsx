import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ZAxis,
  ScatterChart,
  Scatter,
  ResponsiveContainer,
  Tooltip as RTooltip,
  CartesianGrid,
} from 'recharts'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
  KpiCard,
  Card,
  CardHeader,
  CardTitle,
  StatusChip,
  Badge,
  Progress,
  Button,
  Icon,
  DataTable,
  type ColumnDef,
} from '@ds'
import {
  usePurchaseOrders, useLongLead, useVendors, useVendorScores,
  type PurchaseOrder, type VendorScore,
} from '@adapters'
import { PageHeader, CriticalAlert, AiBanner } from '../../components/shared'

export function ProcurementPage() {
  return (
    <div>
      <PageHeader
        title="Procurement"
        subtitle="PO tracking · long-lead expediting · vendor performance"
        actions={<Button variant="accent"><Icon name="add" size={18} /> New PO</Button>}
      />
      <Tabs defaultValue="board">
        <TabsList className="mb-lg">
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="vendors">Vendor Performance</TabsTrigger>
        </TabsList>
        <TabsContent value="board"><BoardTab /></TabsContent>
        <TabsContent value="vendors"><VendorPerformanceTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function BoardTab() {
  const { data: pos } = usePurchaseOrders()
  const { data: longLead } = useLongLead()
  const { data: vendors } = useVendors()

  const cols: ColumnDef<PurchaseOrder, unknown>[] = [
    { accessorKey: 'id', header: 'PO #', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'vendor', header: 'Vendor' },
    { accessorKey: 'description', header: 'Description' },
    { accessorKey: 'value', header: 'Value', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'expediting', header: 'Expediting', cell: (c) => <StatusChip status={c.getValue() as string} dot /> },
  ]

  return (
    <div className="space-y-lg">

      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Total POs" value="124" icon="receipt_long" trend={{ direction: 'up', label: '+12', tone: 'success' }} />
        <KpiCard label="Approved" value="98" icon="check_circle" hint="79% of total" />
        <KpiCard label="Pending" value="18" icon="hourglass_top" hint="8 awaiting review" />
        <KpiCard label="Delayed" value="8" icon="warning" critical />
      </div>

      <div className="grid grid-cols-12 gap-lg">
        {/* Long-lead tracker */}
        <Card className="col-span-12 p-lg lg:col-span-4">
          <h3 className="mb-md text-headline-sm font-bold text-primary">Long-Lead Tracker</h3>
          <div className="space-y-md">
            {longLead?.map((l) => (
              <div key={l.id}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-body-sm font-semibold text-on-surface">{l.name}</span>
                  <StatusChip status={l.status} />
                </div>
                <Progress value={l.progressPct} threshold />
                <div className="mt-1 flex justify-between font-mono-tag text-label-sm text-on-surface-variant">
                  <span>Ordered {l.ordered}</span><span>ETA {l.eta}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* PO register */}
        <Card className="col-span-12 overflow-hidden lg:col-span-8">
          <CardHeader><CardTitle>Purchase Order Register</CardTitle></CardHeader>
          <DataTable columns={cols} data={pos ?? []} stickyFirst />
        </Card>
      </div>

      <div className="grid grid-cols-12 gap-lg">
        <Card className="col-span-12 p-lg lg:col-span-6">
          <h3 className="mb-md text-headline-sm font-bold text-primary">Vendor Lead Time (days)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={vendors ?? []}>
              <CartesianGrid vertical={false} stroke="#dce9ff" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <RTooltip contentStyle={{ borderRadius: 8, border: '1px solid #c5c6cd', fontSize: 12 }} />
              <Bar dataKey="avgLeadTimeDays" fill="#0058be" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <div className="col-span-12 lg:col-span-6">
          <CriticalAlert
            title="Expediting Alert — PO-4510-14"
            body="Siemens gas turbine generators delayed 6 weeks; impacts RFSU milestone. Mitigation: dual-source the secondary lot."
            action="Open Mitigation"
          />
        </div>
      </div>
    </div>
  )
}

const tierTone: Record<string, 'purple' | 'info' | 'neutral' | 'warning'> = {
  Strategic: 'purple', Preferred: 'info', Approved: 'neutral', Watchlist: 'warning',
}

function VendorPerformanceTab() {
  const { data = [] } = useVendorScores()
  const scatter = data.map((v) => ({ x: 100 - v.leadTimeDays / 3, y: v.qualityPct, z: 1, name: v.name, status: v.status }))

  const cols: ColumnDef<VendorScore, unknown>[] = [
    { accessorKey: 'name', header: 'Vendor', cell: (c) => <span className="font-semibold text-primary">{c.getValue() as string}</span> },
    { accessorKey: 'tier', header: 'Tier', cell: (c) => <Badge tone={tierTone[c.getValue() as string] ?? 'neutral'}>{c.getValue() as string}</Badge> },
    { accessorKey: 'onTimePct', header: 'On-Time', cell: (c) => <div className="flex items-center gap-2"><Progress value={c.getValue() as number} className="w-20" threshold /> {c.getValue() as number}%</div> },
    { accessorKey: 'qualityPct', header: 'Quality', cell: (c) => <div className="flex items-center gap-2"><Progress value={c.getValue() as number} className="w-20" threshold /> {c.getValue() as number}%</div> },
    { accessorKey: 'leadTimeDays', header: 'Lead Time', cell: (c) => <span className="font-mono-tag">{c.getValue() as number}d</span> },
    { accessorKey: 'spend', header: 'Spend', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} /> },
  ]

  return (
    <div className="space-y-lg">
      <AiBanner text="SparkElec (Watchlist) is the dominant supply risk — 61% on-time, 74% quality. Consolidating H-beam volume with Sulzer unlocks a 12% discount (~$142k)." action="Run Performance Audit" />
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Strategic Partners" value={String(data.filter((v) => v.tier === 'Strategic').length)} icon="handshake" trend={{ direction: 'up', label: '+3', tone: 'success' }} />
        <KpiCard label="Avg Reliability" value={`${data.length ? Math.round(data.reduce((s, v) => s + v.onTimePct, 0) / data.length) : 0}%`} icon="verified" />
        <KpiCard label="Active Contract Value" value="$1.2B" icon="payments" hint="185 agreements" />
        <KpiCard label="At-Risk Vendors" value={String(data.filter((v) => v.status === 'Blocking').length)} icon="warning" critical={data.some((v) => v.status === 'Blocking')} />
      </div>
      <div className="grid grid-cols-12 gap-lg">
        <Card className="col-span-12 p-lg lg:col-span-5">
          <h3 className="mb-md text-headline-sm font-bold text-primary">Reliability vs Cost Efficiency</h3>
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
              <CartesianGrid stroke="#dce9ff" />
              <XAxis type="number" dataKey="x" name="Cost Efficiency" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} label={{ value: 'Cost Efficiency →', position: 'insideBottom', offset: -8, fontSize: 10 }} />
              <YAxis type="number" dataKey="y" name="Reliability" domain={[60, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <ZAxis type="number" dataKey="z" range={[120, 121]} />
              <RTooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 8, border: '1px solid #c5c6cd', fontSize: 12 }} formatter={(_value, _name, p) => [(p?.payload as { name: string })?.name, '']} />
              <Scatter data={scatter} fill="#0058be" />
            </ScatterChart>
          </ResponsiveContainer>
        </Card>
        <Card className="col-span-12 overflow-hidden lg:col-span-7">
          <CardHeader><CardTitle>Strategic Partner Registry</CardTitle></CardHeader>
          <DataTable columns={cols} data={data} />
        </Card>
      </div>
    </div>
  )
}
