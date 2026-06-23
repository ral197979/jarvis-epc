# Go-To-Market Positioning — Denver Engineering

> **The AI-native project operating system.**
> Status: v2 (codebase-grounded). Every "real today" claim traces to shipped code in `api/`, `src/`, and `api/db/migrations/`. Every "not yet" claim is named honestly so we never get caught overselling in an enterprise eval.
>
> Companion docs: [PRODUCT_REQUIREMENTS_DOCUMENT.md](PRODUCT_REQUIREMENTS_DOCUMENT.md) · [AI_PROJECT_INTELLIGENCE_SPEC.md](AI_PROJECT_INTELLIGENCE_SPEC.md) · [FEATURES.md](FEATURES.md) · [APP_OVERVIEW.md](APP_OVERVIEW.md) · [COST_CONTROL_SPEC.md](COST_CONTROL_SPEC.md) · [DOCUMENT_CONTROL_SPEC.md](DOCUMENT_CONTROL_SPEC.md) · [MOBILE_FIELD_EXECUTION_SPEC.md](MOBILE_FIELD_EXECUTION_SPEC.md) · [INTEGRATION_MARKETPLACE_SPEC.md](INTEGRATION_MARKETPLACE_SPEC.md) · [ENTERPRISE_SECURITY_SPEC.md](ENTERPRISE_SECURITY_SPEC.md)

---

## 0. How to use this document

