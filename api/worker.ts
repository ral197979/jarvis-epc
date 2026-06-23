/**
 * Denver Engineering — Dedicated Worker Process
 * ───────────────────────────────────────────────
 * Separate entry point for background workers.
 * Run independently from the HTTP server so that:
 *   1. Workers can be scaled/restarted independently
 *   2. CPU-bound work (PDF, reports) doesn't block HTTP event loop
 *   3. Multiple HTTP server instances can share one worker process
 *
 * Render.com configuration (render.yaml):
 *   - type: worker
 *     name: denver-eng-workers
 *     startCommand: node dist/api/worker.js
 *
 * Environment: same env vars as api/server.ts.
 * Set WORKER_ONLY=true to prevent workers from starting inside server.ts.
 */

import pino from 'pino'
import { initPool } from './db/pool'
import { runMigrations } from './db/migrate'
import { startPackWorker, stopPackWorker } from './services/packWorker'
import { startScheduler, stopScheduler } from './services/scheduler'
import { registerWebhookDispatchHandler } from './services/webhookDispatch'
import { registerIntegrationSync } from './services/integrationSync'
import { registerKpiSnapshotHandler } from './services/kpiSnapshot'
import { registerComplianceWatcher } from './services/complianceWatcher'
import { registerAuditRetentionHandler } from './services/auditRetention'
import { registerKnowledgeIngestHandler } from './services/knowledgeIngest'
import { registerFixExtractorHandler } from './services/fixExtractor'
import { registerKnowledgeEmbedHandler } from './services/knowledgeEmbed'
import { registerSlaEngine } from './services/slaEngine'
import { registerNotificationWorker } from './services/notifications/notificationWorker'
import { registerAnalyticsSnapshotHandler } from './services/actions/actionAnalyticsService'
import { registerReadinessSnapshotHandler } from './services/readiness/readinessSnapshots'
import { startIfcParseWorker, stopIfcParseWorker } from './services/bim/ifcParseWorker'
import { startFederatedAggregationWorker, stopFederatedAggregationWorker } from './services/ecosystem/federatedAggregationWorker'
import { purgeExpiredTokens } from './auth'
import { initErrorTracking, flushErrorTracking } from './services/observability/errorTracking'

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  // pino-pretty only in local development — staging and production use structured JSON
  ...(process.env['NODE_ENV'] === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
  base: { service: 'denver-engineering-workers', version: '9.0.0', env: process.env['NODE_ENV'] },
})

// ─── Worker startup ───────────────────────────────────────────────────────────

async function startWorkers(): Promise<void> {
  log.info('[worker] Starting Denver Engineering worker process...')

  // Error tracking (Sentry if SENTRY_DSN set)
  await initErrorTracking()

  // Database connection + migrations (workers need DB too)
  log.info('[worker] Connecting to PostgreSQL...')
  await initPool()

  log.info('[worker] Running migrations...')
  await runMigrations()

  // ── Register all background job handlers ──────────────────────────────────
  // Each handler registers itself with the scheduler for its job type.
  // The scheduler polls Redis/DB for pending jobs and dispatches them.

  startScheduler()
  startPackWorker()
  registerWebhookDispatchHandler()
  registerIntegrationSync()
  registerKpiSnapshotHandler()
  registerComplianceWatcher()
  registerSlaEngine()
  registerNotificationWorker()
  registerAnalyticsSnapshotHandler()
  registerReadinessSnapshotHandler()
  registerAuditRetentionHandler()
  registerKnowledgeIngestHandler()
  registerFixExtractorHandler()
  registerKnowledgeEmbedHandler()
  startIfcParseWorker()
  startFederatedAggregationWorker()

  // ── Periodic maintenance ──────────────────────────────────────────────────

  // Purge expired JWT refresh tokens every hour
  setInterval(() => {
    purgeExpiredTokens().catch(err =>
      log.error({ err: err.message }, '[worker] Token purge failed')
    )
  }, 60 * 60 * 1000)

  // Purge expired SAML sessions every 30 minutes
  setInterval(() => {
    import('./db/pool').then(({ query }) =>
      query('SELECT purge_expired_saml_sessions()').catch(() => {})
    )
  }, 30 * 60 * 1000)

  log.info('[worker] All workers started — waiting for jobs')

  // ── Graceful shutdown ──────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    log.info(`[worker] ${signal} received — shutting down workers...`)
    stopScheduler()
    stopPackWorker()
    stopIfcParseWorker()
    stopFederatedAggregationWorker()
    await flushErrorTracking(3000)
    log.info('[worker] Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorkers().catch(err => {
    log.fatal({ err: err.message }, '[worker] Fatal startup error')
    process.exit(1)
  })
}

export { startWorkers }
