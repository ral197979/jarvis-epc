import { useEffect, useState } from 'react'
import { Card, Badge, StatusChip, Button, Icon, Progress, cn, EmptyState } from '@ds'
import { useFptScripts, type FptScript, type FptStep } from '@adapters'

type ResultMap = Record<string, FptStep['result']>

export function FptExecution() {
  const { data = [] } = useFptScripts()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ResultMap>>({})

  useEffect(() => {
    if (!selectedId && data.length) setSelectedId(data[0].id)
  }, [data, selectedId])

  const selected = data.find((s) => s.id === selectedId)

  const resultFor = (script: FptScript, step: FptStep): FptStep['result'] =>
    results[script.id]?.[step.id] ?? step.result

  const record = (scriptId: string, stepId: string, result: FptStep['result']) =>
    setResults((prev) => ({ ...prev, [scriptId]: { ...prev[scriptId], [stepId]: result } }))

  const progress = (script: FptScript) => {
    const done = script.steps.filter((s) => resultFor(script, s) !== 'pending').length
    return Math.round((done / script.steps.length) * 100)
  }

  return (
    <div className="grid grid-cols-12 gap-lg">
      {/* Script list */}
      <div className="col-span-12 space-y-2 lg:col-span-4">
        {data.map((s) => {
          const pct = progress(s)
          const failed = s.steps.some((st) => resultFor(s, st) === 'fail')
          return (
            <Card
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={cn('cursor-pointer p-md transition-shadow hover:shadow-md', s.id === selectedId && 'border-secondary ring-1 ring-secondary')}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono-tag text-label-md text-on-surface-variant">{s.id}</span>
                <StatusChip status={failed ? 'Failed' : pct === 100 ? 'Passed' : pct > 0 ? 'In Progress' : 'Not Started'} />
              </div>
              <div className="mt-0.5 font-semibold text-primary">{s.name}</div>
              <div className="mb-2 text-body-sm text-on-surface-variant">{s.system}</div>
              <Progress value={pct} threshold />
            </Card>
          )
        })}
      </div>

      {/* Execution detail */}
      <div className="col-span-12 lg:col-span-8">
        {!selected ? (
          <Card><EmptyState icon="science" title="Select a test script" description="Choose an FPT on the left to begin execution." /></Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-outline-variant p-md">
              <div>
                <h3 className="text-headline-sm font-bold text-primary">{selected.name}</h3>
                <div className="mt-0.5 flex items-center gap-2 text-body-sm text-on-surface-variant">
                  <span className="font-mono-tag">{selected.id}</span> · {selected.system}
                  <span className="text-outline">·</span> Witness: {selected.witnessedBy}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono-tag text-label-md text-on-surface-variant">PROGRESS</div>
                <div className="text-headline-sm font-bold text-primary">{progress(selected)}%</div>
              </div>
            </div>

            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="border-b border-outline-variant bg-background font-mono-tag text-label-md uppercase text-on-surface-variant">
                  <th className="px-md py-sm">#</th>
                  <th className="px-md py-sm">Instruction</th>
                  <th className="px-md py-sm">Expected Result</th>
                  <th className="px-md py-sm text-right">Result</th>
                </tr>
              </thead>
              <tbody>
                {selected.steps.map((step) => {
                  const res = resultFor(selected, step)
                  return (
                    <tr key={step.id} className={cn('border-b border-outline-variant', res === 'pending' && 'bg-secondary-fixed/10')}>
                      <td className="px-md py-3 font-mono-tag text-on-surface-variant">{step.no}</td>
                      <td className="px-md py-3 font-medium text-on-surface">{step.description}</td>
                      <td className="px-md py-3 text-on-surface-variant">{step.expected}</td>
                      <td className="px-md py-3">
                        {res === 'pending' ? (
                          <div className="flex justify-end gap-1">
                            <button onClick={() => record(selected.id, step.id, 'pass')} className="rounded bg-success-container px-2 py-1 font-semibold text-success hover:brightness-95">PASS</button>
                            <button onClick={() => record(selected.id, step.id, 'fail')} className="rounded bg-error-container px-2 py-1 font-semibold text-on-error-container hover:brightness-95">FAIL</button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <Badge tone={res === 'pass' ? 'success' : 'danger'}>{res === 'pass' ? 'Pass' : 'Fail'}</Badge>
                            <button onClick={() => record(selected.id, step.id, 'pending')} title="Reset" className="text-on-surface-variant hover:text-primary"><Icon name="undo" size={16} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div className="flex items-center justify-between border-t border-outline-variant p-md">
              <span className="text-body-sm text-on-surface-variant">
                {selected.steps.filter((s) => resultFor(selected, s) !== 'pending').length} / {selected.steps.length} steps recorded
              </span>
              <Button variant="accent" disabled={progress(selected) < 100}>
                <Icon name="send" size={18} /> Submit FPT Results
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
