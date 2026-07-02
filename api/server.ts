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
import { initPool, poolHealthy, poolStats, query, tenantQuery } from './db/pool'
import { runMigrations } from './db/migrate'
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
import { payApplicationsRouter } from './routes/payApplications' // v4.45.0: AIA G702/G703 billing
import { qualityIntelligenceRouter } from './routes/qualityIntelligence' // v4.51.0: Quality Intelligence
import { safetyRouter         } from './routes/safety'          // v4.53.0: Safety (Phase 10)
import { costIntelligenceRouter } from './routes/costIntelligence' // v4.54.0: Cost Intelligence
import { commitmentsRouter     } from './routes/commitments'      // v4.57.0: commitment rollup
import { vendorScorecardRouter } from './routes/vendorScorecard'   // v4.59.0: vendor scorecard
import { ncrRouter            } from './routes/ncr'             // v4.55.0: NCR / CAPA (Phase 9)
import { myWorkRouter         } from './routes/myWork'          // v4.33.0: My Work — universal personal queue (Redesign W2)
import { lifecycleRouter      } from './routes/lifecycle'       // v4.34.0: Project lifecycle + approval gates (Redesign W3)
import { relatedRouter        } from './routes/related'         // v4.35.0: Cross-module related records (Redesign W4)
import { turnoverRouter       } from './routes/turnover'        // v4.38.0: Turnover packages + commissioning handoff (Redesign W7)
import { procurementRiskRouter } from './routes/procurementRisk'  // v4.52.0: Procurement Risk Engine
import { rfiCopilotRouter    } from './routes/rfiCopilot'      // v4.46.0: RFI Copilot
import { submittalReviewRouter } from './routes/submittalReview' // v4.47.0: Submittal review assistant
import { fieldAssistantRouter } from './routes/fieldAssistant'   // v4.48.0: AI Field Assistant
import { autoCoordinationRouter } from './routes/autoCoordination' // v4.49.0: Autonomous Coordination
import { inspectionsRouter  } from './routes/inspections'   // v4.32.0
import { punchListsRouter   } from './routes/punchLists'    // v4.32.0
import { systemsRouter       } from './routes/systems'       // v4.32.0: EPC hierarchy (F05)
import { testPacksRouter     } from './routes/testPacks'     // v4.32.0: real test packs (F05)
import { testResultsRouter   } from './routes/testResults'   // v4.32.0: per-step results (F01)
import { deficienciesRouter  } from './routes/deficiencies'  // v4.32.0: test-traced deficiencies (F01)
import { commissioningItemsRouter } from './routes/commissioningItems' // v4.32.0: CX checklist items (P2)
import { auditRouter        } from './routes/audit'         // v4.30.0-audit
import commissioningRouter    from './routes/commissioning' // v4.30.0
import { commissioningWebhookRouter } from './routes/commissioningWebhook' // PR-1: external Commissioning status webhook (HMAC, raw body)
import { openapiRouter } from './routes/openapi' // R6b: OpenAPI spec (public, flag-gated)
import { personalAgentRouter } from './routes/personalAgent' // ADR-012: per-user agent (flag-gated)
import automationRouter       from './routes/automation'    // v4.31.0
import complianceRouter       from './routes/compliance'    // v4.31.0
import fieldSyncRouter        from './routes/fieldSync'     // v4.31.0
import scheduleRouter         from './routes/schedule'      // v4.31.0
import { scheduleForecastRouter } from './routes/scheduleForecast' // v4.50.0: schedule Monte Carlo + recovery
import { scheduleCriticalPathRouter } from './routes/scheduleCriticalPath' // v4.56.0: critical-path what-if
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
import { issueWsTicket } from './realtime/wsTicket'                        // AUD-010: WS connection tickets
import { handleCsrfToken, requireCsrf } from './middleware/csrf'           // P2-8: CSRF protection
import { registerReadinessSnapshotHandler } from './services/readiness/readinessSnapshots' // v4.35.0 Ava Phase 3
import { runbooksRouter       } from './routes/runbooks'                    // v4.40.0 Ava Phase 4
import { aiGovernanceRouter   } from './routes/aiGovernance'               // v4.40.0 Ava Phase 4
import { simulationRouter     } from './routes/simulation'                  // v4.40.0 Ava Phase 4
import { policiesRouter       } from './routes/policies'                    // v4.40.0 Ava Phase 4
import { executiveRouter      } from './routes/executive'                   // v4.40.0 Ava Phase 4
import { integrationHubRouter } from './routes/integrationHub'             // v4.40.0 Ava Phase 4
import { exportsRouter        } from './routes/exports'                     // v4.40.0 Ava Phase 4
import { copilotRouter        } from './routes/copilot'                     // v4.41.0: Project Copilot (AI Project Intelligence)
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
import { changeOrdersRouter           } from './routes/changeOrders'                                      // v10.7.0: Change Order Management
import { subcontractsRouter           } from './routes/subcontracts'                                      // v10.8.0: Bid Packages & Subcontracts
import { meetingsRouter               } from './routes/meetings'                                           // v10.9.0: Meeting Minutes
import { costControlRouter            } from './routes/costControl'                                         // v10.10.0: Cost Control Dashboard
import { costEntryRouter              } from './routes/costEntry'                                            // v10.11.0: Field Cost Entry
import { proposalsRouter              } from './routes/proposals'                                            // v10.12.0: Proposals & Bid Pipeline
import { teamRouter                   } from './routes/team'                                                 // v10.13.0: Team & Workforce
import { notificationsRouter          } from './routes/notifications'                                        // v10.14.0: Notifications
import { predictRouter                } from './routes/predict'                                              // v10.15.0: Predict Dashboard
import { timesheetsRouter             } from './routes/timesheets'                                           // v10.16.0: Workforce Timesheets
import { riskRegisterRouter           } from './routes/riskRegister'                                         // v10.17.0: Risk Register
import { startIfcParseWorker,         stopIfcParseWorker         } from './services/bim/ifcParseWorker'                  // v10.2.0: IFC parse worker
import { startFederatedAggregationWorker, stopFederatedAggregationWorker } from './services/ecosystem/federatedAggregationWorker' // v10.2.0: DP aggregation worker
import samlRouter from './auth/saml/samlRoutes'                                                                          // Phase 2A: SAML 2.0 Enterprise SSO
import { scimRouter, scimAdminRouter } from './routes/scim'                                                              // Phase 2B: SCIM 2.0 Provisioning
import { initErrorTracking, errorTrackingMiddleware, flushErrorTracking } from './services/observability/errorTracking'  // Phase 1: Observability
import { metricsMiddleware, metricsHandler, setDbUp } from './services/observability/metrics'                                       // Phase 3: Prometheus metrics

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  // pino-pretty only in local development — staging and production use structured JSON
  // for Render log drain, Datadog, and Sentry breadcrumb ingestion.
  ...(process.env['NODE_ENV'] === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
  base: { service: 'denver-engineering-api', version: '9.0.0', env: process.env['NODE_ENV'] },
})

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express()

