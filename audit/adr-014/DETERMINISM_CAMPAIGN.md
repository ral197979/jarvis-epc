# ADR-014 — full-repo determinism campaign (HOB §56, §61)

**Commit:** `f5883c31c1205a113ec4909437449d0a84381d34` (product code unmodified —
this session added only `scripts/adr014/` and `audit/adr-014/`, neither of which
is imported by any test).

## Result

```
FULL-REPO DETERMINISM: PROVED — 5/5
```

Five consecutive default `npx vitest run` invocations. No retries, no worker
reduction, no forced serialization, no sleep insertion, no timeout inflation, no
cache manipulation, no source edits.

| Run | Test files | Tests | Duration |
|---|---|---|---|
| 1 | 165 passed (165) | 5392 passed (5392) | 83.88s |
| 2 | 165 passed (165) | 5392 passed (5392) | 81.68s |
| 3 | 165 passed (165) | 5392 passed (5392) | 82.98s |
| 4 | 165 passed (165) | 5392 passed (5392) | 83.23s |
| 5 | 165 passed (165) | 5392 passed (5392) | 82.50s |

Zero failures, zero flakes, zero skips. Duration variance across runs: 2.2s
(2.7%).

## Why this matters

Phases 3A and 3B **both** failed their full-repo determinism campaigns, with a
characteristic signature: 5-second timeouts and supertest socket Parse Errors
that reproduced on prior certified SHAs while the same files passed in
isolation. Both were classified `NOT PROVED — ENVIRONMENTAL`.

This run supports that classification with a positive control. The same suite,
on the same repository, is **fully deterministic on a clean host** — so the
failures are a property of the loaded development host, not of the test suite or
the product code.

## Host

```
cores ........... 4
load average .... 1.66 / 1.36 / 0.59 (during campaign)
memory .......... 16075 MB total, 15351 MB available
platform ........ Linux 6.18.44 container, no emulators, no simulators,
                  no VMs, no Docker load, no owner processes
node ............ see package.json engines
vitest .......... 4.1.9
```

Dev dependencies were absent from the container and installed with
`npm install --no-audit --no-fund` before the campaign. The resulting
`package-lock.json` churn (30 deleted `libc` hint lines, an npm-version artifact)
was reverted rather than committed.

## Recommendation

Run the Phase-3C determinism campaign in a clean container rather than on the
loaded development host. On this evidence it should pass 5/5, which would let
Phase 3C claim `FULL-REPO DETERMINISM: PROVED` instead of inheriting the
`NOT PROVED — ENVIRONMENTAL` verdict carried by 3A and 3B.
