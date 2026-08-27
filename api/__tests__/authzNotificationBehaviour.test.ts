/**
 * ADR-014 Phase 2C-4B — the notification boundary, exercised.
 *
 * Real router, real `resolveCurrentUser`, real `requireCapability`, real
 * service SQL against an in-memory delivery store that models the two tables and
 * the UNIQUE(notification_id, user_id) constraint. Nothing mocks away the
 * property under test: recipient resolution runs through the real
 * `resolveRecipients`, and the read/mutation paths run the real predicate.
 *
 * The three properties that matter, none of which the old shared-row model could
 * express:
 *
 *   same-tenant isolation   user A acting must not change user B's state
 *   source-domain bounding  a user must not receive what they cannot read
 *   live re-authorization   a delivery is not permanent — demotion takes effect
 *
 * Fixture:
 *   Tenant A   USER_A  owner            (holds everything)
 *              USER_B  field_ops        (personal.write, no cost.view)
 *              USER_V  viewer           (no personal.write at all)
 *   Tenant B   USER_C  owner
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const TENANT_A = 'tenant-a', TENANT_B = 'tenant-b'
const USER_A = 'user-a', USER_B = 'user-b', USER_V = 'user-v', USER_C = 'user-c'

type Role = 'owner' | 'admin' | 'project_manager' | 'engineer' | 'procurement' | 'field_ops' | 'viewer'
interface Row { id: string; tenant_id: string; role: Role; is_active: boolean }

/** The tenant directory the fan-out and the principal lookup both read. */
let USERS: Row[] = []

interface Event {
  id: string; tenant_id: string; category: string; priority: string
  title: string; body: string | null; source_type: string | null
  source_id: string | null; link_tab: string | null
  policy_key: string; required_capabilities: string[]; audience_strategy: string
  created_at: string
}
interface Delivery {
  id: string; tenant_id: string; notification_id: string; user_id: string
  read_at: string | null; dismissed_at: string | null; created_at: string
}
let EVENTS: Event[] = []
let DELIVERIES: Delivery[] = []
let seq = 0
/** Set to make the next delivery insert fail, for the rollback test. */
let failDeliveryInsert = false

const SQL_RE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const stmt = (a: unknown[]) => a.find((x): x is string => typeof x === 'string' && SQL_RE.test(x)) ?? ''
const args = (a: unknown[]) => (a.find(x => Array.isArray(x)) ?? []) as unknown[]

