/**
 * Denver Engineering — Cross-module Related records (v4.35.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Workflow Redesign W4 (see WORKFLOW_REDESIGN.md §9). Given a record, surface the
 * records connected to it so users never search manually.
 *
 * HONESTY: only relationships that REALLY exist in the schema are returned —
 * foreign keys (change_orders.rfi_id, corrective_actions.ncr_id, punch_items.
 * drawing_id), the unified Action spine (actions.source_module + source_id), and
 * the shared spec_section string for submittals. Links the canonical graph WANTS
 * but the schema lacks (RFI↔Drawing, RFI↔Submittal, Inspection↔Punch, …) are not
 * fabricated. All reads are tenant-scoped (RLS-respecting).
 */
import { tenantQuery } from '../../db/pool'

export interface RelatedItem {
  source:     string
  sourceId:   string
  tab:        string
  parentId:   string | null
  projectId:  string | null
  identifier: string | null
  title:      string
  status:     string | null
}
export interface RelatedGroup { key: string; label: string; items: RelatedItem[] }
export interface RelatedResult { source: string; id: string; groups: RelatedGroup[] }

// Where each record source's canonical screen lives (mirrors CopilotView SOURCE_TAB).
const TAB: Record<string, string> = {
  rfi: 'rfis', submittal: 'submittals', punch: 'punch', inspection: 'inspections',
  action: 'actions', changeorder: 'changeorders', drawing: 'drawings', ncr: 'ncr', capa: 'ncr',
}

type Row = Record<string, unknown>
const s = (v: unknown): string => (v == null ? '' : String(v))
const sn = (v: unknown): string | null => (v == null ? null : String(v))

/** actions linked to a record via the unified Action spine. `module` is the plural table name. */
async function linkedActions(tenantId: string, moduleName: string, id: string): Promise<RelatedItem[]> {
  const r = await tenantQuery(tenantId,
    `SELECT id, title, status, project_id FROM actions WHERE tenant_id=$1 AND source_module=$2 AND source_id=$3 LIMIT 100`,
    [tenantId, moduleName, id])
  return (r.rows as Row[]).map(row => ({
    source: 'action', sourceId: s(row.id), tab: TAB.action, parentId: null,
    projectId: sn(row.project_id), identifier: null, title: s(row.title) || 'Action', status: sn(row.status),
  }))
}

function group(key: string, label: string, items: RelatedItem[]): RelatedGroup | null {
  return items.length ? { key, label, items } : null
}

