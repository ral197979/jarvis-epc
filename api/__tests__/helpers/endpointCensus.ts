/**
 * Denver Engineering — source-derived endpoint census with effective paths
 * ─────────────────────────────────────────────────────────────────────────────
 * ADR-014 Phase 2B-1. The Phase 2A coverage model reads route *declarations*;
 * classifying a read by the information it returns needs the **mounted** path
 * too — `projects.ts GET /` is the organisation-wide registry only because
 * server.ts mounts it at `/api/v1/projects`, and `audit.ts GET /` is the audit
 * trail only because it is mounted at `/api/v1/audit`.
 *
 * Everything here is derived from source. Nothing is hand-maintained, so the
 * census cannot drift away from what the server actually exposes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ENDPOINT_EXCEPTIONS, endpointKey, type RouteClass } from '../../authz/routeManifest'

export interface CensusEndpoint {
  file:       string
  router:     string
  method:     string
  /** The path as declared on the router. */
  path:       string
  /** Mounted path(s). `[]` when the router is never mounted (dead route). */
  effective:  string[]
  /**
   * The capability the route's own guard declares, or `null`. For a
   * `requireAllCapabilities(...)` guard this is the FIRST capability — the two
   * earlier read gates compare against it and their routes all use
   * `requireCapability`, so their meaning is unchanged.
   */
  capability: string | null
  /**
   * The complete requirement. One entry for `requireCapability`, every entry
   * for `requireAllCapabilities`, `null` when unguarded. ADR-014 Phase 2B-3
   * needs the whole conjunction: a dropped capability must be detectable.
   */
  allCapabilities: string[] | null
  key:        string
  /**
   * The handler source, from the route declaration to its closing `})`.
   * ADR-014 Phase 3A needs it to prove record-scope enforcement from SOURCE
   * rather than from a hand-maintained label.
   */
  body:       string
  /**
   * Whether the handler actually calls the canonical record-scope layer.
   * Derived, never declared — a manifest entry claiming record scope without
   * this is a lie the census must catch.
   */
  enforcesRecordScope: boolean
  /**
   * Whether the handler enforces the functional capability through the record
   * scope policy registry rather than through a route-level guard. True only
   * for polymorphic routes whose capability requirement varies per resource.
   */
  enforcesPolicyCapability: boolean
}

/**
 * The canonical record-scope entry points. A handler that calls one of these
 * has had its object scope decided by `api/authz/recordScope.ts`, which is the
 * only place the project-membership rule is implemented.
 */
const RECORD_SCOPE_CALLS = [
  'canAccessProject(',
  // ADR-014 Phase 3B: the COLLECTION form of the same rule. A list endpoint
  // cannot use the batched id filter — it must push the predicate into its own
  // query so COUNT, LIMIT and OFFSET describe the authorized set — so this is
  // the record-scope call a scoped collection makes.
  'projectScopeSql(',
  // ADR-014 Phase 3F: the registry-driven collection predicate. Same rule as
  // `projectScopeSql`, but it reads the resource's `projectSemantics` so a
  // DUAL_PROJECT_OR_TENANT collection keeps its tenant-global rows instead of
  // losing them to a membership test they can never satisfy.
  'collectionScopeSql(',
  // ADR-014 Phase 3H: the polymorphic scope-key guards. `operational_twins` and
  // `realtime_event_log` authorize against a kind plus a free-text id with no
  // foreign key, so the entity the selector names carries the authority — these
  // are the calls that ask it.
  'requireTwinScope(',
  'requirePolymorphicScope(',
  'polymorphicCollectionScopeSql(',
  // ADR-014 Phase 3I: the body-selected polymorphic form, for the AI-governance
  // routes that name their target in the payload.
  'requireBodyPolymorphicScope(',
  // ADR-014 Phase 3K: the same decision reached from a handler rather than
  // from middleware, for `GET /files/download/:token` — the record id lives
  // inside the token, so the guard form cannot be used and the ladder is
  // called directly instead.
  'authorizeRecordScope(',
  // ADR-014 Phase 3L: the caller's reachable project set, for a tenant-wide
  // aggregate with no project in its path (`/safety/trir`).
  'resolveProjectScope(',
  // ADR-014 Phase 3B: the guard form, for a route whose PATH names the project
  // it operates on. Roughly fifty project-child collections share that shape,
  // so the rule is expressed once as middleware rather than as fifty copies of
  // the membership SQL.
  'requireProjectScope(',
  // ADR-014 Phase 3C: the guard form for a route whose path carries only the
  // RECORD id. It resolves the record's parent project through the policy
  // registry and then applies the same membership rule, so a route using it is
  // record-scoped by exactly the same authority as the others here.
  'requireRecordScope(',
  // ADR-014 Phase 3D: the body-selected form — the caller names the target
  // project in the payload, so neither the path nor an existing record can
  // supply it.
  'requireBodyProjectScope(',
  'authorizeSource(',
  'filterAuthorizedTargets(',
  'filterAccessibleProjectIds(',
  'filterByParentProject(',
] as const

