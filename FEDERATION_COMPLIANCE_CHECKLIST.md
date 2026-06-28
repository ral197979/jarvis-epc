# Federation Compliance Checklist

Objective, verifiable criteria for **Level 2 (Certified)** membership (`FEDERATION_CHANGE_POLICY.md` §8).
Each item is phrased so it can be checked yes/no with evidence (a URL, a test, a doc, a config). Use this
at adoption and re-validate at every major Federation Specification bump.

Repository: ______________   Target spec version: ______   Reviewer: ______   Date: ______

---

## Architecture
- [ ] Domain ownership documented (owns / never owns); no overlap with another owner (contract §1/§10).
- [ ] Mints only object types it owns; references all others (contract §3).
- [ ] Independently deployable (no synchronized-release dependency on another repo).

## API
- [ ] Versioned REST prefix (e.g. `/api/v1`).
- [ ] `GET /openapi.json` returns a valid OpenAPI document.
- [ ] Health endpoint returns liveness/readiness; version endpoint returns the build/spec version.
- [ ] Consistent structured error envelope across endpoints.
- [ ] Pagination convention on list endpoints.
- [ ] `X-Correlation-ID` accepted, propagated, and echoed.
- [ ] Mutating endpoints honor `Idempotency-Key` (replay returns the original result).

## Security
- [ ] AuthN via JWT/OIDC on all non-public endpoints.
- [ ] RBAC enforced.
- [ ] Multi-tenant isolation enforced at the data layer (e.g. RLS), not only app code.
- [ ] Immutable audit trail for mutations.
- [ ] Inbound webhooks verify HMAC signatures (constant-time compare).
- [ ] Service-to-service federation auth defined (token/mTLS + scopes).
- [ ] Secret rotation policy in place; least-privilege credentials.

## AI
- [ ] Every AI-generated artifact carries the full AI envelope (contract §11.1).
- [ ] No AI output is authoritative until reviewed/approved per the owning domain workflow (§11.2).
- [ ] Confidence + citations + model/prompt version present on AI outputs.

## Events
- [ ] Publishes/subscribes canonical events with `spec_version` (contract §4).
- [ ] Internal↔canonical mapping done at the repo's own edge.
- [ ] Consumers are idempotent (dedupe on `(tenant_id, event_id)`).
- [ ] Consumers ignore unknown fields.
- [ ] Envelope includes `event_id`, `tenant_id`, `correlation_id`, `subject_uuid` where applicable.

## Objects
- [ ] Shared objects referenced by UUID only.
- [ ] Object resolution goes through the Universal Object Service (no cross-repo DB reads).
- [ ] Legacy/external IDs mapped to canonical UUIDs.
- [ ] Lifecycle changes use supersede/merge/tombstone; UUIDs never mutated or reused.

## Documentation
- [ ] Adoption checklist (`FEDERATION_ADOPTION_GUIDE.md`) completed and linked.
- [ ] OpenAPI published and current.
- [ ] Contract version targeted is stated; deviations are tracked as `[gap]` with follow-ups.

## Deployment
- [ ] Federation features are flag-gated and default-off until enabled.
- [ ] Migrations are additive and reversible; identity preserved across migrations.
- [ ] Rollback path documented.

## Observability
- [ ] Structured logs with correlation IDs.
- [ ] Metrics exported; health/heartbeat present.
- [ ] Emits lifecycle/canonical events feeding the Digital Thread + Knowledge Graph.

## Governance
- [ ] Repo owner identified for the approval matrix (`FEDERATION_CHANGE_POLICY.md` §6).
- [ ] Agrees to the RFC process for any federation-wide change it proposes.
- [ ] Declared compliance level (1/2/3) recorded.

---

**Result:** ☐ Level 1 Compatible ☐ Level 2 Certified ☐ Level 3 Reference — notes: ______________
