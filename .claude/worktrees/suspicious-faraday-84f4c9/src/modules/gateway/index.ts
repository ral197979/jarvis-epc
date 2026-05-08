/**
 * JARVIS EPC — Gateway Module
 * ────────────────────────────
 * Unified API client abstraction. Supports direct and proxied modes.
 *
 * Dependencies: store, observability, auth, eventBus
 * Status: API key proxied via /api/v1/gateway. CORS + rate limiting enforced in api/server.ts.
 */

import {
  gatewayLog, GATEWAY_LOG_MAX,
  sessionMetrics,
  gatewayMode,
  GATEWAY_PROXY_URL,
  backendBase,
  csrfToken,
  type GatewayLogEntry,
} from '../store/index.js'

import { slog, logError } from '../observability/index.js'
import { getAuthToken, clearAuthToken, checkSessionTimeout, announce } from '../auth/index.js'
import { jip } from '../eventBus/index.js'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface GatewayRequest {
  target:   string
  method?:  string
  headers?: Record<string, string>
  body?:    string
}

export interface AIAction {
  type: string
  data?: Record<string, unknown>
}

export interface AIResponse {
  message: string
  actions: AIAction[]
}

export interface AIContextPayload {
  summary:     string
  operational: string
}

export interface OnApiCallInfo {
  tokens:       number
  payloadChars: number
  action:       string
}

// ─── Backend URL Helper ───────────────────────────────────────────────────────
export function backendUrl(path: string): string {
  return (backendBase ?? '') + path
}

// ─── Core Gateway ─────────────────────────────────────────────────────────────
export function gateway(request: GatewayRequest): Promise<Response> {
  if (checkSessionTimeout() && gatewayMode === 'proxied') {
    return Promise.reject(new Error('Session expired'))
  }

  const entry: GatewayLogEntry = {
    ts:          new Date().toISOString(),
    method:      request.method ?? 'POST',
    target:      request.target,
    payloadSize: request.body ? request.body.length : 0,
    mode:        gatewayMode,
  }

  let url: string, headers: Record<string, string>, body: string | undefined

  if (gatewayMode === 'proxied') {
    url     = backendUrl(GATEWAY_PROXY_URL)
    const jwt = getAuthToken()
    headers = {
      'Content-Type':  'application/json',
      'X-CSRF-Token':  csrfToken,
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    }
    body = JSON.stringify({
      target:  request.target,
      method:  request.method ?? 'POST',
      headers: request.headers ?? {},
      body:    request.body ? JSON.parse(request.body) : undefined,
    })
  } else {
    url     = request.target
    headers = request.headers ?? { 'Content-Type': 'application/json' }
    body    = request.body
  }

  entry.url = url
  gatewayLog.push(entry)
  if (gatewayLog.length > GATEWAY_LOG_MAX) {
    gatewayLog.splice(0, gatewayLog.length - GATEWAY_LOG_MAX)
  }

  console.info(`[JARVIS:Gateway] ${gatewayMode} → ${request.target} (${entry.payloadSize} bytes)`)

  // ── Retry loop with telemetry ─────────────────────────────────────────────
  const MAX_RETRIES    = 2   // total attempts: 1 initial + MAX_RETRIES retries
  const RETRY_DELAY_MS = 400 // base delay; doubles on each attempt

  const attemptFetch = async (attempt: number): Promise<Response> => {
    const t0 = Date.now()
    entry.attempt = attempt

    try {
      const response = await fetch(url, { method: request.method ?? 'POST', headers, body })
      const latency  = Date.now() - t0
      entry.latencyMs = latency
      entry.status    = response.status

      const ct = response.headers.get('content-type') ?? ''
      if (response.ok && !ct.includes('application/json') && !ct.includes('text/')) {
        slog('WARN', 'security', `Unexpected Content-Type from gateway: ${ct.slice(0, 50)}`)
      }

      sessionMetrics.apiLatency.push(latency)
      if (sessionMetrics.apiLatency.length > 50) {
        sessionMetrics.apiLatency.splice(0, sessionMetrics.apiLatency.length - 50)
      }
      sessionMetrics.avgLatency = Math.round(
        sessionMetrics.apiLatency.reduce((a, b) => a + b, 0) / sessionMetrics.apiLatency.length
      )
      sessionMetrics.maxLatency = Math.max(...sessionMetrics.apiLatency)

      if ((entry.status ?? 0) >= 400) {
        logError('gateway', `${entry.target} → ${entry.status}`)
        sessionMetrics.gatewayErrors++
      }

      if (gatewayMode === 'proxied' && response.status === 401) {
        console.warn('[JARVIS:Gateway] 401 — token expired, clearing auth')
        clearAuthToken()
        jip.publish('jarvis', 'token_expired', { timestamp: new Date().toISOString() })
      }

      return response
    } catch (err: unknown) {
      const latency   = Date.now() - t0
      const errMsg    = err instanceof Error ? err.message : String(err)
      entry.latencyMs = latency
      entry.errorMsg  = errMsg
      logError('gateway', `network error (attempt ${attempt}): ${errMsg}`)
      slog('WARN', 'gateway', `[Gateway] fetch failed attempt ${attempt}/${MAX_RETRIES + 1}`, { errMsg, latency })
      sessionMetrics.gatewayErrors++

      if (attempt <= MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1)
        await new Promise(r => setTimeout(r, delay))
        return attemptFetch(attempt + 1)
      }
      throw err
    }
  }

  return attemptFetch(1)
}

