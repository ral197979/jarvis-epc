/**
 * Denver Engineering — WebSocket Connection Tickets (AUD-010 remediation)
 * ───────────────────────────────────────────────────────────────────────
 * Replaces the prior `?token=<access_token>` query-string scheme (which leaks
 * long-lived JWTs into access logs, proxies, WAFs and browser history) with a
 * short-lived, single-use connection ticket:
 *
 *   1. Authenticated client calls  GET /api/v1/realtime/ws-ticket  (cookie/JWT)
 *   2. Server issues an opaque 32-byte random ticket bound to {userId,tenantId},
 *      TTL 30s, stored server-side.
 *   3. Client connects:  wss://host/ws?ticket=<ticket>
 *   4. Gateway validates AND consumes the ticket (single use). The tenant/user
 *      identity comes from the SERVER-side record, never from query params.
 *
 * Storage is in-process. For multi-instance deployments the issuing instance
 * must also terminate the WS (Render sticky sessions) OR this should be backed
 * by Redis — see note at the bottom. The interface is intentionally small so a
 * Redis-backed implementation can be dropped in without touching callers.
 */

import { randomBytes } from 'node:crypto'

export interface WsTicketRecord {
  userId:   string
  tenantId: string
  expiresAt: number
}

const TICKET_TTL_MS = 30_000
const _tickets = new Map<string, WsTicketRecord>()

/** Issue a single-use ticket bound to the authenticated principal. */
export function issueWsTicket(userId: string, tenantId: string): { ticket: string; expiresInMs: number } {
  const ticket = randomBytes(32).toString('hex')
  _tickets.set(ticket, { userId, tenantId, expiresAt: Date.now() + TICKET_TTL_MS })
  // Opportunistic sweep so the map can't grow unbounded under load.
  if (_tickets.size > 10_000) _sweep()
  return { ticket, expiresInMs: TICKET_TTL_MS }
}

/**
 * Validate AND consume a ticket. Returns the bound principal on success, or
 * null if the ticket is unknown, already used, or expired. Single use: a valid
 * ticket is deleted on the first successful consumption.
 */
export function consumeWsTicket(ticket: string | null | undefined): WsTicketRecord | null {
  if (!ticket) return null
  const rec = _tickets.get(ticket)
  if (!rec) return null
  _tickets.delete(ticket)           // single-use: remove regardless of expiry
  if (rec.expiresAt < Date.now()) return null
  return rec
}

function _sweep(): void {
  const now = Date.now()
  for (const [k, v] of _tickets.entries()) {
    if (v.expiresAt < now) _tickets.delete(k)
  }
}

/** Test-only: clear all tickets. */
export function _resetWsTickets(): void {
  _tickets.clear()
}
