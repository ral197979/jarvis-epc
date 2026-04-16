/**
 * JARVIS EPC — Production Backend Server
 * ─────────────────────────────────────────
 * v4.30.0 — Full production API with:
 *   - PostgreSQL via pool + migrations
 *   - Multi-tenant auth (JWT + tenant resolution)
 *   - Projects, Procurement, File management, Integrations
 *   - Webhook dispatcher
 *   - Audit logging middleware
 *   - Graceful shutdown
 *
 * Endpoints:
 *   GET  /api/v1/health
 *   POST /api/v1/tenants                    — Register tenant
 *   GET  /api/v1/tenants/me                 — Tenant info (auth)
 *   PATCH /api/v1/tenants/me                — Update tenant
 *   *    /api/v1/tenants/me/users           — User management
 *   GET  /api/v1/tenants/me/usage           — Quota
 *   POST /api/v1/auth/login
 *   POST /api/v1/auth/refresh
 *   POST /api/v1/auth/logout
 *   GET  /api/v1/auth/me
 *   GET  /api/v1/admin/sessions
 *   *    /api/v1/projects
 *   *    /api/v1/vendors
 *   *    /api/v1/purchase-orders
 *   *    /api/v1/rfis
 *   *    /api/v1/submittals
 *   *    /api/v1/files
 *   *    /api/v1/integrations
 *   *    /api/v1/webhooks
 *   *    /api/v1/sync-jobs
 *   POST /api/v1/gateway                    — Anthropic AI proxy
 */

import express, { Request, Response, NextFunction } from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import cookieParser from 'cookie-parser'
import cors         from 'cors'
import helmet       from 'helmet'
import rateLimit    from 'express-rate-limit'
import { randomBytes } from 'node:crypto'
import pino from 'pino'

import {
  handleLogin, handleRefresh, handleLogout, handleMe,
  requireAuth, purgeExpiredTokens, verifyToken,
  type AuthenticatedRequest,
} from './auth'
import { initPool, poolHealthy, poolStats } from './db/pool'
import { runMigrations } from './db/migrate'
import { tenantQuery, query } from './db/pool'
import { requireTenant, TenantRequest } from './middleware/tenant'
import projectsRouter   from './routes/projects'
import tenantsRouter    from './routes/tenants'
import {
  vendorsRouter, purchaseOrdersRouter, rfisRouter, submittalsRouter,
} from './routes/procurement'
import filesRouter from './routes/files'
import {
  integrationsRouter, webhooksRouter, syncJobsRouter,
} from './routes/integrations'
import { calculationsRouter } from './routes/calculations'
import { mcpRouter          } from './routes/mcp'           // v4.28.0
import { risksRouter        } from './routes/risks'         // v4.28.0
import { dailyLogsRouter    } from './routes/dailyLogs'     // v4.31.0
import { drawingsRouter     } from './routes/drawings'      // v4.31.0
import { bimRouter          } from './routes/bim'           // v4.31.0
import { budgetsRouter      } from './routes/budgets'       // v4.31.0
import { inspectionsRouter  } from './routes/inspections'   // v4.32.0
import { punchListsRouter   } from './routes/punchLists'    // v4.32.0
import { auditRouter        } from './routes/audit'         // v4.30.0-audit
import commissioningRouter    from './routes/commissioning' // v4.30.0
import { startPackWorker, stopPackWorker } from './services/packWorker' // v4.30.0

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  ...(process.env['NODE_ENV'] !== 'production'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
  base: { service: 'jarvis-epc-api', version: '4.30.0', env: process.env['NODE_ENV'] },
})

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express()

// ─── Security headers ─────────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: false,  // handled by frontend
  crossOriginEmbedderPolicy: false,
}))

// ─── CORS ─────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean)

app.use(cors({
  origin:      ALLOWED_ORIGINS,
  credentials: true,
  methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Request-ID','X-Tenant-ID'],
}))

// ─── Body / cookie parsing ────────────────────────────────────────────────────

app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))
app.use(cookieParser())

// ─── Request ID + structured logging ─────────────────────────────────────────

app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers['x-request-id'] as string) ?? randomBytes(8).toString('hex')
  res.setHeader('X-Request-ID', requestId)
  ;(req as Request & { requestId: string }).requestId = requestId
  const start = Date.now()
  res.on('finish', () => {
    if (req.path === '/api/v1/health') return  // suppress health noise
    log.info({
      method: req.method, path: req.path, status: res.statusCode,
      duration: Date.now() - start, requestId,
    })
  })
  next()
})

