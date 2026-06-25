/**
 * Denver Engineering — EPC shared kernel (v4.56.0)
 * ──────────────────────────────────────────────────────────────────────────────
 * Types, error classes, and scope-verification helpers shared by the EPC
 * readiness layer (epcCore.ts) and the commissioning-execution layer
 * (cxExecution.ts). Extracted in the commissioning-extraction refactor (PR-2,
 * COMMISSIONING_EXTRACTION_PLAN.md §4 Phase B) so the two layers no longer share
 * a single file and the execution layer can be lifted into the Commissioning
 * repo without dragging readiness code with it.
 *
 * This module imports nothing from epcCore or cxExecution — it is the leaf both
 * depend on, so there is no import cycle.
 */
import { tenantQuery } from '../db/pool'

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

// ─── Scope verification ───────────────────────────────────────────────────────

export async function assertSystemInScope(ctx: AuditCtx, systemId: string): Promise<void> {
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

export async function assertSubsystemInScope(
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

export async function assertTagInScope(
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
