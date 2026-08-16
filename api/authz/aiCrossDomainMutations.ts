/**
 * Denver Engineering — AI / cross-domain mutation perimeter (ADR-014 Phase 2C-3)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 2B-3 decided who may *read* the AI and cross-domain surface. This decides
 * who may *change* it — the 45 endpoints Phase 2C-2A measured as the largest
 * remaining coherent block of authentication-only ordinary mutations.
 *
 * Until now every one of these was authentication-only: any signed-in principal,
 * viewer included, could register a digital twin, overwrite agent memory, queue
 * an AI recommendation, create durable agent tasks, capture evidence against an
 * arbitrary entity, or open a replay session over the tenant's history.
 *
 * How authority was chosen
 * ────────────────────────
 * Not from the file name. `adaptive.ts` contains routes under three different
 * authorities and two of its POSTs turned out to be reads. Each endpoint was
 * classified by the side effect its handler actually performs, and the capability
 * was taken from the closest established sibling on the same resource family —
 * the same rule Phase 2C-2 applied. Concretely:
 *
 *   POST /adaptive/feedback   → ai.govern         because GET /adaptive/feedback is
 *   POST /adaptive/memory     → crossdomain.write because GET /adaptive/memory is
 *                               the crossdomain.read half
 *   POST /coordination/scan   → the same six-capability conjunction its own
 *                               GET .../recommendations already carries
 *   POST /ops/incident        → platform.automation because every other mutation
 *                               on the ops command centre is
 *
 * **No existing grant was changed.** One capability was created —
 * `crossdomain.write`, owner decision D8 — and it is granted to `owner` alone.
 *
 * Three things this slice deliberately does NOT do
 * ────────────────────────────────────────────────
 *   - it does not apply one capability to all 45. Six distinct authorities are
 *     used, plus two escalations to `transitions.ts`;
 *   - it does not leave a semantic read inside the mutation registry to preserve
 *     the count. Seven POSTs perform no write at all and are reclassified into
 *     the Phase 2B-3 read perimeter, where they are ratcheted;
 *   - it does not let `crossdomain.write` become an owner bypass into business
 *     domains. Every entry below writes only AI/synthesized state; the ratchet
 *     asserts none of them touches a domain-owned table.
 */
import type { ServerCapability } from './capabilities'

/** The temporary Owner-only mutation capability, named once so tests assert on it. */
export const TEMPORARY_CROSS_DOMAIN_WRITE = 'crossdomain.write' as const

/**
 * What this slice decided about an endpoint. Every one of the 45 entry
 * endpoints carries exactly one.
 */
export type AiMutationDisposition =
  /** Alters AI governance/configuration state. `ai.govern`. */
  | 'AI_GOVERNANCE_MUTATION'
  /** Creates/changes persisted state with no bounded source domain. `crossdomain.write`. */
  | 'CROSS_DOMAIN_MUTATION'
  /** AI-local artifact over a *known* domain set — AI authority AND domain authority. */
  | 'BOUNDED_DOMAIN_AI_MUTATION'
  /** Operations-centre mutation; neither AI governance nor synthesized state. */
  | 'PLATFORM_OPS_MUTATION'
  /** Proved to perform no write. Moved into the Phase 2B-3 read perimeter. */
  | 'CLASSIFICATION_CORRECTION_READ'
  /** Proved consequential. Registered in `transitions.ts` instead. */
  | 'CONSEQUENTIAL_TRANSITION'

