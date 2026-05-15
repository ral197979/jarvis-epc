# GO / NO-GO Decision
**Denver Engineering / Ava Platform — v13.0.0**
**Audit Date:** 2026-05-12

---

## ⚠️ DECISION: GO WITH RESTRICTIONS

---

## Rationale

The platform is structurally sound. 83/100 composite score. The data layer (PostgreSQL RLS, Laplace DP, audit chain hash, replay integrity) is well-engineered. The CI engine, EVM module, IoT ingest, and schedule import are all production-ready.

**One blocker:** The Ava Phase 5 agent routes accept client-supplied `tenantId` without authentication. This is a P0 tenant isolation bypass — any caller with a valid tenant UUID can read agent data cross-tenant. This cannot be in production with real tenant data.

---

## Restrictions

### Before go-live with new tenants or expanded user access:
1. **Fix TENANT-001** — Add `requireAuth + requireTenant` to agents/approvals/memory/risk routes (~30 min)
2. **Fix TENANT-002** — Add auth to twin/scenarios/optimization routes in server.ts (~20 min)

### Within Sprint 1 post-launch:
3. Fix TENANT-003 (RLS backfill migration for 3 tables)
4. Fix DP-001 (k≥5 anonymity gate on federated aggregation)
5. Add rate limiting to agent orchestration routes

### Within 60 days:
6. Token expiry for IoT ingest tokens
7. Structured logging for 4 silent catches
8. Migrate pool.query in ops/readiness/sync/evidence to tenantQuery

---

## Cleared For Production (No Blockers)

| Module | Version | Status |
|--------|---------|--------|
| Core EPC (projects, RFIs, submittals, drawings, BIM) | v4.x | ✅ GO |
| CRM | v4.x | ✅ GO |
| Commissioning packs | v4.x | ✅ GO |
| Knowledge base / RAG | v4.x | ✅ GO |
| Action Center + SLA | v4.x | ✅ GO |
| EVM dashboard | v10.3.0 | ✅ GO |
| Schedule import (P6/MSP) | v10.4.0 | ✅ GO |
| IoT sensor ingest | v10.5.0 | ✅ GO |
| APS 3D Viewer | v10.2.0 | ✅ GO (APS credentials required) |
| Audit verification | v4.x | ✅ GO |
| Federated intelligence (DP) | v4.x | ✅ GO with DP-001 caveat |

| Module | Version | Status |
|--------|---------|--------|
| Multi-agent orchestration | v5.0.0 | 🔴 BLOCKED by TENANT-001 |
| Agent approvals queue | v5.0.0 | 🔴 BLOCKED by TENANT-001 |
| Digital twins | v6.0.0 | 🟡 RESTRICTED (non-functional until TENANT-002 fixed) |
| Scenario simulation | v6.0.0 | 🟡 RESTRICTED (non-functional until TENANT-002 fixed) |
| Resource optimization | v7.0.0 | 🟡 RESTRICTED (non-functional until TENANT-002 fixed) |

---

## Estimated Fix Time for Blockers

| Issue | Effort | Owner |
|-------|--------|-------|
| TENANT-001: Add auth to 4 agent routes | ~45 min | Engineering |
| TENANT-002: Add auth at 3 server.ts mounts | ~20 min | Engineering |
| **Total** | **~65 min** | |

Once TENANT-001 and TENANT-002 are resolved, this platform is **GO** for production with real tenant data.

---

## Confidence Scores

| Dimension | Confidence | Notes |
|-----------|-----------|-------|
| Tenant isolation | 72% | P0 blocker exists on agent routes |
| Data layer security | 91% | Strong RLS + DP |
| Governance integrity | 88% | Chain hash + canAutoApprove solid |
| Replay integrity | 90% | Auditor + regression monitor in place |
| Operational maturity | 80% | Workers, health, rate limits mostly covered |
| Ecosystem trust | 92% | DP correct, k-anonymity gap only |
| **Deployment confidence** | **85%** | GO after ~65 min of fixes |
