/**
 * Denver Engineering — API authorization manifest (ADR-014 Phase 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Every route file carries exactly one classification. The coverage test
 * (`api/__tests__/authzCoverage.test.ts`) censuses the real route declarations
 * and fails if a file is unclassified, so a new business endpoint cannot be
 * added without someone deciding how it is authorized.
 *
 * `PENDING_PHASE2` is a debt ratchet, not a classification. It records — with
 * exact endpoint counts — the surface that is still authentication-only. The
 * test asserts the counts match reality, so the list can only shrink
 * deliberately: adding endpoints to a pending file fails the build, and
 * removing the last one requires deleting the entry.
 *
 * Phase 2 is INCOMPLETE while `PENDING_PHASE2` is non-empty.
 */

export type RouteClass =
  /** Guarded by `requireCapability` / `requireAnyCapability`. */
  | 'CAPABILITY'
  /** Deliberately reachable without a user session. */
  | 'PUBLIC'
  /** Machine-to-machine; authenticated by HMAC signature, not a user role. */
  | 'SERVICE_HMAC'
  /** Still authentication-only. Phase 2 debt. */
  | 'PENDING_PHASE2'

export interface RouteFileClassification {
  klass:  RouteClass
  /** Why this classification is correct. Required for everything except pending. */
  reason?: string
  /** For PENDING_PHASE2: the endpoint count recorded when the debt was booked. */
  endpoints?: number
}

/**
 * Files whose every endpoint is enforced by the canonical primitive.
 */
export const CAPABILITY_PROTECTED: Record<string, RouteFileClassification> = {
  'ask.ts': {
    klass: 'CAPABILITY',
    reason: 'Router-level assistant.use; session deletion requires assistant.admin (ADR-014 §20).',
  },
  'knowledge.ts': {
    klass: 'CAPABILITY',
    reason: 'Router-level assistant.use for corpus reads; ingest/re-embed/mine/delete require assistant.admin.',
  },
}

/**
 * Non-user authentication contracts. These must NOT carry a human capability.
 */
export const NON_USER_AUTH: Record<string, RouteFileClassification> = {
  'commissioningWebhook.ts': {
    klass: 'SERVICE_HMAC',
    reason: 'Raw-body HMAC signature, mounted before express.json() and outside the /api/v1 auth chain.',
  },
  'novaCommands.ts': {
    klass: 'SERVICE_HMAC',
    reason: 'Raw-body HMAC with dual-secret rotation; tenant resolved from the verified connection record.',
  },
  'openapi.ts': {
    klass: 'PUBLIC',
    reason: 'Spec document, flag-gated by OPENAPI_ENABLED; serves no tenant data.',
  },
}

/**
 * PHASE 2 DEBT — still authentication-only.
 *
 * Any authenticated tenant user can invoke these regardless of role. The counts
 * are asserted against the live census, so this list cannot silently grow.
 */
export const PENDING_PHASE2: Record<string, number> = {
  'actions.ts': 23, 'adaptive.ts': 28, 'agentActionsRoutes.ts': 4, 'agentApprovals.ts': 5,
  'agentMemory.ts': 6, 'agentReadiness.ts': 3, 'agentRisk.ts': 3, 'agents.ts': 9,
  'aiGovernance.ts': 7, 'audit.ts': 4, 'auditVerification.ts': 4, 'autoCoordination.ts': 4,
  'automation.ts': 11, 'autosignRules.ts': 5, 'baselinesRoutes.ts': 3, 'bim.ts': 9,
  'budgets.ts': 8, 'calculations.ts': 5, 'changeOrders.ts': 12, 'commissioning.ts': 12,
  'commissioningItems.ts': 3, 'commitments.ts': 1, 'compliance.ts': 7, 'copilot.ts': 8,
  'correlations.ts': 1, 'costControl.ts': 1, 'costEntry.ts': 8, 'costIntelligence.ts': 1,
  'dailyLogs.ts': 7, 'deficiencies.ts': 3, 'denverMcp.ts': 2, 'drawings.ts': 11,
  'ecosystem.ts': 50, 'enterprise.ts': 40, 'estimating.ts': 17, 'evidence.ts': 7,
  'evm.ts': 10, 'executive.ts': 7, 'exports.ts': 3, 'fieldAssistant.ts': 1,
  'fieldSync.ts': 2, 'files.ts': 11, 'fixLibrary.ts': 8, 'inspections.ts': 8,
  'integrationHub.ts': 7, 'integrations.ts': 12, 'iot.ts': 10, 'lifecycle.ts': 3,
  'mcp.ts': 4, 'meetings.ts': 12, 'monteCarlo.ts': 4, 'myWork.ts': 1, 'ncr.ts': 8,
  'notifications.ts': 7, 'novaIntegrationStatus.ts': 2, 'ops.ts': 11, 'optimization.ts': 11,
  'payApplications.ts': 7, 'personalAgent.ts': 5, 'policies.ts': 5, 'portfolio.ts': 11,
  'predict.ts': 2, 'procurement.ts': 16, 'procurementRisk.ts': 1, 'projects.ts': 7,
  'proposals.ts': 13, 'punchLists.ts': 11, 'qualityIntelligence.ts': 1, 'readiness.ts': 5,
  'related.ts': 1, 'rfiCopilot.ts': 1, 'riskRegister.ts': 6, 'runbooks.ts': 7,
  'safety.ts': 7, 'scenarios.ts': 11, 'schedule.ts': 8, 'scheduleCriticalPath.ts': 2,
  'scheduleForecast.ts': 1, 'scheduleImport.ts': 2, 'scim.ts': 12, 'simulation.ts': 4,
  'subcontracts.ts': 19, 'submittalReview.ts': 1, 'sync.ts': 5, 'systems.ts': 9,
  'team.ts': 9, 'tenants.ts': 8, 'testPacks.ts': 4, 'testResults.ts': 2,
  'timesheets.ts': 7, 'transmittals.ts': 7, 'turnover.ts': 3, 'twin.ts': 20,
  'vendorScorecard.ts': 1,
}

/** Every classified file, for the coverage test. */
export function classificationFor(file: string): RouteFileClassification | undefined {
  if (CAPABILITY_PROTECTED[file]) return CAPABILITY_PROTECTED[file]
  if (NON_USER_AUTH[file])        return NON_USER_AUTH[file]
  if (file in PENDING_PHASE2)     return { klass: 'PENDING_PHASE2', endpoints: PENDING_PHASE2[file] }
  return undefined
}
