/**
 * Denver Engineering — Embedding service (v4.31.0)
 *
 * Thin wrapper around OpenAI-compatible embeddings APIs with batching,
 * retry, and strict dimension enforcement. No SDK dependency — plain
 * fetch. Supports two providers picked by EMBED_PROVIDER:
 *
 *   'openai'   → https://api.openai.com/v1/embeddings
 *                 default model: text-embedding-3-small (1536 dims)
 *                 needs: OPENAI_API_KEY
 *
 *   'together' → https://api.together.xyz/v1/embeddings  (default)
 *                 default model: intfloat/multilingual-e5-large-instruct (1024 dims)
 *                 needs: TOGETHER_AI_API_KEY
 *
 * If dimensions change, ALTER the knowledge_chunks.embedding column
 * to the new dimension and re-embed. The EMBED_DIMENSIONS env var
 * must match the chosen model.
 */

import { slog } from '../../src/modules/observability/index'

export interface EmbedResult {
  vectors:       number[][]
  model:         string
  total_tokens:  number
}

type Provider = 'openai' | 'together'

function _resolveProvider(): Provider {
  const raw = (process.env['EMBED_PROVIDER'] ?? '').toLowerCase().trim()
  if (raw === 'openai' || raw === 'together') return raw
  // Auto-select: prefer Together AI (cheaper, the key we have works).
  if (process.env['TOGETHER_AI_API_KEY']) return 'together'
  if (process.env['OPENAI_API_KEY'])      return 'openai'
  return 'together'  // force a clear error from _apiKey() if nothing is set
}

// maxChars: provider-specific input truncation. Together's e5-large
// maxes at 512 tokens (~2000 chars with typical English, but engineering
// PDFs tokenize denser because of numbers/codes — stay conservative at
// 1500 chars ≈ ~380 tokens). OpenAI text-embedding-3-small handles 8191
// tokens, so we can send bigger chunks without loss.
const PROVIDER_DEFAULTS: Record<Provider, { model: string; dims: number; url: string; envKey: string; maxChars: number }> = {
  openai:   {
    model: 'text-embedding-3-small', dims: 1536,
    url:   'https://api.openai.com/v1/embeddings',
    envKey: 'OPENAI_API_KEY',
    maxChars: 8000,
  },
  together: {
    model: 'intfloat/multilingual-e5-large-instruct', dims: 1024,
    url:   'https://api.together.xyz/v1/embeddings',
    envKey: 'TOGETHER_AI_API_KEY',
    // 512-token cap is hard; engineering PDFs with lots of numbers /
    // codes / abbreviations tokenize at up to ~0.73 tokens/char. Observed:
    // a 1000-char engineering chunk tokenized to 733 tokens, rejected.
    // 700 chars leaves safe headroom. Most useful semantic content in
    // the first 700 chars of any chunk anyway.
    maxChars: 700,
  },
}

const PROVIDER = _resolveProvider()
const DEFAULT_MODEL = process.env['EMBED_MODEL'] ?? PROVIDER_DEFAULTS[PROVIDER].model
export const EMBED_DIMENSIONS = Number(process.env['EMBED_DIMENSIONS'] ?? String(PROVIDER_DEFAULTS[PROVIDER].dims))
const API_URL = process.env['EMBED_URL'] ?? PROVIDER_DEFAULTS[PROVIDER].url

const MAX_BATCH_INPUTS = 96
const MAX_INPUT_CHARS = Number(process.env['EMBED_MAX_INPUT_CHARS'] ?? String(PROVIDER_DEFAULTS[PROVIDER].maxChars))

function _apiKey(): string {
  const envKey = PROVIDER_DEFAULTS[PROVIDER].envKey
  const k = process.env[envKey]
  if (!k || k.startsWith('placeholder') || k.length < 20) {
    throw new Error(`${envKey} not configured — Phase 3 semantic search requires a real key`)
  }
  return k
}

// Truncate inputs defensively — long PDF chunks can overflow the 8k
// token per-input limit and fail the whole batch.
function _prepInput(s: string): string {
  const clean = (s ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length <= MAX_INPUT_CHARS) return clean
  return clean.slice(0, MAX_INPUT_CHARS - 3) + '...'
}

/**
 * Embed an array of strings. Returns one vector per input, same order,
 * plus token accounting for cost tracking. Auto-batches above the
 * MAX_BATCH_INPUTS threshold.
 */
export async function embedTexts(inputs: string[]): Promise<EmbedResult> {
  if (inputs.length === 0) return { vectors: [], model: DEFAULT_MODEL, total_tokens: 0 }
  const key = _apiKey()
  const model = DEFAULT_MODEL

  const allVectors: number[][] = []
  let totalTokens = 0

  for (let i = 0; i < inputs.length; i += MAX_BATCH_INPUTS) {
    const batch = inputs.slice(i, i + MAX_BATCH_INPUTS).map(_prepInput)
    const { vectors, tokens } = await _callEmbed(key, model, batch)
    allVectors.push(...vectors)
    totalTokens += tokens
  }

  return { vectors: allVectors, model, total_tokens: totalTokens }
}

async function _callEmbed(
  key: string, model: string, inputs: string[], attempt = 1,
): Promise<{ vectors: number[][]; tokens: number }> {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ model, input: inputs }),
    })
    if (!res.ok) {
      const text = await res.text()
      // Retry once on transient 429 / 5xx; otherwise fail
      if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
        const delay = 2_000 * attempt
        slog('WARN', 'embed', `[retry] ${res.status} after ${delay}ms`, { attempt })
        await new Promise(r => setTimeout(r, delay))
        return _callEmbed(key, model, inputs, attempt + 1)
      }
      throw new Error(`${PROVIDER} embeddings HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    const body = await res.json() as {
      data: Array<{ embedding: number[]; index: number }>
      usage: { total_tokens: number }
    }
    // Response order matches input order per the API contract.
    // Sort defensively to make sure (-> index).
    const sorted = [...body.data].sort((a, b) => a.index - b.index)
    return {
      vectors: sorted.map(d => d.embedding),
      tokens:  body.usage?.total_tokens ?? 0,
    }
  } catch (err) {
    if (attempt < 3) {
      const delay = 1_500 * attempt
      slog('WARN', 'embed', `[retry] network error after ${delay}ms`, {
        attempt, message: err instanceof Error ? err.message : String(err),
      })
      await new Promise(r => setTimeout(r, delay))
      return _callEmbed(key, model, inputs, attempt + 1)
    }
    throw err
  }
}

/**
 * Format a JS number[] as a pgvector literal: '[1.23,4.56,...]'
 * so it can be passed as a $n parameter to INSERT / UPDATE.
 */
export function toPgVectorLiteral(v: number[]): string {
  // No spaces; pgvector accepts JSON-ish array syntax.
  return `[${v.join(',')}]`
}

export const __testHooks = {
  DEFAULT_MODEL, MAX_BATCH_INPUTS, MAX_INPUT_CHARS, _prepInput,
}
