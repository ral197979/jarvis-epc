/**
 * Tests: api/services/mcp/denverMcpServer.ts + api/routes/denverMcp.ts
 *
 * Framework (registry/dispatch/validation) is pure. Route is flag-gated; auth +
 * tenant are mocked like other route tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.auth = { sub: 'u1' }; next() },
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 't1'; next() },
}))

import express from 'express'
import request from 'supertest'
import {
  McpToolRegistry, dispatch, buildDenverMcpRegistry,
  UnknownToolError, ToolValidationError,
} from '../services/mcp/denverMcpServer'
import { denverMcpRouter } from '../routes/denverMcp'

describe('McpToolRegistry + dispatch', () => {
  function reg() {
    return new McpToolRegistry().register({
      name: 'echo', description: 'echo back', inputSchema: { type: 'object', required: ['msg'] },
      handler: (_ctx, args) => ({ echoed: args['msg'] }),
    })
  }
  it('lists tool metadata without handlers', () => {
    const list = reg().list()
    expect(list).toEqual([{ name: 'echo', description: 'echo back', inputSchema: { type: 'object', required: ['msg'] } }])
    expect((list[0] as any).handler).toBeUndefined()
  })
  it('dispatches to the handler with ctx + args', async () => {
    const r = await dispatch(reg(), 'echo', { tenantId: 't1' }, { msg: 'hi' })
    expect(r).toEqual({ echoed: 'hi' })
  })
  it('throws UnknownToolError for an unregistered tool', async () => {
    await expect(dispatch(reg(), 'nope', { tenantId: 't1' }, {})).rejects.toThrow(UnknownToolError)
  })
  it('throws ToolValidationError when a required arg is missing', async () => {
    await expect(dispatch(reg(), 'echo', { tenantId: 't1' }, {})).rejects.toThrow(ToolValidationError)
  })
})

describe('seeded Denver tools', () => {
  const reg = buildDenverMcpRegistry()
  it('registers the discovery tool set', () => {
    expect(reg.list().map(t => t.name).sort())
      .toEqual(['denver.canonical_events', 'denver.capabilities', 'denver.health', 'denver.object_types'])
  })
  it('denver.health returns ok', async () => {
    expect(await dispatch(reg, 'denver.health', { tenantId: null })).toEqual({ status: 'ok', service: 'denver-engineering' })
  })
  it('denver.object_types includes equipment', async () => {
    const r = await dispatch(reg, 'denver.object_types', { tenantId: null }) as { types: string[] }
    expect(r.types).toContain('equipment')
  })
  it('denver.canonical_events includes fat.completed', async () => {
    const r = await dispatch(reg, 'denver.canonical_events', { tenantId: null }) as { events: string[] }
    expect(r.events).toContain('fat.completed')
  })
})

describe('denver mcp route', () => {
  beforeEach(() => { delete process.env['DENVER_MCP_SERVER'] })
  afterEach(() => { delete process.env['DENVER_MCP_SERVER'] })

  function app() {
    const a = express()
    a.use(express.json())
    a.use('/api/v1/denver-mcp', denverMcpRouter as any)
    return a
  }

  it('404 when the flag is off', async () => {
    expect((await request(app()).get('/api/v1/denver-mcp/tools')).status).toBe(404)
  })
  it('lists tools when enabled', async () => {
    process.env['DENVER_MCP_SERVER'] = 'true'
    const res = await request(app()).get('/api/v1/denver-mcp/tools')
    expect(res.status).toBe(200)
    expect(res.body.tools.map((t: any) => t.name)).toContain('denver.health')
  })
  it('calls a tool', async () => {
    process.env['DENVER_MCP_SERVER'] = 'true'
    const res = await request(app()).post('/api/v1/denver-mcp/call').send({ tool: 'denver.health' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ tool: 'denver.health', result: { status: 'ok', service: 'denver-engineering' } })
  })
  it('404 for an unknown tool', async () => {
    process.env['DENVER_MCP_SERVER'] = 'true'
    const res = await request(app()).post('/api/v1/denver-mcp/call').send({ tool: 'denver.nope' })
    expect(res.status).toBe(404)
  })
  it('400 when tool is missing', async () => {
    process.env['DENVER_MCP_SERVER'] = 'true'
    const res = await request(app()).post('/api/v1/denver-mcp/call').send({})
    expect(res.status).toBe(400)
  })
})
