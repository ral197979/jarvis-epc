/**
 * JARVIS EPC — EngineeringView  ·  Engineering Overview
 */
import React, { useState, useEffect } from 'react'
import { useBizStore }  from '../modules/biz/store'
import { KpiCard }      from './KpiCard'
import { StatusBadge }  from './StatusBadge'
import { AoView }       from './AoView'
import { AtView }       from './AtView'
import { CalcView }     from './CalcView'
import type { PolicyConfig } from '../modules/biz/dispatch'

// ─── PlantImportPanel (G3) ────────────────────────────────────────────────────

interface PlantTag { tag: string; service: string; unit?: string; discipline?: string; source_system?: string }

function PlantImportPanel() {
  const [jsonText, setJsonText]       = useState('')
  const [sourceSystem, setSourceSystem] = useState('AVEVA')
  const [result, setResult]           = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [tags, setTags]               = useState<PlantTag[]>([])
  const [loadingTags, setLoadingTags] = useState(false)

  const fetchTags = () => {
    setLoadingTags(true)
    fetch('/api/v1/import/plant', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setTags(d.tags ?? []))
      .catch(() => setTags([]))
      .finally(() => setLoadingTags(false))
  }

  useEffect(() => { fetchTags() }, [])

  const submit = async (dryRun: boolean) => {
    setResult(null)
    setError(null)
    let data: unknown
    try { data = JSON.parse(jsonText) } catch { setError('Invalid JSON — paste an array of tag objects'); return }
    try {
      const res = await fetch('/api/v1/import/plant', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun, source_system: sourceSystem, data }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Request failed'); return }
      setResult(json.message ?? JSON.stringify(json))
      if (!dryRun) fetchTags()
    } catch { setError('Network error') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="jarvis-card" style={{ padding: 16 }}>
        <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Import Plant Tags (P&amp;ID / Equipment / Instruments)</h4>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 4 }}>Source System</label>
          <select value={sourceSystem} onChange={e => setSourceSystem(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 12, background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-tx)', minWidth: 200 }}>
            <option>AVEVA</option>
            <option>Hexagon SmartPID</option>
            <option>Bentley OpenPlant</option>
            <option>Manual</option>
          </select>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 4 }}>Tag Data (JSON array)</label>
          <textarea
            value={jsonText}
            onChange={e => setJsonText(e.target.value)}
            rows={8}
            placeholder={'[\n  {"tag": "FT-101", "service": "Feed Flow", "unit": "U100", "discipline": "Instrument"},\n  {"tag": "P-201", "service": "Feed Pump", "unit": "U200", "discipline": "Mechanical"}\n]'}
            style={{ width: '100%', padding: 8, fontSize: 11, fontFamily: 'monospace', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-tx)', resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => submit(true)}
            style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-tx)', cursor: 'pointer' }}>
            Dry Run
          </button>
          <button onClick={() => submit(false)}
            style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, background: 'var(--jarvis-ac)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer' }}>
            Commit Import
          </button>
        </div>

        {result && <div style={{ marginTop: 10, padding: 10, background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, fontSize: 12, color: 'var(--jarvis-grn,#27ae60)' }}>{result}</div>}
        {error  && <div style={{ marginTop: 10, padding: 10, background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, fontSize: 12, color: 'var(--jarvis-red,#e74c3c)' }}>{error}</div>}
      </div>

      <div className="jarvis-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h4 className="jarvis-label" style={{ margin: 0 }}>Imported Tags</h4>
          <span style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{tags.length} records</span>
          <button onClick={fetchTags} disabled={loadingTags}
            style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 11, background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-ts)', cursor: 'pointer' }}>
            {loadingTags ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {tags.length === 0 ? (
          <div className="jarvis-empty"><span>No tags imported yet</span></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--jarvis-bd)' }}>
                  {['Tag', 'Service', 'Unit', 'Discipline', 'Source'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--jarvis-ts)', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tags.map((t, i) => (
                  <tr key={t.tag ?? i} style={{ borderBottom: '1px solid var(--jarvis-bd)' }}>
                    <td style={{ padding: '5px 8px', fontWeight: 600 }}>{t.tag}</td>
                    <td style={{ padding: '5px 8px' }}>{t.service}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--jarvis-ts)' }}>{t.unit ?? '—'}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--jarvis-ts)' }}>{t.discipline ?? '—'}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--jarvis-ts)' }}>{t.source_system ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'summary' | 'deliverables' | 'transmittals' | 'calculator' | 'plant'
export interface EngineeringViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown> }

export function EngineeringView({ policy, biz: _b }: EngineeringViewProps) {
  const eng  = useBizStore(s => s.biz.engineering_deliverables ?? [])
  const inst = useBizStore(s => s.biz.installation ?? [])
  const man  = useBizStore(s => s.biz.manpower ?? [])
  const tx   = useBizStore(s => s.biz.transmittals ?? [])
  const [tab, setTab] = useState<Tab>('summary')

  const approved  = eng.filter(e => e['status'] === 'approved' || e['status'] === 'issued').length
  const inReview  = eng.filter(e => e['status'] === 'in-review').length
  const disciplines = [...new Set(eng.map(e => String(e['discipline'] ?? e['category'] ?? 'General')))].length

  const TABS: {id: Tab; label: string}[] = [
    {id:'summary', label:'Summary'},
    {id:'deliverables', label:'Deliverables'},
    {id:'transmittals', label:'Transmittals'},
    {id:'calculator', label:'Calculator'},
    {id:'plant', label:'Plant Import'},
  ]
  const defPolicy: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer', ...policy }

  return (
    <div role="main" aria-label="Engineering Overview">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Deliverables"  value={eng.length}         sub={`${approved} approved`} />
        <KpiCard label="In Review"     value={inReview}            color="var(--jarvis-amb)" />
        <KpiCard label="Disciplines"   value={disciplines}          color="var(--jarvis-blue)" />
        <KpiCard label="Installation"  value={inst.length}          color="var(--jarvis-pur)" />
        <KpiCard label="Transmittals"  value={tx.length}            color="var(--jarvis-grn)" />
        <KpiCard label="Manpower"      value={man.length}           color="var(--jarvis-td)" />
      </div>
      <div role="tablist" style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--jarvis-bd)' }}>
        {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 14px 10px', background: 'transparent', border: 'none', borderBottom: tab === t.id ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t.id ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t.id ? 700 : 500, fontSize: 12, cursor: 'pointer' }}>{t.label}</button>)}
      </div>
      {tab === 'summary' && (
        eng.length === 0 ? (
          <div className="jarvis-empty"><span className="jarvis-empty-icon">⚙️</span><span>No engineering deliverables yet</span></div>
        ) : (
          <div className="jarvis-card" style={{ padding: 16 }}>
            <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Recent Deliverables</h4>
            {eng.slice(0, 10).map((e, i) => (
              <div key={String(e['id'] ?? i)} className="jarvis-row">
                <div className="jarvis-flex-1"><span className="jarvis-body" style={{ fontWeight: 600 }}>{String(e['title'] ?? e['deliverable'] ?? e['id'])}</span><span className="jarvis-small" style={{ display:'block' }}>{String(e['discipline'] ?? '—')} · Rev {String(e['rev'] ?? e['revision'] ?? '0')}</span></div>
                <StatusBadge status={String(e['status'] ?? 'draft')} />
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'deliverables'  && <AoView policy={defPolicy} />}
      {tab === 'transmittals'  && <AtView policy={defPolicy} />}
      {tab === 'calculator'    && <CalcView policy={defPolicy} />}
      {tab === 'plant'         && <PlantImportPanel />}
    </div>
  )
}
export default EngineeringView
