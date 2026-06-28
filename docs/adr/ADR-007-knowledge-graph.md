# ADR-007 — Knowledge Graph

- **Status:** Accepted (2026-06-27)
- **Decider:** Federation Architecture Council
- **Related:** `ECOSYSTEM_INTEGRATION_CONTRACT.md` §7, ADR-003, ADR-006

## Context
AI reasoning, root-cause analysis, impact analysis, semantic search, digital twin, and future autonomous
agents all need a connected, semantic model of how objects relate (`instrument measures equipment`,
`drawing defines equipment`, `test validates equipment`). Relationships scattered across repos cannot
power cross-system reasoning.

## Decision
Maintain a **shared knowledge graph**: **nodes are Universal Object references** (ADR-003), **edges are
typed relationships** from a governed taxonomy. Every repository contributes nodes/edges keyed by registry
UUID. Edges carry **ownership and provenance** (who asserted it, from what source). Traversal directions
are explicit and neutral (`dependencies` = outgoing, `impacts` = incoming) rather than forcing one
lifecycle direction onto heterogeneous verbs. The edge-type taxonomy is a governed contract (changes via
RFC).

## Consequences
- **Positive:** one substrate for reasoning/search/impact/root-cause and the digital thread (ADR-006);
  extensible via new edge types (additive, governed).
- **Negative / cost:** needs a persistent, governed graph store with provenance and relationship
  constraints (allowed from/to types per edge) — follow-up beyond PR #4's in-memory, cycle-safe library.
- **Neutral:** Denver indexes/hosts cross-system search; AEC remains the engineering source of truth for
  the objects themselves.

## Alternatives considered
- **Per-repo graphs.** Rejected — no cross-system reasoning; duplicated edges.
- **Untyped/free-form edges.** Rejected — unconstrained edges (`test measures system`) make reasoning
  unreliable; a governed taxonomy is required.
