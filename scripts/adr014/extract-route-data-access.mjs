#!/usr/bin/env node
/**
 * ADR-014 — machine-derived route → table data-access map.
 *
 * For every endpoint in audit/adr-014/endpoint-inventory.json, derives WHICH
 * TABLES the request reads and writes, from SQL found in the handler and — when
 * the handler delegates — in the service functions it calls (one resolution
 * level, recorded explicitly as `resolvedVia`).
 *
 * This is what makes the HOB §5/§9 classification source-derived rather than
 * guessed from the URL: `PATCH /api/v1/drawings/:id` is project-bound because
 * it UPDATEs `drawings`, and `drawings.project_id` exists — not because the word
 * "drawings" appears in the path.
 *
 * It also records the WHERE-clause scoping columns of each write, which is the
 * direct evidence for whether a mutation is tenant-scoped only (`tenant_id`) or
 * genuinely project-scoped (`project_id`).
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const INV  = join(ROOT, 'audit', 'adr-014', 'endpoint-inventory.json')

// ── shared source utilities (kept local so each script stands alone) ─────────
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
function matchParen (src, open) {
  let depth = 0, i = open, n = src.length
  while (i < n) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++ } i++; continue }
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return i + 1 }
    i++
  }
  return -1
}

// ── SQL extraction ───────────────────────────────────────────────────────────
const WRITE_RE = [
  [/INSERT\s+INTO\s+([A-Za-z_][\w.]*)/gi, 'INSERT'],
  [/UPDATE\s+([A-Za-z_][\w.]*)\s+SET/gi,  'UPDATE'],
  [/DELETE\s+FROM\s+([A-Za-z_][\w.]*)/gi, 'DELETE'],
]
const READ_RE = [
  [/\bFROM\s+([A-Za-z_][\w.]*)/gi, 'FROM'],
  [/\bJOIN\s+([A-Za-z_][\w.]*)/gi, 'JOIN'],
]
const SQL_NOISE = new Set(['set', 'where', 'select', 'values', 'returning', 'as', 'on', 'and', 'or'])

/** Scoping columns named in WHERE clauses of a fragment — the authorization evidence. */
function scopeColumnsIn (text) {
  const cols = new Set()
  for (const m of text.matchAll(/\b(tenant_id|project_id|user_id|owner_id|assigned_to|created_by|parent_project_id)\s*(?:=|IN\b|<>|!=)/gi)) {
    cols.add(m[1].toLowerCase())
  }
  return [...cols].sort()
}

/**
 * Is this `FROM` inside a subquery rather than the statement's outer query?
 *
 * ADR-014 Phase 3F §4. Source order alone is not enough, because a scalar
 * subquery in the SELECT list appears BEFORE the outer FROM:
 *
 *     SELECT t.*, (SELECT count(*) FROM transmittal_items …) FROM transmittals t
 *
 * "first FROM wins" would report `GET /transmittals` as returning
 * transmittal_items, and `GET /vendors` as returning purchase_orders. What
 * actually separates them is nesting: the outer FROM sits at paren depth 0
 * within its SQL literal, every subquery FROM sits deeper. Depth is counted
 * from the nearest preceding quote — the start of the SQL string — so
 * surrounding JavaScript parentheses cannot skew it.
 */
function isNestedFrom (text, index) {
  let lit = -1
  for (const q of ['`', "'", '"']) lit = Math.max(lit, text.lastIndexOf(q, index))
  const from = lit >= 0 ? lit + 1 : 0
  let depth = 0
  for (let i = from; i < index; i++) {
    const c = text[i]
    if (c === '(') depth++
    else if (c === ')') depth--
  }
  return depth > 0
}

function sqlIn (text) {
  const writes = [], reads = new Set(), readsFrom = new Set()
  for (const [re, kind] of WRITE_RE) {
    for (const m of text.matchAll(re)) {
      const t = m[1].replace(/^public\./, '').toLowerCase()
      if (SQL_NOISE.has(t) || t.startsWith('$')) continue
      // WHERE clause belonging to this statement: text up to the next ; or backtick
      const tail = text.slice(m.index, m.index + 600)
      writes.push({ op: kind, table: t, scopeColumns: scopeColumnsIn(tail) })
    }
  }
  for (const [re, kind] of READ_RE) {
    for (const m of text.matchAll(re)) {
      const t = m[1].replace(/^public\./, '').toLowerCase()
      if (SQL_NOISE.has(t) || t.startsWith('$') || /^\d/.test(t)) continue
      reads.add(t)
      // ADR-014 Phase 3F §4: which rows a collection RETURNS is decided by the
      // table it selects FROM, not by every table it happens to touch. A vendor
      // list that JOINs `projects` for a display name is not a project
      // collection; recording FROM separately is what lets the classifier tell
      // the two apart instead of treating any mention of a project-bound table
      // as ownership.
      if (kind === 'FROM' && !isNestedFrom(text, m.index)) readsFrom.add(t)
    }
  }
  // NOT sorted: order is the evidence. The outer query's FROM comes first in
  // the source, and a count subquery's FROM comes later — `GET /vendors`
  // selects FROM vendors and then counts FROM purchase_orders, so sorting would
  // make a vendor registry look like a project collection.
  return { writes, reads: [...reads].sort(), readsFrom: [...readsFrom] }
}

// ── index every exported function in api/services + api/db helpers ──────────
function walk (dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) acc.push(p)
  }
  return acc
}

