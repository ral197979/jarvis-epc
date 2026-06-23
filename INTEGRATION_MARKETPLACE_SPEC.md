# Integration Marketplace Specification — Phase 13

> **Denver Engineering — the AI-native project operating system.**
> Build-ready specification for the connector marketplace, Connector SDK, sync engine, and object-graph mapping that lets Denver pull/push data with the systems an EPC enterprise already runs.

**Status legend:** ✅ implemented · 🟡 partial / scaffolded · ❌ not built · ⚠️ caveat

**Related specs:** [ENTERPRISE_SECURITY_SPEC.md](./ENTERPRISE_SECURITY_SPEC.md) · [docs/THIRD_PARTY_AGENT_SDK.md](./docs/THIRD_PARTY_AGENT_SDK.md) · [docs/AIR_GAPPED_DEPLOYMENT_MODE.md](./docs/AIR_GAPPED_DEPLOYMENT_MODE.md)

---

## 1. Positioning & Goals

Denver is the AI-native successor to Procore. Procore's moat is its app marketplace and its position as the system of record. Denver's strategy is the inverse: **be the AI execution layer that sits on top of, and migrates away from, the incumbent systems of record.** The marketplace must therefore do three jobs:

1. **Bidirectional sync** with schedule, financial, document, and field systems (P6, MSP, Procore, ACC, Aconex, SAP, etc.).
2. **One-way migration** off incumbents (Procore → Denver, Aconex → Denver) with full provenance so customers can leave their old system of record.
3. **Outbound publishing** to BI/analytics and ITSM (Power BI, ServiceNow) so Denver's AI insights flow into enterprise reporting and workflows.

**Non-goal (Phase 13):** a public third-party app store with revenue share. That is Phase 15+. Phase 13 ships first-party connectors built on a public SDK contract so partners *can* extend later. Third-party agent execution is governed separately by the zero-trust [Third-Party Agent SDK](./docs/THIRD_PARTY_AGENT_SDK.md).

---

## 2. Current State (grounded in code)

### 2.1 What exists ✅

| Capability | Evidence | Status |
|---|---|---|
| Connector framework (registry, job queue, retry/backoff, dead-letter, health scoring) | `api/services/integration/connectorFramework.ts` | ✅ |
| Integration Hub API (connect, list, health, sync, job complete/fail) | `api/routes/integrationHub.ts` | ✅ |
| Integration CRUD + webhooks + sync-job history API | `api/routes/integrations.ts` | ✅ |
| Durable webhook dispatch (HMAC-signed, SSRF-guarded, exponential backoff, delivery log) | `api/services/webhookDispatch.ts`, `dispatchWebhookEvent()` / `emitEvent()` in `api/routes/integrations.ts` | ✅ |
| Scheduled sync promoter + worker (idempotent, `FOR UPDATE SKIP LOCKED`) | `api/services/integrationSync.ts` | 🟡 (dispatch is a no-op stub) |
| Async export jobs (analytics, audit, actions, readiness, events, SLA, recommendations) | `api/routes/exports.ts` | ✅ |
| **QuickBooks Online** connector (real OAuth2, customer/invoice/expense push) | `api/services/integration/quickbooksConnector.ts` | ✅ |
| **Slack** connector (webhook + bot token, Block Kit, signature verify) | `api/services/integration/slackConnector.ts` | ✅ |
| **Microsoft Teams** connector (Adaptive Cards v1.5, EVM cards, signature verify) | `api/services/integration/teamsConnector.ts` | ✅ |

### 2.2 The honest gap ❌

The **construction-domain connectors do not exist.** `api/services/integrationSync.ts` `_performSync()` routes every integration type through a default no-op:

```
// v1 stub: log the intent and return a clean no-op so existing
// integrations can be enabled without type-specific code.
// case 'procore': case 'sap': case 'oracle_primavera':
// case 'ms_project': case 'aconex': case 'autodesk_bim360': ...
default: return { pushed: 0, pulled: 0, failed: 0 }
```

So today an admin can *register* a "procore" integration and *enable* sync, but it pushes/pulls zero records. The connectivity test (`POST /api/v1/integrations/:id/test`) only does an HTTP `GET {base_url}/health` — it is not a vendor-aware auth check. **Treat anything other than QuickBooks/Slack/Teams + webhooks/exports as not-yet-built.**

