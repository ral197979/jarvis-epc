import { useState } from 'react'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
  Card, CardHeader, CardTitle, KpiCard, Badge, StatusChip, Button, Icon, DataTable,
  cn, type ColumnDef,
} from '@ds'
import { useReportTemplates, useRecentReports, type GeneratedReport } from '@adapters'
import { PageHeader } from '../../components/shared'

export function ReportsPage() {
  return (
    <div>
      <PageHeader
        title="Reports Center"
        subtitle="Templates · generated reports · custom builder"
        actions={<Button variant="accent"><Icon name="add" size={18} /> New Report</Button>}
      />
      <Tabs defaultValue="templates">
        <TabsList className="mb-lg">
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="recent">Generated</TabsTrigger>
          <TabsTrigger value="builder">Builder</TabsTrigger>
        </TabsList>
        <TabsContent value="templates"><TemplatesTab /></TabsContent>
        <TabsContent value="recent"><RecentTab /></TabsContent>
        <TabsContent value="builder"><BuilderTab /></TabsContent>
      </Tabs>
    </div>
  )
}

const catTone: Record<string, 'purple' | 'info' | 'success' | 'warning' | 'neutral'> = {
  Executive: 'purple', Commercial: 'info', Commissioning: 'success', Safety: 'warning', Technical: 'neutral',
}

function TemplatesTab() {
  const { data = [] } = useReportTemplates()
  const { data: recent = [] } = useRecentReports()
  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <KpiCard label="Templates" value={String(data.length)} icon="dashboard_customize" />
        <KpiCard label="Generated (30d)" value={String(recent.length)} icon="description" />
        <KpiCard label="Scheduled" value={String(recent.filter((r) => r.status === 'Scheduled').length)} icon="schedule_send" />
        <KpiCard label="Auto-distributed" value="12" icon="forward_to_inbox" trend={{ direction: 'up', label: 'to stakeholders', tone: 'success' }} />
      </div>
      <div className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-3">
        {data.map((t) => (
          <Card key={t.id} className="flex flex-col p-lg">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-on-primary"><Icon name={t.icon} /></div>
              <Badge tone={catTone[t.category] ?? 'neutral'}>{t.category}</Badge>
            </div>
            <h3 className="text-headline-sm font-bold text-primary">{t.name}</h3>
            <p className="mt-1 flex-1 text-body-sm text-on-surface-variant">{t.description}</p>
            <div className="mt-md flex gap-2">
              <Button variant="accent" size="sm" className="flex-1"><Icon name="play_arrow" size={18} /> Generate</Button>
              <Button variant="secondary" size="sm"><Icon name="visibility" size={18} /></Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function RecentTab() {
  const { data = [] } = useRecentReports()
  const cols: ColumnDef<GeneratedReport, unknown>[] = [
    { accessorKey: 'name', header: 'Report', cell: (c) => <span className="font-semibold text-primary">{c.getValue() as string}</span> },
    { accessorKey: 'template', header: 'Template' },
    { accessorKey: 'generatedBy', header: 'By' },
    { accessorKey: 'date', header: 'Date' },
    { accessorKey: 'format', header: 'Format', cell: (c) => <Badge tone="neutral">{c.getValue() as string}</Badge> },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} dot /> },
    {
      id: 'dl', header: '',
      cell: (c) => c.row.original.status === 'Ready'
        ? <button className="font-semibold text-secondary hover:underline">Download</button>
        : <span className="text-on-surface-variant">—</span>,
    },
  ]
  return (
    <Card className="overflow-hidden">
      <CardHeader><CardTitle>Generated Reports</CardTitle></CardHeader>
      <DataTable columns={cols} data={data} />
    </Card>
  )
}

const SECTIONS = [
  'Executive Summary', 'Portfolio KPIs', 'Financials / EVM', 'Schedule & Milestones',
  'Commissioning Readiness', 'Risk Register', 'Procurement Status', 'Safety / HSE', 'Appendices',
]

function BuilderTab() {
  const [selected, setSelected] = useState<string[]>(['Executive Summary', 'Portfolio KPIs', 'Financials / EVM'])
  const [generating, setGenerating] = useState(false)
  const [done, setDone] = useState(false)

  const toggle = (s: string) =>
    setSelected((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))

  const generate = () => {
    setGenerating(true)
    setDone(false)
    setTimeout(() => { setGenerating(false); setDone(true) }, 1200)
  }

  return (
    <div className="grid grid-cols-12 gap-lg">
      <Card className="col-span-12 p-lg lg:col-span-5">
        <h3 className="mb-md text-headline-sm font-bold text-primary">Report Sections</h3>
        <div className="space-y-2">
          {SECTIONS.map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-3 rounded-lg border border-outline-variant bg-background px-3 py-2.5 text-body-sm hover:bg-surface-container-low">
              <input type="checkbox" checked={selected.includes(s)} onChange={() => { toggle(s); setDone(false) }} className="h-4 w-4 accent-secondary" />
              <span className={cn(selected.includes(s) ? 'font-medium text-on-surface' : 'text-on-surface-variant')}>{s}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card className="col-span-12 flex flex-col p-lg lg:col-span-7">
        <div className="mb-md flex items-center justify-between">
          <h3 className="text-headline-sm font-bold text-primary">Live Preview</h3>
          <Badge tone="info">{selected.length} sections</Badge>
        </div>
        <div className="flex-1 rounded-lg border border-outline-variant bg-surface-container-low p-md">
          {selected.length === 0 ? (
            <p className="py-10 text-center text-body-sm text-on-surface-variant">Select sections to assemble the report.</p>
          ) : (
            <ol className="space-y-2">
              {selected.map((s, i) => (
                <li key={s} className="flex items-center gap-3 rounded-lg bg-surface-container-lowest px-3 py-2 text-body-sm">
                  <span className="font-mono-tag text-label-md text-on-surface-variant">{String(i + 1).padStart(2, '0')}</span>
                  <Icon name="article" size={16} className="text-secondary" />
                  <span className="font-medium text-on-surface">{s}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="mt-md flex items-center justify-between">
          {done ? (
            <span className="flex items-center gap-1 text-body-sm font-semibold text-success"><Icon name="check_circle" size={18} /> Report generated</span>
          ) : (
            <span className="text-body-sm text-on-surface-variant">Output: PDF · auto-distributed on generate</span>
          )}
          <Button variant="accent" onClick={generate} disabled={!selected.length || generating}>
            {generating ? <><Icon name="progress_activity" size={18} className="animate-spin" /> Generating…</> : <><Icon name="picture_as_pdf" size={18} /> Generate Report</>}
          </Button>
        </div>
      </Card>
    </div>
  )
}
