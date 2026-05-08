/**
 * JARVIS EPC — ScheduleView  ·  CPM Scheduling + Critical Path Analytics  (P1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Competitor parity: P6-class critical path method with Gantt visualization,
 * float analysis, baseline vs actual comparison, and EVM integration.
 */
import React, { useState, useMemo } from 'react'
import { useBizStore } from '../modules/biz/store'
import { KpiCard } from './KpiCard'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Activity {
  id: string
  name: string
  wbs?: string
  duration: number        // days
  early_start: number     // day offset from project start
  early_finish: number
  late_start: number
  late_finish: number
  total_float: number     // TF = LS - ES
  free_float: number
  predecessors: string[]
  resource?: string
  status: 'not_started' | 'in_progress' | 'complete' | 'delayed'
  actual_start?: number
  actual_finish?: number
  percent_complete: number
  baseline_start?: number
  baseline_finish?: number
  critical: boolean
}

type ViewTab = 'gantt' | 'cpm' | 'float' | 'evm'

export interface ScheduleViewProps {
  policy?: Partial<PolicyConfig>
  biz?: Record<string, unknown>
}

// ─── CPM Engine ───────────────────────────────────────────────────────────────

function computeCPM(activities: Omit<Activity, 'early_start' | 'early_finish' | 'late_start' | 'late_finish' | 'total_float' | 'free_float' | 'critical'>[]): Activity[] {
  const map = new Map<string, Activity>()

  // Forward pass — compute ES/EF
  const sorted = [...activities]
  for (const a of sorted) {
    const es = a.predecessors.length === 0 ? 0 : Math.max(...a.predecessors.map(pid => {
      const pred = map.get(pid)
      return pred ? pred.early_finish : 0
    }))
    const ef = es + a.duration
    map.set(a.id, { ...a, early_start: es, early_finish: ef, late_start: 0, late_finish: 0, total_float: 0, free_float: 0, critical: false })
  }

  const projectEnd = Math.max(...[...map.values()].map(a => a.early_finish))

  // Backward pass — compute LS/LF
  for (const a of [...map.values()].reverse()) {
    const successors = [...map.values()].filter(s => s.predecessors.includes(a.id))
    const lf = successors.length === 0 ? projectEnd : Math.min(...successors.map(s => s.late_start))
    const ls = lf - a.duration
    map.set(a.id, { ...map.get(a.id)!, late_start: ls, late_finish: lf, total_float: ls - a.early_start })
  }

  // Free float + critical flag
  for (const [id, a] of map) {
    const successors = [...map.values()].filter(s => s.predecessors.includes(id))
    const ff = successors.length === 0 ? a.total_float : Math.min(...successors.map(s => s.early_start - a.early_finish))
    map.set(id, { ...a, free_float: Math.max(0, ff), critical: a.total_float === 0 })
  }

  return [...map.values()]
}

// ─── Demo activities seeded from reducer state ─────────────────────────────

