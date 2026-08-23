/**
 * Denver Engineering — WebSocket Gateway (v4.35.0)
 * ──────────────────────────────────────────────────
 * Ava Phase 3 — Upgrades HTTP connections to WebSocket with
 * tenant-auth validation, reconnect support, and event replay.
 *
 * Mount via: server.ts registerWebSocketGateway(server)
 */
import { WebSocketServer, type WebSocket } from 'ws'
import type { IncomingMessage, Server } from 'http'
import { randomBytes } from 'crypto'
import { initSubscriptionManager } from './subscriptionManager'
import { replayEvents } from './eventBroadcaster'
import type { SubscriptionScope } from './eventBroadcaster'
import { consumeWsTicket } from './wsTicket'

// ─── Auth validation ──────────────────────────────────────────────────────────

interface WsAuthContext {
  tenantId: string
  userId:   string
  valid:    boolean
}

/**
 * Authenticate the WebSocket upgrade via a single-use connection ticket
 * (AUD-010). Clients first call GET /api/v1/realtime/ws-ticket over the
 * authenticated REST channel, then connect with `?ticket=<ticket>`.
 *
 * The tenant/user identity is taken from the SERVER-side ticket record, never
 * from caller-supplied query params — so a client cannot connect as another
 * tenant by editing the URL. The ticket is consumed (single use) here.
 */
function _validateWsAuth(req: IncomingMessage): WsAuthContext {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const ticket = url.searchParams.get('ticket')

  const rec = consumeWsTicket(ticket)
  if (!rec) {
    return { tenantId: '', userId: '', valid: false }
  }

  return { tenantId: rec.tenantId, userId: rec.userId, valid: true }
}

// ─── Gateway setup ────────────────────────────────────────────────────────────

export function registerWebSocketGateway(httpServer: Server): WebSocketServer {
  const wss    = new WebSocketServer({ server: httpServer, path: '/ws' })
  const manager = initSubscriptionManager()

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const auth = _validateWsAuth(req)

    if (!auth.valid) {
      ws.close(4001, 'unauthorized')
      return
    }

    const clientId = randomBytes(8).toString('hex')
    manager.register(ws, clientId, auth.tenantId, auth.userId)

    // Send connected acknowledgement with client ID (for reconnect)
    const sendJson = (obj: unknown) => {
      try {
        if (ws.readyState === 1) ws.send(JSON.stringify(obj))
      } catch { /* ignore */ }
    }

    sendJson({ type: 'connected', client_id: clientId })

    // Auto-subscribe to tenant scope on connect
    manager.subscribe(clientId, { scope: 'tenant' })

    // Handle reconnect with replay
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const lastSeqStr = url.searchParams.get('last_seq')
    const replayScope = (url.searchParams.get('replay_scope') ?? 'tenant') as SubscriptionScope
    const replayScopeId = url.searchParams.get('replay_scope_id') ?? undefined

    if (lastSeqStr) {
      const lastSeq = parseInt(lastSeqStr, 10)
      if (!isNaN(lastSeq)) {
        void _sendReplay(ws, auth.tenantId, replayScope, replayScopeId, lastSeq, sendJson)
      }
    }
  })

  console.log('[ws-gateway] WebSocket gateway listening at /ws')
  return wss
}

async function _sendReplay(
  ws:       WebSocket,
  tenantId: string,
  scope:    SubscriptionScope,
  scopeId:  string | undefined,
  lastSeq:  number,
  send:     (o: unknown) => void,
): Promise<void> {
  try {
    const events = await replayEvents(tenantId, scope, scopeId, lastSeq)
    if (events.length === 0) return
    send({ type: 'replay_start', count: events.length })
    for (const e of events) { send({ type: 'event', data: e }) }
    send({ type: 'replay_end', last_seq: events[events.length - 1]?.sequence_number })
  } catch (err) {
    console.error('[ws-gateway] replay error', err)
  }
}

// ─── Polling fallback endpoint (for environments without WebSocket) ───────────

/**
 * Use this with express route: GET /api/v1/realtime/poll
 * Clients provide ?last_seq=N and receive new events since that sequence.
 * This is the polling fallback for environments that block WebSocket (proxies, etc.)
 */
export async function pollEvents(
  tenantId:  string,
  lastSeq:   number,
  scope:     SubscriptionScope = 'tenant',
  scopeId?:  string,
  limit      = 50,
  /** ADR-014 Phase 3H: the route-built per-scope authorization predicate. */
  authScope: { sql: string; params: unknown[] } = { sql: '', params: [] },
) {
  return replayEvents(tenantId, scope, scopeId, lastSeq, limit, authScope)
}
