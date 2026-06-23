import { lazy } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { MobileShell } from './mobile/MobileShell'

// Route-level code-splitting: each module is its own chunk, loaded on demand.
const named = <T extends Record<string, unknown>, K extends keyof T>(p: Promise<T>, key: K) =>
  p.then((m) => ({ default: m[key] as React.ComponentType }))

const DashboardPage = lazy(() => named(import('../modules/dashboard/DashboardPage'), 'DashboardPage'))
const ProjectsPage = lazy(() => named(import('../modules/projects/ProjectsPage'), 'ProjectsPage'))
const ProjectWorkspace = lazy(() => named(import('../modules/projects/ProjectWorkspace'), 'ProjectWorkspace'))
const CrmPage = lazy(() => named(import('../modules/crm/CrmPage'), 'CrmPage'))
const ProcurementPage = lazy(() => named(import('../modules/procurement/ProcurementPage'), 'ProcurementPage'))
const EngineeringPage = lazy(() => named(import('../modules/engineering/EngineeringPage'), 'EngineeringPage'))
const CommissioningPage = lazy(() => named(import('../modules/commissioning/CommissioningPage'), 'CommissioningPage'))
const DigitalTwinPage = lazy(() => named(import('../modules/twin/DigitalTwinPage'), 'DigitalTwinPage'))
const DocumentsPage = lazy(() => named(import('../modules/documents/DocumentsPage'), 'DocumentsPage'))
const ActionsPage = lazy(() => named(import('../modules/actions/ActionsPage'), 'ActionsPage'))
const FinancePage = lazy(() => named(import('../modules/finance/FinancePage'), 'FinancePage'))
const AnalyticsPage = lazy(() => named(import('../modules/analytics/AnalyticsPage'), 'AnalyticsPage'))
const AiCopilotPage = lazy(() => named(import('../modules/ai/AiCopilotPage'), 'AiCopilotPage'))
const ContractsPage = lazy(() => named(import('../modules/contracts/ContractsPage'), 'ContractsPage'))
const InventoryPage = lazy(() => named(import('../modules/inventory/InventoryPage'), 'InventoryPage'))
const SchedulePage = lazy(() => named(import('../modules/schedule/SchedulePage'), 'SchedulePage'))
const RiskPage = lazy(() => named(import('../modules/risk/RiskPage'), 'RiskPage'))
const MaintenancePage = lazy(() => named(import('../modules/maintenance/MaintenancePage'), 'MaintenancePage'))
const SafetyPage = lazy(() => named(import('../modules/safety/SafetyPage'), 'SafetyPage'))
const CloseoutPage = lazy(() => named(import('../modules/closeout/CloseoutPage'), 'CloseoutPage'))
const ReportsPage = lazy(() => named(import('../modules/reports/ReportsPage'), 'ReportsPage'))
const MitigationPage = lazy(() => named(import('../modules/mitigation/MitigationPage'), 'MitigationPage'))
const AdminPage = lazy(() => named(import('../modules/admin/AdminPage'), 'AdminPage'))
const NotFound = lazy(() => named(import('./ModulePlaceholder'), 'NotFoundPlaceholder'))

// Mobile field-flow track (separate shell)
const FieldHomePage = lazy(() => named(import('../modules/mobile/FieldHomePage'), 'FieldHomePage'))
const ArrivalPage = lazy(() => named(import('../modules/mobile/ArrivalPage'), 'ArrivalPage'))
const MobileFptPage = lazy(() => named(import('../modules/mobile/MobileFptPage'), 'MobileFptPage'))
const ScanPage = lazy(() => named(import('../modules/mobile/ScanPage'), 'ScanPage'))
const SyncPage = lazy(() => named(import('../modules/mobile/SyncPage'), 'SyncPage'))

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:id', element: <ProjectWorkspace /> },
      { path: 'crm', element: <CrmPage /> },
      { path: 'contracts', element: <ContractsPage /> },
      { path: 'procurement', element: <ProcurementPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'engineering', element: <EngineeringPage /> },
      { path: 'schedule', element: <SchedulePage /> },
      { path: 'risk', element: <RiskPage /> },
      { path: 'maintenance', element: <MaintenancePage /> },
      { path: 'commissioning', element: <CommissioningPage /> },
      { path: 'safety', element: <SafetyPage /> },
      { path: 'twin', element: <DigitalTwinPage /> },
      { path: 'closeout', element: <CloseoutPage /> },
      { path: 'documents', element: <DocumentsPage /> },
      { path: 'actions', element: <ActionsPage /> },
      { path: 'mitigation', element: <MitigationPage /> },
      { path: 'finance', element: <FinancePage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'ai', element: <AiCopilotPage /> },
      { path: 'admin', element: <AdminPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    path: '/m',
    element: <MobileShell />,
    children: [
      { index: true, element: <FieldHomePage /> },
      { path: 'arrival', element: <ArrivalPage /> },
      { path: 'fpt', element: <MobileFptPage /> },
      { path: 'scan', element: <ScanPage /> },
      { path: 'sync', element: <SyncPage /> },
    ],
  },
])
