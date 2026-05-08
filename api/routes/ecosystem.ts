// Denver Engineering — Ecosystem Platform Routes (v9.0.0)
// 44 endpoints across federated intelligence, benchmarking, playbook marketplace,
// plugin framework, external agents, automation adapters, knowledge graph,
// edge nodes, air-gap mode, certification, and workflow composition.

import { Router, Request, Response, NextFunction } from 'express'

// ─── Service imports ──────────────────────────────────────────────────────────

import {
  setFederatedOptIn, isOptedIn, contributeData, publishPattern,
  getPattern, listActivePatterns, createModelVersion, activateModelVersion,
  withdrawContribution,
} from '../services/ecosystem/federatedIntelligenceEngine'

import {
  computeAndStoreCohort, getIndustryBenchmarks, getBenchmarkForMetric,
  getTenantBenchmark, getReadinessBenchmarks, getSlaBenchmarks,
} from '../services/ecosystem/benchmarkingService'

import {
  createPlaybook, getPlaybook, listPlaybooks, publishPlaybook,
  installPlaybook, uninstallPlaybook, getTenantInstalls, submitPlaybookReview,
  getPlaybookVersion,
} from '../services/ecosystem/playbookMarketplaceService'

import {
  registerPlugin, getPlugin, listPlugins, updatePluginStatus, triggerKillSwitch,
  addPluginVersion, installPlugin, rollbackPlugin, disablePlugin,
  checkPluginPermission, getPluginAuditEvents,
} from '../services/ecosystem/pluginRegistryService'

import {
  registerExternalAgent, getExternalAgent, listExternalAgents,
  updateAgentStatus, executeExternalAgent, authenticateAgent, getAgentCapabilities,
} from '../services/ecosystem/externalAgentGateway'

import {
  createAdapter, getAdapter, listAdapters, deactivateAdapter,
  ingestInboundEvent, sendOutboundEvent, markEventProcessed, getDeadLetterEvents,
  listEvents,
} from '../services/ecosystem/automationAdapterService'

import {
  upsertEntity, getEntity, searchEntities, addRelationship,
  getNeighborhood, queryGraph, getExplainablePath,
} from '../services/ecosystem/knowledgeGraphService'

import {
  registerEdgeNode, getEdgeNode, listEdgeNodes, updateNodeStatus,
  heartbeatNode, revokeEdgeNode, startSyncSession, completeSyncSession,
  enqueueCommand, getPendingCommands, acknowledgeCommand, bufferAuditEvent,
  flushAuditBuffer, getAllEdgeNodeStatuses,
} from '../services/ecosystem/edgeNodeService'

import {
  activateLicense, getActiveLicense, revokeLicense, getAirGapStatus,
  createPackage, verifyPackage,
} from '../services/ecosystem/airGapModeService'

import {
  generateCertificationEvidence, listCertificationExports, verifyExportIntegrity,
} from '../services/ecosystem/certificationEvidenceService'

import {
  createWorkflow, getWorkflow, listWorkflows, updateWorkflowDefinition,
  validateWorkflowPolicy, dryRunWorkflow, publishWorkflow, rollbackWorkflow,
  getWorkflowVersions, getWorkflowRuns, pauseWorkflow,
} from '../services/ecosystem/workflowComposerService'

const router = Router()

// ─── Typed request helper ─────────────────────────────────────────────────────

interface Req extends Request { tenantId: string }
const tid = (req: Request): string => (req as unknown as Req).tenantId

// ─── Federated Intelligence ───────────────────────────────────────────────────

// POST /api/v1/ecosystem/federated/opt-in
router.post('/federated/opt-in', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await setFederatedOptIn(tid(req), true)
    res.json({ optIn: true })
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/federated/opt-out
router.post('/federated/opt-out', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await setFederatedOptIn(tid(req), false)
    res.json({ optIn: false })
  } catch (err) { next(err) }
})

// GET /api/v1/ecosystem/federated/opt-in
router.get('/federated/opt-in', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const optedIn = await isOptedIn(tid(req))
    res.json({ optedIn })
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/federated/contribute
router.post('/federated/contribute', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contribution = await contributeData(tid(req), req.body)
    res.status(201).json(contribution)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/federated/withdraw/:id
router.post('/federated/withdraw/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await withdrawContribution(tid(req), req.params['id']!)
    res.json({ withdrawn: true })
  } catch (err) { next(err) }
})

