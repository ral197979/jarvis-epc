import { Card, CardHeader, CardTitle, KpiCard, Badge, Progress, Button, Icon, cn } from '@ds'
import { useCloseoutLedger } from '@adapters'
import { PageHeader, AiBanner } from '../../components/shared'

const statusMeta: Record<string, { tone: 'success' | 'info' | 'danger'; icon: string }> = {
  Complete: { tone: 'success', icon: 'check_circle' },
  'In Progress': { tone: 'info', icon: 'pending' },
  Outstanding: { tone: 'danger', icon: 'radio_button_unchecked' },
}

export function CloseoutPage() {
  const { data: items = [] } = useCloseoutLedger()
  const complete = items.filter((i) => i.status === 'Complete').length
  const outstanding = items.filter((i) => i.status === 'Outstanding').length
  const readiness = items.length ? Math.round((complete / items.length) * 100) : 0
  const categories = Array.from(new Set(items.map((i) => i.category)))
  const certItem = items.find((i) => i.description.includes('Final Handover Certificate'))

  return (
    <div className="space-y-lg">
      <PageHeader
        title="Project Closeout"
        subtitle="Closeout ledger · handover · final certificate"
        actions={<Button variant="accent" disabled={outstanding > 0}><Icon name="assignment_turned_in" size={18} /> Authorize Closeout</Button>}
      />

      <AiBanner
        text={`Closeout readiness is ${readiness}%. ${outstanding} items outstanding gate the Final Handover Certificate — the critical path is O&M manuals and final account/retention release.`}
        action="Generate Closeout Report"
      />

      <div className="grid grid-cols-2 gap-md xl:grid-cols-4">
        <Card className="p-lg">
          <div className="mb-2 font-mono-tag text-label-md uppercase text-on-surface-variant">Closeout Readiness</div>
          <div className="text-headline-md font-bold text-primary">{readiness}%</div>
          <Progress className="mt-2" value={readiness} threshold />
        </Card>
        <KpiCard label="Complete" value={String(complete)} icon="task_alt" trend={{ direction: 'up', label: `of ${items.length} items`, tone: 'success' }} />
        <KpiCard label="In Progress" value={String(items.filter((i) => i.status === 'In Progress').length)} icon="pending" />
        <KpiCard label="Outstanding" value={String(outstanding)} icon="warning" critical={outstanding > 0} />
      </div>

      <div className="grid grid-cols-12 gap-lg">
        {/* Ledger by category */}
        <div className="col-span-12 space-y-lg lg:col-span-8">
          {categories.map((cat) => {
            const catItems = items.filter((i) => i.category === cat)
            const done = catItems.filter((i) => i.status === 'Complete').length
            return (
              <Card key={cat} className="overflow-hidden">
                <CardHeader>
                  <CardTitle>{cat}</CardTitle>
                  <span className="font-mono-tag text-label-md text-on-surface-variant">{done}/{catItems.length} complete</span>
                </CardHeader>
                <ul className="divide-y divide-outline-variant">
                  {catItems.map((item) => {
                    const m = statusMeta[item.status] ?? statusMeta.Outstanding
                    return (
                      <li key={item.id} className="flex items-center justify-between px-md py-3">
                        <div className="flex items-center gap-3">
                          <Icon name={m.icon} className={cn(m.tone === 'success' ? 'text-success' : m.tone === 'info' ? 'text-info' : 'text-on-surface-variant')} />
                          <div>
                            <div className="text-body-md font-medium text-on-surface">{item.description}</div>
                            <div className="font-mono-tag text-label-sm text-on-surface-variant">{item.id} · {item.owner} · due {item.due}</div>
                          </div>
                        </div>
                        <Badge tone={m.tone}>{item.status}</Badge>
                      </li>
                    )
                  })}
                </ul>
              </Card>
            )
          })}
        </div>

        {/* Final handover certificate */}
        <div className="col-span-12 lg:col-span-4">
          <Card className="p-lg">
            <div className="mb-md flex items-center gap-2">
              <Icon name="workspace_premium" filled className="text-secondary" />
              <h3 className="text-headline-sm font-bold text-primary">Final Handover Certificate</h3>
            </div>
            <div className={cn('rounded-lg border-2 border-dashed p-lg text-center', certItem?.status === 'Complete' ? 'border-success' : 'border-outline-variant')}>
              <Icon name={certItem?.status === 'Complete' ? 'verified' : 'lock'} size={40} className={cn('mx-auto', certItem?.status === 'Complete' ? 'text-success' : 'text-on-surface-variant')} />
              <div className="mt-2 font-semibold text-primary">{certItem?.status === 'Complete' ? 'Signed & Issued' : 'Locked'}</div>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                {certItem?.status === 'Complete'
                  ? 'Project formally accepted by the owner.'
                  : `Releases when all ${outstanding} outstanding items are cleared.`}
              </p>
            </div>
            <CertRow label="Owner sign-off" ready={false} />
            <CertRow label="Warranty notice" ready={false} />
            <CertRow label="Retention release" ready={false} />
            <CertRow label="Spare parts logged" ready={true} />
          </Card>
        </div>
      </div>
    </div>
  )
}

function CertRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="mt-2 flex items-center justify-between text-body-sm">
      <span className="text-on-surface">{label}</span>
      <Badge tone={ready ? 'success' : 'neutral'} dot>{ready ? 'Ready' : 'Pending'}</Badge>
    </div>
  )
}