// ─── Security headers ─────────────────────────────────────────────────────────

// P2-1: Content Security Policy — restricts what the browser can load/execute.
// 'unsafe-inline' for style-src is required because React components use inline
// style objects throughout. script-src stays strict ('self' only, no inline JS).
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      fontSrc:     ["'self'", 'data:'],
      connectSrc:  ["'self'", 'wss:', 'https://api.anthropic.com'],
      frameSrc:    ["'none'"],
      frameAncestors: ["'none'"],
      objectSrc:   ["'none'"],
      upgradeInsecureRequests: process.env['NODE_ENV'] === 'production' ? [] : null,
    },
  },
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

// ─── Commissioning webhook (PR-1) ─────────────────────────────────────────────
// Mounted BEFORE express.json() so the route can read the RAW body for HMAC
// verification. Authenticated by signature (service-to-service), so it sits
// outside the /api/v1 auth+CSRF chain. See COMMISSIONING_EXTRACTION_PLAN.md §1d.
app.use('/api/cx/webhook', commissioningWebhookRouter)

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
  ;(req as unknown as Record<string, unknown>)['correlationId'] = correlationId
  res.setHeader('X-Correlation-ID', correlationId)
  next()
})

// ─── Prometheus metrics (Phase 3) ────────────────────────────────────────────
//   GET /metrics — Prometheus scrape endpoint (bearer token protected when METRICS_TOKEN set)
//   metricsMiddleware — tracks every HTTP request's method/route/status/duration

