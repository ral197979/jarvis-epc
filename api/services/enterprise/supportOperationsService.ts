// Denver Engineering — Support Operations Service (v8.0.0)
// Ticket lifecycle management: creation, escalation, SLA tracking, resolution.

import { tenantQuery } from '../../db/pool'
import {
  SupportTicket, CreateTicketInput, SupportTicketStatus, SupportTicketPriority,
} from './enterpriseTypes'

// ─── SLA deadlines by priority (hours) ───────────────────────────────────────

const SLA_HOURS: Record<SupportTicketPriority, number> = {
  critical: 4,
  high: 24,
  medium: 72,
  low: 168, // 7 days
}

// ─── Create ticket ────────────────────────────────────────────────────────────

export async function createTicket(
  tenantId: string,
  input: CreateTicketInput,
): Promise<SupportTicket> {
  const { title, description, priority = 'medium', reporter, tags = [] } = input

  const ticketNumber = await _generateTicketNumber()
  const slaDeadline = new Date(Date.now() + SLA_HOURS[priority] * 60 * 60 * 1000)

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO support_tickets
      (tenant_id, ticket_number, title, description, status, priority,
       reporter, tags, sla_deadline, metadata)
     VALUES ($1,$2,$3,$4,'open',$5,$6,$7,$8,'{}')
     RETURNING *`,
    [tenantId, ticketNumber, title, description ?? null, priority, reporter ?? null, tags, slaDeadline],
  )
  return _mapTicket(res.rows[0])
}

// ─── Get ticket ───────────────────────────────────────────────────────────────

export async function getTicket(tenantId: string, ticketId: string): Promise<SupportTicket | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM support_tickets WHERE tenant_id = $1 AND id = $2`,
    [tenantId, ticketId],
  )
  return res.rows.length > 0 ? _mapTicket(res.rows[0]) : null
}

// ─── List tickets ─────────────────────────────────────────────────────────────

export async function listTickets(
  tenantId: string,
  opts: {
    status?: SupportTicketStatus
    priority?: SupportTicketPriority
    assignee?: string
    limit?: number
  } = {},
): Promise<SupportTicket[]> {
  const { status, priority, assignee, limit = 100 } = opts
  const params: unknown[] = [tenantId]
  const clauses: string[] = []

  if (status != null)   { params.push(status);   clauses.push(`status = $${params.length}`) }
  if (priority != null) { params.push(priority); clauses.push(`priority = $${params.length}`) }
  if (assignee != null) { params.push(assignee); clauses.push(`assignee = $${params.length}`) }

  const where = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : ''
  params.push(limit)

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM support_tickets WHERE tenant_id = $1 ${where}
     ORDER BY
       CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
       created_at DESC
     LIMIT $${params.length}`,
    params,
  )
  return res.rows.map(_mapTicket)
}

// ─── Update ticket status ─────────────────────────────────────────────────────

export async function updateTicketStatus(
  tenantId: string,
  ticketId: string,
  status: SupportTicketStatus,
  opts: { assignee?: string; reason?: string } = {},
): Promise<SupportTicket> {
  const now = new Date()
  const resolvedAt = status === 'resolved' ? now : null
  const closedAt = status === 'closed' ? now : null

  const res = await tenantQuery(
    tenantId,
    `UPDATE support_tickets SET
       status = $2,
       assignee = COALESCE($3, assignee),
       resolved_at = CASE WHEN $4::timestamptz IS NOT NULL THEN $4::timestamptz ELSE resolved_at END,
       closed_at = CASE WHEN $5::timestamptz IS NOT NULL THEN $5::timestamptz ELSE closed_at END,
       updated_at = now()
     WHERE tenant_id = $1 AND id = $6
     RETURNING *`,
    [tenantId, status, opts.assignee ?? null, resolvedAt, closedAt, ticketId],
  )
  if (res.rows.length === 0) throw new Error(`Ticket ${ticketId} not found`)
  return _mapTicket(res.rows[0])
}

// ─── Escalate ticket ──────────────────────────────────────────────────────────

export async function escalateTicket(
  tenantId: string,
  ticketId: string,
  reason: string,
): Promise<SupportTicket> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE support_tickets SET
       priority = CASE WHEN priority = 'medium' THEN 'high'::support_ticket_priority
                       WHEN priority = 'high' THEN 'critical'::support_ticket_priority
                       ELSE priority END,
       escalated_at = COALESCE(escalated_at, now()),
       metadata = metadata || $3::jsonb,
       updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [tenantId, ticketId, JSON.stringify({ escalatedReason: reason, escalatedAt: new Date() })],
  )
  if (res.rows.length === 0) throw new Error(`Ticket ${ticketId} not found`)
  return _mapTicket(res.rows[0])
}

// ─── Get SLA breaches ─────────────────────────────────────────────────────────

export async function getSlaBreaches(tenantId: string): Promise<SupportTicket[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM support_tickets
     WHERE tenant_id = $1
       AND status NOT IN ('resolved', 'closed')
       AND sla_deadline < now()
     ORDER BY sla_deadline ASC`,
    [tenantId],
  )
  return res.rows.map(_mapTicket)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function _generateTicketNumber(): Promise<string> {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `TKT-${ts}-${rand}`
}

export function _mapTicket(row: Record<string, unknown>): SupportTicket {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    ticketNumber: String(row.ticket_number),
    title: String(row.title),
    description: row.description != null ? String(row.description) : undefined,
    status: row.status as SupportTicketStatus,
    priority: row.priority as SupportTicketPriority,
    reporter: row.reporter != null ? String(row.reporter) : undefined,
    assignee: row.assignee != null ? String(row.assignee) : undefined,
    tags: (row.tags as string[]) ?? [],
    escalatedAt: row.escalated_at != null ? new Date(row.escalated_at as string) : undefined,
    resolvedAt: row.resolved_at != null ? new Date(row.resolved_at as string) : undefined,
    closedAt: row.closed_at != null ? new Date(row.closed_at as string) : undefined,
    slaDeadline: row.sla_deadline != null ? new Date(row.sla_deadline as string) : undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

export const __testHooks = { _mapTicket, SLA_HOURS }
