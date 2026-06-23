# Executive Slide Deck

> A 40-slide executive presentation. Each slide includes a **Title**, the **Key Message** (the one thing the audience must remember), **Bullets** (speaker support), and a **Suggested Graphic** (for the design team).
>
> Designed to be sold from. Sections: Cover & Vision (1–6) · Solution & Platform (7–10) · Feature Deep Dive (11–25) · Workflows (26–30) · ROI (31–35) · Competitive (36–38) · Roadmap & Close (39–40).
>
> Graphic specifications referenced here are detailed in `assets/SLIDE_GRAPHICS_SPEC.md`.

---

## Slide 1 — Cover
- **Key message:** Denver Engineering — the AI command center for delivering and commissioning capital projects.
- **Bullets:**
  - Denver Engineering
  - *Deliver complex facilities. Prove they're ready to operate.*
  - Presenter / date / audience
- **Suggested graphic:** Full-bleed hero — a stylized facility (data center / treatment plant) overlaid with a subtle command-center UI and a glowing readiness gauge. "Industrial Precision" design language.

## Slide 2 — The Vision
- **Key message:** Every capital project should run on one source of truth that knows when it's ready.
- **Bullets:**
  - From fragmented spreadsheets and PDFs → one live system of record
  - From "I think we're ready" → an objective readiness score
  - From stale monthly reports → real-time, predictive intelligence
- **Suggested graphic:** Before/after split — chaotic tool sprawl on the left, one unified platform on the right.

## Slide 3 — The Problem
- **Key message:** Information fragmentation is the #1 controllable driver of project overruns.
- **Bullets:**
  - Project data lives in 10+ disconnected tools
  - Commissioning runs on paper; records get lost
  - Leaders learn about overruns weeks too late
  - "Is it ready?" is a matter of opinion
- **Suggested graphic:** Tangled-wires diagram of disconnected tools with dollar signs leaking out.

## Slide 4 — The Cost of the Problem
- **Key message:** The cost of getting it wrong dwarfs the cost of the software.
- **Bullets:**
  - Large-project overruns commonly run 20–80%
  - Rework costs 5–12% of contract value
  - Disputed turnover and premature acceptance carry major liability
  - Weeks of professional time lost to manual reporting and document search
- **Suggested graphic:** Bar chart of overrun ranges + a callout: "one avoided overrun > years of subscription."

## Slide 5 — The Market
- **Key message:** This is a massive, underserved seam in a multi-trillion-dollar industry.
- **Bullets:**
  - Buyers: EPC contractors, owners/operators, CxAs, government, data centers, utilities, hospitals, universities
  - Existing tools cover *build* OR *operate* — not the seam between
  - Owners increasingly demand evidence-based handover
- **Suggested graphic:** Market map showing "Build" tools and "Operate" tools with a highlighted gap in the middle labeled "Delivery + Commissioning + Readiness."

## Slide 6 — The Big Idea
- **Key message:** Own the seam between "build it" and "operate it."
- **Bullets:**
  - Deliver the project AND prove it's ready to operate
  - Commissioning depth + project controls + grounded AI, on one model
  - Readiness as a first-class, measurable outcome
- **Suggested graphic:** A bridge connecting "Build" and "Operate," with the platform logo as the keystone.

## Slide 7 — The Solution
- **Key message:** One platform for the entire project lifecycle.
- **Bullets:**
  - Proposal → Design → Construction → Commissioning → Turnover
  - Financial controls + document AI + predictive intelligence across all of it
  - Multi-tenant, secure, auditable by design
- **Suggested graphic:** The lifecycle ribbon (see `assets/lifecycle-diagram`).

## Slide 8 — Platform Overview
- **Key message:** 45+ purpose-built screens across 9 work domains, plus a modern Mission Control UI.
- **Bullets:**
  - Operations · AI · CRM · Engineering · Construction · Finance · Documents · Procurement · System
  - Real-time updates, role-gated access, one source of truth
- **Suggested graphic:** Domain grid / honeycomb of the nine domains with representative icons.

## Slide 9 — Architecture of Trust
- **Key message:** Enterprise-grade security and auditability are built in, not bolted on.
- **Bullets:**
  - Row-level security on every tenant record
  - Automatic audit logging on every change
  - JWT auth, rate limiting, prompt-injection guard
  - Air-gapped & certification (SOC 2 / ISO 27001) options
- **Suggested graphic:** Layered "defense in depth" shield diagram.

## Slide 10 — The Intelligence Layer
- **Key message:** Three AI capabilities turn data into decisions.
- **Bullets:**
  - Ask Jarvis — grounded, cited document answers
  - Predict — health scoring, EAC forecasting, anomaly detection
  - Command Center — heatmap, root-cause correlation, explainable recommendations
- **Suggested graphic:** Three-panel "brain" diagram sitting atop the data model.

