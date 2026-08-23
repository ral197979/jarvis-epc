/**
 * ADR-014 Phase 3E-R — the nullable project-parent ratchet.
 *
 * Phase 3D and 3E refused every record whose `project_id` was NULL. For the 44
 * resources whose column is `NOT NULL` that branch is unreachable, so the rule
 * cost nothing. For the 15 whose column is nullable it cost everything: their
 * ingest and create paths produce project-less rows deliberately, and the
 * resolver returned before the tenant-wide branch could run, so those rows were
 * unreachable by EVERY principal — the tenant Owner included.
 *
 * This file holds the reconciliation:
 *
 *   §3   every resource DECLARES what a NULL parent means; there is no default
 *   §7   the declaration agrees with the migrations, not with an opinion
 *   §8   a claim that NULL is legitimate carries repository evidence
 *   §15  the project parent cannot be moved, so NULL is not an escape hatch
 *   §34  DUAL resolves both branches; PROJECT_REQUIRED still denies NULL
 *
 * Every assertion derives from source and proves it FOUND its target first, so
 * a renamed column or a regex that stops matching fails loudly rather than
 * passing vacuously.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  RECORD_SCOPE_POLICIES, policyFor,
  type RecordScopePolicy, type ProjectSemantics,
} from '../authz/recordScopePolicies'

const ROOT = process.cwd()
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const MIG_DIR = path.join(ROOT, 'api/db/migrations')
const MIGRATIONS = fs.readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()
  .map(f => ({ f, sql: fs.readFileSync(path.join(MIG_DIR, f), 'utf8') }))

/** The balanced-paren CREATE TABLE body for `table`, from the migrations. */
function createTable(table: string): string | null {
  for (const { sql } of MIGRATIONS) {
    const m = new RegExp(`CREATE TABLE (IF NOT EXISTS )?${table}\\s*\\(`, 'i').exec(sql)
    if (!m) continue
    let i = m.index + m[0].length, depth = 1
    while (i < sql.length && depth > 0) { if (sql[i] === '(') depth++; else if (sql[i] === ')') depth--; i++ }
    return sql.slice(m.index, i)
  }
  return null
}

/**
 * Is `column` on `table` nullable, according to the migrations?
 *
 * Read from the DDL rather than from the policy, so the policy can be checked
 * AGAINST it. `null` means the column could not be located, which is itself a
 * failure — a policy that names a column the schema does not have would
 * otherwise pass silently.
 */
function columnIsNullable(table: string, column: string): boolean | null {
  const body = createTable(table)
  if (body) {
    const line = body.split('\n').find(l => new RegExp(`^\\s*${column}\\s`).test(l))
    if (line) return !/NOT NULL/i.test(line)
  }
  for (const { sql } of MIGRATIONS) {
    const re = new RegExp(`ALTER TABLE ${table}[\\s\\S]{0,400}?ADD COLUMN[^;]*\\b${column}\\b[^;]*;`, 'i')
    const m = re.exec(sql)
    if (m) return !/NOT NULL/i.test(m[0])
  }
  return null
}

/** Where a policy's project parent physically lives: table + column. */
function parentColumn(p: RecordScopePolicy): { table: string; column: string } | null {
  const d = p.derivation
  if (!d) return null
  return d.kind === 'DIRECT_COLUMN'
    ? { table: d.table, column: d.projectColumn }
    : { table: d.parentTable, column: d.parentProjectColumn }
}

const withDerivation = RECORD_SCOPE_POLICIES.filter(p => p.derivation)
const dual   = RECORD_SCOPE_POLICIES.filter(p => p.projectSemantics === 'DUAL_PROJECT_OR_TENANT')
const global_ = RECORD_SCOPE_POLICIES.filter(p => p.projectSemantics === 'TENANT_GLOBAL')
const required = RECORD_SCOPE_POLICIES.filter(p => p.projectSemantics === 'PROJECT_REQUIRED')
const selfScoped = RECORD_SCOPE_POLICIES.filter(p => p.projectSemantics === 'SELF_SCOPED')