### 2.3 Architecture today (data flow)

```
Route (emitEvent / sync trigger)
   │
   ▼
background_jobs / integration_jobs  (durable queue, per-tenant)
   │  claim FOR UPDATE SKIP LOCKED
   ▼
Worker (render.yaml: dedicated worker service)
   │
   ├── webhook_dispatch → dispatchWebhookEvent() → HMAC-signed POST (SSRF-guarded) → webhook_deliveries log
   └── integration_sync → _performSync(integration)  ← ❌ STUB to be replaced by Connector SDK
```

The Phase 13 work is: **replace the `_performSync` stub with a Connector SDK dispatch layer, and implement the connectors below against it.**

---

## 3. Required Connectors — priority & direction

Direction key: **Pull** = into Denver · **Push** = out of Denver · **↔** = bidirectional · **Migrate** = one-time bulk import with provenance.

| # | Connector | Domain | Direction | Priority | Auth | Primary objects |
|---|---|---|---|---|---|---|
| 1 | **Primavera P6** (EPPM / Pro) | Schedule | ↔ + Migrate | **P0** | OAuth2 / Basic (P6 EPPM REST) | activities, WBS, resources, relationships, baselines |
| 2 | **Microsoft Project** (Project for the web / Online / .mpp) | Schedule | ↔ + Migrate | **P0** | OAuth2 (Microsoft Graph / Project CSOM) | tasks, dependencies, assignments, calendars |
| 3 | **Procore** | System of record | ↔ + **Migrate** | **P0** | OAuth2 (Procore API) | projects, RFIs, submittals, drawings, daily logs, budgets, commitments, change orders |
| 4 | **Autodesk Construction Cloud** (ACC / BIM 360) | Documents / BIM | ↔ | **P0** | 3-legged OAuth2 (APS/Forge) | drawings, models, issues, RFIs, sheets, folders |
| 5 | **Oracle Aconex** | Documents / correspondence | Pull + **Migrate** | **P1** | OAuth2 / Basic (Aconex REST) | documents, transmittals, mail, workflows |
| 6 | **Oracle Primavera Unifier** | Cost / PM controls | ↔ | **P1** | REST + token | cost sheets, business processes, commitments, payment apps |
| 7 | **Microsoft SharePoint** | Documents | ↔ | **P1** | OAuth2 (Microsoft Graph) | document libraries, files, metadata columns |
| 8 | **Bluebeam** (Studio / Revu) | Drawing markup | Pull | **P1** | OAuth2 / API key (Studio Prime) | sessions, markups, sets, projects |
| 9 | **SAP** (S/4HANA / ECC via OData or BAPI gateway) | ERP / finance | ↔ | **P1** | OAuth2 / OData basic | purchase orders, commitments, GR/IR, cost centers, WBS, invoices |
| 10 | **Oracle ERP Cloud** (Fusion) | ERP / finance | ↔ | **P2** | OAuth2 (Fusion REST) | POs, suppliers, invoices, projects, expenditures |
| 11 | **IBM Maximo** | CMMS / asset mgmt | ↔ | **P2** | OAuth2 / MAXAUTH (Maximo REST/OSLC) | work orders, assets, locations, PMs |
| 12 | **ServiceNow** | ITSM / workflow | Push + ↔ | **P2** | OAuth2 (ServiceNow Table API) | incidents, change requests, tasks, CMDB CIs |
| 13 | **Power BI** | BI / analytics | **Push** | **P2** | OAuth2 (Power BI REST / push datasets) | datasets, rows (EVM, actions, deficiencies, SLA) |

**Rollout sequencing:** P0 connectors (P6, MSP, Procore, ACC) unlock the schedule + system-of-record migration story that wins enterprise deals. P1 adds cost/document depth (Aconex, Unifier, SharePoint, Bluebeam, SAP). P2 closes the analytics/operations loop (Oracle ERP, Maximo, ServiceNow, Power BI).

---

## 4. Connector SDK Contract

