# Operational Stewardship Program — Ava/Denver v13+

**Program:** Long-Term Operational Stewardship  
**Effective:** v13.0.0 (Post-GA)  
**Owner:** Denver Engineering  
**Status:** Active  

---

## Mission

The Ava/Denver platform is architecturally complete. This program governs what happens next: sustained operational excellence, governance preservation, customer success, and controlled evolution — without introducing uncontrolled complexity, governance shortcuts, or replay compromises.

Phases 1–13 built the platform. This program keeps it trustworthy.

---

## Primary Operating Principles

1. **Governance first** — operational decisions do not override governance controls
2. **Replay integrity is sacred** — replay failures are SEV events, not backlog items
3. **No hidden automation** — all automated behavior is auditable and documented
4. **No opaque adaptive behavior** — AI behavior changes require explicit review
5. **No uncontrolled complexity growth** — complexity budget violations require council review
6. **No ecosystem trust dilution** — no entity auto-approved; all moderation human-reviewed
7. **No unsafe plugin/agent escalation** — all high-impact ecosystem actions require approval
8. **No cross-tenant leakage** — tenant isolation regressions block all deployments
9. **Stability over feature inflation** — new features require stewardship impact assessment
10. **Production reliability over architectural novelty** — operational trust is the product

---

## Ten Stewardship Domains

| # | Domain | Cadence | Owner Service |
|---|--------|---------|---------------|
| 1 | Real Customer Operations | Daily/Weekly | `deploymentOperationsCoordinator` |
| 2 | Governance Durability | Weekly | `governanceDurabilityAuditor` |
| 3 | Ecosystem Trust Management | Weekly | `ecosystemTrustOperations` |
| 4 | Operational Telemetry | Daily | `productionTelemetryOperations` |
| 5 | Deployment & Reliability | Per-wave | `rolloutWaveManager` |
| 6 | Customer Success & Support | Daily | `customerAdoptionOptimizer`, `supportOperationsCoordinator` |
| 7 | Cost & Performance | Monthly | `platformEvolutionCouncil` |
| 8 | Complexity Governance | Monthly | `platformEvolutionCouncil` |
| 9 | Industry Expansion | Per-vertical | `industryExpansionFramework` |
| 10 | Long-Term Platform Evolution | Quarterly | `platformEvolutionCouncil` |

---

## Domain 1 — Real Customer Operations

**Goal:** Every tenant deployment succeeds reliably. Onboarding friction is measured and minimized.

Key operations:
- Pre-wave deployment readiness reviews (`computeReadinessScore`)
- Onboarding completion rate tracking (`assessTenantAdoption`)
- Operational maturity progression monitoring
- Replay validation before every wave (`replayValidated === true`)
- Governance verification during rollout
- Rollback drill rehearsals (monthly)

Health signal: `waveSuccessRate >= 0.80` AND `onboardingComplete` rate trending up.

Reference: [`CUSTOMER_DEPLOYMENT_OPERATIONS.md`](CUSTOMER_DEPLOYMENT_OPERATIONS.md), [`DEPLOYMENT_RELIABILITY_REFINEMENT.md`](DEPLOYMENT_RELIABILITY_REFINEMENT.md)

---

## Domain 2 — Governance Durability

**Goal:** All six governance dimensions maintain ≥ 98% pass rate. Replay drift stays below 1%.

Key operations:
- Weekly `recordDurabilityCheck()` per dimension
- Replay drift monitoring after every pipeline execution
- `getOpenReplayDriftAlerts()` — must resolve before new tenant activations
- Approval enforcement verification (all high-risk actions have approvals)
- Plugin isolation validation
- Explainability compliance spot-checks

Non-negotiable: replay failures → SEV-2 minimum. Governance bypass → release blocker.

Reference: [`GOVERNANCE_DURABILITY_PROGRAM.md`](GOVERNANCE_DURABILITY_PROGRAM.md)

---

## Domain 3 — Ecosystem Trust Management

**Goal:** Trust signal stays ≥ 0.75. Moderation queue depth stays manageable. No auto-approvals ever.

Key operations:
- Plugin certification reviews (all new plugins moderated before activation)
- Workflow sandbox validation before production
- External agent audits quarterly
- `computeEcosystemTrustSignal()` tracked weekly
- Revocation drills (quarterly — verify revocation is replay-safe)
- Moderation replay reviews (all moderation actions produce consistent replay output)

