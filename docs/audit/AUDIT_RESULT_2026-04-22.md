# Denver Engineering — Audit Result
**Repo:** `denver-engineering-v4.30.0` · **Date:** 2026-04-22 · **Auditor:** Claude (playbook-driven)
**Target identity confirmed:** `package.json` → `"name":"denver-engineering","version":"4.30.0"`; `api/server.ts` logs `service:'denver-engineering-api', version:'4.30.0'`.

> Evidence labels used below: **Observed** (read in the code), **Reproduced** (ran and saw it), **Likely** (inferred), **Unknown** (blocked or unverified).

---

## 1. Executive Summary

**Verdict: CONDITIONAL GO — demo-safe only. Not pilot-ready, not field-ready, not production-ready.**

Denver Engineering is a **substantially real application** with genuine multi-tenant architecture, PostgreSQL + Row Level Security, JWT auth with refresh rotation, a thoughtful grounded-RAG pipeline, 25 real migrations, and ~13k lines of backend route/service code. It is *not* a Potemkin village. The build passes, TypeScript passes strict, the production bundle compiles, and the commissioning pack worker is a real async job system backed by PostgreSQL `FOR UPDATE SKIP LOCKED`.

**But three truth problems make it unsafe for real project delivery today:**

1. **The commissioning workflow the user actually sees is not persisted.** `CxWorkflowView.tsx` — the Scope → Matrix → Packs → Execute → Deficiencies → Turnover UI — openly declares "Zero API calls. Pure client-side commissioning engine." It writes to client-side Zustand (localStorage). Meanwhile the backend `commissioning_packs` / `generation_jobs` tables are driven only by a separate `/generate-draft` surface. A commissioning manager running a real pack on a real project will lose it on browser clear.
2. **The test suite claimed "green" in the v4.31.0 CHANGELOG is not green.** Running `npm test -- --run` **reproduced 1,037 failing tests / 4,791 passing (49 test files failed / 123 passed)**. The regression signal the team believes they have does not exist in the current tree.
3. **There is no CI pipeline.** `.github/workflows/` contains only `render-deploy.yml` (deploy trigger). The README badge points to a non-existent `ci.yml`. Lint is currently broken (157 parser errors — missing `@typescript-eslint/parser` wiring). The `ci` npm script exists but runs nowhere.

**Secondary structural gap:** the data model has **no systems / subsystems / tag-equipment register** as proper tables. The "commissioning pack" is generated from a `system_type` varchar and a synthetic asset built from the pack title — not from a real per-tag coverage matrix. This is the central EPC-realism gap the playbook specifically flags.

### Readiness levels
| Use case | Verdict | Why |
|---|---|---|
| **Demo to a prospect** | ✅ GO | Build is clean, UI is polished, many real flows work. Keep the demo away from "run this on my real project." |
| **Internal alpha / data-model rehearsal** | ⚠️ CONDITIONAL | Backend is real enough to validate schema shape — just don't trust generated packs as audit-ready yet. |
| **Pilot on a real project** | ❌ NO-GO | Commissioning workflow not persisted; test suite not a regression signal; CI not blocking PRs; no systems/tag hierarchy. |
| **Field use by technicians** | ❌ NO-GO | Field work flows through views that read from Zustand-only state; offline claims are not validated end-to-end. |
| **Production delivery / turnover** | ❌ NO-GO | No formal turnover dossier persistence, no document→tag→test traceability. |

### Strongest areas
- Multi-tenant architecture with PostgreSQL RLS + `app.current_tenant_id` context injection (**`api/db/pool.ts:104-127`**)
- JWT refresh rotation + account lockout after 5 failures + bcrypt with constant-time compare on unknown email (**`api/auth.ts:117-161`**)
- Grounded RAG with schema-forced tool_use and explicit "NEVER invent part numbers, torque specs, setpoints, or safety interlocks" in the system prompt (**`api/services/askBuilder.ts:170-179`**)
- Commissioning pack worker uses `FOR UPDATE SKIP LOCKED` + exponential backoff — legitimate async pattern (**`api/services/packWorker.ts:93-113`**)
- Agent-mode middleware with `auto` / `review_all` / `frozen` states + suppressed-action audit logging (**`api/middleware/agentMode.ts:53-122`**)

### Weakest areas
- Commissioning workflow persistence gap (see Executive Summary §1)
- No systems/subsystems/tag register tables (EPC hierarchy gap)
- Test suite unreliable (1,037 failures)
- No CI pipeline
- `_failJob` duplicate-column SQL bug (silent pack-worker failures)

### Top 5 Blockers (covered in §4)

### Recommended next phase
Execute the playbook's **Phase 0 — truth-finding**: get tests honestly green, stand up a real CI workflow, fix the pack worker SQL bug, and resolve the client-side-vs-backend commissioning persistence split **before** writing new features.

