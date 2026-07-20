/**
 * Tests: api/services/integration/novaOutbox.ts
 *
 * Pure backoff ladder + dead-letter disposition, contract-envelope shape
 * (validated manually against the frozen JSON schema files — no ajv), and the
 * enqueue no-op when NOVA_EXTERNAL is off.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  tenantQuery: vi.fn(),
  tenantTransaction: vi.fn(),
  pool: { connect: vi.fn() },
}))

import {
  BACKOFF_LADDER_MS,
  MAX_ATTEMPTS,
  nextAttemptDelayMs,
  failureDisposition,
  buildEventEnvelope,
  enqueueNovaEvent,
} from '../services/integration/novaOutbox'

const _dir = dirname(fileURLToPath(import.meta.url))
const CONTRACTS_DIR = resolve(_dir, '../../docs/integration/nova-denver/contracts/v1')

interface JsonSchema {
  required: string[]
  properties: Record<string, { enum?: string[]; const?: string; properties?: Record<string, unknown>; required?: string[] }>
}

function loadSchema(file: string): JsonSchema {
  return JSON.parse(readFileSync(resolve(CONTRACTS_DIR, file), 'utf8')) as JsonSchema
}

/** Manual structural check: required fields present, enums honored, no unknown keys. */
function checkAgainstSchema(schema: JsonSchema, value: Record<string, unknown>): string[] {
  const problems: string[] = []
  for (const key of schema.required) {
    if (value[key] === undefined) problems.push(`missing required '${key}'`)
  }
  for (const key of Object.keys(value)) {
    const prop = schema.properties[key]
    if (!prop) { problems.push(`unknown key '${key}'`); continue }
    if (prop.const !== undefined && value[key] !== prop.const) problems.push(`'${key}' !== const ${prop.const}`)
    if (prop.enum !== undefined && !prop.enum.includes(String(value[key]))) problems.push(`'${key}' not in enum`)
  }
  return problems
}

describe('backoff ladder (pure)', () => {
  it('follows the connector-framework ladder 30s, 60s, 5m, 15m, 1h', () => {
    expect(BACKOFF_LADDER_MS).toEqual([30_000, 60_000, 300_000, 900_000, 3_600_000])
    expect(nextAttemptDelayMs(1)).toBe(30_000)
    expect(nextAttemptDelayMs(2)).toBe(60_000)
    expect(nextAttemptDelayMs(3)).toBe(300_000)
    expect(nextAttemptDelayMs(4)).toBe(900_000)
    expect(nextAttemptDelayMs(5)).toBe(3_600_000)
  })

  it('requeues with the ladder delay until attempt 6, then dead-letters', () => {
    expect(failureDisposition(1)).toEqual({ status: 'queued', delayMs: 30_000 })
    expect(failureDisposition(2)).toEqual({ status: 'queued', delayMs: 60_000 })
    expect(failureDisposition(3)).toEqual({ status: 'queued', delayMs: 300_000 })
    expect(failureDisposition(4)).toEqual({ status: 'queued', delayMs: 900_000 })
    expect(failureDisposition(5)).toEqual({ status: 'queued', delayMs: 3_600_000 })
    expect(failureDisposition(MAX_ATTEMPTS)).toEqual({ status: 'dead', delayMs: null })
    expect(failureDisposition(7)).toEqual({ status: 'dead', delayMs: null })
  })
})

describe('buildEventEnvelope (pure) vs frozen contract schemas', () => {
  const baseRow = {
    event_id: 'ev-12345678',
    seq: '42',
    correlation_id: 'corr-1',
    created_at: new Date('2026-07-20T15:00:00Z'),
  }

  it('produces a valid progress event envelope', () => {
    const envelope = buildEventEnvelope({
      ...baseRow,
      event_type: 'denver.project.progress.updated',
      payload: {
        connectionId: 'conn-1', novaTenantId: 'nova-t-1',
        novaProjectId: 'nova-p-9', denverProjectId: 'dp-1',
        summary: { overallStatus: 'construction', overallPercent: 61.5, deficienciesOpen: 4, criticalDeficienciesOpen: 1, turnoverStatus: 'in_progress' },
      },
    })
    const schema = loadSchema('progress-event.schema.json')
    expect(checkAgainstSchema(schema, envelope)).toEqual([])
    // Nested summary honors the schema too.
    const summarySchema = schema.properties['summary'] as unknown as JsonSchema
    expect(checkAgainstSchema(summarySchema, envelope['summary'] as Record<string, unknown>)).toEqual([])
    expect(envelope['sequence']).toBe(42)
    expect(envelope['occurredAt']).toBe('2026-07-20T15:00:00.000Z')
  })

  it('produces a valid turnover event envelope', () => {
    const envelope = buildEventEnvelope({
      ...baseRow,
      event_type: 'denver.turnover.package.updated',
      payload: {
        connectionId: 'conn-1', novaTenantId: 'nova-t-1',
        novaProjectId: 'nova-p-9', denverProjectId: 'dp-1',
        package: { packageId: 'tp-1', title: 'Compressor Train A', status: 'ready_for_turnover', systemOrArea: 'Area 100' },
      },
    })
    const schema = loadSchema('turnover-event.schema.json')
    expect(checkAgainstSchema(schema, envelope)).toEqual([])
    const packageSchema = schema.properties['package'] as unknown as JsonSchema
    expect(checkAgainstSchema(packageSchema, envelope['package'] as Record<string, unknown>)).toEqual([])
  })

  it('omits correlationId when the row has none (never null-filled)', () => {
    const envelope = buildEventEnvelope({
      ...baseRow,
      correlation_id: null,
      event_type: 'denver.integration.test',
      payload: { connectionId: 'c', novaTenantId: 'n', novaProjectId: 'p', denverProjectId: 'd', summary: { overallStatus: 'planning' } },
    })
    expect('correlationId' in envelope).toBe(false)
  })
})

describe('enqueueNovaEvent', () => {
  beforeEach(() => { mockQuery.mockReset() })
  afterEach(() => { delete process.env['NOVA_EXTERNAL'] })

  it('is a no-op returning { enabled:false } when NOVA_EXTERNAL is off', async () => {
    delete process.env['NOVA_EXTERNAL']
    const result = await enqueueNovaEvent('t1', 'denver.integration.test', {
      connectionId: 'c', novaTenantId: 'n', novaProjectId: 'p', denverProjectId: 'd',
    })
    expect(result).toEqual({ enabled: false })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('inserts an outbox row when enabled', async () => {
    process.env['NOVA_EXTERNAL'] = 'true'
    mockQuery.mockResolvedValue({ rows: [{ id: 'ob-1' }] })
    const result = await enqueueNovaEvent('t1', 'denver.project.progress.updated', {
      connectionId: 'c', novaTenantId: 'n', novaProjectId: 'p', denverProjectId: 'd',
      summary: { overallStatus: 'planning' },
    }, 'corr-9')
    expect(result).toEqual({ enabled: true, outboxId: 'ob-1' })
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(String(sql)).toContain('INSERT INTO nova_outbox')
    expect(params[0]).toBe('t1')
    expect(params[1]).toBe('denver.project.progress.updated')
    expect(params[3]).toBe('corr-9')
  })
})
