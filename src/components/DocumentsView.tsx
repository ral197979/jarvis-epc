/**
 * Denver Engineering — DocumentsView Component
 * ───────────────────────────────────────
 * Phase 10: Extraction of JarvisCore `vn()` — the Documents module.
 *
 * Two tabs:
 *   Document Register  — ISO 19650-compliant document list with
 *                        discipline / CDE state / suitability / phase filters
 *   Transmittals       — Transmittal register showing sender, recipient,
 *                        purpose, and attached doc count
 *
 * ISO 19650 naming convention enforced:
 *   PROJECT-ORIGINATOR-FUNCTION-SPATIAL-FORM-DISCIPLINE-NUMBER
 *
 * Zero dependency on JarvisCore globals.
 * All state from Zustand selectDocuments selector.
 */

import React, { useState, useMemo } from 'react'
import {
  useBizStore,
  selectDocuments,
} from '../modules/biz/store'
import { createDispatch, actions, type PolicyConfig } from '../modules/biz/dispatch'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'

// ─── Types ────────────────────────────────────────────────────────────────────
interface ISOFields {
  proj?:     string
  orig?:     string
  func?:     string
  spatial?:  string
  form?:     string
  disc?:     string
  num?:      string
  suit?:     string
  rev?:      string
  cde?:      string
}

interface Document {
  id:          string
  title?:      string
  phase?:      string
  author?:     string
  date?:       string
  status?:     string
  description?: string
  version?:    string
  project?:    string
  iso?:        ISOFields
  [key: string]: unknown
}

interface Transmittal {
  id:        string
  subject?:  string
  from?:     string
  to?:       string
  date?:     string
  status?:   string
  purpose?:  string
  doc_count?: number
  documents?: Array<{ id: string; purpose?: string }>
  [key: string]: unknown
}

type DocumentsTab = 'register' | 'transmittals'

export interface DocumentsViewProps {
  policy:        PolicyConfig
  transmittals?: Transmittal[]
  onNavigate?:   (tab: string) => void
  onAudit?:      (entry: unknown) => void
  onToast?:      (msg: string, type: string) => void
}

// ─── ISO 19650 ID builder ─────────────────────────────────────────────────────
function buildISO19650Id(iso: ISOFields): string {
  const { proj = 'PROJ', orig = 'JIP', func = 'XX', spatial = 'ZZ', form = 'DR', disc = 'P', num } = iso
  return `${proj}-${orig}-${func}-${spatial}-${form}-${disc}-${num ?? '????'}`
}

// ─── CDE state color ──────────────────────────────────────────────────────────
const CDE_COLORS: Record<string, string> = {
  wip:       'var(--jarvis-td)',
  shared:    'var(--jarvis-blue)',
  published: 'var(--jarvis-grn)',
  archived:  'var(--jarvis-ts)',
}

const PURPOSE_COLORS: Record<string, string> = {
  'for-review':       'var(--jarvis-blue)',
  'for-approval':     'var(--jarvis-amb)',
  'for-construction': 'var(--jarvis-grn)',
  'for-information':  'var(--jarvis-td)',
  'for-record':       'var(--jarvis-ts)',
  'revise-resubmit':  'var(--jarvis-red)',
  'as-requested':     'var(--jarvis-cyn)',
}

// ─── Document detail panel ────────────────────────────────────────────────────
function DocumentDetail({ doc, onBack }: { doc: Document; onBack: () => void }) {
  const iso = doc.iso ?? {}
  const isoId = buildISO19650Id(iso)

  return (
    <div>
      <div className="jarvis-header" style={{ padding: '10px 0', marginBottom: 16 }}>
        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onBack}>
          ← Document Register
        </button>
        <StatusBadge status={iso.cde ?? doc.status ?? 'wip'} />
      </div>

      {/* ISO ID banner */}
      <div style={{
        background: 'color-mix(in srgb, var(--jarvis-ac) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--jarvis-ac) 30%, transparent)',
        borderRadius: 8, padding: 12, marginBottom: 16,
      }}>
        <div style={{ fontSize: 9, color: 'var(--jarvis-ac)', fontWeight: 700, marginBottom: 4 }}>
          ISO 19650 CONTAINER ID
        </div>
        <div style={{
          fontSize: 16, fontWeight: 800, color: 'var(--jarvis-ac)',
          fontFamily: 'var(--jarvis-font-mono)', letterSpacing: 1,
        }}>
          {isoId}
        </div>
        <div style={{ fontSize: 9, color: 'var(--jarvis-ts)', marginTop: 4 }}>
          Project – Originator – Function – Spatial – Form – Discipline – Number
        </div>
      </div>

      <h2 className="jarvis-heading" style={{ marginBottom: 4 }}>{doc.title ?? doc.id}</h2>
      <p className="jarvis-small" style={{ marginBottom: 12 }}>{doc.id}</p>

      {/* Meta fields */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
        {([
          ['Discipline',  iso.disc],
          ['Form',        iso.form],
          ['Suitability', iso.suit ?? 'S0'],
          ['Revision',    iso.rev ?? doc.version ?? 'P01'],
          ['CDE State',   iso.cde ?? 'wip'],
          ['Phase',       doc.phase],
          ['Author',      doc.author],
          ['Date',        doc.date],
          ['Project',     doc.project],
        ] as [string, string | undefined][]).map(([label, value]) => (
          <div key={label} className="jarvis-card" style={{ padding: '8px 10px', background: 'var(--jarvis-bl)' }}>
            <div className="jarvis-muted" style={{ fontSize: 9, marginBottom: 2 }}>{label}</div>
            <div className="jarvis-body" style={{ fontWeight: 600, fontSize: 11 }}>{value ?? '—'}</div>
          </div>
        ))}
      </div>

      {doc.description && (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 8 }}>Description</h4>
          <p className="jarvis-body">{doc.description}</p>
        </div>
      )}
    </div>
  )
}

