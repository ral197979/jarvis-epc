# ADR-003 — Universal Object Service

- **Status:** Accepted (2026-06-27)
- **Amended by:** [ADR-009](ADR-009-crania-absorbs-aec.md) — Crania absorbed the former Ava-Engineering-Core (AEC) engine (2026-07-01); read every "AEC" below as **Crania**.
- **Decider:** Federation Architecture Council
- **Related:** `ECOSYSTEM_INTEGRATION_CONTRACT.md` §3, §3.1, §13, ADR-006, ADR-007, ADR-009

## Context
For the federation to behave as one platform, an equipment tag like `LT-101` must be the *same object*
across Denver, AEC, and Menlo. Copied names and per-repo surrogate keys cause drift, duplicate identities,
and unresolvable references. A shared identity model is the linchpin of the digital thread and knowledge
graph.

## Decision
Adopt a **Universal Object Service (UOS)**: every real-world object has **one immutable UUID**, minted by
its owning system (minting-authority table, §3), and every other repository **stores references only** and
**resolves through the UOS**. The UOS provides issuance, resolution (`object_type + uuid` → canonical
record), owner lookup, external/legacy-ID mapping, aliases, merge/supersede/tombstone, version history,
discovery, and reference validation. Identity is immutable; lifecycle changes are expressed via
`superseded-by` / `merged-into` / `tombstoned`, never by mutating or reusing a UUID. Denver is the initial
host/orchestrator (§13); issuance still follows the per-type minting authority.

## Consequences
- **Positive:** one object end-to-end; safe forever-references; clean legacy migration (preserve old ids
  as external/legacy mappings, e.g. Menlo `externalId`); foundation for thread + graph.
- **Negative / cost:** requires a real service (store + resolution API + lifecycle) — this is follow-up
  implementation beyond the PR #4 vocabulary; introduces a resolution dependency (cache/replicate to
  manage latency/availability).
- **Neutral:** PR #4 ships only the identity *vocabulary + minting guardrails*; the persistent service is
  scheduled separately.

## Alternatives considered
- **Code-level UUID vocabulary only (no service).** Rejected as the end state — without resolution/lifecycle
  no repo can reliably resolve another's objects; acceptable only as the first phase.
- **Each repo owns its own ids; map at integration points.** Rejected — N×N mapping, drift, duplicate
  identities.
- **Natural keys (tag strings) as identity.** Rejected — tags get renamed/revised; not stable.