---

## 2. Architecture Snapshot

**Observed** from `package.json`, `docker-compose.yml`, `api/server.ts`, and migration files.

### Runtime shape
```
┌────────────────┐          ┌────────────────────────┐
│ React SPA      │  HTTPS   │ Express 5 API          │   tsx runtime
│ (Vite, port    │─────────▶│ port 3001              │   Node ≥18
│  5173 dev /    │          │ helmet + rate-limit    │
│  nginx :80     │          │ cookie-parser + CORS   │
│  prod)         │          │ pino structured logs   │
└────────────────┘          └─────────┬──────────────┘
       │                              │
       │ lazy-loaded views            │
       │ Zustand biz store ◄──────────┘ (some views bypass API)
       │ localStorage cache           │
       ▼                              ▼
 Browser state              ┌────────────────────┐       ┌────────────┐
                            │ PostgreSQL 16      │       │ Redis 7    │
                            │ 25 migrations      │       │ refresh    │
                            │ RLS on every       │       │ token      │
                            │ tenant table       │       │ revocation │
                            └────────────────────┘       └────────────┘
                            ▲                 ▲
                            │                 │
                ┌───────────┴──┐     ┌────────┴─────────┐
                │ packWorker   │     │ scheduler        │
                │ (in-process  │     │ + 7 job handlers │
                │  poll loop,  │     │ (webhooks,       │
                │  SKIP LOCKED)│     │  KPI, compliance,│
                └──────────────┘     │  knowledge, etc) │
                                     └──────────────────┘

  Storage: local filesystem (./uploads) or S3-compatible (toggle via STORAGE_BACKEND)
  Gateway: POST /api/v1/gateway proxies to api.anthropic.com with backend-held key
```

### Exact run path
From `package.json` + `.env.example`:
- Dev: `cp .env.example .env && npm install && npm run dev:full` → Vite on **:5173**, Express on **:3001**
- Prod: `docker compose up -d` (postgres, redis, api, frontend)
- Health: `GET /api/v1/health` → `{status, version, uptime, db, storage}`

### Dependency/version truth
- Node `>=18.0.0` (engines)
- React `^18.3.1`, Zustand `^5.0.11`, pg `^8.13.3`, pino `^10.3.1`, bcrypt `^6.0.0`
- Anthropic SDK `^0.32.1` (current; default model in `ASK_MODEL` env = `claude-sonnet-4-6`)
- TypeScript `^5.5.3`, vitest `^4.0.18`, eslint `^9.7.0`

### Setup blockers / risk summary
- **Observed**: `api/{db/{migrations,queries},routes,middleware,files,integrations}/` exists as an empty directory tree — a literal artifact of an un-brace-expanded `mkdir` command. Minor, worth cleaning.
- **Reproduced**: `npm run lint` fails with 157 parse errors — `eslint.config.js` does not wire `@typescript-eslint/parser` for `.ts` files.
- **Reproduced**: 9 npm audit vulnerabilities (7 high, 2 moderate): `undici` HTTP smuggling + `picomatch` ReDoS via transitive deps.
- **Observed**: `scripts/check-monolith-size.js` ratchet is 6,530; actual `JarvisCore.jsx` is 1,127 lines. Gate does not gate anything.
- **Observed**: `README.md` references `ci.yml` badge; no `ci.yml` workflow exists.

---

## 3. Scorecard

Scores 0–10. Weighted toward EPC truth per playbook §9.

