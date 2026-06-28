# ADR-006 — Digital Thread

- **Status:** Accepted (2026-06-27)
- **Decider:** Federation Architecture Council
- **Related:** `ECOSYSTEM_INTEGRATION_CONTRACT.md` §6, ADR-003, ADR-004, ADR-007

## Context
EPC value depends on traceability: from a requirement through calculation, drawing, equipment,
procurement, construction, commissioning, turnover, to operations. If each repo keeps its own
disconnected records, no one can answer "what did this derive from?" or "what does changing this affect?"

## Decision
Maintain a **Digital Thread** spanning the lifecycle, expressed as **registry-UUID references** (ADR-003)
over the knowledge graph (ADR-007). Each lifecycle hop is **asserted by the system that owns that hop**,
carries **provenance** (the source event/document), and is built incrementally — ideally **auto-contributed
from canonical events** (ADR-004). Denver hosts the cross-system **thread index**; navigation is both
**backward** (to origin) and **forward** (to downstream artifacts).

## Consequences
- **Positive:** end-to-end provenance and upstream/downstream navigation; supports audit, change-impact, and AI
  reasoning; no data islands.
- **Negative / cost:** continuity depends on every owner emitting edges with provenance; requires
  persistence (follow-up beyond PR #4's in-memory traversal).
- **Neutral:** the thread is a *view* over graph edges + registry objects, not a separate store of record.

## Alternatives considered
- **Point-to-point links between repos.** Rejected — N×N, fragile, no global view.
- **Centralized data warehouse copy of everything.** Rejected — duplicates ownership, goes stale, violates
  "reference, don't copy."
