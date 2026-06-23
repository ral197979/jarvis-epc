/** React Query hooks — the API surface screens actually consume. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  portfolioAdapter,
  projectAdapter,
  commissioningAdapter,
  crmAdapter,
  procurementAdapter,
  financeAdapter,
  engineeringAdapter,
  documentsAdapter,
  actionsAdapter,
  twinAdapter,
  contractsAdapter,
  adminAdapter,
  inventoryAdapter,
  scheduleAdapter,
  riskAdapter,
  maintenanceAdapter,
  scenarioAdapter,
  safetyAdapter,
  closeoutAdapter,
  reportsAdapter,
  mitigationAdapter,
  mobileAdapter,
} from './adapters'
import type { Deficiency } from './types'

export const usePortfolioKpis = () => useQuery({ queryKey: ['portfolio', 'kpis'], queryFn: portfolioAdapter.kpis })
export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: portfolioAdapter.projects })
export const usePortfolioInsights = () => useQuery({ queryKey: ['portfolio', 'insights'], queryFn: portfolioAdapter.insights })
export const usePortfolioRisks = () => useQuery({ queryKey: ['portfolio', 'risks'], queryFn: portfolioAdapter.risks })

/** Create a project, then refetch the project list + portfolio. */
export const useCreateProject = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (form: { code: string; name: string; client?: string; region?: string; phase?: string; budget?: number }) =>
      portfolioAdapter.createProject(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}

export const useProject = (id: string) => useQuery({ queryKey: ['project', id], queryFn: () => projectAdapter.get(id) })
export const useMilestones = (id: string) => useQuery({ queryKey: ['project', id, 'milestones'], queryFn: () => projectAdapter.milestones(id) })
export const useDeliverables = (id: string) => useQuery({ queryKey: ['project', id, 'deliverables'], queryFn: () => projectAdapter.deliverables(id) })
export const useProjectRisks = (id: string) => useQuery({ queryKey: ['project', id, 'risks'], queryFn: () => projectAdapter.risks(id) })
export const useTeam = (id: string) => useQuery({ queryKey: ['project', id, 'team'], queryFn: () => projectAdapter.team(id) })
export const useActivity = (id: string) => useQuery({ queryKey: ['project', id, 'activity'], queryFn: () => projectAdapter.activity(id) })

export const useCommissioningKpis = () => useQuery({ queryKey: ['cx', 'kpis'], queryFn: commissioningAdapter.kpis })
export const useCompletionMatrix = () => useQuery({ queryKey: ['cx', 'matrix'], queryFn: commissioningAdapter.matrix })
export const useEquipment = (projectId?: string) =>
  useQuery({ queryKey: ['cx', 'equipment', projectId], queryFn: () => commissioningAdapter.equipment(projectId) })
export const useDeficiencies = (projectId?: string) =>
  useQuery({ queryKey: ['cx', 'deficiencies', projectId], queryFn: () => commissioningAdapter.deficiencies(projectId) })

/** Update a deficiency's status, then refetch the registry. */
export const useUpdateDeficiencyStatus = (projectId?: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ deficiency, status }: { deficiency: Deficiency; status: string }) =>
      commissioningAdapter.updateDeficiencyStatus(deficiency, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cx', 'deficiencies', projectId] }),
  })
}

/** Create a deficiency, then refetch the registry for the active project. */
export const useCreateDeficiency = (projectId?: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (form: { title: string; severity: string; description?: string }) =>
      commissioningAdapter.createDeficiency({
        projectId: projectId ?? '',
        code: `DEF-${Math.floor(1000 + Math.random() * 9000)}`,
        title: form.title,
        description: form.description,
        severity: form.severity,
        status: 'open',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cx', 'deficiencies', projectId] }),
  })
}
export const useTestPacks = (projectId?: string) =>
  useQuery({ queryKey: ['cx', 'testpacks', projectId], queryFn: () => commissioningAdapter.testPacks(projectId) })
export const usePfc = () => useQuery({ queryKey: ['cx', 'pfc'], queryFn: commissioningAdapter.pfc })
export const useFptScripts = () => useQuery({ queryKey: ['cx', 'fpt'], queryFn: commissioningAdapter.fptScripts })
export const useIstSequences = () => useQuery({ queryKey: ['cx', 'ist'], queryFn: commissioningAdapter.istSequences })
export const useTurnoverPackages = () => useQuery({ queryKey: ['cx', 'turnover'], queryFn: commissioningAdapter.turnoverPackages })

export const useLeads = () => useQuery({ queryKey: ['crm', 'leads'], queryFn: crmAdapter.leads })
export const useFunnel = () => useQuery({ queryKey: ['crm', 'funnel'], queryFn: crmAdapter.funnel })

export const usePurchaseOrders = () => useQuery({ queryKey: ['proc', 'pos'], queryFn: procurementAdapter.pos })
export const useLongLead = () => useQuery({ queryKey: ['proc', 'longlead'], queryFn: procurementAdapter.longLead })
export const useVendors = () => useQuery({ queryKey: ['proc', 'vendors'], queryFn: procurementAdapter.vendors })
export const useVendorScores = () => useQuery({ queryKey: ['proc', 'vendorScores'], queryFn: procurementAdapter.vendorScores })