| Area | Score | One-line justification |
|---|---:|---|
| Product architecture | 7 | Real multi-tier: Express + React + Postgres + Redis + pack worker + scheduler — not a stub. |
| Frontend UX | 6 | Polished visuals, 60+ extracted views, lazy-loaded router; but half of views call API, half don't — inconsistent. |
| Backend / API quality | 7 | 26 route modules, solid validation, pagination, RLS-correct queries; some duplicate-column SQL and missing input length caps. |
| Data model quality | 6 | Strong on projects/procurement/daily logs/drawings/audit; **no systems/subsystems/tag register** is a structural gap. |
| Auth & authorization | 7 | bcrypt + lockout + httpOnly cookies + refresh rotation + jti revocation in both DB and Redis; dev-secret fallback and SSL `rejectUnauthorized:false` drag it down. |
| Tenant / project isolation | 8 | Postgres RLS on every tenant table + `current_setting('app.current_tenant_id')` context via BEGIN/COMMIT per query — genuinely isolated. |
| Security hardening | 5 | Helmet + rate-limit + CSRF-safe cookies + redacted audit bodies — but 7 high npm vulns, broken lint, dev JWT fallback, token-path construction risks. |
| Document-control integrity | 5 | `documents` + `document_versions` + `drawings` + `drawing_revisions` exist and look right; not linked to tags/equipment — so revision-to-execution traceability is broken. |
| Engineering data traceability | 4 | No formal tag/equipment register; pack generation uses a synthetic asset from pack title. |
| Commissioning workflow completeness | 3 | The full UI (`CxWorkflowView`) is client-side-only per its own header comment; backend pack workflow is a separate, narrower `/generate-draft` path. |
| Test-pack generation quality | 5 | Template engine normalizes 20+ system types, produces Markdown + HTML; PDF is explicitly a stub (`pdfPath: null`). Output is template-driven, not tag-driven. |
| Turnover / dossier readiness | 3 | `CxTurnoverItem` exists only as a client-side type in Zustand; no turnover table in the DB. |
| Reliability / operational maturity | 5 | Pack worker's `_failJob` has a duplicate-column SQL UPDATE — failed jobs are never properly marked failed. Graceful shutdown is correctly wired. |
| Observability / logging | 7 | pino structured logs, request IDs, audit_log table, optional log drain, `X-Request-ID` response header. |
| Performance / scalability | 5 | Lazy-loaded views, FTS indexes, pool stats; but every `tenantQuery` runs BEGIN/COMMIT, and 715 KB recharts vendor chunk is heavy. |
| Testing depth | 3 | **Reproduced: 1,037 failing / 4,791 passing tests** — README claims ~1,800 passing, CHANGELOG claims 0 failing. Present-tense claims contradict. |
| Deployment readiness | 4 | Build works + Dockerfiles exist + Render deploy wired; but no CI gate and no smoke-test workflow. |
| Mobile / offline field readiness | 4 | `OfflineIndicator.tsx` + `offlineQueue` module exist; CxWorkflow persisting to localStorage makes it technically offline-tolerant but only locally. |
| AI safety / usefulness | 7 | Forced tool_use with schema, explicit no-invention rules, OEM-tier grounding; citations still self-reported by the model (no server-side match check). |
| Maintainability / code health | 5 | Real module extraction effort; but obfuscated single-letter variables in `JarvisCore.jsx`, 125 TODO/FIXME markers in `src/`, stale ratchet. |
| Documentation / handover readiness | 5 | CHANGELOG is detailed and current (v4.31.0 dated 2026-04-17); but README CI badge is false, monolith-comment is 5× stale, `ci.yml` is missing. |

**Overall weighted score: 5.3 / 10**
**Final verdict: CONDITIONAL GO (demo only).**

---

## 4. Top 5 Blockers

