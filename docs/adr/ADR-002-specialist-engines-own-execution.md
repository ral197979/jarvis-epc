# ADR-002 — Specialist Engines Own Technical Execution

- **Status:** Accepted (2026-06-27)
- **Amended by:** [ADR-009](ADR-009-crania-absorbs-aec.md) — Crania absorbed the former Ava-Engineering-Core (AEC) engine (2026-07-01); read every "AEC" below as **Crania**.
- **Decider:** Federation Architecture Council
- **Related:** `ECOSYSTEM_INTEGRATION_CONTRACT.md` §1, §10, §13, ADR-001, ADR-005, ADR-008, ADR-009

## Context
EPC delivery spans process calculations, engineering models, PLC/SCADA logic, document rendering, and
field commissioning. Implementing all of these inside Denver would create a monolith and duplicate
specialized systems that already exist. Ownership must be unambiguous to prevent two repos claiming the
same capability.

## Decision
Technical execution is owned by specialist engines, with **exactly one owner per capability** (ratified
in contract §13):
- **Crania** — natural-language design intent + orchestration (delegates math).
- **Ava Math Engine** — every engineering calculation.
- **Ava-Engineering-Core (AEC)** — canonical engineering model, drawing intelligence, engineering
  calculations, and the EAP Document Factory (ADR-008).
- **Ava-ControlCore** — PLC/SCADA generation, review, conversion, and controls/PLC FAT.
- **Menlo-Commissioning** — field commissioning execution (FAT/SAT/FPT/IST, punch, deficiencies, NCR,
  witnessing, turnover).
Denver requests a **capability** (ADR-005) and the owning engine executes; results return to Denver.

## Consequences
- **Positive:** no duplicated logic; engines evolve independently; clear accountability; testable seams.
- **Negative / cost:** cross-repo calls add latency and require availability/version handling (Capability
  Registry health + fallback).
- **Neutral:** some capabilities legitimately appear in two repos at different layers — controls/PLC FAT
  (ControlCore) vs field FAT (Menlo); ControlCore PLC-FAT results feed Menlo. This is layering, not
  duplication (contract §13).

## Alternatives considered
- **Shared libraries vendored into each repo.** Rejected — version skew and duplicated maintenance;
  breaks single-owner accountability.
- **One mega-engine.** Rejected — couples unrelated domains and prevents independent scaling/deployment.
