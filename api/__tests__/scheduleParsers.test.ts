/**
 * Schedule import parsers — Primavera P6 XER + MS Project MSPDI (v10.4.0)
 *
 * Round-trips realistic export fixtures through the pure parsers and asserts the
 * P6/MSP-specific normalization: hours→days, baseline-vs-actual date fallback,
 * milestone zeroing, status derivation, WBS-code resolution, predecessor type +
 * lag conversion. These parsers are the data-ingestion entry point, so the
 * fixtures mirror the real on-disk shapes (tab-delimited %T/%F/%R for XER,
 * nested <Task>/<PredecessorLink> for MSPDI).
 */
import { describe, it, expect } from 'vitest'
import { parseXer } from '../services/schedule/xerParser'
import { parseMsp } from '../services/schedule/mspParser'
import { detectFormat } from '../services/schedule/scheduleImportService'

// ─── XER fixture ────────────────────────────────────────────────────────────
// Tab-delimited; built via row() so the delimiter is explicit and unambiguous.

const row = (tag: string, ...vals: string[]) => [tag, ...vals].join('\t')

function buildXer(): string {
  const taskFields = [
    'task_id', 'task_code', 'task_name', 'task_type', 'status_code',
    'wbs_id', 'orig_drtn_hr_cnt', 'target_drtn_hr_cnt',
    'target_start_date', 'target_end_date', 'early_start_date', 'early_end_date',
    'act_start_date', 'act_end_date', 'phys_complete_pct', 'target_cost',
  ]
  // T1: normal, not started, 40h → 5d, baseline dates, cost
  const t1 = ['1001', 'A1000', 'Excavate footings', 'TT_Task', 'TK_NotStart',
    'W1', '40', '40', '2024-01-15', '2024-01-19', '', '', '', '', '0', '12500']
  // T2: active/in-progress, 16h → 2d, has actual start, 50%
  const t2 = ['1002', 'A1010', 'Pour foundation', 'TT_Task', 'TK_Active',
    'W1', '16', '16', '2024-01-22', '2024-01-23', '', '', '2024-01-22', '', '50', '8000']
  // T3: complete, 8h → 1d, both actuals, 100%
  const t3 = ['1003', 'A1020', 'Cure concrete', 'TT_Task', 'TK_Complete',
    'W2', '8', '8', '2024-01-24', '2024-01-24', '', '', '2024-01-24', '2024-01-24', '100', '500']
  // T4: finish milestone — duration must zero out regardless of hours
  const t4 = ['1004', 'M100', 'Foundation complete', 'TT_FinMile', 'TK_NotStart',
    'W2', '0', '0', '2024-01-25', '2024-01-25', '', '', '', '', '0', '0']
  // T5: no baseline dates — must fall back to early_* columns
  const t5 = ['1005', 'A1030', 'Backfill', 'TT_Task', 'TK_NotStart',
    'W1', '24', '24', '', '', '2024-01-26', '2024-01-29', '', '', '0', '3000']

  const predFields = ['task_id', 'pred_task_id', 'pred_type', 'lag_hr_cnt']
  // successor 1002 depends on 1001 (FS, no lag); 1004 on 1003 (FS, 16h = 2d lag)
  const p1 = ['1002', '1001', 'PR_FS', '0']
  const p2 = ['1004', '1003', 'PR_FS', '16']
  const p3 = ['1005', '1002', 'PR_SS', '8']

  return [
    'ERMHDR\t19.12\t2024-01-10\tProject\tadmin',
    '%T PROJECT',
    row('%F', 'proj_id', 'proj_short_name'),
    row('%R', '5001', 'WTP-Phase2'),
    '%E',
    '%T WBS',
    row('%F', 'wbs_id', 'wbs_short_name'),
    row('%R', 'W1', 'CIVIL'),
    row('%R', 'W2', 'CONCRETE'),
    '%E',
    '%T TASK',
    row('%F', ...taskFields),
    row('%R', ...t1),
    row('%R', ...t2),
    row('%R', ...t3),
    row('%R', ...t4),
    row('%R', ...t5),
    '%E',
    '%T TASKPRED',
    row('%F', ...predFields),
    row('%R', ...p1),
    row('%R', ...p2),
    row('%R', ...p3),
    '%E',
  ].join('\n')
}

