# JARVIS EPC — Component Registry

> **Owner visibility document.** Maps every UI component in `src/components/` to its
> EPC domain, functional status, and view ID. Updated as part of v4.23.0 P1 remediation.

---

## Status legend

| Status | Meaning |
|---|---|
| ✅ Functional | Fully implemented — renders real data |
| 🚧 Coming Soon | Extraction stub — renders `ComingSoonView` with proper UX |
| 🔧 Utility | Not a page view — overlay, container, or shared primitive |
| 📦 Placeholder | Legacy raw stub — should not exist after this release |

---

## Component map

| File | Component | Domain | Label | View ID | Status |
|---|---|---|---|---|---|
| ActionItemsView.tsx | ActionItemsView | Operations | Action Items | action-items | ✅ Functional |
| AeView.tsx | AeView | Engineering | Architecture Export | ae | 🚧 Coming Soon |
| AnView.tsx | AnView | Engineering | Analysis & Notes | an | 🚧 Coming Soon |
| AoView.tsx | AoView | Engineering | Architecture Overview | ao | 🚧 Coming Soon |
| AtView.tsx | AtView | Engineering | Approvals & Transmittals | at | 🚧 Coming Soon |
| BiView.tsx | BiView | Procurement | Bid Items | bi | 🚧 Coming Soon |
| BnView.tsx | BnView | Construction | Build Notes | bn | 🚧 Coming Soon |
| BuildAIContext.ts | BuildAIContext | — | AI Context Builder | — | 🔧 Utility |
| CalcView.tsx | CalcView | Engineering | Calculator & Analysis | calc | 🚧 Coming Soon |
| CmdPalette.tsx | CmdPalette | — | Command Palette Overlay | cmd-palette | 🔧 Utility |
| ComingSoonView.tsx | ComingSoonView | — | Shared Coming Soon | — | 🔧 Utility |
| CommissioningBaselineView.tsx | CommissioningBaselineView | Commissioning | Commissioning Baseline | commissioning-baseline | ✅ Functional |
| CommissioningView.tsx | CommissioningView | Commissioning | Commissioning Overview | commissioning | ✅ Functional |
| ConstructionMainView.tsx | ConstructionMainView | Construction | Construction Main Dashboard | construction-main | ✅ Functional |
| ConstructionView.tsx | ConstructionView | Construction | Construction Overview | construction | ✅ Functional |
| CRMLeads.tsx | CRMLeads | CRM | Leads Register | crm-leads | ✅ Functional |
| CRMView.tsx | CRMView | CRM | CRM & Leads | crm | 🚧 Coming Soon |
| CtView.tsx | CtView | Construction | Construction Tracking | ct | 🚧 Coming Soon |
| Dashboard.tsx | Dashboard | Operations | Dashboard Shell | dashboard-shell | ✅ Functional |
| DashboardMainView.tsx | DashboardMainView | Operations | Dashboard | dashboard | 🚧 Coming Soon |
| DetailPanelView.tsx | DetailPanelView | Operations | Detail Panel | detail | 🚧 Coming Soon |
| DirectoryView.tsx | DirectoryView | Procurement | Vendor Directory | directory | ✅ Functional |
| DnView.tsx | DnView | Engineering | Design Notes | dn | 🚧 Coming Soon |
| DocsView.tsx | DocsView | Documents | Documents Overview | docs | 🚧 Coming Soon |
| DocumentsSubView.tsx | DocumentsSubView | Documents | Document Sub-Panel | docs-sub | 🚧 Coming Soon |
| DocumentsView.tsx | DocumentsView | Documents | Document Register | documents | ✅ Functional |
| DomainReducer.ts | DomainReducer | — | Domain State Reducer | — | 🔧 Utility |
| DtView.tsx | DtView | Documents | Document Tracking | dt | 🚧 Coming Soon |
| EeView.tsx | EeView | Engineering | Electrical Engineering | ee | 🚧 Coming Soon |
| EngineeringView.tsx | EngineeringView | Engineering | Engineering Overview | engineering | ✅ Functional |
| EtView.tsx | EtView | Construction | Equipment Tracking | et | 🚧 Coming Soon |
| FeView.tsx | FeView | Engineering | Field Engineering | fe | 🚧 Coming Soon |
| FeedView.tsx | FeedView | Finance | Finance Feed | feed | 🚧 Coming Soon |
| FieldOperationsView.tsx | FieldOperationsView | Field Engineering | Field Operations | field-ops | ✅ Functional |
| FinanceView.tsx | FinanceView | Finance | Finance Overview | finance | ✅ Functional |
| FnView.tsx | FnView | Finance | Finance Notes | fn | 🚧 Coming Soon |
| HiView.tsx | HiView | Safety | HSE Items | hi | 🚧 Coming Soon |
| HnView.tsx | HnView | Hub | Hub Notifications | hn | 🚧 Coming Soon |
| HtView.tsx | HtView | Safety | HSE Tracking | ht | 🚧 Coming Soon |
| HubView.tsx | HubView | Hub | Project Hub | hub | 🚧 Coming Soon |
| IeView.tsx | IeView | Quality | Inspection & Engineering | ie | 🚧 Coming Soon |
| InView.tsx | InView | Quality | Inspection Notes | in | 🚧 Coming Soon |
| JiView.tsx | JiView | Construction | Job Items | ji | 🚧 Coming Soon |
| JnSubView.tsx | JnSubView | Construction | Job Notes Detail | jnsub | 🚧 Coming Soon |
| JnView.tsx | JnView | Construction | Job Notes | jn | 🚧 Coming Soon |
| JobsView.tsx | JobsView | Construction | Jobs | jobs | 🚧 Coming Soon |
| KiView.tsx | KiView | Reporting | KPI Intelligence | ki | ✅ Functional |
| KpiCard.tsx | KpiCard | — | KPI Card Primitive | — | 🔧 Utility |
| MCPToolsPage.tsx | MCPToolsPage | System | MCP Tool Browser | mcp | ✅ Functional |
| NextActionsBar.tsx | NextActionsBar | — | Cross-domain Priority Bar | — | 🔧 Utility |
| KtView.tsx | KtView | Operations | Knowledge Base | kt | 🚧 Coming Soon |
| LeView.tsx | LeView | CRM | Leads Pipeline | le | 🚧 Coming Soon |
| LiView.tsx | LiView | Procurement | Labour Items | li | 🚧 Coming Soon |
| LnView.tsx | LnView | CRM | Lead Notifications | ln | 🚧 Coming Soon |
| LoView.tsx | LoView | Procurement | Logistics Overview | lo | 🚧 Coming Soon |
| ModalShellView.tsx | ModalShellView | Operations | Modal Shell | modal | 🚧 Coming Soon |
| NeView.tsx | NeView | Engineering | Network Engineering | ne | 🚧 Coming Soon |
| OverviewView.tsx | OverviewView | System | System Overview | overview | ✅ Functional |
| PlannerView.tsx | PlannerView | Procurement | Procurement Planner | planner | ✅ Functional |
| PnView.tsx | PnView | Procurement | Procurement Notes | pn | 🚧 Coming Soon |
| ProcurementSubView.tsx | ProcurementSubView | Procurement | Procurement Sub-Panel | proc-sub | 🚧 Coming Soon |
| ProcurementView.tsx | ProcurementView | Procurement | Procurement Overview | procurement | ✅ Functional |
| ProjectsView.tsx | ProjectsView | Operations | Projects Register | projects | ✅ Functional |
| QiView.tsx | QiView | Quality | QA Items | qi | 🚧 Coming Soon |
| ResourcesView.tsx | ResourcesView | Operations | Resources | resources | 🚧 Coming Soon |
| RoView.tsx | RoView | Risk | Risk Overview | ro | 🚧 Coming Soon |
| RtView.tsx | RtView | Risk | Risk Tracking | rt | 🚧 Coming Soon |
| SafetyMainView.tsx | SafetyMainView | Safety | Safety Main | safety-main | 🚧 Coming Soon |
| SafetyView.tsx | SafetyView | Safety | Safety Overview | safety | ✅ Functional |
| SettingsView.tsx | SettingsView | Admin | Settings | settings | 🚧 Coming Soon |
| SnView.tsx | SnView | Safety | Safety Notes | sn | 🚧 Coming Soon |
| SoView.tsx | SoView | Planning | Schedule Overview | so | 🚧 Coming Soon |
| StatusBadge.tsx | StatusBadge | — | Status Badge Primitive | — | 🔧 Utility |
| StView.tsx | StView | Planning | Schedule Tracking | st | 🚧 Coming Soon |
| SubPanelGView.tsx | SubPanelGView | Operations | Panel G | subpanel-g | 🚧 Coming Soon |
| SubPanelQView.tsx | SubPanelQView | Operations | Panel Q | subpanel-q | 🚧 Coming Soon |
| SubPanelVView.tsx | SubPanelVView | Operations | Panel V | subpanel-v | 🚧 Coming Soon |
| SubmittalsView.tsx | SubmittalsView | Safety | Submittals | submittals | ✅ Functional |
| SystemView.tsx | SystemView | Settings | System Overview | system | ✅ Functional |
| ToastContainer.tsx | ToastContainer | — | Notification Host | toast | 🔧 Utility |
| UnView.tsx | UnView | Engineering | Unit Notes | un | 🚧 Coming Soon |
| WView.tsx | WView | Construction | Work Overview | w | 🚧 Coming Soon |
| WnView.tsx | WnView | Construction | Work Notes | wn | 🚧 Coming Soon |
| WtView.tsx | WtView | Construction | Work Tracking | wt | 🚧 Coming Soon |
| XtView.tsx | XtView | Operations | External Tracking | xt | 🚧 Coming Soon |
| YiView.tsx | YiView | Finance | Yield & Performance | yi | 🚧 Coming Soon |
| ZeView.tsx | ZeView | Construction | Zone Engineering | ze | 🚧 Coming Soon |
| ZnView.tsx | ZnView | Construction | Zone Notes | zn | 🚧 Coming Soon |
| ZtView.tsx | ZtView | Commissioning | Zone Tracking | zt | 🚧 Coming Soon |

---

## Summary

| Status | Count |
|---|---|
| ✅ Functional | 22 |
| 🚧 Coming Soon | 54 |
| 🔧 Utility | 7 |
| **Total** | **83** |

---

## Domain breakdown

| Domain | Functional | Coming Soon |
|---|---|---|
| Construction | 2 | 14 |
| Engineering | 1 | 9 |
| Procurement | 4 | 7 |
| Safety | 2 | 6 |
| Operations | 3 | 7 |
| Finance | 2 | 4 |
| Documents | 1 | 4 |
| Quality | 0 | 4 |
| CRM | 1 | 3 |
| Planning | 0 | 2 |
| Risk | 0 | 2 |
| Commissioning | 2 | 1 |
| Hub | 0 | 2 |
| Reporting | 1 | 0 |
| Admin | 0 | 1 |
| Field Engineering | 1 | 0 |
| Settings | 1 | 0 |
| System | 1 | 0 |

---

*Last updated: v4.23.0 — P1 remediation cycle*
*Maintained by: Owner-First Audit process*