export interface AiMutation {
  file:   string
  router: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path:   string
  disposition: AiMutationDisposition
  /** EVERY capability the caller must hold. Conjunction, never "any of". */
  allOf:  readonly ServerCapability[]
  /** Set when the entry relies on the temporary Owner-only fail-closed policy. */
  temporary?: boolean
  /**
   * Set when the entry was NOT part of the Phase 2C-3 entry census but was added
   * by a later slice as a semantic correction. The Phase 2C-3 ratchet
   * reconstructs its frozen 45-endpoint entry set from source plus this
   * registry, so a later addition would silently inflate a historical count.
   * Entries carrying this marker are excluded from that reconstruction and
   * asserted separately, which keeps both facts true at once.
   */
  addedIn?: 'PHASE_2C5'
  /**
   * The persisted effect, in the words of the handler. `'none'` marks a
   * classification correction — asserted against the source by the ratchet.
   */
  effect: string
  /** Why this capability rather than another. */
  reason: string
}

/**
 * All 45 Phase 2C-3 entry endpoints, each with exactly one disposition.
 *
 * Ordering follows the entry census: adaptive, twin, optimization, evidence,
 * agentMemory, scenarios, agentReadiness, agentRisk, simulation, singletons.
 */
export const AI_CROSS_DOMAIN_MUTATIONS: readonly AiMutation[] = [

  // ── adaptive.ts (12) ───────────────────────────────────────────────────────
  // Three authorities in one file. The learning/forecast half is AI model
  // telemetry the platform administrator governs; the outcome/memory half
  // carries free-form before/after payloads with no bounded provenance.
  {
    file: 'adaptive.ts', router: 'router', method: 'POST', path: '/feedback',
    disposition: 'AI_GOVERNANCE_MUTATION', allOf: ['ai.govern'],
    effect: 'INSERT INTO learning_feedback',
    reason: 'The read half of this exact resource — GET /adaptive/feedback, /feedback/health, /feedback/signals/:type, /feedback/source/... — is ai.govern. Learning feedback is AI model telemetry, not business data.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'POST', path: '/outcomes',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO recommendation_outcomes',
    reason: 'recordOutcome persists beforeState/afterState — free-form snapshots of whatever entity the recommendation touched, over an open entityType. GET /outcomes/effectiveness and /outcomes/top are crossdomain.read for that reason.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'PATCH', path: '/outcomes/:id/measurement',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'UPDATE recommendation_outcomes',
    reason: 'Writes afterState onto the same unbounded snapshot column POST /outcomes creates.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'POST', path: '/forecast-accuracy',
    disposition: 'AI_GOVERNANCE_MUTATION', allOf: ['ai.govern'],
    effect: 'INSERT INTO forecast_accuracy_history',
    reason: 'GET /forecast-accuracy and GET /forecast-accuracy/stats/:type are ai.govern. Forecast accuracy is model-quality telemetry.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'POST', path: '/forecast-accuracy/:id/actual',
    disposition: 'AI_GOVERNANCE_MUTATION', allOf: ['ai.govern'],
    effect: 'UPDATE forecast_accuracy_history',
    reason: 'Closes out a prediction on the row POST /forecast-accuracy created; same authority.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'POST', path: '/calibrate',
    disposition: 'CLASSIFICATION_CORRECTION_READ', allOf: ['ai.govern'],
    effect: 'none',
    reason: 'calibratePrediction reads getAccuracyStats and returns an adjusted number. No INSERT, UPDATE, DELETE or durable job anywhere in forecastCalibrationEngine.ts. A computation expressed as POST; its sibling GET /calibrate/drift/:type is ai.govern over the same data.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'POST', path: '/rank',
    disposition: 'CLASSIFICATION_CORRECTION_READ', allOf: ['crossdomain.read'], temporary: true,
    effect: 'none',
    reason: 'rankRecommendations reads getAgentEffectiveness and sorts the candidate list the caller supplied. recommendationRankingEngine.ts contains no write. GET /rank/top is crossdomain.read over the identical data.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'POST', path: '/anomaly-patterns/:anomalyId/feedback',
    disposition: 'AI_GOVERNANCE_MUTATION', allOf: ['ai.govern'],
    effect: 'INSERT INTO learning_feedback',
    reason: 'Marks an anomaly detection a false positive — model-quality feedback. GET /anomaly-patterns and /anomaly-patterns/:type are ai.govern.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'POST', path: '/memory',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO agent_memory … ON CONFLICT DO UPDATE',
    reason: 'Operational memory is keyed by an open scopeType/scopeId and stores a free-form value. GET /adaptive/memory and /memory/:agentType/:scopeType/:key are crossdomain.read.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'POST', path: '/memory/decay',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'UPDATE agent_memory (confidence decay)',
    reason: 'Bulk-alters the same unbounded memory rows POST /memory writes.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'POST', path: '/memory/reinforce',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'UPDATE agent_memory (confidence boost)',
    reason: 'Raises the confidence an agent places in an unbounded memory entry; same authority as writing one.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'POST', path: '/simulation-outcomes',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO learning_feedback (scenario outcome)',
    reason: 'Records the realised outcome of a scenario simulation. GET /simulation-outcomes is crossdomain.read; only its aggregate /stats sibling is ai.govern.',
  },

  // ── twin.ts (7) ────────────────────────────────────────────────────────────
  // Every read on this router is crossdomain.read because `twin_entity_type`
  // spans project, system, subsystem, equipment, tag, workflow, action,
  // inspection, deficiency, permit, vendor, workforce, site and region, and
  // twin state is an unbounded "full state capture" JSONB. The writes put data
  // INTO exactly those columns, so the same unbounded provenance applies.
  {
    file: 'twin.ts', router: 'router', method: 'POST', path: '/',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO operational_twins … ON CONFLICT DO UPDATE',
    reason: 'Registers a twin over any entity_type in the unbounded set. registerTwin destructures a fixed field list and never accepts status, so this cannot forge sync health.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'POST', path: '/:twinId/sync',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'writes observed twin state + snapshot',
    reason: 'Writes the unbounded state JSONB GET /:twinId/state discloses under crossdomain.read.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'POST', path: '/register-sync',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'registerTwin + syncTwin in one call',
    reason: 'The composition of POST / and POST /:twinId/sync; it cannot carry less authority than either half.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'POST', path: '/:twinId/events',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'applyEventLink — links an event and applies a state delta',
    reason: 'Applies a caller-supplied stateDelta to the unbounded twin state.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'POST', path: '/:twinId/snapshots',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO twin_state_snapshots',
    reason: 'Creates the signed point-in-time capture GET /:twinId/snapshots reads under crossdomain.read.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'POST', path: '/:twinId/relationships',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO twin_relationships',
    reason: 'Edges of the cross-domain state graph that /traverse, /impact and /risk-propagation walk under crossdomain.read.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'DELETE', path: '/:twinId/relationships',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'DELETE FROM twin_relationships',
    reason: 'Removes an edge from the same graph; deletion is not lesser authority than creation.',
  },
  // ADR-014 Phase 2C-5 §17 — semantic correction. Registered in
  // `aiCrossDomainReads.ts` as a CROSS_DOMAIN_AI_READ until Phase 2C-5, and
  // guarded on the route by `crossdomain.read`, even though the handler writes.
  // A read capability can no longer change twin status.
  {
    file: 'twin.ts', router: 'router', method: 'PATCH', path: '/:twinId/status',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    addedIn: 'PHASE_2C5',
    effect: 'UPDATE operational_twins SET status',
    reason: 'updateTwinStatus writes the sync-health status of a twin over the unbounded twin_entity_type set. It is the same persisted object POST /:twinId/sync maintains, so it carries the same crossdomain.write authority rather than the crossdomain.read it was declared with before Phase 2C-5.',
  },

  // ── optimization.ts (5) ────────────────────────────────────────────────────
  // Only one of the five writes. The other four synthesize a report and return
  // it — the exact error class Phase 2C-2 found on the correlations endpoint.
  {
    file: 'optimization.ts', router: 'router', method: 'POST', path: '/proposals',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO optimization_feedback',
    reason: 'GET /proposals is crossdomain.read. proposeOptimization destructures a fixed field list and never accepts status, so a holder cannot create a proposal already approved or applied — those literals belong to POST /proposals/:id/approve and /apply, both already ai.govern.',
  },
  {
    file: 'optimization.ts', router: 'router', method: 'POST', path: '/strategy',
    disposition: 'CLASSIFICATION_CORRECTION_READ', allOf: ['crossdomain.read'], temporary: true,
    effect: 'none',
    reason: 'generateStrategyPlan SELECTs operational_twins, operational_anomalies and optimization_feedback and returns a plan object. operationalStrategyPlanner.ts contains no INSERT, UPDATE or DELETE.',
  },
  {
    file: 'optimization.ts', router: 'router', method: 'POST', path: '/consensus',
    disposition: 'CLASSIFICATION_CORRECTION_READ', allOf: ['crossdomain.read'], temporary: true,
    effect: 'none',
    reason: 'buildConsensus scores the votes in the request body against historical effectiveness. The only query in optimizationCoordinator.ts is the SELECT inside getOptimizationSummary.',
  },
  {
    file: 'optimization.ts', router: 'router', method: 'POST', path: '/coordinate',
    disposition: 'CLASSIFICATION_CORRECTION_READ', allOf: ['crossdomain.read'], temporary: true,
    effect: 'none',
    reason: 'coordinateRecommendations reconciles the inputs supplied in the body via rankRecommendations. No write in optimizationCoordinator.ts.',
  },
  {
    file: 'optimization.ts', router: 'router', method: 'POST', path: '/root-cause',
    disposition: 'CLASSIFICATION_CORRECTION_READ', allOf: ['crossdomain.read'], temporary: true,
    effect: 'none',
    reason: 'synthesizeRootCause SELECTs operational_anomalies, realtime_event_log and twin_state_snapshots and returns a report. rootCauseSynthesisEngine.ts contains no write.',
  },

  // ── evidence.ts (4) ────────────────────────────────────────────────────────
  // Phase 2B-3 put both evidence reads on crossdomain.read because
  // `evidence_links.entity_type` is an open string, so the domain of an evidence
  // asset follows whatever it was linked to. The writes decide that linkage.
  {
    file: 'evidence.ts', router: 'evidenceRouter', method: 'POST', path: '/initiate',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO evidence_assets + presigned upload URL',
    reason: 'Creates the asset row GET /evidence/:id returns under crossdomain.read, and issues storage credentials for it.',
  },
  {
    file: 'evidence.ts', router: 'evidenceRouter', method: 'POST', path: '/confirm',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'UPDATE evidence_assets (storage key, checksum)',
    reason: 'Binds a storage object and its checksum to the asset — the integrity claim the read surface reports.',
  },
  {
    file: 'evidence.ts', router: 'evidenceRouter', method: 'POST', path: '/link',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO evidence_links',
    reason: 'This is the route that sets the open `entity_type` Phase 2B-3 named as the reason evidence has no bounded domain. It decides which domain an asset belongs to, so no domain capability can be checked at authorization time.',
  },
  {
    file: 'evidence.ts', router: 'evidenceRouter', method: 'POST', path: '/assets/:id/scan',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO asset_scan_events',
    reason: 'Records a QR/NFC scan against a caller-supplied asset_type with no bounded domain, co-located on the evidence router and reached through the same open-entity model.',
  },

  // ── agentMemory.ts (3) ─────────────────────────────────────────────────────
  {
    file: 'agentMemory.ts', router: 'agentMemoryRouter', method: 'POST', path: '/',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO agent_memory_entries',
    reason: 'GET / and GET /:agentType/:scopeType/:scopeId/:key are crossdomain.read: memory value is free-form and scope is an open string.',
  },
  {
    file: 'agentMemory.ts', router: 'agentMemoryRouter', method: 'DELETE', path: '/:agentType/:scopeType/:scopeId/:key',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'forgetMemory — deletes an entry',
    reason: 'Erases what an agent knows; the same authority as writing it.',
  },
  {
    file: 'agentMemory.ts', router: 'agentMemoryRouter', method: 'POST', path: '/purge',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'purgeExpiredMemory — bulk delete',
    reason: 'Tenant-wide bulk deletion of the same rows; strictly broader than the single-key delete above.',
  },

  // ── scenarios.ts (3) ───────────────────────────────────────────────────────
  // run/cancel move a simulation row through pending → running → completed |
  // cancelled. That lifecycle is confined to scenario_simulations: no business
  // record is written, so it is an ordinary AI-artifact mutation and NOT a
  // consequential transition.
  {
    file: 'scenarios.ts', router: 'router', method: 'POST', path: '/',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO scenario_simulations',
    reason: 'GET / and GET /:scenarioId are crossdomain.read. createScenario destructures a fixed field list and never accepts status, so a holder cannot create a scenario already completed.',
  },
  {
    file: 'scenarios.ts', router: 'router', method: 'POST', path: '/:scenarioId/run',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: "UPDATE scenario_simulations SET status='running' → 'completed', results",
    reason: 'Executes the simulation and persists its results. Every write stays inside scenario_simulations — _applyEvent mutates an in-memory copy of the base state, so no twin or business row changes.',
  },
  {
    file: 'scenarios.ts', router: 'router', method: 'POST', path: '/:scenarioId/cancel',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: "UPDATE scenario_simulations SET status='cancelled' WHERE status IN ('pending','running')",
    reason: 'Stops a simulation the caller could have started. Guarded by the same authority as starting one.',
  },

  // ── agentReadiness.ts (2) ──────────────────────────────────────────────────
  // POST /coordinate is NOT here: it calls orchestrate() with no dryRun and is
  // registered in transitions.ts. See NEWLY_DISCOVERED_CONSEQUENTIAL below.
  {
    file: 'agentReadiness.ts', router: 'agentReadinessRouter', method: 'POST', path: '/assess',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO agent_tasks (durable job)',
    reason: 'enqueueTask creates durable work over a scope defaulting to global. Its sibling GET /plan/:scope/:id performs the identical enqueue under crossdomain.read, so the read authority is settled and only the write half is new. Unlike /coordinate it does not call orchestrate, so it neither bypasses governance nor opens execution records.',
  },

  // ── agentRisk.ts (2) ───────────────────────────────────────────────────────
  {
    file: 'agentRisk.ts', router: 'agentRiskRouter', method: 'POST', path: '/analyze',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO agent_tasks (durable job)',
    reason: 'Enqueues the analyze_risk job for a scope. Until Phase 2C-5 the identical enqueueTask was also reachable through GET /agents/risk/overview at crossdomain.read; §19 removed that side effect, so this route is now the ONLY way to create the job and the read half merely observes it. Deliberately NOT risk.write: it writes no risk register row.',
  },
  {
    file: 'agentRisk.ts', router: 'agentRiskRouter', method: 'POST', path: '/mitigate',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO agent_tasks (durable job)',
    reason: 'Queues recommend_mitigation over the same unbounded scope. It produces recommendations; it does not close a risk, which is POST /risks/:id/close under risk.approve.',
  },

  // ── simulation.ts (2) ──────────────────────────────────────────────────────
  {
    file: 'simulation.ts', router: 'simulationRouter', method: 'POST', path: '/replay',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO simulation_sessions + background runReplay',
    reason: 'Creates a durable session and starts asynchronous work over the tenant event history. GET / and GET /:id/results are crossdomain.read.',
  },
  {
    file: 'simulation.ts', router: 'simulationRouter', method: 'POST', path: '/what-if',
    disposition: 'CROSS_DOMAIN_MUTATION', allOf: ['crossdomain.write'], temporary: true,
    effect: 'INSERT INTO simulation_sessions (via createSimulationSession)',
    reason: 'Named like a computation, but runWhatIf opens a persisted session row before replaying. A durable record makes it a mutation regardless of the analytical intent.',
  },

  // ── singleton families (5, one of which escalated to transitions.ts) ───────
  // agentActionsRoutes.ts POST /:id/review is NOT here — it is a consequential
  // transition. See NEWLY_DISCOVERED_CONSEQUENTIAL below.
  {
    file: 'agents.ts', router: 'agentsRouter', method: 'POST', path: '/plan',
    disposition: 'CLASSIFICATION_CORRECTION_READ', allOf: ['ai.govern'],
    effect: 'none',
    reason: 'orchestrate() is called with options.dryRun = true, which returns { tasksCreated: 0 } before enqueueTask or openExecution. checkGovernance is invoked without an executionId, so it writes no execution event either, and evaluateAgentPolicies is read-only. The non-dry-run twin, POST /agents/execute, is already a registered transition under ai.govern; GET /agents/objectives is ai.govern.',
  },
  {
    file: 'aiGovernance.ts', router: 'aiGovernanceRouter', method: 'POST', path: '/recommendations',
    disposition: 'AI_GOVERNANCE_MUTATION', allOf: ['ai.govern'],
    effect: 'INSERT INTO ai_recommendation_queue',
    reason: 'Phase 2B-3 already recorded this in RECLASSIFIED_NOT_AI_READS as an ordinary mutation deferred to Phase 2C. Every other route on aiGovernanceRouter is ai.govern; queueing an item into the human-approval queue is governance of the queue.',
  },
  {
    file: 'autoCoordination.ts', router: 'router', method: 'POST', path: '/projects/:projectId/coordination/scan',
    disposition: 'BOUNDED_DOMAIN_AI_MUTATION',
    allOf: ['assistant.use', 'project.view', 'construction.view', 'engineering.view', 'schedule.view', 'cost.view'],
    effect: 'INSERT INTO coordination_recommendations … ON CONFLICT DO UPDATE',
    reason: 'The one endpoint in this slice whose source domains ARE bounded, so the two-dimensional Phase 2B-3 model is preserved rather than collapsed into crossdomain.write. buildProjectCoordination reads exactly projects, rfis, submittals (construction), bim_issues (engineering), schedule_dependencies/schedule_tasks and change_orders (cost) — the same six capabilities its own GET .../coordination/recommendations already requires. It writes only the AI artifact; the underlying business rows are untouched. Approving one of these recommendations, which does create an action, is POST /coordination/recommendations/:id/approve under ai.govern.',
  },
  {
    file: 'ops.ts', router: 'opsRouter', method: 'POST', path: '/incident',
    disposition: 'PLATFORM_OPS_MUTATION', allOf: ['platform.automation'],
    effect: 'INSERT INTO ops_incidents + broadcastEvent',
    reason: 'The fifth mutation on the operations command centre. The other four — /reassign, /escalate, /freeze, /unfreeze — are all platform.automation, and same-file, same-router sibling precedent is the capability-selection rule this gate inherits from Phase 2C-2. Deliberately NOT crossdomain.write: an incident report is authored by a person, not synthesized from unbounded sources, so the fail-closed cross-domain placeholder does not describe it. Recorded as a distinct disposition because it is neither AI governance nor cross-domain synthesis.',
  },
]