// GET /api/v1/ecosystem/federated/patterns
router.get('/federated/patterns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const patterns = await listActivePatterns(req.query['type'] as string | undefined)
    res.json(patterns)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/federated/patterns (admin)
router.post('/federated/patterns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pattern = await publishPattern(req.body)
    res.status(201).json(pattern)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/federated/model-versions (admin)
router.post('/federated/model-versions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mv = await createModelVersion(req.body)
    res.status(201).json(mv)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/federated/model-versions/:id/activate (admin)
router.post('/federated/model-versions/:id/activate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mv = await activateModelVersion(req.params['id']!)
    res.json(mv)
  } catch (err) { next(err) }
})

// ─── Benchmarking ─────────────────────────────────────────────────────────────

// GET /api/v1/ecosystem/benchmarks/industry
router.get('/benchmarks/industry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cohorts = await getIndustryBenchmarks(
      req.query['industry'] as string | undefined,
      req.query['region'] as string | undefined,
    )
    res.json(cohorts)
  } catch (err) { next(err) }
})

// GET /api/v1/ecosystem/benchmarks/tenant
router.get('/benchmarks/tenant', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { metric, value } = req.query
    const result = await getTenantBenchmark(
      tid(req),
      metric as Parameters<typeof getTenantBenchmark>[1],
      Number(value),
    )
    res.json(result)
  } catch (err) { next(err) }
})

// GET /api/v1/ecosystem/benchmarks/readiness
router.get('/benchmarks/readiness', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getReadinessBenchmarks())
  } catch (err) { next(err) }
})

// GET /api/v1/ecosystem/benchmarks/sla
router.get('/benchmarks/sla', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getSlaBenchmarks())
  } catch (err) { next(err) }
})

// ─── Playbook Marketplace ─────────────────────────────────────────────────────

// GET /api/v1/ecosystem/marketplace/playbooks
router.get('/marketplace/playbooks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const playbooks = await listPlaybooks({
      status: req.query['status'] as Parameters<typeof listPlaybooks>[0]['status'],
      playbookType: req.query['type'] as string | undefined,
    })
    res.json(playbooks)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/marketplace/playbooks
router.post('/marketplace/playbooks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const playbook = await createPlaybook(req.body)
    res.status(201).json(playbook)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/marketplace/playbooks/:id/publish
router.post('/marketplace/playbooks/:id/publish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const playbook = await publishPlaybook(req.params['id']!, req.body.sandboxValidated === true)
    res.json(playbook)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/marketplace/playbooks/:id/install
router.post('/marketplace/playbooks/:id/install', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const install = await installPlaybook(tid(req), req.params['id']!, req.body)
    res.status(201).json(install)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/marketplace/playbooks/:id/uninstall
router.post('/marketplace/playbooks/:id/uninstall', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await uninstallPlaybook(tid(req), req.params['id']!)
    res.json({ uninstalled: true })
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/marketplace/playbooks/:id/review
router.post('/marketplace/playbooks/:id/review', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await submitPlaybookReview(tid(req), req.params['id']!, req.body.rating, req.body.reviewText)
    res.json({ submitted: true })
  } catch (err) { next(err) }
})

// ─── Plugin Framework ─────────────────────────────────────────────────────────

// GET /api/v1/ecosystem/plugins
router.get('/plugins', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const plugins = await listPlugins({ status: req.query['status'] as Parameters<typeof listPlugins>[0]['status'] })
    res.json(plugins)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/plugins
router.post('/plugins', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const plugin = await registerPlugin(req.body)
    res.status(201).json(plugin)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/plugins/:id/install
router.post('/plugins/:id/install', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const install = await installPlugin(tid(req), req.params['id']!, req.body)
    res.status(201).json(install)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/plugins/:id/rollback
router.post('/plugins/:id/rollback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const install = await rollbackPlugin(tid(req), req.params['id']!)
    res.json(install)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/plugins/:id/disable
router.post('/plugins/:id/disable', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await disablePlugin(tid(req), req.params['id']!)
    res.json({ disabled: true })
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/plugins/:id/kill-switch (admin)
router.post('/plugins/:id/kill-switch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await triggerKillSwitch(req.params['id']!, req.body.actor ?? 'admin')
    res.json({ killSwitchTriggered: true })
  } catch (err) { next(err) }
})

// ─── External Agents ──────────────────────────────────────────────────────────

// POST /api/v1/ecosystem/external-agents/register
router.post('/external-agents/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await registerExternalAgent(req.body)
    res.status(201).json(result)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/external-agents/:id/execute
router.post('/external-agents/:id/execute', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await executeExternalAgent(req.params['id']!, {
      tenantId: tid(req),
      ...req.body,
    })
    res.json(result)
  } catch (err) { next(err) }
})

// GET /api/v1/ecosystem/external-agents/:id/capabilities
router.get('/external-agents/:id/capabilities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const capabilities = await getAgentCapabilities(req.params['id']!)
    res.json({ capabilities })
  } catch (err) { next(err) }
})

// ─── Automation Adapters ──────────────────────────────────────────────────────

// GET /api/v1/ecosystem/adapters
router.get('/adapters', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await listAdapters(tid(req)))
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/adapters
router.post('/adapters', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await createAdapter(tid(req), req.body)
    res.status(201).json(result)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/adapters/:id/ingest
router.post('/adapters/:id/ingest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = await ingestInboundEvent(tid(req), req.params['id']!, req.body)
    res.status(201).json(event)
  } catch (err) { next(err) }
})

// ─── Knowledge Graph ──────────────────────────────────────────────────────────

// GET /api/v1/ecosystem/knowledge-graph/entities/:id
router.get('/knowledge-graph/entities/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entity = await getEntity(tid(req), req.params['id']!)
    if (entity == null) return res.status(404).json({ error: 'Not found' })
    res.json(entity)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/knowledge-graph/query
router.post('/knowledge-graph/query', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await queryGraph(tid(req), req.body)
    res.json(result)
  } catch (err) { next(err) }
})

