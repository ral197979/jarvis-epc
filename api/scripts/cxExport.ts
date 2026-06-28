/**
 * Denver Engineering — Commissioning export bundle CORE (Phase C, PR-3)
 * ──────────────────────────────────────────────────────────────────────────────
 * Pure logic for the portable commissioning-execution export bundle. No DB, no
 * filesystem — it takes row providers and returns serialized NDJSON files, a
 * manifest, and a parity report. The DB/FS runner lives in cxExportRun.ts.
 *
 * Greenfield assumption: the Commissioning repo does not exist yet, so this
 * produces a self-describing bundle for later ingest (see CX_EXPORT_INGEST.md),
 * NOT a live transfer. No deletions, no mutation of Denver — read-only export.
 *
 * Determinism / idempotency: rows are serialized with a stable key order and the
 * caller orders rows by id, so re-running over the same DB state yields byte-
 * identical NDJSON files and identical checksums. (The only non-deterministic
 * field is the manifest's exportedAt timestamp, which is metadata.)
 *
 * See COMMISSIONING_EXTRACTION_PLAN.md §4 Phase C.
 */
import { createHash } from 'node:crypto'

/** Bundle schema version — bump when the table set or column shape changes. */
export const SCHEMA_VERSION = 'denver-epc-cx/1.0.0'

// ─── Table specs (parents BEFORE children for orphan resolution) ──────────────

export interface FkRef { column: string; table: string }

export interface TableSpec {
  name: string
  sourceMigration: string
  /** True if the table has a project_id column (direct project scoping). */
  hasProjectId: boolean
  /** True if project scope must be applied via baseline_id (observations). */
  projectViaBaseline?: boolean
  /** FKs whose target table is ALSO in this bundle (orphan-checkable). */
  parents: FkRef[]
  /** FKs whose target lives OUTSIDE the bundle (Denver/readiness/users/etc). */
  externalRefs: FkRef[]
}

export const TABLES: TableSpec[] = [
  {
    name: 'test_packs', sourceMigration: '026_epc_core', hasProjectId: true,
    parents: [],
    externalRefs: [
      { column: 'system_id', table: 'systems' },
      { column: 'subsystem_id', table: 'subsystems' },
      { column: 'tag_id', table: 'tags' },
      { column: 'commissioning_item_id', table: 'commissioning_items' },
      { column: 'created_by', table: 'users' }, { column: 'updated_by', table: 'users' },
    ],
  },
  {
    name: 'test_results', sourceMigration: '026_epc_core', hasProjectId: true,
    parents: [{ column: 'test_pack_id', table: 'test_packs' }],
    externalRefs: [
      { column: 'performed_by', table: 'users' }, { column: 'witnessed_by', table: 'users' },
      { column: 'created_by', table: 'users' }, { column: 'updated_by', table: 'users' },
    ],
  },
  {
    name: 'deficiencies', sourceMigration: '026_epc_core', hasProjectId: true,
    parents: [
      { column: 'test_pack_id', table: 'test_packs' },
      { column: 'test_result_id', table: 'test_results' },
    ],
    externalRefs: [
      { column: 'tag_id', table: 'tags' },
      { column: 'assignee_user_id', table: 'users' }, { column: 'closed_by', table: 'users' },
      { column: 'created_by', table: 'users' }, { column: 'updated_by', table: 'users' },
    ],
  },
  {
    name: 'ncrs', sourceMigration: '078_ncr_capa', hasProjectId: true,
    parents: [],
    externalRefs: [{ column: 'raised_by', table: 'users' }],
  },
  {
    name: 'corrective_actions', sourceMigration: '078_ncr_capa', hasProjectId: true,
    parents: [{ column: 'ncr_id', table: 'ncrs' }],
    externalRefs: [
      { column: 'assigned_to', table: 'users' }, { column: 'verified_by', table: 'users' },
    ],
  },
  {
    name: 'punch_lists', sourceMigration: '008_tier1_modules', hasProjectId: true,
    parents: [],
    externalRefs: [{ column: 'created_by', table: 'users' }],
  },
  {
    name: 'punch_items', sourceMigration: '008_tier1_modules', hasProjectId: true,
    parents: [{ column: 'punch_list_id', table: 'punch_lists' }],
    externalRefs: [
      { column: 'assigned_to', table: 'users' }, { column: 'drawing_id', table: 'drawings' },
      { column: 'verified_by', table: 'users' }, { column: 'closed_by', table: 'users' },
      { column: 'created_by', table: 'users' },
    ],
  },
  {
    name: 'commissioning_baselines', sourceMigration: '019_commissioning_baselines', hasProjectId: true,
    parents: [],
    externalRefs: [],
  },
  {
    // No project_id column — project scope applied via baseline_id.
    name: 'commissioning_observations', sourceMigration: '019_commissioning_baselines',
    hasProjectId: false, projectViaBaseline: true,
    parents: [{ column: 'baseline_id', table: 'commissioning_baselines' }],
    externalRefs: [
      { column: 'pack_id', table: 'commissioning_packs' },
      { column: 'rule_id', table: 'commissioning_autosign_rules' },
      { column: 'created_by', table: 'users' },
    ],
  },
]

