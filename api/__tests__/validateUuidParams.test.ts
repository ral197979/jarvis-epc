import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { registerUuidParamGuards, validateUuidQueryParams } from '../middleware/validateUuidParams'

function makeApp() {
  const app = express()
  registerUuidParamGuards(app)
  app.use(validateUuidQueryParams)
  app.get('/ok',                                (_req, res) => res.json({ ok: true }))
  app.get('/res/:id',                           (_req, res) => res.json({ ok: true }))
  app.get('/projects/:projectId/data',          (_req, res) => res.json({ ok: true }))
  app.get('/systems/:systemId/tags/:tagId',     (_req, res) => res.json({ ok: true }))
  app.get('/files/:token',                      (_req, res) => res.json({ ok: true }))
  app.get('/tags',                              (_req, res) => res.json({ ok: true }))
  return app
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'
const app = makeApp()

describe('validateUuidParams middleware', () => {
  it('passes routes with no ID params', async () => {
    const res = await request(app).get('/ok')
    expect(res.status).toBe(200)
  })

  it('passes a valid UUID in :id', async () => {
    const res = await request(app).get(`/res/${VALID_UUID}`)
    expect(res.status).toBe(200)
  })

  it('passes a valid UUID in :projectId', async () => {
    const res = await request(app).get(`/projects/${VALID_UUID}/data`)
    expect(res.status).toBe(200)
  })

  it('passes valid UUIDs in :systemId + :tagId', async () => {
    const res = await request(app).get(`/systems/${VALID_UUID}/tags/${VALID_UUID}`)
    expect(res.status).toBe(200)
  })

  it('returns 400 for a non-UUID :id', async () => {
    const res = await request(app).get('/res/not-a-uuid')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('validation')
    expect(res.body.message).toContain('id')
  })

  it('returns 400 for a non-UUID :projectId', async () => {
    const res = await request(app).get('/projects/my-project-slug/data')
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('projectId')
  })

  it('does NOT validate :token (not a UUID param)', async () => {
    const res = await request(app).get('/files/some-opaque-token-value')
    expect(res.status).toBe(200)
  })
})

describe('validateUuidQueryParams middleware', () => {
  it('passes when no UUID query params are present', async () => {
    const res = await request(app).get('/tags?status=active&page=1')
    expect(res.status).toBe(200)
  })

  it('passes a valid UUID in project_id query param', async () => {
    const res = await request(app).get(`/tags?project_id=${VALID_UUID}`)
    expect(res.status).toBe(200)
  })

  it('returns 400 for a non-UUID project_id query param', async () => {
    const res = await request(app).get('/tags?project_id=not-a-uuid')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('validation')
    expect(res.body.message).toContain('project_id')
  })

  it('returns 400 for a non-UUID system_id query param', async () => {
    const res = await request(app).get('/tags?system_id=bad-value')
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('system_id')
  })

  it('does NOT validate unknown query params like ?status or ?page', async () => {
    const res = await request(app).get('/tags?status=not-a-uuid&page=garbage')
    expect(res.status).toBe(200)
  })

  it('skips validation when UUID query param is empty string', async () => {
    const res = await request(app).get('/tags?project_id=')
    expect(res.status).toBe(200)
  })
})
