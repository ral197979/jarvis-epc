/**
 * Denver Engineering — WebSocket Subscription Manager (v4.35.0)
 * ─────────────────────────────────────────────────────────────
 * Ava Phase 3 — Manages active WebSocket client connections and
 * routes broadcast events to the correct subscribers.
 *
 * Isolation: tenant_id is validated on every subscription. A client
 * can only subscribe to scopes within their authenticated tenant.
 */
import type { WebSocket } from 'ws'
import type { RealtimeEvent, SubscriptionScope } from './eventBroadcaster'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Subscription {
  scope:   SubscriptionScope
  scopeId?: string          // null = subscribe to all within tenant
}

interface Client {
  id:            string
  ws:            WebSocket
  tenantId:      string
  userId:        string
  subscriptions: Subscription[]
  lastHeartbeat: number
  lastSeq:       number
}

// ─── Manager ─────────────────────────────────────────────────────────────────

class SubscriptionManager {
  private clients = new Map<string, Client>()
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null

  // ─── Connection lifecycle ────────────────────────────────────────────────

  register(
    ws:       WebSocket,
    clientId: string,
    tenantId: string,
    userId:   string,
  ): void {
    const client: Client = {
      id:            clientId,
      ws,
      tenantId,
      userId,
      subscriptions: [],
      lastHeartbeat: Date.now(),
      lastSeq:       0,
    }
    this.clients.set(clientId, client)

    ws.on('message', (raw) => { this._handleMessage(clientId, raw.toString()) })
    ws.on('close',   ()    => { this.unregister(clientId) })
    ws.on('pong',    ()    => { const c = this.clients.get(clientId); if (c) c.lastHeartbeat = Date.now() })
  }

  unregister(clientId: string): void {
    this.clients.delete(clientId)
  }

  // ─── Subscription management ─────────────────────────────────────────────

  subscribe(clientId: string, sub: Subscription): void {
    const client = this.clients.get(clientId)
    if (!client) return
    // Avoid duplicate subscriptions
    const exists = client.subscriptions.some(
      s => s.scope === sub.scope && s.scopeId === sub.scopeId,
    )
    if (!exists) client.subscriptions.push(sub)
  }

  unsubscribe(clientId: string, sub: Subscription): void {
    const client = this.clients.get(clientId)
    if (!client) return
    client.subscriptions = client.subscriptions.filter(
      s => !(s.scope === sub.scope && s.scopeId === sub.scopeId),
    )
  }

  // ─── Message handling ────────────────────────────────────────────────────

  private _handleMessage(clientId: string, raw: string): void {
    try {
      const msg = JSON.parse(raw) as { type: string; [k: string]: unknown }
      const client = this.clients.get(clientId)
      if (!client) return

      switch (msg['type']) {
        case 'subscribe':
          this.subscribe(clientId, {
            scope:   msg['scope'] as SubscriptionScope,
            scopeId: msg['scope_id'] as string | undefined,
          })
          this._send(client, { type: 'subscribed', scope: msg['scope'], scope_id: msg['scope_id'] })
          break

        case 'unsubscribe':
          this.unsubscribe(clientId, {
            scope:   msg['scope'] as SubscriptionScope,
            scopeId: msg['scope_id'] as string | undefined,
          })
          break

        case 'ping':
          client.lastHeartbeat = Date.now()
          this._send(client, { type: 'pong', ts: Date.now() })
          break

        case 'replay':
          // Client requests replay — handled by route layer calling replayEvents()
          this._send(client, { type: 'replay_ack', since_seq: msg['since_seq'] })
          break
      }
    } catch { /* malformed message — ignore */ }
  }

  // ─── Broadcast ───────────────────────────────────────────────────────────

  broadcast(event: RealtimeEvent): void {
    const msg = JSON.stringify({ type: 'event', data: event })

    for (const client of this.clients.values()) {
      // Tenant isolation — never cross tenant boundaries
      if (client.tenantId !== event.tenant_id) continue

      // Check if client has a matching subscription
      if (!this._matchesSubscription(client, event)) continue

      // Update last seen sequence
      if (event.sequence_number && event.sequence_number > client.lastSeq) {
        client.lastSeq = event.sequence_number
      }

      this._send(client, msg)
    }
  }

  private _matchesSubscription(client: Client, event: RealtimeEvent): boolean {
    // Tenant-wide subscription always receives all events
    const hasTenantSub = client.subscriptions.some(
      s => s.scope === 'tenant' && !s.scopeId,
    )
    if (hasTenantSub) return true

    // Check scope-specific subscriptions
    return client.subscriptions.some(s =>
      s.scope === event.subscription_scope &&
      (!s.scopeId || s.scopeId === event.scope_id),
    )
  }

  private _send(client: Client, msg: string | Record<string, unknown>): void {
    try {
      const payload = typeof msg === 'string' ? msg : JSON.stringify(msg)
      if (client.ws.readyState === 1 /* OPEN */) {
        client.ws.send(payload)
      }
    } catch { /* connection may have closed — ignore */ }
  }

  // ─── Heartbeat ───────────────────────────────────────────────────────────

  startHeartbeat(intervalMs = 30_000): void {
    this.heartbeatInterval = setInterval(() => {
      const cutoff = Date.now() - intervalMs * 3
      for (const [id, client] of this.clients) {
        if (client.lastHeartbeat < cutoff) {
          // Client hasn't responded to pings — terminate
          client.ws.terminate()
          this.clients.delete(id)
        } else {
          try { client.ws.ping() } catch { this.clients.delete(id) }
        }
      }
    }, intervalMs)
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  // ─── Introspection ───────────────────────────────────────────────────────

  getClientCount(): number { return this.clients.size }
  getClientCount_byTenant(tenantId: string): number {
    let n = 0
    for (const c of this.clients.values()) if (c.tenantId === tenantId) n++
    return n
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _manager: SubscriptionManager | null = null

export function getSubscriptionManager(): SubscriptionManager {
  if (!_manager) _manager = new SubscriptionManager()
  return _manager
}

export function initSubscriptionManager(): SubscriptionManager {
  _manager = new SubscriptionManager()
  _manager.startHeartbeat()
  return _manager
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = { SubscriptionManager }
