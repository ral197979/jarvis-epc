# Denver Engineering — Feature Truth

**Branch:** `audit/denver-feature-truth` · **Base commit:** `e6bdec8` (origin/main) · **Repository:** `ral197979/jarvis-epc`

An evidence-grounded, honesty-first inventory of what Denver Engineering **actually does** today — verified against source, backend routes, and this repository's committed audit evidence, not against marketing copy or feature labels.

The machine-readable source of truth is [`src/config/capabilityRegistry.ts`](src/config/capabilityRegistry.ts), enforced in CI by the `feature-truth-guard` job ([`scripts/validate-capability-registry.mjs`](scripts/validate-capability-registry.mjs) + [`src/__tests__/config/capabilityRegistry.test.ts`](src/__tests__/config/capabilityRegistry.test.ts)). This document is the human-readable companion.

> **Verification-limit disclosure.** The local dev database is empty (0 tenants, 0 users) and the login screen is a stale PIN form that does not match the email/password backend. Deep multi-tenant workflow verification was therefore constrained. Classifications carry an explicit verification tier — `runtime` (exercised live), `code` (source + route tracing), or `audit` (carried from a committed evidence doc with file:line proof). Workflow *depth* leans on `code`/`audit`; that is stated rather than overclaimed as `runtime`.

---

## 1. Product summary

Denver Engineering is an EPC (Engineering, Procurement & Construction) project-management platform. Its genuinely strong, self-contained capabilities are the **management platform** (projects, RFIs, submittals, punch, inspections, daily logs, change orders, budgets, cost control, EVM, timesheets, schedule import, risk, meetings, transmittals, billing), **document intelligence + grounded RAG assistant** (Ask Jarvis), and **real P&ID/PFD drawing generation**. Several "AI / Copilot / IQ / Autopilot / Predict" surfaces are **deterministic analytics or statistical models, not generative AI**. The **discipline engineering-calculation tools are design-assist shells** with no validated calculation backend reachable from this app.

## 2. Capability legend (truth taxonomy)

| Status | Meaning |
|---|---|
| `VERIFIED_NATIVE` | Frontend + backend + persistence in this repo; real behavior |
| `VERIFIED_EXTERNAL` | Works, but depends on an external service whose integration path is implemented |
| `DETERMINISTIC_AUTOMATION` | Rules / thresholds / scoring / workflow — **not** generative AI |
| `PREDICTIVE_MODEL` | Statistical/heuristic inference (state whether validated) |
| `GROUNDING_OR_RAG` | LLM answering from retrieved project documents, with citations |
| `DRAWING_GENERATOR` | Produces a real drawing/diagram; implies **no** engineering calculation |
| `EXTERNAL_SHELL` | UI expecting an external calc/intelligence not proven to implement it |
| `UI_ONLY` | Renders; no meaningful backend/persistence |
| `PLACEHOLDER_OR_SYNTHETIC` | Outputs are random/hard-coded/synthetic presented as results |
| `PARTIAL` | A meaningful part works; a required segment is incomplete |
| `BROKEN_OR_DEAD` | Dead nav/route/action, missing backend, or cannot fulfil its purpose |
| `NOT_VERIFIED` | Verification genuinely blocked |

"AI" is **not** a status. A feature's mechanism (LLM / deterministic / statistical / drawing) is recorded separately from its status.

## 3. Summary by status (71 capability entries)

| Status | Count |
|---|---|
| VERIFIED_NATIVE | 31 |
| PARTIAL | 22 |
| DETERMINISTIC_AUTOMATION | 10 |
| VERIFIED_EXTERNAL | 2 |
| PREDICTIVE_MODEL | 2 |
| GROUNDING_OR_RAG | 1 |
| EXTERNAL_SHELL | 1 |
| DRAWING_GENERATOR | 1 |
| BROKEN_OR_DEAD | 1 |

Route census: **62 sidebar nav routes + ~8 hidden/legacy TAB_MAP-only routes** (commissioning, engineering hub, audit log, overview, planner, resources, jobs, procurement hub) that are reachable but absent from the sidebar. See [`DENVER_ROUTE_COVERAGE.md`](DENVER_ROUTE_COVERAGE.md).

## 4. Management platform — the trustworthy core (`VERIFIED_NATIVE`)

These are real REST-backed workflows with persistence and authorization (traced in `audit/INDEPENDENT_AUDIT_2026-07-02.md` and `audit/evidence/CLOSURE_EVIDENCE_2026-07-02.md`):

My Work · Actions · Setup Wizard · Lifecycle · Proposals · Team · Schedule Import · Risk Register · Budget · Meetings · Drawings · Fix Library · RFIs · Submittals · Subcontracts · Daily Logs · Timesheets · IoT Sensors · Inspections · Punch List · NCR/CAPA · Compliance · Change Orders · Cost Control · Cost Entry · EVM · Billing · Transmittals · Automation · Audit Log (hidden) · Commissioning (hidden).

**BIM** and **Knowledge** are `VERIFIED_EXTERNAL` (xeokit CDN viewer; external embedding provider + Anthropic summaries, respectively).

## 5. AI and automation — mechanism honesty

The single most common honesty gap in Denver is **"AI"-branded surfaces that are actually deterministic**. Full detail in [`DENVER_AI_CAPABILITY_STATUS.md`](DENVER_AI_CAPABILITY_STATUS.md). Summary:

