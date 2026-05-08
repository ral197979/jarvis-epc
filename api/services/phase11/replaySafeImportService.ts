// Denver Engineering — Replay-Safe Import Service (Phase 11)
// Ensure imported data maintains replay integrity and audit trail

import { pool, tenantQuery } from '../../db/pool'
import { createHash } from 'crypto'

// ─── Import Ledger Entry ──────────────────────────────────────────────────────

export interface ImportLedgerEntry {
  id: string
  jobId: string
  tenantId: string
  batchIndex: number
  rowsImported: number
  batchHash: string
  replayEventId: string | null
  committedAt: Date
  createdAt: Date
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapLedgerEntry(row: Record<string, unknown>): ImportLedgerEntry {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    tenantId: row.tenant_id as string,
    batchIndex: Number(row.batch_index),
    rowsImported: Number(row.rows_imported),
    batchHash: row.batch_hash as string,
    replayEventId: row.replay_event_id as string | null,
    committedAt: new Date(row.committed_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Compute Batch Hash ───────────────────────────────────────────────────────

export function computeBatchHash(rows: Record<string, unknown>[]): string {
  const canonical = JSON.stringify(rows, (_, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort())
      : val
  )
  return createHash('sha256').update(canonical).digest('hex')
}

// ─── Record Import Ledger Entry ───────────────────────────────────────────────

export async function recordImportLedgerEntry(
  jobId: string,
  tenantId: string,
  batchIndex: number,
  rowsImported: number,
  batchHash: string,
  replayEventId: string | null = null
): Promise<ImportLedgerEntry> {
  const result = await pool.query(
    `INSERT INTO import_ledger_entries
       (job_id, tenant_id, batch_index, rows_imported, batch_hash,
        replay_event_id, committed_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     RETURNING *`,
    [jobId, tenantId, batchIndex, rowsImported, batchHash, replayEventId]
  )
  return _mapLedgerEntry(result.rows[0])
}

// ─── Get Ledger Entries ───────────────────────────────────────────────────────

export async function getImportLedgerEntries(jobId: string): Promise<ImportLedgerEntry[]> {
  const result = await pool.query(
    `SELECT * FROM import_ledger_entries
     WHERE job_id = $1
     ORDER BY batch_index ASC`,
    [jobId]
  )
  return result.rows.map(_mapLedgerEntry)
}

// ─── Verify Ledger Integrity ──────────────────────────────────────────────────

export async function verifyLedgerIntegrity(
  jobId: string,
  batches: Array<{ batchIndex: number; rows: Record<string, unknown>[] }>
): Promise<{ valid: boolean; mismatchedBatches: number[] }> {
  const entries = await getImportLedgerEntries(jobId)
  const entryMap = new Map(entries.map(e => [e.batchIndex, e.batchHash]))
  const mismatchedBatches: number[] = []

  for (const batch of batches) {
    const storedHash = entryMap.get(batch.batchIndex)
    if (!storedHash) {
      mismatchedBatches.push(batch.batchIndex)
      continue
    }
    const computedHash = computeBatchHash(batch.rows)
    if (computedHash !== storedHash) {
      mismatchedBatches.push(batch.batchIndex)
    }
  }

  return { valid: mismatchedBatches.length === 0, mismatchedBatches }
}

// ─── Check No Replay Interference ────────────────────────────────────────────

export async function checkNoReplayInterference(
  tenantId: string,
  importedEntityIds: string[]
): Promise<{ safe: boolean; interferedIds: string[] }> {
  if (importedEntityIds.length === 0) return { safe: true, interferedIds: [] }

  const rows = await tenantQuery(
    tenantId,
    `SELECT entity_id FROM replay_events
     WHERE entity_id = ANY($1) AND status = 'open'`,
    [importedEntityIds]
  )

  const interferedIds = (rows as Record<string, unknown>[]).map(r => r.entity_id as string)
  return { safe: interferedIds.length === 0, interferedIds }
}

// ─── Generate Import Audit Hash ───────────────────────────────────────────────

export function generateImportAuditHash(
  jobId: string,
  totalRowsImported: number,
  batchCount: number
): string {
  const payload = `${jobId}:${totalRowsImported}:${batchCount}`
  return createHash('sha256').update(payload).digest('hex').substring(0, 24)
}

// ─── Is Import Replay Safe ────────────────────────────────────────────────────

export function isImportReplaySafe(
  entries: ImportLedgerEntry[]
): boolean {
  if (entries.length === 0) return false
  // All batches must have a recorded ledger entry
  const batchIndices = entries.map(e => e.batchIndex)
  const maxBatch = Math.max(...batchIndices)
  for (let i = 0; i <= maxBatch; i++) {
    if (!batchIndices.includes(i)) return false
  }
  return true
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapLedgerEntry,
  computeBatchHash,
  generateImportAuditHash,
  isImportReplaySafe,
}