// ─── Global rate limits ───────────────────────────────────────────────────────

const envInt = (k: string, def: number) => { const v = parseInt(process.env[k] ?? '', 10); return Number.isFinite(v) && v > 0 ? v : def }
const globalLimiter = rateLimit({ windowMs: 60_000,      max: envInt('RATE_LIMIT_GLOBAL_MAX', 600), standardHeaders: true, legacyHeaders: false })
const authLimiter   = rateLimit({ windowMs: 15 * 60_000, max: envInt('RATE_LIMIT_AUTH_MAX',   200), standardHeaders: true, legacyHeaders: false })
const aiLimiter     = rateLimit({ windowMs: 60_000,      max: envInt('RATE_LIMIT_AI_MAX',      30), standardHeaders: true, legacyHeaders: false })

app.use('/api/', globalLimiter)
app.use('/api/v1/auth/', authLimiter)

// ─── Audit log middleware ─────────────────────────────────────────────────────
// Logs write operations to the audit_log table automatically.

const AUDIT_METHODS = new Set(['POST','PATCH','PUT','DELETE'])
const AUDIT_SKIP    = new Set(['/api/v1/auth/refresh', '/api/v1/auth/logout'])

app.use(async (req: Request, _res: Response, next: NextFunction) => {
  if (!AUDIT_METHODS.has(req.method) || AUDIT_SKIP.has(req.path)) { next(); return }
  // We use res.on('finish') to capture the outcome
  const origJson = _res.json.bind(_res)
  _res.json = function(body) {
    // Fire-and-forget audit entry after response
    if (_res.statusCode < 400) {
      const authReq = req as AuthenticatedRequest & TenantRequest
      const tenantId = authReq.tenantId
      const userId   = authReq.auth?.sub
      if (tenantId && userId) {
        const action = req.method === 'DELETE' ? 'delete'
          : req.method === 'POST' ? 'create' : 'update'
        const parts   = req.path.split('/').filter(Boolean)
        const resource = parts[2] ?? 'unknown'  // /api/v1/resource/...
        const resourceId = parts[3] && /^[0-9a-f-]{36}$/.test(parts[3]) ? parts[3] : undefined

        tenantQuery(tenantId, `
          INSERT INTO audit_log (tenant_id,user_id,action,resource,resource_id,ip_address,request_id)
          VALUES (current_setting('app.current_tenant_id',true)::uuid,$1,$2,$3,$4,$5,$6)
        `, [userId, action, resource, resourceId ?? null,
           req.ip ?? null,
           (req as Request & { requestId?: string }).requestId ?? null,
        ]).catch(() => {})  // never block the response
      }
    }
    return origJson(body)
  }
  next()
})

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/api/v1/health', async (_req: Request, res: Response) => {
  const dbOk = poolHealthy()
  res.status(dbOk ? 200 : 503).json({
    status:  dbOk ? 'ok' : 'degraded',
    version: '4.30.0',
    uptime:  Math.floor(process.uptime()),
    ts:      new Date().toISOString(),
    db:      dbOk ? { ...poolStats() } : 'unavailable',
    storage: process.env['STORAGE_BACKEND'] ?? 'local',
  })
})

// ─── Auth routes ──────────────────────────────────────────────────────────────

app.post('/api/v1/auth/login',   authLimiter, (req, res) => handleLogin(req, res))
app.post('/api/v1/auth/refresh', authLimiter, (req, res) => handleRefresh(req, res))
app.post('/api/v1/auth/logout',  requireAuth as never, (req, res) => handleLogout(req as AuthenticatedRequest, res))
app.get('/api/v1/auth/me',       requireAuth as never, (req, res) => handleMe(req as AuthenticatedRequest, res))

// Owner session dashboard
app.get('/api/v1/admin/sessions', requireAuth as never, (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest
  if (!['owner','admin'].includes(authReq.auth?.role ?? '')) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  // Return pool + process stats; detailed session log stored in DB refresh_tokens
  res.json({
    poolStats: poolStats(),
    uptime:    Math.floor(process.uptime()),
    memory:    process.memoryUsage(),
    nodeVersion: process.version,
    ts: new Date().toISOString(),
  })
})

// ─── Tenant routes ────────────────────────────────────────────────────────────

app.use('/api/v1/tenants', tenantsRouter)