// ─── Transmittal detail panel ─────────────────────────────────────────────────
function TransmittalDetail({ transmittal, onBack }: { transmittal: Transmittal; onBack: () => void }) {
  const docs      = transmittal.documents ?? []
  const docCount  = transmittal.doc_count ?? docs.length
  const purposeColor = PURPOSE_COLORS[transmittal.purpose ?? ''] ?? 'var(--jarvis-ts)'

  return (
    <div>
      <div className="jarvis-header" style={{ padding: '10px 0', marginBottom: 16 }}>
        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onBack}>
          ← Transmittals
        </button>
        <StatusBadge status={transmittal.status ?? 'sent'} />
      </div>

      <h2 className="jarvis-heading" style={{ marginBottom: 4 }}>{transmittal.id}</h2>
      <p className="jarvis-small" style={{ marginBottom: 12 }}>{transmittal.subject}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
        {([
          ['From',     transmittal.from],
          ['To',       transmittal.to],
          ['Date',     transmittal.date],
          ['Purpose',  transmittal.purpose],
          ['Status',   transmittal.status],
          ['Doc Count', String(docCount)],
        ] as [string, string | undefined][]).map(([label, value]) => (
          <div key={label} className="jarvis-card" style={{ padding: '8px 10px', background: 'var(--jarvis-bl)' }}>
            <div className="jarvis-muted" style={{ fontSize: 9, marginBottom: 2 }}>{label}</div>
            <div
              className="jarvis-body"
              style={{
                fontWeight: 600, fontSize: 11,
                color: label === 'Purpose' ? purposeColor : 'var(--jarvis-tx)',
              }}
            >
              {value ?? '—'}
            </div>
          </div>
        ))}
      </div>

      {docs.length > 0 && (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Attached Documents ({docs.length})</h4>
          {docs.map((d, i) => (
            <div
              key={d.id}
              className="jarvis-row"
              style={{ borderBottom: i < docs.length - 1 ? '1px solid var(--jarvis-bd)' : 'none' }}
            >
              <span className="jarvis-body" style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 600 }}>{d.id}</span>
              {d.purpose && (
                <span style={{
                  fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                  color: PURPOSE_COLORS[d.purpose] ?? 'var(--jarvis-ts)',
                }}>
                  {d.purpose.replace(/-/g, ' ')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Document Register tab ────────────────────────────────────────────────────
function DocumentRegister({ docs, onSelect, canWrite }: {
  docs:     Document[]
  onSelect: (d: Document) => void
  canWrite: boolean
}) {
  const [search,      setSearch]      = useState('')
  const [discFilter,  setDiscFilter]  = useState('all')
  const [cdeFilter,   setCdeFilter]   = useState('all')
  const [suitFilter,  setSuitFilter]  = useState('all')
  const [phaseFilter, setPhaseFilter] = useState('all')

  const disciplines = useMemo(() => ['all', ...new Set(docs.map(d => d.iso?.disc).filter(Boolean) as string[])], [docs])
  const cdeStates   = useMemo(() => ['all', ...new Set(docs.map(d => d.iso?.cde ?? 'wip'))], [docs])
  const suitStates  = useMemo(() => ['all', ...new Set(docs.map(d => d.iso?.suit ?? 'S0'))], [docs])
  const phases      = useMemo(() => ['all', ...new Set(docs.map(d => d.phase).filter(Boolean) as string[])], [docs])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return docs.filter(d => {
      const iso = d.iso ?? {}
      if (discFilter  !== 'all' && (iso.disc ?? '') !== discFilter)  return false
      if (cdeFilter   !== 'all' && (iso.cde  ?? 'wip') !== cdeFilter)  return false
      if (suitFilter  !== 'all' && (iso.suit ?? 'S0')  !== suitFilter)  return false
      if (phaseFilter !== 'all' && d.phase !== phaseFilter) return false
      if (q) {
        const isoId = buildISO19650Id(iso)
        return (d.id + d.title + d.author + isoId).toLowerCase().includes(q)
      }
      return true
    })
  }, [docs, search, discFilter, cdeFilter, suitFilter, phaseFilter])

  const ifcCount = docs.filter(d => d.iso?.suit === 'S4' || d.iso?.cde === 'published').length
  const wipCount = docs.filter(d => !d.iso?.cde || d.iso.cde === 'wip').length

  if (docs.length === 0) {
    return (
      <div className="jarvis-empty" role="status">
        <span className="jarvis-empty-icon">📐</span>
        <h3 className="jarvis-heading">No documents yet</h3>
        <p className="jarvis-muted">Add documents with ISO 19650-compliant naming</p>
      </div>
    )
  }

  return (
    <div>
      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
        <KpiCard label="Total Docs"   value={docs.length}              color="var(--jarvis-blue)" />
        <KpiCard label="IFC / Published" value={ifcCount}             color="var(--jarvis-grn)" />
        <KpiCard label="WIP"          value={wipCount}                 color="var(--jarvis-amb)" />
        <KpiCard label="Disciplines"  value={disciplines.length - 1}  color="var(--jarvis-ts)" />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          className="jarvis-input"
          type="search"
          placeholder="Search by ID, title, author…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search documents"
          style={{ flex: 1, minWidth: 180 }}
        />
        <select className="jarvis-select" value={discFilter}  onChange={e => setDiscFilter(e.target.value)} aria-label="Filter by discipline">
          {disciplines.map(d => <option key={d} value={d}>{d === 'all' ? 'All Disciplines' : d}</option>)}
        </select>
        <select className="jarvis-select" value={cdeFilter}   onChange={e => setCdeFilter(e.target.value)} aria-label="Filter by CDE state">
          {cdeStates.map(s => <option key={s} value={s}>{s === 'all' ? 'All CDE States' : s}</option>)}
        </select>
        <select className="jarvis-select" value={suitFilter}  onChange={e => setSuitFilter(e.target.value)} aria-label="Filter by suitability">
          {suitStates.map(s => <option key={s} value={s}>{s === 'all' ? 'All Suitability' : s}</option>)}
        </select>
        <select className="jarvis-select" value={phaseFilter} onChange={e => setPhaseFilter(e.target.value)} aria-label="Filter by phase">
          {phases.map(p => <option key={p} value={p}>{p === 'all' ? 'All Phases' : p}</option>)}
        </select>
      </div>

      <div style={{ marginBottom: 8 }}>
        <span className="jarvis-small">{filtered.length} of {docs.length} documents</span>
      </div>

      {filtered.length === 0 ? (
        <div className="jarvis-empty" role="status"><span>No documents match your filters</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Document register">
            <thead>
              <tr>
                <th>Document ID</th>
                <th>Title</th>
                <th>Disc</th>
                <th>Form</th>
                <th>Suit</th>
                <th>Rev</th>
                <th>CDE</th>
                <th>Phase</th>
                <th>Author</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(doc => {
                const iso     = doc.iso ?? {}
                const cde     = iso.cde ?? 'wip'
                const cdeColor = CDE_COLORS[cde] ?? 'var(--jarvis-ts)'
                return (
                  <tr key={doc.id} onClick={() => onSelect(doc)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, fontSize: 10, color: 'var(--jarvis-ac)' }}>
                      {doc.id}
                    </td>
                    <td className="jarvis-truncate" style={{ maxWidth: 160 }}>{doc.title ?? '—'}</td>
                    <td className="jarvis-small">{iso.disc ?? '—'}</td>
                    <td className="jarvis-small">{iso.form ?? '—'}</td>
                    <td className="jarvis-small">{iso.suit ?? 'S0'}</td>
                    <td className="jarvis-small" style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{iso.rev ?? doc.version ?? 'P01'}</td>
                    <td>
                      <span style={{
                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                        color: cdeColor, background: `color-mix(in srgb, ${cdeColor} 12%, transparent)`,
                        padding: '2px 5px', borderRadius: 4,
                      }}>
                        {cde}
                      </span>
                    </td>
                    <td className="jarvis-small">{doc.phase ?? '—'}</td>
                    <td className="jarvis-small">{doc.author ?? '—'}</td>
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

// ─── Transmittals tab ─────────────────────────────────────────────────────────
function TransmittalsTab({ transmittals, onSelect }: {
  transmittals: Transmittal[]
  onSelect:     (t: Transmittal) => void
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search) return transmittals
    const q = search.toLowerCase()
    return transmittals.filter(t =>
      (t.id + t.subject + t.from + t.to + t.purpose).toLowerCase().includes(q)
    )
  }, [transmittals, search])

  if (transmittals.length === 0) {
    return (
      <div className="jarvis-empty" role="status">
        <span className="jarvis-empty-icon">📨</span>
        <span>No transmittals recorded</span>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <input
          className="jarvis-input"
          type="search"
          placeholder="Search transmittals…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search transmittals"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="jarvis-empty" role="status"><span>No transmittals match</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Transmittal register">
            <thead>
              <tr>
                <th>ID</th><th>Subject</th><th>From</th><th>To</th>
                <th>Date</th><th>Purpose</th><th style={{ textAlign: 'right' }}>Docs</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const docCount  = t.doc_count ?? (t.documents?.length ?? 0)
                const purpose   = t.purpose ?? t.documents?.[0]?.purpose ?? '—'
                const purColor  = PURPOSE_COLORS[purpose] ?? 'var(--jarvis-ts)'
                return (
                  <tr key={t.id} onClick={() => onSelect(t)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 700, color: 'var(--jarvis-ac)', fontSize: 11, fontFamily: 'var(--jarvis-font-mono)' }}>
                      {t.id}
                    </td>
                    <td className="jarvis-truncate" style={{ maxWidth: 180 }}>{t.subject ?? '—'}</td>
                    <td className="jarvis-small">{t.from ?? '—'}</td>
                    <td className="jarvis-small">{t.to ?? '—'}</td>
                    <td className="jarvis-small">{t.date ?? '—'}</td>
                    <td>
                      <span style={{ fontSize: 9, fontWeight: 700, color: purColor, textTransform: 'uppercase' }}>
                        {purpose !== '—' ? purpose.replace(/-/g, ' ') : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>
                      {docCount}
                    </td>
                    <td><StatusBadge status={t.status ?? 'sent'} /></td>
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

// ─── DocumentsView (main export) ─────────────────────────────────────────────
export function DocumentsView({
  policy,
  transmittals: transmittalsProp,
  onNavigate,
  onAudit,
  onToast,
}: DocumentsViewProps) {
  const allDocs = useBizStore(selectDocuments) as Document[]
  const transmittalsFromStore = useBizStore(s => s.biz.transmittals ?? []) as Transmittal[]
  const transmittals: Transmittal[] = transmittalsProp ?? transmittalsFromStore

  const [activeTab,       setActiveTab]       = useState<DocumentsTab>('register')
  const [selectedDoc,     setSelectedDoc]     = useState<Document | null>(null)
  const [selectedTransmittal, setSelectedTransmittal] = useState<Transmittal | null>(null)

  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'

  const tabCounts: Partial<Record<DocumentsTab, number>> = {
    transmittals: transmittals.filter(t => t.status !== 'closed' && t.status !== 'acknowledged').length,
  }

  // ── Detail routing ────────────────────────────────────────────────────────────
  if (selectedDoc) {
    return <DocumentDetail doc={selectedDoc} onBack={() => setSelectedDoc(null)} />
  }
  if (selectedTransmittal) {
    return <TransmittalDetail transmittal={selectedTransmittal} onBack={() => setSelectedTransmittal(null)} />
  }

  const TABS = [
    { id: 'register'     as DocumentsTab, label: 'Document Register', icon: '📐' },
    { id: 'transmittals' as DocumentsTab, label: 'Transmittals',      icon: '📨' },
  ]

  return (
    <div role="main" aria-label="Documents">
      {/* ISO 19650 badge */}
      <div className="jarvis-row" style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--jarvis-cd)', border: '1px solid var(--jarvis-bd)', borderRadius: 8 }}>
        <span style={{ fontSize: 14 }}>📐</span>
        <span className="jarvis-small">
          Naming: <span style={{ fontWeight: 700, color: 'var(--jarvis-ac)', fontFamily: 'var(--jarvis-font-mono)' }}>
            PROJECT-ORIGINATOR-FUNCTION-SPATIAL-FORM-DISCIPLINE-NUMBER
          </span>
        </span>
        <span className="jarvis-small" style={{ marginLeft: 'auto', color: 'var(--jarvis-td)' }}>ISO 19650-2</span>
      </div>

      {/* Tab bar */}
      <div role="tablist" aria-label="Document sections" style={{
        display: 'flex', gap: 2, marginBottom: 16,
        background: 'var(--jarvis-cd)', borderRadius: 6, padding: 2,
        border: '1px solid var(--jarvis-bd)',
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, padding: '6px 10px', borderRadius: 5, border: 'none',
              background: activeTab === tab.id ? 'color-mix(in srgb, var(--jarvis-ac) 18%, transparent)' : 'transparent',
              color:      activeTab === tab.id ? 'var(--jarvis-ac)' : 'var(--jarvis-ts)',
              fontWeight: activeTab === tab.id ? 700 : 500,
              fontSize: 11, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {(tabCounts[tab.id] ?? 0) > 0 && (
              <span style={{ background: 'var(--jarvis-amb)', color: '#fff', borderRadius: 99, padding: '1px 6px', fontSize: 9, fontWeight: 700 }}>
                {tabCounts[tab.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'register' && (
        <DocumentRegister docs={allDocs} onSelect={setSelectedDoc} canWrite={canWrite} />
      )}
      {activeTab === 'transmittals' && (
        <TransmittalsTab transmittals={transmittals} onSelect={setSelectedTransmittal} />
      )}
    </div>
  )
}

export default DocumentsView
