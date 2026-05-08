# Incident Response Agent Design

**Denver Engineering — Ava Phase 5 (v5.0.0)**

## Purpose

The IncidentResponseAgent triages operational incidents, determines severity, coordinates multi-team response, and generates incident reports.

## Capabilities

| Capability ID | Task Types | Approval Required |
|---------------|-----------|-------------------|
| `incident.triage` | `triage_incident`, `auto_escalate`, `notify_stakeholders` | No |
| `incident.coordinate` | `coordinate_response`, `generate_incident_report` | **Yes** |

## Governance Level: High

High governance because:
- Incident response triggers cross-team actions
- Auto-escalation affects executive visibility
- Incident reports go to external stakeholders

## Severity Classification

```
alertCount ≥ 10 → 'critical'
alertCount ≥ 5  → 'high'
alertCount ≥ 2  → 'medium'
alertCount < 2  → 'low'
```

Alert count is derived from `context.activeAlerts` — events in `realtime_event_log` of types `sla_breached`, `action_escalated`, `blocker_added` in the last 24 hours.

## Decision Trace

```typescript
{
  decisionType: 'incident_triage',
  rationale: '{N} active alerts, severity {level}',
  confidence: 88,
  policyContext: { alertCount },
  chosenAction: severity,
}
```

## Output Schema

```typescript
{
  incidentId: string     // e.g. 'inc-a1b2c3d4'
  severity: string       // 'low' | 'medium' | 'high' | 'critical'
  responders: string[]   // user IDs assigned to respond
  alertCount: number
}
```

## Incident Response Plan Flow

```
1. triage_incident (no approval) → severity determination
2. analyze_risk (no approval) → risk context
3. notify_stakeholders (no approval) → alert affected parties
4. coordinate_response (requires approval) → multi-team mobilization
```

This maps to the `incident_response` objective in the orchestrator.

## Integration with Alert System

IncidentResponseAgent reads from `context.activeAlerts` assembled by `AgentContextBuilder._fetchActiveAlerts`. Real-time events from `realtime_event_log` are the primary signal source.
