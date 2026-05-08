/**
 * JARVIS EPC — MarketplacePage  (G4 — Partner Marketplace v0)
 */
import React, { useState, useEffect } from 'react'
import { MARKETPLACE_TOOLS, type MCPTool } from '../constants/mcpTools'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface MarketplacePageProps { policy?: Partial<PolicyConfig> }

const CATEGORIES = ['All', 'Analytics', 'Field', 'Engineering', 'Documents', 'System'] as const

export function MarketplacePage({ policy }: MarketplacePageProps) {
  const [cat, setCat] = useState<string>('All')
  const [search, setSearch] = useState('')
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState<string | null>(null)
  const isOwner = policy?.activeRole === 'owner'

  useEffect(() => {
    fetch('/api/v1/marketplace', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const map: Record<string, boolean> = {}
        for (const t of d.tools ?? []) map[t.name] = t.enabled
        setEnabled(map)
      })
      .catch(() => {})
  }, [])

  const toggle = async (tool: MCPTool) => {
    if (!isOwner) return
    setLoading(tool.name)
    const next = !enabled[tool.name]
    try {
      await fetch(`/api/v1/marketplace/${tool.name}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      setEnabled(e => ({ ...e, [tool.name]: next }))
    } finally {
      setLoading(null)
    }
  }

  const filtered = MARKETPLACE_TOOLS.filter(t =>
    (cat === 'All' || t.cat === cat) &&
    (t.name.includes(search) || t.desc.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div role="main" aria-label="Marketplace" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>🛒 Partner Marketplace</h2>
        <span style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginLeft: 'auto' }}>{MARKETPLACE_TOOLS.length} available integrations</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => setCat(c)} style={{ padding: '5px 12px', fontSize: 11, background: cat === c ? 'var(--jarvis-ac)' : 'var(--jarvis-bg2)', color: cat === c ? '#fff' : 'var(--jarvis-ts)', border: '1px solid var(--jarvis-bd)', borderRadius: 14, cursor: 'pointer' }}>{c}</button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ marginLeft: 'auto', padding: '5px 10px', fontSize: 12, background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, color: 'var(--jarvis-tx)' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {filtered.map(t => (
          <div key={t.name} style={{ border: '1px solid var(--jarvis-bd)', borderRadius: 8, padding: 14, background: 'var(--jarvis-bg2)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{t.name.replace(/_/g, ' ')}</div>
                <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginTop: 2 }}>{t.publisher} · v{t.version}</div>
              </div>
              <span style={{ padding: '2px 8px', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, fontSize: 10, color: 'var(--jarvis-ts)' }}>{t.cat}</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--jarvis-ts)', margin: '8px 0', lineHeight: 1.4 }}>{t.desc}</p>
            <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginBottom: 10 }}>Params: {t.params.join(', ')}</div>
            {isOwner ? (
              <button
                onClick={() => toggle(t)}
                disabled={loading === t.name}
                style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, background: enabled[t.name] ? '#e74c3c' : 'var(--jarvis-ac)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', opacity: loading === t.name ? 0.6 : 1 }}
              >
                {loading === t.name ? '…' : enabled[t.name] ? 'Disable' : 'Enable'}
              </button>
            ) : (
              <span style={{ fontSize: 11, color: enabled[t.name] ? 'var(--jarvis-grn,#27ae60)' : 'var(--jarvis-ts)' }}>{enabled[t.name] ? '✓ Enabled' : 'Not enabled'}</span>
            )}
          </div>
        ))}
        {filtered.length === 0 && <div style={{ color: 'var(--jarvis-ts)', padding: 40, textAlign: 'center', gridColumn: '1/-1' }}>No tools match your filter.</div>}
      </div>

      {!isOwner && (
        <div style={{ marginTop: 24, padding: 12, background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, fontSize: 12, color: 'var(--jarvis-ts)' }}>
          Only the Owner role can enable or disable marketplace tools.
        </div>
      )}
    </div>
  )
}

export default MarketplacePage