/** Assemble the related-records groups for a record. Returns only non-empty groups. */
export async function getRelated(tenantId: string, source: string, id: string): Promise<RelatedResult> {
  const groups: (RelatedGroup | null)[] = []

  if (source === 'rfi') {
    const co = await tenantQuery(tenantId,
      `SELECT id, co_number, title, status, project_id FROM change_orders WHERE tenant_id=$1 AND rfi_id=$2 LIMIT 100`, [tenantId, id])
    groups.push(group('changeorders', 'Change orders from this RFI', (co.rows as Row[]).map(r => ({
      source: 'changeorder', sourceId: s(r.id), tab: TAB.changeorder, parentId: null,
      projectId: sn(r.project_id), identifier: r.co_number != null ? `CO ${s(r.co_number)}` : null, title: s(r.title), status: sn(r.status),
    }))))
    groups.push(group('actions', 'Linked actions', await linkedActions(tenantId, 'rfis', id)))
  }

  else if (source === 'changeorder') {
    const rfi = await tenantQuery(tenantId,
      `SELECT r.id, r.rfi_number, r.title, r.status, r.project_id
         FROM rfis r JOIN change_orders c ON c.rfi_id = r.id
        WHERE c.tenant_id=$1 AND c.id=$2 LIMIT 1`, [tenantId, id])
    groups.push(group('rfi', 'Originating RFI', (rfi.rows as Row[]).map(r => ({
      source: 'rfi', sourceId: s(r.id), tab: TAB.rfi, parentId: null,
      projectId: sn(r.project_id), identifier: r.rfi_number != null ? `RFI ${s(r.rfi_number)}` : null, title: s(r.title), status: sn(r.status),
    }))))
  }

  else if (source === 'ncr') {
    const capa = await tenantQuery(tenantId,
      `SELECT id, description, status, project_id FROM corrective_actions WHERE tenant_id=$1 AND ncr_id=$2 LIMIT 100`, [tenantId, id])
    groups.push(group('capa', 'Corrective / preventive actions', (capa.rows as Row[]).map(r => ({
      source: 'capa', sourceId: s(r.id), tab: TAB.capa, parentId: id,
      projectId: sn(r.project_id), identifier: null, title: s(r.description), status: sn(r.status),
    }))))
  }

  else if (source === 'capa') {
    const ncr = await tenantQuery(tenantId,
      `SELECT n.id, n.ncr_number, n.title, n.status, n.project_id
         FROM ncrs n JOIN corrective_actions c ON c.ncr_id = n.id
        WHERE c.tenant_id=$1 AND c.id=$2 LIMIT 1`, [tenantId, id])
    groups.push(group('ncr', 'Parent NCR', (ncr.rows as Row[]).map(r => ({
      source: 'ncr', sourceId: s(r.id), tab: TAB.ncr, parentId: null,
      projectId: sn(r.project_id), identifier: r.ncr_number != null ? `NCR ${s(r.ncr_number)}` : null, title: s(r.title), status: sn(r.status),
    }))))
  }

  else if (source === 'punch') {
    const dwg = await tenantQuery(tenantId,
      `SELECT d.id, d.sheet_number, d.title, d.project_id
         FROM drawings d JOIN punch_items p ON p.drawing_id = d.id
        WHERE p.tenant_id=$1 AND p.id=$2 LIMIT 1`, [tenantId, id])
    groups.push(group('drawing', 'Referenced drawing', (dwg.rows as Row[]).map(r => ({
      source: 'drawing', sourceId: s(r.id), tab: TAB.drawing, parentId: null,
      projectId: sn(r.project_id), identifier: r.sheet_number != null ? s(r.sheet_number) : null, title: s(r.title), status: null,
    }))))
    groups.push(group('actions', 'Linked actions', await linkedActions(tenantId, 'punch_items', id)))
  }

  else if (source === 'drawing') {
    const punch = await tenantQuery(tenantId,
      `SELECT id, item_number, title, status, project_id, punch_list_id FROM punch_items WHERE tenant_id=$1 AND drawing_id=$2 LIMIT 100`, [tenantId, id])
    groups.push(group('punch', 'Punch items on this drawing', (punch.rows as Row[]).map(r => ({
      source: 'punch', sourceId: s(r.id), tab: TAB.punch, parentId: sn(r.punch_list_id),
      projectId: sn(r.project_id), identifier: r.item_number != null ? `PL ${s(r.item_number)}` : null, title: s(r.title), status: sn(r.status),
    }))))
  }

  else if (source === 'submittal') {
    groups.push(group('actions', 'Linked actions', await linkedActions(tenantId, 'submittals', id)))
    // Same spec section — a real shared-key association (not a FK).
    const self = await tenantQuery(tenantId,
      `SELECT spec_section FROM submittals WHERE tenant_id=$1 AND id=$2 LIMIT 1`, [tenantId, id])
    const spec = sn((self.rows[0] as Row | undefined)?.spec_section)
    if (spec) {
      const sib = await tenantQuery(tenantId,
        `SELECT id, submittal_number, title, status, project_id FROM submittals
          WHERE tenant_id=$1 AND spec_section=$2 AND id<>$3 LIMIT 50`, [tenantId, spec, id])
      groups.push(group('spec', `Same spec section (${spec})`, (sib.rows as Row[]).map(r => ({
        source: 'submittal', sourceId: s(r.id), tab: TAB.submittal, parentId: null,
        projectId: sn(r.project_id), identifier: r.submittal_number != null ? `SUB ${s(r.submittal_number)}` : null, title: s(r.title), status: sn(r.status),
      }))))
    }
  }

  else if (source === 'inspection') {
    groups.push(group('actions', 'Linked actions', await linkedActions(tenantId, 'inspections', id)))
  }

  return { source, id, groups: groups.filter((g): g is RelatedGroup => g !== null) }
}

/** Sources for which we have at least one real relationship to surface. */
export const RELATED_SOURCES = new Set(['rfi', 'changeorder', 'ncr', 'capa', 'punch', 'drawing', 'submittal', 'inspection'])
