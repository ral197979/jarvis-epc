/**
 * ADR-014 Phase 2 §20 — Ask Jarvis / Knowledge entry-point authorization.
 *
 * The UI hides Ask Jarvis from roles without `assistant.use`, but the endpoints
 * accepted any authenticated tenant user, so the client denial was bypassable by
 * calling the API directly. These tests drive the server, not React.
 *
 * SCOPE: this proves who may *use* the endpoints. It does not prove which
 * documents the retriever returns — retrieval filtering is Phase 3.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => mockQuery(...a),
  tenantQuery:       (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: vi.fn(),
  pool:              { connect: vi.fn() },
}))

// requireAuth stands in for a verified token; the role deliberately does NOT
// come from here — the capability layer re-reads it from the database.
vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['auth'] = { sub: 'u1', tid: 't1', role: 'owner' }   // stale claim on purpose
    next()
  },
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = 't1'
    next()
  },
}))
vi.mock('../services/askBuilder', () => ({ askJarvis: vi.fn(async () => ({ answer: 'ok', citations: [] })) }))
vi.mock('../services/enterprise/aiCostTracker', () => ({ AiBudgetExceededError: class extends Error {} }))
vi.mock('../services/knowledgeIngest',  () => ({ enqueueSourceIngest: vi.fn() }))
vi.mock('../services/knowledgeSearch',   () => ({ searchKnowledge: vi.fn(async () => ({ results: [] })) }))
vi.mock('../services/knowledgeEmbed',   () => ({ enqueueEmbedSource: vi.fn(), enqueueEmbedBulk: vi.fn() }))
vi.mock('../services/fixExtractor',     () => ({ mineFixesFromSource: vi.fn(), mineFixesBulk: vi.fn() }))

const askRouter       = (await import('../routes/ask')).default
const knowledgeRouter = (await import('../routes/knowledge')).default

/** Whatever role the database currently reports for the caller. */
function currentRole(role: string) {
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = String(args[0] ?? '') + String(args[1] ?? '')
    if (/FROM users WHERE id/.test(sql)) {
      return { rows: [{ id: 'u1', tenant_id: 't1', role, is_active: true }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  })
}

function app() {
  const a = express()
  a.use(express.json())
  a.use('/api/v1/ask', askRouter)
  a.use('/api/v1/knowledge', knowledgeRouter)
  return a
}

beforeEach(() => { mockQuery.mockReset() })

// Phase 1 grants assistant.use to owner, project_manager, engineer, procurement.
// It is withheld from viewer, field_ops and the platform administrator.
const MAY_USE    = ['owner', 'project_manager', 'engineer', 'procurement']
const MAY_NOT    = ['viewer', 'field_ops', 'admin']

describe('§20 — Ask Jarvis entry point', () => {
  it.each(MAY_NOT)('denies %s with 403, despite a valid tenant session', async role => {
    currentRole(role)
    const res = await request(app()).post('/api/v1/ask').send({ question: 'what is the budget?' })
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'forbidden' })
  })

  it.each(MAY_USE)('does not deny %s on capability grounds', async role => {
    currentRole(role)
    const res = await request(app()).post('/api/v1/ask').send({ question: 'what is the budget?' })
    expect(res.status).not.toBe(403)
  })

  it('denies a viewer reading chat sessions', async () => {
    currentRole('viewer')
    expect((await request(app()).get('/api/v1/ask/sessions')).status).toBe(403)
  })

  it('denies session deletion to everyone without assistant.admin', async () => {
    for (const role of ['project_manager', 'engineer', 'procurement', 'viewer', 'field_ops']) {
      currentRole(role)
      const res = await request(app()).delete('/api/v1/ask/sessions/s1')
      expect(res.status, `${role} must not delete chat sessions`).toBe(403)
    }
  })
})

describe('§20 — Knowledge entry point', () => {
  it.each(MAY_NOT)('denies %s searching the corpus', async role => {
    currentRole(role)
    const res = await request(app()).post('/api/v1/knowledge/search').send({ q: 'weld procedure' })
    expect(res.status).toBe(403)
  })

  it('denies corpus administration to non-admin assistant users', async () => {
    for (const role of ['project_manager', 'engineer', 'procurement']) {
      currentRole(role)
      expect((await request(app()).post('/api/v1/knowledge/bulk-ingest').send({ docs: [] })).status,
        `${role} must not ingest`).toBe(403)
      expect((await request(app()).delete('/api/v1/knowledge/sources/s1')).status,
        `${role} must not delete a source`).toBe(403)
    }
  })

  it('admits the owner to corpus administration', async () => {
    currentRole('owner')
    expect((await request(app()).post('/api/v1/knowledge/bulk-ingest').send({ docs: [] })).status).not.toBe(403)
  })
})

describe('§20 — the boundary uses current server state only', () => {
  it('ignores the role embedded in the token', async () => {
    // requireAuth injects role: 'owner'; the database says viewer.
    currentRole('viewer')
    expect((await request(app()).post('/api/v1/ask').send({ question: 'x' })).status).toBe(403)
  })

  it('ignores client-supplied role hints entirely (D4)', async () => {
    currentRole('viewer')
    const res = await request(app())
      .post('/api/v1/ask?role=owner')
      .set('x-role', 'owner')
      .set('x-effective-role', 'owner')
      .send({ question: 'x', role: 'owner', activeRole: 'owner' })
    expect(res.status).toBe(403)
  })
})
