#!/usr/bin/env node
/**
 * ADR-014 — machine-derived endpoint inventory (HOB §5 first hard gate, §9).
 *
 * Parses checked-in SOURCE ONLY (api/server.ts mounts + api/routes/*.ts route
 * declarations). It never imports the app, never starts a server, never reads a
 * database. Output is a deterministic JSON document, sorted, suitable for
 * diffing across commits.
 *
 * WHAT THIS EXTRACTS (facts):
 *   - every Express route declaration: method, router-relative path, mounted
 *     full path, source file, line
 *   - the guard middleware in force: router-level `.use(...)` + per-route
 *     inline middleware, and mount-level middleware from server.ts
 *   - the path parameters of each route
 *
 * WHAT IT DOES NOT DO: classify. Classification lives in classify-scope.mjs so
 * that the raw extraction stays auditable and policy-free.
 *
 * LIMITS (stated, not hidden):
 *   - Only routers reachable from a literal `app.use(...)` in api/server.ts are
 *     mounted; routers mounted dynamically or not mounted at all are emitted
 *     with mounted=false so they are visible rather than silently dropped.
 *   - Only string-literal route paths are extracted. Computed paths are
 *     reported in `anomalies`.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT       = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SERVER_TS  = join(ROOT, 'api', 'server.ts')
const ROUTES_DIR = join(ROOT, 'api', 'routes')

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']
const anomalies = []

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Length-preserving source scan. Returns two views, each EXACTLY as long as the
 * input, so an index found in one addresses the same character in the other:
 *
 *   noComments  comment bodies blanked; string/template/regex CONTENT intact.
 *               Route path literals, guard tokens and `requireRole` lists are
 *               read from this view.
 *   skeleton    comments blanked AND every literal's CONTENT blanked, leaving
 *               only code structure. Paren matching runs here.
 *
 * Why two views: the previous single-view scanner matched parens over source in
 * which a literal could still contain a quote. A `'` inside a template literal
 * — `current_setting('app.current_tenant_id',true)` in scim.ts — desynchronised
 * the scan, `matchParen` ran off the end of the file, and the enclosing route
 * was dropped with no anomaly. That silently removed PATCH /Users/:id from the
 * inventory. Blanking literal CONTENT (keeping the delimiters, and keeping
 * every offset) makes that whole defect class impossible.
 */
function scanSource (src) {
  const n  = src.length
  const nc = new Array(n)
  const sk = new Array(n)
  const blank = ch => (ch === '\n' ? '\n' : ' ')
  const keepBoth   = i => { nc[i] = src[i]; sk[i] = src[i] }
  const blankBoth  = i => { nc[i] = blank(src[i]); sk[i] = nc[i] }
  const keepNcOnly = i => { nc[i] = src[i]; sk[i] = blank(src[i]) }

  // Last significant code character, to tell a regex literal from a division.
  let prev = ''
  let i = 0
  while (i < n) {
    const c = src[i], d = src[i + 1]

    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { blankBoth(i); i++ }
      continue
    }
    if (c === '/' && d === '*') {
      blankBoth(i); blankBoth(i + 1); i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { blankBoth(i); i++ }
      if (i < n) { blankBoth(i); blankBoth(i + 1); i += 2 }
      continue
    }
    if (c === "'" || c === '"') {
      keepBoth(i); i++
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { keepNcOnly(i); i++; if (i < n) { keepNcOnly(i); i++ } continue }
        keepNcOnly(i); i++
      }
      if (i < n) { keepBoth(i); i++ }
      prev = 'x'
      continue
    }
    if (c === '`') {
      // Blank the whole template, interpolations included. Any parens inside a
      // `${...}` are balanced, so removing them wholesale leaves the enclosing
      // paren match correct.
      keepBoth(i); i++
      let depth = 0
      while (i < n) {
        if (src[i] === '\\') { keepNcOnly(i); i++; if (i < n) { keepNcOnly(i); i++ } continue }
        if (src[i] === '$' && src[i + 1] === '{') { depth++; keepNcOnly(i); i++; keepNcOnly(i); i++; continue }
        if (depth > 0 && src[i] === '}') { depth--; keepNcOnly(i); i++; continue }
        if (depth === 0 && src[i] === '`') break
        keepNcOnly(i); i++
      }
      if (i < n) { keepBoth(i); i++ }
      prev = 'x'
      continue
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%~^<>]/.test(prev)) {
      // Regex literal. Content blanked in the skeleton; a `(` inside a character
      // class must not reach the paren matcher.
      keepBoth(i); i++
      let inClass = false
      while (i < n) {
        if (src[i] === '\\') { keepNcOnly(i); i++; if (i < n) { keepNcOnly(i); i++ } continue }
        if (src[i] === '[') inClass = true
        else if (src[i] === ']') inClass = false
        else if (src[i] === '/' && !inClass) break
        else if (src[i] === '\n') break
        keepNcOnly(i); i++
      }
      if (i < n && src[i] === '/') { keepBoth(i); i++ }
      while (i < n && /[a-z]/.test(src[i])) { keepBoth(i); i++ }   // flags
      prev = 'x'
      continue
    }
    keepBoth(i)
    if (!/\s/.test(c)) prev = c
    i++
  }
  return { noComments: nc.join(''), skeleton: sk.join('') }
}

