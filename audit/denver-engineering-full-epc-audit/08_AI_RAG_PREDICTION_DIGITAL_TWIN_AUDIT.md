# 08 — AI / RAG / Prediction / Digital Twin Audit

## AI Architecture Overview

```
Ask Jarvis (RAG)          → api/services/askBuilder.ts
Agent System              → api/services/agents/
AI Governance             → api/services/ai/aiGovernance.ts
Prediction Dashboard      → api/routes/predict.ts
Digital Twin              → api/routes/twin.ts
Adaptive Intelligence     → api/services/adaptive/
Monte Carlo Simulation    → api/routes/monteCarlo.ts
Federated Intelligence    → api/services/ecosystem/federatedIntelligenceEngine.ts
```

---

## Ask Jarvis (RAG)

**Frontend:** `src/components/AskJarvisView.tsx` ✅  
**Backend:** `api/routes/ask.ts`, `api/services/askBuilder.ts` ✅  
**Migration:** `023_chat_sessions.sql` ✅  
**Test:** `api/__tests__/askBuilder.test.ts` ✅

### Tenant Isolation
```typescript
// askBuilder.ts uses tenantTransaction — all DB ops scoped to tenant
return tenantTransaction(a.tenantId, async (client) => { ... })
```
Chat sessions stored with `tenant_id = current_setting('app.current_tenant_id',true)::uuid` ✅  
Vector retrieval filters by `tenant_id` via `tenantQuery` ✅

**Strength:** RAG pipeline is tenant-scoped at both retrieval and storage layers.

### Source Attribution
`askBuilder.ts` returns `structured_answer` with numbered source references:
```typescript
lines.push('# PRIOR FIXES (engineer-authored, tenant-owned)')
// sources numbered and referenced in answer
```
Source attribution exists in the response structure ✅

### Prompt Injection Risk
- Question length limited to 4000 chars ✅
- `aiSanitizer.ts` exists at `src/modules/utils/aiSanitizer.ts` — **frontend utility only**, not called in askBuilder.ts backend
- Raw user question interpolated into Anthropic API prompt — adversarial instructions possible
- Retrieval-level isolation prevents cross-tenant data exposure, but model could still be manipulated into ignoring its instructions
- **Risk P1:** No backend sanitization against prompt injection

### Hallucination Controls
- Answers grounded via RAG retrieval (sources provided)
- `top_k` parameter limits retrieved chunks
- No confidence score returned with answers
- No "I don't know" threshold — model answers even with low-relevance chunks
- **Risk P2:** No explicit "insufficient evidence" detection

---

## Agent System (Ava)

**Backend Services:**
- `api/services/agents/agentOrchestrator.ts` — multi-agent orchestration
- `api/services/agents/agentRegistry.ts` — registered agents catalog
- `api/services/agents/agentTaskQueue.ts` — task queue
- `api/services/agents/agentExecutionLedger.ts` — execution audit trail
- `api/services/agents/agentMemoryService.ts` — per-agent memory store
- `api/services/agents/agentGovernanceService.ts` — governance hooks
- `api/services/agents/agentHandoffService.ts` — agent-to-agent handoff

**Routes:**
- `/api/v1/agents` — list, orchestrate
- `/api/v1/agents/approvals` — human approval queue
- `/api/v1/agents/memory` — agent memory inspection
- `/api/v1/agents/risk` — risk assessment agent
- `/api/v1/agents/readiness` — readiness agent

**Strengths:**
- Human approval queue before agent execution ✅
- Agent execution ledger (audit trail) ✅
- Memory isolation per agent ✅
- Agent governance service ✅

**Risks:**
- Agent memory isolation between tenants not independently verified — `agentMemoryService.ts` must use `tenantQuery` (**P1**)
- Agent-to-agent handoff — if agents can spawn sub-agents, resource exhaustion possible (**P2**)
- No agent budget/cost cap per run (**P2**)

---

## AI Governance

**Backend:** `api/routes/aiGovernance.ts`, `api/services/ai/aiGovernance.ts` ✅  
**Migration:** `041_ai_governance.sql` ✅  
**RLS:** ✅ (migration 041)

**Capabilities:**
- AI recommendation queue with human approval gates ✅
- Recommendation expiry (stale recommendations expired) ✅
- Approve/reject/execute workflow ✅
- Governance logs ✅

**Gaps:**
- AI cost tracking per recommendation not confirmed
- No model routing based on task complexity (all calls go to single model)
- No fallback model configuration if primary model is unavailable

