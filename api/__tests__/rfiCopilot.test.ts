/**
 * RFI Copilot — similarity / impact + route tests (v4.46.0)
 *
 * The similarity and impact logic is pure; route smoke mirrors the mock-pool pattern.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (t: string, sql: string, p: unknown[]) => mockQuery(t, sql, p),
  query:       (sql: string, p: unknown[]) => mockQuery(null, sql, p),
}))
vi.mock('../auth', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.auth = { sub: 'u1' }; next() } }))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

import { tokenize, jaccard, findSimilarRfis, assessImpact, type RfiLite } from '../services/rfi/rfiCopilotService'

const NOW = new Date('2026-06-22T12:00:00Z')

describe('tokenize / jaccard', () => {
  it('drops stopwords and short tokens', () => {
    const t = tokenize('Please confirm the beam connection detail')
    expect(t.has('beam')).toBe(true)
    expect(t.has('connection')).toBe(true)
    expect(t.has('the')).toBe(false)   // stopword
    expect(t.has('confirm')).toBe(false) // stopword
  })
  it('jaccard of identical sets is 1, disjoint is 0', () => {
    expect(jaccard(tokenize('beam connection'), tokenize('beam connection'))).toBe(1)
    expect(jaccard(tokenize('beam connection'), tokenize('pump curve'))).toBe(0)
  })
})

describe('findSimilarRfis', () => {
  const target: RfiLite = { id: 't', title: 'Beam connection at gridline B', description: 'Confirm bolt pattern' }
  const candidates: RfiLite[] = [
    { id: 'a', rfi_number: '10', title: 'Beam connection bolt pattern gridline B', status: 'answered', response: 'Use 4 bolts' },
    { id: 'b', rfi_number: '11', title: 'Chilled water pump curve', status: 'open', response: null },
    { id: 't', rfi_number: '99', title: 'Beam connection at gridline B', description: 'Confirm bolt pattern' }, // self, excluded
  ]
  it('ranks the relevant prior RFI first and excludes self', () => {
    const out = findSimilarRfis(target, candidates)
    expect(out.map(s => s.rfiNumber)).toContain('10')
    expect(out.map(s => s.id)).not.toContain('t')
    expect(out[0].rfiNumber).toBe('10')
    expect(out[0].hasResponse).toBe(true)
    expect(out[0].similarity).toBeGreaterThan(0)
  })
  it('drops unrelated RFIs below the threshold', () => {
    const out = findSimilarRfis(target, candidates)
    expect(out.map(s => s.rfiNumber)).not.toContain('11')
  })
})

describe('assessImpact', () => {
  it('escalates schedule risk when overdue, critical, and blocking', () => {
    const i = assessImpact({ priority: 'critical', due_date: '2026-06-01' }, 2, NOW)
    expect(i.scheduleRisk).toBe('high')
    expect(i.blockingCount).toBe(2)
    expect(i.daysOverdue).toBe(21)
    expect(i.reasons.join(' ')).toMatch(/critical|overdue|blocking/)
  })
  it('reports low risk for a calm RFI', () => {
    const i = assessImpact({ priority: 'low', due_date: '2026-08-01' }, 0, NOW)
    expect(i.scheduleRisk).toBe('low')
    expect(i.reasons).toContain('no schedule pressure detected')
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { rfiCopilotRouter } from '../routes/rfiCopilot'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/rfis', rfiCopilotRouter as any)
  return app
}

describe('RFI Copilot route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /rfis/:id/copilot returns precedent, responders, and impact', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM rfis WHERE tenant_id=\$1 AND id=\$2/.test(sql)) {
        return { rows: [{ id: 'rfi1', project_id: 'p1', rfi_number: '5', title: 'Beam connection bolt pattern', description: 'gridline B', discipline: 'Structural', priority: 'high', status: 'open', due_date: '2026-06-01' }], rowCount: 1 }
      }
      if (/AND id<>\$3/.test(sql)) return { rows: [{ id: 'rfi2', rfi_number: '2', title: 'Beam connection bolt pattern gridline B', description: '', status: 'answered', response: '4 bolts' }] }
      if (/response_by AS user_id/.test(sql)) return { rows: [{ user_id: 'eng-7', answered: 9 }] }
      if (/relation_type='blocks'/.test(sql)) return { rows: [{ blocking: 1 }] }
      return { rows: [] }
    })
    const res = await request(makeApp()).get('/api/v1/rfis/rfi1/copilot')
    expect(res.status).toBe(200)
    expect(res.body.data.similar.length).toBeGreaterThan(0)
    expect(res.body.data.suggestedResponders[0].userId).toBe('eng-7')
    expect(['medium', 'high']).toContain(res.body.data.impact.scheduleRisk)
  })

  it('404s for an unknown RFI', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/rfis/nope/copilot')
    expect(res.status).toBe(404)
  })
})
