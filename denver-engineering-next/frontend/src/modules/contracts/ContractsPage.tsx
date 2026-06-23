import {
  Tabs, TabsList, TabsTrigger, TabsContent,
  Card, CardHeader, CardTitle, KpiCard, StatusChip, Badge, Button, Icon, DataTable, type ColumnDef,
} from '@ds'
import {
  useContracts, useChangeOrders, useCompliance,
  type Contract, type ChangeOrder, type ComplianceItem,
} from '@adapters'
import { PageHeader, AiBanner } from '../../components/shared'
import { useUi } from '../../lib/store'

export function ContractsPage() {
  return (
    <div>
      <PageHeader
        title="Contracts"
        subtitle="Prime & subcontract register · change orders · compliance"
        actions={<Button variant="accent"><Icon name="add" size={18} /> New Contract</Button>}
      />
      <Tabs defaultValue="register">
        <TabsList className="mb-lg">
          <TabsTrigger value="register">Register &amp; Change Orders</TabsTrigger>
          <TabsTrigger value="compliance">Compliance Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="register"><RegisterTab /></TabsContent>
        <TabsContent value="compliance"><ComplianceTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function RegisterTab() {
  const activeProjectId = useUi((s) => s.activeProjectId)
  const { data: contracts = [] } = useContracts(activeProjectId)
  const { data: changeOrders = [] } = useChangeOrders(activeProjectId)

  const executed = contracts.filter((c) => c.status === 'Executed').length
  const pendingCos = changeOrders.filter((c) => c.status !== 'Approved').length

  const contractCols: ColumnDef<Contract, unknown>[] = [
    { accessorKey: 'id', header: 'Contract', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'title', header: 'Title' },
    { accessorKey: 'counterparty', header: 'Counterparty' },
    { accessorKey: 'type', header: 'Type' },
    { accessorKey: 'value', header: 'Value', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} /> },
    { accessorKey: 'executed', header: 'Executed' },
  ]
  const coCols: ColumnDef<ChangeOrder, unknown>[] = [
    { accessorKey: 'id', header: 'CO', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'contractId', header: 'Contract', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'description', header: 'Description' },
    {
      accessorKey: 'value',
      header: 'Value',
      cell: (c) => {
        const v = c.getValue() as string
        return <span className={`font-mono-tag font-semibold ${v.startsWith('-') ? 'text-success' : 'text-danger'}`}>{v}</span>
      },
    },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} dot /> },
  ]

  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Contracts" value={String(contracts.length)} icon="gavel" />
        <KpiCard label="Executed" value={String(executed)} icon="verified" trend={{ direction: 'up', label: 'In force', tone: 'success' }} />
        <KpiCard label="Change Orders" value={String(changeOrders.length)} icon="edit_document" />
        <KpiCard label="Pending COs" value={String(pendingCos)} icon="pending_actions" critical={pendingCos > 0} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Contract Register</CardTitle></CardHeader>
        <DataTable columns={contractCols} data={contracts} stickyFirst />
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Change Orders</CardTitle>
          <Badge tone="warning">{pendingCos} pending</Badge>
        </CardHeader>
        <DataTable columns={coCols} data={changeOrders} stickyFirst />
      </Card>
    </div>
  )
}

const compTone: Record<string, 'success' | 'warning' | 'danger'> = { Compliant: 'success', 'At Risk': 'warning', Breach: 'danger' }

function ComplianceTab() {
  const { data = [] } = useCompliance()
  const breaches = data.filter((c) => c.status === 'Breach').length
  const atRisk = data.filter((c) => c.status === 'At Risk').length
  const passRate = data.length ? Math.round((data.filter((c) => c.status === 'Compliant').length / data.length) * 100) : 0

  const cols: ColumnDef<ComplianceItem, unknown>[] = [
    { accessorKey: 'contractId', header: 'Contract', cell: (c) => <span className="font-mono-tag">{c.getValue() as string}</span> },
    { accessorKey: 'clause', header: 'Clause' },
    { accessorKey: 'requirement', header: 'Requirement' },
    { accessorKey: 'owner', header: 'Owner' },
    { accessorKey: 'due', header: 'Due' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <Badge tone={compTone[c.getValue() as string] ?? 'neutral'} dot>{c.getValue() as string}</Badge> },
  ]

  return (
    <div className="space-y-lg">
      {breaches > 0 && (
        <AiBanner
          text={`${breaches} clause in active breach (CTR-021 performance bond overdue). Estimated LD exposure on CTR-001 is $50k/day past Nov 15 — recommend escalation.`}
          action="Run Compliance Scan"
        />
      )}
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Audit Pass Rate" value={`${passRate}%`} icon="fact_check" trend={{ direction: 'up', label: 'tracked clauses', tone: 'success' }} />
        <KpiCard label="At Risk" value={String(atRisk)} icon="warning" />
        <KpiCard label="In Breach" value={String(breaches)} icon="gavel" critical={breaches > 0} />
        <KpiCard label="Contractual Value" value="$2.4B" icon="payments" trend={{ direction: 'up', label: '+4.2%', tone: 'success' }} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Clause Compliance Audit</CardTitle></CardHeader>
        <DataTable columns={cols} data={data} stickyFirst />
      </Card>
    </div>
  )
}
