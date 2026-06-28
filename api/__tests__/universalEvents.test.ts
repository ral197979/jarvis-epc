/**
 * Tests: api/services/events/universalEvents.ts
 *
 * Vocabulary + envelope are pure. Fan-out (webhook dispatcher + realtime bus) is
 * mocked so we can assert flag gating and the canonical→realtime mapping subset.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockEmit = vi.fn()
vi.mock('../services/webhookDispatch', () => ({
  emitEvent: (...a: unknown[]) => mockEmit(...a),
}))
const mockBroadcast = vi.fn()
vi.mock('../realtime/eventBroadcaster', () => ({
  broadcastEvent: (...a: unknown[]) => mockBroadcast(...a),
}))

import {
  isCanonicalEvent, buildEnvelope, publishEvent, CANONICAL_EVENTS, UnknownEventError,
} from '../services/events/universalEvents'

describe('canonical vocabulary', () => {
  it('recognizes canonical events and rejects others', () => {
    expect(isCanonicalEvent('fat.completed')).toBe(true)
    expect(isCanonicalEvent('FATCompleted')).toBe(false)
    expect(isCanonicalEvent('nope.nope')).toBe(false)
  })
  it('every canonical event is dotted lowercase', () => {
    for (const e of CANONICAL_EVENTS) expect(e).toMatch(/^[a-z]+(\.[a-z_]+)+$/)
  })
})

describe('buildEnvelope', () => {
  it('builds a full envelope with defaults', () => {
    const env = buildEnvelope('t1', 'project.created')
    expect(env).toMatchObject({ event: 'project.created', tenant_id: 't1', project_id: null, subject_uuid: null, data: {} })
    expect(env.event_id).toMatch(/[0-9a-f-]{36}/)
    expect(typeof env.occurred_at).toBe('string')
  })
  it('uses injected id/timestamp/fields', () => {
    const env = buildEnvelope('t1', 'equipment.updated', {
      eventId: 'e-1', occurredAt: '2026-06-25T00:00:00.000Z',
      projectId: 'p1', subjectUuid: 'eq-uuid', correlationId: 'c-1', data: { tag: 'P-101' },
    })
    expect(env).toEqual({
      event_id: 'e-1', event: 'equipment.updated', tenant_id: 't1',
      project_id: 'p1', subject_uuid: 'eq-uuid', occurred_at: '2026-06-25T00:00:00.000Z',
      correlation_id: 'c-1', data: { tag: 'P-101' },
    })
  })
  it('throws UnknownEventError for a non-canonical event', () => {
    expect(() => buildEnvelope('t1', 'made.up')).toThrow(UnknownEventError)
  })
})

describe('publishEvent — flag gating + fan-out', () => {
  beforeEach(() => { mockEmit.mockReset(); mockBroadcast.mockReset(); delete process.env['UNIVERSAL_EVENTS'] })
  afterEach(() => { delete process.env['UNIVERSAL_EVENTS'] })

  it('does not fan out when the flag is off (still returns envelope)', async () => {
    const r = await publishEvent('t1', 'project.created', { projectId: 'p1' })
    expect(r.published).toBe(false)
    expect(r.envelope.event).toBe('project.created')
    expect(mockEmit).not.toHaveBeenCalled()
    expect(mockBroadcast).not.toHaveBeenCalled()
  })

  it('emits to the webhook dispatcher with the canonical name when enabled', async () => {
    process.env['UNIVERSAL_EVENTS'] = 'true'
    const r = await publishEvent('t1', 'project.created', { projectId: 'p1', eventId: 'e1' })
    expect(r.published).toBe(true)
    expect(mockEmit).toHaveBeenCalledWith('t1', 'project.created', expect.objectContaining({ event: 'project.created', event_id: 'e1' }))
    expect(mockBroadcast).not.toHaveBeenCalled() // not in the realtime-mapped subset
  })

  it('also mirrors mapped events to the realtime bus', async () => {
    process.env['UNIVERSAL_EVENTS'] = 'true'
    await publishEvent('t1', 'fat.completed', { projectId: 'p1' })
    expect(mockEmit).toHaveBeenCalledWith('t1', 'fat.completed', expect.any(Object))
    expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'readiness_changed', tenant_id: 't1', subscription_scope: 'readiness', scope_id: 'p1',
    }))
  })

  it('rejects an unknown event and does not emit', async () => {
    process.env['UNIVERSAL_EVENTS'] = 'true'
    await expect(publishEvent('t1', 'bogus.event')).rejects.toThrow(UnknownEventError)
    expect(mockEmit).not.toHaveBeenCalled()
  })
})
