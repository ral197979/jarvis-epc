# ADR-009 — Crania Absorbs Ava-Engineering-Core

- **Status:** Accepted (2026-07-01)
- **Decider:** Federation Architecture Council
- **Amends:** ADR-002, ADR-003, ADR-005, ADR-007, ADR-008
- **Related:** `ECOSYSTEM_INTEGRATION_CONTRACT.md` §1, §3, §5, §10, §13, `REFERENCE_ARCHITECTURE.md`, `FEDERATION_CHANGE_POLICY.md`

## Context
The v2.0 federation defined two distinct engineering engines: **Crania** (natural-language design intent
+ orchestration) and **Ava-Engineering-Core / AEC** (canonical engineering model, drawing intelligence,
engineering calculations, and the EAP Document Factory). In practice both were dormant — declared in
Denver's capability registry and object-authority map but flag-gated OFF, with no configured endpoints
and no running service. Crania's runtime footprint was a single registry line; AEC's was the object
minting-authority for 11 engineering types plus the EAP client.

Maintaining two separate engineering engines — one for design intent, one for the engineering
system-of-record + documents — adds a federation boundary, a second transport, and a second deployment
for capabilities that a single engine can own. Since neither engine is built yet, consolidating now is a
paper/authority re-allocation rather than a service migration.

## Decision
**Crania absorbs the former Ava-Engineering-Core engine.** AEC is retired as a separate federation member;
all of its responsibilities move to Crania:

- **Capabilities** — `drawing.review`, `engineering.model`, and `doc.generate` join Crania's existing
  `process.design` and `calc.run` in the AI Capability Registry. The `aec` provider is removed.
- **Object authority** — the 11 canonical engineering object types (`system, subsystem, equipment,
  instrument, loop, io_point, cable, panel, drawing, calculation, document`) are now minted by **Crania**.
  Minting authorities are **Denver / Crania / Menlo**.
- **EAP Document Factory** — the sole engineering-document authority now lives in Crania, reached over
  REST at `CRANIA_BASE_URL` (auth `CRANIA_SVC_TOKEN`). The former `AEC_BASE_URL` / `AEC_SVC_TOKEN` are
  removed.

Denver's federation partners are therefore **Crania, Ava-ControlCore, and Menlo-Commissioning** (plus the
legacy Ava-MCP bridge and any future CRM). Raw computation still delegates to the **Ava Math Engine**.

Everything remains **additive and flag-gated (default OFF)** — `CAPABILITY_REGISTRY`, `OBJECT_REGISTRY`,
and `EAP_ENABLED` are unchanged in default behavior; this ADR changes ownership, not runtime state.

## Consequences
- **Positive:** one engineering engine instead of two — fewer federation boundaries, one transport story,
  one deployment. No object type loses an authority; no capability is dropped.
- **Positive:** because both engines were dormant, no data migration or live cutover is required.
- **Negative / trade-off:** Crania becomes dual-mandate (design intent **and** engineering
  system-of-record + document authority) — a larger engine with a broader responsibility surface.
- **Transport note:** Crania is MCP-first (`CRANIA_MCP_URL`), but the EAP doc factory is REST
  (`CRANIA_BASE_URL`). Crania exposes both; the capability registry abstracts transport for callers.
- **Superseded naming:** ADR-002/003/005/007/008 retain their decisions but their "AEC" references now
  mean Crania (each carries an *Amended by: ADR-009* note).
