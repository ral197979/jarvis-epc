/**
 * ADR-014 Phase 3E — the direct-ID read ratchet.
 *
 * Phase 3D closed the project-bound MUTATION surface. This file holds the
 * surface it left open, and which Phase 3E closes:
 *
 *     correct functional read capability
 *   + knowledge of a record's UUID
 *   + no live membership of that record's project
 *   = the record was still returned
 *
 * Every assertion is derived from source and proves it FOUND its target first,
 * so a renamed guard, a moved route or a regex that stops matching fails loudly
 * rather than passing vacuously — the same discipline as the Phase-3A ratchet.
 *
 * What is held here:
 *   §8/§9   every project-bound direct-ID read has exactly one disposition
 *   §12     a protected read carries capability AND record scope, conjunctively
 *   §15     the declared resource addresses the table the ID actually names
 *   §16     the guard sits on the right router in a multi-router file
 *   §29     a SELF-scoped surface is not widened into project membership
 *   §37     the declared policy exists, resolves, and matches the migrations
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { censusWithEffectivePaths } from './helpers/endpointCensus'
import {
  DIRECT_ID_ADOPTION, directIdCounters, policyFor, RECORD_SCOPE_POLICIES,
} from '../authz/recordScopePolicies'

const census = censusWithEffectivePaths()
const src = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const schemaMap = JSON.parse(
  src('audit/adr-014/schema-project-parent-map.json'),
) as { tables: { table: string; projectParent: Record<string, unknown> }[] }

/** The census row(s) an adoption entry names, matched on METHOD + mounted path. */
function endpointsFor(entry: { endpoint: string }) {
  const [method, mounted] = entry.endpoint.split(' ')
  return census.filter(e => e.method === method && e.effective.includes(mounted!))
}

const protectedEntries = DIRECT_ID_ADOPTION.filter(a => a.disposition === 'PROTECT_PHASE3E')
const selfEntries      = DIRECT_ID_ADOPTION.filter(a => a.disposition === 'SELF_SCOPED')
const openEntries      = DIRECT_ID_ADOPTION.filter(
  a => a.disposition === 'NON_PROJECT_RESOURCE' || a.disposition === 'DEFERRED_PHASE3_SCOPE_MODEL')