/** Comments blanked, literals intact. Kept as a named helper for readability. */
function stripComments (src) { return scanSource(src).noComments }

/**
 * Given the index of an opening '(', return the index just past its matching
 * ')'. `src` MUST be a skeleton view from `scanSource` — literal content is
 * already blanked there, so this needs no quote handling of its own.
 */
function matchParen (src, open) {
  let depth = 0, i = open, n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return i + 1 }
    i++
  }
  return -1
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length

/** Direct guard tokens in a fragment (no alias resolution). */
function directGuardsIn (fragment) {
  const found = new Set()
  const re = /\b(requireAuth|requireTenant|requireRole|requireCsrf|requireServiceToken|requireScimAuth|requirePlatformAdmin|authenticate|agentLimiter|authLimiter|globalLimiter|idempotency|validateUuidParams|validateUuidQueryParams|agentMode|rateLimit)\b/g
  let m
  while ((m = re.exec(fragment))) found.add(m[1])
  // requireRole('a','b') — capture the role list, it is authorization-relevant
  const rr = /requireRole\s*\(([^)]*)\)/g
  while ((m = rr.exec(fragment))) {
    const roles = [...m[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map(x => x[1])
    if (roles.length) found.add(`requireRole(${roles.join('|')})`)
  }
  return [...found].sort()
}

/**
 * Guards reached INDIRECTLY, via a local alias or middleware-factory helper:
 *   const auth = requireAuth as never                 -> auth
 *   function _authMiddleware() { return [requireAuth, requireTenant()] }
 * Missing these reports a guarded route as unguarded, which is a false finding
 * in the exact direction that matters, so they are resolved rather than ignored.
 */
function buildAliasMap (src, skel) {
  const defs = new Map()   // name -> definition text
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([^\n;]+)/g)) {
    defs.set(m[1], m[2])
  }
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const open = src.indexOf('(', m.index)
    const afterParams = matchParen(skel, open)
    const bodyOpen = src.indexOf('{', afterParams)
    if (bodyOpen < 0) continue
    let depth = 0, i = bodyOpen
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (!depth) break }
    }
    defs.set(m[1], src.slice(bodyOpen, i + 1))
  }
  const alias = new Map()
  for (const [name, body] of defs) {
    const g = directGuardsIn(body)
    if (g.length) alias.set(name, new Set(g))
  }
  // one more pass so an alias-of-an-alias resolves
  for (const [name, body] of defs) {
    const acc = new Set(alias.get(name) ?? [])
    for (const ref of body.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      if (ref[1] !== name && alias.has(ref[1])) for (const x of alias.get(ref[1])) acc.add(x)
    }
    if (acc.size) alias.set(name, acc)
  }
  return alias
}

