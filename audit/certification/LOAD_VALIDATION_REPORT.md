# Load Validation Report (Phase 7)

**Date:** 2026-06-22

## Verdict: 🟡 Single-instance profile validated (local); production-scale PENDING

### Collected evidence (local, real — `audit/evidence/CLOSURE_EVIDENCE.md §4`, authenticated DB read `GET /api/v1/projects`)

| Concurrency | p50 | p99 | Throughput | Errors |
|---|---|---|---|---|
| 100 | 18 ms | **28 ms** | ~5,300 rps | 0 |
| 500 | 91 ms | **209 ms** | ~5,114 rps | 0 |
| 1000 | 199 ms | **739 ms** | ~4,634 rps | 0 |
| 5000 | 816 ms | **7,497 ms** | ~4,758 rps | 448 (saturation, **no crash**) |

- Graceful degradation, no crash at 5000 concurrent connections (pool-bound).
- Rate limiter sheds load correctly under stress (429 beyond 600/min/IP) — DoS protection verified.

| Item | Status | Reason / how to collect |
|---|---|---|
| Throughput / latency (prod-scale) | PENDING | run on Render plan-matched staging (no access here) |
| CPU / memory / network | PENDING | Render metrics during the run |
| DB load / connection pool | PENDING | Render Postgres metrics; raise `DB_POOL_MAX` + pooler beyond 1–2 instances |
| Error rate (prod) | PENDING | capture during load |
| No alert regressions during load | PENDING | requires deployed monitoring (Phase 2) |

**Capacity note:** single instance ≈ 5k rps on the authenticated DB path; scale horizontally on Render + add PgBouncer beyond ~2 instances.
**Acceptance:** prod-scale load (100/500/1000 + burst) with the resource telemetry above (`operator-kit.sh` WS2).
