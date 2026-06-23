/**
 * Denver Engineering — Project Copilot / Focus (v4.41.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * The AI Project Intelligence surface. Answers "What should I focus on today?"
 * by ranking live cross-module signals (RFIs, submittals, risks, inspections,
 * punch, actions, cost, schedule) into an explained, prioritised focus list.
 *
 * Data: GET /api/v1/copilot/focus  (portfolio roll-up across active projects).
 */
import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../../modules/store/appSlice'

// ─── Types (mirror api/services/copilot/projectCopilotService.ts) ─────────────

type FocusSeverity = 'critical' | 'high' | 'medium' | 'low'
type FocusSource =
  | 'rfi' | 'submittal' | 'risk' | 'inspection' | 'punch' | 'action' | 'budget' | 'schedule'

interface FocusItem {
  source:            FocusSource
  sourceId:          string | null
  reference:         string
  title:             string
  why:               string
  recommendedAction: string
  severity:          FocusSeverity
  score:             number
  impacts:           string[]
  dueDate:           string | null
  daysOverdue:       number | null
  parentId?:         string | null
  projectId:         string
  projectName:       string | null
}

interface PortfolioBriefing {
  generatedAt: string
  headline:    string
  summary:     { projects: number; total: number; critical: number; high: number }
  items:       FocusItem[]
}

// ─── Presentation maps ────────────────────────────────────────────────────────

const SEV_COLOR: Record<FocusSeverity, string> = {
  critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#6b7280',
}
const SOURCE_LABEL: Record<FocusSource, string> = {
  rfi: 'RFI', submittal: 'Submittal', risk: 'Risk', inspection: 'Inspection',
  punch: 'Punch', action: 'Action', budget: 'Cost', schedule: 'Schedule',
}
const SOURCE_ICON: Record<FocusSource, string> = {
  rfi: '❓', submittal: '📨', risk: '⚠️', inspection: '🔍',
  punch: '📌', action: '⚡', budget: '💰', schedule: '📅',
}
// Where each source's record lives. budget/schedule are project-level, so they
// land on the relevant module with the project pre-selected.
const SOURCE_TAB: Record<FocusSource, string> = {
  rfi: 'rfis', submittal: 'submittals', risk: 'riskregister', inspection: 'inspections',
  punch: 'punch', action: 'actions', budget: 'costcontrol', schedule: 'evm',
}

// ─── Item card ────────────────────────────────────────────────────────────────

