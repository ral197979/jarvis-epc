/**
 * Denver Engineering — My Work (v4.33.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Workflow Redesign Wave 2 (see WORKFLOW_REDESIGN.md §7). The universal personal
 * queue: everything assigned to / owned by the signed-in user, unioned across
 * modules into lanes. Each row deep-links into its canonical record.
 *
 * Data: GET /api/v1/my-work
 */
import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../../modules/store/appSlice'

// ─── Types (mirror api/services/myWork/myWorkService.ts) ──────────────────────

interface MyWorkItem {
  key: string; source: string; sourceId: string; tab: string; parentId: string | null
  projectId: string | null; identifier: string | null; title: string; status: string
  priority: string | null; dueDate: string | null; kind: 'assigned' | 'approval' | 'completed'
  daysOverdue: number; overdue: boolean; upcoming: boolean
}
interface MyWorkResult {
  userId: string; generatedAt: string
  counts: { assigned: number; approvals: number; overdue: number; upcoming: number; completedToday: number; total: number }
  lanes: {
    assigned: MyWorkItem[]; approvals: MyWorkItem[]; overdue: MyWorkItem[]
    upcoming: MyWorkItem[]; completedToday: MyWorkItem[]
  }
}

type LaneKey = keyof MyWorkResult['lanes']

const LANES: { key: LaneKey; label: string; countKey: keyof MyWorkResult['counts'] }[] = [
  { key: 'assigned',       label: 'Assigned to me',     countKey: 'assigned' },
  { key: 'approvals',      label: 'Needs my approval',  countKey: 'approvals' },
  { key: 'overdue',        label: 'Overdue',            countKey: 'overdue' },
  { key: 'upcoming',       label: 'Upcoming this week', countKey: 'upcoming' },
  { key: 'completedToday', label: 'Completed today',    countKey: 'completedToday' },
]

const SOURCE_LABEL: Record<string, string> = {
  rfi: 'RFI', submittal: 'Submittal', punch: 'Punch', capa: 'Corrective Action',
  action: 'Action', inspection: 'Inspection', changeorder: 'Change Order',
}
const SOURCE_ICON: Record<string, string> = {
  rfi: '❓', submittal: '📨', punch: '📌', capa: '🚫',
  action: '⚡', inspection: '🔍', changeorder: '🔄',
}

function dueBadge(it: MyWorkItem): { text: string; color: string } | null {
  if (it.overdue) return { text: `${it.daysOverdue}d overdue`, color: '#ef4444' }
  if (it.upcoming) return { text: 'due this week', color: '#f59e0b' }
  if (it.dueDate)  return { text: `due ${it.dueDate}`, color: 'var(--jarvis-ts)' }
  return null
}

// ─── Item card ────────────────────────────────────────────────────────────────

function WorkCard({ item, onOpen }: { item: MyWorkItem; onOpen: (item: MyWorkItem) => void }) {
  const [hover, setHover] = useState(false)
  const badge = dueBadge(item)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item) } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
        padding: '12px 14px', borderRadius: 10,
        border: '1px solid var(--jarvis-bd)',
        borderLeft: `3px solid ${badge?.color ?? 'var(--jarvis-bd)'}`,
        background: hover ? 'var(--jarvis-sf)' : 'var(--jarvis-bg2)',
        transition: 'background var(--jarvis-t-fast)',
      }}
    >
      <span style={{ fontSize: 18 }} aria-hidden>{SOURCE_ICON[item.source] ?? '•'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {SOURCE_LABEL[item.source] ?? item.source}
          </span>
          {item.identifier && (
            <span style={{ fontSize: 11, color: 'var(--jarvis-ts)', fontFamily: 'var(--jarvis-font-mono)' }}>{item.identifier}</span>
          )}
          <span style={{ fontSize: 11, color: 'var(--jarvis-td)' }}>· {item.status}</span>
        </div>
        <div style={{ fontSize: 14, color: 'var(--jarvis-tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.title || '(untitled)'}
        </div>
      </div>
      {badge && (
        <span style={{ fontSize: 11, fontWeight: 600, color: badge.color, whiteSpace: 'nowrap' }}>{badge.text}</span>
      )}
      <span style={{ color: 'var(--jarvis-td)', fontSize: 16 }} aria-hidden>›</span>
    </div>
  )
}

// ─── View ───────────────────────────────────────────────────────────────────

export default function MyWorkView(_props: { onNavigate?: (tab: string) => void }) {
  const [data, setData]       = useState<MyWorkResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(false)
  const [lane, setLane]       = useState<LaneKey>('assigned')
  const openRecord = useAppStore(s => s.openRecord)

  const handleOpen = useCallback((item: MyWorkItem) => {
    openRecord({
      tab:       item.tab,
      source:    item.source,
      sourceId:  item.sourceId,
      projectId: item.projectId ?? '',
      parentId:  item.parentId ?? null,
    })
  }, [openRecord])

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const res = await fetch('/api/v1/my-work')
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json() as { data: MyWorkResult }
      setData(json.data)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const items = data ? data.lanes[lane] : []

  const tabS = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--jarvis-ac)' : 'var(--jarvis-bd)'}`,
    background: active ? 'var(--jarvis-ac)' : 'transparent',
    color: active ? '#0a0b0f' : 'var(--jarvis-tx)', fontWeight: active ? 700 : 500,
  })

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🗂️ My Work</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>
            Everything assigned to you, across every project and module.
          </p>
        </div>
        <button onClick={load} disabled={loading} style={{
          padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: loading ? 'default' : 'pointer',
          border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)',
          opacity: loading ? 0.6 : 1,
        }}>{loading ? 'Refreshing…' : '↻ Refresh'}</button>
      </div>

      {/* Lane tabs */}
      {data && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {LANES.map(l => (
            <button key={l.key} onClick={() => setLane(l.key)} style={tabS(lane === l.key)}>
              {l.label} ({data.counts[l.countKey]})
            </button>
          ))}
        </div>
      )}

      {/* States */}
      {error && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>
          Couldn't load your work. <button onClick={load} style={{ background: 'none', border: 'none', color: 'var(--jarvis-ac)', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}
      {!error && loading && !data && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>Gathering your work…</div>
      )}
      {!error && data && items.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>
          {data.counts.total === 0
            ? '✅ Nothing assigned to you right now.'
            : 'Nothing in this lane.'}
        </div>
      )}

      {/* List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map(it => <WorkCard key={it.key} item={it} onOpen={handleOpen} />)}
      </div>
    </div>
  )
}
