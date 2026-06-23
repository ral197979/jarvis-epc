/**
 * Denver Engineering — Coordination Copilot (v4.42.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * "Where is the project blocked or out of sync?" — surfaces missing approvals,
 * dependency blockers, out-of-sequence schedule clashes, open BIM clashes, and
 * pending change orders across active projects, ranked and explained.
 *
 * Data: GET /api/v1/copilot/coordination (portfolio roll-up).
 */
import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../../modules/store/appSlice'

type Severity = 'critical' | 'high' | 'medium' | 'low'
type Category = 'missing_approval' | 'blocker' | 'schedule_clash' | 'bim_clash' | 'commercial_gate'
type Source = 'rfi' | 'submittal' | 'action' | 'schedule' | 'bim' | 'change_order'

interface CoordinationIssue {
  category: Category
  source: Source
  sourceId: string | null
  reference: string
  title: string
  why: string
  recommendedAction: string
  owner: string | null
  severity: Severity
  score: number
  impacts: string[]
  dueDate: string | null
  daysOverdue: number | null
  projectId: string
  projectName: string | null
}

interface PortfolioBriefing {
  generatedAt: string
  headline: string
  summary: { projects: number; total: number; critical: number; high: number }
  issues: CoordinationIssue[]
}

const SEV_COLOR: Record<Severity, string> = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#6b7280' }
const CAT_LABEL: Record<Category, string> = {
  missing_approval: 'Missing approval', blocker: 'Blocker', schedule_clash: 'Schedule clash',
  bim_clash: 'BIM clash', commercial_gate: 'Commercial gate',
}
const CAT_ICON: Record<Category, string> = {
  missing_approval: '✋', blocker: '⛔', schedule_clash: '🔀', bim_clash: '🧩', commercial_gate: '💵',
}
// Where each source's record lives (reuses the deep-link channel from Focus).
const SOURCE_TAB: Record<Source, string> = {
  rfi: 'rfis', submittal: 'submittals', action: 'actions', schedule: 'evm', bim: 'bim', change_order: 'changeorders',
}

function IssueCard({ issue, onOpen }: { issue: CoordinationIssue; onOpen: (i: CoordinationIssue) => void }) {
  const color = SEV_COLOR[issue.severity]
  const [hover, setHover] = useState(false)
  const overdue = issue.daysOverdue != null && issue.daysOverdue > 0 ? `${issue.daysOverdue}d overdue` : null
  return (
    <div
      role="button" tabIndex={0}
      aria-label={`Open ${CAT_LABEL[issue.category]} ${issue.reference}`}
      onClick={() => onOpen(issue)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(issue) } }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
        background: hover ? 'var(--jarvis-bg)' : 'var(--jarvis-bg2)',
        border: `1px solid ${hover ? color : 'var(--jarvis-bd)'}`, borderLeft: `3px solid ${color}`,
        transition: 'background 120ms, border-color 120ms',
      }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#0a0b0f', background: color, padding: '2px 7px', borderRadius: 99 }}>{issue.severity}</span>
          <span style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>{CAT_ICON[issue.category]} {CAT_LABEL[issue.category]} · {issue.reference}</span>
          {issue.projectName && <span style={{ fontSize: 11, color: 'var(--jarvis-ts)', opacity: 0.8 }}>· {issue.projectName}</span>}
          {overdue && <span style={{ fontSize: 10, fontWeight: 600, color, border: `1px solid ${color}`, padding: '1px 6px', borderRadius: 99 }}>{overdue}</span>}
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color, fontFamily: 'var(--jarvis-font-mono)' }}>{issue.score}</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--jarvis-tx)', lineHeight: 1.45 }}>{issue.why}</div>
        <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', marginTop: 6, display: 'flex', gap: 6 }}>
          <span aria-hidden>→</span><span><strong style={{ color: 'var(--jarvis-tx)' }}>Do:</strong> {issue.recommendedAction}</span>
        </div>
        {issue.impacts.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {issue.impacts.map(t => (
              <span key={t} style={{ fontSize: 10, color: 'var(--jarvis-ts)', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', padding: '1px 7px', borderRadius: 99 }}>{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface Props { onNavigate?: (tab: string) => void }
const CATS: (Category | 'all')[] = ['all', 'missing_approval', 'blocker', 'schedule_clash', 'bim_clash', 'commercial_gate']

export default function CoordinationView(_props: Props) {
  const [briefing, setBriefing] = useState<PortfolioBriefing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const openRecord = useAppStore(s => s.openRecord)

  const handleOpen = useCallback((i: CoordinationIssue) => {
    openRecord({ tab: SOURCE_TAB[i.source], source: i.source, sourceId: i.sourceId, projectId: i.projectId })
  }, [openRecord])

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const res = await fetch('/api/v1/copilot/coordination?limit=60')
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json() as { data: PortfolioBriefing }
      setBriefing(json.data)
    } catch { setError(true) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const issues = (briefing?.issues ?? []).filter(i => filter === 'all' || i.category === filter)

  const chipS = (active: boolean, color?: string): React.CSSProperties => ({
    padding: '4px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
    border: `1px solid ${color ?? 'var(--jarvis-bd)'}`, background: active ? (color ?? 'var(--jarvis-ac)') : 'transparent',
    color: active ? '#0a0b0f' : (color ?? 'var(--jarvis-tx)'), fontWeight: active ? 700 : 400,
  })

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🔗 Coordination</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>Where the project is blocked or out of sync — across every active project.</p>
        </div>
        <button onClick={load} disabled={loading} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: loading ? 'default' : 'pointer', border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', opacity: loading ? 0.6 : 1 }}>{loading ? 'Refreshing…' : '↻ Refresh'}</button>
      </div>

      {briefing && (
        <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', fontSize: 14, color: 'var(--jarvis-tx)', lineHeight: 1.5 }}>{briefing.headline}</div>
      )}

      {briefing && briefing.summary.total > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {CATS.map(c => {
            const count = c === 'all' ? briefing.issues.length : briefing.issues.filter(i => i.category === c).length
            const label = c === 'all' ? 'All' : CAT_LABEL[c]
            return <button key={c} onClick={() => setFilter(c)} style={chipS(filter === c)}>{label} ({count})</button>
          })}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--jarvis-ts)' }}>{briefing.summary.projects} active project{briefing.summary.projects === 1 ? '' : 's'}</span>
        </div>
      )}

      {error && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>
          Couldn&apos;t load coordination. <button onClick={load} style={{ background: 'none', border: 'none', color: 'var(--jarvis-ac)', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}
      {!error && loading && !briefing && <div style={{ padding: 24, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>Checking project coordination…</div>}
      {!error && briefing && issues.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>
          {briefing.summary.total === 0 ? '✅ No coordination issues — approvals, dependencies, clashes, and change orders are all clear.' : 'No issues match this filter.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {issues.map((it, i) => <IssueCard key={`${it.source}-${it.sourceId ?? i}`} issue={it} onOpen={handleOpen} />)}
      </div>
    </div>
  )
}