// GET /api/v1/ecosystem/knowledge-graph/neighborhood/:id
router.get('/knowledge-graph/neighborhood/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const depth = Number(req.query['depth'] ?? 1)
    const result = await getNeighborhood(tid(req), req.params['id']!, depth)
    res.json(result)
  } catch (err) { next(err) }
})

// ─── Edge Nodes ───────────────────────────────────────────────────────────────

// GET /api/v1/ecosystem/edge-nodes
router.get('/edge-nodes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await listEdgeNodes(tid(req)))
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/edge-nodes
router.post('/edge-nodes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const node = await registerEdgeNode(tid(req), req.body)
    res.status(201).json(node)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/edge-nodes/:id/heartbeat
router.post('/edge-nodes/:id/heartbeat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await heartbeatNode(tid(req), req.params['id']!)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/edge-nodes/:id/revoke
router.post('/edge-nodes/:id/revoke', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await revokeEdgeNode(tid(req), req.params['id']!)
    res.json({ revoked: true })
  } catch (err) { next(err) }
})

// GET /api/v1/ecosystem/edge-nodes/admin/status (admin)
router.get('/edge-nodes/admin/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getAllEdgeNodeStatuses())
  } catch (err) { next(err) }
})

// ─── Air-Gap Mode ─────────────────────────────────────────────────────────────

// POST /api/v1/ecosystem/air-gap/activate
router.post('/air-gap/activate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const license = await activateLicense(tid(req), req.body)
    res.json(license)
  } catch (err) { next(err) }
})

// GET /api/v1/ecosystem/air-gap/status
router.get('/air-gap/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const license = await getActiveLicense(tid(req))
    res.json(getAirGapStatus(license))
  } catch (err) { next(err) }
})

// ─── Certification ────────────────────────────────────────────────────────────

// POST /api/v1/ecosystem/certification/generate
router.post('/certification/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await generateCertificationEvidence(tid(req), req.body.certificationType)
    res.json(result)
  } catch (err) { next(err) }
})

// GET /api/v1/ecosystem/certification/exports
router.get('/certification/exports', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const exports = await listCertificationExports(
      tid(req),
      req.query['type'] as Parameters<typeof listCertificationExports>[1],
    )
    res.json(exports)
  } catch (err) { next(err) }
})

// ─── Workflows ────────────────────────────────────────────────────────────────

// GET /api/v1/ecosystem/workflows
router.get('/workflows', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wfs = await listWorkflows(tid(req), req.query['status'] as WorkflowStatus | undefined)
    res.json(wfs)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/workflows
router.post('/workflows', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wf = await createWorkflow(tid(req), req.body)
    res.status(201).json(wf)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/workflows/:id/validate
router.post('/workflows/:id/validate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await validateWorkflowPolicy(tid(req), req.params['id']!)
    res.json(result)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/workflows/:id/test
router.post('/workflows/:id/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await dryRunWorkflow(tid(req), req.params['id']!, req.body.testContext)
    res.json(result)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/workflows/:id/publish
router.post('/workflows/:id/publish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wf = await publishWorkflow(tid(req), req.params['id']!, req.body.publishedBy ?? 'admin')
    res.json(wf)
  } catch (err) { next(err) }
})

// POST /api/v1/ecosystem/workflows/:id/rollback
router.post('/workflows/:id/rollback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wf = await rollbackWorkflow(tid(req), req.params['id']!, Number(req.body.targetVersion))
    res.json(wf)
  } catch (err) { next(err) }
})

// GET /api/v1/ecosystem/workflows/:id/versions
router.get('/workflows/:id/versions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const versions = await getWorkflowVersions(tid(req), req.params['id']!)
    res.json(versions)
  } catch (err) { next(err) }
})

// ─── Type alias ───────────────────────────────────────────────────────────────
type WorkflowStatus = import('../services/ecosystem/ecosystemTypes').WorkflowStatus

export default router
