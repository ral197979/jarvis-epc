# Enterprise Security Specification — Phase 14

> **Denver Engineering — the AI-native project operating system.**
> Build-ready specification for the security, identity, tenancy, audit-immutability, deployment-tier, and compliance posture required to survive SOC 2 / ISO 27001 audit and enterprise (and government) procurement.

**Status legend:** ✅ implemented · 🟡 partial / scaffolded · ❌ not built · ⚠️ caveat

**Related specs & docs:** [INTEGRATION_MARKETPLACE_SPEC.md](./INTEGRATION_MARKETPLACE_SPEC.md) · [docs/SOC2_READINESS_PACK.md](./docs/SOC2_READINESS_PACK.md) · [docs/ISO27001_ALIGNMENT.md](./docs/ISO27001_ALIGNMENT.md) · [docs/SECURITY_ARCHITECTURE_REVIEW.md](./docs/SECURITY_ARCHITECTURE_REVIEW.md) · [docs/TENANT_ISOLATION_AND_SECURITY.md](./docs/TENANT_ISOLATION_AND_SECURITY.md) · [docs/AIR_GAPPED_DEPLOYMENT_MODE.md](./docs/AIR_GAPPED_DEPLOYMENT_MODE.md)

---

## 1. Current State (grounded in code, with evidence)

### 1.1 Multi-tenant isolation — Row-Level Security ✅

- **Mechanism:** every tenant-facing query runs through `tenantQuery(tenantId, sql, params)` which sets the Postgres GUC `app.current_tenant_id`. RLS policies enforce `tenant_id = current_setting('app.current_tenant_id', true)::uuid`. Tenant resolution and the GUC handshake live in `api/middleware/tenant.ts` (`requireTenant()`); administrative/worker queries use the unscoped `query()` (`api/db/pool.ts`).
- **Hardening migrations:**
  - `api/db/migrations/056_rls_backfill_and_token_expiry.sql` — RLS backfill + refresh-token expiry.
  - `api/db/migrations/070_rls_missing_tables.sql` — closes RLS gaps on previously-uncovered tables.
  - `api/db/migrations/072_rls_hardening.sql` — policy hardening.
  - `api/db/migrations/075_rls_app_role_grants.sql` — creates the app role with **`NOBYPASSRLS`**, so RLS is *forced* even for the connecting role (the most important control — it removes the "table owner bypasses RLS" footgun).
- **Tenant resolution order** (`api/middleware/tenant.ts`): JWT `tid` claim → host subdomain slug → `400 tenant_required`. The legacy `X-Tenant-ID` header path was **removed** (it allowed unauthenticated tenant spoofing). 60s in-process tenant cache with `invalidateTenantCache()`.
- ⚠️ **Honest caveat:** [docs/TENANT_ISOLATION_AND_SECURITY.md](./docs/TENANT_ISOLATION_AND_SECURITY.md) documents 7 of 11 Phase-8 tables under `tenant_isolation`; the remaining 4 (`tenant_subscriptions`, `tenant_lifecycle_events`, `deployment_health_checks`, `demo_tenants`) are intentionally admin/global. The CI guard in §3 exists to make "intentional" explicit and prevent silent regressions.

### 1.2 Authentication & token management ✅

`api/auth.ts`:
- **JWT** HS256, signed with `JWT_SECRET` (fatal if missing in prod). Access TTL **15 min** (cookie `jarvis_at`), refresh TTL **7 days** (cookie `jarvis_rt`). Cookies are `httpOnly`, `secure` in prod, `sameSite=strict`; refresh cookie scoped to `path=/api/v1/auth/refresh`.
- **Refresh-token revocation:** JTI tracked in **Redis** (`isRevoked`/`hasRefreshToken`) **and** the `refresh_tokens` table (SHA-256 token hash, never plaintext). Refresh performs **rotation** (old JTI revoked in Redis + DB, new pair issued). `purgeExpiredTokens()` runs hourly.
  - ⚠️ Redis must be `noeviction` with ≥1 GB — `render.yaml` notes the free 25 MB tier silently evicted revocation records at ~1k users, allowing reuse of revoked tokens. This is now `starter` (1 GB, noeviction).
