/**
 * Denver Engineering — Nova Integration panel (ADR-001 §2.9, v1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Project-workspace card showing the Nova (business operations) link for a
 * Denver project: linked Nova project/number, customer, contract number,
 * commercial PM (only if stored — "not reported" otherwise, never zero-filled),
 * outbound delivery health from nova_outbox, last successful outbound event,
 * pending/failed/dead delivery counts, "Open in Nova", and an owner/admin-only
 * Retry action for dead/failed deliveries.
 *
 * Honesty rules (binding, from the ADR):
 *   - failed/dead deliveries NEVER render as healthy — health comes from the
 *     server rollup, which encodes the same rule.
 *   - contract VALUE is never displayed (the API never returns it).
 *   - no link → an explicit "not connected" state, not a blank card.
 *
 * Data: GET /api/v1/projects/:id/nova-integration (novaIntegrationStatus.ts).
 * Retry: POST .../nova-integration/retry — server enforces owner/admin (403);
 * the button is additionally hidden for non-privileged roles via `canManage`.
 */
import React, { useCallback, useEffect, useState } from 'react'

// ─── API types (mirror api/routes/novaIntegrationStatus.ts) ──────────────────

export interface NovaIntegrationStatus {
  linked: boolean
  link?: {
    novaProjectId:     string
    novaProjectNumber: string | null
    novaCustomerName:  string | null
    contractNumber:    string | null
    commercialPm:      string | null
    linkedAt:          string | null
    lastEventAt:       string | null
  }
  connection?: {
    connectionId: string
    novaTenantId: string
    status:       string
  } | null
  health?: 'disconnected' | 'failed' | 'degraded' | 'pending' | 'healthy'
  delivery?: {
    queuedCount:            number
    failedCount:            number
    deadCount:              number
    lastDeliveredAt:        string | null
    lastDeliveredEventType: string | null
  }
  openInNovaUrl?: string | null
}

export interface NovaIntegrationPanelProps {
  /** Denver DB project UUID; null when the workspace record has no synced backend project. */
  projectId: string | null
  /** True for owner/admin — shows the Retry action (server enforces regardless). */
  canManage: boolean
}

// ─── Health chip ──────────────────────────────────────────────────────────────

const HEALTH_META: Record<string, { label: string; color: string }> = {
  healthy:      { label: 'Healthy',              color: 'var(--jarvis-grn)' },
  pending:      { label: 'Delivery pending',     color: 'var(--jarvis-blue)' },
  degraded:     { label: 'Retrying deliveries',  color: 'var(--jarvis-amb)' },
  failed:       { label: 'Delivery failed',      color: 'var(--jarvis-red)' },
  disconnected: { label: 'Connection unavailable', color: 'var(--jarvis-red)' },
}

