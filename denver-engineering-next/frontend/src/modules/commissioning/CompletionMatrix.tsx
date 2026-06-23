import { Card, Icon, cn, COMMISSIONING_STAGES, cellStatusMeta, type CellStatus } from '@ds'
import { useCompletionMatrix } from '@adapters'

/** Sticky system-hierarchy × lifecycle-stage matrix — the commissioning centerpiece. */
export function CompletionMatrix() {
  const { data: systems } = useCompletionMatrix()

  const categories = Array.from(new Set(systems?.map((s) => s.category) ?? []))

  const avg = systems && systems.length
    ? Math.round(
        (systems.reduce((acc, s) => acc + Object.values(s.cells).filter((c) => c === 'complete').length, 0) /
          (systems.length * COMMISSIONING_STAGES.length)) *
          100,
      )
    : 0

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-outline-variant p-md">
        <h3 className="text-headline-sm font-bold text-primary">System Completion Matrix</h3>
        <div className="flex items-center gap-4 text-body-sm text-on-surface-variant">
          <span><span className="font-bold text-primary">{systems?.length ?? 0}</span> systems</span>
          <span>Avg completion <span className="font-bold text-primary">{avg}%</span></span>
        </div>
      </div>

      <div className="custom-scrollbar overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-background">
              <th className="sticky left-0 z-10 w-[280px] bg-background px-md py-sm text-left font-mono-tag text-label-md uppercase text-on-surface-variant">
                System Hierarchy
              </th>
              {COMMISSIONING_STAGES.map((s) => (
                <th key={s} className="min-w-[92px] px-2 py-sm text-center font-mono-tag text-label-sm uppercase text-on-surface-variant">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => (
              <CategoryGroup key={cat} category={cat} systems={(systems ?? []).filter((s) => s.category === cat)} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 border-t border-outline-variant p-md">
        <span className="font-mono-tag text-label-md uppercase text-on-surface-variant">Legend</span>
        {(Object.keys(cellStatusMeta) as CellStatus[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5 text-body-sm">
            <span className={cn('h-3 w-3 rounded-sm', cellStatusMeta[k].dot)} />
            {cellStatusMeta[k].label}
          </span>
        ))}
      </div>
    </Card>
  )
}

function CategoryGroup({
  category,
  systems,
}: {
  category: string
  systems: { id: string; tag: string; name: string; cells: Record<string, CellStatus> }[]
}) {
  return (
    <>
      <tr className="bg-surface-container-low">
        <td colSpan={COMMISSIONING_STAGES.length + 1} className="sticky left-0 px-md py-2">
          <div className="flex items-center gap-2 font-mono-tag text-label-md uppercase text-primary">
            <Icon name="expand_more" size={18} /> {category}
            <span className="text-on-surface-variant">({systems.length})</span>
          </div>
        </td>
      </tr>
      {systems.map((sys) => (
        <tr key={sys.id} className="border-b border-outline-variant hover:bg-surface-container-low/50">
          <td className="sticky left-0 z-10 bg-surface-container-lowest px-md py-2.5">
            <div className="font-semibold text-on-surface">{sys.name}</div>
            <div className="font-mono-tag text-label-sm text-on-surface-variant">{sys.tag}</div>
          </td>
          {COMMISSIONING_STAGES.map((stage) => {
            const status = (sys.cells[stage] ?? 'not-started') as CellStatus
            const meta = cellStatusMeta[status]
            return (
              <td key={stage} className="px-2 py-2.5 text-center">
                <span className={cn('inline-flex h-7 w-full items-center justify-center rounded text-[10px] font-bold uppercase', meta.chip)}>
                  {status === 'complete' && <Icon name="check" size={14} />}
                  {status === 'in-progress' && <Icon name="pending" size={14} />}
                  {status === 'critical' && <Icon name="priority_high" size={14} />}
                  {status === 'delayed' && <Icon name="schedule" size={14} />}
                </span>
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}
