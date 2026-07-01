# ADR-008 — EAP is the Document Authority

- **Status:** Accepted (2026-06-27)
- **Amended by:** [ADR-009](ADR-009-crania-absorbs-aec.md) — Crania absorbed the former Ava-Engineering-Core (AEC) engine (2026-07-01); the EAP Document Factory now lives in **Crania**. Read every "AEC" below as **Crania**.
- **Decider:** Federation Architecture Council
- **Related:** `ECOSYSTEM_INTEGRATION_CONTRACT.md` §10, §13, ADR-001, ADR-002, ADR-009

## Context
Engineering documents (FDS, SOO, FAT/SAT/FPT procedures, O&M manuals, test procedures, turnover packages,
commissioning reports) are produced across the ecosystem. If multiple repos each render documents,
templates, citation models, and outputs diverge, and there is no single authoritative artifact.

## Decision
**AEC's EAP Document Factory is the single authoritative engineering-document generator.** All repositories
requiring engineering documents **delegate to EAP** and **store a reference** (URL + sha256), never the
rendered bytes — producer renders, consumer references. Denver may own the **document-control record and
workflow status** (manage vs generate, ADR-001). ControlCore may produce controls-specific *source*
artifacts, but final rendered engineering documents register through EAP. One document engine, one citation
model, one template system. AI-generated documents additionally carry the AI envelope (ADR-009).

## Consequences
- **Positive:** consistent documents, one citation/template system, no divergent renderers; clean
  reference-passing across repos.
- **Negative / cost:** EAP availability matters for doc generation (mitigated by capability resolution +
  async generation + stored references); requires every repo to route doc needs through EAP rather than a
  local library.
- **Neutral:** "document control" (Denver) and "document generation" (EAP) are distinct, complementary
  ownerships, not a conflict.

## Alternatives considered
- **Each repo renders its own documents.** Rejected — divergence, duplicated templates, no single source
  of truth.
- **A shared rendering library vendored everywhere.** Rejected — version skew; loses the single
  authoritative artifact + citation model.
