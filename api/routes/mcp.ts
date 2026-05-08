/**
 * Denver Engineering — MCP Bridge Route
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.28.0 — Denver release
 *
 * Two layers of MCP execution:
 *
 *   1. Native tools — implemented directly in this Express handler:
 *        http_fetch, audit_log, audit_query, model_call, embedding_create
 *        session_create (persisted to calc_sessions as agent sessions)
 *
 *   2. Ava proxy — every other tool call forwarded to the Ava FastMCP server
 *        at AVA_MCP_URL. If AVA_MCP_URL is not configured, those tools return
 *        a 503 with an actionable message.
 *
 * Security boundaries:
 *   - All routes require JWT auth + active tenant.
 *   - http_fetch enforces ALLOWED_FETCH_DOMAINS (allowlist). Wildcards forbidden.
 *   - bash / file_read / process_kill / face_* are Ava-only — never natively
 *     implemented here; blocked if Ava is unreachable.
 *   - Model calls use the backend ANTHROPIC_API_KEY — never exposed to browser.
 *
 * Endpoints:
 *   GET  /api/v1/mcp/tools              — merged tool catalogue (native + Ava)
 *   POST /api/v1/mcp/execute            — execute any tool
 *   GET  /api/v1/mcp/ava/health         — Ava server health probe
 *   GET  /api/v1/mcp/sessions           — list agent sessions for tenant
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import { tenantQuery, query }                       from '../db/pool'
import Anthropic from '@anthropic-ai/sdk'

// v4.31.0 TS fix: narrow tenantId to required for post-middleware handlers.
type AuthTenantReq = Request & AuthenticatedRequest & Omit<TenantRequest, 'tenantId'> & { tenantId: string }

const router = Router()
// Public read-only endpoints (tool catalog + Ava health) bypass auth so the UI
// can render the tool browser without a full login session.
const PUBLIC_GET_PATHS = new Set(['/tools', '/ava/health'])
router.use((req, res, next) => {
  if (req.method === 'GET' && PUBLIC_GET_PATHS.has(req.path)) return next()
  return (requireAuth as any)(req, res, next)
})
router.use((req, res, next) => {
  if (req.method === 'GET' && PUBLIC_GET_PATHS.has(req.path)) return next()
  return (requireTenant as any)(req, res, next)
})

// ─── Config ───────────────────────────────────────────────────────────────────
// v4.31.0 test-friendliness: read env vars live (via getters) so tests that
// set process.env per-case take effect without reloading the module.

function getAvaMcpUrl(): string | undefined {
  return process.env['AVA_MCP_URL']
}

function getAvaTimeout(): number {
  return parseInt(process.env['AVA_MCP_TIMEOUT_MS'] ?? '15000', 10)
}

/** Comma-separated list of domains http_fetch may contact. */
function getFetchAllowlist(): string[] {
  return (process.env['MCP_FETCH_ALLOWLIST'] ?? '')
    .split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
}

// (AVA_TIMEOUT / FETCH_ALLOWLIST are read via getters below — no module-level
// caches so tests can override env per-case.)

const anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })

// ─── Native tool catalogue ─────────────────────────────────────────────────────

const NATIVE_TOOLS = [
  { name: 'http_fetch',        cat: 'System',   live: true,  desc: 'HTTP GET/POST to allowlisted domains', params: ['url', 'method', 'body', 'headers'] },
  { name: 'audit_log',         cat: 'Security', live: true,  desc: 'Write structured audit entry to DB',   params: ['action', 'details'] },
  { name: 'audit_query',       cat: 'Security', live: true,  desc: 'Query tenant audit log',               params: ['filter', 'limit'] },
  { name: 'model_call',        cat: 'AI',       live: true,  desc: 'Call Claude via backend API key',      params: ['model', 'messages', 'max_tokens', 'system'] },
  { name: 'embedding_create',  cat: 'AI',       live: true,  desc: 'Create text embedding vector',        params: ['text', 'model'] },
  { name: 'session_create',    cat: 'AI',       live: true,  desc: 'Create a named agent session',        params: ['model', 'system_prompt', 'name'] },
  { name: 'session_resume',    cat: 'AI',       live: true,  desc: 'Resume an existing agent session',    params: ['session_id', 'message'] },
  { name: 'knowledge.fix_search', cat: 'Knowledge', live: true,
    desc: 'Search the tenant fix library by symptoms / asset system / free text. Returns ranked resolutions.',
    params: ['symptoms', 'asset_system', 'asset_tag', 'query', 'limit', 'min_confidence'] },
  { name: 'knowledge.search', cat: 'Knowledge', live: true,
    desc: 'Full-text search over ingested PDF corpus (manuals, IOMs, specs, standards). Returns ranked chunks w/ source citation.',
    params: ['query', 'topK', 'source_ids', 'tags', 'asset_system', 'license_types'] },
  { name: 'ask_domain', cat: 'Knowledge', live: true,
    desc: 'Grounded RAG: tier-weighted retrieval + Fix Library lookup + Claude w/ schema-enforced JSON. Returns { answer, procedure, possible_causes, confidence, citations }.',
    params: ['question', 'project_id', 'asset_system', 'top_k'] },
]