The SDK is the seam between the generic sync engine (`connectorFramework.ts` + `integrationSync.ts`) and per-vendor logic. Every connector is a module that exports a `Connector` implementing the interface below. The sync engine never knows vendor specifics; it only calls these methods.

### 4.1 Interface

```ts
// api/services/integration/sdk/connector.ts  (NEW — Phase 13)

export interface ConnectorManifest {
  type: string                 // 'primavera_p6' | 'procore' | ...
  version: string              // semver
  direction: ('pull' | 'push' | 'migrate')[]
  authKind: 'oauth2' | 'oauth2_3lo' | 'basic' | 'apikey' | 'odata_basic'
  scopes?: string[]
  supportedObjects: string[]   // Denver object-graph kinds this connector maps
  configSchema: JSONSchema     // rendered by the marketplace install UX
  rateLimit?: { rps: number; burst: number }
  webhookCapable: boolean
}

export interface ConnectorContext {
  tenantId: string
  connectorId: string
  credentials: ResolvedCredentials   // decrypted just-in-time; never logged
  config: Record<string, unknown>
  cursor?: string                    // opaque incremental-sync watermark
  logger: ScopedLogger
  signal: AbortSignal                // honored for cancellation/timeouts
}

export interface Connector {
  manifest(): ConnectorManifest

  // ── AUTH ──────────────────────────────────────────────────────────────
  // OAuth2 authorize URL build + code exchange + refresh. Mirrors the
  // proven shape of QuickBooksConnector (buildAuthUrl / exchangeCode /
  // refreshAccessToken / revokeTokens).
  auth: {
    buildAuthUrl?(state: string): string
    exchangeCode?(code: string, meta: Record<string, string>): Promise<TokenSet>
    refresh?(tokens: TokenSet): Promise<TokenSet>
    revoke?(tokens: TokenSet): Promise<void>
    verify(ctx: ConnectorContext): Promise<HealthProbe>   // real auth check, NOT GET /health
  }

  // ── PULL (vendor → Denver) ────────────────────────────────────────────
  // Returns external records + a new cursor. MUST be incremental when the
  // vendor supports change tokens / modifiedSince; full-scan otherwise.
  pull(ctx: ConnectorContext, kind: string): Promise<PullPage>

  // ── PUSH (Denver → vendor) ────────────────────────────────────────────
  // Idempotent: caller passes an idempotencyKey; connector must dedupe.
  push(ctx: ConnectorContext, kind: string, records: MappedRecord[]): Promise<PushResult>

  // ── SCHEMA MAPPING ────────────────────────────────────────────────────
  // Translate external payload ⇄ Denver object graph. Pure function; the
  // engine handles persistence + provenance stamping.
  mapToDenver(kind: string, external: unknown): MappedRecord
  mapFromDenver(kind: string, denver: MappedRecord): unknown

  // ── WEBHOOK (optional, vendor → Denver push) ──────────────────────────
  webhook?: {
    verify(rawBody: Buffer, headers: Record<string, string>, secret: string): boolean
    parse(rawBody: Buffer): { kind: string; records: unknown[]; cursor?: string }
  }
}

export interface PullPage {
  kind: string
  records: unknown[]
  cursor: string | null     // null = caught up
  hasMore: boolean
}

export interface PushResult {
  pushed: number
  failed: number
  externalIds: Array<{ denverId: string; externalId: string }>  // for crosswalk
  errors: Array<{ denverId: string; message: string; retryable: boolean }>
}

export interface MappedRecord {
  kind: string                       // Denver object-graph kind
  externalId?: string
  denverId?: string
  fields: Record<string, unknown>
  provenance: Provenance             // attached on every mapped record
}
```

### 4.2 Registration

Connectors self-register into a static registry at boot. The sync worker resolves by `integration.type`:

```ts
// api/services/integration/sdk/registry.ts
registerConnector(primaveraP6Connector)
registerConnector(procoreConnector)
// ... resolveConnector(type) → Connector | undefined
```

`_performSync()` in `integrationSync.ts` is rewritten to: `const c = resolveConnector(integration.type)` → drive `pull`/`push`/`mapToDenver` through the engine. The current no-op default becomes "unknown connector type → fail job with a clear error" rather than a silent success.