- **Passwords:** bcrypt cost 12; constant-time compare against a dummy hash for unknown users; **account lockout** after 5 failed attempts (15 min). SCIM-provisioned users get a valid-but-unusable random bcrypt hash (SSO-only).
- **Middleware:** `requireAuth` (cookie-first, then `Authorization: Bearer`), `requireRole(...roles)`.

### 1.3 Federated identity — SAML 2.0 + SCIM 2.0 ✅

- **SAML 2.0** (`api/auth/saml/*`, migration `073_saml_sso.sql`, `samlify`): SP metadata (`GET …/saml/:tenantSlug/metadata`), SP-initiated login with server-side relay-state (10-min expiry), ACS (`POST …/callback`) with **replay protection** (unique assertion ID, consumed-session check), tenant-match check, JIT user provisioning, role derivation (`roleMapping.ts`), SLO, certificate rotation (`certificateRotation.ts`).
- **SCIM 2.0** (`api/routes/scim.ts`, migration `074_scim_tokens.sql`, base `/scim/v2`): Bearer token auth (`scim_<hex>`, SHA-256-hashed at rest), ServiceProviderConfig/Schemas, Users CRUD with filter+pagination (max 200), **JIT provisioning idempotent on duplicate email**, **PATCH with RFC 7644 §3.5.2 PatchOp validation** (and the Okta "no-path `{op:replace, value:{active:false}}`" quirk handled), soft-delete (deactivate). Admin token management at `/api/v1/scim/tokens` + `/api/v1/scim/audit` (owner/admin only). All SCIM queries are RLS-scoped via `tenantQuery`.

### 1.4 Application security ✅

