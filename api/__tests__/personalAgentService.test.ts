/**
 * Tests: api/services/agents/personalAgentService.ts (ADR-012, Phase 1)
 *
 * Pure orchestration over mocked deps (DB pool, agent memory query, My Work,
 * askJarvis). Covers the flag, user-scoped memory store/list/forget wiring,
 * the briefing composition, and the ask delegation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../db/pool', () => ({ tenantQuery: vi.fn() }))
vi.mock('../services/agents/agentMemoryService', () => ({ queryMemory: vi.fn() }))
vi.mock('../services/myWork/myWorkService', () => ({ buildMyWork: vi.fn() }))
vi.mock('../services/askBuilder', () => ({ askJarvis: vi.fn() }))

import { tenantQuery } from '../db/pool'
import { queryMemory } from '../services/agents/agentMemoryService'
import { buildMyWork } from '../services/myWork/myWorkService'
import { askJarvis } from '../services/askBuilder'
import {
  isPersonalAgentEnabled, rememberForUser, listUserMemory, forgetUserMemory,
  getPersonalBriefing, askPersonalAgent,
} from '../services/agents/personalAgentService'

const tq = tenantQuery as ReturnType<typeof vi.fn>
const qm = queryMemory as ReturnType<typeof vi.fn>
const mw = buildMyWork as ReturnType<typeof vi.fn>
const aj = askJarvis as ReturnType<typeof vi.fn>

const T = 'tenant-1'
const U = 'user-42'

describe('personalAgentService', () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env['PERSONAL_AGENT'] })
  afterEach(() => { delete process.env['PERSONAL_AGENT'] })

  it('flag defaults off and reads live', () => {
    expect(isPersonalAgentEnabled()).toBe(false)
    process.env['PERSONAL_AGENT'] = 'true'
    expect(isPersonalAgentEnabled()).toBe(true)
  })

  it('rememberForUser upserts as personal_agent / user scope / clamped confidence', async () => {
    tq.mockResolvedValue({ rows: [{ key: 'tz', value: { value: 'UTC' }, memory_type: 'preference', confidence: 100 }] })
    const saved = await rememberForUser({ tenantId: T, userId: U, key: 'tz', value: { value: 'UTC' }, confidence: 250 })

    expect(saved).toEqual({ key: 'tz', value: { value: 'UTC' }, memoryType: 'preference', confidence: 100 })
    const [tenantArg, , params] = tq.mock.calls[0]
    expect(tenantArg).toBe(T)
    // params: [tenant, agent_type, scope_type, scope_id, memory_type, key, value(json), confidence]
    expect(params[1]).toBe('personal_agent')
    expect(params[2]).toBe('user')
    expect(params[3]).toBe(U)
    expect(params[5]).toBe('tz')
    expect(params[7]).toBe(100)            // 250 clamped to 100
  })

  it('listUserMemory queries user scope and maps entries', async () => {
    qm.mockResolvedValue([
      { key: 'tz', value: { value: 'UTC' }, memoryType: 'preference', confidence: 90 },
      { key: 'role', value: { value: 'PM' }, memoryType: 'fact', confidence: undefined },
    ])
    const list = await listUserMemory(T, U)

    expect(qm).toHaveBeenCalledWith(T, { scopeType: 'user', scopeId: U, limit: 200 })
    expect(list).toEqual([
      { key: 'tz', value: { value: 'UTC' }, memoryType: 'preference', confidence: 90 },
      { key: 'role', value: { value: 'PM' }, memoryType: 'fact', confidence: null },
    ])
  })

  it('forgetUserMemory reports whether a row was removed', async () => {
    tq.mockResolvedValueOnce({ rows: [{ id: 'x' }] })
    expect(await forgetUserMemory(T, U, 'tz')).toBe(true)
    tq.mockResolvedValueOnce({ rows: [] })
    expect(await forgetUserMemory(T, U, 'missing')).toBe(false)
    const [, , params] = tq.mock.calls[0]
    expect(params).toEqual([T, 'personal_agent', 'user', U, 'tz'])
  })

  it('getPersonalBriefing combines My Work and personal memory', async () => {
    mw.mockResolvedValue({ lanes: { overdue: [], today: [] }, total: 0 })
    qm.mockResolvedValue([{ key: 'tz', value: { value: 'UTC' }, memoryType: 'preference', confidence: 100 }])

    const b = await getPersonalBriefing(T, U, new Date('2026-07-02T00:00:00Z'))
    expect(mw).toHaveBeenCalledWith(T, U, new Date('2026-07-02T00:00:00Z'))
    expect(b.userId).toBe(U)
    expect(b.work).toEqual({ lanes: { overdue: [], today: [] }, total: 0 })
    expect(b.memory).toHaveLength(1)
    expect(b.generatedAt).toBe('2026-07-02T00:00:00.000Z')
  })

  it('askPersonalAgent delegates to askJarvis for the user and attaches personal memory', async () => {
    aj.mockResolvedValue({ session_id: 's1', structured: { answer: 'hi' } })
    qm.mockResolvedValue([{ key: 'tz', value: { value: 'UTC' }, memoryType: 'preference', confidence: 100 }])

    const r = await askPersonalAgent({ tenantId: T, userId: U, question: 'what is overdue?' })
    expect(aj).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T, userId: U, question: 'what is overdue?', projectId: null }))
    expect(r.answer).toMatchObject({ session_id: 's1' })
    expect(r.personalMemoryUsed).toHaveLength(1)
  })
})
