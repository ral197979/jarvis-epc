/**
 * Denver Engineering — EPC Core Service (v4.32.0)
 * ──────────────────────────────────────────────────────────────────────────────
 * Backend-foundation service for the F01/F05 remediation:
 *   systems, subsystems, tags, commissioning_items,
 *   test_packs, test_results, deficiencies
 *
 * All helpers use tenantQuery/tenantTransaction so Row Level Security
 * and `app.current_tenant_id` session-context are set correctly on every
 * call. Project scope is enforced in WHERE clauses (tenant-only RLS per
 * the repo convention; see docs/audit/V432_MAPPING_NOTE.md).
 *
 * Hard rule (F05): test packs MUST reference a real project + system.
 * If subsystem_id/tag_id are supplied they must be in the same scope.
 * No synthetic-asset / title-only shortcut is exposed from this module.
 */

import { tenantQuery, tenantTransaction } from '../db/pool'

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface AuditCtx {
  tenantId:  string
  projectId: string
  userId:    string | null
}

export class ValidationError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends Error {
  constructor(message = 'not_found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

// ─── Internal scope verification ──────────────────────────────────────────────

async function _assertSystemInScope(ctx: AuditCtx, systemId: string): Promise<void> {
  const r = await tenantQuery<{ id: string }>(ctx.tenantId, `
    SELECT id FROM systems
    WHERE id = $1
      AND project_id = $2
      AND tenant_id  = current_setting('app.current_tenant_id', true)::uuid
  `, [systemId, ctx.projectId])
  if (!r.rows[0]) {
    throw new ValidationError(`system_not_in_scope: ${systemId}`, 400)
  }
}

async function _assertSubsystemInScope(
  ctx: AuditCtx,
  subsystemId: string,
  systemId: string,
): Promise<void> {
  const r = await tenantQuery<{ id: string }>(ctx.tenantId, `
    SELECT id FROM subsystems
    WHERE id = $1
      AND system_id  = $2
      AND project_id = $3
      AND tenant_id  = current_setting('app.current_tenant_id', true)::uuid
  `, [subsystemId, systemId, ctx.projectId])
  if (!r.rows[0]) {
    throw new ValidationError(`subsystem_not_in_system: ${subsystemId}`, 400)
  }
}

async function _assertTagInScope(
  ctx: AuditCtx,
  tagId: string,
  systemId: string,
  subsystemId: string | null,
): Promise<void> {
  const r = await tenantQuery<{ subsystem_id: string | null }>(ctx.tenantId, `
    SELECT subsystem_id FROM tags
    WHERE id = $1
      AND system_id  = $2
      AND project_id = $3
      AND tenant_id  = current_setting('app.current_tenant_id', true)::uuid
  `, [tagId, systemId, ctx.projectId])
  const row = r.rows[0]
  if (!row) {
    throw new ValidationError(`tag_not_in_system: ${tagId}`, 400)
  }
  if (subsystemId && row.subsystem_id && row.subsystem_id !== subsystemId) {
    throw new ValidationError(`tag_not_in_subsystem: ${tagId}`, 400)
  }
}

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
  await _assertSystemInScope(ctx, systemId)
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
  await _assertSystemInScope(ctx, systemId)
  if (payload.subsystemId) {
    await _assertSubsystemInScope(ctx, payload.subsystemId, systemId)
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

// ─── TEST PACKS ───────────────────────────────────────────────────────────────

const VALID_PACK_TYPES = new Set(['pre_comm', 'loop_check', 'start_up', 'functional', 'turnover'])
const VALID_GENERATED_FROM = new Set(['manual', 'template', 'ai', 'imported'])

export interface UpdateTestPackInput {
  title?:     string
  revision?:  string
  status?:    string
}

export interface CreateTestPackInput {
  projectId:              string
  systemId:               string
  subsystemId?:           string | null
  tagId?:                 string | null
  commissioningItemId?:   string | null
  packNo:                 string
  title:                  string
  revision?:              string
  packType:               string
  generatedFrom?:         string
}

export async function listTestPacksByProject(ctx: Pick<AuditCtx, 'tenantId' | 'projectId'>) {
  const r = await tenantQuery(ctx.tenantId, `
    SELECT tp.id, tp.pack_no, tp.title, tp.revision, tp.pack_type, tp.status,
           tp.system_id, tp.subsystem_id, tp.tag_id, tp.commissioning_item_id,
           tp.generated_from, tp.created_at, tp.updated_at,
           s.code AS system_code, s.name AS system_name,
           t.tag_no AS tag_no
    FROM test_packs tp
    JOIN systems s ON s.id = tp.system_id
    LEFT JOIN tags t ON t.id = tp.tag_id
    WHERE tp.project_id = $1
      AND tp.tenant_id  = current_setting('app.current_tenant_id', true)::uuid
    ORDER BY tp.pack_no
  `, [ctx.projectId])
  return r.rows
}

export async function updateTestPack(
  ctx: Pick<AuditCtx, 'tenantId' | 'userId'>,
  packId: string,
  payload: UpdateTestPackInput,
) {
  const fields: [string, unknown][] = []
  if (payload.title    !== undefined) fields.push(['title',    payload.title])
  if (payload.revision !== undefined) fields.push(['revision', payload.revision])
  if (payload.status   !== undefined) fields.push(['status',   payload.status])
  if (fields.length === 0) throw new ValidationError('no updatable fields provided')
  fields.push(['updated_by', ctx.userId])

  const sets   = fields.map(([col], i) => `${col} = $${i + 1}`).join(', ')
  const values = fields.map(([, v]) => v)
  values.push(packId)

  const r = await tenantQuery(ctx.tenantId, `
    UPDATE test_packs
    SET ${sets}
    WHERE id = $${values.length}
      AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
    RETURNING id, pack_no, title, revision, pack_type, status,
              system_id, subsystem_id, tag_id, generated_from, updated_at
  `, values)
  if (!r.rows[0]) throw new NotFoundError('test_pack_not_found')
  return r.rows[0]
}

export async function getTestPack(ctx: Pick<AuditCtx, 'tenantId'>, packId: string) {
  const r = await tenantQuery(ctx.tenantId, `
    SELECT tp.*, s.code AS system_code, s.name AS system_name, t.tag_no AS tag_no
    FROM test_packs tp
    JOIN systems s ON s.id = tp.system_id
    LEFT JOIN tags t ON t.id = tp.tag_id
    WHERE tp.id = $1
      AND tp.tenant_id = current_setting('app.current_tenant_id', true)::uuid
  `, [packId])
  const row = r.rows[0]
  if (!row) throw new NotFoundError('test_pack_not_found')
  return row
}

export async function createTestPack(
  ctx: Pick<AuditCtx, 'tenantId' | 'userId'>,
  payload: CreateTestPackInput,
) {
  // F05 hard rule: enforce real project + system scope.
  if (!payload.projectId || !payload.systemId) {
    throw new ValidationError('projectId and systemId are required — synthetic-asset packs are forbidden')
  }
  if (!VALID_PACK_TYPES.has(payload.packType)) {
    throw new ValidationError(`invalid pack_type; must be one of: ${[...VALID_PACK_TYPES].join(', ')}`)
  }
  const generatedFrom = payload.generatedFrom ?? 'manual'
  if (!VALID_GENERATED_FROM.has(generatedFrom)) {
    throw new ValidationError(`invalid generated_from; must be one of: ${[...VALID_GENERATED_FROM].join(', ')}`)
  }

  const scopeCtx: AuditCtx = {
    tenantId:  ctx.tenantId,
    projectId: payload.projectId,
    userId:    ctx.userId,
  }

  return tenantTransaction(ctx.tenantId, async (client) => {
    // Verify scope inside the transaction (tenant context already set by tenantTransaction).
    await _assertSystemInScope(scopeCtx, payload.systemId)
    if (payload.subsystemId) {
      await _assertSubsystemInScope(scopeCtx, payload.subsystemId, payload.systemId)
    }
    if (payload.tagId) {
      await _assertTagInScope(scopeCtx, payload.tagId, payload.systemId, payload.subsystemId ?? null)
    }

    const r = await client.query(`
      INSERT INTO test_packs
        (tenant_id, project_id, system_id, subsystem_id, tag_id,
         commissioning_item_id, pack_no, title, revision, pack_type,
         status, generated_from, created_by, updated_by)
      VALUES
        (current_setting('app.current_tenant_id', true)::uuid,
         $1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11, $11)
      RETURNING id, pack_no, title, revision, pack_type, status,
                system_id, subsystem_id, tag_id, commissioning_item_id,
                generated_from, created_at, updated_at
    `, [
      payload.projectId, payload.systemId,
      payload.subsystemId ?? null, payload.tagId ?? null,
      payload.commissioningItemId ?? null,
      payload.packNo, payload.title,
      payload.revision ?? 'A', payload.packType,
      generatedFrom, ctx.userId,
    ])
    return r.rows[0]
  })
}

// ─── TEST RESULTS ─────────────────────────────────────────────────────────────

const VALID_RESULT_STATUS = new Set(['pending', 'pass', 'fail', 'na'])

export interface CreateTestResultInput {
  projectId:       string
  testPackId:      string
  stepNo:          number
  stepTitle:       string
  expectedResult?: string | null
  actualResult?:   string | null
  resultStatus?:   string
  evidenceUri?:    string | null
  performedBy?:    string | null
  witnessedBy?:    string | null
  performedAt?:    string | null   // ISO timestamp
  comments?:       string | null
}

export interface UpdateTestResultInput {
  actualResult?:   string | null
  resultStatus?:   string
  evidenceUri?:    string | null
  performedBy?:    string | null
  witnessedBy?:    string | null
  performedAt?:    string | null
  comments?:       string | null
}

export async function createTestResult(
  ctx: Pick<AuditCtx, 'tenantId' | 'userId'>,
  payload: CreateTestResultInput,
) {
  if (!payload.projectId || !payload.testPackId) {
    throw new ValidationError('projectId and testPackId are required')
  }
  if (!Number.isInteger(payload.stepNo) || payload.stepNo < 1) {
    throw new ValidationError('stepNo must be a positive integer')
  }
  const resultStatus = payload.resultStatus ?? 'pending'
  if (!VALID_RESULT_STATUS.has(resultStatus)) {
    throw new ValidationError(`invalid result_status; must be one of: ${[...VALID_RESULT_STATUS].join(', ')}`)
  }

  // Verify the pack belongs to the same tenant+project (RLS handles tenant; check project explicitly).
  const packCheck = await tenantQuery<{ project_id: string }>(ctx.tenantId, `
    SELECT project_id FROM test_packs
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
  `, [payload.testPackId])
  if (!packCheck.rows[0]) throw new NotFoundError('test_pack_not_found')
  if (packCheck.rows[0].project_id !== payload.projectId) {
    throw new ValidationError('test_pack_project_mismatch')
  }

  const r = await tenantQuery(ctx.tenantId, `
    INSERT INTO test_results
      (tenant_id, project_id, test_pack_id, step_no, step_title,
       expected_result, actual_result, result_status, evidence_uri,
       performed_by, witnessed_by, performed_at, comments,
       created_by, updated_by)
    VALUES
      (current_setting('app.current_tenant_id', true)::uuid,
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
    RETURNING id, test_pack_id, step_no, step_title, result_status, created_at, updated_at
  `, [
    payload.projectId, payload.testPackId, payload.stepNo, payload.stepTitle,
    payload.expectedResult ?? null, payload.actualResult ?? null,
    resultStatus, payload.evidenceUri ?? null,
    payload.performedBy ?? null, payload.witnessedBy ?? null,
    payload.performedAt ?? null, payload.comments ?? null,
    ctx.userId,
  ])
  return r.rows[0]
}

export async function updateTestResult(
  ctx: Pick<AuditCtx, 'tenantId' | 'userId'>,
  resultId: string,
  payload: UpdateTestResultInput,
) {
  if (payload.resultStatus && !VALID_RESULT_STATUS.has(payload.resultStatus)) {
    throw new ValidationError(`invalid result_status; must be one of: ${[...VALID_RESULT_STATUS].join(', ')}`)
  }
  // Build dynamic SET clause from provided fields.
  const fields: [string, unknown][] = []
  if (payload.actualResult !== undefined) fields.push(['actual_result',  payload.actualResult])
  if (payload.resultStatus !== undefined) fields.push(['result_status',  payload.resultStatus])
  if (payload.evidenceUri  !== undefined) fields.push(['evidence_uri',   payload.evidenceUri])
  if (payload.performedBy  !== undefined) fields.push(['performed_by',   payload.performedBy])
  if (payload.witnessedBy  !== undefined) fields.push(['witnessed_by',   payload.witnessedBy])
  if (payload.performedAt  !== undefined) fields.push(['performed_at',   payload.performedAt])
  if (payload.comments     !== undefined) fields.push(['comments',       payload.comments])
  if (fields.length === 0) {
    throw new ValidationError('no updatable fields provided')
  }
  fields.push(['updated_by', ctx.userId])

  const sets   = fields.map(([col], i) => `${col} = $${i + 1}`).join(', ')
  const values = fields.map(([, v]) => v)
  values.push(resultId)

  const r = await tenantQuery(ctx.tenantId, `
    UPDATE test_results
    SET ${sets}
    WHERE id = $${values.length}
      AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
    RETURNING id, test_pack_id, step_no, step_title, result_status,
              actual_result, evidence_uri, performed_at, updated_at
  `, values)
  if (!r.rows[0]) throw new NotFoundError('test_result_not_found')
  return r.rows[0]
}

// ─── DEFICIENCIES ─────────────────────────────────────────────────────────────

const VALID_SEVERITY       = new Set(['low', 'medium', 'high', 'critical'])
const VALID_DEF_STATUS     = new Set(['open', 'in_review', 'closed', 'waived'])

export interface CreateDeficiencyInput {
  projectId:        string
  testPackId?:      string | null
  testResultId?:    string | null
  tagId?:           string | null
  code:             string
  title:            string
  description?:     string | null
  severity?:        string
  status?:          string
  assigneeUserId?:  string | null
  dueDate?:         string | null   // ISO date
}

export interface UpdateDeficiencyInput {
  title?:           string
  description?:     string | null
  severity?:        string
  status?:          string
  assigneeUserId?:  string | null
  dueDate?:         string | null
}

export async function listDeficienciesByProject(ctx: Pick<AuditCtx, 'tenantId' | 'projectId'>) {
  const r = await tenantQuery(ctx.tenantId, `
    SELECT id, code, title, description, severity, status,
           test_pack_id, test_result_id, tag_id, assignee_user_id,
           due_date, closed_at, created_at, updated_at
    FROM deficiencies
    WHERE project_id = $1
      AND tenant_id  = current_setting('app.current_tenant_id', true)::uuid
    ORDER BY created_at DESC
  `, [ctx.projectId])
  return r.rows
}

export async function createDeficiency(
  ctx: Pick<AuditCtx, 'tenantId' | 'userId'>,
  payload: CreateDeficiencyInput,
) {
  if (!payload.projectId || !payload.code || !payload.title) {
    throw new ValidationError('projectId, code, and title are required')
  }
  const severity = payload.severity ?? 'medium'
  if (!VALID_SEVERITY.has(severity)) {
    throw new ValidationError(`invalid severity; must be one of: ${[...VALID_SEVERITY].join(', ')}`)
  }
  const status = payload.status ?? 'open'
  if (!VALID_DEF_STATUS.has(status)) {
    throw new ValidationError(`invalid status; must be one of: ${[...VALID_DEF_STATUS].join(', ')}`)
  }

  const r = await tenantQuery(ctx.tenantId, `
    INSERT INTO deficiencies
      (tenant_id, project_id, test_pack_id, test_result_id, tag_id,
       code, title, description, severity, status,
       assignee_user_id, due_date, created_by, updated_by)
    VALUES
      (current_setting('app.current_tenant_id', true)::uuid,
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
    RETURNING id, code, title, description, severity, status,
              test_pack_id, test_result_id, tag_id, assignee_user_id,
              due_date, created_at, updated_at
  `, [
    payload.projectId, payload.testPackId ?? null, payload.testResultId ?? null,
    payload.tagId ?? null, payload.code, payload.title,
    payload.description ?? null, severity, status,
    payload.assigneeUserId ?? null, payload.dueDate ?? null,
    ctx.userId,
  ])
  return r.rows[0]
}

export async function updateDeficiency(
  ctx: Pick<AuditCtx, 'tenantId' | 'userId'>,
  deficiencyId: string,
  payload: UpdateDeficiencyInput,
) {
  if (payload.severity && !VALID_SEVERITY.has(payload.severity)) {
    throw new ValidationError(`invalid severity; must be one of: ${[...VALID_SEVERITY].join(', ')}`)
  }
  if (payload.status && !VALID_DEF_STATUS.has(payload.status)) {
    throw new ValidationError(`invalid status; must be one of: ${[...VALID_DEF_STATUS].join(', ')}`)
  }

  const setClauses: string[] = []
  const values: unknown[]   = []
  let n = 1

  if (payload.title          !== undefined) { setClauses.push(`title = $${n++}`);            values.push(payload.title) }
  if (payload.description    !== undefined) { setClauses.push(`description = $${n++}`);      values.push(payload.description) }
  if (payload.severity       !== undefined) { setClauses.push(`severity = $${n++}`);         values.push(payload.severity) }
  if (payload.assigneeUserId !== undefined) { setClauses.push(`assignee_user_id = $${n++}`); values.push(payload.assigneeUserId) }
  if (payload.dueDate        !== undefined) { setClauses.push(`due_date = $${n++}`);         values.push(payload.dueDate) }
  if (payload.status !== undefined) {
    setClauses.push(`status = $${n++}`)
    values.push(payload.status)
    if (payload.status === 'closed') setClauses.push('closed_at = NOW()')
  }

  if (setClauses.length === 0) throw new ValidationError('no updatable fields provided')
  setClauses.push(`updated_by = $${n++}`)
  values.push(ctx.userId, deficiencyId)

  const r = await tenantQuery(ctx.tenantId, `
    UPDATE deficiencies
    SET ${setClauses.join(', ')}
    WHERE id = $${n}
      AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
    RETURNING id, code, title, description, severity, status,
              assignee_user_id, due_date, closed_at, updated_at
  `, values)
  if (!r.rows[0]) throw new NotFoundError('deficiency_not_found')
  return r.rows[0]
}

// ─── COMMISSIONING ITEMS ──────────────────────────────────────────────────────

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

// ─── F05: Tag / pack coverage report ─────────────────────────────────────────

export interface TagCoverageItem {
  tag_id:         string
  tag_no:         string
  equipment_name: string
  system_id:      string
  tag_status:     string
  packs: Array<{ id: string; pack_no: string; pack_type: string; status: string }>
}

export interface CoverageReport {
  summary: {
    total_tags:     number
    covered_tags:   number
    uncovered_tags: number
    coverage_pct:   number
  }
  tags:       TagCoverageItem[]
  pagination: { limit: number; offset: number; total: number }
}

export async function getTagPackCoverage(
  ctx: Pick<AuditCtx, 'tenantId' | 'projectId'> & { limit?: number; offset?: number },
): Promise<CoverageReport> {
  const limit  = ctx.limit  ?? 100
  const offset = ctx.offset ?? 0

  const [summaryRes, tagsRes] = await Promise.all([
    tenantQuery<{ total_tags: string; covered_tags: string }>(ctx.tenantId, `
      SELECT
        COUNT(*)::text AS total_tags,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM test_packs tp
            WHERE tp.tag_id = t.id AND tp.project_id = $1
          )
        )::text AS covered_tags
      FROM tags t
      WHERE t.project_id = $1
    `, [ctx.projectId]),
    tenantQuery<TagCoverageItem>(ctx.tenantId, `
      SELECT
        t.id            AS tag_id,
        t.tag_no,
        t.equipment_name,
        t.system_id,
        t.status        AS tag_status,
        COALESCE(
          JSON_AGG(JSON_BUILD_OBJECT(
            'id',        tp.id,
            'pack_no',   tp.pack_no,
            'pack_type', tp.pack_type,
            'status',    tp.status
          )) FILTER (WHERE tp.id IS NOT NULL),
          '[]'::json
        ) AS packs
      FROM tags t
      LEFT JOIN test_packs tp ON tp.tag_id = t.id AND tp.project_id = $1
      WHERE t.project_id = $1
      GROUP BY t.id, t.tag_no, t.equipment_name, t.system_id, t.status
      ORDER BY t.tag_no
      LIMIT $2 OFFSET $3
    `, [ctx.projectId, limit, offset]),
  ])

  const total   = parseInt(summaryRes.rows[0]?.total_tags   ?? '0', 10)
  const covered = parseInt(summaryRes.rows[0]?.covered_tags ?? '0', 10)

  return {
    summary: {
      total_tags:     total,
      covered_tags:   covered,
      uncovered_tags: total - covered,
      coverage_pct:   total > 0 ? Math.round((covered / total) * 100) : 0,
    },
    tags:       tagsRes.rows,
    pagination: { limit, offset, total },
  }
}
