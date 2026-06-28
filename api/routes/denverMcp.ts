/**
 * Denver Engineering — Denver MCP server route (R6c)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET  /tools  — list Denver's MCP tool metadata
 *   POST /call   — { tool, args } → dispatch a tool, returns { tool, result }
 *
 * Provider side (other systems call Denver). Flag-gated by DENVER_MCP_SERVER.
 * NOT mounted in server.ts yet: POST /call is a mutating service-to-service entry
 * that needs an explicit auth model (bearer token + CSRF exemption) — a deliberate
 * follow-up. Until mounted it changes nothing.
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import {
  buildDenverMcpRegistry, dispatch, isDenverMcpServerEnabled,
  UnknownToolError, ToolValidationError,
} from '../services/mcp/denverMcpServer'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest

const router = Router()
const registry = buildDenverMcpRegistry()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/tools', (_req: Request, res: Response) => {
  if (!isDenverMcpServerEnabled()) { res.status(404).json({ error: 'denver mcp server not enabled' }); return }
  res.json({ tools: registry.list() })
})

router.post('/call', async (req: Request, res: Response) => {
  if (!isDenverMcpServerEnabled()) { res.status(404).json({ error: 'denver mcp server not enabled' }); return }
  const r = req as AuthTenantReq
  const { tool, args } = req.body as { tool?: string; args?: Record<string, unknown> }
  if (!tool) { res.status(400).json({ error: 'tool is required' }); return }
  try {
    const result = await dispatch(registry, tool, { tenantId: r.tenantId ?? null }, args ?? {})
    res.json({ tool, result })
  } catch (err) {
    if (err instanceof UnknownToolError)   { res.status(404).json({ error: err.message }); return }
    if (err instanceof ToolValidationError) { res.status(400).json({ error: err.message }); return }
    res.status(500).json({ error: 'tool dispatch failed', detail: (err as Error).message })
  }
})

export const denverMcpRouter = router
