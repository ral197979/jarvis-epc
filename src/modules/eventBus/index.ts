/**
 * Denver Engineering — JIP (Jarvis Interop Protocol) Event Bus
 * ─────────────────────────────────────────────────────
 * Typed pub/sub messaging for decoupled component communication.
 * Pure module — no dependencies, no side effects beyond its own state.
 */

// ─── Types ────────────────────────────────────────────────────────────────────
export interface JIPMessage<TPayload = unknown> {
  jip:     '1.0'
  id:      string
  source:  string
  channel: string
  action:  string
  payload: TPayload
  ts:      number
}

export type JIPHandler<TPayload = unknown> = (msg: JIPMessage<TPayload>) => void

export interface JIPBus {
  publish<TPayload = unknown>(
    channel: string,
    action:  string,
    payload?: TPayload,
    source?: string,
  ): JIPMessage<TPayload>

  subscribe<TPayload = unknown>(
    channel: string,
    action:  string,
    handler: JIPHandler<TPayload>,
  ): () => void

  getLog(): JIPMessage[]
  clear(): void
}

// ─── Well-known channels (extend as needed) ───────────────────────────────────
export const JIP_CHANNELS = {
  JARVIS: 'jarvis',
  AUTH:   'auth',
  DATA:   'data',
  MCP:    'mcp',
  CRUD:   'crud',
} as const

export const JIP_ACTIONS = {
  TOKEN_EXPIRED:  'token_expired',
  TOKEN_ROTATED:  'token_rotated',
  SESSION_TIMEOUT:'session_timeout',
  CONNECT:        'connect',
  DISCONNECT:     'disconnect',
} as const

// ─── Internal state ───────────────────────────────────────────────────────────
let _subscribers: Record<string, JIPHandler[]> = {}
let _sequence = 0
let _log: JIPMessage[]  = []
const MAX_LOG = 200

// ─── JIP Bus ──────────────────────────────────────────────────────────────────
export const jip: JIPBus = {
  publish<TPayload = unknown>(
    channel: string,
    action:  string,
    payload?: TPayload,
    source?: string,
  ): JIPMessage<TPayload> {
    const msg: JIPMessage<TPayload> = {
      jip:     '1.0',
      id:      `jip-${++_sequence}`,
      source:  source ?? 'shell',
      channel,
      action,
      payload: payload ?? ({} as TPayload),
      ts:      Date.now(),
    }

    _log.push(msg as JIPMessage)
    if (_log.length > MAX_LOG) _log.shift()

    const exact    = `${channel}:${action}`
    const chanWild = `${channel}:*`
    const globalW  = '*:*'

    for (const key of [exact, chanWild, globalW]) {
      for (const fn of (_subscribers[key] ?? [])) {
        try { fn(msg as JIPMessage) }
        catch (ex) { console.error(`[JIP] Subscriber error on ${key}:`, ex) }
      }
    }

    return msg
  },

  subscribe<TPayload = unknown>(
    channel: string,
    action:  string,
    handler: JIPHandler<TPayload>,
  ): () => void {
    const key = `${channel}:${action ?? '*'}`
    if (!_subscribers[key]) _subscribers[key] = []
    _subscribers[key].push(handler as JIPHandler)
    return () => {
      _subscribers[key] = (_subscribers[key] ?? []).filter(fn => fn !== handler)
    }
  },

  getLog(): JIPMessage[] { return _log.slice() },

  clear(): void {
    _subscribers = {}
    _log = []
    _sequence = 0
  },
}

// ─── Legacy alias ─────────────────────────────────────────────────────────────
export const tt = jip
