/**
 * ADR-014 Phase 2A-2 — status-write transition ratchet.
 *
 * The Phase 2A ratchet asked "does this route path name a consequential verb?".
 * That question cannot see `PATCH /punch-items/:id  { status: 'closed' }`, which
 * reaches exactly the state `POST /punch-items/:id/close` exists to guard. Ten
 * such paths were in production when Phase 2A was declared complete.
 *
 * This file adds the second question — "can any generic mutation write a state a
 * consequential transition owns?" — and holds it closed:
 *
 *   1. every generic state writer is explicitly classified;
 *   2. transition-owned ∩ ordinary = ∅ for every entity;
 *   3. every declared generic writer actually carries the guard;
 *   4. every transition-owned value names a real registered transition, with the
 *      capability that transition really requires;
 *   5. no state policy is orphaned and no state is owned twice.
 *
 * The negative controls at the bottom prove the detector fails on the class it
 * exists to catch, rather than passing vacuously.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { endpointKey } from '../authz/routeManifest'
import { ENFORCED_TRANSITIONS } from '../authz/transitions'
import {
  STATE_POLICIES, RESERVED_TRANSITION_FIELDS, ORDINARY_STATE_WRITERS,
  transitionOwnedViolation, guardTransitionOwnedState,
  type StatePolicy, type TransitionOwnedState,
} from '../authz/transitionStates'
import { isServerCapability } from '../authz/capabilities'

const ROUTES_DIR = path.join(process.cwd(), 'api', 'routes')

/** Field names that carry workflow state, whatever the entity calls them. */
const STATE_FIELD = /^(status|state|stage|phase|decision|approval_status|review_status|lifecycle_status|verified)$/

interface RouteBody {
  file: string; router: string; method: string; path: string; key: string
  /** Source text of this handler, up to the next route declaration. */
  body: string
  /** Middleware text between the path literal and the handler. */
  head: string
}

/** Every non-GET route declaration, with its handler source. */
function mutationHandlers(): RouteBody[] {
  const out: RouteBody[] = []
  for (const file of fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.ts')).sort()) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8')
    const re = /(\w+)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*'([^']*)'/g
    const decls: { router: string; method: string; path: string; idx: number; after: number }[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      decls.push({ router: m[1], method: m[2].toUpperCase(), path: m[3], idx: m.index, after: re.lastIndex })
    }
    for (let i = 0; i < decls.length; i++) {
      const d = decls[i]
      if (d.method === 'GET') continue
      const end = i + 1 < decls.length ? decls[i + 1].idx : src.length
      out.push({
        file, router: d.router, method: d.method, path: d.path,
        key: endpointKey(file, d.router, d.method, d.path),
        body: src.slice(d.idx, end),
        head: src.slice(d.after, Math.min(end, d.after + 160)),
      })
    }
  }
  return out
}

/**
 * Does this handler write a workflow-state field from the request body?
 *
 * Textual, because that is what a ratchet can check without running the app.
 * It reads the three shapes Denver's routes actually use — an allow-list array,
 * a `b.status`-style property read, and a destructure/cast off the body — and it
 * is deliberately generous: a false positive costs one classification entry,
 * a false negative is the defect this file exists to prevent.
 */
function writesStateFromBody(body: string): string[] {
  const hits = new Set<string>()
  for (const a of body.matchAll(/(?:allowed|fields)\s*(?::[^=]*)?=\s*\[([^\]]*)\]/g)) {
    for (const q of a[1].matchAll(/'([^']+)'/g)) if (STATE_FIELD.test(q[1])) hits.add(q[1])
  }
  for (const q of body.matchAll(/\b(?:req\.body|body|b)\s*\.\s*(\w+)/g)) if (STATE_FIELD.test(q[1])) hits.add(q[1])
  for (const q of body.matchAll(/\bbody\s*\[\s*'(\w+)'\s*\]/g)) if (STATE_FIELD.test(q[1])) hits.add(q[1])
  for (const d of body.matchAll(/\{([^}]*)\}\s*=\s*req\.body|req\.body\s+as\s*\{([^}]*)\}/g)) {
    for (const q of (d[1] ?? d[2] ?? '').matchAll(/(\w+)/g)) if (STATE_FIELD.test(q[1])) hits.add(q[1])
  }
  return [...hits]
}

