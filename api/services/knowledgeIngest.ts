/**
 * JARVIS EPC — Knowledge Base Ingest (v4.31.0)
 *
 * Pipeline:
 *   1. CLI or admin UI registers a source: creates knowledge_sources row
 *      with status='pending', enqueues an 'ingest_pdf' background job.
 *   2. Scheduler handler claims the job, extracts text with pdf-parse,
 *      chunks it (fixed-size char windows w/ overlap), bulk-inserts
 *      knowledge_chunks. The trigger populates search_tsv automatically.
 *   3. Source row flips to status='ready' with chunk_count set.
 *
 * Chunking is deliberately simple for v1. Engineering PDFs are
 * narrative-heavy enough that fixed-size windows (with sentence-boundary
 * nudging at edges) produce good retrieval. Section-aware / markdown-
 * respecting chunking is a follow-up once we see real retrieval quality.
 */

import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import { tenantTransaction, query } from '../db/pool'
import { registerHandler, type BackgroundJob } from './scheduler'
import { slog } from '../../src/modules/observability/index'

// ─── Config ───────────────────────────────────────────────────────────────────

const CHUNK_TARGET_CHARS  = Number(process.env['KNOWLEDGE_CHUNK_CHARS']   ?? '1400')
const CHUNK_OVERLAP_CHARS = Number(process.env['KNOWLEDGE_CHUNK_OVERLAP'] ?? '200')
const MAX_CHUNKS_PER_DOC  = Number(process.env['KNOWLEDGE_MAX_CHUNKS']    ?? '5000')

// ─── Types ────────────────────────────────────────────────────────────────────

interface IngestPayload {
  sourceId: string
}

interface PdfExtract {
  text: string
  pageCount: number
}

// ─── Public: register handler at boot ─────────────────────────────────────────

export function registerKnowledgeIngestHandler(): void {
  registerHandler('ingest_pdf', _handleIngestPdf)
  slog('INFO', 'knowledgeIngest', '[boot] Registered ingest_pdf handler')
}

// ─── Public: enqueue a source for ingestion ───────────────────────────────────
//
// Called by the CLI bulk-loader and by the REST ingest endpoint. Assumes
// the knowledge_sources row already exists with status='pending'.

