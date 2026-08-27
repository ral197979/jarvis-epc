/**
 * Denver Engineering — BIM Element Service (v10.0.0)
 * ─────────────────────────────────────────────────────
 * Parses IFC property payloads into bim_elements rows,
 * queues async IFC parse jobs, and links elements to
 * platform entities (assets, systems, punch items, etc.).
 *
 * IFC geometry rendering is delegated to Autodesk Platform
 * Services (APS) or IFC.js — this service owns the data
 * layer only (element registry, quantities, property sets).
 */
import { pool, tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IfcElementInput {
  ifc_guid:    string
  ifc_type:    string
  name?:       string
  description?: string
  discipline?: string
  level?:      string
  zone?:       string
  status?:     string
  bounding_box?: Record<string, unknown>
  centroid?:   Record<string, unknown>
  properties?: Record<string, unknown>
  quantities?: Record<string, unknown>
  material?:   string
  load_bearing?: boolean
  is_external?: boolean
  asset_id?:   string
  system_id?:  string
}

export interface BimElement {
  id:          string
  tenant_id:   string
  model_id:    string
  ifc_guid:    string
  ifc_type:    string
  name:        string | null
  description: string | null
  discipline:  string | null
  level:       string | null
  zone:        string | null
  status:      string
  properties:  Record<string, unknown>
  quantities:  Record<string, unknown>
  material:    string | null
  load_bearing: boolean | null
  is_external: boolean | null
  asset_id:    string | null
  system_id:   string | null
  created_at:  string
  updated_at:  string
}

// ─── IFC type → discipline mapping ───────────────────────────────────────────

const IFC_DISCIPLINE_MAP: Record<string, string> = {
  IfcWall:                 'structural',
  IfcWallStandardCase:     'structural',
  IfcSlab:                 'structural',
  IfcBeam:                 'structural',
  IfcColumn:               'structural',
  IfcFoundation:           'structural',
  IfcRoof:                 'structural',
  IfcStair:                'architectural',
  IfcDoor:                 'architectural',
  IfcWindow:               'architectural',
  IfcSpace:                'architectural',
  IfcZone:                 'architectural',
  IfcPipeSegment:          'mechanical',
  IfcPipeFitting:          'mechanical',
  IfcDuctSegment:          'mechanical',
  IfcDuctFitting:          'mechanical',
  IfcFlowTerminal:         'mechanical',
  IfcFlowController:       'mechanical',
  IfcCableSegment:         'electrical',
  IfcCableFitting:         'electrical',
  IfcElectricDistributionBoard: 'electrical',
  IfcLightFixture:         'electrical',
  IfcOutlet:               'electrical',
  IfcSensor:               'instrumentation',
  IfcActuator:             'instrumentation',
  IfcController:           'instrumentation',
}

function inferDiscipline(ifcType: string): string | null {
  return IFC_DISCIPLINE_MAP[ifcType] ?? null
}

// ─── Upsert elements (batch) ──────────────────────────────────────────────────

export async function upsertBimElements(
  tenantId: string,
  modelId:  string,
  elements: IfcElementInput[],
): Promise<{ inserted: number; updated: number }> {
  if (!elements.length) return { inserted: 0, updated: 0 }

  let inserted = 0
  let updated  = 0
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`)

    for (const el of elements) {
      const discipline = el.discipline ?? inferDiscipline(el.ifc_type)
      const res = await client.query(
        `INSERT INTO bim_elements
           (tenant_id, model_id, ifc_guid, ifc_type, name, description,
            discipline, level, zone, status, bounding_box, centroid,
            properties, quantities, material, load_bearing, is_external,
            asset_id, system_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (tenant_id, model_id, ifc_guid) DO UPDATE SET
           name         = EXCLUDED.name,
           description  = EXCLUDED.description,
           discipline   = EXCLUDED.discipline,
           level        = EXCLUDED.level,
           zone         = EXCLUDED.zone,
           status       = EXCLUDED.status,
           bounding_box = EXCLUDED.bounding_box,
           centroid     = EXCLUDED.centroid,
           properties   = EXCLUDED.properties,
           quantities   = EXCLUDED.quantities,
           material     = EXCLUDED.material,
           load_bearing = EXCLUDED.load_bearing,
           is_external  = EXCLUDED.is_external,
           asset_id     = EXCLUDED.asset_id,
           system_id    = EXCLUDED.system_id,
           updated_at   = now()
         RETURNING (xmax = 0) AS was_inserted`,
        [
          tenantId, modelId, el.ifc_guid, el.ifc_type,
          el.name ?? null, el.description ?? null,
          discipline, el.level ?? null, el.zone ?? null,
          el.status ?? 'unknown',
          el.bounding_box ? JSON.stringify(el.bounding_box) : null,
          el.centroid     ? JSON.stringify(el.centroid)     : null,
          JSON.stringify(el.properties ?? {}),
          JSON.stringify(el.quantities ?? {}),
          el.material    ?? null,
          el.load_bearing ?? null,
          el.is_external  ?? null,
          el.asset_id    ?? null,
          el.system_id   ?? null,
        ],
      )
      if (res.rows[0]?.was_inserted) inserted++
      else updated++
    }

    // Update model element_count
    await client.query(
      `UPDATE bim_models SET element_count = (
         SELECT count(*) FROM bim_elements WHERE model_id = $1 AND tenant_id = $2
       ), updated_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [modelId, tenantId],
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return { inserted, updated }
}

// ─── Query elements ───────────────────────────────────────────────────────────

export async function getModelElements(
  tenantId:  string,
  modelId:   string,
  opts: { ifc_type?: string; discipline?: string; level?: string; limit?: number; offset?: number } = {},
): Promise<{ elements: BimElement[]; total: number }> {
  const params: unknown[] = [tenantId, modelId]
  const filters: string[] = []

  if (opts.ifc_type)   { params.push(opts.ifc_type);   filters.push(`ifc_type = $${params.length}`) }
  if (opts.discipline) { params.push(opts.discipline);  filters.push(`discipline = $${params.length}`) }
  if (opts.level)      { params.push(opts.level);       filters.push(`level = $${params.length}`) }

  const where = filters.length ? `AND ${filters.join(' AND ')}` : ''
  const limit  = Math.min(opts.limit  ?? 100, 500)
  const offset = opts.offset ?? 0

  const [rows, count] = await Promise.all([
    tenantQuery(tenantId,
      `SELECT * FROM bim_elements WHERE tenant_id=$1 AND model_id=$2 ${where}
       ORDER BY ifc_type, name LIMIT ${limit} OFFSET ${offset}`,
      params),
    tenantQuery(tenantId,
      `SELECT count(*) FROM bim_elements WHERE tenant_id=$1 AND model_id=$2 ${where}`,
      params),
  ])

  return { elements: rows.rows as BimElement[], total: parseInt(count.rows[0]?.count ?? '0') }
}

/**
 * One element, bound to the model whose path addressed it.
 *
 * ADR-014 Phase 3J §22: `/bim-models/:modelId/elements/:id` is authorized on the
 * MODEL, so the lookup must be constrained to that model — otherwise the guard
 * proves the caller may read model A while the query hands them an element of
 * model B, which may belong to a project they cannot reach. The parent id is a
 * boundary, not decoration (D27).
 */
export async function getElementById(
  tenantId: string, elementId: string, modelId: string,
): Promise<BimElement | null> {
  const res = await tenantQuery(tenantId,
    'SELECT * FROM bim_elements WHERE id=$1 AND tenant_id=$2 AND model_id=$3',
    [elementId, tenantId, modelId])
  return (res.rows[0] as BimElement) ?? null
}

// ─── Element links ────────────────────────────────────────────────────────────

/**
 * Link an element to a business entity.
 *
 * ADR-014 Phase 3J §22/§23: the INSERT selects its element through the model in
 * the path, so an element belonging to another model cannot be linked through a
 * model the caller happens to be authorized for. Returns false when the element
 * is not part of that model, which the route answers as a 404.
 */
export async function linkElementToEntity(
  tenantId:   string,
  elementId:  string,
  modelId:    string,
  entityType: string,
  entityId:   string,
  linkedBy:   string,
  context?:   string,
): Promise<boolean> {
  const res = await tenantQuery(tenantId,
    `INSERT INTO bim_element_links (tenant_id, element_id, entity_type, entity_id, linked_by, context)
     SELECT $1, e.id, $3, $4, $5, $6
       FROM bim_elements e
      WHERE e.id = $2 AND e.tenant_id = $1 AND e.model_id = $7
     ON CONFLICT (tenant_id, element_id, entity_type, entity_id) DO NOTHING`,
    [tenantId, elementId, entityType, entityId, linkedBy, context ?? null, modelId])
  if ((res.rowCount ?? 0) > 0) return true
  // A zero rowCount is ambiguous: either the element is not in this model, or
  // the link already existed. Distinguish, so an idempotent re-link still succeeds.
  const own = await tenantQuery(tenantId,
    'SELECT 1 FROM bim_elements WHERE id=$1 AND tenant_id=$2 AND model_id=$3',
    [elementId, tenantId, modelId])
  return (own.rowCount ?? 0) > 0
}

export async function getElementLinks(
  tenantId:  string,
  elementId: string,
): Promise<{ entity_type: string; entity_id: string; context: string | null; linked_at: string }[]> {
  const res = await tenantQuery(tenantId,
    `SELECT entity_type, entity_id, context, linked_at
     FROM bim_element_links WHERE tenant_id=$1 AND element_id=$2
     ORDER BY linked_at DESC`,
    [tenantId, elementId])
  return res.rows as { entity_type: string; entity_id: string; context: string | null; linked_at: string }[]
}

// ─── IFC parse job queue ──────────────────────────────────────────────────────

export async function enqueueIfcParseJob(
  tenantId:   string,
  modelId:    string,
  storageKey: string,
): Promise<string> {
  const res = await tenantQuery(tenantId,
    `INSERT INTO ifc_parse_jobs (tenant_id, model_id, storage_key)
     VALUES ($1,$2,$3) RETURNING id`,
    [tenantId, modelId, storageKey])
  return res.rows[0].id as string
}

export async function getParseJobStatus(
  tenantId: string,
  modelId:  string,
): Promise<{ status: string; elements_parsed: number | null; error: string | null } | null> {
  const res = await tenantQuery(tenantId,
    `SELECT status, elements_parsed, error FROM ifc_parse_jobs
     WHERE tenant_id=$1 AND model_id=$2
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, modelId])
  const row = res.rows[0]
  if (!row) return null
  return row as { status: string; elements_parsed: number | null; error: string | null }
}

// ─── Quantity summary for takeoff ─────────────────────────────────────────────
// Aggregates BaseQuantities from BIM elements, grouped by IFC type + discipline.

export async function getModelQuantitySummary(
  tenantId: string,
  modelId:  string,
): Promise<{
  ifc_type:   string
  discipline: string | null
  count:      number
  total_area:   number | null
  total_volume: number | null
  total_length: number | null
}[]> {
  const res = await tenantQuery(tenantId,
    `SELECT
       ifc_type,
       discipline,
       count(*)::int                                              AS count,
       sum((quantities->>'GrossArea')::numeric)                  AS total_area,
       sum((quantities->>'GrossVolume')::numeric)                AS total_volume,
       sum((quantities->>'Length')::numeric)                     AS total_length
     FROM bim_elements
     WHERE tenant_id=$1 AND model_id=$2
     GROUP BY ifc_type, discipline
     ORDER BY count DESC`,
    [tenantId, modelId])
  return res.rows as {
    ifc_type: string; discipline: string | null; count: number
    total_area: number | null; total_volume: number | null; total_length: number | null
  }[]
}
