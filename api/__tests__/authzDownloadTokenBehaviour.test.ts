/**
 * ADR-014 Phase 3K — the download token, exercised end to end.
 *
 * The condition this slice removes:
 *
 *     a token minted while you had access
 *   + `docs.view`, which every engineer holds
 *   = the bytes, for the rest of the hour, whatever happened to your access
 *
 * Phase 2 made role staleness impossible, Phase 3C–3J made record staleness
 * impossible, and this route sat outside both: it re-derived nothing. A token
 * was a bearer credential naming a storage key, and the key carries no scope.
 *
 * The tests are deliberately written around the MINT → REVOKE → REDEEM
 * sequence rather than around the guard, because the guard is not the claim.
 * The claim is that revocation lands on the next request. So every case here
 * mints a real token through `GET /files/presign/:versionId` while access is
 * intact, changes the world, and then redeems it.
 *
 * The filesystem is real (a temp dir per run), not mocked: the sidecar the
 * product writes is the sidecar the product reads, so a change to either half
 * of that contract shows up here rather than passing on a stubbed shape.
 *
 * Fixture:
 *   Tenant A   USER_A  (engineer) → member of PROJECT_A
 *              USER_D  (engineer) → member of PROJECT_A, a project PEER
 *              OWNER_A (owner)    → tenant-wide by project.list.all
 *   Tenant B   USER_C  (engineer) → member of PROJECT_C
 *
 *   VERSION_A → DOC_A → PROJECT_A      the reachable file
 *   VERSION_B → DOC_B → PROJECT_B      same tenant, a project USER_A is not in
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import fs   from 'node:fs'
import os   from 'node:os'
import path from 'node:path'

// LOCAL_DIR is read at module load in both files.ts and storage.ts, so the temp
// root has to exist in the environment before either import is evaluated.
const STORAGE_DIR = vi.hoisted(() => {
  const fsx = require('node:fs') as typeof import('node:fs')
  const osx = require('node:os') as typeof import('node:os')
  const px  = require('node:path') as typeof import('node:path')
  const dir = fsx.mkdtempSync(px.join(osx.tmpdir(), 'adr014-p3k-'))
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
const USER_D    = '10000000-0000-4000-8000-0000000000a4'
const USER_C    = '10000000-0000-4000-8000-0000000000c1'
const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'

const VERSION_A = '60000000-0000-4000-8000-00000000000a'
const VERSION_B = '60000000-0000-4000-8000-00000000000b'
const VERSION_G = '60000000-0000-4000-8000-00000000000c'   // a `_global` document

interface VersionRow { project: string | null; tenant: string; key: string; status: string }
let VERSIONS: Record<string, VersionRow>

const KEY_A = `${TENANT_A}/${PROJECT_A}/aaaa.pdf`
const KEY_B = `${TENANT_A}/${PROJECT_B}/bbbb.pdf`
const KEY_G = `${TENANT_A}/_global/gggg.pdf`

interface MemberRow { projectId: string; userId: string; active: boolean }
let MEMBERS: MemberRow[]

interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller): void => {
  caller = c; (globalThis as Record<string, unknown>)['__p3k'] = c
}

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p3k'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p3k'] as Caller).tenantId
    next()
  },
}))

import { requireAuth } from '../auth'
import filesRouter from '../routes/files'

const app = (() => {
  const a = express()
  a.use(express.json())
  // Mounted exactly as api/server.ts mounts it — no requireTenant at the mount;
  // the router supplies its own per route, which is the thing Phase 3K had to
  // add to the download route.
  a.use('/api/v1/files', requireAuth as never, filesRouter as never)
  return a
})()

const SQLRE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (a: unknown[]): string =>
  a.find((x): x is string => typeof x === 'string' && SQLRE.test(x)) ?? ''
const paramsOf = (a: unknown[]): unknown[] =>
  (a.find(x => Array.isArray(x)) as unknown[] | undefined) ?? []
const statements = (): string[] => mockQuery.mock.calls.map(c => sqlOf(c)).filter(Boolean)
/** Statements that read the FILE row, as opposed to resolving authorization. */
const payloadQueries = (): string[] => statements().filter(s =>
  !/FROM\s+users\s+WHERE\s+id/i.test(s) &&
  !/FROM projects/i.test(s) &&
  !/AS\s+project_id/i.test(s))

