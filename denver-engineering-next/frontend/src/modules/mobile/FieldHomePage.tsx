import { NavLink } from 'react-router-dom'
import { Card, Badge, StatusChip, Icon, Avatar, cn, priorityTone } from '@ds'
import { useFieldAssignments, useSyncQueue } from '@adapters'

const QUICK = [
  { to: '/m/arrival', icon: 'login', label: 'Site Arrival' },
  { to: '/m/scan', icon: 'qr_code_scanner', label: 'Scan Asset' },
  { to: '/m/fpt', icon: 'science', label: 'Run FPT' },
  { to: '/m/sync', icon: 'sync', label: 'Sync' },
]

export function FieldHomePage() {
  const { data: assignments = [] } = useFieldAssignments()
  const { data: sync = [] } = useSyncQueue()
  const pending = sync.filter((s) => s.status !== 'Synced').length

  return (
    <div className="space-y-md">
      {/* Greeting */}
      <div className="flex items-center gap-3">
        <Avatar name="Jordan Martinez" className="h-11 w-11 text-body-md" />
        <div>
          <div className="text-body-lg font-bold text-primary">Hi, Jordan</div>
          <div className="text-body-sm text-on-surface-variant">Gulf Coast LNG · Day shift</div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-2">
        {QUICK.map((q) => (
          <NavLink key={q.to} to={q.to} className="flex flex-col items-center gap-1 rounded-xl border border-outline-variant bg-surface-container-lowest p-3 active:scale-95">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary/10 text-secondary"><Icon name={q.icon} /></div>
            <span className="text-center text-label-md font-semibold text-on-surface">{q.label}</span>
          </NavLink>
        ))}
      </div>

      {/* Sync status */}
      {pending > 0 && (
        <NavLink to="/m/sync" className="flex items-center gap-2 rounded-xl bg-warning/15 p-3 text-warning active:scale-[0.99]">
          <Icon name="cloud_upload" />
          <span className="flex-1 text-body-sm font-semibold">{pending} change(s) waiting to sync</span>
          <Icon name="chevron_right" />
        </NavLink>
      )}

      {/* Today's work orders */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-headline-sm font-bold text-primary">My Work Orders</h2>
          <Badge tone="neutral">{assignments.length}</Badge>
        </div>
        <div className="space-y-2">
          {assignments.map((a) => (
            <Card key={a.id} className="p-3 active:scale-[0.99]">
              <div className="flex items-center justify-between">
                <span className="font-mono-tag text-label-md text-on-surface-variant">{a.id}</span>
                <Badge tone={priorityTone(a.priority)}>{a.priority}</Badge>
              </div>
              <div className="mt-0.5 font-semibold text-on-surface">{a.title}</div>
              <div className="mt-1 flex items-center gap-2 text-body-sm text-on-surface-variant">
                <Icon name="location_on" size={15} /> {a.location}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className={cn('flex items-center gap-1 text-body-sm', 'text-on-surface-variant')}>
                  <Icon name="schedule" size={15} /> {a.due}
                </span>
                <StatusChip status={a.status} dot />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
