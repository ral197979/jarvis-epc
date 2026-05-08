# Incident Response Playbook — Denver Engineering

**Version:** 10.0.0  
**Maintained by:** Platform Engineering  
**Last Updated:** 2026-05-07

---

## Severity Levels

| Level | Definition | Response Time | Examples |
|-------|-----------|---------------|---------|
| P0 | Platform down / complete data loss risk | 15 minutes | DB unavailable, replay divergence in prod, billing system down |
| P1 | Major feature broken / significant tenant impact | 1 hour | Queue backlog > 1000, SLO breach, replay failures |
| P2 | Degraded functionality | 4 hours | High latency, flaky tests in CI, edge sync lag |
| P3 | Minor issue / cosmetic | 24 hours | UI bug, slow queries, single tenant issue |

---

## P0 Response: Platform Down

1. **Acknowledge** alert in PagerDuty within 15 minutes
2. **Assess** via `ReliabilityCommandCenter` and `LaunchReadinessDashboard`
3. **Identify** scope: which tenants, which dimensions (use `operationalReadinessScanner`)
4. **Rollback** if deployment-related:
   ```typescript
   const audit = await getLatestDeployment('production')
   if (isRollbackSafe(audit)) {
     await updateDeploymentStatus(audit.id, 'rolled_back')
     // trigger infra rollback
   }
   ```
5. **Communicate** to affected tenants via support channel within 30 minutes
6. **Post-mortem** within 48 hours

---

## P1 Response: Replay Divergence

Triggered by: `ReplayVerificationRun.status === 'failed'`

1. Open incident via `openReplayIncident(tenantId, eventStreamId, divergenceHash, passes, failures)`
2. Run diagnostic: `analyzeReplayDivergence(tenantId, eventStreamId)`
3. Review recommendation from `generateRecommendation(rootCause)`
4. Common root causes:
   - **nondeterministic_code**: Audit event handlers for `Math.random()`, `Date.now()`
   - **missing_event**: Verify event stream completeness
   - **schema_mismatch**: Check recent migrations
   - **clock_skew**: Enable monotonic clock
5. Resolve: `resolveReplayIncident(incidentId, rootCause, resolution)`
6. Verify: Re-run `startVerification()` → expect `status === 'passed'`

---

## P1 Response: SLO Breach

Triggered by: `uptimePercent < 99.9%`

1. Check `SLACompliancePanel` for active violations
2. Record violation: `recordSLOViolation(environment, type, description, durationMs, impactedTenants)`
3. Identify degraded dimensions via `getUptimeSummary()`
4. Remediate root cause
5. Resolve violation: `resolveViolation(violationId, rootCause)`
6. Monitor error budget: `computeErrorBudgetRemaining(uptimePercent)`

---

## P1 Response: Queue Backlog

Triggered by: `runQueueHealthCheck` → `fail` (> 1000 pending items > 5 minutes)

1. Check worker health: `getUptimeHistory('worker_churn')`
2. Scale workers if under-provisioned
3. Inspect oldest queue items for stuck jobs
4. If DB-related: run `checkMigrationSafety()`
5. Clear stuck items only after root cause identified

---

## Communication Templates

### Tenant Notification (P0/P1)
```
Subject: [Action Required] Platform Incident — Denver Engineering

We are currently experiencing [ISSUE]. The following services are affected:
- [LIST]

Estimated recovery: [TIME or 'Investigating']
Next update: [TIME]

Support ticket: [ID]
```

### Resolution Notification
```
Subject: [Resolved] Platform Incident — Denver Engineering

The incident affecting [ISSUE] has been resolved as of [TIME].

Root cause: [ROOT_CAUSE]
Duration: [DURATION]
Affected tenants: [COUNT]

We apologize for the disruption.
```