// ─── AI Rate Limiter ──────────────────────────────────────────────────────────
const _chatRateLimit = {
  callCount:      0,
  windowStart:    Date.now(),
  lastCall:       0,
  COOLDOWN_MS:    2_000,
  MAX_PER_MINUTE: 10,
}

/** @internal — exposed for test isolation only */
export function _resetAIRateLimit(): void {
  _chatRateLimit.callCount   = 0
  _chatRateLimit.windowStart = Date.now()
  _chatRateLimit.lastCall    = 0
}

const AI_MAX_ITEMS = 5

function buildAIContext(biz: Record<string, unknown>): AIContextPayload {
  const b = biz
  const summary = [
    `Company: ${(b.company as { name?: string })?.name ?? 'Unknown'}`,
    `Projects: ${(b.projects as unknown[])?.length ?? 0}`,
    `Open Leads: ${((b.leads as Array<{status:string}>)    ?? []).filter(l => l.status !== 'closed').length}`,
    `Active Invoices: ${((b.invoices as Array<{status:string}>)  ?? []).filter(i => i.status !== 'paid').length}`,
  ].join(' | ')

  const opSnap: Record<string, unknown> = {}
  for (const key in b) {
    opSnap[key] = Array.isArray(b[key]) ? (b[key] as unknown[]).slice(0, AI_MAX_ITEMS) : b[key]
  }

  return { summary, operational: JSON.stringify(opSnap) }
}

const AI_SYSTEM_PROMPT = `You are JARVIS, an AI assistant for an EPC (Engineering, Procurement, Construction) company. You have access to the company's operational data and help with project management, financial analysis, field operations, and business intelligence. Respond with JSON: { "message": "...", "actions": [...] }. Actions can create leads, contracts, invoices, RFIs, submittals, incidents, and more. Keep responses concise and actionable.`