export const useMaterials = () => useQuery({ queryKey: ['inv', 'materials'], queryFn: inventoryAdapter.materials })
export const useRequisitions = () => useQuery({ queryKey: ['inv', 'requisitions'], queryFn: inventoryAdapter.requisitions })
export const useReceiving = () => useQuery({ queryKey: ['inv', 'receiving'], queryFn: inventoryAdapter.receiving })

export const useGantt = () => useQuery({ queryKey: ['schedule', 'gantt'], queryFn: scheduleAdapter.gantt })
export const useActivities = () => useQuery({ queryKey: ['schedule', 'activities'], queryFn: scheduleAdapter.activities })
export const useWbsNodes = () => useQuery({ queryKey: ['schedule', 'wbs'], queryFn: scheduleAdapter.wbs })
export const useBaselines = () => useQuery({ queryKey: ['schedule', 'baselines'], queryFn: scheduleAdapter.baselines })
export const useResourceLoad = () => useQuery({ queryKey: ['schedule', 'resourceLoad'], queryFn: scheduleAdapter.resourceLoad })

export const useRiskEntries = () => useQuery({ queryKey: ['risk', 'entries'], queryFn: riskAdapter.entries })
export const useContingency = () => useQuery({ queryKey: ['risk', 'contingency'], queryFn: riskAdapter.contingency })

export const useMaintenanceTasks = () => useQuery({ queryKey: ['maint', 'tasks'], queryFn: maintenanceAdapter.tasks })
export const useAssetRecords = () => useQuery({ queryKey: ['maint', 'assets'], queryFn: maintenanceAdapter.assets })
export const useLifecycle = () => useQuery({ queryKey: ['maint', 'lifecycle'], queryFn: maintenanceAdapter.lifecycle })
export const useScenarios = () => useQuery({ queryKey: ['scenarios'], queryFn: scenarioAdapter.list })

export const useSafetyIncidents = () => useQuery({ queryKey: ['safety', 'incidents'], queryFn: safetyAdapter.incidents })
export const useTrainingRecords = () => useQuery({ queryKey: ['safety', 'training'], queryFn: safetyAdapter.training })
export const useCloseoutLedger = () => useQuery({ queryKey: ['closeout', 'ledger'], queryFn: closeoutAdapter.ledger })

export const useReportTemplates = () => useQuery({ queryKey: ['reports', 'templates'], queryFn: reportsAdapter.templates })
export const useRecentReports = () => useQuery({ queryKey: ['reports', 'recent'], queryFn: reportsAdapter.recent })

export const useMitigationPlans = () => useQuery({ queryKey: ['mitigation', 'plans'], queryFn: mitigationAdapter.plans })
export const useResourceShifts = () => useQuery({ queryKey: ['mitigation', 'shifts'], queryFn: mitigationAdapter.shifts })

export const useFieldAssignments = () => useQuery({ queryKey: ['mobile', 'assignments'], queryFn: mobileAdapter.assignments })
export const useSyncQueue = () => useQuery({ queryKey: ['mobile', 'sync'], queryFn: mobileAdapter.syncQueue })

export const useCashFlow = () => useQuery({ queryKey: ['evm', 'cashflow'], queryFn: financeAdapter.cashFlow })
export const useDrawdowns = () => useQuery({ queryKey: ['evm', 'drawdowns'], queryFn: financeAdapter.drawdowns })
export const useSafetyAudits = () => useQuery({ queryKey: ['safety', 'audits'], queryFn: safetyAdapter.audits })
export const useSiteAccess = () => useQuery({ queryKey: ['safety', 'siteAccess'], queryFn: safetyAdapter.siteAccess })

export const useEvmSummary = (projectId?: string) =>
  useQuery({ queryKey: ['evm', 'summary', projectId], queryFn: () => financeAdapter.summary(projectId) })
export const useEvmTrend = (projectId?: string) =>
  useQuery({ queryKey: ['evm', 'trend', projectId], queryFn: () => financeAdapter.trend(projectId) })
export const useWbs = () => useQuery({ queryKey: ['evm', 'wbs'], queryFn: financeAdapter.wbs })

export const useDrawings = (projectId?: string) =>
  useQuery({ queryKey: ['eng', 'drawings', projectId], queryFn: () => engineeringAdapter.drawings(projectId) })
export const useDocuments = () => useQuery({ queryKey: ['docs'], queryFn: documentsAdapter.list })
export const useActions = () => useQuery({ queryKey: ['actions'], queryFn: actionsAdapter.list })
export const useTwinAssets = () => useQuery({ queryKey: ['twin', 'assets'], queryFn: twinAdapter.assets })
export const useContracts = (projectId?: string) =>
  useQuery({ queryKey: ['contracts', projectId], queryFn: () => contractsAdapter.list(projectId) })
export const useChangeOrders = (projectId?: string) =>
  useQuery({ queryKey: ['contracts', 'cos', projectId], queryFn: () => contractsAdapter.changeOrders(projectId) })
export const useCompliance = () => useQuery({ queryKey: ['contracts', 'compliance'], queryFn: contractsAdapter.compliance })
export const useAdminUsers = () => useQuery({ queryKey: ['admin', 'users'], queryFn: adminAdapter.users })
export const useFeatureGates = () => useQuery({ queryKey: ['admin', 'gates'], queryFn: adminAdapter.featureGates })