beforeEach(() => {
  MEMBERS = [
    { projectId: PROJECT_A, userId: USER_A, active: true },
    { projectId: PROJECT_A, userId: USER_D, active: true },
  ]
  VERSIONS = {
    [VERSION_A]: { project: PROJECT_A, tenant: TENANT_A, key: KEY_A, status: 'active' },
    [VERSION_B]: { project: PROJECT_B, tenant: TENANT_A, key: KEY_B, status: 'active' },
    [VERSION_G]: { project: null,      tenant: TENANT_A, key: KEY_G, status: 'active' },
  }
  setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })

  // The stored objects themselves.
  for (const key of [KEY_A, KEY_B, KEY_G]) {
    const full = path.join(STORAGE_DIR, key)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, `contents of ${key}`)
  }

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = paramsOf(args)
    const empty = { rows: [], rowCount: 0 }

    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
    }

    // resolveRecordScope for document_versions — the FK_PATH projection through
    // documents. Answered from the fixture and honouring the tenant predicate
    // the product actually wrote, so removing it changes what comes back.
    if (/FROM document_versions r/i.test(sql) && /AS\s+project_id/i.test(sql)) {
      const v = VERSIONS[params[0] as string]
      const honoursTenant = /r\.tenant_id = current_setting/i.test(sql)
      if (!v || (honoursTenant && v.tenant !== caller.tenantId)) return empty
      return { rows: [{ project_id: v.project }], rowCount: 1 }
    }

    // filterAccessibleProjectIds / canAccessProject.
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

    // The presign payload read, and the Phase-3K liveness re-read.
    if (/FROM document_versions/i.test(sql)) {
      const v = VERSIONS[params[0] as string]
      if (!v) return empty
      if (/status\s*=\s*'active'/i.test(sql) && v.status !== 'active') return empty
      if (/tenant_id\s*=\s*current_setting/i.test(sql) && v.tenant !== caller.tenantId) return empty
      return { rows: [{ storage_key: v.key, original_name: 'plans.pdf', mime_type: 'application/pdf' }], rowCount: 1 }
    }

    return empty
  })
})

afterAll(() => { fs.rmSync(STORAGE_DIR, { recursive: true, force: true }) })

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Mint a real token through the product's own presign route. */
async function mint(versionId: string): Promise<string> {
  const res = await request(app).get(`/api/v1/files/presign/${versionId}`)
  expect(res.status, 'presign must succeed for the fixture to mean anything').toBe(200)
  const url = res.body.data.downloadUrl as string
  return url.split('/').pop()!
}

const sidecar = (token: string): string =>
  path.join(STORAGE_DIR, '.tokens', `dl_${token}.json`)

/** The streamed bytes. `application/octet-stream` is not parsed into `res.text`. */
const bodyText = (res: { body: unknown }): string =>
  Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body)

// ─── the binding exists at all ───────────────────────────────────────────────

describe('a minted token names what to re-authorize', () => {
  it('records tenant, subject and record — not just the storage key', async () => {
    const token = await mint(VERSION_A)
    const meta = JSON.parse(fs.readFileSync(sidecar(token), 'utf8')) as Record<string, unknown>
    expect(meta['tenantId']).toBe(TENANT_A)
    expect(meta['subjectId']).toBe(USER_A)
    expect(meta['resource']).toBe('document_versions')
    expect(meta['recordId']).toBe(VERSION_A)
  })

  it('mints only for a version the caller can already reach', async () => {
    // Not a download test — it establishes that the mint side is guarded, so
    // every revocation test below starts from a legitimately issued token.
    const res = await request(app).get(`/api/v1/files/presign/${VERSION_B}`)
    expect(res.status).toBe(404)
  })

  it('streams the file to the principal it was minted for', async () => {
    const token = await mint(VERSION_A)
    const res = await request(app).get(`/api/v1/files/download/${token}`).buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/octet-stream')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    // The bytes of THIS version's object, not merely a 200.
    expect(bodyText(res)).toBe(`contents of ${KEY_A}`)
  })

  it('spends the token on success, so it is single-use', async () => {
    const token = await mint(VERSION_A)
    expect((await request(app).get(`/api/v1/files/download/${token}`)).status).toBe(200)
    expect(fs.existsSync(sidecar(token))).toBe(false)
    expect((await request(app).get(`/api/v1/files/download/${token}`)).status).toBe(404)
  })
})

// ─── §V/W the revocation window, which is the point of the slice ─────────────

