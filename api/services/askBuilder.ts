/**
 * Denver Engineering — Grounded RAG Ask Builder (v4.31.0)
 *
 * Full pipeline behind POST /api/v1/ask:
 *
 *   1. Retrieve — lexical FTS over knowledge_chunks (existing service)
 *   2. Filter   — project_id, asset_system, source kinds
 *   3. Rank     — tier-weighted (OEM > record > other > form) via
 *                 knowledgeTier.TIER_WEIGHT
 *   4. Fix lookup — parallel query to knowledge_fixes for same terms
 *   5. Trim     — cap to top 8 chunks, 1200 chars each (hard cost ceiling)
 *   6. Build    — structured prompt w/ numbered sources + prior fixes
 *   7. Ask      — Claude via Anthropic SDK with tool_use forcing a
 *                 schema-compliant "record_answer" call (no free text)
 *   8. Persist  — chat_messages row w/ structured_answer + retrieved ids
 *
 * Output shape (enforced by the tool schema below):
 *   { answer, procedure[], possible_causes[], confidence, citations[] }
 *
 * Agents can call the same pipeline through the MCP `ask_domain` tool
 * which returns this exact JSON.
 */

import Anthropic from '@anthropic-ai/sdk'
import { tenantTransaction } from '../db/pool'
import { searchKnowledge, type KnowledgeHit } from './knowledgeSearch'
import { searchFixes, type FixSearchHit } from './fixLibrary'
import { getAiBudgetStatus, recordAiUsage, AiBudgetExceededError } from './enterprise/aiCostTracker'
import { slog } from '../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AskInput {
  tenantId:    string
  userId:      string
  sessionId?:  string          // when null, start a new session
  question:    string
  projectId?:  string | null
  assetSystem?: string | null
  // Escape hatches — normally defaults are right
  topK?:       number          // default 8, clamped [3,12]
  chunkCharLimit?: number      // per-chunk truncate cap (default 1200)
  agentType?:  string          // cost attribution (e.g. 'personal_agent'); default null
}

export interface Citation {
  source:   string             // source_title
  chunk_id: string
  page_ref?: string | null
  tier:     string
}

export interface StructuredAnswer {
  answer:          string
  procedure:       string[]
  possible_causes: string[]
  confidence:      number      // 0.0–1.0
  citations:       Citation[]
}

export interface AskResult {
  session_id:      string
  message_id:      string
  structured:      StructuredAnswer
  retrieved_chunks: KnowledgeHit[]
  matched_fixes:   FixSearchHit[]
  model:           string
  input_tokens:    number
  output_tokens:   number
  elapsed_ms:      number
}

// ─── Anthropic setup ──────────────────────────────────────────────────────────

const DEFAULT_MODEL = process.env['ASK_MODEL'] ?? 'claude-sonnet-4-6'

function getClient(): Anthropic {
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey || apiKey.startsWith('placeholder')) {
    throw new Error('ANTHROPIC_API_KEY not configured — /ask requires a real key')
  }
  // ANTHROPIC_BASE_URL points the SDK at a self-hosted / OpenAI-compatible model
  // behind an Anthropic-compatible proxy (e.g. LiteLLM). Unset → Anthropic's API.
  return new Anthropic({ apiKey, baseURL: process.env['ANTHROPIC_BASE_URL'] || undefined })
}

// The one tool Claude is allowed to call. The schema is the OUTPUT
// contract — Anthropic validates arguments against it, so we never
// parse free text or worry about malformed JSON.
const RECORD_ANSWER_TOOL: Anthropic.Tool = {
  name: 'record_answer',
  description:
    'Return the structured answer. You MUST call this tool exactly once. ' +
    'Ground every claim in the provided SOURCES. If no source supports ' +
    'the user\'s question, set confidence to 0.0 and explain in `answer`.',
  input_schema: {
    type: 'object',
    required: ['answer','procedure','possible_causes','confidence','citations'],
    properties: {
      answer: {
        type: 'string',
        description: 'A direct 1-3 sentence answer to the question.',
      },
      procedure: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Numbered actionable steps. Empty array [] if the question is ' +
          'conceptual rather than procedural.',
      },
      possible_causes: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Likely root causes relevant to the question. Empty array [] ' +
          'if question is not diagnostic.',
      },
      confidence: {
        type: 'number',
        minimum: 0, maximum: 1,
        description:
          '0.0 = no coverage in sources. 0.3 = thin coverage, partial. ' +
          '0.7 = clear coverage from OEM or records. 0.95 = multiple ' +
          'authoritative sources converge.',
      },
      citations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['source', 'chunk_id', 'tier'],
          properties: {
            source:   { type: 'string', description: 'source_title' },
            chunk_id: { type: 'string' },
            page_ref: { type: 'string' },
            tier:     { type: 'string', enum: ['oem','record','form','other'] },
          },
        },
        description:
          'Only chunks you actually used. One entry per distinct chunk ' +
          'referenced. Empty [] if confidence is 0.',
      },
    },
  },
}