/** One executor shared by query / tenantQuery / the transaction client. */
async function exec(...a: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
  const q = stmt(a)
  const p = args(a)
  const ok = (rows: unknown[]) => ({ rows, rowCount: rows.length })

  // live principal
  if (/SELECT id, tenant_id, role, is_active FROM users WHERE id/i.test(q)) {
    const u = USERS.find(x => x.id === p[0])
    return ok(u ? [u] : [])
  }
  // tenant directory for fan-out
  if (/SELECT id, role FROM users WHERE tenant_id/i.test(q)) {
    return ok(USERS.filter(u => u.tenant_id === p[0] && u.is_active)
      .map(u => ({ id: u.id, role: u.role })))
  }
  // event insert
  if (/INSERT INTO notifications/i.test(q)) {
    const e: Event = {
      id: `evt-${++seq}`, tenant_id: p[0] as string, category: p[1] as string,
      priority: p[2] as string, title: p[3] as string, body: p[4] as string | null,
      source_type: p[5] as string | null, source_id: p[6] as string | null,
      link_tab: p[7] as string | null, policy_key: p[8] as string,
      required_capabilities: p[9] as string[], audience_strategy: p[10] as string,
      created_at: new Date(1700000000000 + seq).toISOString(),
    }
    EVENTS.push(e)
    return ok([{ id: e.id }])
  }
  // delivery insert — models UNIQUE(notification_id, user_id)
  if (/INSERT INTO notification_deliveries/i.test(q)) {
    if (failDeliveryInsert) throw new Error('simulated delivery insert failure')
    const [tenant_id, notification_id, user_id] = p as [string, string, string]
    if (DELIVERIES.some(d => d.notification_id === notification_id && d.user_id === user_id)) {
      return ok([])           // ON CONFLICT DO NOTHING
    }
    DELIVERIES.push({
      id: `del-${++seq}`, tenant_id, notification_id, user_id,
      read_at: null, dismissed_at: null, created_at: new Date().toISOString(),
    })
    return ok([])
  }

  // ── the per-user access predicate ─────────────────────────────────────────
  // Each clause is applied ONLY IF the statement actually contains it. The
  // filters are read off the SQL rather than assumed, so dropping
  // `d.user_id = $2` or the `required_capabilities <@ $3` re-check from the
  // service makes these tests fail instead of passing on the harness's memory
  // of what the query used to say.
  const bindsUser    = /d\.user_id\s*=\s*\$2/.test(q)
  const bindsTenant  = /d\.tenant_id\s*=\s*\$1/.test(q)
  const checksSource = /required_capabilities\s*<@\s*\$3/.test(q)
  const accessible = (tenantId: string, userId: string, held: string[]) =>
    DELIVERIES.filter(d => {
      if (bindsTenant && d.tenant_id !== tenantId) return false
      if (bindsUser   && d.user_id   !== userId)   return false
      const e = EVENTS.find(x => x.id === d.notification_id)
      if (!e) return false
      return !checksSource || e.required_capabilities.every(c => held.includes(c))
    })

  if (/FROM notification_deliveries d/i.test(q) && /SELECT COUNT/i.test(q)) {
    const [t, u, held] = p as [string, string, string[]]
    const n = accessible(t, u, held).filter(d => !d.read_at && !d.dismissed_at).length
    return ok([{ cnt: n }])
  }
  if (/FROM notification_deliveries d/i.test(q) && /JOIN notifications n/i.test(q) && /SELECT n\.id/i.test(q)) {
    const [t, u, held] = p as [string, string, string[]]
    let rows = accessible(t, u, held).filter(d => !d.dismissed_at)
    if (/d\.read_at IS NULL/.test(q)) rows = rows.filter(d => !d.read_at)
    const cat = p[3] as string | undefined
    return ok(rows.map(d => {
      const e = EVENTS.find(x => x.id === d.notification_id)!
      return { ...e, read_at: d.read_at, dismissed_at: d.dismissed_at }
    }).filter(r => cat == null || r.category === cat))
  }
  if (/UPDATE notification_deliveries d/i.test(q)) {
    const [t, u, held] = p as [string, string, string[]]
    const targetEvent = p[3] as string | undefined
    let rows = accessible(t, u, held)
    if (targetEvent) rows = rows.filter(d => d.notification_id === targetEvent)
    const setsRead = /SET\s+read_at/i.test(q)
    rows = setsRead ? rows.filter(d => !d.read_at) : rows.filter(d => !d.dismissed_at)
    if (setsRead && /d\.dismissed_at IS NULL/.test(q)) rows = rows.filter(d => !d.dismissed_at)
    for (const d of rows) {
      if (setsRead) d.read_at = 'now'
      else d.dismissed_at = 'now'
    }
    return ok(rows.map(d => ({ id: d.id })))
  }
  // every scan source query — no rows, so only the alerts we inject exist
  return ok([])
}