| Surface | Branding implies | Actual mechanism | Status |
|---|---|---|---|
| **Ask Jarvis** | AI assistant | **Real** grounded RAG (Anthropic + retrieval + citations) | `GROUNDING_OR_RAG` |
| Focus, Coordination, Autopilot, Executive, Portfolio IQ, Quality IQ, Cost IQ, Procurement Risk, Vendor Scorecard, Field Assistant | AI / Copilot / IQ / Autopilot | **Deterministic** analytics/rules — no LLM | `DETERMINISTIC_AUTOMATION` |
| Predict, Schedule Forecast | ML prediction | **Statistical/heuristic** (Monte Carlo, trend) — not trained ML, not LLM; confidence is heuristic | `PREDICTIVE_MODEL` |
| Process Design, MCP catalog | AI process engineering / 43 tools | External Ava MCP orchestrator, unconfigured by default; ~34/43 MCP tools 503 | `EXTERNAL_SHELL` / `PARTIAL` |

**System-prompt correction:** the legacy `src/config/systemPrompt.ts` advertised "107 skills, AGI, 44 calcs, a Fuel design tool, 12 NEC auto-calcs, 7 agents" — none reachable. Corrected in this audit to state the engineering-calculation honesty boundary. (Its only consumer is the legacy `JarvisCore.jsx` client path; the production RAG assistant `api/services/askBuilder.ts` already used an honest "answer ONLY from SOURCES" prompt.)

## 6. Engineering tools — the calculation truth boundary

Denver's discipline design tools (WWTP, PWTP, HVAC/MEP, NEC, stormwater, fire, process equipment, oil & gas) render substantial UIs but have **no validated calculation backend reachable from this app**. Non-native tool calls forward via `POST /api/v1/mcp/execute → AVA_MCP_URL` to an external Ava **agent/task orchestrator** — not a calculation engine — and `AVA_MCP_URL` is blank by default. Full discipline-by-discipline matrix in [`DENVER_ENGINEERING_TOOLS_STATUS.md`](DENVER_ENGINEERING_TOOLS_STATUS.md).

**P&ID/PFD generation is real** (`DRAWING_GENERATOR`) — genuine ISA-5.1 SVG/DXF from `public/tools/denver/*-PID-GENERATOR.js` — but a diagram does **not** imply sizing, selection, code compliance, operability, or safety.

## 7. Known honesty defects found (and their status)

| Finding | Where | Status in this audit |
|---|---|---|
| "FEED" lifecycle step 1 is actually a **financial journal**, not Front-End Engineering Design | `feed` route / `FeedView.tsx` | Documented (`honestyIssue` on entry `feed`) |
| **Directory renders permanently empty** — data props never wired by ContentRouter (P0-11, still open) | `directory` route | `BROKEN_OR_DEAD` in registry |
| ~25 `useBizStore` collections never hydrated from backend (only `projects` is) | CRM, Safety, Hub, Dashboard, etc. | `PARTIAL` per affected entry |
| MCP catalog advertises 43 tools; ~34 unreachable (503) by default | `mcp` route | `PARTIAL` + `honestyIssue` |
| All integration connector syncs are documented no-ops | `integrations` route | `PARTIAL` + `honestyIssue` |
| Notification delivery channels not implemented (now fail honestly) | `notifications` route | `PARTIAL` + `honestyIssue` |
| System-prompt overclaims (AGI/44 calcs/Fuel) | `systemPrompt.ts` | **Corrected** in this audit |
| Sidebar Engineering section (9 items) ≠ lifecycle stepper (7) | `workflows.ts` | Documented + test (prior working-tree change) |

## 8. External dependencies

| Dependency | Used by | Configured by default? |
|---|---|---|
| Anthropic Claude API | Ask Jarvis, Knowledge summaries | Needs `ANTHROPIC_API_KEY` |
| Embedding provider (OpenAI/Together) | Knowledge search | Needs provider key |
| Ava MCP orchestrator (`AVA_MCP_URL`) | Process Design, ~34 MCP tools | **No** — blank in `.env.example` |
| xeokit (CDN) | BIM 3D viewer | Yes (CDN) |
| External commissioning workspace | Turnover handoff | No — `COMMISSIONING_EXTERNAL` flag off |

## 9. Known gaps / deferred backlog

No calculation engines were implemented in this audit (out of scope). Deferred, tracked in [`DENVER_CAPABILITY_BACKLOG.md`](DENVER_CAPABILITY_BACKLOG.md): WWTP/PWTP/HVAC/NEC/stormwater/fire/process/O&G calculation backends; Directory prop-wiring fix (P0-11); full `useBizStore` hydration beyond projects (P0-10 remainder); MCP `AVA_MCP_URL` provisioning; integration connector implementations.

## 10. Production suitability

Suitable for operational use today: the `VERIFIED_NATIVE` management-platform workflows, Ask Jarvis (with an Anthropic key), Knowledge search (with an embedding key), P&ID/PFD drafting (with engineer review of any resulting design), and the deterministic analytics surfaces (understood as analytics, not AI). **Not** production-suitable as presented: the discipline engineering calculators, Directory, and the non-hydrated store views.

## 11. Engineering disclaimer

Any number produced by Denver's discipline engineering-calculation tools is **not a certified engineering output**. There is no validated calculation backend reachable from this application. All such outputs require performance in a validated external tool and review by a qualified, licensed engineer.
