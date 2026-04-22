/**
 * JARVIS EPC — CxWorkflowView
 * ────────────────────────────
 * Full commissioning workflow integrated from the JarvisEPC MVP.
 *
 * Tabs: Scope → Matrix → Packs → Execute → Deficiencies → Turnover
 *
 * State: all collections stored in BizStore via generic/update_collection.
 * Keys: cx_scope_results, cx_matrix_rows, cx_packs, cx_executions,
 *       cx_deficiencies, cx_retests, cx_turnover_items
 *
 * Zero API calls. Pure client-side commissioning engine.
 */

import React, { useState, useMemo, useCallback } from 'react'
import { useBizStore }                           from '../modules/biz/store'
import { JARVIS_ACTIONS }                        from '../modules/biz/reducer'
import { createDispatch, type PolicyConfig }     from '../modules/biz/dispatch'
import { StatusBadge }                           from './StatusBadge'
import { KpiCard }                               from './KpiCard'
import {
  analyzeScope,
  generateMatrixRows,
  generatePack,
  generateDefaultTurnoverItems,
  createExecution,
  resolveExecutionStatus,
  PHASE_LABELS,
  PHASE_COLOR,
  ALL_PHASES,
  type CxPack,
  type CxMatrixRow,
  type CxExecution,
  type CxDeficiency,
  type CxRetest,
  type CxTurnoverItem,
  type CxScopeResult,
  type CxAsset,
  type CxPhase,
  type CxStepResult,
  type DefSeverity,
} from '../modules/commissioning/rules'
import {
  listProjectTemplates,
  instantiateProjectTemplate,
  type ProjectTemplate,
  type ProjectTemplateKey,
} from '../modules/commissioning/projectTemplates'

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkflowTab = 'project' | 'scope' | 'matrix' | 'packs' | 'execute' | 'deficiencies' | 'turnover'

export interface CxWorkflowViewProps {
  policy:       PolicyConfig
  onNavigate?:  (tab: string) => void
  onAudit?:     (e: unknown) => void
  onToast?:     (msg: string, type: string) => void
}

// ─── Store helpers ────────────────────────────────────────────────────────────

function useCxCollection<T>(key: string): T[] {
  return useBizStore(s => ((s.biz as Record<string, unknown>)[key] as T[]) ?? [])
}

// ─── Shared ───────────────────────────────────────────────────────────────────

function PhasePill({ phase }: { phase: CxPhase }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: `color-mix(in srgb, ${PHASE_COLOR[phase]} 16%, transparent)`,
      color: PHASE_COLOR[phase], textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
    }}>
      {PHASE_LABELS[phase]}
    </span>
  )
}

function SevPill({ severity }: { severity: DefSeverity }) {
  const c = { low: 'var(--jarvis-grn)', medium: 'var(--jarvis-amb)', high: 'var(--jarvis-red)', critical: 'var(--jarvis-red)' }[severity] ?? 'var(--jarvis-td)'
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c, textTransform: 'uppercase' }}>
      {severity}
    </span>
  )
}

// ─── Tab: Project Setup ───────────────────────────────────────────────────────
// Pick a project type → review auto-bundled systems → add/remove → apply.
// "Apply" instantiates one CxAsset per selected slot and registers a system
// (contract) in the biz store, so the Matrix tab can pick them up immediately.