// v4.31.0 TS fix: AVA_ONLY_TOOLS reference catalogue kept as documentation;
// prefix with `void` to acknowledge intentional non-use and satisfy both
// loose and strict typechecks (the strict config raises noUnusedLocals).
 
const AVA_ONLY_TOOLS = [
  'bash','file_read','file_write','file_search','glob',
  'process_list','process_kill','clipboard_read','clipboard_write',
  'browser_open','browser_click','browser_type','browser_screenshot',
  'cron_add','cron_list','cron_remove','webhook_register','webhook_list',
  'canvas_create','canvas_draw','vision_capture','vision_analyze',
  'face_recognize','face_add','face_list',
  'agi_reason','agi_plan','agi_evolve','agi_reflect',
  'skill_run','skill_list','skill_install',
  'mcp_tool','mcp_resource',
  'secret_get','secret_set',
] as const
// v4.31.0 TS fix: suppress noUnusedLocals for this reference catalogue
void AVA_ONLY_TOOLS

// ─── Helpers ──────────────────────────────────────────────────────────────────

// v4.31.0 TS fix: disambiguate from Express's Response — the Web fetch Response
// has `.ok` / `.status` property, not a method. Use globalThis.Response so TS
// doesn't resolve to the Express type imported at the top of this file.
async function fetchAva(path: string, options?: RequestInit, timeoutMs?: number): Promise<globalThis.Response> {
  const AVA_MCP_URL = getAvaMcpUrl()
  if (!AVA_MCP_URL) throw new Error('AVA_MCP_URL not configured')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs ?? getAvaTimeout())
  try {
    return await fetch(`${AVA_MCP_URL}${path}`, { ...options, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function isDomainAllowed(url: string): boolean {
  const FETCH_ALLOWLIST = getFetchAllowlist()
  if (FETCH_ALLOWLIST.length === 0) return true  // open by default in dev
  try {
    const host = new URL(url).hostname.toLowerCase()
    return FETCH_ALLOWLIST.some(d => host === d || host.endsWith(`.${d}`))
  } catch {
    return false
  }
}

async function writeAudit(tenantId: string, userId: string | undefined, action: string, details: unknown) {
  await query(
    `INSERT INTO audit_log (tenant_id, user_id, action, resource_type, resource_id, changes, created_at)
     VALUES ($1,$2,$3,'mcp_tool',$4,$5,NOW()) ON CONFLICT DO NOTHING`,
    [tenantId, userId ?? null, action, action, JSON.stringify(details)]
  ).catch(e => console.warn('[mcp] audit_log insert failed:', e.message))
}

// ─── GET /api/v1/mcp/tools — merged catalogue ──────────────────────────────────

router.get('/tools', async (req: Request, res: Response) => {
  const AVA_MCP_URL = getAvaMcpUrl()
  const avaTools: unknown[] = []

  if (AVA_MCP_URL) {
    try {
      const avaRes = await fetchAva('/tools', {}, 5000)
      if (avaRes.ok) {
        const body = await avaRes.json() as { tools?: unknown[] }
        avaTools.push(...(body.tools ?? []))
      }
    } catch {
      // Ava unreachable — return native-only catalogue
    }
  }

  // Merge: if Ava returned a tool with the same name as a native, Ava wins (richer)
  const avaNames = new Set((avaTools as { name: string }[]).map(t => t.name))
  const nativeFiltered = NATIVE_TOOLS.filter(t => !avaNames.has(t.name))

  res.json({
    tools: [...nativeFiltered, ...avaTools],
    ava_connected: AVA_MCP_URL ? avaTools.length > 0 : false,
    ava_url: AVA_MCP_URL ? AVA_MCP_URL.replace(/\/\/.*@/, '//***@') : null,
    native_count: nativeFiltered.length,
    ava_count: avaTools.length,
  })
})

// ─── GET /api/v1/mcp/ava/health ───────────────────────────────────────────────

router.get('/ava/health', async (_req: Request, res: Response) => {
  const AVA_MCP_URL = getAvaMcpUrl()
  if (!AVA_MCP_URL) {
    return res.json({ healthy: false, reason: 'AVA_MCP_URL not configured' })
  }
  try {
    const r = await fetchAva('/health', {}, 3000)
    const body = await r.json() as Record<string, unknown>
    // v4.31.0 TS fix: spread Ava body first so our authoritative `status` + `healthy`
    // override any same-named fields returned by Ava's health endpoint.
    res.json({ ...body, healthy: r.ok, status: r.status })
  } catch (e: unknown) {
    res.json({ healthy: false, reason: (e as Error).message })
  }
})

// ─── POST /api/v1/mcp/execute — unified tool dispatch ─────────────────────────

router.post('/execute', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { tool, params = {}, project_id } = req.body as {
    tool?: string; params?: Record<string, unknown>; project_id?: string
  }

  if (!tool || typeof tool !== 'string') {
    return res.status(400).json({ error: 'tool name required' })
  }

  // v4.31.0: per-tenant MCP marketplace — tools explicitly disabled by an
  // admin in mcp_disabled_tools are blocked here. Default is enabled (no row).
  try {
    const disabledRes = await tenantQuery<{ tool_name: string }>(r.tenantId, `
      SELECT tool_name FROM mcp_disabled_tools
      WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid
        AND  tool_name = $1
    `, [tool])
    if (disabledRes.rows.length > 0) {
      return res.status(403).json({
        error: 'tool_disabled',
        message: `Tool '${tool}' is disabled for this tenant.`,
        tool,
      })
    }
  } catch {
    // Marketplace table unavailable — fail open (don't block existing flows).
  }

  // Emit audit entry (non-fatal)
  await writeAudit(r.tenantId, r.auth?.sub, `mcp:${tool}`, { params, project_id })

  // ── Native tool dispatch ──
  const isNative = NATIVE_TOOLS.some(t => t.name === tool)
  if (isNative) {
    return executeNative(tool, params, r, project_id, res)
  }

  // ── Ava-only or unknown — proxy to Ava ──
  const AVA_MCP_URL = getAvaMcpUrl()
  if (!AVA_MCP_URL) {
    return res.status(503).json({
      error: 'ava_not_configured',
      message: `Tool '${tool}' requires the Ava MCP server. Set AVA_MCP_URL in your environment.`,
      tool,
    })
  }

  try {
    const avaRes = await fetchAva('/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': r.tenantId },
      body: JSON.stringify({ tool, params, context: { tenant_id: r.tenantId, user_id: r.auth?.sub, project_id } }),
    })
    const body = await avaRes.json()
    res.status(avaRes.status).json(body)
  } catch (e: unknown) {
    res.status(503).json({ error: 'ava_unreachable', message: (e as Error).message })
  }
})

