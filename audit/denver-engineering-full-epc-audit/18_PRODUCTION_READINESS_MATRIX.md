# 18 — Production Readiness Matrix

## Overall Score: 61/100 — CONDITIONAL GO

---

## Dimension Scores

| Dimension | Score | Status |
|---|---|---|
| Auth & Security | 72/100 | ⚠️ PARTIAL |
| Multi-Tenancy | 68/100 | ⚠️ PARTIAL |
| Frontend / UX | 70/100 | ⚠️ PARTIAL |
| Backend API | 75/100 | ⚠️ PARTIAL |
| Database & RLS | 65/100 | ⚠️ PARTIAL |
| EPC Business Logic | 80/100 | ✅ READY |
| AI / RAG | 60/100 | ⚠️ PARTIAL |
| Testing | 45/100 | ❌ NOT READY |
| CI/CD | 35/100 | ❌ NOT READY |
| Deployment | 25/100 | ❌ NOT READY |
| Monitoring | 40/100 | ❌ NOT READY |
| Field / Mobile | 50/100 | ⚠️ PARTIAL |

---

## Detailed Readiness Checks

### Authentication & Authorization

| Check | Status | Evidence |
|---|---|---|
| JWT implementation | ✅ PASS | httpOnly cookies, 15min TTL, SameSite=strict |
| Password hashing | ✅ PASS | bcrypt ^6.0.0 |
| Refresh token revocation | ⚠️ WARN | Redis not provisioned in production |
| requireAuth on all routes | ✅ PASS | Applied at server or router level |
| requireTenant on all routes | ✅ PASS | Applied consistently |
| Admin RBAC | ✅ PASS | role check on admin endpoints |
| Financial data RBAC | ❌ FAIL | viewer role reads financial data |
| Token rotation | ⚠️ UNVERIFIED | Not confirmed |
| CSP | ❌ FAIL | Disabled in Helmet |
| Rate limiting | ✅ PASS | globalLimiter, authLimiter, aiLimiter |

### Multi-Tenancy

| Check | Status | Evidence |
|---|---|---|
| App-layer isolation | ✅ PASS | tenantQuery/tenantTransaction wrappers |
| RLS on core tables | ✅ PASS | projects, vendors, RFIs, etc. |
| RLS on financial tables | ❌ FAIL | change_orders, timesheets, cost_entries not confirmed |
| RLS on communication tables | ❌ FAIL | notifications, meetings not confirmed |
| Tenant cache security | ✅ PASS | 60s TTL with eviction |
| Cross-tenant data isolation | ✅ PASS | tenantQuery sets session variable |
| Federated anonymization | ❌ FAIL | Tests prove data is not properly anonymized |

### EPC Business Logic

| Check | Status | Evidence |
|---|---|---|
| EVM formulas (ANSI/EIA-748) | ✅ PASS | CPI, SPI, EAC, ETC, VAC, TCPI all correct |
| CPM scheduling | ✅ PASS | Forward/backward pass, cycle detection |
| Schedule import (P6 XER) | ✅ PASS | fast-xml-parser, custom XER parser |
| Change order workflow | ⚠️ PARTIAL | Status transitions not server-enforced confirmed |
| Risk register | ✅ PASS | Full CRUD, Monte Carlo integration |
| Submittal workflow | ⚠️ PARTIAL | Status transitions need verification |
| BIM/IFC parsing | ⚠️ PARTIAL | web-ifc pre-release, no size limit |
| Monte Carlo simulation | ⚠️ PARTIAL | Exists, reproducibility not confirmed |

### AI / RAG

| Check | Status | Evidence |
|---|---|---|
| Tenant-scoped retrieval | ✅ PASS | tenantQuery on vector search |
| Source attribution | ✅ PASS | Numbered sources in response |
| Human approval gate | ✅ PASS | AI governance queue |
| Prompt injection protection | ❌ FAIL | No backend sanitization |
| Federated anonymization | ❌ FAIL | Broken — adds noise, doesn't strip |
| Agent memory isolation | ⚠️ UNVERIFIED | Must verify tenantQuery use |
| Cost tracking | ✅ PASS | aiCostTracker service |
| Model fallback | ❌ FAIL | No fallback configured |

### Testing

