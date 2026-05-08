# Long-Term Maintainability

**Denver Engineering — Phase 12**  
**Status:** Active | **Version:** 12.0.0

---

## Overview

Four services ensure the platform remains maintainable over years of growth: technical debt tracking, service lifecycle management, deprecation coordination, and version compatibility matrix generation.

---

## Services

| Service | Purpose |
|---------|---------|
| `technicalDebtTracker` | Identifies and quantifies open technical debt |
| `serviceLifecycleManager` | Manages service version lifecycle states |
| `deprecationCoordinator` | Tracks and communicates deprecation schedules |
| `compatibilityMatrixGenerator` | Generates version compatibility matrices |

---

## Technical Debt Tracking

### Total Effort
```
totalDebtEffort = sum(estimatedEffortDays) for open items (resolvedAt = null)
```

### Blocking Debt
```
hasBlockingDebt = any item with:
  severity = 'critical' AND replayImpact = true AND resolvedAt = null
```
Blocking debt must be resolved before any replay-adjacent change is accepted.

### Debt by Severity
Counts of open items grouped by `severity` (critical / high / medium / low).

### Debt Risk Classification

| Total Effort | Risk |
|--------------|------|
| > 90 days | `critical` |
| > 45 days | `high` |
| > 15 days | `medium` |
| ≤ 15 days | `low` |

---

## Service Lifecycle States

```
active → deprecated → removed
```

### State Helpers
```
isServiceActive  = status = 'active'
isServiceSunset  = status = 'removed' OR (sunsetAt ≤ now)
daysUntilSunset  = ceil((sunsetAt − now) / 86,400,000)   (null if no sunsetAt)
countByStatus    = group records by status → Record<status, count>
```

---

## Deprecation Coordination

### Deprecated Check
```
isDeprecated = deprecatedAt ≤ now
isPastSunset = sunsetAt ≤ now
daysToSunset = ceil((sunsetAt − now) / 86,400,000)
```

### High-Impact Deprecation
```
isHighImpact = affectedTenantsCount ≥ 10 OR migrationPath = null
```
High-impact deprecations require:
1. Minimum 90-day advance notice to affected tenants.
2. Migration path documented before announcement.
3. CSM outreach to all affected tenants.

---

## Compatibility Matrix

### Full Compatibility
```
isFullyCompatible = compatible AND replayCompatible AND schemaCompatible AND breakingChanges.length = 0
```

### Compatibility Risk

| Condition | Risk |
|-----------|------|
| !replayCompatible OR !schemaCompatible | `high` |
| !compatible | `medium` |
| breakingChanges.length > 0 | `low` |
| All clear | `none` |

### Migration Required
```
requiresMigration = !schemaCompatible OR breakingChanges.length > 0
```

---

## Key Tables

| Table | Description |
|-------|-------------|
| `p12_technical_debt` | Open and resolved debt items |
| `p12_service_lifecycle` | Service version states with deprecation dates |
| `p12_deprecations` | Deprecation records with tenant impact |
| `p12_compatibility_matrix` | Version-to-version compatibility entries |

---

## Maintainability Health Targets

| Metric | Target |
|--------|--------|
| Total open debt effort | < 45 days |
| Blocking debt items | 0 |
| Services past sunset | 0 |
| High-impact deprecations without migration path | 0 |
| Incompatible upgrade paths in matrix | < 5% |

---

## Operational Guidance

- **Blocking debt** halts all replay-adjacent work until resolved.
- Services within 30 days of sunset trigger automated tenant notifications.
- Compatibility matrices are generated for every minor and major version bump.
- `high` compatibility risk upgrades must be tested in staging for ≥ 1 week before production.
- Debt items are **never deleted** — resolved items are closed via `resolvedAt`.