This is the field manual for selling Denver Engineering: the one-line position, the proof points behind it, who we sell to and in what order, the value/ROI narrative per buyer, the competitive frame, the demo script, pricing hypotheses, objection handling, and the phased GTM sequence tied to the [15-phase roadmap](PRODUCT_REQUIREMENTS_DOCUMENT.md#4-scope--current-state-vs-required-grounded-in-repo).

**The cardinal rule:** lead with what is real (the Project Copilot and the records platform), roadmap the rest transparently, and **never** demo the engineering "calculators" as validated calculations — they use placeholder math today (see [§9 Readiness Gate](#9-readiness-gate--what-is-not-yet-sellable) and [FEATURES.md](FEATURES.md)).

---

## 1. The one line

### **"The AI-native project operating system."**

Not "Procore with AI." That framing concedes the category to the incumbent and reduces us to a feature. We are a different *kind* of system.

| Legacy systems of record (Procore / ACC / Aconex / Unifier) | Denver Engineering |
|---|---|
| **Track** projects | **Understand** them |
| **Report** status | **Predict** outcomes |
| **Store** information | **Turn information into decisions** |
| User time: clicking, searching, chasing, reporting | User time: deciding, solving, executing |

The architectural claim underneath the slogan: **every object — RFI, submittal, risk, cost line, inspection, schedule task — is AI-understandable, AI-searchable, AI-connected, and AI-actionable.** A legacy tool can show you a list of 412 open RFIs. We tell you which three will slip the critical path this week, why, and what to do — with a deep-link to act. (See [AI_PROJECT_INTELLIGENCE_SPEC.md](AI_PROJECT_INTELLIGENCE_SPEC.md).)

**Elevator (30 sec):** "Procore stores your project. Denver Engineering understands it. Our Project Copilot reads live signals across RFIs, submittals, risk, quality, cost, and schedule and answers one question every morning — *what should I focus on today, and why* — with ranked, explained, auditable recommendations you can act on in one click. We're the AI-native project operating system built for the programs where schedule and cost certainty are existential: data centers, water, hospitals, airports, government."

---

## 2. Why we win — proof, not slogans

Each proof point ties to **shipped, inspectable code**. We do not sell vapor.

### 2.1 AI Project Intelligence — the Project Copilot ("Focus")
**This is the demo that lands.** `api/services/copilot/projectCopilotService.ts` + `src/components/copilot/CopilotView.tsx` (the `Focus` view, live in the nav as `🧭 Focus`).

- **What it does:** answers *"What should I focus on today?"* by synthesizing live cross-module state from **eight sources** — overdue/unassigned RFIs, stalled submittals, high-score risks, failed/overdue inspections, hot punch items, cross-module actions, budget overrun, schedule slip — and returns a ranked briefing.
- **Per item it returns:** a `severity` (critical/high/medium/low), a `score` (0–100), a plain-English **`why`**, a **`recommendedAction`**, the `impacts[]` (schedule/cost/quality/…), `dueDate`/`daysOverdue`, and a **deep-link** straight into the source record.
- **Why it's credible to enterprise buyers:** the ranker (`synthesizeFocus`) is a **pure, deterministic, unit-tested function** — not an LLM guessing priorities. It is testable, auditable, and free of hallucinated rankings. We use the LLM for language and open-ended reasoning, never for the numbers. That is exactly the assurance posture a $1B program's PMO demands.
- **Scopes:** single-project (`GET /api/v1/copilot/projects/:id/focus`) and portfolio roll-up (`GET /api/v1/copilot/focus`).

> **Talk track:** "Every other tool gives you a longer list. We give you a shorter one — the right one — and we can show you the math behind every ranking because it's deterministic, not a black box."

### 2.2 Every object is AI-actionable — the `actions` spine
The platform's cross-module **Action Center** (`api/routes/actions.ts`, `api/services/actionService.ts`) gives every domain object an actionable, SLA-tracked, escalatable, audited work item. This is the rail that turns *recommend* into *execute-with-approval* (the Phase 12 autonomy path). The graph is already wired; the autonomy loop is the roadmap on top of it.

### 2.3 A real records platform underneath the intelligence
The Copilot is only credible because there is a genuine system of record feeding it. **50+ shipped modules** across nine domains ([navigation.ts](src/config/navigation.ts)): Projects, RFIs, Submittals, Drawings, BIM/IFC, Daily Logs, Inspections, Punch, Commissioning, Change Orders, Cost Control, EVM, Budget, Risk Register (with Monte Carlo), Portfolio (IRR/NPV/MOIC), Subcontracts, Transmittals, Documents, and the grounded RAG assistant **Ask Jarvis** (cited answers over ingested docs). This is table-stakes parity that makes the intelligence layer believable.

### 2.4 Built for high-assurance capital programs
Enterprise-grade from the foundation (see [ENTERPRISE_SECURITY_SPEC.md](ENTERPRISE_SECURITY_SPEC.md)): PostgreSQL **row-level security on all 84 tenant tables**, JWT + httpOnly refresh with Redis revocation, SAML SSO + SCIM provisioning (migrations `073/074`), full audit log on every mutation, Helmet CSP, rate limiting, UUID guards, prompt-injection guard on the AI path. This is what survives a SOC2 / ISO 27001 security review — the gate that filters out lighter-weight competitors in our target segments.

### 2.5 Genuine P&ID / PFD generation
ISA-5.1 process diagrams with valve actuators, instrument bubbles, title blocks, and DXF export are **real, working SVG generation** (`public/tools/denver/UNIVERSAL-PID-GENERATOR.js`). A credible engineering-domain artifact we can demo without caveat. *(Note: it draws diagrams; it does not perform process calculations — see [§9](#9-readiness-gate--what-is-not-yet-sellable).)*

---

## 3. Target segments — land → expand

We sell where **schedule/cost certainty and auditability outweigh price** — high-complexity, high-assurance, multi-stakeholder capital programs.

### Primary (lead here)
Data centers · mission-critical & industrial facilities · water / wastewater treatment plants · hospitals · airports · government facilities · embassies · energy infrastructure.

### Secondary (expand into)
Commercial buildings · universities · mixed-use developments.

### The land → expand motion
1. **LAND — data centers & mission-critical.** Beachhead. Here schedule slip and cost overrun are *existential* (a delayed hyperscale facility is millions per week of lost capacity), the buyer is sophisticated, and AI ROI is self-evident. Land a **single flagship program** with the Project Copilot + records platform.
2. **EXPAND — same owner/EPC, adjacent programs.** Capital owners and EPCs run portfolios. Once Copilot proves out on one program, the **Portfolio roll-up** (`buildPortfolioFocus`) becomes the natural expansion wedge — "see all your programs ranked in one briefing." Expand seats, then projects, then the portfolio.
3. **EXPAND — adjacent verticals.** Water, hospitals, airports, government share the same DNA (regulated, audited, multi-stakeholder, high-assurance). Reference accounts in one vertical de-risk the next.
4. **EXPAND — secondary commercial/university** once the integration marketplace (Phase 13) enables rip-and-replace migration from Procore/P6.

> **Why not lead commercial?** Commercial is price-sensitive and Procore-entrenched; we'd compete on table stakes where the incumbent is strongest. Our differentiation (predictive certainty) is worth the most where the stakes are highest. Lead with the segments that pay for certainty.

---

## 4. Buyer personas & value / ROI narrative

The economic buyer is the **owner/program executive or EPC project executive**; the champions are the **PM, PX, and PMO lead** who feel the daily pain.

| Persona | What keeps them up at night | Our answer (real today / roadmap) | ROI lever |
|---|---|---|---|
| **Owner / Executive** | No confidence the reported schedule/cost is the *real* one | Predictive project health + Owner Copilot narrative *(Executive Copilot = roadmap, P1; Portfolio health real today)* | Avoided overrun/delay on a $100M–$1B program; one avoided week of data-center slip dwarfs annual license |
| **Project Executive / PMO** | Portfolio blind spots, recovery starts too late | **Portfolio Focus roll-up (real today)** + Monte Carlo risk *(recovery planner = roadmap)* | Earlier risk detection → recovery while it's still cheap |
| **Project Manager** | Drowning in clicks, chasing approvals, manual status reports | **Project Copilot Focus (real today)** ranks the day; Coordination Copilot *(roadmap)* | Hours/week of PM time reclaimed from searching/reporting → deciding |
| **Construction Manager / Super** | Field issues surface too late, daily reporting is a chore | Field service + daily logs *(real); native PWA + AI daily report = roadmap, P0)* | Faster issue resolution; fewer surprises at the morning huddle |
| **QA/QC** | Recurring defects, scattered quality records | Inspections + punch + deficiency + Fix Library *(real); quality recurring-issue intelligence = roadmap)* | Fewer repeat NCRs; faster closeout |
| **IT / Security** | Will this survive our security review? | RLS, SAML/SCIM, audit, prompt-injection guard *(real today)*; FedRAMP/air-gap *(roadmap)* | Passes enterprise procurement gate; shortens sales cycle |

### The ROI story in one paragraph
On a billion-dollar capital program, the budget for project-controls *software* is a rounding error against the cost of **a single week of schedule slip or a single missed cost-overrun signal**. Legacy tools spend the team's time *clicking, searching, chasing, and reporting*. Denver Engineering spends it *deciding, solving, and executing* — and it detects risk earlier, when recovery is still cheap. We don't sell seats; we sell **certainty on programs where uncertainty costs millions per week.** Track the realized value with `forecastAccuracyTracker` (predicted vs. actual) and Copilot adoption metrics (see [PRD §7](PRODUCT_REQUIREMENTS_DOCUMENT.md#7-success-metrics)).

---

## 5. Competitive frame

**Be honest.** Match table stakes where we must; differentiate where we genuinely do. Claiming to out-feature Procore on document control today loses the deal in the eval.

| Capability | Procore | Autodesk Construction Cloud | Oracle Unifier | Aconex | **Denver Engineering** |
|---|---|---|---|---|---|
| System of record (RFI/submittal/drawings/daily logs) | ✅ deep | ✅ deep | ✅ | ✅ (docs/correspondence) | ✅ **shipped, parity-class** |
| Cost / pay-apps / commercial depth | ✅ deep | 🟡 | ✅ deep | 🟡 | 🟡 **partial — roadmap P0** |
| Document control depth (controlled copies, distribution, overlay) | ✅ | ✅ deep | ✅ | ✅ deep | 🟡 **partial — roadmap P0** |
| Field PWA / mobile maturity | ✅ deep | ✅ | 🟡 | 🟡 | 🟡 **partial — roadmap P0** |
| Schedule (CPM / Monte Carlo) | 🟡 | 🟡 | ✅ | ❌ | ✅ CPM + Monte Carlo *(recovery planner roadmap)* |
| Integrations marketplace | ✅ large | ✅ large | 🟡 | 🟡 | ❌ **roadmap P2** |
| Enterprise security (RLS, SSO/SCIM, audit) | ✅ | ✅ | ✅ | ✅ | ✅ **shipped** |
| **AI project intelligence (ranked, explained, deterministic focus)** | ❌ (reporting/copilot bolt-ons) | ❌ | ❌ | ❌ | ✅ **shipped — our moat** |
| **Object graph designed for autonomous coordination** | ❌ | ❌ | ❌ | ❌ | 🟡 **spine shipped, autonomy roadmap** |

### Positioning per competitor
- **vs Procore:** "Procore is the best system of *record*. We're the system of *intelligence*. We match the records table stakes you rely on and add the decision layer Procore's reporting can't — deterministic, explained, auditable focus, not a chatbot bolted onto dashboards." Concede integrations-marketplace breadth (roadmap) — don't fight there yet.
- **vs Autodesk Construction Cloud:** "ACC is strongest in design/BIM-to-build. We're strongest in *project execution intelligence*. For an owner/EPC who lives in RFIs, cost, schedule, and risk, we turn that state into decisions."
- **vs Oracle Unifier:** "Unifier is powerful but heavy, slow to deploy, and configuration-bound. We're modern, fast, and AI-native out of the box — and our Copilot is something Unifier's workflow engine fundamentally isn't."
- **vs Aconex:** "Aconex is the gold standard for document control and correspondence. We're not trying to out-Aconex Aconex on docs (that's our P0 parity work). We unify docs *plus* cost, schedule, field, and risk under one AI graph, instead of being a doc silo."

**Where we honestly do NOT yet match:** integrations marketplace breadth (P2), pay-app/financial depth (P0), document-control depth (P0), field-PWA maturity (P0). Say so. Credibility is the asset.

---

## 6. Demo script / storyline

**Audience:** owner/EPC PMO + a PM champion. **Length:** 25–30 min. **Goal:** make them feel the difference between *a tool that stores* and *a system that understands*.

**Setup (2 min).** Open on a real, populated project (or the demo tenant). One line: "Most tools start with a navigation menu. We start with a question — *what should I focus on today?*"

**Act 1 — The Copilot (the hero, 8 min).** Open `🧭 Focus`.
1. Show the **portfolio headline**: *"X critical and Y high-priority items across N active projects."* — one screen, the whole portfolio triaged.
2. Click into the **top item**. Read the **`why`** aloud: e.g. *"RFI 014 is 6 days overdue and unassigned; it's on the critical path."* Then the **`recommendedAction`**.
3. **Deep-link** straight into that RFI record and act. "From insight to action in one click — no hunting."
4. Filter by **severity**. "This is deterministic and auditable — I can show you exactly why each item scored what it did. No black box, no hallucinated priorities."

> This is the emotional center of the demo. Spend time here. Let them imagine their Monday morning.

**Act 2 — The records platform that makes it real (8 min).** Walk RFIs → Submittals → Drawings/BIM → Cost Control/EVM → Risk Register (show Monte Carlo) → Portfolio (IRR/NPV/MOIC). Message: "The Copilot is only this good because there's a real system of record underneath. This is parity-class project controls — and it's all feeding the intelligence layer."

**Act 3 — Ask Jarvis & the graph (4 min).** Ask a grounded question; show **cited** answers over ingested documents. "Every answer is sourced. No hallucinations." Tie back: "Every object here is AI-understandable, searchable, connected, and actionable."

**Act 4 — The honest roadmap (3 min).** Proactively name where we're investing: pay-app/financial depth, field PWA, document-control depth, the integration marketplace, and the additional Copilots (Executive/Coordination/Portfolio). "We'd rather show you the roadmap than oversell. Here's what's real today and here's the sequence." This *builds* trust with sophisticated buyers.

**Close.** "Procore tracks. We understand. The question isn't whether you need a system of record — you have one. It's whether you want one that thinks."

### Demo guardrails (do NOT do these)
- **Do NOT** open the engineering Calc / Process Design tools and present any number as a validated calculation. They are placeholder/synthetic math today ([FEATURES.md](FEATURES.md)). If asked, position them honestly as **design-assist / drafting UIs** on the roadmap to validated engines, and pivot to the P&ID generator (which is real).
- **Do NOT** demo pay-applications, controlled-copy document distribution, or the integrations marketplace as shipped — they're roadmap.
- **Do NOT** claim the autonomy loop ("AI executes for you") is live — it's *recommend-with-deep-link* today; execute-with-approval is Phase 12.

---

## 7. Pricing-tier hypotheses

Value-based, not seat-commodity. We price against the cost of *uncertainty on a capital program*, not against Procore's per-seat sheet. **Hypotheses to validate in early deals — not committed list price.**

| Tier | Who | What's included | Pricing model (hypothesis) |
|---|---|---|---|
| **Program** | Single flagship program (the land motion) | Full records platform + **Project Copilot Focus** + Ask Jarvis + Monte Carlo, SSO/SCIM, audit | Platform fee per program (scaled to contract value/complexity) + bounded seats |
| **Portfolio** | Owner/EPC with multiple programs (the expand motion) | Everything in Program **+ Portfolio Copilot roll-up** + cross-project benchmarking + Executive Copilot (as it ships) | Annual platform subscription tiered by # active programs + total program value under management |
| **Enterprise** | Largest owners/EPCs, government | Everything **+ autonomy (as it ships), advanced integrations, FedRAMP/air-gap path, premium SLA, dedicated success** | Negotiated enterprise agreement; security/compliance as value drivers |

**Pricing principles:** (1) anchor on program value and avoided cost, not seats; (2) the **Copilot is the premium differentiator** — it should not be free; (3) generous records-platform access drives daily usage and data density (which makes the Copilot smarter); (4) land small (one program), expand on proven ROI.

---

## 8. Objection handling

| Objection | Response |
|---|---|
| **"We already have Procore."** | "Good — keep your system of record as long as you need it. We're the intelligence layer it doesn't have. Our Copilot turns the project state you already track into ranked, explained decisions. We can run alongside and prove value on one program first." |
| **"Isn't this just AI hype / a chatbot?"** | "The opposite. Our ranking engine is a *deterministic, unit-tested* function — we can show you exactly why every item scored what it did. We use the LLM for language, never for the numbers. That's the assurance posture your PMO needs." |
| **"Your financials / pay-apps / document control aren't as deep as Procore."** | "Correct, today — and we'll tell you exactly where. That's our P0 roadmap, and we'd rather be honest than caught in an eval. What we have that they don't is the decision layer. Decide where you want to lead." |
| **"How do we trust an AI recommendation on a billion-dollar program?"** | "Three ways: it's deterministic and auditable, every recommendation is logged with its inputs and rationale, and nothing executes autonomously today — it recommends and deep-links; *you* act. Execute-with-approval is roadmap, fully audited." |
| **"Will it pass our security review?"** | "Row-level security on every tenant table, SAML SSO + SCIM, full audit log, prompt-injection guards, JWT with Redis revocation today. FedRAMP and air-gapped deployment are on the roadmap for government accounts." (See [ENTERPRISE_SECURITY_SPEC.md](ENTERPRISE_SECURITY_SPEC.md).) |
| **"Do the engineering calculators work?"** | "The P&ID/PFD diagram generation is real and we'll show you. The discipline calculators are design-assist UIs today — we won't present placeholder math as validated engineering. Validated calc engines are a deliberate, separate roadmap item." |
| **"Switching cost / migration is too high."** | "We're building the integration marketplace (P6, MSP, Procore, ACC, Aconex, Unifier) precisely to make migration low-friction. Until then we land on a *new* program where there's no rip-and-replace, and prove value before you migrate anything." |
| **"You're a young product."** | "We're young on breadth, mature on the thing that matters most — the intelligence layer no incumbent has. We're transparent about the parity work, and we're moving fast on a clear roadmap. Land one program, judge us on it." |

---

## 9. Readiness gate — what is NOT yet sellable

**Read this before any competitive enterprise eval.** Selling these as done is the fastest way to lose credibility with sophisticated buyers. Map to the [PRD scope table](PRODUCT_REQUIREMENTS_DOCUMENT.md#4-scope--current-state-vs-required-grounded-in-repo).

| Area | Status | GTM rule |
|---|---|---|
| **Engineering "calculators"** (WWTP, PWTP, HVAC/MEP, NEC, stormwater, fire, process, O&G) | ⚠️ **Placeholder / synthetic math** — design-assist shells, not validated engines ([FEATURES.md](FEATURES.md)) | **Never demo a calc result as validated.** Relabel as design-assist/drafting; pivot to the real P&ID generator. Validated engines are a separate roadmap commitment. |
| **Financial depth — pay-applications, invoices, prime/owner contracts, claims** | 🟡 Partial (budgets/COs/cost-entry/EVM exist; pay-apps ❌) | Roadmap **P0**. Don't demo pay-apps as shipped. See [COST_CONTROL_SPEC.md](COST_CONTROL_SPEC.md). |
| **Field PWA maturity** (offline-first, media/voice/QR/GPS, AI daily report) | 🟡 Partial (daily logs + field-sync exist) | Roadmap **P0**. Show daily logs; don't claim native PWA parity. See [MOBILE_FIELD_EXECUTION_SPEC.md](MOBILE_FIELD_EXECUTION_SPEC.md). |
| **Document control depth** (controlled copies, distribution lists, superseded sets, overlay/compare) | 🟡 Partial (drawings/transmittals exist) | Roadmap **P0**. Don't claim Aconex-class doc control. See [DOCUMENT_CONTROL_SPEC.md](DOCUMENT_CONTROL_SPEC.md). |
| **Integrations marketplace** (P6, MSP, Procore, ACC, Aconex, Unifier, SAP, Bluebeam, Power BI) | ❌ Mostly missing (connectors scaffolding only) | Roadmap **P2** — unlocks rip-and-replace. Until then, land on new programs. See [INTEGRATION_MARKETPLACE_SPEC.md](INTEGRATION_MARKETPLACE_SPEC.md). |
| **Additional Copilots** (Executive / Coordination / Portfolio narrative) | 🟡 Project Focus shipped; others roadmap | Demo Project + Portfolio **Focus** (real). Position Executive/Coordination as the near-term roadmap built on the same engine. |
| **Autonomous coordination** (execute-with-approval) | 🟡 Spine + governance scaffolding only | It **recommends and deep-links** today; it does not autonomously execute. Don't imply it does. |
| **Safety module** (observations/incidents/permits/JSA) | ❌ Not present | Don't claim safety management. |
| **Compliance certifications** (SOC2 Type II, FedRAMP, air-gap) | ❌ Roadmap (controls in place, attestations pending) | Say "designed for / on the path to," not "certified." |

**Lead with what's real: the Project Copilot + the records platform + enterprise security. Roadmap everything else transparently.**

---

## 10. Phased GTM sequencing (aligned to the 15-phase roadmap)

GTM motions are gated on product readiness. We don't open a motion before the product can win the eval it triggers.

| GTM phase | Product gate (roadmap) | Motion | Goal |
|---|---|---|---|
| **G0 — Design-partner / flagship land (NOW)** | Project Copilot Focus + records platform + security **shipped** | Hand-sell to **1–3 data-center / mission-critical flagship programs**; sharpen the Copilot demo + records depth | First reference program; validate ROI + pricing hypotheses |
| **G1 — Credibility / parity** | Close **P0** gaps: pay-apps/financial depth, RFI/submittal impact analysis, field PWA, document control (Phases 2/3/4/6/8) | Expand within flagship accounts; enter competitive evals where parity now holds | Survive head-to-head vs Procore/ACC on table stakes + win on intelligence |
| **G2 — Differentiation / moat** | Ship **P1**: Executive / Coordination / Portfolio Copilots, Monte Carlo recovery planner, predictive engines (Phases 5/11) | Lead with the full Copilot suite; portfolio expansion motion; vertical reference accounts | Make the intelligence layer the reason-to-buy across the portfolio |
| **G3 — Ecosystem / rip-and-replace** | Ship **P2** integration marketplace: P6, MSP, Procore, ACC, Aconex, Unifier (Phase 13) | Migration plays — displace incumbents on existing programs; enter secondary verticals (commercial/university) | Low-friction switching unlocks replacement deals |
| **G4 — Autonomy & compliance (largest accounts)** | Phase 12 execute-with-approval + Phase 14 FedRAMP/air-gap/immutable-log attestations + SOC2 Type II | Enterprise & government motion; autonomy as premium tier | Win the largest, most-regulated programs (government/embassy/energy) |

**Sequencing principle:** the Copilot is sellable *now* on new programs; parity work (G1) unlocks competitive displacement; the marketplace (G3) unlocks rip-and-replace; autonomy + compliance (G4) unlocks the largest, most-regulated accounts. Each gate is a roadmap deliverable in the [PRD](PRODUCT_REQUIREMENTS_DOCUMENT.md#5-functional-requirements-priority-ordered).

---

## 11. Messaging cheat-sheet (one screen)

- **Category:** The AI-native project operating system. *(Not "Procore with AI.")*
- **One-liner:** Procore stores your project. We understand it.
- **Proof:** A shipped, deterministic, auditable Project Copilot that answers "what should I focus on today, and why?" with one-click action — on a real, secure records platform.
- **Who:** Data centers, mission-critical, water, hospitals, airports, government — where certainty beats price.
- **Why now:** AI finally lets a project system *decide*, not just *report*.
- **Honesty:** Lead with the Copilot + records. Roadmap financials/field/docs/integrations. Never demo placeholder calcs as real.
- **Close:** "The question isn't whether you need a system of record. It's whether you want one that thinks."

---

*Grounded in the live repository — Denver Engineering. See [PRODUCT_REQUIREMENTS_DOCUMENT.md](PRODUCT_REQUIREMENTS_DOCUMENT.md) and [AI_PROJECT_INTELLIGENCE_SPEC.md](AI_PROJECT_INTELLIGENCE_SPEC.md) for the product source of truth.*
