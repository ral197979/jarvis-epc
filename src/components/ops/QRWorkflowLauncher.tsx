/**
 * Denver Engineering — QR/NFC Workflow Launcher (v4.35.0)
 * ─────────────────────────────────────────────────────────
 * Ava Phase 3 — Scan a QR code to open an asset's operational
 * workflow: active blockers, inspections, and field actions.
 *
 * Uses the browser's camera (via <input type=file capture=environment>
 * fallback) or manual asset ID entry for desktop.
 */
import React, { useState, useEffect } from 'react'

interface AssetOperation {
  id:            string
  title:         string
  action_type:   string
  status:        string
  priority:      string
  is_blocked:    boolean
  due_at?:       string | null
}

interface AssetReadiness {
  readiness_score: number
  readiness_state: string
  blocking_factors: { description: string }[]
}

interface QRWorkflowLauncherProps {
  onActionSelect?: (actionId: string) => void
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#dc2626', high: '#f97316', medium: '#d97706', low: '#6b7280',
}
const STATUS_COLORS: Record<string, string> = {
  open: '#2563eb', in_progress: '#7c3aed', completed: '#10b981',
}

export function QRWorkflowLauncher({ onActionSelect }: QRWorkflowLauncherProps) {
  const [assetId, setAssetId]       = useState('')
  const [manualInput, setManualInput] = useState('')
  const [operations, setOperations] = useState<AssetOperation[]>([])
  const [readiness, setReadiness]   = useState<AssetReadiness | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [scanMode, setScanMode]     = useState<'idle' | 'scanning' | 'loaded'>('idle')

  const loadAsset = async (id: string) => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [opsRes, readyRes] = await Promise.all([
        fetch(`/api/v1/assets/${id}/operations`),
        fetch(`/api/v1/assets/${id}/readiness`),
      ])
      const opsJ   = await opsRes.json()
      const readyJ = await readyRes.json()
      setOperations(opsJ.data ?? [])
      setReadiness(readyJ.data ?? null)
      setAssetId(id)
      setScanMode('loaded')

      // Log scan event
      void fetch(`/api/v1/evidence/assets/${id}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_type: 'equipment', scan_method: 'qr' }),
      })
    } catch {
      setError('Failed to load asset. Check connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (manualInput.trim()) loadAsset(manualInput.trim())
  }

  const readinessColor = readiness
    ? { not_ready: '#dc2626', at_risk: '#f97316', conditionally_ready: '#d97706', ready: '#10b981' }
        [readiness.readiness_state as never] ?? '#6b7280'
    : '#6b7280'

  if (scanMode === 'idle') {
    return (
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📷</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>Scan Asset QR / NFC</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
            Point camera at equipment QR code to open workflows
          </div>
        </div>

        {/* Camera input (mobile) */}
        <label style={{ display: 'block', width: '100%', marginBottom: 12 }}>
          <div style={{ width: '100%', padding: '10px 0', borderRadius: 8, fontSize: 14,
            background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer',
            textAlign: 'center', fontWeight: 600 }}>
            📷 Open Camera
          </div>
          <input type="file" accept="image/*" capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => {
              // In production: decode QR from image using a library like jsQR
              // For now: simulate scan with a demo asset ID
              const file = e.target.files?.[0]
              if (file) loadAsset(`demo-asset-${Date.now()}`)
            }}
          />
        </label>

        {/* Manual entry */}
        <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginBottom: 10 }}>or enter manually</div>
        <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: 8 }}>
          <input
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            placeholder="Asset ID or tag…"
            style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db',
              fontSize: 13, color: '#374151' }}
          />
          <button type="submit" disabled={loading}
            style={{ padding: '8px 14px', borderRadius: 6, background: '#f9fafb',
              border: '1px solid #d1d5db', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
            {loading ? '…' : '→'}
          </button>
        </form>
        {error && <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{error}</div>}
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
      {/* Asset header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #e5e7eb',
        background: '#f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>ASSET</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', fontFamily: 'monospace' }}>
            {assetId}
          </div>
        </div>
        {readiness && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: readinessColor }}>
              {Math.round(readiness.readiness_score)}
            </div>
            <div style={{ fontSize: 10, color: readinessColor, textTransform: 'capitalize' }}>
              {readiness.readiness_state.replace(/_/g, ' ')}
            </div>
          </div>
        )}
      </div>

      {/* Blocking factors */}
      {readiness && readiness.blocking_factors.length > 0 && (
        <div style={{ padding: '8px 14px', background: '#fef2f2', borderBottom: '1px solid #fee2e2' }}>
          {readiness.blocking_factors.map((f, i) => (
            <div key={i} style={{ fontSize: 12, color: '#dc2626' }}>⚠ {f.description}</div>
          ))}
        </div>
      )}

      {/* Operations list */}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {operations.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
            No active operations for this asset.
          </div>
        ) : operations.map(op => (
          <div key={op.id}
            onClick={() => onActionSelect?.(op.id)}
            style={{ padding: '10px 14px', borderBottom: '1px solid #f3f4f6',
              cursor: onActionSelect ? 'pointer' : 'default',
              display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            {op.is_blocked && <span title="Blocked" style={{ fontSize: 12 }}>🔒</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#111827',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {op.title}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: PRIORITY_COLORS[op.priority] ?? '#6b7280' }}>
                  {op.priority}
                </span>
                <span style={{ fontSize: 10, color: STATUS_COLORS[op.status] ?? '#6b7280',
                  textTransform: 'capitalize' }}>
                  {op.status.replace('_', ' ')}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Reset */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid #e5e7eb' }}>
        <button onClick={() => setScanMode('idle')} style={{ fontSize: 12, color: '#6b7280',
          background: 'none', border: 'none', cursor: 'pointer' }}>
          ← Scan different asset
        </button>
      </div>
    </div>
  )
}