## Slide 11 — Feature Deep Dive: Dashboard
- **Key message:** Everyone starts the day on the same trustworthy picture.
- **Bullets:** KPI tiles · EVM health gauges · live activity feed · one-click drill-down.
- **Suggested graphic:** Annotated dashboard screenshot/mockup.

## Slide 12 — Projects & Action Center
- **Key message:** A master register plus a work system where nothing falls through the cracks.
- **Bullets:** Project register links everything · Action Center with SLA, escalation, real-time alerts · the platform's "work orders."
- **Suggested graphic:** Project hub with action cards and SLA badges.

## Slide 13 — Commissioning (Signature Feature) — Part 1
- **Key message:** Commissioning becomes a structured, provable process.
- **Bullets:** 4 phases (pre-comm → pre-functional → functional → turnover) · 21 asset types · test packs with evidence.
- **Suggested graphic:** The 4-phase commissioning funnel (see `assets/commissioning-workflow`).

## Slide 14 — Commissioning — Part 2: Deficiencies & Retest
- **Key message:** Issues close only when they're actually fixed.
- **Bullets:** Deficiency severity & ownership · retest loop closes on a passing test · coverage reporting ensures every tag is tested.
- **Suggested graphic:** Deficiency → retest → close loop diagram.

## Slide 15 — Readiness Scoring
- **Key message:** "Is it ready?" becomes an objective number.
- **Bullets:** Weighted score (open actions 30% · blockers 25% · SLA 20% · inspections 15% · escalations 10%) · states (not ready → ready) · blocking factors + history.
- **Suggested graphic:** Readiness gauge with the weighted-component breakdown (see `assets/readiness-score`).

## Slide 16 — Financial Controls
- **Key message:** Cost truth in real time, margin protected.
- **Bullets:** Budgets · change orders · cost control · cost entry · earned value (CPI/SPI, S-curve).
- **Suggested graphic:** EVM S-curve with CPI/SPI gauges.

## Slide 17 — Risk & Portfolio
- **Key message:** Quantify risk; see the whole portfolio as an investment.
- **Bullets:** Risk register with Monte Carlo · portfolio IRR/NPV/MOIC · conflict & bottleneck detection.
- **Suggested graphic:** 5×5 risk matrix + portfolio rollup table.

## Slide 18 — Engineering & Design Coordination
- **Key message:** Coordinate design on current information.
- **Bullets:** Drawings & revisions · RFIs & submittals · BIM clash resolution · Engineering Hub.
- **Suggested graphic:** Drawing register with markup + BIM clash callouts.

## Slide 19 — P&ID / PFD Generation
- **Key message:** Standards-compliant process diagrams, generated in-platform.
- **Bullets:** ISA-5.1 diagrams · valve actuators & instrument bubbles · title blocks · DXF export.
- **Suggested graphic:** A generated P&ID with annotation callouts.

## Slide 20 — Construction & Field Operations
- **Key message:** Field reality reaches the office the same day.
- **Bullets:** Daily logs · inspections · punch lists · offline-capable capture with sync · QR launchers.
- **Suggested graphic:** Mobile field-capture mockup syncing to the dashboard.

## Slide 21 — Documents & Knowledge
- **Key message:** Every document is findable, summarized, and access-controlled.
- **Bullets:** Transmittals · ISO 19650 register · full-text + AI-summarized search · knowledge ingestion.
- **Suggested graphic:** Document register with an AI-summary panel.

## Slide 22 — Ask Jarvis (Grounded AI)
- **Key message:** Your documents become instant, cited, trustworthy answers.
- **Bullets:** Grounded in your corpus · citation for every claim · prompt-injection guard · persistent sessions.
- **Suggested graphic:** Chat answer with hover-citations linking to source documents.

## Slide 23 — Predict (Predictive Intelligence)
- **Key message:** Catch slippage before it compounds.
- **Bullets:** Health score (0–100) · EAC forecast with trend & confidence · anomaly alerts · portfolio summary.
- **Suggested graphic:** Health gauge + EAC forecast trendline with anomaly flags.

## Slide 24 — Executive & Operations Command Center
- **Key message:** The leadership cockpit — see where to look, act in real time.
- **Bullets:** Portfolio risk heatmap · SLA & escalation hotspots · contractor performance · live ops feed · command actions.
- **Suggested graphic:** Command-center dashboard with a heatmap and live feed.

## Slide 25 — Explainable Decision Support
- **Key message:** Recommendations you can trust because they explain themselves.
- **Bullets:** Rules-based next-best-action (escalate/reassign/prioritize/pause-SLA) · plain-English reasons · root-cause correlation. No black box.
- **Suggested graphic:** A recommendation card with "why" + a root-cause correlation timeline.

## Slide 26 — Workflow: Project Delivery
- **Key message:** The whole project, end to end, on one platform.
- **Bullets:** Win → Plan → Design → Construct → Commission → Close-out.
- **Suggested graphic:** Horizontal workflow swimlane.

## Slide 27 — Workflow: Commissioning to Turnover
- **Key message:** From first checklist to a downloadable turnover package.
- **Bullets:** Scope → test packs → 4 phases → deficiency/retest → readiness → turnover.
- **Suggested graphic:** Commissioning workflow with the readiness gauge at the end.

