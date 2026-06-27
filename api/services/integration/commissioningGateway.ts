/**
 * Denver Engineering — Commissioning gateway (outbound, PR-1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Typed client for the Denver → Commissioning API (plan §2). Every call is
 * guarded by the COMMISSIONING_EXTERNAL flag: when disabled (the default), the
 * gateway is a NO-OP that returns { enabled:false } and never touches the
 * network — so PR-1 changes no runtime behavior.
 *
 * On a successful handoff creation the gateway seeds the local status mirror with
 * the project linkage and workspace URL, so later inbound events have a row to
 * update. See COMMISSIONING_EXTRACTION_PLAN.md §2.1–2.3.
 */
import {
  isCommissioningExternalEnabled,
  commissioningBaseUrl,
  commissioningServiceToken,
  commissioningTimeoutMs,
} from './cxConfig'
import { seedMirror } from './cxStatusMirror'
import { toMenloInboundEvent } from './cxEventMap'
import { slog } from '../../../src/modules/observability/index'

export interface CreateHandoffInput {
  tenant_id: string
  project_id: string
  turnover_package_id: string
  name: string
  scope?: Record<string, unknown>
  deliverables?: Record<string, unknown>
  idempotency_key: string
}

/** Discriminated result: callers branch on `enabled`. */
export type GatewayResult<T> = ({ enabled: true } & T) | { enabled: false }

const DISABLED = { enabled: false } as const

async function _request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const base = commissioningBaseUrl()
  if (!base) throw new Error('COMMISSIONING_BASE_URL not configured')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), commissioningTimeoutMs())
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${commissioningServiceToken()}`,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body == null ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`commissioning ${method} ${path} → ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** §2.1 — create a commissioning handoff; seeds the local mirror on success. */
export async function createHandoff(
  input: CreateHandoffInput,
): Promise<GatewayResult<{ handoff_id: string; workspace_url: string; status: string }>> {
  if (!isCommissioningExternalEnabled()) return DISABLED
  // Menlo intake endpoint (ECOSYSTEM_INTEGRATION_CONTRACT.md §3.1 / R1).
  const res = await _request<{ handoff_id: string; workspace_url: string; status: string }>(
    'POST', '/api/projects/handoff', input, input.idempotency_key,
  )
  try {
    await seedMirror(input.tenant_id, res.handoff_id, {
      projectId: input.project_id,
      turnoverPackageId: input.turnover_package_id,
      workspaceUrl: res.workspace_url,
      phase: res.status,
    })
  } catch (err) {
    slog('ERROR', 'commissioning', '[gateway] mirror seed failed', {
      tenantId: input.tenant_id, handoffId: res.handoff_id,
      message: err instanceof Error ? err.message : String(err),
    })
  }
  return { enabled: true, ...res }
}

/** Pull current commissioning status for a project (push via webhook is preferred). */
export async function getHandoffStatus(
  projectId: string,
): Promise<GatewayResult<{ status: Record<string, unknown> }>> {
  if (!isCommissioningExternalEnabled()) return DISABLED
  const status = await _request<Record<string, unknown>>('GET', `/api/projects/${encodeURIComponent(projectId)}/status`)
  return { enabled: true, status }
}

/**
 * Publish a Denver → Menlo lifecycle event (readiness, construction-complete,
 * equipment-installed, …). Canonical event name is translated to Menlo's inbound
 * vocabulary at the edge; delivery is fire-and-forget to Menlo's event sink.
 * Replaces the old synchronous readiness gate — Menlo's readiness model is
 * event-driven (ECOSYSTEM_INTEGRATION_CONTRACT.md §3 / R1).
 */
export async function publishToCommissioning(
  canonicalEvent: string, projectId: string, data: Record<string, unknown> = {},
): Promise<GatewayResult<{ accepted: boolean }>> {
  if (!isCommissioningExternalEnabled()) return DISABLED
  await _request('POST', '/api/events', {
    event: toMenloInboundEvent(canonicalEvent),
    project_id: projectId,
    data,
  })
  return { enabled: true, accepted: true }
}