// ─── Context builder ─────────────────────────────────────────────────────────

function _truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 3).trimEnd() + '...'
}

function _buildContextBlock(chunks: KnowledgeHit[], fixes: FixSearchHit[], perChunkLimit: number): string {
  const lines: string[] = []
  lines.push('# SOURCES')
  chunks.forEach((c, i) => {
    lines.push('')
    lines.push(`## [${i + 1}] ${c.source_title}  ·  chunk_id=${c.chunk_id}  ·  tier=${c.tier}${c.page_ref ? `  ·  ${c.page_ref}` : ''}`)
    lines.push(_truncate(c.text, perChunkLimit))
  })
  if (fixes.length > 0) {
    lines.push('')
    lines.push('# PRIOR FIXES (engineer-authored, tenant-owned)')
    fixes.forEach((f, i) => {
      lines.push('')
      lines.push(`## [F${i + 1}] ${f.fix.root_cause}  ·  fix_id=${f.fix.id}  ·  confidence=${f.fix.confidence}`)
      lines.push(`asset_system=${f.fix.asset_system ?? '—'}  symptoms=${f.fix.symptoms.join(', ')}`)
      lines.push(_truncate(f.fix.resolution_steps, perChunkLimit))
    })
  }
  return lines.join('\n')
}

const SYSTEM_PROMPT = `You are a senior commissioning engineer for industrial EPC projects (water treatment, HVAC, PLC/VFD systems). Answer ONLY from the provided SOURCES — never from general knowledge. Rules:

- If no source addresses the question, set confidence to 0.0 and state that in \`answer\`.
- Prefer OEM / record tier over form tier when sources conflict.
- Every step in \`procedure\` must be traceable to a cited chunk_id.
- Keep answer field tight (1-3 sentences); push detail into procedure or possible_causes.
- NEVER invent part numbers, torque specs, setpoints, or safety interlocks.
- If safety-critical info is incomplete in sources, say so explicitly in \`answer\`.

You MUST call the record_answer tool exactly once. Do not produce free text.`

// ─── Public entry point ──────────────────────────────────────────────────────