## Slide 28 — Workflow: Asset Lifecycle
- **Key message:** Operations inherits a complete asset record on day one.
- **Bullets:** Register → inspect → commission → resolve → turnover → operating record.
- **Suggested graphic:** Asset lifecycle ring.

## Slide 29 — Workflow: Issue to Resolution
- **Key message:** Turn firefighting into managed operations.
- **Bullets:** Detect → triage → recommend → act → correlate root cause → close → learn.
- **Suggested graphic:** Operations loop diagram.

## Slide 30 — Workflow: Data to Decisions
- **Key message:** Leadership steers on live truth, not stale reports.
- **Bullets:** Live data → KPI rollup → portfolio view → forecast/anomalies → decision → directed action.
- **Suggested graphic:** Funnel from raw data to executive decision.

## Slide 31 — ROI: The Thesis
- **Key message:** One avoided bad outcome pays for the platform many times over.
- **Bullets:** Software cost ≪ value at risk on a single project · levers: overrun avoidance, rework reduction, Cx acceleration, productivity.
- **Suggested graphic:** Scale balancing "subscription" vs. "one avoided overrun."

## Slide 32 — ROI: Data Center & Industrial
- **Key message:** Faster energization/startup and provable commissioning.
- **Bullets:** Data center ($300M): ~$4.5M + 1.5–2.5 wks earlier energization · Industrial ($150M): ~$4.5M combined.
- **Suggested graphic:** Two ROI cards with headline numbers.

## Slide 33 — ROI: Hospital & Embassy
- **Key message:** Compliance-heavy facilities, de-risked and on time.
- **Bullets:** Hospital ($200M): ~$3.0M + 60% compliance-effort cut · Embassy ($120M): ~$1.8M + 70% audit-effort cut.
- **Suggested graphic:** Two ROI cards.

## Slide 34 — ROI: Water Plant & University
- **Key message:** Evidence-based acceptance and portfolio governance.
- **Bullets:** Water/wastewater ($90M): ~$1.35M + 2–4 wks faster · University program ($250M): ~$5.0M + tool consolidation.
- **Suggested graphic:** Two ROI cards.

## Slide 35 — ROI: Levers Summary
- **Key message:** Seven repeatable levers you can model with your own numbers.
- **Bullets:** Overrun avoidance · rework reduction · change recovery · Cx acceleration · productivity · tool consolidation · compliance effort.
- **Suggested graphic:** Levers table (from `ROI_ANALYSIS.md`).

## Slide 36 — Competitive: The Landscape
- **Key message:** We own a seam no single category covers.
- **Bullets:** CMMS/EAM (Maximo, UpKeep, Limble) · facilities (ServiceNow, FM:Systems) · construction (Procore, Aconex) · niche Cx tools.
- **Suggested graphic:** 2×2 / category map with our position in the center seam.

## Slide 37 — Competitive: Where We Win
- **Key message:** Commissioning depth + grounded AI + readiness + portfolio intelligence on one model.
- **Bullets:** vs. Procore → Cx + AI · vs. Maximo → delivery + Cx (we feed it) · vs. Cx tools → integrated & intelligent.
- **Suggested graphic:** Win/tie/complement matrix.

## Slide 38 — Competitive: Honest Scope
- **Key message:** We're credible because we're clear about boundaries.
- **Bullets:** Not an EAM · not real-time SCADA · design calculators are drafting aids · we integrate with those layers.
- **Suggested graphic:** "In scope / integrates with" two-column diagram.

## Slide 39 — Roadmap & Direction
- **Key message:** Deepening the seam: richer AI, broader integrations, deeper Cx.
- **Bullets:** Expanding integration ecosystem · enhanced mobile · deeper predictive models · industry playbooks. *(Position as direction, not commitments.)*
- **Suggested graphic:** Now / Next / Later horizon bands.

## Slide 40 — Call to Action
- **Key message:** Start with one facility; prove the value in one project cycle.
- **Bullets:** Stand up the project → ingest documents → run the work → commission it → put it in front of leadership · *Let's scope your pilot.*
- **Suggested graphic:** Clean closing slide with the pilot path and contact details.

---

## Deck delivery notes

- **Short version (15 min):** Slides 1, 3, 6, 7, 13, 15, 24, 31, 37, 40.
- **Standard version (30–40 min):** All 40, lingering on 13–15 (commissioning + readiness) and 31–35 (ROI) for the economic buyer.
- **Technical evaluation:** Add a live demo after slide 25; bring `COMPETITIVE_POSITIONING.md` for the honest-scope conversation.
- **Tone:** Confident and specific. Lead with the seam, prove with commissioning and readiness, close with ROI. Never overstate SCADA/calculation scope — credibility is the close.

---

*Graphic specifications for every "Suggested graphic" are in `assets/SLIDE_GRAPHICS_SPEC.md`.*
