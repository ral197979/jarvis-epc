/**
 * Denver Engineering — Fix Library Auto-Extractor (v4.31.0)
 *
 * Phase 2 of the "make Jarvis smarter" plan. For each ingested source,
 * we batch its chunks through Claude with a tool-use schema that forces
 * extraction of any `{symptoms, root_cause, resolution_steps}` narratives
 * present. Extracted rows are written to knowledge_fixes with:
 *
 *   confidence        = 'suspected'   (engineer verifies to promote)
 *   source_id         = <source row>  (provenance)
 *   extraction_run_id = <uuid>        (rollback / compare runs)
 *   source_url        = storage_path  (citation)
 *   source_note       = chunk_ids cited
 *
 * Cost controls:
 *   - Only processes sources whose tier classifies as 'oem' or 'record'
 *     unless `--all` is passed. Forms/templates rarely contain fix
 *     narratives; running them just burns tokens.
 *   - Batches CHUNKS_PER_BATCH chunks per Claude call.
 *   - Truncates each chunk to CHUNK_CHAR_LIMIT to cap input size.
 *   - Per-source hard ceiling MAX_BATCHES_PER_SOURCE.
 *   - Skips sources that already have fixes with a non-null
 *     extraction_run_id (idempotent; use re-extract to override).
 *
 * Design: async via the existing scheduler. HTTP caller gets a job_id
 * and polls status via /api/v1/knowledge/sources/:id. No long-running
 * synchronous HTTP.
 */

import Anthropic from '@anthropic-ai/sdk'
import crypto from 'node:crypto'
import { query, tenantTransaction } from '../db/pool'
import { registerHandler, enqueue, type BackgroundJob } from './scheduler'
import { classifySource } from './knowledgeTier'
import { slog } from '../../src/modules/observability/index'

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_MODEL        = process.env['FIX_EXTRACT_MODEL']       ?? 'claude-sonnet-4-6'
const CHUNKS_PER_BATCH     = Number(process.env['FIX_EXTRACT_BATCH'] ?? '6')
const CHUNK_CHAR_LIMIT     = Number(process.env['FIX_EXTRACT_CHAR_LIMIT'] ?? '1400')
const MAX_BATCHES_PER_SOURCE = Number(process.env['FIX_EXTRACT_MAX_BATCHES'] ?? '50')
const MAX_OUTPUT_TOKENS    = 1500

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractPayload {
  sourceId:   string
  runId?:     string
  reextract?: boolean   // force: delete prior auto-fixes for this source first
}

export interface ExtractedFix {
  symptoms:         string[]
  root_cause:       string
  resolution_steps: string
  asset_system_hint?: string
  cited_chunk_ids:  string[]
}

interface SourceRow {
  id: string
  tenant_id: string
  title: string
  kind: string
  storage_path: string | null
  asset_system: string | null
  chunk_count: number
  status: string
}

interface ChunkRow {
  id: string
  ordinal: number
  text: string
  page_ref: string | null
}

// ─── Public: register the handler ─────────────────────────────────────────────

export function registerFixExtractorHandler(): void {
  registerHandler('extract_fixes_from_source', _handleExtractJob)
  slog('INFO', 'fixExtractor', '[boot] Registered extract_fixes_from_source handler')
}

// ─── Public: enqueue helpers ──────────────────────────────────────────────────

export async function enqueueExtractFromSource(
  tenantId: string,
  sourceId: string,
  userId:   string | null,
  opts:     { reextract?: boolean } = {},
): Promise<string | null> {
  const runId = crypto.randomUUID()
  return enqueue(tenantId, 'extract_fixes_from_source',
    { sourceId, runId, reextract: opts.reextract ?? false },
    { maxAttempts: 2, createdBy: userId ?? undefined },
  )
}

// Bulk: enqueue one job per OEM/record source that hasn't been extracted yet.
export async function enqueueExtractBulk(
  tenantId: string,
  userId:   string | null,
  opts:     { limit?: number; assetSystem?: string | null; reextract?: boolean } = {},
): Promise<{ enqueued: number; skipped: number; runId: string }> {
  const runId = crypto.randomUUID()
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100))

  // Already-extracted filter: skip sources that have ANY auto-extracted fix
  // unless reextract=true.
  const skipExtractedClause = opts.reextract
    ? ''
    : `AND NOT EXISTS (
         SELECT 1 FROM knowledge_fixes f
         WHERE f.source_id = s.id
           AND f.extraction_run_id IS NOT NULL
       )`

  const assetSystemClause = opts.assetSystem ? `AND s.asset_system = $2` : ''
  const sqlParams: unknown[] = [tenantId]
  if (opts.assetSystem) sqlParams.push(opts.assetSystem)

  const res = await query<SourceRow>(`
    SELECT id, tenant_id, title, kind, storage_path, asset_system, chunk_count, status
    FROM   knowledge_sources s
    WHERE  s.tenant_id = $1
      AND  s.status = 'ready'
      AND  s.chunk_count > 0
      ${skipExtractedClause}
      ${assetSystemClause}
    ORDER BY s.created_at DESC
    LIMIT ${limit}
  `, sqlParams)

  let enqueued = 0, skipped = 0
  for (const row of res.rows) {
    const tier = classifySource(row.title, row.kind)
    // Only auto-process OEM + record tiers — forms rarely contain fix narratives
    if (tier === 'form' || tier === 'other') { skipped++; continue }
    await enqueue(tenantId, 'extract_fixes_from_source',
      { sourceId: row.id, runId, reextract: opts.reextract ?? false },
      { maxAttempts: 2, createdBy: userId ?? undefined },
    )
    enqueued++
  }
  return { enqueued, skipped, runId }
}

