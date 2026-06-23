/**
 * Denver Engineering — ContentRouter  (v4.29.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 19c extraction: the main content area / tab router from JarvisApp.
 * Previously the giant if/else chain at the bottom of JarvisCore.jsx
 * (lines ~5050–5250): `m === "dash" ? Q = ... : m === "crm" ? ...`
 *
 * Usage:
 *   import { ContentRouter } from '../components/ContentRouter'
 *   <ContentRouter policy={policy} biz={biz} onNavigate={setTab} />
 */

import React, { Suspense, lazy } from 'react'
import type { PolicyConfig } from '../modules/biz/dispatch'
import { useAppStore }       from '../modules/store/appSlice'
import { ViewErrorBoundary } from './ErrorBoundary'

// ─── Lazy load all view components ───────────────────────────────────────────
// Using lazy() avoids bundling the entire component tree upfront.

const Dashboard         = lazy(() => import('./Dashboard'))
const CRMView           = lazy(() => import('./CRMView'))
const FeedView          = lazy(() => import('./FeedView'))
const ProjectsView      = lazy(() => import('./ProjectsView'))
const ConstructionView  = lazy(() => import('./ConstructionView'))
const DailyLogsView     = lazy(() => import('./DailyLogsView'))
const DrawingsView      = lazy(() => import('./DrawingsView'))
const BIMViewerView     = lazy(() => import('./BIMViewerView'))
const BudgetView        = lazy(() => import('./BudgetView'))
const DocumentsView     = lazy(() => import('./DocumentsView'))
const CalcView          = lazy(() => import('./CalcView'))
const HubView           = lazy(() => import('./HubView'))
const SafetyView        = lazy(() => import('./SafetyView'))
const CommissioningView = lazy(() => import('./CommissioningView'))
const ProcurementView   = lazy(() => import('./ProcurementView'))
const ActionItemsView   = lazy(() => import('./ActionItemsView'))
const FieldOperationsView = lazy(() => import('./FieldOperationsView'))
const DirectoryView     = lazy(() => import('./DirectoryView'))
const MCPToolsPage      = lazy(() => import('./MCPToolsPage'))
const FinanceView       = lazy(() => import('./FinanceView'))
const EngineeringView   = lazy(() => import('./EngineeringView'))
const SettingsView      = lazy(() => import('./SettingsView'))
const DashboardMainView = lazy(() => import('./DashboardMainView'))
const SubmittalsView    = lazy(() => import('./SubmittalsView'))
const RFIsView          = lazy(() => import('./RFIsView'))
const PunchListView     = lazy(() => import('./PunchListView'))
const InspectionsView   = lazy(() => import('./InspectionsView'))
const AuditLogView      = lazy(() => import('./AuditLogView'))
const AutomationView    = lazy(() => import('./AutomationView'))
const ComplianceView    = lazy(() => import('./ComplianceView'))
const FixLibraryView    = lazy(() => import('./FixLibraryView'))
const KnowledgeView     = lazy(() => import('./KnowledgeView'))
const AskJarvisView     = lazy(() => import('./AskJarvisView'))
const JobsView          = lazy(() => import('./JobsView'))
const PlannerView       = lazy(() => import('./PlannerView'))
const ResourcesView     = lazy(() => import('./ResourcesView'))
const EVMDashboard        = lazy(() => import('./evm/EVMDashboard'))
const ScheduleImportView  = lazy(() => import('./schedule/ScheduleImportView'))
const IoTDashboard        = lazy(() => import('./iot/IoTDashboard'))
const ChangeOrdersView    = lazy(() => import('./changeOrders/ChangeOrdersView'))
const SubcontractView     = lazy(() => import('./procurement/SubcontractView'))
const MeetingsView        = lazy(() => import('./meetings/MeetingsView'))
const CostControlDashboard = lazy(() => import('./costControl/CostControlDashboard'))
const CostEntryView        = lazy(() => import('./costEntry/CostEntryView'))
const ProposalsView        = lazy(() => import('./proposals/ProposalsView'))
const TeamView             = lazy(() => import('./team/TeamView'))
const NotificationsView    = lazy(() => import('./notifications/NotificationsView'))
const PredictView          = lazy(() => import('./predict/PredictView'))
const TimesheetsView       = lazy(() => import('./timesheets/TimesheetsView'))
const RiskRegisterView     = lazy(() => import('./riskRegister/RiskRegisterView'))
const ProcessDesignView    = lazy(() => import('./ProcessDesignView'))
const TransmittalsView     = lazy(() => import('./TransmittalsView'))
const IntegrationsView     = lazy(() => import('./IntegrationsView'))
const CopilotView          = lazy(() => import('./copilot/CopilotView'))
const CoordinationView     = lazy(() => import('./copilot/CoordinationView'))
const ExecutiveView        = lazy(() => import('./copilot/ExecutiveView'))
const PortfolioIQView       = lazy(() => import('./copilot/PortfolioIQView'))

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContentRouterProps {
  policy:       Partial<PolicyConfig>
  biz?:         Record<string, unknown>
  onNavigate?:  (tab: string) => void
  onAudit?:     (entry: unknown) => void
  onToast?:     (msg: string, type: string) => void
}

