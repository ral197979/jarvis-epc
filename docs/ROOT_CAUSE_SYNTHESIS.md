# Root Cause Synthesis Engine

**Denver Engineering — Ava Phase 7 (v7.0.0)**

## Overview

The root cause synthesis engine correlates evidence from three independent data sources — anomaly records, real-time events, and state change history — to produce a structured root cause report with ranked contributing factors and mitigation suggestions.

## Evidence Sources

### 1. Anomaly Evidence
Queries `operational_anomalies` for open anomalies within the time window, grouped by type and severity. Severity scoring: critical=80, high=60, medium=40, low=20.

### 2. Event Evidence
Queries `realtime_event_log` for high-frequency events. Only events with count ≥ 3 are surfaced as candidates (noise filter). Gracefully skips if table doesn't exist.

### 3. State Change Evidence
Queries `twin_state_snapshots` with JOIN on `operational_twins` to find fields that changed frequently. Requires ≥ 2 changes per field to qualify as a candidate. Gracefully skips on missing tables.

## Correlation Algorithm

Each evidence source produces `RootCauseCandidate` objects with:
- `causeType`: `anomaly:<type>`, `event:<type>`, or `state_change:<field>`
- `confidence`: 0–1, computed from count
- `contributionScore`: 0–100, severity-weighted
- `affectedEntities`: list of entity UUIDs

Candidates are sorted descending by `contributionScore`. The top candidate becomes the `primaryCause`; the next 4 become `contributingFactors`.

## Mitigation Generation

Mitigations are generated based on `primaryCause.causeType`:

| Cause Type | Mitigation |
|-----------|-----------|
| `anomaly:*` | Resolve open anomalies, run detection sweep |
| `event:*` | Investigate event source, check pipeline |
| `state_change:*` | Audit changes to field, review governance policies |

## Output Structure

```typescript
interface RootCauseReport {
  incidentId: string       // random UUID per synthesis
  tenantId: string
  primaryCause: RootCauseCandidate
  contributingFactors: RootCauseCandidate[]
  mitigationSuggestions: string[]
  synthesizedAt: Date
}
```

## API

```
POST /api/v1/optimization/root-cause
{
  "entityId": "<uuid>",        // optional — scope to specific entity
  "entityType": "project",     // optional
  "windowHours": 24,           // default 24h
  "anomalyIds": ["a-1", "a-2"] // optional — force-include specific anomalies
}
```

## Unknown Cause

When zero evidence is found (all three sources return empty), the report returns a primary cause of type `unknown` with confidence 0.1. This is not an error — it means the system lacks sufficient signal to make a determination.

## Integration with Phase 6 Anomaly Radar

The `AnomalyRadar` component can pass selected anomaly IDs to the root cause endpoint to trigger targeted synthesis. Results are surfaced in the mitigation panel.