### 4.3 SDK guarantees the engine provides (so connectors stay thin)

- **Credential resolution & rotation** — connectors receive decrypted creds via `ConnectorContext`; the engine handles token-refresh scheduling and re-encryption (§6).
- **Retry / backoff / dead-letter** — already in `connectorFramework.ts` (`_buildRetryDelay`, `dead_letter` status). Connectors throw on retryable errors; the engine schedules `next_attempt_at`.
- **Idempotency** — `integration_jobs (tenant_id, idempotency_key)` unique constraint + `ON CONFLICT DO NOTHING` already enforced in `enqueueIntegrationJob()`.
- **Health scoring** — `_computeHealthScore()` already degrades on consecutive failures / staleness.
- **Rate limiting** — engine token-bucket per connector from `manifest().rateLimit`.
- **Provenance & persistence** — engine stamps provenance and writes to the object graph (§5).

---

## 5. Object Mapping into the Denver Object Graph (with provenance)

### 5.1 Canonical object-graph kinds

The Denver graph already has first-class entities (projects, RFIs, submittals, drawings, daily logs, budgets, deficiencies, punch lists, inspections, risks, actions, EVM — see the corresponding `api/routes/*.ts`). Connectors map external objects onto these kinds. Cross-system identity is held in a **crosswalk** table:

```sql
-- migration NNN_integration_crosswalk.sql  (NEW)
CREATE TABLE integration_crosswalk (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  connector_id    uuid NOT NULL REFERENCES integration_connectors(id),
  denver_kind     text NOT NULL,          -- 'project','rfi','schedule_activity',...
  denver_id       uuid NOT NULL,
  external_system text NOT NULL,          -- 'procore','primavera_p6',...
  external_id     text NOT NULL,
  external_etag   text,                   -- vendor version/hash for conflict detection
  last_synced_at  timestamptz,
  UNIQUE (tenant_id, external_system, denver_kind, external_id)
);
-- RLS: tenant_isolation USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
```

### 5.2 Provenance (required on every imported/synced record)

```sql
CREATE TABLE integration_provenance (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  denver_kind    text NOT NULL,
  denver_id      uuid NOT NULL,
  field          text,                    -- NULL = whole record
  source_system  text NOT NULL,           -- 'aconex','procore',...
  source_id      text NOT NULL,
  source_etag    text,
  sync_job_id    uuid,
  imported_at    timestamptz NOT NULL DEFAULT now(),
  raw_snapshot   jsonb                     -- original vendor payload (audit/replay)
);
-- RLS: tenant_isolation (per ENTERPRISE_SECURITY_SPEC.md)
```

`Provenance` on `MappedRecord` carries `{ sourceSystem, sourceId, sourceEtag, importedAt, fieldLevel? }`. This is what lets a customer **migrate off Procore/Aconex and still answer "where did this RFI come from"** during audit. Provenance rows are append-only and complement the audit-chain verifier described in [ENTERPRISE_SECURITY_SPEC.md](./ENTERPRISE_SECURITY_SPEC.md).

### 5.3 Representative field maps

**Primavera P6 activity → Denver schedule_activity**

| P6 field | Denver field |
|---|---|
| `ObjectId` | `external_id` (crosswalk) |
| `Id` (activity code) | `code` |
| `Name` | `name` |
| `WBSObjectId` | `wbs_id` (resolved via crosswalk) |
| `StartDate` / `FinishDate` | `planned_start` / `planned_finish` |
| `RemainingDuration` / `PercentComplete` | `remaining_duration` / `pct_complete` |
| relationships (`PredecessorActivityObjectId`, `Type`, `Lag`) | `dependencies[]` |
| `BaselineStartDate` | `baseline_start` |

**Procore RFI → Denver rfi**: `id→external_id`, `number→number`, `subject→title`, `status→status` (mapped enum), `assignee.id→assignee` (crosswalk on users), `due_date→due_at`; attachments → drawings/files via ACC/SharePoint crosswalk. Provenance `source_system='procore'`.

**SAP commitment (PO) → Denver budget/commitment**: `EBELN→external_id`, `NETWR→committed_amount`, `WAERS→currency`, `MATKL`/cost center → `budget_line` (crosswalk); GR/IR → `actuals`. Used for SAP commitment reconciliation (§11 acceptance).