describe('parseXer (Primavera P6)', () => {
  const s = parseXer(buildXer())

  it('reads the project short-name and all non-empty tasks', () => {
    expect(s.projectName).toBe('WTP-Phase2')
    expect(s.tasks).toHaveLength(5)
    expect(s.warnings).toHaveLength(0)
  })

  it('converts duration hours to whole days (÷8)', () => {
    const t = s.tasks.find(t => t.activityId === 'A1000')!
    expect(t.durationDays).toBe(5)   // 40h / 8
  })

  it('zeroes milestone duration and flags isMilestone', () => {
    const m = s.tasks.find(t => t.activityId === 'M100')!
    expect(m.isMilestone).toBe(true)
    expect(m.durationDays).toBe(0)
  })

  it('resolves wbs_id to its short-name', () => {
    expect(s.tasks.find(t => t.activityId === 'A1000')!.wbsCode).toBe('CIVIL')
    expect(s.tasks.find(t => t.activityId === 'A1020')!.wbsCode).toBe('CONCRETE')
  })

  it('derives status from status_code / percent-complete', () => {
    expect(s.tasks.find(t => t.activityId === 'A1000')!.status).toBe('not_started')
    expect(s.tasks.find(t => t.activityId === 'A1010')!.status).toBe('in_progress')
    expect(s.tasks.find(t => t.activityId === 'A1020')!.status).toBe('complete')
  })

  it('prefers baseline (target_*) dates but falls back to early_* when blank', () => {
    const baseline = s.tasks.find(t => t.activityId === 'A1000')!
    expect(baseline.plannedStart).toBe('2024-01-15')
    expect(baseline.plannedFinish).toBe('2024-01-19')

    const fellBack = s.tasks.find(t => t.activityId === 'A1030')!
    expect(fellBack.plannedStart).toBe('2024-01-26')   // from early_start_date
    expect(fellBack.plannedFinish).toBe('2024-01-29')
  })

  it('carries planned cost and actual dates', () => {
    const t = s.tasks.find(t => t.activityId === 'A1020')!
    expect(t.plannedCost).toBe(500)
    expect(t.actualStart).toBe('2024-01-24')
    expect(t.actualFinish).toBe('2024-01-24')
  })

  it('maps predecessor type and converts lag hours to days', () => {
    expect(s.dependencies).toHaveLength(3)
    const fs = s.dependencies.find(d => d.predecessorExternalId === '1001')!
    expect(fs).toMatchObject({ successorExternalId: '1002', type: 'FS', lagDays: 0 })
    const lagged = s.dependencies.find(d => d.predecessorExternalId === '1003')!
    expect(lagged).toMatchObject({ successorExternalId: '1004', type: 'FS', lagDays: 2 }) // 16h / 8
    const ss = s.dependencies.find(d => d.predecessorExternalId === '1002')!
    expect(ss.type).toBe('SS')
  })

  it('warns on an empty / task-less file instead of throwing', () => {
    const empty = parseXer('ERMHDR\t19.12\n%T PROJECT\n%E')
    expect(empty.tasks).toHaveLength(0)
    expect(empty.warnings).toContain('No TASK table found or file is empty')
  })
})

// ─── MSPDI fixture ──────────────────────────────────────────────────────────

const MSP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>Treatment Plant Fitout</Name>
  <Tasks>
    <Task>
      <UID>0</UID><ID>0</ID><Name>Summary</Name><Duration>PT80H</Duration>
    </Task>
    <Task>
      <UID>1</UID><ID>1</ID><Name>Set anchor bolts</Name>
      <Duration>PT40H</Duration><Start>2024-03-01T08:00:00</Start>
      <Finish>2024-03-05T17:00:00</Finish><PercentComplete>0</PercentComplete>
      <WBS>1.1</WBS><Cost>4000</Cost>
    </Task>
    <Task>
      <UID>2</UID><ID>2</ID><Name>Install pump</Name>
      <Duration>PT16H</Duration><Start>2024-03-06T08:00:00</Start>
      <Finish>2024-03-07T17:00:00</Finish>
      <ActualStart>2024-03-06T08:00:00</ActualStart>
      <PercentComplete>40</PercentComplete><WBS>1.2</WBS><Cost>9000</Cost>
      <PredecessorLink>
        <PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>4800</LinkLag>
      </PredecessorLink>
    </Task>
    <Task>
      <UID>3</UID><ID>3</ID><Name>Commissioning milestone</Name>
      <Milestone>1</Milestone><Duration>PT0H</Duration>
      <Start>2024-03-08T08:00:00</Start><Finish>2024-03-08T08:00:00</Finish>
      <PredecessorLink>
        <PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag>
      </PredecessorLink>
    </Task>
    <Task>
      <UID>4</UID><ID>4</ID><Name>Voided row</Name><IsNull>true</IsNull>
    </Task>
  </Tasks>
</Project>`

describe('parseMsp (MS Project MSPDI)', () => {
  const s = parseMsp(MSP_XML)

  it('reads project name and skips UID-0 summary + IsNull rows', () => {
    expect(s.projectName).toBe('Treatment Plant Fitout')
    expect(s.tasks.map(t => t.externalId)).toEqual(['1', '2', '3'])
  })

  it('parses ISO-8601 duration to days and zeroes milestones', () => {
    expect(s.tasks.find(t => t.externalId === '1')!.durationDays).toBe(5)  // PT40H
    const mile = s.tasks.find(t => t.externalId === '3')!
    expect(mile.isMilestone).toBe(true)
    expect(mile.durationDays).toBe(0)
  })

  it('derives status from percent-complete and actual dates', () => {
    expect(s.tasks.find(t => t.externalId === '1')!.status).toBe('not_started')
    expect(s.tasks.find(t => t.externalId === '2')!.status).toBe('in_progress')
  })

  it('converts LinkLag (tenths of a minute) to whole days', () => {
    // 4800 tenths = 480 min = 1 eight-hour day
    const dep = s.dependencies.find(d => d.successorExternalId === '2')!
    expect(dep).toMatchObject({ predecessorExternalId: '1', type: 'FS', lagDays: 1 })
  })

  it('returns a warning (not a throw) on malformed XML', () => {
    const bad = parseMsp('<Project><Tasks><Task>')
    expect(bad.tasks).toHaveLength(0)
    expect(bad.warnings.length).toBeGreaterThan(0)
  })
})

// ─── Format detection ───────────────────────────────────────────────────────

describe('detectFormat', () => {
  it('detects by file extension', () => {
    expect(detectFormat('schedule.xer', '')).toBe('xer')
    expect(detectFormat('schedule.XER', '')).toBe('xer')
    expect(detectFormat('schedule.xml', '')).toBe('mspdi')
  })

  it('sniffs content when the extension is ambiguous', () => {
    expect(detectFormat('export.dat', 'ERMHDR\t19.12')).toBe('xer')
    expect(detectFormat('export.dat', '<Project xmlns="...">')).toBe('mspdi')
  })

  it('defaults to xer for unknown input', () => {
    expect(detectFormat('mystery', 'random text')).toBe('xer')
  })
})
