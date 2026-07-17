/**
 * Denver Engineering — Release identity (infra/fly-staging-readiness)
 * ─────────────────────────────────────────────────────────────────────────────
 * Non-secret release identity surfaced on /api/v1/health so a deployed Fly
 * release can be tied back to an exact Git commit without shell access.
 *
 * APP_RELEASE_SHA is injected at deploy time via `flyctl deploy --env
 * APP_RELEASE_SHA=<sha>` (see .github/workflows/fly-staging-deploy.yml) — never
 * hand-typed, never derived from an uncommitted working tree. Absent in local
 * dev, where it resolves to null rather than a fabricated value.
 */

export interface ReleaseIdentity {
  releaseSha: string | null
  env:        string | null
}

export function getReleaseIdentity(): ReleaseIdentity {
  return {
    releaseSha: process.env['APP_RELEASE_SHA'] ?? null,
    env:        process.env['APP_ENV'] ?? process.env['NODE_ENV'] ?? null,
  }
}