// ─── 1. The candidate set is complete and singly-dispositioned (§8, §9) ───────
describe('every project-bound direct-ID read has exactly one disposition', () => {
  it('covers the machine-derived candidate set, and nothing is unexplained', () => {
    const c = directIdCounters()
    expect(c.candidates, 'the Phase-3D inventory found 63 project-bound direct-ID reads, 9 already protected').toBe(54)
    expect(c.protected_ + c.selfScoped + c.nonProject + c.deferred).toBe(c.candidates)
    expect(c.unexplained, 'a disposition without an argument is a gap wearing a label').toBe(0)
  })

  it('names each endpoint exactly once', () => {
    const keys = DIRECT_ID_ADOPTION.map(a => a.endpoint)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('names only endpoints that are really mounted, so the closure is not vacuous', () => {
    for (const a of DIRECT_ID_ADOPTION) {
      expect(endpointsFor(a).length, `${a.endpoint} is not mounted`).toBeGreaterThan(0)
    }
  })

  it('reports the split this slice actually achieved', () => {
    const c = directIdCounters()
    expect(c.protected_).toBe(44)
    expect(c.selfScoped).toBe(4)
    expect(c.nonProject).toBe(4)
    expect(c.deferred, 'both twin-keyed reads, deferred for a MODEL reason not a scheduling one').toBe(2)
  })
})

// ─── 2. A protected read is capability AND scope, conjunctively (§12, §16) ────
describe('every Phase-3E route carries both authorization dimensions', () => {
  it('keeps its existing functional read capability', () => {
    for (const a of protectedEntries) {
      const [e] = endpointsFor(a)
      expect(e!.allCapabilities, `${a.endpoint} lost its capability guard`).not.toBeNull()
      expect(e!.allCapabilities!.length).toBeGreaterThan(0)
    }
  })

  it('declares the canonical record scope on the route itself', () => {
    for (const a of protectedEntries) {
      const [e] = endpointsFor(a)
      const decl = e!.body.split('\n')[0] ?? ''
      const guard = a.resource === 'project'
        ? /requireProjectScope\(\s*'id'\s*\)/
        : new RegExp(`requireRecordScope\\(\\s*'${a.resource}'`)
      expect(decl, `${a.endpoint} does not declare ${a.resource} scope`).toMatch(guard)
    }
  })

  it('hangs the guard off the router the adoption entry names (§16 multi-router files)', () => {
    // procurement.ts declares four routers; subcontracts.ts and iot.ts more than
    // one each. A path-only match would be ambiguous in exactly those files, so
    // the registry records the router variable and it is checked here.
    for (const a of protectedEntries) {
      const [e] = endpointsFor(a)
      expect(e!.router, `${a.endpoint} is declared on ${e!.router}, not ${a.router}`).toBe(a.router)
    }
  })

  it('resolves every declared resource to a policy with a derivation', () => {
    for (const a of protectedEntries) {
      if (a.resource === 'project') continue          // requireProjectScope needs no parent lookup
      const p = policyFor(a.resource)
      expect(p, `${a.resource} has no policy, so requireRecordScope would deny everyone`).not.toBeNull()
      expect(p!.derivation, `${a.resource} has no derivation`).toBeTruthy()
    }
  })
})

// ─── 3. The resource addresses the record the ID names (§15) ─────────────────
describe('the declared scope resource matches the table the ID really addresses', () => {
  it('binds each policy to the record table the registry proved from the handler SQL', () => {
    for (const a of protectedEntries) {
      if (a.resource === 'project') {
        expect(a.recordTable).toBe('projects')
        continue
      }
      expect(policyFor(a.resource)!.table, `${a.endpoint} scopes the wrong table`).toBe(a.recordTable)
    }
  })

  it('proves the twelve sub-collection routes scope their PARENT, not their payload table', () => {
    // The extractor's `primaryTable` is the first written table reaching a
    // project, which for a sub-collection route is the CHILD. Scoping the child
    // would look up an id that table has never seen and refuse every caller, so
    // these are the routes where getting §15 wrong is silently catastrophic.
    const parentScoped: [string, string][] = [
      ['GET /api/v1/bid-packages/:id/submissions', 'bid_packages'],
      ['GET /api/v1/budgets/:id/items',            'budgets'],
      ['GET /api/v1/change-orders/:id/tasks',      'change_orders'],
      ['GET /api/v1/evm/baselines/:baselineId/wbs','evm_baselines'],
      ['GET /api/v1/knowledge/sources/:id/chunks', 'knowledge_sources'],
      ['GET /api/v1/meetings/:id/actions',         'meetings'],
      ['GET /api/v1/meetings/:id/agenda',          'meetings'],
      ['GET /api/v1/ncrs/:id/capas',               'ncrs'],
      ['GET /api/v1/readiness/subsystem/:id',      'subsystems'],
      ['GET /api/v1/rfis/:id/copilot',             'rfis'],
      ['GET /api/v1/sensors/:id/readings',         'sensors'],
      ['GET /api/v1/subcontracts/:id/invoices',    'subcontracts'],
    ]
    for (const [endpoint, table] of parentScoped) {
      const a = DIRECT_ID_ADOPTION.find(x => x.endpoint === endpoint)
      expect(a, `${endpoint} left the adoption registry`).toBeTruthy()
      expect(a!.recordTable).toBe(table)
      expect(policyFor(a!.resource)!.table).toBe(table)
    }
  })

  it('reads a non-default route parameter where the ID is not called :id', () => {
    const byParam: [string, string, string][] = [
      ['GET /api/v1/evm/baselines/:baselineId/wbs', 'evm_baselines',     'baselineId'],
      ['GET /api/v1/files/presign/:versionId',      'document_versions', 'versionId'],
      ['GET /api/v1/test-packs/:packId',            'test_packs',        'packId'],
    ]
    for (const [endpoint, resource, param] of byParam) {
      const a = DIRECT_ID_ADOPTION.find(x => x.endpoint === endpoint)!
      const [e] = endpointsFor(a)
      expect(e!.body.split('\n')[0]).toMatch(
        new RegExp(`requireRecordScope\\(\\s*'${resource}'\\s*,\\s*'${param}'\\s*\\)`))
    }
  })
})

// ─── 4. FK derivations agree with the migrations (§37) ───────────────────────
describe('an FK-derived resource declares the hop the schema really has', () => {
  it('matches every FK_PATH policy this slice relies on against the parsed migrations', () => {
    const used = new Set(protectedEntries.map(a => a.resource))
    const fk = RECORD_SCOPE_POLICIES.filter(p => used.has(p.resource) && p.derivation?.kind === 'FK_PATH')
    expect(fk.length, 'no FK_PATH policy was checked — the filter stopped matching').toBeGreaterThan(0)

    for (const p of fk) {
      const d = p.derivation as Extract<typeof p.derivation, { kind: 'FK_PATH' }>
      const t = schemaMap.tables.find(x => x.table === d.table)
      expect(t, `${d.table} is not in the parsed schema`).toBeTruthy()
      const parent = t!.projectParent as { strategy: string; path?: { via: string; table: string; column: string }[] }
      expect(parent.strategy, `${d.table} is not FK_PATH in the migrations`).toBe('FK_PATH')
      const hop = parent.path![0]!
      expect(hop.via,    `${p.resource} declares the wrong foreign key`).toBe(d.via)
      expect(hop.table,  `${p.resource} declares the wrong parent table`).toBe(d.parentTable)
      expect(hop.column, `${p.resource} declares the wrong parent column`).toBe(d.parentProjectColumn)
    }
  })

  it('declares knowledge_chunks against the source hop migration 022 actually creates', () => {
    const d = policyFor('knowledge_chunks')!.derivation as Extract<
      ReturnType<typeof policyFor> extends null ? never : NonNullable<ReturnType<typeof policyFor>>['derivation'],
      { kind: 'FK_PATH' }>
    expect(d.via).toBe('source_id')
    expect(d.parentTable).toBe('knowledge_sources')
    expect(src('api/db/migrations/022_knowledge_base.sql')).toMatch(/project_id\s+UUID\s+REFERENCES projects\(id\)/)
  })
})

// ─── 5. SELF stays SELF (§29) ────────────────────────────────────────────────
describe('an ownership-scoped read is not widened into project membership', () => {
  it('leaves the Personal Inbox and chat-session reads free of requireRecordScope', () => {
    for (const a of selfEntries) {
      const [e] = endpointsFor(a)
      expect(e!.body.split('\n')[0], `${a.endpoint} was converted to project scope, which WIDENS it`)
        .not.toMatch(/requireRecordScope\(/)
    }
  })

  it('keeps an ownership guard on each of them, so they are not simply unguarded', () => {
    const owners: [string, RegExp][] = [
      ['GET /api/v1/actions/:id',               /requireActionAccess\(/],
      ['GET /api/v1/actions/:id/relationships', /requireActionAccess\(/],
      ['GET /api/v1/actions/:id/timeline',      /requireActionAccess\(/],
      ['GET /api/v1/ask/sessions/:id',          /user_id\s*=\s*\$2/],
    ]
    for (const [endpoint, rule] of owners) {
      const a = DIRECT_ID_ADOPTION.find(x => x.endpoint === endpoint)!
      expect(endpointsFor(a)[0]!.body, `${endpoint} lost its ownership rule`).toMatch(rule)
    }
  })
})

// ─── 6. What stays open, stays open for a stated reason (§30, §61) ───────────
describe('the routes this slice does not close are classified, not ignored', () => {
  it('keeps the non-project reads off the record-scope layer, because their ID has no project', () => {
    for (const a of openEntries) {
      expect(a.resource, `${a.endpoint} names a resource but is not scoped`).toBe('')
      expect(endpointsFor(a)[0]!.body.split('\n')[0]).not.toMatch(/requireRecordScope\(/)
    }
  })

  it('proves each of those tables really has no project parent in the migrations', () => {
    for (const table of ['vendors', 'team_members', 'operational_twins']) {
      const t = schemaMap.tables.find(x => x.table === table)
      expect(t, `${table} is not in the parsed schema`).toBeTruthy()
      expect((t!.projectParent as { strategy: string }).strategy,
        `${table} DOES reach a project — the deferral is wrong`).toBe('NO_PROJECT_PARENT')
    }
  })

  it('keeps the twin entity id polymorphic and unconstrained, which is why it is deferred', () => {
    const m = src('api/db/migrations/046_digital_twin.sql')
    // A text column with no REFERENCES is precisely what makes the parent
    // underivable; if a foreign key is ever added, this deferral must be redone.
    expect(m).toMatch(/entity_id\s+text\s+NOT NULL/)
    expect(m).not.toMatch(/entity_id\s+uuid\s+[^\n]*REFERENCES/i)
  })
})
