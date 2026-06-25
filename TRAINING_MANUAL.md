# Denver Engineering — User Training Manual

> **The AI-native project operating system for capital construction.**
> A complete, role-by-role training guide covering every level of a construction
> organization — from the field crew to the C-suite to the system administrator.
> Companion docs: [CUSTOMER_FEATURES.md](CUSTOMER_FEATURES.md) · [USER_WORKFLOWS.md](USER_WORKFLOWS.md) · [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md)

---

## How to use this manual

- **New to the platform?** Read **Part 1 — Getting Started** first; it applies to everyone.
- **Want your job, fast?** Jump to your role in **Part 2 — Role-Based Tracks**. Each track is a self-contained "do this" guide.
- **Need a specific module?** See **Part 3 — Module Reference** for step-by-step how-tos.
- **Setting the system up?** See **Part 4 — Administrator Guide**.
- Terms in *italics* are defined in **Part 5 — Glossary**.

Conventions: **Nav → Screen** means click that item in the left sidebar. Buttons and fields are shown in **bold**.

---

# Part 1 — Getting Started (everyone)

### 1.1 Signing in
1. Open the application URL provided by your administrator.
2. Sign in with your email and password, or click **Single sign-on** if your company uses SSO (Okta, Azure AD, etc.).
3. First time in, you'll land on the **Dashboard**.

### 1.2 The screen layout
- **Left sidebar** — navigation, grouped by domain (Operations, AI, Construction, Finance, Procurement, Documents, Engineering, System). Collapse it with the chevron to widen your workspace.
- **Main area** — the screen you selected.
- **Project selector** — most screens have a project dropdown in the top-right. Your choice is remembered across screens.
- **Notifications bell** — real-time alerts on items assigned to you.

### 1.3 Picking your project
Most work is project-scoped. Choose your project from the dropdown once; it carries across modules until you change it. Cross-project screens (Focus, Executive, Portfolio IQ) roll up *all* your active projects automatically.

### 1.4 The one screen everyone should start on: 🧭 **Focus**
**Nav → Focus** is your daily entry point, whatever your role. It reads every module and ranks what needs attention — overdue RFIs, stalled submittals, high risks, failed inspections, hot punch items, budget overruns, schedule slip — into a single list.
- Each card shows a **severity**, a **score**, a plain-English **why**, and a **recommended action**.
- Filter with the **severity chips** (Critical / High / Medium / Low).
- **Click any card** to jump straight to the underlying record, with the project already selected, ready to act.

> Habit to build: open **Focus** every morning, clear the Critical and High cards, move on.

### 1.5 How AI is used here (and why you can trust it)
The rankings, scores, risk indices, and forecasts are produced by **deterministic, auditable logic** — the same inputs always give the same result, and the reasoning is shown. AI language models are used only for wording and open-ended questions (Ask Jarvis), never to invent the numbers.

---

# Part 1.6 — The organization hierarchy at a glance

Denver Engineering is used top-to-bottom across the whole org. Every job below
maps to one of five **permission tiers** your administrator assigns. The tier
controls *what you can see and change*; your *role* (the job) determines *where
you spend your day*.

### Permission tiers (set by the administrator)
| Tier | Who | Sees | Can change |
|---|---|---|---|
| **Owner** | Company principal / account owner | Everything, all projects, owner settings | Everything, including org config |
| **Admin** | IT / system admin, PMO lead | Everything, all projects | Everything except billing-of-record |
| **Project Manager** | PM, CM, controls, QA/QC, safety | Operations, Construction, Finance, Engineering, Documents, Field | Create/edit records in their projects |
| **Engineer** | Design, VDC, field engineer, scheduler | Operations, Construction, Engineering, Documents, Field | Create/edit engineering & coordination records |
| **Viewer** | Owner's reps, subs, auditors | Operations + Documents (read) | Read-only |

> Note: the sidebar automatically hides domains your tier can't use. If a screen
> in this manual isn't in your sidebar, your tier doesn't include it — ask your admin.

