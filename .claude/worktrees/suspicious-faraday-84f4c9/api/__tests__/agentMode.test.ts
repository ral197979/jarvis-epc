/**
 * Tests: api/middleware/agentMode.ts
 * Focus on state-machine behavior: pass-through, queued, frozen.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (tenantId: string, sql: string, params: unknown[]) => mockQuery(tenantId, sql, params),
  query:       (sql: string, params: unknown[]) => mockQuery(null, sql, params),
}))

const mockRecord = vi.fn().mockResolvedValue('action-id')
vi.mock('../services/agentActions', () => ({
  record: (input: unknown) => mockRecord(input),
}))

import { requireAgentMode } from '../middleware/agentMode'

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    method:   'POST',
    path:     '/api/v1/commissioning/arbitrate',
    headers:  {},
    params:   {},
    body:     {},
    ...overrides,
  } as any
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    _json: null,
    status(code: number) { this.statusCode = code; return this },
    json(body: unknown) { this._json = body; return this },
  }
  return res
}

describe('requireAgentMode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes through when no X-Agent-Action header (human request)', async () => {
    const next = vi.fn()
    await requireAgentMode(['auto'])(makeReq(), makeRes(), next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('passes through for tenant-wide agent actions without project context', async () => {
    const next = vi.fn()
    const req = makeReq({ headers: { 'x-agent-action': 'digest' } })
    await requireAgentMode(['auto'])(req, makeRes(), next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('returns 403 when project is frozen', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ agent_mode: 'frozen' }] })
    const next = vi.fn()
    const req = makeReq({
      headers: { 'x-agent-action': 'ci_arbiter' },
      body:    { project_id: 'p-1' },
    })
    const res = makeRes()
    await requireAgentMode(['auto'])(req, res, next)
    expect(res.statusCode).toBe(403)
    expect(res._json.error).toBe('project_frozen')
    expect(next).not.toHaveBeenCalled()
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'suppressed' }),
    )
  })

  it('returns 202 + records queued action when mode not in allowed set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ agent_mode: 'review_all' }] })
    const next = vi.fn()
    const req = makeReq({
      headers: { 'x-agent-action': 'ci_arbiter' },
      body:    { project_id: 'p-1' },
    })
    const res = makeRes()
    await requireAgentMode(['auto'])(req, res, next)
    expect(res.statusCode).toBe(202)
    expect(res._json.queued).toBe(true)
    expect(res._json.action_id).toBe('action-id')
    expect(next).not.toHaveBeenCalled()
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'queued' }),
    )
  })

  it('passes through when mode matches allowed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ agent_mode: 'auto' }] })
    const next = vi.fn()
    const req = makeReq({
      headers: { 'x-agent-action': 'ci_arbiter' },
      body:    { project_id: 'p-1' },
    })
    await requireAgentMode(['auto'])(req, makeRes(), next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('fails closed (queued) when DB read errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection reset'))
    const next = vi.fn()
    const req = makeReq({
      headers: { 'x-agent-action': 'ci_arbiter' },
      body:    { project_id: 'p-1' },
    })
    const res = makeRes()
    await requireAgentMode(['auto'])(req, res, next)
    expect(res.statusCode).toBe(202)          // fell back to review_all
    expect(next).not.toHaveBeenCalled()
  })
})
