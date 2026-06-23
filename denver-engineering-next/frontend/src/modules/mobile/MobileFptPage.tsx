import { useEffect, useState } from 'react'
import { Card, Button, Badge, Progress, Icon, cn, EmptyState } from '@ds'
import { useFptScripts, type FptStep } from '@adapters'

type ResultMap = Record<string, FptStep['result']>

export function MobileFptPage() {
  const { data = [] } = useFptScripts()
  const script = data[0]
  const [results, setResults] = useState<ResultMap>({})

  useEffect(() => {
    if (script) setResults(Object.fromEntries(script.steps.map((s) => [s.id, s.result])))
  }, [script])

  if (!script) return <EmptyState icon="science" title="No test assigned" />

  const resultFor = (s: FptStep) => results[s.id] ?? s.result
  const done = script.steps.filter((s) => resultFor(s) !== 'pending').length
  const pct = Math.round((done / script.steps.length) * 100)
  const record = (id: string, r: FptStep['result']) => setResults((p) => ({ ...p, [id]: r }))

  return (
    <div className="space-y-md">
      <Card className="p-md">
        <div className="flex items-center justify-between">
          <span className="font-mono-tag text-label-md text-on-surface-variant">{script.id}</span>
          <Badge tone="info" dot>Witness: {script.witnessedBy}</Badge>
        </div>
        <div className="mt-0.5 font-bold text-primary">{script.name}</div>
        <div className="mb-1 mt-2 flex items-center justify-between text-body-sm">
          <span className="text-on-surface-variant">{done}/{script.steps.length} steps</span>
          <span className="font-mono-tag font-semibold text-primary">{pct}%</span>
        </div>
        <Progress value={pct} threshold height={10} />
      </Card>

      <div className="space-y-2">
        {script.steps.map((s) => {
          const res = resultFor(s)
          return (
            <Card key={s.id} className={cn('p-3', res === 'pending' && 'border-secondary')}>
              <div className="flex gap-2">
                <span className="font-mono-tag text-label-md text-on-surface-variant">{s.no}</span>
                <div className="flex-1">
                  <div className="text-body-md font-semibold text-on-surface">{s.description}</div>
                  <div className="text-body-sm text-on-surface-variant">Expected: {s.expected}</div>
                </div>
              </div>
              {res === 'pending' ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button onClick={() => record(s.id, 'pass')} className="rounded-lg bg-success-container py-2.5 font-bold text-success active:scale-95">PASS</button>
                  <button onClick={() => record(s.id, 'fail')} className="rounded-lg bg-error-container py-2.5 font-bold text-on-error-container active:scale-95">FAIL</button>
                </div>
              ) : (
                <div className="mt-3 flex items-center justify-between">
                  <Badge tone={res === 'pass' ? 'success' : 'danger'}>{res === 'pass' ? 'Pass' : 'Fail'}</Badge>
                  <button onClick={() => record(s.id, 'pending')} className="flex items-center gap-1 text-body-sm font-semibold text-secondary"><Icon name="undo" size={16} /> Redo</button>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      <Button variant="accent" size="lg" className="w-full" disabled={pct < 100}>
        <Icon name="send" size={20} /> Submit & Queue
      </Button>
    </div>
  )
}
