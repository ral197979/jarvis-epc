/**
 * `GET /api/v1/files/documents/:id/content` — the in-app viewer stream.
 *
 * Why this route exists at all: DrawingsView rendered an iframe pointed at
 * `/api/v1/documents/:id/file`, a path that has never been registered. Express
 * fell through to the SPA catch-all, so the frame loaded the application's own
 * HTML and the viewer displayed a blank page that looked like a broken PDF.
 * The registry recorded that as an honesty issue rather than a bug to fix; this
 * is the fix.
 *
 * The route cannot simply reuse `/download/:token`. That route forces
 * `application/octet-stream` + `attachment` under AUD-006 so a stored polyglot
 * can never execute in the app origin — which is exactly right for a download
 * and useless for a viewer, because the browser saves the file instead of
 * showing it. Serving INLINE re-opens that question, so the answer here is made
 * by TYPE: only passive formats render, and the type served is the allowlist's
 * spelling rather than the stored column's.
 *
 * Fixture:
 *   Tenant A   USER_A (engineer) → PROJECT_A          DOC_A  pdf   in PROJECT_A
 *              OWNER_A (owner)   → tenant-wide        DOC_B  pdf   in PROJECT_B
 *   Tenant B   USER_C (engineer) → PROJECT_C          DOC_H  html  in PROJECT_A
 *                                                     DOC_S  svg   in PROJECT_A
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import fs   from 'node:fs'
import path from 'node:path'

const STORAGE_DIR = vi.hoisted(() => {
  const fsx = require('node:fs') as typeof import('node:fs')
  const osx = require('node:os') as typeof import('node:os')
  const px  = require('node:path') as typeof import('node:path')
  const dir = fsx.mkdtempSync(px.join(osx.tmpdir(), 'files-inline-'))
  process.env['STORAGE_LOCAL_DIR'] = dir
  process.env['STORAGE_BACKEND']   = 'local'
  return dir
})

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => mockQuery(...a),
  tenantQuery:       (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: async (_t: string, fn: (c: unknown) => unknown) => fn({ query: mockQuery }),
  pool:              { query: (...a: unknown[]) => mockQuery(...a), connect: vi.fn() },
}))

import type { UserRole } from '../authz/capabilities'

const TENANT_A  = 'aaaaaaaa-0000-4000-8000-000000000001'
const TENANT_B  = 'bbbbbbbb-0000-4000-8000-000000000002'
const USER_A    = '10000000-0000-4000-8000-0000000000a1'
const OWNER_A   = '10000000-0000-4000-8000-0000000000a2'
const USER_C    = '10000000-0000-4000-8000-0000000000c1'
const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'

const DOC_A = '70000000-0000-4000-8000-00000000000a'
const DOC_B = '70000000-0000-4000-8000-00000000000b'
// Valid UUIDs, deliberately: `resolveRecordScope` refuses a malformed id as
// NOT_FOUND before any policy runs, so a fixture id like `…000h` would answer
// 404 and quietly stop the 415 tests from testing anything.
const DOC_H = '70000000-0000-4000-8000-00000000000c'   // stored text/html
const DOC_S = '70000000-0000-4000-8000-00000000000d'   // stored image/svg+xml
const DOC_M = '70000000-0000-4000-8000-00000000000e'   // metadata row, object missing

interface DocRow { project: string | null; tenant: string; key: string; mime: string; name: string; hasObject: boolean }
let DOCS: Record<string, DocRow>

interface MemberRow { projectId: string; userId: string; active: boolean }
let MEMBERS: MemberRow[]
interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller): void => { caller = c; (globalThis as Record<string, unknown>)['__inline'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__inline'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__inline'] as Caller).tenantId
    next()
  },
}))

import { requireAuth } from '../auth'
import filesRouter from '../routes/files'

const app = (() => {
  const a = express()
  a.use(express.json())
  a.use('/api/v1/files', requireAuth as never, filesRouter as never)
  return a
})()

const SQLRE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (a: unknown[]): string =>
  a.find((x): x is string => typeof x === 'string' && SQLRE.test(x)) ?? ''
const paramsOf = (a: unknown[]): unknown[] =>
  (a.find(x => Array.isArray(x)) as unknown[] | undefined) ?? []
const statements = (): string[] => mockQuery.mock.calls.map(c => sqlOf(c)).filter(Boolean)
const payloadQueries = (): string[] => statements().filter(s =>
  !/FROM\s+users\s+WHERE\s+id/i.test(s) &&
  !/FROM projects/i.test(s) &&
  !/AS\s+project_id/i.test(s))

const bodyText = (res: { body: unknown }): string =>
  Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body)

beforeEach(() => {
  MEMBERS = [{ projectId: PROJECT_A, userId: USER_A, active: true }]
  DOCS = {
    [DOC_A]: { project: PROJECT_A, tenant: TENANT_A, key: `${TENANT_A}/${PROJECT_A}/a.pdf`,  mime: 'application/pdf', name: 'A-101.pdf',  hasObject: true },
    [DOC_B]: { project: PROJECT_B, tenant: TENANT_A, key: `${TENANT_A}/${PROJECT_B}/b.pdf`,  mime: 'application/pdf', name: 'B-201.pdf',  hasObject: true },
    [DOC_H]: { project: PROJECT_A, tenant: TENANT_A, key: `${TENANT_A}/${PROJECT_A}/x.html`, mime: 'text/html',       name: 'evil.html',  hasObject: true },
    [DOC_S]: { project: PROJECT_A, tenant: TENANT_A, key: `${TENANT_A}/${PROJECT_A}/x.svg`,  mime: 'image/svg+xml',   name: 'evil.svg',   hasObject: true },
    [DOC_M]: { project: PROJECT_A, tenant: TENANT_A, key: `${TENANT_A}/${PROJECT_A}/gone.pdf`, mime: 'application/pdf', name: 'gone.pdf', hasObject: false },
  }
  setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })

  for (const d of Object.values(DOCS)) {
    const full = path.join(STORAGE_DIR, d.key)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    if (d.hasObject) fs.writeFileSync(full, `bytes of ${d.key}`)
    else if (fs.existsSync(full)) fs.unlinkSync(full)
  }

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = paramsOf(args)
    const empty = { rows: [], rowCount: 0 }

    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
    }

    // requireRecordScope('documents') — the DIRECT_COLUMN projection.
    if (/FROM documents r/i.test(sql) && /AS\s+project_id/i.test(sql)) {
      const d = DOCS[params[0] as string]
      const honoursTenant = /r\.tenant_id = current_setting/i.test(sql)
      if (!d || (honoursTenant && d.tenant !== caller.tenantId)) return empty
      return { rows: [{ project_id: d.project }], rowCount: 1 }
    }

    if (/FROM projects/i.test(sql) && /ANY\(\$1::uuid\[\]\)/i.test(sql)) {
      const candidates = (params[0] as string[]) ?? []
      const needsMembership = /project_members/i.test(sql)
      const honoursTenant   = /tenant_id = current_setting/i.test(sql)
      const visible = candidates.filter(id => {
        if (honoursTenant && caller.tenantId !== TENANT_A) return false
        if (!needsMembership) return true
        return MEMBERS.some(m => m.projectId === id && m.userId === caller.id && m.active)
      })
      return { rows: visible.map(id => ({ id })), rowCount: visible.length }
    }

    // The viewer's own current-version lookup.
    if (/FROM documents d/i.test(sql) && /JOIN document_versions dv/i.test(sql)) {
      const d = DOCS[params[0] as string]
      if (!d) return empty
      if (/d\.tenant_id = current_setting/i.test(sql) && d.tenant !== caller.tenantId) return empty
      return { rows: [{ storage_key: d.key, original_name: d.name, mime_type: d.mime }], rowCount: 1 }
    }

    return empty
  })
})

afterAll(() => { fs.rmSync(STORAGE_DIR, { recursive: true, force: true }) })

// ─── the viewer actually shows the document ──────────────────────────────────

describe('the viewer serves the document rather than the app shell', () => {
  it('streams the current version inline', async () => {
    const res = await request(app).get(`/api/v1/files/documents/${DOC_A}/content`).buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toContain('inline')
    expect(res.headers['content-disposition']).toContain('A-101.pdf')
    expect(bodyText(res)).toBe(`bytes of ${DOCS[DOC_A]!.key}`)
  })

  it('sets the headers that keep an inline response passive', async () => {
    const res = await request(app).get(`/api/v1/files/documents/${DOC_A}/content`).buffer(true)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-security-policy']).toBe('sandbox')
  })

  it('404s when the row exists but the object does not', async () => {
    const res = await request(app).get(`/api/v1/files/documents/${DOC_M}/content`)
    expect(res.status).toBe(404)
  })
})

// ─── AUD-006: inline means the type decides ──────────────────────────────────

describe('only passive formats are rendered inline', () => {
  it('refuses stored HTML rather than executing it in the app origin', async () => {
    const res = await request(app).get(`/api/v1/files/documents/${DOC_H}/content`)
    expect(res.status).toBe(415)
    expect(res.body.error).toBe('not_inline_renderable')
    // It refused by TYPE, before opening the object.
    expect(res.headers['content-type']).toContain('application/json')
  })

  it('refuses SVG, which is script-capable, exactly as the upload allowlist does', async () => {
    const res = await request(app).get(`/api/v1/files/documents/${DOC_S}/content`)
    expect(res.status).toBe(415)
  })

  it('never echoes the stored mime string as the response type', async () => {
    // A crafted `mime_type` column must not choose the Content-Type. The value
    // below differs only in case and padding from an allowlisted type, so a
    // handler that passed the column through would answer 200 with it.
    DOCS[DOC_A]!.mime = 'application/pdf; charset=utf-8'
    const res = await request(app).get(`/api/v1/files/documents/${DOC_A}/content`)
    expect(res.status).toBe(415)
  })

  it('normalises case on the allowlist check, so PDFs are not refused for spelling', async () => {
    DOCS[DOC_A]!.mime = 'APPLICATION/PDF'
    const res = await request(app).get(`/api/v1/files/documents/${DOC_A}/content`).buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
  })
})

// ─── ADR-014: the viewer is on the same ladder as everything else ────────────

describe('the viewer is scoped exactly like the document list', () => {
  it('refuses a document in a project the caller is not in', async () => {
    const res = await request(app).get(`/api/v1/files/documents/${DOC_B}/content`)
    expect(res.status).toBe(404)
    expect(payloadQueries()).toHaveLength(0)
  })

  it('refuses once the membership is closed, on the next request', async () => {
    expect((await request(app).get(`/api/v1/files/documents/${DOC_A}/content`)).status).toBe(200)
    MEMBERS = MEMBERS.map(m => ({ ...m, active: false }))
    mockQuery.mockClear()
    const res = await request(app).get(`/api/v1/files/documents/${DOC_A}/content`)
    expect(res.status).toBe(404)
    expect(payloadQueries()).toHaveLength(0)
  })

  it('refuses a caller whose role does not hold docs.view', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'admin' })
    const res = await request(app).get(`/api/v1/files/documents/${DOC_A}/content`)
    expect(res.status).toBe(403)
    expect(payloadQueries()).toHaveLength(0)
  })

  it('refuses a principal from another tenant', async () => {
    setCaller({ id: USER_C, tenantId: TENANT_B, role: 'engineer' })
    const res = await request(app).get(`/api/v1/files/documents/${DOC_A}/content`)
    expect(res.status).toBe(404)
    expect(payloadQueries()).toHaveLength(0)
  })

  it('admits the tenant-wide owner on both projects', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    for (const d of [DOC_A, DOC_B]) {
      expect((await request(app).get(`/api/v1/files/documents/${d}/content`)).status).toBe(200)
    }
  })
})
