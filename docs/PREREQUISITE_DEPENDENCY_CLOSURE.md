# Prerequisite: Runtime Dependency Closure for PR #1

**Branch:** `chore/dependency-closure-prereq` · **Base:** `main`
**Purpose:** land pre-existing runtime modules that the security-audit PR ([#1](https://github.com/ral197979/jarvis-epc/pull/1)) imports but that were **never committed to any branch**. This keeps PR #1 scoped to audit/security/ops changes.

## Why this PR exists
The audit was performed against a working tree where a body of subsystem code (SAML 2.0 SSO, SCIM 2.0, CSRF middleware, observability) existed **only on disk** — `git log --all` shows 0 commits for these files. `main`'s `server.ts` is an older version that does not reference them. PR #1's `server.ts` (with audit edits) wires them in, so PR #1 cannot compile until these modules exist in the repo. This PR commits exactly that closure.

## Contents (non-audit runtime modules only)
| File | Subsystem |
|---|---|
| `api/routes/scim.ts` | SCIM 2.0 provisioning |
| `api/middleware/csrf.ts` | CSRF protection |
| `api/services/observability/errorTracking.ts` | Error tracking (Sentry) |
| `api/auth/saml/samlRoutes.ts` | SAML SSO |
| `api/auth/saml/samlProvider.ts` | SAML SSO |
| `api/auth/saml/samlMetadata.ts` | SAML SSO |
| `api/auth/saml/samlTokenBridge.ts` | SAML SSO |
| `api/auth/saml/certificateRotation.ts` | SAML SSO |
| `api/auth/saml/roleMapping.ts` | SAML SSO |
| `api/services/observability/metrics.ts` | Metrics — **base/pre-audit form** (see below) |

## Note on `metrics.ts` (important)
`metrics.ts` is included **only** because `api/auth/saml/samlRoutes.ts` imports the pre-existing
counter `authSamlLoginTotal` from it (a runtime dependency). It is committed here in its
**base / pre-audit form**:
- ✅ Keeps all pre-existing counters/histograms (HTTP, auth, SAML, job, SCIM).
- ❌ **OPS-003** (db/backup gauges, `setDbUp`, `recordBackupSuccess`) — NOT here.
- ❌ **OPS-004** (fail-closed `/metrics`) — NOT here; the base handler is token-optional.

**The OPS-003 and OPS-004 security changes remain in PR #1**, where they appear as a visible
diff against this base `metrics.ts`. No other audit remediation files are included in this PR.

## Scope guarantees
- No audit remediation files (ssrfGuard, wsTicket, enterprise authz, migrations, etc.).
- No OPS reports, release notes, certification docs, or operator evidence.
- Only compile/lint fixes were made inside the closure files (unused-import removals).

## Merge order
Merge this PR **first**, then PR #1 rebases/retargets onto it and compiles cleanly.
