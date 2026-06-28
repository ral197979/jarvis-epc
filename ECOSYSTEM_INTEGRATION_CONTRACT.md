# Ava EPC Ecosystem — Integration Contract v2.0 (DRAFT)

**Status:** v2.0 — hardened for merge (2026-06-27). Source-of-truth proposal; documentation only — no
code changes implied by this file. Supersedes the v1 draft. Aligns to *HOB — AI-Native Federation
Architecture v2.0*. This pass resolves the architecture-review must-fix items **in the contract**: AI
Governance envelope (§11), Universal Object Service (§3.1), event `spec_version` + compatibility policy
(§4), and ratified ownership decisions (§13). Implementation of these remains follow-up work (tracked on
PR #4); the dormant code in PR #4 is unaffected.

**Tagging:** **[observed]** = what a repo exposes today (read-only review, 2026-06-27). **[proposed]** =
the target convention to ratify before wiring. **[gap]** = Denver work needed.

**Prime directive:** the ecosystem behaves like one intelligent platform; each repo stays independently
deployable. No monolith. Specialists stay specialists. **Denver is the Enterprise EPC Delivery
Platform** — it owns the EPC *business workflow* end-to-end (the user experiences one platform) and
delegates *technical execution* to specialist engines. Denver is not a calculation/PLC/commissioning/
document engine, but it absolutely is the primary EPC application.

Companions: `COMMISSIONING_EXTRACTION_PLAN.md` (Denver↔Menlo extraction), `api/scripts/CX_EXPORT_INGEST.md`
(bootstrap migration).

---

## 1. Domain ownership (permanent) [observed]

| System | Owns | Never owns |
|---|---|---|
| **Denver** | The full EPC delivery workflow: opportunity, proposal, **engineering management** (packages, deliverables, approvals, schedules), procurement, construction, **quality**, cost, schedule, **risk**, **document control**, **turnover planning**, portfolio analytics, executive/owner reporting, enterprise AI, cross-system search, digital-thread index | *Technical execution only*: engineering/process calculations, PLC/SCADA logic generation, field commissioning execution, document authoring/rendering |
| **Crania** | Natural-language engineering: intent extraction, design interpretation, workflow orchestration | The calculation engine (delegates to Math Engine + AEC) |
| **Ava-Engineering-Core (AEC)** | Canonical `EngineeringModel` (equipment, instruments, loops, IO), drawing intelligence, engineering relationships, **engineering calculations**, **EAP Document Factory** | Project orchestration, field execution |
| **Ava Math Engine** | Every engineering calculation (hydraulics, HVAC, pump/pipe/tank sizing, heat transfer, pressure loss, structural, electrical) | UI, workflow, persistence |
| **Ava-ControlCore** | Controls: PLC gen/review/conversion, HMI, SCADA, controls cybersecurity, **controls FAT automation**, PLC commissioning, controls validation | Field commissioning |
| **Menlo-Commissioning** | Commissioning execution: pre-comm, loop checks, FAT, SAT, FPT, IST, performance testing, punch, deficiencies, NCR/CAPA, witnessing, turnover, readiness | Engineering calcs, PLC generation |

> **Manage vs execute (the core principle).** Denver owns the *workflow and lifecycle* of every EPC
> artifact; specialist engines own the *technical execution* behind it. "Size this chilled-water pump"
> → Denver issues a capability request → Math Engine computes → result returns to Denver; the user only
> ever sees Denver. Likewise Denver owns the engineering *deliverable register, approvals, and schedule*
> while AEC/EAP *generates* the document content Denver references (manage vs generate). This is the
> Procore pattern: one perceived platform, specialized services behind it.

> Boundary note: "FAT" appears in two places by design — **ControlCore** owns *controls/PLC* FAT
> automation; **Menlo** owns *field* FAT execution. ControlCore's PLC-FAT results feed Menlo; they do
> not duplicate. (Ratified, §13.)

---

## 2. Five integration mechanisms

Communication happens only through these. **No direct database coupling. No duplicated business logic,
calculations, or document generation.**

1. **Universal Object Service** — one immutable UUID per real-world object; identity issuance + resolution (§3).
2. **Universal Event Specification** — shared event vocabulary (§4).
3. **AI Capability Registry** — ask for a capability, not a service URL (§5).
4. **MCP + REST** — synchronous capability calls and queries (§5, §8).
5. **Digital Thread + Knowledge Graph** — traceability and semantic reasoning (§6, §7).

---

## 3. Universal Object Registry → Universal Object Service [proposed]

Every object below gets **one immutable UUID** that never changes across the asset lifecycle.
Applications **store references only** — no app re-mints an identity another app owns.

**Registered object types:** organization, project, building, area, system, subsystem, equipment,
instrument, loop, io_point, cable, panel, drawing, calculation, document, requirement, issue, test,
vendor, purchase_order, submittal, inspection, work_order.

**Minting authority [proposed]** (who creates the UUID, aligned to §1 ownership):

| Object types | Minted by |
|---|---|
| organization, project, building, area, contract, purchase_order, submittal, vendor, work_order, requirement | **Denver** |
| system, subsystem, equipment, instrument, loop, io_point, cable, panel, drawing, calculation, document | **AEC** (canonical engineering) |
| test, issue (punch/deficiency/NCR), inspection | **Menlo** (execution) |

**Reference rule:** every record in any repo that relates to a registered object stores its
`*_uuid` (e.g. `equipment_uuid`, `project_uuid`, `document_uuid`) — not a copied name or a local
surrogate. This is what makes `LT-101` one object end-to-end.

**Denver today [observed]:** has `projects`, `systems`, `subsystems`, `tags`(equipment),
`commissioning_items` with local UUIDs. **[gap]** no shared registry; tag identity is Denver-local, not
reconciled to AEC's `EngineeringModel`. Registry adoption = treat AEC equipment/instrument UUIDs as the
canonical ids Denver references.

### 3.1 The registry is a SERVICE, not just a vocabulary [proposed]

The UUID vocabulary (object types + minting authority above) is necessary but not sufficient. To be the
long-term federation identity backbone it must be promoted to a first-class **Universal Object Service**
(UOS) — the system of record for object identity across every repository. The UOS is responsible for:

- **UUID issuance** (by the owning system per the minting-authority table)
- **UUID resolution** (given a reference, return the object's canonical record)
- **object owner lookup** (which repository owns this object)
- **external ID mapping** (vendor/customer/3rd-party identifiers)
- **legacy ID mapping** (pre-federation identifiers — e.g. Denver-local tag ids, Menlo `externalId`)
- **alias handling** (multiple human identifiers → one canonical UUID)
- **merge semantics** (two records found to be the same object)
- **supersede semantics** (an object replaced by a newer one, e.g. re-tag/revision)
- **tombstone policy** (logical deletion; identities are never hard-deleted or reused)
- **version history** (attribute changes over time; the UUID itself is immutable)
- **object discovery** (search/enumerate objects by type/owner/scope)
- **cross-system reference validation** (is this `*_uuid` real and resolvable?)

**Resolution contract [proposed].** Given:

```text
object_type + uuid
```

the UOS returns:

```text
canonical UUID
object type
owning repository
current lifecycle status      (active | superseded | merged | tombstoned)
aliases
external IDs
superseded-by / merged-into links
related references
source system
created timestamp
updated timestamp
```

**Binding rule:** Applications **may reference** shared objects by UUID, but **object resolution must go
through the Universal Object Service** — no repository resolves another repository's object by reaching
into its database or re-deriving identity. Identity is immutable; lifecycle changes are expressed via
`superseded-by` / `merged-into` / `tombstoned`, never by mutating or reusing a UUID.

**Hosting:** see §13 (Denver is the initial UOS host/orchestrator; canonical issuance + lifecycle
resolution are governed by the UOS regardless of host).

**Status [observed/gap]:** PR #4 ships the identity *vocabulary + minting guardrails* (`objectRegistry.ts`,
pure, in-memory). The persistent UOS (store, resolution API, lifecycle) is **follow-up implementation
work**, not in PR #4.

---

## 4. Universal Event Specification [proposed]

One vocabulary; each app maps its internal names to it **at its own edge** (publisher maps out,
subscriber maps in). Dotted `domain.action` form.

> **This supersedes v1 §3.2.** v1 said "Denver adopts Menlo's event names." v2.0 is correct: a *shared*
> vocabulary that **Menlo too** maps onto. The adapter sits at every edge, not just Denver's.

**Canonical events:** `project.created`, `project.updated`, `engineering.started`,
`engineering.completed`, `drawing.generated`, `calculation.completed`, `equipment.created`,
`equipment.updated`, `fat.started`, `fat.completed`, `sat.completed`, `loopcheck.completed`,
`commissioning.started`, `commissioning.completed`, `deficiency.created`, `deficiency.closed`,
`ncr.created`, `ncr.closed`, `turnover.ready`, `turnover.completed`.
*(Extensions to ratify: `punch.created`/`punch.closed`, `evidence.verified`, `witness.signed` — Menlo
emits these today and they have no canonical name yet.)*

**Edge mapping — Menlo ⇄ canonical ⇄ Denver `cx_status_mirror` (PR-1):**

| Menlo internal [observed] | Canonical event | Denver mirror effect |
|---|---|---|
| `CommissioningStarted` | `commissioning.started` | `phase = in_commissioning` |
| `FATCompleted` | `fat.completed` | `fat_status = passed` |
| `SATCompleted` | `sat.completed` | `sat_status = passed` |
| `LoopCheckCompleted` | `loopcheck.completed` | log |
| `DeficiencyCreated` / `DeficiencyResolved` | `deficiency.created` / `deficiency.closed` | `deficiencies_open` ± |
| `NCRCreated` / `NCRClosed` | `ncr.created` / `ncr.closed` | `ncr_open` ± |
| `PunchCreated` / `PunchClosed` | `punch.created` / `punch.closed` *(ext)* | `punch_open` ± |
| `TurnoverReady` | `turnover.ready` | `phase = ready_for_turnover` |
| `CommissioningCompleted` | `commissioning.completed` | `phase = accepted` |

Denver publishes (out): `project.*`, `engineering.completed`, `commissioning`-readiness signals (which
Menlo subscribes to as its inbound `ProjectReadyForCommissioning`, `ConstructionCompleted`, …).

**Envelope [proposed].** Every event envelope carries a `spec_version` so the vocabulary can evolve
without breaking subscribers:

```text
spec_version      semver of the event contract (e.g. "1.0")
event_id          unique id; idempotency key with tenant_id
event_name        canonical dotted name (domain.action)
tenant_id
project_id
subject_uuid      Universal Object Service reference (§3)
occurred_at       ISO-8601 UTC
correlation_id    trace id across systems
data              event payload (see schema rules below)
```

Idempotency key = `(tenant_id, event_id)` (Denver PR-1 `cx_inbound_events`). Transport: signed webhooks
(HMAC-SHA256, PR-1) → broker later.

**Compatibility policy [proposed] (binding once adopted):**
- **Additive by default** — new optional fields may be added within the same `spec_version`.
- **Breaking changes require a new `spec_version`** (removing/renaming a field, changing a type/meaning).
- **Consumers must ignore unknown fields** (forward-compatible parsing).
- **Deprecated fields remain for at least one full compatibility window** before removal in a later
  `spec_version`; deprecations are announced, not silent.
- **Payloads should reference a schema** — `data` carries (or the registry maps) a `schema_name` /
  `schema_version` so payloads are validatable and versioned independently of the envelope.
- **Delivery is at-least-once unless explicitly stated otherwise** — ordering is **not** guaranteed
  across transports; consumers **must be idempotent** (dedupe on `(tenant_id, event_id)`).

**Denver today [observed]:** R3 `universalEvents.buildEnvelope` emits `{event_id, event, tenant_id,
project_id, subject_uuid, occurred_at, correlation_id, data}` over `realtime_event_log` + the webhook
dispatcher. **[gap]** it does **not** yet carry `spec_version`, uses `event` (not `event_name`), and has
no per-payload `schema_*` — aligning the envelope to the versioned shape above is **follow-up
implementation** (a one-field-plus-rename change), not in PR #4.

---

## 5. AI Capability Registry [proposed]

**Denver never hardcodes service URLs.** It registers capabilities → providers and asks for a capability.

| Capability | Provider | Transport [observed] |
|---|---|---|
| Generate process design | **Crania** | MCP (11 tools) |
| Run pump/pipe/tank sizing, hydraulics, etc. | **Ava Math Engine** (via Crania/AEC) | MCP |
| Drawing review / extraction, engineering model | **AEC** | MCP (15 drawing + 10 process) |
| Generate PLC / controls FAT | **Ava-ControlCore** | **REST only — needs MCP shim [gap]** |
| Generate engineering documents (EAP) | **AEC** | REST `/api/doc-factory/*` |
| Generate / execute commissioning procedure | **Menlo** | MCP bridge (`/api/mcp/*`) |

**Registry record [proposed]:** `{ capability, provider, transport, endpoint|command, tools[], scopes,
health_url, version_url }`. Providers evolve independently; Denver resolves at call time.

**Denver today [observed]:** single `AVA_MCP_URL` bridge + sync routes. **[gap]** capability-based
registry that can resolve multiple providers/transports.

---

## 6. Digital Thread [proposed]

Every registered object exposes **backward** (to origin) and **forward** (to downstream) traceability:

`requirement → calculation → drawing → equipment → purchase_order → submittal → installation →
inspection → loop_check → fat → sat → ist → performance_test → punch → turnover → operations`

Implemented as **registry-UUID references**, not copies. Denver owns the **digital-thread index**
(cross-system drill-down) but each link is asserted by whichever app owns that hop. Nothing is a data
island. **Denver today [observed]:** has `related`/correlation services + the cx_status_mirror handoff
link. **[gap]** a thread index keyed by registry UUIDs spanning all systems.

---

## 7. Knowledge Graph [proposed]

One shared semantic graph; every app contributes nodes/edges keyed by registry UUID.

**Edge types:** `equipment belongs_to system`, `equipment feeds process`, `instrument measures
equipment`, `plc controls equipment`, `drawing defines equipment`, `test validates equipment`,
`punch affects equipment`, `vendor supplied equipment`.

**Powers:** AI reasoning, semantic search, impact + root-cause analysis, digital thread, autonomous
agents. **[proposed]** graph store + a write contract (apps emit edges on object/event changes);
**[gap]** Denver contributes project/procurement/construction edges and hosts cross-system search.

---

## 8. Universal API standards — every repo, no exceptions [proposed] + Denver status

| Requirement | Denver status |
|---|---|
| REST API | ✅ [observed] Express `/api/v1/*` |
| Health endpoint | ✅ |
| Version endpoint | ✅ (build/version reporting) |
| OpenAPI specification | **[gap]** not published |
| MCP server | ◑ MCP bridge exists; no first-class Denver MCP server |
| Webhook endpoints | ✅ inbound (PR-1 `commissioningWebhook`) + outbound dispatch |
| Event publisher | ✅ `realtime_event_log` / `emitEvent` (internal vocabulary) |
| Authentication | ✅ JWT (httpOnly), RBAC |
| Audit logging | ✅ audit services + immutable trails |
| Tenant awareness | ✅ Postgres RLS (`app.current_tenant_id`) |
| Correlation IDs | ✅ X-Correlation-ID middleware |
| Idempotency | ◑ present where it matters (PR-1 `cx_inbound_events`); not a universal middleware |
| Structured errors | ✅ |
| Observability | ✅ structured logging, perf budgets, heartbeat |

---

## 9. Shared security baseline [proposed] + Denver status

| Pattern | Denver status |
|---|---|
| JWT / OIDC | ✅ JWT; OIDC [gap] |
| RBAC | ✅ |
| Row-Level Security | ✅ (RLS + non-owner app role) |
| Audit trails (immutable) | ✅ |
| Correlation IDs | ✅ |
| Signed webhooks | ✅ (PR-1 HMAC-SHA256) |
| Secret rotation | ◑ JWT rotation present; org-wide rotation policy [gap] |
| Least privilege | ✅ (`jarvis_app` non-owner role) |

---

## 10. Engineering Document Authority [proposed]

**AEC's EAP Document Factory is the only authoritative engineering-document generator.** [observed] AEC
exposes `/api/doc-factory/{generate,generate-async,export,fpt,iom}` and ships SDK adapters
(`aec.menlo/v1`, `aec.denver`, `aec.crania`, `aec.ava-controls`, `aec.ava-math`).

- Menlo `DOCGEN_BASE_URL` → AEC EAP (Menlo already stores `packageRef` only). [proposed]
- Denver authors engineering docs (FDS, SOO, FAT, SAT, FPT, O&M, test procedures, turnover packages,
  commissioning reports) via EAP — **never a second renderer.** [gap: Denver should route doc needs to EAP]
- ControlCore `plc-docgen` stays PLC-specialized but registers outputs as EAP document types. [proposed]
- One document engine, one citation model, one template system. Producers render; consumers store
  references (URL + sha256).

---

## 11. AI-first principles + AI Governance Contract [proposed]

**Principles.** Every repo exposes AI capabilities; every screen supports NL interaction; every KPI
drills to source; every artifact carries provenance; every recommendation is explainable with confidence
+ evidence. (Crania/AEC/ControlCore already attach provenance/citations; Menlo's copilot is advisory-only
and never signs off — keep that invariant.)

### 11.1 AI artifact envelope (binding once adopted)

Every AI-generated output — across **Denver, Crania, Ava-Engineering-Core, Ava Math Engine,
Ava-ControlCore, Menlo, and any future specialist engine** — must carry a uniform governance envelope so
provenance, explainability, and approval travel with the artifact wherever it crosses the federation:

```text
model_provider        e.g. anthropic | openai | ollama | local
model_name            e.g. claude-opus-4-8
model_version         resolved model id/version actually used
prompt_version        version of the prompt/template that produced it
confidence            0.0–1.0 (or an explicit "n/a")
reasoning_summary     short human-readable rationale
citations[]           source references the output is grounded in
evidence_refs[]       registry UUIDs / document refs supporting it
review_status         draft | under_review | approved | rejected
human_approver        user id of the approver (null until approved)
approved_at           ISO-8601 UTC (null until approved)
generated_at          ISO-8601 UTC
correlation_id        trace id (ties to the event/digital-thread chain)
```

The envelope attaches to AI-produced events (the event `data`), documents (alongside the EAP doc
reference), and registry objects created/updated by AI.

### 11.2 Authority rule (binding)

**No AI-generated engineering output is considered authoritative until it has been reviewed or approved
according to the owning domain's workflow.** Until then it is `draft`/`under_review` and must be labeled
as such everywhere it appears. The owning system (per §1 / §10 ownership) defines the approval workflow;
the approver and timestamp are recorded in the envelope and the audit trail. Advisory AI (e.g. Menlo's
copilot) never sign offs — it only proposes.

**Status [observed/gap]:** specialist engines attach partial provenance/citations today; a *uniform*
AI-artifact envelope across all repos is **follow-up contract + implementation** work, not in PR #4.

---

## 12. Denver gap summary (what v2.0 asks of THIS repo)

Denver already satisfies most Universal API + Security items. Net-new Denver work, all **additive**:
1. **Universal Object Registry** references — adopt AEC equipment/instrument UUIDs as canonical; store as refs.
2. **Universal event vocabulary** edge adapter — map `realtime_event_log` / PR-1 `cx.*` ⇄ canonical names.
3. **AI Capability Registry** — replace single `AVA_MCP_URL` with capability→provider resolution.
4. **Digital-thread index** keyed by registry UUIDs.
5. **Knowledge-graph** contributions (project/procurement/construction edges) + cross-system search.
6. **OpenAPI spec** publication; **first-class MCP server**; **universal idempotency** middleware.
7. Route Denver document generation to **EAP**.

---

## 13. Ratified decisions (binding)

Previously-open boundary questions, now ratified as the federation standard.

**Process Design.** Crania owns natural-language design intent and orchestration. Ava-Engineering-Core
and Ava Math Engine own calculations, engineering models, and technical computation. Denver manages the
EPC workflow and stores project/deliverable state. Denver never calls both Crania and AEC/Math for the
same calculation — it requests a capability and the providers delegate among themselves.

**Document Generation.** AEC/EAP is the authoritative document-generation system. Denver may own
document-control records and workflow status (manage vs generate). ControlCore may generate
controls-specific *source* artifacts, but final rendered engineering documents must register through EAP.
One document engine, one citation model, one template system.

**FAT Ownership.** ControlCore owns PLC/controls FAT and code validation. Menlo owns field
FAT/SAT/FPT/IST execution. ControlCore FAT results feed Menlo execution and Denver readiness dashboards;
the two never duplicate.

**Registry Host.** Denver is the initial host/orchestrator for the Universal Object Service (§3).
Specialist repositories may propose object references, but canonical UUID issuance and lifecycle
resolution must be governed by the Universal Object Service (issuance still follows the §3 minting-
authority table; "host" is the orchestration point, not a change of ownership).

**Standing (non-blocking) decision — transport.** Start with signed webhooks (HMAC-SHA256, PR-1);
graduate to a broker (NATS/Kafka/SQS) as cross-system fan-out grows. Reassess when a second high-volume
subscriber comes online.

---

## 14. Adoption roadmap — Denver-first, additive, flag-gated

Sequenced so each step is independently shippable and reversible. Steps touching other repos are
specs/contracts only here (each repo implements its own edge).

| # | Step | Scope | Risk |
|---|---|---|---|
| R0 | Ratify this contract (vocabulary, registry, capability list, API/security baseline) | All | none (doc) |
| R1 | **Denver↔Menlo edge adapter** to canonical event names + reconcile gateway to Menlo REST (`/api/projects/handoff`, `/api/events`) | Denver | low; unblocks Phase D |
| R2 | **AI Capability Registry** in Denver (capability→provider; wrap existing `AVA_MCP_URL`) | Denver | low, additive |
| R3 | **Universal event vocabulary** publish/subscribe via edge adapter over `realtime_event_log` | Denver | low, additive |
| R4 | **Object Registry references** — adopt AEC canonical UUIDs for equipment/instrument; store refs in Denver | Denver + AEC contract | medium |
| R5 | **Digital-thread index** + **knowledge-graph** contributions keyed by registry UUIDs | Denver | medium |
| R6 | **OpenAPI**, **first-class MCP server**, **universal idempotency** middleware | Denver | low–medium |
| R7 | Route Denver doc generation → **EAP** | Denver + AEC | low |
| — | (Parallel, gated) Phase D dual-read cutover + Menlo bootstrap ingest | per extraction plan | held |

**Constraints honored throughout:** Denver-only code changes; no Menlo edits until it's ready; nothing
alters Denver runtime behavior without an approved, flag-gated PR; specialists stay specialists.