describe('a token does not outlive the access that minted it', () => {
  it('refuses once the minting membership is closed', async () => {
    const token = await mint(VERSION_A)
    // Same JWT, same token, same second — only the membership changes.
    MEMBERS = MEMBERS.map(m => m.userId === USER_A ? { ...m, active: false } : m)

    mockQuery.mockClear()
    const res = await request(app).get(`/api/v1/files/download/${token}`)
    expect(res.status).toBe(404)
    // The refusal precedes the file entirely: no liveness read, no stream.
    expect(payloadQueries()).toHaveLength(0)
    // And it did not burn the token on the way out.
    expect(fs.existsSync(sidecar(token))).toBe(true)
  })

  it('refuses once the current role no longer holds docs.view', async () => {
    const token = await mint(VERSION_A)
    // `admin` is the role in this registry that does NOT hold `docs.view` —
    // `viewer` does. The point is the capability, not the seniority.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'admin' })

    mockQuery.mockClear()
    const res = await request(app).get(`/api/v1/files/download/${token}`)
    // 403, not 404: the functional gate refuses before the record is resolved,
    // exactly as everywhere else in ADR-014.
    expect(res.status).toBe(403)
    expect(payloadQueries()).toHaveLength(0)
  })

  it('refuses once the account is deactivated', async () => {
    const token = await mint(VERSION_A)
    mockQuery.mockImplementationOnce(async () => ({ rows: [], rowCount: 0 }))
    const res = await request(app).get(`/api/v1/files/download/${token}`)
    expect(res.status).toBe(401)
  })

  it('refuses once the version is no longer active', async () => {
    const token = await mint(VERSION_A)
    VERSIONS[VERSION_A]!.status = 'deleted'
    const res = await request(app).get(`/api/v1/files/download/${token}`)
    expect(res.status).toBe(404)
  })

  it('refuses when the version no longer points at the token\'s key', async () => {
    const token = await mint(VERSION_A)
    VERSIONS[VERSION_A]!.key = `${TENANT_A}/${PROJECT_A}/superseded.pdf`
    const res = await request(app).get(`/api/v1/files/download/${token}`)
    expect(res.status).toBe(404)
  })
})

// ─── the token is not a bearer credential ────────────────────────────────────

describe('a token is not transferable', () => {
  it('refuses a project PEER holding the same token', async () => {
    const token = await mint(VERSION_A)
    // USER_D is in PROJECT_A and holds docs.view — record scope alone would
    // admit them. The subject binding is what refuses.
    setCaller({ id: USER_D, tenantId: TENANT_A, role: 'engineer' })
    const res = await request(app).get(`/api/v1/files/download/${token}`)
    expect(res.status).toBe(404)
    expect(fs.existsSync(sidecar(token))).toBe(true)
  })

  it('refuses the tenant Owner holding another user\'s token', async () => {
    const token = await mint(VERSION_A)
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await request(app).get(`/api/v1/files/download/${token}`)).status).toBe(404)
  })

  it('refuses a principal from another tenant', async () => {
    const token = await mint(VERSION_A)
    setCaller({ id: USER_C, tenantId: TENANT_B, role: 'engineer' })
    mockQuery.mockClear()
    const res = await request(app).get(`/api/v1/files/download/${token}`)
    expect(res.status).toBe(404)
    expect(payloadQueries()).toHaveLength(0)
  })

  it('refuses a sidecar whose tenant is not the redeemer\'s, subject aside', async () => {
    // The case above is refused by the SUBJECT binding before the tenant check
    // is reached — USER_C is not USER_A — so it proves nothing about the tenant
    // check. This one isolates it: the sidecar names the redeeming user, and
    // the record is one they can genuinely reach, so every other rung of the
    // ladder admits. Only the tenant disagrees.
    const token = 'b'.repeat(48)
    fs.mkdirSync(path.join(STORAGE_DIR, '.tokens'), { recursive: true })
    fs.writeFileSync(sidecar(token), JSON.stringify({
      key: KEY_A, token, tenantId: TENANT_B, subjectId: USER_A,
      resource: 'document_versions', recordId: VERSION_A,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }))
    const res = await request(app).get(`/api/v1/files/download/${token}`)
    expect(res.status).toBe(404)
    expect(fs.existsSync(sidecar(token))).toBe(true)
  })

  it('refuses a token that carries no binding at all', async () => {
    // The shape minted before Phase 3K. It fails closed rather than falling
    // back to the pre-3K behaviour of honouring whatever key it names.
    const token = 'f'.repeat(48)
    fs.mkdirSync(path.join(STORAGE_DIR, '.tokens'), { recursive: true })
    fs.writeFileSync(sidecar(token), JSON.stringify({
      key: KEY_A, token, expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }))
    const res = await request(app).get(`/api/v1/files/download/${token}`)
    expect(res.status).toBe(404)
    expect(payloadQueries()).toHaveLength(0)
  })
})