Rule: `canAutoApprove()` is permanently `false`. This is not configurable.

Reference: [`ECOSYSTEM_TRUST_AND_MODERATION.md`](ECOSYSTEM_TRUST_AND_MODERATION.md)

---

## Domain 4 — Operational Telemetry

**Goal:** Platform drift score stays ≥ 70. Severe drift is investigated same-day.

Key operations:
- Daily `recordTelemetry()` for all 8 tracked metrics
- `getRecentAlerts()` reviewed each morning
- Severe drift (`> 35%` deviation) → page on-call immediately
- Replay-related drift → escalate to replay integrity team
- Weekly trend analysis for moderate drift patterns

Tracked metrics: `recommendation_acceptance`, `workflow_abandonment`, `replay_latency`, `support_escalation`, `onboarding_friction`, `plugin_adoption`, `deployment_rollback`, `operational_bottleneck`

Reference: [`PRODUCTION_TELEMETRY_OPERATIONS.md`](PRODUCTION_TELEMETRY_OPERATIONS.md)

---

## Domain 5 — Deployment & Reliability

**Goal:** Wave success rate ≥ 80%. Rollback recovery time < 30 minutes.

Key operations:
- Per-wave abort evaluation (`waveSuccessRate < 0.80` → abort)
- Replay validation required before wave creation
- Zero-tolerance replay gate enforcement in `tenantLaunchValidator`
- Migration replay validation before database changes
- Monthly failover drill
- Monthly rollback rehearsal

Reference: [`DEPLOYMENT_RELIABILITY_REFINEMENT.md`](DEPLOYMENT_RELIABILITY_REFINEMENT.md), [`CUSTOMER_DEPLOYMENT_OPERATIONS.md`](CUSTOMER_DEPLOYMENT_OPERATIONS.md)

---

## Domain 6 — Customer Success & Support

**Goal:** Churn risk stays below 0.35 across all tenants. SLA breaches trend to zero.

Key operations:
- Weekly `assessTenantAdoption()` for all active tenants
- `getAtRiskTenants()` reviewed every Monday
- `buildIncidentClusters()` weekly — identify systemic failure patterns
- Replay-assisted diagnostics on all L2+ incidents (`replayAssisted: true`)
- Root cause documented for every resolved incident
- 4-hour SLA target for critical incidents

Intervention triggers: see [`CUSTOMER_SUCCESS_AND_ADOPTION.md`](CUSTOMER_SUCCESS_AND_ADOPTION.md)

---

## Domain 7 — Cost & Performance

**Goal:** AI routing and replay compute costs grow sub-linearly with tenant count.

Tracked cost surfaces:
- AI routing cost per recommendation
- Replay compute cost per session
- Graph traversal cost per query
- Export generation cost per export
- Telemetry storage cost per metric/day

Operations:
- Monthly cost efficiency review against per-tenant baselines
- Quarterly AI provider routing analysis
- Replay optimization review when latency drift is `moderate` or worse

Rule: cost optimization cannot weaken governance or replay integrity.

Reference: [`COST_AND_PERFORMANCE_EFFICIENCY.md`](COST_AND_PERFORMANCE_EFFICIENCY.md)

---

## Domain 8 — Complexity Governance

**Goal:** Complexity growth stays ≤ 10% per cycle. No subsystem coupling regressions.

Key operations:
- Monthly `recordComplexityTrend()` per environment
- `getComplexityTrends()` reviewed before any new proposals
- `isOverLimit` → freeze new evolution proposals pending council review
- Replay surface impact tracked for all approved proposals
- Quarterly dependency audit

Rule: `COMPLEXITY_GROWTH_LIMIT_PCT = 0.10`. Exceeding this blocks new proposals.

Reference: [`PLATFORM_EVOLUTION_GOVERNANCE.md`](PLATFORM_EVOLUTION_GOVERNANCE.md)

---

## Domain 9 — Industry Expansion

**Goal:** Each new vertical has a certified playbook before tenant deployment.

Key operations:
- `computePlaybookReadiness()` before any vertical goes to production
- All templates validated: `replayCompatible AND governanceValidated`
- Compliance framework registration for regulated verticals
- Vertical-specific deployment testing in staging

Supported verticals: water/wastewater, manufacturing, facilities, utilities, energy, industrial operations, infrastructure

Reference: [`INDUSTRY_EXPANSION_PROGRAM.md`](INDUSTRY_EXPANSION_PROGRAM.md)

