/**
 * JARVIS EPC — CommissioningBaselineView
 * ────────────────────────────────────────
 * Phase 21: The Commissioning Intelligence UI layer.
 *
 * Four panels implementing the Continuum Commissioning architecture:
 *   1. Asset Truth View   — baseline status, drift score, KPIs
 *   2. Baseline Viewer    — immutable baseline record + tests + setpoints
 *   3. Change Timeline    — post-handover drift log with impact heat
 *   4. Audit Package      — evidence chain generator and export
 *
 * Aesthetic: precision-industrial. Tight monospace data grids, hard-edge
 * status indicators, heat-mapped drift scoring. The UI communicates that
 * the data here is authoritative — not a dashboard, an instrument.
 *
 * Uses: JARVIS CSS tokens + utility classes, no external deps.
 */

import React, { useState, useMemo, useCallback } from 'react'
import { useBizStore }  from '../modules/biz/store'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'
import { type PolicyConfig } from '../modules/biz/dispatch'
import {
  computeAssetTruth,
  computeDrift,
  buildAuditPackage,
  validateBaseline,
  canFreezeBaseline,
  scoreToCCABand,
  isBaselineFrozen,
  type CIAsset,
  type CIBaseline,
  type CITest,
  type CISetpoint,
  type CIPMTask,
  type CIChangeEvent,
  type CIEvidence,
  type AssetTruthView,
  type DriftSummary,
  type AuditAnswerPackage,
} from '../modules/commissioning'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CommissioningBaselineViewProps {
  policy:      PolicyConfig
  onAudit?:    (entry: unknown) => void
  onToast?:    (msg: string, type: 'info' | 'success' | 'warn' | 'error') => void
  onNavigate?: (tab: string) => void
}

// ─── Panel type ───────────────────────────────────────────────────────────────

type CIPanel = 'truth' | 'baseline' | 'timeline' | 'audit'

// ─── Drift colours ────────────────────────────────────────────────────────────

function driftColor(score: number): string {
  if (score === 0)   return 'var(--jarvis-grn)'
  if (score <= 20)   return 'var(--jarvis-grn)'
  if (score <= 50)   return 'var(--jarvis-amb)'
  if (score <= 75)   return 'var(--jarvis-org)'
  return 'var(--jarvis-red)'
}

function driftBg(score: number): string {
  if (score === 0)   return 'rgba(34,197,94,0.08)'
  if (score <= 20)   return 'rgba(34,197,94,0.08)'
  if (score <= 50)   return 'rgba(245,158,11,0.08)'
  if (score <= 75)   return 'rgba(249,115,22,0.08)'
  return 'rgba(239,68,68,0.08)'
}

function bandLabel(score: number): string {
  const band = scoreToCCABand(score)
  const labels: Record<string, string> = {
    operationally_defendable:  'DEFENDABLE',
    latent_risk:               'LATENT RISK',
    high_failure_probability:  'HIGH RISK',
    commissioned_in_name_only: 'UNDEFENDABLE',
  }
  return labels[band] ?? band
}

// ─── Shared micro-components ──────────────────────────────────────────────────

function Field({ label, value, mono = false, accent }: {
  label: string; value: React.ReactNode; mono?: boolean; accent?: string
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
        color: 'var(--jarvis-td)', textTransform: 'uppercase', marginBottom: 2,
      }}>{label}</div>
      <div style={{
        fontSize: 12,
        fontFamily: mono ? 'var(--jarvis-font-mono)' : 'inherit',
        color: accent ?? 'var(--jarvis-tx)',
        lineHeight: 1.4,
      }}>{value ?? '—'}</div>
    </div>
  )
}

function Chip({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 7px',
      borderRadius: 3,
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color, background: bg,
      border: `1px solid ${color}22`,
    }}>{text}</span>
  )
}

function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderBottom: '1px solid var(--jarvis-bd)',
      paddingBottom: 8, marginBottom: 14,
    }}>
      <span style={{
        fontSize: 9, fontWeight: 800, letterSpacing: '0.16em',
        color: 'var(--jarvis-ts)', textTransform: 'uppercase',
      }}>{title}</span>
      {right}
    </div>
  )
}

