#!/usr/bin/env node
/**
 * ADR-014 — machine-derived table → project-parent map (HOB §12 input).
 *
 * Parses api/db/migrations/*.sql in filename order and records, per table:
 *   - primary key / id column
 *   - tenant column (tenant_id)
 *   - direct project parent column (project_id)
 *   - foreign keys, so an INDIRECT project parent can be derived by walking
 *     FK edges to a table that does have project_id (e.g. punch_list_items →
 *     punch_lists → project_id)
 *
 * This is the data HOB §12 requires so parent-project resolution lives in one
 * policy table instead of ad-hoc `SELECT project_id FROM ...` in every router.
 *
 * ALTER TABLE ... ADD COLUMN is applied so late-added project_id columns are
 * not missed. Nothing is executed; no database is contacted.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIG  = join(ROOT, 'api', 'db', 'migrations')

const stripSql = s => s.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

/** table -> { columns:Map(name->{type,ref}), pk, sources:[] } */
const tables = new Map()
const ensure = t => {
  if (!tables.has(t)) tables.set(t, { name: t, columns: new Map(), pk: null, sources: [] })
  return tables.get(t)
}

/** Split a CREATE TABLE body on top-level commas. */
function splitDefs (body) {
  const out = []; let depth = 0, cur = ''
  for (const ch of body) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

const files = readdirSync(MIG).filter(f => f.endsWith('.sql')).sort()
for (const f of files) {
  const sql = stripSql(readFileSync(join(MIG, f), 'utf8'))

  // CREATE TABLE [IF NOT EXISTS] name ( ... )
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w.]*)\s*\(/gi)) {
    const open = sql.indexOf('(', m.index + m[0].length - 1)
    let depth = 0, i = open
    for (; i < sql.length; i++) { if (sql[i] === '(') depth++; else if (sql[i] === ')') { depth--; if (!depth) break } }
    const body = sql.slice(open + 1, i)
    const t = ensure(m[1].replace(/^public\./, ''))
    t.sources.push(f)
    for (const raw of splitDefs(body)) {
      const def = raw.trim()
      if (!def) continue
      const tableCon = /^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT|EXCLUDE)\b/i.exec(def)
      if (tableCon) {
        const pk = /^PRIMARY\s+KEY\s*\(\s*([\w"\s,]+?)\s*\)/i.exec(def)
        if (pk) t.pk = pk[1].replace(/"/g, '').trim()
        const fk = /FOREIGN\s+KEY\s*\(\s*(\w+)\s*\)\s*REFERENCES\s+([A-Za-z_][\w.]*)\s*\(\s*(\w+)\s*\)/i.exec(def)
        if (fk) {
          const c = t.columns.get(fk[1]) ?? { type: null, ref: null }
          c.ref = { table: fk[2].replace(/^public\./, ''), column: fk[3] }
          t.columns.set(fk[1], c)
        }
        continue
      }
      const cm = /^"?(\w+)"?\s+([A-Za-z][\w\s()]*?)(?:\s|$)/.exec(def)
      if (!cm) continue
      const col = { type: cm[2].trim(), ref: null }
      const ref = /REFERENCES\s+([A-Za-z_][\w.]*)\s*(?:\(\s*(\w+)\s*\))?/i.exec(def)
      if (ref) col.ref = { table: ref[1].replace(/^public\./, ''), column: ref[2] ?? 'id' }
      if (/PRIMARY\s+KEY/i.test(def)) t.pk = cm[1]
      const existing = t.columns.get(cm[1])
      t.columns.set(cm[1], existing ? { ...existing, ...col, ref: col.ref ?? existing.ref } : col)
    }
  }

  // ALTER TABLE x ADD COLUMN [IF NOT EXISTS] col type [REFERENCES y(z)]
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][\w.]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+([^;,]+)/gi)) {
    const t = ensure(m[1].replace(/^public\./, ''))
    const tail = m[3]
    const col = { type: tail.trim().split(/\s+/)[0], ref: null }
    const ref = /REFERENCES\s+([A-Za-z_][\w.]*)\s*(?:\(\s*(\w+)\s*\))?/i.exec(tail)
    if (ref) col.ref = { table: ref[1].replace(/^public\./, ''), column: ref[2] ?? 'id' }
    if (!t.columns.has(m[2])) t.columns.set(m[2], col); else t.columns.set(m[2], { ...t.columns.get(m[2]), ...col })
    if (!t.sources.includes(f)) t.sources.push(f)
  }
  // ALTER TABLE x ADD [CONSTRAINT n] FOREIGN KEY (c) REFERENCES y(z)
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][\w.]*)\s+ADD\s+(?:CONSTRAINT\s+\w+\s+)?FOREIGN\s+KEY\s*\(\s*(\w+)\s*\)\s*REFERENCES\s+([A-Za-z_][\w.]*)\s*\(\s*(\w+)\s*\)/gi)) {
    const t = ensure(m[1].replace(/^public\./, ''))
    const c = t.columns.get(m[2]) ?? { type: null, ref: null }
    c.ref = { table: m[3].replace(/^public\./, ''), column: m[4] }
    t.columns.set(m[2], c)
  }
}

