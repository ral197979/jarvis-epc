/**
 * Denver Engineering — Timesheets View (v10.16.0)
 *
 * Weekly grid: members down, days across.
 * Approve → auto-creates Labor Cost Entry → surfaces in Cost Control ACWP.
 */
import React, { useEffect, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected'

interface Timesheet {
  id:          string
  memberId:    string
  memberName:  string
  memberRate:  number | null
  projectId:   string
  projectName: string
  weekStart:   string
  status:      TimesheetStatus
  totalHours:  number
  totalCost:   number | null
  mon:  number | null; tue: number | null; wed: number | null
  thu:  number | null; fri: number | null; sat: number | null; sun: number | null
  wbsCode:     string | null
  notes:       string | null
  approvedAt:  string | null
  costEntryId: string | null
}

interface WeeklySummary {
  weekStart:   string
  totalHours:  number
  totalCost:   number
  memberCount: number
  byStatus:    Record<TimesheetStatus, number>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAYS: { key: keyof Pick<Timesheet,'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun'>; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

const STATUS_COLOR: Record<TimesheetStatus, string> = {
  draft:     '#6b7280',
  submitted: '#3b82f6',
  approved:  '#22c55e',
  rejected:  '#ef4444',
}

const fmt$ = (n: number | null) =>
  n === null ? '—' : n >= 1000 ? `$${(n/1000).toFixed(1)}K` : `$${n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`

/** Get the Monday of the week containing a date */
function toMonday(d: Date): string {
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  const mon = new Date(d)
  mon.setDate(d.getDate() + diff)
  return mon.toISOString().slice(0,10)
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0,10)
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month:'short', day:'numeric' })
}

// ─── Hour cell ────────────────────────────────────────────────────────────────

function HrCell({ value, onChange, disabled }: { value: number | null; onChange: (v: number | null) => void; disabled: boolean }) {
  const [local, setLocal] = useState(value !== null ? String(value) : '')
  useEffect(() => { setLocal(value !== null ? String(value) : '') }, [value])

  return (
    <input
      type="number" min="0" max="24" step="0.5"
      value={local}
      disabled={disabled}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        const v = local.trim() === '' ? null : parseFloat(local)
        onChange(isNaN(v!) ? null : v)
      }}
      style={{
        width: 52, padding: '4px 4px', textAlign: 'center', borderRadius: 5,
        border: '1px solid var(--jarvis-b)', background: disabled ? 'transparent' : 'var(--jarvis-s)',
        color: value ? 'var(--jarvis-t)' : 'var(--jarvis-ts)', fontSize: 12,
        fontWeight: value ? 600 : 400,
      }}
    />
  )
}

// ─── Timesheet row ────────────────────────────────────────────────────────────

