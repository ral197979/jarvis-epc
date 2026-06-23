/**
 * Denver Engineering — IFC Parse Worker (v10.2.0)
 * ─────────────────────────────────────────────────
 * Processes ifc_parse_jobs: reads an IFC file from storage,
 * parses it with web-ifc, extracts elements + quantities,
 * and writes results to bim_elements via upsertBimElements.
 *
 * web-ifc operates on raw IFC bytes — no geometry rendering,
 * just property extraction. Geometry is handled client-side
 * by the APS viewer or IFC.js.
 *
 * Runs as a background worker polled by the scheduler.
 */
import * as WebIFC from 'web-ifc'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { pool } from '../../db/pool'
import { upsertBimElements, type IfcElementInput } from './bimElementService'

// ─── IFC entity types we care about ──────────────────────────────────────────

const ELEMENT_TYPES = [
  WebIFC.IFCWALL, WebIFC.IFCWALLSTANDARDCASE,
  WebIFC.IFCSLAB, WebIFC.IFCBEAM, WebIFC.IFCCOLUMN,
  WebIFC.IFCDOOR, WebIFC.IFCWINDOW,
  WebIFC.IFCROOF, WebIFC.IFCSTAIR, WebIFC.IFCRAMP,
  WebIFC.IFCFURNISHINGELEMENT,
  WebIFC.IFCPIPESEGMENT, WebIFC.IFCPIPEFITTING,
  WebIFC.IFCDUCTSEGMENT, WebIFC.IFCDUCTFITTING,
  WebIFC.IFCFLOWCONTROLLER, WebIFC.IFCFLOWTERMINAL,
  WebIFC.IFCCABLESEGMENT, WebIFC.IFCCABLEFITTING,
  WebIFC.IFCLIGHTFIXTURE, WebIFC.IFCOUTLET,
  WebIFC.IFCSENSOR, WebIFC.IFCACTUATOR,
  WebIFC.IFCSPACE, WebIFC.IFCZONE,
  WebIFC.IFCBUILDINGELEMENT,
]

// ─── IFC type number → string name ───────────────────────────────────────────

// Build reverse map from WebIFC constants
const TYPE_NAMES: Record<number, string> = {}
for (const [key, val] of Object.entries(WebIFC)) {
  if (typeof val === 'number' && key.startsWith('IFC')) {
    TYPE_NAMES[val] = key
  }
}

// ─── Parse a single IFC file buffer ──────────────────────────────────────────

