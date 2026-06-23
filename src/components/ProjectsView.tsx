/**
 * Denver Engineering — ProjectsView Component
 * ─────────────────────────────────────
 * Phase 9: Extraction of JarvisCore `sn()` (projects list) and
 * the project workspace panels embedded in `un()`.
 *
 * Provides the full project management experience:
 *   - Projects list table (sourced from contracts collection)
 *   - Per-project KPI row (milestones progress, EVM, engineering, installation)
 *   - EVM performance metrics with CPI/SPI/VAC analysis
 *   - Action items linked to the project
 *   - Activity log for the project context
 *
 * Zero dependency on JarvisCore globals.
 * All state from Zustand selectors, all mutations through createDispatch.
 */

import React, { useState, useMemo, useCallback } from 'react'
import {
  useBizStore,
  selectContracts,
  selectActionItems,
  selectEVMProjects,
} from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Project {
  id:        string
  project:   string
  client?:   string
  value?:    number
  type?:     string
  status?:   string
  progress?: number
  start?:    string
  end?:      string
  [key: string]: unknown
}

interface EVMData {
  project: string
  period:  string
  budget:  number
  ev:      number
  ac:      number
  pv:      number
  cpi:     number
  spi:     number
  eac:     number
  vac:     number
  cv:      number
  sv:      number
  [key: string]: unknown
}

interface ActionItem {
  id:       string
  subject:  string
  project:  string
  status:   string
  priority: string
  assigned: string
  due:      string
  [key: string]: unknown
}

