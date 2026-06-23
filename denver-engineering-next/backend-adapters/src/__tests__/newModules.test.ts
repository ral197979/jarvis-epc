import { describe, it, expect } from 'vitest'
import {
  inventoryAdapter,
  scheduleAdapter,
  scenarioAdapter,
  procurementAdapter,
  contractsAdapter,
  safetyAdapter,
  closeoutAdapter,
  reportsAdapter,
  mitigationAdapter,
  mobileAdapter,
  riskAdapter,
  maintenanceAdapter,
  financeAdapter,
} from '../adapters'

describe('Stitch-B new module adapters (mock)', () => {
  it('inventory: materials carry stock + status', async () => {
    const m = await inventoryAdapter.materials()
    expect(m.length).toBeGreaterThan(0)
    expect(m[0]).toHaveProperty('available')
    expect(m.some((x) => x.status === 'Out')).toBe(true)
  })
  it('inventory: requisitions + receiving resolve', async () => {
    expect((await inventoryAdapter.requisitions()).length).toBeGreaterThan(0)
    const grns = await inventoryAdapter.receiving()
    expect(grns.every((g) => g.qtyExpected >= g.qtyReceived || g.status === 'Discrepancy')).toBe(true)
  })
  it('schedule: gantt tasks are ordered with milestones', async () => {
    const g = await scheduleAdapter.gantt()
    expect(g.length).toBeGreaterThan(0)
    expect(g.some((t) => t.milestone)).toBe(true)
    expect(g.every((t) => typeof t.progressPct === 'number')).toBe(true)
  })
  it('procurement: vendor scores include tiers + status', async () => {
    const v = await procurementAdapter.vendorScores()
    expect(v.some((x) => x.tier === 'Strategic')).toBe(true)
    expect(v.some((x) => x.status === 'Blocking')).toBe(true)
  })
  it('scenarios: modeled with cost + schedule impact', async () => {
    const s = await scenarioAdapter.list()
    expect(s.some((x) => x.status === 'Recommended')).toBe(true)
    expect(s.some((x) => x.status === 'Rejected')).toBe(true)
  })
  it('contracts: compliance items include a breach', async () => {
    const c = await contractsAdapter.compliance()
    expect(c.some((x) => x.status === 'Breach')).toBe(true)
  })
  it('safety: incidents include an LTI + training has an expired cert', async () => {
    const inc = await safetyAdapter.incidents()
    expect(inc.some((x) => x.type === 'LTI')).toBe(true)
    const tr = await safetyAdapter.training()
    expect(tr.some((x) => x.status === 'Expired')).toBe(true)
  })
  it('closeout: ledger spans categories with outstanding items', async () => {
    const l = await closeoutAdapter.ledger()
    expect(new Set(l.map((x) => x.category)).size).toBeGreaterThan(1)
    expect(l.some((x) => x.status === 'Outstanding')).toBe(true)
  })
  it('reports: templates + generated reports resolve', async () => {
    expect((await reportsAdapter.templates()).length).toBeGreaterThan(0)
    const recent = await reportsAdapter.recent()
    expect(recent.some((r) => r.status === 'Ready')).toBe(true)
    expect(recent.some((r) => r.status === 'Scheduled')).toBe(true)
  })
  it('mitigation: plans recover schedule + resource shifts in motion', async () => {
    const plans = await mitigationAdapter.plans()
    expect(plans.some((p) => p.scheduleImpactDays < 0)).toBe(true)
    expect(plans.some((p) => p.severity === 'Critical')).toBe(true)
    const shifts = await mitigationAdapter.shifts()
    expect(shifts.some((s) => s.status === 'Confirmed')).toBe(true)
  })
  it('mobile: field assignments + a sync conflict in the queue', async () => {
    const a = await mobileAdapter.assignments()
    expect(a.length).toBeGreaterThan(0)
    const q = await mobileAdapter.syncQueue()
    expect(q.some((s) => s.status === 'Conflict')).toBe(true)
  })
  it('schedule P6: activities have critical-path + float; WBS + baselines resolve', async () => {
    const acts = await scheduleAdapter.activities()
    expect(acts.some((a) => a.critical)).toBe(true)
    expect(acts.some((a) => a.floatDays < 0 || a.floatDays >= 0)).toBe(true)
    expect((await scheduleAdapter.wbs()).length).toBeGreaterThan(0)
    expect((await scheduleAdapter.baselines()).some((b) => b.varianceDays > 0)).toBe(true)
  })
  it('risk: register has a critical entry + a depleted contingency reserve', async () => {
    expect((await riskAdapter.entries()).some((r) => r.severity === 'Critical')).toBe(true)
    expect((await riskAdapter.contingency()).some((c) => c.status === 'Depleted')).toBe(true)
  })
  it('maintenance: overdue task + asset register + lifecycle forecast', async () => {
    expect((await maintenanceAdapter.tasks()).some((t) => t.status === 'Overdue')).toBe(true)
    expect((await maintenanceAdapter.assets()).length).toBeGreaterThan(0)
    expect((await maintenanceAdapter.lifecycle()).every((l) => l.remainingPct <= 100)).toBe(true)
  })
  it('finance deep-dive: cash flow points + drawdown requests', async () => {
    expect((await financeAdapter.cashFlow()).some((c) => c.net < 0)).toBe(true)
    expect((await financeAdapter.drawdowns()).some((d) => d.status === 'Review')).toBe(true)
  })
  it('safety: audits with findings + a suspended site-access badge', async () => {
    expect((await safetyAdapter.audits()).some((a) => a.openFindings > 0)).toBe(true)
    expect((await safetyAdapter.siteAccess()).some((b) => b.status === 'Suspended')).toBe(true)
  })
})
