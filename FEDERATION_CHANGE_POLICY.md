# Federation Change Policy

**The constitution governing all Ava EPC Federation contracts.**
Status: v1.0 (2026-06-27). Governs the *contracts* in `ECOSYSTEM_INTEGRATION_CONTRACT.md` and the
companion governance docs. Documentation/governance only — implementation-agnostic.

Federation members: **Denver, Menlo-Commissioning, Crania, Ava Math Engine,
Ava-ControlCore**, and any future repository that adopts the federation contracts.
(Crania absorbed the former Ava-Engineering-Core engine — see ADR-011.)

---

## 1. Purpose

The federation lets independent repositories behave like one intelligent platform. That only holds if the
**shared contracts are stable and evolve predictably**. Without governance, every repo drifts, edges
break silently, and integration becomes tribal knowledge.

This policy exists so that:
- Every repository stays **independently deployable** while interoperating through **stable, versioned
  contracts**.
- No contract changes silently. Every change is proposed, reviewed, versioned, and migrated.
- The federation can evolve for years without a rewrite or a "big bang" coordination event.

The federation contracts under governance are: the **Universal Object Service**, **Canonical Event
Specification**, **AI Capability Registry**, **AI Governance envelope**, **Digital Thread**, **Knowledge
Graph**, **Universal API Standards**, and **Security Standards** (see `ECOSYSTEM_INTEGRATION_CONTRACT.md`).

---

## 2. Versioning policy

Federation contracts use **semantic versioning** on a single **Federation Specification** version line:

```
Federation Specification:  v2.0 → v2.1 → v2.2 → v3.0
```

| Bump | Meaning | Examples |
|---|---|---|
| **Major** (`vX.0`) | Breaking change | remove/rename a field, change a type or meaning, drop an event, change minting authority |
| **Minor** (`v2.X`) | Additive capability | new optional field, new event, new capability, new object type |
| **Patch** (`v2.1.X`) | Clarification | typo, wording, non-normative example, formatting |

Rules:
- **Never silently change a contract.** Every normative change updates the version and is recorded in a
  changelog and an RFC (§5).
- The current contract (`ECOSYSTEM_INTEGRATION_CONTRACT.md`) is **v2.0**.
- Event envelopes carry their own `spec_version` (contract §4); it tracks the Federation Specification
  major/minor for event-shape compatibility.

---

## 3. Backward compatibility

- **Additive-first evolution** — prefer adding optional fields/events over changing existing ones.
- **Consumers must ignore unknown fields** (forward-compatible parsing) — this is a hard requirement for
  every member.
- **Compatibility window** — a minor version is supported for at least **two subsequent minor releases**
  or **180 days**, whichever is longer.
- **Deprecation lifecycle** — `active → deprecated (announced) → sunset (removed in next major)`. A
  deprecated field/event keeps working for at least **one full compatibility window**.
- **Migration notices** — any deprecation or breaking change ships a migration note in the RFC and the
  release notes before it lands.
- **Sunset policy** — removal only in a **major** version, only after the deprecation window, only with a
  documented migration path.

---

## 4. Breaking change policy

A breaking change requires **all** of:
1. A **new major Federation Specification version**.
2. **Migration documentation** (what changes, who is affected, how to migrate).
3. A **coexistence period** where old and new are both honored (dual-read/dual-write or version
   negotiation), no shorter than one compatibility window.
4. **Explicit approval** per the approval matrix (§6).

Breaking changes are never applied in place to a released version.

---

## 5. RFC process

Every federation-wide change requires an RFC (use `FEDERATION_RFC_TEMPLATE.md`) covering:
- **Motivation** — the problem and why now.
- **Impact** — which contracts, which repositories, which versions.
- **Alternatives considered** — and why rejected.
- **Compatibility analysis** — additive vs breaking; which `spec_version`.
- **Migration plan** — steps, coexistence period, notices.
- **Rollback plan** — how to revert safely.
- **Approval** — sign-off per the matrix.

Patch-level changes (typos/clarifications) may use a lightweight RFC (Summary + Compatibility = "none")
but still update the version and changelog.

---

## 6. Approval matrix

Each federation domain has an accountable owner who must approve changes to it. (Roles are
responsibilities, not necessarily distinct people.)

| Contract domain | Primary approver | Required co-approvers |
|---|---|---|
| Event contracts (§4) | Federation Architect | every publishing + subscribing repo owner |
| Universal Object Service (§3) | Object Service owner (Denver as host) | Crania + Menlo (largest minters) |
| AI Governance (§11) | AI Governance Lead | each AI-producing repo owner |
| API Standards (§8) | Federation Architect | all repo owners |
| Security (§9) | Security Lead | Federation Architect |
| Capability Registry (§5) | Federation Architect | affected provider owner(s) |
| Digital Thread (§6) | Object Service owner | affected hop owners |
| Knowledge Graph (§7) | Federation Architect | edge-owning repos |

- **Major** changes require the primary approver **and** all listed co-approvers.
- **Minor** changes require the primary approver and any directly affected co-approver.
- **Patch** changes require the primary approver only.

---

## 7. Repository adoption process

A new repository joins the federation by satisfying the adoption checklist (full detail in
`FEDERATION_ADOPTION_GUIDE.md`):

- [ ] **Universal Object Service** — references shared objects by UUID; resolves via the UOS; mints only
      object types it owns.
- [ ] **Event Specification** — publishes/subscribes canonical events with `spec_version`; idempotent
      consumers; ignores unknown fields.
- [ ] **Capability Registry** — registers the capabilities it provides; resolves others by capability.
- [ ] **AI Governance** — every AI-generated artifact carries the AI envelope; nothing authoritative
      until reviewed/approved.
- [ ] **API Standards** — REST + error model + pagination + correlation IDs + idempotency.
- [ ] **Security Standards** — auth, RBAC, tenant isolation, audit, signed webhooks, least privilege.
- [ ] **OpenAPI** — publishes a spec.
- [ ] **MCP** — exposes capabilities and/or consumes them via MCP.
- [ ] **Health endpoint** — liveness/readiness + version.

---

## 8. Compliance levels

| Level | Name | Bar |
|---|---|---|
| **Level 1** | Federation **Compatible** | Can interoperate: references objects by UUID, ignores unknown event fields, basic auth + health. Minimum to exchange data. |
| **Level 2** | Federation **Certified** | Passes the full `FEDERATION_COMPLIANCE_CHECKLIST.md`: event versioning, AI envelope, security baseline, OpenAPI, MCP, observability. |
| **Level 3** | Federation **Reference Implementation** | A canonical example others copy: complete contract coverage, exemplary docs/tests, hosts or stewards a federation service. |

Members declare their level; certification (Level 2+) is reviewed against the checklist during adoption
and at each major Federation Specification bump.

---

## 9. Amending this policy

This policy is itself a federation contract: changes follow the RFC process (§5) and the approval matrix
(§6, "API Standards" row), and are versioned. See `FEDERATION_LIFECYCLE.md` for the stage model and
`FEDERATION_RELEASE_POLICY.md` for cadence and support windows.