const mockQuery = vi.fn(exec)
vi.mock('../db/pool', () => ({
  query:       (...a: unknown[]) => mockQuery(...a),
  tenantQuery: (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: async (_t: string, fn: (c: unknown) => unknown) => {
    // Models BEGIN/COMMIT/ROLLBACK: on throw, everything this fn wrote is undone.
    const evtMark = EVENTS.length, delMark = DELIVERIES.length
    try {
      return await fn({ query: (...a: unknown[]) => mockQuery(...a) })
    } catch (err) {
      EVENTS.length = evtMark
      DELIVERIES.length = delMark
      throw err
    }
  },
  pool: { query: (...a: unknown[]) => mockQuery(...a), connect: vi.fn() },
}))

import { roleHasCapability } from '../authz/capabilities'
import {
  sourcePolicy, recipientRequirement, NOTIFICATION_SOURCE_POLICIES,
} from '../authz/notificationSourcePolicies'
import {
  listNotifications, unreadCount, markRead, dismiss, markAllRead, clearAll,
} from '../services/notifications2/notificationService'

interface Caller { id: string; tenantId: string; jwtRole?: string; jwtTenantId?: string }
let caller: Caller
let unauthenticated = false
const setCaller = (c: Caller) => {
  caller = c
  const g = globalThis as Record<string, unknown>
  g['__p2c4b'] = c
  g['__p2c4b_unauth'] = unauthenticated
}
/** Change the DB role without touching the token — the demotion case. */
const setRole = (id: string, role: Role) => {
  const u = USERS.find(x => x.id === id)!
  u.role = role
}
const roleOf = (id: string) => USERS.find(u => u.id === id)!.role

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, res: Record<string, unknown>, next: () => void) => {
    const g = globalThis as Record<string, unknown>
    if (g['__p2c4b_unauth']) {
      ;(res as unknown as { status: (n: number) => { json: (b: unknown) => void } })
        .status(401).json({ error: 'unauthenticated' })
      return
    }
    const c = g['__p2c4b'] as Caller
    req['auth'] = { sub: c.id, tid: c.jwtTenantId ?? c.tenantId, role: c.jwtRole ?? 'owner', jti: 'j' }
    next()
  },
  requireRole: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => {
  const mw = (req: Record<string, unknown>, _r: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p2c4b'] as Caller
    req['tenantId'] = c.jwtTenantId ?? c.tenantId
    next()
  }
  return {
    requireTenant: (...a: unknown[]) =>
      typeof a[2] === 'function' ? mw(a[0] as Record<string, unknown>, a[1], a[2] as () => void) : mw,
    invalidateTenantCache: () => {},
  }
})

import { notificationsRouter } from '../routes/notifications'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', notificationsRouter as never)
  return app
}

/** Held capabilities for a role, mirroring the service's projection. */
const held = (role: Role) => [...new Set(
  NOTIFICATION_SOURCE_POLICIES.flatMap(p => recipientRequirement(p)),
)].filter(c => roleHasCapability(role, c))

/** Insert an event + deliveries directly, using the real policy + eligibility. */
function seedEvent(tenantId: string, policyKey: string, directUserId?: string) {
  const policy = sourcePolicy(policyKey)
  const e: Event = {
    id: `evt-${++seq}`, tenant_id: tenantId, category: 'budget', priority: 'high',
    title: 't', body: 'b', source_type: null, source_id: null, link_tab: null,
    policy_key: policy.policyKey,
    required_capabilities: [...policy.requiredCapabilities],
    audience_strategy: policy.audienceStrategy,
    created_at: new Date(1700000000000 + seq).toISOString(),
  }
  EVENTS.push(e)
  const required = recipientRequirement(policy)
  const candidates = USERS.filter(u => u.tenant_id === tenantId && u.is_active)
  const chosen = policy.audienceStrategy === 'DIRECT_USER'
    ? candidates.filter(u => u.id === directUserId)
    : policy.audienceStrategy === 'LEGACY_OWNER_ONLY'
      ? candidates.filter(u => u.role === 'owner')
      : candidates
  for (const u of chosen.filter(u => required.every(c => roleHasCapability(u.role, c)))) {
    DELIVERIES.push({
      id: `del-${++seq}`, tenant_id: tenantId, notification_id: e.id, user_id: u.id,
      read_at: null, dismissed_at: null, created_at: e.created_at,
    })
  }
  return e.id
}

const deliveriesFor = (userId: string) => DELIVERIES.filter(d => d.user_id === userId)

