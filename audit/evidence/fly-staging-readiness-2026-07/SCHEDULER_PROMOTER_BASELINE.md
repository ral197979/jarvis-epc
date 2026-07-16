# Scheduler/Promoter Error Baseline (documentation only — not fixed in this task)

## Exact component
`api/services/scheduler.ts`, function `_tick()` (lines ~285-295 as of this task): every scheduler poll tick (production poll interval observed as ~5s at process boot, per this session's earlier `[scheduler] Started ... poll=5000ms` log line) iterates all registered "promoters" and wraps each in a try/catch:

```ts
for (const promoter of _promoters) {
  try {
    await promoter()
  } catch (err) {
    slog('ERROR', 'scheduler', '[promoter] Failed', {
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
```

Three promoters are registered at startup:
- `complianceWatcher.ts` → `_scanComplianceTasks`
- `integrationSync.ts` → `_promoteDueIntegrations`
- `slaEngine.ts` → `_scanOverdueActions`

## Redacted error signature
Every occurrence in the production log stream is the identical, generic line:
```
[JARVIS:scheduler] [promoter] Failed
```
**No further detail is available from the log stream** — and this is itself a real, separate finding, documented below, not glossed over.

## Root cause of the missing detail (a genuine logging gap, found during this task)
`slog()` (`src/modules/observability/index.ts`) is called with a `data` argument containing the actual caught error's `message` — but `slog`'s console-output path only ever prints `` `[JARVIS:${category}] ${msg}` `` (`fn(...)` call, ~line 46 of that file). **The `data` object is stored in an in-memory ring buffer (`structuredLog`) but is never written to stdout/console at all.** Since Fly's log stream only captures stdout, the underlying error message, and even *which* of the three registered promoters failed, are both lost before they ever reach a log a human or this task could read. This was confirmed by fetching both the plain and `--json` Fly log output — both show only the generic line.

## Occurrence window observed
Two separate bounded log fetches during this task (2026-07-16, roughly `19:25`–`20:30 UTC`) both show the line recurring at irregular intervals of roughly 1–5 minutes (not every 5-second tick — so the underlying promoter's own logic must be gating or intermittently succeeding, or Fly's log retention/sampling is not capturing every occurrence; can't distinguish which from available evidence). Fly's default log retention window is short, so the **true first occurrence is not determinable** from what's currently retained — only that it predates this task's observation window, and per the merged-PR timeline it also predates PR #18 (the machine currently running is still on the pre-PR#18 v5 release).

## Classification
| Question | Answer | Confidence |
|---|---|---|
| Crashes the process? | **No** — each promoter call is individually try/caught; one failing promoter cannot block the tick or the process (comment in source: "Each failure is isolated so one bad promoter can't block the tick"). | High (proven by source read) |
| Causes a machine restart? | **No** — `flyctl status`/`flyctl machines list` show the same machine (`6836e9b7127418`) continuously `started` with no restart count increase correlated to these log lines, both at initial inspection and at this task's re-inspection days later. | High |
| Health remains green? | **Yes** — `flyctl checks list` shows the health check passing throughout; the health endpoint doesn't probe promoter state at all, only DB/Redis connectivity. | High |
| Caused by missing configuration? | **Unknown / unprovable from available evidence.** Plausible (e.g. an unset integration config, an unset SLA policy table row) but not confirmed. | Low — explicitly not claimed as fact |
| Caused by data? | **Unknown / unprovable.** Equally plausible as a configuration cause. | Low |
| Caused by an unavailable dependency? | **Unlikely to be a hard dependency outage** — if it were, health would very likely also degrade (DB/Redis checks share the same connection pool as these services), and it hasn't. Not certain. | Low-medium |
| Present before PR #18? | **Yes** — the currently-running machine is still on pre-PR#18 code (release v5, deployed 2026-07-02), and the error is present now. Pre-existing, not introduced by PR #18. | High |
| Should it block staging infrastructure creation? | **No** — staging infrastructure creation (this task) doesn't depend on this being fixed; the staging app itself starts with zero deployed release. | — |
| Should it block a future production deployment of PR #18? | **No, but it should be diagnosed first if practical** — it's non-fatal and pre-existing, so it does not itself block promotion. However, because the underlying error text is currently unrecoverable from logs (see above), anyone deploying PR #18 to production should not assume "no new errors" == "no errors" for this specific class of failure — the logging gap silently hides detail regardless of what's deployed. | Medium |

## Explicitly not done in this task
- Not fixed: the promoter's underlying failure.
- Not fixed: `slog`'s missing `data`-to-console behavior (the logging gap itself). This would be a small, real, worthwhile fix, but it's out of this task's scope ("Do not fix the errors in this slice").
- Not filed as a tracked issue: this repository's established workflow doesn't include a lightweight `gh issue create` convention evidenced elsewhere in this codebase's history (no existing "Issues" usage was found), so per this task's instruction ("record the follow-up recommendation in the PR and final report" when issue creation isn't clearly supported), the recommendation is recorded here and in the PR description instead.

## Follow-up recommendation
1. Fix `slog()` to include `data` in its console output (or route it through the structured pino logger already used elsewhere in `api/server.ts`) so promoter failures — and which promoter failed — are actually diagnosable from production logs going forward.
2. Once diagnosable, re-run this classification with real error text before deciding whether it's config, data, or dependency-caused.