/**
 * The subset of those calls that enforce the FUNCTIONAL CAPABILITY too, by
 * reading it from `recordScopePolicies.ts` per resource type.
 *
 * This distinction matters for a polymorphic route. `/related/:source/:id`
 * carries no route-level `requireCapability`, and correctly so: it spans nine
 * resource types across five domains, and no single capability is both safe and
 * useful across them — which is exactly why Phase 2 deferred it. Its capability
 * requirement is per-target and lives in the policy registry, applied by these
 * two functions. A route reaching the record-scope layer through only the
 * scope-only helpers still needs its own guard.
 */
const POLICY_CAPABILITY_CALLS = ['authorizeSource(', 'filterAuthorizedTargets('] as const

const ROUTES_DIR = path.join(process.cwd(), 'api', 'routes')
const SERVER_TS  = path.join(process.cwd(), 'api', 'server.ts')

/** `import x from './routes/y'` / `import { a, b } from './routes/y'` → name → file. */
function routerImports(serverSrc: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of serverSrc.matchAll(/import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+'\.\/routes\/(\w+)'/g)) {
    const file = `${m[3]}.ts`
    if (m[1]) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (name) map.set(name, file)
      }
    } else if (m[2]) {
      map.set(m[2], file)
    }
  }
  return map
}

/** Every `app.use('<prefix>', …, <router>)` mount, in declaration order. */
function mounts(serverSrc: string, imports: Map<string, string>): Array<{ prefix: string; name: string; file: string }> {
  const out: Array<{ prefix: string; name: string; file: string }> = []
  for (const raw of serverSrc.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('app.use(')) continue
    const inner = line.slice('app.use('.length)
    const withPrefix = /^'([^']*)'\s*,\s*(.*)$/.exec(inner)
    const prefix = withPrefix ? withPrefix[1] : ''
    const rest   = withPrefix ? withPrefix[2] : inner
    for (const id of rest.matchAll(/\b(\w+Router)\b/g)) {
      const file = imports.get(id[1])
      if (file) out.push({ prefix, name: id[1], file })
    }
  }
  return out
}

/** Local router variable → the identifier server.ts imports it by. */
function exportedNames(src: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of src.matchAll(/export\s+const\s+(\w+)\s*[:=]/g)) map.set(m[1], m[1])
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const [local, exported] = part.trim().split(/\s+as\s+/)
      if (local?.trim()) map.set(local.trim(), (exported ?? local).trim())
    }
  }
  const def = /export\s+default\s+(\w+)/.exec(src)
  if (def) map.set(def[1], '__default__')
  return map
}

