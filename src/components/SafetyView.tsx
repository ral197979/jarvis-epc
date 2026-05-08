/**
 * Denver Engineering — SafetyView Component
 * ───────────────────────────────────
 * Phase 9: Extraction of JarvisCore `kn()` — the unified Safety module.
 *
 * Covers four safety domains:
 *   - Dashboard: KPI summary (days since incident, TRIR, active permits, JHA count)
 *   - Incidents:  log, detail panel, recordable/LTI tracking
 *   - JHAs:       Job Hazard Analysis list and detail
 *   - Permits:    Work permits with type/status filtering
 *   - Toolbox:    Toolbox talk attendance and topics
 *
 * Zero dependency on JarvisCore globals.
 * All state from Zustand selectors, all mutations through createDispatch.
 */

import React, { useState, useMemo, useCallback } from 'react'
import {
  useBizStore,
  selectIncidents,
  selectDaysSinceLastIncident,
  selectRecordableRate,
} from '../modules/biz/store'
import { createDispatch, actions, type PolicyConfig } from '../modules/biz/dispatch'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Incident {
  id:               string
  title?:           string
  description?:     string
  type?:            string
  date?:            string
  location?:        string
  severity?:        string
  status?:          string
  recordable?:      boolean
  lti?:             boolean
  root_cause?:      string
  corrective_action?: string
  [key: string]:    unknown
}

interface JHA {
  id:         string
  task?:      string
  title?:     string
  status?:    string
  hazards?:   string[]
  controls?:  string[]
  risk?:      string
  reviewer?:  string
  date?:      string
  location?:  string
  supervisor? :string
  [key: string]: unknown
}

interface Permit {
  id:          string
  type?:       string
  location?:   string
  status?:     string
  date?:       string
  issuer?:     string
  holder?:     string
  valid_from?: string
  valid_to?:   string
  hazards?:    string[]
  precautions?: string[]
  [key: string]: unknown
}

interface ToolboxTalk {
  id:        string
  topic?:    string
  date?:     string
  attendees?: number
  presenter?: string
  location?:  string
  [key: string]: unknown
}

type SafetyTab = 'dashboard' | 'incidents' | 'jhas' | 'permits' | 'toolbox'

export interface SafetyViewProps {
  policy:       PolicyConfig
  jhas?:        JHA[]
  incidents?:   Incident[]
  permits?:     Permit[]
  toolboxTalks?: ToolboxTalk[]
  onNavigate?:  (tab: string) => void
  onAudit?:     (entry: unknown) => void
  onToast?:     (msg: string, type: string) => void
}

// ─── Tab config ───────────────────────────────────────────────────────────────
const TABS: { id: SafetyTab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'incidents', label: 'Incidents',  icon: '🚨' },
  { id: 'jhas',      label: 'JHAs',       icon: '📋' },
  { id: 'permits',   label: 'Permits',    icon: '🪪' },
  { id: 'toolbox',   label: 'Toolbox',    icon: '🧰' },
]

const INCIDENT_STAGES = ['reported', 'investigation', 'corrective', 'reviewed', 'closed']
const PERMIT_STAGES   = ['draft', 'requested', 'approved', 'active', 'closed']

// ─── Stage pipeline (display only) ───────────────────────────────────────────
function StagePipeline({ stages, current }: { stages: string[]; current: string }) {
  const activeIdx = stages.indexOf(current)
  return (
    <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
      {stages.map((s, i) => {
        const isActive = s === current
        const isPast   = i < activeIdx
        const bg = isActive ? 'var(--jarvis-ac)' : isPast ? 'var(--jarvis-grn)' : 'var(--jarvis-bd)'
        const tc = isActive || isPast ? '#fff' : 'var(--jarvis-td)'
        return (
          <div
            key={s}
            style={{
              flex:         1,
              padding:      '6px 4px',
              background:   bg,
              color:        tc,
              fontSize:     10,
              fontWeight:   isActive ? 700 : 500,
              textAlign:    'center',
              borderRight:  i < stages.length - 1 ? '1px solid rgba(0,0,0,0.12)' : 'none',
              borderRadius: i === 0 ? '6px 0 0 6px' : i === stages.length - 1 ? '0 6px 6px 0' : '0',
              textTransform: 'capitalize',
            }}
          >
            {s}
          </div>
        )
      })}
    </div>
  )
}