### 5.4 Conflict policy

Since several connectors are bidirectional, the engine applies a per-connector, per-kind **conflict policy** declared in config:

- `source_of_truth: 'denver' | 'external'` — the authoritative side wins on conflict.
- `last_write_wins` — compare `external_etag` vs Denver `updated_at`; newer wins.
- `manual_review` — divergence creates an `integration_conflicts` row surfaced in the marketplace UX for human resolution; neither side overwrites until resolved.

Conflicts are detected by comparing `external_etag` in the crosswalk against the live vendor etag on pull, and Denver `updated_at` against `last_synced_at` on push. Detected conflicts that aren't auto-resolvable are written to an `integration_conflicts` table and never silently dropped.

---

## 6. Credential & Secrets Model

- **Per-tenant, per-connector secrets.** `integration_connectors.credential_ref` already exists; it points to an encrypted credential record, never the plaintext.
- **Encryption at rest.** Credentials (OAuth tokens, API keys, refresh tokens) are envelope-encrypted with a **per-tenant data key** (see [ENTERPRISE_SECURITY_SPEC.md §6 Per-Tenant Encryption Keys](./ENTERPRISE_SECURITY_SPEC.md)). The connector framework receives decrypted creds only inside `ConnectorContext`, just-in-time, in worker memory.
- **OAuth token lifecycle.** Mirror the proven QuickBooks pattern (`accessTokenExpiry`, refresh when `< Date.now() + 60_000`, `revokeTokens()` on disconnect). The engine schedules background refresh before expiry.
- **Redaction.** All connector logs and the audit middleware redact `password, token, refresh_token, secret, api_key, authorization, client_secret, client_id` (the redaction set already enforced in `api/server.ts` audit middleware and `api/middleware/agentMode.ts`).
- **SSRF protection.** All outbound connector and webhook calls go through the existing `assertSafeUrl()` guard (rejects loopback/link-local/internal) used by `dispatchWebhookEvent()`.
- **Air-gapped mode.** When `getAirGapStatus().cloudIntegrationsDisabled` is true, the registry must refuse to load cloud connectors and surface a clear "disabled in air-gapped deployment" error (see [docs/AIR_GAPPED_DEPLOYMENT_MODE.md](./docs/AIR_GAPPED_DEPLOYMENT_MODE.md)).

---

## 7. Sync Engine

### 7.1 Triggers

1. **Scheduled** — `integrationSync.ts` promoter ticks every ≥`INTEGRATION_SCAN_MIN_INTERVAL_MS` (default 60s), claims due integrations (`sync_enabled AND status='active' AND last_sync_at + sync_interval < now()`) via `FOR UPDATE SKIP LOCKED`, enqueues one `integration_sync` job each. **(exists)**
2. **Webhook (vendor → Denver)** — vendors that support webhooks (Procore, ACC, ServiceNow) POST to `/api/v1/integrations/:id/webhook`; the engine verifies the signature via `connector.webhook.verify()`, then enqueues a targeted incremental pull. **(new)**
3. **Manual** — `POST /api/v1/integrations/:id/sync` enqueues immediately (202 Accepted). **(exists)**

### 7.2 Guarantees

| Property | Mechanism |
|---|---|
| **Idempotent** | `integration_jobs (tenant_id, idempotency_key)` unique + `ON CONFLICT DO NOTHING` (`enqueueIntegrationJob`) |
| **At-least-once delivery** | durable `integration_jobs` / `background_jobs`; jobs resume after worker restart |
| **Retry / backoff** | `_buildRetryDelay()` → 30s, 60s, 5m, 15m, 1h capped |
| **Dead-letter** | `attempts >= max_attempts` → `status='dead_letter'` (`failIntegrationJob`) |
| **Per-tenant isolation** | all writes via `tenantQuery()` → `app.current_tenant_id` GUC + RLS |
| **Incremental** | opaque `cursor` per connector/kind stored on the integration row |
| **Observability** | `sync_jobs` (pushed/pulled/failed counts, error_log), `webhook_deliveries`, connector `health_score` |
| **Cancellation** | `AbortSignal` in `ConnectorContext`, honored by connectors |

