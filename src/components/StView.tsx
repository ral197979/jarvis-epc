/**
 * JARVIS EPC — StView · Schedule Tracking  (v4.28.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Tracks schedule performance metrics across active projects.
 * Complements SoView (visual Gantt) with numeric tracking and variance analysis.
 *
 * Panels:
 *   1. SPI / CPI dashboard (from biz store EVM data)
 *   2. Project schedule variance table (planned vs actual dates)
 *   3. Critical path activities (overdue + upcoming within 30 days)
 *   4. Manpower tracking (planned vs actual hours by discipline)
 */

import React, { useState, useMemo, useEffect } from 'react'
import { useBizStore, selectProjects, selectEVMProjects } from '../modules/biz/store'
import { KpiCard } from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

interface EVMRecord {
  id?: string; project?: string; spi?: number; cpi?: number
  bac?: number; ac?: number; ev?: number; pv?: number
  eac?: number; vac?: number; date?: string
}

interface ScheduleRow {
  id:             string
  name?:          string
  code?:          string
  status?:        string
  planned_start?: string
  planned_finish?:string
  actual_start?:  string
  actual_finish?: string
  progress_pct?:  number
  variance_days:  number
  on_time:        boolean
}

export interface StViewProps {
  policy?:  Partial<PolicyConfig>
  onToast?: (msg: string, type: string) => void
}

function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

function today() { return new Date().toISOString().slice(0, 10) }

function spiColor(spi: number): string {
  if (spi >= 0.95) return 'var(--jarvis-grn)'
  if (spi >= 0.80) return 'var(--jarvis-amb)'
  return 'var(--jarvis-red)'
}

function varColor(days: number): string {
  if (days <= 0) return 'var(--jarvis-grn)'
  if (days <= 14) return 'var(--jarvis-amb)'
  return 'var(--jarvis-red)'
}