// ─── Loading skeleton (P2-7) ─────────────────────────────────────────────────
// Replaces the plain "Loading…" spinner with a structured skeleton that matches
// the typical view layout: header bar + 4 KPI tiles + a content block.

const SKEL: React.CSSProperties = {
  background: 'linear-gradient(90deg, var(--jarvis-surface,#1e293b) 25%, rgba(255,255,255,0.04) 50%, var(--jarvis-surface,#1e293b) 75%)',
  backgroundSize: '200% 100%',
  animation: 'jarvis-skeleton-shimmer 1.4s infinite',
  borderRadius: 6,
}

function ViewLoader() {
  return (
    <div style={{ padding: 24, maxWidth: 1100 }} aria-busy="true" aria-label="Loading view">
      <style>{`
        @keyframes jarvis-skeleton-shimmer {
          0%   { background-position: 200% 0 }
          100% { background-position: -200% 0 }
        }
      `}</style>
      {/* Header skeleton */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ ...SKEL, width: 180, height: 22, marginBottom: 8 }} />
          <div style={{ ...SKEL, width: 260, height: 13 }} />
        </div>
        <div style={{ ...SKEL, width: 130, height: 34, borderRadius: 6 }} />
      </div>
      {/* KPI tiles skeleton */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{ ...SKEL, flex: '1 1 140px', minWidth: 140, height: 80, borderRadius: 8 }} />
        ))}
      </div>
      {/* Content block skeleton */}
      <div style={{ ...SKEL, width: '100%', height: 320, borderRadius: 8 }} />
    </div>
  )
}

// ─── Tab → Component map ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ViewEntry = React.LazyExoticComponent<React.ComponentType<any>> | React.ComponentType<any>

const TAB_MAP: Record<string, ViewEntry> = {
  dash:          Dashboard,
  crm:           CRMView,
  feed:          FeedView,
  projects:      ProjectsView,
  construction:  ConstructionView,
  dailylogs:     DailyLogsView,
  drawings:      DrawingsView,
  bim:           BIMViewerView,
  changeorders:     ChangeOrdersView,
  subcontracts:     SubcontractView,
  meetings:         MeetingsView,
  costcontrol:      CostControlDashboard,
  costentry:        CostEntryView,
  timesheets:       TimesheetsView,
  riskregister:     RiskRegisterView,
  proposals:        ProposalsView,
  evm:              EVMDashboard,
  scheduleimport:   ScheduleImportView,
  iot:              IoTDashboard,
  budget:           BudgetView,
  safety:        SafetyView,
  commissioning: CommissioningView,
  procurement:   ProcurementView,
  docs:          DocumentsView,
  calc:          CalcView,
  hub:           HubView,
  actions:       ActionItemsView,
  field:         FieldOperationsView,
  directory:     DirectoryView,
  mcp:           MCPToolsPage,
  portfolio:     FinanceView,
  engineering:   EngineeringView,
  system:        SettingsView,
  plan:          PlannerView,
  resources:     ResourcesView,
  submittals:    SubmittalsView,
  rfis:          RFIsView,
  punch:         PunchListView,
  inspections:   InspectionsView,
  audit:         AuditLogView,
  automation:    AutomationView,
  compliance:    ComplianceView,
  fixlibrary:    FixLibraryView,
  knowledge:     KnowledgeView,
  ask:           AskJarvisView,
  processdesign: ProcessDesignView,
  transmittals:  TransmittalsView,
  jobs:          JobsView,
  overview:      DashboardMainView,
  team:          TeamView,
  predict:       PredictView,
  focus:         CopilotView,
  coordination:  CoordinationView,
  executive:     ExecutiveView,
  portfolioiq:   PortfolioIQView,
  integrations:  IntegrationsView,
  notifications: NotificationsView,
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ContentRouter({ policy, biz, onNavigate, onAudit, onToast }: ContentRouterProps) {
  const activeTab = useAppStore(s => s.ui.activeTab)

  const ViewComponent = TAB_MAP[activeTab]

  if (!ViewComponent) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12, color: 'var(--jarvis-ts)' }}>
        <span style={{ fontSize: 32 }} aria-hidden>🔧</span>
        <p style={{ fontSize: 13 }}>View not found: <code>{activeTab}</code></p>
      </div>
    )
  }

  const sharedProps = {
    policy,
    biz,
    onNavigate,
    onAudit,
    onToast,
  }

  return (
    <main
      id="main-content"
      role="main"
      aria-label={`${activeTab} view`}
      style={{ flex: 1, overflow: 'auto', minHeight: 0 }}
    >
      <ViewErrorBoundary viewId={activeTab}>
        <Suspense fallback={<ViewLoader />}>
          <ViewComponent {...sharedProps} />
        </Suspense>
      </ViewErrorBoundary>
    </main>
  )
}

/**
 * Register a custom view for a tab id.
 * Useful for plugins or tenant-specific overrides.
 */
export function registerView(tabId: string, component: ViewEntry) {
  TAB_MAP[tabId] = component
}

export default ContentRouter
