/**
 * JARVIS EPC — CommissioningView Component
 * Phase 11: Extraction of JarvisCore Sn() — the Closeout / Commissioning module.
 *
 * Three tabs:
 *   Completion    — Category progress bars per closeout record
 *   Punch List    — Filterable punch items with A/B/C priority, 6-stage lifecycle
 *   Lessons       — Lessons learned register with positive/negative/neutral impact
 */

import React, { useState, useMemo } from 'react'
import {
  useBizStore,
  selectPunchItems,
  selectCloseouts,
  selectLessons,
} from '../modules/biz/store'
import { type PolicyConfig } from '../modules/biz/dispatch'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'
import { CxWorkflowView } from './CxWorkflowView'

interface PunchItem {
  id: string; description?: string; priority?: string; status?: string; category?: string
  location?: string; assigned?: string; due?: string; ref_dwg?: string; closed_date?: string
  [key: string]: unknown
}
interface Lesson {
  lesson?: string; category?: string; impact?: string; [key: string]: unknown
}
interface Closeout {
  id?: string; system?: string; description?: string; categories?: Record<string, { total: number; done: number }>
  [key: string]: unknown
}

export interface CommissioningViewProps {
  policy:       PolicyConfig
  closeouts?:   Closeout[]
  punchItems?:  PunchItem[]
  lessons?:     Lesson[]
  onNavigate?:  (tab: string) => void
  onAudit?:     (entry: unknown) => void
  onToast?:     (msg: string, type: string) => void
}

type CommTab = 'completion' | 'punch' | 'lessons' | 'workflow'

const PUNCH_STAGES = ['open','assigned','in-progress','resolved','verified','closed']
const PRIORITY_COLOR: Record<string, string> = { A: 'var(--jarvis-red)', B: 'var(--jarvis-amb)', C: 'var(--jarvis-ts)', high: 'var(--jarvis-red)', medium: 'var(--jarvis-amb)', low: 'var(--jarvis-ts)' }
const CAT_COLORS = ['var(--jarvis-blue)','var(--jarvis-grn)','var(--jarvis-amb)','var(--jarvis-pur)']

function StagePipeline({ stages, current }: { stages: string[]; current?: string }) {
  const activeIdx = current ? stages.indexOf(current) : -1
  return (
    <div style={{ display: 'flex', marginBottom: 16 }}>
      {stages.map((s, i) => {
        const isActive = s === current; const isPast = i < activeIdx
        const bg = isActive ? 'var(--jarvis-ac)' : isPast ? 'var(--jarvis-grn)' : 'var(--jarvis-bl)'
        const tc = isActive || isPast ? '#fff' : 'var(--jarvis-td)'
        return (
          <div key={s} style={{
            flex: 1, padding: '5px 2px', background: bg, color: tc, fontSize: 8,
            fontWeight: isActive ? 700 : 500, textAlign: 'center' as const,
            borderRight: i < stages.length - 1 ? '1px solid rgba(0,0,0,0.1)' : 'none',
            borderRadius: i === 0 ? '6px 0 0 6px' : i === stages.length - 1 ? '0 6px 6px 0' : 0,
            textTransform: 'capitalize' as const,
          }}>{s.replace('-', ' ')}</div>
        )
      })}
    </div>
  )
}

function PunchDetail({ item, onBack }: { item: PunchItem; onBack: () => void }) {
  const pColor = PRIORITY_COLOR[item.priority ?? 'C'] ?? 'var(--jarvis-ts)'
  return (
    <div>
      <div className="jarvis-header" style={{ padding: '10px 0', marginBottom: 16 }}>
        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onBack}>← Punch List</button>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: pColor,
            background: `color-mix(in srgb, ${pColor} 15%, transparent)`,
            padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase' as const }}>
            {item.priority ?? 'C'}-Item
          </span>
          <StatusBadge status={item.status ?? 'open'} />
        </div>
      </div>
      <h2 className="jarvis-heading" style={{ marginBottom: 12 }}>{item.id}</h2>
      <StagePipeline stages={PUNCH_STAGES} current={item.status} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
        {([['Priority',item.priority],['Location',item.location],['Assigned',item.assigned],['Due',item.due],
           ['Category',item.category],['Ref Drawing',item.ref_dwg],['Closed Date',item.closed_date]] as [string,string|undefined][]).map(([lbl,val]) => (
          <div key={lbl} className="jarvis-card" style={{ padding: '8px 10px', background: 'var(--jarvis-bl)' }}>
            <div className="jarvis-muted" style={{ fontSize: 9, marginBottom: 2 }}>{lbl}</div>
            <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--jarvis-tx)' }}>{val ?? '—'}</div>
          </div>
        ))}
      </div>
      {item.description && (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 8 }}>Description</h4>
          <p className="jarvis-body">{item.description}</p>
        </div>
      )}
    </div>
  )
}