### Org levels → roles → where they live
| Org level | Roles | Permission tier | Primary home screens |
|---|---|---|---|
| **Executive / C-suite** | CEO, COO, President | Owner / Admin | Executive · Portfolio IQ · Predict · Dashboard |
| **Program / Portfolio** | Program Director, Project Executive, PMO | Admin / PM | Portfolio IQ · Focus (portfolio) · EVM · Schedule Forecast |
| **Project leadership** | Project Manager, Construction Manager | PM | Focus · Coordination · RFIs · Submittals · Cost · Change Orders |
| **Preconstruction** | Estimator, Precon Manager, BD | PM / Engineer | Proposals · CRM · Budget · Subcontracts |
| **Project controls** | Cost Manager, Scheduler/Planner | PM / Engineer | Budget · EVM · Cost IQ · Schedule Forecast · Billing |
| **Design / engineering** | Design Eng, VDC/BIM Manager, Process Eng | Engineer | FEED · Drawings · BIM · Process Design · Calcs |
| **Procurement** | Procurement/Contracts Manager, Buyer | PM | Subcontracts · Procure Risk · Vendor Scorecard · Directory |
| **Quality & safety** | QA/QC Manager, EHS/Safety Manager | PM | Inspections · Punch · Quality IQ · NCR/CAPA · Safety |
| **Field supervision** | Superintendent, Foreman, Field Engineer | PM / Engineer | Daily Logs · Field Assistant · Inspections · Punch |
| **Document control** | Document Controller | Engineer / PM | Documents · Transmittals · Drawings |
| **External** | Owner/Client, Contractor/Sub, Auditor | Viewer | Predict · Documents · Transmittals (+ assigned records) |
| **System** | Administrator | Admin / Owner | System · Automation · Integrations · MCP · Knowledge |

The tracks in Part 2 follow this hierarchy from top to bottom. Find your level,
read your track, and you have your daily job in five minutes.

---

# Part 2 — Role-Based Tracks

Roles map to permission levels your administrator assigns (Owner, Admin, Project Manager, Engineer, Viewer). The tracks below describe the *job*, not the permission name.

---

## 2.1 Executive (CEO / COO / President)

**You need:** project health, risk, cash-flow confidence, schedule confidence — across the whole portfolio.

**Your home screens:** Executive · Portfolio IQ · Predict · Dashboard

**Daily / weekly routine**
1. **Nav → Executive.** Read the **portfolio health** number and the status mix (on-track / watch / at-risk / critical). Scan **systemic issues** — problems recurring across multiple projects.
2. Review the **worst-first project table**. The project at the top needs you most.
3. For any project, click **📄 Report** to generate a **copy-pasteable owner/board report** (health, schedule, cost, quality & safety, recommended actions). Paste it into your board deck or email.
4. **Nav → Predict** for forward-looking portfolio risk (red/amber/green, CPI/SPI trends, completion projection).

**Tips**
- The Executive briefing is deterministic — you can defend every number in a board meeting.
- Use **Portfolio IQ** when you suspect a *systemic* problem (e.g., the same trade underperforming on multiple jobs).

---

## 2.2 Project Executive / Program Director

**You need:** portfolio visibility, forecasting, recovery plans, resource balance.

**Your home screens:** Portfolio IQ · Focus (portfolio) · EVM · Schedule Forecast

**Routine**
1. **Nav → Portfolio IQ.** Review **benchmarks** (cost variance, schedule slip, overdue work) to see best/worst/median across projects.
2. Check **resource conflicts** — people over-allocated across two or more projects. Rebalance before it bites.
3. Note **exemplars** (replicate what they do) and **outliers** (intervene).
4. **Nav → Schedule Forecast** on an at-risk project → run **Monte Carlo** for P50/P80 completion and use the **Recovery Planner** to find the highest-leverage acceleration.

---

## 2.3 Project Manager (PM)

**You need:** RFIs, submittals, schedule, cost, coordination — under control daily.

**Your home screens:** Focus · Coordination · RFIs · Submittals · Cost Control · Change Orders · Meetings

**Daily routine**
1. **Nav → Focus.** Work top-down: clear Critical, then High.
2. **Nav → Coordination.** This shows where the project is *blocked* — missing approvals, dependency blockers, out-of-sequence tasks, open BIM clashes, pending change orders. Resolve or escalate each.
3. **RFIs:** open an RFI → read the **🤖 RFI Copilot** panel: has this been asked before, who should answer, and the schedule impact. Respond or reassign.
4. **Submittals:** open a submittal → the **review assistant** runs readiness checks, finds precedent, suggests a reviewer, and flags deviation risk. Route accordingly.
5. **Change Orders / Cost Control:** keep pricing and variances current.
6. **Meetings:** capture minutes and decisions; action items auto-link.