// ─── Detail field grid ────────────────────────────────────────────────────────
function FieldGrid({ fields }: { fields: [string, string | undefined | null][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 16 }}>
      {fields.map(([label, value]) => (
        <div key={label} className="jarvis-card" style={{ padding: '8px 10px', background: 'var(--jarvis-bl)' }}>
          <div className="jarvis-muted" style={{ fontSize: 9, marginBottom: 2 }}>{label}</div>
          <div className="jarvis-body" style={{ fontWeight: 600, fontSize: 11 }}>{value || '—'}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Incident detail panel ────────────────────────────────────────────────────
function IncidentDetail({ incident, onBack }: { incident: Incident; onBack: () => void }) {
  return (
    <div>
      <div className="jarvis-header" style={{ padding: '10px 0', marginBottom: 16 }}>
        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onBack}>← All Incidents</button>
        <div style={{ display: 'flex', gap: 8 }}>
          {incident.recordable && <span className="jarvis-tag" style={{ color: 'var(--jarvis-red)', background: 'color-mix(in srgb, var(--jarvis-red) 15%, transparent)' }}>Recordable</span>}
          {incident.lti        && <span className="jarvis-tag" style={{ color: 'var(--jarvis-red)', background: 'color-mix(in srgb, var(--jarvis-red) 15%, transparent)' }}>LTI</span>}
          <StatusBadge status={incident.status ?? 'reported'} />
        </div>
      </div>
      <h2 className="jarvis-heading" style={{ marginBottom: 4 }}>{incident.title ?? incident.description ?? 'Incident'}</h2>
      <p className="jarvis-small" style={{ marginBottom: 12 }}>{incident.id}</p>
      <StagePipeline stages={INCIDENT_STAGES} current={incident.status ?? 'reported'} />
      <FieldGrid fields={[
        ['Type',              incident.type ?? 'Near Miss'],
        ['Date',              incident.date],
        ['Location',         incident.location ?? 'Site'],
        ['Severity',         incident.severity ?? 'Minor'],
        ['Recordable',       incident.recordable ? 'Yes' : 'No'],
        ['LTI',              incident.lti ? 'Yes' : 'No'],
        ['Root Cause',       incident.root_cause ?? 'Under Investigation'],
        ['Corrective Action', incident.corrective_action ?? 'Pending'],
      ]} />
      {incident.description && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 12 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 8 }}>Description</h4>
          <p className="jarvis-body">{incident.description}</p>
        </div>
      )}
    </div>
  )
}

