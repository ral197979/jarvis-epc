/**
 * ADR-014 Phase 2A — role sweeps across every enforced consequential transition.
 *
 * Drives the real guard for each (transition, role) pair rather than asserting
 * against the grant table, so a route wired to the wrong capability is caught.
 * The route source is checked separately, so a transition that lost its guard
 * fails here too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import request from 'supertest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => mockQuery(...a),
  tenantQuery:       (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: vi.fn(),
}))

import { principal, principalQuery, authMiddlewareFor, ALL_ROLES, type TestPrincipal } from './helpers/testPrincipal'
import { requireCapability } from '../authz/requireCapability'
import { roleHasCapability } from '../authz/capabilities'
import { ENFORCED_TRANSITIONS, PENDING_TRANSITIONS } from '../authz/transitions'

let current: TestPrincipal
beforeEach(() => {
  mockQuery.mockReset()
  mockQuery.mockImplementation(principalQuery(() => current))
})

/** The transition's guard, mounted alone, so only authorization is under test. */
function transitionApp(capability: string) {
  const app = express()
  app.use(express.json())
  app.use(authMiddlewareFor(() => current))
  app.post('/t', requireCapability(capability as never), (_req, res) => { res.json({ executed: true }) })
  return app
}

// ─── The route source really carries the guard ────────────────────────────────
describe('every enforced transition is guarded at its route', () => {
  it.each(ENFORCED_TRANSITIONS.map(t => [`${t.file} ${t.method} ${t.path}`, t] as const))(
    '%s declares requireCapability',
    (_label, t) => {
      const src = fs.readFileSync(path.join(process.cwd(), 'api', 'routes', t.file), 'utf8')
      const esc = t.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // The capability guard need not be the first middleware: enterprise routes
      // run a tenant-scope guard first, then authorize. Assert it appears in the
      // declaration's middleware list, before the handler.
      const decl = new RegExp(`\\.${t.method.toLowerCase()}\\s*\\(\\s*'${esc}'\\s*,([\\s\\S]{0,200}?)(?:async\\s*\\(|\\(req)`) 
      const head = decl.exec(src)?.[1] ?? ''
      expect(head.includes(`requireCapability('${t.capability}')`),
        `${t.file} ${t.method} ${t.path} is not guarded by ${t.capability}`).toBe(true)
    },
  )
})

// ─── Viewer sweep — the primary gate proof ────────────────────────────────────
describe('Viewer is denied every consequential transition', () => {
  it.each(ENFORCED_TRANSITIONS.map(t => [`${t.operation} (${t.capability})`, t] as const))(
    'viewer cannot %s',
    async (_label, t) => {
      current = principal({ role: 'viewer' })
      const res = await request(transitionApp(t.capability)).post('/t').send({})
      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'forbidden' })
    },
  )

  it('attempts every transition and succeeds at none', async () => {
    current = principal({ role: 'viewer' })
    let denied = 0
    for (const t of ENFORCED_TRANSITIONS) {
      const res = await request(transitionApp(t.capability)).post('/t').send({})
      if (res.status === 403) denied++
    }
    expect(denied).toBe(ENFORCED_TRANSITIONS.length)
  })
})

// ─── Admin sweep ──────────────────────────────────────────────────────────────
describe('Platform Administrator holds platform and AI governance only', () => {
  it('is admitted to AI governance and platform automation', async () => {
    current = principal({ role: 'admin' })
    const platformCaps = (c: string) => c === 'ai.govern' || c.startsWith('platform.')
    for (const t of ENFORCED_TRANSITIONS.filter(x => platformCaps(x.capability) && x.capability !== 'platform.security')) {
      const res = await request(transitionApp(t.capability)).post('/t').send({})
      expect(res.status, `admin should perform ${t.operation}`).toBe(200)
    }
  })

  it('is denied every business transition', async () => {
    current = principal({ role: 'admin' })
    // platform.security is deliberately Owner-only — it changes the security
    // perimeter — so admin is denied it alongside every business transition.
    const business = ENFORCED_TRANSITIONS.filter(t =>
      t.capability === 'platform.security' ||
      (t.capability !== 'ai.govern' && !t.capability.startsWith('platform.')))
    expect(business.length).toBeGreaterThan(0)
    for (const t of business) {
      const res = await request(transitionApp(t.capability)).post('/t').send({})
      expect(res.status, `admin must not ${t.operation}`).toBe(403)
    }
  })
})