**Weekly**
- **Nav → Cost IQ** to understand *why* the budget moved, with cited drivers.
- **Nav → Schedule Forecast** to check completion probability and run **what-if** on a slipping task.

---

## 2.4 Construction Manager

**You need:** field execution, issue resolution, progress tracking.

**Your home screens:** Construct · Daily Logs · Schedule Forecast · Subcontracts · Procure Risk · Coordination

**Routine**
1. Review **Daily Logs** for production, manpower, weather, and delay flags.
2. **Nav → Coordination** to clear field blockers and out-of-sequence work.
3. **Nav → Procure Risk** to catch late equipment before it stops a crew — overdue, arriving-late, and not-yet-issued POs, ranked by dollars at risk.
4. **Nav → Schedule Forecast** to see the critical path and test recovery options.

---

## 2.5 Superintendent (Field)

**You need:** daily planning, manpower, productivity — often offline.

**Your home screens:** Daily Logs · Field Service · Field Assistant · Inspections · Punch List

**Daily routine**
1. **Nav → Field Assistant.** Ask the day's questions: *what's behind schedule, what's blocking Area B, what inspections are due today?*
2. **Daily Logs:** record crew, weather, equipment, production, and any delay/safety flags. Works offline — entries sync when you're back online.
3. **Inspections / Punch List:** run checklists and log punch items with photos and locations from the field; queue offline and sync.
4. End of day: confirm your daily log is complete; it feeds the PM's reports automatically.

**Tips**
- Field screens are built to work without signal — capture now, sync later.
- A failed inspection can be turned into a formal NCR automatically (see QA/QC track).

---

## 2.6 QA/QC Manager

**You need:** inspections, deficiencies, quality records, and trends.

**Your home screens:** Inspections · Punch List · Quality IQ · NCR / CAPA

**Routine**
1. **Inspections:** run template checklists (ACI 318, UL 1479 firestop, MEP rough-in, etc.), record pass/fail/na, attach photos, sign.
2. Failed items become **punch items** or **deficiencies**, assigned and tracked to verification.
3. **Nav → NCR / CAPA → "⚙ Auto-raise from failures"** to create non-conformance reports for any failed inspection that doesn't have one yet (idempotent — it won't duplicate). Then set disposition, root cause, and add corrective/preventive actions tracked to closure.
4. **Nav → Quality IQ** weekly: recurring issues by discipline + keyword, discipline performance (fail rate, open punch, close speed, quality score), and location hotspots.

---

## 2.7 Safety (EHS) Manager

**You need:** observations, incidents, near-misses, and leading indicators.

**Your home screens:** Safety

**Routine**
1. **Nav → Safety.** Log **observations** (unsafe conditions/acts, hazards, positives) and **incidents** (near-miss, first-aid, injury, property, environmental) with severity and location.
2. Read the **predictive engine**: the **risk index** (0–100), high-risk areas, recurring hazards, and your **observation-to-incident ratio** (a strong leading-indicator/reporting-culture signal).
3. Drive open high-severity items to closure; watch the recurring-hazard list for patterns.

---

## 2.8 Cost Manager / Project Controls

**You need:** budgets, forecasting, change control, earned value, and billing.

**Your home screens:** Budget · Change Orders · Cost Control · Cost Entry · EVM · Cost IQ · Billing

**Routine**
1. **Budget:** maintain original / approved-change / revised budgets by cost code and WBS.
2. **Change Orders:** price → approve → execute; cost and schedule impacts roll into the revised budget.
3. **Cost Entry / Cost Control:** keep committed and actual costs current.
4. **EVM:** review SPI/CPI, EAC/ETC, S-curves.
5. **Nav → Cost IQ:** read *why* the forecast is moving — cited drivers (approved/pending change orders, forecast overrun, contingency pressure), overrun risk, and the **subcontract commitment rollup** (committed vs. billed vs. retention held).
6. **Billing:** generate **AIA G702/G703 pay applications** from the schedule of values — completed-to-date, retention, and current payment due — and move them through draft → submitted → approved → paid.

---

## 2.9 Procurement / Contracts Manager

**You need:** vendor evaluation, purchase orders, material tracking, and supply-chain risk.

**Your home screens:** Subcontracts · Procure Risk · Vendor Scorecard · Directory

