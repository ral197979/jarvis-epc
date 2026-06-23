import { useEffect, useState } from 'react'
import { Card, Badge, StatusChip, Button, Icon, Progress, cn, EmptyState } from '@ds'
import { useTurnoverPackages, type TurnoverPackage } from '@adapters'

type CollectedMap = Record<string, Record<string, boolean>> // pkgId → label → collected

export function TurnoverBuilder() {
  const { data = [] } = useTurnoverPackages()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<CollectedMap>({})

  useEffect(() => {
    if (!selectedId && data.length) setSelectedId(data[0].id)
  }, [data, selectedId])

  const selected = data.find((p) => p.id === selectedId)
  const isCollected = (pkg: TurnoverPackage, label: string) =>
    overrides[pkg.id]?.[label] ?? pkg.items.find((i) => i.label === label)?.collected ?? false
  const completion = (pkg: TurnoverPackage) =>
    Math.round((pkg.items.filter((i) => isCollected(pkg, i.label)).length / pkg.items.length) * 100)

  const toggle = (pkgId: string, label: string, value: boolean) =>
    setOverrides((prev) => ({ ...prev, [pkgId]: { ...prev[pkgId], [label]: value } }))

  return (
    <div className="grid grid-cols-12 gap-lg">
      {/* Package list */}
      <div className="col-span-12 space-y-2 lg:col-span-4">
        {data.map((p) => {
          const pct = completion(p)
          return (
            <Card
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={cn('cursor-pointer p-md transition-shadow hover:shadow-md', p.id === selectedId && 'border-secondary ring-1 ring-secondary')}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono-tag text-label-md text-on-surface-variant">{p.id}</span>
                <StatusChip status={p.status} />
              </div>
              <div className="mt-0.5 font-semibold text-primary">{p.system}</div>
              <div className="mb-2 flex items-center gap-1 text-body-sm text-on-surface-variant"><Icon name="person" size={14} /> {p.recipient}</div>
              <Progress value={pct} threshold />
              <div className="mt-1 text-right font-mono-tag text-label-sm text-on-surface-variant">{pct}% complete</div>
            </Card>
          )
        })}
      </div>

      {/* Package detail */}
      <div className="col-span-12 lg:col-span-8">
        {!selected ? (
          <Card><EmptyState icon="inventory_2" title="Select a turnover package" description="Choose a package to assemble its documents." /></Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-outline-variant p-md">
              <div>
                <h3 className="text-headline-sm font-bold text-primary">{selected.system} Turnover Package</h3>
                <div className="mt-0.5 flex items-center gap-2 text-body-sm text-on-surface-variant">
                  <span className="font-mono-tag">{selected.id}</span> · {selected.recipient} <StatusChip status={selected.status} />
                </div>
              </div>
              <Button variant="accent" disabled={completion(selected) < 100}>
                <Icon name="assignment_turned_in" size={18} /> Ready for Sign-off
              </Button>
            </div>

            <div className="border-b border-outline-variant p-md">
              <div className="mb-1 flex items-center justify-between text-body-sm">
                <span className="font-mono-tag text-label-md uppercase text-on-surface-variant">Document Completeness</span>
                <span className="font-semibold text-primary">{completion(selected)}%</span>
              </div>
              <Progress value={completion(selected)} threshold height={10} />
            </div>

            <ul className="divide-y divide-outline-variant">
              {selected.items.map((item) => {
                const collected = isCollected(selected, item.label)
                return (
                  <li key={item.label} className="flex items-center justify-between px-md py-3">
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={collected}
                        onChange={(e) => toggle(selected.id, item.label, e.target.checked)}
                        className="h-4 w-4 accent-secondary"
                      />
                      <Icon name="description" size={18} className="text-on-surface-variant" />
                      <span className={cn('text-body-md', collected ? 'text-on-surface' : 'text-on-surface-variant')}>{item.label}</span>
                    </label>
                    {collected ? <Badge tone="success">Collected</Badge> : <Badge tone="danger">Missing</Badge>}
                  </li>
                )
              })}
            </ul>
          </Card>
        )}
      </div>
    </div>
  )
}
