/**
 * AI Field Assistant — briefing + route tests (v4.48.0)
 */
// ADR-014 Phase 3F: the collection routes below now carry `requireProjectScope`,
// which refuses a malformed project id WITHOUT issuing SQL (fail closed). These
// ids are real uuids so the request still reaches the handler and this stays a
// response-shape smoke test; `nope` became a uuid that simply does not exist.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ADR-014 Phase 2B-3: Despite its name the field briefing reads
// inspections, punch items and schedule dependencies — not field tables —
// so it requires assistant.use AND project.view AND quality.view AND
// schedule.view. Its holders are owner, project manager and engineer; the
// engineer is the narrowest.
// Authorization re-resolves that role from the database on every request,
// so the pool answers the lookup for the caller under test.
const CALLER = vi.hoisted(() => ({ id: 'caller', tenant_id: 'tenant-1', role: 'engineer', is_active: true }))

const mockQuery = vi.fn()
/**
 * ADR-014 Phase 3F — `requireProjectScope` asks whether the caller can reach
 * the project named in the path before the handler runs. Answered here rather
 * than through the scripted mock, for the same reason the current-user lookup
 * already is: an authorization query must not consume a `mockResolvedValueOnce`
 * entry written for the handler's own queries. Whether the guard REFUSES is
 * proved in the Phase-3F behavioural suite, not in this shape smoke test.
 */
const _projectScopeAnswer = (sql: unknown, params: unknown): { rows: unknown[]; rowCount: number } | null => {
  const s = String(sql)
  if (/AS\s+project_id/i.test(s)) return { rows: [{ project_id: '30000000-0000-4000-8000-000000000001' }], rowCount: 1 }
  if (/FROM\s+projects\s+p?\b/i.test(s) && /ANY\(\$\d+::uuid\[\]\)/i.test(s)) {
    // Echo the ids the resolver asked about, so the fixture's own project is
    // the one reported reachable.
    const ids = ((params as unknown[])?.find(x => Array.isArray(x)) as string[] | undefined) ?? []
    return { rows: ids.map(id => ({ id })), rowCount: ids.length }
  }
  return null
}

vi.mock('../db/pool', () => ({
  tenantQuery: (t: string, sql: string, p: unknown[]) => _projectScopeAnswer(sql, p) ?? mockQuery(t, sql, p),
  query:       (sql: string, p: unknown[]) =>
    /FROM\s+users\s+WHERE\s+id/i.test(String(sql))
      ? Promise.resolve({ rows: [CALLER], rowCount: 1 })
      : mockQuery(null, sql, p),
}))
vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: 'u1', tid: 'tenant-1', role: 'engineer' }
    next()
  },
}))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

import { buildFieldBriefing, type FieldInputs } from '../services/field/fieldAssistantService'

const NOW = new Date('2026-06-22T12:00:00Z')

function inputs(over: Partial<FieldInputs> = {}): FieldInputs {
  return { inspections: [], punchItems: [], scheduleClashes: [], ...over }
}

describe('buildFieldBriefing — inspections due', () => {
  it('includes scheduled inspections due today or overdue, excludes future', () => {
    const b = buildFieldBriefing(inputs({
      inspections: [
        { id: 'i1', inspection_number: 'C-1', title: 'Pour', status: 'scheduled', scheduled_date: '2026-06-22', location: 'Area B' },  // today
        { id: 'i2', inspection_number: 'C-2', title: 'Firestop', status: 'scheduled', scheduled_date: '2026-06-15', location: 'Area A' }, // overdue
        { id: 'i3', inspection_number: 'C-3', title: 'Later', status: 'scheduled', scheduled_date: '2026-07-30', location: 'Area C' },     // future
      ],
    }), NOW)
    const refs = b.inspectionsDue.map(i => i.ref)
    expect(refs).toContain('INSP C-1')
    expect(refs).toContain('INSP C-2')
    expect(refs).not.toContain('INSP C-3')
    expect(b.inspectionsDue[0].ref).toBe('INSP C-2') // most overdue first
    expect(b.inspectionsDue.find(i => i.ref === 'INSP C-1')!.note).toBe('due today')
  })
})

describe('buildFieldBriefing — behind schedule', () => {
  it('lists out-of-sequence tasks and overdue punch items', () => {
    const b = buildFieldBriefing(inputs({
      scheduleClashes: [{ succ_id: 'task-aaaa', succ_name: 'Drywall', succ_status: 'in_progress', pred_name: 'Rough-in', pred_status: 'in_progress' }],
      punchItems: [
        { id: 'p1', item_number: 1, title: 'late', priority: 'high', status: 'open', due_date: '2026-06-10', location: 'Area B' },
        { id: 'p2', item_number: 2, title: 'future', priority: 'low', status: 'open', due_date: '2026-08-01', location: 'Area B' },
      ],
    }), NOW)
    const refs = b.behindSchedule.map(i => i.ref)
    expect(refs).toContain('Task task-aaa'.slice(0, 'Task '.length + 8))
    expect(refs).toContain('Punch #1')
    expect(refs).not.toContain('Punch #2') // not overdue
    expect(b.behindSchedule.find(i => i.type === 'schedule')!.note).toMatch(/out of sequence/)
  })
})

describe('buildFieldBriefing — open by area', () => {
  it('collects open items with locations and lists the distinct areas', () => {
    const b = buildFieldBriefing(inputs({
      punchItems: [
        { id: 'p1', item_number: 1, title: 'a', priority: 'high', status: 'open', location: 'Area B' },
        { id: 'p2', item_number: 2, title: 'b', priority: 'low', status: 'open', location: 'Area A' },
      ],
      inspections: [{ id: 'i1', inspection_number: 'C-9', title: 'fail', status: 'completed', overall_result: 'fail', location: 'Area A' }],
    }), NOW)
    expect(b.areas).toEqual(['Area A', 'Area B'])
    expect(b.openItems.length).toBe(3)
    expect(b.openItems.find(i => i.status === 'failed')!.severity).toBe('high')
    expect(b.summary.openItems).toBe(3)
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { fieldAssistantRouter } from '../routes/fieldAssistant'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', fieldAssistantRouter as any)
  return app
}

describe('Field assistant route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /projects/:id/field-assistant returns the three sections', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1' }], rowCount: 1 })  // project exists
      .mockResolvedValueOnce({ rows: [{ id: 'i1', inspection_number: 'C-2', title: 'Firestop', status: 'scheduled', scheduled_date: '2026-06-15', location: 'Area A' }] }) // inspections
      .mockResolvedValueOnce({ rows: [] }) // punch
      .mockResolvedValueOnce({ rows: [] }) // schedule clashes
    const res = await request(makeApp()).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/field-assistant')
    expect(res.status).toBe(200)
    expect(res.body.data.inspectionsDue.length).toBe(1)
    expect(res.body.data.summary).toBeTruthy()
  })

  it('404s for an unknown project', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/projects/30000000-0000-4000-8000-0000000000ff/field-assistant')
    expect(res.status).toBe(404)
  })
})
