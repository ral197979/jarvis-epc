import { describe, it, expect } from 'vitest'
import {
  mapDrawing,
  mapDocument,
  mapAction,
  type RawDrawing,
  type RawDocument,
  type RawAction,
} from '../live/registriesLive'

describe('mapDrawing (live → UI)', () => {
  const r: RawDrawing = {
    id: 'uuid-d', sheet_number: 'DWG-P-201', title: 'P&ID Process Area 200',
    discipline: 'Process', current_rev: 'C', issue_date: '2024-06-01T00:00:00Z', metadata: null,
  }
  it('maps sheet_number/title/discipline/rev and dates the issue', () => {
    const d = mapDrawing(r)
    expect(d.id).toBe('DWG-P-201')
    expect(d.rev).toBe('C')
    expect(d.due).toBe('2024-06-01')
    expect(d.status).toBe('Issued') // default when not in metadata
    expect(d.reviewer).toBe('—')
  })
  it('reads status/reviewer from metadata when present', () => {
    const d = mapDrawing({ ...r, metadata: { status: 'in_review', reviewer: 'S. Pena' } })
    expect(d.status).toBe('In review')
    expect(d.reviewer).toBe('S. Pena')
  })
})

describe('mapDocument (live → UI)', () => {
  it('maps title/type/version/status/owner/updated', () => {
    const r: RawDocument = {
      id: 'uuid-doc', document_number: 'DOC-9001', title: 'Project Execution Plan',
      type: 'plan', current_version: 4, status: 'approved', created_at: '2024-05-30T10:00:00Z',
      uploaded_by_name: 'A. Sterling', uploaded_at: '2024-06-01T08:00:00Z',
    }
    const d = mapDocument(r)
    expect(d.id).toBe('DOC-9001')
    expect(d.type).toBe('Plan')
    expect(d.rev).toBe('4')
    expect(d.status).toBe('Approved')
    expect(d.owner).toBe('A. Sterling')
    expect(d.updated).toBe('2024-06-01')
  })
})

describe('mapAction (live → UI)', () => {
  it('maps title/priority/assignee/status and uses action_type as source fallback', () => {
    const r: RawAction = {
      id: 'uuid-a', title: 'Verify alternative turbine vendor', priority: 'critical',
      status: 'open', action_type: 'procurement_risk', due_at: '2024-06-21T00:00:00Z',
      assigned_user_email: 'rokoye@denver.eng', source: null,
    }
    const a = mapAction(r)
    expect(a.priority).toBe('Critical')
    expect(a.assignee).toBe('rokoye@denver.eng')
    expect(a.due).toBe('2024-06-21')
    expect(a.status).toBe('Open')
    expect(a.source).toBe('Procurement risk')
  })
})