**Routine**
1. **Subcontracts:** manage bid packages, comparisons, awards, schedules of values, and invoices.
2. **Nav → Procure Risk:** predict late equipment — overdue, arriving-late, and not-yet-issued POs — plus vendor supply-chain risk, ranked by dollars at risk. Expedite the top items.
3. **Nav → Vendor Scorecard:** each vendor's standing across commitments, billing, on-time delivery, and at-risk POs — ranked weakest-first for award and recovery decisions.

---

## 2.10 Design / Engineering

**You need:** design coordination, drawings, specs, and engineering tools.

**Your home screens:** FEED · Drawings · BIM · Eng Hub · Fix Library · Process Design · Calcs

**Routine**
1. **Drawings:** maintain the sheet register, revisions, and red-line markups.
2. **BIM:** upload IFC models and track clash/coordination issues.
3. **FEED / Eng Hub / Fix Library:** front-end design surfaces and reusable fix patterns (searchable by Ask Jarvis).
4. **Process Design / Calcs:** generate ISA-5.1 P&ID/PFD diagrams (with DXF export).

> **Important:** the embedded discipline *calculators* (WWTP/PWTP/HVAC/NEC/stormwater/process) are **design-assist/drafting aids**, not validated calculation engines. Do not rely on their numbers for certified work — use your sealed calculation tools and treat these as drafting/coordination aids.

---

## 2.11 Contractor / Subcontractor

**You need:** drawings, submittals, RFIs, and your assigned tasks.

**Your home screens:** Drawings · Submittals · RFIs · Actions · Notifications

**Routine**
1. **Notifications:** check what's been assigned or is due.
2. **Drawings:** pull the latest sheets and revisions.
3. **Submittals / RFIs:** submit and respond; watch overdue tracking.
4. **Actions:** work your assigned items to completion.

---

## 2.12 Owner / Client

**You need:** visibility, confidence, accountability.

**Your home screens:** Predict · Executive (owner report) · Documents · Transmittals

**Routine**
1. **Nav → Predict** / project health for a read-only status.
2. Ask your PM for the **owner report** (generated from **Executive → 📄 Report**) for a clean weekly/board narrative.
3. **Documents / Transmittals** for the formal record. The **audit log** provides an immutable trail for accountability.

---

# Part 3 — Module Reference (step-by-step)

### Projects (Nav → Projects)
Create and manage the project registry — code, client, location, contract value, phases, status. Set the project's budget, planned start/finish, and team here.

### RFIs (Nav → RFIs)
1. Select your project → **+ New RFI**: title, description, discipline, priority, assignee, due date.
2. Open an RFI to see the **RFI Copilot** (precedent, suggested responder, schedule impact).
3. **Respond** to record the answer; status moves open → answered → closed.

### Submittals (Nav → Submittals)
1. **+ New submittal**: number, title, type, discipline, spec section, due date.
2. Open it → **review assistant** readiness checks + precedent + reviewer suggestion.
3. **Review** with a disposition: approved / approved-as-noted / revise & resubmit / rejected.

### Inspections (Nav → Inspections)
1. **+ New inspection** from a template → run the checklist → record pass/fail/na, photos, signature.
2. **Complete** stamps the result; failures feed Quality IQ and can auto-raise NCRs.

### Punch List (Nav → Punch List)
Create lists and items with location, trade, priority, due date, drawing pins, and photos. Verify and close items; Focus surfaces overdue and high-priority punch.

### NCR / CAPA (Nav → NCR / CAPA)
1. **+ Raise** an NCR (or **⚙ Auto-raise from failures**).
2. Set **status**, **disposition**, and **root cause**.
3. Add **corrective actions** and track them open → in-progress → completed → verified.

### Safety (Nav → Safety)
Log observations and incidents; read the risk index, high-risk areas, recurring hazards, and leading indicators.

### Schedule (Nav → Import Schedule, Schedule Forecast)
1. **Import Schedule:** drag in a P6 XER or MS Project XML; CPM and baseline parse automatically.
2. **Schedule Forecast:** **Run** Monte Carlo → P10/P50/P80/P90 + probability of a target date; review **criticality**, the **critical path**, the **recovery plan**, and the **what-if** simulator (pick a task, set a delay, see the new finish).

### Cost (Nav → Budget, Change Orders, Cost Control, Cost Entry, EVM, Cost IQ)
Maintain budgets and change orders; enter actuals; review EVM; open **Cost IQ** for cited drift drivers and the commitment rollup.

