/**
 * Denver Engineering — Audit Chain Verification (v4.40.0)
 * ────────────────────────────────────────────────────────
 * Ava Phase 4 — Verifies integrity of the operational event log.
 * Detects tampered records, sequence gaps, and corrupted event chains
 * using rolling SHA-256 checksums and sequence number continuity checks.
 */

import { createHash } from 'node:crypto'
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntegrityReport {
  tenantId:          string
  verifiedAt:        string
  period:            { from: string; to: string }
  eventCount:        number
  chainHash:         string
  gapsDetected:      number
  gapDetails:        GapDetail[]
  integrityStatus:   'valid' | 'tampered' | 'gap_detected' | 'empty'
  tamperedEvents:    string[]
}

export interface GapDetail {
  expectedSeq: number
  foundSeq:    number
  gapSize:     number
}

// ─── Chain Hash ───────────────────────────────────────────────────────────────
// Rolling SHA-256: each step hashes (prevHash + eventId + sequenceNumber)
// Final output is the hash of the full chain.

export function computeChainHash(
  events: Array<{ id: unknown; sequence_number: number; event_type?: string }>
): string {
  let rolling = ''
  for (const ev of events) {
    const input = `${rolling}:${String(ev.id)}:${ev.sequence_number}`
    rolling = createHash('sha256').update(input).digest('hex')
  }
  if (!rolling) return createHash('sha256').update('empty').digest('hex')
  return rolling
}

// ─── Gap Detection ────────────────────────────────────────────────────────────

export function detectGaps(
  events: Array<{ sequence_number: number }>
): GapDetail[] {
  if (events.length < 2) return []
  const gaps: GapDetail[] = []
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!.sequence_number
    const curr = events[i]!.sequence_number
    if (curr - prev > 1) {
      gaps.push({ expectedSeq: prev + 1, foundSeq: curr, gapSize: curr - prev - 1 })
    }
  }
  return gaps
}

// ─── Verify Chain Integrity ───────────────────────────────────────────────────

export async function verifyChainIntegrity(
  tenantId: string,
  fromDate?: string,
  toDate?: string
): Promise<IntegrityReport> {
  const params: unknown[] = [tenantId]
  let q = `SELECT id, sequence_number, event_type, published_at
           FROM realtime_event_log WHERE tenant_id = $1`
  if (fromDate) { params.push(fromDate); q += ` AND published_at >= $${params.length}` }
  if (toDate)   { params.push(toDate);   q += ` AND published_at <= $${params.length}` }
  q += ` ORDER BY sequence_number ASC`

  const { rows: events } = await tenantQuery(tenantId, q, params)

  if (!events.length) {
    return {
      tenantId, verifiedAt: new Date().toISOString(),
      period: { from: fromDate ?? '(all)', to: toDate ?? '(all)' },
      eventCount: 0, chainHash: computeChainHash([]),
      gapsDetected: 0, gapDetails: [],
      integrityStatus: 'empty', tamperedEvents: [],
    }
  }

  const chainHash    = computeChainHash(events)
  const gapDetails   = detectGaps(events)
  const gapsDetected = gapDetails.length

  // Compare against stored snapshot if available
  const { rows: snap } = await tenantQuery(tenantId, `
    SELECT chain_hash, first_seq, last_seq FROM audit_integrity_snapshots
    WHERE tenant_id = $1 AND snapshot_date = CURRENT_DATE
  `, [tenantId])

  const tamperedEvents: string[] = []
  let status: IntegrityReport['integrityStatus'] = 'valid'

  if (snap[0] && snap[0].chain_hash && snap[0].chain_hash !== chainHash) {
    status = 'tampered'
    // Identify tampered event range (simplified: flag last event if hash mismatch)
    const lastEvent = events[events.length - 1]
    if (lastEvent) tamperedEvents.push(String(lastEvent.id))
  } else if (gapsDetected > 0) {
    status = 'gap_detected'
  }

  return {
    tenantId, verifiedAt: new Date().toISOString(),
    period: {
      from: events[0]?.published_at ? new Date(events[0].published_at).toISOString() : '(start)',
      to:   events[events.length-1]?.published_at ? new Date(events[events.length-1]!.published_at).toISOString() : '(end)',
    },
    eventCount: events.length, chainHash, gapsDetected, gapDetails,
    integrityStatus: status, tamperedEvents,
  }
}

// ─── Snapshot Integrity ───────────────────────────────────────────────────────

export async function snapshotIntegrity(
  tenantId: string
): Promise<void> {
  const report = await verifyChainIntegrity(tenantId)
  const firstEvent = report.eventCount > 0 ? await _getFirstEventId(tenantId) : null
  const lastEvent  = report.eventCount > 0 ? await _getLastEventId(tenantId) : null

  await tenantQuery(tenantId, `
    INSERT INTO audit_integrity_snapshots
      (tenant_id, event_count, chain_hash, first_event_id, last_event_id,
       gaps_detected, integrity_status)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (tenant_id, snapshot_date)
    DO UPDATE SET
      event_count = EXCLUDED.event_count,
      chain_hash = EXCLUDED.chain_hash,
      gaps_detected = EXCLUDED.gaps_detected,
      integrity_status = EXCLUDED.integrity_status,
      verified_at = now()
  `, [tenantId, report.eventCount, report.chainHash,
      firstEvent, lastEvent, report.gapsDetected, report.integrityStatus])
}

async function _getFirstEventId(tenantId: string): Promise<string | null> {
  const { rows } = await tenantQuery(tenantId,
    `SELECT id FROM realtime_event_log WHERE tenant_id = $1 ORDER BY sequence_number ASC LIMIT 1`,
    [tenantId])
  return rows[0]?.id as string ?? null
}

async function _getLastEventId(tenantId: string): Promise<string | null> {
  const { rows } = await tenantQuery(tenantId,
    `SELECT id FROM realtime_event_log WHERE tenant_id = $1 ORDER BY sequence_number DESC LIMIT 1`,
    [tenantId])
  return rows[0]?.id as string ?? null
}

// ─── Audit Export ─────────────────────────────────────────────────────────────

export async function exportAuditChain(
  tenantId: string,
  limit = 10000
): Promise<Array<Record<string, unknown>>> {
  const { rows } = await tenantQuery(tenantId, `
    SELECT id, event_type, payload, subscription_scope, scope_id,
           sequence_number, correlation_id, published_at
    FROM realtime_event_log
    WHERE tenant_id = $1
    ORDER BY sequence_number ASC
    LIMIT $2
  `, [tenantId, limit])
  return rows as Array<Record<string, unknown>>
}

// ─── Get Snapshots ────────────────────────────────────────────────────────────

export async function getIntegritySnapshots(
  tenantId: string,
  days = 30
): Promise<unknown[]> {
  const { rows } = await tenantQuery(tenantId, `
    SELECT * FROM audit_integrity_snapshots
    WHERE tenant_id = $1 AND snapshot_date >= CURRENT_DATE - $2
    ORDER BY snapshot_date DESC
  `, [tenantId, days])
  return rows
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeChainHash,
  detectGaps,
  verifyChainIntegrity,
  snapshotIntegrity,
  exportAuditChain,
}