function CompletionTab({ closeouts }: { closeouts: Closeout[] }) {
  if (closeouts.length === 0) {
    return <div className="jarvis-empty" role="status"><span className="jarvis-empty-icon">🏗️</span><span>No closeout records</span></div>
  }
  return (
    <div>
      {closeouts.map((cl, idx) => {
        const cats = Object.entries(cl.categories ?? {}).map(([name, data], i) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          total: (data as {total:number;done:number}).total ?? 0,
          done:  (data as {total:number;done:number}).done  ?? 0,
          color: CAT_COLORS[i % 4],
        }))
        const totalAll = cats.reduce((s, c) => s + c.total, 0)
        const doneAll  = cats.reduce((s, c) => s + c.done,  0)
        const pct = totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 100

        return (
          <div key={idx} className="jarvis-card" style={{ padding: 16, marginBottom: 12 }}>
            <div className="jarvis-row" style={{ marginBottom: 12 }}>
              <h3 className="jarvis-heading" style={{ fontSize: 13 }}>
                {cl.system ?? cl.description ?? `Closeout ${idx + 1}`}
              </h3>
              <span style={{
                fontSize: 14, fontWeight: 800, color: pct === 100 ? 'var(--jarvis-grn)' : 'var(--jarvis-tx)',
                fontFamily: 'var(--jarvis-font-mono)',
              }}>{pct}%</span>
            </div>
            {cats.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(cats.length, 4)}, 1fr)`, gap: 10 }}>
                {cats.map((cat, i) => (
                  <div key={i} style={{ background: 'var(--jarvis-bl)', borderRadius: 6, padding: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 6 }}>{cat.name}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--jarvis-font-mono)', marginBottom: 4,
                      color: cat.done === cat.total ? 'var(--jarvis-grn)' : 'var(--jarvis-tx)' }}>
                      {cat.done}/{cat.total}
                    </div>
                    <div style={{ background: 'var(--jarvis-bd)', borderRadius: 4, height: 6 }}>
                      <div style={{ width: `${cat.total > 0 ? (cat.done/cat.total)*100 : 0}%`, height: '100%',
                        borderRadius: 4, background: cat.color, transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="jarvis-muted">No category data</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PunchTab({ items, onSelect }: { items: PunchItem[]; onSelect: (p: PunchItem) => void }) {
  const [statusFilter,   setStatusFilter]   = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')

  const statuses   = useMemo(() => ['all', ...new Set(items.map(p => p.status).filter(Boolean)   as string[])],[items])
  const priorities = useMemo(() => ['all', ...new Set(items.map(p => p.priority).filter(Boolean) as string[])],[items])

  const filtered = useMemo(() => items.filter(p => {
    if (statusFilter   !== 'all' && p.status   !== statusFilter)   return false
    if (priorityFilter !== 'all' && p.priority !== priorityFilter) return false
    return true
  }), [items, statusFilter, priorityFilter])

  const aCount = items.filter(p => p.priority === 'A' || p.priority === 'high').length
  const bCount = items.filter(p => p.priority === 'B' || p.priority === 'medium').length
  const closedCount = items.filter(p => ['resolved','verified','closed'].includes(p.status ?? '')).length
  const closurePct = items.length ? Math.round((closedCount / items.length) * 100) : 100

  if (items.length === 0) {
    return <div className="jarvis-empty" role="status"><span className="jarvis-empty-icon">✅</span><span>No punch items</span></div>
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px,1fr))', gap: 8, marginBottom: 12 }}>
        <KpiCard label="Total"    value={items.length}   sub={`${closedCount} closed`} />
        <KpiCard label="Closure"  value={`${closurePct}%`} color={closurePct === 100 ? 'var(--jarvis-grn)' : 'var(--jarvis-amb)'} />
        <KpiCard label="A-Items"  value={aCount}         color="var(--jarvis-red)" />
        <KpiCard label="B-Items"  value={bCount}         color="var(--jarvis-amb)" />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <select className="jarvis-select" value={statusFilter}   onChange={e => setStatusFilter(e.target.value)}   aria-label="Filter punch by status">
          {statuses.map(s =>   <option key={s} value={s}>{s === 'all' ? 'All Statuses'   : s}</option>)}</select>
        <select className="jarvis-select" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} aria-label="Filter punch by priority">
          {priorities.map(p => <option key={p} value={p}>{p === 'all' ? 'All Priorities' : p}</option>)}</select>
        <span className="jarvis-small" style={{ alignSelf: 'center', marginLeft: 4 }}>{filtered.length} of {items.length}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="jarvis-empty" role="status"><span>No punch items match</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Punch list">
            <thead>
              <tr><th>ID</th><th>Description</th><th>Priority</th><th>Location</th><th>Assigned</th><th>Status</th></tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const pColor = PRIORITY_COLOR[p.priority ?? 'C'] ?? 'var(--jarvis-ts)'
                return (
                  <tr key={p.id} onClick={() => onSelect(p)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 700, color: 'var(--jarvis-ac)', fontSize: 10, fontFamily: 'var(--jarvis-font-mono)' }}>{p.id}</td>
                    <td className="jarvis-truncate" style={{ maxWidth: 200 }}>{p.description ?? '—'}</td>
                    <td>
                      <span style={{ fontSize: 9, fontWeight: 700, color: pColor,
                        background: `color-mix(in srgb, ${pColor} 15%, transparent)`,
                        padding: '2px 5px', borderRadius: 4, textTransform: 'uppercase' as const }}>
                        {p.priority ?? '—'}
                      </span>
                    </td>
                    <td className="jarvis-small">{p.location ?? '—'}</td>
                    <td className="jarvis-small">{p.assigned ?? '—'}</td>
                    <td><StatusBadge status={p.status ?? 'open'} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function LessonsTab({ lessons }: { lessons: Lesson[] }) {
  if (lessons.length === 0) {
    return <div className="jarvis-empty" role="status"><span>No lessons recorded yet</span></div>
  }
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px,1fr))', gap: 8, marginBottom: 12 }}>
        <KpiCard label="Total Lessons" value={lessons.length} />
        <KpiCard label="Positive" value={lessons.filter(l => l.impact === 'positive').length} color="var(--jarvis-grn)" />
        <KpiCard label="Negative" value={lessons.filter(l => l.impact === 'negative').length} color="var(--jarvis-red)" />
      </div>
      <div className="jarvis-scroll-y jarvis-max-h-lg">
        {lessons.map((l, i) => {
          const icon = l.impact === 'positive' ? '✅' : l.impact === 'negative' ? '⚠️' : '📝'
          return (
            <div key={i} className="jarvis-card" style={{ padding: 12, marginBottom: 6, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
              <div>
                <p style={{ fontSize: 12, color: 'var(--jarvis-tx)', marginBottom: 4 }}>{l.lesson ?? '—'}</p>
                <span style={{ fontSize: 10, color: 'var(--jarvis-td)' }}>{l.category ?? ''}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CommissioningView({
  policy, closeouts: closeoutsProp, punchItems: punchProp, lessons: lessonsProp,
  onNavigate, onAudit, onToast,
}: CommissioningViewProps) {
  const storeCloseouts = useBizStore(selectCloseouts)  as Closeout[]
  const storePunch     = useBizStore(selectPunchItems)  as PunchItem[]
  const storeLessons   = useBizStore(selectLessons)     as Lesson[]

  const closeouts = closeoutsProp ?? storeCloseouts
  const punchItems= punchProp     ?? storePunch
  const lessons   = lessonsProp   ?? storeLessons

  const [activeTab,     setActiveTab]     = useState<CommTab>('completion')
  const [selectedPunch, setSelectedPunch] = useState<PunchItem | null>(null)

  const closedCount = punchItems.filter(p => ['resolved','verified','closed'].includes(p.status ?? '')).length
  const openPunch   = punchItems.length - closedCount

  if (selectedPunch) {
    return <PunchDetail item={selectedPunch} onBack={() => setSelectedPunch(null)} />
  }

  const TABS = [
    { id: 'workflow'   as CommTab, label: 'Workflow',       icon: '🔬' },
    { id: 'completion' as CommTab, label: 'Completion',     icon: '📊' },
    { id: 'punch'      as CommTab, label: 'Punch List',     icon: '📋' },
    { id: 'lessons'    as CommTab, label: 'Lessons Learned',icon: '💡' },
  ]

  return (
    <div role="main" aria-label="Commissioning">
      <div role="tablist" aria-label="Commissioning sections" style={{
        display: 'flex', gap: 2, marginBottom: 16,
        background: 'var(--jarvis-cd)', borderRadius: 6, padding: 2, border: '1px solid var(--jarvis-bd)',
      }}>
        {TABS.map(tab => (
          <button key={tab.id} role="tab" aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, padding: '6px 8px', borderRadius: 5, border: 'none',
              background: activeTab === tab.id ? 'color-mix(in srgb, var(--jarvis-ac) 18%, transparent)' : 'transparent',
              color: activeTab === tab.id ? 'var(--jarvis-ac)' : 'var(--jarvis-ts)',
              fontWeight: activeTab === tab.id ? 700 : 500, fontSize: 11, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>
            <span>{tab.icon}</span><span>{tab.label}</span>
            {tab.id === 'punch' && openPunch > 0 && (
              <span style={{ background: 'var(--jarvis-red)', color: '#fff', borderRadius: 99, padding: '1px 5px', fontSize: 9, fontWeight: 700 }}>
                {openPunch}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'workflow'   && <CxWorkflowView policy={policy} onNavigate={onNavigate} onAudit={onAudit} onToast={onToast} />}
      {activeTab === 'completion' && <CompletionTab closeouts={closeouts} />}
      {activeTab === 'punch'      && <PunchTab items={punchItems} onSelect={setSelectedPunch} />}
      {activeTab === 'lessons'    && <LessonsTab lessons={lessons} />}
    </div>
  )
}

export default CommissioningView
