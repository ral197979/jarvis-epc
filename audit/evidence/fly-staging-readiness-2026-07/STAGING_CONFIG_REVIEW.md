# Staging Configuration Review

- Path: `fly.staging.toml` (repo root, alongside production's `fly.toml`)
- App target: `denver-epc-staging` only — enforced by `scripts/validate-fly-staging-config.mjs` (CI-gated, see `VALIDATION_RESULTS.md`)
- Process model: single process group (`app`), single machine — identical topology to production, preserving the current in-process web+scheduler architecture (see `WORKER_TOPOLOGY.md`)
- Health route: `GET /api/v1/health`, `interval=30s timeout=5s grace_period=60s` — identical to production
- Machine size: `shared-cpu-1x:1024MB` — identical to production's smallest tier
- Scale: `min_machines_running = 0`, `auto_stop_machines = true` (staging-appropriate — cost control; production stays `min_machines_running = 1` and `auto_stop_machines = false`, unchanged)
- Non-secret environment metadata: `APP_ENV = "staging"`, `LOG_LEVEL = "debug"` (more verbose than production's `"info"`, appropriate for a diagnosis environment). `NODE_ENV` is intentionally left `"production"` so staging exercises the app's real production code paths (including the `DATABASE_URL_APP` fail-closed check from PR #18) rather than a separate "development" branch of logic — `APP_ENV` is what actually distinguishes the environment for anything that needs to know.
- Contains no database URL, token, password, or private key — verified both by manual review and by `scripts/validate-fly-staging-config.mjs`'s automated checks (no `postgres://` pattern, no password-shaped assignment).
- Same `Dockerfile.api` as production — no staging-only build path, so what's proven in staging is the same artifact-build process production uses.

## Fly validation
```
$ flyctl config validate --config fly.staging.toml --app denver-epc-staging
Validating fly.staging.toml
✓ Configuration is valid
```
