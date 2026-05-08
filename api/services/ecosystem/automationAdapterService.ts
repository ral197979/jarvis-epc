// Denver Engineering — Automation Adapter Service (v9.0.0)
// Signed webhook delivery, idempotent ingest, dead-letter queue, rate limits.

import { createHmac, randomBytes } from 'crypto'
import { tenantQuery } from '../../db/pool'
import {
  AutomationAdapter, AutomationEvent, AutomationAdapterType,
} from './ecosystemTypes'

// ─── Adapter CRUD ─────────────────────────────────────────────────────────────

export interface CreateAdapterInput {
  adapterType: AutomationAdapterType
  name: string
  endpointUrl?: string
  rateLimitRpm?: number
  metadata?: Record<string, unknown>
}

export interface CreateAdapterResult {
  adapter: AutomationAdapter
  signingSecret: string  // returned once
}

export async function createAdapter(
  tenantId: string,
  input: CreateAdapterInput,
): Promise<CreateAdapterResult> {
  const signingSecret = randomBytes(32).toString('hex')

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO automation_adapters
      (tenant_id, adapter_type, name, endpoint_url, signing_secret, rate_limit_rpm, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      tenantId, input.adapterType, input.name, input.endpointUrl ?? null,
      signingSecret,  // stored; in production would be encrypted at rest
      input.rateLimitRpm ?? 60,
      JSON.stringify(input.metadata ?? {}),
    ],
  )
  return { adapter: _mapAdapter(res.rows[0]), signingSecret }
}

export async function getAdapter(
  tenantId: string,
  adapterId: string,
): Promise<AutomationAdapter | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM automation_adapters WHERE id = $1 AND tenant_id = $2`,
    [adapterId, tenantId],
  )
  return res.rows.length > 0 ? _mapAdapter(res.rows[0]) : null
}

export async function listAdapters(tenantId: string): Promise<AutomationAdapter[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM automation_adapters WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  )
  return res.rows.map(_mapAdapter)
}

export async function deactivateAdapter(tenantId: string, adapterId: string): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE automation_adapters SET is_active = FALSE, updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [adapterId, tenantId],
  )
}

// ─── Inbound event ingestion (idempotent) ─────────────────────────────────────

export interface InboundEventInput {
  eventType: string
  payload: Record<string, unknown>
  idempotencyKey?: string
  signature?: string
  rawBody?: string
}

export async function ingestInboundEvent(
  tenantId: string,
  adapterId: string,
  input: InboundEventInput,
): Promise<AutomationEvent> {
  // Verify signature if provided
  let signatureValid: boolean | null = null
  if (input.signature != null && input.rawBody != null) {
    const adapterRow = await tenantQuery(
      tenantId,
      `SELECT signing_secret FROM automation_adapters WHERE id = $1 AND tenant_id = $2`,
      [adapterId, tenantId],
    )
    if (adapterRow.rows.length > 0) {
      const secret = adapterRow.rows[0].signing_secret as string
      signatureValid = verifySignature(secret, input.rawBody, input.signature)
    }
  }

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO automation_events
      (adapter_id, tenant_id, direction, event_type, payload, idempotency_key, signature_valid)
     VALUES ($1,$2,'inbound',$3,$4,$5,$6)
     ON CONFLICT (adapter_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO UPDATE SET updated_at = now()
     RETURNING *`,
    [
      adapterId, tenantId, input.eventType,
      JSON.stringify(input.payload),
      input.idempotencyKey ?? null,
      signatureValid,
    ],
  )
  return _mapEvent(res.rows[0])
}

// ─── Outbound event delivery ──────────────────────────────────────────────────

export async function sendOutboundEvent(
  tenantId: string,
  adapterId: string,
  eventType: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<AutomationEvent> {
  const res = await tenantQuery(
    tenantId,
    `INSERT INTO automation_events
      (adapter_id, tenant_id, direction, event_type, payload, idempotency_key)
     VALUES ($1,$2,'outbound',$3,$4,$5)
     ON CONFLICT (adapter_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO UPDATE SET retry_count = automation_events.retry_count + 1, updated_at = now()
     RETURNING *`,
    [adapterId, tenantId, eventType, JSON.stringify(payload), idempotencyKey ?? null],
  )
  return _mapEvent(res.rows[0])
}

export async function markEventProcessed(tenantId: string, eventId: string): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE automation_events
     SET processed = TRUE, processed_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [eventId, tenantId],
  )
}

export async function getDeadLetterEvents(tenantId: string): Promise<AutomationEvent[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM automation_events
     WHERE tenant_id = $1 AND processed = FALSE AND retry_count >= 3
     ORDER BY created_at ASC`,
    [tenantId],
  )
  return res.rows.map(_mapEvent)
}

export async function listEvents(
  tenantId: string,
  adapterId?: string,
): Promise<AutomationEvent[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM automation_events
     WHERE tenant_id = $1 AND ($2::uuid IS NULL OR adapter_id = $2)
     ORDER BY created_at DESC LIMIT 100`,
    [tenantId, adapterId ?? null],
  )
  return res.rows.map(_mapEvent)
}

// ─── Signature helpers ────────────────────────────────────────────────────────

export function signPayload(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function verifySignature(secret: string, payload: string, signature: string): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  return expected === signature
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapAdapter(row: Record<string, unknown>): AutomationAdapter {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    adapterType: row['adapter_type'] as AutomationAdapterType,
    name: row['name'] as string,
    endpointUrl: (row['endpoint_url'] as string) ?? null,
    isActive: Boolean(row['is_active']),
    rateLimitRpm: Number(row['rate_limit_rpm'] ?? 60),
    metadata: (typeof row['metadata'] === 'string'
      ? JSON.parse(row['metadata'])
      : row['metadata']) as Record<string, unknown>,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  }
}

function _mapEvent(row: Record<string, unknown>): AutomationEvent {
  return {
    id: row['id'] as string,
    adapterId: row['adapter_id'] as string,
    tenantId: row['tenant_id'] as string,
    direction: row['direction'] as 'inbound' | 'outbound',
    eventType: row['event_type'] as string,
    payload: (typeof row['payload'] === 'string'
      ? JSON.parse(row['payload'])
      : row['payload']) as Record<string, unknown>,
    idempotencyKey: (row['idempotency_key'] as string) ?? null,
    signatureValid: row['signature_valid'] != null ? Boolean(row['signature_valid']) : null,
    processed: Boolean(row['processed']),
    error: (row['error'] as string) ?? null,
    retryCount: Number(row['retry_count'] ?? 0),
    createdAt: new Date(row['created_at'] as string),
    processedAt: row['processed_at'] != null ? new Date(row['processed_at'] as string) : null,
  }
}

export const __testHooks = { signPayload, verifySignature, _mapAdapter, _mapEvent }