// ─── JHA detail panel ─────────────────────────────────────────────────────────
function JHADetail({ jha, onBack }: { jha: JHA; onBack: () => void }) {
  const hazards  = jha.hazards  ?? []
  const controls = jha.controls ?? ['Standard PPE', 'Buddy system']
  return (
    <div>
      <div className="jarvis-header" style={{ padding: '10px 0', marginBottom: 16 }}>
        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onBack}>← All JHAs</button>
        <StatusBadge status={jha.status ?? 'draft'} />
      </div>
      <h2 className="jarvis-heading" style={{ marginBottom: 4 }}>{jha.title ?? jha.task}</h2>
      <p className="jarvis-small" style={{ marginBottom: 12 }}>{jha.id}</p>
      <FieldGrid fields={[
        ['Task / Activity', jha.task ?? jha.title],
        ['Status',          jha.status ?? 'active'],
        ['Risk Level',      jha.risk ?? 'Medium'],
        ['Reviewed By',     jha.reviewer ?? 'Site HSE'],
        ['Date',            jha.date],
        ['Location',        jha.location],
        ['Supervisor',      jha.supervisor],
      ]} />
      {hazards.length > 0 && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 12 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Hazard Register</h4>
          {hazards.map((h, i) => (
            <div key={i} className="jarvis-row" style={{ borderBottom: i < hazards.length - 1 ? undefined : 'none' }}>
              <span style={{ fontSize: 14 }}>⚠️</span>
              <span className="jarvis-body jarvis-flex-1">{h}</span>
            </div>
          ))}
        </div>
      )}
      {controls.length > 0 && (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Controls</h4>
          {controls.map((c, i) => (
            <div key={i} className="jarvis-row" style={{ borderBottom: i < controls.length - 1 ? undefined : 'none' }}>
              <span style={{ fontSize: 14 }}>✅</span>
              <span className="jarvis-body jarvis-flex-1">{c}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Permit detail panel ──────────────────────────────────────────────────────
function PermitDetail({ permit, onBack }: { permit: Permit; onBack: () => void }) {
  return (
    <div>
      <div className="jarvis-header" style={{ padding: '10px 0', marginBottom: 16 }}>
        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onBack}>← All Permits</button>
        <StatusBadge status={permit.status ?? 'draft'} />
      </div>
      <h2 className="jarvis-heading" style={{ marginBottom: 4 }}>{permit.type} Permit</h2>
      <p className="jarvis-small" style={{ marginBottom: 12 }}>{permit.location ?? 'Site'} · {permit.id}</p>
      <StagePipeline stages={PERMIT_STAGES} current={permit.status ?? 'draft'} />
      <FieldGrid fields={[
        ['Type',       permit.type],
        ['Location',   permit.location],
        ['Status',     permit.status],
        ['Issuer',     permit.issuer ?? 'Site HSE'],
        ['Holder',     permit.holder],
        ['Valid From', permit.valid_from ?? permit.date],
        ['Valid To',   permit.valid_to],
        ['Hazards',    (permit.hazards    ?? ['General']).join(', ')],
        ['Precautions', (permit.precautions ?? ['Standard PPE']).join(', ')],
      ]} />
    </div>
  )
}

// ─── Safety Dashboard ─────────────────────────────────────────────────────────
function SafetyDashboard({ incidents, jhas, permits, toolboxTalks, onTabChange }: {
  incidents:   Incident[]
  jhas:        JHA[]
  permits:     Permit[]
  toolboxTalks: ToolboxTalk[]
  onTabChange: (tab: SafetyTab) => void
}) {
  const daysSinceLast  = useBizStore(selectDaysSinceLastIncident)
  const recordableRate = useBizStore(selectRecordableRate)
  const activePermits  = permits.filter(p => p.status === 'active' || p.status === 'approved')
  const openIncidents  = incidents.filter(i => i.status !== 'closed')
  const recordables    = incidents.filter(i => i.recordable)
  const approvedJHAs   = jhas.filter(j => j.status === 'approved').length

  return (
    <div>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCard
          label="Days Since Incident"
          value={daysSinceLast}
          sub={incidents.length === 0 ? 'no incidents' : 'last incident'}
          color={daysSinceLast >= 30 ? 'var(--jarvis-grn)' : daysSinceLast >= 7 ? 'var(--jarvis-amb)' : 'var(--jarvis-red)'}
        />
        <KpiCard
          label="TRIR"
          value={recordableRate}
          sub="recordable rate"
          color={recordableRate <= 1 ? 'var(--jarvis-grn)' : recordableRate <= 3 ? 'var(--jarvis-amb)' : 'var(--jarvis-red)'}
        />
        <KpiCard label="Open Incidents" value={openIncidents.length} sub={`${recordables.length} recordable`}
          color={openIncidents.length === 0 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)'} />
        <KpiCard label="Active Permits"  value={activePermits.length} sub={`of ${permits.length} total`}
          color="var(--jarvis-blue)" />
        <KpiCard label="Approved JHAs"   value={approvedJHAs}          sub={`of ${jhas.length} total`}
          color="var(--jarvis-grn)" />
        <KpiCard label="Toolbox Talks"   value={toolboxTalks.length}
          sub={`${toolboxTalks.reduce((s, t) => s + (t.attendees ?? 0), 0)} attendees`}
          color="var(--jarvis-pur)" />
      </div>

      {/* Quick-nav cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Recent incidents */}
        <div className="jarvis-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h4 className="jarvis-label">Recent Incidents</h4>
            <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={() => onTabChange('incidents')}>
              View all →
            </button>
          </div>
          {incidents.length === 0 ? (
            <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>No incidents recorded ✅</p>
          ) : (
            incidents.slice(0, 4).map(inc => (
              <div key={inc.id} className="jarvis-row" style={{ borderBottom: '1px solid var(--jarvis-bd)' }}>
                <div className="jarvis-flex-1 jarvis-truncate">
                  <span className="jarvis-body" style={{ fontWeight: 600 }}>{inc.title ?? inc.description ?? inc.id}</span>
                  <span className="jarvis-small" style={{ display: 'block' }}>{inc.date ?? '—'}</span>
                </div>
                <StatusBadge status={inc.status ?? 'reported'} />
              </div>
            ))
          )}
        </div>

        {/* Active permits */}
        <div className="jarvis-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h4 className="jarvis-label">Active Permits</h4>
            <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={() => onTabChange('permits')}>
              View all →
            </button>
          </div>
          {activePermits.length === 0 ? (
            <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>No active permits</p>
          ) : (
            activePermits.slice(0, 4).map(p => (
              <div key={p.id} className="jarvis-row" style={{ borderBottom: '1px solid var(--jarvis-bd)' }}>
                <div className="jarvis-flex-1">
                  <span className="jarvis-body" style={{ fontWeight: 600 }}>{p.type}</span>
                  <span className="jarvis-small" style={{ display: 'block' }}>{p.location ?? 'Site'}</span>
                </div>
                <StatusBadge status={p.status ?? 'active'} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Generic safety table ─────────────────────────────────────────────────────
function SafetyTable<T extends { id: string; status?: string }>({
  rows,
  cols,
  onSelect,
  ariaLabel,
}: {
  rows:      T[]
  cols:      { key: keyof T; label: string; render?: (r: T) => React.ReactNode }[]
  onSelect:  (r: T) => void
  ariaLabel: string
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search) return rows
    const q = search.toLowerCase()
    return rows.filter(r =>
      Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q))
    )
  }, [rows, search])

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <input
          className="jarvis-input"
          type="search"
          placeholder={`Filter ${ariaLabel.toLowerCase()}…`}
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label={`Search ${ariaLabel}`}
        />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty" role="status">
          <span className="jarvis-empty-icon">🔍</span>
          <span>{search ? 'No items match your search' : `No ${ariaLabel.toLowerCase()} recorded`}</span>
        </div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label={ariaLabel}>
            <thead>
              <tr>{cols.map(c => <th key={String(c.key)}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} onClick={() => onSelect(row)} style={{ cursor: 'pointer' }}>
                  {cols.map(c => (
                    <td key={String(c.key)}>
                      {c.render
                        ? c.render(row)
                        : String(row[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Toolbox tab ──────────────────────────────────────────────────────────────
function ToolboxTab({ talks }: { talks: ToolboxTalk[] }) {
  const totalAttendees = talks.reduce((s, t) => s + (t.attendees ?? 0), 0)
  const topics = [...new Set(talks.map(t => t.topic).filter(Boolean))]

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        <KpiCard label="Total Talks"    value={talks.length}   color="var(--jarvis-pur)" />
        <KpiCard label="Attendees"      value={totalAttendees} color="var(--jarvis-blue)" />
        <KpiCard label="Topics Covered" value={topics.length}  color="var(--jarvis-grn)" />
      </div>
      {talks.length === 0 ? (
        <div className="jarvis-empty">
          <span className="jarvis-empty-icon">🧰</span>
          <span>No toolbox talks recorded</span>
        </div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Toolbox talks">
            <thead>
              <tr>
                <th>Topic</th><th>Date</th><th>Presenter</th><th>Location</th><th>Attendees</th>
              </tr>
            </thead>
            <tbody>
              {talks.map(t => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.topic ?? '—'}</td>
                  <td>{t.date ?? '—'}</td>
                  <td>{t.presenter ?? '—'}</td>
                  <td>{t.location ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--jarvis-font-mono)', textAlign: 'right' }}>{t.attendees ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── SafetyView (main export) ─────────────────────────────────────────────────
export function SafetyView({
  policy,
  jhas: jhasProp,
  incidents: incidentsProp,
  permits: permitsProp,
  toolboxTalks: toolboxProp,
  onNavigate,
  onAudit,
  onToast,
}: SafetyViewProps) {
  // Pull from store; props override for testing
  // Note: use primitive selector paths to avoid Zustand object-equality infinite loop
  const storeIncidents = useBizStore(selectIncidents) as Incident[]
  const storeJHAs      = useBizStore(s => s.biz.jhas     ?? []) as JHA[]
  const storePermits   = useBizStore(s => s.biz.permits  ?? []) as Permit[]

  const incidents   = incidentsProp ?? storeIncidents
  const jhas        = jhasProp     ?? storeJHAs
  const permits     = permitsProp  ?? storePermits
  const toolboxTalks = toolboxProp ?? []

  const [activeTab,      setActiveTab]   = useState<SafetyTab>('dashboard')
  const [selectedInc,    setSelectedInc] = useState<Incident | null>(null)
  const [selectedJHA,    setSelectedJHA] = useState<JHA | null>(null)
  const [selectedPermit, setSelectedPermit] = useState<Permit | null>(null)

  // ── Tab counts ────────────────────────────────────────────────────────────────
  const tabCounts: Partial<Record<SafetyTab, number>> = {
    incidents: incidents.filter(i => i.status !== 'closed').length,
    jhas:      jhas.filter(j => j.status !== 'approved').length,
    permits:   permits.filter(p => p.status === 'active' || p.status === 'approved').length,
    toolbox:   toolboxTalks.length,
  }

  // ── Detail routing ────────────────────────────────────────────────────────────
  if (selectedInc) {
    return <IncidentDetail incident={selectedInc} onBack={() => setSelectedInc(null)} />
  }
  if (selectedJHA) {
    return <JHADetail jha={selectedJHA} onBack={() => setSelectedJHA(null)} />
  }
  if (selectedPermit) {
    return <PermitDetail permit={selectedPermit} onBack={() => setSelectedPermit(null)} />
  }

  // ── Main view ─────────────────────────────────────────────────────────────────
  return (
    <div role="main" aria-label="Safety">
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Safety sections"
        style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--jarvis-bd)', paddingBottom: 0 }}
      >
        {TABS.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding:         '8px 14px',
              background:      'transparent',
              border:          'none',
              borderBottom:    activeTab === tab.id ? '2px solid var(--jarvis-ac)' : '2px solid transparent',
              color:           activeTab === tab.id ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)',
              fontWeight:      activeTab === tab.id ? 700 : 500,
              fontSize:        12,
              cursor:          'pointer',
              display:         'flex',
              alignItems:      'center',
              gap:             6,
              paddingBottom:   10,
              transition:      'color 0.15s ease, border-color 0.15s ease',
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {(tabCounts[tab.id] ?? 0) > 0 && (
              <span style={{
                background:   tab.id === 'incidents' ? 'var(--jarvis-red)' : 'var(--jarvis-ac)',
                color:        '#fff',
                borderRadius: 99,
                padding:      '1px 6px',
                fontSize:     9,
                fontWeight:   700,
              }}>
                {tabCounts[tab.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === 'dashboard' && (
        <SafetyDashboard
          incidents={incidents}
          jhas={jhas}
          permits={permits}
          toolboxTalks={toolboxTalks}
          onTabChange={setActiveTab}
        />
      )}

      {activeTab === 'incidents' && (
        <SafetyTable<Incident>
          rows={incidents}
          ariaLabel="Incidents"
          onSelect={setSelectedInc}
          cols={[
            { key: 'id',       label: 'ID' },
            { key: 'title',    label: 'Description', render: r => r.title ?? r.description ?? r.id },
            { key: 'type',     label: 'Type' },
            { key: 'date',     label: 'Date' },
            { key: 'severity', label: 'Severity' },
            { key: 'status',   label: 'Status', render: r => <StatusBadge status={r.status ?? 'reported'} /> },
            {
              key: 'recordable', label: 'Rec.',
              render: r => r.recordable
                ? <span style={{ color: 'var(--jarvis-red)', fontWeight: 700 }}>R</span>
                : <span style={{ color: 'var(--jarvis-td)' }}>—</span>,
            },
          ]}
        />
      )}

      {activeTab === 'jhas' && (
        <SafetyTable<JHA>
          rows={jhas}
          ariaLabel="Job Hazard Analyses"
          onSelect={setSelectedJHA}
          cols={[
            { key: 'id',       label: 'ID' },
            { key: 'title',    label: 'Task / Activity', render: r => r.title ?? r.task ?? '—' },
            { key: 'location', label: 'Location' },
            { key: 'risk',     label: 'Risk' },
            { key: 'date',     label: 'Date' },
            { key: 'status',   label: 'Status', render: r => <StatusBadge status={r.status ?? 'draft'} /> },
          ]}
        />
      )}

      {activeTab === 'permits' && (
        <SafetyTable<Permit>
          rows={permits}
          ariaLabel="Work Permits"
          onSelect={setSelectedPermit}
          cols={[
            { key: 'id',       label: 'ID' },
            { key: 'type',     label: 'Type' },
            { key: 'location', label: 'Location' },
            { key: 'issuer',   label: 'Issuer' },
            { key: 'valid_from', label: 'Valid From' },
            { key: 'valid_to',   label: 'Valid To' },
            { key: 'status',   label: 'Status', render: r => <StatusBadge status={r.status ?? 'draft'} /> },
          ]}
        />
      )}

      {activeTab === 'toolbox' && (
        <ToolboxTab talks={toolboxTalks} />
      )}
    </div>
  )
}

export default SafetyView