// ─── AI API Call ──────────────────────────────────────────────────────────────
export function callAI(
  userMessage: string,
  biz: Record<string, unknown>,
  onApiCall?: (info: OnApiCallInfo) => void,
): Promise<AIResponse> {
  const now = Date.now()
  if (now - _chatRateLimit.windowStart > 60_000) {
    _chatRateLimit.callCount   = 0
    _chatRateLimit.windowStart = now
  }
  if (now - _chatRateLimit.lastCall < _chatRateLimit.COOLDOWN_MS) {
    return Promise.resolve({ message: '⏳ Please wait a few seconds between messages.', actions: [{ type: 'none' }] })
  }
  if (_chatRateLimit.callCount >= _chatRateLimit.MAX_PER_MINUTE) {
    return Promise.resolve({ message: `⚠️ Rate limit reached (max ${_chatRateLimit.MAX_PER_MINUTE}/min).`, actions: [{ type: 'none' }] })
  }
  _chatRateLimit.lastCall  = now
  _chatRateLimit.callCount++

  const ctx = buildAIContext(biz)

  return gateway({
    target:  'https://api.anthropic.com/v1/messages',
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 3_000,
      system:     AI_SYSTEM_PROMPT,
      messages: [
        { role: 'user',      content: `Summary:\n${ctx.summary}\nOperational (PII redacted, max ${AI_MAX_ITEMS}/collection):\n${ctx.operational}` },
        { role: 'assistant', content: 'Ready.' },
        { role: 'user',      content: userMessage },
      ],
    }),
  })
    .then(r => r.json() as Promise<{ content: Array<{ text?: string }> }>)
    .then(data => {
      const text      = data.content.map(c => c.text ?? '').join('')
      const estTokens = Math.ceil(text.length / 4) + Math.ceil(userMessage.length / 4) + Math.ceil(ctx.operational.length / 4)
      onApiCall?.({ tokens: estTokens, payloadChars: ctx.operational.length, action: 'ai_chat' })
      announce('AI response received')
      try {
        return JSON.parse(text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()) as AIResponse
      } catch {
        return { message: text, actions: [{ type: 'none' }] }
      }
    })
    .catch((err: Error) => ({
      message: `⚠️ API call failed: ${err.message ?? 'Unknown error'}`,
      actions: [{ type: 'none' }],
    }))
}

// ─── AI Action Processor ──────────────────────────────────────────────────────
const ACTION_COLLECTION_MAP: Record<string, string> = {
  add_lead: 'leads', add_contract: 'contracts', add_invoice: 'invoices',
  add_po: 'purchase_orders', add_submittal: 'submittals', add_rfi: 'rfis',
  add_jha: 'jhas', add_incident: 'incidents', add_toolbox_talk: 'toolbox_talks',
  add_permit: 'permits', add_cx_phase: 'cx_phases', add_cx_issue: 'cx_issues',
  add_journal: 'journal', add_expense: 'expenses', add_closeout: 'closeouts',
  add_punch: 'punch_items', add_lesson: 'lessons',
  add_deliverable: 'engineering_deliverables',
  add_engineering_deliverable: 'engineering_deliverables',
  add_rfq: 'rfqs', add_installation: 'installation', add_manpower: 'manpower',
  add_document: 'documents', add_transmittal: 'transmittals', add_feed_study: 'feed_studies',
}

export function applyAIActions(
  biz: Record<string, unknown>,
  actions: AIAction[],
): Record<string, unknown> {
  const state = JSON.parse(JSON.stringify(biz)) as Record<string, unknown>

  for (const action of actions ?? []) {
    if (!action || action.type === 'none') continue
    const p = action.data ?? {}

    if (action.type === 'set_company') {
      Object.assign(state.company as object, p)
      continue
    }
    if (action.type === 'record_payment') {
      const inv = (state.invoices as Array<{ id: string; status: string }>)?.find(i => i.id === (p.invoice_id as string))
      if (inv) inv.status = 'paid'
      continue
    }
    if (action.type === 'add_evm') {
      const cpi = (p.ac as number) ? (p.ev as number) / (p.ac as number) : 1
      const spi = (p.pv as number) ? (p.ev as number) / (p.pv as number) : 1
      const eac = cpi ? (p.budget as number) / cpi : (p.budget as number)
      const entry = { ...p, cpi: +cpi.toFixed(3), spi: +spi.toFixed(3), eac: Math.round(eac), vac: Math.round((p.budget as number) - eac) }
      const evms = state.evm_projects as Array<Record<string, unknown>>
      const idx  = evms.findIndex(e => e.project === p.project)
      if (idx >= 0) evms[idx] = entry
      else evms.push(entry)
      continue
    }
    if (action.type.startsWith('update_')) {
      const entity = action.type.replace('update_', '')
      const col    = entity === 'status' ? (p.collection as string) : `${entity}s`
      const arr    = state[col] as Array<{ id: string }>
      if (arr) {
        const idx = arr.findIndex(r => r.id === (p.id as string))
        if (idx >= 0) Object.assign(arr[idx], p)
      }
      continue
    }
    const col = ACTION_COLLECTION_MAP[action.type]
    if (col) (state[col] as unknown[])?.push(p)
  }

  return state
}

// ─── Legacy aliases ───────────────────────────────────────────────────────────
export const _gateway = gateway
export const tn       = callAI
export const nn       = applyAIActions