function FocusCard({ item, onOpen }: { item: FocusItem; onOpen: (item: FocusItem) => void }) {
  const color = SEV_COLOR[item.severity]
  const [hover, setHover] = useState(false)
  const overdueBadge = item.daysOverdue != null && item.daysOverdue > 0
    ? `${item.daysOverdue}d overdue`
    : item.daysOverdue != null && item.daysOverdue < 0
      ? `due in ${-item.daysOverdue}d`
      : null

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${SOURCE_LABEL[item.source]} ${item.reference}`}
      onClick={() => onOpen(item)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item) } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
        background: hover ? 'var(--jarvis-bg)' : 'var(--jarvis-bg2)',
        border: `1px solid ${hover ? color : 'var(--jarvis-bd)'}`,
        borderLeft: `3px solid ${color}`,
        transition: 'background var(--jarvis-t-fast, 120ms), border-color var(--jarvis-t-fast, 120ms)',
      }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Top row: severity + source + project + due */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
            color: '#0a0b0f', background: color, padding: '2px 7px', borderRadius: 99,
          }}>{item.severity}</span>
          <span style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>
            {SOURCE_ICON[item.source]} {SOURCE_LABEL[item.source]} · {item.reference}
          </span>
          {item.projectName && (
            <span style={{ fontSize: 11, color: 'var(--jarvis-ts)', opacity: 0.8 }}>· {item.projectName}</span>
          )}
          {overdueBadge && (
            <span style={{
              fontSize: 10, fontWeight: 600, color, border: `1px solid ${color}`,
              padding: '1px 6px', borderRadius: 99,
            }}>{overdueBadge}</span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color, fontFamily: 'var(--jarvis-font-mono)' }}>
            {item.score}
          </span>
        </div>

        {/* Why */}
        <div style={{ fontSize: 13, color: 'var(--jarvis-tx)', lineHeight: 1.45 }}>{item.why}</div>

        {/* Recommended action */}
        <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', marginTop: 6, display: 'flex', gap: 6 }}>
          <span aria-hidden>→</span><span><strong style={{ color: 'var(--jarvis-tx)' }}>Do:</strong> {item.recommendedAction}</span>
        </div>

        {/* Impact tags */}
        {item.impacts.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {item.impacts.map(t => (
              <span key={t} style={{
                fontSize: 10, color: 'var(--jarvis-ts)', background: 'var(--jarvis-bg)',
                border: '1px solid var(--jarvis-bd)', padding: '1px 7px', borderRadius: 99,
              }}>{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

interface Props { onNavigate?: (tab: string) => void }

const SEVERITIES: (FocusSeverity | 'all')[] = ['all', 'critical', 'high', 'medium', 'low']

export default function CopilotView(_props: Props) {
  const [briefing, setBriefing] = useState<PortfolioBriefing | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(false)
  const [filter,   setFilter]   = useState<FocusSeverity | 'all'>('all')
  const openRecord = useAppStore(s => s.openRecord)

  const handleOpen = useCallback((item: FocusItem) => {
    openRecord({
      tab:       SOURCE_TAB[item.source],
      source:    item.source,
      sourceId:  item.sourceId,
      projectId: item.projectId,
      parentId:  item.parentId ?? null,
    })
  }, [openRecord])

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const res  = await fetch('/api/v1/copilot/focus?limit=50')
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json() as { data: PortfolioBriefing }
      setBriefing(json.data)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const items = (briefing?.items ?? []).filter(i => filter === 'all' || i.severity === filter)

  const chipS = (active: boolean, color?: string): React.CSSProperties => ({
    padding: '4px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
    border: `1px solid ${color ?? 'var(--jarvis-bd)'}`,
    background: active ? (color ?? 'var(--jarvis-ac)') : 'transparent',
    color:      active ? '#0a0b0f' : (color ?? 'var(--jarvis-tx)'),
    fontWeight: active ? 700 : 400, textTransform: 'capitalize',
  })

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🧭 Focus</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>
            What needs your attention today — ranked across every project.
          </p>
        </div>
        <button onClick={load} disabled={loading} style={{
          padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: loading ? 'default' : 'pointer',
          border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)',
          opacity: loading ? 0.6 : 1,
        }}>{loading ? 'Refreshing…' : '↻ Refresh'}</button>
      </div>

      {/* Headline */}
      {briefing && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 16,
          background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)',
          fontSize: 14, color: 'var(--jarvis-tx)', lineHeight: 1.5,
        }}>{briefing.headline}</div>
      )}

      {/* Summary chips / severity filters */}
      {briefing && briefing.summary.total > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {SEVERITIES.map(s => {
            const count = s === 'all'
              ? briefing.summary.total
              : briefing.items.filter(i => i.severity === s).length
            const color = s === 'all' ? undefined : SEV_COLOR[s]
            return (
              <button key={s} onClick={() => setFilter(s)} style={chipS(filter === s, color)}>
                {s} ({count})
              </button>
            )
          })}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--jarvis-ts)' }}>
            {briefing.summary.projects} active project{briefing.summary.projects === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {/* States */}
      {error && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>
          Couldn't load the focus briefing. <button onClick={load} style={{ background: 'none', border: 'none', color: 'var(--jarvis-ac)', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}
      {!error && loading && !briefing && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>Analysing projects…</div>
      )}
      {!error && briefing && items.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>
          {briefing.summary.total === 0
            ? '✅ Nothing pressing — no overdue or high-risk items across your active projects.'
            : 'No items match this filter.'}
        </div>
      )}

      {/* Item list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it, i) => <FocusCard key={`${it.source}-${it.sourceId ?? i}`} item={it} onOpen={handleOpen} />)}
      </div>
    </div>
  )
}
