# 01 — Repository Structure Audit

## What Exists

### Root Layout
```
denver-engineering/
├── api/                    ← Node.js/Express backend
│   ├── __tests__/          ← 23 test files (backend unit tests)
│   ├── db/
│   │   ├── migrate.ts      ← Migration runner
│   │   ├── migrations/     ← 69 SQL migration files (001–069, gap at 020)
│   │   └── pool.ts         ← pg Pool + tenantQuery/tenantTransaction wrappers
│   ├── files/storage.ts    ← File storage abstraction (local/S3)
│   ├── lib/logger.ts       ← Pino structured logger
│   ├── middleware/         ← auth, tenant, validateUuidParams
│   ├── realtime/           ← WebSocket gateway + event broadcaster
│   ├── routes/             ← ~75 Express routers
│   ├── scripts/            ← ingest-directory.ts
│   ├── services/           ← ~120 service files across 15+ domains
│   ├── auth.ts             ← JWT + bcrypt auth module
│   └── server.ts           ← Express app entry point (~450 lines)
├── src/                    ← React 18 SPA frontend
│   ├── __tests__/          ← 40+ test files (frontend + service unit tests)
│   ├── components/         ← ~130 view/component files
│   ├── config/             ← navigation.ts, systemPrompt.ts, defaultState.ts
│   ├── constants/          ← mcpTools.ts
│   ├── hooks/              ← useJarvis.ts
│   ├── jarvis/             ← JarvisCore.jsx (main app shell)
│   ├── modules/            ← auth, biz, commissioning, gateway, store, theme, utils
│   ├── styles/             ← index.css, tokens.css, utilities.css
│   └── utils/csv.ts
├── docs/                   ← 179 documentation files
├── e2e/                    ← Playwright E2E tests
├── public/                 ← Static assets + tool HTML files
├── scripts/                ← ops-health-snapshot.ts, ops-governance-check.ts
├── Jarvis_EPC/             ← Excel competitive analysis
├── audit/                  ← Prior audit artifacts
├── CHANGELOG.md            ← Detailed version history
├── COMPONENT_MAP.md        ← Frontend component registry
├── render.yaml             ← Render.com deployment config
├── docker-compose.yml      ← Docker dev stack (postgres + redis + api + frontend)
├── Dockerfile.api          ← API container
├── Dockerfile.frontend     ← Frontend nginx container
└── package.json            ← Monorepo (one package.json for both)
```

---

## Migration Sequence Analysis

| Range | Status |
|---|---|
| 001–019 | ✅ Present |
| 020 | ❌ MISSING — gap in sequence |
| 021–069 | ✅ Present |

**Risk Level: P1** — The migration runner (`api/db/migrate.ts`) applies files in sorted filename order. A gap at 020 may indicate a deleted migration whose SQL changes are now orphaned, or an intentionally skipped migration. This must be documented or the gap filled.

---

## Route Count

**Backend API routes:** ~75 Express routers mounted in `api/server.ts`  
**Frontend views:** 43 navigation items, 47 entries in `TAB_MAP` (ContentRouter)

### Navigation vs TAB_MAP Discrepancy

Items in `NAVIGATION_ITEMS` (navigation.ts) but NOT in `TAB_MAP`:
- `safety` — in TAB_MAP as `SafetyView` ✅ (navigation uses `construction` domain)

Items in `TAB_MAP` but NOT in `NAVIGATION_ITEMS`:
- `safety`, `engineering`, `system`, `plan`, `resources`, `jobs`, `overview` — internal/admin routes

**Finding:** `integrations` nav item resolves to `ComingSoonView` stub (P1). All other nav items have real implementations.

---

## Package Dependencies

**Notable dependencies:**
- `@anthropic-ai/sdk ^0.32.1` — Claude AI SDK
- `web-ifc ^0.0.77` — IFC/BIM parsing (alpha-quality version)
- `pdf-parse ^1.1.1` — PDF extraction
- `ws ^8.18.0` — WebSocket (realtime)
- `multer ^2.1.1` — File uploads
- `bcrypt ^6.0.0` — Password hashing
- `pino ^10.3.1` — Structured logging
- `express-rate-limit ^8.2.1` — Rate limiting
- `helmet ^8.1.0` — Security headers
- `recharts ^2.12.7` — Charts

**Missing from package.json / Concern:**
- No `pgvector` — vector embeddings may use TEXT column with manual cosine similarity (see migration 025)
- No `redis` client — token store uses Redis but no `ioredis`/`redis` in deps (likely conditional import or missing)
- `web-ifc ^0.0.77` is pre-1.0 and actively changes APIs

---

## Code Metrics

| Metric | Value |
|---|---|
| Total source files (excl. node_modules) | ~500+ |
| API routes files | 75 |
| API service files | 120+ |
| Frontend component files | 130+ |
| DB migration files | 69 (001–019, 021–069) |
| Test files (total) | 63 |
| Test cases (total) | 4,450 |
| Passing tests | 4,422 |
| Failing tests | 28 |

---

## Documentation

- `README.md` — Present, covers setup
- `CHANGELOG.md` — Comprehensive version history
- `COMPONENT_MAP.md` — Frontend component registry
- `EXTRACTION_ROADMAP.md` — Modularization roadmap
- `INTEGRATION_GUIDE_v4.28.md` / `v4.29.md` — Integration docs
- `PHASE_19_MIGRATION.md` — Phase 19 migration notes
- `REMEDIATION_ROADMAP.md` — Remediation tracking
- `docs/` — 179 files (likely feature specs/designs)

**Missing:**
- No `ARCHITECTURE.md` explaining the overall system design
- No runbook for production operations
- No data dictionary for DB schema
- No API reference (OpenAPI/Swagger spec absent)

---

## Risk Summary

| Finding | Severity |
|---|---|
| Migration gap at 020 | P1 |
| `integrations` nav is ComingSoonView | P1 |
| `web-ifc ^0.0.77` pre-release dependency | P2 |
| No OpenAPI spec | P2 |
| No pgvector in deps (may use manual cosine) | P2 |
| Redis dependency not in package.json | P2 |
| Missing Architecture doc | P3 |