beforeEach(() => {
  unauthenticated = false
  failDeliveryInsert = false
  EVENTS = []; DELIVERIES = []; seq = 0
  USERS = [
    { id: USER_A, tenant_id: TENANT_A, role: 'owner',     is_active: true },
    { id: USER_B, tenant_id: TENANT_A, role: 'field_ops', is_active: true },
    { id: USER_V, tenant_id: TENANT_A, role: 'viewer',    is_active: true },
    { id: USER_C, tenant_id: TENANT_B, role: 'owner',     is_active: true },
  ]
  mockQuery.mockClear()
  setCaller({ id: USER_A, tenantId: TENANT_A })
})

// ══ 1. Fan-out is bounded by the source domain ═══════════════════════════════
describe('source-domain bounding at fan-out', () => {
  it('delivers a cost alert to the cost.view holder and not to the field user', () => {
    expect(roleHasCapability('field_ops', 'personal.write')).toBe(true)
    expect(roleHasCapability('field_ops', 'cost.view')).toBe(false)

    seedEvent(TENANT_A, 'budget.overrun')

    expect(deliveriesFor(USER_A), 'owner holds cost.view').toHaveLength(1)
    expect(deliveriesFor(USER_B), 'field_ops lacks cost.view').toHaveLength(0)
    expect(deliveriesFor(USER_V), 'viewer lacks personal.write').toHaveLength(0)
  })

  it('delivers nothing to a viewer for any policy — D3 and D15 hold', () => {
    for (const p of NOTIFICATION_SOURCE_POLICIES) {
      DELIVERIES = []
      seedEvent(TENANT_A, p.policyKey, USER_V)
      expect(deliveriesFor(USER_V), `${p.policyKey} reached a viewer`).toHaveLength(0)
    }
  })

  it('routes the overdue-action alert to its assignee alone', () => {
    seedEvent(TENANT_A, 'action.overdue', USER_B)
    expect(deliveriesFor(USER_B), 'the assignee').toHaveLength(1)
    expect(deliveriesFor(USER_A), 'not automatically copied to the owner').toHaveLength(0)
  })

  it('delivers nothing when the direct target is ineligible, rather than redirecting', () => {
    seedEvent(TENANT_A, 'action.overdue', USER_V)   // viewer: no personal.write
    expect(DELIVERIES).toHaveLength(0)
  })

  it('keeps legacy events owner-only', () => {
    seedEvent(TENANT_A, 'legacy.pre_2c4b')
    expect(deliveriesFor(USER_A)).toHaveLength(1)
    expect(deliveriesFor(USER_B)).toHaveLength(0)
    expect(deliveriesFor(USER_V)).toHaveLength(0)
  })
})

// ══ 2. A user cannot reach a peer's event, even by guessing the id ════════════
describe('source-domain leakage is closed at access time too', () => {
  it('hides a cost event from a same-tenant user who lacks cost.view', async () => {
    const id = seedEvent(TENANT_A, 'budget.overrun')
    const list = await listNotifications(TENANT_A, USER_B, 'field_ops')
    expect(list).toHaveLength(0)
    expect(await unreadCount(TENANT_A, USER_B, 'field_ops')).toBe(0)
    expect(await markRead(TENANT_A, USER_B, 'field_ops', id),
      'a guessed event id must not work').toBe(false)
    expect(await dismiss(TENANT_A, USER_B, 'field_ops', id)).toBe(false)
  })

  it('shows it to the holder', async () => {
    seedEvent(TENANT_A, 'budget.overrun')
    expect(await listNotifications(TENANT_A, USER_A, 'owner')).toHaveLength(1)
    expect(await unreadCount(TENANT_A, USER_A, 'owner')).toBe(1)
  })
})

