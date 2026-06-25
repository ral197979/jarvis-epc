/**
 * Denver Engineering — Commissioning export bundle RUNNER (Phase C, PR-3)
 * ──────────────────────────────────────────────────────────────────────────────
 * Read-only export of commissioning-execution tables into a portable bundle
 * (NDJSON + manifest + parity report) for later ingest by the future
 * Commissioning repo. No deletions, no Denver mutation, no live transfer.
 *
 * Usage:
 *   tsx api/scripts/cxExportRun.ts [--tenant=<uuid>] [--project=<uuid>] \
 *       [--out=<dir>] [--now=<iso>]
 *
 * Environment:
 *   DATABASE_URL — required (reads via the admin pool; RLS-exempt, scoped by
 *                  explicit WHERE so a tenant/project filter is honored).
 *
 * Idempotent: same DB state + same scope → byte-identical NDJSON + checksums.
 * Re-running overwrites the output dir (no appends/dupes). Pass --now for a
 * fully deterministic manifest (otherwise exportedAt is the wall clock).
 *
 * See CX_EXPORT_INGEST.md and COMMISSIONING_EXTRACTION_PLAN.md §4 Phase C.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { initPool, pool, query } from '../db/pool'
import {
  TABLES, buildBundle, scopeSql, sha256,
  type Scope, type TableSpec, type ParityReport,
} from './cxExport'

interface Args { tenantId: string | null; projectId: string | null; outDir: string; now: string }

function parseArgs(argv: string[]): Args {
  const get = (k: string) => {
    const hit = argv.find(a => a.startsWith(`--${k}=`))
    return hit ? hit.slice(k.length + 3) : null
  }
  return {
    tenantId: get('tenant'),
    projectId: get('project'),
    outDir: get('out') ?? path.resolve(process.cwd(), 'cx-export-bundle'),
    now: get('now') ?? new Date().toISOString(),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const scope: Scope = { tenantId: args.tenantId, projectId: args.projectId }

  if (!scope.tenantId) {
    console.warn('[cx-export] WARNING: no --tenant given — exporting ALL tenants (full migration bundle).')
  }

  await initPool()

  const fetchRows = async (t: TableSpec) => {
    const { where, params } = scopeSql(t, scope)
    // table name is from the fixed TABLES allowlist (not user input) → safe to interpolate.
    const r = await query(`SELECT * FROM ${t.name} ${where} ORDER BY id`, params)
    return r.rows as Record<string, unknown>[]
  }
  const countRows = async (t: TableSpec) => {
    const { where, params } = scopeSql(t, scope)
    const r = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${t.name} ${where}`, params)
    return parseInt(r.rows[0]?.n ?? '0', 10)
  }

  const bundle = await buildBundle({ scope, now: args.now, tables: TABLES, fetchRows, countRows })

  // ── Write NDJSON files (overwrite → idempotent) ──────────────────────────────
  await fs.mkdir(args.outDir, { recursive: true })
  for (const f of bundle.files) {
    await fs.writeFile(path.join(args.outDir, f.name), f.content, 'utf8')
  }

  // ── Checksum round-trip: re-read each file and verify against the manifest ────
  const byTable = new Map(bundle.manifest.tables.map(e => [e.table, e]))
  for (const entry of bundle.parity.tables) {
    const man = byTable.get(entry.table)
    if (!man) continue
    const disk = await fs.readFile(path.join(args.outDir, man.file), 'utf8')
    const diskChecksum = sha256(disk)
    entry.checksumOk = diskChecksum === man.checksum
    if (!entry.checksumOk) {
      entry.warnings.push(`checksum mismatch on disk: manifest=${man.checksum} disk=${diskChecksum}`)
      bundle.parity.warnings.push(`[${entry.table}] disk checksum mismatch`)
      bundle.parity.ok = false
    }
  }

  // ── Write manifest + parity report ───────────────────────────────────────────
  await fs.writeFile(path.join(args.outDir, 'manifest.json'), JSON.stringify(bundle.manifest, null, 2) + '\n', 'utf8')
  await fs.writeFile(path.join(args.outDir, 'parity_report.json'), JSON.stringify(bundle.parity, null, 2) + '\n', 'utf8')

  printSummary(args.outDir, bundle.parity, bundle.manifest.totals.rows)

  await pool.end()
  if (!bundle.parity.ok) process.exitCode = 2
}

function printSummary(outDir: string, parity: ParityReport, totalRows: number): void {
  console.log(`\n[cx-export] bundle written to ${outDir}`)
  console.log(`  scope: tenant=${parity.scope.tenant ?? 'ALL'} project=${parity.scope.project ?? 'ALL'}`)
  console.log(`  total rows: ${totalRows}`)
  for (const t of parity.tables) {
    const flags = [
      t.rowsOk ? null : 'ROW-MISMATCH',
      t.checksumOk ? null : 'CHECKSUM-FAIL',
      t.orphans.length ? `${t.orphans.reduce((a, o) => a + o.count, 0)} ORPHANS` : null,
    ].filter(Boolean).join(', ')
    console.log(`  ${t.exportedRows === t.expectedRows ? '✓' : '✗'} ${t.table.padEnd(26)} ${String(t.exportedRows).padStart(7)} rows${flags ? '  ⚠ ' + flags : ''}`)
  }
  console.log(`\n  PARITY: ${parity.ok ? 'OK ✓' : 'FAILED ✗'}  (${parity.warnings.length} warnings)`)
}

main().catch(err => {
  console.error('[cx-export][fatal]', err)
  process.exit(1)
})