`api/server.ts` middleware order: `helmet` (CSP — `script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, HSTS, upgrade-insecure in prod) → `cors` (`ALLOWED_ORIGINS` allowlist, credentials) → body parsing (2 MB) → correlation/request-ID + pino logging → `trust proxy = 1` → rate limiters → audit middleware → health → auth routes → SAML → SCIM → `requireCsrf` → domain routes → WS gateway → error handler (Sentry + pino).

- **Rate limiting:** global 600/60s, auth 200/15min, AI 30/60s, agent 20/60s (env-tunable).
- **CSRF** (`api/middleware/csrf.ts`): double-submit cookie (`csrf_token`, non-httpOnly, 8 h) + `X-CSRF-Token` header on all `/api/v1` mutations; bearer-token and safe-method requests exempt.
- **Agent gating** (`api/middleware/agentMode.ts`): per-project `agent_mode` ∈ `auto | review_all | frozen`; `frozen`→403, `review_all`→202 queued action, fail-closed to `review_all` on lookup error. Evidence sanitized (same redaction set as audit).

### 1.5 RBAC ✅

Roles: `owner, admin, project_manager, engineer, viewer` (plus `edge_node` in edge contexts). Enforced at route level via `requireRole(...)`; SCIM `roles[]` and SAML group attributes map onto these.

### 1.6 Audit & immutability 🟡→✅ for chain verification

- **Audit log** (`api/routes/audit.ts`): every POST/PATCH/PUT/DELETE captured by server middleware (tenant_id, user_id, action, resource, resource_id, redacted body, IP, UA, request_id), append-only, sensitive-key redaction. Read/filter/export (CSV+JSON, owner/admin) at `/api/v1/audit*`.
- **Hash-chained verification** (`api/routes/auditVerification.ts` + `api/services/audit/auditVerifier.ts`): rolling SHA-256 chain over `realtime_event_log` (`hash = SHA256(prevHash : id : sequence_number)`), **gap detection** on sequence numbers, daily snapshots in `audit_integrity_snapshots`, status ∈ `valid | tampered | gap_detected | empty`. Routes: `GET …/verify`, `GET …/integrity`, `POST …/snapshot`, `GET …/export` (≤50k events).
  - ⚠️ Tampering detection is hash-chain + gap based (cryptographically detects deletion/reordering), **not** a per-record digital signature. The hardening in §4 (HMAC/signature + WORM) closes that gap, which is what an immutable **decision log** for Phase 12 requires.

### 1.7 Compliance posture — readiness, not certified ⚠️

- [docs/SOC2_READINESS_PACK.md](./docs/SOC2_READINESS_PACK.md) — "READY FOR AUDIT", CC1–CC9 mapped to real services. **Readiness pack exists; no SOC 2 Type II report issued.**
- [docs/ISO27001_ALIGNMENT.md](./docs/ISO27001_ALIGNMENT.md) — "ALIGNED", Annex A matrix, SoA referenced. **Aligned; not certified.**
- [docs/SECURITY_ARCHITECTURE_REVIEW.md](./docs/SECURITY_ARCHITECTURE_REVIEW.md) — internal review "APPROVED"; external pen test scheduled, internal review complete with no criticals. **No external audit/pen-test report published yet.**
- **Evidence automation:** `api/services/ecosystem/certificationEvidenceService.ts` auto-collects SOC2/ISO/AI-governance/audit-chain/tenant-isolation/retention/security-questionnaire evidence into `compliance_exports` with SHA-256 checksums and 90-day TTL (`verifyExportIntegrity()`).

### 1.8 What is NOT built ❌

| Capability | Status |
|---|---|
| Per-tenant encryption keys (envelope encryption) | ❌ roadmap (today: env-level secrets + S3 SSE-AES256 + DB at-rest) |
| Immutable hash-chained **decision log** (Phase 12) | ❌ planned (audit-chain verifier is the foundation) |
| RLS-on-every-tenant-table CI guard | ❌ to build (§3) |
| SCIM **group→role** mapping + IdP-enforced MFA assertion | 🟡 SCIM `roles[]` + SAML groups exist; group→role policy table not built |
| Air-gapped on-prem deployment (field-deployed) | 🟡 designed ([docs/AIR_GAPPED_DEPLOYMENT_MODE.md](./docs/AIR_GAPPED_DEPLOYMENT_MODE.md)); not deployed |
| FedRAMP-aligned GovCloud tier | ❌ not built |
| SOC 2 Type II / ISO 27001 **certification** | ❌ readiness only |

---

## 2. Architecture Overview

```
                         ┌─────────────── IdP (Okta / Azure AD / Ping) ───────────────┐
                         │  SAML 2.0 assertion        SCIM 2.0 provisioning + MFA      │
                         └───────────────┬───────────────────────┬────────────────────┘
                                         ▼                        ▼
  Client ──TLS 1.2+──►  Helmet/CORS/CSRF/RateLimit  ──►  requireAuth (JWT, Redis revocation)
                                         │                        │
                                         ▼                        ▼
                            requireTenant (set app.current_tenant_id GUC)
                                         │
                                         ▼
                         Postgres + RLS (FORCE, NOBYPASSRLS app role)
                                         │
                ┌────────────────────────┼─────────────────────────┐
                ▼                        ▼                          ▼
        audit_log (append-only)   realtime_event_log          per-tenant data
                │                  + auditVerifier (hash chain)
                ▼
        certificationEvidenceService → compliance_exports (checksummed)
```

---

## 3. Requirement: RLS-on-every-tenant-table CI Guard ❌→✅

**Problem:** RLS is enforced per table; a new migration can add a tenant table and forget the policy (or `FORCE ROW LEVEL SECURITY`), silently breaking isolation.

**Control:** a CI test that fails the build if any table with a `tenant_id` column lacks both RLS enabled and a `tenant_isolation` policy, unless explicitly allowlisted.

```sql
-- the guard query (run in CI against a migrated test DB)
SELECT c.relname
FROM pg_class c
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
WHERE c.relkind = 'r'
  AND c.relnamespace = 'public'::regnamespace
  AND (
    c.relrowsecurity = false           -- RLS not enabled
    OR c.relforcerowsecurity = false   -- not forced (owner bypass risk)
    OR NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation'
    )
  )
  AND c.relname NOT IN (/* explicit admin/global allowlist */);
