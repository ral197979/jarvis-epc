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

export interface ReadinessInput {
  fat_ready: boolean
  sat_ready: boolean
  evidence?: Record<string, unknown>
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
  const res = await _request<{ handoff_id: string; workspace_url: string; status: string }>(
    'POST', '/api/cx/v1/handoffs', input, input.idempotency_key,
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

/** §2.2 — pull current status for a handoff (push via webhook is preferred). */
export async function getHandoffStatus(
  handoffId: string,
): Promise<GatewayResult<{ status: Record<string, unknown> }>> {
  if (!isCommissioningExternalEnabled()) return DISABLED
  const status = await _request<Record<string, unknown>>('GET', `/api/cx/v1/handoffs/${encodeURIComponent(handoffId)}/status`)
  return { enabled: true, status }
}

/** §2.3 — assert FAT/SAT readiness; Commissioning may reject with blocking items. */
export async function assertReadiness(
  handoffId: string, input: ReadinessInput,
): Promise<GatewayResult<{ accepted: boolean; blocking_items: unknown[] }>> {
  if (!isCommissioningExternalEnabled()) return DISABLED
  const res = await _request<{ accepted: boolean; blocking_items: unknown[] }>(
    'POST', `/api/cx/v1/handoffs/${encodeURIComponent(handoffId)}/readiness`, input,
  )
  return { enabled: true, ...res }
}