function HealthChip({ health }: { health: string }) {
  const meta = HEALTH_META[health] ?? { label: health, color: 'var(--jarvis-ts)' }
  return (
    <span
      aria-label={`Integration health: ${meta.label}`}
      style={{
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
        color: meta.color, border: `1px solid ${meta.color}`, borderRadius: 10,
        padding: '2px 8px', whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  )
}

// ─── Field row ────────────────────────────────────────────────────────────────

function FieldRow({ label, value, mono = false, last = false }: {
  label: string; value: React.ReactNode; mono?: boolean; last?: boolean
}) {
  return (
    <div className="jarvis-row" style={last ? { borderBottom: 'none' } : undefined}>
      <span className="jarvis-small">{label}</span>
      <span
        className="jarvis-body"
        style={{ fontWeight: 600, fontFamily: mono ? 'var(--jarvis-font-mono)' : undefined }}
      >
        {value}
      </span>
    </div>
  )
}

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function NovaIntegrationPanel({ projectId, canManage }: NovaIntegrationPanelProps) {
  const [status, setStatus]   = useState<NovaIntegrationStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [retrying, setRetrying]     = useState(false)
  const [retryResult, setRetryResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/nova-integration`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setStatus(await res.json() as NovaIntegrationStatus)
    } catch (err) {
      setStatus(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  const retry = useCallback(async () => {
    if (!projectId) return
    setRetrying(true)
    setRetryResult(null)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/nova-integration/retry`, { method: 'POST' })
      if (res.status === 403) { setRetryResult('Not permitted — requires owner or admin.'); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json() as { requeued: number }
      setRetryResult(`Re-queued ${body.requeued} deliver${body.requeued === 1 ? 'y' : 'ies'}.`)
      await load()
    } catch (err) {
      setRetryResult(`Retry failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRetrying(false)
    }
  }, [projectId, load])

  // Header shared by every state so the panel is always identifiable.
  const header = (extra?: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <h4 className="jarvis-label">Nova Integration</h4>
      {extra}
    </div>
  )

  // No synced backend project record → the link table cannot be consulted.
  if (!projectId) {
    return (
      <div className="jarvis-card" style={{ padding: 16 }} aria-label="Nova Integration">
        {header()}
        <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>
          Nova integration status is unavailable — this workspace record has no
          synced backend project.
        </p>
      </div>
    )
  }

  if (loading && !status) {
    return (
      <div className="jarvis-card" style={{ padding: 16 }} aria-label="Nova Integration" aria-busy="true">
        {header()}
        <p className="jarvis-muted">Loading integration status…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="jarvis-card" style={{ padding: 16 }} aria-label="Nova Integration">
        {header()}
        <p className="jarvis-body" style={{ color: 'var(--jarvis-red)', marginBottom: 8 }}>
          Could not load Nova integration status ({error}).
        </p>
        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={() => load()}>
          Reload
        </button>
      </div>
    )
  }

  if (!status || !status.linked) {
    return (
      <div className="jarvis-card" style={{ padding: 16 }} aria-label="Nova Integration">
        {header()}
        <p className="jarvis-body" style={{ marginBottom: 4 }}>Not connected to Nova.</p>
        <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>
          This project was not created from a Nova commercial project. Linked
          projects are provisioned from Nova — there is no connect action on the
          Denver side.
        </p>
      </div>
    )
  }

  const { link, connection, delivery, health, openInNovaUrl } = status
  const failedTotal = (delivery?.failedCount ?? 0) + (delivery?.deadCount ?? 0)

  return (
    <div className="jarvis-card" style={{ padding: 16 }} aria-label="Nova Integration">
      {header(<HealthChip health={health ?? 'disconnected'} />)}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px', marginBottom: 12 }}>
        <div>
          <FieldRow label="Nova project #" value={link?.novaProjectNumber ?? '—'} mono />
          <FieldRow label="Nova project ID" value={link?.novaProjectId ?? '—'} mono />
          <FieldRow label="Customer" value={link?.novaCustomerName ?? '—'} />
          <FieldRow label="Contract #" value={link?.contractNumber ?? '—'} mono />
          <FieldRow
            label="Commercial PM"
            value={link?.commercialPm ?? <span className="jarvis-muted" style={{ fontStyle: 'italic' }}>not reported</span>}
            last
          />
        </div>
        <div>
          <FieldRow label="Nova tenant" value={connection?.novaTenantId ?? '—'} mono />
          <FieldRow label="Connection" value={connection ? connection.status : 'not found'} />
          <FieldRow label="Linked" value={fmtWhen(link?.linkedAt)} />
          <FieldRow
            label="Last delivered event"
            value={delivery?.lastDeliveredEventType
              ? `${delivery.lastDeliveredEventType} · ${fmtWhen(delivery.lastDeliveredAt)}`
              : <span className="jarvis-muted" style={{ fontStyle: 'italic' }}>none yet</span>}
          />
          <FieldRow
            label="Deliveries"
            value={
              <span style={{ display: 'inline-flex', gap: 10 }}>
                <span style={{ color: 'var(--jarvis-blue)' }}>{delivery?.queuedCount ?? 0} pending</span>
                <span style={{ color: (delivery?.failedCount ?? 0) > 0 ? 'var(--jarvis-amb)' : undefined }}>
                  {delivery?.failedCount ?? 0} retrying
                </span>
                <span style={{ color: (delivery?.deadCount ?? 0) > 0 ? 'var(--jarvis-red)' : undefined }}>
                  {delivery?.deadCount ?? 0} dead
                </span>
              </span>
            }
            last
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {openInNovaUrl ? (
          <a
            className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm"
            href={openInNovaUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Nova ↗
          </a>
        ) : (
          <span className="jarvis-muted" style={{ fontSize: 11, fontStyle: 'italic' }}>
            No Nova deep link available for this project.
          </span>
        )}
        {canManage && failedTotal > 0 && (
          <button
            className="jarvis-btn jarvis-btn-primary jarvis-btn-sm"
            onClick={() => retry()}
            disabled={retrying}
          >
            {retrying ? 'Re-queuing…' : `Retry ${failedTotal} failed deliver${failedTotal === 1 ? 'y' : 'ies'}`}
          </button>
        )}
        {retryResult && <span className="jarvis-small" role="status">{retryResult}</span>}
      </div>
    </div>
  )
}

export default NovaIntegrationPanel