export async function enqueueSourceIngest(
  tenantId: string,
  sourceId: string,
  userId:   string | null,
): Promise<string | null> {
  const { enqueue } = await import('./scheduler')
  return enqueue(tenantId, 'ingest_pdf', { sourceId }, {
    maxAttempts: 3,
    createdBy:   userId ?? undefined,
  })
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function _handleIngestPdf(job: BackgroundJob): Promise<Record<string, unknown>> {
  const { sourceId } = job.payload_json as unknown as IngestPayload
  if (!sourceId) throw new Error('ingest_pdf payload missing sourceId')

  const srcRes = await query<{
    id: string; tenant_id: string; storage_path: string | null; kind: string
  }>(`
    SELECT id, tenant_id, storage_path, kind
    FROM   knowledge_sources
    WHERE  id = $1 AND tenant_id = $2
  `, [sourceId, job.tenant_id])
  const src = srcRes.rows[0]
  if (!src)                   throw new Error(`Source not found: ${sourceId}`)
  if (!src.storage_path)      throw new Error(`Source ${sourceId} has no storage_path`)
  if (src.kind !== 'pdf')     throw new Error(`kind=${src.kind} not supported in v1 (pdf only)`)

  await query(`UPDATE knowledge_sources SET status='ingesting', error_text=NULL WHERE id=$1`, [sourceId])

  try {
    const extract = await _extractPdf(src.storage_path)
    const chunks  = _chunkText(extract.text)

    if (chunks.length > MAX_CHUNKS_PER_DOC) {
      throw new Error(`Document too large: ${chunks.length} chunks exceeds max ${MAX_CHUNKS_PER_DOC}`)
    }

    // Single transaction: delete any prior chunks (re-ingest safe) + insert fresh.
    await tenantTransaction(job.tenant_id, async (client) => {
      await client.query(
        `DELETE FROM knowledge_chunks WHERE source_id = $1`,
        [sourceId],
      )

      // Bulk insert via UNNEST — one round-trip for all chunks.
      if (chunks.length > 0) {
        const ordinals:  number[] = []
        const texts:     string[] = []
        const charStarts:number[] = []
        const charEnds:  number[] = []
        const tokenEsts: number[] = []
        for (let i = 0; i < chunks.length; i++) {
          const c = chunks[i]!
          ordinals.push(i)
          texts.push(c.text)
          charStarts.push(c.start)
          charEnds.push(c.end)
          tokenEsts.push(Math.ceil(c.text.length / 4))   // rough: ~4 chars/token
        }
        await client.query(`
          INSERT INTO knowledge_chunks
            (tenant_id, source_id, ordinal, text, char_start, char_end, tokens_est)
          SELECT
            current_setting('app.current_tenant_id',true)::uuid,
            $1::uuid,
            u.ord, u.txt, u.cs, u.ce, u.tok
          FROM UNNEST(
            $2::int[], $3::text[], $4::int[], $5::int[], $6::int[]
          ) AS u(ord, txt, cs, ce, tok)
        `, [sourceId, ordinals, texts, charStarts, charEnds, tokenEsts])
      }

      await client.query(`
        UPDATE knowledge_sources
        SET    status      = 'ready',
               chunk_count = $1,
               page_count  = COALESCE(page_count, $2),
               ingested_at = NOW(),
               error_text  = NULL
        WHERE  id = $3
      `, [chunks.length, extract.pageCount, sourceId])
    })

    slog('INFO', 'knowledgeIngest', '[ingest] Complete', {
      sourceId, chunks: chunks.length, pages: extract.pageCount,
    })
    return { sourceId, chunks: chunks.length, pages: extract.pageCount }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await query(`
      UPDATE knowledge_sources SET status='failed', error_text=$1 WHERE id=$2
    `, [msg, sourceId]).catch(() => {})
    throw err   // scheduler retries w/ backoff
  }
}

// ─── PDF extraction ──────────────────────────────────────────────────────────

async function _extractPdf(filePath: string): Promise<PdfExtract> {
  // pdf-parse is CJS-only and requires a dynamic import dance under ESM.
  // We guard the import so a missing dep gives a clear error message
  // rather than a cryptic module-resolution failure.
  let pdfParse: (buf: Buffer) => Promise<{ text: string; numpages?: number }>
  try {
    const mod = await import('pdf-parse') as unknown as
      { default?: (buf: Buffer) => Promise<{ text: string; numpages?: number }> }
    pdfParse = mod.default ?? (mod as unknown as typeof pdfParse)
  } catch (err) {
    throw new Error(`pdf-parse not installed or unusable — run "npm i pdf-parse"; original: ${
      err instanceof Error ? err.message : String(err)
    }`)
  }

  const buf = await fs.readFile(filePath)
  const res = await pdfParse(buf)
  return {
    text:       res.text ?? '',
    pageCount:  res.numpages ?? 0,
  }
}

// ─── Chunker ──────────────────────────────────────────────────────────────────

export interface Chunk {
  text:  string
  start: number
  end:   number
}

/**
 * Fixed-size character chunker with overlap. Nudges chunk boundaries to
 * the nearest sentence terminator within a tolerance window so chunks
 * don't split mid-sentence. Pure / testable.
 */
export function _chunkText(text: string,
  target:  number = CHUNK_TARGET_CHARS,
  overlap: number = CHUNK_OVERLAP_CHARS,
): Chunk[] {
  // Normalize whitespace to reduce noise in chunks (PDFs extract with
  // lots of \r and stray spaces). Preserve paragraph breaks as \n\n.
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (normalized.length === 0) return []
  if (normalized.length <= target) return [{ text: normalized, start: 0, end: normalized.length }]

  const chunks: Chunk[] = []
  const boundaryTolerance = Math.min(200, Math.floor(target / 6))
  let cursor = 0
  while (cursor < normalized.length) {
    let end = Math.min(cursor + target, normalized.length)

    // If not at the end, try to nudge to a sentence/paragraph boundary
    // within the tolerance window to avoid splitting mid-sentence.
    if (end < normalized.length) {
      const windowStart = Math.max(cursor + target - boundaryTolerance, cursor + 1)
      const windowEnd   = Math.min(cursor + target + boundaryTolerance, normalized.length)
      const window = normalized.slice(windowStart, windowEnd)
      // Preference order: paragraph break, sentence terminator, space
      let offset = window.lastIndexOf('\n\n')
      if (offset < 0) {
        const m = window.match(/[.!?]\s/)
        offset = m?.index != null ? m.index + 1 : -1
      }
      if (offset < 0) offset = window.lastIndexOf(' ')
      if (offset > 0) end = windowStart + offset
    }

    chunks.push({
      text:  normalized.slice(cursor, end).trim(),
      start: cursor,
      end,
    })
    if (end >= normalized.length) break
    cursor = Math.max(end - overlap, cursor + 1)
  }
  return chunks
}

// ─── Test-only ────────────────────────────────────────────────────────────────

export const __testHooks = {
  chunkText: _chunkText,
  CHUNK_TARGET_CHARS,
  CHUNK_OVERLAP_CHARS,
}

// Keep node imports visible to unused-locals in strict mode (used by sha256
// helpers below when registered elsewhere — placeholder retained for future
// dedup helper).
void crypto
void path
