# ADR-010 — Federation Security Principles

- **Status:** Accepted (2026-06-27)
- **Decider:** Federation Architecture Council; co-approver: Security Lead
- **Related:** `ECOSYSTEM_INTEGRATION_CONTRACT.md` §9, ADR-003, ADR-004, ADR-005

## Context
A federation of independently deployed repositories sharing tenants, objects, and events expands the
attack surface: cross-repo calls, webhooks, shared identity, and AI-driven actions. Security cannot be a
per-repo afterthought; it must be a shared baseline every member meets.

## Decision
Adopt federation-wide **security principles** all members must satisfy (verified by
`FEDERATION_COMPLIANCE_CHECKLIST.md`):
1. **AuthN** via JWT/OIDC; **service-to-service** federation auth via signed service tokens (or mTLS) with
   explicit scopes — no anonymous cross-repo calls.
2. **RBAC** on all privileged actions.
3. **Multi-tenant isolation enforced at the data layer** (e.g. Postgres RLS with a non-owner role), not
   only in application code.
4. **Immutable audit trail** for mutations and approvals (including AI approvals, ADR-009).
5. **Signed webhooks** (HMAC-SHA256, constant-time compare) for all inbound event delivery.
6. **Secret rotation** policy and **least-privilege** credentials per service.
7. **Tenant/identity trust:** `tenant_id` and registry UUIDs are authoritative as issued; no repo
   re-derives or reassigns them.

## Consequences
- **Positive:** uniform, auditable security posture; safe cross-repo collaboration; tenant isolation holds
  even if an app-layer check is missed.
- **Negative / cost:** federation s2s auth (token issuance/rotation/scopes) and OIDC are prerequisites to
  *operating* live cross-repo endpoints — follow-up before mounting provider endpoints (e.g. Denver MCP
  provider remains unmounted until this exists).
- **Neutral:** transport hardening (mTLS vs signed tokens) can evolve via RFC without changing the
  principles.

## Alternatives considered
- **Per-repo security choices.** Rejected — inconsistent posture; a weak member endangers the federation.
- **App-layer-only tenant isolation.** Rejected — a single missed `WHERE` leaks tenants; defense-in-depth
  via RLS is required.
- **Network trust (assume internal = safe).** Rejected — no zero-trust; insufficient for shared tenants
  and AI-driven actions.