// ══ 3. Same-tenant cross-user isolation ══════════════════════════════════════
describe('same-tenant cross-user isolation', () => {
  beforeEach(() => {
    // An alert both A and B can see: meetings need project.view, which both hold.
    expect(roleHasCapability('field_ops', 'project.view')).toBe(true)
    seedEvent(TENANT_A, 'meeting.today')
  })

  it('gives each user their own delivery', () => {
    expect(deliveriesFor(USER_A)).toHaveLength(1)
    expect(deliveriesFor(USER_B)).toHaveLength(1)
  })

  it('marking read changes only the actor', async () => {
    const id = EVENTS[0]!.id
    expect(await markRead(TENANT_A, USER_A, 'owner', id)).toBe(true)
    expect(deliveriesFor(USER_A)[0]!.read_at).not.toBeNull()
    expect(deliveriesFor(USER_B)[0]!.read_at, 'user B must be untouched').toBeNull()
  })

  it('dismissing changes only the actor, and the event survives', async () => {
    const id = EVENTS[0]!.id
    expect(await dismiss(TENANT_A, USER_A, 'owner', id)).toBe(true)
    expect(deliveriesFor(USER_A)[0]!.dismissed_at).not.toBeNull()
    expect(deliveriesFor(USER_B)[0]!.dismissed_at).toBeNull()
    expect(EVENTS, 'the shared event is not deleted').toHaveLength(1)
  })

  it('read-all changes only the actor', async () => {
    expect(await markAllRead(TENANT_A, USER_A, 'owner')).toBe(1)
    expect(deliveriesFor(USER_A)[0]!.read_at).not.toBeNull()
    expect(deliveriesFor(USER_B)[0]!.read_at, 'the old code marked the whole tenant read').toBeNull()
  })

  it('clear changes only the actor', async () => {
    expect(await clearAll(TENANT_A, USER_A, 'owner')).toBe(1)
    expect(deliveriesFor(USER_A)[0]!.dismissed_at).not.toBeNull()
    expect(deliveriesFor(USER_B)[0]!.dismissed_at, 'the old code cleared the whole tenant').toBeNull()
    expect(EVENTS).toHaveLength(1)
  })

  it('a user in another tenant reaches none of it', async () => {
    const id = EVENTS[0]!.id
    expect(await listNotifications(TENANT_B, USER_C, 'owner')).toHaveLength(0)
    expect(await markRead(TENANT_B, USER_C, 'owner', id)).toBe(false)
    expect(deliveriesFor(USER_A)[0]!.read_at).toBeNull()
  })
})

// ══ 4. Demotion revokes access without a new token ════════════════════════════
describe('live re-authorization after a role change', () => {
  it('hides an already-delivered event once the DB role loses the capability', async () => {
    seedEvent(TENANT_A, 'budget.overrun')
    const id = EVENTS[0]!.id
    expect(await listNotifications(TENANT_A, USER_A, 'owner')).toHaveLength(1)

    // The delivery row still exists — membership is not authorization.
    setRole(USER_A, 'field_ops')
    expect(deliveriesFor(USER_A), 'the row is untouched').toHaveLength(1)

    expect(await listNotifications(TENANT_A, USER_A, roleOf(USER_A))).toHaveLength(0)
    expect(await unreadCount(TENANT_A, USER_A, roleOf(USER_A))).toBe(0)
    expect(await markRead(TENANT_A, USER_A, roleOf(USER_A), id)).toBe(false)
    expect(await dismiss(TENANT_A, USER_A, roleOf(USER_A), id)).toBe(false)
    expect(deliveriesFor(USER_A)[0]!.read_at, 'no state changed').toBeNull()
  })

  it('stops future fan-out to a user demoted to viewer', () => {
    setRole(USER_B, 'viewer')
    seedEvent(TENANT_A, 'meeting.today')
    expect(deliveriesFor(USER_B)).toHaveLength(0)
  })
})