### 7.3 Dead-letter handling UX

Dead-lettered jobs and unresolved `integration_conflicts` surface in the marketplace health view (§8) with replay (`POST /api/v1/integrations/jobs/:id/replay` — new) and "resolve conflict" actions. No record is ever silently dropped.

---

## 8. Marketplace Install / Config / Health UX

### 8.1 Install

1. **Browse** — catalog rendered from each connector's `manifest()` (name, domain, direction, auth kind, supported objects).
2. **Authorize** — for OAuth connectors, redirect through `auth.buildAuthUrl(state)` → vendor consent → callback `exchangeCode()`. CSRF-safe `state` stored server-side (proven in QuickBooks connector).
3. **Configure** — render `manifest().configSchema` (JSON Schema) → field maps, sync direction, conflict policy, sync interval. Persist via `POST /api/v1/integrations/connect`.
4. **Verify** — call `auth.verify()` (a *real* vendor auth probe, replacing the `GET /health` placeholder), show green/red.

### 8.2 Health & monitoring

- `GET /api/v1/integrations/health` and `GET /api/v1/integrations/:id/health` already return `health_score`, `last_sync_at`, `consecutive_failures`, `last_error` (`getConnectorHealth`).
- UX surfaces: health-score trend, last sync result (pushed/pulled/failed), dead-letter queue depth, unresolved conflicts, next scheduled run, token-expiry countdown.

### 8.3 Migration wizard (Procore / Aconex)

Dedicated one-time bulk import: select source project → preview object counts → run `migrate` direction (full-scan pull + map + provenance stamp) → reconciliation report (imported / skipped / errored, with provenance links). Runs as chunked, resumable `integration_jobs`.

---

## 9. API Surface (existing + new)

| Method | Path | Status |
|---|---|---|
| POST | `/api/v1/integrations/connect` | ✅ existing |
| GET | `/api/v1/integrations` | ✅ |
| GET | `/api/v1/integrations/health` · `/:id/health` | ✅ |
| POST | `/api/v1/integrations/sync` · `/:id/sync` | ✅ |
| POST | `/api/v1/integrations/jobs/:id/complete` · `/:id/fail` | ✅ |
| POST | `/api/v1/integrations/:id/test` | 🟡 placeholder → replace with `auth.verify()` |
| GET/POST/PATCH/DELETE | `/api/v1/webhooks*` | ✅ |
| POST | `/api/v1/integrations/:id/webhook` | ❌ new (inbound vendor webhook) |
| GET | `/api/v1/integrations/catalog` | ❌ new (manifest-driven catalog) |
| POST | `/api/v1/integrations/:id/oauth/callback` | ❌ new (per-connector OAuth) |
| POST | `/api/v1/integrations/:id/migrate` | ❌ new (migration wizard) |
| POST | `/api/v1/integrations/jobs/:id/replay` | ❌ new (dead-letter replay) |
| GET/POST | `/api/v1/integrations/conflicts*` | ❌ new (conflict review) |
| POST | `/api/v1/exports` + `/:id` + `/:id/download` | ✅ |

---

## 10. Threat Model (integration-specific)

| Threat | Mitigation |
|---|---|
| SSRF via connector/webhook base_url | `assertSafeUrl()` rejects loopback/link-local/internal (existing) |
| Credential theft from DB | per-tenant envelope encryption; `credential_ref` indirection; redaction in logs |
| Cross-tenant data bleed in shared worker | every read/write via `tenantQuery()` + RLS GUC; crosswalk/provenance carry `tenant_id` + RLS |
| Webhook spoofing (vendor → Denver) | `connector.webhook.verify()` HMAC/signature check per vendor (pattern proven in Slack/Teams verify) |
| Replay of vendor webhooks | timestamp window + delivery-id dedupe (Slack connector already enforces a 5-min window) |
| Poisoned/oversized vendor payloads | schema validation in `mapToDenver`; size caps; raw payload quarantined in `raw_snapshot` |
| Silent data loss on sync failure | dead-letter + conflict tables, never drop; health-score degradation; alerting |
| Token leakage via OAuth `state`/redirect | CSRF-safe random `state` stored server-side; exact redirect-URI match |

