/**
 * Denver Engineering — Production Backend Server
 * ─────────────────────────────────────────
 * v9.0.0 — Full production API with:
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

// v4.31.0 TS fix: drop unused imports (`verifyToken`, `query`, `requireTenant`)
import {
  handleLogin, handleRefresh, handleLogout, handleMe,
  requireAuth, purgeExpiredTokens,
  type AuthenticatedRequest,
} from './auth'
import { initPool, poolHealthy, poolStats } from './db/pool'
import { runMigrations } from './db/migrate'
import { tenantQuery } from './db/pool'
import { requireTenant, TenantRequest } from './middleware/tenant'
import { registerUuidParamGuards, validateUuidQueryParams } from './middleware/validateUuidParams'
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
import { systemsRouter       } from './routes/systems'       // v4.32.0: EPC hierarchy (F05)
import { testPacksRouter     } from './routes/testPacks'     // v4.32.0: real test packs (F05)
import { testResultsRouter   } from './routes/testResults'   // v4.32.0: per-step results (F01)
import { deficienciesRouter  } from './routes/deficiencies'  // v4.32.0: test-traced deficiencies (F01)
import { commissioningItemsRouter } from './routes/commissioningItems' // v4.32.0: CX checklist items (P2)
import { auditRouter        } from './routes/audit'         // v4.30.0-audit
import commissioningRouter    from './routes/commissioning' // v4.30.0
import automationRouter       from './routes/automation'    // v4.31.0
import complianceRouter       from './routes/compliance'    // v4.31.0
import fieldSyncRouter        from './routes/fieldSync'     // v4.31.0
import scheduleRouter         from './routes/schedule'      // v4.31.0
import autosignRulesRouter    from './routes/autosignRules' // v4.31.0
import agentActionsRouter     from './routes/agentActionsRoutes' // v4.31.0
import baselinesRouter        from './routes/baselinesRoutes'    // v4.31.0
import correlationsRouter     from './routes/correlations'       // v4.31.0
import fixLibraryRouter       from './routes/fixLibrary'          // v4.31.0
import knowledgeRouter        from './routes/knowledge'            // v4.31.0
import askRouter              from './routes/ask'                  // v4.31.0
import { startPackWorker, stopPackWorker } from './services/packWorker' // v4.30.0
import { startScheduler,  stopScheduler  } from './services/scheduler'  // v4.31.0
import { registerWebhookDispatchHandler, emitEvent } from './services/webhookDispatch' // v4.31.0
import { registerIntegrationSync } from './services/integrationSync' // v4.31.0
import { registerKpiSnapshotHandler } from './services/kpiSnapshot'  // v4.31.0
import { registerComplianceWatcher } from './services/complianceWatcher' // v4.31.0
import { registerAuditRetentionHandler } from './services/auditRetention' // v4.31.0
import { actionsRouter } from './routes/actions'                          // v4.33.0 Ava
import { registerSlaEngine } from './services/slaEngine'                  // v4.33.0 Ava
import { registerNotificationWorker } from './services/notifications/notificationWorker'     // v4.34.0 Ava
import { registerAnalyticsSnapshotHandler } from './services/actions/actionAnalyticsService' // v4.34.0 Ava
import { registerKnowledgeIngestHandler } from './services/knowledgeIngest' // v4.31.0
import { registerFixExtractorHandler }    from './services/fixExtractor'    // v4.31.0
import { registerKnowledgeEmbedHandler }  from './services/knowledgeEmbed'  // v4.31.0
import { opsRouter       } from './routes/ops'                              // v4.35.0 Ava Phase 3
import { readinessRouter } from './routes/readiness'                        // v4.35.0 Ava Phase 3
import { syncRouter      } from './routes/sync'                             // v4.35.0 Ava Phase 3
import { evidenceRouter  } from './routes/evidence'                         // v4.35.0 Ava Phase 3
import { registerWebSocketGateway } from './realtime/wsGateway'            // v4.35.0 Ava Phase 3
import { registerReadinessSnapshotHandler } from './services/readiness/readinessSnapshots' // v4.35.0 Ava Phase 3
import { runbooksRouter       } from './routes/runbooks'                    // v4.40.0 Ava Phase 4
import { aiGovernanceRouter   } from './routes/aiGovernance'               // v4.40.0 Ava Phase 4
import { simulationRouter     } from './routes/simulation'                  // v4.40.0 Ava Phase 4
import { policiesRouter       } from './routes/policies'                    // v4.40.0 Ava Phase 4
import { executiveRouter      } from './routes/executive'                   // v4.40.0 Ava Phase 4
import { integrationHubRouter } from './routes/integrationHub'             // v4.40.0 Ava Phase 4
import { exportsRouter        } from './routes/exports'                     // v4.40.0 Ava Phase 4
import { auditVerificationRouter } from './routes/auditVerification'       // v4.40.0 Ava Phase 4
import { agentsRouter           } from './routes/agents'                    // v5.0.0 Ava Phase 5
import { agentApprovalsRouter   } from './routes/agentApprovals'            // v5.0.0 Ava Phase 5
import { agentMemoryRouter      } from './routes/agentMemory'               // v5.0.0 Ava Phase 5
import { agentRiskRouter        } from './routes/agentRisk'                 // v5.0.0 Ava Phase 5
import { agentReadinessRouter   } from './routes/agentReadiness'            // v5.0.0 Ava Phase 5
import twinRouter                  from './routes/twin'                      // v6.0.0 Ava Phase 6: Digital Twin
import portfolioRouter             from './routes/portfolio'                 // v6.0.0 Ava Phase 6: Portfolio Intelligence
import scenariosRouter             from './routes/scenarios'                 // v6.0.0 Ava Phase 6: Scenario Simulation
import adaptiveRouter              from './routes/adaptive'                   // v7.0.0 Ava Phase 7: Adaptive Intelligence
import optimizationRouter          from './routes/optimization'               // v7.0.0 Ava Phase 7: Resource Optimization + Strategy
import enterpriseRouter            from './routes/enterprise'                 // v8.0.0 Ava Phase 8: Enterprise Deployment Platform
import ecosystemRouter             from './routes/ecosystem'                  // v9.0.0 Ava Phase 9: Federated Intelligence + Ecosystem Platform
import { estimatingRouter         } from './routes/estimating'                // v10.0.0: BIM Element Layer + Estimating Engine
import { monteCarloRouter         } from './routes/monteCarlo'                // v10.1.0: Monte Carlo Risk Simulation
import { transmittalsRouter       } from './routes/transmittals'              // v10.1.0: Transmittal / Doc Control
import { evmRouter                    } from './routes/evm'                                               // v10.3.0: Earned Value Management
import { scheduleImportRouter         } from './routes/scheduleImport'                                    // v10.4.0: P6 XER + MSP XML schedule import
import { iotRouter                    } from './routes/iot'                                               // v10.5.0: IoT sensor ingest
import { startIfcParseWorker,         stopIfcParseWorker         } from './services/bim/ifcParseWorker'                  // v10.2.0: IFC parse worker
import { startFederatedAggregationWorker, stopFederatedAggregationWorker } from './services/ecosystem/federatedAggregationWorker' // v10.2.0: DP aggregation worker

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  ...(process.env['NODE_ENV'] !== 'production'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
  base: { service: 'denver-engineering-api', version: '9.0.0', env: process.env['NODE_ENV'] },
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

// ─── Correlation ID + Request ID middleware (v4.34.0) ────────────────────────
// Propagates X-Correlation-ID for cross-service tracing. Falls back to
// X-Request-ID. Both are echoed in the response headers.

app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers['x-correlation-id'] as string)
    ?? (req.headers['x-request-id'] as string)
    ?? randomBytes(8).toString('hex')
  ;(req as Record<string, unknown>)['correlationId'] = correlationId
  res.setHeader('X-Correlation-ID', correlationId)
  next()
})

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
        let action: string
        if (req.path === '/api/v1/auth/login') action = 'login'
        else if (req.method === 'DELETE') action = 'delete'
        else if (req.method === 'POST')    action = 'create'
        else                               action = 'update'
        const parts   = req.path.split('/').filter(Boolean)
        const resource = parts[2] ?? 'unknown'  // /api/v1/resource/...
        const resourceId = parts[3] && /^[0-9a-f-]{36}$/.test(parts[3]) ? parts[3] : undefined

        // v4.30.0: capture request body as new_data for create/update (redact sensitive keys)
        const SENSITIVE = new Set(['password','token','refresh_token','secret','api_key','authorization'])
        const redact = (v: unknown): unknown => {
          if (!v || typeof v !== 'object') return v
          if (Array.isArray(v)) return v.map(redact)
          const out: Record<string, unknown> = {}
          for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
            out[k] = SENSITIVE.has(k.toLowerCase()) ? '[redacted]' : redact(val)
          }
          return out
        }
        const newData = (action === 'create' || action === 'update') && req.body && Object.keys(req.body).length
          ? JSON.stringify(redact(req.body))
          : null

        tenantQuery(tenantId, `
          INSERT INTO audit_log (tenant_id,user_id,action,resource,resource_id,new_data,ip_address,user_agent,request_id)
          VALUES (current_setting('app.current_tenant_id',true)::uuid,$1,$2,$3,$4,$5::jsonb,$6,$7,$8)
        `, [userId, action, resource, resourceId ?? null,
           newData,
           req.ip ?? null,
           req.headers['user-agent'] ?? null,
           (req as Request & { requestId?: string }).requestId ?? null,
        ]).catch(() => {})  // never block the response

        // v4.31.0: every successful mutation also emits a webhook event.
        // Subscribers filter by `{resource}.{action}` (e.g. 'projects.create').
        // Payload intentionally omits `newData` — webhooks go to external URLs,
        // so we send only the resource identity and let subscribers re-fetch
        // via the API if they need details. Fire-and-forget; errors logged.
        emitEvent(tenantId, `${resource}.${action}`, {
          resourceId: resourceId ?? null,
          userId,
          requestId: (req as Request & { requestId?: string }).requestId ?? null,
        })
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
    version: '9.0.0',
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

// ─── UUID param guard ─────────────────────────────────────────────────────────

registerUuidParamGuards(app)
app.use('/api/v1', validateUuidQueryParams)

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
app.use('/api/v1/admin/automation', automationRouter)  // v4.31.0: scheduler admin
app.use('/api/v1/compliance-tasks', complianceRouter)  // v4.31.0: compliance watcher CRUD
app.use('/api/v1/field-sync',       fieldSyncRouter)   // v4.31.0: offline batch replay
app.use('/api/v1/schedule',         scheduleRouter)    // v4.31.0: CPM + tasks + dependencies
app.use('/api/v1/commissioning/autosign-rules', autosignRulesRouter) // v4.31.0: arbitration rules + /arbitrate
app.use('/api/v1/commissioning/baselines',      baselinesRouter)     // v4.31.0: baseline visibility
app.use('/api/v1/agent-actions',   agentActionsRouter) // v4.31.0: agent action log + review queue
app.use('/api/v1/correlations',    correlationsRouter) // v4.31.0: event proximity ranker
app.use('/api/v1/knowledge-fixes', fixLibraryRouter)   // v4.31.0: Pattern C fix library
app.use('/api/v1/knowledge',       knowledgeRouter)    // v4.31.0: ingested-document corpus
app.use('/api/v1/ask',             askRouter)          // v4.31.0: grounded RAG chat
app.use('/api/v1',                calculationsRouter)
app.use('/api/v1',                risksRouter)         // v4.28.0: Risk Register CRUD
app.use('/api/v1',                dailyLogsRouter)      // v4.31.0: Daily logs
app.use('/api/v1',                drawingsRouter)       // v4.31.0: Drawings + revisions + markups
app.use('/api/v1',                bimRouter)            // v4.31.0: BIM models + coordination issues
app.use('/api/v1',                budgetsRouter)        // v4.31.0: Budgets + change orders
app.use('/api/v1',                inspectionsRouter)    // v4.32.0: Inspection templates + records
app.use('/api/v1',                punchListsRouter)     // v4.32.0: Punch lists + items
app.use('/api/v1',                systemsRouter)        // v4.32.0: EPC hierarchy (F05)
app.use('/api/v1',                testPacksRouter)      // v4.32.0: real test packs (F05)
app.use('/api/v1',                testResultsRouter)    // v4.32.0: per-step results (F01)
app.use('/api/v1',                deficienciesRouter)          // v4.32.0: test-traced deficiencies (F01)
app.use('/api/v1',                commissioningItemsRouter)    // v4.32.0: CX checklist items (P2)
app.use('/api/v1/audit',          auditRouter)          // v4.30.0: Audit log read API
app.use('/api/v1/actions',        actionsRouter)        // v4.33.0 Ava: Global Action Center
app.use('/api/v1/ops',           opsRouter)            // v4.35.0 Ava Phase 3: Operations Center
app.use('/api/v1/readiness',     readinessRouter)      // v4.35.0 Ava Phase 3: Readiness Engine
app.use('/api/v1/sync',          syncRouter)           // v4.35.0 Ava Phase 3: Mobile Offline Sync
app.use('/api/v1/evidence',      evidenceRouter)       // v4.35.0 Ava Phase 3: Field Evidence Pipeline
app.use('/api/v1/runbooks',      runbooksRouter)       // v4.40.0 Ava Phase 4: Autonomous Runbook Engine
app.use('/api/v1/ai',            aiGovernanceRouter)   // v4.40.0 Ava Phase 4: AI Governance Queue
app.use('/api/v1/simulation',    simulationRouter)     // v4.40.0 Ava Phase 4: Simulation + Replay Engine
app.use('/api/v1/policies',      policiesRouter)       // v4.40.0 Ava Phase 4: Enterprise Policy Engine
app.use('/api/v1/executive',     executiveRouter)      // v4.40.0 Ava Phase 4: Executive Command Dashboard
app.use('/api/v1/integrations/hub', integrationHubRouter) // v4.40.0 Ava Phase 4: Integration Hub
app.use('/api/v1/exports',       exportsRouter)        // v4.40.0 Ava Phase 4: Data Warehouse Exports
app.use('/api/v1/audit/verify',  auditVerificationRouter) // v4.40.0 Ava Phase 4: Audit Chain Verification
app.use('/api/v1/agents',                agentsRouter)            // v5.0.0 Ava Phase 5: Multi-Agent System
app.use('/api/v1/agents/approvals',      agentApprovalsRouter)    // v5.0.0 Ava Phase 5: Agent Approval Queue
app.use('/api/v1/agents/memory',         agentMemoryRouter)       // v5.0.0 Ava Phase 5: Agent Memory Store
app.use('/api/v1/agents/risk',           agentRiskRouter)         // v5.0.0 Ava Phase 5: Risk Agent
app.use('/api/v1/agents/readiness',      agentReadinessRouter)    // v5.0.0 Ava Phase 5: Readiness Agent
app.use('/api/v1/twins',                 requireAuth as never, requireTenant() as never, twinRouter)              // v6.0.0 Ava Phase 6: Digital Twin Registry + Graph
app.use('/api/v1/portfolio',             portfolioRouter)         // v6.0.0 Ava Phase 6: Portfolio Intelligence
app.use('/api/v1/scenarios',             requireAuth as never, requireTenant() as never, scenariosRouter)         // v6.0.0 Ava Phase 6: Scenario Simulation + Temporal
app.use('/api/v1/adaptive',             adaptiveRouter)          // v7.0.0 Ava Phase 7: Learning Feedback + Calibration
app.use('/api/v1/optimization',         requireAuth as never, requireTenant() as never, optimizationRouter)      // v7.0.0 Ava Phase 7: Resource Optimization + Strategy
app.use('/api/v1/enterprise',           enterpriseRouter)        // v8.0.0 Ava Phase 8: Enterprise Deployment Platform
app.use('/api/v1/ecosystem',            ecosystemRouter)         // v9.0.0 Ava Phase 9: Federated Intelligence + Ecosystem
app.use('/api/v1',                      estimatingRouter)        // v10.0.0: BIM Element Layer + Estimating Engine
app.use('/api/v1/monte-carlo',          monteCarloRouter)        // v10.1.0: Monte Carlo Risk Simulation
app.use('/api/v1/transmittals',         transmittalsRouter)      // v10.1.0: Transmittal / Doc Control
app.use('/api/v1',                      evmRouter)               // v10.3.0: Earned Value Management
app.use('/api/v1',                      scheduleImportRouter)    // v10.4.0: P6 XER + MSP XML import
app.use('/api/v1',                      iotRouter)               // v10.5.0: IoT sensor ingest

// ─── AI Gateway ───────────────────────────────────────────────────────────────

app.post('/api/v1/gateway', requireAuth as never, aiLimiter, async (req: Request, res: Response) => {
  // v4.31.0 TS fix: `authReq` cast was unused in this handler — requireAuth
  // has already validated the token; drop the redundant narrowing.
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

  // Start generic scheduler + background-job runner (v4.31.0)
  // Handlers for specific job types should be registered from their
  // respective route/service modules via registerHandler() before or
  // shortly after this call (registration is lazy — missing handlers
  // fail their job cleanly instead of crashing the scheduler).
  startScheduler()
  registerWebhookDispatchHandler()
  registerIntegrationSync()
  registerKpiSnapshotHandler()
  registerComplianceWatcher()
  registerSlaEngine()                   // v4.33.0 Ava: SLA escalation worker
  registerNotificationWorker()          // v4.34.0 Ava: notification delivery queue
  registerAnalyticsSnapshotHandler()    // v4.34.0 Ava: nightly analytics aggregation
  registerReadinessSnapshotHandler()   // v4.35.0 Ava Phase 3: nightly readiness snapshots
  registerAuditRetentionHandler()
  registerKnowledgeIngestHandler()
  registerFixExtractorHandler()
  registerKnowledgeEmbedHandler()
  startIfcParseWorker()                // v10.2.0: IFC parse queue (polls every 15s)
  startFederatedAggregationWorker()    // v10.2.0: Federated DP aggregation (every 5min)

  // Periodic cleanup
  setInterval(() => {
    purgeExpiredTokens().catch(() => {})
  }, 60 * 60 * 1000)  // every hour

  const server = app.listen(PORT, () => {
    log.info(`[startup] Denver Engineering API v4.40.0 listening on port ${PORT}`)
  })

  // v4.35.0 Ava Phase 3: WebSocket gateway for real-time event streaming
  registerWebSocketGateway(server)

  // Graceful shutdown
  for (const sig of ['SIGTERM','SIGINT']) {
    process.on(sig, () => {
      log.info(`[shutdown] ${sig} received — draining connections...`)
      stopScheduler()                     // v4.31.0
      stopPackWorker()                    // v4.30.0
      stopIfcParseWorker()                // v10.2.0
      stopFederatedAggregationWorker()    // v10.2.0
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
