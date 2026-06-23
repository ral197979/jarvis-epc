/**
 * Live wiring for the Digital Twin asset registry.
 *
 * Endpoint (api/routes/twin.ts → twinRegistry.ts):
 *   GET /api/v1/twins  → { twins: OperationalTwin[], count }   (tenant-scoped)
 *
 * SCOPE: only the asset LIST is wired here. Live telemetry streams from a
 * separate source (`GET /api/v1/twins/:id/state` and the `/iot` gateway) and is
 * intentionally NOT wired yet — so live assets carry `telemetry: []`, and the
 * client-side telemetry simulation remains a mock-only affordance.
 */
import { api } from '../http'
import type { TwinAsset } from '../types'

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}
const cap = (s: string | null | undefined): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '—'

export interface RawTwin {
  id: string
  entityType: string
  entityId: string
  name: string
  status: string | null
  readinessScore?: number | null
  metadata?: Record<string, unknown> | null
}

/** readinessScore may be 0–1 or 0–100; normalize to a 0–100 completion percent. */
function readinessToPct(score: number | null | undefined): number {
  const n = num(score)
  return Math.round(n <= 1 ? n * 100 : n)
}

export function mapTwinAsset(r: RawTwin): TwinAsset {
  const meta = r.metadata ?? {}
  return {
    id: r.entityId,
    tag: r.entityId,
    name: r.name,
    system: typeof meta.system === 'string' ? meta.system : cap(r.entityType),
    status: cap(r.status),
    completionPct: readinessToPct(r.readinessScore),
    openPunch: typeof meta.open_punch === 'number' ? meta.open_punch : 0,
    telemetry: [], // live telemetry not wired (see file header)
  }
}

export async function fetchTwinAssetsLive(): Promise<TwinAsset[]> {
  const res = await api<{ twins: RawTwin[]; count: number }>('/twins?limit=200')
  return (res.twins ?? []).map(mapTwinAsset)
}
