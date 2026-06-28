# ADR-001 — Denver is the Enterprise EPC Delivery Platform

- **Status:** Accepted (2026-06-27)
- **Decider:** Federation Architecture Council
- **Related:** `ECOSYSTEM_INTEGRATION_CONTRACT.md` §1, ADR-002, ADR-008

## Context
The ecosystem needs a coherent product the user experiences as "one platform," while specialist
capabilities live in separate repositories. An early framing called Denver an "operating system / not an
engineering system," which contradicted the actual codebase (Denver already runs engineering workflow,
procurement, construction, cost, schedule, quality, risk, document control). Ambiguity about Denver's
role risks either a monolith or a hollow shell.

## Decision
Denver is the **Enterprise EPC Delivery Platform**: it owns the end-to-end EPC **business workflow**
(opportunity → proposal → engineering management → procurement → construction → quality/cost/schedule/risk
→ document control → turnover planning → portfolio/executive reporting) and **delegates technical
execution** to specialist engines. The user only ever sees Denver. Principle: **manage vs execute** —
Denver owns the workflow and lifecycle of every artifact; engines compute/render/execute behind it.

## Consequences
- **Positive:** clear single front door; no monolith; specialists stay specialists; Denver can orchestrate
  without reimplementing domain math/PLC/commissioning/doc rendering.
- **Negative / cost:** Denver depends on engines being reachable (mitigated by the Capability Registry,
  ADR-005, and graceful degradation).
- **Neutral:** Denver owns *records and workflow status* for things it does not execute (e.g. the
  engineering deliverable register; the document-control record vs EAP-rendered content, ADR-008).

## Alternatives considered
- **Denver as a pure orchestrator (owns no domain workflow).** Rejected — contradicts what Denver is and
  would split EPC workflow across repos, fragmenting the user experience.
- **Monolithic Denver (owns execution too).** Rejected — duplicates specialist logic, kills independent
  deployability, and scales poorly.