export async function parseIfcBuffer(
  ifcBuffer: Buffer,
  tenantId:  string,
  modelId:   string,
): Promise<{ parsed: number; errors: string[] }> {
  const errors: string[] = []
  const api = new WebIFC.IfcAPI()
  await api.Init()

  const modelHandle = api.OpenModel(new Uint8Array(ifcBuffer))
  const elements: IfcElementInput[] = []

  for (const typeId of ELEMENT_TYPES) {
    let ids: number[]
    try {
      ids = Array.from(api.GetLineIDsWithType(modelHandle, typeId)).map((n: number) => Number(n))
    } catch {
      continue
    }

    for (const id of ids) {
      try {
        const el = api.GetLine(modelHandle, id, true) as Record<string, unknown>
        const ifcType = TYPE_NAMES[typeId] ?? `IFC_TYPE_${typeId}`

        // Extract GlobalId (IFC GUID)
        const guidVal = el['GlobalId'] as Record<string, unknown> | undefined
        const ifc_guid: string = (guidVal?.['value'] as string) ?? String(id)

        // Name
        const nameVal = el['Name'] as Record<string, unknown> | undefined
        const name: string | undefined = (nameVal?.['value'] as string) || undefined

        // Description
        const descVal = el['Description'] as Record<string, unknown> | undefined
        const description: string | undefined = (descVal?.['value'] as string) || undefined

        // Object placement → rough centroid (simplified — full geometry is viewer's job)
        let centroid: Record<string, unknown> | undefined
        try {
          const geo = api.GetFlatMesh(modelHandle, id)
          if (geo.geometries.size() > 0) {
            const g = geo.geometries.get(0)
            const t = g.flatTransformation
            // Column 3 of 4x4 matrix = translation
            centroid = { x: Math.round(t[12]! * 100) / 100, y: Math.round(t[13]! * 100) / 100, z: Math.round(t[14]! * 100) / 100 }
          }
        } catch { /* geometry optional */ }

        // Property sets
        const properties: Record<string, unknown> = {}
        const quantities: Record<string, unknown> = {}

        try {
          const psets = await api.properties.getPropertySets(modelHandle, id) as unknown[]
          for (const pset of psets) {
            const ps = pset as Record<string, unknown>
            const psetName = ((ps['Name'] as Record<string, unknown>)?.['value'] as string) ?? 'Pset'
            const props = (ps['HasProperties'] ?? ps['Quantities']) as unknown[] | undefined
            if (!Array.isArray(props)) continue

            const isQset = psetName.includes('Quantity') || psetName.includes('BaseQuantities')
            for (const prop of props) {
              const p = prop as Record<string, unknown>
              const pName = ((p['Name'] as Record<string, unknown>)?.['value'] as string) ?? ''
              const nomVal = p['NominalValue'] as Record<string, unknown> | undefined
              const lengthVal = p['LengthValue'] as Record<string, unknown> | undefined
              const areaVal  = p['AreaValue']   as Record<string, unknown> | undefined
              const volVal   = p['VolumeValue'] as Record<string, unknown> | undefined
              const val = nomVal?.['value'] ?? lengthVal?.['value'] ?? areaVal?.['value'] ?? volVal?.['value']
              if (val !== undefined) {
                if (isQset) quantities[pName] = val
                else        properties[pName] = val
              }
            }
          }
        } catch { /* property extraction optional */ }

        elements.push({
          ifc_guid,
          ifc_type: ifcType,
          name,
          description,
          properties,
          quantities,
          centroid,
        })
      } catch (e) {
        errors.push(`Element ${id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  api.CloseModel(modelHandle)

  const { inserted, updated } = await upsertBimElements(tenantId, modelId, elements)
  return { parsed: inserted + updated, errors }
}

// ─── Worker: claim and process one job ───────────────────────────────────────

const WORKER_ID = `ifc-worker-${process.pid}`
const LOCK_MINUTES = 10

export async function processNextIfcJob(): Promise<boolean> {
  const client = await pool.connect()
  let jobId: string | null = null

  try {
    await client.query('BEGIN')

    // Claim next pending/failed job
    const claim = await client.query(
      `UPDATE ifc_parse_jobs SET
         status      = 'running',
         locked_by   = $1,
         locked_until = now() + interval '${LOCK_MINUTES} minutes',
         attempts    = attempts + 1,
         started_at  = now()
       WHERE id = (
         SELECT id FROM ifc_parse_jobs
         WHERE status IN ('pending','failed')
           AND attempts < max_attempts
           AND run_after <= now()
           AND (locked_until IS NULL OR locked_until < now())
         ORDER BY run_after ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, tenant_id, model_id, storage_key`,
      [WORKER_ID],
    )

    if (!claim.rows[0]) { await client.query('COMMIT'); return false }

    const job = claim.rows[0] as {
      id: string; tenant_id: string; model_id: string; storage_key: string
    }
    jobId = job.id
    await client.query('COMMIT')

    // Read file from storage_key
    // In production this would fetch from S3/GCS. For local/Render: try local path.
    const localPath = job.storage_key.startsWith('/') ? job.storage_key : null
    if (!localPath || !existsSync(localPath)) {
      // Mark as failed — storage integration not configured
      await pool.query(
        `UPDATE ifc_parse_jobs SET status='failed', error=$1, completed_at=now()
         WHERE id=$2`,
        [`Storage key not accessible locally: ${job.storage_key}`, job.id],
      )
      return true
    }

    const buffer = await readFile(localPath)
    const { parsed, errors } = await parseIfcBuffer(buffer, job.tenant_id, job.model_id)

    await pool.query(
      `UPDATE ifc_parse_jobs SET
         status='completed', elements_parsed=$1, error=$2,
         locked_by=NULL, locked_until=NULL, completed_at=now()
       WHERE id=$3`,
      [parsed, errors.length ? errors.slice(0, 5).join('; ') : null, job.id],
    )

    return true
  } catch (err) {
    if (jobId) {
      await pool.query(
        `UPDATE ifc_parse_jobs SET status='failed', error=$1, locked_by=NULL, locked_until=NULL, completed_at=now()
         WHERE id=$2`,
        [err instanceof Error ? err.message : String(err), jobId],
      ).catch(() => {})
    } else {
      await client.query('ROLLBACK').catch(() => {})
    }
    return false
  } finally {
    client.release()
  }
}

// ─── Register as a scheduled background worker ────────────────────────────────

let _interval: ReturnType<typeof setInterval> | null = null

export function startIfcParseWorker(pollMs = 15_000): void {
  if (_interval) return
  _interval = setInterval(async () => {
    try { await processNextIfcJob() } catch { /* logged by processNextIfcJob */ }
  }, pollMs)
}

export function stopIfcParseWorker(): void {
  if (_interval) { clearInterval(_interval); _interval = null }
}