---

## Prediction Dashboard

**Frontend:** `src/components/predict/PredictView.tsx` ✅  
**Backend:** `api/routes/predict.ts` ✅  
**Migration:** Likely `047_adaptive_intelligence.sql`

**Assessment:** Prediction dashboard shows ML-based forecasts for project outcomes (cost, schedule).

**Gaps:**
- Prediction confidence scores — not confirmed in response schema
- Model retraining pipeline not visible
- Prediction explainability not confirmed
- No prediction accuracy tracking (though `forecastAccuracyTracker.ts` exists in adaptive services)

---

## Digital Twin

**Frontend:** `src/components/TwinOperationsMap.tsx` ✅  
**Backend:** `api/routes/twin.ts` ✅  
**Migration:** `046_digital_twin.sql` (file exists in migration 046 directory, not in root `migrations/` folder — **GAP**)  
**Services:** None found for `046_digital_twin.sql` migration reference

**Critical Finding:** Migration `046_digital_twin.sql` is NOT in `api/db/migrations/` directory. The file list shows `045_agent_system.sql` → `047_adaptive_intelligence.sql` (skipping 046). This means the digital twin DB schema may not be applied. **P1**

**Gaps:**
- Physical twin anomaly detection evidence not confirmed
- Real sensor → digital twin data binding not confirmed (IoT module exists separately)
- Simulation reproducibility not confirmed
- `web-ifc` BIM element linkage to twin entities not confirmed

---

## Monte Carlo Risk Simulation

**Backend:** `api/routes/monteCarlo.ts`, `api/services/` (Monte Carlo service)  
**Migration:** `051_geo_links_montecarlo_transmittals.sql` ✅

**Assessment:**
- Monte Carlo simulation exists for risk/schedule analysis
- Connected to risk register

**Gaps:**
- Simulation reproducibility — random seed handling not confirmed
- Confidence interval outputs (P10/P50/P90) not confirmed
- Iteration count limits not confirmed (infinite simulation possible)

---

## Adaptive Intelligence

**Backend Services:** 12 adaptive intelligence service files  
- `adaptiveAnomalyEngine.ts`
- `forecastAccuracyTracker.ts`
- `forecastCalibrationEngine.ts`
- `learningLoopEngine.ts`
- `operationalMemoryEngine.ts`
- `recommendationFeedbackTracker.ts`
- `recommendationRankingEngine.ts`
- `resourceOptimizationEngine.ts`
- `rootCauseSynthesisEngine.ts`
- `simulationLearningService.ts`

**Assessment:** Extensive adaptive intelligence framework. However, without live data, it's impossible to assess whether these services are properly integrated or are scaffolding-only.

---

## Federated Intelligence (CRITICAL — P0 SECURITY)

**Backend:** `api/services/ecosystem/federatedIntelligenceEngine.ts`  
**Test File:** `src/__tests__/modules/actions-phase9c.test.ts`

### Failing Tests (P0 SECURITY FINDING)
```
× _anonymize strips tenant_id
  Expected value: 42
  Received value: 29.31  (random noise added)

× anonymization removes all identifying fields
  Expected value: 42
  Received value: 45.86  (random noise added)
```

**Analysis:** The `_anonymize()` function in `federatedIntelligenceEngine.ts` adds Laplacian/Gaussian noise to numeric values rather than stripping identifying data. This means:
1. `tenant_id` field should be removed — NOT confirmed removed
2. Numeric values should remain intact — instead, noise is added (42 → 29.31)
3. An attacker with access to multiple federated contributions could potentially fingerprint which tenant contributed specific data via the noise pattern

**This is a P0 security bug.** Federated data contribution is intended to share anonymized patterns across tenants. If the anonymization is broken, cross-tenant data correlation attacks are possible.

---

## Risk Summary

| Module | Finding | Severity |
|---|---|---|
| Federated Anonymization | Adds noise instead of stripping data — tests fail | P0 |
| Digital Twin | Migration 046 missing from migrations/ directory | P1 |
| Agent Memory | Tenant isolation not independently verified | P1 |
| RAG | No backend prompt injection sanitization | P1 |
| AI Governance | No model fallback configuration | P2 |
| Prediction | No confidence scores in API response | P2 |
| Monte Carlo | Simulation reproducibility not confirmed | P2 |
| RAG | No "insufficient evidence" detection | P2 |
| Agents | No per-agent cost cap | P2 |
