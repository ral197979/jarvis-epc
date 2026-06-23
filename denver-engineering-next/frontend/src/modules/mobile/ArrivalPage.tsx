import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Button, Icon, Badge, cn } from '@ds'

const CHECKS = [
  { id: 'ppe', label: 'PPE inspected (hard hat, boots, hi-vis, glasses)', icon: 'engineering' },
  { id: 'brief', label: 'Daily safety briefing attended', icon: 'campaign' },
  { id: 'ptw', label: 'Permit-to-work reviewed & valid', icon: 'verified_user' },
  { id: 'hazard', label: 'Site hazard assessment acknowledged', icon: 'warning' },
  { id: 'geo', label: 'Geofence check-in confirmed', icon: 'location_on' },
]

export function ArrivalPage() {
  const navigate = useNavigate()
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [checkedIn, setCheckedIn] = useState(false)
  const complete = CHECKS.every((c) => done[c.id])

  if (checkedIn) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success/15 text-success"><Icon name="check_circle" filled size={48} /></div>
        <h2 className="text-headline-md font-bold text-primary">Checked In</h2>
        <p className="max-w-xs text-body-sm text-on-surface-variant">Induction complete for Gulf Coast LNG · Area 200. Your work orders are now active.</p>
        <Badge tone="success" dot>On site · {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Badge>
        <Button variant="accent" className="mt-2" onClick={() => navigate('/m')}><Icon name="home" size={18} /> Go to Work Orders</Button>
      </div>
    )
  }

  return (
    <div className="space-y-md">
      <Card className="p-md">
        <div className="font-mono-tag text-label-md uppercase text-on-surface-variant">Site</div>
        <div className="text-headline-sm font-bold text-primary">Gulf Coast LNG · Area 200</div>
        <div className="mt-1 flex items-center gap-2 text-body-sm text-on-surface-variant"><Icon name="badge" size={16} /> Induction required before entry</div>
      </Card>

      <div className="space-y-2">
        {CHECKS.map((c) => (
          <button
            key={c.id}
            onClick={() => setDone((p) => ({ ...p, [c.id]: !p[c.id] }))}
            className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left active:scale-[0.99]',
              done[c.id] ? 'border-success bg-success/10' : 'border-outline-variant bg-surface-container-lowest')}
          >
            <Icon name={c.icon} className={cn(done[c.id] ? 'text-success' : 'text-on-surface-variant')} />
            <span className={cn('flex-1 text-body-sm font-medium', done[c.id] ? 'text-on-surface' : 'text-on-surface-variant')}>{c.label}</span>
            <Icon name={done[c.id] ? 'check_circle' : 'radio_button_unchecked'} className={cn(done[c.id] ? 'text-success' : 'text-outline')} />
          </button>
        ))}
      </div>

      <Button variant="accent" size="lg" className="w-full" disabled={!complete} onClick={() => setCheckedIn(true)}>
        <Icon name="login" size={20} /> {complete ? 'Confirm Check-In' : `Complete all ${CHECKS.length} checks`}
      </Button>
    </div>
  )
}
