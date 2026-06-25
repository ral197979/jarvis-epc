/**
 * Denver Engineering — Related records panel (v4.35.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Workflow Redesign W4 (see WORKFLOW_REDESIGN.md §9). A drop-in panel for any
 * record detail view: shows the records connected to this one (FK / shared-key /
 * Action-spine links only) grouped by relationship, each deep-linking to its
 * canonical screen. Renders nothing when there are no real links.
 *
 * Data: GET /api/v1/related/:source/:id
 */
import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../modules/store/appSlice'

interface RelatedItem {
  source: string; sourceId: string; tab: string; parentId: string | null
  projectId: string | null; identifier: string | null; title: string; status: string | null
}
interface RelatedGroup { key: string; label: string; items: RelatedItem[] }
interface RelatedResult { source: string; id: string; groups: RelatedGroup[] }

const SOURCE_ICON: Record<string, string> = {
  rfi: '❓', submittal: '📨', punch: '📌', inspection: '🔍',
  action: '⚡', changeorder: '🔄', drawing: '📐', ncr: '🚫', capa: '🛠️',
}

export default function RelatedPanel({ source, id, projectId }: { source: string; id: string; projectId?: string | null }) {
  const [data, setData] = useState<RelatedResult | null>(null)
  const [loading, setLoading] = useState(false)
  const openRecord = useAppStore(s => s.openRecord)

  useEffect(() => {
    let alive = true
    setLoading(true); setData(null)
    fetch(`/api/v1/related/${source}/${id}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive) setData(j?.data ?? null) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [source, id])

  if (loading && !data) return null
  if (!data || data.groups.length === 0) return null

  return (
    <div style={{ borderTop: '1px solid var(--jarvis-bg)', paddingTop: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
        🔗 Related records
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.groups.map(g => (
          <div key={g.key}>
            <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginBottom: 6 }}>{g.label}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {g.items.map(it => (
                <button
                  key={`${it.source}:${it.sourceId}`}
                  onClick={() => openRecord({ tab: it.tab, source: it.source, sourceId: it.sourceId, projectId: it.projectId ?? projectId ?? '', parentId: it.parentId ?? null })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer',
                    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--jarvis-bd)',
                    background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', fontSize: 13, width: '100%',
                  }}
                >
                  <span aria-hidden>{SOURCE_ICON[it.source] ?? '•'}</span>
                  {it.identifier && <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, color: 'var(--jarvis-ts)' }}>{it.identifier}</span>}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title || '(untitled)'}</span>
                  {it.status && <span style={{ fontSize: 11, color: 'var(--jarvis-td)' }}>{it.status}</span>}
                  <span style={{ color: 'var(--jarvis-td)' }} aria-hidden>›</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