// ─── GET /api/v1/mcp/sessions — agent sessions for tenant ──────────────────────

router.get('/sessions', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { limit = '20', offset = '0', project_id } = req.query

  const params: unknown[] = [r.tenantId]
  let projectFilter = ''
  if (project_id) { params.push(project_id); projectFilter = `AND project_id = $${params.length}` }
  params.push(parseInt(limit as string), parseInt(offset as string))

  try {
    const result = await tenantQuery(r.tenantId,
      `SELECT id, tool_name, tool_version, input_summary, output_summary, notes, created_at,
              CASE WHEN pid_svg IS NOT NULL THEN true ELSE false END AS has_pid
       FROM calc_sessions
       WHERE tenant_id = $1 AND tool_name LIKE 'agent:%' ${projectFilter}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ sessions: result.rows })
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ─── Native executor ──────────────────────────────────────────────────────────

async function executeNative(
  tool: string,
  params: Record<string, unknown>,
  r: AuthTenantReq,
  projectId: string | undefined,
  res: Response,
): Promise<void> {

  try {
    switch (tool) {

      // ── http_fetch ──────────────────────────────────────────────────────────
      case 'http_fetch': {
        const url    = String(params['url'] ?? '')
        const method = String(params['method'] ?? 'GET').toUpperCase()
        const body   = params['body']

        if (!url) return void res.status(400).json({ error: 'url required' })
        if (!isDomainAllowed(url)) {
          return void res.status(403).json({ error: 'domain_not_allowed', url,
            message: `Domain not in MCP_FETCH_ALLOWLIST. Add it to enable http_fetch for this domain.` })
        }
        const allowed = ['GET','POST','PUT','PATCH','DELETE','HEAD']
        if (!allowed.includes(method)) return void res.status(400).json({ error: `method must be one of ${allowed.join(', ')}` })

        const fetchRes = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', ...(params['headers'] as object ?? {}) },
          body: body ? JSON.stringify(body) : undefined,
        })
        const text = await fetchRes.text()
        let json: unknown
        try { json = JSON.parse(text) } catch { json = null }

        res.json({ ok: fetchRes.ok, status: fetchRes.status, body: json ?? text,
          headers: Object.fromEntries(fetchRes.headers.entries()) })
        break
      }

      // ── audit_log ───────────────────────────────────────────────────────────
      case 'audit_log': {
        const action  = String(params['action'] ?? 'mcp_manual')
        const details = params['details'] ?? {}
        await writeAudit(r.tenantId, r.auth?.sub, action, details)
        res.json({ ok: true, action })
        break
      }

      // ── audit_query ─────────────────────────────────────────────────────────
      case 'audit_query': {
        const filter = String(params['filter'] ?? '')
        const limit  = Math.min(parseInt(String(params['limit'] ?? '50')), 200)
        const result = await query(
          `SELECT id, action, resource_type, resource_id, changes, created_at
           FROM audit_log
           WHERE tenant_id = $1 ${filter ? `AND action ILIKE $2` : ''}
           ORDER BY created_at DESC LIMIT ${limit}`,
          filter ? [r.tenantId, `%${filter}%`] : [r.tenantId]
        )
        res.json({ entries: result.rows, count: result.rowCount })
        break
      }

      // ── model_call ──────────────────────────────────────────────────────────
      case 'model_call': {
        const model      = String(params['model'] ?? 'claude-sonnet-4-6')
        const messages   = params['messages'] as Anthropic.MessageParam[] ?? []
        const max_tokens = parseInt(String(params['max_tokens'] ?? '1024'))
        const system     = params['system'] ? String(params['system']) : undefined

        if (!messages.length) return void res.status(400).json({ error: 'messages required' })

        const completion = await anthropic.messages.create({
          model, messages, max_tokens, ...(system ? { system } : {}),
        })

        res.json({
          id:      completion.id,
          model:   completion.model,
          content: completion.content,
          usage:   completion.usage,
          stop_reason: completion.stop_reason,
        })
        break
      }

      // ── embedding_create ────────────────────────────────────────────────────
      case 'embedding_create': {
        // Anthropic doesn't expose embeddings — proxy hint to Ava if available
        const AVA_MCP_URL = getAvaMcpUrl()
        if (AVA_MCP_URL) {
          const avaRes = await fetchAva('/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: 'embedding_create', params }),
          })
          const body = await avaRes.json()
          res.status(avaRes.status).json(body)
        } else {
          res.status(501).json({ error: 'embedding_create requires Ava MCP server (AVA_MCP_URL). Ava uses Nomic/sentence-transformers.' })
        }
        break
      }

      // ── session_create ──────────────────────────────────────────────────────
      case 'session_create': {
        const model         = String(params['model'] ?? 'claude-sonnet-4-6')
        const system_prompt = String(params['system_prompt'] ?? '')
        const name          = String(params['name'] ?? `agent-${Date.now()}`)

        const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

        // Persist as a calc_session with tool_name prefixed 'agent:'
        await tenantQuery(r.tenantId,
          `INSERT INTO calc_sessions
             (tenant_id, project_id, tool_name, tool_version, input_summary, output_summary, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [r.tenantId, projectId ?? null, `agent:${name}`, model,
           JSON.stringify({ name, model }),
           JSON.stringify({ session_id: sessionId, system_prompt_preview: system_prompt.slice(0, 200), status: 'created' }),
           r.auth?.sub ?? null]
        )

        res.status(201).json({ session_id: sessionId, name, model, status: 'created' })
        break
      }

      // ── session_resume ──────────────────────────────────────────────────────
      case 'session_resume': {
        const session_id = String(params['session_id'] ?? '')
        const message    = String(params['message'] ?? '')
        if (!session_id || !message) return void res.status(400).json({ error: 'session_id and message required' })

        // Stateless resume — just call Claude with the message
        const completion = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          messages: [{ role: 'user', content: message }],
        })

        const reply = completion.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('')
        res.json({ session_id, reply, usage: completion.usage })
        break
      }

      // ── knowledge.search — ingested-corpus full-text search ────────────────
      case 'knowledge.search': {
        const { searchKnowledge } = await import('../services/knowledgeSearch')
        const q = String(params['query'] ?? '').trim()
        if (!q) return void res.status(400).json({ error: 'query required' })
        const hits = await searchKnowledge({
          tenantId:    r.tenantId,
          query:       q,
          topK:        typeof params['topK'] === 'number' ? params['topK'] as number : undefined,
          sourceIds:   Array.isArray(params['source_ids'])    ? params['source_ids']    as string[] : undefined,
          tags:        Array.isArray(params['tags'])          ? params['tags']          as string[] : undefined,
          assetSystem: params['asset_system'] as string | undefined,
          licenseTypes: Array.isArray(params['license_types']) ? params['license_types'] as string[] : undefined,
        })
        res.json({ hits })
        break
      }

      // ── ask_domain — grounded RAG, schema-enforced answer ─────────────────
      case 'ask_domain': {
        if (!r.auth?.sub) return void res.status(401).json({ error: 'user_required' })
        const { askJarvis } = await import('../services/askBuilder')
        const question = String(params['question'] ?? '').trim()
        if (!question) return void res.status(400).json({ error: 'question required' })
        try {
          const out = await askJarvis({
            tenantId:     r.tenantId,
            userId:       r.auth.sub,
            question,
            projectId:    (params['project_id']   as string | undefined) ?? null,
            assetSystem:  (params['asset_system'] as string | undefined) ?? null,
            topK:         typeof params['top_k'] === 'number' ? params['top_k'] as number : undefined,
          })
          // Return the structured answer directly (what agents consume),
          // plus trace metadata for audit.
          res.json({
            ...out.structured,
            _meta: {
              session_id:   out.session_id,
              message_id:   out.message_id,
              model:        out.model,
              retrieved:    out.retrieved_chunks.map(c => ({ chunk_id: c.chunk_id, score: c.score, tier: c.tier })),
              fixes:        out.matched_fixes.map(f => ({ fix_id: f.fix.id, score: f.score })),
              input_tokens: out.input_tokens,
              output_tokens: out.output_tokens,
              elapsed_ms:   out.elapsed_ms,
            },
          })
        } catch (e: unknown) {
          const msg = (e as Error).message
          if (msg.includes('ANTHROPIC_API_KEY')) {
            res.status(503).json({ error: 'llm_not_configured', message: msg })
          } else {
            res.status(500).json({ error: 'ask_failed', message: msg })
          }
        }
        break
      }

      // ── knowledge.fix_search — tenant Fix Library retrieval ───────────────
      case 'knowledge.fix_search': {
        const { searchFixes } = await import('../services/fixLibrary')
        const symptoms = Array.isArray(params['symptoms']) ? (params['symptoms'] as string[]) : undefined
        const hits = await searchFixes({
          tenantId:      r.tenantId,
          symptoms,
          assetSystem:   params['asset_system'] as string | undefined,
          assetTag:      params['asset_tag']    as string | undefined,
          query:         params['query']        as string | undefined,
          limit:         typeof params['limit'] === 'number' ? params['limit'] as number : undefined,
          minConfidence: params['min_confidence'] as 'confirmed'|'probable'|'suspected'|undefined,
        })
        res.json({ hits: hits.map(h => ({
          fix_id:       h.fix.id,
          score:        Number(h.score.toFixed(3)),
          confidence:   h.fix.confidence,
          asset_system: h.fix.asset_system,
          asset_tag:    h.fix.asset_tag,
          symptoms:     h.fix.symptoms,
          root_cause:   h.fix.root_cause,
          resolution:   h.fix.resolution_steps,
          source_url:   h.fix.source_url,
          why:          h.why,
        })) })
        break
      }

      default:
        res.status(404).json({ error: 'tool_not_found', tool })
    }
  } catch (e: unknown) {
    console.error(`[mcp] native tool '${tool}' error:`, e)
    res.status(500).json({ error: 'tool_execution_failed', message: (e as Error).message, tool })
  }
}

export { router as mcpRouter }
