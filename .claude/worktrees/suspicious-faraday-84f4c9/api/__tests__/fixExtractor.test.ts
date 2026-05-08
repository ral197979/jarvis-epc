/**
 * Tests: api/services/fixExtractor.ts
 * Focus: tool-schema contract + system-prompt guardrails.
 * (The Anthropic call itself is not exercised here — network + cost.)
 */

import { describe, it, expect } from 'vitest'
import { __testHooks } from '../services/fixExtractor'

const { EXTRACT_TOOL, SYSTEM_PROMPT, CHUNKS_PER_BATCH, CHUNK_CHAR_LIMIT } = __testHooks

describe('EXTRACT_TOOL schema', () => {
  it('requires fixes array at top level', () => {
    expect(EXTRACT_TOOL.input_schema.required).toEqual(['fixes'])
  })

  it('each fix requires symptoms, root_cause, resolution_steps, cited_chunk_ids', () => {
    const props = EXTRACT_TOOL.input_schema.properties as Record<string, Record<string, unknown>>
    const item  = (props['fixes'] as { items: { required: string[] } }).items
    expect(item.required).toEqual([
      'symptoms', 'root_cause', 'resolution_steps', 'cited_chunk_ids',
    ])
  })

  it('symptoms is a string array (snake_case convention enforced by description)', () => {
    const props = EXTRACT_TOOL.input_schema.properties as Record<string, Record<string, unknown>>
    const item = (props['fixes'] as { items: { properties: Record<string, Record<string, unknown>> } }).items
    expect(item.properties['symptoms']!['type']).toBe('array')
    const items = item.properties['symptoms']!['items'] as Record<string, unknown>
    expect(items['type']).toBe('string')
    expect(String(item.properties['symptoms']!['description'])).toMatch(/snake_case/)
  })
})

describe('SYSTEM_PROMPT guardrails', () => {
  it('forbids inventing values / setpoints / part numbers', () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER invent/i)
  })
  it('requires all three: symptoms, root cause, resolution', () => {
    expect(SYSTEM_PROMPT).toMatch(/all three/i)
  })
  it('allows empty extraction — not every chunk has a fix', () => {
    expect(SYSTEM_PROMPT).toMatch(/empty/i)
  })
  it('demands chunk_id citation per fix', () => {
    expect(SYSTEM_PROMPT).toMatch(/chunk_id/i)
  })
})

describe('cost-control constants', () => {
  it('batch size + chunk limit keep input bounded', () => {
    expect(CHUNKS_PER_BATCH).toBeGreaterThanOrEqual(1)
    expect(CHUNKS_PER_BATCH).toBeLessThanOrEqual(12)
    expect(CHUNK_CHAR_LIMIT).toBeGreaterThan(400)
    expect(CHUNK_CHAR_LIMIT).toBeLessThan(4000)
  })
})