/**
 * Operations this slice proved consequential rather than ordinary. They are
 * registered in `transitions.ts` and guarded there, not above.
 *
 * ADR-014 Phase 2C-2 §42 applies unchanged: correctness outranks counter
 * stability. Both are new discoveries, so the confirmed consequential count
 * moves 86 → 88.
 */
export interface NewlyConsequentialAiMutation {
  file: string; router: string; method: string; path: string
  capability: ServerCapability
  reason: string
}

export const NEWLY_DISCOVERED_CONSEQUENTIAL: readonly NewlyConsequentialAiMutation[] = [
  {
    file: 'agentReadiness.ts', router: 'agentReadinessRouter', method: 'POST', path: '/coordinate',
    capability: 'ai.govern',
    reason: 'An unguarded second path to an outcome the registry already protects. It calls orchestrate() with no options, so dryRun is falsy and the full path runs: checkGovernance, then enqueueTask plus openExecution for every task in the plan. That is precisely what POST /agents/execute does, and POST /agents/execute is a registered transition requiring ai.govern. Leaving it ordinary would let any authenticated principal start autonomous agent execution while the canonical route demanded governance authority.',
  },
  {
    file: 'agentActionsRoutes.ts', router: 'router', method: 'POST', path: '/:id/review',
    capability: 'ai.govern',
    reason: 'Records the human verdict — confirmed, overridden or reversed — on an action an agent already took autonomously, writing reviewed_by, reviewed_at and review_outcome. This is the human-in-the-loop record of record for AI decisions and it feeds the digest and review-queue dashboards. Its direct analogue, POST /agent-approvals/:id/approve, is already a registered transition under ai.govern; a verdict on an executed action is not lesser authority than a verdict on a proposed one.',
  },
]