// ─── Anthropic setup ──────────────────────────────────────────────────────────

function getClient(): Anthropic {
  const key = process.env['ANTHROPIC_API_KEY']
  if (!key || key.startsWith('placeholder')) {
    throw new Error('ANTHROPIC_API_KEY not configured — fix extraction requires a real key')
  }
  return new Anthropic({ apiKey: key, baseURL: process.env['ANTHROPIC_BASE_URL'] || undefined })
}

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'record_fixes',
  description:
    'Extract troubleshooting fix narratives from the provided chunks. ' +
    'A FIX is a distinct problem-and-resolution pair where ALL three are ' +
    'present in the text: (1) observable symptoms / failure signals, ' +
    '(2) named root cause, (3) concrete resolution steps. ' +
    'Skip product descriptions, generic warnings, marketing copy, ' +
    'parts lists, specifications, and anything that is not a complete ' +
    'problem→solution narrative. If no qualifying narratives exist, ' +
    'return an empty fixes array. DO NOT invent fixes.',
  input_schema: {
    type: 'object',
    required: ['fixes'],
    properties: {
      fixes: {
        type: 'array',
        items: {
          type: 'object',
          required: ['symptoms', 'root_cause', 'resolution_steps', 'cited_chunk_ids'],
          properties: {
            symptoms: {
              type: 'array',
              items: { type: 'string' },
              description:
                '1-5 short symptom tags in snake_case (e.g. ' +
                '"oil_pressure_trip", "low_discharge_pressure", ' +
                '"vfd_fault_fdbkl"). Lowercase only.',
            },
            root_cause: {
              type: 'string',
              description: 'One sentence naming what is actually wrong.',
            },
            resolution_steps: {
              type: 'string',
              description:
                'Numbered list or paragraph describing the fix. Include ' +
                'specific values / settings / part references only if they ' +
                'appear in the source chunks — do not invent them.',
            },
            asset_system_hint: {
              type: 'string',
              description:
                'Equipment category this fix applies to, if clearly ' +
                'inferable (e.g. "chiller", "vfd", "booster_pump", "ro_skid").',
            },
            cited_chunk_ids: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Chunk IDs (from the provided chunk headers) where this ' +
                'fix narrative appears. Every returned fix MUST cite at ' +
                'least one chunk_id.',
            },
          },
        },
      },
    },
  },
}

const SYSTEM_PROMPT = `You are a senior commissioning engineer extracting high-quality troubleshooting knowledge from technical documentation into a structured fix library.

RULES:
- Return ONLY fixes that have all three: observable symptoms, named root cause, concrete resolution steps.
- Every fix must cite the chunk_id(s) where its narrative appears.
- Prefer SPECIFIC fixes ("replace oil filter when pressure drop >50 psi") over generic ones ("check oil").
- NEVER invent values, setpoints, torque specs, or part numbers. If the source doesn't name them, omit them.
- Skip: product descriptions, marketing copy, generic warnings without causes, TOC, parts lists.
- It is correct and expected to return an empty fixes array (\`{"fixes":[]}\`) for chunks that are purely informational.
- Call record_fixes exactly once per request. No free text.`

// ─── Handler ──────────────────────────────────────────────────────────────────

