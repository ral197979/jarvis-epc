import { useEffect, useState } from 'react'
import { Card, Badge, StatusChip, Icon, cn, EmptyState, type Tone } from '@ds'
import { useIstSequences, type IstSequence, type IstStep } from '@adapters'

const stepMeta: Record<IstStep['status'], { tone: Tone; dot: string; label: string }> = {
  complete: { tone: 'success', dot: 'bg-success', label: 'Complete' },
  active: { tone: 'info', dot: 'bg-info animate-pulse', label: 'Running' },
  pending: { tone: 'neutral', dot: 'bg-status-gray', label: 'Pending' },
  blocked: { tone: 'danger', dot: 'bg-danger', label: 'Blocked' },
}

export function IstOrchestration() {
  const { data = [] } = useIstSequences()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedId && data.length) setSelectedId(data[0].id)
  }, [data, selectedId])

  const selected = data.find((s) => s.id === selectedId)

  return (
    <div className="grid grid-cols-12 gap-lg">
      {/* Sequence list */}
      <div className="col-span-12 space-y-2 lg:col-span-4">
        {data.map((s) => (
          <Card
            key={s.id}
            onClick={() => setSelectedId(s.id)}
            className={cn('cursor-pointer p-md transition-shadow hover:shadow-md', s.id === selectedId && 'border-secondary ring-1 ring-secondary')}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono-tag text-label-md text-on-surface-variant">{s.id}</span>
              <StatusChip status={s.status} dot />
            </div>
            <div className="mt-0.5 font-semibold text-primary">{s.name}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {s.systems.map((sys) => <Badge key={sys} tone="neutral">{sys}</Badge>)}
            </div>
            <div className="mt-2 flex items-center gap-1 font-mono-tag text-label-sm text-on-surface-variant">
              <Icon name="schedule" size={14} /> {s.window}
            </div>
          </Card>
        ))}
      </div>

      {/* Sequence detail */}
      <div className="col-span-12 lg:col-span-8">
        {!selected ? (
          <Card><EmptyState icon="conveyor_belt" title="Select a sequence" description="Choose an IST sequence to view orchestration." /></Card>
        ) : (
          <SequenceDetail seq={selected} />
        )}
      </div>
    </div>
  )
}

function SequenceDetail({ seq }: { seq: IstSequence }) {
  const done = seq.steps.filter((s) => s.status === 'complete').length
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-outline-variant p-md">
        <div>
          <h3 className="text-headline-sm font-bold text-primary">{seq.name}</h3>
          <div className="mt-0.5 font-mono-tag text-label-md text-on-surface-variant">{seq.window}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip status={seq.status} dot />
          <div className="flex gap-1">
            {['play_arrow', 'pause', 'skip_next'].map((ic) => (
              <button key={ic} className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-high">
                <Icon name={ic} size={18} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Step timeline */}
      <div className="p-md">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono-tag text-label-md uppercase text-on-surface-variant">Execution Sequence</span>
          <span className="text-body-sm text-on-surface-variant">{done}/{seq.steps.length} complete</span>
        </div>
        <ol className="relative space-y-1 border-l-2 border-outline-variant pl-5">
          {seq.steps.map((step) => {
            const m = stepMeta[step.status]
            return (
              <li key={step.id} className="relative pb-3">
                <span className={cn('absolute -left-[27px] top-1 h-3.5 w-3.5 rounded-full ring-4 ring-surface-container-lowest', m.dot)} />
                <div className="flex items-center justify-between rounded-lg border border-outline-variant bg-background px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="font-mono-tag text-label-md text-on-surface-variant">T{step.seq}</span>
                    <div>
                      <div className="text-body-sm font-semibold text-on-surface">{step.action}</div>
                      <div className="font-mono-tag text-label-sm text-on-surface-variant">{step.system}</div>
                    </div>
                  </div>
                  <Badge tone={m.tone}>{m.label}</Badge>
                </div>
              </li>
            )
          })}
        </ol>
      </div>

      {/* Event log */}
      <div className="border-t border-outline-variant bg-primary p-md">
        <div className="mb-2 flex items-center gap-2 font-mono-tag text-label-md uppercase text-inverse-on-surface/80">
          <Icon name="terminal" size={16} /> System Event Log
        </div>
        <div className="custom-scrollbar max-h-40 space-y-1 overflow-y-auto font-mono-tag text-label-md">
          {seq.steps.map((step) => {
            const level = step.status === 'blocked' ? 'CRIT' : step.status === 'active' ? 'CMD' : step.status === 'complete' ? 'INFO' : 'WAIT'
            const color = level === 'CRIT' ? 'text-error-container' : level === 'CMD' ? 'text-secondary-fixed' : level === 'INFO' ? 'text-success' : 'text-inverse-on-surface/50'
            return (
              <div key={step.id} className="flex gap-2 text-inverse-on-surface/80">
                <span className="text-inverse-on-surface/40">T{step.seq}</span>
                <span className={cn('font-bold', color)}>[{level}]</span>
                <span>{step.system}: {step.action}</span>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