// ─── 1. Every resource declares, and nothing defaults (§3) ───────────────────
describe('every resource declares what a NULL project parent means', () => {
  const VALID: ProjectSemantics[] = [
    'PROJECT_REQUIRED', 'TENANT_GLOBAL', 'DUAL_PROJECT_OR_TENANT', 'SELF_SCOPED']

  it('declares valid semantics on every policy', () => {
    expect(RECORD_SCOPE_POLICIES.length).toBeGreaterThan(50)
    for (const p of RECORD_SCOPE_POLICIES) {
      expect(VALID, `${p.resource} declares ${p.projectSemantics}`).toContain(p.projectSemantics)
    }
  })

  it('declares a project-parent mutation rule on every policy', () => {
    for (const p of RECORD_SCOPE_POLICIES) {
      expect(p.projectParentMutation, `${p.resource} has no parent-mutation rule`).toBeTruthy()
    }
  })

  it('leaves no resource unexplained', () => {
    const counted = required.length + global_.length + dual.length + selfScoped.length
    expect(counted, 'every policy lands in exactly one semantic class')
      .toBe(RECORD_SCOPE_POLICIES.length)
  })

  it('reports the split this slice actually measured', () => {
    expect(required.length).toBe(44)
    // 15 at Phase 3E-R; Phase 3G added `document_folders` and `source_uploads`,
    // both created with `project_id ?? null` behind requireBodyProjectScope —
    // the same evidence shape that made `documents` and `commissioning_packs`
    // dual.
    expect(dual.length).toBe(17)
    expect(selfScoped.length).toBe(1)
    expect(global_.length, 'no resource is global-ONLY; the nullable ones are all dual').toBe(0)
  })

  it('offers no permissive default in the type — the field is required', () => {
    // Structural: the interface must not mark it optional, or a new resource
    // could acquire a NULL-parent meaning by saying nothing.
    const policies = src('api/authz/recordScopePolicies.ts')
    expect(policies).toMatch(/\n\s*projectSemantics:\s*ProjectSemantics\n/)
    expect(policies).not.toMatch(/projectSemantics\?:/)
    expect(policies).toMatch(/\n\s*projectParentMutation:\s*ProjectParentMutation\n/)
    expect(policies).not.toMatch(/projectParentMutation\?:/)
  })
})

// ─── 2. The declaration agrees with the schema (§7) ──────────────────────────
describe('declared semantics match the migrations, not an opinion', () => {
  it('finds the project column in the migrations for every derived resource', () => {
    for (const p of withDerivation) {
      const pc = parentColumn(p)!
      if (pc.table === 'projects' && pc.column === 'id') continue   // the root's own PK
      expect(columnIsNullable(pc.table, pc.column),
        `${p.resource}: ${pc.table}.${pc.column} is not in the migrations`).not.toBeNull()
    }
  })

  it('never claims a nullable parent where the column is NOT NULL', () => {
    // The dangerous direction: declaring DUAL on a NOT NULL column would add an
    // unreachable branch and, worse, suggest a global state the data cannot hold.
    for (const p of [...dual, ...global_]) {
      const pc = parentColumn(p)
      expect(pc, `${p.resource} claims a nullable parent but has no derivation`).toBeTruthy()
      if (pc!.table === 'projects' && pc!.column === 'id') {
        throw new Error(`${p.resource} cannot be dual: its parent is the project's own primary key`)
      }
      expect(columnIsNullable(pc!.table, pc!.column),
        `${p.resource} is declared ${p.projectSemantics} but ${pc!.table}.${pc!.column} is NOT NULL`).toBe(true)
    }
  })

  it('never denies NULL on a column that is actually nullable', () => {
    // The other direction, which is the bug this slice fixes: a PROJECT_REQUIRED
    // declaration over a nullable column makes real rows permanently unreachable.
    for (const p of required) {
      const pc = parentColumn(p)
      if (!pc) continue
      if (pc.table === 'projects' && pc.column === 'id') continue
      expect(columnIsNullable(pc.table, pc.column),
        `${p.resource} denies NULL but ${pc.table}.${pc.column} is nullable — its project-less rows would be unreachable`)
        .toBe(false)
    }
  })

  it('keeps the project root PROJECT_REQUIRED, since its parent is its own key', () => {
    const project = policyFor('project')!
    expect(project.projectSemantics).toBe('PROJECT_REQUIRED')
  })
})