function TimesheetRow({
  ts, dirty, onHourChange, onSave, onSubmit, onApprove, onReject, saving,
}: {
  ts:           Timesheet
  dirty:        boolean
  onHourChange: (id: string, day: string, val: number | null) => void
  onSave:       (ts: Timesheet) => void
  onSubmit:     (id: string) => void
  onApprove:    (id: string) => void
  onReject:     (id: string) => void
  saving:       string | null
}) {
  const editable = ts.status === 'draft'
  const totalHrs = DAYS.reduce((s, d) => s + (ts[d.key] ?? 0), 0)
  const estCost  = ts.memberRate ? totalHrs * ts.memberRate : null

  return (
    <tr style={{ borderBottom: '1px solid var(--jarvis-b)' }}>
      {/* Member */}
      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--jarvis-t)' }}>{ts.memberName}</div>
        {ts.memberRate && <div style={{ fontSize: 10, color: 'var(--jarvis-ts)' }}>${ts.memberRate}/hr</div>}
      </td>
      {/* Day cells */}
      {DAYS.map(d => (
        <td key={d.key} style={{ padding: '6px 4px', textAlign: 'center' }}>
          <HrCell
            value={ts[d.key]}
            disabled={!editable}
            onChange={v => onHourChange(ts.id, d.key, v)}
          />
        </td>
      ))}
      {/* Total */}
      <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, color: totalHrs > 0 ? 'var(--jarvis-t)' : 'var(--jarvis-ts)', whiteSpace: 'nowrap', fontSize: 12 }}>
        {totalHrs > 0 ? `${totalHrs}h` : '—'}
        {estCost !== null && totalHrs > 0 && (
          <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--jarvis-ts)' }}>{fmt$(estCost)}</div>
        )}
      </td>
      {/* Status */}
      <td style={{ padding: '8px 8px', textAlign: 'center' }}>
        <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 600, color: '#fff', background: STATUS_COLOR[ts.status] }}>
          {ts.status}
        </span>
      </td>
      {/* Actions */}
      <td style={{ padding: '8px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
          {editable && dirty && (
            <button onClick={() => onSave(ts)} disabled={saving === ts.id}
              style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--jarvis-a)', background: 'var(--jarvis-a)', color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
              Save
            </button>
          )}
          {editable && !dirty && totalHrs > 0 && (
            <button onClick={() => onSubmit(ts.id)} disabled={saving === ts.id}
              style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid #3b82f6', background: 'transparent', color: '#3b82f6', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
              Submit
            </button>
          )}
          {ts.status === 'submitted' && (
            <>
              <button onClick={() => onApprove(ts.id)} disabled={saving === ts.id}
                style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid #22c55e', background: 'transparent', color: '#22c55e', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                ✓
              </button>
              <button onClick={() => onReject(ts.id)} disabled={saving === ts.id}
                style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', fontSize: 11, cursor: 'pointer' }}>
                ✕
              </button>
            </>
          )}
          {ts.status === 'approved' && ts.costEntryId && (
            <span style={{ fontSize: 10, color: '#22c55e' }}>✓ Posted</span>
          )}
        </div>
      </td>
    </tr>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  policy?:     Record<string, unknown>
  biz?:        Record<string, unknown>
  onNavigate?: (tab: string) => void
}