function ProjectSetupTab({
  templates, canWrite, onApply, hasExistingAssets,
}: {
  templates:         ProjectTemplate[]
  canWrite:          boolean
  hasExistingAssets: boolean
  onApply:           (key: ProjectTemplateKey, projectName: string, selected: Set<string>) => void
}) {
  const [selectedKey,  setSelectedKey]  = useState<ProjectTemplateKey | null>(null)
  const [projectName,  setProjectName]  = useState('')
  const [selectedSys,  setSelectedSys]  = useState<Set<string>>(new Set())

  const selectedTemplate = templates.find(t => t.key === selectedKey)

  function pickTemplate(t: ProjectTemplate) {
    setSelectedKey(t.key)
    setProjectName(t.label)
    setSelectedSys(new Set(t.systems.map(s => s.name)))
  }

  function toggleSystem(name: string) {
    setSelectedSys(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else                next.add(name)
      return next
    })
  }

  function handleApply() {
    if (!selectedKey || selectedSys.size === 0) return
    onApply(selectedKey, projectName, selectedSys)
    setSelectedKey(null)
    setSelectedSys(new Set())
    setProjectName('')
  }

  return (
    <div>
      <div className="jarvis-card" style={{ padding: 14, marginBottom: 16 }}>
        <h4 className="jarvis-label" style={{ marginBottom: 6 }}>Pick a project type</h4>
        <p className="jarvis-muted" style={{ fontSize: 11, marginBottom: 12 }}>
          Each template is a starter scope — you can add or remove systems before applying.
          {hasExistingAssets && ' Applying will append to your existing assets, not replace them.'}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {templates.map(t => {
            const isActive = t.key === selectedKey
            return (
              <button
                key={t.key}
                onClick={() => pickTemplate(t)}
                className="jarvis-card"
                style={{
                  padding: 12, textAlign: 'left' as const, cursor: 'pointer', border: isActive ? '1px solid var(--jarvis-ac)' : '1px solid var(--jarvis-bd)',
                  background: isActive ? 'color-mix(in srgb, var(--jarvis-ac) 8%, transparent)' : 'var(--jarvis-cd)',
                }}
              >
                <div className="jarvis-body" style={{ fontWeight: 700, marginBottom: 4 }}>{t.label}</div>
                <div className="jarvis-muted" style={{ fontSize: 10, marginBottom: 6, lineHeight: 1.4 }}>{t.description}</div>
                <div className="jarvis-small" style={{ color: 'var(--jarvis-ac)', fontWeight: 600 }}>
                  {t.systems.length} system{t.systems.length === 1 ? '' : 's'}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {selectedTemplate && (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h4 className="jarvis-heading" style={{ fontSize: 13, marginBottom: 2 }}>{selectedTemplate.label}</h4>
              <p className="jarvis-muted" style={{ fontSize: 11 }}>{selectedTemplate.description}</p>
            </div>
            <div style={{ minWidth: 240, flex: '0 0 auto' }}>
              <label className="jarvis-small" htmlFor="cx-proj-name" style={{ display: 'block', marginBottom: 4 }}>Project name</label>
              <input
                id="cx-proj-name"
                className="jarvis-input"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder={selectedTemplate.label}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span className="jarvis-label">Bundled systems</span>
            <span className="jarvis-small">{selectedSys.size} of {selectedTemplate.systems.length} selected</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, marginBottom: 16 }}>
            {selectedTemplate.systems.map(sys => {
              const checked = selectedSys.has(sys.name)
              return (
                <label key={sys.name} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  background: checked ? 'color-mix(in srgb, var(--jarvis-ac) 6%, transparent)' : 'var(--jarvis-bl)',
                  border: '1px solid var(--jarvis-bd)', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSystem(sys.name)}
                    style={{ accentColor: 'var(--jarvis-ac)' }}
                  />
                  <span style={{ flex: 1 }}>{sys.name}</span>
                  <span className="jarvis-small" style={{ fontFamily: 'var(--jarvis-font-mono)', color: 'var(--jarvis-ts)' }}>{sys.assetType}</span>
                </label>
              )
            })}
          </div>

          {canWrite && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                className="jarvis-btn jarvis-btn-primary"
                onClick={handleApply}
                disabled={selectedSys.size === 0 || !projectName.trim()}
              >
                ✓ Apply Template ({selectedSys.size} system{selectedSys.size === 1 ? '' : 's'})
              </button>
              {selectedSys.size === 0 && <span className="jarvis-muted" style={{ fontSize: 11 }}>Select at least one system</span>}
              {!projectName.trim() && <span className="jarvis-muted" style={{ fontSize: 11 }}>Project name required</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Scope Analyzer ──────────────────────────────────────────────────────

function ScopeTab({
  scopeResults, onAnalyze,
}: {
  scopeResults: CxScopeResult[]
  onAnalyze:    (title: string, content: string) => void
}) {
  const [title,   setTitle]   = useState('Scope Narrative')
  const [content, setContent] = useState(
    'Remove and replace existing RO water treatment system. Upgrade chiller controls and verify AHU operation. New VFD installation for pump circuit upgrades.'
  )

  return (
    <div>
      <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
        <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Analyze Scope Document</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label className="jarvis-small" htmlFor="cx-scope-title" style={{ display: 'block', marginBottom: 4 }}>Document Title</label>
            <input id="cx-scope-title" className="jarvis-input" value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="jarvis-small" htmlFor="cx-scope-content" style={{ display: 'block', marginBottom: 4 }}>Scope Text</label>
            <textarea
              id="cx-scope-content"
              className="jarvis-input"
              rows={5}
              style={{ width: '100%', resize: 'vertical' }}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Paste scope narrative, scope of works, or engineering description…"
            />
          </div>
        </div>
        <button
          className="jarvis-btn jarvis-btn-primary"
          onClick={() => onAnalyze(title, content)}
          disabled={!content.trim()}
        >
          🔍 Analyze Scope
        </button>
      </div>

      {scopeResults.length === 0 ? (
        <div className="jarvis-empty">
          <span className="jarvis-empty-icon">📄</span>
          <span>No scope analyses yet. Paste a scope narrative above and click Analyze.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...scopeResults].reverse().map(r => (
            <div key={r.id} className="jarvis-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div className="jarvis-body" style={{ fontWeight: 600, marginBottom: 4 }}>{r.summary}</div>
                  <div className="jarvis-muted" style={{ fontSize: 10 }}>{new Date(r.createdAt).toLocaleString()}</div>
                </div>
                <div style={{
                  fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, fontSize: 18,
                  color: r.confidence >= 85 ? 'var(--jarvis-grn)' : 'var(--jarvis-amb)',
                }}>
                  {r.confidence}%
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {r.classifications.map(c => (
                  <span key={c} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                    background: 'color-mix(in srgb, var(--jarvis-blue) 14%, transparent)', color: 'var(--jarvis-blue)' }}>
                    {c}
                  </span>
                ))}
              </div>
              {r.affectedSystems.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="jarvis-muted" style={{ fontSize: 10, alignSelf: 'center' }}>Systems:</span>
                  {r.affectedSystems.map(s => (
                    <span key={s} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4,
                      background: 'var(--jarvis-bl)', color: 'var(--jarvis-tx)', fontWeight: 600 }}>
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Commissioning Matrix ────────────────────────────────────────────────

function MatrixTab({
  assets, systems, matrix, canWrite,
  onGenerateMatrix, onGeneratePack, existingPackIds,
}: {
  assets:          CxAsset[]
  systems:         Array<{ id: string; name: string; type?: string }>
  matrix:          CxMatrixRow[]
  canWrite:        boolean
  onGenerateMatrix:(systemId: string) => void
  onGeneratePack:  (row: CxMatrixRow) => void
  existingPackIds: Set<string>
}) {
  const [phaseFilter, setPhaseFilter] = useState<CxPhase | 'all'>('all')
  const [sysFilt,     setSysFilt]     = useState('all')

  const filtered = useMemo(() => matrix.filter(r => {
    if (phaseFilter !== 'all' && r.phase !== phaseFilter)  return false
    if (sysFilt     !== 'all' && r.systemId !== sysFilt)   return false
    return true
  }), [matrix, phaseFilter, sysFilt])

  const phaseCount = ALL_PHASES.reduce((acc, p) => {
    acc[p] = matrix.filter(r => r.phase === p).length
    return acc
  }, {} as Record<CxPhase, number>)

  return (
    <div>
      {/* System generate buttons */}
      {systems.length > 0 && canWrite && (
        <div className="jarvis-card" style={{ padding: 14, marginBottom: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Generate Matrix</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {systems.map(sys => {
              const sysAssets = assets.filter(a => a.systemId === sys.id)
              return (
                <button
                  key={sys.id}
                  className="jarvis-btn jarvis-btn-ghost"
                  style={{ fontSize: 11 }}
                  onClick={() => onGenerateMatrix(sys.id)}
                  disabled={sysAssets.length === 0}
                  title={sysAssets.length === 0 ? 'No assets in this system' : `Generate from ${sysAssets.length} assets`}
                >
                  ⚡ {sys.name} ({sysAssets.length} assets)
                </button>
              )
            })}
          </div>
          {assets.length === 0 && (
            <p className="jarvis-muted" style={{ fontSize: 11, marginTop: 8, fontStyle: 'italic' }}>
              Add commissioning assets in the CI Assets section first, then generate a matrix.
            </p>
          )}
        </div>
      )}

      {/* Phase summary pills */}
      {matrix.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {ALL_PHASES.map(p => (
            <button key={p} onClick={() => setPhaseFilter(phaseFilter === p ? 'all' : p)}
              style={{
                fontSize: 11, padding: '4px 10px', border: 'none', borderRadius: 99, cursor: 'pointer',
                background: phaseFilter === p
                  ? `color-mix(in srgb, ${PHASE_COLOR[p]} 20%, transparent)`
                  : 'var(--jarvis-bl)',
                color: PHASE_COLOR[p], fontWeight: phaseFilter === p ? 700 : 500,
                outline: phaseFilter === p ? `1px solid ${PHASE_COLOR[p]}` : 'none',
              }}>
              {PHASE_LABELS[p]} ({phaseCount[p] ?? 0})
            </button>
          ))}
          {systems.length > 1 && (
            <select className="jarvis-select" value={sysFilt} onChange={e => setSysFilt(e.target.value)} style={{ fontSize: 11, padding: '4px 8px' }}>
              <option value="all">All systems</option>
              {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
      )}

      {matrix.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">📋</span><span>Matrix is empty. Add assets and click Generate Matrix.</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Commissioning matrix">
            <thead>
              <tr>
                <th>Asset Tag</th>
                <th>Type</th>
                <th>Phase</th>
                <th>Test Name</th>
                <th>Responsible</th>
                <th>Evidence</th>
                <th>Status</th>
                {canWrite && <th>Pack</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id}>
                  <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, fontSize: 11 }}>{row.assetTag}</td>
                  <td className="jarvis-small">{row.assetType}</td>
                  <td><PhasePill phase={row.phase} /></td>
                  <td style={{ fontWeight: 600 }}>{row.testName}</td>
                  <td className="jarvis-small">{row.responsibleParty.join(', ')}</td>
                  <td className="jarvis-small">{row.evidenceRequirements.join(', ')}</td>
                  <td><StatusBadge status={row.status} /></td>
                  {canWrite && (
                    <td>
                      {existingPackIds.has(row.id) ? (
                        <span className="jarvis-small" style={{ color: 'var(--jarvis-grn)' }}>✓ generated</span>
                      ) : (
                        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={() => onGeneratePack(row)}>
                          Generate
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Packs ───────────────────────────────────────────────────────────────

function PacksTab({
  packs, canWrite, onStartExecution, onSelectPack, selectedPack,
}: {
  packs:            CxPack[]
  canWrite:         boolean
  onStartExecution: (pack: CxPack) => void
  onSelectPack:     (pack: CxPack | null) => void
  selectedPack:     CxPack | null
}) {
  const [phaseFilter, setPhaseFilter] = useState<CxPhase | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const filtered = useMemo(() => packs.filter(p => {
    if (phaseFilter  !== 'all' && p.phase  !== phaseFilter)  return false
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    return true
  }), [packs, phaseFilter, statusFilter])

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {}
    packs.forEach(p => { c[p.status] = (c[p.status] ?? 0) + 1 })
    return c
  }, [packs])

  if (selectedPack) {
    return (
      <div>
        <div className="jarvis-header" style={{ padding: '10px 0', marginBottom: 16 }}>
          <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={() => onSelectPack(null)}>← All Packs</button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <PhasePill phase={selectedPack.phase} />
            <StatusBadge status={selectedPack.status} />
          </div>
        </div>
        <h2 className="jarvis-heading" style={{ marginBottom: 4 }}>{selectedPack.title}</h2>
        <p className="jarvis-small" style={{ marginBottom: 16 }}>Rev: {selectedPack.revision} · Pack ID: {selectedPack.id.slice(-8)}</p>

        <div className="jarvis-card" style={{ padding: 14, marginBottom: 12 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 8 }}>Prerequisites</h4>
          {selectedPack.prerequisites.map((p, i) => (
            <div key={i} className="jarvis-row" style={{ padding: '6px 0' }}>
              <span style={{ fontSize: 14 }}>☐</span>
              <span className="jarvis-body jarvis-flex-1">{p}</span>
            </div>
          ))}
        </div>

        <div className="jarvis-card" style={{ padding: 14, marginBottom: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Test Steps</h4>
          {selectedPack.steps.map((step, i) => (
            <div key={step.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < selectedPack.steps.length - 1 ? '1px solid var(--jarvis-bd)' : 'none' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--jarvis-ac)', width: 20, flexShrink: 0 }}>{step.stepNo}</span>
                <div className="jarvis-flex-1">
                  <div className="jarvis-body" style={{ fontWeight: 600, marginBottom: 4 }}>{step.action}</div>
                  <div className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>Expected: {step.expectedResult}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {canWrite && selectedPack.status === 'draft' && (
          <button className="jarvis-btn jarvis-btn-primary" onClick={() => onStartExecution(selectedPack)}>
            ▶ Start Execution
          </button>
        )}
      </div>
    )
  }

  if (packs.length === 0) {
    return <div className="jarvis-empty"><span className="jarvis-empty-icon">📦</span><span>No packs yet. Generate packs from the Matrix tab.</span></div>
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8, marginBottom: 14 }}>
        <KpiCard label="Total"     value={packs.length} />
        <KpiCard label="Draft"     value={statusCounts['draft']     ?? 0} />
        <KpiCard label="Active"    value={statusCounts['in_progress'] ?? 0} color="var(--jarvis-blue)" />
        <KpiCard label="Complete"  value={statusCounts['completed'] ?? 0}  color="var(--jarvis-grn)" />
        <KpiCard label="Failed"    value={statusCounts['failed']    ?? 0}  color="var(--jarvis-red)" />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select className="jarvis-select" value={phaseFilter} onChange={e => setPhaseFilter(e.target.value as CxPhase | 'all')} style={{ fontSize: 11 }}>
          <option value="all">All phases</option>
          {ALL_PHASES.map(p => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
        </select>
        <select className="jarvis-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ fontSize: 11 }}>
          <option value="all">All statuses</option>
          {['draft','issued','in_progress','completed','failed'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="jarvis-small" style={{ alignSelf: 'center' }}>{filtered.length} of {packs.length}</span>
      </div>
      <div className="jarvis-scroll-y jarvis-max-h-lg">
        <table className="jarvis-table" aria-label="Test packs">
          <thead>
            <tr><th>Pack Title</th><th>Phase</th><th>Rev</th><th>Steps</th><th>Status</th>{canWrite && <th>Action</th>}</tr>
          </thead>
          <tbody>
            {filtered.map(pack => (
              <tr key={pack.id} onClick={() => onSelectPack(pack)} style={{ cursor: 'pointer' }}>
                <td style={{ fontWeight: 600 }}>{pack.title}</td>
                <td><PhasePill phase={pack.phase} /></td>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{pack.revision}</td>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{pack.steps.length}</td>
                <td><StatusBadge status={pack.status} /></td>
                {canWrite && (
                  <td onClick={e => e.stopPropagation()}>
                    {pack.status === 'draft' && (
                      <button className="jarvis-btn jarvis-btn-primary jarvis-btn-sm" onClick={() => onStartExecution(pack)}>
                        ▶ Execute
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Tab: Execution ───────────────────────────────────────────────────────────

type ResultMap = Record<string, { passFail: 'pass' | 'fail' | 'na' | 'blocked'; comments: string; actual: string }>

function ExecuteTab({
  packs, executions, canWrite, onSubmitExecution,
}: {
  packs:             CxPack[]
  executions:        CxExecution[]
  canWrite:          boolean
  onSubmitExecution: (packId: string, results: ResultMap) => void
}) {
  const [selectedPackId, setSelectedPackId] = useState<string>('')
  const [results, setResults]               = useState<ResultMap>({})

  const selectedPack = packs.find(p => p.id === selectedPackId)
  const activePacks  = packs.filter(p => ['draft','issued','in_progress'].includes(p.status))
  const packExecs    = executions.filter(e => e.packId === selectedPackId)

  function setResult(stepId: string, field: keyof ResultMap[string], value: string) {
    setResults(prev => {
      const existing = prev[stepId] ?? { passFail: 'na' as const, comments: '', actual: '' }
      return { ...prev, [stepId]: { ...existing, [field]: value } }
    })
  }

  const RESULT_OPTIONS: Array<{ value: 'pass' | 'fail' | 'na' | 'blocked'; label: string; color: string }> = [
    { value: 'pass',    label: '✓ Pass',    color: 'var(--jarvis-grn)' },
    { value: 'fail',    label: '✗ Fail',    color: 'var(--jarvis-red)' },
    { value: 'na',      label: '— N/A',     color: 'var(--jarvis-td)'  },
    { value: 'blocked', label: '⊘ Blocked', color: 'var(--jarvis-amb)' },
  ]

  const allAnswered  = selectedPack ? selectedPack.steps.every(s => results[s.id]?.passFail) : false
  const anyFail      = selectedPack ? selectedPack.steps.some(s => results[s.id]?.passFail === 'fail') : false

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label className="jarvis-small" htmlFor="cx-exec-pack" style={{ display: 'block', marginBottom: 6 }}>Select pack to execute</label>
        <select
          id="cx-exec-pack"
          className="jarvis-select"
          value={selectedPackId}
          onChange={e => { setSelectedPackId(e.target.value); setResults({}) }}
          style={{ width: '100%' }}
        >
          <option value="">— choose a pack —</option>
          {activePacks.map(p => <option key={p.id} value={p.id}>{p.title} [{PHASE_LABELS[p.phase]}]</option>)}
        </select>
        {activePacks.length === 0 && (
          <p className="jarvis-muted" style={{ fontSize: 11, marginTop: 8, fontStyle: 'italic' }}>No packs available for execution. Generate packs from the Matrix tab.</p>
        )}
      </div>

      {selectedPack && (
        <div>
          <div className="jarvis-card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h4 className="jarvis-heading" style={{ fontSize: 13, margin: 0 }}>{selectedPack.title}</h4>
              <PhasePill phase={selectedPack.phase} />
            </div>
            <p className="jarvis-muted" style={{ fontSize: 11 }}>Complete each step. All steps must be answered before submission.</p>
          </div>

          {selectedPack.steps.map((step, i) => {
            const res = results[step.id]
            const chosen = res?.passFail
            return (
              <div key={step.id} className="jarvis-card" style={{ padding: 14, marginBottom: 10, borderLeft: chosen === 'pass' ? '3px solid var(--jarvis-grn)' : chosen === 'fail' ? '3px solid var(--jarvis-red)' : chosen === 'blocked' ? '3px solid var(--jarvis-amb)' : '3px solid var(--jarvis-bd)' }}>
                <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--jarvis-ac)', minWidth: 18 }}>{step.stepNo}</span>
                  <div className="jarvis-flex-1">
                    <div className="jarvis-body" style={{ fontWeight: 600, marginBottom: 3 }}>{step.action}</div>
                    <div className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>Expected: {step.expectedResult}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                  {RESULT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setResult(step.id, 'passFail', opt.value)}
                      style={{
                        fontSize: 11, padding: '4px 10px', border: `1px solid ${opt.color}`, borderRadius: 6, cursor: 'pointer',
                        background: chosen === opt.value ? `color-mix(in srgb, ${opt.color} 20%, transparent)` : 'transparent',
                        color: opt.color, fontWeight: chosen === opt.value ? 700 : 500,
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {chosen && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label className="jarvis-small" htmlFor={`act-${step.id}`} style={{ display: 'block', marginBottom: 2 }}>Actual result</label>
                      <input id={`act-${step.id}`} className="jarvis-input" style={{ fontSize: 11 }} value={res?.actual ?? ''} onChange={e => setResult(step.id, 'actual', e.target.value)} placeholder="Measured value or observation" />
                    </div>
                    <div>
                      <label className="jarvis-small" htmlFor={`cmt-${step.id}`} style={{ display: 'block', marginBottom: 2 }}>Comments</label>
                      <input id={`cmt-${step.id}`} className="jarvis-input" style={{ fontSize: 11 }} value={res?.comments ?? ''} onChange={e => setResult(step.id, 'comments', e.target.value)} placeholder="Optional comments" />
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {canWrite && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
              <button
                className={`jarvis-btn ${anyFail ? 'jarvis-btn-ghost' : 'jarvis-btn-primary'}`}
                style={{ borderColor: anyFail ? 'var(--jarvis-red)' : undefined, color: anyFail ? 'var(--jarvis-red)' : undefined }}
                disabled={!allAnswered}
                onClick={() => onSubmitExecution(selectedPackId, results)}
              >
                {anyFail ? '⚠ Submit (with failures)' : '✓ Submit Execution'}
              </button>
              {!allAnswered && <span className="jarvis-muted" style={{ fontSize: 11 }}>Answer all steps to submit</span>}
            </div>
          )}

          {packExecs.length > 0 && (
            <div className="jarvis-card" style={{ padding: 14, marginTop: 20 }}>
              <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Execution History</h4>
              {packExecs.map(exec => (
                <div key={exec.id} className="jarvis-row">
                  <div className="jarvis-flex-1">
                    <span className="jarvis-small">{new Date(exec.createdAt).toLocaleString()}</span>
                    <span className="jarvis-small" style={{ display: 'block' }}>
                      {exec.stepResults.filter(r => r.passFail === 'pass').length} pass ·{' '}
                      {exec.stepResults.filter(r => r.passFail === 'fail').length} fail ·{' '}
                      {exec.stepResults.filter(r => r.passFail === 'na').length} N/A
                    </span>
                  </div>
                  <StatusBadge status={exec.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Deficiencies ────────────────────────────────────────────────────────

function DeficienciesTab({
  deficiencies, retests, packs, canWrite, onCreateRetest, onUpdateStatus,
}: {
  deficiencies:   CxDeficiency[]
  retests:        CxRetest[]
  packs:          CxPack[]
  canWrite:       boolean
  onCreateRetest: (deficiency: CxDeficiency) => void
  onUpdateStatus: (id: string, status: CxDeficiency['status']) => void
}) {
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('open')
  const [sevFilter, setSevFilter] = useState<'all' | CxDeficiency['severity']>('all')

  const displayed = useMemo(() => deficiencies.filter(d => {
    const closed = ['closed'].includes(d.status)
    if (filter === 'open'   && closed)  return false
    if (filter === 'closed' && !closed) return false
    if (sevFilter !== 'all' && d.severity !== sevFilter) return false
    return true
  }), [deficiencies, filter, sevFilter])

  const open     = deficiencies.filter(d => d.status !== 'closed').length
  const critical = deficiencies.filter(d => d.severity === 'critical' && d.status !== 'closed').length
  const packMap  = new Map(packs.map(p => [p.id, p]))
  const retestsByDef = new Map(retests.map(r => [r.deficiencyId, r]))

  if (deficiencies.length === 0) {
    return <div className="jarvis-empty"><span className="jarvis-empty-icon">✅</span><span>No deficiencies recorded yet.</span></div>
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 14 }}>
        <KpiCard label="Total"    value={deficiencies.length} />
        <KpiCard label="Open"     value={open}     color={open > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Critical" value={critical} color={critical > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Retests"  value={retests.length} color="var(--jarvis-pur)" />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['all','open','closed'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`jarvis-btn ${filter === f ? 'jarvis-btn-primary' : 'jarvis-btn-ghost'}`} style={{ fontSize: 11, padding: '4px 10px', textTransform: 'capitalize' }}>{f}</button>
        ))}
        <select className="jarvis-select" value={sevFilter} onChange={e => setSevFilter(e.target.value as typeof sevFilter)} style={{ fontSize: 11 }}>
          <option value="all">All severities</option>
          {['low','medium','high','critical'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {displayed.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🔍</span><span>No items match</span></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {displayed.map(def => {
            const pack    = packMap.get(def.packId)
            const retest  = retestsByDef.get(def.id)
            const isClosed = def.status === 'closed'
            return (
              <div key={def.id} className="jarvis-card" style={{ padding: 16, borderLeft: `3px solid ${{ low:'var(--jarvis-grn)', medium:'var(--jarvis-amb)', high:'var(--jarvis-red)', critical:'var(--jarvis-red)' }[def.severity]}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <span className="jarvis-body" style={{ fontWeight: 700 }}>{def.title}</span>
                    {pack && <span className="jarvis-small" style={{ display: 'block', marginTop: 2, color: 'var(--jarvis-ts)' }}>Pack: {pack.title}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    <SevPill severity={def.severity} />
                    <StatusBadge status={def.status} />
                  </div>
                </div>
                <p className="jarvis-body" style={{ color: 'var(--jarvis-ts)', marginBottom: 10, fontSize: 12 }}>{def.description}</p>
                {def.assignedTo && <div className="jarvis-small" style={{ marginBottom: 8 }}>Assigned to: {def.assignedTo}</div>}
                {retest && (
                  <div style={{ marginBottom: 8, padding: '6px 10px', background: 'color-mix(in srgb, var(--jarvis-pur) 10%, transparent)', borderRadius: 6 }}>
                    <span className="jarvis-small" style={{ color: 'var(--jarvis-pur)' }}>Retest: {retest.status} · {new Date(retest.createdAt).toLocaleDateString()}</span>
                  </div>
                )}
                {canWrite && !isClosed && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {!retest && (
                      <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={() => onCreateRetest(def)}>
                        🔄 Create Retest
                      </button>
                    )}
                    <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={() => onUpdateStatus(def.id, 'closed')}>
                      ✓ Close
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Turnover ────────────────────────────────────────────────────────────

function TurnoverTab({
  turnover, systems, canWrite, onUpdateStatus, onGenerateForSystem,
}: {
  turnover:           CxTurnoverItem[]
  systems:            Array<{ id: string; name: string }>
  canWrite:           boolean
  onUpdateStatus:     (id: string, status: CxTurnoverItem['status']) => void
  onGenerateForSystem:(systemId: string) => void
}) {
  const [sysFilt, setSysFilt] = useState('all')

  const displayed = turnover.filter(t => sysFilt === 'all' || t.systemId === sysFilt)
  const approved  = turnover.filter(t => t.status === 'approved').length
  const missing   = turnover.filter(t => t.status === 'missing').length
  const pct       = turnover.length > 0 ? Math.round((approved / turnover.length) * 100) : 0

  const STATUS_ACTIONS: { label: string; status: CxTurnoverItem['status']; color?: string }[] = [
    { label: 'Submit',  status: 'submitted' },
    { label: 'Approve', status: 'approved',  color: 'var(--jarvis-grn)' },
    { label: 'Reject',  status: 'rejected',  color: 'var(--jarvis-red)' },
  ]

  const STATUS_COLOR: Record<string, string> = {
    missing:   'var(--jarvis-td)',
    submitted: 'var(--jarvis-blue)',
    approved:  'var(--jarvis-grn)',
    rejected:  'var(--jarvis-red)',
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Total"    value={turnover.length} />
        <KpiCard label="Approved" value={approved} color="var(--jarvis-grn)" />
        <KpiCard label="Missing"  value={missing}  color={missing > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Complete" value={`${pct}%`} color={pct === 100 ? 'var(--jarvis-grn)' : pct >= 60 ? 'var(--jarvis-amb)' : 'var(--jarvis-red)'} />
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span className="jarvis-small">Turnover Completion</span>
          <span className="jarvis-small" style={{ fontWeight: 700 }}>{approved}/{turnover.length}</span>
        </div>
        <div style={{ background: 'var(--jarvis-bl)', borderRadius: 8, height: 10, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--jarvis-grn)' : 'var(--jarvis-blue)', borderRadius: 8, transition: 'width 0.4s' }} />
        </div>
      </div>

      {canWrite && systems.length > 0 && turnover.length === 0 && (
        <div className="jarvis-card" style={{ padding: 14, marginBottom: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Seed Turnover Checklist</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {systems.map(sys => (
              <button key={sys.id} className="jarvis-btn jarvis-btn-ghost" style={{ fontSize: 11 }} onClick={() => onGenerateForSystem(sys.id)}>
                + {sys.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {systems.length > 1 && turnover.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <select className="jarvis-select" value={sysFilt} onChange={e => setSysFilt(e.target.value)} style={{ fontSize: 11 }}>
            <option value="all">All systems</option>
            {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {displayed.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">📦</span><span>No turnover items. Add systems and click Seed Turnover Checklist.</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Turnover checklist">
            <thead>
              <tr><th>Document</th><th>Category</th><th>System</th><th>Status</th>{canWrite && <th>Actions</th>}</tr>
            </thead>
            <tbody>
              {displayed.map(item => {
                const sys  = systems.find(s => s.id === item.systemId)
                const col  = STATUS_COLOR[item.status] ?? 'var(--jarvis-td)'
                return (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.title}</td>
                    <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 10, color: 'var(--jarvis-ts)' }}>{item.category}</td>
                    <td className="jarvis-small">{sys?.name ?? '—'}</td>
                    <td>
                      <span style={{ fontSize: 10, fontWeight: 700, color: col,
                        background: `color-mix(in srgb, ${col} 14%, transparent)`,
                        padding: '2px 7px', borderRadius: 4, textTransform: 'capitalize' }}>
                        {item.status}
                      </span>
                    </td>
                    {canWrite && (
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {STATUS_ACTIONS.filter(a => a.status !== item.status).map(a => (
                            <button key={a.status} className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm"
                              style={{ fontSize: 10, color: a.color }}
                              onClick={() => onUpdateStatus(item.id, a.status)}>
                              {a.label}
                            </button>
                          ))}
                        </div>
                      </td>
                    )}
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

// ─── Dashboard summary ────────────────────────────────────────────────────────

function WorkflowDashboard({
  matrix, packs, deficiencies, turnover, onTabChange,
}: {
  matrix:       CxMatrixRow[]
  packs:        CxPack[]
  deficiencies: CxDeficiency[]
  turnover:     CxTurnoverItem[]
  onTabChange:  (t: WorkflowTab) => void
}) {
  const matrixDone  = matrix.filter(r => r.status === 'complete').length
  const packsDone   = packs.filter(p => p.status === 'completed').length
  const openDefs    = deficiencies.filter(d => d.status !== 'closed').length
  const turnoverPct = turnover.length > 0 ? Math.round((turnover.filter(t => t.status === 'approved').length / turnover.length) * 100) : 0

  const items = [
    { icon: '📋', label: 'Matrix',       stat: `${matrixDone}/${matrix.length}`,           sub: 'tests complete',     tab: 'matrix'       as WorkflowTab, alert: false },
    { icon: '📦', label: 'Packs',        stat: `${packsDone}/${packs.length}`,              sub: 'packs complete',     tab: 'packs'        as WorkflowTab, alert: packs.filter(p => p.status === 'failed').length > 0 },
    { icon: '🚨', label: 'Deficiencies', stat: String(openDefs),                            sub: 'open items',         tab: 'deficiencies' as WorkflowTab, alert: openDefs > 0 },
    { icon: '📦', label: 'Turnover',     stat: `${turnoverPct}%`,                           sub: 'documentation done', tab: 'turnover'     as WorkflowTab, alert: turnoverPct < 100 && turnover.length > 0 },
  ]

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        {items.map(item => (
          <div key={item.label} className="jarvis-card" onClick={() => onTabChange(item.tab)}
            style={{ padding: 16, cursor: 'pointer', borderLeft: `3px solid ${item.alert ? 'var(--jarvis-red)' : 'var(--jarvis-ac)'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 22 }}>{item.icon}</span>
              {item.alert && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--jarvis-red)', marginTop: 4 }} />}
            </div>
            <div className="jarvis-body" style={{ fontWeight: 700 }}>{item.label}</div>
            <div style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 800, fontSize: 20, color: item.alert ? 'var(--jarvis-red)' : 'var(--jarvis-ac)', marginTop: 2 }}>{item.stat}</div>
            <div className="jarvis-muted" style={{ fontSize: 10, marginTop: 2 }}>{item.sub}</div>
          </div>
        ))}
      </div>

      {packs.filter(p => p.status === 'failed').length > 0 && (
        <div className="jarvis-card" style={{ padding: 14, borderLeft: '3px solid var(--jarvis-red)' }}>
          <h4 className="jarvis-label" style={{ marginBottom: 8, color: 'var(--jarvis-red)' }}>Failed Packs</h4>
          {packs.filter(p => p.status === 'failed').slice(0, 5).map(p => (
            <div key={p.id} className="jarvis-row"><span className="jarvis-flex-1 jarvis-body" style={{ fontSize: 12 }}>{p.title}</span><PhasePill phase={p.phase} /></div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

const TABS: { id: WorkflowTab; label: string; icon: string }[] = [
  { id: 'project',      label: 'Project Setup', icon: '🏗️' },
  { id: 'scope',        label: 'Scope',        icon: '🔍' },
  { id: 'matrix',       label: 'Matrix',       icon: '📋' },
  { id: 'packs',        label: 'Packs',        icon: '📦' },
  { id: 'execute',      label: 'Execute',      icon: '▶' },
  { id: 'deficiencies', label: 'Deficiencies', icon: '🚨' },
  { id: 'turnover',     label: 'Turnover',     icon: '🏁' },
]

export function CxWorkflowView({ policy, onAudit, onToast }: CxWorkflowViewProps) {
  const [tab, setTab]         = useState<WorkflowTab>('project')
  const [selectedPack, setSP] = useState<CxPack | null>(null)

  const scopeResults  = useCxCollection<CxScopeResult>('cx_scope_results')
  const matrixRows    = useCxCollection<CxMatrixRow>('cx_matrix_rows')
  const packs         = useCxCollection<CxPack>('cx_packs')
  const executions    = useCxCollection<CxExecution>('cx_executions')
  const deficiencies  = useCxCollection<CxDeficiency>('cx_deficiencies')
  const retests       = useCxCollection<CxRetest>('cx_retests')
  const turnoverItems = useCxCollection<CxTurnoverItem>('cx_turnover_items')

  // Pull cx assets and contracts (systems) from existing biz state
  const ciAssets   = useBizStore(s => s.biz.ci_assets   ?? []) as Array<{ id: string; tag: string; type: string; system_id?: string; systemId?: string; description?: string }>
  const contracts  = useBizStore(s => s.biz.contracts    ?? []) as Array<{ id: string; project?: string; type?: string }>

  const assets: CxAsset[] = ciAssets.map(a => ({
    id:          String(a.id),
    systemId:    String(a.system_id ?? a.systemId ?? ''),
    tag:         String(a.tag ?? a.id),
    type:        String(a.type ?? 'pump'),
    description: a.description ? String(a.description) : undefined,
  }))

  const systems = contracts.map(c => ({ id: String(c.id), name: String(c.project ?? c.id), type: String(c.type ?? '') }))

  const { dispatch } = useMemo(() => createDispatch({
    policy,
    audit: onAudit ? e => onAudit(e) : undefined,
    toast: onToast ? (m, t) => onToast(m, t) : undefined,
  }), [policy, onAudit, onToast])

  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function updateCollection(key: string, items: unknown[]) {
    dispatch({ type: JARVIS_ACTIONS.UPDATE_COLLECTION, data: { collection: key, items } })
  }

  // ── Project Setup ────────────────────────────────────────────────────────────

  const projectTemplates = useMemo(() => listProjectTemplates(), [])

  const handleApplyProjectTemplate = useCallback(
    (key: ProjectTemplateKey, projectName: string, selected: Set<string>) => {
      const { system, assets: newAssets } = instantiateProjectTemplate(key, projectName, selected)

      // Append to existing biz collections — never replace.
      const nextContracts = [...contracts, { id: system.id, project: system.name, type: system.type }]
      const nextCiAssets  = [
        ...ciAssets,
        ...newAssets.map(a => ({
          id:          a.id,
          tag:         a.tag,
          type:        a.type,
          system_id:   a.systemId,
          description: a.description,
        })),
      ]

      updateCollection('contracts',  nextContracts)
      updateCollection('ci_assets',  nextCiAssets)
      onToast?.(`Created "${system.name}" with ${newAssets.length} asset${newAssets.length === 1 ? '' : 's'}`, 'success')
      setTab('matrix')
    },
    [contracts, ciAssets, dispatch, onToast],
  )

  // ── Scope ────────────────────────────────────────────────────────────────────

  const handleAnalyze = useCallback((_title: string, content: string) => {
    const result = analyzeScope(`doc-${Date.now()}`, content)
    updateCollection('cx_scope_results', [...scopeResults, result])
    onToast?.('Scope analyzed', 'success')
  }, [scopeResults, dispatch, onToast])

  // ── Matrix ───────────────────────────────────────────────────────────────────

  const handleGenerateMatrix = useCallback((systemId: string) => {
    const sysAssets = assets.filter(a => a.systemId === systemId)
    if (sysAssets.length === 0) { onToast?.('No assets found for this system', 'warn'); return }
    const newRows = generateMatrixRows(systemId, sysAssets)
    // Replace rows for this system, keep others
    const existing = matrixRows.filter(r => r.systemId !== systemId)
    updateCollection('cx_matrix_rows', [...existing, ...newRows])
    onToast?.(`Generated ${newRows.length} matrix rows`, 'success')
  }, [assets, matrixRows, dispatch, onToast])

  const existingPackIds = useMemo(() => new Set(packs.map(p => p.matrixRowId)), [packs])

  const handleGeneratePack = useCallback((row: CxMatrixRow) => {
    const pack = generatePack(row)
    updateCollection('cx_packs', [...packs, pack])
    // Mark matrix row as in_progress
    const updatedMatrix = matrixRows.map(r => r.id === row.id ? { ...r, status: 'in_progress' as const } : r)
    updateCollection('cx_matrix_rows', updatedMatrix)
    onToast?.(`Pack created: ${pack.title}`, 'success')
  }, [packs, matrixRows, dispatch, onToast])

  // ── Execution ────────────────────────────────────────────────────────────────

  const handleSubmitExecution = useCallback((packId: string, results: ResultMap) => {
    const pack = packs.find(p => p.id === packId)
    if (!pack) return

    const stepResults: CxStepResult[] = pack.steps.map(s => ({
      stepId:       s.id,
      passFail:     results[s.id]?.passFail ?? 'na',
      comments:     results[s.id]?.comments,
      actualResult: results[s.id]?.actual,
    }))

    const execStatus = resolveExecutionStatus(stepResults)
    const exec: CxExecution = {
      ...createExecution(packId),
      stepResults,
      status: execStatus,
      updatedAt: new Date().toISOString(),
    }

    const packStatus = execStatus === 'completed' ? 'completed' : 'failed'
    const updatedPacks = packs.map(p => p.id === packId ? { ...p, status: packStatus as CxPack['status'] } : p)

    // If failed, auto-create deficiency
    const failedSteps = stepResults.filter(r => r.passFail === 'fail')
    const newDefs: CxDeficiency[] = failedSteps.map(r => {
      const step = pack.steps.find(s => s.id === r.stepId)
      return {
        id:          `def-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        packId,
        title:       `Failed: ${step?.action ?? 'Step'}`,
        description: r.comments ?? r.actualResult ?? 'Step failed during execution.',
        severity:    'medium' as DefSeverity,
        status:      'open' as const,
        createdAt:   new Date().toISOString(),
      }
    })

    updateCollection('cx_executions', [...executions, exec])
    updateCollection('cx_packs',      updatedPacks)
    if (newDefs.length > 0) {
      updateCollection('cx_deficiencies', [...deficiencies, ...newDefs])
      onToast?.(`Execution submitted — ${newDefs.length} deficiency${newDefs.length > 1 ? 's' : ''} raised`, 'warn')
    } else {
      onToast?.('Execution complete — all steps passed ✓', 'success')
    }
  }, [packs, executions, deficiencies, dispatch, onToast])

  // ── Deficiencies ─────────────────────────────────────────────────────────────

  const handleCreateRetest = useCallback((def: CxDeficiency) => {
    const retest: CxRetest = {
      id:            `ret-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      deficiencyId:  def.id,
      originalPackId: def.packId,
      status:        'issued',
      createdAt:     new Date().toISOString(),
    }
    const updatedDefs = deficiencies.map(d => d.id === def.id ? { ...d, status: 'ready_for_retest' as const } : d)
    updateCollection('cx_retests',      [...retests, retest])
    updateCollection('cx_deficiencies', updatedDefs)
    onToast?.('Retest created', 'success')
  }, [deficiencies, retests, dispatch, onToast])

  const handleUpdateDefStatus = useCallback((id: string, status: CxDeficiency['status']) => {
    const updated = deficiencies.map(d => d.id === id ? { ...d, status } : d)
    updateCollection('cx_deficiencies', updated)
    onToast?.(`Deficiency ${status}`, 'info')
  }, [deficiencies, dispatch, onToast])

  // ── Turnover ──────────────────────────────────────────────────────────────────

  const handleGenerateTurnover = useCallback((systemId: string) => {
    const existing = turnoverItems.filter(t => t.systemId !== systemId)
    const newItems = generateDefaultTurnoverItems(systemId)
    updateCollection('cx_turnover_items', [...existing, ...newItems])
    onToast?.(`Seeded ${newItems.length} turnover items`, 'success')
  }, [turnoverItems, dispatch, onToast])

  const handleUpdateTurnover = useCallback((id: string, status: CxTurnoverItem['status']) => {
    const updated = turnoverItems.map(t => t.id === id ? { ...t, status } : t)
    updateCollection('cx_turnover_items', updated)
    onToast?.('Turnover item updated', 'success')
  }, [turnoverItems, dispatch, onToast])

  // ── Badge counts ──────────────────────────────────────────────────────────────

  const badgeCounts: Partial<Record<WorkflowTab, number>> = {
    matrix:       matrixRows.filter(r => r.status === 'not_started').length,
    packs:        packs.filter(p => p.status === 'failed').length,
    deficiencies: deficiencies.filter(d => d.status !== 'closed').length,
    turnover:     turnoverItems.filter(t => t.status === 'missing').length,
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div role="main" aria-label="Commissioning Workflow">
      {/* Summary KPIs */}
      {(matrixRows.length + packs.length + deficiencies.length + turnoverItems.length) > 0 && (
        <div style={{ marginBottom: 16 }}>
          <WorkflowDashboard
            matrix={matrixRows}
            packs={packs}
            deficiencies={deficiencies}
            turnover={turnoverItems}
            onTabChange={setTab}
          />
        </div>
      )}

      {/* Tab bar */}
      <div role="tablist" aria-label="Commissioning workflow" style={{
        display: 'flex', gap: 2, marginBottom: 16,
        background: 'var(--jarvis-cd)', borderRadius: 6, padding: 2, border: '1px solid var(--jarvis-bd)',
        overflowX: 'auto',
      }}>
        {TABS.map(t => {
          const badge = badgeCounts[t.id] ?? 0
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => { setTab(t.id); setSP(null) }}
              style={{
                flex: '0 0 auto', padding: '6px 10px', borderRadius: 5, border: 'none',
                background: tab === t.id ? 'color-mix(in srgb, var(--jarvis-ac) 18%, transparent)' : 'transparent',
                color:      tab === t.id ? 'var(--jarvis-ac)' : 'var(--jarvis-ts)',
                fontWeight: tab === t.id ? 700 : 500, fontSize: 11, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
              }}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              {badge > 0 && (
                <span style={{
                  background: t.id === 'deficiencies' ? 'var(--jarvis-red)' : 'var(--jarvis-amb)',
                  color: '#fff', borderRadius: 99, padding: '1px 5px', fontSize: 9, fontWeight: 700,
                }}>
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab panels */}
      {tab === 'project'      && (
        <ProjectSetupTab
          templates={projectTemplates}
          canWrite={canWrite}
          hasExistingAssets={ciAssets.length > 0}
          onApply={handleApplyProjectTemplate}
        />
      )}
      {tab === 'scope'        && <ScopeTab scopeResults={scopeResults} onAnalyze={handleAnalyze} />}
      {tab === 'matrix'       && (
        <MatrixTab
          assets={assets}
          systems={systems}
          matrix={matrixRows}
          canWrite={canWrite}
          onGenerateMatrix={handleGenerateMatrix}
          onGeneratePack={handleGeneratePack}
          existingPackIds={existingPackIds}
        />
      )}
      {tab === 'packs'        && (
        <PacksTab
          packs={packs}
          canWrite={canWrite}
          onStartExecution={p => { setTab('execute') }}
          onSelectPack={setSP}
          selectedPack={selectedPack}
        />
      )}
      {tab === 'execute'      && (
        <ExecuteTab
          packs={packs}
          executions={executions}
          canWrite={canWrite}
          onSubmitExecution={handleSubmitExecution}
        />
      )}
      {tab === 'deficiencies' && (
        <DeficienciesTab
          deficiencies={deficiencies}
          retests={retests}
          packs={packs}
          canWrite={canWrite}
          onCreateRetest={handleCreateRetest}
          onUpdateStatus={handleUpdateDefStatus}
        />
      )}
      {tab === 'turnover'     && (
        <TurnoverTab
          turnover={turnoverItems}
          systems={systems}
          canWrite={canWrite}
          onUpdateStatus={handleUpdateTurnover}
          onGenerateForSystem={handleGenerateTurnover}
        />
      )}
    </div>
  )
}

export default CxWorkflowView
