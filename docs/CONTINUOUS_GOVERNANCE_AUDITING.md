# Continuous Governance Auditing

**Denver Engineering — Phase 12**  
**Status:** Active | **Version:** 12.0.0

---

## Overview

Governance auditing runs on a continuous schedule to verify that all platform invariants hold in production. Three services cover the full audit lifecycle: cycle execution, regression detection, and replay consistency enforcement.

---

## Services

| Service | Purpose |
|---------|---------|
| `continuousGovernanceAuditor` | Runs audit cycles, hashes results |
| `governanceRegressionMonitor` | Detects check status regressions |
| `replayConsistencyMonitor` | Enforces zero-tolerance replay determinism |

---

## Audit Cycles

### Cycle Hash
Each cycle produces a deterministic 24-character hex hash from its check results:
```
hash = SHA-256(canonical JSON of sorted checks)[0..24]
```
Sorted by check name to ensure determinism across runs.

### Cycle Status

| Condition | Status |
|-----------|--------|
| Any check failed | `non_compliant` |
| Any warning (no failures) | `warning` |
| All passed | `compliant` |

A cycle is **passing** only when `status === 'compliant'` AND `failed === 0`.

### Pass Rate
```
passRate = passing / total   (1.0 for empty set)
```

---

## Regression Detection

A regression is detected when a check **worsens**:
- `pass → warn`
- `pass → fail`
- `warn → fail`

Status improvements (`fail → pass`, etc.) do not trigger regressions.

### Severity Classification

| Condition | Severity |
|-----------|---------|
| Critical check type (see below) | `critical` |
| Any `pass → fail` transition | `critical` |
| All other regressions | `warning` |

**Critical check types:**
- `replay_integrity`
- `tenant_isolation`
- `plugin_isolation`
- `billing_correctness`

### Open Critical Regressions
An open critical regression (`severity = 'critical'` AND `resolvedAt = null`) is a **P0 incident** requiring immediate engineering response.

---

## Replay Consistency (Zero Tolerance)

### Hash Computation
```
replayHash = SHA-256(canonicalJSON(payload, sortedKeys))  →  64-char hex
```
Canonical JSON uses lexicographically sorted keys at every nesting level.

### Consistency Rate
```
consistencyRate = passed / checked   (1.0 if checked = 0)
```

### Zero Tolerance Enforcement
```
isConsistencyAcceptable = (consistencyRate === 1.0)
```
Any `consistencyRate < 1.0` is unacceptable and must halt the affected stream.

---

## Key Tables

| Table | Description |
|-------|-------------|
| `p12_governance_audit_cycles` | One record per audit cycle |
| `p12_governance_regression_alerts` | Regression events with resolution tracking |
| `p12_replay_consistency_records` | Per-stream consistency checks |

---

## Operational Guidance

- **Audit frequency:** Minimum once per hour in production, every 15 minutes in pre-production.
- **Non-compliant cycles:** Open a P1 incident; do not deploy until the cycle returns to compliant.
- **Replay divergence:** Immediately halt the affected tenant stream; investigate root cause; never auto-retry without hash verification.
- **Audit hash rotation:** A hash change between identical check sets indicates a non-determinism bug — escalate to engineering.
- All audit records are **append-only**; never delete or update governance records.