app.get('/metrics', metricsHandler)
app.use(openapiRouter)   // R6b: GET /openapi.json (public, flag-gated via OPENAPI_ENABLED)
app.use(metricsMiddleware)

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

// ─── Trust proxy (must be set before rate limiters for correct client IP) ────

app.set('trust proxy', 1)

// ─── Global rate limits ───────────────────────────────────────────────────────

const envInt = (k: string, def: number) => { const v = parseInt(process.env[k] ?? '', 10); return Number.isFinite(v) && v > 0 ? v : def }
const globalLimiter = rateLimit({ windowMs: 60_000,      max: envInt('RATE_LIMIT_GLOBAL_MAX', 600), standardHeaders: true, legacyHeaders: false })
const authLimiter   = rateLimit({ windowMs: 15 * 60_000, max: envInt('RATE_LIMIT_AUTH_MAX',   200), standardHeaders: true, legacyHeaders: false })
const aiLimiter     = rateLimit({ windowMs: 60_000,      max: envInt('RATE_LIMIT_AI_MAX',      30), standardHeaders: true, legacyHeaders: false })
const agentLimiter  = rateLimit({ windowMs: 60_000,      max: envInt('RATE_LIMIT_AGENT_MAX',   20), standardHeaders: true, legacyHeaders: false })

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
        const SENSITIVE = new Set(['password','token','refresh_token','secret','api_key','authorization','clientsecret','client_secret','clientid','client_id'])
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
// Enterprise-grade: verifies DB connectivity with a live query ping.
// Uptime monitors (Render, Datadog, PagerDuty) hit this every 30s.