// ─── 3. A claim that NULL is legitimate carries evidence (§8) ────────────────
describe('a tenant-global claim is argued from the repository', () => {
  it('gives every non-PROJECT_REQUIRED resource substantive evidence', () => {
    const claiming = [...dual, ...global_, ...selfScoped]
    expect(claiming.length).toBe(18)
    for (const p of claiming) {
      expect(p.projectSemanticsEvidence, `${p.resource} claims ${p.projectSemantics} with no evidence`).toBeTruthy()
      expect(p.projectSemanticsEvidence!.length,
        `${p.resource}'s evidence is too short to be an argument`).toBeGreaterThan(80)
    }
  })

  it('asks for no evidence where the schema already guarantees it', () => {
    for (const p of required) {
      expect(p.projectSemanticsEvidence,
        `${p.resource} is PROJECT_REQUIRED by NOT NULL and needs no argument`).toBeUndefined()
    }
  })

  it('cites the explicit scope column the commissioning tables actually declare', () => {
    // The strongest evidence in the repository: these two name the global state.
    for (const r of ['commissioning_baselines', 'commissioning_autosign_rules']) {
      expect(policyFor(r)!.projectSemanticsEvidence).toMatch(/scope/)
    }
    expect(src('api/db/migrations/019_commissioning_baselines.sql'))
      .toMatch(/CHECK \(scope IN \('global','client','project'\)\)/)
    expect(src('api/db/migrations/016_autosign_rules.sql'))
      .toMatch(/CHECK \(scope IN \('global','client','project'\)\)/)
  })

  it('cites the `_global` document bucket that files.ts really builds', () => {
    expect(policyFor('documents')!.projectSemanticsEvidence).toMatch(/_global/)
    expect(src('api/routes/files.ts')).toMatch(/\$\{projectId \?\? '_global'\}/)
  })

  it('cites the knowledge ingests that omit the column entirely', () => {
    expect(policyFor('knowledge_sources')!.projectSemanticsEvidence).toMatch(/omits/)
    // knowledgeBulkIngest inserts knowledge_sources without project_id at all.
    const bulk = src('api/services/knowledgeBulkIngest.ts')
    const insert = /INSERT INTO knowledge_sources[\s\S]{0,400}?\)/.exec(bulk)?.[0] ?? ''
    expect(insert, 'the bulk ingest INSERT was not found').toMatch(/tenant_id/)
    expect(insert, 'bulk ingest now sets project_id — re-derive the semantics').not.toMatch(/project_id/)

    const fixes = src('api/services/fixExtractor.ts')
    const fixInsert = /INSERT INTO knowledge_fixes[\s\S]{0,400}?\)/.exec(fixes)?.[0] ?? ''
    expect(fixInsert, 'the fix-extractor INSERT was not found').toMatch(/tenant_id/)
    expect(fixInsert, 'the extractor now sets project_id — re-derive the semantics').not.toMatch(/project_id/)
  })
})