/** function name -> { file, writes, reads } */
const serviceIndex = new Map()
for (const file of walk(join(ROOT, 'api', 'services'))) {
  const src = stripComments(readFileSync(file, 'utf8'))
  const decls = [
    ...src.matchAll(/\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g),
    ...src.matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s*)?\(/g),
  ]
  for (const m of decls) {
    const name = m[1]
    // body = from the declaration to the next top-level `export ` (bounded slice)
    const start = m.index
    const nextExport = src.indexOf('\nexport ', start + 1)
    const body = src.slice(start, nextExport === -1 ? src.length : nextExport)
    const { writes, reads, readsFrom } = sqlIn(body)
    if (!serviceIndex.has(name)) serviceIndex.set(name, { file: file.replace(ROOT + '/', ''), writes, reads, readsFrom })
  }
}

// ── re-parse route files, capturing handler text per route ───────────────────
const inv = JSON.parse(readFileSync(INV, 'utf8'))
const handlerCache = new Map()

function handlersFor (file) {
  if (handlerCache.has(file)) return handlerCache.get(file)
  const abs = join(ROOT, file)
  const raw = readFileSync(abs, 'utf8')
  const src = stripComments(raw)
  // ADR-014 Phase 3F: keyed by DECLARATION LINE, not by "METHOD routePath".
  // api/routes/procurement.ts declares four routers that each serve `GET /`
  // (vendors, purchase-orders, rfis, submittals), so a method+path key made
  // them collide and the last one parsed won — `GET /vendors` was reported as
  // reading `submittals`. The endpoint inventory already distinguishes them by
  // line, and `stripComments` preserves newlines, so the line is a safe and
  // unambiguous join key. The method+path map is kept as a fallback so a route
  // the line lookup misses degrades to the old behaviour rather than vanishing.
  const byLine = new Map()   // 1-based declaration line -> handler text
  const byPath = new Map()   // "METHOD routePath" -> handler text (fallback)
  let line = 1, scanned = 0
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|options|head|all)\s*\(/g)) {
    const open = m.index + m[0].length - 1
    const close = matchParen(src, open)
    if (close < 0) continue
    const args = src.slice(open + 1, close - 1)
    const lit = args.match(/^\s*['"`]([^'"`]*)['"`]/)
    if (!lit) continue
    while (scanned < m.index) { if (src[scanned] === '\n') line++; scanned++ }
    byLine.set(line, args)
    if (!byPath.has(`${m[2].toUpperCase()} ${lit[1]}`)) byPath.set(`${m[2].toUpperCase()} ${lit[1]}`, args)
  }
  const map = { byLine, byPath }
  handlerCache.set(file, map)
  return map
}

const out = []
for (const ep of inv.endpoints) {
  const h = handlersFor(ep.file)
  const handler = h.byLine.get(ep.line) ?? h.byPath.get(`${ep.method} ${ep.routePath}`) ?? ''
  const own = sqlIn(handler)
  // delegated calls: identifiers invoked in the handler that the service index knows
  const called = new Set()
  for (const m of handler.matchAll(/\b([A-Za-z_$][\w$]{2,})\s*\(/g)) if (serviceIndex.has(m[1])) called.add(m[1])
  const delegatedWrites = [], delegatedReads = new Set(), delegatedReadsFrom = new Set()
  for (const fn of called) {
    const s = serviceIndex.get(fn)
    for (const w of s.writes) delegatedWrites.push({ ...w, viaFunction: fn, inFile: s.file })
    for (const r of s.reads) delegatedReads.add(r)
    for (const r of s.readsFrom) delegatedReadsFrom.add(r)
  }
  const writes = [...own.writes, ...delegatedWrites]
  const reads = [...new Set([...own.reads, ...delegatedReads])].sort()
  // Handler SQL first, then delegated service SQL: the route's own outer query
  // is the better evidence of what it returns.
  const readsFrom = [...new Set([...own.readsFrom, ...delegatedReadsFrom])]
  out.push({
    method: ep.method, path: ep.path, file: ep.file, line: ep.line,
    pathParams: ep.pathParams, guards: ep.guards, bodyProjectRefs: ep.bodyProjectRefs,
    mounted: ep.mounted,
    writes, reads, readsFrom,
    /**
     * The table whose rows this endpoint actually returns — the first FROM in
     * source order (ADR-014 Phase 3F §4). `null` when no read SQL resolved.
     */
    primaryReadTable: readsFrom[0] ?? null,
    writeTables: [...new Set(writes.map(w => w.table))].sort(),
    delegatesTo: [...called].sort(),
    resolvedVia: own.writes.length || own.reads.length
      ? (delegatedWrites.length ? 'HANDLER_SQL+SERVICE' : 'HANDLER_SQL')
      : (delegatedWrites.length || delegatedReads.size ? 'SERVICE' : 'UNRESOLVED'),
  })
}

const counts = {
  endpoints: out.length,
  resolvedHandlerSql: out.filter(x => x.resolvedVia.startsWith('HANDLER_SQL')).length,
  resolvedViaService: out.filter(x => x.resolvedVia === 'SERVICE').length,
  unresolved:         out.filter(x => x.resolvedVia === 'UNRESOLVED').length,
  serviceFunctionsIndexed: serviceIndex.size,
}
writeFileSync(join(ROOT, 'audit', 'adr-014', 'route-data-access.json'),
  JSON.stringify({ generatedFrom: 'api/routes/*.ts + api/services/**/*.ts', counts, endpoints: out }, null, 2) + '\n')
console.log(JSON.stringify(counts, null, 2))
