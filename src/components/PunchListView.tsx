/**
 * Denver Engineering — PunchListView (REST upgrade)
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.32.0 — Full punch-list workflow against /api/v1/projects/:projectId/
 * punch-lists and /api/v1/punch-items/*.
 *
 * Lifecycle:
 *   list:  open -> in_progress -> closed
 *   item:  open -> in_progress -> verified -> closed
 *
 * Verify and close use dedicated endpoints (POST /:id/verify and /:id/close)
 * which stamp verified_by/at and closed_by/at server-side.
 *
 * Replaces the corrupted file shipped in 2444420 (null byte + interleaved RFI
 * fragments rendered the original unparseable by tsc).
 */
import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useDeepLink } from '../hooks/useDeepLink'
import { downloadCsv } from '../utils/csv'

interface PunchList {
  id: string
  project_id: string
  title: string
  description: string | null
  status: 'open' | 'in_progress' | 'closed'
  item_count: number | string
  open_count: number | string
  in_progress_count: number | string
  verified_count: number | string
  closed_count: number | string
  created_by: string | null
  created_at: string
  updated_at: string
}


interface Drawing {
  id: string
  sheet_number: string
  title: string
  discipline: string | null
  current_rev: string | null
}

interface PunchItem {
  id: string
  punch_list_id: string
  project_id: string
  item_number: number
  title: string
  description: string | null
  location: string | null
  discipline: string | null
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'in_progress' | 'verified' | 'closed'
  assigned_to: string | null
  due_date: string | null
  drawing_id: string | null
  pin_x: number | null
  pin_y: number | null
  photos: any[]
  verified_by: string | null
  verified_at: string | null
  closed_by: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

interface Project {
  id: string
  code?: string
  name: string
}

const DISCIPLINES = [
  'Architectural',
  'Structural',
  'Mechanical',
  'Electrical',
  'Plumbing',
  'Fire / Life Safety',
  'Civil',
  'Process / Water',
  'Controls / BAS',
  'Telecom / Security',
]

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'var(--jarvis-red)',
  high: 'var(--jarvis-amb)',
  medium: 'var(--jarvis-accent)',
  low: 'var(--jarvis-grn)',
}

const ITEM_STATUS_COLOR: Record<string, string> = {
  open: 'var(--jarvis-red)',
  in_progress: 'var(--jarvis-amb)',
  verified: 'var(--jarvis-accent)',
  closed: 'var(--jarvis-grn)',
}

const ITEM_STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  verified: 'Verified',
  closed: 'Closed',
}

const LIST_STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  closed: 'Closed',
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '-'
  try { return new Date(d).toLocaleDateString() } catch { return String(d) }
}

function n(v: number | string | null | undefined): number {
  if (v == null) return 0
  const x = typeof v === 'number' ? v : parseInt(v, 10)
  return Number.isFinite(x) ? x : 0
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color,
        border: `1px solid ${color}`,
        background: 'transparent',
      }}
    >
      {children}
    </span>
  )
}