app.get('/api/v1/health', async (_req: Request, res: Response) => {
  const dbOk = poolHealthy()
  let dbPing = false
  let dbPingMs: number | null = null

  if (dbOk) {
    const t0 = Date.now()
    try {
      await query('SELECT 1')
      dbPing   = true
      dbPingMs = Date.now() - t0
    } catch { /* dbPing stays false */ }
  }

  // Redis health check
  let redisPing = false
  let redisPingMs: number | null = null
  try {
    const { getTokenStore } = await import('./tokenStore')
    const store = getTokenStore()
    const t0 = Date.now()
    await store.isRevoked('health-check-probe')
    redisPing   = true
    redisPingMs = Date.now() - t0
  } catch { /* redisPing stays false */ }

  const allOk = dbOk && dbPing
  setDbUp(dbOk && dbPing)   // OPS-003: expose db health as a Prometheus gauge for alerting
  const mem   = process.memoryUsage()

  res.status(allOk ? 200 : 503).json({
    status:  allOk ? 'ok' : 'degraded',
    version: '9.0.0',
    uptime:  Math.floor(process.uptime()),
    ts:      new Date().toISOString(),
    checks: {
      db:    { ok: dbOk && dbPing, latencyMs: dbPingMs, pool: poolStats() },
      redis: { ok: redisPing,      latencyMs: redisPingMs },
    },
    memory: {
      heapUsedMb:  Math.round(mem.heapUsed  / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMb:       Math.round(mem.rss       / 1024 / 1024),
    },
    storage: process.env['STORAGE_BACKEND'] ?? 'local',
  })
})

// ─── Auth routes ──────────────────────────────────────────────────────────────

app.post('/api/v1/auth/login',   authLimiter, (req, res) => handleLogin(req, res))
app.post('/api/v1/auth/refresh', authLimiter, (req, res) => handleRefresh(req, res))
app.post('/api/v1/auth/logout',  requireAuth as never, (req, res) => handleLogout(req as AuthenticatedRequest, res))
app.get('/api/v1/auth/me',       requireAuth as never, (req, res) => handleMe(req as AuthenticatedRequest, res))
// P2-8: CSRF token issuance (call once after login; attach X-CSRF-Token to mutations)
app.get('/api/v1/auth/csrf',     requireAuth as never, handleCsrfToken)

// AUD-010: short-lived single-use WebSocket connection ticket.
// Replaces the prior `?token=<jwt>` query-string scheme. Client fetches a
// ticket here (authenticated), then connects: wss://host/ws?ticket=<ticket>.
app.get('/api/v1/realtime/ws-ticket', requireAuth as never, (req, res) => {
  const auth = (req as AuthenticatedRequest).auth
  if (!auth?.sub || !auth?.tid) { res.status(401).json({ error: 'unauthenticated' }); return }
  const { ticket, expiresInMs } = issueWsTicket(auth.sub, auth.tid)
  res.json({ data: { ticket, expiresInMs } })
})

// Phase 2A: SAML 2.0 SSO
//   /api/v1/auth/saml/:tenantSlug/...  — callback, login, setup, config
//   /saml/:tenantSlug/...              — metadata (short URL for IdP import)
app.use('/api/v1/auth/saml', authLimiter, samlRouter)
app.use('/saml',                          samlRouter)

// Phase 2B: SCIM 2.0 automated provisioning (Okta, Azure AD, OneLogin)
//   /scim/v2/...           — RFC 7644 SCIM protocol (bearer token auth)
//   /api/v1/scim/tokens    — admin: generate/revoke SCIM tokens
//   /api/v1/scim/audit     — admin: SCIM operation audit log
app.use('/scim/v2',       express.json({ limit: '1mb' }), scimRouter)
app.use('/api/v1/scim',   scimAdminRouter)

// GDPR: Right to Erasure — DELETE /api/v1/auth/me
app.delete('/api/v1/auth/me', requireAuth as never, async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest
  const userId  = authReq.auth?.sub
  const tenantId = authReq.auth?.tid
  if (!userId || !tenantId) { res.status(401).json({ error: 'unauthenticated' }); return }

  try {
    // Record deletion request (async compliance trail)
    const emailRes = await query<{ email: string }>('SELECT email FROM users WHERE id=$1', [userId])
    const email = emailRes.rows[0]?.email ?? ''

    await query(
      `INSERT INTO data_deletion_requests (tenant_id, user_id, email, requested_by, reason, status)
       VALUES ($1,$2,$3,$4,$5,'pending')`,
      [tenantId, userId, email, userId, (req.body as Record<string,unknown>)?.['reason'] ?? null]
    )

    // Immediately deactivate account; scheduled job handles full erasure
    await query(
      `UPDATE users SET is_active=false, email=$1, display_name='[deleted]', password_hash='[deleted]',
       avatar_url=NULL, preferences='{}', updated_at=NOW() WHERE id=$2`,
      [`deleted-${userId}@deleted.invalid`, userId]
    )

    // Revoke all active tokens
    await query(`UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL`, [userId])

    const clearOpts = { httpOnly: true, secure: process.env['NODE_ENV'] === 'production', sameSite: 'strict' as const }
    res.clearCookie('jarvis_at', { ...clearOpts, path: '/' })
    res.clearCookie('jarvis_rt', { ...clearOpts, path: '/api/v1/auth/refresh' })

    log.info({ userId, tenantId, email }, '[gdpr] Account deletion initiated')
    res.json({ data: { message: 'Account deletion initiated. Your data will be erased within 30 days per our data retention policy.' } })
  } catch (err) {
    log.error({ userId, error: String(err) }, '[gdpr] Deletion error')
    res.status(500).json({ error: 'deletion_failed' })
  }
})

// Apply CSRF check to all v1 mutations (Bearer-token clients auto-exempt inside requireCsrf)
app.use('/api/v1', requireCsrf as never)

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

// ─── Personal Agent (ADR-012, flag-gated: PERSONAL_AGENT) ──────────────────────
app.use('/api/v1', personalAgentRouter)

// ─── UUID param guard ─────────────────────────────────────────────────────────

registerUuidParamGuards(app)
app.use('/api/v1', validateUuidQueryParams)

// ─── Domain routes ────────────────────────────────────────────────────────────

