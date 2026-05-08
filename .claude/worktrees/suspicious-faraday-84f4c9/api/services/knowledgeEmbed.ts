/**
 * JARVIS EPC — Knowledge embed handler (v4.31.0)
 *
 * Scheduler-backed batch embedder. Job payload: { sourceId? }.
 *   - sourceId present → embed all un-embedded chunks for that source
 *   - sourceId absent  → embed the next un-embedded batch corpus-wide
 *     (allows multi-job parallelism if scheduler workers are added later)
 *
 * Writes to knowledge_chunks.embedding (VECTOR) + embedding_json (JSONB
 * backup) + embedding_model (provenance).
 */

import { query, tenantTransaction } from '../db/pool'
import { registerHandler, enqueue, type BackgroundJob } from './scheduler'
import { embedTexts, toPgVectorLiteral, EMBED_DIMENSIONS } from './embed'
import { slog } from '../../src/modules/observability/index'

const EMBED_BATCH_SIZE = Number(process.env['EMBED_BATCH_SIZE']   ?? '96')

interface EmbedPayload {
  sourceId?: string
}

interface ChunkRow {
  id:   string
  text: string
}

export function registerKnowledgeEmbedHandler(): void {
  registerHandler('embed_chunks', _handleEmbedJob)
  slog('INFO', 'knowledgeEmbed', '[boot] Registered embed_chunks handler')
}

export async function enqueueEmbedSource(
  tenantId: string, sourceId: string, userId: string | null,
): Promise<string | null> {
  return enqueue(tenantId, 'embed_chunks', { sourceId }, {
    maxAttempts: 2, createdBy: userId ?? undefined,
  })
}

export async function enqueueEmbedBulk(
  tenantId: string, userId: string | null, opts: { limit?: number } = {},
): Promise<{ enqueued: number; sourcesPending: number }> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100))
  // Filter to sources that actually still have un-embedded chunks.
  // Previously ORDER BY updated_at DESC LIMIT N skipped sources that
  // lost priority after earlier runs — this variant finds all stragglers.
  const res = await query<{ id: string }>(`
    SELECT s.id
    FROM   knowledge_sources s
    WHERE  s.tenant_id = $1
      AND  s.status    = 'ready'
      AND  s.chunk_count > 0
      AND  EXISTS (
        SELECT 1 FROM knowledge_chunks c
        WHERE c.source_id = s.id AND c.embedding IS NULL
      )
    ORDER BY s.created_at
    LIMIT  $2
  `, [tenantId, limit])

  let enqueued = 0
  for (const r of res.rows) {
    await enqueue(tenantId, 'embed_chunks', { sourceId: r.id }, {
      maxAttempts: 2, createdBy: userId ?? undefined,
    })
    enqueued++
  }
  return { enqueued, sourcesPending: enqueued }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function _handleEmbedJob(job: BackgroundJob): Promise<Record<string, unknown>> {
  const { sourceId } = job.payload_json as unknown as EmbedPayload

  // Pull a batch of chunks needing embeddings — scoped to source if provided.
  const scope = sourceId ? 'AND source_id = $2' : ''
  const vals  = sourceId ? [job.tenant_id, sourceId] : [job.tenant_id]
  const chunks = await query<ChunkRow>(`
    SELECT id, text
    FROM   knowledge_chunks
    WHERE  tenant_id = $1 AND embedding IS NULL ${scope}
    ORDER  BY ordinal
    LIMIT  ${EMBED_BATCH_SIZE}
  `, vals)

  if (chunks.rows.length === 0) {
    return { sourceId, embedded: 0, reason: 'no_pending_chunks' }
  }

  const inputs = chunks.rows.map(c => c.text)
  const result = await embedTexts(inputs)
  if (result.vectors.length !== chunks.rows.length) {
    throw new Error(`embedding count mismatch: asked for ${chunks.rows.length} got ${result.vectors.length}`)
  }

  // Write all embeddings in one transaction.
  await tenantTransaction(job.tenant_id, async (client) => {
    for (let i = 0; i < chunks.rows.length; i++) {
      const row = chunks.rows[i]!
      const vec = result.vectors[i]!
      if (vec.length !== EMBED_DIMENSIONS) {
        throw new Error(`expected ${EMBED_DIMENSIONS} dims, got ${vec.length} for chunk ${row.id}`)
      }
      await client.query(`
        UPDATE knowledge_chunks
        SET    embedding       = $1::vector,
               embedding_json  = $2::jsonb,
               embedding_model = $3
        WHERE  id = $4
          AND  tenant_id = current_setting('app.current_tenant_id',true)::uuid
      `, [toPgVectorLiteral(vec), JSON.stringify(vec), result.model, row.id])
    }
  })

  // If this job is scoped to a source and more chunks remain, re-enqueue
  // so the scheduler drains the source progressively without any single
  // job running for minutes on end.
  if (sourceId) {
    const remaining = await query<{ n: string }>(`
      SELECT COUNT(*)::text AS n FROM knowledge_chunks
      WHERE  source_id = $1 AND tenant_id = $2 AND embedding IS NULL
    `, [sourceId, job.tenant_id])
    const left = parseInt(remaining.rows[0]?.n ?? '0', 10)
    if (left > 0) {
      await enqueue(job.tenant_id, 'embed_chunks', { sourceId }, {
        maxAttempts: 2, createdBy: job.created_by ?? undefined,
      })
    }
  }

  slog('INFO', 'knowledgeEmbed', '[embed] batch complete', {
    sourceId, embedded: chunks.rows.length, tokens: result.total_tokens, model: result.model,
  })

  return {
    sourceId:   sourceId ?? null,
    embedded:   chunks.rows.length,
    tokens:     result.total_tokens,
    model:      result.model,
  }
}