export default function PunchListView(_props: { policy?: any; biz?: any; onNavigate?: (tab: string) => void; onToast?: (m: string, t?: string) => void; onAudit?: (e: unknown) => void }) {
  const { onToast, onAudit } = _props
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string>('')

  const [lists, setLists] = useState<PunchList[]>([])
  const [selectedListId, setSelectedListId] = useState<string>('')
  const [items, setItems] = useState<PunchItem[]>([])

  const [loadingLists, setLoadingLists] = useState(false)
  const [loadingItems, setLoadingItems] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterPriority, setFilterPriority] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [showCreateList, setShowCreateList] = useState(false)
  const [listForm, setListForm] = useState({ title: '', description: '' })

  const [showCreateItem, setShowCreateItem] = useState(false)
  const [itemForm, setItemForm] = useState({
    title: '',
    description: '',
    location: '',
    discipline: 'Architectural',
    priority: 'medium' as 'low' | 'medium' | 'high' | 'critical',
    due_date: '',
    drawing_id: '' as string,
    pin_x: null as number | null,
    pin_y: null as number | null,
  })
  const [drawings, setDrawings] = useState<Drawing[]>([])

  const [showDetail, setShowDetail] = useState(false)
  const [selectedItem, setSelectedItem] = useState<PunchItem | null>(null)
  const deepLink = useDeepLink('punch')
  const deepLinkOpened = useRef(false)

  // Load projects
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/v1/projects', { credentials: 'include' })
        const json = await res.json()
        const list: Project[] = json.data || json.projects || []
        setProjects(list)
        const saved = localStorage.getItem('jarvis-active-project')
        if (saved && list.some(p => p.id === saved)) {
          setProjectId(saved)
        } else if (list.length > 0) {
          setProjectId(list[0].id)
          localStorage.setItem('jarvis-active-project', list[0].id)
        }
      } catch (e) {
        console.error('[punch] load projects failed', e)
        setError('Failed to load projects')
      }
    })()
  }, [])

  // Load lists
  const reloadLists = async () => {
    if (!projectId) { setLists([]); setSelectedListId(''); return }
    setLoadingLists(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/punch-lists?limit=100`, { credentials: 'include' })
      const json = await res.json()
      const next: PunchList[] = json.punchLists || json.data || []
      setLists(next)
      if (next.length > 0) {
        const stillExists = next.some(l => l.id === selectedListId)
        if (!stillExists) setSelectedListId(next[0].id)
      } else {
        setSelectedListId('')
      }
    } catch (e) {
      console.error('[punch] load lists failed', e)
      setError('Failed to load punch lists')
    } finally {
      setLoadingLists(false)
    }
  }
  useEffect(() => { reloadLists() }, [projectId])

  // Load drawings for pin wiring
  useEffect(() => {
    if (!projectId) { setDrawings([]); return }
    (async () => {
      try {
        const res = await fetch(`/api/v1/projects/${projectId}/drawings?limit=200`, { credentials: 'include' })
        if (!res.ok) return
        const json = await res.json()
        setDrawings(Array.isArray(json.drawings) ? json.drawings : [])
      } catch { /* ignore */ }
    })()
  }, [projectId])

  // Load items for selected list
  const reloadItems = async () => {
    if (!selectedListId) { setItems([]); return }
    setLoadingItems(true)
    try {
      const res = await fetch(`/api/v1/punch-lists/${selectedListId}/items`, { credentials: 'include' })
      const json = await res.json()
      setItems(json.items || json.data || [])
    } catch (e) {
      console.error('[punch] load items failed', e)
    } finally {
      setLoadingItems(false)
    }
  }
  useEffect(() => { reloadItems() }, [selectedListId])

  // Deep-link: select the item's parent list (from the Focus payload) so its
  // items load, then open the item once present.
  useEffect(() => {
    if (deepLink?.parentId) setSelectedListId(deepLink.parentId)
  }, [deepLink])
  useEffect(() => {
    if (deepLinkOpened.current || !deepLink?.sourceId || items.length === 0) return
    const target = items.find(it => it.id === deepLink.sourceId)
    if (target) { setSelectedItem(target); setShowDetail(true); deepLinkOpened.current = true }
  }, [deepLink, items])

  // Derived
  const filteredItems = useMemo(() => {
    return items.filter(it => {
      if (filterStatus !== 'all' && it.status !== filterStatus) return false
      if (filterPriority !== 'all' && it.priority !== filterPriority) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = `${it.item_number} ${it.title} ${it.location ?? ''} ${it.discipline ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, filterStatus, filterPriority, search])

  const projectKpis = useMemo(() => {
    const totalItems = lists.reduce((s, l) => s + n(l.item_count), 0)
    const open = lists.reduce((s, l) => s + n(l.open_count), 0)
    const inProgress = lists.reduce((s, l) => s + n(l.in_progress_count), 0)
    const verified = lists.reduce((s, l) => s + n(l.verified_count), 0)
    const closed = lists.reduce((s, l) => s + n(l.closed_count), 0)
    const completionPct = totalItems > 0 ? Math.round((closed / totalItems) * 100) : 0
    return { lists: lists.length, totalItems, open, inProgress, verified, closed, completionPct }
  }, [lists])

  // Actions
  const handleCreateList = async () => {
    if (!projectId || !listForm.title.trim()) {
      alert('Title is required.')
      return
    }
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/punch-lists`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: listForm.title.trim(), description: listForm.description.trim() || null }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Create failed: ${j.error ?? res.statusText}`)
        return
      }
      const json = await res.json()
      const created: PunchList | undefined = json.punchList || json.data
      setShowCreateList(false); onToast?.('Punch list created', 'success'); onAudit?.({ type: 'punch.list.created' })
      setListForm({ title: '', description: '' })
      await reloadLists()
      if (created?.id) setSelectedListId(created.id)
    } catch (e) {
      console.error('[punch] create list failed', e)
      alert('Create failed (network error)')
    }
  }

  const handleCreateItem = async () => {
    if (!selectedListId || !itemForm.title.trim()) {
      alert('Item title is required.')
      return
    }
    try {
      const res = await fetch(`/api/v1/punch-lists/${selectedListId}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: itemForm.title.trim(),
          description: itemForm.description.trim() || null,
          location: itemForm.location.trim() || null,
          discipline: itemForm.discipline || null,
          priority: itemForm.priority,
          due_date: itemForm.due_date || null,
          drawing_id: itemForm.drawing_id || null,
          pin_x: itemForm.pin_x,
          pin_y: itemForm.pin_y,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Create failed: ${j.error ?? res.statusText}`)
        return
      }
      setShowCreateItem(false); onToast?.('Punch item added', 'success'); onAudit?.({ type: 'punch.item.created' })
      setItemForm({
        title: '',
        description: '',
        location: '',
        discipline: 'Architectural',
        priority: 'medium',
        due_date: '',
        drawing_id: '',
        pin_x: null,
        pin_y: null,
      })
      await reloadItems()
      await reloadLists()
    } catch (e) {
      console.error('[punch] create item failed', e)
      alert('Create failed (network error)')
    }
  }

  const handleItemStatus = async (itemId: string, newStatus: PunchItem['status']) => {
    try {
      const res = await fetch(`/api/v1/punch-items/${itemId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Status change failed: ${j.error ?? res.statusText}`)
        return
      }
      await reloadItems()
      await reloadLists()
    } catch (e) {
      console.error('[punch] status change failed', e)
    }
  }

  const handleVerify = async (itemId: string) => {
    try {
      const res = await fetch(`/api/v1/punch-items/${itemId}/verify`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Verify failed: ${j.error ?? res.statusText}`)
        return
      }
      await reloadItems()
      await reloadLists()
    } catch (e) {
      console.error('[punch] verify failed', e)
    }
  }

  const handleClose = async (itemId: string) => {
    try {
      const res = await fetch(`/api/v1/punch-items/${itemId}/close`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Close failed: ${j.error ?? res.statusText}`)
        return
      }
      await reloadItems()
      await reloadLists()
    } catch (e) {
      console.error('[punch] close failed', e)
    }
  }

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Delete this punch item? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/v1/punch-items/${itemId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Delete failed: ${j.error ?? res.statusText}`)
        return
      }
      await reloadItems()
      await reloadLists()
    } catch (e) {
      console.error('[punch] delete failed', e)
    }
  }

  const openDetail = (it: PunchItem) => {
    setSelectedItem(it)
    setShowDetail(true)
  }

  const activeProject = projects.find(p => p.id === projectId)
  const activeList = lists.find(l => l.id === selectedListId)

  // Render
  return (
    <div role="main" aria-label="Punch List">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Punch Lists
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--jarvis-accent)' }}>
            {activeProject ? `${activeProject.code ?? ''} ${activeProject.name}`.trim() : '- select a project -'}
          </div>
        </div>
        <select
          className="jarvis-input"
          value={projectId}
          onChange={e => {
            setProjectId(e.target.value)
            localStorage.setItem('jarvis-active-project', e.target.value)
          }}
          aria-label="Active project"
          style={{ minWidth: 220 }}
        >
          <option value="">- project -</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.code ? `${p.code} - ` : ''}{p.name}</option>
          ))}
        </select>
        <button
          className="jarvis-btn"
          onClick={() => setShowCreateList(true)}
          disabled={!projectId}
        >
          + New List
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiTile label="Lists"        value={projectKpis.lists} />
        <KpiTile label="Items"        value={projectKpis.totalItems} />
        <KpiTile label="Open"         value={projectKpis.open}        color="var(--jarvis-red)" />
        <KpiTile label="In Progress"  value={projectKpis.inProgress}  color="var(--jarvis-amb)" />
        <KpiTile label="Verified"     value={projectKpis.verified}    color="var(--jarvis-accent)" />
        <KpiTile label="Closed"       value={projectKpis.closed}      color="var(--jarvis-grn)" />
        <KpiTile label="% Closed"     value={`${projectKpis.completionPct}%`} color="var(--jarvis-grn)" />
      </div>

      {/* Two-column layout: lists | items */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 12 }}>

        {/* Lists column */}
        <div style={{ background: 'var(--jarvis-card)', borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Lists
          </div>
          {loadingLists ? (
            <div style={{ padding: 12, color: 'var(--jarvis-ts)', fontSize: 12 }}>Loading...</div>
          ) : lists.length === 0 ? (
            <div style={{ padding: 12, color: 'var(--jarvis-ts)', fontSize: 12 }}>
              {projectId ? 'No punch lists yet. Create one to start.' : 'Select a project first.'}
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {lists.map(l => {
                const active = l.id === selectedListId
                return (
                  <li key={l.id}>
                    <button
                      onClick={() => setSelectedListId(l.id)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 10px',
                        background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                        border: `1px solid ${active ? 'var(--jarvis-accent)' : 'transparent'}`,
                        borderRadius: 4,
                        cursor: 'pointer',
                        color: 'inherit',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{l.title}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'var(--jarvis-ts)' }}>
                        <span>{LIST_STATUS_LABEL[l.status] ?? l.status}</span>
                        <span style={{ fontFamily: 'var(--jarvis-font-mono)' }}>
                          {n(l.closed_count)}/{n(l.item_count)}
                        </span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Items column */}
        <div>
          {/* List header + new item button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {activeList ? `Items - ${LIST_STATUS_LABEL[activeList.status] ?? activeList.status}` : 'Items'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {activeList ? activeList.title : '- select a list -'}
              </div>
            </div>
            <button
              className="jarvis-btn"
              onClick={() => setShowCreateItem(true)}
              disabled={!selectedListId}
            >
              + New Item
            </button>
            <button
              className="jarvis-btn"
              disabled={!items.length}
              onClick={() => downloadCsv(`punch-items-${new Date().toISOString().slice(0,10)}.csv`, items.map((it: any) => ({
                id: it.id, list_id: it.list_id, description: it.description, status: it.status,
                priority: it.priority, location: it.location, trade: it.trade,
                assignee: it.assignee, due_date: it.due_date ?? '',
                drawing_id: it.drawing_id ?? '', pin_x: it.pin_x ?? '', pin_y: it.pin_y ?? '',
                created_at: it.created_at
              })))}
              style={{ marginLeft: 8, opacity: items.length ? 1 : 0.5 }}
              title="Export punch items to CSV"
            >
              ⬇ CSV
            </button>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <select className="jarvis-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {Object.entries(ITEM_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="jarvis-input" value={filterPriority} onChange={e => setFilterPriority(e.target.value)} aria-label="Filter by priority">
              <option value="all">All priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <input
              className="jarvis-input"
              type="search"
              placeholder="Search number, title, location..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search items"
              style={{ flex: 1, minWidth: 180 }}
            />
          </div>

          {/* Items body */}
          {error ? (
            <div className="jarvis-empty" style={{ color: 'var(--jarvis-red)' }}>
              <span className="jarvis-empty-icon">!</span><span>{error}</span>
            </div>
          ) : !selectedListId ? (
            <div className="jarvis-empty">
              <span className="jarvis-empty-icon">*</span>
              <span>Select a punch list to view items.</span>
            </div>
          ) : loadingItems ? (
            <div className="jarvis-empty"><span className="jarvis-empty-icon">...</span><span>Loading items...</span></div>
          ) : filteredItems.length === 0 ? (
            <div className="jarvis-empty">
              <span className="jarvis-empty-icon">+</span>
              <span>{items.length === 0 ? 'No items in this list yet.' : 'No items match the current filters.'}</span>
            </div>
          ) : (
            <div className="jarvis-scroll-y jarvis-max-h-lg">
              <table className="jarvis-table" aria-label="Punch Items">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Title</th>
                    <th>Location</th>
                    <th>Discipline</th>
                    <th>Priority</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th style={{ width: 1 }}>-</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map(it => {
                    const overdue = it.due_date && new Date(it.due_date) < new Date()
                      && !['verified', 'closed'].includes(it.status)
                    return (
                      <tr key={it.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(it)}>
                        <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, fontWeight: 700 }}>
                          #{it.item_number}
                        </td>
                        <td style={{ fontWeight: 600 }}>{it.title}</td>
                        <td>{it.location ?? '-'}</td>
                        <td>{it.discipline ?? '-'}</td>
                        <td><Pill color={PRIORITY_COLOR[it.priority] ?? 'var(--jarvis-ts)'}>{it.priority}</Pill></td>
                        <td style={{ color: overdue ? 'var(--jarvis-red)' : undefined, fontWeight: overdue ? 700 : undefined }}>
                          {fmtDate(it.due_date)}{overdue ? ' !' : ''}
                        </td>
                        <td><Pill color={ITEM_STATUS_COLOR[it.status] ?? 'var(--jarvis-ts)'}>{ITEM_STATUS_LABEL[it.status] ?? it.status}</Pill></td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {it.status === 'open' && (
                            <button
                              className="jarvis-btn"
                              onClick={e => { e.stopPropagation(); handleItemStatus(it.id, 'in_progress') }}
                              style={{ fontSize: 11, padding: '2px 8px' }}
                            >Start</button>
                          )}
                          {it.status === 'in_progress' && (
                            <button
                              className="jarvis-btn"
                              onClick={e => { e.stopPropagation(); handleVerify(it.id) }}
                              style={{ fontSize: 11, padding: '2px 8px' }}
                            >Verify</button>
                          )}
                          {it.status === 'verified' && (
                            <button
                              className="jarvis-btn"
                              onClick={e => { e.stopPropagation(); handleClose(it.id) }}
                              style={{ fontSize: 11, padding: '2px 8px' }}
                            >Close</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create list modal */}
      {showCreateList && (
        <Modal title="New Punch List" onClose={() => setShowCreateList(false)}>
          <FormRow label="Title *">
            <input
              className="jarvis-input"
              value={listForm.title}
              onChange={e => setListForm({ ...listForm, title: e.target.value })}
              placeholder="e.g. Final Walkthrough - Level 2"
            />
          </FormRow>
          <FormRow label="Description">
            <textarea
              className="jarvis-input"
              value={listForm.description}
              onChange={e => setListForm({ ...listForm, description: e.target.value })}
              rows={3}
              placeholder="Scope of this punch list..."
            />
          </FormRow>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="jarvis-btn" onClick={() => setShowCreateList(false)}>Cancel</button>
            <button className="jarvis-btn" onClick={handleCreateList} style={{ background: 'var(--jarvis-accent)', color: 'var(--jarvis-bg)' }}>
              Create
            </button>
          </div>
        </Modal>
      )}

      {/* Create item modal */}
      {showCreateItem && (
        <Modal title={`New Item - ${activeList?.title ?? ''}`} onClose={() => setShowCreateItem(false)}>
          <FormRow label="Title *">
            <input
              className="jarvis-input"
              value={itemForm.title}
              onChange={e => setItemForm({ ...itemForm, title: e.target.value })}
              placeholder="e.g. Touch up paint at column line C-4"
            />
          </FormRow>
          <FormRow label="Description">
            <textarea
              className="jarvis-input"
              value={itemForm.description}
              onChange={e => setItemForm({ ...itemForm, description: e.target.value })}
              rows={3}
              placeholder="Detail of the deficiency..."
            />
          </FormRow>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <FormRow label="Location">
              <input
                className="jarvis-input"
                value={itemForm.location}
                onChange={e => setItemForm({ ...itemForm, location: e.target.value })}
                placeholder="e.g. L2 Mech Room"
              />
            </FormRow>
            <FormRow label="Discipline">
              <select
                className="jarvis-input"
                value={itemForm.discipline}
                onChange={e => setItemForm({ ...itemForm, discipline: e.target.value })}
              >
                {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </FormRow>
            <FormRow label="Priority">
              <select
                className="jarvis-input"
                value={itemForm.priority}
                onChange={e => setItemForm({ ...itemForm, priority: e.target.value as any })}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </FormRow>
            <FormRow label="Due Date">
              <input
                className="jarvis-input"
                type="date"
                value={itemForm.due_date}
                onChange={e => setItemForm({ ...itemForm, due_date: e.target.value })}
              />
            </FormRow>
          </div>
          <FormRow label="Drawing (optional)">
            <select
              className="jarvis-input"
              value={itemForm.drawing_id}
              onChange={e => setItemForm({ ...itemForm, drawing_id: e.target.value, pin_x: null, pin_y: null })}
            >
              <option value="">- no drawing -</option>
              {drawings.map(d => (
                <option key={d.id} value={d.id}>
                  {d.sheet_number} - {d.title}{d.discipline ? ` (${d.discipline})` : ''}
                </option>
              ))}
            </select>
          </FormRow>

          {itemForm.drawing_id && (
            <FormRow label={`Pin location${itemForm.pin_x != null && itemForm.pin_y != null ? ` (${itemForm.pin_x.toFixed(1)}, ${itemForm.pin_y.toFixed(1)})` : ' - click to place'}`}>
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                  const x = ((e.clientX - r.left) / r.width)  * 100
                  const y = ((e.clientY - r.top)  / r.height) * 100
                  setItemForm({ ...itemForm, pin_x: Math.round(x * 10) / 10, pin_y: Math.round(y * 10) / 10 })
                }}
                style={{
                  position: 'relative',
                  width: '100%',
                  height: 180,
                  border: '1px dashed var(--jarvis-border, #8884)',
                  borderRadius: 6,
                  background: 'var(--jarvis-panel, #1113)',
                  cursor: 'crosshair',
                  userSelect: 'none',
                }}
                title="Click to drop pin (normalized 0-100 coords)"
              >
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 12, pointerEvents: 'none' }}>
                  Drawing preview placeholder - click to place pin
                </div>
                {itemForm.pin_x != null && itemForm.pin_y != null && (
                  <div
                    style={{
                      position: 'absolute',
                      left: `calc(${itemForm.pin_x}% - 8px)`,
                      top:  `calc(${itemForm.pin_y}% - 8px)`,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: 'var(--jarvis-accent, #e11)',
                      border: '2px solid #fff',
                      boxShadow: '0 0 0 2px rgba(0,0,0,0.4)',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
            </FormRow>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="jarvis-btn" onClick={() => setShowCreateItem(false)}>Cancel</button>
            <button className="jarvis-btn" onClick={handleCreateItem} style={{ background: 'var(--jarvis-accent)', color: 'var(--jarvis-bg)' }}>
              Create
            </button>
          </div>
        </Modal>
      )}

      {/* Detail modal */}
      {showDetail && selectedItem && (
        <Modal title={`Item #${selectedItem.item_number} - ${selectedItem.title}`} onClose={() => setShowDetail(false)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
            <KV label="Status"><Pill color={ITEM_STATUS_COLOR[selectedItem.status] ?? 'var(--jarvis-ts)'}>{ITEM_STATUS_LABEL[selectedItem.status] ?? selectedItem.status}</Pill></KV>
            <KV label="Priority"><Pill color={PRIORITY_COLOR[selectedItem.priority] ?? 'var(--jarvis-ts)'}>{selectedItem.priority}</Pill></KV>
            <KV label="Discipline">{selectedItem.discipline ?? '-'}</KV>
            <KV label="Location">{selectedItem.location ?? '-'}</KV>
            <KV label="Due Date">{fmtDate(selectedItem.due_date)}</KV>
            <KV label="Drawing Pin">{selectedItem.drawing_id ? `${selectedItem.drawing_id.slice(0, 8)}... @ (${selectedItem.pin_x ?? '?'}, ${selectedItem.pin_y ?? '?'})` : '-'}</KV>
            <KV label="Verified">{selectedItem.verified_at ? fmtDate(selectedItem.verified_at) : '-'}</KV>
            <KV label="Closed">{selectedItem.closed_at ? fmtDate(selectedItem.closed_at) : '-'}</KV>
          </div>
          {selectedItem.description && (
            <div style={{ background: 'var(--jarvis-card)', padding: 10, borderRadius: 6, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Description
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{selectedItem.description}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
            {selectedItem.status === 'open' && (
              <button className="jarvis-btn" onClick={() => { handleItemStatus(selectedItem.id, 'in_progress'); setShowDetail(false) }}>
                Start Work
              </button>
            )}
            {selectedItem.status === 'in_progress' && (
              <button className="jarvis-btn" onClick={() => { handleVerify(selectedItem.id); setShowDetail(false) }}
                style={{ background: 'var(--jarvis-accent)', color: 'var(--jarvis-bg)' }}>
                Mark Verified
              </button>
            )}
            {selectedItem.status === 'verified' && (
              <button className="jarvis-btn" onClick={() => { handleClose(selectedItem.id); setShowDetail(false) }}
                style={{ background: 'var(--jarvis-grn)', color: 'var(--jarvis-bg)' }}>
                Close
              </button>
            )}
            <button className="jarvis-btn" onClick={() => { handleDeleteItem(selectedItem.id); setShowDetail(false) }}
              style={{ borderColor: 'var(--jarvis-red)', color: 'var(--jarvis-red)' }}>
              Delete
            </button>
            <button className="jarvis-btn" onClick={() => setShowDetail(false)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// Local UI helpers

function KpiTile({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{
      background: 'var(--jarvis-card)',
      padding: 10,
      borderRadius: 6,
      border: '1px solid rgba(255,255,255,0.05)',
    }}>
      <div style={{
        fontSize: 10,
        color: 'var(--jarvis-ts)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}>{label}</div>
      <div style={{
        fontSize: 22,
        fontWeight: 700,
        color: color ?? 'var(--jarvis-accent)',
        fontFamily: 'var(--jarvis-font-mono)',
      }}>{value}</div>
    </div>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 11,
        color: 'var(--jarvis-ts)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 4,
      }}>{label}</div>
      {children}
    </div>
  )
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--jarvis-card)', padding: 8, borderRadius: 4 }}>
      <div style={{
        fontSize: 10,
        color: 'var(--jarvis-ts)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 2,
      }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{children}</div>
    </div>
  )
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      role="dialog"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--jarvis-bg)',
          border: '1px solid var(--jarvis-accent)',
          borderRadius: 8,
          padding: 20,
          maxWidth: wide ? 720 : 480,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          paddingBottom: 8,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--jarvis-accent)' }}>{title}</div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--jarvis-ts)', fontSize: 20, cursor: 'pointer' }}
            aria-label="Close"
          >x</button>
        </div>
        {children}
      </div>
    </div>
  )
}