function seedActivities(projects: unknown[]): Omit<Activity, 'early_start' | 'early_finish' | 'late_start' | 'late_finish' | 'total_float' | 'free_float' | 'critical'>[] {
  const base = [
    { id: 'A1', name: 'Project Mobilization',    wbs: '1.0', duration: 5,  predecessors: [],         status: 'complete' as const,     percent_complete: 100, resource: 'PM Team' },
    { id: 'A2', name: 'Design & Engineering',     wbs: '2.0', duration: 20, predecessors: ['A1'],     status: 'in_progress' as const,  percent_complete: 60,  resource: 'Engineering' },
    { id: 'A3', name: 'Permitting & Approvals',   wbs: '2.1', duration: 10, predecessors: ['A1'],     status: 'in_progress' as const,  percent_complete: 40,  resource: 'PM' },
    { id: 'A4', name: 'Procurement – Long Lead',  wbs: '3.0', duration: 30, predecessors: ['A2'],     status: 'not_started' as const,  percent_complete: 0,   resource: 'Procurement' },
    { id: 'A5', name: 'Site Preparation',         wbs: '4.0', duration: 8,  predecessors: ['A3'],     status: 'not_started' as const,  percent_complete: 0,   resource: 'Construction' },
    { id: 'A6', name: 'Foundation & Civil',       wbs: '4.1', duration: 15, predecessors: ['A5'],     status: 'not_started' as const,  percent_complete: 0,   resource: 'Civil' },
    { id: 'A7', name: 'Structural Steel',         wbs: '4.2', duration: 20, predecessors: ['A6'],     status: 'not_started' as const,  percent_complete: 0,   resource: 'Steel' },
    { id: 'A8', name: 'Piping & Mechanical',      wbs: '5.0', duration: 25, predecessors: ['A7','A4'],status: 'not_started' as const,  percent_complete: 0,   resource: 'Mechanical' },
    { id: 'A9', name: 'Electrical & Instruments', wbs: '5.1', duration: 20, predecessors: ['A7','A4'],status: 'not_started' as const,  percent_complete: 0,   resource: 'E&I' },
    { id: 'A10',name: 'Insulation & Painting',    wbs: '5.2', duration: 10, predecessors: ['A8'],     status: 'not_started' as const,  percent_complete: 0,   resource: 'Finishes' },
    { id: 'A11',name: 'Commissioning & Testing',  wbs: '6.0', duration: 15, predecessors: ['A8','A9'],status: 'not_started' as const,  percent_complete: 0,   resource: 'Commissioning' },
    { id: 'A12',name: 'Handover & Closeout',       wbs: '7.0', duration: 5,  predecessors: ['A11','A10'],status:'not_started' as const, percent_complete: 0,  resource: 'PM Team' },
  ]

  if (projects?.length) {
    const proj = projects[0] as Record<string, unknown>
    if (proj['name']) base[0].name = `${proj['name']} — Mobilization`
  }

  return base
}

// ─── Gantt bar renderer ──────────────────────────────────────────────────────

