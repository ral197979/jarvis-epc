/**
 * Denver Engineering — MS Project XML (MSPDI) Parser (v10.4.0)
 * ──────────────────────────────────────────────────────────────
 * Parses Microsoft Project XML format (MSPDI / .xml export) into
 * a normalized ImportSchedule using fast-xml-parser.
 *
 * MS Project UID 0 is the project summary task — skipped.
 * Duration is in PT<N>H format (ISO 8601): "PT80H" = 80 hours = 10 days.
 */
import { XMLParser } from 'fast-xml-parser'
import type { ImportSchedule, ImportTask, ImportDependency } from './xerParser'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseMspDate(val: unknown): string | null {
  if (!val || typeof val !== 'string') return null
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function parseDuration(val: unknown): number {
  // ISO 8601 duration: PT8H, PT40H, P5DT0H, etc.
  if (!val || typeof val !== 'string') return 0
  const hoursMatch = val.match(/(\d+(?:\.\d+)?)H/)
  const daysMatch  = val.match(/(\d+(?:\.\d+)?)D/)
  let hours = hoursMatch ? parseFloat(hoursMatch[1]!) : 0
  const days  = daysMatch  ? parseFloat(daysMatch[1]!)  : 0
  hours += days * 8
  return Math.max(0, Math.round(hours / 8))
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function parseMsp(content: string): ImportSchedule {
  const warnings: string[] = []

  const parser = new XMLParser({
    ignoreAttributes:    false,
    attributeNamePrefix: '@_',
    parseTagValue:       true,
    parseAttributeValue: true,
    isArray: (name) => ['Task', 'PredecessorLink'].includes(name),
  })

  let parsed: Record<string, unknown>
  try {
    parsed = parser.parse(content) as Record<string, unknown>
  } catch (e) {
    return { projectName: 'Unknown', tasks: [], dependencies: [], warnings: [`XML parse error: ${e}`] }
  }

  // Navigate: Project > Tasks > Task  (namespace-aware fallback)
  const root = (parsed['Project'] ?? parsed['msp:Project'] ?? {}) as Record<string, unknown>
  const projectName = (root['Name'] as string) ?? 'Imported Project'

  const tasksNode = (root['Tasks'] ?? {}) as Record<string, unknown>
  const rawTasks  = (tasksNode['Task'] as unknown[]) ?? []

  // UID → task map (for dependency resolution)
  const uidToExternal = new Map<number, string>()
  const tasks: ImportTask[] = []

  for (const raw of rawTasks) {
    const t = raw as Record<string, unknown>
    const uid = Number(t['UID'])
    if (uid === 0 || isNaN(uid)) continue  // project summary task / malformed row (no valid UID)

    const externalId = String(uid)
    const activityId = (t['ID'] as string | number)?.toString() ?? externalId
    const name       = (t['Name'] as string) ?? `Task ${uid}`

    // Type 1 = Summary, 0 = normal, milestone flag
    const isMilestone = Boolean(t['Milestone'])
    const isNull      = t['IsNull'] === true || t['IsNull'] === 'true'
    if (isNull) continue

    const durationDays = isMilestone ? 0 : parseDuration(t['Duration'])
    const plannedStart  = parseMspDate(t['Start'])
    const plannedFinish = parseMspDate(t['Finish'])
    const actualStart   = parseMspDate(t['ActualStart'])
    const actualFinish  = parseMspDate(t['ActualFinish'])

    const pct = Number(t['PercentComplete'] ?? t['PercentWorkComplete'] ?? 0)
    const percentComplete = isNaN(pct) ? 0 : Math.min(100, Math.max(0, pct))

    const status: ImportTask['status'] =
      percentComplete >= 100 || actualFinish != null ? 'complete'
      : actualStart != null || percentComplete > 0   ? 'in_progress'
      : 'not_started'

    const wbsCode    = (t['WBS'] as string) ?? null
    const plannedCost = Number(t['Cost'] ?? t['FixedCost'] ?? 0) || 0

    uidToExternal.set(uid, externalId)
    tasks.push({
      externalId, activityId, name, wbsCode,
      durationDays, isMilestone,
      plannedStart, plannedFinish, actualStart, actualFinish,
      percentComplete, status, plannedCost,
    })
  }

  // Dependencies: PredecessorLink inside each Task
  const dependencies: ImportDependency[] = []
  const TYPE_MAP: Record<number, ImportDependency['type']> = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' }

  for (const raw of rawTasks) {
    const t = raw as Record<string, unknown>
    const uid = Number(t['UID'])
    if (uid === 0) continue
    const succExtId = uidToExternal.get(uid)
    if (!succExtId) continue

    const links = (t['PredecessorLink'] as unknown[]) ?? []
    for (const link of links) {
      const l = link as Record<string, unknown>
      const predUid = Number(l['PredecessorUID'])
      const predExtId = uidToExternal.get(predUid)
      if (!predExtId) { warnings.push(`Unknown predecessor UID ${predUid}`); continue }
      // LinkLag is in tenths of a minute: minutes = LinkLag/10, days = minutes/480 (8-hour workday)
      const lagMinutes = Number(l['LinkLag'] ?? 0) / 10
      const lagDays    = Math.round(lagMinutes / 480)
      const typeNum = Number(l['Type'] ?? 1)
      const type    = TYPE_MAP[typeNum] ?? 'FS'
      dependencies.push({ predecessorExternalId: predExtId, successorExternalId: succExtId, lagDays, type })
    }
  }

  if (!tasks.length) warnings.push('No tasks found in MS Project XML')

  return { projectName, tasks, dependencies, warnings }
}