// ─── Deterministic serialization ──────────────────────────────────────────────

/** Stable JSON: object keys sorted recursively; Dates → ISO; arrays preserved. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(_normalize(value))
}

function _normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return v.map(_normalize)
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = _normalize((v as Record<string, unknown>)[k])
    }
    return out
  }
  return v
}

/** Serialize rows to NDJSON (one stable-stringified object per line, trailing \n). */
export function serializeNdjson(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  return rows.map(stableStringify).join('\n') + '\n'
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

// ─── Bundle assembly ──────────────────────────────────────────────────────────

export interface Scope { tenantId: string | null; projectId: string | null }

export interface BundleInput {
  scope: Scope
  now: string                                   // ISO timestamp (injected for determinism/tests)
  schemaVersion?: string
  tables?: TableSpec[]
  /** Rows filtered to scope; MUST be ordered by id for byte-stable output. */
  fetchRows: (t: TableSpec) => Promise<Record<string, unknown>[]>
  /** Independent COUNT(*) with the same scope — the parity cross-check. */
  countRows: (t: TableSpec) => Promise<number>
}

export interface ManifestEntry {
  table: string
  file: string
  sourceMigration: string
  rowCount: number
  checksum: string
  foreignKeys: { inBundle: FkRef[]; external: FkRef[] }
}

export interface Manifest {
  schemaVersion: string
  exportedAt: string
  scope: { org: string | null; tenant: string | null; project: string | null }
  tables: ManifestEntry[]
  totals: { tables: number; rows: number }
}

export interface OrphanFinding { column: string; parentTable: string; count: number; sampleIds: string[] }
export interface MissingRefFinding { column: string; targetTable: string; nonNullCount: number }

export interface ParityEntry {
  table: string
  expectedRows: number
  exportedRows: number
  rowsOk: boolean
  checksum: string
  /** Set by the runner after re-reading the written file (disk round-trip). */
  checksumOk: boolean
  orphans: OrphanFinding[]
  missingReferences: MissingRefFinding[]
  warnings: string[]
}

export interface ParityReport {
  exportedAt: string
  scope: { org: string | null; tenant: string | null; project: string | null }
  tables: ParityEntry[]
  ok: boolean
  warnings: string[]
}

export interface BundleFile { name: string; content: string; checksum: string }

export interface Bundle {
  files: BundleFile[]
  manifest: Manifest
  parity: ParityReport
}

function _id(row: Record<string, unknown>): string {
  return String(row['id'])
}

/** Build the full bundle (files + manifest + parity) from row providers. */
export async function buildBundle(input: BundleInput): Promise<Bundle> {
  const tables = input.tables ?? TABLES
  const schemaVersion = input.schemaVersion ?? SCHEMA_VERSION
  const scopeMeta = { org: input.scope.tenantId, tenant: input.scope.tenantId, project: input.scope.projectId }

  const files: BundleFile[] = []
  const manifestEntries: ManifestEntry[] = []
  const parityEntries: ParityEntry[] = []
  const topWarnings: string[] = []
  const exportedIds = new Map<string, Set<string>>()
  let totalRows = 0
  let ok = true

  for (const t of tables) {
    const rows = await input.fetchRows(t)
    const expected = await input.countRows(t)
    const content = serializeNdjson(rows)
    const checksum = sha256(content)
    const fileName = `${t.name}.ndjson`

    exportedIds.set(t.name, new Set(rows.map(_id)))
    files.push({ name: fileName, content, checksum })
    manifestEntries.push({
      table: t.name, file: fileName, sourceMigration: t.sourceMigration,
      rowCount: rows.length, checksum,
      foreignKeys: { inBundle: t.parents, external: t.externalRefs },
    })

    // ── Parity: row count cross-check
    const rowsOk = expected === rows.length
    const warnings: string[] = []
    if (!rowsOk) {
      ok = false
      warnings.push(`row count mismatch: COUNT(*)=${expected} but exported ${rows.length}`)
    }

    // ── Orphans: child rows whose in-bundle parent id is absent
    const orphans: OrphanFinding[] = []
    for (const p of t.parents) {
      const parentSet = exportedIds.get(p.table)
      if (!parentSet) {
        warnings.push(`parent table ${p.table} not in bundle — cannot verify ${p.column}`)
        continue
      }
      const missing: string[] = []
      for (const row of rows) {
        const fk = row[p.column]
        if (fk != null && !parentSet.has(String(fk))) missing.push(_id(row))
      }
      if (missing.length) {
        ok = false
        orphans.push({ column: p.column, parentTable: p.table, count: missing.length, sampleIds: missing.slice(0, 5) })
      }
    }

    // ── Missing references: non-null FKs whose target is outside the bundle
    const missingReferences: MissingRefFinding[] = []
    for (const ext of t.externalRefs) {
      let n = 0
      for (const row of rows) if (row[ext.column] != null) n++
      if (n > 0) missingReferences.push({ column: ext.column, targetTable: ext.table, nonNullCount: n })
    }
    if (t.projectViaBaseline && input.scope.projectId) {
      warnings.push('project scope applied via baseline_id (no project_id column)')
    }

    parityEntries.push({
      table: t.name, expectedRows: expected, exportedRows: rows.length, rowsOk,
      checksum, checksumOk: true, orphans, missingReferences, warnings,
    })
    topWarnings.push(...warnings.map(w => `[${t.name}] ${w}`))
    totalRows += rows.length
  }

  const manifest: Manifest = {
    schemaVersion, exportedAt: input.now, scope: scopeMeta,
    tables: manifestEntries, totals: { tables: tables.length, rows: totalRows },
  }
  const parity: ParityReport = {
    exportedAt: input.now, scope: scopeMeta, tables: parityEntries, ok, warnings: topWarnings,
  }
  return { files, manifest, parity }
}

// ─── Scope SQL helper (used by the runner; pure so it is unit-tested) ──────────

export interface ScopeSql { where: string; params: unknown[] }

/**
 * Build the WHERE clause + params for a table at the given scope. Tables without
 * project_id use baseline_id IN (...) when a project filter is supplied; tables
 * with neither fall back to tenant scope.
 */
export function scopeSql(t: TableSpec, scope: Scope): ScopeSql {
  const clauses: string[] = []
  const params: unknown[] = []
  if (scope.tenantId) { params.push(scope.tenantId); clauses.push(`tenant_id = $${params.length}`) }
  if (scope.projectId) {
    if (t.hasProjectId) {
      params.push(scope.projectId); clauses.push(`project_id = $${params.length}`)
    } else if (t.projectViaBaseline) {
      params.push(scope.projectId)
      clauses.push(`baseline_id IN (SELECT id FROM commissioning_baselines WHERE project_id = $${params.length})`)
    }
    // else: not project-scopable → tenant scope only (warned in buildBundle)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return { where, params }
}
