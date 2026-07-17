# Current Worker Topology (documentation only — unchanged in this task)

**Status:** as-observed, not redesigned. This task explicitly preserves this topology; it does not create a separate worker process, deploy `api/worker.ts`, or split web/background work.

## What actually runs today
- `Dockerfile.api`'s `CMD` is `npx tsx api/server.ts` — this is the **only** entrypoint the production (and now staging) Fly image runs.
- `api/server.ts`'s `start()` function (guarded by the `import.meta.url`/`process.argv[1]` main-module check) calls, in-process, in the same Node process as the Express HTTP server:
  - the scheduler (`api/services/scheduler.ts` — `startScheduler()`), which runs a poll tick (`_tick()`) roughly every 5 seconds;
  - the pack worker (`packWorker.ts`), IFC parse worker, and federated aggregation worker;
  - three registered scheduler "promoters" (see `SCHEDULER_PROMOTER_BASELINE.md`): `complianceWatcher.ts`, `integrationSync.ts`, `slaEngine.ts`.
- `api/worker.ts` **exists in the repository as a separate, standalone entrypoint** (its own `start()`/main-module guard, its own scheduler/pack-worker/etc. startup calls) but is **not referenced anywhere** in `Dockerfile.api`, `fly.toml`, or `fly.staging.toml`. It is dead infrastructure today — a second entrypoint that would let background work run as an independent Fly process group, but nothing invokes it.

## Fly process model (both production and staging, unchanged by this task)
- One Fly process group: `app` (fly.toml/fly.staging.toml define no `[processes]` block, so Fly uses the single default group).
- One machine (`min_machines_running = 1` in production; `= 0` with `auto_stop_machines = true` in staging, since staging doesn't need to be always-on — see `fly.staging.toml`).
- Web request handling and all background scheduling/promotion/worker execution share this single process and this single machine.

## Why this matters for scaling
No leader election, distributed lock, or job-claim mechanism beyond a single `FOR UPDATE SKIP LOCKED`-style claim inside a single process has been implemented or verified in this codebase for the scheduler/promoter/worker loop. Running **more than one machine** for either the production or the staging app today would mean:
- multiple copies of the same scheduler tick running concurrently,
- multiple promoters attempting the same due-work scan concurrently,
- a real risk of duplicate job execution (e.g., a background job claimed and processed twice, a promoter promoting the same due item twice) — the independent audit's "no separate worker process" finding did not previously flag this specific duplication risk, but it follows directly from the topology and is called out here for the first time.

## Staging-specific guard
**Do not scale `denver-epc-staging` (or `denver-epc`) above one active scheduler-bearing machine until scheduler leadership, locking, or duplicate-execution behavior is formally verified.** This is enforced today only by `fly.staging.toml`'s single `[[vm]]` block and the absence of a `[processes]` block with independent scaling — there is no code-level guard preventing a future config edit from scaling to N machines. `scripts/validate-fly-staging-config.mjs` checks that `fly.staging.toml` retains a single process group, but cannot by itself prevent someone from later running `flyctl scale count 2`.

## What would need to happen before splitting web/worker
1. Decide whether `api/worker.ts` should become a real second Fly process group (`[processes]` block: `app = "npx tsx api/server.ts"`, `worker = "npx tsx api/worker.ts"`), and whether `api/server.ts` should then stop starting the scheduler/pack-worker in-process (to avoid running it twice).
2. Verify or implement job-claim/promoter concurrency safety (distributed lock or `FOR UPDATE SKIP LOCKED` semantics already exist for the job queue itself per the independent audit — but the *promoters* run unconditionally on every tick with no claim/lock at all, per `scheduler.ts`'s `_tick()`).
3. Re-verify the health check and readiness semantics for a topology where "the app is healthy" and "the worker is healthy" become two different questions.

None of this was implemented or decided in this task — it is out of scope per this task's explicit "do not create a separate Fly worker process" boundary. Recorded here as the concrete prerequisite for whoever picks it up next.
