/**
 * Denver Engineering — Schedule Import Service (v10.4.0)
 * ────────────────────────────────────────────────────────
 * Orchestrates XER / MSPDI file import into schedule_tasks + schedule_dependencies.
 * Idempotent: re-importing the same external ID UPSERTs existing tasks.
 */
import { tenantQuery } from '../../db/pool'
import { parseXer }  from './xerParser'
import { parseMsp }  from './mspParser'
import type { ImportSchedule, ImportTask, ImportDependency } from './xerParser'

export type ImportFormat = 'xer' | 'mspdi'

export interface ImportJobResult {
  jobId:         string
  tasksImported: number
  tasksUpdated:  number
  depsImported:  number
  warnings:      string[]
}

// ─── Detect format from filename / content ────────────────────────────────────

export function detectFormat(filename: string, content: string): ImportFormat {
  if (filename.toLowerCase().endsWith('.xer')) return 'xer'
  if (filename.toLowerCase().endsWith('.xml')) return 'mspdi'
  // Content sniff
  if (content.includes('ERMHDR') || content.includes('%T PROJECT')) return 'xer'
  if (content.includes('<Project') || content.includes('mspdi')) return 'mspdi'
  return 'xer'  // default
}

// ─── Parse dispatch ───────────────────────────────────────────────────────────

export function parseSchedule(content: string, format: ImportFormat): ImportSchedule {
  return format === 'mspdi' ? parseMsp(content) : parseXer(content)
}

// ─── Import into DB ───────────────────────────────────────────────────────────

export async function importSchedule(
  tenantId:  string,
  projectId: string,
  filename:  string,
  content:   string,
  importedBy?: string,
): Promise<ImportJobResult> {
  const format  = detectFormat(filename, content)
  const schedule = parseSchedule(content, format)

  // Create import job
  const jobRes = await tenantQuery(tenantId,
    `INSERT INTO schedule_import_jobs
       (tenant_id, project_id, format, status, filename, file_size_bytes, imported_by, started_at)
     VALUES ($1,$2,$3,'running',$4,$5,$6,now()) RETURNING id`,
    [tenantId, projectId, format, filename, Buffer.byteLength(content), importedBy ?? null],
  )
  const jobId = jobRes.rows[0].id as string

  let tasksImported = 0
  let tasksUpdated  = 0
  let depsImported  = 0
  const warnings    = [...schedule.warnings]

  try {
    // Load existing external_id → task_id map for this project
    const mapRes = await tenantQuery(tenantId,
      `SELECT external_id, task_id FROM schedule_import_id_map WHERE tenant_id=$1 AND project_id=$2`,
      [tenantId, projectId],
    )
    const existingMap = new Map<string, string>(
      mapRes.rows.map(r => [r.external_id as string, r.task_id as string])
    )

    // Upsert tasks
    const externalToUuid = new Map<string, string>()

    for (const task of schedule.tasks) {
      try {
        const existing = existingMap.get(task.externalId)
        let taskId: string

        if (existing) {
          // Update existing task
          await tenantQuery(tenantId,
            `UPDATE schedule_tasks SET
               name=$3, wbs_code=$4, duration_days=$5, is_milestone=$6,
               planned_start=$7, planned_finish=$8,
               actual_start=$9, actual_finish=$10,
               percent_complete=$11, status=$12, planned_cost=$13,
               updated_at=now()
             WHERE id=$1 AND tenant_id=$2`,
            [existing, tenantId, task.name, task.wbsCode ?? task.activityId,
             task.durationDays, task.isMilestone,
             task.plannedStart, task.plannedFinish,
             task.actualStart, task.actualFinish,
             task.percentComplete, task.status, task.plannedCost],
          )
          taskId = existing
          tasksUpdated++
        } else {
          // Insert new task
          const ins = await tenantQuery(tenantId,
            `INSERT INTO schedule_tasks
               (tenant_id, project_id, name, wbs_code, duration_days, is_milestone,
                planned_start, planned_finish, actual_start, actual_finish,
                percent_complete, status, planned_cost)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING id`,
            [tenantId, projectId, task.name, task.wbsCode ?? task.activityId,
             task.durationDays, task.isMilestone,
             task.plannedStart, task.plannedFinish,
             task.actualStart, task.actualFinish,
             task.percentComplete, task.status, task.plannedCost],
          )
          taskId = ins.rows[0].id as string
          tasksImported++

          // Record ID mapping
          await tenantQuery(tenantId,
            `INSERT INTO schedule_import_id_map
               (tenant_id, project_id, import_job_id, external_id, task_id)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (tenant_id, project_id, external_id)
             DO UPDATE SET task_id=$5, import_job_id=$3`,
            [tenantId, projectId, jobId, task.externalId, taskId],
          )
        }

        externalToUuid.set(task.externalId, taskId)
      } catch (e) {
        warnings.push(`Task ${task.externalId} (${task.name}): ${(e as Error).message}`)
      }
    }

    // Import dependencies (delete old ones for this project, re-insert)
    if (schedule.dependencies.length > 0) {
      // Collect all task UUIDs involved
      const taskIds = [...externalToUuid.values()]
      if (taskIds.length > 0) {
        await tenantQuery(tenantId,
          `DELETE FROM schedule_dependencies
           WHERE tenant_id=$1 AND predecessor_id = ANY($2) AND successor_id = ANY($2)`,
          [tenantId, taskIds],
        )
      }

      for (const dep of schedule.dependencies) {
        const predId = externalToUuid.get(dep.predecessorExternalId)
        const succId = externalToUuid.get(dep.successorExternalId)
        if (!predId || !succId) {
          warnings.push(`Dep ${dep.predecessorExternalId}→${dep.successorExternalId}: task not found`)
          continue
        }
        try {
          await tenantQuery(tenantId,
            `INSERT INTO schedule_dependencies
               (tenant_id, predecessor_id, successor_id, lag_days)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT DO NOTHING`,
            [tenantId, predId, succId, dep.lagDays],
          )
          depsImported++
        } catch (e) {
          warnings.push(`Dep ${dep.predecessorExternalId}→${dep.successorExternalId}: ${(e as Error).message}`)
        }
      }
    }

    // Mark job complete
    await tenantQuery(tenantId,
      `UPDATE schedule_import_jobs SET
         status='completed', tasks_imported=$2, tasks_updated=$3,
         deps_imported=$4, warnings=$5, completed_at=now()
       WHERE id=$1`,
      [jobId, tasksImported, tasksUpdated, depsImported, JSON.stringify(warnings)],
    )
  } catch (err) {
    await tenantQuery(tenantId,
      `UPDATE schedule_import_jobs SET status='failed', error=$2, completed_at=now() WHERE id=$1`,
      [jobId, (err as Error).message],
    ).catch(() => {})
    throw err
  }

  return { jobId, tasksImported, tasksUpdated, depsImported, warnings }
}

// ─── Job history ──────────────────────────────────────────────────────────────

export async function listImportJobs(tenantId: string, projectId: string) {
  const res = await tenantQuery(tenantId,
    `SELECT id, format, status, filename, file_size_bytes,
            tasks_imported, tasks_updated, deps_imported,
            warnings, error, imported_by, started_at, completed_at, created_at
     FROM schedule_import_jobs
     WHERE tenant_id=$1 AND project_id=$2
     ORDER BY created_at DESC LIMIT 20`,
    [tenantId, projectId],
  )
  return res.rows
}
