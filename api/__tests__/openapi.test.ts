/**
 * Tests: api/services/openapi/openapiSpec.ts + api/routes/openapi.ts
 *
 * Spec builder is pure; the route is flag-gated. Covers document shape, registry
 * merge/extension, and the served endpoint (404 when off, spec when on).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { buildDefaultSpec, OpenApiRegistry, OPENAPI_VERSION } from '../services/openapi/openapiSpec'
import { openapiRouter } from '../routes/openapi'

describe('openapi spec builder', () => {
  it('produces a valid skeleton document', () => {
    const doc = buildDefaultSpec()
    expect(doc.openapi).toBe(OPENAPI_VERSION)
    expect(doc.info.title).toBe('Denver Engineering API')
    expect(doc.servers).toEqual([{ url: '/' }])
    expect(doc.components.securitySchemes).toHaveProperty('bearerAuth')
    expect(doc.components.securitySchemes).toHaveProperty('cookieAuth')
  })

  it('seeds a representative core surface', () => {
    const doc = buildDefaultSpec()
    expect(doc.paths['/api/v1/health']).toHaveProperty('get')
    expect(doc.paths['/api/v1/projects']).toHaveProperty('get')
    expect(doc.paths['/api/v1/projects']).toHaveProperty('post')
    expect(doc.paths['/api/v1/projects'].post.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }])
  })

  it('registry merges multiple methods on one path and is extensible', () => {
    const r = new OpenApiRegistry()
    r.register('get', '/x', { responses: { '200': { description: 'ok' } } })
    r.register('post', '/x', { responses: { '201': { description: 'made' } } })
    expect(r.pathCount()).toBe(1)
    const doc = r.build()
    expect(Object.keys(doc.paths['/x']).sort()).toEqual(['get', 'post'])
  })
})

describe('GET /openapi.json', () => {
  beforeEach(() => { delete process.env['OPENAPI_ENABLED'] })
  afterEach(() => { delete process.env['OPENAPI_ENABLED'] })

  function app() {
    const a = express()
    a.use(openapiRouter)
    return a
  }

  it('returns 404 when OPENAPI_ENABLED is off', async () => {
    const res = await request(app()).get('/openapi.json')
    expect(res.status).toBe(404)
  })

  it('serves the spec when enabled', async () => {
    process.env['OPENAPI_ENABLED'] = 'true'
    const res = await request(app()).get('/openapi.json')
    expect(res.status).toBe(200)
    expect(res.body.openapi).toBe(OPENAPI_VERSION)
    expect(res.body.paths['/api/v1/health']).toBeDefined()
  })
})
