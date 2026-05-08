/**
 * Denver Engineering — SettingsView  ·  Application Settings
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'

export interface SettingsViewProps { policy?: Partial<PolicyConfig>; onToast?: (m: string, t: string) => void }
const DEF: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }

export function SettingsView({ policy: pProp, onToast }: SettingsViewProps) {
  const policy  = { ...DEF, ...pProp }
  const company = useBizStore(s => s.biz.company)
  const [form, setForm] = useState<Record<string,string>>(Object.fromEntries(Object.entries(company).map(([k,v]) => [k, String(v)])))
  const [tab, setTab]   = useState<'company'|'system'|'data'>('company')
  const canWrite = policy.writesEnabled

  const { dispatch } = React.useMemo(() => createDispatch({ policy, toast: onToast ? (m,t) => onToast(m,t) : undefined }), [policy])

  function saveCompany() {
    dispatch({ type: JARVIS_ACTIONS.SET_COMPANY, data: { ...form } })
    onToast?.('Company profile saved', 'success')
  }

  const COMPANY_FIELDS = [
    ['name',        'Company Name'],
    ['abn',         'ABN / Tax ID'],
    ['address',     'Address'],
    ['city',        'City'],
    ['country',     'Country'],
    ['phone',       'Phone'],
    ['email',       'Email'],
    ['website',     'Website'],
    ['industry',    'Industry'],
    ['currency',    'Currency'],
  ]

  return (
    <div role="main" aria-label="Settings">
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--jarvis-bd)' }}>
        {(['company','system','data'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px 10px', background: 'transparent', border: 'none', borderBottom: tab === t ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t ? 700 : 500, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>

      {tab === 'company' && (
        <div>
          <div className="jarvis-card" style={{ padding: 20 }}>
            <h4 className="jarvis-label" style={{ marginBottom: 16 }}>Company Profile</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {COMPANY_FIELDS.map(([k, l]) => (
                <div key={k}>
                  <label className="jarvis-small" htmlFor={`setting-${k}`} style={{ display: 'block', marginBottom: 4 }}>{l}</label>
                  <input id={`setting-${k}`} className="jarvis-input" disabled={!canWrite} value={form[k] ?? ''} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} />
                </div>
              ))}
            </div>
            {canWrite ? (
              <button className="jarvis-btn jarvis-btn-primary" style={{ marginTop: 16 }} onClick={saveCompany}>Save Company Profile</button>
            ) : (
              <p className="jarvis-muted" style={{ marginTop: 12, fontStyle: 'italic', fontSize: 12 }}>Read-only — contact your administrator to edit company settings</p>
            )}
          </div>
        </div>
      )}

      {tab === 'system' && (
        <div className="jarvis-card" style={{ padding: 20 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 12 }}>System Information</h4>
          {[
            ['Version',      'Denver Engineering v4.23.0'],
            ['Role',          policy.activeRole ?? 'viewer'],
            ['Writes',        policy.writesEnabled ? 'Enabled' : 'Disabled'],
            ['AI Chat',       policy.chatEnabled ? 'Enabled' : 'Disabled'],
            ['Exports',       policy.exportsEnabled ? 'Enabled' : 'Disabled'],
          ].map(([k, v]) => (
            <div key={k} className="jarvis-row">
              <span className="jarvis-small">{k}</span>
              <span className="jarvis-body" style={{ fontWeight: 600, fontFamily: 'var(--jarvis-font-mono)', fontSize: 12 }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'data' && (
        <div className="jarvis-card" style={{ padding: 20 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Data Management</h4>
          <p className="jarvis-body" style={{ marginBottom: 16, color: 'var(--jarvis-ts)' }}>Import, export, and manage your project data.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {policy.exportsEnabled && (
              <button className="jarvis-btn jarvis-btn-ghost" onClick={() => onToast?.('Export initiated', 'info')}>📤 Export All Data</button>
            )}
            <button className="jarvis-btn jarvis-btn-ghost" onClick={() => onToast?.('Contact support to import data', 'info')}>📥 Import Data</button>
            {canWrite && (
              <button className="jarvis-btn jarvis-btn-ghost" style={{ color: 'var(--jarvis-red)', borderColor: 'var(--jarvis-red)' }}
                onClick={() => { if (window.confirm('This will clear all data. Are you sure?')) { dispatch({ type: JARVIS_ACTIONS.WIPE_ALL, data: {} }); onToast?.('All data wiped', 'warn') } }}>
                ⚠️ Wipe All Data
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
export default SettingsView