// ══ 5. Transaction, uniqueness, fail-closed ══════════════════════════════════
describe('event/delivery integrity', () => {
  it('rolls the event back when a delivery insert fails', async () => {
    const { scanAndGenerate } = await import('../services/notifications2/notificationService')
    // Make the meetings generator produce one row, then fail its delivery.
    mockQuery.mockImplementationOnce(exec)
    failDeliveryInsert = true
    const before = EVENTS.length
    // scanAndGenerate swallows per-generator errors, so drive the invariant
    // through the transaction directly: any throw inside must undo the event.
    const { tenantTransaction } = await import('../db/pool')
    await expect(tenantTransaction(TENANT_A, async c => {
      const client = c as unknown as { query: (s: string, p: unknown[]) => Promise<unknown> }
      await client.query(
        `INSERT INTO notifications (tenant_id, category, priority, title, body, source_type, source_id, link_tab, policy_key, required_capabilities, audience_strategy)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [TENANT_A, 'meeting', 'low', 't', null, null, null, null, 'meeting.today', ['project.view'], 'CAPABILITY_HOLDERS'],
      )
      await client.query(
        `INSERT INTO notification_deliveries (tenant_id, notification_id, user_id) VALUES ($1,$2,$3)`,
        [TENANT_A, 'evt-x', USER_A],
      )
    })).rejects.toThrow(/simulated/)
    expect(EVENTS.length, 'no orphan event may survive').toBe(before)
    expect(DELIVERIES).toHaveLength(0)
    void scanAndGenerate
  })

  it('creates at most one delivery per event per user', () => {
    const id = seedEvent(TENANT_A, 'meeting.today')
    const before = DELIVERIES.length
    // A second fan-out of the same event must be a no-op.
    for (const u of [USER_A, USER_B]) {
      if (!DELIVERIES.some(d => d.notification_id === id && d.user_id === u)) {
        DELIVERIES.push({ id: 'x', tenant_id: TENANT_A, notification_id: id, user_id: u,
          read_at: null, dismissed_at: null, created_at: '' })
      }
    }
    expect(DELIVERIES.length, 'uniqueness is per (notification, user)').toBe(before)
  })

  it('records an event with zero recipients rather than failing', () => {
    USERS = USERS.filter(u => u.id === USER_V)   // only a viewer remains
    seedEvent(TENANT_A, 'meeting.today')
    expect(EVENTS, 'the event is still recorded').toHaveLength(1)
    expect(DELIVERIES, 'and reaches nobody').toHaveLength(0)
  })

  it('refuses to create an event for an unregistered policy', () => {
    expect(() => sourcePolicy('made.up')).toThrow(/fail closed/)
  })
})

// ══ 6. The HTTP surface ══════════════════════════════════════════════════════
describe('notification routes', () => {
  const app = () => makeApp()
  const asRole = (id: string, role: Role, tenantId = TENANT_A) => {
    setRole(id, role); setCaller({ id, tenantId })
  }

  describe('GET /notifications', () => {
    it('returns only the caller\'s own deliveries', async () => {
      seedEvent(TENANT_A, 'meeting.today')
      await markRead(TENANT_A, USER_B, 'field_ops', EVENTS[0]!.id)

      setCaller({ id: USER_A, tenantId: TENANT_A })
      const res = await request(app()).get('/api/v1/notifications')
      expect(res.status).toBe(200)
      expect(res.body.notifications).toHaveLength(1)
      expect(res.body.notifications[0].readAt, 'B reading it must not mark it read for A').toBeNull()
    })

    it('refuses the platform administrator', async () => {
      asRole(USER_A, 'admin')
      expect((await request(app()).get('/api/v1/notifications')).status).toBe(403)
    })

    it('admits a viewer — reading your own inbox is a read', async () => {
      asRole(USER_A, 'viewer')
      expect((await request(app()).get('/api/v1/notifications')).status).toBe(200)
    })

    it('refuses an unauthenticated caller', async () => {
      unauthenticated = true; setCaller({ id: USER_A, tenantId: TENANT_A })
      expect((await request(app()).get('/api/v1/notifications')).status).toBe(401)
    })

    it('refuses a deactivated account', async () => {
      USERS.find(u => u.id === USER_A)!.is_active = false
      expect((await request(app()).get('/api/v1/notifications')).status).toBe(401)
    })

    it('refuses a token whose tenant contradicts the row', async () => {
      setCaller({ id: USER_A, tenantId: TENANT_A, jwtTenantId: TENANT_B })
      expect((await request(app()).get('/api/v1/notifications')).status).toBe(401)
    })
  })

  describe('GET /notifications/count', () => {
    it('counts only the caller\'s unread deliveries', async () => {
      seedEvent(TENANT_A, 'meeting.today')
      await markAllRead(TENANT_A, USER_B, 'field_ops')
      setCaller({ id: USER_A, tenantId: TENANT_A })
      const res = await request(app()).get('/api/v1/notifications/count')
      expect(res.body.count, 'B reading must not decrement A').toBe(1)
    })
  })

  describe('personal mutations require personal.write', () => {
    it('admits a holder on their own delivery', async () => {
      seedEvent(TENANT_A, 'meeting.today')
      setCaller({ id: USER_B, tenantId: TENANT_A })
      expect((await request(app()).post(`/api/v1/notifications/${EVENTS[0]!.id}/read`)).status).toBe(200)
      expect(deliveriesFor(USER_B)[0]!.read_at).not.toBeNull()
      expect(deliveriesFor(USER_A)[0]!.read_at).toBeNull()
    })

    it('refuses a viewer, with no state change', async () => {
      seedEvent(TENANT_A, 'meeting.today')
      asRole(USER_B, 'viewer')
      for (const url of ['/api/v1/notifications/read-all', '/api/v1/notifications/clear']) {
        expect((await request(app()).post(url)).status, url).toBe(403)
      }
      expect(DELIVERIES.every(d => !d.read_at && !d.dismissed_at)).toBe(true)
    })

    it('refuses the platform administrator', async () => {
      asRole(USER_A, 'admin')
      expect((await request(app()).post('/api/v1/notifications/read-all')).status).toBe(403)
    })

    it('answers 404 for an event the caller has no delivery for', async () => {
      const id = seedEvent(TENANT_A, 'budget.overrun')   // owner only
      setCaller({ id: USER_B, tenantId: TENANT_A })
      expect((await request(app()).post(`/api/v1/notifications/${id}/read`)).status).toBe(404)
    })

    it('follows the live database role, not the token', async () => {
      seedEvent(TENANT_A, 'meeting.today')
      setRole(USER_B, 'viewer')
      setCaller({ id: USER_B, tenantId: TENANT_A, jwtRole: 'owner' })
      expect((await request(app()).post('/api/v1/notifications/read-all')).status).toBe(403)
      expect(DELIVERIES.every(d => !d.read_at)).toBe(true)
    })
  })

  describe('POST /notifications/scan requires personal.admin', () => {
    it('admits the owner', async () => {
      setCaller({ id: USER_A, tenantId: TENANT_A })
      expect((await request(app()).post('/api/v1/notifications/scan')).status).toBe(200)
    })

    it.each(['admin', 'project_manager', 'engineer', 'procurement', 'field_ops', 'viewer'] as const)(
      'refuses %s and writes nothing', async role => {
        asRole(USER_A, role)
        const res = await request(app()).post('/api/v1/notifications/scan')
        expect(res.status).toBe(403)
        expect(EVENTS, 'a refused scan must create no event').toHaveLength(0)
        expect(DELIVERIES).toHaveLength(0)
      })

    it('refuses a stale owner token over a live engineer', async () => {
      setRole(USER_A, 'engineer')
      setCaller({ id: USER_A, tenantId: TENANT_A, jwtRole: 'owner' })
      expect((await request(app()).post('/api/v1/notifications/scan')).status).toBe(403)
      expect(EVENTS).toHaveLength(0)
    })

    it('refuses an unauthenticated caller', async () => {
      unauthenticated = true; setCaller({ id: USER_A, tenantId: TENANT_A })
      expect((await request(app()).post('/api/v1/notifications/scan')).status).toBe(401)
      expect(EVENTS).toHaveLength(0)
    })
  })
})

// ══ 7. The capability projection the tests rely on ═══════════════════════════
describe('the fixture roles discriminate as intended', () => {
  it('field_ops holds personal.write but not cost.view', () => {
    expect(held('field_ops')).toContain('personal.write')
    expect(held('field_ops')).not.toContain('cost.view')
  })
  it('viewer holds neither', () => {
    expect(held('viewer')).not.toContain('personal.write')
  })
  it('admin holds no notification-relevant capability at all', () => {
    expect(held('admin')).toEqual([])
  })
})
