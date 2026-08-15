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
}

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

      out.push({
        file, router, method, path: routePath, capability, allCapabilities,
        key: `${file} ${router}.${method} ${routePath}`,
        effective: [...new Set(prefixes)].map(p => `${p}${routePath}`.replace(/\/+$/, '') || '/'),
      })
    }
  }
  return out
}
