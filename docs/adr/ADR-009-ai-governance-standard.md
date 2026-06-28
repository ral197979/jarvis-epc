# ADR-009 — AI Governance Standard

- **Status:** Accepted (2026-06-27)
- **Decider:** Federation Architecture Council
- **Related:** `ECOSYSTEM_INTEGRATION_CONTRACT.md` §11, ADR-004, ADR-008

## Context
The ecosystem is AI-native: AI generates engineering tasks, drafts, calculations, documents, and
recommendations across every repo. Without a uniform governance standard, AI output crosses repository
boundaries with inconsistent (or no) provenance, confidence, or review status — unacceptable for
engineering work where authority and traceability are safety-relevant.

## Decision
Adopt a federation-wide **AI Governance Standard**. Every AI-generated artifact carries a uniform **AI
envelope**: model provider, model name, model version, prompt version, confidence, reasoning summary,
citations, evidence references, review status, human approver, approved_at, generated_at, and
correlation/trace id. **Binding rule:** *no AI-generated engineering output is authoritative until reviewed
or approved according to the owning domain's workflow.* Advisory AI (e.g. Menlo's copilot) never signs
off — it only proposes. The envelope travels with AI-produced events (ADR-004), documents (ADR-008), and
registry objects.

## Consequences
- **Positive:** consistent explainability, provenance, and human-in-the-loop control everywhere; auditable
  AI; safe to embed AI deeply because authority is gated by review.
- **Negative / cost:** every AI-producing path must populate the envelope and implement/track a review
  workflow (follow-up implementation across repos).
- **Neutral:** confidence may be `n/a` for deterministic generators; the standard still applies (provenance
  + review status).

## Alternatives considered
- **Per-repo AI metadata.** Rejected — inconsistent shapes; provenance lost at boundaries.
- **Trust AI output as authoritative.** Rejected outright — unacceptable for engineering; violates
  human-in-the-loop safety.