function DriftMeter({ score }: { score: number }) {
  const color = driftColor(score)
  const inverted = 100 - score // health = inverse of drift
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{
        height: 4, background: 'var(--jarvis-bd)',
        borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${inverted}%`,
          background: color,
          borderRadius: 2,
          transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        }} />
      </div>
    </div>
  )
}

function ImpactDot({ impact }: { impact: string }) {
  const colors: Record<string, string> = {
    none: 'var(--jarvis-td)', low: 'var(--jarvis-grn)',
    medium: 'var(--jarvis-amb)', high: 'var(--jarvis-org)',
    critical: 'var(--jarvis-red)',
  }
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7,
      borderRadius: '50%', background: colors[impact] ?? 'var(--jarvis-ts)',
      marginRight: 5, flexShrink: 0,
    }} />
  )
}

function TestResultBadge({ result }: { result: string }) {
  const cfg: Record<string, [string, string]> = {
    pass:             ['var(--jarvis-grn)',  'rgba(34,197,94,0.1)'],
    fail:             ['var(--jarvis-red)',  'rgba(239,68,68,0.1)'],
    conditional_pass: ['var(--jarvis-amb)',  'rgba(245,158,11,0.1)'],
    deferred:         ['var(--jarvis-org)',  'rgba(249,115,22,0.1)'],
    not_applicable:   ['var(--jarvis-td)',   'var(--jarvis-cd)'],
  }
  const [color, bg] = cfg[result] ?? ['var(--jarvis-ts)', 'var(--jarvis-cd)']
  const labels: Record<string, string> = {
    pass: 'PASS', fail: 'FAIL', conditional_pass: 'COND', deferred: 'DEF', not_applicable: 'N/A',
  }
  return <Chip text={labels[result] ?? result} color={color} bg={bg} />
}

function StatusChip({ status }: { status: string }) {
  const cfg: Record<string, [string, string]> = {
    frozen:      ['var(--jarvis-cyn)',  'rgba(6,182,212,0.1)'],
    draft:       ['var(--jarvis-amb)',  'rgba(245,158,11,0.1)'],
    proposed:    ['var(--jarvis-blue)', 'rgba(59,130,246,0.1)'],
    approved:    ['var(--jarvis-grn)',  'rgba(34,197,94,0.1)'],
    implemented: ['var(--jarvis-pur)',  'rgba(167,139,250,0.1)'],
    rejected:    ['var(--jarvis-red)',  'rgba(239,68,68,0.1)'],
    rolled_back: ['var(--jarvis-org)',  'rgba(249,115,22,0.1)'],
    active:      ['var(--jarvis-grn)',  'rgba(34,197,94,0.1)'],
  }
  const [color, bg] = cfg[status] ?? ['var(--jarvis-ts)', 'var(--jarvis-cd)']
  return <Chip text={status.replace('_', ' ')} color={color} bg={bg} />
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyCI({ message }: { message: string }) {
  return (
    <div style={{
      textAlign: 'center', padding: '40px 0',
      color: 'var(--jarvis-td)', fontSize: 12,
    }}>
      <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>⬡</div>
      {message}
    </div>
  )
}

// ─── Panel 1: Asset Truth View ────────────────────────────────────────────────

function AssetTruthPanel({
  assets, baselines, tests, setpoints, pmTasks, changeEvents, evidence,
  selectedAssetId, onSelectAsset, onPanel, policy, onToast,
}: {
  assets: CIAsset[]
  baselines: CIBaseline[]
  tests: CITest[]
  setpoints: CISetpoint[]
  pmTasks: CIPMTask[]
  changeEvents: CIChangeEvent[]
  evidence: CIEvidence[]
  selectedAssetId: string | null
  onSelectAsset: (id: string) => void
  onPanel: (p: CIPanel) => void
  policy: PolicyConfig
  onToast?: (msg: string, type: 'info' | 'success' | 'warn' | 'error') => void
}) {
  const dispatch = useBizStore(s => s.dispatch)

  const driftSummaries: DriftSummary[] = useMemo(() =>
    assets.map(a => {
      const bl = baselines
        .filter(b => b.asset_id === a.id && isBaselineFrozen(b))
        .sort((x, y) => y.version - x.version)[0] ?? null
      const changes = changeEvents.filter(c => c.asset_id === a.id)
      return computeDrift(a, bl, changes)
    }),
    [assets, baselines, changeEvents]
  )

  const selected = selectedAssetId
    ? assets.find(a => a.id === selectedAssetId)
    : null

  const truth: AssetTruthView | null = useMemo(() => {
    if (!selected) return null
    return computeAssetTruth(selected, baselines, tests, setpoints, pmTasks, changeEvents, evidence)
  }, [selected, baselines, tests, setpoints, pmTasks, changeEvents, evidence])

  const handleFreeze = useCallback(() => {
    if (!truth?.active_baseline && selected) {
      const draftBl = baselines.find(b => b.asset_id === selected.id && b.status === 'draft')
      if (!draftBl) { onToast?.('No draft baseline found for this asset.', 'warn'); return }
      const validation = validateBaseline(
        draftBl,
        tests.filter(t => draftBl.test_ids.includes(t.id)),
        setpoints.filter(s => draftBl.setpoint_ids?.includes(s.id) ?? false),
        evidence.filter(e => draftBl.evidence_ids.includes(e.id)),
      )
      if (!validation.valid) {
        onToast?.(`Cannot freeze: ${validation.errors[0]}`, 'warn')
        return
      }
      const canFreeze = canFreezeBaseline(draftBl, baselines)
      if (!canFreeze.ok) { onToast?.(canFreeze.reason ?? 'Cannot freeze.', 'warn'); return }
      dispatch({ type: JARVIS_ACTIONS.CI_FREEZE_BASELINE, data: { id: draftBl.id, frozen_by: policy.activeRole } })
      onToast?.(`Baseline v${draftBl.version} frozen.`, 'success')
    }
  }, [truth, selected, baselines, tests, setpoints, evidence, dispatch, policy, onToast])

  return (
    <div>
      {/* Asset registry table */}
      <div className="jarvis-card" style={{ marginBottom: 16 }}>
        <SectionHeader
          title={`Asset Registry — ${assets.length} asset${assets.length !== 1 ? 's' : ''}`}
        />
        {!assets.length ? (
          <EmptyCI message="No assets registered. Add assets via the API or import." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--jarvis-bd)' }}>
                  {['Tag', 'Name', 'System', 'Class', 'Status', 'Baseline', 'Drift', 'Posture'].map(h => (
                    <th key={h} style={{
                      padding: '4px 8px', textAlign: 'left',
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                      color: 'var(--jarvis-td)', textTransform: 'uppercase',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assets.map((a, i) => {
                  const drift = driftSummaries.find(d => d.asset_id === a.id)
                  const score = drift?.drift_score ?? 100
                  const frozenBl = baselines.find(b => b.asset_id === a.id && isBaselineFrozen(b))
                  const isSelected = a.id === selectedAssetId
                  return (
                    <tr
                      key={a.id}
                      onClick={() => onSelectAsset(a.id)}
                      style={{
                        borderBottom: i < assets.length - 1 ? '1px solid var(--jarvis-bd)' : 'none',
                        background: isSelected ? 'rgba(59,130,246,0.06)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'background var(--jarvis-t-fast)',
                      }}
                    >
                      <td style={{ padding: '7px 8px', fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, color: 'var(--jarvis-ac)' }}>{a.tag}</td>
                      <td style={{ padding: '7px 8px', color: 'var(--jarvis-tx)' }}>{a.name}</td>
                      <td style={{ padding: '7px 8px', color: 'var(--jarvis-ts)', fontSize: 10 }}>{a.system}</td>
                      <td style={{ padding: '7px 8px' }}><Chip text={a.class} color="var(--jarvis-ts)" bg="var(--jarvis-cd)" /></td>
                      <td style={{ padding: '7px 8px' }}><StatusChip status={a.status} /></td>
                      <td style={{ padding: '7px 8px', fontFamily: 'var(--jarvis-font-mono)', fontSize: 10, color: frozenBl ? 'var(--jarvis-cyn)' : 'var(--jarvis-td)' }}>
                        {frozenBl ? `v${frozenBl.version} ❄` : 'draft'}
                      </td>
                      <td style={{ padding: '7px 8px', minWidth: 80 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <DriftMeter score={score} />
                          <span style={{ fontSize: 10, fontFamily: 'var(--jarvis-font-mono)', color: driftColor(score), flexShrink: 0 }}>{score}</span>
                        </div>
                      </td>
                      <td style={{ padding: '7px 8px' }}>
                        <Chip text={bandLabel(score)} color={driftColor(score)} bg={driftBg(score)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Selected asset detail */}
      {truth && selected && (
        <div className="jarvis-card" style={{ borderColor: 'var(--jarvis-ac)22' }}>
          <SectionHeader
            title={`Asset Detail — ${selected.tag}`}
            right={
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {truth.audit_ready && (
                  <Chip text="AUDIT READY" color="var(--jarvis-grn)" bg="rgba(34,197,94,0.1)" />
                )}
                {!truth.active_baseline && (
                  <button
                    className="jarvis-btn jarvis-btn-sm"
                    style={{ background: 'var(--jarvis-cyn)', color: '#000', borderColor: 'var(--jarvis-cyn)' }}
                    onClick={handleFreeze}
                  >Freeze Baseline</button>
                )}
                <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={() => onPanel('baseline')}>View Baseline →</button>
              </div>
            }
          />

          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Baseline',  value: truth.active_baseline ? `v${truth.active_baseline.version} ❄` : 'None', color: truth.active_baseline ? 'var(--jarvis-cyn)' : 'var(--jarvis-red)' },
              { label: 'Tests',     value: truth.tests.length, color: 'var(--jarvis-tx)' },
              { label: 'Setpoints', value: truth.setpoints.length, color: 'var(--jarvis-tx)' },
              { label: 'Changes',   value: truth.change_events.length, color: truth.change_events.length ? 'var(--jarvis-amb)' : 'var(--jarvis-tx)' },
              { label: 'Drift',     value: truth.drift_score, color: driftColor(truth.drift_score) },
            ].map(kpi => (
              <div key={kpi.label} style={{
                background: 'var(--jarvis-cd)', border: '1px solid var(--jarvis-bd)',
                borderRadius: 6, padding: '10px 12px',
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--jarvis-td)', textTransform: 'uppercase', marginBottom: 4 }}>{kpi.label}</div>
                <div style={{ fontSize: 20, fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
              </div>
            ))}
          </div>

          {/* Drift meter */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--jarvis-td)', textTransform: 'uppercase' }}>Drift from Baseline</span>
              <span style={{ fontSize: 9, color: driftColor(truth.drift_score), fontFamily: 'var(--jarvis-font-mono)' }}>{bandLabel(truth.drift_score)}</span>
            </div>
            <div style={{ height: 6, background: 'var(--jarvis-bd)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${truth.drift_score}%`, background: driftColor(truth.drift_score), borderRadius: 3, transition: 'width 0.6s ease' }} />
            </div>
          </div>

          {/* Asset fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 24px' }}>
            <Field label="Tag"          value={selected.tag}          mono />
            <Field label="System"       value={selected.system} />
            <Field label="Class"        value={selected.class} />
            <Field label="Manufacturer" value={selected.manufacturer} />
            <Field label="Model"        value={selected.model} />
            <Field label="Serial"       value={selected.serial}       mono />
          </div>

          {/* Active PM tasks summary */}
          {truth.pm_tasks.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--jarvis-td)', textTransform: 'uppercase', marginBottom: 6 }}>Active PM Tasks ({truth.pm_tasks.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {truth.pm_tasks.map(pm => (
                  <div key={pm.id} style={{
                    background: 'var(--jarvis-cd)', border: '1px solid var(--jarvis-bd)',
                    borderRadius: 4, padding: '4px 8px', fontSize: 10,
                  }}>
                    <span style={{ color: 'var(--jarvis-ts)' }}>{pm.title}</span>
                    <span style={{ marginLeft: 6, color: 'var(--jarvis-td)', fontSize: 9 }}>· {pm.frequency}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Panel 2: Baseline Viewer ─────────────────────────────────────────────────

