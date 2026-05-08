/**
 * Denver Engineering — Dependency Graph Placeholder (v4.34.0)
 * ─────────────────────────────────────────────────────────────
 * Ava Phase 2 — Scaffold for dependency visualization.
 *
 * Current: renders blockers and downstream actions as a text tree.
 * Future:  swap body for a proper D3/Cytoscape graph component.
 */
import React, { useEffect, useState } from 'react'

interface DependencyNode {
  action_id:   string
  title:       string
  status:      string
  priority:    string
  action_type: string
  depth:       number
}

interface DependencyReport {
  action_id:               string
  is_blocked:              boolean
  blocked_by_count:        number
  blockers:                DependencyNode[]
  root_blockers:           DependencyNode[]
  downstream_impact_count: number
  critical_path_flag:      boolean
}

interface DependencyGraphPlaceholderProps {
  actionId:  string
  tenantId?: string  // used for API call if provided
  report?:   DependencyReport  // pre-fetched; skips API call if provided
}

const STATUS_COLOR: Record<string, string> = {
  open:        '#3b82f6',
  in_progress: '#8b5cf6',
  completed:   '#10b981',
  cancelled:   '#9ca3af',
}

function NodePill({ node }: { node: DependencyNode }) {
  return (
    <span style={{
      display:      'inline-flex', alignItems: 'center', gap: 6,
      padding:      '3px 10px', borderRadius: 12,
      fontSize:     12, fontWeight: 500,
      background:   '#f9fafb', border:  '1px solid #e5e7eb',
    }}>
      <span style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: STATUS_COLOR[node.status] ?? '#d1d5db',
      }} />
      {node.action_type} · {node.title.slice(0, 40)}{node.title.length > 40 ? '…' : ''}
    </span>
  )
}

export function DependencyGraphPlaceholder({
  actionId, tenantId, report: propReport,
}: DependencyGraphPlaceholderProps) {
  const [report, setReport]   = useState<DependencyReport | null>(propReport ?? null)
  const [loading, setLoading] = useState(!propReport)

  useEffect(() => {
    if (propReport) { setReport(propReport); return }
    setLoading(true)
    fetch(`/api/v1/actions/${actionId}/dependencies`)
      .then(r => r.json())
      .then(j => setReport(j.data ?? null))
      .catch(() => setReport(null))
      .finally(() => setLoading(false))
  }, [actionId, propReport])

  if (loading) {
    return <div style={{ color: '#9ca3af', fontSize: 13, padding: 16 }}>Loading dependencies…</div>
  }

  if (!report) {
    return <div style={{ color: '#9ca3af', fontSize: 13, padding: 16 }}>No dependency data</div>
  }

  return (
    <div style={{ padding: 16, fontSize: 13 }}>
      {/* Header badges */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {report.critical_path_flag && (
          <span style={{ padding: '2px 8px', borderRadius: 4, background: '#fef2f2',
            color: '#dc2626', border: '1px solid #fecaca', fontWeight: 600, fontSize: 11 }}>
            🔴 Critical Path
          </span>
        )}
        {report.is_blocked && (
          <span style={{ padding: '2px 8px', borderRadius: 4, background: '#fffbeb',
            color: '#d97706', border: '1px solid #fde68a', fontWeight: 600, fontSize: 11 }}>
            🔒 Blocked by {report.blocked_by_count}
          </span>
        )}
        {report.downstream_impact_count > 0 && (
          <span style={{ padding: '2px 8px', borderRadius: 4, background: '#eff6ff',
            color: '#2563eb', border: '1px solid #bfdbfe', fontWeight: 600, fontSize: 11 }}>
            ⬇ {report.downstream_impact_count} downstream
          </span>
        )}
      </div>

      {/* Blockers section */}
      {report.blockers.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, color: '#374151', marginBottom: 8 }}>
            Blocked by ({report.blockers.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 16,
            borderLeft: '2px solid #fca5a5' }}>
            {report.blockers.map(n => <NodePill key={n.action_id} node={n} />)}
          </div>
        </div>
      )}

      {/* Root blockers */}
      {report.root_blockers.length > 0 && report.root_blockers[0]?.action_id !== report.blockers[0]?.action_id && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, color: '#374151', marginBottom: 8 }}>
            Root blockers
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 16,
            borderLeft: '2px solid #f87171' }}>
            {report.root_blockers.map(n => <NodePill key={n.action_id} node={n} />)}
          </div>
        </div>
      )}

      {!report.is_blocked && report.downstream_impact_count === 0 && (
        <div style={{ color: '#9ca3af', fontSize: 12 }}>
          No blocking dependencies. This action can proceed independently.
        </div>
      )}

      {/* Future: D3/Cytoscape graph */}
      <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6,
        background: '#f9fafb', border: '1px dashed #d1d5db', color: '#9ca3af', fontSize: 11 }}>
        📊 Interactive dependency graph — Phase 2 Sprint 3
      </div>
    </div>
  )
}