// ─── the tenant-global document still works ──────────────────────────────────

describe('the DUAL_PROJECT_OR_TENANT semantics are preserved', () => {
  it('admits a `_global` document version with no project parent', async () => {
    // Phase 3E-R: a NULL parent means what the resource says, and
    // `document_versions` declares project-less rows legitimate. Hardening the
    // token must not make every tenant-level document undownloadable.
    const token = await mint(VERSION_G)
    const res = await request(app).get(`/api/v1/files/download/${token}`).buffer(true)
    expect(res.status).toBe(200)
    expect(bodyText(res)).toBe(`contents of ${KEY_G}`)
  })
})

// ─── expiry, still a backstop ────────────────────────────────────────────────

describe('expiry survives as a backstop', () => {
  it('refuses an expired token with 410 and consumes it', async () => {
    const token = await mint(VERSION_A)
    const meta = JSON.parse(fs.readFileSync(sidecar(token), 'utf8')) as Record<string, unknown>
    meta['expiresAt'] = new Date(Date.now() - 1000).toISOString()
    fs.writeFileSync(sidecar(token), JSON.stringify(meta))

    const res = await request(app).get(`/api/v1/files/download/${token}`)
    expect(res.status).toBe(410)
    expect(fs.existsSync(sidecar(token))).toBe(false)
  })
})

// ─── the token is not a filesystem path ──────────────────────────────────────

describe('a token parameter cannot address the filesystem', () => {
  it('refuses a percent-encoded traversal instead of resolving it', async () => {
    // Express percent-decodes path parameters, so this arrives at the handler
    // as the single parameter `../../../etc/hosts` — one segment to the router,
    // a traversal to path.join. Before Phase 3K it built a sidecar path out of
    // it, parsed whatever JSON it found, and opened the `key` inside.
    const res = await request(app).get('/api/v1/files/download/..%2F..%2F..%2Fetc%2Fhosts')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('invalid_token')
  })

  it('refuses a traversal that would otherwise reach a real sidecar', async () => {
    // The test above is refused by the format check AND by the target not
    // existing, so it does not isolate the check. This one plants a completely
    // valid sidecar OUTSIDE the token directory and reaches it by escaping.
    //
    // The handler prefixes the parameter with `dl_`, so a bare `../` does not
    // escape — but `x/../../` does: path.join(<root>/.tokens, 'dl_x/../../p.json')
    // normalises to <root>/p.json. Without the format check this returns the
    // file. With it, the parameter is not a token and never becomes a path.
    fs.writeFileSync(path.join(STORAGE_DIR, 'planted.json'), JSON.stringify({
      key: KEY_A, token: 'planted', tenantId: TENANT_A, subjectId: USER_A,
      resource: 'document_versions', recordId: VERSION_A,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }))
    const res = await request(app).get('/api/v1/files/download/x%2F..%2F..%2Fplanted')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('invalid_token')
    // The sidecar is untouched — the request never reached it.
    expect(fs.existsSync(path.join(STORAGE_DIR, 'planted.json'))).toBe(true)
  })

  it('refuses an upload traversal that would otherwise reach a real sidecar', async () => {
    // The upload route builds its path with no `dl_` prefix, so `../` escapes
    // directly — and the sidecar it lands on decides WHERE THE BYTES ARE
    // WRITTEN. Without the format check this is an attacker-chosen write path.
    fs.writeFileSync(path.join(STORAGE_DIR, 'planted-upload.json'), JSON.stringify({
      key: `${TENANT_A}/${PROJECT_A}/written-by-traversal.pdf`,
      token: 'planted-upload',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      maxSize: 1024 * 1024,
    }))
    const res = await request(app)
      .put('/api/v1/files/upload/..%2Fplanted-upload')
      .set('Content-Type', 'application/pdf')
      .send('payload')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('invalid_token')
    expect(fs.existsSync(path.join(STORAGE_DIR, TENANT_A, PROJECT_A, 'written-by-traversal.pdf'))).toBe(false)
  })
})