export default function TimesheetsView({ biz, onNavigate }: Props) {
  const projects = (() => {
    try { return (biz?.projects as { id: string; name: string }[]) ?? [] } catch { return [] }
  })()

  const [projectId, setProjectId] = useState(projects[0]?.id ?? 'demo')
  const [weekStart, setWeekStart] = useState(() => toMonday(new Date()))
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [summary,    setSummary]   = useState<WeeklySummary[]>([])
  const [loading,      setLoading]      = useState(false)
  const [saving,       setSaving]       = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [localHrs,   setLocalHrs]  = useState<Record<string, Partial<Record<string, number | null>>>>({})

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [tsRes, sumRes] = await Promise.all([
        fetch(`/api/v1/projects/${projectId}/timesheets?week=${weekStart}`),
        fetch(`/api/v1/projects/${projectId}/timesheets/summary`),
      ])
      const tsData  = await tsRes.json()  as { timesheets: Timesheet[] }
      const sumData = await sumRes.json() as { weeks: WeeklySummary[] }
      setTimesheets(tsData.timesheets ?? [])
      setSummary(sumData.weeks ?? [])
      setLocalHrs({})
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [projectId, weekStart])

  useEffect(() => { load() }, [load])

  const handleHourChange = (id: string, day: string, val: number | null) => {
    setLocalHrs(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), [day]: val } }))
  }

  const mergedTs = (ts: Timesheet): Timesheet => {
    const overrides = localHrs[ts.id] ?? {}
    return { ...ts, ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v])) } as Timesheet
  }

  const isDirty = (id: string) => Object.keys(localHrs[id] ?? {}).length > 0

  const handleSave = async (ts: Timesheet) => {
    setSaving(ts.id)
    try {
      const hrs = localHrs[ts.id] ?? {}
      await fetch(`/api/v1/projects/${ts.projectId}/timesheets`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId:  ts.memberId,
          weekStart: ts.weekStart,
          ...(hrs.mon !== undefined ? { mon: hrs.mon } : {}),
          ...(hrs.tue !== undefined ? { tue: hrs.tue } : {}),
          ...(hrs.wed !== undefined ? { wed: hrs.wed } : {}),
          ...(hrs.thu !== undefined ? { thu: hrs.thu } : {}),
          ...(hrs.fri !== undefined ? { fri: hrs.fri } : {}),
          ...(hrs.sat !== undefined ? { sat: hrs.sat } : {}),
          ...(hrs.sun !== undefined ? { sun: hrs.sun } : {}),
        }),
      })
      await load()
    } catch { /* ignore */ } finally { setSaving(null) }
  }

  const action = async (id: string, endpoint: string) => {
    setSaving(id)
    try { await fetch(`/api/v1/timesheets/${id}/${endpoint}`, { method: 'POST' }); await load() }
    catch { /* ignore */ } finally { setSaving(null) }
  }

  const weekLabel = `${shortDate(weekStart)} – ${shortDate(addDays(weekStart, 6))}`
  const prevWeek  = () => setWeekStart(addDays(weekStart, -7))
  const nextWeek  = () => setWeekStart(addDays(weekStart, 7))

  const btnS: React.CSSProperties = { padding: '6px 12px', borderRadius: 6, border: '1px solid var(--jarvis-b)', background: 'var(--jarvis-s2)', color: 'var(--jarvis-t)', cursor: 'pointer', fontSize: 12 }

  const weekTotals = timesheets.reduce((acc, ts) => ({
    hours: acc.hours + ts.totalHours,
    cost:  acc.cost  + (ts.totalCost ?? 0),
    submitted: acc.submitted + (ts.status === 'submitted' ? 1 : 0),
  }), { hours: 0, cost: 0, submitted: 0 })

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--jarvis-t)' }}>Timesheets</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--jarvis-ts)' }}>
            Log hours · Approve → Labor Cost Entry → ACWP
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {projects.length > 0 && (
            <select value={projectId} onChange={e => setProjectId(e.target.value)} style={btnS}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button onClick={prevWeek} style={btnS}>‹ Prev</button>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)', padding: '0 4px' }}>{weekLabel}</span>
          <button onClick={nextWeek} style={btnS}>Next ›</button>
        </div>
      </div>

      {/* Week summary strip */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {([
          ['Total Hours',     weekTotals.hours > 0 ? `${weekTotals.hours}h` : '—', 'var(--jarvis-t)', 'all'],
          ['Est. Labor Cost', fmt$(weekTotals.cost > 0 ? weekTotals.cost : null),   '#22c55e',         ''],
          ['Pending Approval', String(weekTotals.submitted),                         weekTotals.submitted > 0 ? '#f59e0b' : 'var(--jarvis-ts)', 'submitted'],
          ['Members',         String(timesheets.length),                            'var(--jarvis-ts)', 'all'],
        ] as [string, string, string, string][]).map(([label, val, color, filter]) => (
          <div key={label} onClick={filter ? () => setFilterStatus(filter) : undefined}
            style={{ flex: '1 1 110px', background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 8, padding: '10px 14px', cursor: filter ? 'pointer' : 'default' }}
            onMouseEnter={filter ? e => (e.currentTarget.style.opacity = '.75') : undefined}
            onMouseLeave={filter ? e => (e.currentTarget.style.opacity = '1') : undefined}
          >
            <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color, marginTop: 2 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>Loading…</div>
        ) : timesheets.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>
            No timesheets for this week.
            <br />
            <span style={{ fontSize: 12 }}>Assign team members to this project in the <button onClick={() => onNavigate?.('team')} style={{ background: 'none', border: 'none', color: 'var(--jarvis-a)', cursor: 'pointer', textDecoration: 'underline', fontSize: 12, padding: 0 }}>Team tab</button>, then they'll appear here.</span>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--jarvis-b)', background: 'var(--jarvis-s)' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--jarvis-ts)', fontWeight: 600 }}>Member</th>
                {DAYS.map((d, i) => (
                  <th key={d.key} style={{ padding: '8px 4px', textAlign: 'center', fontSize: 11, color: 'var(--jarvis-ts)', fontWeight: 600 }}>
                    {d.label}
                    <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--jarvis-ts)' }}>{shortDate(addDays(weekStart, i))}</div>
                  </th>
                ))}
                <th style={{ padding: '8px 8px', textAlign: 'right', fontSize: 11, color: 'var(--jarvis-ts)', fontWeight: 600 }}>Total</th>
                <th style={{ padding: '8px 8px', textAlign: 'center', fontSize: 11, color: 'var(--jarvis-ts)', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '8px 8px', fontSize: 11, color: 'var(--jarvis-ts)', fontWeight: 600 }}></th>
              </tr>
            </thead>
            <tbody>
              {timesheets.filter(ts => filterStatus === 'all' || ts.status === filterStatus).map(ts => (
                <TimesheetRow
                  key={ts.id}
                  ts={mergedTs(ts)}
                  dirty={isDirty(ts.id)}
                  onHourChange={handleHourChange}
                  onSave={handleSave}
                  onSubmit={id => action(id, 'submit')}
                  onApprove={id => action(id, 'approve')}
                  onReject={id  => action(id, 'reject')}
                  saving={saving}
                />
              ))}
            </tbody>
            {/* Column totals */}
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--jarvis-b)', background: 'var(--jarvis-s)' }}>
                <td style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, color: 'var(--jarvis-ts)' }}>Totals</td>
                {DAYS.map(d => {
                  const col = timesheets.reduce((s, ts) => s + (ts[d.key] ?? 0), 0)
                  return (
                    <td key={d.key} style={{ padding: '8px 4px', textAlign: 'center', fontSize: 11, fontWeight: col > 0 ? 700 : 400, color: col > 0 ? 'var(--jarvis-t)' : 'var(--jarvis-ts)' }}>
                      {col > 0 ? `${col}h` : '—'}
                    </td>
                  )
                })}
                <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--jarvis-t)' }}>
                  {weekTotals.hours}h
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* History bar chart (SVG) */}
      {summary.length > 1 && (
        <div style={{ background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)', marginBottom: 10 }}>Weekly Hours History</div>
          <svg viewBox={`0 0 ${summary.length * 52} 80`} style={{ width: '100%', maxHeight: 80 }}>
            {summary.slice().reverse().map((w, i) => {
              const maxH = Math.max(...summary.map(s => s.totalHours), 1)
              const barH = (w.totalHours / maxH) * 56
              const x = i * 52 + 4
              const color = w.byStatus.approved > 0 ? '#22c55e' : w.byStatus.submitted > 0 ? '#3b82f6' : '#6b7280'
              return (
                <g key={w.weekStart}>
                  <rect x={x} y={60 - barH} width={44} height={barH} rx={3} fill={color} opacity={0.8} />
                  <text x={x + 22} y={75} textAnchor="middle" fontSize={8} fill="var(--jarvis-ts)">
                    {w.weekStart.slice(5)}
                  </text>
                  {w.totalHours > 0 && (
                    <text x={x + 22} y={60 - barH - 3} textAnchor="middle" fontSize={8} fill={color} fontWeight={600}>
                      {w.totalHours}h
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
          <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10, color: 'var(--jarvis-ts)' }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#22c55e', marginRight: 4 }} />Approved</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#3b82f6', marginRight: 4 }} />Pending</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#6b7280', marginRight: 4 }} />Draft</span>
          </div>
        </div>
      )}

      {/* Explainer */}
      <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', fontSize: 12, color: 'var(--jarvis-ts)' }}>
        💡 <b style={{ color: 'var(--jarvis-t)' }}>Workflow:</b> Enter hours → Save → Submit → PM approves. Approval auto-creates a <b>Labor Cost Entry</b> (hours × hourly rate) marked as posted, which flows into EVM Actuals and appears as ACWP in the Cost Control dashboard.
      </div>
    </div>
  )
}
