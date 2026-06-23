# 02 — Frontend UI/UX Audit

## Technology Stack
- React 18.3.1 + Zustand 5.0.11
- Vite 6 build system (code-split, lazy-loaded views)
- Recharts 2.12.7 for data visualization
- Lucide React 1.8.0 for icons
- Custom CSS design tokens (`src/styles/tokens.css`)

---

## Route / View Coverage

### Fully Implemented Views (confirmed in ContentRouter TAB_MAP)
| Nav ID | View Component | Notes |
|---|---|---|
| dash | Dashboard | Main ops dashboard |
| ask | AskJarvisView | RAG chat interface |
| crm | CRMView | CRM + leads |
| feed | FeedView | FEED engineering |
| projects | ProjectsView | Project CRUD |
| construction | ConstructionView | Construction main |
| dailylogs | DailyLogsView | Field daily logs |
| drawings | DrawingsView | Drawing revisions + markups |
| bim | BIMViewerView | BIM/IFC viewer |
| changeorders | ChangeOrdersView | Change order workflow |
| subcontracts | SubcontractView | Subcontract management |
| meetings | MeetingsView | Meeting minutes |
| costcontrol | CostControlDashboard | Cost control |
| costentry | CostEntryView | Field cost entry |
| timesheets | TimesheetsView | Workforce timesheets |
| riskregister | RiskRegisterView | Risk register v10.17.0 |
| proposals | ProposalsView | Bid pipeline |
| evm | EVMDashboard | Earned Value Management |
| scheduleimport | ScheduleImportView | P6 XER / MSP XML import |
| iot | IoTDashboard | IoT sensor dashboard |
| budget | BudgetView | Budget management |
| safety | SafetyView | Safety module |
| commissioning | CommissioningView | CX/commissioning |
| procurement | ProcurementView | Procurement |
| docs | DocumentsView | Document management |
| calc | CalcView | Engineering calculators |
| hub | HubView | Engineering hub |
| actions | ActionItemsView | Global action center |
| field | FieldOperationsView | Field service |
| directory | DirectoryView | Directory |
| mcp | MCPToolsPage | MCP tools |
| portfolio | FinanceView | Portfolio/finance |
| engineering | EngineeringView | Engineering view |
| system | SettingsView | System settings |
| submittals | SubmittalsView | Submittals |
| rfis | RFIsView | RFIs |
| punch | PunchListView | Punch lists |
| inspections | InspectionsView | Inspection templates |
| audit | AuditLogView | Audit trail |
| automation | AutomationView | Automation scheduler |
| compliance | ComplianceView | Compliance tasks |
| fixlibrary | FixLibraryView | Fix pattern library |
| knowledge | KnowledgeView | Knowledge base |
| processdesign | ProcessDesignView | Process engineering |
| team | TeamView | Team & workforce |
| predict | PredictView | AI predict dashboard |
| notifications | NotificationsView | Notification center |

### Stubs / Missing
| Nav ID | Status | Risk |
|---|---|---|
| integrations | ComingSoonView rendered in production | P1 |

---

## Bundle Analysis

**Build output (production):**
- `vendor-react-BhBnqHFA.js`: **359 KB** (gzip 108 KB) — React + React-DOM
- `vendor-recharts-DYk21_8r.js`: **354 KB** (gzip 95 KB) — Recharts only
- `index-BqpbtucG.js`: **114 KB** (gzip 34 KB) — main app shell
- `CommissioningView-BMoNTDff.js`: **100 KB** (gzip 20 KB) — largest view
- `AutomationView-SgJQke14.js`: **58 KB** (gzip 8 KB)

**Finding:** All views are lazy-loaded via `React.lazy()`. Initial bundle is ~218 KB gzipped (react + recharts + index). Acceptable for enterprise SaaS. However, Recharts at 95 KB gzipped is entirely in vendor chunk — any page that uses charts loads this regardless of use.

---

## Design System & UX Quality

### Strengths
- Custom CSS design tokens (`--jarvis-ts`, `--jarvis-bg`, etc.) — consistent theming
- `StatusBadge`, `KpiCard` reusable components
- `ToastContainer` for notifications
- `OfflineIndicator` for PWA state
- `HeartbeatBar` for connection status
- `NavSidebar` with domain grouping
- `CmdPalette` (command palette) implemented
- `ComingSoonView` pattern for graceful stub rendering

### UX Concerns
1. **`integrations` renders ComingSoon in production** — enterprise customers expect working integrations (P1)
2. **No loading skeleton** — `ViewLoader` shows plain text "Loading…" with no visual skeleton
3. **No error boundary per view** — `Suspense` fallback used but no `ErrorBoundary` around each lazy component (one view crash could render blank screen)
4. **Navigation has 43 items** — overwhelming sidebar without collapsible sections or search; only domain grouping
5. **Multiple icon duplication** — `Construct` and `Subcontracts` both use `🏗️`; `Automation` and `System` both use `⚙️`
6. **`portfolio` tab resolves to `FinanceView`** — label/component mismatch may confuse users

---

## State Management

- Zustand `useAppStore` for global app state (`appSlice.ts`)
- `BizReducer` / `DomainReducer` for domain state
- `modules/biz/` — biz layer with dispatch/mutateBiz pattern
- `modules/persistence/` — localStorage persistence
- `modules/offlineQueue/` — offline operation queue
- `modules/eventBus/` — internal event bus

**Finding:** State architecture is well-structured. Offline queue exists. No observed issues with state management pattern.

---

## Forms & Validation

- Client-side validation exists in individual view components
- No shared form validation library (no Zod, Yup, React Hook Form)
- Each view implements its own field validation inline
- **Risk:** Inconsistent validation UX across views (P2)

---

## Accessibility

- `aria-live="polite"` on ViewLoader ✅
- No aria-label audit performed on all interactive elements
- Icon-only buttons likely lack aria-labels (not verified per component)
- **Risk:** Incomplete ARIA coverage for enterprise accessibility requirements (P2)

---

## Mobile / Responsive

- `OfflineIndicator` component exists ✅
- `mcp__computer-use` not applicable for actual browser tests
- No evidence of responsive CSS breakpoints in design tokens
- `FieldOperationsView` exists but no PWA manifest / service worker confirmed
- **Risk:** Mobile responsiveness not verified (P2)

---

## Risk Summary

| Finding | Severity |
|---|---|
| `integrations` nav item shows ComingSoonView in production | P1 |
| No ErrorBoundary per view — crash blanks entire view area | P1 |
| ViewLoader shows plain text, no skeleton UI | P2 |
| 43 nav items with no collapse/search | P2 |
| No shared form validation library | P2 |
| Icon duplication in navigation | P3 |
| `portfolio` → FinanceView label mismatch | P3 |
| No ARIA audit completed | P2 |
| Mobile responsiveness unverified | P2 |