app.use('/api/v1/projects',       projectsRouter)
app.use('/api/v1/vendors',        vendorsRouter)
app.use('/api/v1/purchase-orders', purchaseOrdersRouter)
app.use('/api/v1/rfis',           rfisRouter)
app.use('/api/v1/rfis',           rfiCopilotRouter)    // v4.46.0: RFI Copilot (precedent/responder/impact)
app.use('/api/v1/submittals',     submittalsRouter)
app.use('/api/v1/submittals',     submittalReviewRouter) // v4.47.0: Submittal review assistant
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
app.use('/api/v1/schedule',         scheduleForecastRouter) // v4.50.0: Monte Carlo forecast + recovery planner
app.use('/api/v1/schedule',         scheduleCriticalPathRouter) // v4.56.0: critical-path explain + what-if
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
app.use('/api/v1',                payApplicationsRouter) // v4.45.0: AIA G702/G703 pay applications
app.use('/api/v1',                qualityIntelligenceRouter) // v4.51.0: Quality Intelligence
app.use('/api/v1',                safetyRouter)          // v4.53.0: Safety (Phase 10)
app.use('/api/v1',                costIntelligenceRouter) // v4.54.0: Cost Intelligence
app.use('/api/v1',                commitmentsRouter)     // v4.57.0: commitment rollup
app.use('/api/v1',                vendorScorecardRouter) // v4.59.0: vendor scorecard
app.use('/api/v1',                ncrRouter)             // v4.55.0: NCR / CAPA (Phase 9)
app.use('/api/v1',                myWorkRouter)          // v4.33.0: My Work — universal personal queue (Redesign W2)
app.use('/api/v1',                lifecycleRouter)       // v4.34.0: Project lifecycle + approval gates (Redesign W3)
app.use('/api/v1',                relatedRouter)         // v4.35.0: Cross-module related records (Redesign W4)
app.use('/api/v1',                turnoverRouter)        // v4.38.0: Turnover packages + commissioning handoff (Redesign W7)
app.use('/api/v1',                procurementRiskRouter) // v4.52.0: Procurement Risk Engine
app.use('/api/v1',                fieldAssistantRouter)  // v4.48.0: AI Field Assistant
app.use('/api/v1',                autoCoordinationRouter) // v4.49.0: Autonomous Coordination (recommend → approve → execute)
app.use('/api/v1',                inspectionsRouter)    // v4.32.0: Inspection templates + records
app.use('/api/v1',                punchListsRouter)     // v4.32.0: Punch lists + items
app.use('/api/v1',                systemsRouter)        // v4.32.0: EPC hierarchy (F05)
app.use('/api/v1',                testPacksRouter)      // v4.32.0: real test packs (F05)
app.use('/api/v1',                testResultsRouter)    // v4.32.0: per-step results (F01)
app.use('/api/v1',                deficienciesRouter)          // v4.32.0: test-traced deficiencies (F01)
app.use('/api/v1',                commissioningItemsRouter)    // v4.32.0: CX checklist items (P2)
app.use('/api/v1/audit',          auditRouter)          // v4.30.0: Audit log read API
app.use('/api/v1/actions',        actionsRouter)        // v4.33.0 Ava: Global Action Center
app.use('/api/v1/ops',           requireAuth as never, requireTenant() as never, opsRouter)       // v4.35.0 Ava Phase 3: Operations Center
app.use('/api/v1/readiness',     requireAuth as never, requireTenant() as never, readinessRouter) // v4.35.0 Ava Phase 3: Readiness Engine
app.use('/api/v1/sync',          requireAuth as never, requireTenant() as never, syncRouter)     // v4.35.1: added auth
app.use('/api/v1/evidence',      requireAuth as never, requireTenant() as never, evidenceRouter) // v4.35.1: added auth
app.use('/api/v1/runbooks',      runbooksRouter)       // v4.40.0 Ava Phase 4: Autonomous Runbook Engine
app.use('/api/v1/ai',            aiGovernanceRouter)   // v4.40.0 Ava Phase 4: AI Governance Queue
app.use('/api/v1/simulation',    simulationRouter)     // v4.40.0 Ava Phase 4: Simulation + Replay Engine
app.use('/api/v1/policies',      policiesRouter)       // v4.40.0 Ava Phase 4: Enterprise Policy Engine
app.use('/api/v1/executive',     executiveRouter)      // v4.40.0 Ava Phase 4: Executive Command Dashboard
app.use('/api/v1/integrations/hub', integrationHubRouter) // v4.40.0 Ava Phase 4: Integration Hub
app.use('/api/v1/exports',       exportsRouter)        // v4.40.0 Ava Phase 4: Data Warehouse Exports
app.use('/api/v1',               copilotRouter)        // v4.41.0: Project Copilot — AI Project Intelligence focus briefings
app.use('/api/v1/audit/verify',  auditVerificationRouter) // v4.40.0 Ava Phase 4: Audit Chain Verification
app.use('/api/v1/agents',                agentLimiter, agentsRouter)            // v5.0.1 Ava Phase 5: Multi-Agent System
app.use('/api/v1/agents/approvals',      agentLimiter, agentApprovalsRouter)    // v5.0.1 Ava Phase 5: Agent Approval Queue
app.use('/api/v1/agents/memory',         agentLimiter, agentMemoryRouter)       // v5.0.1 Ava Phase 5: Agent Memory Store
app.use('/api/v1/agents/risk',           agentLimiter, agentRiskRouter)         // v5.0.1 Ava Phase 5: Risk Agent
app.use('/api/v1/agents/readiness',      requireAuth as never, requireTenant() as never, agentReadinessRouter) // v5.0.0 Ava Phase 5: Readiness Agent
app.use('/api/v1/twins',                 requireAuth as never, requireTenant() as never, twinRouter)              // v6.0.0 Ava Phase 6: Digital Twin Registry + Graph
app.use('/api/v1/portfolio',             requireAuth as never, requireTenant() as never, portfolioRouter) // v6.0.0 Ava Phase 6: Portfolio Intelligence
app.use('/api/v1/scenarios',             requireAuth as never, requireTenant() as never, scenariosRouter)         // v6.0.0 Ava Phase 6: Scenario Simulation + Temporal
app.use('/api/v1/adaptive',             requireAuth as never, requireTenant() as never, adaptiveRouter) // v7.0.0 Ava Phase 7: Learning Feedback + Calibration
app.use('/api/v1/optimization',         requireAuth as never, requireTenant() as never, optimizationRouter)      // v7.0.0 Ava Phase 7: Resource Optimization + Strategy
app.use('/api/v1/enterprise',           enterpriseRouter)        // v8.0.0 Ava Phase 8: Enterprise Deployment Platform
app.use('/api/v1/ecosystem',            requireAuth as never, requireTenant() as never, ecosystemRouter) // v9.0.0 Ava Phase 9: Federated Intelligence + Ecosystem
app.use('/api/v1',                      estimatingRouter)        // v10.0.0: BIM Element Layer + Estimating Engine
app.use('/api/v1/monte-carlo',          monteCarloRouter)        // v10.1.0: Monte Carlo Risk Simulation
app.use('/api/v1/transmittals',         transmittalsRouter)      // v10.1.0: Transmittal / Doc Control
app.use('/api/v1',                      evmRouter)               // v10.3.0: Earned Value Management
app.use('/api/v1',                      scheduleImportRouter)    // v10.4.0: P6 XER + MSP XML import
app.use('/api/v1',                      iotRouter)               // v10.5.0: IoT sensor ingest
app.use('/api/v1',                      changeOrdersRouter)      // v10.7.0: Change Order Management
app.use('/api/v1',                      subcontractsRouter)      // v10.8.0: Bid Packages & Subcontracts
app.use('/api/v1',                      meetingsRouter)          // v10.9.0: Meeting Minutes
app.use('/api/v1',                      costControlRouter)       // v10.10.0: Cost Control Dashboard
app.use('/api/v1',                      costEntryRouter)         // v10.11.0: Field Cost Entry
app.use('/api/v1',                      proposalsRouter)         // v10.12.0: Proposals & Bid Pipeline
app.use('/api/v1',                      teamRouter)              // v10.13.0: Team & Workforce
app.use('/api/v1',                      notificationsRouter)     // v10.14.0: Notifications
app.use('/api/v1',                      predictRouter)           // v10.15.0: Predict Dashboard
app.use('/api/v1',                      timesheetsRouter)        // v10.16.0: Workforce Timesheets
app.use('/api/v1',                      riskRegisterRouter)      // v10.17.0: Risk Register

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
      res.status(upstream.status).json({ error: 'upstream_error', message: 'AI request failed' })
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

// ─── Global error handler (Phase 1: Sentry + Pino) ──────────────────────────
// errorTrackingMiddleware captures to Sentry (if configured) then responds 500.
// Must be last middleware — 4-argument signature marks it as an Express error handler.

app.use(errorTrackingMiddleware)

// ─── Startup ──────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  const PORT = Number(process.env['PORT'] ?? 3001)

  // Phase 1: Initialize error tracking (Sentry if SENTRY_DSN set, Pino otherwise)
  await initErrorTracking()

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
      server.close(async () => {
        log.info('[shutdown] HTTP server closed')
        await flushErrorTracking(2000)  // Phase 1: flush Sentry before exit
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