/** One handler's source, declaration through its closing `})` at column 0. */
function handlerBody(src: string, router: string, verb: string, routePath: string): string {
  const esc = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${router}\\s*\\.\\s*${verb}\\s*\\(\\s*'${esc}'[\\s\\S]*?\\n\\}\\)`)
  return re.exec(src)?.[0] ?? ''
}

export function censusWithEffectivePaths(): CensusEndpoint[] {
  const serverSrc = fs.readFileSync(SERVER_TS, 'utf8')
  const imports   = routerImports(serverSrc)
  const allMounts = mounts(serverSrc, imports)

  const out: CensusEndpoint[] = []
  for (const file of fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.ts')).sort()) {
    const src   = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8')
    const names = exportedNames(src)
    const routerWide = /router\s*\.\s*use\s*\(\s*requireCapability\(\s*'([^']+)'/.exec(src)

    // Lookahead on the tail so one declaration never swallows the next.
    const re = /(\w+)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*'([^']*)'\s*,?(?=([\s\S]{0,200}))/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const [, router, verb, routePath] = m
      const tail   = m[4] ?? ''
      const method = verb.toUpperCase()

      // `requireAllCapabilities('a', 'b', …)` — capture the whole argument list
      // so a dropped capability is visible, not just the first one.
      const all = /(?:^\s*|,\s*)requireAllCapabilities\(([^)]*)\)/.exec(tail)
      const allCaps = all
        ? [...all[1].matchAll(/'([^']+)'/g)].map(x => x[1])
        : null

      const inline = /^\s*require(?:Any)?Capability\(\s*'([^']+)'|,\s*require(?:Any)?Capability\(\s*'([^']+)'/.exec(tail)
      const capability = allCaps?.length
        ? allCaps[0]
        : inline ? (inline[1] ?? inline[2]) : (routerWide ? routerWide[1] : null)
      const allCapabilities = allCaps?.length
        ? allCaps
        : capability ? [capability] : null

      const exported = names.get(router)
      const prefixes = allMounts
        .filter(mo => mo.file === file && (exported === '__default__' || exported === undefined || mo.name === exported))
        .map(mo => mo.prefix)

      const body = handlerBody(src, router, verb, routePath)

      out.push({
        file, router, method, path: routePath, capability, allCapabilities,
        key: `${file} ${router}.${method} ${routePath}`,
        effective: [...new Set(prefixes)].map(p => `${p}${routePath}`.replace(/\/+$/, '') || '/'),
        body,
        enforcesRecordScope: RECORD_SCOPE_CALLS.some(c => body.includes(c)),
        enforcesPolicyCapability: POLICY_CAPABILITY_CALLS.some(c => body.includes(c)),
      })
    }
  }
  return out
}

// ─── The single classification engine (ADR-014 Phase 3A §30) ──────────────────
//
// Phase 2C-5 found two census implementations that disagreed: this helper, and
// a private parser inside `authzCoverage.test.ts` that recognised only
// `requireCapability` and therefore reported 23 pending endpoints where the
// canonical model reported 2. Two sources of truth about which endpoints are
// protected is one too many, so classification now lives here and
// `authzCoverage.test.ts` consumes it.

export interface ClassifiedEndpoint extends CensusEndpoint {
  klass: RouteClass
}

/**
 * The class of one endpoint, derived from source and the deliberate-exception
 * manifest. Nothing here is hand-maintained per endpoint except the exceptions,
 * which carry their own reasons and are checked for staleness.
 *
 * `CAPABILITY_RECORD_SCOPE` is derived, not declared: an endpoint earns it by
 * having BOTH a capability guard AND a call into the canonical record-scope
 * layer. Labelling a route record-scoped without enforcing it cannot pass.
 */
export function classifyEndpoint(e: CensusEndpoint): RouteClass {
  const exception = ENDPOINT_EXCEPTIONS[endpointKey(e.file, e.router, e.method, e.path)]
  if (exception) return exception.klass

  if (e.capability) {
    // A route-level guard supplies the functional half; record scope, if the
    // handler enforces it, supplies the object half.
    return e.enforcesRecordScope ? 'CAPABILITY_RECORD_SCOPE' : 'CAPABILITY'
  }

  // No route-level guard. This is only acceptable when BOTH halves come from
  // the policy registry — a per-resource capability AND a per-record scope,
  // applied by `authorizeSource` / `filterAuthorizedTargets`. Anything else
  // with no guard is Phase-2 debt, exactly as before.
  if (e.enforcesRecordScope && e.enforcesPolicyCapability) return 'CAPABILITY_RECORD_SCOPE'
  return 'PENDING_PHASE2'
}

/** The whole census, classified. The one entry point every gate should use. */
export function classifiedCensus(): ClassifiedEndpoint[] {
  return censusWithEffectivePaths().map(e => ({ ...e, klass: classifyEndpoint(e) }))
}

/** Every class the model may assign, for exhaustive-sum assertions. */
export const ALL_ROUTE_CLASSES: readonly RouteClass[] = [
  'CAPABILITY',
  'CAPABILITY_RECORD_SCOPE',
  'PUBLIC',
  'SERVICE_HMAC',
  'SERVICE_TOKEN',
  'HYBRID_SERVICE_CAPABILITY',
  'UNMOUNTED',
  'PENDING_PHASE2',
]