// ─── Domain routes ────────────────────────────────────────────────────────────

app.use('/api/v1/projects',       projectsRouter)
app.use('/api/v1/vendors',        vendorsRouter)
app.use('/api/v1/purchase-orders', purchaseOrdersRouter)
app.use('/api/v1/rfis',           rfisRouter)
app.use('/api/v1/submittals',     submittalsRouter)
app.use('/api/v1/files',          filesRouter)
app.use('/api/v1/integrations',   integrationsRouter)
app.use('/api/v1/webhooks',       webhooksRouter)
app.use('/api/v1/sync-jobs',      syncJobsRouter)
// Specific-prefix mounts MUST precede the broad '/api/v1' mounts below,
// otherwise those catch-all routers' top-level requireAuth middleware will
// 401 requests destined for more specific mounts (e.g. /api/v1/mcp/tools).
app.use('/api/v1/mcp',            mcpRouter)           // v4.28.0: MCP bridge + native tools
app.use('/api/v1/commissioning',  commissioningRouter) // v4.30.0: Pack generation workflow
app.use('/api/v1',                calculationsRouter)
app.use('/api/v1',                risksRouter)         // v4.28.0: Risk Register CRUD
app.use('/api/v1',                dailyLogsRouter)      // v4.31.0: Daily logs
app.use('/api/v1',                drawingsRouter)       // v4.31.0: Drawings + revisions + markups
app.use('/api/v1',                bimRouter)            // v4.31.0: BIM models + coordination issues
app.use('/api/v1',                budgetsRouter)        // v4.31.0: Budgets + change orders
app.use('/api/v1',                inspectionsRouter)    // v4.32.0: Inspection templates + records
app.use('/api/v1',                punchListsRouter)     // v4.32.0: Punch lists + items
app.use('/api/v1/audit',          auditRouter)          // v4.30.0: Audit log read API

// ─── AI Gateway ───────────────────────────────────────────────────────────────

app.post('/api/v1/gateway', requireAuth as never, aiLimiter, async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest
  const gatewayEnabled = process.env['VITE_ENABLE_AI_CHAT'] !== 'false'
  if (!gatewayEnabled) {
    res.status(503).json({ error: 'gateway_disabled', message: 'AI gateway is currently disabled.' })
    return
  }

  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) {
    res.status(500).json({ error: 'gateway_not_configured', message: 'Anthropic API key not configured.' })
    return
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    })

    const data = await upstream.json()
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: 'upstream_error', detail: data })
      return
    }
    res.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error({ msg, path: '/api/v1/gateway' }, 'Gateway request failed')
    res.status(502).json({ error: 'gateway_unreachable', message: msg })
  }
})

// ─── Static SPA (production) ──────────────────────────────────────────────────
if (process.env['NODE_ENV'] === 'production' || process.env['SERVE_STATIC'] === '1') {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const distDir = path.resolve(__dirname, '..', 'dist')
  app.use(express.static(distDir, { index: false, maxAge: '1y' }))
  app.get(/^\/(?!api\/).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not_found', message: 'Endpoint not found.' })
})

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  log.error({ err: err.message, stack: err.stack }, 'Unhandled error')
  res.status(500).json({ error: 'internal_error', message: process.env['NODE_ENV'] === 'production' ? 'An unexpected error occurred.' : err.message })
})

// ─── Startup ──────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  const PORT = Number(process.env['PORT'] ?? 3001)

  log.info('[startup] Connecting to PostgreSQL...')
  await initPool()

  log.info('[startup] Running migrations...')
  await runMigrations()

  // Start commissioning pack job worker (v4.30.0)
  startPackWorker()

  // Periodic cleanup
  setInterval(() => {
    purgeExpiredTokens().catch(() => {})
  }, 60 * 60 * 1000)  // every hour

  const server = app.listen(PORT, () => {
    log.info(`[startup] JARVIS EPC API v4.30.0 listening on port ${PORT}`)
  })

  // Graceful shutdown
  for (const sig of ['SIGTERM','SIGINT']) {
    process.on(sig, () => {
      log.info(`[shutdown] ${sig} received — draining connections...`)
      stopPackWorker() // v4.30.0
      server.close(() => {
        log.info('[shutdown] HTTP server closed')
        process.exit(0)
      })
    })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    log.fatal({ err: err.message }, '[startup] Fatal error — exiting')
    process.exit(1)
  })
}

export default app
export { start }
