/**
 * JARVIS EPC — Embedding service (v4.31.0)
 *
 * Thin wrapper around OpenAI's embeddings API with batching, retry,
 * and strict dimension enforcement. No SDK dependency — plain fetch.
 *
 * Default model: text-embedding-3-small (1536 dims, $0.02/Mtok).
 * Override via EMBED_MODEL env var; if dimensions change you must
 * ALTER the knowledge_chunks.embedding column and re-embed the corpus.
 *
 * The service knows nothing about Jarvis schemas — callers (like the
 * ingest handler or the search path) pass in strings and get back
 * Float32Array-ish number arrays.
 */

import { slog } from '../../src/modules/observability/index'

export interface EmbedResult {
  vectors:       number[][]
  model:         string
  total_tokens:  number
}

const DEFAULT_MODEL = process.env['EMBED_MODEL'] ?? 'text-embedding-3-small'
export const EMBED_DIMENSIONS = Number(process.env['EMBED_DIMENSIONS'] ?? '1536')

// OpenAI accepts up to 2048 strings per request, but long inputs blow
// the per-request token ceiling (8191 tokens). We batch conservatively.
const MAX_BATCH_INPUTS = 96

// Each input string gets truncated to this many chars before being
// sent so we never overflow the token-per-request cap on big chunks.
const MAX_INPUT_CHARS = 8000

function _apiKey(): string {
  const k = process.env['OPENAI_API_KEY']
  if (!k || k.startsWith('placeholder') || k.length < 20) {
    throw new Error('OPENAI_API_KEY not configured — Phase 3 semantic search requires a real key')
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
    const res = await fetch('https://api.openai.com/v1/embeddings', {
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
      throw new Error(`OpenAI embeddings HTTP ${res.status}: ${text.slice(0, 200)}`)
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