### Billing (Nav → Billing)
1. Add **Schedule of Values** lines.
2. **+ New application** (seeded from the SOV).
3. Enter this-period work + materials; the G702/G703 totals (retention, current payment due) compute automatically.
4. Move the application draft → submitted → approved → paid.

### Procurement (Nav → Subcontracts, Procure Risk, Vendor Scorecard, Directory)
Manage subcontracts/POs; monitor Procure Risk; review the Vendor Scorecard.

### Documents (Nav → Documents, Drawings, Transmittals, BIM)
Upload and search documents; manage drawings/markups; issue transmittals; coordinate BIM clashes.

### AI (Nav → Focus, Coordination, Executive, Portfolio IQ, Autopilot, Predict, Ask Jarvis)
The intelligence layer. **Autopilot** monitors and recommends actions (with owners/dates) for human approval — nothing executes without sign-off, and every decision is logged.

---

# Part 4 — Administrator Guide

### 4.1 Tenancy & access
- Each organization is an isolated tenant; data is separated at the database level.
- Assign each user a **role**: Owner, Admin, Project Manager, Engineer, or Viewer. Roles control which domains a user sees and whether they can write.

### 4.2 Single sign-on & provisioning
- **SAML SSO:** connect your identity provider (Okta, Azure AD) so users sign in with corporate credentials and MFA.
- **SCIM:** auto-provision and de-provision users from your IdP — joiners get access, leavers are removed automatically.

### 4.3 Setup checklist
1. Create the organization and invite admins.
2. Connect SSO/SCIM (or invite users manually).
3. Create projects; set budgets, dates, and assign teams.
4. Load inspection templates, cost codes/WBS, and the schedule of values.
5. Import the schedule (P6/MSP).
6. Configure notifications, automation rules, and any integrations/webhooks.

### 4.4 Governance & audit
- Every change is captured in the **audit log**; AI/autonomous actions are recorded in an immutable decision ledger.
- **Automation** lets you create rule-based actions/compliance tasks; the **MCP** and **Integrations** screens manage tool bridges, connectors, and webhook delivery.

### 4.5 Integrations (today vs. roadmap)
Available now: QuickBooks, Slack, Microsoft Teams, plus webhook delivery and data-warehouse exports. On the roadmap: Primavera P6, Procore, Autodesk Construction Cloud, Oracle Aconex/Unifier, SAP, Power BI.

---

# Part 5 — Glossary

- **Focus** — the ranked, cross-module daily briefing of what needs attention.
- **Copilot** — an AI assistant scoped to a domain (Project/Coordination/Executive/Portfolio, RFI, Submittal review).
- **Criticality index** — how often a task lands on the critical path across Monte Carlo runs.
- **CPM** — Critical Path Method; the schedule network that drives float and the critical path.
- **EVM** — Earned Value Management (SPI/CPI, EAC/ETC).
- **G702/G703** — AIA progress-billing forms: the payment summary (G702) and continuation sheet (G703).
- **NCR / CAPA** — Non-Conformance Report / Corrective & Preventive Action.
- **Retention (retainage)** — the percentage of billing held back until completion.
- **SOV** — Schedule of Values; the breakdown a contract is billed against.
- **WBS** — Work Breakdown Structure.
- **Disposition** — the decision on a non-conformance (use-as-is / rework / repair / reject / return).

---

# Part 6 — Quick reference: "I need to…"

| I need to… | Go to |
|---|---|
| See what to work on today | 🧭 Focus |
| Find what's blocking the project | 🔗 Coordination |
| Brief the board / owner | 📋 Executive → 📄 Report |
| Compare projects / spot resource conflicts | 🗂️ Portfolio IQ |
| Answer an RFI well | ❓ RFIs (RFI Copilot panel) |
| Pre-screen a submittal | 📨 Submittals (review assistant) |
| Forecast completion / test a delay | 🎲 Schedule Forecast |
| Understand a budget change | 💸 Cost IQ |
| Bill the owner | 🧾 Billing |
| Catch late equipment | 🚚 Procure Risk |
| Judge a vendor | 🏅 Vendor Scorecard |
| Run quality trends | 🔬 Quality IQ |
| Log a safety event | 🦺 Safety |
| Raise / track a non-conformance | 🚫 NCR / CAPA |
| Ask a question of project docs | 💬 Ask Jarvis |
| Add/remove users, SSO | ⚙️ System / Administrator Guide |

---

*Denver Engineering — Procore stores your project. This platform understands it.*
