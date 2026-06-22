# Alert Certification Report (Phase 6)

**Date:** 2026-06-22

## Verdict: 🟡 Rules validated + 2/5 classes fired locally; production trigger/route/escalation PENDING

### Collected evidence (local, real)
- All rules syntactically valid: `promtool check rules` → **6 rules SUCCESS**.
- Routing/escalation valid: `amtool check-config` → **SUCCESS** (severity routes, hourly critical re-page, inhibit rule).
- Firing demonstrated against a live local Prometheus (down target): `ApplicationUnavailable` + `BackupMetricMissing` → **firing** (`audit/evidence/prom_alerts_firing.json`).

| Required alert class | Rule | Fires (local) | Route/Escalation/Recovery (prod) |
|---|---|---|---|
| Service unavailable | `ApplicationUnavailable` (`up==0`) | ✅ fired | PENDING |
| Database unavailable | `DatabaseUnavailable` (`denver_db_up==0`) | ✅ rule valid (inject db-down to fire) | PENDING |
| Backup failure | `BackupFailure` / `BackupMetricMissing` | ✅ `BackupMetricMissing` fired | PENDING |
| Storage anomaly | `QueueFailure` covers job failures; **storage-specific probe metric not yet emitted** | rule valid | PENDING (+ add storage probe metric if a dedicated class is required) |
| Latency threshold | `HighErrorRate` (5xx ratio); **a p99-latency rule can be added from `http_request_duration_ms`** | rule valid | PENDING |

**Reasons pending:** triggering each class in production and verifying delivery → escalation → recovery-clear requires the deployed monitoring stack + prod environment (no access here).
**Note (no new features):** a dedicated *storage-anomaly* and *latency-threshold* alert can be expressed from existing metrics (`http_request_duration_ms`) — flagged for the operator to enable; not added here to honor the no-scope-expansion rule.
**Acceptance:** for each class, capture fired alert + routed notification + recovery-cleared (`operator-kit.sh` WS4).