```

- Allowlist lives in a checked-in file (`security/rls_global_tables.txt`) with a one-line justification per table; adding to it requires review.
- Wire into the existing test suite (`api/__tests__/`) so it runs on every PR. **Acceptance:** introducing a tenant table without a policy fails CI.

---

## 4. Requirement: Per-Tenant Encryption Keys & Immutable Decision Log

### 4.1 Per-tenant encryption keys (envelope encryption) ❌→✅

- **KMS-backed key hierarchy:** a master KEK (cloud KMS in SaaS; HSM/local KMS in air-gap) wraps a **per-tenant DEK**. Sensitive at-rest fields — integration credentials (`integration_connectors.credential_ref`, see [INTEGRATION_MARKETPLACE_SPEC.md §6](./INTEGRATION_MARKETPLACE_SPEC.md)), SAML/SCIM secrets, PII columns — are encrypted with the tenant DEK.
- **Crypto-shredding:** destroying a tenant DEK renders that tenant's encrypted data unrecoverable — fast, provable deletion for offboarding/right-to-erasure.
- **Rotation:** DEKs rotate on schedule; KEK rotation re-wraps DEKs without re-encrypting data.
- DEKs are decrypted just-in-time in worker memory, never logged (redaction set already enforced platform-wide).

### 4.2 Immutable hash-chained decision/audit log (Phase 12) ❌→✅

Extend the existing `auditVerifier` chain into a true immutable **decision log** for autonomous-agent decisions:

- **WORM storage:** append-only table with a DB rule/trigger blocking `UPDATE`/`DELETE`; periodic export to object storage with retention-lock (S3 Object Lock / equivalent).
- **Signed chain:** each record (and each daily snapshot) carries an **HMAC/asymmetric signature** in addition to the rolling SHA-256, so tampering is cryptographically *provable*, not just *detectable*.
- **Decision provenance:** every autonomous/agent decision (`agent_actions.decision`, `decision_trail`) is appended with inputs, model/version, approval state, and outcome — satisfying the Phase 12 "decision log must be immutable" requirement and feeding `certificationEvidenceService` audit-chain evidence.

---

## 5. Requirement: SCIM Group→Role Mapping + MFA via IdP 🟡→✅

- **Group→role mapping table** (per tenant): `idp_group → denver_role` with precedence rules. SCIM `roles[]`/`groups` and SAML group attributes resolve through this table (centralizing what `api/auth/saml/roleMapping.ts` does for SAML so SCIM and SAML share one policy).
- **MFA via IdP:** Denver delegates MFA to the IdP (Okta/Azure AD). Enforce by validating the SAML `AuthnContextClassRef` (e.g., `…:MultiFactor` / phishing-resistant) on the assertion in the ACS handler; reject or step-up if the required assurance level is absent. Per-tenant policy: `require_mfa`, minimum `AuthnContext`.
- **Deprovisioning:** SCIM `active:false` (and `DELETE`) immediately deactivates the user and **revokes refresh tokens** (Redis + DB) so SSO offboarding terminates live sessions.

---

## 6. Deployment Tiers

| Tier | Hosting | Identity / AI | Status |
|---|---|---|---|
| **Managed SaaS** | Render (`render.yaml`): Postgres 16 (SSL forced), Redis (noeviction), separate web + worker, staging parity; secrets `generateValue`; `S3_SSE=AES256` | Cloud IdP (SAML/SCIM); cloud AI (Anthropic) | ✅ live |
| **Air-gapped / on-prem** | Customer-isolated, no egress; offline signed update/model/plugin bundles (SHA-256 + HMAC verified) | Local IdP; **local AI provider** (`LOCAL_AI_PROVIDER`, e.g. ollama); cloud integrations **disabled** (`getAirGapStatus().cloudIntegrationsDisabled`) | 🟡 designed ([docs/AIR_GAPPED_DEPLOYMENT_MODE.md](./docs/AIR_GAPPED_DEPLOYMENT_MODE.md)) |
| **FedRAMP-aligned GovCloud** | AWS GovCloud / Azure Gov; FIPS 140-2/3 crypto modules; FedRAMP-aligned control baseline (Moderate→High path); US-person operations; boundary + SSP | GovCloud IdP; FedRAMP-authorized AI or on-prem model | ❌ to build |

Air-gap and GovCloud both lean on the per-tenant key model (§4) with HSM/local KMS, and the connector registry's air-gap refusal (see [INTEGRATION_MARKETPLACE_SPEC.md §6](./INTEGRATION_MARKETPLACE_SPEC.md)).

---

## 7. Compliance Program

- **SOC 2 Type II:** controls mapped in [docs/SOC2_READINESS_PACK.md](./docs/SOC2_READINESS_PACK.md) (CC1–CC9). Path to certification: select auditor → define Type II observation window → automate evidence via `certificationEvidenceService` → external pen test → report. **Today: readiness pack, not a report.**
- **ISO 27001:2022:** Annex A alignment in [docs/ISO27001_ALIGNMENT.md](./docs/ISO27001_ALIGNMENT.md); finalize SoA, run internal audit + management review, then certification audit (Stage 1/2). **Today: aligned, not certified.**
- **Automated evidence:** `certificationEvidenceService` produces checksummed, tenant-scoped evidence exports (audit-chain proof hash, AI-governance counters, isolation config, retention policy) into `compliance_exports` (90-day TTL, `verifyExportIntegrity()`).
- **Encryption:** in transit TLS 1.2+ (1.3 preferred, `DB_SSL=true`); at rest DB volume encryption + `S3_SSE=AES256`; per-tenant envelope keys (§4) as the hardening step.
- **Secrets management:** SaaS uses Render-managed secrets (`generateValue` for `JWT_SECRET`/`SESSION_SECRET`); no secrets in DB (Stripe/SAML keys env-only); air-gap/Gov uses HSM/local KMS.
- **Backup / DR:** Postgres point-in-time recovery + tested restore; documented RPO/RTO; runbooks under `docs/DISASTER_RECOVERY_RUNBOOK*` (verify presence — see acceptance §10).

---

## 8. Threat Model

| Threat (STRIDE) | Vector | Mitigation | Evidence |
|---|---|---|---|
| **Spoofing** | Tenant impersonation | `X-Tenant-ID` header removed; tenant from signed JWT `tid` only | `api/middleware/tenant.ts` |
| **Spoofing** | Forged SAML assertion / replay | Signature validation, unique assertion-ID replay check, relay-state expiry, tenant match | `api/auth/saml/*` |
| **Tampering** | Audit/decision-log alteration | Append-only + rolling SHA-256 chain + gap detection + (planned) WORM & signature | `api/services/audit/auditVerifier.ts` + §4.2 |
| **Tampering** | Update bundle in air-gap | SHA-256 + HMAC signature verification | [docs/AIR_GAPPED_DEPLOYMENT_MODE.md](./docs/AIR_GAPPED_DEPLOYMENT_MODE.md) |
| **Repudiation** | "I didn't do that" | Per-mutation audit with user/IP/UA/request_id; decision log for agents | `api/routes/audit.ts` |
| **Information disclosure** | Cross-tenant data leak | RLS FORCE + `NOBYPASSRLS` app role + GUC; per-tenant keys (§4) | migration `075`, [docs/TENANT_ISOLATION_AND_SECURITY.md](./docs/TENANT_ISOLATION_AND_SECURITY.md) |
| **Information disclosure** | Secret leakage in logs | Redaction set (`password,token,secret,api_key,…`) in audit + agent middleware | `api/server.ts`, `api/middleware/agentMode.ts` |
| **Information disclosure** | SSRF to internal services | `assertSafeUrl()` on outbound webhook/connector calls | `api/routes/integrations.ts` |
| **Denial of service** | Brute-force / flooding | Account lockout (5/15min) + tiered rate limiters | `api/auth.ts`, `api/server.ts` |
| **Denial of service** | Revoked-token reuse via Redis eviction | Redis `noeviction` ≥1 GB | `render.yaml` |
| **Elevation of privilege** | Stale session after offboarding | SCIM deactivate → revoke refresh tokens (Redis+DB) | §5, `api/auth.ts` |
| **Elevation of privilege** | Autonomous agent overreach | `agentMode` gating (frozen/review_all), fail-closed; human-approval governance | `api/middleware/agentMode.ts` |
| **Elevation of privilege** | CSRF on mutations | Double-submit token on `/api/v1` writes | `api/middleware/csrf.ts` |

---

## 9. Control-to-Implementation Mapping

| Control area | SOC 2 / ISO 27001 ref | Implementation | File / migration | Status |
|---|---|---|---|---|
| Logical access — tenant isolation | CC6 / A.9.4, A.8.2 | RLS + GUC + FORCE/NOBYPASSRLS app role | `056/070/072/075`, `api/middleware/tenant.ts` | ✅ (+CI guard §3) |
| Authentication | CC6 / A.9.4 | JWT 15m + refresh rotation + Redis/DB revocation + bcrypt 12 + lockout | `api/auth.ts` | ✅ |
| Federated SSO | CC6 / A.9.2 | SAML 2.0 (replay-protected) | `073`, `api/auth/saml/*` | ✅ |
| Provisioning / deprovisioning | CC6 / A.9.2 | SCIM 2.0 + PatchOp validation; deactivate→token revoke | `074`, `api/routes/scim.ts` | ✅ (group→role §5) |
| MFA | CC6 / A.9.4 | Delegated to IdP; AuthnContext enforcement | §5 | 🟡 |
| Encryption in transit | CC6 / A.8.24 | TLS 1.2+, DB SSL | `render.yaml` | ✅ |
| Encryption at rest | CC6 / A.8.24 | DB volume + S3 SSE-AES256; per-tenant DEK | `render.yaml`, §4 | 🟡 |
| Change management | CC8 / A.8.32 | Production gates, deployment audit, 90% threshold | [docs/SOC2_READINESS_PACK.md](./docs/SOC2_READINESS_PACK.md) | ✅ |
| Audit logging | CC2/CC7 / A.8.15 | Append-only audit middleware + export | `api/server.ts`, `api/routes/audit.ts` | ✅ |
| Log integrity | CC7 / A.8.15 | Hash-chain verify + gap detect + snapshots; (planned) WORM/sig | `api/services/audit/auditVerifier.ts`, §4.2 | 🟡→✅ |
| Evidence automation | CC3/CC4 | `certificationEvidenceService` checksummed exports | `api/services/ecosystem/certificationEvidenceService.ts` | ✅ |
| AppSec headers / CSRF / rate limit | CC6/CC7 / A.8.26 | Helmet CSP, CORS, CSRF, rate limiters | `api/server.ts`, `api/middleware/csrf.ts` | ✅ |
| Secrets management | CC6 / A.8.24 | Env/managed secrets, no DB secrets; HSM in air-gap | `render.yaml` | ✅ |
| Backup / DR | A.5.30, A.8.13 | PITR + restore drills + runbooks | `docs/DISASTER_RECOVERY_RUNBOOK*` | 🟡 verify |
| Air-gapped operation | A.8.* | Offline signed bundles, local AI, cloud disabled | [docs/AIR_GAPPED_DEPLOYMENT_MODE.md](./docs/AIR_GAPPED_DEPLOYMENT_MODE.md) | 🟡 |

---

## 10. Acceptance Criteria

1. **RLS coverage** — the §3 CI guard passes; deliberately adding a tenant table without a `tenant_isolation` policy fails the build; the allowlist is justified and reviewed.
2. **RLS forced** — automated test confirms the app role is `NOBYPASSRLS` and `FORCE ROW LEVEL SECURITY` is set; a query for tenant A returns zero tenant B rows even with a crafted query.
3. **SSO interop** — SAML + SCIM pass certification against Okta **and** Azure AD: SP-initiated login, JIT provision, group→role mapping, MFA-context enforcement, deactivate→session-termination.
4. **Audit chain** — `GET …/audit/verify` returns `valid`; an injected deletion/reorder yields `tampered`/`gap_detected`; daily snapshot present; (Phase 12) decision-log records are append-only and signature-verifiable.
5. **Per-tenant keys** — credentials/PII encrypt/decrypt under per-tenant DEKs; crypto-shred of a tenant DEK makes that tenant's encrypted data unrecoverable.
6. **Token revocation** — logout/refresh-rotation/SCIM-deactivate revoke the JTI in Redis **and** DB; replay of a revoked refresh token is rejected; verified under Redis `noeviction`.
7. **AppSec** — automated checks assert CSP/CORS/CSRF/rate-limit headers and behavior; CSRF-less mutation → 403; brute-force → lockout.
8. **Air-gap** — install runbook validated in a no-egress environment; cloud integrations refuse to load; license HMAC tamper is detected; local AI provider serves inference.
9. **Compliance evidence** — `certificationEvidenceService` exports SOC2 + ISO + audit-chain evidence with passing `verifyExportIntegrity()`; controls in §9 map to live files.
10. **DR** — restore drill meets documented RPO/RTO; runbook under `docs/DISASTER_RECOVERY_RUNBOOK*` exists and is current.

---

## 11. Phased Plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **14.0 Isolation hardening** | RLS CI guard (§3) + allowlist; confirm FORCE/NOBYPASSRLS everywhere | Acceptance #1, #2 |
| **14.1 Identity completion** | SCIM/SAML group→role table; MFA AuthnContext enforcement; deactivate→token-revoke | Acceptance #3, #6 |
| **14.2 Crypto & immutable log** | Per-tenant envelope keys + crypto-shred; WORM + signed decision log (Phase 12) | Acceptance #4, #5 |
| **14.3 Compliance drive** | Auditor engaged; Type II window; evidence automation; external pen test | SOC 2 Type II report; ISO 27001 stage 2 scheduled |
| **14.4 Air-gap GA** | Field-validate air-gapped install + offline updates + local AI | Acceptance #8 |
| **14.5 GovCloud / FedRAMP** | GovCloud tier, FIPS crypto, SSP + boundary, FedRAMP-aligned baseline | Authorization package drafted; control baseline implemented |

---

*Cross-links: [INTEGRATION_MARKETPLACE_SPEC.md](./INTEGRATION_MARKETPLACE_SPEC.md) · [docs/SOC2_READINESS_PACK.md](./docs/SOC2_READINESS_PACK.md) · [docs/ISO27001_ALIGNMENT.md](./docs/ISO27001_ALIGNMENT.md) · [docs/SECURITY_ARCHITECTURE_REVIEW.md](./docs/SECURITY_ARCHITECTURE_REVIEW.md) · [docs/TENANT_ISOLATION_AND_SECURITY.md](./docs/TENANT_ISOLATION_AND_SECURITY.md) · [docs/AIR_GAPPED_DEPLOYMENT_MODE.md](./docs/AIR_GAPPED_DEPLOYMENT_MODE.md)*