See [ENTERPRISE_SECURITY_SPEC.md](./ENTERPRISE_SECURITY_SPEC.md) for the platform-wide threat model and control mappings.

---

## 11. Acceptance Criteria

A connector is "marketplace-ready" only when all of the following pass in CI/integration tests against a vendor sandbox:

1. **Auth round-trip** — `buildAuthUrl → exchangeCode → refresh → revoke` succeeds; `auth.verify()` returns healthy; tokens stored encrypted per-tenant.
2. **P6 / MSP schedule round-trip** — import an activity network, edit `pct_complete` + a relationship in Denver, push back, re-pull, and assert the vendor reflects the change with zero data loss across baselines and dependencies.
3. **Procore migration with provenance** — migrate a Procore project; every imported RFI/submittal/drawing has an `integration_provenance` row with `source_system='procore'`, `source_id`, and `raw_snapshot`; reconciliation counts match Procore.
4. **Aconex migration with provenance** — migrate a document register; transmittals and document metadata carry provenance and crosswalk entries; no orphaned documents.
5. **SAP commitment reconciliation** — pull POs/commitments; Denver budget committed totals reconcile to SAP `NETWR` per cost center within rounding tolerance; GR/IR maps to actuals; a reconciliation export matches SAP.
6. **Idempotency** — replaying the same sync job (same `idempotency_key`) produces zero duplicate records.
7. **Conflict policy** — concurrent edits on both sides trigger the configured policy (source-of-truth / LWW / manual_review); `manual_review` divergences land in `integration_conflicts` and block silent overwrite.
8. **Resilience** — induced vendor 5xx/429 retries with backoff and dead-letters after `max_attempts`; dead-letter replay succeeds after the fault clears.
9. **Tenant isolation** — automated test asserts a connector for tenant A cannot read/write tenant B objects (RLS + crosswalk scoping).
10. **Webhook security** — forged webhook (bad signature) rejected; replayed webhook (stale timestamp / duplicate delivery id) ignored.
11. **Air-gapped** — with `cloudIntegrationsDisabled=true`, cloud connectors refuse to load with a clear error.

---

## 12. Phased Plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **13.0 SDK foundation** | Build `sdk/connector.ts` + `registry.ts`; rewrite `_performSync` to dispatch via registry; add crosswalk + provenance + conflicts tables (RLS); per-tenant credential encryption; CI tenant-isolation + RLS guard | Stub removed; QuickBooks/Slack/Teams refactored onto the SDK; all existing tests green |
| **13.1 P0 connectors** | Primavera P6, Microsoft Project, Procore, Autodesk Construction Cloud | Acceptance #1–4, #6, #9 pass for all four against sandboxes; Procore migration wizard ships |
| **13.2 P1 connectors** | Aconex, Unifier, SharePoint, Bluebeam, SAP | Acceptance #4, #5, #7 pass; conflict-review UX ships |
| **13.3 P2 connectors** | Oracle ERP, Maximo, ServiceNow, Power BI | Push-to-BI/ITSM acceptance pass; outbound publishing live |
| **13.4 Marketplace polish** | Catalog UX, health dashboard, dead-letter replay, alerting | Full install→configure→verify→monitor loop; dead-letter depth + token-expiry alerts |
| **13.5 Partner SDK GA (→ Phase 15 bridge)** | Publish SDK contract + docs so third parties can author connectors under the zero-trust [Third-Party Agent SDK](./docs/THIRD_PARTY_AGENT_SDK.md) governance model | External connector authored against the published contract passes the acceptance suite |

---

*Cross-links: [ENTERPRISE_SECURITY_SPEC.md](./ENTERPRISE_SECURITY_SPEC.md) · [docs/THIRD_PARTY_AGENT_SDK.md](./docs/THIRD_PARTY_AGENT_SDK.md) · [docs/AIR_GAPPED_DEPLOYMENT_MODE.md](./docs/AIR_GAPPED_DEPLOYMENT_MODE.md) · [docs/TENANT_ISOLATION_AND_SECURITY.md](./docs/TENANT_ISOLATION_AND_SECURITY.md)*
