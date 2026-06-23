import { useState } from 'react'
import { Card, Button, Badge, Icon, cn } from '@ds'
import { useSyncQueue, type SyncItem } from '@adapters'

const meta: Record<string, { tone: 'warning' | 'danger' | 'success'; icon: string }> = {
  Pending: { tone: 'warning', icon: 'cloud_upload' },
  Conflict: { tone: 'danger', icon: 'sync_problem' },
  Synced: { tone: 'success', icon: 'cloud_done' },
}

export function SyncPage() {
  const { data = [] } = useSyncQueue()
  const [over, setOver] = useState<Record<string, string>>({})
  const [syncing, setSyncing] = useState(false)

  const statusOf = (i: SyncItem) => over[i.id] ?? i.status
  const conflicts = data.filter((i) => statusOf(i) === 'Conflict').length
  const pending = data.filter((i) => statusOf(i) === 'Pending').length

  const resolve = (id: string) => setOver((p) => ({ ...p, [id]: 'Synced' }))
  const syncAll = () => {
    setSyncing(true)
    setTimeout(() => {
      setOver((p) => {
        const next = { ...p }
        data.forEach((i) => { if (statusOf(i) === 'Pending') next[i.id] = 'Synced' })
        return next
      })
      setSyncing(false)
    }, 1100)
  }

  return (
    <div className="space-y-md">
      <Card className="p-md">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-headline-sm font-bold text-primary">Offline Queue</div>
            <div className="text-body-sm text-on-surface-variant">{pending} pending · {conflicts} conflict(s)</div>
          </div>
          <Icon name={conflicts ? 'sync_problem' : 'sync'} size={32} className={cn(conflicts ? 'text-danger' : 'text-secondary')} />
        </div>
        <Button variant="accent" size="lg" className="mt-3 w-full" disabled={syncing || pending === 0} onClick={syncAll}>
          {syncing ? <><Icon name="progress_activity" size={20} className="animate-spin" /> Syncing…</> : <><Icon name="cloud_sync" size={20} /> Sync {pending} Change(s)</>}
        </Button>
        {conflicts > 0 && <p className="mt-2 text-center text-body-sm text-danger">Resolve conflicts below before they can sync.</p>}
      </Card>

      <div className="space-y-2">
        {data.map((i) => {
          const st = statusOf(i)
          const m = meta[st] ?? meta.Pending
          return (
            <Card key={i.id} className={cn('p-3', st === 'Conflict' && 'border-danger')}>
              <div className="flex items-center gap-3">
                <Icon name={m.icon} className={cn(m.tone === 'success' ? 'text-success' : m.tone === 'danger' ? 'text-danger' : 'text-warning')} />
                <div className="flex-1">
                  <div className="text-body-md font-semibold text-on-surface">{i.action}</div>
                  <div className="font-mono-tag text-label-sm text-on-surface-variant">{i.entity} · {i.at}</div>
                </div>
                <Badge tone={m.tone} dot>{st}</Badge>
              </div>
              {st === 'Conflict' && (
                <div className="mt-3 rounded-lg bg-error-container/40 p-2">
                  <div className="mb-2 text-body-sm text-on-error-container">Server changed this record while you were offline.</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" size="sm" onClick={() => resolve(i.id)}>Keep Server</Button>
                    <Button variant="accent" size="sm" onClick={() => resolve(i.id)}>Keep Mine</Button>
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
