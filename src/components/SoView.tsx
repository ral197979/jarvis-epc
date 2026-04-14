/**
 * JARVIS EPC — SoView · Schedule Overview  (v4.28.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Project schedule visualization: Gantt bar chart + milestone tracker.
 *
 * Panels:
 *   1. KPI strip — on-time / delayed / SPI / days to completion
 *   2. Timeline Gantt — SVG bar chart from project planned_start/finish dates
 *   3. Milestone table — with status and variance tracking
 *   4. Phase progress bars — per engineering/procurement/construction/commissioning
 */

import React, { useState, useMemo, useEffect } from 'react'
import { useBizStore, selectProjects } from '../modules/biz/store'
import { KpiCard } from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

interface Project {
  id: string; name?: string; code?: string
  planned_start?: string; planned_finish?: string
  actual_start?: string; actual_finish?: string
  progress_pct?: number; status?: string; current_phase?: string
  budget?: number; actual_cost?: number
}

interface Milestone {
  id: string; name: string
  planned_date: string; actual_date?: string
  status: 'pending' | 'complete' | 'overdue' | 'at_risk'
  phase: string; variance_days?: number
}

export interface SoViewProps {
  policy?:  Partial<PolicyConfig>
  onToast?: (msg: string, type: string) => void
}

const STATUS_COLOR: Record<string, { bar: string; text: string }> = {
  planning:    { bar: '#93C5FD', text: '#1D4ED8' },
  active:      { bar: '#6EE7B7', text: '#065F46' },
  on_hold:     { bar: '#FCD34D', text: '#92400E' },
  completed:   { bar: '#A7F3D0', text: '#065F46' },
  cancelled:   { bar: '#FCA5A5', text: '#991B1B' },
}

