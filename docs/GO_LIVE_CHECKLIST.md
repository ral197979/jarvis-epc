# Go-Live Checklist — Phase 11

**Denver Engineering · GA Operations**
**Version:** 11.0.0

---

## Overview

This checklist governs tenant go-live readiness. It is enforced programmatically via `deploymentReadinessChecklist` and `customerGoLiveTracker`. A tenant cannot proceed to go-live until all required items are marked complete.

---

## Checklist Items

### Required Items (6 of 8)

All 6 items below must be completed before `isReadyForGoLive` returns `true`.

#### 1. Infrastructure Provisioned (`infrastructure_provisioned`)
- [ ] Tenant database schema created and migrated
- [ ] RLS policies applied and verified (`tenantQuery` path confirmed active)
- [ ] Application environment provisioned (ECS tasks, env vars, secrets)
- [ ] DNS and TLS certificates configured
- [ ] Health checks passing on all endpoints

**Completed by:** Infrastructure Engineer
**Verification:** `GET /health` returns `200` for tenant subdomain

---

#### 2. Data Migration Complete (`data_migration_complete`)
- [ ] Source data exported and schema-mapped via `schemaMappingEngine`
- [ ] Dry run completed with 0 validation errors
- [ ] Full import executed via `importPipeline` with `dryRun: false`
- [ ] `isImportSuccessful` returns `true` (status=complete, failedRows=0)
- [ ] Replay safety verified via `isImportReplaySafe`
- [ ] Row counts match between source and destination
- [ ] Spot-check 20 random records for data integrity

**Completed by:** Data Engineering / Implementation Engineer
**Verification:** `importJob.status === 'complete'` AND `importJob.failedRows === 0`

---

#### 3. User Training Done (`user_training_done`)
- [ ] Admin users completed platform training (≥ 2 hours)
- [ ] Key workflows demonstrated end-to-end
- [ ] AI suggestion acceptance walkthrough completed
- [ ] User accounts created with correct roles
- [ ] Training completion logged in pilot record

**Completed by:** Customer Success Manager
**Verification:** `pilotTenant.trainingScore >= 80`

---

#### 4. Integrations Verified (`integrations_verified`)
- [ ] All third-party integrations tested in production environment
- [ ] Webhook endpoints confirmed reachable and responding
- [ ] SSO/OAuth flow tested end-to-end
- [ ] API key rotation completed (no test keys in production)
- [ ] Partner certifications active (if applicable)

**Completed by:** Integration Engineer + Customer
**Verification:** All integration health checks green

---

#### 5. Security Review Passed (`security_review_passed`)
- [ ] RLS policies verified (≥ 10 active per Phase 10 requirement)
- [ ] No cross-tenant data leakage in validation run
- [ ] Audit log chain verified (no gaps in last 24 hours)
- [ ] Secrets rotated (no development credentials in production)
- [ ] Penetration test findings addressed (if applicable)

**Completed by:** Security Engineer
**Verification:** `productionGovernanceAuditor` passes all 5 checks

---

#### 6. Performance Baseline Met (`performance_baseline_met`)
- [ ] Tenant load profile simulated at 2× expected peak
- [ ] p95 latency within baseline (no regression > 15%)
- [ ] Error rate < 1% under simulated load
- [ ] `determineScaleTestStatus` returns `passed`
- [ ] Cache hit rates above target thresholds

**Completed by:** SRE / Performance Engineer
**Verification:** Scale test run status = `passed`, no open regressions

---

### Optional Items (2 of 8)

These items are not required for go-live but are strongly recommended.

#### 7. Disaster Recovery Tested (`disaster_recovery_tested`)
- [ ] Database backup verified restorable
- [ ] RTO/RPO objectives documented and tested
- [ ] Failover procedure walked through with on-call team
- [ ] Recovery playbook stored in runbook system

**Completed by:** SRE Team

---

#### 8. Rollback Plan Documented (`rollback_plan_documented`)
- [ ] Rollback procedure documented for each deployment wave
- [ ] `canRollback` flag verified on import job
- [ ] Rollback tested in staging
- [ ] Rollback ownership assigned

**Completed by:** Engineering Lead

---

## Checklist Completion Tracking

```typescript
import { computeChecklistCompletionPct, areAllRequiredItemsComplete, isReadyForGoLive } from '../services/phase11/deploymentReadinessChecklist'

const items = await getChecklistItems(tenantId)
const pct = computeChecklistCompletionPct(items)           // e.g. 75.0
const allRequired = areAllRequiredItemsComplete(items)      // true/false
const readyToGoLive = isReadyForGoLive(items)               // true/false
```

---

## Go-Live Approval

Once `isReadyForGoLive` returns `true`:

1. Engineering Lead signs off in the `CustomerGoLiveDashboard`
2. CSM confirms customer readiness
3. Click **"Go Live"** button — triggers `activated_at = NOW()` on pilot record
4. Deployment wave is initiated via `deploymentAutomationEngine`
5. Customer receives go-live confirmation email
6. SRE activates enhanced monitoring for 72 hours post go-live

---

## Post Go-Live Monitoring (First 72 Hours)

| Hour | Check |
|---|---|
| +1h | All health checks green, error rate < 0.5% |
| +4h | First full business workflow completed by customer |
| +24h | Health score ≥ 70, no open incidents |
| +48h | Adoption metrics trending positively |
| +72h | Formal go-live sign-off, transition to standard monitoring |