// ─── Project Manager sweep ────────────────────────────────────────────────────
describe('Project Manager holds only its established transition capabilities', () => {
  const PM_ALLOWED = ['project.approve', 'construction.approve', 'quality.verify', 'docs.publish', 'risk.approve', 'team.approve']

  it('performs its established transitions', async () => {
    current = principal({ role: 'project_manager' })
    for (const t of ENFORCED_TRANSITIONS.filter(x => PM_ALLOWED.includes(x.capability))) {
      expect((await request(transitionApp(t.capability)).post('/t').send({})).status,
        `PM should perform ${t.operation}`).toBe(200)
    }
  })

  it('is denied the four Owner-only approval families and platform/AI authority', async () => {
    current = principal({ role: 'project_manager' })
    for (const cap of ['cost.approve', 'procurement.approve', 'engineering.approve',
                       'commissioning.approve', 'platform.automation', 'ai.govern', 'platform.admin']) {
      expect((await request(transitionApp(cap)).post('/t').send({})).status,
        `PM must not hold ${cap}`).toBe(403)
    }
  })
})

// ─── Engineer / Field Ops / Procurement ───────────────────────────────────────
describe('write authority never implies approval authority', () => {
  it('denies Engineer engineering approval despite engineering.write', async () => {
    current = principal({ role: 'engineer' })
    expect(roleHasCapability('engineer', 'engineering.write')).toBe(true)
    expect((await request(transitionApp('engineering.approve')).post('/t').send({})).status).toBe(403)
  })

  it('denies Procurement procurement approval despite procurement.write', async () => {
    current = principal({ role: 'procurement' })
    expect(roleHasCapability('procurement', 'procurement.write')).toBe(true)
    for (const t of ENFORCED_TRANSITIONS.filter(x => x.capability === 'procurement.approve')) {
      expect((await request(transitionApp(t.capability)).post('/t').send({})).status,
        `procurement must not ${t.operation}`).toBe(403)
    }
  })

  it('denies Field Ops formal verification and approval families', async () => {
    current = principal({ role: 'field_ops' })
    for (const cap of ['construction.approve', 'cost.approve', 'procurement.approve',
                       'docs.publish', 'team.approve', 'ai.govern']) {
      expect((await request(transitionApp(cap)).post('/t').send({})).status,
        `field_ops must not hold ${cap}`).toBe(403)
    }
  })
})

// ─── Owner positive sweep ─────────────────────────────────────────────────────
describe('Owner passes every transition gate', () => {
  it('is admitted to all enforced transitions', async () => {
    current = principal({ role: 'owner' })
    for (const t of ENFORCED_TRANSITIONS) {
      expect((await request(transitionApp(t.capability)).post('/t').send({})).status,
        `owner should perform ${t.operation}`).toBe(200)
    }
  })
})

// ─── Stale token on a consequential transition ────────────────────────────────
describe('a stale token cannot perform a transition', () => {
  it('denies an approval when the token says owner but the database says viewer', async () => {
    current = principal({ role: 'viewer', jwtRole: 'owner' })
    const res = await request(transitionApp('cost.approve')).post('/t').send({})
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'forbidden' })
  })
})

// ─── Coverage accounting ──────────────────────────────────────────────────────
describe('transition coverage', () => {
  it('grants no transition capability to viewer, and no business approval to admin', () => {
    for (const t of ENFORCED_TRANSITIONS) {
      expect(roleHasCapability('viewer', t.capability), `viewer holds ${t.capability}`).toBe(false)
    }
    for (const cap of ['cost.approve', 'procurement.approve', 'engineering.approve', 'commissioning.approve', 'project.approve']) {
      expect(roleHasCapability('admin', cap), `admin holds ${cap}`).toBe(false)
    }
  })

  it('keeps the four temporary approval families Owner-only', () => {
    for (const cap of ['cost.approve', 'procurement.approve', 'engineering.approve', 'commissioning.approve']) {
      const holders = ALL_ROLES.filter(r => roleHasCapability(r, cap))
      expect(holders, `${cap} must remain Owner-only`).toEqual(['owner'])
    }
  })

  it('has no outstanding transition debt', () => {
    // Phase 2A closes only when this reaches zero.
    expect(PENDING_TRANSITIONS.length, 'Phase 2A closes only when this is empty').toBe(0)
    expect(ENFORCED_TRANSITIONS.length).toBe(73)
  })
})