| Check | Status | Evidence |
|---|---|---|
| TypeScript: 0 errors | ✅ PASS | `npm run typecheck` |
| Unit tests passing | ❌ FAIL | 28 failures in 15 files |
| E2E tests passing | ⚠️ UNVERIFIED | Playwright configured, not run |
| Backend routes tested | ⚠️ PARTIAL | Core routes have tests; finance routes don't |
| Test coverage | ⚠️ PARTIAL | No coverage data available |

### CI/CD & Deployment

| Check | Status | Evidence |
|---|---|---|
| Production build succeeds | ✅ PASS | `npm run build` passes |
| Tests gate deployment | ❌ FAIL | buildCommand doesn't run tests |
| Lint gate deployment | ❌ FAIL | lint not in ci script |
| Render plan adequate | ❌ FAIL | free tier sleeps |
| Database adequate | ❌ FAIL | basic-256mb too small |
| Redis provisioned | ❌ FAIL | Not in render.yaml |
| All env vars set | ❌ FAIL | ANTHROPIC_API_KEY, ALLOWED_ORIGINS missing |
| Health check | ✅ PASS | /api/v1/health with DB check |
| Graceful shutdown | ✅ PASS | SIGTERM/SIGINT handlers |
| Auto-deploy with gate | ❌ FAIL | autoDeploy without test validation |

### Observability

| Check | Status | Evidence |
|---|---|---|
| Structured logging | ✅ PASS | Pino with slog utility |
| Request logging | ✅ PASS | All requests logged |
| Error logging | ✅ PASS | Errors captured |
| External APM | ❌ FAIL | No Datadog/Sentry/New Relic |
| Alerting | ❌ FAIL | No alerting configured |
| Distributed tracing | ❌ FAIL | No trace IDs |
| Audit log integrity | ⚠️ PARTIAL | Hash chain exists, not automated |
| Health endpoint | ✅ PASS | /api/v1/health |

---

## RBAC Permission Matrix

| Role | Read Financial | Write Financial | Admin Functions | Agent Execute | Delete Data |
|---|---|---|---|---|---|
| owner | ✅ | ✅ | ✅ | ✅ | ✅ |
| admin | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| project_manager | ✅ | ✅ | ❌ | ❌ | ❌ |
| engineer | ✅ | ⚠️ | ❌ | ❌ | ❌ |
| viewer | ✅ | ❌ | ❌ | ❌ | ❌ |

**Gap:** `viewer` can read financial data (EVM, cost control, change orders). Enterprise clients expect financial data to be restricted by role.

---

## Database/RLS Matrix

| Table Group | RLS Enabled | Verified |
|---|---|---|
| Core EPC (projects, vendors, rfis, submittals) | ✅ | Migration 002 |
| PM Modules (drawings, budgets, daily_logs) | ✅ | Migration 007 |
| EVM (baselines, actuals, progress) | ✅ | Migration 053 |
| Risk Register | ✅ | Migration 067 |
| AI Governance | ✅ | Migration 041 |
| Runbooks | ✅ | Migration 040 |
| BIM Estimating | ✅ | Migration 050 |
| Field Sync | ✅ | Migration 013 |
| Agent Actions | ✅ | Migration 017 |
| Change Orders | ❌ | Migration 058 unconfirmed |
| Subcontracts | ❌ | Migration 059 unconfirmed |
| Meetings | ❌ | Migration 060 unconfirmed |
| Cost Entries | ❌ | Migration 061 unconfirmed |
| Proposals | ❌ | Migration 062 unconfirmed |
| Team | ❌ | Migration 063 unconfirmed |
| Notifications | ❌ | Migration 064 unconfirmed |
| Timesheets | ❌ | Migration 065 unconfirmed |

---

## AI Governance Matrix

| Control | Status |
|---|---|
| Human approval gate | ✅ |
| Tenant-scoped RAG | ✅ |
| AI cost tracking | ✅ |
| Source attribution | ✅ |
| Agent execution ledger | ✅ |
| Federated anonymization | ❌ BROKEN |
| Prompt injection guard | ❌ MISSING |
| Model fallback | ❌ MISSING |
| AI budget hard limits | ❌ MISSING |
| Confidence scores | ❌ MISSING |
