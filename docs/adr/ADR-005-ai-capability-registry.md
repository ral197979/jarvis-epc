# ADR-005 — AI Capability Registry

- **Status:** Accepted (2026-06-27)
- **Amended by:** [ADR-011](ADR-011-crania-absorbs-aec.md) — Crania absorbed the former Ava-Engineering-Core (AEC) engine (2026-07-01); read every "AEC" below as **Crania**.
- **Decider:** Federation Architecture Council
- **Related:** `ECOSYSTEM_INTEGRATION_CONTRACT.md` §5, ADR-002, ADR-011

## Context
Denver must invoke specialist engines (design, calculation, drawing review, PLC, commissioning, document
generation) without hardcoding their URLs. Hardcoded endpoints make providers impossible to relocate,
version, or replace, and couple Denver's release cycle to theirs.

## Decision
Adopt an **AI Capability Registry**: callers request a **capability** (e.g. `process.design`,
`doc.generate`), and the registry resolves it to a **provider** (Crania, AEC, ControlCore, Menlo, Ava
bridge). Resolution supports ordered **fallback** (first configured provider wins), and the provider
record carries transport, endpoint, scopes, **health**, and **version**. Providers are read from
configuration; Denver resolves at call time. The existing single-bridge (`AVA_MCP_URL`) is wrapped as one
provider so nothing breaks.

## Consequences
- **Positive:** specialist engines evolve, relocate, or are replaced **without changing Denver**; fallback
  and health enable resilience; capability versioning enables safe upgrades.
- **Negative / cost:** registry must be kept current; health checks + circuit-breaking are needed for
  production resilience (follow-up beyond PR #4's first-configured resolution).
- **Neutral:** capability → provider is many-to-one over time (multiple providers per capability) — ordering
  expresses preference.

## Alternatives considered
- **Hardcoded service URLs in business logic.** Rejected — brittle; couples release cycles; no fallback.
- **Service mesh / DNS discovery only.** Rejected as insufficient — solves addressing, not *capability*
  semantics, versioning, or scopes.
