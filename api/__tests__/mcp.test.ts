/**
 * Tests: api/routes/mcp.ts
 * Coverage: tool catalogue, native tool execution, Ava proxy fallback,
 *           health endpoint, domain allowlist, session creation, audit logging
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../auth', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}))

vi.mock('../middleware/tenant', () => ({
  requireTenant: (req: any, _res: any, next: any) => {
    req.tenantId = 'tenant-test'
    req.auth     = { sub: 'user-abc', tid: 'tenant-test', role: 'owner', jti: 'jti-1' }
    next()
  },
}))

vi.mock('../db/pool', () => ({
  tenantQuery: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  query:       vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}))

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        id:          'msg-test-123',
        model:       'claude-sonnet-4-6',
        content:     [{ type: 'text', text: 'Hello from mock' }],
        usage:       { input_tokens: 10, output_tokens: 20 },
        stop_reason: 'end_turn',
      }),
    }
  },
}))

// Mock global fetch for Ava proxy calls
const mockFetch = vi.fn()
global.fetch = mockFetch

import express from 'express'
import request from 'supertest'
// v4.31.0 fix: module exports the router under the name `mcpRouter`, not `router`
import { mcpRouter } from '../routes/mcp'

const app = express()
app.use(express.json())
app.use('/api/v1/mcp', mcpRouter as any)

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/v1/mcp/tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env['AVA_MCP_URL']
  })

  it('returns native tools when Ava is not configured', async () => {
    const res = await request(app).get('/api/v1/mcp/tools')
    expect(res.status).toBe(200)
    expect(res.body.tools).toBeDefined()
    expect(Array.isArray(res.body.tools)).toBe(true)
    expect(res.body.tools.length).toBeGreaterThan(0)
    expect(res.body.ava_connected).toBe(false)
  })

  it('includes http_fetch as a native tool', async () => {
    const res = await request(app).get('/api/v1/mcp/tools')
    const httpFetch = res.body.tools.find((t: any) => t.name === 'http_fetch')
    expect(httpFetch).toBeDefined()
    expect(httpFetch.live).toBe(true)
  })

  it('includes all 6 native tools', async () => {
    const res = await request(app).get('/api/v1/mcp/tools')
    const names = res.body.tools.map((t: any) => t.name)
    for (const required of ['http_fetch','audit_log','audit_query','model_call','embedding_create','session_create']) {
      expect(names).toContain(required)
    }
  })

  it('merges Ava tools when AVA_MCP_URL is set and reachable', async () => {
    process.env['AVA_MCP_URL'] = 'http://ava-test:8788'
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tools: [{ name: 'bash', cat: 'System', desc: 'Run shell command', params: ['command'] }] }),
    })
    const res = await request(app).get('/api/v1/mcp/tools')
    expect(res.body.ava_connected).toBe(true)
    expect(res.body.ava_count).toBe(1)
    const toolNames = res.body.tools.map((t: any) => t.name)
    expect(toolNames).toContain('bash')
  })

  it('falls back gracefully when Ava is configured but unreachable', async () => {
    process.env['AVA_MCP_URL'] = 'http://ava-unreachable:9999'
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const res = await request(app).get('/api/v1/mcp/tools')
    expect(res.status).toBe(200)
    expect(res.body.ava_connected).toBe(false)
  })

  afterEach(() => { delete process.env['AVA_MCP_URL'] })
})

describe('GET /api/v1/mcp/ava/health', () => {
  it('reports Ava as not configured when AVA_MCP_URL is unset', async () => {
    delete process.env['AVA_MCP_URL']
    const res = await request(app).get('/api/v1/mcp/ava/health')
    expect(res.status).toBe(200)
    expect(res.body.healthy).toBe(false)
    expect(res.body.reason).toMatch(/not configured/i)
  })

  it('reports Ava as healthy when /health returns 200', async () => {
    process.env['AVA_MCP_URL'] = 'http://ava-healthy:8788'
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ status: 'ok', version: '2.1.0', tools: 34 }),
      headers: { get: () => null, entries: () => [] },
    })
    const res = await request(app).get('/api/v1/mcp/ava/health')
    expect(res.body.healthy).toBe(true)
    expect(res.body.version).toBe('2.1.0')
    delete process.env['AVA_MCP_URL']
  })

  it('reports Ava as unhealthy when /health returns non-200', async () => {
    process.env['AVA_MCP_URL'] = 'http://ava-sick:8788'
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
    const res = await request(app).get('/api/v1/mcp/ava/health')
    expect(res.body.healthy).toBe(false)
    delete process.env['AVA_MCP_URL']
  })
})

describe('POST /api/v1/mcp/execute — native tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env['AVA_MCP_URL']
    delete process.env['MCP_FETCH_ALLOWLIST']
  })

  it('returns 400 when tool name is missing', async () => {
    const res = await request(app).post('/api/v1/mcp/execute').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/tool/)
  })

  it('executes audit_log and returns ok:true', async () => {
    const res = await request(app).post('/api/v1/mcp/execute').send({
      tool: 'audit_log', params: { action: 'test_event', details: { note: 'unit test' } },
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.action).toBe('test_event')
  })

  it('executes audit_query and returns entries array', async () => {
    const { query } = await import('../db/pool')
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: 'AUD-1', action: 'test', created_at: new Date().toISOString() }], rowCount: 1 } as any)
    const res = await request(app).post('/api/v1/mcp/execute').send({
      tool: 'audit_query', params: { filter: 'test', limit: '10' },
    })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.entries)).toBe(true)
  })

  it('executes model_call and returns content', async () => {
    const res = await request(app).post('/api/v1/mcp/execute').send({
      tool: 'model_call',
      params: {
        model:      'claude-sonnet-4-6',
        messages:   JSON.stringify([{ role: 'user', content: 'Hello' }]),
        max_tokens: '256',
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.content).toBeDefined()
    expect(res.body.id).toBe('msg-test-123')
  })

  it('returns 400 for model_call with no messages', async () => {
    const res = await request(app).post('/api/v1/mcp/execute').send({
      tool: 'model_call', params: {},
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/messages/)
  })

  it('executes http_fetch with open allowlist (no env var set)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, text: async () => '{"hello":"world"}',
      headers: { entries: () => [['content-type', 'application/json']] },
    })
    const res = await request(app).post('/api/v1/mcp/execute').send({
      tool: 'http_fetch', params: { url: 'https://api.example.com/data', method: 'GET' },
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.status).toBe(200)
  })

  it('blocks http_fetch when domain not in allowlist', async () => {
    process.env['MCP_FETCH_ALLOWLIST'] = 'allowed.com,other.com'
    const res = await request(app).post('/api/v1/mcp/execute').send({
      tool: 'http_fetch', params: { url: 'https://blocked.example.com/data' },
    })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('domain_not_allowed')
  })

  it('allows http_fetch when domain matches allowlist', async () => {
    process.env['MCP_FETCH_ALLOWLIST'] = 'allowed.com'
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, text: async () => 'OK',
      headers: { entries: () => [] },
    })
    const res = await request(app).post('/api/v1/mcp/execute').send({
      tool: 'http_fetch', params: { url: 'https://allowed.com/path' },
    })
    expect(res.status).toBe(200)
  })

  it('returns 400 for http_fetch with missing url', async () => {
    const res = await request(app).post('/api/v1/mcp/execute').send({
      tool: 'http_fetch', params: {},
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/url/)
  })

  it('returns 400 for http_fetch with forbidden method', async () => {
    const res = await request(app).post('/api/v1/mcp/execute').send({
      tool: 'http_fetch', params: { url: 'https://example.com', method: 'CONNECT' },
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/method/)
  })

  it('executes session_create and returns session_id', async () => {
    const { tenantQuery } = await import('../db/pool')
    vi.mocked(tenantQuery).mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
    const res = await request(app).post('/api/v1/mcp/execute').send({
      tool: 'session_create',
      params: { name: 'test-agent', model: 'claude-sonnet-4-6', system_prompt: 'You are a test agent' },
    })
    expect(res.status).toBe(201)
    expect(res.body.session_id).toBeDefined()
    expect(res.body.session_id).toMatch(/^sess_/)
    expect(res.body.name).toBe('test-agent')
  })
})

describe('POST /api/v1/mcp/execute — Ava proxy', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env['AVA_MCP_URL'] = 'http://ava-test:8788' })
  afterEach(() => delete process.env['AVA_MCP_URL'])

  it('proxies Ava-only tools to Ava server', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ result: 'shell output', exit_code: 0 }),
    })
    const res = await request(app).post('/api/v1/mcp/execute').send({
      tool: 'bash', params: { command: 'echo hello' },
    })
    expect(res.status).toBe(200)
    expect(res.body.result).toBe('shell output')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/execute'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('returns 503 with actionable message when Ava is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const res = await request(app).post('/api/v1/mcp/execute').send({
      tool: 'bash', params: { command: 'echo hello' },
    })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('ava_unreachable')
    expect(res.body.message).toBeDefined()
  })

  it('returns 503 when AVA_MCP_URL not configured for Ava-only tool', async () => {
    delete process.env['AVA_MCP_URL']
    const res = await request(app).post('/api/v1/mcp/execute').send({
      tool: 'bash', params: { command: 'echo hello' },
    })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('ava_not_configured')
    expect(res.body.message).toContain('AVA_MCP_URL')
  })

  it('passes tenant context to Ava proxy', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: 'ok' }) })
    await request(app).post('/api/v1/mcp/execute').send({ tool: 'file_read', params: { path: '/tmp/test' } })
    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.context.tenant_id).toBe('tenant-test')
  })
})

describe('GET /api/v1/mcp/sessions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns sessions list', async () => {
    const { tenantQuery } = await import('../db/pool')
    vi.mocked(tenantQuery).mockResolvedValueOnce({
      rows: [{ id: 'sess-1', tool_name: 'agent:commissioning', created_at: new Date().toISOString() }],
      rowCount: 1,
    } as any)
    const res = await request(app).get('/api/v1/mcp/sessions')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.sessions)).toBe(true)
  })
})