/**
 * Does this handler hard-code a workflow state into an UPDATE/INSERT?
 *
 * The third detector, and the one that would have caught `POST /submittals/:id/review`
 * and `PATCH /pay-applications/:id`: a dedicated action route writes its state as
 * a literal, not from the body, so the body-field detector cannot see it — and
 * neither could the path-verb ratchet, because `review` was not in its verb list.
 * Matching on the SET clause deliberately excludes `WHERE status NOT IN (...)`
 * guards, which read state rather than writing it.
 */
function writesStateLiteral(body: string): string[] {
  const out = new Set<string>()
  for (const set of body.matchAll(/\bSET\b([\s\S]{0,400}?)(?:\bWHERE\b|\bRETURNING\b|`)/gi)) {
    for (const q of set[1].matchAll(/\b(status|state|stage|phase|decision)\s*=\s*'([a-z_]+)'/gi)) out.add(q[2])
  }
  return [...out]
}

/**
 * Literal state writers reviewed and found not to be consequential transitions.
 *
 * Kept in the test rather than the runtime registry because nothing enforces
 * them at request time — they are a review record, and the ratchet's job is to
 * make sure a new one cannot appear without someone making this judgement.
 */
const LITERAL_STATE_REVIEWED = new Set<string>([
  // Answering an RFI stamps response_by/responded_at, but it supplies information
  // rather than deciding an outcome — the same reasoning by which the transition
  // registry classifies `submit` as a write, not an approval. Ordinary
  // construction write; its authorization lands in Phase 2C-1.
  'procurement.ts rfisRouter.POST /:id/respond',
  // Upload/ingest pipeline states written by the server on its own behalf.
  'files.ts router.POST /confirm/:versionId',
  'files.ts router.DELETE /documents/:id',
  'knowledge.ts router.POST /sources/:id/reingest',
  'runbooks.ts runbooksRouter.POST /',
])

const handlers = mutationHandlers()
const transitionKeys = new Set(ENFORCED_TRANSITIONS.map(t => endpointKey(t.file, t.router, t.method, t.path)))
const guardedGeneric = new Set(
  STATE_POLICIES.flatMap(p => p.genericEndpoints).concat(RESERVED_TRANSITION_FIELDS.flatMap(p => p.genericEndpoints)),
)
const ordinaryWriters = new Map(ORDINARY_STATE_WRITERS.map(w => [w.endpoint, w]))

/** Generic state writers: textual hits plus everything a policy declares. */
const stateWriters = [
  ...new Set([
    ...handlers.filter(h => writesStateFromBody(h.body).length).map(h => h.key),
    ...guardedGeneric,
  ]),
].sort()

/** Endpoints that drive a state by writing a literal rather than echoing the body. */
const literalStateWriters = handlers.filter(h => writesStateLiteral(h.body).length).map(h => h.key).sort()

// ─── 1. Status-write inventory is complete and classified ────────────────────
describe('status-write inventory', () => {
  it('finds state-writing mutation endpoints across the API surface', () => {
    expect(stateWriters.length).toBeGreaterThan(20)
  })

  it('classifies every generic state writer explicitly', () => {
    // The invariant that would have caught all ten findings: a mutation that can
    // write a workflow state is either the canonical transition itself, a generic
    // route restricted by the state registry, or a reviewed ordinary writer.
    const unclassified = stateWriters.filter(k =>
      !transitionKeys.has(k) && !guardedGeneric.has(k) && !ordinaryWriters.has(k))
    expect(unclassified,
      'unclassified state-writing mutations — restrict them in api/authz/transitionStates.ts ' +
      `or record why their states are ordinary:\n  ${unclassified.join('\n  ')}`).toEqual([])
  })

  it('classifies every endpoint that drives a state by literal', () => {
    // Catches the dedicated action route whose path names no consequential verb —
    // how `/submittals/:id/review` and `PATCH /pay-applications/:id` stayed
    // invisible to Phase 2A despite deciding a submittal and a payment.
    const unclassified = literalStateWriters.filter(k =>
      !transitionKeys.has(k) && !guardedGeneric.has(k) && !ordinaryWriters.has(k) &&
      !LITERAL_STATE_REVIEWED.has(k))
    expect(unclassified,
      'endpoints that write a workflow state as a literal and are neither registered transitions ' +
      `nor reviewed ordinary writes:\n  ${unclassified.join('\n  ')}`).toEqual([])
  })

  it('holds no stale ordinary-writer classifications', () => {
    const real = new Set(handlers.map(h => h.key))
    const stale = ORDINARY_STATE_WRITERS.filter(w => !real.has(w.endpoint)).map(w => w.endpoint)
    expect(stale, `classifications naming endpoints that no longer exist: ${stale.join(', ')}`).toEqual([])
  })

  it('requires a substantive reason for every ordinary classification', () => {
    for (const w of ORDINARY_STATE_WRITERS) {
      expect(w.reason.length, `${w.endpoint} needs a reason`).toBeGreaterThan(20)
    }
  })
})

// ─── 2. The state-intersection invariant ─────────────────────────────────────
describe('transition-owned state intersection', () => {
  it('never lets a generic route write a transition-owned value', () => {
    const conflicts: string[] = []
    for (const p of STATE_POLICIES) {
      const owned = new Set(p.transitionOwned.map(t => t.value))
      for (const v of p.ordinary) {
        if (owned.has(v)) conflicts.push(`${p.entity}.${p.field}: '${v}' is both ordinary and transition-owned`)
      }
    }
    expect(conflicts, conflicts.join('\n  ')).toEqual([])
  })

  it('guards every generic endpoint a state policy names', () => {
    const byKey = new Map(handlers.map(h => [h.key, h]))
    const problems: string[] = []
    for (const key of guardedGeneric) {
      const h = byKey.get(key)
      if (!h) { problems.push(`${key}: no such mutation endpoint in source`); continue }
      if (!/guardTransitionOwnedState\(/.test(h.head)) {
        problems.push(`${key}: declared as a restricted generic writer but carries no guardTransitionOwnedState`)
      }
    }
    expect(problems, `state-guard gaps:\n  ${problems.join('\n  ')}`).toEqual([])
  })

  it('leaves no state both ordinary and reserved on the same entity', () => {
    const problems: string[] = []
    for (const r of RESERVED_TRANSITION_FIELDS) {
      for (const p of STATE_POLICIES.filter(s => s.entity === r.entity)) {
        for (const f of r.fields) {
          if (p.bodyKeys.includes(f)) problems.push(`${r.entity}: '${f}' is both a state field and a reserved field`)
        }
      }
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })
})

// ─── 3. Registry consistency — no drift between the two registries ───────────
describe('state policy / transition registry consistency', () => {
  const transitionByPath = new Map(ENFORCED_TRANSITIONS.map(t => [`${t.method} ${t.path}`, t]))

  it('points every transition-owned value at a real registered transition', () => {
    const problems: string[] = []
    const check = (label: string, canonical: string, capability: string) => {
      const t = transitionByPath.get(canonical)
      if (!t) { problems.push(`${label}: canonical '${canonical}' is not a registered transition`); return }
      if (t.capability !== capability) {
        problems.push(`${label}: policy says ${capability}, transition registry says ${t.capability}`)
      }
    }
    for (const p of STATE_POLICIES) {
      for (const t of p.transitionOwned) check(`${p.entity}.${p.field}='${t.value}'`, t.canonical, t.capability)
    }
    for (const r of RESERVED_TRANSITION_FIELDS) check(`${r.entity} reserved fields`, r.canonical, r.capability)
    expect(problems, `stale state policies:\n  ${problems.join('\n  ')}`).toEqual([])
  })

  it('declares a registered capability for every policy', () => {
    for (const p of STATE_POLICIES) {
      for (const t of p.transitionOwned) {
        expect(isServerCapability(t.capability), `${p.entity}: unknown capability ${t.capability}`).toBe(true)
      }
    }
  })

  it('lets exactly one policy own each state', () => {
    const seen = new Map<string, number>()
    for (const p of STATE_POLICIES) {
      for (const t of p.transitionOwned) {
        const k = `${p.entity}.${p.field}='${t.value}'`
        seen.set(k, (seen.get(k) ?? 0) + 1)
      }
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
    expect(dupes, `duplicate state ownership: ${dupes.join(', ')}`).toEqual([])
  })

  it('classifies every value the entity enum admits', () => {
    // No terminal state may sit outside both lists — that is how NCR closure,
    // CAPA verification and turnover acceptance stayed invisible to Phase 2A.
    for (const p of STATE_POLICIES) {
      expect(p.ordinary.length + p.transitionOwned.length,
        `${p.entity}.${p.field} classifies no states`).toBeGreaterThan(0)
      expect(p.note.length, `${p.entity}.${p.field} needs a classification rationale`).toBeGreaterThan(40)
    }
  })
})

// ─── 4. Runtime behaviour of the guard ───────────────────────────────────────
describe('guardTransitionOwnedState', () => {
  const run = (entity: string, body: unknown) => {
    const res = { code: 0, payload: null as unknown }
    const fake = {
      status(c: number) { res.code = c; return this },
      json(p: unknown) { res.payload = p; return this },
    }
    let nexted = false
    guardTransitionOwnedState(entity)({ body } as never, fake as never, (() => { nexted = true }) as never)
    return { ...res, nexted }
  }

  it('rejects a transition-owned status before the handler runs', () => {
    const r = run('punch_items', { status: 'closed' })
    expect(r.nexted).toBe(false)
    expect(r.code).toBe(422)
    expect(r.payload).toMatchObject({ error: 'transition_state_not_writable', canonical: 'POST /punch-items/:id/close' })
  })

  it('admits an ordinary status', () => {
    expect(run('punch_items', { status: 'in_progress' }).nexted).toBe(true)
  })

  it('admits a mutation that names no state at all', () => {
    expect(run('punch_items', { title: 'Cracked weld at grid E4' }).nexted).toBe(true)
  })

  it('rejects reserved completion evidence even without a status', () => {
    const r = run('inspections', { signatures: [{ by: 'someone' }] })
    expect(r.nexted).toBe(false)
    expect(r.code).toBe(422)
    expect(r.payload).toMatchObject({ field: 'signatures', canonical: 'POST /inspections/:id/complete' })
  })

  it('is role-blind — the rejection is a property of the request', () => {
    // No principal is supplied at all, and the answer is still a refusal. The
    // canonical route owns the authorization question; this owns the shape.
    expect(run('purchase_orders', { status: 'approved' }).code).toBe(422)
  })

  it('refuses to guard an entity with no policy', () => {
    expect(() => guardTransitionOwnedState('not_an_entity')).toThrow(/no transition-state policy/)
  })

  it('ignores a null or absent body', () => {
    expect(transitionOwnedViolation('punch_items', null)).toBeNull()
    expect(transitionOwnedViolation('punch_items', undefined)).toBeNull()
  })

  it('compares by value, not by truthiness', () => {
    // `status: 'closed_out'` is not `closed`; a substring match would over-block.
    expect(transitionOwnedViolation('punch_items', { status: 'closed_out' })).toBeNull()
  })
})

// ─── 5. Negative controls — the detector fails on the class it must catch ────
describe('negative controls', () => {
  /** Re-run the intersection invariant over an arbitrary policy set. */
  function intersectionConflicts(policies: readonly StatePolicy[]): string[] {
    const out: string[] = []
    for (const p of policies) {
      const owned = new Set(p.transitionOwned.map(t => t.value))
      for (const v of p.ordinary) if (owned.has(v)) out.push(`${p.entity}.${p.field}: '${v}'`)
    }
    return out
  }

  /** Re-run the canonical-transition check over an arbitrary policy set. */
  function stalePolicies(owned: readonly { canonical: string; capability: string }[]): string[] {
    const byPath = new Map(ENFORCED_TRANSITIONS.map(t => [`${t.method} ${t.path}`, t]))
    return owned.flatMap(o => {
      const t = byPath.get(o.canonical)
      if (!t) return [`${o.canonical}: not a registered transition`]
      if (t.capability !== o.capability) return [`${o.canonical}: ${o.capability} ≠ ${t.capability}`]
      return []
    })
  }

  it('§22 fails when a generic route may write an existing transition state', () => {
    // The original class: a probe endpoint that writes `closed`, a value the
    // registered /close transition owns.
    const probe: StatePolicy = {
      entity: 'probe_items', field: 'status', bodyKeys: ['status'],
      transitionOwned: [{ value: 'closed', canonical: 'POST /punch-items/:id/close', capability: 'quality.verify' }],
      ordinary: ['open', 'closed'],   // ← the bypass
      genericEndpoints: [], note: 'fixture',
    }
    const conflicts = intersectionConflicts([probe])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toContain("probe_items.status: 'closed'")
  })

  it('§23 fails on a new terminal value a generic route may write', () => {
    const probe: StatePolicy = {
      entity: 'probe_packages', field: 'status', bodyKeys: ['status'],
      transitionOwned: [{ value: 'accepted', canonical: 'POST /turnover-packages/:id/accept', capability: 'commissioning.approve' }],
      ordinary: ['open', 'accepted'],  // ← the regression
      genericEndpoints: [], note: 'fixture',
    }
    expect(intersectionConflicts([probe])[0]).toContain("'accepted'")
  })

  it('§24 fails when a consequential state has no registered transition', () => {
    // What would have caught the five Class B findings: a terminal state whose
    // canonical route does not exist in the transition registry.
    const stale = stalePolicies([{ canonical: 'POST /subcontracts/:id/terminate', capability: 'procurement.approve' }])
    expect(stale).toHaveLength(1)
    expect(stale[0]).toContain('not a registered transition')
  })

  it('§25 fails when a transition capability is downgraded', () => {
    // The registry requires the consequence-specific capability; a policy that
    // claims the ordinary write capability for the same route is a downgrade.
    const stale = stalePolicies([{ canonical: 'POST /punch-items/:id/close', capability: 'quality.write' }])
    expect(stale).toHaveLength(1)
    expect(stale[0]).toContain('quality.write ≠ quality.verify')
  })

  it('detects a generic writer that carries no guard', () => {
    const byKey = new Map(handlers.map(h => [h.key, h]))
    // A real, unguarded ordinary state writer stands in for a future regression.
    const unguarded = ORDINARY_STATE_WRITERS.find(w => byKey.has(w.endpoint))
    expect(unguarded, 'expected at least one classified ordinary writer to exist').toBeDefined()
    expect(/guardTransitionOwnedState\(/.test(byKey.get(unguarded!.endpoint)!.head)).toBe(false)
  })

  it('the state-field pattern sees more than a column literally named status', () => {
    for (const f of ['status', 'state', 'stage', 'phase', 'decision', 'approval_status', 'review_status', 'verified']) {
      expect(STATE_FIELD.test(f), `${f} should be treated as workflow state`).toBe(true)
    }
    expect(STATE_FIELD.test('title')).toBe(false)
  })
})

// ─── 6. Phase 2A-2 completeness ──────────────────────────────────────────────
describe('Phase 2A-2 completeness', () => {
  it('closes every one of the ten reported findings', () => {
    // Named explicitly so a future edit that reopens one fails by name rather
    // than by an arithmetic drift nobody reads.
    const closed: [string, string, string][] = [
      ['punch_items',        'status', 'closed'],
      ['inspections',        'status', 'completed'],
      ['purchase_orders',    'status', 'approved'],
      ['risks',              'status', 'closed'],
      ['daily_logs',         'status', 'approved'],
      ['ncrs',               'status', 'closed'],
      ['corrective_actions', 'status', 'verified'],
      ['turnover_packages',  'status', 'accepted'],
    ]
    for (const [entity, field, value] of closed) {
      const p = STATE_POLICIES.find(s => s.entity === entity && s.field === field)
      expect(p, `${entity}.${field} has no state policy`).toBeDefined()
      expect(p!.transitionOwned.map(t => t.value), `${entity}.${field} must own '${value}'`).toContain(value)
      expect(transitionOwnedViolation(entity, { [field]: value })).not.toBeNull()
    }
  })

  it('protects the two endpoint-level lifecycle transitions', () => {
    for (const p of ['/subcontracts/:id/status', '/projects/:projectId/gates/:gateKey', '/projects/:projectId/advance']) {
      const t = ENFORCED_TRANSITIONS.find(x => x.path === p)
      expect(t, `${p} is not registered as a transition`).toBeDefined()
      expect(['procurement.approve', 'project.approve']).toContain(t!.capability)
    }
  })

  it('reports a transition-owned state for every entity it guards', () => {
    const owned: TransitionOwnedState[] = STATE_POLICIES.flatMap(p => [...p.transitionOwned])
    expect(owned.length).toBeGreaterThanOrEqual(11)
  })
})
