# ADR-004 — Canonical Event Specification

- **Status:** Accepted (2026-06-27)
- **Decider:** Federation Architecture Council
- **Related:** `ECOSYSTEM_INTEGRATION_CONTRACT.md` §4, ADR-003, ADR-009, `FEDERATION_CHANGE_POLICY.md`

## Context
Repositories must coordinate via events without coupling to each other's internal vocabularies. Menlo
emits `FATCompleted`; Denver thinks in `cx.*`; future repos will have their own names. A shared, versioned
vocabulary is needed so events remain interpretable as the federation grows (Operations, Facilities,
Finance, …).

## Decision
Adopt a **canonical event vocabulary** in dotted `domain.action` form (e.g. `fat.completed`,
`project.created`). Each repository maps its internal names to canonical **at its own edge** (publisher
maps out, subscriber maps in). Every envelope carries:
`spec_version, event_id, event_name, tenant_id, project_id, subject_uuid, occurred_at, correlation_id,
data`. Compatibility is governed by `FEDERATION_CHANGE_POLICY.md`: additive by default, breaking →
new `spec_version`, consumers ignore unknown fields, deprecation windows, **at-least-once delivery**, and
**idempotent consumers** (dedupe on `(tenant_id, event_id)`).

## Consequences
- **Positive:** loose coupling; new repos subscribe without touching publishers; versioning makes evolution
  safe; `subject_uuid` ties events to the UOS (ADR-003) and the digital thread (ADR-006).
- **Negative / cost:** an edge-mapping adapter per repo; ordering is not guaranteed across transports, so
  consumers must be idempotent and order-tolerant.
- **Neutral:** transport starts as signed webhooks and may graduate to a broker (contract §13 standing
  decision) without changing the envelope.

## Alternatives considered
- **Each repo broadcasts its own event names.** Rejected — N×N translation and brittle coupling.
- **Unversioned envelope.** Rejected — the first vocabulary change would break every subscriber; `spec_version`
  is cheap now and essential later.
- **Exactly-once delivery guarantee.** Rejected as a base assumption — costly/fragile; idempotent
  consumers achieve the same effect.
