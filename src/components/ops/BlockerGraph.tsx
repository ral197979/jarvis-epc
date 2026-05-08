/**
 * Denver Engineering — Blocker Graph (v4.35.0)
 * ──────────────────────────────────────────────
 * Ava Phase 3 — Visual representation of blocked actions
 * and their dependency chains. List-based (no external graph lib).
 * Placeholder architecture for future D3/Cytoscape upgrade.
 */
import React, { useEffect, useState } from 'react'

interface BlockerRow {
  id:              string
  title:           string
  status:          string
  priority:        string
  blocker_count:   number
  blocking_titles: string[]
}

interface BlockerGraphProps {
  projectId?:  string
  maxItems?:   number
  onSelect?:   (actionId: string) => void
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#dc2626', high: '#f97316', medium: '#d97706', low: '#6b7280',
}

const STATUS_COLORS: Record<string, string> = {
  open: '#2563eb', in_progress: '#7c3aed', completed: '#10b981', cancelled: '#9ca3af',
}

export function BlockerGraph({ projectId, maxItems = 20, onSelect }: BlockerGraphProps) {
  const [blockers, setBlockers] = useState<BlockerRow[]>([])
  const [loading, setLoading]  = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (projectId) params.set('project_id', projectId)
    fetch(`/api/v1/ops/blockers?${params}`)
      .then(r => r.json())
      .then(j => setBlockers((j.data ?? []).slice(0, maxItems)))
      .catch(() => setBlockers([]))
      .finally(() => setLoading(false))
  }, [projectId, maxItems])

  if (loading) {
    return <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>Loading blockers…</div>
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Dependency Blockers</div>
        {blockers.length > 0 && (
          <span style={{ fontSize: 11, background: '#fef2f2', color: '#dc2626',
            padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>
            {blockers.length} blocked
          </span>
        )}
      </div>

      {/* Blocker list */}
      {blockers.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
          No dependency blockers found.
        </div>
      ) : (
        blockers.map(row => (
          <div key={row.id}
            onClick={() => onSelect?.(row.id)}
            style={{ padding: '10px 14px', borderBottom: '1px solid #f3f4f6',
              cursor: onSelect ? 'pointer' : 'default' }}>
            {/* Blocked action */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              {/* Blocker count badge */}
              <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                background: '#fef2f2', border: '1.5px solid #dc2626',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: '#dc2626' }}>
                {row.blocker_count}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#111827',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.title}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                  <span style={{ fontSize: 10, fontWeight: 600,
                    color: PRIORITY_COLORS[row.priority] ?? '#6b7280' }}>
                    {row.priority}
                  </span>
                  <span style={{ fontSize: 10, color: STATUS_COLORS[row.status] ?? '#6b7280',
                    textTransform: 'capitalize' }}>
                    {row.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            </div>

            {/* Blocking actions (upstream) */}
            {row.blocking_titles?.length > 0 && (
              <div style={{ marginTop: 6, paddingLeft: 30 }}>
                <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 3 }}>Blocked by:</div>
                {row.blocking_titles.slice(0, 3).map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <div style={{ width: 2, height: 2, borderRadius: '50%', background: '#dc2626', flexShrink: 0 }} />
                    <div style={{ fontSize: 11, color: '#374151',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t}
                    </div>
                  </div>
                ))}
                {row.blocking_titles.length > 3 && (
                  <div style={{ fontSize: 11, color: '#9ca3af', paddingLeft: 8 }}>
                    +{row.blocking_titles.length - 3} more
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}

      {/* Placeholder note for future graph visualization */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid #e5e7eb',
        background: '#f9fafb', fontSize: 11, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>🕸</span>
        <span>Interactive dependency graph visualization coming in Phase 4.</span>
      </div>
    </div>
  )
}
