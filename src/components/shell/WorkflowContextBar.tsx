/**
 * Denver Engineering — Workflow Context Bar (v4.34.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Workflow Redesign W3b (see WORKFLOW_REDESIGN.md §11). A slim strip rendered at
 * the top of every screen showing:
 *   • breadcrumb — Section › Screen (derived from the lifecycle nav)
 *   • the currently selected project, its current lifecycle phase, and the status
 *     of the gate that controls advancement — clickable through to the Lifecycle.
 *
 * Self-contained: reads the active project from localStorage (the shared
 * `jarvis-active-project` convention) and the live lifecycle from the W3 API.
 * Degrades gracefully to just the breadcrumb when there is no project or no data.
 */
import React, { useEffect, useRef, useState } from 'react'
import { NAVIGATION_ITEMS, NAV_SECTIONS } from '../../config/navigation'

interface Props { activeTab: string; onNavigate?: (tab: string) => void }

interface GateLite { name: string; phase: string; approvalStatus: 'pending' | 'approved' | 'waived' }
interface LifecycleLite { currentPhase: string; currentGate: GateLite | null }

const PHASE_LABEL: Record<string, string> = {
  feasibility: 'Feasibility', feed: 'FEED', detailed_design: 'Detailed Design',
  procurement: 'Procurement', construction: 'Construction', commissioning: 'Commissioning',
  closeout: 'Closeout',
}
const GATE_COLOR: Record<GateLite['approvalStatus'], string> = {
  approved: '#22c55e', waived: '#f59e0b', pending: 'var(--jarvis-ts)',
}

function breadcrumb(activeTab: string): string[] {
  const item = NAVIGATION_ITEMS.find(n => n.id === activeTab)
  if (!item) return []
  const section = NAV_SECTIONS.find(s => s.id === item.section)
  return section ? [section.label, item.label] : [item.label]
}

export default function WorkflowContextBar({ activeTab, onNavigate }: Props) {
  const [projectName, setProjectName] = useState<string | null>(null)
  const [lc, setLc] = useState<LifecycleLite | null>(null)
  const lastProject = useRef<string | null>(null)
  const namesRef = useRef<Record<string, string>>({})

  // Resolve project names once (id → name) for the chip label.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/v1/projects', { credentials: 'include' })
        if (!res.ok) return
        const json = await res.json()
        const list: { id: string; name: string }[] = json.data || json.projects || []
        namesRef.current = Object.fromEntries(list.map(p => [p.id, p.name]))
        const pid = localStorage.getItem('jarvis-active-project')
        if (pid && namesRef.current[pid]) setProjectName(namesRef.current[pid])
      } catch { /* ignore */ }
    })()
  }, [])

  // Refresh the lifecycle chip whenever the active project changes (re-read on tab switch).
  useEffect(() => {
    const pid = (() => { try { return localStorage.getItem('jarvis-active-project') } catch { return null } })()
    if (!pid) { setLc(null); setProjectName(null); lastProject.current = null; return }
    if (namesRef.current[pid]) setProjectName(namesRef.current[pid])
    if (pid === lastProject.current) return
    lastProject.current = pid
    ;(async () => {
      try {
        const res = await fetch(`/api/v1/projects/${pid}/lifecycle`, { credentials: 'include' })
        if (!res.ok) { setLc(null); return }
        const json = await res.json()
        setLc(json.data as LifecycleLite)
      } catch { setLc(null) }
    })()
  }, [activeTab])

  const crumbs = breadcrumb(activeTab)
  if (!crumbs.length && !projectName) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      padding: '6px 16px', borderBottom: '1px solid var(--jarvis-bd)',
      background: 'var(--jarvis-bg2)', fontSize: 12, minHeight: 32, flexWrap: 'wrap',
    }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--jarvis-ts)', minWidth: 0 }}>
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: 'var(--jarvis-td)' }}>›</span>}
            <span style={{ color: i === crumbs.length - 1 ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: i === crumbs.length - 1 ? 600 : 400 }}>{c}</span>
          </React.Fragment>
        ))}
      </div>

      {/* Project / phase / gate chip */}
      {projectName && (
        <button
          onClick={() => onNavigate?.('lifecycle')}
          title="Open project lifecycle"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            background: 'transparent', border: 'none', padding: 0, color: 'var(--jarvis-ts)', fontSize: 12,
          }}
        >
          <span style={{ color: 'var(--jarvis-tx)', fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projectName}</span>
          {lc && (
            <>
              <span style={{ color: 'var(--jarvis-td)' }}>·</span>
              <span>{PHASE_LABEL[lc.currentPhase] ?? lc.currentPhase}</span>
              {lc.currentGate && (
                <>
                  <span style={{ color: 'var(--jarvis-td)' }}>·</span>
                  <span style={{ color: GATE_COLOR[lc.currentGate.approvalStatus] }}>
                    {lc.currentGate.approvalStatus === 'approved' ? '● ' : lc.currentGate.approvalStatus === 'waived' ? '◐ ' : '○ '}
                    {lc.currentGate.name}
                  </span>
                </>
              )}
            </>
          )}
        </button>
      )}
    </div>
  )
}