/**
 * The seven endpoints proved to perform no write. Each is registered in
 * `api/authz/aiCrossDomainReads.ts` and ratcheted by the Phase 2B-3 perimeter —
 * deliberately NOT in a second read list that could drift.
 *
 * Kept here so the Phase 2C-3 arithmetic is inspectable in one place: 45 entry
 * endpoints = 36 protected mutations + 2 consequential transitions + 7 of these.
 */
export const RECLASSIFIED_AS_READS: readonly string[] = AI_CROSS_DOMAIN_MUTATIONS
  .filter(m => m.disposition === 'CLASSIFICATION_CORRECTION_READ')
  .map(m => `${m.file} ${m.router}.${m.method} ${m.path}`)

/**
 * Cross-domain writes must not reach domain-owned state. Listed as table-name
 * fragments the ratchet greps the touched handlers for.
 *
 * `crossdomain.write` authorizes the synthesized artifact only. If one of these
 * appears in a handler guarded by it alone, the route needs the corresponding
 * domain authority or is a consequential transition — §9 of the Phase 2C-3 brief.
 */
export const DOMAIN_OWNED_WRITE_TARGETS: readonly string[] = [
  'projects', 'change_orders', 'cost_entries', 'budgets', 'pay_applications',
  'purchase_orders', 'subcontracts', 'bid_packages', 'invoices',
  'punch_items', 'inspections', 'ncrs', 'daily_logs', 'rfis', 'submittals',
  'compliance_tasks', 'commissioning_packs', 'timesheets', 'assignments',
  'users', 'tenants', 'api_keys', 'edge_nodes', 'user_role',
]

/**
 * Endpoints outside this slice that the entry census counted as pending
 * mutations. Recorded so the exit arithmetic is inspectable and so a later
 * slice inherits an explicit, not an implied, backlog.
 */
export const PHASE_2C3_OUT_OF_SCOPE = {
  personalInbox: { files: ['actions.ts', 'notifications.ts', 'personalAgent.ts'], count: 17,
    deferredTo: 'ADR-014 Phase 2C-4 — Personal Inbox read/mutation authorization policy' },
  scimServiceBoundary: { files: ['scim.ts'], count: 4,
    deferredTo: 'SCIM protocol service-boundary census classification' },
  iotHybrid: { files: ['iot.ts'], count: 2,
    deferredTo: 'census taxonomy for "verified service bearer OR user capability"; authorization already closed in Phase 2C-2A' },
  deadRoute: { files: ['denverMcp.ts'], count: 1,
    deferredTo: 'denverMcp router is never mounted; removal is a product decision' },
} as const
