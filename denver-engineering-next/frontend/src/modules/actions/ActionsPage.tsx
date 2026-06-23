import { Card, Badge, StatusChip, Icon, Button, Avatar } from '@ds'
import { useActions, type ActionItem } from '@adapters'
import { PageHeader } from '../../components/shared'

// Tolerant matchers so both mock ("In Progress") and live ("in_progress") statuses group correctly.
const COLUMNS: { key: string; label: string; match: (a: ActionItem) => boolean }[] = [
  { key: 'open', label: 'Open', match: (a) => /open|todo|new|overdue/i.test(a.status) },
  { key: 'in-progress', label: 'In Progress', match: (a) => /progress|active|doing/i.test(a.status) },
  { key: 'done', label: 'Done', match: (a) => /done|closed|complete/i.test(a.status) },
]

export function ActionsPage() {
  const { data } = useActions()

  return (
    <div>
      <PageHeader
        title="Actions"
        subtitle="AI-generated & manual actions across the program"
        actions={<Button variant="accent"><Icon name="add" size={18} /> New Action</Button>}
      />

      <div className="grid grid-cols-1 gap-md md:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = (data ?? []).filter(col.match)
          return (
            <div key={col.key} className="rounded-xl bg-surface-container-low p-3">
              <div className="mb-3 flex items-center justify-between px-1">
                <h3 className="text-body-md font-bold text-primary">{col.label}</h3>
                <Badge tone="neutral">{items.length}</Badge>
              </div>
              <div className="space-y-2">
                {items.map((a) => (
                  <Card key={a.id} className="p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono-tag text-label-sm text-on-surface-variant">{a.id}</span>
                      <StatusChip status={a.priority} />
                    </div>
                    <p className="text-body-sm font-semibold text-on-surface">{a.title}</p>
                    <div className="mt-2 flex items-center justify-between text-body-sm text-on-surface-variant">
                      <span className="flex items-center gap-1.5"><Avatar name={a.assignee} className="h-5 w-5 text-[9px]" /> {a.assignee}</span>
                      <span className="flex items-center gap-1"><Icon name="event" size={14} /> {a.due}</span>
                    </div>
                    {a.source.startsWith('AI') && (
                      <div className="mt-2 flex items-center gap-1 rounded bg-secondary/10 px-2 py-1 font-mono-tag text-label-sm text-secondary">
                        <Icon name="smart_toy" size={14} /> {a.source}
                      </div>
                    )}
                  </Card>
                ))}
                {items.length === 0 && <p className="px-1 py-6 text-center text-body-sm text-on-surface-variant">Nothing here.</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
