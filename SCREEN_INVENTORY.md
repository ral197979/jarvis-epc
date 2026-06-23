# Screen Inventory — Denver Engineering

> Every screen, grouped by the real nav domains in `src/config/navigation.ts`, mapped to its live component in `src/components/ContentRouter.tsx` (`TAB_MAP`).
>
> **Legend:** ✅ implemented & wired · 🟡 shallow/partial · ⚠️ renders real UI but **placeholder math** (not trustworthy) · ❌ planned (no screen)
> **Sibling docs:** [AI_PROJECT_INTELLIGENCE_SPEC.md](./AI_PROJECT_INTELLIGENCE_SPEC.md) · [USER_WORKFLOWS.md](./USER_WORKFLOWS.md) · shell-math baseline in [FEATURES.md](./FEATURES.md)
>
> Every tab below is a real key in `TAB_MAP` unless noted "(no nav)" or ❌. The shell views (⚠️) are flagged in §Engineering and must be relabeled or backed by validated engines before enterprise demos.

---

## AI (domain `ai`)

| Tab | Label | Component | Status |
|---|---|---|---|
| `focus` | 🧭 Focus | `copilot/CopilotView.tsx` | ✅ **The differentiator** — deterministic Project Copilot ranked focus list, severity filters, one-click deep-link into source records. See [AI spec §1](./AI_PROJECT_INTELLIGENCE_SPEC.md#1-the-shipped-differentiator--project-copilot-focus-). |
| `ask` | 🤖 Ask Jarvis | `AskJarvisView.tsx` | ✅ Grounded RAG chat, tier-weighted citations, persistent sessions. |
| `predict` | 🔮 Predict | `predict/PredictView.tsx` | ✅ Portfolio health (CPI/SPI composite), red/amber/green, regression EAC forecast, anomaly flags. |

## Operations (domain `operations`)

| Tab | Label | Component | Status |
|---|---|---|---|
| `dash` | 📊 Dashboard | `Dashboard.tsx` | ✅ Portfolio KPI tiles with drill-down. |
| `projects` | 📋 Projects | `ProjectsView.tsx` | ✅ Registry, type/location/contract/status workflow. |
| `team` | 👥 Team | `team/TeamView.tsx` | ✅ Roster, cost rates. |
| `timesheets` | ⏱️ Timesheets | `timesheets/TimesheetsView.tsx` | ✅ Weekly timesheet approval. |
| `actions` | ⚡ Actions | `ActionItemsView.tsx` | ✅ Cross-module action center, SLA/escalation. |
| `notifications` | 🔔 Notifs | `notifications/NotificationsView.tsx` | ✅ Real-time WebSocket notifications. |

## Construction (domain `construction`)

| Tab | Label | Component | Status |
|---|---|---|---|
| `construction` | 🏗️ Construct | `ConstructionView.tsx` | ✅ Construction module hub. |
| `dailylogs` | 🗓️ Daily Logs | `DailyLogsView.tsx` | ✅ Field reports: weather, crew, equipment, delay/safety flags. |
| `drawings` | 📐 Drawings | `DrawingsView.tsx` | ✅ Sheet register, revisions, red-line markups, IFC tracking. |
| `scheduleimport` | 📅 Import Schedule | `schedule/ScheduleImportView.tsx` | ✅ Primavera P6 (XER) / MS Project (XML) with CPM/baseline parsing. |
| `subcontracts` | 🏗️ Subcontracts | `procurement/SubcontractView.tsx` | ✅ Bid packages, comparison, award, SOV. |
| `meetings` | 📋 Meetings | `meetings/MeetingsView.tsx` | ✅ Agendas, minutes, decisions, auto-linked actions. |
| `bim` | 🏢 BIM | `BIMViewerView.tsx` | ✅ IFC upload, clash/coordination issues. |
| `iot` | 📡 IoT Sensors | `iot/IoTDashboard.tsx` | ✅ Registry, live readings, time-series, thresholds. |
| `rfis` | ❓ RFIs | `RFIsView.tsx` | ✅ RFI log, review, overdue tracking; **deep-link target** of Focus. |
| `submittals` | 📨 Submittals | `SubmittalsView.tsx` | ✅ Shop-drawing log; **deep-link target** of Focus. |
| `punch` | 📌 Punch List | `PunchListView.tsx` | ✅ Closeout items, location/trade/priority/photos; **deep-link target** (carries `parentId`). |
| `inspections` | 🔍 Inspections | `InspectionsView.tsx` | ✅ Template checklists (ACI 318, UL 1479, MEP rough-in); **deep-link target**. |
| `compliance` | 🛡️ Compliance | `ComplianceView.tsx` | ✅ Compliance task tracking. |
| `riskregister` | ⚠️ Risk Register | `riskRegister/RiskRegisterView.tsx` | ✅ Probability × impact scoring; **deep-link target** of Focus risks. |

## Finance (domain `finance`)

| Tab | Label | Component | Status |
|---|---|---|---|
| `changeorders` | 🔄 Change Orders | `changeOrders/ChangeOrdersView.tsx` | ✅ Pricing → approval → execution, cost/schedule impact. |
| `costcontrol` | 📉 Cost Control | `costControl/CostControlDashboard.tsx` | ✅ Budget vs. committed vs. actual; **deep-link target** of Focus budget. |
| `costentry` | 💵 Cost Entry | `costEntry/CostEntryView.tsx` | ✅ Field cost entry. |
| `evm` | 📊 EVM | `evm/EVMDashboard.tsx` | ✅ BCWS/BCWP/ACWP, SPI/CPI, EAC/ETC, S-curves; **deep-link target** of Focus schedule. |
| `budget` | 💰 Budget | `BudgetView.tsx` | ✅ Original/approved-change/revised by cost code + WBS. |
| `portfolio` | 💰 Portfolio | `FinanceView.tsx` | 🟡 Cross-project rollup (IRR/NPV/MOIC) lives here; **not** yet a Portfolio Copilot screen (see ❌ below). |

## CRM / BD (domain `crm`)

| Tab | Label | Component | Status |
|---|---|---|---|
| `crm` | 🎯 CRM | `CRMView.tsx` | ✅ Contacts/companies, lead pipeline, activity timeline. |
| `proposals` | 📄 Proposals | `proposals/ProposalsView.tsx` | ✅ Bid pipeline, line-item costing, award/loss. |

## Engineering (domain `engineering`)

| Tab | Label | Component | Status |
|---|---|---|---|
| `feed` | 🔬 FEED | `FeedView.tsx` | ✅ Front-end engineering design surface. |
| `processdesign` | 🧪 Process Design | `ProcessDesignView.tsx` | ⚠️ **Shell** — UI renders, but underlying process math is placeholder/synthetic. Genuine P&ID/PFD SVG generation is real; the *calculations* are not. |
| `calc` | 🧮 Calcs | `CalcView.tsx` | ⚠️ **Shell** — WWTP/PWTP/HVAC/NEC/stormwater/process calcs are placeholder math routed over MCP to a non-calc orchestrator. **Not trustworthy.** See [FEATURES.md](./FEATURES.md). |
| `hub` | 🛠️ Eng Hub | `HubView.tsx` | ✅ Engineering tool hub. |
| `fixlibrary` | 🔧 Fix Library | `FixLibraryView.tsx` | ✅ Reusable engineering fix patterns, retrievable by Ask Jarvis. |

## Documents / Procurement (domains `documents`, `procurement`)

| Tab | Label | Component | Status |
|---|---|---|---|
| `transmittals` | 📬 Transmittals | `TransmittalsView.tsx` | ✅ Formal transmittal workflow with response tracking. |
| `docs` | 🗄️ Documents | `DocumentsView.tsx` | ✅ Upload + full-text + AI-summarized search. |
| `directory` | 📚 Directory | `DirectoryView.tsx` | ✅ Vendor/company directory. |

## System (domain `system`)

| Tab | Label | Component | Status |
|---|---|---|---|
| `knowledge` | 📚 Knowledge | `KnowledgeView.tsx` | ✅ Document ingest for RAG retrieval. |
| `mcp` | 🔌 MCP | `MCPToolsPage.tsx` | ✅ Tool catalogue browser (native + Ava). |
| `automation` | ⚙️ Automation | `AutomationView.tsx` | ✅ Rule-based action/compliance-task creation. |
| `integrations` | 🔗 Integr. | `IntegrationsView.tsx` | 🟡 Connector list + webhook delivery; not yet a full marketplace. |
| `system` | ⚙️ System | `SettingsView.tsx` | ✅ Settings. |

## Wired but not in the nav bar (reachable via `TAB_MAP` / deep-link / sub-views)

| Tab | Component | Status | Note |
|---|---|---|---|
| `safety` | `SafetyView.tsx` | 🟡 | Component is **636 lines and real**, present in `TAB_MAP`, but **absent from `navigation.ts`** — orphaned until the Safety suite ships (see ❌ below). |
| `commissioning` | `CommissioningView.tsx` | 🟡 | Full Cx workflow component, in `TAB_MAP`, no nav entry. |
| `procurement` | `ProcurementView.tsx` | ✅ | In `TAB_MAP`, surfaced via Construction/Finance flows. |
| `field` | `FieldOperationsView.tsx` | 🟡 | Offline work orders + QR; in `TAB_MAP` (nav id `field`). |
| `overview` | `DashboardMainView.tsx` | 🟡 | Alternate dashboard. |
| `audit` | `AuditLogView.tsx` | ✅ | Immutable audit log viewer. |
| `plan` / `resources` / `jobs` | `PlannerView` / `ResourcesView` / `JobsView` | 🟡 | Planning/resourcing surfaces, no nav entry. |

> **Adaptive/ops/ecosystem dashboards** also exist as components (`AdaptiveObservabilityDashboard`, `AnomalyRadar`, `OptimizationCommandCenter`, `CrossProjectHeatmap`, `ScenarioSimulationPanel`, the `ops/`, `ecosystem/`, `enterprise/`, `phase10–12/`, `postGA/` folders) but are **not** in `navigation.ts` or `TAB_MAP` — internal/observability surfaces, not user-facing project screens.

---

## ❌ Planned screens (gap to the AI-native vision)

These have backing data/services but **no user-facing screen**. Cross-referenced to [AI_PROJECT_INTELLIGENCE_SPEC.md](./AI_PROJECT_INTELLIGENCE_SPEC.md) and [USER_WORKFLOWS.md](./USER_WORKFLOWS.md).

| Planned screen | Backing that exists | Status |
|---|---|---|
| **Executive Copilot** (board/owner/weekly report builder) | `api/routes/executive.ts` `/overview` 🟡, `predictService` ✅, `buildPortfolioFocus` ✅ | ❌ no screen, no nav tab |
| **Coordination Copilot** board (clashes, missing approvals, blocker chains) | `buildProjectFocus` ✅ + `actions/actionDependencyGraph` | ❌ |
| **Portfolio Copilot** comparison | `buildPortfolioFocus` ✅, `ecosystem/benchmarkingService` | ❌ (today only `FinanceView`) |
| **Safety suite** (observations / incidents / permits / JSA / leading indicators) | `SafetyView.tsx` 🟡 (unwired) | ❌ not in nav |
| **Submittal review assistant** panel | submittals data ✅ + RAG | ❌ |
| **RFI impact analysis** panel | dependency graph + schedule float | ❌ |
| **Schedule Monte Carlo / recovery planner** | `monteCarloService` ✅ + routes ✅ | ❌ no UI over a real engine |
| **Billing / pay applications** (SOV %-complete, retention, lien waivers) | SOV in subcontracts ✅ | ❌ |
| **Document control** (superseded sets, distribution matrix, overlay compare) | drawings/transmittals ✅ | ❌ |
| **Integration marketplace** catalog | `integrations` 🟡, `integrationHub` | ❌ full catalog |
| **Mobile field PWA** (arrival / scan / field-home / offline sync) | `FieldOperationsView` 🟡; PWA screens live in `denver-engineering-next` | 🟡→❌ in this repo |

---

## ⚠️ Trust note

The two ⚠️ screens (`processdesign`, `calc`) render convincing engineering UIs but their math is **placeholder** (synthetic / random-noise). The only *real* engineering output is P&ID/PFD SVG/DXF diagram generation (drawing, not calculation). Per [FEATURES.md](./FEATURES.md) and [AI spec §6](./AI_PROJECT_INTELLIGENCE_SPEC.md#6-honesty--what-is-not-trustworthy-), these must be relabeled "design-assist / drafting" or backed by validated engines (`ava-math-engine`, `MEPPro`) before any number is shown to an enterprise buyer.
