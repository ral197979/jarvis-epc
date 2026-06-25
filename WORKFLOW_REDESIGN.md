# Denver Engineering — AI-Native Workflow & Navigation Redesign

> **Goal:** turn Denver Engineering from a collection of modules into a cohesive,
> AI-native EPC project operating system — project-centric, workflow-driven,
> decision-driven, AI-guided, role-aware, lifecycle-based.
>
> **Non-goals (hard constraints):** do **not** remove any functionality, do **not**
> change the visual style, do **not** simplify engineering functionality. This is an
> **information-architecture, navigation, workflow, and UX redesign** — every existing
> screen is preserved and re-homed, never deleted.
>
> Status: **v1 design spec** (this document). Grounded in the live nav
> ([src/config/navigation.ts](src/config/navigation.ts)) and router
> ([src/components/ContentRouter.tsx](src/components/ContentRouter.tsx)).
> Companion docs: [TRAINING_MANUAL.md](TRAINING_MANUAL.md) · [CUSTOMER_FEATURES.md](CUSTOMER_FEATURES.md) · [USER_WORKFLOWS.md](USER_WORKFLOWS.md) · [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md)

---

## How to read this document

It is organized around the **13 deliverables** in the brief, in build-order:

1. [New Information Architecture](#1-new-information-architecture)
2. [New Sidebar Structure](#2-new-sidebar-structure)
3. [Updated Navigation Flows](#3-updated-navigation-flows)
4. [Project Lifecycle Map](#4-project-lifecycle-map)
5. [Role-Based User Journeys](#5-role-based-user-journeys)
6. [Project Setup Wizard](#6-project-setup-wizard)
7. [Universal "My Work" Workspace](#7-universal-my-work-workspace)
8. [Approval Gate Framework](#8-approval-gate-framework)
9. [Cross-Module Relationship Model](#9-cross-module-relationship-model)
10. [Updated Wireframes](#10-updated-wireframes)
11. [UX Improvements](#11-ux-improvements)
12. [Updated Documentation plan](#12-updated-documentation-plan)
13. [Migration Plan — every current screen mapped](#13-migration-plan--every-current-screen-mapped)

Then: [Implementation Sequencing](#implementation-sequencing) and
[Open Decisions](#open-decisions).

---

## Design principles (applied throughout)

| Principle | What it means in this redesign |
|---|---|
| **Project-centric** | A project is always selected and always shown in the header (name · phase · gate · health). Cross-project screens (Focus portfolio, Executive, Portfolio IQ) are the only exceptions. |
| **Workflow-driven** | The sidebar follows the **EPC lifecycle**, not the software's module list. Each section feeds the next. |
| **Decision-driven** | Landing is **Focus**, not Dashboard. Executives get a **Decision Queue**. Every screen surfaces "what needs a decision." |
| **AI-guided** | Every major screen answers the eight standard questions (§16 of the brief) in a consistent **AI strip**. |
| **Role-aware** | The sidebar, landing screen, and My Work filters adapt to the user's permission tier (Owner / Admin / PM / Engineer / Viewer — already enforced in [NavSidebar.tsx](src/components/NavSidebar.tsx)). |
| **Lifecycle-based** | Every project shows where it is on the lifecycle timeline and which gate is next. |

**The "never wonder what's next" rule:** every screen offers a *next logical step*
via breadcrumbs, a "Next Step" affordance, and the AI strip's "What should I do next?"

---

## 1. New Information Architecture

The platform is reorganized into **four planes**. Each current screen lives in exactly
one plane (with deep-links across planes). This separates *daily work* from *lifecycle
execution* from *intelligence* from *governance*.

```
┌─────────────────────────────────────────────────────────────────────┐
│ PLANE 1 — PERSONAL (where every user starts)                          │
│   Focus · My Work · Notifications                                      │
├─────────────────────────────────────────────────────────────────────┤
│ PLANE 2 — PROJECT LIFECYCLE (the EPC spine; project-scoped)           │
│   Setup → Planning → Engineering → Procurement → Construction →       │
│   Quality → Safety → Commercial → Commissioning(ext) → Turnover →     │
│   Operations                                                          │
├─────────────────────────────────────────────────────────────────────┤
│ PLANE 3 — INTELLIGENCE (cross-cutting, mostly portfolio-scoped)       │
│   Focus(portfolio) · Coordination · Predict · Autopilot · Ask Jarvis ·│
│   Executive · Portfolio IQ                                             │
├─────────────────────────────────────────────────────────────────────┤
│ PLANE 4 — GOVERNANCE / ADMIN (org-scoped)                             │
│   Project Setup Wizard · Team/Roles · Automation · Integrations ·     │
│   MCP · Knowledge · Audit · System                                    │
└─────────────────────────────────────────────────────────────────────┘
```

**Information-architecture rules**
- **One home per record type.** A record's canonical screen is its lifecycle-phase home (e.g., an RFI lives under *Engineering → RFIs*). It can *appear* in Focus, My Work, Coordination, and related-record panels, but it is *edited* in one place.
- **Three-click reach.** Any task is reachable in ≤3 clicks: Plane → Phase → Screen, or one click from Focus/My Work.
- **Context follows you.** The selected project, the active phase, and the user's role persist across all Plane 2 screens.

---

## 2. New Sidebar Structure

Replaces the current flat, module-ordered list with a **collapsible, lifecycle-grouped**
sidebar. Section order matches the EPC lifecycle so the eye travels the way a project does.

> Implementation note: the data already supports this. [navigation.ts](src/config/navigation.ts)
> has a `domain` per item and a `NAV_DOMAINS` grouping. The redesign introduces a richer
> `phase` grouping (below) and renders the sidebar as collapsible sections. No screen is removed.

```
DENVER ENGINEERING            [project: Cactus DC ▾]

▸ PERSONAL
    🧭 Focus                    ← default landing
    🗂️ My Work                  ← NEW
    🔔 Notifications

▸ PROJECT SETUP
    🧙 Setup Wizard             ← NEW
    📋 Projects
    👥 Team & Roles
    🎯 CRM
    📄 Proposals

▸ PLANNING
    📅 Import Schedule
    🎲 Schedule Forecast
    ⚠️ Risk Register
    💰 Budget
    📋 Meetings

▸ ENGINEERING            (FEED → IFC → field, see §5)
    🔬 FEED
    🧪 Process Design
    🧮 Calcs
    📐 Drawings
    🏢 BIM
    🛠️ Eng Hub
    🔧 Fix Library
    ❓ RFIs
    📨 Submittals

▸ PROCUREMENT
    🏗️ Subcontracts
    🚚 Procure Risk
    🏅 Vendor Scorecard
    📚 Directory

▸ CONSTRUCTION
    🏗️ Construct                ← "Today's Plan" hub (see §8 of brief)
    🗓️ Daily Logs
    🛠️ Field Service
    🦺 Field Assistant
    ⏱️ Timesheets
    📡 IoT Sensors

▸ QUALITY
    🔍 Inspections
    📌 Punch List
    🚫 NCR / CAPA
    🔬 Quality IQ

▸ SAFETY
    🦺 Safety
    🛡️ Compliance

▸ COMMERCIAL
    🔄 Change Orders
    📉 Cost Control
    💵 Cost Entry
    📊 EVM
    🧾 Billing
    💸 Cost IQ

▸ COMMISSIONING  (external integration — see §17 of brief)
    🔗 Launch Commissioning Workspace   ← NEW handoff (link out)
    📦 Commissioning Status (read-back)  ← NEW

▸ TURNOVER
    📦 Turnover Packages        ← NEW (assembled from existing records)
    📬 Transmittals
    🗄️ Documents

▸ OPERATIONS
    💰 Portfolio (financial)
    (post-turnover handoff)

▸ AI
    🔗 Coordination
    🔮 Predict
    🤖 Autopilot
    🤖 Ask Jarvis

▸ EXECUTIVE
    📋 Executive
    🗂️ Portfolio IQ
    📊 Dashboard               ← now informational only

▸ ADMINISTRATION
    ⚙️ Automation
    🔗 Integrations
    🔌 MCP
    📚 Knowledge
    🧾 Audit Log
    ⚙️ System
```

**Sidebar behavior**
- Sections are **collapsible**; the section containing the active screen auto-expands.
- **Role filtering** hides whole sections a tier can't use (extends the existing role filter in [NavSidebar.tsx](src/components/NavSidebar.tsx)).
- **Phase highlighting:** the section matching the project's *current lifecycle phase* gets a subtle marker so users see "this is where the project is."
- Existing **drag-reorder / hide** personalization (`navOrder` / `navHidden`) is preserved, now scoped within sections.

---

## 3. Updated Navigation Flows

### 3.1 Login flow
```
Login ─▶ Focus (personal)            [NOT Dashboard]
              │
              ├─ click a card ─▶ the exact record (deep-link, project pre-selected)
              └─ "My Work" ─▶ personal queue across all modules
```
Change: default `activeTab` becomes `focus` (today it lands on `dash`). Dashboard demotes
to the **Executive** section as an informational KPI/trend screen.

### 3.2 The universal "act on something" flow
```
Focus / My Work ─▶ Record ─▶ [Related panel] ─▶ Related record ─▶ Action ─▶ back to queue
```
Every record screen gains a consistent footer: **‹ Previous Step | Next Step ›** plus a
**Related** rail (§9). The user never dead-ends.

### 3.3 Phase-to-phase flow (the spine)
```
Setup ▶ Planning ▶ Engineering ▶ Procurement ▶ Construction ▶ Quality/Safety
      ▶ Commercial ▶ Commissioning(ext) ▶ Turnover ▶ Operations
```
Each phase screen header shows **current gate / next gate / outstanding items** (§8) and a
**"Advance to next phase"** affordance gated by approval.

### 3.4 Standard action grammar (every module)
`Create → Assign → Review → Approve/Reject → Verify → Close`
Buttons, colors, and verbs are standardized (§11) so the same action looks the same everywhere.

---

## 4. Project Lifecycle Map

A horizontal, always-available **lifecycle timeline** rendered in the project header and in
full on the project home. Each stage shows status (done / active / upcoming), % complete,
the controlling gate, and the owner.

```
 ●━━━━━●━━━━━●━━━━━◐─────○─────○─────○─────○─────○
 Plan  Eng  Proc  CONST  Mech  Comm  Perf  Turn  Ops
                  ▲ you are here          (ext)
 Gate: 90% Design ✔   Next gate: Construction Release (owner: J. Patel, 3 items open)
```

**Stage → controlling gate (default template; configurable per project):**

| # | Lifecycle stage | Entry gate | Source records that prove completion |
|---|---|---|---|
| 1 | Planning | Project chartered | Budget set, baseline schedule imported, WBS/cost codes loaded |
| 2 | Engineering | 30% / 60% / 90% Design, IFC | Calcs, PFDs, P&IDs, datasheets, IFC drawing set, closed RFIs |
| 3 | Procurement | Material Approval | Awarded subcontracts/POs, approved submittals, vendor selection |
| 4 | Construction | Construction Release | Daily logs, installed quantities, progress %, field inspections |
| 5 | Mechanical Completion | MC declared | Inspections passed, punch burndown, NCRs closed |
| 6 | Commissioning *(external)* | Ready for Commissioning | Handoff package issued; status read back from commissioning platform |
| 7 | Performance Testing *(external)* | Performance accepted | Test results received from commissioning platform |
| 8 | Turnover | Ready for Turnover | Turnover packages complete, transmittals issued, as-builts |
| 9 | Operations | Accepted for Operations | Final docs, warranty/O&M handed over |

The map is **derived, not manually maintained**: each gate's "outstanding requirements"
count is computed from the underlying records (the same deterministic pattern as Focus).

---

## 5. Role-Based User Journeys

Each journey starts at **Focus** and stays inside the new IA. (Full role detail lives in
[TRAINING_MANUAL.md](TRAINING_MANUAL.md); these are the *navigation* journeys.)

### Executive
```
Focus(portfolio) ▶ Executive ▸ Decision Queue ▶ pick a project ▶ Board Report
        └─ Portfolio IQ (compare) · Predict (forecast)
```
Operational modules are never the first thing an executive sees (§12).

### Project Manager
```
Focus ▶ Coordination (what's blocked) ▶ RFIs/Submittals ▶ Change Orders ▶ Cost IQ
   header always shows phase + gate; "Advance phase" when the gate clears
```

### Superintendent (Construction phase)
```
Construct ▸ Today's Plan ▶ Crew ▶ Equipment ▶ Deliveries ▶ Safety Brief ▶
Field Execution ▶ Inspections ▶ Progress ▶ Daily Log ▶ Issues ▶ Tomorrow
```
This is the §8 daily flow rendered as a single guided strip inside *Construction → Construct*.

### QA/QC (continuous-improvement loop, §9)
```
Inspection ▶ Deficiency ▶ Corrective Action ▶ Verification ▶ Closeout ▶ Trend (Quality IQ)
```
Existing screens (Inspections, Punch, NCR/CAPA, Quality IQ) are sequenced into this loop;
"Deficiency" is the unifying term for a failed-inspection item / punch item.

### Safety (daily flow, §11)
```
Morning Brief ▶ Permits ▶ Hazard Review ▶ Observations ▶ Corrective Actions ▶
Incident Investigation ▶ Lessons Learned ▶ Weekly Trends
```
Rendered as a guided flow inside *Safety*; dashboards are secondary.

### Procurement (lifecycle, §10)
```
Need ▶ Requisition ▶ RFQ ▶ Bid Eval ▶ Vendor Selection ▶ PO ▶ Manufacturing ▶
Shipping ▶ Receiving ▶ Inspection ▶ Warehouse ▶ Installed ▶ Ready for Commissioning
```
Mapped onto Subcontracts + Procure Risk + Vendor Scorecard + Directory; Procure Risk runs
*throughout* the flow, not as a separate screen.

### Engineering (FEED → As-Built, §5)
```
Requirements ▶ Basis of Design ▶ Calcs ▶ PFDs ▶ P&IDs ▶ Equipment Selection ▶
Datasheets ▶ Specifications ▶ Vendor Reviews ▶ 3D Models ▶ Construction Drawings ▶
IFC ▶ Field Engineering ▶ As-Built
```
Maps onto FEED, Process Design, Calcs, Drawings, BIM, Eng Hub, Fix Library, RFIs,
Submittals — **reordered, nothing removed**. (Honesty note preserved: the discipline
*calculators* remain design-assist, not validated engines.)

### Client / Owner (§13)
```
My Projects ▶ Project Health ▶ Approvals Waiting ▶ Reports ▶ Documents ▶ Transmittals ▶ Audit Trail
```
Viewer tier; read-only; simple surface built from existing read screens + the owner report.

---

## 6. Project Setup Wizard

A new guided, resumable flow that initializes a whole project before execution. Each step
writes to existing tables; the wizard is an orchestration layer, not new data silos.

```
1  Project Information   →  projects (name, code, client, location, type)
2  Organization          →  company/tenant context, distribution lists
3  Roles                 →  team assignments + permission tiers
4  Contract              →  contract value, type, key dates
5  Budget                →  budget by cost code (seeds Budget/Cost Control)
6  Schedule              →  import P6/MSP or create baseline (Schedule)
7  WBS                   →  work breakdown structure
8  Cost Codes            →  cost-code library
9  Disciplines           →  active disciplines (drives Engineering + Quality templates)
10 Document Structure    →  folder/numbering scheme (Documents/Drawings/Transmittals)
11 Templates             →  inspection checklists, submittal/RFI types, report templates
12 Automation Rules      →  default SLA/escalation/notification rules (Automation)
13 Go Live               →  validate completeness → set phase=Planning, gate=chartered
```

**Behavior:** progress is saved per step (resumable); each step shows a completeness check;
"Go Live" runs a readiness validation and stamps the project onto the lifecycle map at
*Planning*. Admin/Owner/PM tiers only.

---

## 7. Universal "My Work" Workspace

A new global screen aggregating every actionable record assigned to or owned by the user,
across all modules — the personal complement to the project-centric Focus.

**Sections (tabs or stacked lanes):**
| Lane | Contents | Build status |
|---|---|---|
| Assigned to me | Anything where I'm the owner/assignee, open | **Shipped (W2)** — RFIs, punch, CAPA, actions, inspections |
| Needs my approval | Approval-gated items in my court (COs, submittals) | **Shipped (W2)** — submittals + change orders where I'm reviewer |
| Overdue | Past due, any module | **Shipped (W2)** — derived from due dates |
| Upcoming this week | Due in the next 7 days | **Shipped (W2)** — derived from due dates |
| Completed today | Closed by me today (sense of progress) | **Shipped (W2)** — actions closed today |
| Waiting on others | Items I created/own that are blocked on someone else | **Deferred** — needs a `created_by`-vs-assignee distinction not yet modeled |
| Blocked | My items with an unresolved blocker | **Deferred** — needs a blocker relation not yet modeled |

> **W2 honesty note:** the five shipped lanes are backed by real columns
> (`assigned_to` / `reviewed_by` / `assigned_to_user_id` + status + due date). The
> two deferred lanes are intentionally **not** rendered rather than faked — they
> require ownership/blocker data the schema doesn't carry yet. The categorizer
> (`categorizeMyWork`) is pure and unit-tested; the LLM is not involved.

**Aggregated record types:** RFIs, Submittals, Punch items, Inspections, Meetings/action
items, Budget approvals, Change Orders, Safety actions, NCRs/CAPAs, Drawing reviews,
Vendor approvals, Engineering reviews. (One unified queue — every row deep-links to its
canonical record.)

**Implementation:** a read-model that unions the per-module "assigned/owned/overdue"
queries by `assignee = current user` and status, ordered by due date / severity. This reuses
the same cross-module reads that already power Focus and the Action Center
([api/services/actionService.ts](api/services/actionService.ts)).

---

## 8. Approval Gate Framework

A reusable gate object attached to a project phase. Gates make "where are we / what's
blocking advancement" explicit and uniform.

**Gate record (conceptual):**
```
gate {
  id, project_id, phase, name,            // e.g. "90% Design", "Construction Release"
  owner,                                   // who approves
  status: pending | met | approved | waived,
  requirements: [ { label, source, satisfied } ],   // derived from real records
  expected_date,
  approved_by, approved_at
}
```

**Default gate set** (configurable per project): `30% Design · 60% Design · 90% Design ·
IFC Approval · Material Approval · Construction Release · Mechanical Completion ·
Ready For Commissioning · Ready For Turnover · Ready For Operations`.

> **W3 shipped (grounded in the real schema).** Rather than the aspirational 10-gate
> set above, the implementation keys gates to the existing `project_phase` enum
> (`feasibility → feed → detailed_design → procurement → construction →
> commissioning → closeout`). One entry gate per phase, each with requirements
> **computed live** from records (budget set, open critical RFIs, submittals in
> review, pending change orders, failed inspections, open NCRs, punch burndown).
> Approvals persist in `project_gates`; `buildLifecycle` is pure/unit-tested;
> advancement requires the controlling gate to be `approved` or `waived`. The
> richer per-percentage gate set remains a configurable enhancement (open
> decision #1).

**Every project header displays:** Current Gate · Next Gate · Owner · Outstanding
Requirements (count + list) · Expected Completion. Requirements are **computed** from
underlying records (e.g., "all 90% drawings IFC-stamped", "0 open critical RFIs",
"budget approved") — never hand-tracked. Advancing a phase requires its entry gate to be
`approved` (or explicitly `waived` with audit).

---

## 9. Cross-Module Relationship Model

Every record screen gains a **Related** rail that auto-surfaces connected records, so users
never search manually. Relationships already exist implicitly via foreign keys and
project/discipline/spec associations; this surfaces them.

**Canonical relationship graph:**
```
RFI ─ Drawing ─ Specification ─ Submittal ─ Vendor ─ Purchase Order ─
Schedule Activity ─ Cost Code ─ Inspection ─ Punch Item ─ NCR ─
Turnover Package ─ Commissioning Package
```

**Rules**
- Each record shows its directly-linked neighbors grouped by type, with counts and status chips.
- Links are **bidirectional** (an RFI shows its drawing; the drawing shows its RFIs).
- Each related item deep-links to its canonical home (§1) with context preserved.
- The graph is the substrate for AI answers to "what's the schedule/cost impact?" (§16).

**Link sources (already present or derivable):** project_id, discipline, spec_section,
drawing refs, cost_code, schedule activity id, vendor/PO ids, and the Action Center's
cross-module `source/sourceId` channel used by the existing deep-link system
(`openRecord({tab, source, sourceId, projectId})`).

---

## 10. Updated Wireframes (text)

### 10.1 Global shell
```
┌───────────────────────────────────────────────────────────────────────────┐
│ [≡] Denver Engineering   Project: Cactus DC ▾   Phase: Construction         │
│                          Gate: Construction Release ✔  Health: ● 82  [🔔3]   │
├──────────────┬────────────────────────────────────────────────────────────┤
│ SIDEBAR      │ Breadcrumb: Construction › Inspections › INS-1042            │
│ (lifecycle   │ ┌────────────────────────────────────────────────────────┐ │
│  sections,   │ │ AI STRIP  ⚠ 2 need attention · changed today: 3 ·       │ │
│  collapsible)│ │ blocked: 1 · owner: you · next: verify firestop · +4d   │ │
│              │ └────────────────────────────────────────────────────────┘ │
│              │  [ main content / record ]              ┌── Related ───────┐ │
│              │                                         │ Drawing A-101    │ │
│              │                                         │ Submittal 03-12  │ │
│              │                                         │ NCR-77 (open)    │ │
│              │  ‹ Previous Step        Next Step ›     │ Cost code 03300  │ │
│              │                                         └──────────────────┘ │
└──────────────┴────────────────────────────────────────────────────────────┘
```

### 10.2 Focus (landing)
```
🧭 Focus — Tuesday                         [scope: This project ▾ | Portfolio]
[ Critical 3 ][ High 7 ][ Medium 12 ][ Low ]      ← severity filter chips
┌─ CRITICAL ──────────────────────────────────────────────────────────────┐
│ RFI-219 overdue 4d · blocks slab pour · schedule +3d · → Open RFI         │
│ Submittal 05-40 stalled · steel delivery at risk · → Review submittal     │
│ NCR-77 open · firestop · area B · → Disposition                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### 10.3 My Work
```
🗂️ My Work
[Assigned 9][Waiting 4][Approvals 3][Blocked 2][Overdue 5][Done today 6][Week 11]
─ Needs my approval ───────────────────────────────────────────────────────
 CO-014  $48,200  PM submitted  · cost +1.2% · → Review
 Submittal 23-01  HVAC  · due tomorrow      · → Review
 Vendor: Pueblo Steel  prequal  · → Approve
```

### 10.4 Project home — lifecycle + gates
```
Cactus DC                                  Health ● 82  Phase: Construction
 ●━━●━━●━━◐──○──○──○──○──○   Plan Eng Proc CONST Mech Comm Perf Turn Ops
 Current gate: Construction Release ✔   Next: Mechanical Completion
 Outstanding for next gate (owner: J. Patel):
   ☐ Punch burndown 88% (target 100%)   ☐ 2 open critical NCRs   ☐ MEP rough-in inspection
 [ Advance phase ]  (disabled until gate met)
```

### 10.5 Setup Wizard
```
🧙 New Project — Step 5 of 13: Budget                         ●●●●●○○○○○○○○
 Cost code      Description            Amount
 01000          General Conditions     $ ______
 03300          Cast-in-place concrete $ ______
 [ + add code ]                    Total: $ ___________
 ‹ Back: Contract            Save & continue: Schedule ›
```

---

## 11. UX Improvements

| Improvement | Specification |
|---|---|
| Lifecycle sidebar | Sections follow the EPC lifecycle (§2), collapsible, role-filtered, current-phase highlighted. |
| Selected project always visible | Header shows project name on every screen; persists across navigation. |
| Breadcrumbs | `Plane › Phase › Screen › Record` on every screen. |
| Previous/Next step | Record and phase screens expose `‹ Previous | Next ›` where a logical sequence exists. |
| Header status block | Project health + current phase + gate status shown in the header at all times. |
| Standardized action buttons | One grammar everywhere: `Create / Assign / Review / Approve / Reject / Verify / Close` — same labels, colors, placement. |
| ≤3-click reach | Plane → Phase → Screen, or one hop from Focus/My Work. No task buried deeper. |
| Consistent terminology | A shared glossary enforced in UI copy (e.g., "Deficiency" for failed-inspection/punch items; "Gate" for phase approvals; "Package" for turnover/commissioning bundles). |
| AI strip | Standard band on major screens answering the eight §16 questions. |

---

## 12. Updated Documentation plan

On implementation, these docs are updated/created (no code in this deliverable):
- **TRAINING_MANUAL.md** — re-sequence role tracks to the new lifecycle nav; add Setup Wizard, My Work, gates.
- **SCREEN_INVENTORY.md** — annotate each screen with its new plane/phase home (the §13 map).
- **USER_WORKFLOWS.md** — replace module-walkthroughs with the lifecycle/role journeys (§5).
- **CUSTOMER_FEATURES.md** — re-group features by lifecycle plane; add gates, lifecycle map, My Work.
- **New: NAVIGATION.md** — the authoritative sidebar/IA reference for engineers (mirrors §2/§13).

---

## 13. Migration Plan — every current screen mapped

Every screen in [navigation.ts](src/config/navigation.ts) is **preserved** and assigned a new
home. No `id`, route, or component is removed — only the grouping/order changes and a few new
screens are added. `TAB_MAP` in [ContentRouter.tsx](src/components/ContentRouter.tsx) is untouched
except for additions.

| Current id | Current label | Current domain | → New plane | → New section / phase | Notes |
|---|---|---|---|---|---|
| `focus` | Focus | ai | Personal | Personal | **New default landing** |
| `actions` | Actions | operations | Personal | (feeds **My Work**) | Action Center backs My Work |
| `notifications` | Notifs | operations | Personal | Personal | |
| `dash` | Dashboard | operations | Executive | Executive (informational) | **Demoted** from landing |
| `projects` | Projects | operations | Lifecycle | Project Setup | |
| `crm` | CRM | crm | Lifecycle | Project Setup | |
| `proposals` | Proposals | crm | Lifecycle | Project Setup | |
| `team` | Team | operations | Lifecycle | Project Setup (Roles) | feeds Setup Wizard step 3 |
| `scheduleimport` | Import Schedule | construction | Lifecycle | Planning | |
| `forecast` | Schedule Forecast | construction | Lifecycle | Planning | |
| `riskregister` | Risk Register | construction | Lifecycle | Planning | |
| `budget` | Budget | finance | Lifecycle | Planning | also Setup step 5 |
| `meetings` | Meetings | construction | Lifecycle | Planning | action items → My Work |
| `feed` | FEED | engineering | Lifecycle | Engineering | |
| `processdesign` | Process Design | engineering | Lifecycle | Engineering | |
| `calc` | Calcs | engineering | Lifecycle | Engineering | design-assist caveat kept |
| `drawings` | Drawings | construction | Lifecycle | Engineering | |
| `bim` | BIM | construction | Lifecycle | Engineering | |
| `hub` | Eng Hub | engineering | Lifecycle | Engineering | |
| `fixlibrary` | Fix Library | engineering | Lifecycle | Engineering | |
| `rfis` | RFIs | construction | Lifecycle | Engineering | cross-links to Drawings/Submittals |
| `submittals` | Submittals | construction | Lifecycle | Engineering | |
| `subcontracts` | Subcontracts | construction | Lifecycle | Procurement | |
| `procurementrisk` | Procure Risk | construction | Lifecycle | Procurement | runs across the whole flow |
| `vendorscore` | Vendor Scorecard | procurement | Lifecycle | Procurement | |
| `directory` | Directory | procurement | Lifecycle | Procurement | |
| `construction` | Construct | construction | Lifecycle | Construction | becomes **Today's Plan** hub |
| `dailylogs` | Daily Logs | construction | Lifecycle | Construction | |
| `field` | Field Svc | field | Lifecycle | Construction | |
| `fieldai` | Field Asst | field | Lifecycle | Construction | |
| `timesheets` | Timesheets | operations | Lifecycle | Construction | |
| `iot` | IoT Sensors | construction | Lifecycle | Construction | |
| `inspections` | Inspections | construction | Lifecycle | Quality | start of QA loop |
| `punch` | Punch List | construction | Lifecycle | Quality | "Deficiency" |
| `ncr` | NCR / CAPA | construction | Lifecycle | Quality | corrective action |
| `quality` | Quality IQ | construction | Lifecycle | Quality | trend analysis |
| `safety` | Safety | construction | Lifecycle | Safety | daily safety flow |
| `compliance` | Compliance | construction | Lifecycle | Safety | |
| `changeorders` | Change Orders | finance | Lifecycle | Commercial | approvals → My Work |
| `costcontrol` | Cost Control | finance | Lifecycle | Commercial | |
| `costentry` | Cost Entry | finance | Lifecycle | Commercial | |
| `evm` | EVM | finance | Lifecycle | Commercial | |
| `billing` | Billing | finance | Lifecycle | Commercial | |
| `costiq` | Cost IQ | finance | Lifecycle | Commercial | |
| `transmittals` | Transmittals | documents | Lifecycle | Turnover | |
| `docs` | Documents | documents | Lifecycle | Turnover | |
| `portfolio` | Portfolio | finance | Lifecycle | Operations | financial rollup |
| `coordination` | Coordination | ai | Intelligence | AI | |
| `predict` | Predict | ai | Intelligence | AI | |
| `autopilot` | Autopilot | ai | Intelligence | AI | |
| `ask` | Ask Jarvis | ai | Intelligence | AI | |
| `executive` | Executive | ai | Intelligence | Executive | Decision Queue front |
| `portfolioiq` | Portfolio IQ | ai | Intelligence | Executive | |
| `automation` | Automation | system | Governance | Administration | |
| `integrations` | Integr. | system | Governance | Administration | |
| `mcp` | MCP | system | Governance | Administration | |
| `knowledge` | Knowledge | system | Governance | Administration | |
| `system` | System | system | Governance | Administration | |
| `audit` *(routed, not in nav)* | Audit Log | system | Governance | Administration | surface in sidebar |

**New screens added (no removals):**
| New id (proposed) | Label | Plane | Section | Built from |
|---|---|---|---|---|
| `mywork` | My Work | Personal | Personal | union of per-module assigned/overdue queries + Action Center |
| `setup` | Setup Wizard | Lifecycle | Project Setup | orchestrates Projects/Team/Budget/Schedule/templates |
| `turnover` | Turnover Packages | Lifecycle | Turnover | assembled from inspections/punch/NCR/docs/transmittals |
| `cxhandoff` | Commissioning Handoff | Lifecycle | Commissioning | lifecycle handoff + status read-back (external integration) |

> **Commissioning stays external (§17).** Denver Engineering builds only the *handoff points*:
> "Ready for Commissioning" → launch the separate commissioning workspace → read back status →
> "Ready for Turnover". No commissioning execution is built here.

---

## Implementation Sequencing

Phased so each step ships value without a big-bang rewrite. Nothing below is built in this
deliverable — this is the recommended order for the follow-on work.

| Wave | Scope | Risk | Why first |
|---|---|---|---|
| **W1 — Navigation shell** ✅ | Focus as default landing + lifecycle-grouped collapsible sidebar **(shipped)**; header phase/gate block + breadcrumbs deferred to W3 (need gate data) | Low (pure IA/UX; no data changes) | Immediate "feels cohesive" win; reversible |
| **W2 — My Work** ✅ | Aggregated personal queue (read-model over existing data) **(shipped — 5 lanes; 2 deferred)** | Low–Med | High daily value; reuses Focus/Action reads |
| **W3 — Lifecycle map + gates** ✅ | Gate records, derived requirements, lifecycle timeline, "advance phase" **(shipped)** — grounded on the real `project_phase` enum (7 phases); header phase/gate block + breadcrumbs split to **W3b** | Med | Core of the workflow story; needs gate schema |
| **W3b — Global shell phase/gate + breadcrumbs** | Surface current phase/gate in the top bar; record breadcrumbs | Med | Touches legacy `JarvisCore.jsx` shell; deferred from W3 to keep that slice clean |
| **W4 — Related rail** | Cross-module relationship panel on record screens | Med | Realizes "never search for related info" |
| **W5 — Guided flows** | Construction Today's Plan, QA loop, Safety daily, Procurement lifecycle as sequenced strips | Med | Polishes role journeys |
| **W6 — Setup Wizard** | 13-step resumable project initialization | Med–High | Biggest new build; benefits from W1–W3 in place |
| **W7 — Commissioning handoff + Turnover packages** | External integration points | Med | Depends on lifecycle/gates (W3) |
| **W8 — Docs refresh** | Update the §12 docs to match shipped IA | Low | Close the loop |

---

## Open Decisions

These need a product call before implementation (each changes the build):

1. **Gate configurability** — ship the default 10-gate template fixed, or make gates
   per-project-editable in the Setup Wizard from day one? (Recommend: fixed template in W3,
   editable in W6.)
2. **My Work vs. Actions** — does the existing **Actions** screen become My Work, or do they
   coexist (Actions = cross-module action records; My Work = personal aggregation view)?
   (Recommend: keep Actions as the data layer; My Work as the new personal view over it.)
3. **Commissioning integration contract** — what's the external commissioning platform's API
   surface for launch + status read-back? Needed before W7.
4. **"Deficiency" terminology** — unify punch items and failed-inspection items under one
   term in the UI, or keep distinct? (Recommend: unify the *label*, keep the records distinct.)
5. **Role → section visibility matrix** — confirm exactly which lifecycle sections each tier
   sees (extends the current Owner/Admin/PM/Engineer/Viewer filter).

---

*Denver Engineering — reorganized around how projects are actually executed:
project-centric, workflow-driven, decision-driven, AI-guided. Nothing removed — everything
finally in the right place.*