export interface ProjectsViewProps {
  policy:      PolicyConfig
  onNavigate?: (tab: string) => void
  onAudit?:    (entry: unknown) => void
  onToast?:    (msg: string, type: string) => void
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function cpiColor(cpi: number): string {
  if (cpi >= 1.05) return 'var(--jarvis-grn)'
  if (cpi >= 0.95) return 'var(--jarvis-amb)'
  return 'var(--jarvis-red)'
}

function progressColor(pct: number): string {
  if (pct >= 80) return 'var(--jarvis-grn)'
  if (pct >= 40) return 'var(--jarvis-blue)'
  return 'var(--jarvis-amb)'
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
function ProgressBar({ pct, color, height = 6 }: { pct: number; color?: string; height?: number }) {
  const c = color ?? progressColor(pct)
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${pct}% complete`}
      style={{ background: 'var(--jarvis-bl)', borderRadius: height, height, overflow: 'hidden' }}
    >
      <div style={{
        width:        `${Math.min(100, pct)}%`,
        height:       '100%',
        background:   c,
        borderRadius: height,
        minWidth:     pct > 0 ? 3 : 0,
        transition:   'width 0.4s ease',
      }} />
    </div>
  )
}

// ─── EVM panel ────────────────────────────────────────────────────────────────
function EVMPanel({ evm }: { evm: EVMData }) {
  const rows = [
    ['Budget (BAC)',     fmtCurrency(evm.budget),            'var(--jarvis-ts)'],
    ['Earned Value',    fmtCurrency(evm.ev),                 'var(--jarvis-blue)'],
    ['Actual Cost',     fmtCurrency(evm.ac),                 'var(--jarvis-amb)'],
    ['Planned Value',   fmtCurrency(evm.pv),                 'var(--jarvis-ts)'],
    ['EAC',             fmtCurrency(evm.eac),                evm.eac > evm.budget ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'],
    ['VAC',             fmtCurrency(evm.vac),                evm.vac >= 0 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)'],
    ['Cost Variance',   fmtCurrency(evm.cv),                 evm.cv >= 0 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)'],
    ['Schedule Var.',   fmtCurrency(evm.sv),                 evm.sv >= 0 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)'],
  ]

  return (
    <div className="jarvis-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 className="jarvis-label">EVM Performance — {evm.period}</h4>
        <div style={{ display: 'flex', gap: 12, fontSize: 11, fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700 }}>
          <span style={{ color: cpiColor(evm.cpi) }}>CPI {evm.cpi.toFixed(2)}</span>
          <span style={{ color: cpiColor(evm.spi) }}>SPI {evm.spi.toFixed(2)}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
        {rows.slice(0, 4).map(([label, value, color]) => (
          <div key={label as string} className="jarvis-card" style={{ padding: '8px 10px', background: 'var(--jarvis-bl)' }}>
            <div className="jarvis-muted" style={{ marginBottom: 2, fontSize: 9 }}>{label}</div>
            <div style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, color: color as string, fontSize: 12 }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {rows.slice(4).map(([label, value, color]) => (
          <div key={label as string} className="jarvis-card" style={{ padding: '8px 10px', background: 'var(--jarvis-bl)' }}>
            <div className="jarvis-muted" style={{ marginBottom: 2, fontSize: 9 }}>{label}</div>
            <div style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, color: color as string, fontSize: 12 }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Action items panel ───────────────────────────────────────────────────────
function ActionItemsPanel({ actions: items, projectId, canWrite, onAdd }: {
  actions:   ActionItem[]
  projectId: string
  canWrite:  boolean
  onAdd?:    () => void
}) {
  const projectActions = items.filter(a =>
    a.project === projectId || a.project?.includes(projectId)
  )
  const openActions = projectActions.filter(a => a.status !== 'closed' && a.status !== 'complete')

  const priorityColor: Record<string, string> = {
    high: 'var(--jarvis-red)',
    med:  'var(--jarvis-amb)',
    low:  'var(--jarvis-grn)',
  }

  return (
    <div className="jarvis-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 className="jarvis-label">Action Items ({openActions.length} open)</h4>
        {canWrite && (
          <button className="jarvis-btn jarvis-btn-primary jarvis-btn-sm" onClick={() => onAdd?.()}>
            + Add
          </button>
        )}
      </div>
      {projectActions.length === 0 ? (
        <div className="jarvis-empty" style={{ padding: '12px 0' }}>
          <span className="jarvis-muted">No action items for this project</span>
        </div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-sm">
          {projectActions.slice(0, 10).map(item => (
            <div key={item.id} className="jarvis-row" aria-label={`Action item: ${item.subject}`}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span
                  className="jarvis-body jarvis-truncate"
                  style={{
                    fontWeight: 600,
                    display: 'block',
                    textDecoration: item.status === 'closed' ? 'line-through' : 'none',
                    opacity:        item.status === 'closed' ? 0.5 : 1,
                  }}
                >
                  {item.subject}
                </span>
                <span className="jarvis-small">
                  {item.assigned || 'Unassigned'} · Due {item.due || '—'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: priorityColor[item.priority] ?? 'var(--jarvis-ts)',
                    textTransform: 'uppercase',
                  }}
                >
                  {item.priority}
                </span>
                <StatusBadge status={item.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Project detail view ──────────────────────────────────────────────────────
function ProjectDetail({ project, evm, actionItems, canWrite, onBack }: {
  project:     Project & { evm?: EVMData | null }
  evm?:        EVMData | null
  actionItems: ActionItem[]
  canWrite:    boolean
  onBack:      () => void
}) {
  const progress = project.progress ?? 0

  const metaFields = [
    ['Client',    project.client],
    ['Type',      project.type],
    ['Status',    project.status],
    ['Start',     project.start],
    ['End',       project.end],
    ['Value',     project.value != null ? fmtCurrency(Number(project.value)) : '—'],
  ]

  return (
    <div>
      {/* Nav */}
      <div className="jarvis-header" style={{ padding: '10px 0', marginBottom: 16 }}>
        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onBack}>
          ← All Projects
        </button>
        <StatusBadge status={project.status ?? 'active'} />
      </div>

      <h2 className="jarvis-heading" style={{ marginBottom: 2 }}>{project.project}</h2>
      <p className="jarvis-small" style={{ marginBottom: 12 }}>{project.id}</p>

      {/* Progress */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span className="jarvis-small">Overall Progress</span>
          <span className="jarvis-small" style={{ fontWeight: 700, color: progressColor(progress) }}>
            {progress}%
          </span>
        </div>
        <ProgressBar pct={progress} height={10} />
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Progress"   value={`${progress}%`} color={progressColor(progress)} />
        <KpiCard label="Contract Value" value={project.value != null ? fmtCurrency(Number(project.value)) : '—'} color="var(--jarvis-blue)" />
        {evm && <KpiCard label="CPI" value={evm.cpi.toFixed(2)} color={cpiColor(evm.cpi)} sub={evm.cpi >= 1 ? 'on budget' : 'over budget'} />}
        {evm && <KpiCard label="SPI" value={evm.spi.toFixed(2)} color={cpiColor(evm.spi)} sub={evm.spi >= 1 ? 'on schedule' : 'behind'} />}
      </div>

      {/* Two column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {/* Project details */}
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Project Details</h4>
          {metaFields.map(([label, value], i, arr) => (
            <div
              key={label as string}
              className="jarvis-row"
              style={{ borderBottom: i < arr.length - 1 ? undefined : 'none' }}
            >
              <span className="jarvis-small">{label}</span>
              <span className="jarvis-body" style={{ fontWeight: 600 }}>{(value as string) || '—'}</span>
            </div>
          ))}
        </div>

        {/* Notes / description */}
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 8 }}>Notes</h4>
          {project.notes ? (
            <p className="jarvis-body">{project.notes as string}</p>
          ) : (
            <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>No notes recorded</p>
          )}
        </div>
      </div>

      {/* EVM panel */}
      {evm && <div style={{ marginBottom: 12 }}><EVMPanel evm={evm} /></div>}

      {/* Action items */}
      <ActionItemsPanel
        actions={actionItems}
        projectId={project.project ?? project.id}
        canWrite={canWrite}
      />
    </div>
  )
}

// ─── Projects table ───────────────────────────────────────────────────────────
type SortKey = 'project' | 'status' | 'value' | 'progress'

function ProjectsTable({ projects, onSelect }: {
  projects: Array<Project & { evm?: EVMData | null }>
  onSelect: (p: Project) => void
}) {
  const [sort, setSort]   = useState<SortKey>('project')
  const [asc,  setAscDir] = useState(true)

  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      let av: unknown = a[sort]
      let bv: unknown = b[sort]
      if (sort === 'value' || sort === 'progress') {
        av = Number(av ?? 0); bv = Number(bv ?? 0)
      }
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? (av as number) - (bv as number)
        : String(av ?? '').localeCompare(String(bv ?? ''))
      return asc ? cmp : -cmp
    })
  }, [projects, sort, asc])

  function toggleSort(key: SortKey) {
    if (sort === key) setAscDir(d => !d)
    else { setSort(key); setAscDir(true) }
  }

  function th(key: SortKey, label: string) {
    return (
      <th
        onClick={() => toggleSort(key)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
        aria-sort={sort === key ? (asc ? 'ascending' : 'descending') : 'none'}
      >
        {label}{sort === key ? (asc ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="jarvis-empty" role="status">
        <span className="jarvis-empty-icon">🏗️</span>
        <span>No projects found</span>
      </div>
    )
  }

  return (
    <div className="jarvis-scroll-y jarvis-max-h-lg">
      <table className="jarvis-table" aria-label="Projects list">
        <thead>
          <tr>
            {th('project', 'Project')}
            <th>Client</th>
            {th('value',    'Contract Value')}
            <th>Type</th>
            {th('progress', 'Progress')}
            {th('status',   'Status')}
            <th>CPI</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(proj => {
            const evm = proj.evm
            const progress = Number(proj.progress ?? 0)
            return (
              <tr
                key={proj.id}
                onClick={() => onSelect(proj)}
                style={{ cursor: 'pointer' }}
                aria-label={`Open project ${proj.project}`}
              >
                <td>
                  <span style={{ fontWeight: 600 }}>{proj.project}</span>
                  <span className="jarvis-small" style={{ display: 'block' }}>{proj.id}</span>
                </td>
                <td className="jarvis-small">{proj.client ?? '—'}</td>
                <td className="jarvis-text-mono">
                  {proj.value != null ? fmtCurrency(Number(proj.value)) : '—'}
                </td>
                <td className="jarvis-small">{proj.type ?? '—'}</td>
                <td style={{ minWidth: 80 }}>
                  <div style={{ marginBottom: 2, fontSize: 10, color: progressColor(progress), fontWeight: 700 }}>
                    {progress}%
                  </div>
                  <ProgressBar pct={progress} height={4} />
                </td>
                <td><StatusBadge status={proj.status ?? 'active'} /></td>
                <td>
                  {evm ? (
                    <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, fontWeight: 700, color: cpiColor(evm.cpi) }}>
                      {evm.cpi.toFixed(2)}
                    </span>
                  ) : (
                    <span className="jarvis-muted">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── ProjectsView (main export) ───────────────────────────────────────────────
export function ProjectsView({ policy, onNavigate, onAudit, onToast }: ProjectsViewProps) {
  // Use stable selectors separately — selectProjectsWithEVM creates new arrays on every call
  // which would cause infinite render loops. We join in a memoised step instead.
  const rawContracts = useBizStore(selectContracts) as Project[]
  const allActions   = useBizStore(selectActionItems) as ActionItem[]
  const evmAll       = useBizStore(selectEVMProjects)

  const projectsWithEVM = useMemo(() => {
    const evmByProj = new Map(evmAll.map(e => [(e as { project?: string }).project, e]))
    return rawContracts.map(p => ({
      ...p,
      evm: evmByProj.get(p.project ?? p.id ?? '') ?? null,
    })) as Array<Project & { evm: EVMData | null }>
  }, [rawContracts, evmAll])

  const [selected, setSelected] = useState<(Project & { evm?: EVMData | null }) | null>(null)
  const [search,   setSearch]   = useState('')

  const { dispatch: _dispatch } = useMemo(() => createDispatch({
    policy,
    audit: onAudit ? (e) => onAudit(e) : undefined,
    toast: onToast ? (m, t) => onToast(m, t) : undefined,
  }), [policy, onAudit, onToast])

  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'

  // ── Derived ──────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return projectsWithEVM
    return projectsWithEVM.filter(p =>
      p.project?.toLowerCase().includes(q)
      || p.client?.toLowerCase().includes(q)
      || p.type?.toLowerCase().includes(q)
      || p.status?.toLowerCase().includes(q)
    )
  }, [projectsWithEVM, search])

  const activeProjects  = projectsWithEVM.filter(p => p.status === 'active' || p.status === 'in-progress')
  const totalValue      = projectsWithEVM.reduce((s, p) => s + Number(p.value ?? 0), 0)
  const avgProgress     = projectsWithEVM.length
    ? Math.round(projectsWithEVM.reduce((s, p) => s + Number(p.progress ?? 0), 0) / projectsWithEVM.length)
    : 0
  const avgCPI = evmAll.length
    ? evmAll.reduce((s, e) => s + e.cpi, 0) / evmAll.length
    : 1

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleSelect = useCallback((p: Project) => {
    const withEvm = projectsWithEVM.find(pw => pw.id === p.id) ?? p
    setSelected(withEvm as Project & { evm: EVMData | null })
  }, [projectsWithEVM])

  // ── Empty state ───────────────────────────────────────────────────────────────
  if (projectsWithEVM.length === 0) {
    return (
      <div className="jarvis-empty" style={{ marginTop: 48 }}>
        <span className="jarvis-empty-icon">🏗️</span>
        <h3 className="jarvis-heading">No projects yet</h3>
        <p className="jarvis-muted">Projects are created from contracts. Add a contract to get started.</p>
        {canWrite && (
          <button
            className="jarvis-btn jarvis-btn-primary"
            onClick={() => onNavigate?.('contracts')}
            style={{ marginTop: 16 }}
          >
            Go to Contracts
          </button>
        )}
      </div>
    )
  }

  // ── Detail view ───────────────────────────────────────────────────────────────
  if (selected) {
    return (
      <ProjectDetail
        project={selected}
        evm={selected.evm ?? null}
        actionItems={allActions}
        canWrite={canWrite}
        onBack={() => setSelected(null)}
      />
    )
  }

  // ── List view ─────────────────────────────────────────────────────────────────
  return (
    <div role="main" aria-label="Projects">

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCard label="Total Projects"  value={projectsWithEVM.length} sub={`${activeProjects.length} active`} />
        <KpiCard label="Portfolio Value" value={fmtCurrency(totalValue)}  color="var(--jarvis-blue)" />
        <KpiCard label="Avg Progress"    value={`${avgProgress}%`}         color={progressColor(avgProgress)} />
        <KpiCard
          label="Avg CPI"
          value={avgCPI.toFixed(2)}
          color={cpiColor(avgCPI)}
          sub={evmAll.length > 0 ? `${evmAll.length} with EVM` : 'no EVM data'}
        />
      </div>

      {/* Search */}
      <div style={{ marginBottom: 12 }}>
        <input
          className="jarvis-input"
          type="search"
          placeholder="Search by project name, client, type, status…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search projects"
        />
      </div>

      {/* Table */}
      <ProjectsTable projects={filtered} onSelect={handleSelect} />

    </div>
  )
}

export default ProjectsView
