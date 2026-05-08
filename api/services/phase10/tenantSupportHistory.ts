// Denver Engineering — Tenant Support History (v10.0.0)
// Tracks support tickets, escalations, and resolution history per tenant.

import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { SupportTicket, TicketStatus, TicketPriority, TicketEscalation } from './phase10Types'

// ─── Ticket lifecycle ─────────────────────────────────────────────────────────

export interface CreateTicketInput {
  tenantId: string
  subject: string
  description: string
  priority: TicketPriority
  reportedBy: string
  category?: string
}

export async function createSupportTicket(
  input: CreateTicketInput,
): Promise<SupportTicket> {
  const res = await pool.query(
    `INSERT INTO support_tickets
      (tenant_id, subject, description, priority, reported_by, category, status)
     VALUES ($1,$2,$3,$4,$5,$6,'open')
     RETURNING *`,
    [
      input.tenantId, input.subject, input.description,
      input.priority, input.reportedBy, input.category ?? 'general',
    ],
  )
  return _mapTicket(res.rows[0])
}

export async function updateTicketStatus(
  ticketId: string,
  status: TicketStatus,
  resolvedBy?: string,
  resolutionNote?: string,
): Promise<SupportTicket> {
  const res = await pool.query(
    `UPDATE support_tickets
     SET status = $2,
         resolved_by = COALESCE($3, resolved_by),
         resolution_note = COALESCE($4, resolution_note),
         resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE resolved_at END
     WHERE id = $1
     RETURNING *`,
    [ticketId, status, resolvedBy ?? null, resolutionNote ?? null],
  )
  if (res.rows.length === 0) throw new Error(`Support ticket ${ticketId} not found`)
  return _mapTicket(res.rows[0])
}

export async function getSupportTicket(ticketId: string): Promise<SupportTicket | null> {
  const res = await pool.query(
    `SELECT * FROM support_tickets WHERE id = $1`,
    [ticketId],
  )
  return res.rows.length > 0 ? _mapTicket(res.rows[0]) : null
}

export async function listTenantTickets(
  tenantId: string,
  status?: TicketStatus,
  limit = 20,
): Promise<SupportTicket[]> {
  const res = await pool.query(
    `SELECT * FROM support_tickets
     WHERE tenant_id = $1
       AND ($2::text IS NULL OR status = $2)
     ORDER BY created_at DESC LIMIT $3`,
    [tenantId, status ?? null, limit],
  )
  return res.rows.map(_mapTicket)
}

export async function getOpenTicketCount(tenantId: string): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*) AS cnt FROM support_tickets
     WHERE tenant_id = $1 AND status != 'resolved'`,
    [tenantId],
  )
  return Number(res.rows[0]?.['cnt'] ?? 0)
}

// ─── Escalations ──────────────────────────────────────────────────────────────

export async function escalateTicket(
  ticketId: string,
  escalatedTo: string,
  reason: string,
): Promise<TicketEscalation> {
  const res = await pool.query(
    `INSERT INTO ticket_escalations
      (ticket_id, escalated_to, reason, escalated_at)
     VALUES ($1,$2,$3,now())
     RETURNING *`,
    [ticketId, escalatedTo, reason],
  )
  await pool.query(
    `UPDATE support_tickets SET priority = 'critical', status = 'escalated'
     WHERE id = $1`,
    [ticketId],
  )
  return _mapEscalation(res.rows[0])
}

export async function getTicketEscalations(ticketId: string): Promise<TicketEscalation[]> {
  const res = await pool.query(
    `SELECT * FROM ticket_escalations WHERE ticket_id = $1 ORDER BY escalated_at`,
    [ticketId],
  )
  return res.rows.map(_mapEscalation)
}

// ─── Tenant-scoped support query ──────────────────────────────────────────────

export async function getTenantSupportSummary(
  tenantId: string,
): Promise<{
  openCount: number
  resolvedCount: number
  avgResolutionMs: number
  criticalOpen: number
}> {
  const res = await tenantQuery(
    tenantId,
    `SELECT
       SUM(CASE WHEN status != 'resolved' THEN 1 ELSE 0 END)::int AS open_count,
       SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END)::int AS resolved_count,
       AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) * 1000) AS avg_resolution_ms,
       SUM(CASE WHEN priority = 'critical' AND status != 'resolved' THEN 1 ELSE 0 END)::int AS critical_open
     FROM support_tickets WHERE tenant_id = $1`,
    [tenantId],
  )
  const row = res.rows[0]
  return {
    openCount: Number(row?.['open_count'] ?? 0),
    resolvedCount: Number(row?.['resolved_count'] ?? 0),
    avgResolutionMs: Math.round(Number(row?.['avg_resolution_ms'] ?? 0)),
    criticalOpen: Number(row?.['critical_open'] ?? 0),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function computeSLADeadline(priority: TicketPriority, createdAt: Date): Date {
  const slaMsMap: Record<TicketPriority, number> = {
    critical: 4 * 60 * 60 * 1000,     // 4 hours
    high: 24 * 60 * 60 * 1000,         // 24 hours
    medium: 72 * 60 * 60 * 1000,       // 3 days
    low: 7 * 24 * 60 * 60 * 1000,      // 7 days
  }
  return new Date(createdAt.getTime() + slaMsMap[priority])
}

export function isSLABreached(priority: TicketPriority, createdAt: Date, now = new Date()): boolean {
  return now > computeSLADeadline(priority, createdAt)
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapTicket,
  _mapEscalation,
  computeSLADeadline,
  isSLABreached,
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapTicket(row: Record<string, unknown>): SupportTicket {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    subject: row['subject'] as string,
    description: row['description'] as string,
    priority: row['priority'] as TicketPriority,
    reportedBy: row['reported_by'] as string,
    category: row['category'] as string,
    status: row['status'] as TicketStatus,
    resolvedBy: (row['resolved_by'] as string) ?? null,
    resolutionNote: (row['resolution_note'] as string) ?? null,
    resolvedAt: row['resolved_at'] != null ? new Date(row['resolved_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
  }
}

function _mapEscalation(row: Record<string, unknown>): TicketEscalation {
  return {
    id: row['id'] as string,
    ticketId: row['ticket_id'] as string,
    escalatedTo: row['escalated_to'] as string,
    reason: row['reason'] as string,
    escalatedAt: new Date(row['escalated_at'] as string),
    createdAt: new Date(row['created_at'] as string),
  }
}
