# Fly Production Baseline (read-only inspection — nothing below was changed)

- App: `denver-epc`
- Organization: `personal`
- Region: `iad`
- Current release: **v5**, deployed 2026-07-02T13:30:48Z (still the pre-PR#18 build — PR #18 has not been deployed to production)
- Machine: `6836e9b7127418`, process group `app`, state `started`, `shared-cpu-1x:1024MB`
- Health: `flyctl checks list` → 1 check (`servicecheck-00-http-3001`), **passing**
- Secrets present (names/digests only, never retrieved as values): `JWT_SECRET`, `DATABASE_URL`. `DATABASE_URL_APP` is **not present**.
- Release history: v1 (failed, 2026-07-02 02:13), v2–v5 (complete)
- Rollback candidate: **v5 is primary** (it is the currently-running, currently-healthy release — see the correction in `fly-release-2026-07/SAFE_STOP_REPORT.md`); v4 is a secondary fallback only if v5 is later shown unsuitable.
- Recurring, pre-existing, non-fatal `[scheduler] [promoter] Failed` log lines observed — see `SCHEDULER_PROMOTER_BASELINE.md`. Health remains green throughout.

## Production modifications made by this task
**None.** No `flyctl deploy`, `flyctl secrets set`, `flyctl scale`, `flyctl machine restart`, or any other mutating Fly command was run against `denver-epc` at any point in this task. Every command above was read-only (`status`, `machines list`, `releases`, `secrets list`, `checks list`, `logs`).