/**
 * Capability requirements declared in a fragment. ADR-014 Phase 2 expresses the
 * FUNCTIONAL half of authorization through these, and the original extractor
 * did not look for them at all — which is why its pre-Phase-2 run reported 710
 * endpoints as "authenticate only". Detecting them here is what lets the
 * inventory be joined to the canonical endpoint census.
 */
function capabilitiesIn (fragment) {
  const found = new Set()
  for (const m of fragment.matchAll(/\brequire(?:All|Any)?Capabilit(?:y|ies)\s*\(([^)]*)\)/g)) {
    for (const lit of m[1].matchAll(/['"`]([^'"`]+)['"`]/g)) found.add(lit[1])
  }
  return [...found].sort()
}

/**
 * The canonical record-scope entry points, mirrored from
 * `api/__tests__/helpers/endpointCensus.ts`. A handler calling one of these has
 * had its object scope decided by `api/authz/recordScope.ts`. Kept as a literal
 * list so the extractor never has to import product code.
 */
const RECORD_SCOPE_CALLS = [
  'canAccessProject(', 'projectScopeSql(', 'requireProjectScope(',
  'authorizeSource(', 'filterAuthorizedTargets(', 'filterAccessibleProjectIds(',
  'filterByParentProject(',
]
const recordScopeCallsIn = fragment =>
  RECORD_SCOPE_CALLS.filter(c => fragment.includes(c)).map(c => c.slice(0, -1)).sort()

/** Direct guards ∪ guards reached through local aliases referenced in the fragment. */
function guardsWith (fragment, alias) {
  const found = new Set(directGuardsIn(fragment))
  if (alias) {
    for (const m of fragment.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      if (alias.has(m[1])) for (const g of alias.get(m[1])) found.add(g)
    }
  }
  return [...found].sort()
}

// ── 1. server.ts: imports + mounts ───────────────────────────────────────────

const serverRaw  = readFileSync(SERVER_TS, 'utf8')
const serverScan = scanSource(serverRaw)
const serverSrc  = serverScan.noComments
const serverSkel = serverScan.skeleton
const serverAlias = buildAliasMap(serverSrc, serverSkel)

/** local identifier -> { spec, kind: 'default'|'named', exportName } */
const importMap = new Map()
for (const m of serverSrc.matchAll(/import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
  const clause = m[1], spec = m[2]
  const named = clause.match(/\{([^}]*)\}/)
  if (named) {
    for (const part of named[1].split(',')) {
      const t = part.trim()
      if (!t) continue
      const as = t.split(/\s+as\s+/)
      const exportName = as[0].trim()
      const local = (as[1] ?? as[0]).trim()
      if (local) importMap.set(local, { spec, kind: 'named', exportName })
    }
  }
  const def = clause.replace(/\{[^}]*\}/g, '').replace(/,/g, ' ').trim().split(/\s+/)[0]
  if (def) importMap.set(def, { spec, kind: 'default', exportName: 'default' })
}

/** mounts: [{prefix, routerId, module, mountGuards, line}] */
const mounts = []
for (const m of serverSrc.matchAll(/\bapp\.use\s*\(/g)) {
  const open = m.index + m[0].length - 1
  const close = matchParen(serverSkel, open)
  if (close < 0) {
    anomalies.push({ file: 'api/server.ts', line: lineOf(serverRaw, m.index), reason: 'unbalanced app.use(...) — mount not parsed' })
    continue
  }
  const args = serverSrc.slice(open + 1, close - 1)
  const routerIds = [...args.matchAll(/\b([A-Za-z_$][\w$]*Router)\b/g)].map(x => x[1])
  if (!routerIds.length) continue
  const prefixMatch = args.match(/^\s*['"`]([^'"`]*)['"`]/)
  const prefix = prefixMatch ? prefixMatch[1] : ''
  const mountGuards = guardsWith(args, serverAlias)
  for (const routerId of routerIds) {
    mounts.push({
      prefix,
      routerId,
      module: importMap.get(routerId)?.spec ?? null,
      importKind: importMap.get(routerId)?.kind ?? null,
      exportName: importMap.get(routerId)?.exportName ?? null,
      mountGuards,
      serverLine: lineOf(serverRaw, m.index),
    })
  }
}

// ── 2. route modules: router vars, router-level guards, route declarations ───

/** module specifier './routes/x' -> absolute file */
function moduleToFile (spec) {
  if (!spec) return null
  const rel = spec.replace(/^\.\//, '')
  const p = join(ROOT, 'api', rel + '.ts')
  try { readFileSync(p); return p } catch { return null }
}

const fileCache = new Map()
function parseRouteFile (file) {
  if (fileCache.has(file)) return fileCache.get(file)
  const raw  = readFileSync(file, 'utf8')
  const scan = scanSource(raw)
  const src  = scan.noComments
  const skel = scan.skeleton
  const alias = buildAliasMap(src, skel)

  // router variables: `const x = Router()` / `export const x = Router()`
  const routerVars = new Set()
  const exportedRouters = new Map()   // exported name -> var name
  for (const m of src.matchAll(/\b(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:express\.)?Router\s*\(/g)) {
    routerVars.add(m[2])
    if (m[1]) exportedRouters.set(m[2], m[2])
  }
  if (!routerVars.size) routerVars.add('router')
  // `export { router as fooRouter }`
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const as = part.trim().split(/\s+as\s+/)
      const local = as[0]?.trim(), exported = (as[1] ?? as[0])?.trim()
      if (local && exported && routerVars.has(local)) exportedRouters.set(exported, local)
    }
  }
  // `export default router`
  let defaultVar = null
  const dm = src.match(/export\s+default\s+([A-Za-z_$][\w$]*)/)
  if (dm && routerVars.has(dm[1])) defaultVar = dm[1]

  // router-level guards, per router var, including path-scoped `.use('/p', mw)`
  const routerGuards = new Map()   // var -> Set(guard)
  const scopedGuards = []          // {var, path, guards}
  // Intra-file sub-router mounts: `iotRouter.use('/', authRouter)`. Without
  // these, every route declared on a router that server.ts does not import
  // directly is invisible — which silently dropped all eight authenticated
  // iot.ts endpoints from the inventory (ADR-014 Phase 3C).
  const subMounts = []             // {parent, path, child, guards}
  const routerCaps = new Map()     // var -> Set(capability)
  for (const v of routerVars) {
    routerGuards.set(v, new Set())
    routerCaps.set(v, new Set())
    const useRe = new RegExp(`\\b${v}\\.use\\s*\\(`, 'g')
    let m
    while ((m = useRe.exec(src))) {
      const open = m.index + m[0].length - 1
      const close = matchParen(skel, open)
      if (close < 0) {
        anomalies.push({ file: file.replace(ROOT + '/', ''), line: lineOf(raw, m.index), reason: `unbalanced ${v}.use(...) — router-level guards not parsed` })
        continue
      }
      const args = src.slice(open + 1, close - 1)
      const pathLit = args.match(/^\s*['"`]([^'"`]*)['"`]/)
      const g = guardsWith(args, alias)
      const childRef = [...args.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)]
        .map(x => x[1]).find(name => name !== v && routerVars.has(name))
      if (childRef) {
        subMounts.push({ parent: v, path: pathLit ? pathLit[1] : '', child: childRef, guards: g })
        continue
      }
      const caps = capabilitiesIn(args)
      if (pathLit) scopedGuards.push({ var: v, path: pathLit[1], guards: g, caps })
      else {
        for (const x of g) routerGuards.get(v).add(x)
        for (const c of caps) routerCaps.get(v).add(c)
      }
    }
  }

  // route declarations
  const routes = []
  for (const v of routerVars) {
    for (const method of METHODS) {
      const re = new RegExp(`\\b${v}\\.${method}\\s*\\(`, 'g')
      let m
      while ((m = re.exec(src))) {
        const open = m.index + m[0].length - 1
        const close = matchParen(skel, open)
        if (close < 0) {
          anomalies.push({ file: file.replace(ROOT + '/', ''), line: lineOf(raw, m.index), reason: 'unbalanced route declaration — route NOT counted', method })
          continue
        }
        const args = src.slice(open + 1, close - 1)
        const pathLit = args.match(/^\s*['"`]([^'"`]*)['"`]/)
        if (!pathLit) {
          anomalies.push({ file: file.replace(ROOT + '/', ''), line: lineOf(raw, m.index), reason: 'non-literal route path', method })
          continue
        }
        const routePath = pathLit[1]
        // inline middleware = text between the path literal and the handler
        const after = args.slice(pathLit[0].length)
        const handlerAt = after.search(/(async\s*)?\(\s*(req|_req)\b/)
        const inline = handlerAt > 0 ? after.slice(0, handlerAt) : ''
        const inlineGuards = guardsWith(inline, alias)
        const scoped = scopedGuards
          .filter(s => s.var === v && routePath.startsWith(s.path))
          .flatMap(s => s.guards)
        const scopedCaps = scopedGuards
          .filter(s => s.var === v && routePath.startsWith(s.path))
          .flatMap(s => s.caps ?? [])
        routes.push({
          method: method.toUpperCase(),
          routerVar: v,
          routePath,
          line: lineOf(raw, m.index),
          routerGuards: [...routerGuards.get(v)].sort(),
          inlineGuards,
          scopedGuards: [...new Set(scoped)].sort(),
          // The functional half (Phase 2) and the object half (Phase 3),
          // both derived from source rather than declared.
          capabilities: [...new Set([
            ...routerCaps.get(v), ...scopedCaps, ...capabilitiesIn(inline),
          ])].sort(),
          recordScopeCalls: recordScopeCallsIn(args),
          // body reads inside the handler body (for §16/§17 body-project audit)
          bodyProjectRefs: [...new Set(
            [...args.matchAll(/\breq\.body(?:\s*\.\s*|\s*\[\s*['"`])(project_?[Ii]d|projectId|parent_project_id)\b/g)].map(x => x[1]),
          )].sort(),
        })
      }
    }
  }
  const parsed = {
    file, raw, routes, exportedRouters, defaultVar,
    routerVars: [...routerVars],
    subMounts,
    routerGuardsByVar: Object.fromEntries([...routerGuards].map(([k, v2]) => [k, [...v2].sort()])),
  }
  fileCache.set(file, parsed)
  return parsed
}

// ── 3. join mounts × routes ──────────────────────────────────────────────────

/**
 * Every route reachable from one router variable, following intra-file
 * `parent.use('/p', child)` mounts. Router-relative paths are joined, and the
 * parent's router-level guards plus the sub-mount's own middleware are carried
 * down, so a sub-router route reports the guards actually in force on it.
 */
function collectRoutes (parsed, rootVar) {
  const out = []
  const seen = new Set()
  const walk = (v, prefix, inherited) => {
    const mark = `${v}|${prefix}`
    if (seen.has(mark)) return
    seen.add(mark)
    for (const r of parsed.routes.filter(x => x.routerVar === v)) {
      out.push({ ...r, routePath: joinPath(prefix, r.routePath), inheritedGuards: inherited })
    }
    for (const sm of parsed.subMounts.filter(x => x.parent === v)) {
      walk(sm.child, joinPath(prefix, sm.path), [
        ...new Set([...inherited, ...sm.guards, ...(parsed.routerGuardsByVar[v] ?? [])]),
      ])
    }
  }
  walk(rootVar, '', [])
  return out
}

function joinPath (prefix, routePath) {
  const a = (prefix || '').replace(/\/+$/, '')
  const b = routePath === '/' ? '' : routePath
  const full = (a + (b.startsWith('/') || b === '' ? b : '/' + b)) || '/'
  return full.replace(/\/{2,}/g, '/')
}

const endpoints = []
const mountedModules = new Set()

for (const mnt of mounts) {
  const file = moduleToFile(mnt.module)
  if (!file) { anomalies.push({ routerId: mnt.routerId, module: mnt.module, reason: 'router module not resolved' }); continue }
  mountedModules.add(file)
  const parsed = parseRouteFile(file)
  // Bind this mount to exactly ONE router variable. A file may declare several
  // routers (api/routes/procurement.ts declares four); attributing every route
  // in the file to every mount of that file invents endpoints.
  let boundVar = null
  if (mnt.importKind === 'default') boundVar = parsed.defaultVar
  else if (mnt.exportName && parsed.exportedRouters.has(mnt.exportName)) boundVar = parsed.exportedRouters.get(mnt.exportName)
  if (!boundVar) {
    if (parsed.routerVars.length === 1) boundVar = parsed.routerVars[0]
    else { anomalies.push({ routerId: mnt.routerId, module: mnt.module, reason: 'mount could not be bound to a single router variable', candidates: parsed.routerVars }); continue }
  }
  const routes = collectRoutes(parsed, boundVar)
  for (const r of routes) {
    const fullPath = joinPath(mnt.prefix, r.routePath)
    endpoints.push({
      method: r.method,
      path: fullPath,
      mountPrefix: mnt.prefix,
      routePath: r.routePath,
      file: file.replace(ROOT + '/', ''),
      line: r.line,
      serverLine: mnt.serverLine,
      pathParams: [...fullPath.matchAll(/:([A-Za-z_][\w]*)/g)].map(x => x[1]),
      guards: [...new Set([...mnt.mountGuards, ...r.routerGuards, ...r.scopedGuards, ...r.inlineGuards, ...(r.inheritedGuards ?? [])])].sort(),
      capabilities: [...new Set([...(r.capabilities ?? []), ...capabilitiesIn(mnt.mountGuardsRaw ?? '')])].sort(),
      recordScopeCalls: r.recordScopeCalls ?? [],
      bodyProjectRefs: r.bodyProjectRefs,
      mounted: true,
    })
  }
}

// unmounted route files — visible, not dropped (HOB: DEAD_OR_UNMOUNTED)
for (const f of readdirSync(ROUTES_DIR).filter(x => x.endsWith('.ts'))) {
  const abs = join(ROUTES_DIR, f)
  if (mountedModules.has(abs)) continue
  const parsedU = parseRouteFile(abs)
  const childVars = new Set(parsedU.subMounts.map(x => x.child))
  const roots = parsedU.routerVars.filter(v => !childVars.has(v))
  const routes = roots.flatMap(v => collectRoutes(parsedU, v))
  for (const r of routes) {
    endpoints.push({
      method: r.method,
      path: r.routePath,
      mountPrefix: null,
      routePath: r.routePath,
      file: abs.replace(ROOT + '/', ''),
      line: r.line,
      serverLine: null,
      pathParams: [...r.routePath.matchAll(/:([A-Za-z_][\w]*)/g)].map(x => x[1]),
      guards: [...new Set([...r.routerGuards, ...r.scopedGuards, ...r.inlineGuards, ...(r.inheritedGuards ?? [])])].sort(),
      capabilities: r.capabilities ?? [],
      recordScopeCalls: r.recordScopeCalls ?? [],
      bodyProjectRefs: r.bodyProjectRefs,
      mounted: false,
    })
  }
}

endpoints.sort((a, b) =>
  a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.file.localeCompare(b.file))

const MUTATION = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const out = {
  generatedFrom: 'checked-in source (api/server.ts + api/routes/*.ts)',
  counts: {
    endpoints: endpoints.length,
    mounted: endpoints.filter(e => e.mounted).length,
    unmounted: endpoints.filter(e => !e.mounted).length,
    reads: endpoints.filter(e => e.method === 'GET').length,
    mutations: endpoints.filter(e => MUTATION.has(e.method)).length,
    routeFiles: new Set(endpoints.map(e => e.file)).size,
    mounts: mounts.length,
  },
  anomalies,
  endpoints,
}

mkdirSync(join(ROOT, 'audit', 'adr-014'), { recursive: true })
const dest = join(ROOT, 'audit', 'adr-014', 'endpoint-inventory.json')
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n')
console.log(JSON.stringify(out.counts, null, 2))
console.log('anomalies:', anomalies.length)
console.log('->', dest.replace(ROOT + '/', ''))