| # | Blocker | Severity | Evidence |
|---|---|---|---|
| 1 | **CxWorkflowView is client-side only** — the commissioning workflow the user sees does not persist to the backend | Critical | [CxWorkflowView.tsx:13](src/components/CxWorkflowView.tsx#L13) "Zero API calls. Pure client-side commissioning engine." Grep confirmed zero `fetch(` or `api/v1` refs. |
| 2 | **Test suite contradicts changelog** — 1,037 failing tests vs "0 failing" claim | Critical | Reproduced via `npm test -- --run`: `Test Files 49 failed \| 123 passed (172); Tests 1037 failed \| 4791 passed (5828)` |
| 3 | **No CI pipeline** — only a Render deploy trigger; README CI badge is false | Critical | `.github/workflows/` contains only `render-deploy.yml`. README badge points to `ci.yml` which does not exist. |
| 4 | **`_failJob` duplicate `status` column in SQL UPDATE** — pack jobs fail silently and are never marked failed | Critical | [packWorker.ts:256-271](api/services/packWorker.ts#L256) lists `status=$1` and `status=$3` in the same `SET` — PostgreSQL rejects this, `_failJob` itself throws, failure swallowed by outer `.catch`. |
| 5 | **No systems/subsystems/tag-equipment register** — breaks EPC hierarchy realism | High | None of migrations 001–025 create `systems`, `subsystems`, `tags`, or `equipment` tables. Pack worker calls `_syntheticAsset()` ([templateEngine.ts:114](api/services/templateEngine.ts#L114)) to fabricate a `CxAsset` per pack request. |

---

## 5. Workflow Audit Matrix

Classification per playbook §B.2: **Present & works** · **Fragile** · **Partial/stubbed** · **Missing** · **Misleadingly represented**.

| # | Workflow | Status | Evidence |
|---|---|---|---|
| 1 | Sign in / sign out / session persistence | Present & works | `api/auth.ts` + `LoginScreen.tsx` — real bcrypt, cookie-based, rotation. |
| 2 | Project creation | Present & works | `projectsRouter` + `projects` table with phase/contract/budget columns. |
| 3 | System / subsystem setup | **Missing** | No DB tables for `systems`/`subsystems`; concept lives only as `system_type` varchar on commissioning_packs and `system_tag` varchar on wirs. |
| 4 | Tag / equipment register | **Missing** | No `tags`/`equipment` tables. `CxAsset` is a TypeScript type used client-side only. |
| 5 | Document upload / ingestion | Present & works | `POST /files/request-upload` + `PUT /upload/:token` + `/confirm/:versionId`; source uploads table + extracted text. |
| 6 | Drawing / spec parsing | Partial/stubbed | pdf-parse is a dep; `source_uploads.extracted_text` is populated but parser logic is elementary. |
| 7 | Classification / system mapping | Partial | `templateEngine.normaliseSystemType` maps strings to 20 asset types via keyword rules — not a learned classifier. |
| 8 | Commissioning matrix generation | Fragile | `generateMatrixRows` is real client-side logic, but results live in Zustand only. |
| 9 | Test-pack generation | Fragile | Backend worker real + queued; generated packs linked to synthetic asset, not actual tags. |
| 10 | Field execution / checklist completion | **Partial/misleading** | `CxWorkflowView` Execute tab persists to Zustand only — no backend execution record. |
| 11 | Attachment / evidence capture | Partial | `punch_items.photos` + `inspections.photos` + `daily_logs.photos` exist as JSONB; no verified end-to-end upload-to-evidence test. |
| 12 | Issue / punch / deficiency tracking | Present & works | `punch_lists`/`punch_items` tables with pin_x/pin_y, assignee, close workflow. |
| 13 | Status transitions | Fragile | Many `VARCHAR(20)` "status" columns with no DB-level check constraints — easy to drift. |
| 14 | Dashboard / progress rollups | Fragile | `Dashboard.tsx` + `OverviewView` exist; rollup accuracy not end-to-end-tested. |
| 15 | Turnover package generation | **Missing** | No backend `turnover_packages` or `dossiers` table; `CxTurnoverItem` is client-only. |
| 16 | Dossier completeness | **Missing** | Same as 15. |
| 17 | Search / filtering / traceability | Partial | FTS + pg_trgm + knowledge_chunks exist; project→tag→test traceability broken by #3/#4. |
| 18 | AI assistant action boundaries | Present & works | agentMode middleware + `requireAgentMode(['auto'])` gate + `agent_actions` log + frozen state. |
| 19 | Mobile / responsive field usability | Unknown | `OfflineIndicator.tsx` exists; not field-validated by this audit. |
| 20 | Offline behavior | Partial | `offlineQueue` module + `fieldSync` route exist; concurrency/conflict resolution not assessed. |

---

## 6. Detailed Findings Register

Also included as `docs/audit/findings.csv`.

| ID | Severity | Title | Area | Evidence | Impact | Recommended fix | Effort | Priority |
|---|---|---|---|---|---|---|---|---|
| F01 | Critical | CxWorkflowView does not persist commissioning work | Frontend/Backend split | [CxWorkflowView.tsx:13](src/components/CxWorkflowView.tsx#L13) header comment + zero fetch refs | Commissioning manager's Scope/Matrix/Packs/Execute/Deficiencies/Turnover work is lost on browser-clear, invisible to team. | Route each CxWorkflow collection through `/api/v1/commissioning/*` routes; define missing endpoints for matrix/executions/deficiencies/turnover. | L | Now |
| F02 | Critical | Test suite: 1,037 failing / 4,791 passing | Testing | Reproduced via `npm test -- --run` (4791 passing / 1037 failing) | CHANGELOG claim "0 failing" is false; no regression signal possible. | Fix the React hooks null-useMemo setup path in vitest config, then triage failures. Mark `ci` script blocking in CI. | L | Now |
| F03 | Critical | No CI workflow | CI/CD | `.github/workflows/` contains only `render-deploy.yml`; README badge points to missing `ci.yml` | PRs merge with no lint/type/test/build gate; deploy happens on every push to main. | Add `.github/workflows/ci.yml` running `npm run ci`. Require passing before merge. | S | Now |
| F04 | Critical | packWorker `_failJob` duplicate SQL column | Backend reliability | [packWorker.ts:256-271](api/services/packWorker.ts#L256) — `SET status=$1, ..., status=$3, ...` | PostgreSQL rejects the UPDATE; `_failJob` throws; outer `.catch` swallows; jobs stuck in `running` until lock timeout reclaim; never marked `failed`. | Remove the duplicate `status` clause; write a test that exercises 3+ failed attempts and asserts terminal `status='failed'`. | S | Now |
| F05 | High | No systems/subsystems/tag-equipment register | Data model | Review of `api/db/migrations/001-025*.sql` — no such tables. | Pack generation keys off a `system_type` varchar + a synthetic asset — no tag-by-tag coverage matrix or traceability. | Add `systems`, `subsystems`, `equipment_tags` tables with tenant/project FKs; link `commissioning_packs.equipment_tag_id`; add a migration + admin seed for sample tag hierarchy. | L | Now |
| F06 | High | No backend turnover/dossier persistence | Data model | No `turnover_packages`/`dossiers` tables; `CxTurnoverItem` is a client-side TS type only. | Project handover deliverable cannot be produced or audited from the DB. | Add `turnover_packages` and `dossier_items` tables; wire them through `CxWorkflowView` Turnover tab. | M | Next |
| F07 | High | ESLint fails with 157 parsing errors | Code quality | Reproduced via `npm run lint` — "Parsing error: Unexpected token interface" on every `.ts` file | Lint claim in README is false; noUnused + consistent style are unenforced. | Wire `@typescript-eslint/parser` + `parserOptions.project` into `eslint.config.js`; add lint to CI. | S | Now |
| F08 | High | 7 high-severity npm vulnerabilities | Dependencies | `npm audit` reports undici CRLF injection + HTTP smuggling, picomatch ReDoS (6 advisories across these 2 packages), plus 2 moderate. | Untrusted upstream responses could crash server; ReDoS via crafted globs. | `npm audit fix` and re-run CI; pin transitives if non-breaking. | S | Now |
| F09 | High | Monolith-size ratchet at 6,530 for a 1,127-line file | Code health | [check-monolith-size.js:26](scripts/check-monolith-size.js#L26) `MAX_LINES = 6_530`; actual `JarvisCore.jsx` = 1,127 lines | Extraction progress is invisible to CI; any regression up to 5,400 lines would pass. | Lower ratchet to 1,150 (current + small buffer); add it to CI. | S | Now |
| F10 | High | Citations in RAG answer are self-reported by the model | AI safety | [askBuilder.ts:232-237](api/services/askBuilder.ts#L232) — `structured = toolUse.input as StructuredAnswer` with no post-validation | A compromised/misbehaving model could fabricate a `chunk_id` that didn't appear in `retrieved_chunks`; UI would show a "citation" with no real source. | Validate every `citations[].chunk_id` appears in `retrieved_chunks`; drop or flag unverified citations. | S | Next |
| F11 | Medium | DB SSL uses `rejectUnauthorized: false` | Security | [pool.ts:32,40](api/db/pool.ts#L32) | MITM risk for cloud-hosted DB traffic. | Set `rejectUnauthorized: true` when `DB_SSL=true`; ship CA bundle or rely on system store. | S | Next |
| F12 | Medium | Every tenantQuery wraps SELECT in BEGIN/COMMIT | Performance | [pool.ts:104-127](api/db/pool.ts#L104) | Per-request transaction overhead + connection churn; caps real throughput. | Use a `SET LOCAL` on the same connection without explicit BEGIN for read-only paths; or switch to `SET app.current_tenant_id = ...` via server-side session variables. | M | Next |
| F13 | Medium | Only global rate limits, no per-tenant | Security | [server.ts:156-162](api/server.ts#L156) | Noisy-neighbor / abuse risk: one tenant can exhaust AI limit for all. | Key rate limiter by `tenantId` (or tenant+IP); adjust `aiLimiter` to per-tenant. | S | Next |
| F14 | Medium | File download synchronous fs read | Performance/DoS | [files.ts:241-255](api/routes/files.ts#L241) uses `fs.existsSync` / `readFileSync` per download request | Event-loop blocking under concurrent downloads. | Replace with `fs.promises.access` + streaming read. | S | Next |
| F15 | Medium | CommissioningView reads closeouts/punch/lessons from Zustand only | Frontend truth | [CommissioningView.tsx:11-18](src/components/CommissioningView.tsx#L11) imports `selectPunchItems` from biz store only | Numbers shown do not reconcile with backend `punch_lists`/`punch_items`. | Reroute these selectors through backend API where backend tables exist (punch_lists, inspections); preserve Zustand as cache layer only. | M | Next |
| F16 | Medium | Dev-only JWT fallback string | Security | [auth.ts:40](api/auth.ts#L40) `'__dev-only-insecure-fallback__'` | If `NODE_ENV!==production` and `JWT_SECRET` is unset, tokens can be forged by anyone with source access. | Fail fast in non-production if `JWT_SECRET` unset — do not silently fall back. | S | Next |
| F17 | Medium | README CI badge points at non-existent workflow | Docs | [README.md:5](README.md#L5) badge URL `.../workflows/ci.yml/badge.svg` | Contributors/stakeholders believe there is CI; there isn't. | Either add `ci.yml` (F03) or remove the badge. | S | Now |
| F18 | Medium | `api/{db/{migrations,queries},...` literal glob directory exists | Cleanliness | `ls api/` shows `{db` as a real dir | Cosmetic / confusing; suggests a broken setup script shipped once. | `rm -rf` this tree; check shell scripts for `mkdir -p` without quoted glob. | S | Later |
| F19 | Medium | App.jsx comment says JarvisCore ~6,479 lines | Docs | [App.jsx:6-12](src/App.jsx#L6) vs actual 1,127 lines | Misleading about architectural state. | Update the comment or delete it — living comments should describe invariants, not snapshots. | S | Later |
| F20 | Medium | `http_fetch` MCP tool allowlist empty in dev | AI safety | `.env.example:110` — "Empty = open in dev" | Agent can fetch arbitrary URLs in a dev environment exposed to the internet. | Make empty allowlist mean **deny** in all envs; require explicit `*` for open. | S | Next |
| F21 | Medium | Pack `/download/:format` trusts stored path | Security | [commissioning.ts:403-418](api/routes/commissioning.ts#L403) reads `row.path` from DB and `fs.readFile`s directly | If an attacker can write to `commissioning_packs.markdown_path`, they can read files outside the cx-packs dir. Attack requires DB write, but belt-and-braces is cheap. | Validate path resolves inside `STORAGE_DIR` using `path.resolve` + prefix check. | S | Next |
| F22 | Medium | Folder creation doesn't verify parent belongs to same project | Security | [files.ts:376-401](api/routes/files.ts#L376) looks up `parent_id` without checking `project_id` match | Users can create folders under parents from other projects within the same tenant — cross-project folder pollution. | Add `AND project_id = $x OR project_id IS NULL` when looking up parent. | S | Next |
| F23 | Low | 125 TODO/FIXME markers in `src/` | Code health | Grep count | Backlog visibility; some are placeholders for real features. | Triage into an issues list; delete stale ones. | M | Later |
| F24 | Low | CHANGELOG references v4.32.0 features while package.json is v4.30.0 | Docs | `api/server.ts` imports `inspectionsRouter` / `punchListsRouter` labeled `// v4.32.0`; `package.json` version = 4.30.0 | Version labels are aspirational. | Reconcile at next release. | S | Later |
| F25 | Low | Minified single-letter variables in JarvisCore.jsx | Code health | [JarvisCore.jsx:79-84](src/jarvis/JarvisCore.jsx#L79) `useState as g`, `useEffect as ui`, etc. | Readability hostile for new contributors. | Rename to semantic aliases during next extraction pass. | M | Later |

CSV form available at `docs/audit/templates/findings.csv` (template) — copy this table into it as the live register.

---

## 7. Security Review

### Top risks
1. **Dependency CVEs (F08)** — 7 high-severity (`undici` HTTP smuggling / WebSocket overflow; `picomatch` ReDoS). Both are transitive; `npm audit fix` resolves per report.
2. **Self-reported RAG citations (F10)** — an LLM could manufacture chunk_ids and the UI would render them as authoritative.
3. **Dev JWT fallback (F16)** — any dev-mode server with exposed source has forgeable tokens.
4. **Path construction in file download (F21)** + **storage_path blind trust** — defense-in-depth missing against a future DB write-path attacker.
5. **`http_fetch` MCP tool (F20)** — open allowlist in dev.

### Exploitability
- **Network-accessible today:** F08 (undici CRLF/smuggling — reachable wherever the server fetches an external URL: AI gateway forward, `http_fetch`, webhook dispatch).
- **Requires auth + DB write:** F21, F22.
- **Requires code/infra access:** F16.

### Deployment blockers
- F04 (silent pack-worker failure) — **data-integrity blocker**, not strictly a security issue but ships broken state.
- F08 (high CVEs) — production cannot ship with untriaged high advisories.
- F03 (no CI) — nothing currently prevents a regression from reaching prod.

### Positives worth preserving
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on every tenant table with `current_setting('app.current_tenant_id')` policy.
- Audit log middleware redacts `password`/`token`/`secret`/`api_key` before writing `new_data` JSONB.
- JWT refresh rotation invalidates old jti in both DB and Redis.
- Backend-only Anthropic key; `VITE_ANTHROPIC_API_KEY` explicitly forbidden in `.env.example`.

---

## 8. Reliability / Ops Review

**Observed:**
- `initPool` health check on boot (exits in production on failure).
- Graceful `SIGTERM`/`SIGINT` handlers drain HTTP + pool.
- Pack worker uses `FOR UPDATE SKIP LOCKED` + exponential backoff (30s, 2m, 8m).
- Scheduler registers 7 job handlers (webhook, integration sync, KPI snapshot, compliance watcher, audit retention, knowledge ingest, fix extractor).
- pino structured logs + `X-Request-ID` header + slow-query warn at 500 ms.
- Per-tenant storage quota enforcement on upload.

**Gaps (biggest reliability gaps):**
- **F04**: `_failJob` duplicate-column SQL kills the pack worker's retry path.
- **No healthcheck on Redis or worker** — health endpoint reports only pool status.
- **No deadletter for failed scheduler jobs** — beyond max_attempts jobs go to `failed` but there's no alerting.
- **Build-time env assertion** only in `auth.ts` (JWT); DB/Redis secrets could boot to failure with minimal signal.
- **`fs.existsSync` / `readFileSync` in hot paths** (F14) — event-loop blocker under load.

**Scale posture (Likely):**
- PostgreSQL pool max 20 — will cap throughput well before disk.
- `tenantQuery` per-request BEGIN/COMMIT churn is the main cost (F12).
- 715 KB recharts vendor chunk — first-load JS is heavy but cacheable.
- Dashboard/aggregation queries not reviewed for N+1 — **Unknown**.

**Offline/field resilience:**
- `offlineQueue` module + `OfflineIndicator.tsx` exist; `fieldSync` route accepts batch replay.
- Conflict resolution and duplicate-submit protection **Unknown** — would require a field-replay rehearsal.

---

## 9. Deployment Readiness Verdict

### CONDITIONAL GO (demo) · NO-GO (pilot)

**Why CONDITIONAL GO for demo:**
- Build is clean, production bundle compiles, strict TS passes, the UI is polished, auth works, key flows (login, projects, procurement, file upload) are real.
- The architecture (multi-tenant + RLS + pack worker + scheduler + RAG) is meaningfully designed.

**Why NO-GO for pilot / field:**
- The commissioning workflow the user actually executes does not reach the backend (F01).
- The test suite is not a regression signal today (F02).
- There is no CI gate (F03).
- The pack worker silently loses failure state (F04).
- The data model lacks the tag/equipment hierarchy EPC commissioning needs (F05) and lacks turnover/dossier persistence (F06).

### What must happen next
1. **Stop feature work.** Close F01–F04 before v4.32 lands any new route.
2. **Make the test suite honest** — fix the hooks-null setup issue, re-green, re-count, update the README badge to match truth.
3. **Add `ci.yml`** running `npm run ci` + lint + `npm audit --audit-level=high`.
4. **Fix the pack worker `_failJob`** SQL + add a failure-path test.
5. **Decide the commissioning persistence architecture** — is CxWorkflow the system of record (then wire it to the API), or is `/generate-draft` (then delete the client-side engine from the UI path)?

### What not to do yet
- Do not run Denver Engineering on a real customer's project.
- Do not pitch turnover/dossier capability as a current feature.
- Do not rely on the "1,800 tests passing" number in sales materials until F02 is closed.
- Do not add new routes/views until F01–F04 are closed.

---

## 10. Remediation Roadmap by Phase

### Phase 0 — Truth-finding & verification (1–2 weeks)
- **F02** Get tests honestly green. Investigate the null-useMemo failure root cause (test env React import path / dual React copies from worktree isolation).
- **F03** Add `ci.yml`. Required check on PRs: `npm audit --audit-level=high`, `typecheck:all`, `lint`, `test -- --run`, `build`.
- **F07** Wire `@typescript-eslint/parser` into `eslint.config.js`.
- **F09** Lower monolith ratchet to 1,150; add to CI.
- **F17** Remove or fix README CI badge.
- **F18** Remove `api/{db/...` literal-glob directory.
- **F19** Update or remove stale App.jsx comment.

### Phase 1 — Project-delivery blockers (3–6 weeks)
- **F01** Resolve the commissioning persistence split. Define `matrix_rows`, `pack_executions`, `deficiencies`, `retests`, `turnover_packages` migrations + routes + wire CxWorkflowView to them.
- **F04** Fix `_failJob` duplicate-column SQL; add failure-path test.
- **F05** Add `systems`, `subsystems`, `equipment_tags` tables + admin seed + `commissioning_packs.equipment_tag_id` FK.
- **F06** Add `turnover_packages` + `dossier_items`.
- **F08** `npm audit fix` — ship the patched transitives.
- **F15** Reroute `CommissioningView` selectors through backend API.
- **F16** Fail fast if `JWT_SECRET` unset in any env.
- **F21** Validate pack download path resolves inside storage dir.
- **F22** Enforce project match when looking up folder parent.

### Phase 2 — Pilot hardening (6–10 weeks)
- **F10** Post-validate RAG citations against retrieved chunks.
- **F11** Turn on DB SSL `rejectUnauthorized:true`.
- **F12** Move tenant context to connection-level setting (remove per-query BEGIN/COMMIT).
- **F13** Per-tenant rate limiting.
- **F14** Streaming download instead of `readFileSync`.
- **F20** Deny empty `MCP_FETCH_ALLOWLIST` in all envs.
- Add Redis health to `/api/v1/health`.
- Add a dead-letter / alerting path for exhausted scheduler jobs.
- Field-flow rehearsal: run `fieldSync` with intentional disconnect + conflict.

### Phase 3 — Enterprise scale & polish
- **F23** TODO/FIXME triage + cleanup.
- **F24** Version labels reconciled.
- **F25** Rename single-letter vars in JarvisCore.jsx.
- N+1 query audit on dashboard/rollup endpoints.
- PDF artifact rendering (replace `pdfPath: null` stub in `packWorker`).
- Systems/tag admin UI + CSV import.
- Document revision → tag → test traceability end-to-end.

---

## 11. Proof Appendix

### Commands run (reproducible)
```
ls denver-engineering-v4.30.0/                            # repo structure
ls denver-engineering-v4.30.0/api/                        # API layer
ls denver-engineering-v4.30.0/src/                        # frontend layer
ls denver-engineering-v4.30.0/api/db/migrations/          # 25 migration files
wc -l api/server.ts api/auth.ts src/jarvis/JarvisCore.jsx src/App.jsx
wc -l api/routes/*.ts api/services/*.ts           # total 13,046 lines
npm test -- --run                                 # reproduced 1037 failures
npm run typecheck                                 # PASS
npm run typecheck:modules                         # PASS
npm run lint                                      # 157 parse errors
node scripts/check-monolith-size.js               # PASS (but ratchet mis-set)
npm audit --audit-level=high                      # 9 vulns (7 high, 2 moderate)
npm run build                                     # PASS — built in 2.63 s
```

### Key files inspected
- `api/server.ts` (435 lines) — full server wiring
- `api/auth.ts` (339) — JWT + bcrypt + rotation + lockout
- `api/db/pool.ts` (173) — pool + RLS context injection
- `api/middleware/tenant.ts` (194) — tenant resolution
- `api/middleware/agentMode.ts` (134) — auto/review/frozen gate
- `api/services/packWorker.ts` (315) — async pack generation
- `api/services/templateEngine.ts` (290) — pack rendering + normalization
- `api/services/askBuilder.ts` (360) — grounded RAG
- `api/routes/commissioning.ts` (423) — pack CRUD
- `api/routes/files.ts` (404) — file upload/download
- `api/routes/ask.ts` (197) — RAG chat sessions
- `api/routes/mcp.ts` (sampled first 80 lines)
- `api/db/migrations/001_tenants_and_users.sql` through `025_vector_embeddings.sql` — schema
- `src/App.jsx`, `src/jarvis/JarvisCore.jsx` (1,126 lines — sampled)
- `src/components/ContentRouter.tsx`, `CommissioningView.tsx`, `CxWorkflowView.tsx`, `AskJarvisView.tsx`
- `src/modules/commissioning/rules.ts` (573 lines — types sampled, engine noted as client-side)
- `scripts/check-monolith-size.js`, `docker-compose.yml`, `.env.example`, `CHANGELOG.md`, `README.md`
- `.github/workflows/render-deploy.yml` (only workflow present)

### Build/lint/test results observed
| Command | Result |
|---|---|
| `npm run build` | ✅ Built in 2.63 s; largest chunks `vendor-recharts 715 kB`, `CommissioningView 137 kB` |
| `npm run typecheck` | ✅ Clean |
| `npm run typecheck:modules` | ✅ Clean |
| `npm run lint` | ❌ 157 errors (parser misconfig) |
| `npm test -- --run` | ❌ 1037 failing / 4791 passing / 5828 total; 49 test files failed / 123 passed |
| `node scripts/check-monolith-size.js` | ✅ PASS — 1,127 / 6,530 (ratchet ignores regression headroom) |
| `npm audit --audit-level=high` | ❌ 9 vulns (7 high, 2 moderate) — undici, picomatch |

### Logs & runtime
- Full server startup not reproduced — DB credentials not provisioned in this audit environment; health endpoint behavior known from `api/server.ts:234-244`.
- Actual production behavior of pack worker under failure **Unknown** (blocked by F04 requiring DB connection to reproduce).

### Assumptions not verified
- PostgreSQL 16 RLS policies actually enforce at runtime against the `jarvis_app` role (RLS can be bypassed if the app connects as superuser — **Likely correct** but not runtime-verified).
- `offlineQueue` produces consistent results under network partition — **Unknown**.
- Turnover/dossier absence is intentional (pending feature) vs. oversight — **Likely intentional** per REMEDIATION_ROADMAP.md references.
- Render deploy pipeline actually runs on production — **Likely** per workflow file.

### Non-answers / where confidence is low
- Mobile / field UX rated from code presence only — no device-level rehearsal.
- AI prompt-injection resistance rated from system-prompt text + tool-forcing only — not adversarially tested.
- Performance numbers are from bundle output; no load test conducted.

---

*End of audit. Findings written to `docs/audit/AUDIT_RESULT_2026-04-22.md`. Template CSV lives at `docs/audit/templates/findings.csv`.*