function BaselinePanel({
  truth, onPanel,
}: {
  truth: AssetTruthView | null
  onPanel: (p: CIPanel) => void
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'tests' | 'setpoints'>('overview')

  if (!truth) return <EmptyCI message="Select an asset from the Asset Truth View." />

  const { active_baseline: bl, tests, setpoints, baseline_history } = truth

  if (!bl) return (
    <div className="jarvis-card">
      <SectionHeader title="Baseline Viewer" />
      <div style={{
        background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
        borderRadius: 6, padding: 16, textAlign: 'center',
      }}>
        <div style={{ color: 'var(--jarvis-red)', fontWeight: 700, marginBottom: 4 }}>No Frozen Baseline</div>
        <div style={{ color: 'var(--jarvis-ts)', fontSize: 11 }}>This asset has not been commissioned and frozen. Freeze a draft baseline from the Asset Truth View.</div>
      </div>
    </div>
  )

  return (
    <div>
      {/* Baseline header card */}
      <div className="jarvis-card" style={{ marginBottom: 12, borderColor: 'rgba(6,182,212,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--jarvis-cyn)' }}>
                v{bl.version}
              </span>
              <StatusChip status="frozen" />
              <span style={{ fontSize: 10, color: 'var(--jarvis-td)' }}>IMMUTABLE RECORD</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{bl.id}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: 'var(--jarvis-td)', letterSpacing: '0.1em', marginBottom: 2 }}>FROZEN</div>
            <div style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 10, color: 'var(--jarvis-cyn)' }}>
              {bl.frozen_at ? new Date(bl.frozen_at).toLocaleDateString() : '—'}
            </div>
            <div style={{ fontSize: 9, color: 'var(--jarvis-td)' }}>by {bl.frozen_by}</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--jarvis-tx)', marginBottom: 10, lineHeight: 1.5 }}>{bl.scope}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <Field label="Conditions"  value={bl.conditions} />
          <Field label="Witness"     value={bl.witness} />
          <Field label="Contract"    value={bl.contract_ref} mono />
          <Field label="ITP Ref"     value={bl.itp_ref}  mono />
        </div>
        {bl.deferred_items?.length ? (
          <div style={{
            background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.2)',
            borderRadius: 4, padding: '8px 10px', marginTop: 8,
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--jarvis-org)', letterSpacing: '0.1em', marginBottom: 4 }}>DEFERRED ITEMS ({bl.deferred_items.length})</div>
            {bl.deferred_items.map((d, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginBottom: 2 }}>· {d}</div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Version history strip */}
      {baseline_history.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {baseline_history.sort((a, b) => a.version - b.version).map(h => (
            <div key={h.id} style={{
              padding: '4px 10px', borderRadius: 4,
              background: h.id === bl.id ? 'rgba(6,182,212,0.12)' : 'var(--jarvis-cd)',
              border: `1px solid ${h.id === bl.id ? 'rgba(6,182,212,0.4)' : 'var(--jarvis-bd)'}`,
              fontSize: 10, fontFamily: 'var(--jarvis-font-mono)',
              color: h.id === bl.id ? 'var(--jarvis-cyn)' : 'var(--jarvis-ts)',
            }}>
              v{h.version} {isBaselineFrozen(h) ? '❄' : '∆'}
            </div>
          ))}
        </div>
      )}

      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '1px solid var(--jarvis-bd)' }}>
        {(['overview', 'tests', 'setpoints'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '7px 14px', border: 'none', cursor: 'pointer',
              background: 'transparent',
              borderBottom: activeTab === tab ? '2px solid var(--jarvis-ac)' : '2px solid transparent',
              color: activeTab === tab ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)',
              fontSize: 11, fontWeight: activeTab === tab ? 700 : 400,
              transition: 'all var(--jarvis-t-fast)', textTransform: 'capitalize',
            }}
          >
            {tab} {tab === 'tests' && `(${tests.length})`}{tab === 'setpoints' && `(${setpoints.length})`}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="jarvis-card">
            <SectionHeader title="Test Coverage" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {['pass', 'conditional_pass', 'deferred', 'fail', 'not_applicable'].map(r => {
                const count = tests.filter(t => t.result === r).length
                if (!count) return null
                return (
                  <div key={r} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                    <TestResultBadge result={r} />
                    <span style={{ fontFamily: 'var(--jarvis-font-mono)', color: 'var(--jarvis-ts)' }}>{count}</span>
                  </div>
                )
              })}
              {!tests.length && <div style={{ color: 'var(--jarvis-td)', fontSize: 11 }}>No tests linked.</div>}
            </div>
          </div>
          <div className="jarvis-card">
            <SectionHeader title="Evidence" />
            <Field label="Total records" value={`${truth.evidence.length}`} mono />
            <Field label="Hashed" value={`${truth.evidence.filter(e => e.content_hash).length}`} mono />
            <Field label="Audit ready" value={truth.audit_ready ? '✓ Yes' : '✗ No'} accent={truth.audit_ready ? 'var(--jarvis-grn)' : 'var(--jarvis-red)'} />
          </div>
        </div>
      )}

      {/* Tests tab */}
      {activeTab === 'tests' && (
        <div className="jarvis-card">
          {!tests.length ? <EmptyCI message="No tests linked to this baseline." /> : (
            tests.map((t, i) => (
              <div key={t.id} style={{
                padding: '10px 0',
                borderBottom: i < tests.length - 1 ? '1px solid var(--jarvis-bd)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 10, color: 'var(--jarvis-ac)' }}>{t.tag}</span>
                    <Chip text={t.type} color="var(--jarvis-pur)" bg="rgba(167,139,250,0.1)" />
                    <TestResultBadge result={t.result} />
                  </div>
                  <span style={{ fontSize: 9, color: 'var(--jarvis-td)', fontFamily: 'var(--jarvis-font-mono)' }}>
                    {new Date(t.tested_at).toLocaleDateString()} · {t.tested_by}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{t.description}</div>
                <div style={{ fontSize: 9, color: 'var(--jarvis-td)', marginTop: 3 }}>Procedure: {t.procedure_ref}</div>
                {t.deficiencies?.length ? (
                  <div style={{ marginTop: 6 }}>
                    {t.deficiencies.map((d, di) => (
                      <div key={di} style={{ fontSize: 10, color: 'var(--jarvis-red)', marginBottom: 2 }}>⚠ {d}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}

      {/* Setpoints tab */}
      {activeTab === 'setpoints' && (
        <div className="jarvis-card">
          {!setpoints.length ? <EmptyCI message="No setpoints linked to this baseline." /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--jarvis-bd)' }}>
                  {['Tag', 'Parameter', 'Category', 'As-Tested Value', 'OEM Default', 'Unit', 'Verified By'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--jarvis-td)', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {setpoints.map((sp, i) => (
                  <tr key={sp.id} style={{ borderBottom: i < setpoints.length - 1 ? '1px solid var(--jarvis-bd)' : 'none' }}>
                    <td style={{ padding: '7px 8px', fontFamily: 'var(--jarvis-font-mono)', color: 'var(--jarvis-ac)' }}>{sp.tag}</td>
                    <td style={{ padding: '7px 8px', color: 'var(--jarvis-tx)' }}>{sp.parameter}</td>
                    <td style={{ padding: '7px 8px' }}><Chip text={sp.category} color="var(--jarvis-ts)" bg="var(--jarvis-cd)" /></td>
                    <td style={{ padding: '7px 8px', fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, color: 'var(--jarvis-cyn)' }}>{String(sp.value)}</td>
                    <td style={{ padding: '7px 8px', fontFamily: 'var(--jarvis-font-mono)', color: 'var(--jarvis-td)' }}>{sp.oem_default != null ? String(sp.oem_default) : '—'}</td>
                    <td style={{ padding: '7px 8px', color: 'var(--jarvis-ts)' }}>{sp.unit ?? '—'}</td>
                    <td style={{ padding: '7px 8px', color: 'var(--jarvis-td)', fontSize: 10 }}>{sp.verified_by}</td>
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

// ─── Panel 3: Change Impact Timeline ──────────────────────────────────────────

function ChangeTimelinePanel({ truth }: { truth: AssetTruthView | null }) {
  const [filter, setFilter] = useState<string>('all')

  if (!truth) return <EmptyCI message="Select an asset from the Asset Truth View." />

  const allChanges = truth.change_events
    .slice()
    .sort((a, b) => {
      const ta = a.created_at, tb = b.created_at
      return tb.localeCompare(ta)
    })

  const statuses = ['all', ...Array.from(new Set(allChanges.map(c => c.status)))]
  const filtered = filter === 'all' ? allChanges : allChanges.filter(c => c.status === filter)

  const dispatch = useBizStore(s => s.dispatch)

  const handleApprove = (ce: CIChangeEvent) => {
    dispatch({
      type: JARVIS_ACTIONS.CI_UPDATE_CHANGE_STATUS,
      data: { id: ce.id, status: 'approved', approved_by: 'current-user', approved_at: new Date().toISOString() },
    })
  }

  const handleImplement = (ce: CIChangeEvent) => {
    dispatch({
      type: JARVIS_ACTIONS.CI_UPDATE_CHANGE_STATUS,
      data: { id: ce.id, status: 'implemented', implemented_at: new Date().toISOString(), implemented_by: 'current-user' },
    })
  }

  const drift = computeDrift(truth.asset, truth.active_baseline, truth.change_events)

  return (
    <div>
      {/* Drift summary card */}
      <div className="jarvis-card" style={{ marginBottom: 12, borderColor: `${driftColor(drift.drift_score)}33` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--jarvis-td)', textTransform: 'uppercase', marginBottom: 2 }}>Change Impact — {truth.asset.tag}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 32, fontFamily: 'var(--jarvis-font-mono)', fontWeight: 800, color: driftColor(drift.drift_score) }}>{drift.drift_score}</span>
              <span style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>/ 100 drift</span>
              <Chip text={bandLabel(drift.drift_score)} color={driftColor(drift.drift_score)} bg={driftBg(drift.drift_score)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              { l: 'Open',       v: drift.open_changes,         c: drift.open_changes ? 'var(--jarvis-amb)' : 'var(--jarvis-td)' },
              { l: 'Unapproved', v: drift.unapproved_changes,   c: drift.unapproved_changes ? 'var(--jarvis-red)' : 'var(--jarvis-td)' },
              { l: 'High Impact', v: drift.high_impact_changes, c: drift.high_impact_changes ? 'var(--jarvis-org)' : 'var(--jarvis-td)' },
            ].map(kpi => (
              <div key={kpi.l} style={{ background: 'var(--jarvis-cd)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, padding: '8px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--jarvis-td)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>{kpi.l}</div>
                <div style={{ fontSize: 20, fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, color: kpi.c }}>{kpi.v}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Drift bar */}
        <div style={{ height: 6, background: 'var(--jarvis-bd)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${drift.drift_score}%`, background: driftColor(drift.drift_score), borderRadius: 3, transition: 'width 0.6s ease' }} />
        </div>
        {drift.flags.map((f, i) => (
          <div key={i} style={{ marginTop: 8, fontSize: 10, color: 'var(--jarvis-amb)' }}>⚠ {f}</div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              padding: '4px 10px', border: `1px solid ${filter === s ? 'var(--jarvis-ac)' : 'var(--jarvis-bd)'}`,
              borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: filter === s ? 700 : 400,
              background: filter === s ? 'rgba(59,130,246,0.1)' : 'var(--jarvis-cd)',
              color: filter === s ? 'var(--jarvis-ac)' : 'var(--jarvis-ts)',
            }}
          >
            {s === 'all' ? `All (${allChanges.length})` : `${s} (${allChanges.filter(c => c.status === s).length})`}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {!filtered.length ? (
        <EmptyCI message="No change events recorded against this baseline." />
      ) : (
        <div style={{ position: 'relative' }}>
          {/* Vertical spine */}
          <div style={{
            position: 'absolute', left: 11, top: 0, bottom: 0,
            width: 1, background: 'var(--jarvis-bd)',
          }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(ce => (
              <div key={ce.id} style={{ display: 'flex', gap: 16, position: 'relative' }}>
                {/* Dot */}
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 10,
                  background: driftColor({ none: 0, low: 15, medium: 40, high: 70, critical: 90 }[ce.impact] ?? 50),
                  border: '2px solid var(--jarvis-bg)', zIndex: 1,
                  boxShadow: `0 0 0 1px ${driftColor({ none: 0, low: 15, medium: 40, high: 70, critical: 90 }[ce.impact] ?? 50)}`,
                }} />
                {/* Card */}
                <div className="jarvis-card" style={{ flex: 1, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--jarvis-tx)' }}>{ce.title}</span>
                      <StatusChip status={ce.status} />
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <ImpactDot impact={ce.impact} />
                        <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: driftColor({ none: 0, low: 15, medium: 40, high: 70, critical: 90 }[ce.impact] ?? 50) }}>{ce.impact}</span>
                      </div>
                      <Chip text={ce.type.replace('_', ' ')} color="var(--jarvis-ts)" bg="var(--jarvis-cd)" />
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 9, fontFamily: 'var(--jarvis-font-mono)', color: 'var(--jarvis-td)' }}>
                        {new Date(ce.created_at).toLocaleDateString()}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--jarvis-td)' }}>{ce.requested_by}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginBottom: 4, lineHeight: 1.5 }}>{ce.description}</div>
                  <div style={{ fontSize: 10, color: 'var(--jarvis-td)' }}>Reason: {ce.reason}</div>
                  {ce.previous_value && ce.new_value && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 10, color: 'var(--jarvis-red)' }}>{ce.previous_value}</span>
                      <span style={{ color: 'var(--jarvis-td)', fontSize: 10 }}>→</span>
                      <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 10, color: 'var(--jarvis-grn)' }}>{ce.new_value}</span>
                    </div>
                  )}
                  {ce.approved_by && (
                    <div style={{ marginTop: 6, fontSize: 9, color: 'var(--jarvis-grn)' }}>
                      ✓ Approved by {ce.approved_by} · {ce.approved_at ? new Date(ce.approved_at).toLocaleDateString() : ''}
                    </div>
                  )}
                  {/* Action buttons */}
                  {ce.status === 'proposed' && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button className="jarvis-btn jarvis-btn-sm" style={{ background: 'var(--jarvis-grn)', color: '#000', borderColor: 'var(--jarvis-grn)', fontSize: 10 }} onClick={() => handleApprove(ce)}>Approve</button>
                      <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" style={{ fontSize: 10, color: 'var(--jarvis-red)', borderColor: 'var(--jarvis-red)' }}
                        onClick={() => useBizStore.getState().dispatch({ type: JARVIS_ACTIONS.CI_UPDATE_CHANGE_STATUS, data: { id: ce.id, status: 'rejected' } })}>
                        Reject
                      </button>
                    </div>
                  )}
                  {ce.status === 'approved' && (
                    <button className="jarvis-btn jarvis-btn-sm" style={{ marginTop: 8, fontSize: 10 }} onClick={() => handleImplement(ce)}>Mark Implemented</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Panel 4: Audit Package ───────────────────────────────────────────────────

function AuditPanel({ truth }: { truth: AssetTruthView | null }) {
  const [query, setQuery] = useState('')
  const [pkg, setPkg] = useState<AuditAnswerPackage | null>(null)

  if (!truth) return <EmptyCI message="Select an asset from the Asset Truth View." />

  const canGenerate = truth.audit_ready && query.trim().length > 0

  const handleGenerate = () => {
    if (!canGenerate) return
    const result = buildAuditPackage(truth, query, 'current-user')
    setPkg(result)
  }

  return (
    <div>
      {/* Audit readiness summary */}
      <div className="jarvis-card" style={{ marginBottom: 12, borderColor: truth.audit_ready ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--jarvis-td)', textTransform: 'uppercase', marginBottom: 4 }}>Audit Readiness — {truth.asset.tag}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 24, fontWeight: 800, color: truth.audit_ready ? 'var(--jarvis-grn)' : 'var(--jarvis-red)' }}>
                {truth.audit_ready ? '✓ READY' : '✗ NOT READY'}
              </span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <div style={{ textAlign: 'center', background: 'var(--jarvis-cd)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: 9, color: 'var(--jarvis-td)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Baseline</div>
              <div style={{ fontSize: 14, fontFamily: 'var(--jarvis-font-mono)', color: truth.active_baseline ? 'var(--jarvis-cyn)' : 'var(--jarvis-red)' }}>{truth.active_baseline ? '❄' : '✗'}</div>
            </div>
            <div style={{ textAlign: 'center', background: 'var(--jarvis-cd)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: 9, color: 'var(--jarvis-td)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Evidence</div>
              <div style={{ fontSize: 14, fontFamily: 'var(--jarvis-font-mono)', color: truth.evidence.filter(e => e.content_hash).length ? 'var(--jarvis-grn)' : 'var(--jarvis-red)' }}>
                {truth.evidence.filter(e => e.content_hash).length}
              </div>
            </div>
            <div style={{ textAlign: 'center', background: 'var(--jarvis-cd)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: 9, color: 'var(--jarvis-td)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Tests</div>
              <div style={{ fontSize: 14, fontFamily: 'var(--jarvis-font-mono)', color: truth.tests.length ? 'var(--jarvis-grn)' : 'var(--jarvis-red)' }}>{truth.tests.length}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Query input */}
      <div className="jarvis-card" style={{ marginBottom: 12 }}>
        <SectionHeader title="Audit Answer Generator" />
        <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginBottom: 10, lineHeight: 1.5 }}>
          Enter an audit question. The system will assemble the evidence chain and produce a structured package — no AI, no hallucination. Every claim is traceable to a document with a content hash.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="e.g. Prove P-101A was functionally tested and accepted"
            style={{
              flex: 1, padding: '8px 10px',
              background: 'var(--jarvis-cd)', border: '1px solid var(--jarvis-bd)',
              borderRadius: 4, color: 'var(--jarvis-tx)', fontSize: 12,
              outline: 'none',
            }}
            onFocus={e => { e.target.style.borderColor = 'var(--jarvis-ac)' }}
            onBlur={e => { e.target.style.borderColor = 'var(--jarvis-bd)' }}
            onKeyDown={e => { if (e.key === 'Enter' && canGenerate) handleGenerate() }}
          />
          <button
            className="jarvis-btn"
            disabled={!canGenerate}
            onClick={handleGenerate}
            style={{
              opacity: canGenerate ? 1 : 0.4,
              cursor: canGenerate ? 'pointer' : 'not-allowed',
            }}
          >
            Generate Package
          </button>
        </div>
        {!truth.audit_ready && (
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--jarvis-red)' }}>
            ⚠ Audit package cannot be generated — readiness check failed. Ensure the baseline is frozen and all evidence records have content hashes.
          </div>
        )}
      </div>

      {/* Generated package */}
      {pkg && (
        <div className="jarvis-card" style={{ borderColor: 'rgba(34,197,94,0.2)' }}>
          <SectionHeader
            title="Audit Answer Package"
            right={
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 9, fontFamily: 'var(--jarvis-font-mono)', color: 'var(--jarvis-td)' }}>
                  {new Date(pkg.generated_at).toLocaleString()}
                </span>
                <Chip text="EVIDENCE-BACKED" color="var(--jarvis-grn)" bg="rgba(34,197,94,0.1)" />
              </div>
            }
          />

          {/* Narrative */}
          <div style={{
            background: 'var(--jarvis-cd)', border: '1px solid var(--jarvis-bd)',
            borderRadius: 6, padding: 12, marginBottom: 12,
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--jarvis-pur)', textTransform: 'uppercase', marginBottom: 6 }}>
              NARRATIVE · ADVISORY ONLY — NOT AUTHORITATIVE
            </div>
            <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', lineHeight: 1.6 }}>{pkg.narrative}</div>
          </div>

          {/* Baseline ref */}
          <Field label="Baseline Reference" value={pkg.baseline_ref} mono accent="var(--jarvis-cyn)" />

          {/* Evidence chain */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--jarvis-td)', textTransform: 'uppercase', marginBottom: 8 }}>
              Evidence Chain ({pkg.evidence_chain.length} hashed records)
            </div>
            {!pkg.evidence_chain.length ? (
              <div style={{ color: 'var(--jarvis-td)', fontSize: 11 }}>No hashed evidence records.</div>
            ) : (
              pkg.evidence_chain.map((ev, i) => (
                <div key={ev.id} style={{
                  background: 'var(--jarvis-cd)', border: '1px solid var(--jarvis-bd)',
                  borderRadius: 4, padding: '8px 10px', marginBottom: 6,
                  display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'start',
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--jarvis-tx)' }}>{ev.title}</span>
                      <Chip text={ev.type.replace('_', ' ')} color="var(--jarvis-ts)" bg="transparent" />
                    </div>
                    <div style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 9, color: 'var(--jarvis-td)', wordBreak: 'break-all' }}>
                      SHA-256: {ev.hash}
                    </div>
                    <a href={ev.uri} style={{ fontSize: 9, color: 'var(--jarvis-ac)', textDecoration: 'none' }} target="_blank" rel="noreferrer">
                      {ev.uri}
                    </a>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 9, fontFamily: 'var(--jarvis-font-mono)', color: 'var(--jarvis-td)' }}>
                      {new Date(ev.uploaded_at).toLocaleDateString()}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--jarvis-grn)', fontWeight: 700 }}>✓ HASHED</div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Change timeline */}
          {pkg.change_timeline.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--jarvis-td)', textTransform: 'uppercase', marginBottom: 8 }}>
                Change Timeline ({pkg.change_timeline.length} events)
              </div>
              {pkg.change_timeline.map((ct, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '6px 0', borderBottom: i < pkg.change_timeline.length - 1 ? '1px solid var(--jarvis-bd)' : 'none',
                }}>
                  <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 9, color: 'var(--jarvis-td)', flexShrink: 0, paddingTop: 2 }}>
                    {new Date(ct.ts).toLocaleDateString()}
                  </span>
                  <StatusChip status={ct.status} />
                  <span style={{ fontSize: 11, color: 'var(--jarvis-ts)', flex: 1 }}>{ct.description}</span>
                  {ct.approved_by && (
                    <span style={{ fontSize: 9, color: 'var(--jarvis-grn)', flexShrink: 0 }}>✓ {ct.approved_by}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CommissioningBaselineView({
  policy, onAudit, onToast, onNavigate,
}: CommissioningBaselineViewProps) {
  const [panel, setPanel] = useState<CIPanel>('truth')
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)

  // Pull all CI collections from the Zustand biz store
  const ciAssets        = useBizStore(s => (s.biz.ci_assets        as CIAsset[])        ?? [])
  const ciBaselines     = useBizStore(s => (s.biz.ci_baselines     as CIBaseline[])     ?? [])
  const ciTests         = useBizStore(s => (s.biz.ci_tests         as CITest[])         ?? [])
  const ciSetpoints     = useBizStore(s => (s.biz.ci_setpoints     as CISetpoint[])     ?? [])
  const ciPMTasks       = useBizStore(s => (s.biz.ci_pm_tasks      as CIPMTask[])       ?? [])
  const ciChangeEvents  = useBizStore(s => (s.biz.ci_change_events as CIChangeEvent[])  ?? [])
  const ciEvidence      = useBizStore(s => (s.biz.ci_evidence      as CIEvidence[])     ?? [])

  const selectedAsset = selectedAssetId ? ciAssets.find(a => a.id === selectedAssetId) ?? null : null

  const truth: AssetTruthView | null = useMemo(() => {
    if (!selectedAsset) return null
    return computeAssetTruth(selectedAsset, ciBaselines, ciTests, ciSetpoints, ciPMTasks, ciChangeEvents, ciEvidence)
  }, [selectedAsset, ciBaselines, ciTests, ciSetpoints, ciPMTasks, ciChangeEvents, ciEvidence])

  const PANELS: { id: CIPanel; label: string; desc: string }[] = [
    { id: 'truth',    label: 'Asset Truth View',     desc: 'Registry, drift scores, KPIs' },
    { id: 'baseline', label: 'Baseline Viewer',      desc: 'Immutable commissioning record' },
    { id: 'timeline', label: 'Change Timeline',      desc: 'Post-handover drift log' },
    { id: 'audit',    label: 'Audit Package',         desc: 'Evidence chain generator' },
  ]

  return (
    <div style={{ background: 'var(--jarvis-bg)', minHeight: '100%', color: 'var(--jarvis-tx)' }}>

      {/* Header */}
      <div style={{
        background: 'var(--jarvis-sf)',
        borderBottom: '1px solid var(--jarvis-bd)',
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--jarvis-cyn)',
              boxShadow: '0 0 6px var(--jarvis-cyn)',
            }} />
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>
              Commissioning Intelligence
            </span>
            <Chip text="CONTINUUM" color="var(--jarvis-cyn)" bg="rgba(6,182,212,0.1)" />
          </div>
          <div style={{ fontSize: 10, color: 'var(--jarvis-td)', marginTop: 2, marginLeft: 14 }}>
            {selectedAsset ? `${selectedAsset.tag} — ${selectedAsset.name}` : 'No asset selected'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, color: 'var(--jarvis-td)', fontFamily: 'var(--jarvis-font-mono)' }}>
            {ciAssets.length} assets · {ciBaselines.filter(b => isBaselineFrozen(b)).length} frozen
          </span>
        </div>
      </div>

      {/* Panel navigation */}
      <div style={{
        display: 'flex', background: 'var(--jarvis-sf)',
        borderBottom: '1px solid var(--jarvis-bd)',
        padding: '0 16px', gap: 0,
      }}>
        {PANELS.map(p => (
          <button
            key={p.id}
            onClick={() => setPanel(p.id)}
            style={{
              padding: '10px 16px', border: 'none', cursor: 'pointer',
              background: 'transparent',
              borderBottom: panel === p.id ? '2px solid var(--jarvis-cyn)' : '2px solid transparent',
              color: panel === p.id ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)',
              fontSize: 11, fontWeight: panel === p.id ? 700 : 400,
              transition: 'all var(--jarvis-t-fast)',
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1,
            }}
          >
            <span>{p.label}</span>
            <span style={{ fontSize: 9, color: 'var(--jarvis-td)', fontWeight: 400 }}>{p.desc}</span>
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div style={{ padding: 16 }}>
        {panel === 'truth' && (
          <AssetTruthPanel
            assets={ciAssets}
            baselines={ciBaselines}
            tests={ciTests}
            setpoints={ciSetpoints}
            pmTasks={ciPMTasks}
            changeEvents={ciChangeEvents}
            evidence={ciEvidence}
            selectedAssetId={selectedAssetId}
            onSelectAsset={id => { setSelectedAssetId(id); }}
            onPanel={setPanel}
            policy={policy}
            onToast={onToast}
          />
        )}
        {panel === 'baseline' && <BaselinePanel truth={truth} onPanel={setPanel} />}
        {panel === 'timeline' && <ChangeTimelinePanel truth={truth} />}
        {panel === 'audit'    && <AuditPanel truth={truth} />}
      </div>
    </div>
  )
}

export default CommissioningBaselineView