const PHASE_LABELS: Record<string, string> = {
  feed: 'FEED', design: 'Design', procurement: 'Procurement',
  construction: 'Construction', commissioning: 'Commissioning', closeout: 'Closeout',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

function addDays(date: string, days: number): string {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function today() { return new Date().toISOString().slice(0, 10) }

function milestoneVariance(m: Milestone): number {
  const ref = m.actual_date || today()
  return daysBetween(m.planned_date, ref)
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SoView({ policy: _p }: SoViewProps) {
  const storeProjects = useBizStore(selectProjects) as Project[]
  const [remoteProjects, setRemoteProjects] = useState<Project[]>([])
  const [selectedId, setSelectedId]         = useState<string>('')
  const [loading, setLoading]               = useState(false)

  // Milestones (for selected project from API)
  const [milestones, setMilestones] = useState<Milestone[]>([])

  // Load projects from API
  useEffect(() => {
    fetch('/api/v1/projects?limit=100&status=active')
      .then(r => r.ok ? r.json() : { projects: [] })
      .then(d => setRemoteProjects(d.projects ?? []))
      .catch(() => setRemoteProjects([]))
  }, [])

  // Load milestones for selected project (from contracts milestones array)
  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    fetch(`/api/v1/projects/${selectedId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const proj = d?.project
        // Derive milestones from project data if available
        if (proj?.milestones) setMilestones(proj.milestones)
        else setMilestones(generateDefaultMilestones(proj))
      })
      .catch(() => setMilestones([]))
      .finally(() => setLoading(false))
  }, [selectedId])

  // Combine remote + store projects
  const allProjects = useMemo(() => {
    const remoteIds = new Set(remoteProjects.map(p => p.id))
    return [...remoteProjects, ...storeProjects.filter(p => !remoteIds.has(p.id))]
  }, [remoteProjects, storeProjects])

  const selected = useMemo(() => allProjects.find(p => p.id === selectedId) ?? null, [allProjects, selectedId])

  // ── Gantt data ────────────────────────────────────────────────────────────

  const ganttProjects = useMemo(() => {
    const today_date = today()
    return allProjects
      .filter(p => p.planned_start && p.planned_finish)
      .map(p => {
        const totalDays   = daysBetween(p.planned_start!, p.planned_finish!)
        const elapsedDays = Math.max(0, daysBetween(p.planned_start!, today_date))
        const progress    = Math.min(100, p.progress_pct ?? Math.round(elapsedDays / totalDays * 100))
        const isOverdue   = today_date > p.planned_finish! && p.status !== 'completed'
        return { ...p, totalDays, elapsedDays, progress, isOverdue }
      })
      .sort((a, b) => (a.planned_start ?? '').localeCompare(b.planned_start ?? ''))
  }, [allProjects])

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const active    = ganttProjects.filter(p => p.status === 'active' || p.status === 'planning')
    const overdue   = active.filter(p => p.isOverdue).length
    const onTime    = active.length - overdue
    const avgProg   = active.length ? Math.round(active.reduce((s, p) => s + p.progress, 0) / active.length) : 0
    const daysLeft  = selected?.planned_finish ? Math.max(0, daysBetween(today(), selected.planned_finish)) : null
    return { total: allProjects.length, active: active.length, onTime, overdue, avgProg, daysLeft }
  }, [ganttProjects, allProjects, selected])

  // ── Timeline bounds for Gantt ─────────────────────────────────────────────

  const timelineBounds = useMemo(() => {
    const starts  = ganttProjects.map(p => p.planned_start!).sort()
    const finishes = ganttProjects.map(p => p.planned_finish!).sort()
    const start   = starts[0] ?? today()
    const finish  = finishes[finishes.length - 1] ?? addDays(today(), 365)
    const span    = Math.max(daysBetween(start, finish), 30)
    return { start, finish, span }
  }, [ganttProjects])

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div role="main" aria-label="Schedule Overview">

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 20 }}>
        <KpiCard label="Total Projects" value={kpis.total} />
        <KpiCard label="Active"         value={kpis.active}  color="var(--jarvis-blue)" />
        <KpiCard label="On Time"        value={kpis.onTime}  color="var(--jarvis-grn)" />
        <KpiCard label="Delayed"        value={kpis.overdue} color={kpis.overdue > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Avg Progress"   value={`${kpis.avgProg}%`} color="var(--jarvis-pur)" />
      </div>

      {/* Project selector + context */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <select className="jarvis-input" style={{ maxWidth: 360 }} value={selectedId}
          onChange={e => setSelectedId(e.target.value)}>
          <option value="">— All projects overview —</option>
          {allProjects.map(p => (
            <option key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ''}{p.name ?? p.id}</option>
          ))}
        </select>
        {loading && <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>Loading…</span>}
        {kpis.daysLeft !== null && (
          <span style={{ fontSize: 13, fontWeight: 600, color: kpis.daysLeft < 30 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)' }}>
            {kpis.daysLeft} days to planned completion
          </span>
        )}
      </div>

      {/* Gantt chart */}
      <div className="jarvis-card" style={{ padding: 16, marginBottom: 20, overflowX: 'auto' }}>
        <h4 className="jarvis-label" style={{ marginBottom: 14 }}>
          Project Timeline Gantt
          <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)', marginLeft: 8, fontWeight: 400 }}>
            {timelineBounds.start} → {timelineBounds.finish}
          </span>
        </h4>

        {ganttProjects.length === 0 ? (
          <div className="jarvis-empty">
            <span className="jarvis-empty-icon">📅</span>
            <span>No projects with planned dates. Add planned_start and planned_finish to projects to see the Gantt chart.</span>
          </div>
        ) : (
          <div style={{ minWidth: 600 }}>
            {/* Today line header */}
            <div style={{ position: 'relative', marginLeft: 200, height: 20, marginBottom: 4 }}>
              {(() => {
                const todayPct = Math.min(100, Math.max(0,
                  daysBetween(timelineBounds.start, today()) / timelineBounds.span * 100))
                return (
                  <div style={{
                    position: 'absolute', left: `${todayPct}%`,
                    top: 0, bottom: 0, width: 2, background: 'var(--jarvis-red)', opacity: 0.7,
                  }}>
                    <span style={{ position: 'absolute', top: 0, left: 4, fontSize: 9, color: 'var(--jarvis-red)', whiteSpace: 'nowrap', fontWeight: 700 }}>
                      TODAY
                    </span>
                  </div>
                )
              })()}
            </div>

            {/* Gantt rows */}
            {ganttProjects.map(p => {
              const barStart = Math.max(0, daysBetween(timelineBounds.start, p.planned_start!) / timelineBounds.span * 100)
              const barWidth = Math.min(100 - barStart, daysBetween(p.planned_start!, p.planned_finish!) / timelineBounds.span * 100)
              const progWidth = barWidth * p.progress / 100
              const colors    = STATUS_COLOR[p.status ?? 'planning'] ?? STATUS_COLOR.planning
              const isSelected = p.id === selectedId

              return (
                <div key={p.id}
                  onClick={() => setSelectedId(p.id === selectedId ? '' : p.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 8, cursor: 'pointer' }}
                >
                  <div style={{
                    width: 200, paddingRight: 12, fontSize: 11,
                    fontWeight: isSelected ? 700 : 400, color: 'var(--jarvis-tx)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {p.code && <span style={{ color: 'var(--jarvis-ts)', marginRight: 4 }}>[{p.code}]</span>}
                    {p.name ?? p.id}
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: 22, background: 'var(--jarvis-bd)', borderRadius: 3 }}>
                    <div style={{
                      position: 'absolute',
                      left:   `${barStart}%`,
                      width:  `${barWidth}%`,
                      height: '100%',
                      background: colors.bar,
                      borderRadius: 3,
                      overflow: 'hidden',
                      border: isSelected ? `2px solid ${colors.text}` : 'none',
                    }}>
                      {/* Progress overlay */}
                      <div style={{
                        position: 'absolute', left: 0, top: 0, height: '100%',
                        width: `${p.progress}%`, background: colors.text, opacity: 0.3,
                      }} />
                      <span style={{
                        position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)',
                        fontSize: 9, fontWeight: 700, color: colors.text, whiteSpace: 'nowrap',
                      }}>
                        {p.progress}%  {p.isOverdue ? '⚠ DELAYED' : ''}
                      </span>
                    </div>
                    {/* Today line */}
                    {(() => {
                      const todayPct = Math.min(100, Math.max(0,
                        daysBetween(timelineBounds.start, today()) / timelineBounds.span * 100))
                      return (
                        <div style={{
                          position: 'absolute', left: `${todayPct}%`,
                          top: -2, bottom: -2, width: 2, background: 'var(--jarvis-red)', opacity: 0.5,
                          pointerEvents: 'none',
                        }} />
                      )
                    })()}
                  </div>
                  <div style={{ width: 90, paddingLeft: 10, fontSize: 10, color: 'var(--jarvis-ts)', flexShrink: 0 }}>
                    {p.planned_finish}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Selected project detail */}
      {selected && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* Phase progress */}
          <div className="jarvis-card" style={{ padding: 16 }}>
            <h4 className="jarvis-label" style={{ marginBottom: 14 }}>Phase Progress</h4>
            {generatePhaseProgress(selected).map(phase => (
              <div key={phase.id} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{phase.label}</span>
                  <div style={{ display: 'flex', gap: 10, color: 'var(--jarvis-ts)' }}>
                    <span>{phase.progress}%</span>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 600,
                      background: phase.status === 'complete' ? '#D1FAE5' : phase.status === 'active' ? '#DBEAFE' : '#F3F4F6',
                      color: phase.status === 'complete' ? '#065F46' : phase.status === 'active' ? '#1D4ED8' : '#6B7280',
                    }}>
                      {phase.status}
                    </span>
                  </div>
                </div>
                <div style={{ height: 10, background: 'var(--jarvis-bd)', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{
                    width: `${phase.progress}%`, height: '100%', borderRadius: 5,
                    background: phase.status === 'complete' ? 'var(--jarvis-grn)' : 'var(--jarvis-ac)',
                    transition: 'width 0.5s',
                  }} />
                </div>
              </div>
            ))}
          </div>

          {/* Milestone table */}
          <div className="jarvis-card" style={{ padding: 16 }}>
            <h4 className="jarvis-label" style={{ marginBottom: 14 }}>Key Milestones</h4>
            {milestones.length === 0 ? (
              <div className="jarvis-empty"><span>No milestone data</span></div>
            ) : (
              <table className="jarvis-table">
                <thead><tr><th>Milestone</th><th>Planned</th><th>Variance</th><th>Status</th></tr></thead>
                <tbody>
                  {milestones.map(m => {
                    const variance = milestoneVariance(m)
                    return (
                      <tr key={m.id}>
                        <td style={{ fontSize: 12, fontWeight: 600 }}>{m.name}</td>
                        <td style={{ fontSize: 11 }}>{m.planned_date}</td>
                        <td style={{
                          fontSize: 11, fontWeight: 700,
                          color: variance > 0 ? 'var(--jarvis-red)' : variance < 0 ? 'var(--jarvis-grn)' : 'var(--jarvis-ts)',
                        }}>
                          {variance === 0 ? '—' : `${variance > 0 ? '+' : ''}${variance}d`}
                        </td>
                        <td>
                          <span style={{
                            fontSize: 10, padding: '2px 6px', borderRadius: 10, fontWeight: 600,
                            background: m.status === 'complete' ? '#D1FAE5' : m.status === 'overdue' ? '#FEE2E2' : m.status === 'at_risk' ? '#FEF3C7' : '#F3F4F6',
                            color: m.status === 'complete' ? '#065F46' : m.status === 'overdue' ? '#991B1B' : m.status === 'at_risk' ? '#92400E' : '#6B7280',
                          }}>
                            {m.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateDefaultMilestones(project: Project | null): Milestone[] {
  if (!project?.planned_start || !project?.planned_finish) return []
  const start = project.planned_start
  const total = daysBetween(start, project.planned_finish)
  const td    = today()
  return [
    { id: 'm1', name: 'Project Kickoff',      phase: 'feed',          planned_date: start,                    status: td >= start ? 'complete' : 'pending' },
    { id: 'm2', name: 'FEED Complete',        phase: 'design',         planned_date: addDays(start, Math.round(total*0.15)), status: 'pending' },
    { id: 'm3', name: 'Design Approval',      phase: 'design',         planned_date: addDays(start, Math.round(total*0.30)), status: 'pending' },
    { id: 'm4', name: 'Procurement Complete', phase: 'procurement',    planned_date: addDays(start, Math.round(total*0.55)), status: 'pending' },
    { id: 'm5', name: 'Construction Complete',phase: 'construction',   planned_date: addDays(start, Math.round(total*0.80)), status: 'pending' },
    { id: 'm6', name: 'Commissioning Start',  phase: 'commissioning',  planned_date: addDays(start, Math.round(total*0.82)), status: 'pending' },
    { id: 'm7', name: 'Mechanical Completion',phase: 'commissioning',  planned_date: addDays(start, Math.round(total*0.92)), status: 'pending' },
    { id: 'm8', name: 'Substantial Completion',phase: 'closeout',      planned_date: project.planned_finish,  status: 'pending' },
  ].map(m => ({
    ...m,
    status: (m.status === 'pending' && td > m.planned_date) ? 'overdue' : m.status,
    variance_days: td > m.planned_date && m.status !== 'complete' ? daysBetween(m.planned_date, td) : 0,
  }))
}

function generatePhaseProgress(project: Project) {
  const phases = ['feed','design','procurement','construction','commissioning','closeout']
  const currentIdx = project.current_phase ? phases.indexOf(project.current_phase) : -1
  const overallPct = project.progress_pct ?? 0

  return phases.map((id, i) => {
    let progress = 0
    let status   = 'upcoming'
    if (i < currentIdx) { progress = 100; status = 'complete' }
    else if (i === currentIdx) {
      // Distribute overall progress across phases
      progress = Math.min(100, Math.max(0, (overallPct - i * (100/phases.length)) / (100/phases.length) * 100))
      status = 'active'
    }
    return { id, label: PHASE_LABELS[id] ?? id, progress: Math.round(progress), status }
  })
}

export default SoView
