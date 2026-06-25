/**
 * Denver Engineering — EPC Core / readiness scope service (v4.56.0)
 * ──────────────────────────────────────────────────────────────────────────────
 * Readiness SCOPE registry: systems, subsystems, tags (equipment), and
 * commissioning_items (what NEEDS commissioning). This is orchestration/readiness
 * data that stays in Denver.
 *
 * In PR-2 of the commissioning extraction (COMMISSIONING_EXTRACTION_PLAN.md §4
 * Phase B) the EXECUTION helpers (test_packs, test_results, deficiencies, tag/pack
 * coverage) moved to cxExecution.ts, and the shared kernel (types, errors, scope
 * guards) moved to epcShared.ts. This file re-exports the shared types/errors so
 * existing importers keep working unchanged.
 *
 * All helpers use tenantQuery so Row Level Security and `app.current_tenant_id`
 * session-context are set correctly on every call.
 */

import { tenantQuery } from '../db/pool'
import {
  type AuditCtx,
  ValidationError,
  NotFoundError,
  assertSystemInScope,
  assertSubsystemInScope,
} from './epcShared'

// Back-compat re-exports: callers that imported these from epcCore still work.
export { ValidationError, NotFoundError } from './epcShared'
export type { AuditCtx } from './epcShared'

// ─── SYSTEMS ──────────────────────────────────────────────────────────────────

export interface CreateSystemInput {
  code:         string
  name:         string
  description?: string | null
  status?:      string
}

export interface UpdateSystemInput {
  code?:        string
  name?:        string
  description?: string | null
  status?:      string
}

export async function listSystems(ctx: Pick<AuditCtx, 'tenantId' | 'projectId'>) {
  const r = await tenantQuery(ctx.tenantId, `
    SELECT id, code, name, description, status, created_at, updated_at
    FROM systems
    WHERE project_id = $1
      AND tenant_id  = current_setting('app.current_tenant_id', true)::uuid
    ORDER BY code
  `, [ctx.projectId])
  return r.rows
}

export async function createSystem(ctx: AuditCtx, payload: CreateSystemInput) {
  const r = await tenantQuery(ctx.tenantId, `
    INSERT INTO systems
      (tenant_id, project_id, code, name, description, status, created_by, updated_by)
    VALUES
      (current_setting('app.current_tenant_id', true)::uuid, $1, $2, $3, $4, $5, $6, $6)
    RETURNING id, code, name, description, status, created_at, updated_at
  `, [
    ctx.projectId, payload.code, payload.name,
    payload.description ?? null, payload.status ?? 'draft',
    ctx.userId,
  ])
  return r.rows[0]
}

export async function updateSystem(
  ctx: Pick<AuditCtx, 'tenantId' | 'userId'>,
  systemId: string,
  payload: UpdateSystemInput,
) {
  const fields: [string, unknown][] = []
  if (payload.code        !== undefined) fields.push(['code',        payload.code])
  if (payload.name        !== undefined) fields.push(['name',        payload.name])
  if (payload.description !== undefined) fields.push(['description', payload.description])
  if (payload.status      !== undefined) fields.push(['status',      payload.status])
  if (fields.length === 0) throw new ValidationError('no updatable fields provided')
  fields.push(['updated_by', ctx.userId])

  const sets   = fields.map(([col], i) => `${col} = $${i + 1}`).join(', ')
  const values = fields.map(([, v]) => v)
  values.push(systemId)

  const r = await tenantQuery(ctx.tenantId, `
    UPDATE systems
    SET ${sets}
    WHERE id = $${values.length}
      AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
    RETURNING id, code, name, description, status, updated_at
  `, values)
  if (!r.rows[0]) throw new NotFoundError('system_not_found')
  return r.rows[0]
}

// ─── SUBSYSTEMS ───────────────────────────────────────────────────────────────

export interface CreateSubsystemInput {
  code:         string
  name:         string
  description?: string | null
  status?:      string
}

export interface UpdateSubsystemInput {
  code?:        string
  name?:        string
  description?: string | null
  status?:      string
}

export async function createSubsystem(
  ctx: AuditCtx,
  systemId: string,
  payload: CreateSubsystemInput,
) {
  await assertSystemInScope(ctx, systemId)
  const r = await tenantQuery(ctx.tenantId, `
    INSERT INTO subsystems
      (tenant_id, project_id, system_id, code, name, description, status, created_by, updated_by)
    VALUES
      (current_setting('app.current_tenant_id', true)::uuid, $1, $2, $3, $4, $5, $6, $7, $7)
    RETURNING id, system_id, code, name, description, status, created_at, updated_at
  `, [
    ctx.projectId, systemId, payload.code, payload.name,
    payload.description ?? null, payload.status ?? 'draft',
    ctx.userId,
  ])
  return r.rows[0]
}

