/**
 * AUD-010 regression — WebSocket connection tickets.
 * Verifies tickets are single-use, bound to the issuing principal, and that
 * unknown tickets are rejected. (Expiry uses the 30s TTL; we assert the
 * single-use + binding semantics which are the security-critical properties.)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { issueWsTicket, consumeWsTicket, _resetWsTickets } from '../realtime/wsTicket'

describe('wsTicket', () => {
  beforeEach(() => _resetWsTickets())

  it('issues an opaque ticket bound to {userId, tenantId}', () => {
    const { ticket, expiresInMs } = issueWsTicket('user-1', 'tenant-A')
    expect(ticket).toMatch(/^[0-9a-f]{64}$/)  // 32 random bytes hex
    expect(expiresInMs).toBeGreaterThan(0)
    const rec = consumeWsTicket(ticket)
    expect(rec).toEqual({ userId: 'user-1', tenantId: 'tenant-A', expiresAt: expect.any(Number) })
  })

  it('is single-use: a second consume returns null', () => {
    const { ticket } = issueWsTicket('user-1', 'tenant-A')
    expect(consumeWsTicket(ticket)).not.toBeNull()
    expect(consumeWsTicket(ticket)).toBeNull()
  })

  it('returns null for an unknown / forged ticket', () => {
    expect(consumeWsTicket('deadbeef')).toBeNull()
    expect(consumeWsTicket(null)).toBeNull()
    expect(consumeWsTicket(undefined)).toBeNull()
    expect(consumeWsTicket('')).toBeNull()
  })

  it('does not let one ticket impersonate a different tenant', () => {
    const a = issueWsTicket('user-a', 'tenant-A').ticket
    const b = issueWsTicket('user-b', 'tenant-B').ticket
    expect(consumeWsTicket(a)?.tenantId).toBe('tenant-A')
    expect(consumeWsTicket(b)?.tenantId).toBe('tenant-B')
  })
})
