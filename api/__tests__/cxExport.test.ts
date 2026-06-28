/**
 * Tests: api/scripts/cxExport.ts (export/parity core)
 *
 * Pure logic — no DB, no FS. Fixtures are fed through fetchRows/countRows so we
 * can assert determinism, checksums, scope SQL, and parity detection (row
 * mismatch, orphans, missing references) without a database.
 */
import { describe, it, expect } from 'vitest'
import {
  TABLES, SCHEMA_VERSION, stableStringify, serializeNdjson, sha256, scopeSql, buildBundle,
  type TableSpec,
} from '../scripts/cxExport'

const spec = (name: string): TableSpec => {
  const t = TABLES.find(x => x.name === name)
  if (!t) throw new Error(`no spec ${name}`)
  return t
}

// Fixture provider: { tableName: rows[] }. countRows defaults to rows.length
// unless an explicit counts map overrides it (to simulate parity mismatch).
function provider(fixtures: Record<string, Record<string, unknown>[]>, counts?: Record<string, number>) {
  return {
    fetchRows: async (t: TableSpec) => fixtures[t.name] ?? [],
    countRows: async (t: TableSpec) => counts?.[t.name] ?? (fixtures[t.name]?.length ?? 0),
  }
}

describe('stableStringify', () => {
  it('is key-order independent', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
  })
  it('serializes Date as ISO and sorts nested keys', () => {
    const d = new Date('2026-06-25T12:00:00.000Z')
    expect(stableStringify({ z: d, a: { y: 1, x: 2 } }))
      .toBe('{"a":{"x":2,"y":1},"z":"2026-06-25T12:00:00.000Z"}')
  })
  it('preserves array order and nulls undefined', () => {
    expect(stableStringify({ arr: [3, 1, 2], u: undefined })).toBe('{"arr":[3,1,2],"u":null}')
  })
})

describe('serializeNdjson + sha256', () => {
  it('empty rows → empty string', () => {
    expect(serializeNdjson([])).toBe('')
  })
  it('one object per line with trailing newline', () => {
    expect(serializeNdjson([{ id: 'a' }, { id: 'b' }])).toBe('{"id":"a"}\n{"id":"b"}\n')
  })
  it('checksum is stable across equal content', () => {
    expect(sha256('x')).toBe(sha256('x'))
    expect(sha256('x')).not.toBe(sha256('y'))
  })
})

describe('scopeSql', () => {
  it('tenant only', () => {
    expect(scopeSql(spec('test_packs'), { tenantId: 't1', projectId: null }))
      .toEqual({ where: 'WHERE tenant_id = $1', params: ['t1'] })
  })
  it('tenant + project for a table with project_id', () => {
    expect(scopeSql(spec('test_packs'), { tenantId: 't1', projectId: 'p1' }))
      .toEqual({ where: 'WHERE tenant_id = $1 AND project_id = $2', params: ['t1', 'p1'] })
  })
  it('project via baseline subquery for observations (no project_id column)', () => {
    const r = scopeSql(spec('commissioning_observations'), { tenantId: 't1', projectId: 'p1' })
    expect(r.params).toEqual(['t1', 'p1'])
    expect(r.where).toContain('baseline_id IN (SELECT id FROM commissioning_baselines WHERE project_id = $2)')
  })
  it('no scope → no where', () => {
    expect(scopeSql(spec('ncrs'), { tenantId: null, projectId: null })).toEqual({ where: '', params: [] })
  })
})

describe('buildBundle', () => {
  const NOW = '2026-06-25T00:00:00.000Z'
  const subset = [spec('test_packs'), spec('test_results'), spec('deficiencies')]

  const fixtures = {
    test_packs: [{ id: 'tp1', tenant_id: 't1', project_id: 'p1', system_id: 'sys1', pack_no: 'TP-001' }],
    test_results: [{ id: 'tr1', tenant_id: 't1', project_id: 'p1', test_pack_id: 'tp1', step_no: 1 }],
    deficiencies: [{ id: 'd1', tenant_id: 't1', project_id: 'p1', test_pack_id: 'tp1', test_result_id: 'tr1', code: 'D-1' }],
  }

  it('produces files, manifest, and a passing parity report', async () => {
    const b = await buildBundle({ scope: { tenantId: 't1', projectId: 'p1' }, now: NOW, tables: subset, ...provider(fixtures) })
    expect(b.files.map(f => f.name)).toEqual(['test_packs.ndjson', 'test_results.ndjson', 'deficiencies.ndjson'])
    expect(b.manifest.schemaVersion).toBe(SCHEMA_VERSION)
    expect(b.manifest.totals).toEqual({ tables: 3, rows: 3 })
    expect(b.manifest.scope).toEqual({ org: 't1', tenant: 't1', project: 'p1' })
    expect(b.parity.ok).toBe(true)
    // manifest checksum matches the file content checksum
    const tp = b.files.find(f => f.name === 'test_packs.ndjson')!
    expect(b.manifest.tables[0].checksum).toBe(tp.checksum)
  })

  it('is idempotent: identical checksums across runs', async () => {
    const a = await buildBundle({ scope: { tenantId: 't1', projectId: 'p1' }, now: NOW, tables: subset, ...provider(fixtures) })
    const c = await buildBundle({ scope: { tenantId: 't1', projectId: 'p1' }, now: 'different', tables: subset, ...provider(fixtures) })
    expect(a.files.map(f => f.checksum)).toEqual(c.files.map(f => f.checksum))
  })

  it('flags a row-count mismatch', async () => {
    const b = await buildBundle({
      scope: { tenantId: 't1', projectId: 'p1' }, now: NOW, tables: subset,
      ...provider(fixtures, { test_packs: 5 }),  // COUNT says 5, only 1 exported
    })
    expect(b.parity.ok).toBe(false)
    const tp = b.parity.tables.find(t => t.table === 'test_packs')!
    expect(tp.rowsOk).toBe(false)
    expect(tp.expectedRows).toBe(5)
    expect(tp.exportedRows).toBe(1)
  })

  it('detects orphans (child FK with no in-bundle parent)', async () => {
    const orphaned = {
      ...fixtures,
      test_results: [{ id: 'tr9', tenant_id: 't1', project_id: 'p1', test_pack_id: 'GHOST', step_no: 1 }],
    }
    const b = await buildBundle({ scope: { tenantId: 't1', projectId: 'p1' }, now: NOW, tables: subset, ...provider(orphaned) })
    expect(b.parity.ok).toBe(false)
    const tr = b.parity.tables.find(t => t.table === 'test_results')!
    expect(tr.orphans).toHaveLength(1)
    expect(tr.orphans[0]).toMatchObject({ column: 'test_pack_id', parentTable: 'test_packs', count: 1, sampleIds: ['tr9'] })
  })

  it('counts missing (external) references', async () => {
    const b = await buildBundle({ scope: { tenantId: 't1', projectId: 'p1' }, now: NOW, tables: subset, ...provider(fixtures) })
    const tp = b.parity.tables.find(t => t.table === 'test_packs')!
    const sys = tp.missingReferences.find(m => m.column === 'system_id')
    expect(sys).toMatchObject({ targetTable: 'systems', nonNullCount: 1 })
  })

  it('covers all nine execution tables in the default set', () => {
    expect(TABLES.map(t => t.name)).toEqual([
      'test_packs', 'test_results', 'deficiencies', 'ncrs', 'corrective_actions',
      'punch_lists', 'punch_items', 'commissioning_baselines', 'commissioning_observations',
    ])
  })
})