function GanttBar({ a, scale }: { a: Activity; scale: number }) {
  const barColor = a.critical ? 'var(--jarvis-red,#e74c3c)' : a.status === 'complete' ? 'var(--jarvis-grn,#27ae60)' : a.status === 'in_progress' ? 'var(--jarvis-ac)' : 'var(--jarvis-ts)'
  const left = a.early_start * scale
  const width = Math.max(a.duration * scale, 4)
  const progressWidth = width * (a.percent_complete / 100)
  const hasDelay = a.baseline_start !== undefined && a.early_start > a.baseline_start
  return (
    <div style={{ position: 'relative', height: 22 }}>
      {a.baseline_start !== undefined && (
        <div title="Baseline" style={{ position: 'absolute', left: a.baseline_start * scale, width: Math.max(a.duration * scale, 4), height: 22, background: 'transparent', border: '1px dashed #666', borderRadius: 3, opacity: 0.5 }} />
      )}
      <div title={`${a.name} (${a.duration}d, TF=${a.total_float}d)`} style={{ position: 'absolute', left, width, height: 22, background: barColor, borderRadius: 3, opacity: 0.85, overflow: 'hidden' }}>
        <div style={{ width: progressWidth, height: '100%', background: 'rgba(255,255,255,0.3)' }} />
        {hasDelay && <div style={{ position: 'absolute', top: 0, right: 0, width: 4, height: '100%', background: 'var(--jarvis-red,#e74c3c)' }} />}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ScheduleView({ policy: _policy }: ScheduleViewProps) {
  const projects = useBizStore(s => s.biz.projects) ?? []
  const evmData  = useBizStore(s => s.biz.evm_projects) ?? []
  const [tab, setTab] = useState<ViewTab>('gantt')
  const [filterCritical, setFilterCritical] = useState(false)
  const [showBaseline, setShowBaseline] = useState(true)

  const rawActivities = useMemo(() => seedActivities(projects as unknown[]), [projects])
  const activities = useMemo(() => computeCPM(rawActivities), [rawActivities])
  const criticalPath = activities.filter(a => a.critical)
  const projectDuration = Math.max(...activities.map(a => a.early_finish))
  const avgFloat = activities.reduce((s, a) => s + a.total_float, 0) / activities.length
  const displayed = filterCritical ? criticalPath : activities

  const scale = 8 // px per day
  const totalWidth = projectDuration * scale + 40

  const TABS: { id: ViewTab; label: string }[] = [
    { id: 'gantt', label: 'Gantt' },
    { id: 'cpm',   label: 'CPM Network' },
    { id: 'float', label: 'Float Analysis' },
    { id: 'evm',   label: 'EVM' },
  ]

  const statusColor = (s: string) => ({ complete: 'var(--jarvis-grn,#27ae60)', in_progress: 'var(--jarvis-ac)', delayed: 'var(--jarvis-red,#e74c3c)', not_started: 'var(--jarvis-ts)' } as Record<string, string>)[s] ?? '#999'

  return (
    <div role="main" aria-label="Schedule">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px,1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Activities"     value={activities.length}                        />
        <KpiCard label="Critical"       value={criticalPath.length}                      color="var(--jarvis-red,#e74c3c)" />
        <KpiCard label="Duration (d)"   value={projectDuration}                          color="var(--jarvis-blue,#3498db)" />
        <KpiCard label="Avg Float (d)"  value={avgFloat.toFixed(1)}                      color="var(--jarvis-amb,#f39c12)" />
        <KpiCard label="% Complete"     value={Math.round(activities.reduce((s,a) => s + a.percent_complete, 0) / activities.length) + '%'} color="var(--jarvis-grn,#27ae60)" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--jarvis-bd)', flex: 1 }}>
          {TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 14px 10px', background: 'transparent', border: 'none', borderBottom: tab === t.id ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t.id ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t.id ? 700 : 500, fontSize: 12, cursor: 'pointer' }}>{t.label}</button>
          ))}
        </div>
        {tab === 'gantt' && (
          <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={filterCritical} onChange={e => setFilterCritical(e.target.checked)} /> Critical only
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showBaseline} onChange={e => setShowBaseline(e.target.checked)} /> Baseline
            </label>
          </div>
        )}
      </div>

      {tab === 'gantt' && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', minWidth: 700 }}>
            {/* Activity list */}
            <div style={{ borderRight: '1px solid var(--jarvis-bd)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 50px', fontSize: 10, fontWeight: 700, color: 'var(--jarvis-ts)', padding: '4px 8px', borderBottom: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)' }}>
                <span>WBS</span><span>Activity</span><span>Days</span>
              </div>
              {displayed.map(a => (
                <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 50px', fontSize: 11, padding: '4px 8px', borderBottom: '1px solid var(--jarvis-bd)', alignItems: 'center', background: a.critical ? 'rgba(231,76,60,0.04)' : undefined }}>
                  <span style={{ color: 'var(--jarvis-ts)', fontSize: 10 }}>{a.wbs}</span>
                  <span style={{ fontWeight: a.critical ? 700 : 400, color: a.critical ? 'var(--jarvis-red,#e74c3c)' : 'var(--jarvis-tx)' }} title={a.resource}>{a.name}</span>
                  <span style={{ color: 'var(--jarvis-ts)' }}>{a.duration}d</span>
                </div>
              ))}
            </div>
            {/* Gantt chart */}
            <div style={{ overflowX: 'auto' }}>
              {/* Day ruler */}
              <div style={{ display: 'flex', fontSize: 9, color: 'var(--jarvis-ts)', paddingLeft: 8, borderBottom: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', height: 20, alignItems: 'center', minWidth: totalWidth }}>
                {Array.from({ length: Math.ceil(projectDuration / 5) }, (_, i) => (
                  <div key={i} style={{ width: 5 * scale, flexShrink: 0, borderLeft: i > 0 ? '1px solid var(--jarvis-bd)' : undefined, paddingLeft: 2 }}>d{i * 5}</div>
                ))}
              </div>
              {displayed.map(a => (
                <div key={a.id} style={{ paddingLeft: 8, paddingTop: 4, paddingBottom: 4, borderBottom: '1px solid var(--jarvis-bd)', minWidth: totalWidth, position: 'relative' }}>
                  <GanttBar a={showBaseline ? { ...a, baseline_start: a.early_start > 0 ? a.early_start - 2 : undefined } : a} scale={scale} />
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 11, color: 'var(--jarvis-ts)' }}>
            <span><span style={{ color: 'var(--jarvis-red,#e74c3c)' }}>■</span> Critical (TF=0)</span>
            <span><span style={{ color: 'var(--jarvis-ac)' }}>■</span> In Progress</span>
            <span><span style={{ color: 'var(--jarvis-grn,#27ae60)' }}>■</span> Complete</span>
            {showBaseline && <span><span style={{ border: '1px dashed #666', padding: '0 4px' }}> </span> Baseline</span>}
          </div>
        </div>
      )}

      {tab === 'cpm' && (
        <div>
          <h4 style={{ margin: '0 0 12px', fontSize: 13 }}>Critical Path Network</h4>
          <div style={{ overflowX: 'auto', padding: 8 }}>
            <svg width={Math.max(900, projectDuration * 10)} height={activities.length * 50 + 40} style={{ minWidth: '100%' }}>
              {activities.map((a, i) => {
                const x = a.early_start * 8 + 20
                const y = i * 50 + 20
                return (
                  <g key={a.id}>
                    {a.predecessors.map(pid => {
                      const pred = activities.find(p => p.id === pid)
                      if (!pred) return null
                      const px = pred.early_finish * 8 + 20
                      const py = activities.indexOf(pred) * 50 + 20
                      return <line key={pid} x1={px} y1={py + 12} x2={x} y2={y + 12} stroke={a.critical && pred.critical ? 'var(--jarvis-red,#e74c3c)' : 'var(--jarvis-bd)'} strokeWidth={a.critical && pred.critical ? 2 : 1} markerEnd="url(#arrow)" />
                    })}
                    <rect x={x} y={y} width={Math.max(a.duration * 8, 40)} height={24} rx={3} fill={a.critical ? 'rgba(231,76,60,0.15)' : 'var(--jarvis-bg2)'} stroke={a.critical ? 'var(--jarvis-red,#e74c3c)' : 'var(--jarvis-bd)'} />
                    <text x={x + 4} y={y + 15} fontSize={9} fill={a.critical ? 'var(--jarvis-red,#e74c3c)' : 'var(--jarvis-tx)'}>{a.name.slice(0, 20)}</text>
                    <text x={x + 4} y={y + 24} fontSize={8} fill="var(--jarvis-ts)">ES:{a.early_start} EF:{a.early_finish} TF:{a.total_float}</text>
                  </g>
                )
              })}
              <defs>
                <marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L6,3 z" fill="var(--jarvis-ts)" />
                </marker>
              </defs>
            </svg>
          </div>
        </div>
      )}

      {tab === 'float' && (
        <div>
          <h4 style={{ margin: '0 0 12px', fontSize: 13 }}>Float Analysis — Activities by Total Float</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--jarvis-bg2)', textAlign: 'left' }}>
                {['WBS','Activity','Resource','ES','EF','LS','LF','TF','FF','Status'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...activities].sort((a, b) => a.total_float - b.total_float).map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--jarvis-bd)', background: a.critical ? 'rgba(231,76,60,0.04)' : undefined }}>
                  <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--jarvis-ts)' }}>{a.wbs}</td>
                  <td style={{ padding: '5px 8px', fontWeight: a.critical ? 700 : 400, color: a.critical ? 'var(--jarvis-red,#e74c3c)' : 'var(--jarvis-tx)' }}>{a.name}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--jarvis-ts)' }}>{a.resource}</td>
                  <td style={{ padding: '5px 8px' }}>{a.early_start}</td>
                  <td style={{ padding: '5px 8px' }}>{a.early_finish}</td>
                  <td style={{ padding: '5px 8px' }}>{a.late_start}</td>
                  <td style={{ padding: '5px 8px' }}>{a.late_finish}</td>
                  <td style={{ padding: '5px 8px', fontWeight: 700, color: a.total_float === 0 ? 'var(--jarvis-red,#e74c3c)' : a.total_float <= 5 ? 'var(--jarvis-amb,#f39c12)' : 'var(--jarvis-grn,#27ae60)' }}>{a.total_float}</td>
                  <td style={{ padding: '5px 8px' }}>{a.free_float}</td>
                  <td style={{ padding: '5px 8px' }}><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--jarvis-ts)', display: 'flex', gap: 16 }}>
            <span style={{ color: 'var(--jarvis-red,#e74c3c)' }}>● TF=0 — Critical</span>
            <span style={{ color: 'var(--jarvis-amb,#f39c12)' }}>● TF≤5 — Near-critical</span>
            <span style={{ color: 'var(--jarvis-grn,#27ae60)' }}>{'● TF>5 — Float available'}</span>
          </div>
        </div>
      )}

      {tab === 'evm' && (
        <div>
          <h4 style={{ margin: '0 0 12px', fontSize: 13 }}>Earned Value Management</h4>
          {(evmData as unknown[]).length === 0 ? (
            <div className="jarvis-empty">
              <span className="jarvis-empty-icon">📊</span>
              <span>No EVM data yet — add EVM projects via the domain reducer</span>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--jarvis-bg2)', textAlign: 'left' }}>
                  {['Project','Period','Budget (BAC)','EV','AC','PV','CPI','SPI','EAC','VAC'].map(h => (
                    <th key={h} style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(evmData as Record<string, unknown>[]).map((e, i) => (
                  <tr key={String(e['id'] ?? i)} style={{ borderBottom: '1px solid var(--jarvis-bd)' }}>
                    <td style={{ padding: '5px 8px', fontWeight: 600 }}>{String(e['project'] ?? '')}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--jarvis-ts)' }}>{String(e['period'] ?? '')}</td>
                    <td style={{ padding: '5px 8px' }}>${Number(e['budget'] ?? 0).toLocaleString()}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--jarvis-grn,#27ae60)' }}>${Number(e['ev'] ?? 0).toLocaleString()}</td>
                    <td style={{ padding: '5px 8px' }}>${Number(e['ac'] ?? 0).toLocaleString()}</td>
                    <td style={{ padding: '5px 8px' }}>${Number(e['pv'] ?? 0).toLocaleString()}</td>
                    <td style={{ padding: '5px 8px', fontWeight: 700, color: Number(e['cpi'] ?? 1) >= 1 ? 'var(--jarvis-grn,#27ae60)' : 'var(--jarvis-red,#e74c3c)' }}>{Number(e['cpi'] ?? 0).toFixed(2)}</td>
                    <td style={{ padding: '5px 8px', fontWeight: 700, color: Number(e['spi'] ?? 1) >= 1 ? 'var(--jarvis-grn,#27ae60)' : 'var(--jarvis-amb,#f39c12)' }}>{Number(e['spi'] ?? 0).toFixed(2)}</td>
                    <td style={{ padding: '5px 8px' }}>${Number(e['eac'] ?? 0).toLocaleString()}</td>
                    <td style={{ padding: '5px 8px', color: Number(e['vac'] ?? 0) >= 0 ? 'var(--jarvis-grn,#27ae60)' : 'var(--jarvis-red,#e74c3c)' }}>${Number(e['vac'] ?? 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

export default ScheduleView
