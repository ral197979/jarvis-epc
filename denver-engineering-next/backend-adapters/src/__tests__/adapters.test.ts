import { describe, it, expect } from 'vitest'
import { portfolioAdapter, commissioningAdapter, financeAdapter, twinAdapter } from '../adapters'

describe('digital twin adapter (mock)', () => {
  it('returns assets with telemetry channels', async () => {
    const assets = await twinAdapter.assets()
    expect(assets.length).toBeGreaterThan(0)
    const op = assets.find((a) => a.status === 'Operational')
    expect(op?.telemetry.length).toBeGreaterThan(0)
    expect(op?.telemetry[0]).toHaveProperty('unit')
    expect(op?.telemetry[0].max).toBeGreaterThan(op!.telemetry[0].min)
  })
})

describe('commissioning Phase 3 adapters (mock)', () => {
  it('returns PFC items with checksheet counts', async () => {
    const pfc = await commissioningAdapter.pfc()
    expect(pfc.length).toBeGreaterThan(0)
    expect(pfc[0].checksTotal).toBeGreaterThan(0)
  })
  it('returns FPT scripts with steps', async () => {
    const scripts = await commissioningAdapter.fptScripts()
    expect(scripts.every((s) => Array.isArray(s.steps) && s.steps.length > 0)).toBe(true)
  })
  it('returns IST sequences with ordered steps', async () => {
    const seqs = await commissioningAdapter.istSequences()
    expect(seqs[0].steps[0].seq).toBe(1)
  })
  it('returns turnover packages with document items', async () => {
    const pkgs = await commissioningAdapter.turnoverPackages()
    expect(pkgs.every((p) => p.items.length > 0)).toBe(true)
  })
})

describe('createProject (mock write)', () => {
  it('appends a new project that the list then returns', async () => {
    const before = (await portfolioAdapter.projects()).length
    const created = await portfolioAdapter.createProject({
      code: 'PRJ-TEST-9',
      name: 'Coastal Desalination Plant',
      client: 'AquaCorp',
      region: 'AMER',
      phase: 'Engineering',
      budget: 420_000_000,
    })
    expect(created.code).toBe('PRJ-TEST-9')
    expect(created.contractValue).toBe('$420M')
    expect(created.health).toBe('healthy')
    expect(created.progressPct).toBe(0)
    const after = await portfolioAdapter.projects()
    expect(after.length).toBe(before + 1)
    expect(after.some((p) => p.code === 'PRJ-TEST-9')).toBe(true)
  })
})

describe('createDeficiency (mock write)', () => {
  it('appends a new deficiency that the registry then returns', async () => {
    const before = (await commissioningAdapter.deficiencies()).length
    const created = await commissioningAdapter.createDeficiency({
      projectId: 'PRJ-2024-004',
      code: 'DEF-TEST',
      title: 'Pump seal weeping',
      severity: 'critical',
    })
    expect(created.id).toBe('DEF-TEST')
    expect(created.category).toBe('A') // critical → Cat A
    expect(created.status).toBe('Open')
    const after = await commissioningAdapter.deficiencies()
    expect(after.length).toBe(before + 1)
    expect(after.some((d) => d.id === 'DEF-TEST')).toBe(true)
  })

  it('updates a deficiency status in place (mock write)', async () => {
    const created = await commissioningAdapter.createDeficiency({
      projectId: 'PRJ-2024-004',
      code: 'DEF-UPD',
      title: 'Damper actuator sticking',
      severity: 'medium',
    })
    expect(created.status).toBe('Open')
    const updated = await commissioningAdapter.updateDeficiencyStatus(created, 'closed')
    expect(updated.status).toBe('Closed')
    const list = await commissioningAdapter.deficiencies()
    expect(list.find((d) => d.id === 'DEF-UPD')?.status).toBe('Closed')
  })
})

describe('adapter layer (mock mode)', () => {
  it('returns portfolio KPIs', async () => {
    const kpis = await portfolioAdapter.kpis()
    expect(kpis.totalContractValue).toMatch(/\$/)
    expect(kpis.onTrack).toBeGreaterThan(0)
  })

  it('returns a complete commissioning matrix', async () => {
    const matrix = await commissioningAdapter.matrix()
    expect(matrix.length).toBeGreaterThan(0)
    for (const sys of matrix) {
      expect(sys.tag).toBeTruthy()
      expect(Object.keys(sys.cells).length).toBeGreaterThan(0)
    }
  })

  it('returns an EVM summary with CPI/SPI', async () => {
    const evm = await financeAdapter.summary()
    expect(evm.cpi).toBeGreaterThan(0)
    expect(evm.spi).toBeGreaterThan(0)
  })
})