export async function askJarvis(input: AskInput): Promise<AskResult> {
  const started = Date.now()
  const topK    = Math.max(3, Math.min(12, input.topK ?? 8))
  const chunkCharLimit = Math.max(300, Math.min(3000, input.chunkCharLimit ?? 1200))

  // 1-3: tier-weighted retrieval over corpus. Hybrid (lexical + semantic)
  // when the corpus has embeddings; falls back silently to pure lexical
  // otherwise — never errors the /ask request for missing embeddings.
  const chunks = await searchKnowledge({
    tenantId:       input.tenantId,
    query:          input.question,
    topK,
    assetSystem:    input.assetSystem ?? undefined,
    projectId:      input.projectId ?? undefined,
    applyTierBoost: true,
    useSemantic:    true,
  })

  // 4: parallel fix-library lookup — question becomes a free-text query.
  //    Symptom-tag search would be stronger but we don't have tags yet
  //    from raw NL input. FTS over rationale+resolution is the v1 path.
  const fixes = await searchFixes({
    tenantId: input.tenantId,
    query:    input.question,
    assetSystem: input.assetSystem ?? undefined,
    limit: 3,
  })

  // 5-6: build context + 7: model call w/ schema-enforced tool
  const contextBlock = _buildContextBlock(chunks, fixes, chunkCharLimit)
  const client = getClient()
  const model = DEFAULT_MODEL

  // Budget gate — refuse BEFORE spending when the tenant is over its monthly AI
  // budget. Only enforces when a budget is configured (isOverBudget is false
  // otherwise), so it's opt-in per tenant. Fails OPEN on a budget-lookup error
  // so a transient DB issue never blocks a legitimate ask.
  try {
    const budget = await getAiBudgetStatus(input.tenantId)
    if (budget.isOverBudget) throw new AiBudgetExceededError(budget)
  } catch (err) {
    if (err instanceof AiBudgetExceededError) throw err
    slog('WARN', 'askBuilder', '[ask] budget check failed — allowing (fail-open)', {
      tenantId: input.tenantId, error: (err as Error).message,
    })
  }

  const completion = await client.messages.create({
    model,
    max_tokens: 2048,
    tools: [RECORD_ANSWER_TOOL],
    tool_choice: { type: 'tool', name: 'record_answer' },
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: [
        { type: 'text', text: contextBlock },
        { type: 'text', text: `\n# QUESTION\n${input.question}` },
      ] },
    ],
  })

  // Extract the tool invocation. tool_choice forced exactly one.
  const toolUse = completion.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  )
  if (!toolUse) {
    throw new Error('Claude returned no tool_use — schema contract broken')
  }
  const structured = toolUse.input as unknown as StructuredAnswer

  // 8: persist session + turns
  const { sessionId, messageId } = await _persistTurn({
    tenantId:      input.tenantId,
    userId:        input.userId,
    sessionId:     input.sessionId,
    projectId:     input.projectId ?? null,
    question:      input.question,
    structured,
    retrievedIds:  chunks.map(c => c.chunk_id),
    model,
    inputTokens:   completion.usage.input_tokens,
    outputTokens:  completion.usage.output_tokens,
  })

  const elapsed = Date.now() - started

  // Meter spend for the AI cost tracker / budget engine. Best-effort — an
  // accounting hiccup must never fail an answer the user already received.
  try {
    await recordAiUsage(input.tenantId, {
      agentType:        input.agentType,
      model,
      provider:         process.env['ANTHROPIC_BASE_URL'] ? 'custom' : 'anthropic',
      operation:        'ask',
      promptTokens:     completion.usage.input_tokens,
      completionTokens: completion.usage.output_tokens,
      latencyMs:        elapsed,
    })
  } catch (err) {
    slog('WARN', 'askBuilder', '[ask] usage recording failed', {
      tenantId: input.tenantId, error: (err as Error).message,
    })
  }

  slog('INFO', 'askBuilder', '[ask] resolved', {
    tenantId:   input.tenantId,
    sessionId,
    model,
    chunks:     chunks.length,
    fixes:      fixes.length,
    confidence: structured.confidence,
    elapsed,
  })

  return {
    session_id:       sessionId,
    message_id:       messageId,
    structured,
    retrieved_chunks: chunks,
    matched_fixes:    fixes,
    model,
    input_tokens:     completion.usage.input_tokens,
    output_tokens:    completion.usage.output_tokens,
    elapsed_ms:       elapsed,
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

interface PersistArgs {
  tenantId:     string
  userId:       string
  sessionId?:   string
  projectId:    string | null
  question:     string
  structured:   StructuredAnswer
  retrievedIds: string[]
  model:        string
  inputTokens:  number
  outputTokens: number
}

async function _persistTurn(a: PersistArgs): Promise<{ sessionId: string; messageId: string }> {
  return tenantTransaction(a.tenantId, async (client) => {
    let sessionId = a.sessionId
    let nextOrdinal = 0

    if (!sessionId) {
      // Create session — derive title from first 80 chars of question.
      const title = a.question.trim().slice(0, 80)
      const sRes = await client.query<{ id: string }>(`
        INSERT INTO chat_sessions (tenant_id, user_id, title, project_id, message_count)
        VALUES (current_setting('app.current_tenant_id',true)::uuid,
                $1, $2, $3, 0)
        RETURNING id
      `, [a.userId, title, a.projectId])
      sessionId = sRes.rows[0]!.id
    } else {
      // Compute next ordinal; also verify ownership before writing.
      const ord = await client.query<{ n: string }>(`
        SELECT COUNT(*)::text AS n FROM chat_messages
        WHERE session_id = $1
          AND tenant_id  = current_setting('app.current_tenant_id',true)::uuid
      `, [sessionId])
      nextOrdinal = parseInt(ord.rows[0]?.n ?? '0', 10)
    }

    // User turn
    await client.query(`
      INSERT INTO chat_messages
        (session_id, tenant_id, ordinal, role, content)
      VALUES
        ($1, current_setting('app.current_tenant_id',true)::uuid, $2, 'user', $3)
    `, [sessionId, nextOrdinal, a.question])

    // Assistant turn
    const mRes = await client.query<{ id: string }>(`
      INSERT INTO chat_messages
        (session_id, tenant_id, ordinal, role, content, structured_answer,
         retrieved_chunk_ids, input_tokens, output_tokens, model)
      VALUES
        ($1, current_setting('app.current_tenant_id',true)::uuid, $2,
         'assistant', $3, $4::jsonb, $5::jsonb, $6, $7, $8)
      RETURNING id
    `, [
      sessionId, nextOrdinal + 1,
      a.structured.answer,
      JSON.stringify(a.structured),
      JSON.stringify(a.retrievedIds),
      a.inputTokens, a.outputTokens, a.model,
    ])

    await client.query(`
      UPDATE chat_sessions
      SET message_count = message_count + 2, updated_at = NOW()
      WHERE id = $1
    `, [sessionId])

    return { sessionId: sessionId!, messageId: mRes.rows[0]!.id }
  })
}

// ─── Test-only hooks ──────────────────────────────────────────────────────────

export const __testHooks = {
  RECORD_ANSWER_TOOL,
  SYSTEM_PROMPT,
  _buildContextBlock,
  _truncate,
}