// ── derive project-parent strategy per table ─────────────────────────────────

const PROJECT_COLS = ['project_id', 'projectId', 'parent_project_id']

function directProjectCol (t) {
  return PROJECT_COLS.find(c => t.columns.has(c)) ?? null
}

/** Walk FK edges (bounded) to find a table that has a direct project column. */
function indirectProjectPath (t, seen = new Set(), depth = 0) {
  if (depth > 3) return null
  for (const [colName, col] of t.columns) {
    if (!col.ref || col.ref.table === t.name) continue
    if (seen.has(col.ref.table)) continue
    const parent = tables.get(col.ref.table)
    if (!parent) continue
    const d = directProjectCol(parent)
    if (d) return [{ via: colName, table: parent.name, column: d }]
    const next = new Set(seen); next.add(t.name)
    const deeper = indirectProjectPath(parent, next, depth + 1)
    if (deeper) return [{ via: colName, table: parent.name, column: null }, ...deeper]
  }
  return null
}

const result = []
for (const t of [...tables.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  if (t.name === 'projects') {
    result.push({ table: t.name, idColumn: t.pk ?? 'id', tenantColumn: t.columns.has('tenant_id') ? 'tenant_id' : null,
      projectParent: { strategy: 'PROJECT_ROOT', column: t.pk ?? 'id' }, columns: t.columns.size, sources: t.sources })
    continue
  }
  const direct = directProjectCol(t)
  let projectParent
  if (direct) projectParent = { strategy: 'DIRECT_COLUMN', column: direct, nullable: null }
  else {
    const path = indirectProjectPath(t)
    projectParent = path
      ? { strategy: 'FK_PATH', path }
      : { strategy: 'NO_PROJECT_PARENT' }
  }
  result.push({
    table: t.name,
    idColumn: t.pk ?? (t.columns.has('id') ? 'id' : null),
    tenantColumn: t.columns.has('tenant_id') ? 'tenant_id' : null,
    projectParent,
    columns: t.columns.size,
    sources: t.sources,
  })
}

const counts = {
  tables: result.length,
  migrationFiles: files.length,
  directProjectColumn: result.filter(r => r.projectParent.strategy === 'DIRECT_COLUMN').length,
  fkPathToProject:     result.filter(r => r.projectParent.strategy === 'FK_PATH').length,
  noProjectParent:     result.filter(r => r.projectParent.strategy === 'NO_PROJECT_PARENT').length,
  projectRoot:         result.filter(r => r.projectParent.strategy === 'PROJECT_ROOT').length,
  withTenantColumn:    result.filter(r => r.tenantColumn).length,
}

mkdirSync(join(ROOT, 'audit', 'adr-014'), { recursive: true })
writeFileSync(join(ROOT, 'audit', 'adr-014', 'schema-project-parent-map.json'),
  JSON.stringify({ generatedFrom: 'api/db/migrations/*.sql', counts, tables: result }, null, 2) + '\n')
console.log(JSON.stringify(counts, null, 2))