// ─── 4. NULL is not an escape hatch (§15, §35) ───────────────────────────────
describe('the project parent cannot be moved, so NULL cannot be reached for', () => {
  it('records every resource as IMMUTABLE, because no writer moves the parent', () => {
    for (const p of RECORD_SCOPE_POLICIES) {
      expect(p.projectParentMutation,
        `${p.resource} claims a transfer workflow — prove it exists and gate it (§17/§18)`)
        .toBe('IMMUTABLE')
    }
  })

  it('proves no UPDATE statement in the API assigns a project parent', () => {
    // The escape hatch this slice must not open: if an ordinary write could set
    // project_id = NULL, a caller could promote a project record out of its
    // project and read it back through the tenant-global branch.
    const dirs = ['api/routes', 'api/services']
    const files: string[] = []
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`
        if (e.isDirectory()) walk(rel)
        else if (e.name.endsWith('.ts')) files.push(rel)
      }
    }
    dirs.forEach(walk)
    expect(files.length, 'no source files were scanned').toBeGreaterThan(50)

    const offenders: string[] = []
    for (const rel of files) {
      const text = src(rel)
      // Every UPDATE … SET … up to its WHERE (or statement end).
      const re = /UPDATE\s+(\w+)\s+SET\b([\s\S]*?)(?:\bWHERE\b|`)/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        const [, table, setClause] = m
        if (/\bproject_id\s*=/i.test(setClause!)) offenders.push(`${rel}: UPDATE ${table}`)
      }
    }
    expect(offenders, 'a writer assigns project_id — classify the transfer (§16)').toEqual([])
  })

  it('keeps project_id out of every column allow-list', () => {
    const routes = fs.readdirSync(path.join(ROOT, 'api/routes')).filter(f => f.endsWith('.ts'))
    let seen = 0
    for (const f of routes) {
      const text = src(`api/routes/${f}`)
      const re = /const allowed\s*=\s*\[([\s\S]*?)\]/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        seen++
        expect(m[1], `api/routes/${f} allow-lists project_id`).not.toMatch(/'project_id'|'projectId'/)
      }
    }
    expect(seen, 'no allow-list was found — the regex stopped matching').toBeGreaterThan(5)
  })
})

// ─── 5. The resolver honours the declaration (§34) ───────────────────────────
describe('the canonical resolver reads the declaration rather than assuming', () => {
  const resolver = src('api/authz/recordScope.ts')

  it('distinguishes an absent row from a row with a NULL parent', () => {
    // `rows.length` is the load-bearing line: reading `rows[0]?.project_id`
    // alone conflates "not there" with "there, and global".
    expect(resolver).toMatch(/if \(res\.rows\.length === 0\) return \{ kind: 'NOT_FOUND' \}/)
    expect(resolver).toMatch(/kind: 'TENANT_GLOBAL'/)
  })

  it('gates the tenant-global branch on the resource declaration', () => {
    expect(resolver).toMatch(/allowsTenantGlobal\(policy\.projectSemantics\)/)
    expect(resolver).toMatch(/s === 'TENANT_GLOBAL' \|\| s === 'DUAL_PROJECT_OR_TENANT'/)
  })

  it('still requires membership on the project branch', () => {
    expect(resolver).toMatch(/if \(!await canAccessProject\(principal, found\.projectId\)\) \{ notFound\(\); return \}/)
  })

  it('keeps the tenant predicate on the parent lookup, so global stays tenant-bound', () => {
    const fn = /export async function resolveRecordScope[\s\S]*?\n}/.exec(resolver)?.[0] ?? ''
    expect(fn, 'resolveRecordScope was not found').toContain('SELECT')
    const predicates = fn.match(/current_setting\('app\.current_tenant_id', true\)::uuid/g) ?? []
    expect(predicates.length, 'both derivation shapes must carry the tenant predicate').toBe(2)
  })

  it('treats a failed lookup as NOT_FOUND, never as tenant-global', () => {
    const fn = /export async function resolveRecordScope[\s\S]*?\n}/.exec(resolver)?.[0] ?? ''
    const cat = /catch \{[\s\S]*?\}/.exec(fn)?.[0] ?? ''
    expect(cat, 'the catch block was not found').toContain('NOT_FOUND')
    // Comments stripped: the catch block DISCUSSES the tenant-global branch it
    // must not take, and asserting over the prose would pass or fail on wording.
    const code = cat.replace(/\/\/[^\n]*/g, '')
    expect(code, 'a database error must not be read as "this record has no project"')
      .not.toContain('TENANT_GLOBAL')
  })
})
