# Enterprise Security Spec — Denver Engineering

> Phase 14. v1, grounded in `api/server.ts`, `api/auth.ts`, RLS migrations (`056/070/072/075`),
> SAML (`073`), SCIM (`074`), audit routes.

## 1. Current state (✅/🟡/❌)
- ✅ **Multi-tenant isolation** via Postgres **RLS** on tenant tables (GUC `app.current_tenant_id`); hardening migrations `056/070/072/075`.
- ✅ **AuthN:** JWT access + httpOnly refresh cookie; **Redis** token revocation; bcrypt password hashing (cost 12); SCIM users get a valid-but-unusable hash (SSO-only).
- ✅ **SSO:** SAML 2.0 (`073`, samlify) + **SCIM 2.0** provisioning (`074`) with PatchOp validation.
- ✅ **AppSec:** Helmet CSP, CORS allowlist, global + auth rate limiters, CSRF on mutating `/api/v1`, UUID query validation, path-traversal & error-leak hardening (recent commits).
- ✅ **RBAC:** owner/admin/project_manager/engineer/viewer; route-level `requireRole`.
- ✅ **Audit log** read API; SCIM/admin token management + audit.
- 🟡 **Immutable logs** — audit exists; tamper-evidence/append-only attestation partial (audit chain verification routes present).
- ❌ **Air-gapped deployment**, **FedRAMP path**, **SOC2 Type II / ISO 27001** certification artifacts (docs exist under `docs/SOC2_READINESS_PACK.md`, `ISO27001_ALIGNMENT.md` — readiness, not certified).

## 2. Requirements
- **Tenancy:** RLS on *every* tenant table (CI check to prevent regressions); per-tenant encryption keys (roadmap).
- **Identity:** SAML + SCIM (have); SCIM group→role mapping; session policy, MFA via IdP.
- **Audit & immutability:** append-only, hash-chained decision/audit log (Phase 12 decision log must be immutable); export for compliance.
- **Deployment tiers:** managed SaaS (Render), **air-gapped/on-prem** package, **FedRAMP-aligned GovCloud**.
- **Compliance program:** SOC2 Type II, ISO 27001, evidence automation (existing `certificationEvidenceService`).
- **Data:** encryption at rest + in transit, secrets in a managed store, backup/DR runbooks (present under `docs/DISASTER_RECOVERY_RUNBOOK*`).

## 3. Acceptance criteria
RLS regression test green across all tenant tables; SAML+SCIM pass IdP cert (Okta/Azure AD); audit log hash-chain verifiable; air-gap install runbook validated; SOC2 controls mapped with automated evidence.
