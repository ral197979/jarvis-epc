# Federation Adoption Guide

How any repository (FacilityHub, EstateOps, SwiftFix, EngineeringHub, a new specialist engine, …) joins
the Ava EPC Federation. Onboarding is **implementation against stable contracts** — not an architectural
negotiation. Read `ECOSYSTEM_INTEGRATION_CONTRACT.md` first; this guide is the practical checklist.

Goal: reach **Level 1 (Compatible)** to exchange data, then **Level 2 (Certified)** for full membership
(`FEDERATION_CHANGE_POLICY.md` §8). Certification is verified with `FEDERATION_COMPLIANCE_CHECKLIST.md`.

---

## 0. Before you start
- Declare your repo's **domain ownership**: what it *owns* and *never owns* (contract §1 / §10). Confirm
  no overlap with an existing owner; if there is overlap, file an RFC to ratify the boundary.
- Decide which object types (if any) you **mint** vs **reference** (contract §3 minting authority).

## 1. Required APIs (Universal API Standards, §8)
- [ ] REST surface under a versioned prefix (`/api/v1/...`).
- [ ] **Health endpoint** (liveness/readiness) and a **version endpoint**.
- [ ] **Structured error model** (consistent error envelope) and **pagination** convention.
- [ ] **Correlation IDs** propagated (`X-Correlation-ID`) and echoed.
- [ ] **Idempotency** for mutating endpoints (honor `Idempotency-Key`).

## 2. Required MCP support (§5)
- [ ] Expose your capabilities as MCP tools (provider side) **and/or** consume others via MCP.
- [ ] Register your capabilities in the AI Capability Registry (capability → provider), with
      `health_url` and `version`.
- [ ] Never hardcode peer service URLs — resolve by capability.

## 3. Required AI metadata (AI Governance, §11)
- [ ] Every AI-generated artifact carries the **AI envelope**: model provider/name/version, prompt
      version, confidence, reasoning summary, citations, evidence refs, review status, approver,
      approved_at, generated_at, correlation_id.
- [ ] Nothing AI-generated is treated as authoritative until reviewed/approved per your domain workflow.

## 4. Universal Object references (§3)
- [ ] Reference shared objects by **UUID**; never copy names or mint a competing identity.
- [ ] **Resolve** shared objects through the Universal Object Service (do not read another repo's DB).
- [ ] Map your **legacy/external IDs** to canonical UUIDs via the UOS; preserve identity (use
      supersede/merge, never reuse a UUID).

## 5. Event publishing/subscribing (§4)
- [ ] Publish canonical events with the versioned envelope (`spec_version`, `event_name`, `event_id`,
      `tenant_id`, `project_id`, `subject_uuid`, `occurred_at`, `correlation_id`, `data`).
- [ ] Map your internal event names to canonical at **your edge** (publisher maps out, subscriber maps in).
- [ ] Consumers are **idempotent** (dedupe on `(tenant_id, event_id)`) and **ignore unknown fields**.

## 6. Capability registration (§5)
- [ ] Declare each capability you provide and the transport (MCP/REST).
- [ ] Provide health + version so Denver/others can detect availability and compatibility.

## 7. Security (§9)
- [ ] AuthN (JWT/OIDC) + RBAC; service-to-service auth for federation calls.
- [ ] Multi-tenant isolation (enforced at the data layer, e.g. RLS).
- [ ] Immutable audit trail; signed webhooks (HMAC); secret rotation; least privilege.

## 8. OpenAPI (§8)
- [ ] Publish an OpenAPI document at `/openapi.json` describing your surface.

## 9. Observability
- [ ] Structured logs with correlation IDs; metrics; health/heartbeat. Emit lifecycle/canonical events
      so the Digital Thread and Knowledge Graph can incorporate your objects.

---

## Onboarding checklists

### Level 1 — Federation Compatible (minimum to interoperate)
- [ ] References shared objects by UUID
- [ ] Resolves objects via the UOS (no cross-repo DB access)
- [ ] Publishes/consumes at least one canonical event with `spec_version`
- [ ] Consumers idempotent + ignore unknown fields
- [ ] AuthN + tenant isolation
- [ ] Health endpoint

### Level 2 — Federation Certified (full member)
- [ ] All of Level 1, plus:
- [ ] Capability registered (with health + version)
- [ ] AI envelope on all AI-generated artifacts
- [ ] Full API standards (errors, pagination, correlation IDs, idempotency)
- [ ] Security baseline complete (RBAC, audit, signed webhooks, rotation, least privilege)
- [ ] OpenAPI published
- [ ] MCP provider and/or consumer
- [ ] Observability (logs/metrics/events) wired
- [ ] Passes `FEDERATION_COMPLIANCE_CHECKLIST.md`

### Level 3 — Reference Implementation
- [ ] All of Level 2, exemplary docs + tests, and stewards or hosts a federation service (e.g. Denver
      hosts the Universal Object Service).

---

## Does onboarding require architectural change?
**No** — provided the federation contracts are at the version you target. Adding a repository is
capability registration + event adoption + object referencing + the standards above: **implementation
work, not redesign.** If you find you *need* a contract change to integrate, that's an RFC
(`FEDERATION_RFC_TEMPLATE.md`), not a private workaround.