async function _handleExtractJob(job: BackgroundJob): Promise<Record<string, unknown>> {
  const { sourceId, runId, reextract } = job.payload_json as unknown as ExtractPayload
  if (!sourceId) throw new Error('extract_fixes_from_source payload missing sourceId')
  const effectiveRunId = runId ?? crypto.randomUUID()

  // 1. Load source metadata
  const srcRes = await query<SourceRow>(`
    SELECT id, tenant_id, title, kind, storage_path, asset_system, chunk_count, status
    FROM   knowledge_sources
    WHERE  id = $1 AND tenant_id = $2
  `, [sourceId, job.tenant_id])
  const src = srcRes.rows[0]
  if (!src) throw new Error(`Source not found: ${sourceId}`)
  if (src.status !== 'ready') {
    slog('WARN', 'fixExtractor', '[extract] source not ready, skipping', { sourceId, status: src.status })
    return { sourceId, skipped: true, reason: `status=${src.status}` }
  }

  // 2. Reextract: drop prior auto-extracted fixes (preserves engineer-authored)
  if (reextract) {
    await query(
      `DELETE FROM knowledge_fixes WHERE source_id = $1 AND extraction_run_id IS NOT NULL`,
      [sourceId],
    )
  }

  // 3. Load chunks
  const chunksRes = await query<ChunkRow>(`
    SELECT id, ordinal, text, page_ref
    FROM   knowledge_chunks
    WHERE  source_id = $1 AND tenant_id = $2
    ORDER BY ordinal
  `, [sourceId, job.tenant_id])
  const chunks = chunksRes.rows
  if (chunks.length === 0) return { sourceId, fixes_extracted: 0, batches: 0, reason: 'no_chunks' }

  // 4. Batch + extract
  const client = getClient()
  const batchSize   = Math.max(1, CHUNKS_PER_BATCH)
  const maxBatches  = MAX_BATCHES_PER_SOURCE
  const totalBatches = Math.min(maxBatches, Math.ceil(chunks.length / batchSize))

  let totalFixes = 0
  let totalInput = 0, totalOutput = 0

  for (let b = 0; b < totalBatches; b++) {
    const start = b * batchSize
    const batch = chunks.slice(start, start + batchSize)
    const { extracted, inputTokens, outputTokens } = await _extractBatch(client, src, batch)
    totalInput  += inputTokens
    totalOutput += outputTokens

    if (extracted.length > 0) {
      const inserted = await _persistFixes(src, extracted, effectiveRunId)
      totalFixes += inserted
    }
  }

  slog('INFO', 'fixExtractor', '[extract] done', {
    sourceId, title: src.title, chunks: chunks.length, batches: totalBatches,
    fixes: totalFixes, input_tokens: totalInput, output_tokens: totalOutput,
  })

  return {
    sourceId,
    title:           src.title,
    chunks:          chunks.length,
    batches:         totalBatches,
    fixes_extracted: totalFixes,
    input_tokens:    totalInput,
    output_tokens:   totalOutput,
    run_id:          effectiveRunId,
  }
}

// ─── Batch extraction ─────────────────────────────────────────────────────────

async function _extractBatch(
  client: Anthropic, src: SourceRow, batch: ChunkRow[],
): Promise<{ extracted: ExtractedFix[]; inputTokens: number; outputTokens: number }> {
  const contextLines: string[] = [
    `# SOURCE: ${src.title}`,
    `# ASSET_SYSTEM: ${src.asset_system ?? '(unclassified)'}`,
    '',
    '# CHUNKS',
  ]
  for (const c of batch) {
    contextLines.push('')
    contextLines.push(`## chunk_id=${c.id}${c.page_ref ? ` · ${c.page_ref}` : ''}`)
    const text = c.text.length > CHUNK_CHAR_LIMIT
      ? c.text.slice(0, CHUNK_CHAR_LIMIT - 3) + '...'
      : c.text
    contextLines.push(text)
  }

  try {
    const completion = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: 'record_fixes' },
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: contextLines.join('\n') },
      ],
    })

    const toolUse = completion.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    const extracted = (toolUse?.input as { fixes?: ExtractedFix[] } | undefined)?.fixes ?? []

    return {
      extracted,
      inputTokens:  completion.usage.input_tokens,
      outputTokens: completion.usage.output_tokens,
    }
  } catch (err) {
    slog('WARN', 'fixExtractor', '[batch] extraction call failed', {
      sourceId: src.id, message: err instanceof Error ? err.message : String(err),
    })
    return { extracted: [], inputTokens: 0, outputTokens: 0 }
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function _persistFixes(
  src: SourceRow, fixes: ExtractedFix[], runId: string,
): Promise<number> {
  let inserted = 0
  await tenantTransaction(src.tenant_id, async (client) => {
    for (const f of fixes) {
      // Validation — defensive even though tool schema enforces shape
      if (!Array.isArray(f.symptoms) || f.symptoms.length === 0) continue
      if (!f.root_cause?.trim() || !f.resolution_steps?.trim()) continue
      if (!Array.isArray(f.cited_chunk_ids) || f.cited_chunk_ids.length === 0) continue

      const symptoms = f.symptoms
        .map(s => String(s).toLowerCase().trim())
        .filter(s => s.length > 0)
        .slice(0, 5)
      if (symptoms.length === 0) continue

      await client.query(`
        INSERT INTO knowledge_fixes
          (tenant_id, source_id, extraction_run_id,
           asset_system, symptoms, root_cause, resolution_steps,
           confidence, source_url, source_note, created_by)
        VALUES
          (current_setting('app.current_tenant_id',true)::uuid,
           $1, $2, $3, $4::text[], $5, $6,
           'suspected', $7, $8, NULL)
      `, [
        src.id,
        runId,
        f.asset_system_hint ?? src.asset_system ?? null,
        symptoms,
        f.root_cause.trim(),
        f.resolution_steps.trim(),
        src.storage_path,
        `auto-extracted from chunks: ${f.cited_chunk_ids.slice(0, 5).join(', ')}`,
      ])
      inserted++
    }
  })
  return inserted
}

// ─── Test-only hooks ──────────────────────────────────────────────────────────

export const __testHooks = {
  EXTRACT_TOOL,
  SYSTEM_PROMPT,
  DEFAULT_MODEL,
  CHUNKS_PER_BATCH,
  CHUNK_CHAR_LIMIT,
  MAX_BATCHES_PER_SOURCE,
}
