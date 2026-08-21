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

/** Strip line + block comments so commented-out routes are not counted. */
function stripComments (src) {
  let out = '', i = 0, n = src.length
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++ } continue }
    if (c === '/' && d === '*') {
      out += '  '; i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++ }
      out += '  '; i += 2; continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; out += c; i++
      while (i < n && src[i] !== q) { if (src[i] === '\\') { out += src[i]; i++ } if (i < n) { out += src[i]; i++ } }
      out += src[i] ?? ''; i++; continue
    }
    out += c; i++
  }
  return out
}

/** Given index of an opening '(', return index just past its matching ')'. */
function matchParen (src, open) {
  let depth = 0, i = open, n = src.length
  while (i < n) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++ }
      i++; continue
    }
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
function buildAliasMap (src) {
  const defs = new Map()   // name -> definition text
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([^\n;]+)/g)) {
    defs.set(m[1], m[2])
  }
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const open = src.indexOf('(', m.index)
    const afterParams = matchParen(src, open)
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

const serverRaw = readFileSync(SERVER_TS, 'utf8')
const serverSrc = stripComments(serverRaw)
const serverAlias = buildAliasMap(serverSrc)

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
  const close = matchParen(serverSrc, open)
  if (close < 0) continue
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
  const raw = readFileSync(file, 'utf8')
  const src = stripComments(raw)
  const alias = buildAliasMap(src)

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
  for (const v of routerVars) {
    routerGuards.set(v, new Set())
    const useRe = new RegExp(`\\b${v}\\.use\\s*\\(`, 'g')
    let m
    while ((m = useRe.exec(src))) {
      const open = m.index + m[0].length - 1
      const close = matchParen(src, open)
      if (close < 0) continue
      const args = src.slice(open + 1, close - 1)
      const pathLit = args.match(/^\s*['"`]([^'"`]*)['"`]/)
      const g = guardsWith(args, alias)
      if (pathLit) scopedGuards.push({ var: v, path: pathLit[1], guards: g })
      else for (const x of g) routerGuards.get(v).add(x)
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
        const close = matchParen(src, open)
        if (close < 0) continue
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
        routes.push({
          method: method.toUpperCase(),
          routerVar: v,
          routePath,
          line: lineOf(raw, m.index),
          routerGuards: [...routerGuards.get(v)].sort(),
          inlineGuards,
          scopedGuards: [...new Set(scoped)].sort(),
          // body reads inside the handler body (for §16/§17 body-project audit)
          bodyProjectRefs: [...new Set(
            [...args.matchAll(/\breq\.body(?:\s*\.\s*|\s*\[\s*['"`])(project_?[Ii]d|projectId|parent_project_id)\b/g)].map(x => x[1]),
          )].sort(),
        })
      }
    }
  }
  const parsed = { file, raw, routes, exportedRouters, defaultVar, routerVars: [...routerVars] }
  fileCache.set(file, parsed)
  return parsed
}

// ── 3. join mounts × routes ──────────────────────────────────────────────────

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
  const routes = parsed.routes.filter(r => r.routerVar === boundVar)
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
      guards: [...new Set([...mnt.mountGuards, ...r.routerGuards, ...r.scopedGuards, ...r.inlineGuards])].sort(),
      bodyProjectRefs: r.bodyProjectRefs,
      mounted: true,
    })
  }
}

// unmounted route files — visible, not dropped (HOB: DEAD_OR_UNMOUNTED)
for (const f of readdirSync(ROUTES_DIR).filter(x => x.endsWith('.ts'))) {
  const abs = join(ROUTES_DIR, f)
  if (mountedModules.has(abs)) continue
  const { routes } = parseRouteFile(abs)
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
      guards: [...new Set([...r.routerGuards, ...r.scopedGuards, ...r.inlineGuards])].sort(),
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
