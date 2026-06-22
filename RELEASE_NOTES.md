# Release Notes — v4.32.0

**Type:** Security + Operations remediation (no new features, no architectural changes)
**Branch:** `audit/enterprise-remediation-2026-06-21` · PR [#1](https://github.com/ral197979/jarvis-epc/pull/1) · Commit `d8a4b5e`
**Status:** 🟢 Enterprise Ready (Engineering) · 🟡 Pending Operations Certification (production evidence outstanding)

## Highlights

Closes the independent enterprise security audit (1 Critical + 8 High) and the code-level operations findings (OPS-001/002/004), each with verification evidence (`docs/AUDIT_CLOSURE_SUMMARY.md`).

### Security
- **Critical:** enterprise tenant-lifecycle routes are now authorization-guarded — previously any authenticated user could suspend/archive any tenant (AUD-001).
- Multi-tenant **RLS now actually enforces** via a non-owner DB role (AUD-002, proven at runtime).
- Removed a cross-tenant audit-read bypass (AUD-003).
- Central **SSRF guard** on all outbound user-controlled fetches; MCP fetch is default-deny (AUD-004/005).
- File-upload hardening: SVG removed from allowlist, `nosniff` + octet-stream downloads (AUD-006).
- LLM-generated HTML **sanitized** before render (AUD-007).
- **Dependencies** remediated to 0 critical / 0 high (AUD-009).
- WebSocket auth moved from query-string JWT to a **single-use connection ticket** (AUD-010).
- Migration chain now **rebuilds cleanly from scratch** (AUD-031).

### Operations
- **S3 storage backend made functional** (SDK installed + ESM fix + render.yaml config) — was broken at runtime (OPS-001).
- **Encryption at rest** enforced on all upload paths (SSE-AES256) (OPS-002).
- `/metrics` **fails closed** when no token is configured (OPS-004).
- Production **alerting authored + validated**: Prometheus rules (5 classes), Alertmanager routing/escalation; demonstrated firing locally (OPS-003 — production deployment pending).

## Breaking changes
None. New behavior is opt-in / non-breaking by default:
- AUD-002 RLS enforcement activates only when `DATABASE_URL_APP` is set.
- S3 backend requires `S3_BUCKET` + AWS credential secrets (already `STORAGE_BACKEND=s3` previously, but non-functional).

## Required operator actions before production deploy
1. Set Render secrets: `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (+ `S3_ENDPOINT` if R2/MinIO), `METRICS_TOKEN`.
2. To activate RLS enforcement: provision `jarvis_app` password + set `DATABASE_URL_APP`.
3. Enable bucket versioning/lifecycle/default-encryption; deploy the authored monitoring stack.
   Full checklist: `audit/OPERATIONS_CERTIFICATION_PROGRAM.md` §9.6 / `docs/RELEASE_SIGNOFF.md`.

## Verification
`npm ci` ✓ · `tsc` 0 errors ✓ · `vite build` ✓ · 408/408 security tests ✓ · `npm audit` 0 crit/0 high. See `BUILD_VERIFICATION_REPORT.md`.

## Known issues / exceptions
- 2 pre-existing date-relative unit tests fail in `actions-phase8c.test.ts` (unrelated).
- 7 pre-existing lint warnings in SAML/SCIM/QuickBooks modules (unrelated; not reopened).
- Production-validation evidence (PITR, prod-scale load, bucket governance, prod alert firing) outstanding — see signoff.
