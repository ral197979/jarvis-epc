/**
 * ADR-014 Phase 2C-4B — the notification ownership ratchet.
 *
 * Phase 2C-4A could not close these seven routes because the schema had no
 * recipient: `read_at`/`dismissed_at` were single columns on a tenant-shared
 * row, so "user A must not mutate user B's notification" was not expressible.
 * D13 supplied the model. What this file defends is that the model stays real:
 *
 *   route capability      may this principal touch notification state at all
 *   delivery ownership    is this row theirs
 *   live source authority do they STILL hold what the event requires
 *
 * All three are required. A route-level Personal Inbox capability is not
 * sufficient by itself, and a delivery row is not permanent authorization.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  NOTIFICATION_SOURCE_POLICIES, DELIVERY_BASE_CAPABILITY,
  LEGACY_POLICY_KEY, LEGACY_REQUIRED_CAPABILITIES,
  sourcePolicy, recipientRequirement,
} from '../authz/notificationSourcePolicies'
import {
  PERSONAL_INBOX_ENDPOINTS, DEFERRED_NOTIFICATIONS,
  NOTIFICATION_OWNERSHIP_RESOLUTION,
} from '../authz/personalInboxAuthorization'
import { isServerCapability, SERVER_ROLE_CAPS, USER_ROLES, type UserRole } from '../authz/capabilities'
import { censusWithEffectivePaths } from './helpers/endpointCensus'

const endpoints = censusWithEffectivePaths()
const byKey = new Map(endpoints.map(e => [e.key, e]))
const holders = (c: string): UserRole[] =>
  USER_ROLES.filter(r => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(c))
const holdersOfAll = (caps: readonly string[]): UserRole[] =>
  USER_ROLES.filter(r => caps.every(c => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(c)))

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const stripComments = (s: string) => s
  .split('\n')
  .filter(l => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') })
  .join('\n')

const ROUTES   = read('api/routes/notifications.ts')
const SERVICE  = read('api/services/notifications2/notificationService.ts')
const MIGRATION = read('api/db/migrations/085_notification_deliveries.sql')

const NOTIF = PERSONAL_INBOX_ENDPOINTS.filter(e => e.file === 'notifications.ts')

// ─── 1. The seven routes ──────────────────────────────────────────────────────
describe('the seven notification routes', () => {
  it('are all registered and all leave PENDING_PHASE2', () => {
    expect(NOTIF.length).toBe(7)
    expect(DEFERRED_NOTIFICATIONS.length, 'nothing may remain deferred').toBe(0)
    for (const e of NOTIF) {
      const live = byKey.get(`${e.file} ${e.router}.${e.method} ${e.path}`)
      expect(live, `${e.path}: no such endpoint`).toBeDefined()
      expect(live!.allCapabilities, `${e.path}`).toEqual([...e.capabilities])
    }
  })

  it('carries the exact §35 disposition table', () => {
    const cap = (p: string) => NOTIF.find(e => e.path === p)!.capabilities
    expect(cap('/notifications')).toEqual(['personal.view'])
    expect(cap('/notifications/count')).toEqual(['personal.view'])
    expect(cap('/notifications/:id/read')).toEqual(['personal.write'])
    expect(cap('/notifications/:id/dismiss')).toEqual(['personal.write'])
    expect(cap('/notifications/read-all')).toEqual(['personal.write'])
    expect(cap('/notifications/clear')).toEqual(['personal.write'])
    expect(cap('/notifications/scan')).toEqual(['personal.admin'])
  })

  it('puts scan behind owner-only authority, not platform.admin', () => {
    expect(holders('personal.admin')).toEqual(['owner'])
    expect(stripComments(ROUTES), 'platform.admin must not guard a Personal Inbox operation')
      .not.toMatch(/requireCapability\('platform\.admin'\)/)
  })
})

// ─── 2. Runtime never writes the shared read/dismiss columns ──────────────────
describe('personal state lives in the delivery table', () => {
  it('never updates notifications.read_at or notifications.dismissed_at at runtime', () => {
    const runtime = stripComments(SERVICE) + stripComments(ROUTES)
    expect(runtime, 'shared read state must be dormant')
      .not.toMatch(/UPDATE\s+notifications\s+SET[\s\S]{0,120}read_at/i)
    expect(runtime, 'shared dismiss state must be dormant')
      .not.toMatch(/UPDATE\s+notifications\s+SET[\s\S]{0,120}dismissed_at/i)
  })

  it('targets notification_deliveries for every personal state change', () => {
    const updates = [...stripComments(SERVICE).matchAll(/UPDATE\s+(\w+)/gi)].map(m => m[1])
    expect(updates.length, 'the service must perform personal updates').toBeGreaterThan(0)
    for (const table of updates) {
      expect(table, 'only the delivery table may carry personal state')
        .toBe('notification_deliveries')
    }
  })

  it('marks the legacy columns dormant in the migration rather than dropping them', () => {
    expect(MIGRATION).toMatch(/COMMENT ON COLUMN notifications\.read_at/)
    expect(MIGRATION).toMatch(/COMMENT ON COLUMN notifications\.dismissed_at/)
  })
})

// ─── 3. Schema invariants ─────────────────────────────────────────────────────
describe('the delivery schema', () => {
  it('creates notification_deliveries with a per-event/user uniqueness constraint', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS notification_deliveries/)
    expect(MIGRATION, 'uniqueness must be enforced by the database, not the application')
      .toMatch(/UNIQUE\s*\(\s*notification_id\s*,\s*user_id\s*\)/)
  })

  it('carries tenant, recipient, read and dismiss state', () => {
    for (const col of ['tenant_id', 'notification_id', 'user_id', 'read_at', 'dismissed_at']) {
      expect(MIGRATION, `${col} missing`).toMatch(new RegExp(`\\b${col}\\b`))
    }
  })

  it('indexes the inbox, the unread count and the fan-out lookup', () => {
    expect(MIGRATION).toMatch(/notification_deliveries_inbox/)
    expect(MIGRATION).toMatch(/notification_deliveries_unread/)
    expect(MIGRATION).toMatch(/notification_deliveries_notification/)
  })

  it('enables tenant row-level security, like the event table', () => {
    expect(MIGRATION).toMatch(/ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY/)
    expect(MIGRATION).toMatch(/notification_deliveries_tenant_isolation/)
  })

  it('stores the source authority on the event', () => {
    expect(MIGRATION).toMatch(/required_capabilities\s+TEXT\[\]/)
    expect(MIGRATION).toMatch(/audience_strategy/)
    expect(MIGRATION).toMatch(/policy_key/)
  })

  it('backfills legacy rows to active owners only — D14', () => {
    expect(MIGRATION).toMatch(/LEGACY_OWNER_ONLY/)
    expect(MIGRATION, 'the backfill must join owners specifically')
      .toMatch(/u\.role\s*=\s*'owner'/)
    expect(MIGRATION, 'and only active ones').toMatch(/u\.is_active\s*=\s*TRUE/)
    expect(MIGRATION, 'legacy authority is the fail-closed cross-domain read')
      .toMatch(/ARRAY\['crossdomain\.read'\]/)
  })
})

// ─── 4. Source policies ───────────────────────────────────────────────────────
describe('notification source policies', () => {
  it('covers every generator in the scan, exactly once', () => {
    const keys = NOTIFICATION_SOURCE_POLICIES.map(p => p.policyKey)
    expect(keys.length).toBe(new Set(keys).size)

    // Every policyKey the service passes must resolve, and every non-legacy
    // policy must actually be used by a generator.
    const used = [...SERVICE.matchAll(/policyKey:\s*'([^']+)'/g)].map(m => m[1]!)
    expect(used.length, 'the scan must declare a policy per alert').toBeGreaterThan(0)
    for (const k of used) expect(() => sourcePolicy(k), `${k} unregistered`).not.toThrow()

    const nonLegacy = keys.filter(k => k !== LEGACY_POLICY_KEY)
    for (const k of nonLegacy) {
      expect(used, `${k} is registered but no generator emits it`).toContain(k)
    }
  })

  it('names source tables and the disclosure being authorized', () => {
    for (const p of NOTIFICATION_SOURCE_POLICIES) {
      expect(p.sourceTables.length, `${p.policyKey}`).toBeGreaterThan(0)
      expect(p.discloses.length, `${p.policyKey}`).toBeGreaterThan(10)
      expect(p.reason.length, `${p.policyKey}: reason too thin to review`).toBeGreaterThan(60)
    }
  })

  it('requires at least one real source capability, all of them registered', () => {
    for (const p of NOTIFICATION_SOURCE_POLICIES) {
      expect(p.requiredCapabilities.length, `${p.policyKey} authorizes nothing`).toBeGreaterThan(0)
      for (const c of p.requiredCapabilities) {
        expect(isServerCapability(c), `${p.policyKey}: unknown capability ${c}`).toBe(true)
      }
    }
  })

  it('has no EVERYONE audience — an underivable alert fails closed', () => {
    const strategies = new Set(NOTIFICATION_SOURCE_POLICIES.map(p => p.audienceStrategy))
    expect([...strategies].sort())
      .toEqual(['CAPABILITY_HOLDERS', 'DIRECT_USER', 'LEGACY_OWNER_ONLY'])
    expect(read('api/authz/notificationSourcePolicies.ts')).not.toMatch(/'EVERYONE'/)
  })

  it('throws rather than defaulting for an unregistered policy', () => {
    expect(() => sourcePolicy('does.not.exist')).toThrow(/fail closed/)
  })

  it('adds personal.write to every recipient requirement — D15', () => {
    expect(DELIVERY_BASE_CAPABILITY).toBe('personal.write')
    for (const p of NOTIFICATION_SOURCE_POLICIES) {
      expect(recipientRequirement(p)).toContain('personal.write')
    }
  })

  it('therefore delivers to no viewer and no platform administrator', () => {
    for (const p of NOTIFICATION_SOURCE_POLICIES) {
      const eligible = holdersOfAll(recipientRequirement(p))
      expect(eligible, `${p.policyKey} must not reach viewer`).not.toContain('viewer')
      expect(eligible, `${p.policyKey} must not reach admin`).not.toContain('admin')
    }
  })

  it('keeps the legacy policy owner-only', () => {
    const legacy = sourcePolicy(LEGACY_POLICY_KEY)
    expect(legacy.audienceStrategy).toBe('LEGACY_OWNER_ONLY')
    expect([...legacy.requiredCapabilities]).toEqual([...LEGACY_REQUIRED_CAPABILITIES])
    expect(holdersOfAll(recipientRequirement(legacy))).toEqual(['owner'])
  })

  it('bounds each alert to the domain its body actually discloses', () => {
    // A spot-check with teeth: the two policies whose bodies carry currency must
    // require cost.view, and the invoice alert must require both its domains.
    const budget = sourcePolicy('budget.overrun')
    expect(budget.requiredCapabilities).toContain('cost.view')
    const invoice = sourcePolicy('invoice.stale')
    expect([...invoice.requiredCapabilities].sort()).toEqual(['cost.view', 'procurement.view'])
    const bid = sourcePolicy('bid.deadline')
    expect(bid.requiredCapabilities).toContain('crm.view')
  })

  it('routes the one direct-recipient alert to the assignee, not to a capability set', () => {
    const overdue = sourcePolicy('action.overdue')
    expect(overdue.audienceStrategy).toBe('DIRECT_USER')
    expect(SERVICE, 'the generator must pass the source row\'s user')
      .toMatch(/directUserId:\s*\(row\['assigned_to_user_id'\]/)
  })
})

// ─── 5. Fan-out and access are both capability-gated ──────────────────────────
describe('the two-layer check', () => {
  it('resolves recipients from the canonical capability projection', () => {
    expect(SERVICE, 'no parallel role table for notifications')
      .toMatch(/roleHasCapability\(/)
    expect(SERVICE).toMatch(/function eligible\(/)
    expect(SERVICE).toMatch(/function resolveRecipients\(/)
  })

  it('has no permissive branch in recipient resolution', () => {
    const body = /function resolveRecipients\([\s\S]*?\n\}/.exec(stripComments(SERVICE))?.[0] ?? ''
    expect(body.length, 'resolveRecipients must parse').toBeGreaterThan(100)
    expect(body, 'no "everyone" fallback').not.toMatch(/return users\.map/)
    expect(body, 'DIRECT_USER must not fall back to the owner')
      .not.toMatch(/owner[\s\S]{0,80}fallback/i)
  })

  it('re-checks the event requirement against the caller on every access', () => {
    // `required_capabilities <@ $3::text[]` is the live re-check; it must appear
    // on the shared predicate every read and mutation uses.
    expect(SERVICE).toMatch(/required_capabilities\s*<@/)
    const accessible = /const ACCESSIBLE = `[\s\S]*?`/.exec(SERVICE)?.[0] ?? ''
    expect(accessible).toMatch(/d\.user_id\s*=\s*\$2/)
    expect(accessible).toMatch(/d\.tenant_id\s*=\s*\$1/)
    expect(accessible).toMatch(/required_capabilities\s*<@\s*\$3/)
  })

  it('applies that predicate to every per-user function', () => {
    for (const fn of ['listNotifications', 'unreadCount', 'markRead', 'dismiss',
                      'markAllRead', 'clearAll']) {
      const body = new RegExp(`export async function ${fn}\\(([\\s\\S]*?)\\n\\}`).exec(SERVICE)?.[0] ?? ''
      expect(body.length, `${fn} must parse`).toBeGreaterThan(80)
      expect(body, `${fn} must use the ACCESSIBLE predicate`).toMatch(/ACCESSIBLE/)
      expect(body, `${fn} must take the live role`).toMatch(/role:\s*string/)
    }
  })

  it('creates the event and its deliveries in one transaction', () => {
    expect(SERVICE).toMatch(/tenantTransaction\(/)
    const insert = /async function insertNotif\([\s\S]*?\n\}/.exec(SERVICE)?.[0] ?? ''
    expect(insert).toMatch(/INSERT INTO notifications/)
    expect(insert).toMatch(/INSERT INTO notification_deliveries/)
    expect(insert.indexOf('INSERT INTO notifications'))
      .toBeLessThan(insert.indexOf('INSERT INTO notification_deliveries'))
    expect(insert, 'concurrent scans must not duplicate')
      .toMatch(/ON CONFLICT \(notification_id, user_id\) DO NOTHING/)
  })
})

// ─── 6. Nothing authority-bearing comes from the request ──────────────────────
describe('policy cannot be forged through the HTTP surface', () => {
  it('reads no recipient, audience or capability field from the request', () => {
    const routes = stripComments(ROUTES)
    for (const f of ['user_id', 'recipient_id', 'required_capabilities',
                     'audience', 'read_for_user', 'dismiss_for_user']) {
      expect(routes, `${f} must not be readable from a request`).not.toContain(f)
    }
    expect(routes, 'notification routes read no request body at all').not.toMatch(/req\.body/)
  })

  it('derives the event policy in the service, never from the caller', () => {
    const insert = /async function insertNotif\([\s\S]*?\n\}/.exec(SERVICE)?.[0] ?? ''
    expect(insert, 'the policy is looked up, not supplied').toMatch(/sourcePolicy\(n\.policyKey\)/)
    expect(insert, 'and the event stores the policy\'s capabilities')
      .toMatch(/policy\.requiredCapabilities/)
  })

  it('records how the Phase 2C-4A deferral was resolved', () => {
    expect(NOTIFICATION_OWNERSHIP_RESOLUTION.decision).toBe('D13')
    expect(NOTIFICATION_OWNERSHIP_RESOLUTION.endpointsClosed).toBe(7)
  })
})

// ─── 7. Every production writer goes through the new path ─────────────────────
describe('no legacy event-only writer survives', () => {
  it('has exactly one production INSERT INTO notifications, inside insertNotif', () => {
    const files = ['api/routes', 'api/services']
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) { walk(rel); continue }
        if (!entry.name.endsWith('.ts')) continue
        const src = stripComments(read(rel))
        if (!/INSERT\s+INTO\s+notifications\b/i.test(src)) continue
        if (rel === 'api/services/notifications2/notificationService.ts') continue
        offenders.push(rel)
      }
    }
    for (const f of files) walk(f)
    expect(offenders,
      `every user-facing notification writer must go through the event+policy+delivery path:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('routes the only writer through the policy lookup', () => {
    const inserts = [...SERVICE.matchAll(/INSERT\s+INTO\s+notifications\b/gi)]
    expect(inserts.length, 'exactly one event writer').toBe(1)
    const insert = /async function insertNotif\([\s\S]*?\n\}/.exec(SERVICE)?.[0] ?? ''
    expect(insert, 'the single writer is inside insertNotif').toMatch(/INSERT INTO notifications/)
  })
})
