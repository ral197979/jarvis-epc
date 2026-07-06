/**
 * Denver Engineering — Primavera P6 XER Parser (v10.4.0)
 * ────────────────────────────────────────────────────────
 * Parses Primavera P6 XER export format into a normalized ImportSchedule.
 *
 * XER format:
 *   ERMHDR<tab>...<header line>
 *   %T TABLE_NAME
 *   %F field1<tab>field2<tab>...
 *   %R value1<tab>value2<tab>...   (one row per %R line)
 *   %E                             (end of table)
 *
 * We extract: PROJECT, TASK, TASKPRED, WBS
 */

export interface ImportTask {
  externalId:    string       // P6 task_id
  activityId:    string       // task_code (e.g. A1000)
  name:          string
  wbsCode:       string | null
  durationDays:  number
  isMilestone:   boolean
  plannedStart:  string | null  // ISO date
  plannedFinish: string | null
  actualStart:   string | null
  actualFinish:  string | null
  percentComplete: number
  status:        'not_started' | 'in_progress' | 'complete'
  plannedCost:   number
}

export interface ImportDependency {
  predecessorExternalId: string
  successorExternalId:   string
  lagDays:               number
  type:                  'FS' | 'SS' | 'FF' | 'SF'
}

export interface ImportSchedule {
  projectName:   string
  tasks:         ImportTask[]
  dependencies:  ImportDependency[]
  warnings:      string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseXerDate(val: string | undefined): string | null {
  if (!val || val.trim() === '') return null
  // P6 dates: "2024-01-15" or "2024-01-15 00:00" or "15-JAN-24"
  const s = val.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function hrsToDays(hrs: number | undefined): number {
  if (!hrs || isNaN(hrs)) return 0
  return Math.max(0, Math.round(hrs / 8))
}

// XER rows always contain every %F column, so a missing value is a blank string
// rather than undefined — `??` would not treat it as absent. Use this for any
// "prefer A, fall back to B" column pair.
function firstNonBlank(...vals: (string | undefined)[]): string | undefined {
  for (const v of vals) if (v && v.trim() !== '') return v
  return undefined
}

const PRED_TYPE_MAP: Record<string, ImportDependency['type']> = {
  PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF',
}

// ─── XER table parser ─────────────────────────────────────────────────────────

function parseXerTables(text: string): Record<string, Record<string, string>[]> {
  const tables: Record<string, Record<string, string>[]> = {}
  let currentTable = ''
  let fields: string[] = []

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.startsWith('%T ')) {
      currentTable = line.slice(3).trim()
      fields = []
      tables[currentTable] = []
    } else if (line.startsWith('%F\t') || line === '%F') {
      fields = line.slice(2).split('\t').map(f => f.trim())
    } else if (line.startsWith('%R\t') || line === '%R') {
      const vals = line.slice(2).split('\t')
      const row: Record<string, string> = {}
      fields.forEach((f, i) => { row[f] = (vals[i] ?? '').trim() })
      if (currentTable) tables[currentTable]!.push(row)
    }
    // %E = end of table, ERMHDR = header — skip
  }
  return tables
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function parseXer(content: string): ImportSchedule {
  const warnings: string[] = []
  const tables = parseXerTables(content)

  // Project name
  const projRows = tables['PROJECT'] ?? []
  const projectName = projRows[0]?.['proj_short_name'] ?? projRows[0]?.['proj_id'] ?? 'Imported Project'

  // WBS code lookup: wbs_id → wbs_short_name
  const wbsMap = new Map<string, string>()
  for (const row of tables['WBS'] ?? []) {
    if (row['wbs_id'] && row['wbs_short_name']) {
      wbsMap.set(row['wbs_id'], row['wbs_short_name'])
    }
  }

  // Tasks
  const tasks: ImportTask[] = []
  for (const row of tables['TASK'] ?? []) {
    const externalId = row['task_id']
    if (!externalId) continue

    const name = row['task_name'] ?? row['task_code'] ?? `Task ${externalId}`
    const taskType = row['task_type'] ?? ''
    const isMilestone = taskType === 'TT_Mile' || taskType === 'TT_FinMile'

    // Duration: prefer orig_drtn_hr_cnt, fall back to target_drtn_hr_cnt
    const durationHrs = parseFloat(row['orig_drtn_hr_cnt'] ?? row['target_drtn_hr_cnt'] ?? '0')
    const durationDays = isMilestone ? 0 : hrsToDays(durationHrs)

    // Dates: prefer target (baseline) dates, fall back to early dates
    const plannedStart  = parseXerDate(firstNonBlank(row['target_start_date'], row['early_start_date']))
    const plannedFinish = parseXerDate(firstNonBlank(row['target_end_date'],   row['early_end_date']))
    const actualStart   = parseXerDate(row['act_start_date'])
    const actualFinish  = parseXerDate(row['act_end_date'])

    const pct = parseFloat(row['phys_complete_pct'] ?? row['act_drtn_hr_cnt'] ?? '0')
    const percentComplete = isNaN(pct) ? 0 : Math.min(100, Math.max(0, pct))

    const statusCode = row['status_code'] ?? 'TK_NotStart'
    const status: ImportTask['status'] =
      statusCode === 'TK_Complete' || percentComplete >= 100 ? 'complete'
      : statusCode === 'TK_Active' ? 'in_progress'
      : 'not_started'

    const wbsCode = row['wbs_id'] ? (wbsMap.get(row['wbs_id']) ?? null) : null
    const plannedCost = parseFloat(row['target_cost'] ?? '0') || 0

    tasks.push({
      externalId, activityId: row['task_code'] ?? externalId,
      name, wbsCode, durationDays, isMilestone,
      plannedStart, plannedFinish, actualStart, actualFinish,
      percentComplete, status, plannedCost,
    })
  }

  // Dependencies
  const dependencies: ImportDependency[] = []
  for (const row of tables['TASKPRED'] ?? []) {
    const successorId  = row['task_id']
    const predecessorId = row['pred_task_id']
    if (!successorId || !predecessorId) continue
    const lagHrs  = parseFloat(row['lag_hr_cnt'] ?? '0')
    const lagDays = Math.round(lagHrs / 8)
    const type    = PRED_TYPE_MAP[row['pred_type'] ?? ''] ?? 'FS'
    dependencies.push({ predecessorExternalId: predecessorId, successorExternalId: successorId, lagDays, type })
  }

  if (!tasks.length) warnings.push('No TASK table found or file is empty')

  return { projectName, tasks, dependencies, warnings }
}