export function StView({ policy: _p }: StViewProps) {
  const storeProjects = useBizStore(selectProjects) as ScheduleRow[]
  const evmData       = useBizStore(selectEVMProjects) as EVMRecord[]
  const [remoteProjects, setRemoteProjects] = useState<ScheduleRow[]>([])
  const [loading, setLoading]               = useState(false)
  const [sortBy, setSortBy]                 = useState<'variance' | 'progress' | 'name'>('variance')

  // Load active projects from API
  useEffect(() => {
    setLoading(true)
    fetch('/api/v1/projects?limit=100')
      .then(r => r.ok ? r.json() : { projects: [] })
      .then(d => {
        const rows = (d.projects ?? []).map((p: ScheduleRow) => ({
          ...p,
          variance_days: p.planned_finish
            ? daysBetween(p.planned_finish, today())
            : 0,
          on_time: p.planned_finish ? today() <= p.planned_finish : true,
        }))
        setRemoteProjects(rows)
      })
      .catch(() => setRemoteProjects([]))
      .finally(() => setLoading(false))
  }, [])

  const allProjects = useMemo(() => {
    const remoteIds = new Set(remoteProjects.map(p => p.id))
    const storeRows = storeProjects
      .filter(p => !remoteIds.has(p.id))
      .map(p => ({
        ...p,
        variance_days: (p as ScheduleRow).planned_finish ? daysBetween((p as ScheduleRow).planned_finish!, today()) : 0,
        on_time: (p as ScheduleRow).planned_finish ? today() <= (p as ScheduleRow).planned_finish! : true,
      }))
    return [...remoteProjects, ...storeRows]
  }, [remoteProjects, storeProjects])

  // Sort
  const sorted = useMemo(() => {
    const rows = [...allProjects]
    if (sortBy === 'variance') rows.sort((a, b) => b.variance_days - a.variance_days)
    else if (sortBy === 'progress') rows.sort((a, b) => (a.progress_pct ?? 0) - (b.progress_pct ?? 0))
    else rows.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    return rows
  }, [allProjects, sortBy])

  // Critical path: overdue or finishing within 30 days
  const critical = useMemo(() => sorted.filter(p =>
    p.planned_finish &&
    daysBetween(today(), p.planned_finish) <= 30 &&
    p.status !== 'completed' && p.status !== 'cancelled'
  ), [sorted])

  // KPIs
  const kpis = useMemo(() => {
    const active = allProjects.filter(p => p.status !== 'completed' && p.status !== 'cancelled')
    const delayed = active.filter(p => !p.on_time).length
    const onTime  = active.length - delayed

    // EVM aggregates
    const evms = evmData.filter(e => e.spi !== undefined)
    const avgSPI = evms.length ? evms.reduce((s, e) => s + (e.spi ?? 1), 0) / evms.length : null
    const avgCPI = evms.length ? evms.reduce((s, e) => s + (e.cpi ?? 1), 0) / evms.length : null

    return { active: active.length, onTime, delayed, avgSPI, avgCPI }
  }, [allProjects, evmData])

  return (
    <div role="main" aria-label="Schedule Tracking">

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 24 }}>
        <KpiCard label="Active Projects" value={kpis.active} />
        <KpiCard label="On Schedule"     value={kpis.onTime}  color="var(--jarvis-grn)" />
        <KpiCard label="Delayed"         value={kpis.delayed} color={kpis.delayed > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Avg SPI"         value={kpis.avgSPI !== null ? kpis.avgSPI.toFixed(2) : '—'} color={kpis.avgSPI !== null ? spiColor(kpis.avgSPI) : undefined} />
        <KpiCard label="Avg CPI"         value={kpis.avgCPI !== null ? kpis.avgCPI.toFixed(2) : '—'} color={kpis.avgCPI !== null ? spiColor(kpis.avgCPI) : undefined} />
      </div>

      {/* Critical path alert */}
      {critical.length > 0 && (
        <div style={{ padding: 14, background: '#FEF3C7', borderRadius: 8, marginBottom: 20, border: '1px solid #FCD34D' }}>
          <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#92400E' }}>
            ⚠ {critical.length} project{critical.length !== 1 ? 's' : ''} finishing within 30 days
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {critical.map(p => {
              const days = daysBetween(today(), p.planned_finish!)
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{p.code ? `[${p.code}] ` : ''}{p.name ?? p.id}</span>
                  <span style={{ color: days < 0 ? 'var(--jarvis-red)' : 'var(--jarvis-amb)', fontWeight: 700 }}>
                    {days < 0 ? `${Math.abs(days)}d OVERDUE` : `${days}d remaining`}
                  </span>
                  <span style={{ color: 'var(--jarvis-ts)' }}>{p.progress_pct ?? 0}% complete</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Schedule variance table */}
      <div className="jarvis-card" style={{ padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h4 className="jarvis-label" style={{ margin: 0 }}>Schedule Variance by Project</h4>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
            {loading && <span style={{ color: 'var(--jarvis-ts)' }}>Loading…</span>}
            <label className="jarvis-small">Sort:</label>
            <select className="jarvis-input" style={{ width: 120, padding: '3px 8px', fontSize: 12 }}
              value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
              <option value="variance">Most delayed</option>
              <option value="progress">Least progress</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="jarvis-empty">
            <span className="jarvis-empty-icon">📅</span>
            <span>No project schedule data available</span>
          </div>
        ) : (
          <div className="jarvis-scroll-y jarvis-max-h-lg">
            <table className="jarvis-table" aria-label="Schedule variance">
              <thead>
                <tr>
                  <th>Project</th><th>Status</th><th>Planned Start</th>
                  <th>Planned Finish</th><th>Progress</th><th>Variance</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(p => {
                  const isDelayed  = !p.on_time && p.planned_finish && p.status !== 'completed'
                  const varDays    = p.planned_finish ? daysBetween(p.planned_finish, today()) : 0
                  return (
                    <tr key={p.id} style={{ background: isDelayed ? 'rgba(254,226,226,0.3)' : undefined }}>
                      <td style={{ fontWeight: 600 }}>
                        {p.code && <span style={{ color: 'var(--jarvis-ts)', marginRight: 6, fontSize: 11 }}>[{p.code}]</span>}
                        {p.name ?? p.id}
                      </td>
                      <td>
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                          background: p.status === 'active' ? '#DBEAFE' : p.status === 'completed' ? '#D1FAE5' : '#F3F4F6',
                          color: p.status === 'active' ? '#1D4ED8' : p.status === 'completed' ? '#065F46' : '#6B7280',
                        }}>
                          {p.status ?? 'planning'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12 }}>{p.planned_start ?? '—'}</td>
                      <td style={{ fontSize: 12 }}>{p.planned_finish ?? '—'}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 60, height: 8, background: 'var(--jarvis-bd)', borderRadius: 4 }}>
                            <div style={{
                              width: `${p.progress_pct ?? 0}%`, height: '100%', borderRadius: 4,
                              background: isDelayed ? 'var(--jarvis-red)' : 'var(--jarvis-grn)',
                            }} />
                          </div>
                          <span style={{ fontSize: 12 }}>{p.progress_pct ?? 0}%</span>
                        </div>
                      </td>
                      <td style={{ fontWeight: 700, color: varDays > 0 ? varColor(varDays) : 'var(--jarvis-grn)', fontSize: 12 }}>
                        {p.planned_finish
                          ? varDays > 0 ? `+${varDays}d late` : varDays < 0 ? `${Math.abs(varDays)}d early` : 'On track'
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* EVM performance table */}
      {evmData.length > 0 && (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 14 }}>EVM Performance Summary</h4>
          <table className="jarvis-table" aria-label="EVM performance">
            <thead>
              <tr><th>Project</th><th>BAC</th><th>AC</th><th>EV</th><th>PV</th><th>SPI</th><th>CPI</th><th>EAC</th><th>VAC</th></tr>
            </thead>
            <tbody>
              {evmData.map((e, i) => (
                <tr key={e.id ?? i}>
                  <td style={{ fontWeight: 600, fontSize: 12 }}>{e.project ?? '—'}</td>
                  {(['bac','ac','ev','pv','eac','vac'] as const).map(k => (
                    <td key={k} style={{ fontSize: 12 }}>
                      {e[k] !== undefined ? `$${Number(e[k]).toLocaleString()}` : '—'}
                    </td>
                  ))}
                  <td style={{ fontWeight: 700, fontSize: 12, color: e.spi !== undefined ? spiColor(e.spi) : undefined }}>
                    {e.spi?.toFixed(2) ?? '—'}
                  </td>
                  <td style={{ fontWeight: 700, fontSize: 12, color: e.cpi !== undefined ? spiColor(e.cpi) : undefined }}>
                    {e.cpi?.toFixed(2) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default StView