export async function updateSubsystem(
  ctx: Pick<AuditCtx, 'tenantId' | 'userId'>,
  subsystemId: string,
  payload: UpdateSubsystemInput,
) {
  const fields: [string, unknown][] = []
  if (payload.code        !== undefined) fields.push(['code',        payload.code])
  if (payload.name        !== undefined) fields.push(['name',        payload.name])
  if (payload.description !== undefined) fields.push(['description', payload.description])
  if (payload.status      !== undefined) fields.push(['status',      payload.status])
  if (fields.length === 0) throw new ValidationError('no updatable fields provided')
  fields.push(['updated_by', ctx.userId])

  const sets   = fields.map(([col], i) => `${col} = $${i + 1}`).join(', ')
  const values = fields.map(([, v]) => v)
  values.push(subsystemId)

  const r = await tenantQuery(ctx.tenantId, `
    UPDATE subsystems
    SET ${sets}
    WHERE id = $${values.length}
      AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
    RETURNING id, system_id, code, name, description, status, updated_at
  `, values)
  if (!r.rows[0]) throw new NotFoundError('subsystem_not_found')
  return r.rows[0]
}

// ─── TAGS (equipment register) ────────────────────────────────────────────────

export interface CreateTagInput {
  tagNo:          string
  equipmentName:  string
  equipmentType?: string | null
  subsystemId?:   string | null
  location?:      string | null
  manufacturer?:  string | null
  modelNo?:       string | null
  serialNo?:      string | null
  status?:        string
}

export interface UpdateTagInput {
  equipmentName?:  string
  equipmentType?:  string | null
  location?:       string | null
  manufacturer?:   string | null
  modelNo?:        string | null
  serialNo?:       string | null
  status?:         string
}

export async function listTagsForProject(ctx: Pick<AuditCtx, 'tenantId' | 'projectId'>) {
  const r = await tenantQuery(ctx.tenantId, `
    SELECT id, system_id, subsystem_id, tag_no, equipment_name, equipment_type,
           location, manufacturer, model_no, serial_no, status, created_at, updated_at
    FROM tags
    WHERE project_id = $1
      AND tenant_id  = current_setting('app.current_tenant_id', true)::uuid
    ORDER BY tag_no
  `, [ctx.projectId])
  return r.rows
}

export async function createTag(
  ctx: AuditCtx,
  systemId: string,
  payload: CreateTagInput,
) {
  await assertSystemInScope(ctx, systemId)
  if (payload.subsystemId) {
    await assertSubsystemInScope(ctx, payload.subsystemId, systemId)
  }
  const r = await tenantQuery(ctx.tenantId, `
    INSERT INTO tags
      (tenant_id, project_id, system_id, subsystem_id, tag_no, equipment_name,
       equipment_type, location, manufacturer, model_no, serial_no, status,
       created_by, updated_by)
    VALUES
      (current_setting('app.current_tenant_id', true)::uuid,
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
    RETURNING id, system_id, subsystem_id, tag_no, equipment_name, equipment_type,
              location, manufacturer, model_no, serial_no, status, created_at, updated_at
  `, [
    ctx.projectId, systemId, payload.subsystemId ?? null,
    payload.tagNo, payload.equipmentName,
    payload.equipmentType ?? null, payload.location ?? null,
    payload.manufacturer ?? null, payload.modelNo ?? null, payload.serialNo ?? null,
    payload.status ?? 'planned', ctx.userId,
  ])
  return r.rows[0]
}

export async function updateTag(
  ctx: Pick<AuditCtx, 'tenantId' | 'userId'>,
  tagId: string,
  payload: UpdateTagInput,
) {
  const fields: [string, unknown][] = []
  if (payload.equipmentName  !== undefined) fields.push(['equipment_name',  payload.equipmentName])
  if (payload.equipmentType  !== undefined) fields.push(['equipment_type',  payload.equipmentType])
  if (payload.location       !== undefined) fields.push(['location',        payload.location])
  if (payload.manufacturer   !== undefined) fields.push(['manufacturer',    payload.manufacturer])
  if (payload.modelNo        !== undefined) fields.push(['model_no',        payload.modelNo])
  if (payload.serialNo       !== undefined) fields.push(['serial_no',       payload.serialNo])
  if (payload.status         !== undefined) fields.push(['status',          payload.status])
  if (fields.length === 0) throw new ValidationError('no updatable fields provided')
  fields.push(['updated_by', ctx.userId])

  const sets   = fields.map(([col], i) => `${col} = $${i + 1}`).join(', ')
  const values = fields.map(([, v]) => v)
  values.push(tagId)

  const r = await tenantQuery(ctx.tenantId, `
    UPDATE tags
    SET ${sets}
    WHERE id = $${values.length}
      AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
    RETURNING id, system_id, subsystem_id, tag_no, equipment_name, equipment_type,
              location, manufacturer, model_no, serial_no, status, updated_at
  `, values)
  if (!r.rows[0]) throw new NotFoundError('tag_not_found')
  return r.rows[0]
}