---

## Domain 10 — Long-Term Platform Evolution

**Goal:** Every platform change is intentional, reviewed, and complexity-budgeted.

Key operations:
- Quarterly Platform Evolution Council review
- All `governanceRisk: 'high'` proposals require named approver before any work begins
- `requiresCouncilApproval()` evaluated for every proposal before sprint planning
- Quarterly complexity trend review across all environments
- Annual architecture health assessment

Prohibited: uncontrolled subsystem expansion, opaque AI automation, governance shortcuts, replay compromises, ecosystem trust erosion.

Reference: [`PLATFORM_EVOLUTION_GOVERNANCE.md`](PLATFORM_EVOLUTION_GOVERNANCE.md)

---

## Required Operational Artifacts

Maintained on the cadence indicated:

| Artifact | Cadence | Template |
|---------|---------|---------|
| Governance Stability Report | Weekly | [`GOVERNANCE_DURABILITY_PROGRAM.md`](GOVERNANCE_DURABILITY_PROGRAM.md) |
| Replay Integrity Report | Weekly | [`REPLAY_INTEGRITY_AUDIT.md`](REPLAY_INTEGRITY_AUDIT.md) |
| Ecosystem Trust Review | Weekly | [`ECOSYSTEM_TRUST_AND_MODERATION.md`](ECOSYSTEM_TRUST_AND_MODERATION.md) |
| Operational Maturity Dashboard | Weekly | [`CUSTOMER_SUCCESS_AND_ADOPTION.md`](CUSTOMER_SUCCESS_AND_ADOPTION.md) |
| Deployment Reliability Report | Per-wave | [`DEPLOYMENT_RELIABILITY_REFINEMENT.md`](DEPLOYMENT_RELIABILITY_REFINEMENT.md) |
| Customer Success Metrics | Monthly | [`CUSTOMER_SUCCESS_AND_ADOPTION.md`](CUSTOMER_SUCCESS_AND_ADOPTION.md) |
| Complexity Budget Report | Monthly | [`PLATFORM_EVOLUTION_GOVERNANCE.md`](PLATFORM_EVOLUTION_GOVERNANCE.md) |
| Support Operations Review | Monthly | [`SUPPORT_EXCELLENCE_OPERATIONS.md`](SUPPORT_EXCELLENCE_OPERATIONS.md) |
| AI Cost Efficiency Report | Monthly | [`COST_AND_PERFORMANCE_EFFICIENCY.md`](COST_AND_PERFORMANCE_EFFICIENCY.md) |
| Ecosystem Moderation Audit | Quarterly | [`ECOSYSTEM_TRUST_AND_MODERATION.md`](ECOSYSTEM_TRUST_AND_MODERATION.md) |
| Quarterly Maturity Review | Quarterly | [`QUARTERLY_MATURITY_REVIEW_TEMPLATE.md`](QUARTERLY_MATURITY_REVIEW_TEMPLATE.md) |

---

## Operational Scripts

| Script | Purpose | Run |
|--------|---------|-----|
| `scripts/ops-health-snapshot.ts` | Full platform health summary across all domains | `tsx scripts/ops-health-snapshot.ts` |
| `scripts/ops-governance-check.ts` | Governance durability + replay drift status | `tsx scripts/ops-governance-check.ts` |

---

## Success Criteria

The stewardship program is working when:

- Customer deployments succeed at ≥ 80% wave success rate
- Governance pass rate stays ≥ 98% across all dimensions
- Replay integrity has zero open drift alerts for > 30 days
- Ecosystem trust signal stays ≥ 0.75
- Tenant churn risk stays below 0.35 on average
- Complexity growth stays ≤ 10% per quarter
- SLA breach rate trends toward zero
- No governance bypasses in the release pipeline
- No cross-tenant leakage events

---

## Anti-Patterns to Prevent

| Anti-Pattern | Response |
|-------------|---------|
| "We'll fix governance after launch" | Block release; fix now |
| "Auto-approve low-risk plugins" | Denied; all plugins require human review |
| "Temporary replay bypass for speed" | No temporary bypasses; fix the replay issue |
| "This complexity increase is small" | Run `computeComplexityGrowthPct`; if > 10%, council review |
| "Tenant isolation check adds latency" | Accept the latency; isolation is non-negotiable |
| "We'll track that telemetry later" | Instrument now; blind spots compound |