// ─── COMMISSIONING ITEMS (readiness scope: what needs commissioning) ──────────

const VALID_ITEM_TYPES   = new Set(['pre_comm', 'pre_func', 'func', 'startup', 'turnover'])
const VALID_ITEM_STATUS  = new Set(['not_started', 'in_progress', 'complete', 'waived', 'na'])

export interface CreateCommissioningItemInput {
  projectId:         string
  systemId:          string
  subsystemId?:      string | null
  tagId?:            string | null
  itemType:          string
  title:             string
  description?:      string | null
  status?:           string
  sourceDocumentId?: string | null
  sourceReference?:  string | null
}

export interface UpdateCommissioningItemInput {
  title?:           string
  description?:     string | null
  status?:          string
  sourceReference?: string | null
}

export async function listCommissioningItems(ctx: Pick<AuditCtx, 'tenantId' | 'projectId'>) {
  const r = await tenantQuery(ctx.tenantId, `
    SELECT id, system_id, subsystem_id, tag_id, item_type, title, description,
           status, source_document_id, source_reference, created_at, updated_at
    FROM commissioning_items
    WHERE project_id = $1
      AND tenant_id  = current_setting('app.current_tenant_id', true)::uuid
    ORDER BY item_type, title
  `, [ctx.projectId])
  return r.rows
}

export async function createCommissioningItem(
  ctx: Pick<AuditCtx, 'tenantId' | 'userId'>,
  payload: CreateCommissioningItemInput,
) {
  if (!VALID_ITEM_TYPES.has(payload.itemType)) {
    throw new ValidationError(`invalid item_type; must be one of: ${[...VALID_ITEM_TYPES].join(', ')}`)
  }
  const status = payload.status ?? 'not_started'
  if (!VALID_ITEM_STATUS.has(status)) {
    throw new ValidationError(`invalid status; must be one of: ${[...VALID_ITEM_STATUS].join(', ')}`)
  }
  const r = await tenantQuery(ctx.tenantId, `
    INSERT INTO commissioning_items
      (tenant_id, project_id, system_id, subsystem_id, tag_id,
       item_type, title, description, status,
       source_document_id, source_reference, created_by, updated_by)
    VALUES
      (current_setting('app.current_tenant_id', true)::uuid,
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
    RETURNING id, system_id, subsystem_id, tag_id, item_type,
              title, description, status, source_reference, created_at, updated_at
  `, [
    payload.projectId, payload.systemId,
    payload.subsystemId ?? null, payload.tagId ?? null,
    payload.itemType, payload.title, payload.description ?? null, status,
    payload.sourceDocumentId ?? null, payload.sourceReference ?? null,
    ctx.userId,
  ])
  return r.rows[0]
}

export async function updateCommissioningItem(
  ctx: Pick<AuditCtx, 'tenantId' | 'userId'>,
  itemId: string,
  payload: UpdateCommissioningItemInput,
) {
  if (payload.status && !VALID_ITEM_STATUS.has(payload.status)) {
    throw new ValidationError(`invalid status; must be one of: ${[...VALID_ITEM_STATUS].join(', ')}`)
  }
  const fields: [string, unknown][] = []
  if (payload.title           !== undefined) fields.push(['title',            payload.title])
  if (payload.description     !== undefined) fields.push(['description',      payload.description])
  if (payload.status          !== undefined) fields.push(['status',           payload.status])
  if (payload.sourceReference !== undefined) fields.push(['source_reference', payload.sourceReference])
  if (fields.length === 0) throw new ValidationError('no updatable fields provided')
  fields.push(['updated_by', ctx.userId])

  const sets   = fields.map(([col], i) => `${col} = $${i + 1}`).join(', ')
  const values = fields.map(([, v]) => v)
  values.push(itemId)

  const r = await tenantQuery(ctx.tenantId, `
    UPDATE commissioning_items
    SET ${sets}
    WHERE id = $${values.length}
      AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
    RETURNING id, system_id, item_type, title, description, status,
              source_reference, updated_at
  `, values)
  if (!r.rows[0]) throw new NotFoundError('commissioning_item_not_found')
  return r.rows[0]
}
