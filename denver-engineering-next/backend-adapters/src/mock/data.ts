import type {
  PortfolioKpis,
  Project,
  Milestone,
  Deliverable,
  Risk,
  TeamMember,
  ActivityItem,
  AiInsight,
  MatrixSystem,
  CommissioningKpis,
  Equipment,
  Deficiency,
  TestPack,
  PfcItem,
  FptScript,
  IstSequence,
  TurnoverPackage,
  TwinAsset,
  Contract,
  ChangeOrder,
  AdminUser,
  FeatureGate,
  MitigationPlan,
  ResourceShift,
  FieldAssignment,
  SyncItem,
  ReportTemplate,
  GeneratedReport,
  CashFlowPoint,
  DrawdownRequest,
  SafetyAudit,
  SiteAccessBadge,
  SafetyIncident,
  TrainingRecord,
  CloseoutItem,
  MaterialItem,
  Requisition,
  ReceivingRecord,
  GanttTask,
  Activity,
  WbsNode,
  BaselineRow,
  ResourceLoad,
  RiskEntry,
  ContingencyItem,
  MaintenanceTask,
  AssetRecord,
  LifecycleRow,
  VendorScore,
  Scenario,
  ComplianceItem,
  Lead,
  PurchaseOrder,
  LongLeadItem,
  Vendor,
  EvmSummary,
  WbsLine,
  EvmTrendPoint,
  DrawingRecord,
  DocumentRecord,
  ActionItem,
} from '../types'

export const portfolioKpis: PortfolioKpis = {
  totalContractValue: '$1.42B',
  actualCost: '$892.4M',
  actualCostPct: '62.8% of Total Contract',
  revenueYtd: '$342.1M',
  costVariance: '-$24.8M',
  costVariancePct: '-2.4% Variance',
  onTrack: 24,
  atRisk: 4,
  openRisks: 42,
  openNcrs: 18,
}

export const projects: Project[] = [
  { id: 'PRJ-2024-001', code: 'PRJ-2024-001', name: 'NEOM Infrastructure Phase 2', client: 'NEOM Co.', region: 'EMEA', phase: 'Construction', health: 'at-risk', budgetStatus: 'Healthy', scheduleStatus: 'Delayed', safetyStatus: 'No Incidents', qualityPct: 98.4, progressPct: 64, contractValue: '$420M', lat: 28.0, lng: 35.3 },
  { id: 'PRJ-2024-004', code: 'PRJ-2024-004', name: 'Gulf Coast LNG Terminal', client: 'Cheniere', region: 'AMER', phase: 'Commissioning', health: 'critical', budgetStatus: 'Overrun', scheduleStatus: 'Ahead', safetyStatus: '1 LTI', qualityPct: 92.1, progressPct: 81, contractValue: '$680M', lat: 29.3, lng: -94.8 },
  { id: 'PRJ-2023-088', code: 'PRJ-2023-088', name: 'Singapore Hub Renovation', client: 'PSA Intl.', region: 'APAC', phase: 'Engineering', health: 'healthy', budgetStatus: 'Healthy', scheduleStatus: 'On Track', safetyStatus: 'No Incidents', qualityPct: 99.9, progressPct: 38, contractValue: '$210M', lat: 1.29, lng: 103.85 },
  { id: 'PRJ-2024-011', code: 'PRJ-2024-011', name: 'Rotterdam H2 Electrolyzer', client: 'Shell', region: 'EMEA', phase: 'Procurement', health: 'at-risk', budgetStatus: 'Watch', scheduleStatus: 'Delayed', safetyStatus: 'No Incidents', qualityPct: 96.5, progressPct: 22, contractValue: '$95M', lat: 51.92, lng: 4.48 },
  { id: 'PRJ-2023-052', code: 'PRJ-2023-052', name: 'Permian Basin Gas Plant', client: 'ExxonMobil', region: 'AMER', phase: 'Commissioning', health: 'healthy', budgetStatus: 'Healthy', scheduleStatus: 'On Track', safetyStatus: 'No Incidents', qualityPct: 97.8, progressPct: 89, contractValue: '$540M', lat: 31.8, lng: -102.3 },
]

export const milestones: Milestone[] = [
  { id: 'M1', name: 'Issued For Construction (IFC)', date: '2024-03-12', status: 'Complete', owner: 'A. Sterling' },
  { id: 'M2', name: 'Long-Lead Equipment PO', date: '2024-05-01', status: 'Complete', owner: 'R. Okoye' },
  { id: 'M3', name: 'Mechanical Completion', date: '2024-09-30', status: 'In Progress', owner: 'J. Martinez' },
  { id: 'M4', name: 'Ready For Start-Up (RFSU)', date: '2024-11-15', status: 'At Risk', owner: 'J. Martinez' },
  { id: 'M5', name: 'Substantial Completion', date: '2025-01-20', status: 'Not Started', owner: 'A. Sterling' },
]

export const deliverables: Deliverable[] = [
  { id: 'DEL-201', name: 'P&ID — Process Area 200', discipline: 'Process', rev: 'C', status: 'Approved', due: '2024-06-01' },
  { id: 'DEL-340', name: 'Electrical SLD', discipline: 'Electrical', rev: 'B', status: 'In Review', due: '2024-06-18' },
  { id: 'DEL-410', name: 'Structural Steel GA', discipline: 'Civil', rev: 'A', status: 'In Progress', due: '2024-07-02' },
  { id: 'DEL-512', name: 'Control Narrative', discipline: 'I&C', rev: 'D', status: 'Approved', due: '2024-05-20' },
]

export const risks: Risk[] = [
  { id: 'R-014', title: 'Long-lead turbine delivery slip', category: 'Schedule', probability: 4, impact: 5, severity: 'Critical', owner: 'R. Okoye', status: 'Open' },
  { id: 'R-022', title: 'Welder availability in Q3', category: 'Resource', probability: 3, impact: 3, severity: 'Medium', owner: 'J. Martinez', status: 'Mitigating' },
  { id: 'R-031', title: 'Permit amendment for flare stack', category: 'Regulatory', probability: 2, impact: 4, severity: 'High', owner: 'A. Sterling', status: 'Open' },
  { id: 'R-039', title: 'FX exposure on EU equipment', category: 'Financial', probability: 3, impact: 2, severity: 'Medium', owner: 'Finance', status: 'Monitoring' },
]

export const team: TeamMember[] = [
  { id: 'U1', name: 'Alex Sterling', role: 'Program Director', email: 'asterling@denver.eng', allocationPct: 40 },
  { id: 'U2', name: 'Jordan Martinez', role: 'Construction Manager', email: 'jmartinez@denver.eng', allocationPct: 100 },
  { id: 'U3', name: 'Rita Okoye', role: 'Procurement Lead', email: 'rokoye@denver.eng', allocationPct: 80 },
  { id: 'U4', name: 'Sam Pena', role: 'Commissioning Manager', email: 'spena@denver.eng', allocationPct: 100 },
]

export const activity: ActivityItem[] = [
  { id: 'A1', actor: 'Sam Pena', action: 'signed off', target: 'PFC-CH-001', at: '12m ago', icon: 'check_circle' },
  { id: 'A2', actor: 'Rita Okoye', action: 'flagged delay on', target: 'PO-4510-14', at: '1h ago', icon: 'warning' },
  { id: 'A3', actor: 'Jordan Martinez', action: 'logged deficiency', target: 'DEF-4821', at: '3h ago', icon: 'report_problem' },
  { id: 'A4', actor: 'Alex Sterling', action: 'approved', target: 'DEL-512 Rev D', at: 'Yesterday', icon: 'description' },
]

export const aiInsights: AiInsight[] = [
  {
    id: 'AI-1',
    title: 'Gulf region cost trend',
    body: '3 projects in the Gulf region are trending toward a 5% cost overrun due to procurement delays in long-lead equipment.',
    severity: 'critical',
    recommendation: 'Accelerate alternative vendor verification for the turbine assemblies.',
  },
  {
    id: 'AI-2',
    title: 'Commissioning readiness',
    body: 'Electrical discipline completion (62%) lags mechanical (84%); IST sequencing is at risk for the Oct turnover.',
    severity: 'at-risk',
    recommendation: 'Add a second loop-check crew to the Electrical scope for 3 weeks.',
  },
]

// ── Commissioning ──────────────────────────────────────────────────────────
export const commissioningKpis: CommissioningKpis = {
  overallCompletion: 78.4,
  systemsComplete: 142,
  systemsTotal: 210,
  systemsAtRisk: 12,
  criticalDeficiencies: 42,
  readinessForecast: 92,
}

const S = (cells: Record<string, MatrixSystem['cells'][string]>) => cells
export const matrixSystems: MatrixSystem[] = [
  { id: 'SYS-100', tag: 'HVAC-100', name: 'Chilled Water', category: 'Mechanical', cells: S({ DESIGN: 'complete', PROCURE: 'complete', INSTALL: 'complete', ENERGIZE: 'complete', PFC: 'complete', 'START-UP': 'in-progress', FPT: 'not-started', IST: 'not-started', TURNOVER: 'not-started' }) },
  { id: 'SYS-110', tag: 'HVAC-110', name: 'Air Handling', category: 'Mechanical', cells: S({ DESIGN: 'complete', PROCURE: 'complete', INSTALL: 'complete', ENERGIZE: 'in-progress', PFC: 'not-started', 'START-UP': 'not-started', FPT: 'not-started', IST: 'not-started', TURNOVER: 'not-started' }) },
  { id: 'SYS-200', tag: 'ELEC-200', name: 'Medium Voltage', category: 'Electrical', cells: S({ DESIGN: 'complete', PROCURE: 'complete', INSTALL: 'delayed', ENERGIZE: 'not-started', PFC: 'not-started', 'START-UP': 'not-started', FPT: 'not-started', IST: 'not-started', TURNOVER: 'not-started' }) },
  { id: 'SYS-210', tag: 'ELEC-210', name: 'UPS & Backup', category: 'Electrical', cells: S({ DESIGN: 'complete', PROCURE: 'complete', INSTALL: 'critical', ENERGIZE: 'not-started', PFC: 'not-started', 'START-UP': 'not-started', FPT: 'not-started', IST: 'not-started', TURNOVER: 'not-started' }) },
  { id: 'SYS-300', tag: 'CTRL-300', name: 'DCS / BMS', category: 'Controls', cells: S({ DESIGN: 'complete', PROCURE: 'in-progress', INSTALL: 'not-started', ENERGIZE: 'not-started', PFC: 'not-started', 'START-UP': 'not-started', FPT: 'not-started', IST: 'not-started', TURNOVER: 'not-started' }) },
  { id: 'SYS-310', tag: 'CTRL-310', name: 'Fire & Gas', category: 'Controls', cells: S({ DESIGN: 'complete', PROCURE: 'complete', INSTALL: 'complete', ENERGIZE: 'complete', PFC: 'complete', 'START-UP': 'complete', FPT: 'complete', IST: 'in-progress', TURNOVER: 'not-started' }) },
]

export const equipment: Equipment[] = [
  { id: 'HVAC-CH-001', tag: 'HVAC-CH-001', name: 'Centrifugal Chiller A', system: 'Chilled Water', vendor: 'Trane', model: 'CVHF-1250', status: 'Operational', completionPct: 88, openPunch: 2 },
  { id: 'HVAC-CH-002', tag: 'HVAC-CH-002', name: 'Centrifugal Chiller B', system: 'Chilled Water', vendor: 'Trane', model: 'CVHF-1250', status: 'Testing', completionPct: 64, openPunch: 5 },
  { id: 'ELEC-SG-200', tag: 'ELEC-SG-200', name: 'MV Switchgear', system: 'Medium Voltage', vendor: 'Siemens', model: '8DA10', status: 'Mechanical Cmpl.', completionPct: 45, openPunch: 8 },
  { id: 'CTRL-DCS-300', tag: 'CTRL-DCS-300', name: 'DCS Controller Rack', system: 'DCS / BMS', vendor: 'Emerson', model: 'DeltaV', status: 'Not Started', completionPct: 10, openPunch: 0 },
]

export const deficiencies: Deficiency[] = [
  { id: 'DEF-4821', description: 'Chiller A condenser pressure transmitter out of calibration', category: 'A', severity: 'Critical', system: 'Chilled Water', contractor: 'MechCo', status: 'Open', loggedAt: '2024-06-14' },
  { id: 'DEF-4822', description: 'Missing earthing on MV switchgear cubicle 3', category: 'A', severity: 'High', system: 'Medium Voltage', contractor: 'SparkElec', status: 'Assigned', loggedAt: '2024-06-13' },
  { id: 'DEF-4810', description: 'AHU-110 access door gasket damaged', category: 'B', severity: 'Medium', system: 'Air Handling', contractor: 'MechCo', status: 'Retest', loggedAt: '2024-06-11' },
  { id: 'DEF-4799', description: 'Cable tray labeling incomplete in Room 210', category: 'C', severity: 'Low', system: 'Medium Voltage', contractor: 'SparkElec', status: 'Closed', loggedAt: '2024-06-08' },
]

export const testPacks: TestPack[] = [
  { id: 'TP-CW-01', discipline: 'Mechanical', testType: 'Hydrotest', preparedBy: 'MechCo', date: '2024-06-02', qaSignature: 'S. Pena', progressPct: 100 },
  { id: 'TP-MV-04', discipline: 'Electrical', testType: 'Loop Check', preparedBy: 'SparkElec', date: '2024-06-12', qaSignature: 'Pending', progressPct: 42 },
  { id: 'TP-DCS-02', discipline: 'Controls', testType: 'FPT', preparedBy: 'CtrlSys', date: '2024-06-15', qaSignature: 'Pending', progressPct: 18 },
]

// ── Commissioning Phase 3 ────────────────────────────────────────────────────
export const pfcItems: PfcItem[] = [
  { id: 'PFC-CW-001', system: 'Chilled Water', equipmentTag: 'HVAC-CH-001', description: 'Chiller A pre-functional check', checksComplete: 24, checksTotal: 24, status: 'Signed Off', signedBy: 'S. Pena' },
  { id: 'PFC-CW-002', system: 'Chilled Water', equipmentTag: 'HVAC-CH-002', description: 'Chiller B pre-functional check', checksComplete: 18, checksTotal: 24, status: 'In Progress', signedBy: '—' },
  { id: 'PFC-AH-110', system: 'Air Handling', equipmentTag: 'HVAC-AHU-110', description: 'AHU-110 pre-functional check', checksComplete: 12, checksTotal: 20, status: 'In Progress', signedBy: '—' },
  { id: 'PFC-MV-200', system: 'Medium Voltage', equipmentTag: 'ELEC-SG-200', description: 'MV switchgear pre-energization check', checksComplete: 8, checksTotal: 30, status: 'In Progress', signedBy: '—' },
  { id: 'PFC-DCS-300', system: 'DCS / BMS', equipmentTag: 'CTRL-DCS-300', description: 'DCS controller PFC', checksComplete: 0, checksTotal: 16, status: 'Not Started', signedBy: '—' },
]

export const fptScripts: FptScript[] = [
  {
    id: 'FPT-CW-01', name: 'Chilled Water Capacity Test', system: 'Chilled Water', status: 'In Progress', witnessedBy: 'S. Pena',
    steps: [
      { id: 's1', no: 1, description: 'Start lead chiller, confirm sequence', expected: 'Chiller starts within 30s', result: 'pass' },
      { id: 's2', no: 2, description: 'Ramp to 100% load', expected: 'Supply temp ≤ 6.7°C', result: 'pass' },
      { id: 's3', no: 3, description: 'Verify condenser pump interlock', expected: 'Pump runs before compressor', result: 'pending' },
      { id: 's4', no: 4, description: 'Simulate high pressure trip', expected: 'Chiller trips & alarms', result: 'pending' },
    ],
  },
  {
    id: 'FPT-AH-11', name: 'AHU-110 Economizer Test', system: 'Air Handling', status: 'Not Started', witnessedBy: '—',
    steps: [
      { id: 's1', no: 1, description: 'Command 50% outside-air damper', expected: 'Damper modulates to 50%', result: 'pending' },
      { id: 's2', no: 2, description: 'Verify freeze-stat trip', expected: 'Unit trips at 3°C', result: 'pending' },
    ],
  },
  {
    id: 'FPT-FG-31', name: 'Fire & Gas Cause-Effect', system: 'Fire & Gas', status: 'Passed', witnessedBy: 'J. Martinez',
    steps: [
      { id: 's1', no: 1, description: 'Activate zone 1 detector', expected: 'Alarm + damper close', result: 'pass' },
      { id: 's2', no: 2, description: 'Confirm DCS annunciation', expected: 'Alarm logged on DCS', result: 'pass' },
    ],
  },
]

export const istSequences: IstSequence[] = [
  {
    id: 'IST-01', name: 'Black-Start to Full Load', systems: ['Medium Voltage', 'Chilled Water', 'DCS / BMS'], window: '2024-09-14 02:00–08:00', status: 'Running',
    steps: [
      { id: 'i1', seq: 1, system: 'Medium Voltage', action: 'Energize MV bus from utility', status: 'complete' },
      { id: 'i2', seq: 2, system: 'DCS / BMS', action: 'Bring DCS online & confirm comms', status: 'complete' },
      { id: 'i3', seq: 3, system: 'Chilled Water', action: 'Start chilled water loop', status: 'active' },
      { id: 'i4', seq: 4, system: 'Chilled Water', action: 'Stabilize supply temperature', status: 'pending' },
      { id: 'i5', seq: 5, system: 'DCS / BMS', action: 'Verify load-shed sequence', status: 'blocked' },
    ],
  },
  {
    id: 'IST-02', name: 'Emergency Power Transfer', systems: ['Medium Voltage', 'UPS & Backup'], window: '2024-09-21 22:00–02:00', status: 'Scheduled',
    steps: [
      { id: 'i1', seq: 1, system: 'Medium Voltage', action: 'Simulate utility loss', status: 'pending' },
      { id: 'i2', seq: 2, system: 'UPS & Backup', action: 'Confirm generator start ≤ 10s', status: 'pending' },
      { id: 'i3', seq: 3, system: 'Medium Voltage', action: 'Verify ATS transfer', status: 'pending' },
    ],
  },
]

export const turnoverPackages: TurnoverPackage[] = [
  {
    id: 'TOP-CW', system: 'Chilled Water', recipient: 'Owner — Facilities', status: 'In Review',
    items: [
      { label: 'Mechanical Completion certificate', collected: true },
      { label: 'PFC sign-off records', collected: true },
      { label: 'FPT results package', collected: true },
      { label: 'Vendor O&M manuals', collected: false },
      { label: 'As-built drawings', collected: true },
      { label: 'Spare parts list', collected: false },
    ],
  },
  {
    id: 'TOP-FG', system: 'Fire & Gas', recipient: 'Owner — HSE', status: 'Accepted',
    items: [
      { label: 'Mechanical Completion certificate', collected: true },
      { label: 'Cause & effect matrix', collected: true },
      { label: 'FPT results package', collected: true },
      { label: 'Vendor O&M manuals', collected: true },
      { label: 'Training records', collected: true },
    ],
  },
  {
    id: 'TOP-MV', system: 'Medium Voltage', recipient: 'Owner — Electrical', status: 'Draft',
    items: [
      { label: 'Mechanical Completion certificate', collected: false },
      { label: 'PFC sign-off records', collected: false },
      { label: 'Protection relay settings', collected: true },
      { label: 'As-built drawings', collected: false },
    ],
  },
]

// ── Digital Twin ─────────────────────────────────────────────────────────────
export const twinAssets: TwinAsset[] = [
  {
    id: 'HVAC-CH-001', tag: 'HVAC-CH-001', name: 'Centrifugal Chiller A', system: 'Chilled Water', status: 'Operational', completionPct: 88, openPunch: 2,
    telemetry: [
      { label: 'Pressure', value: 124.5, unit: 'PSI', min: 90, max: 150 },
      { label: 'Flow Rate', value: 1200, unit: 'GPM', min: 800, max: 1400 },
      { label: 'Supply Temp', value: 44.2, unit: '°F', min: 40, max: 55 },
      { label: 'Power Draw', value: 342, unit: 'kW', min: 200, max: 480 },
    ],
  },
  {
    id: 'HVAC-CH-002', tag: 'HVAC-CH-002', name: 'Centrifugal Chiller B', system: 'Chilled Water', status: 'Testing', completionPct: 64, openPunch: 5,
    telemetry: [
      { label: 'Pressure', value: 118.0, unit: 'PSI', min: 90, max: 150 },
      { label: 'Flow Rate', value: 980, unit: 'GPM', min: 800, max: 1400 },
      { label: 'Supply Temp', value: 47.8, unit: '°F', min: 40, max: 55 },
      { label: 'Power Draw', value: 288, unit: 'kW', min: 200, max: 480 },
    ],
  },
  {
    id: 'ELEC-SG-200', tag: 'ELEC-SG-200', name: 'MV Switchgear', system: 'Medium Voltage', status: 'Mechanical Cmpl.', completionPct: 45, openPunch: 8,
    telemetry: [
      { label: 'Bus Voltage', value: 13.8, unit: 'kV', min: 13, max: 14.4 },
      { label: 'Load Current', value: 420, unit: 'A', min: 0, max: 1200 },
      { label: 'Breaker Temp', value: 38.5, unit: '°C', min: 20, max: 70 },
    ],
  },
  {
    id: 'CTRL-DCS-300', tag: 'CTRL-DCS-300', name: 'DCS Controller Rack', system: 'DCS / BMS', status: 'Offline', completionPct: 10, openPunch: 0,
    telemetry: [
      { label: 'CPU Load', value: 0, unit: '%', min: 0, max: 100 },
      { label: 'I/O Points', value: 0, unit: 'live', min: 0, max: 2048 },
    ],
  },
]

// ── Mobile field flows ───────────────────────────────────────────────────────
export const fieldAssignments: FieldAssignment[] = [
  { id: 'WO-2201', title: 'FPT — Chilled Water Capacity Test', system: 'HVAC-CH-001', location: 'Area 200 · Level 1', due: 'Today 14:00', status: 'In Progress', priority: 'High' },
  { id: 'WO-2202', title: 'Asset audit — MV Switchgear', system: 'ELEC-SG-200', location: 'Substation B', due: 'Today 16:30', status: 'Assigned', priority: 'High' },
  { id: 'WO-2203', title: 'Log deficiency — AHU-110 gasket', system: 'HVAC-AHU-110', location: 'Roof Plant', due: 'Tomorrow', status: 'Assigned', priority: 'Medium' },
  { id: 'WO-2204', title: 'Preservation check — Pumps', system: 'Chilled Water', location: 'Yard A-3', due: 'Tomorrow', status: 'Assigned', priority: 'Low' },
]
export const syncQueue: SyncItem[] = [
  { id: 'SQ-1', action: 'FPT result recorded', entity: 'FPT-CW-01 · Step 3', status: 'Pending', at: '2m ago' },
  { id: 'SQ-2', action: 'Deficiency logged', entity: 'DEF-4830', status: 'Conflict', at: '14m ago' },
  { id: 'SQ-3', action: 'Asset audited', entity: 'ELEC-SG-200', status: 'Pending', at: '20m ago' },
  { id: 'SQ-4', action: 'Photo uploaded', entity: 'WO-2201 / IMG-08', status: 'Synced', at: '1h ago' },
]

// ── AI Mitigation / Resource Reallocation ───────────────────────────────────
export const mitigationPlans: MitigationPlan[] = [
  { id: 'MIT-01', trigger: 'Turbine PO-4510-14 slipped 6 weeks', project: 'PRJ-2024-004', severity: 'Critical', recommendation: 'Dual-source the secondary turbine lot and pull commissioning prep forward two weeks.', scheduleImpactDays: -21, costImpact: '+$2.1M', confidence: 88, status: 'Proposed' },
  { id: 'MIT-02', trigger: 'Electrical loop-checks behind by 9 days', project: 'PRJ-2024-004', severity: 'High', recommendation: 'Reassign 2 I&C crews from Permian (ahead of plan) to Gulf Coast for 3 weeks.', scheduleImpactDays: -9, costImpact: '+$0.4M', confidence: 92, status: 'Proposed' },
  { id: 'MIT-03', trigger: 'MV switchgear earthing defect cluster', project: 'PRJ-2024-004', severity: 'High', recommendation: 'Surge QA inspection and stand up a dedicated remediation cell on Site D-202.', scheduleImpactDays: -4, costImpact: '+$0.15M', confidence: 79, status: 'Proposed' },
]
export const resourceShifts: ResourceShift[] = [
  { id: 'RS-01', resource: 'I&C Loop-Check Crew', from: 'Permian Basin (PRJ-2023-052)', to: 'Gulf Coast LNG (PRJ-2024-004)', count: 2, status: 'Proposed', eta: '2024-06-24' },
  { id: 'RS-02', resource: 'QA/QC Inspector', from: 'Singapore Hub (PRJ-2023-088)', to: 'Gulf Coast LNG (PRJ-2024-004)', count: 1, status: 'Dispatched', eta: '2024-06-21' },
  { id: 'RS-03', resource: 'Mobile Crane (200T)', from: 'Yard A-3', to: 'Gulf Coast — Area 200', count: 1, status: 'Confirmed', eta: '2024-06-20' },
  { id: 'RS-04', resource: 'Commissioning Engineer', from: 'Bench (available)', to: 'Gulf Coast LNG (PRJ-2024-004)', count: 3, status: 'Dispatched', eta: '2024-06-22' },
]

// ── Reports Center ───────────────────────────────────────────────────────────
export const reportTemplates: ReportTemplate[] = [
  { id: 'RPT-EXEC', name: 'Executive Monthly Report', category: 'Executive', description: 'Portfolio health, KPIs, risks & AI insights for leadership.', icon: 'insights' },
  { id: 'RPT-EVM', name: 'EVM & Cost Performance', category: 'Commercial', description: 'PV/EV/AC, CPI/SPI, forecasts and WBS variance.', icon: 'payments' },
  { id: 'RPT-CX', name: 'Commissioning Readiness', category: 'Commissioning', description: 'System completion matrix, deficiencies, turnover readiness.', icon: 'precision_manufacturing' },
  { id: 'RPT-PROC', name: 'Procurement Status', category: 'Commercial', description: 'PO register, long-lead expediting, vendor performance.', icon: 'shopping_cart' },
  { id: 'RPT-SAFE', name: 'HSE / Safety Summary', category: 'Safety', description: 'TRIR, incidents, training compliance and corrective actions.', icon: 'health_and_safety' },
  { id: 'RPT-HAND', name: 'Handover Dossier', category: 'Technical', description: 'As-builts, O&M manuals, certificates and warranty data.', icon: 'workspace_premium' },
]
export const generatedReports: GeneratedReport[] = [
  { id: 'GEN-7001', name: 'Gulf Coast LNG — Executive Monthly (Jun)', template: 'Executive Monthly Report', generatedBy: 'A. Sterling', date: '2024-06-18', status: 'Ready', format: 'PDF' },
  { id: 'GEN-7002', name: 'Portfolio EVM Rollup Q2', template: 'EVM & Cost Performance', generatedBy: 'Finance', date: '2024-06-15', status: 'Ready', format: 'XLSX' },
  { id: 'GEN-7003', name: 'Commissioning Readiness — Wk 24', template: 'Commissioning Readiness', generatedBy: 'S. Pena', date: '2024-06-17', status: 'Generating', format: 'PDF' },
  { id: 'GEN-7004', name: 'Board Deck — 2026 Strategy', template: 'Executive Monthly Report', generatedBy: 'A. Sterling', date: '2024-06-20', status: 'Scheduled', format: 'PPTX' },
  { id: 'GEN-7005', name: 'HSE Summary — May', template: 'HSE / Safety Summary', generatedBy: 'HSE', date: '2024-06-02', status: 'Ready', format: 'PDF' },
]

// ── Finance deep-dive ────────────────────────────────────────────────────────
export const cashFlow: CashFlowPoint[] = [
  { month: 'Jan', inflow: 42, outflow: 38, net: 4 },
  { month: 'Feb', inflow: 55, outflow: 61, net: -2 },
  { month: 'Mar', inflow: 68, outflow: 72, net: -6 },
  { month: 'Apr', inflow: 74, outflow: 70, net: -2 },
  { month: 'May', inflow: 81, outflow: 88, net: -9 },
  { month: 'Jun', inflow: 92, outflow: 90, net: -7 },
]
export const drawdownRequests: DrawdownRequest[] = [
  { id: 'DR-4501', description: 'Structural steel escalation', area: 'Procurement', amount: '$2.4M', status: 'Approved', date: '2024-06-10' },
  { id: 'DR-4502', description: 'Loop-check crew surge', area: 'Commissioning', amount: '$0.4M', status: 'Review', date: '2024-06-17' },
  { id: 'DR-4503', description: 'Unidentified utilities relocation', area: 'Civil', amount: '$4.2M', status: 'Review', date: '2024-06-18' },
  { id: 'DR-4504', description: 'Weather standby — Q3', area: 'Site', amount: '$0.6M', status: 'Approved', date: '2024-06-05' },
  { id: 'DR-4505', description: 'Scope change — flare stack', area: 'Mechanical', amount: '$1.1M', status: 'Rejected', date: '2024-05-28' },
]

// ── Safety audits + site access ──────────────────────────────────────────────
export const safetyAudits: SafetyAudit[] = [
  { id: 'AUD-201', title: 'Working-at-heights compliance', area: 'Area 200 — Steel', auditor: 'HSE Lead', date: '2024-06-14', score: 96, openFindings: 1, status: 'Action Required' },
  { id: 'AUD-202', title: 'Electrical isolation (LOTO)', area: 'Substation B', auditor: 'SparkElec QA', date: '2024-06-11', score: 88, openFindings: 3, status: 'Open' },
  { id: 'AUD-203', title: 'Scaffold inspection', area: 'Roof Plant', auditor: 'HSE Lead', date: '2024-06-05', score: 99, openFindings: 0, status: 'Closed' },
  { id: 'AUD-204', title: 'Confined-space permit audit', area: 'Tank Farm', auditor: 'HSE Lead', date: '2024-05-30', score: 92, openFindings: 0, status: 'Closed' },
]
export const siteAccessBadges: SiteAccessBadge[] = [
  { id: 'BDG-1001', person: 'Jordan Martinez', company: 'Denver EPC', role: 'Construction Mgr', inducted: '2024-01-08', zones: 'All zones', status: 'Active' },
  { id: 'BDG-1042', person: 'MechCo Crew (12)', company: 'MechCo', role: 'Mechanical', inducted: '2024-03-02', zones: 'Area 200, 300', status: 'Active' },
  { id: 'BDG-1108', person: 'SparkElec Crew (8)', company: 'SparkElec', role: 'Electrical', inducted: '2024-04-22', zones: 'Substation B', status: 'Expiring' },
  { id: 'BDG-1190', person: 'Visitor — Auditor', company: 'BV Cert', role: 'Inspector', inducted: '2024-06-01', zones: 'Escorted', status: 'Active' },
  { id: 'BDG-0921', person: 'CivilCo Crew (6)', company: 'BuildRight', role: 'Civil', inducted: '2023-11-15', zones: 'Yard A', status: 'Suspended' },
]

// ── Safety ───────────────────────────────────────────────────────────────────
export const safetyIncidents: SafetyIncident[] = [
  { id: 'INC-0912', title: 'Dropped object near MV switchgear', type: 'Near Miss', severity: 'High', project: 'PRJ-2024-004', date: '2024-06-17', status: 'Investigating', reportedBy: 'J. Martinez' },
  { id: 'INC-0908', title: 'Hand laceration during pipe fit-up', type: 'Recordable', severity: 'Medium', project: 'PRJ-2024-004', date: '2024-06-12', status: 'Open', reportedBy: 'MechCo' },
  { id: 'INC-0901', title: 'Slip on wet platform — lost time', type: 'LTI', severity: 'Critical', project: 'PRJ-2024-004', date: '2024-05-28', status: 'Investigating', reportedBy: 'SparkElec' },
  { id: 'INC-0887', title: 'Eye irritation, flushed at station', type: 'First Aid', severity: 'Low', project: 'PRJ-2023-052', date: '2024-05-20', status: 'Closed', reportedBy: 'BuildRight' },
  { id: 'INC-0875', title: 'Scaffold tag missing', type: 'Near Miss', severity: 'Medium', project: 'PRJ-2023-088', date: '2024-05-11', status: 'Closed', reportedBy: 'HSE' },
]
export const trainingRecords: TrainingRecord[] = [
  { id: 'TR-1', person: 'Jordan Martinez', role: 'Construction Manager', course: 'Confined Space Entry', status: 'Valid', expires: '2025-03-01' },
  { id: 'TR-2', person: 'Sam Pena', role: 'Commissioning Manager', course: 'LOTO / Energy Isolation', status: 'Expiring', expires: '2024-07-30' },
  { id: 'TR-3', person: 'Rita Okoye', role: 'Procurement Lead', course: 'Site Safety Induction', status: 'Valid', expires: '2025-01-15' },
  { id: 'TR-4', person: 'SparkElec Crew', role: 'Electrical Subcontractor', course: 'Arc Flash Awareness', status: 'Expired', expires: '2024-05-31' },
  { id: 'TR-5', person: 'MechCo Crew', role: 'Mechanical Subcontractor', course: 'Working at Heights', status: 'Valid', expires: '2024-12-01' },
]

// ── Project Closeout ─────────────────────────────────────────────────────────
export const closeoutItems: CloseoutItem[] = [
  { id: 'CO-DOC-01', category: 'Documentation', description: 'As-built drawings (all disciplines)', status: 'In Progress', owner: 'Doc Control', due: '2024-12-15' },
  { id: 'CO-DOC-02', category: 'Documentation', description: 'O&M manuals compiled & indexed', status: 'Outstanding', owner: 'CxPro', due: '2024-12-20' },
  { id: 'CO-COM-01', category: 'Commercial', description: 'Final account & retention release', status: 'Outstanding', owner: 'Finance', due: '2025-01-20' },
  { id: 'CO-COM-02', category: 'Commercial', description: 'All change orders closed', status: 'In Progress', owner: 'A. Sterling', due: '2024-12-31' },
  { id: 'CO-TEC-01', category: 'Technical', description: 'Punch list cleared (Cat A & B)', status: 'In Progress', owner: 'S. Pena', due: '2024-11-30' },
  { id: 'CO-TEC-02', category: 'Technical', description: 'Spare parts delivered & logged', status: 'Complete', owner: 'Warehouse', due: '2024-10-30' },
  { id: 'CO-HAN-01', category: 'Handover', description: 'Turnover packages accepted by owner', status: 'In Progress', owner: 'S. Pena', due: '2024-12-10' },
  { id: 'CO-HAN-02', category: 'Handover', description: 'Final Handover Certificate signed', status: 'Outstanding', owner: 'Owner', due: '2025-01-25' },
  { id: 'CO-HAN-03', category: 'Handover', description: 'Warranty period commencement notice', status: 'Outstanding', owner: 'Legal', due: '2025-01-25' },
]

// ── Inventory / Materials ────────────────────────────────────────────────────
export const materials: MaterialItem[] = [
  { id: 'MAT-1001', description: 'Carbon Steel Pipe, 12" Sch 40', category: 'Piping', uom: 'm', onHand: 1840, reserved: 1200, available: 640, location: 'Yard A-3', status: 'In Stock' },
  { id: 'MAT-1042', description: 'Gate Valve, 6" 300# RF', category: 'Valves', uom: 'ea', onHand: 24, reserved: 22, available: 2, location: 'WH-1 R12', status: 'Low' },
  { id: 'MAT-1108', description: 'Cable, MV 15kV 3C 240mm²', category: 'Electrical', uom: 'm', onHand: 0, reserved: 0, available: 0, location: 'WH-2 R04', status: 'Out' },
  { id: 'MAT-1205', description: 'Structural Bolt, M24 x 90 A325', category: 'Fasteners', uom: 'ea', onHand: 9800, reserved: 4200, available: 5600, location: 'WH-1 B07', status: 'In Stock' },
  { id: 'MAT-1310', description: 'Instrument Transmitter, Pressure', category: 'Instrumentation', uom: 'ea', onHand: 12, reserved: 10, available: 2, location: 'WH-2 R18', status: 'Low' },
]
export const requisitions: Requisition[] = [
  { id: 'REQ-3001', item: 'Gate Valve, 6" 300#', qty: 18, requestedBy: 'J. Martinez', project: 'PRJ-2024-004', status: 'Approved', date: '2024-06-16' },
  { id: 'REQ-3002', item: 'Cable, MV 15kV 3C 240mm²', qty: 1200, requestedBy: 'SparkElec', project: 'PRJ-2024-004', status: 'Submitted', date: '2024-06-17' },
  { id: 'REQ-3003', item: 'Pressure Transmitter', qty: 8, requestedBy: 'CtrlSys', project: 'PRJ-2024-004', status: 'Issued', date: '2024-06-12' },
  { id: 'REQ-3004', item: 'Structural Bolt M24', qty: 2000, requestedBy: 'BuildRight', project: 'PRJ-2023-052', status: 'Draft', date: '2024-06-18' },
]
export const receiving: ReceivingRecord[] = [
  { id: 'GRN-5001', po: 'PO-4511-02', item: 'API 610 Pumps', qtyExpected: 12, qtyReceived: 12, status: 'Received', date: '2024-06-10' },
  { id: 'GRN-5002', po: 'PO-4513-21', item: 'Control Valves', qtyExpected: 220, qtyReceived: 180, status: 'Partial', date: '2024-06-15' },
  { id: 'GRN-5003', po: 'PO-4512-09', item: 'MV Switchgear Lineup', qtyExpected: 1, qtyReceived: 1, status: 'Discrepancy', date: '2024-06-16' },
  { id: 'GRN-5004', po: 'PO-4510-14', item: 'Gas Turbine Generators', qtyExpected: 2, qtyReceived: 0, status: 'Pending', date: '—' },
]

// ── Schedule / Gantt ─────────────────────────────────────────────────────────
export const ganttTasks: GanttTask[] = [
  { id: 'G1', name: 'Engineering & Design', track: 'Engineering', start: '2024-01-01', end: '2024-05-31', progressPct: 100, status: 'Complete' },
  { id: 'G2', name: 'Long-Lead Procurement', track: 'Procurement', start: '2024-02-01', end: '2024-12-01', progressPct: 65, status: 'At Risk' },
  { id: 'G3', name: 'Civil & Structural', track: 'Construction', start: '2024-04-01', end: '2024-09-30', progressPct: 82, status: 'On Track' },
  { id: 'G4', name: 'Mechanical Erection', track: 'Construction', start: '2024-06-01', end: '2024-10-31', progressPct: 58, status: 'On Track' },
  { id: 'G5', name: 'E&I Installation', track: 'Construction', start: '2024-07-15', end: '2024-11-30', progressPct: 34, status: 'Delayed' },
  { id: 'G6', name: 'Mechanical Completion', track: 'Milestone', start: '2024-09-30', end: '2024-09-30', progressPct: 0, status: 'At Risk', milestone: true },
  { id: 'G7', name: 'Pre-Commissioning', track: 'Commissioning', start: '2024-09-15', end: '2024-11-15', progressPct: 20, status: 'On Track' },
  { id: 'G8', name: 'Commissioning & Start-Up', track: 'Commissioning', start: '2024-10-15', end: '2025-01-15', progressPct: 5, status: 'On Track' },
  { id: 'G9', name: 'Turnover / RFSU', track: 'Milestone', start: '2024-11-15', end: '2024-11-15', progressPct: 0, status: 'At Risk', milestone: true },
]

// ── Schedule / Primavera P6 bridge ───────────────────────────────────────────
export const activities: Activity[] = [
  { id: 'A1000', name: 'Site Mobilization', wbs: '1.1', start: '2024-01-01', finish: '2024-01-31', durationDays: 30, floatDays: 0, pctComplete: 100, status: 'Complete', critical: true },
  { id: 'A1100', name: 'Foundations — Area 200', wbs: '1.2', start: '2024-02-01', finish: '2024-04-30', durationDays: 89, floatDays: 0, pctComplete: 100, status: 'Complete', critical: true },
  { id: 'A1200', name: 'Structural Steel Erection', wbs: '1.2', start: '2024-04-15', finish: '2024-08-15', durationDays: 122, floatDays: 0, pctComplete: 82, status: 'In Progress', critical: true },
  { id: 'A1300', name: 'Mechanical Equipment Set', wbs: '1.3', start: '2024-06-01', finish: '2024-10-31', durationDays: 152, floatDays: 0, pctComplete: 58, status: 'In Progress', critical: true },
  { id: 'A1350', name: 'Piping & Tie-ins', wbs: '1.3', start: '2024-07-01', finish: '2024-11-15', durationDays: 137, floatDays: 12, pctComplete: 40, status: 'In Progress', critical: false },
  { id: 'A1400', name: 'E&I Installation', wbs: '1.4', start: '2024-07-15', finish: '2024-11-30', durationDays: 138, floatDays: 0, pctComplete: 34, status: 'In Progress', critical: true },
  { id: 'A1500', name: 'Pre-Commissioning', wbs: '1.5', start: '2024-09-15', finish: '2024-11-15', durationDays: 61, floatDays: 5, pctComplete: 20, status: 'In Progress', critical: false },
  { id: 'A1600', name: 'Commissioning & Start-Up', wbs: '1.5', start: '2024-10-15', finish: '2025-01-15', durationDays: 92, floatDays: 0, pctComplete: 5, status: 'In Progress', critical: true },
  { id: 'A1700', name: 'Turnover / RFSU', wbs: '1.6', start: '2025-01-15', finish: '2025-01-20', durationDays: 5, floatDays: 0, pctComplete: 0, status: 'Not Started', critical: true },
]
export const wbsNodes: WbsNode[] = [
  { id: 'W1', code: '1', name: 'Gulf Coast LNG Terminal', level: 0, budget: '$680M', pctComplete: 64 },
  { id: 'W11', code: '1.1', name: 'Mobilization & Site Prep', level: 1, budget: '$28M', pctComplete: 100 },
  { id: 'W12', code: '1.2', name: 'Civil & Structural', level: 1, budget: '$190M', pctComplete: 88 },
  { id: 'W13', code: '1.3', name: 'Mechanical', level: 1, budget: '$210M', pctComplete: 52 },
  { id: 'W14', code: '1.4', name: 'Electrical & Instrumentation', level: 1, budget: '$120M', pctComplete: 34 },
  { id: 'W15', code: '1.5', name: 'Commissioning', level: 1, budget: '$96M', pctComplete: 14 },
  { id: 'W16', code: '1.6', name: 'Turnover & Closeout', level: 1, budget: '$36M', pctComplete: 2 },
]
export const baselineRows: BaselineRow[] = [
  { id: 'A1200', activity: 'Structural Steel Erection', baselineFinish: '2024-07-31', currentFinish: '2024-08-15', varianceDays: 15, status: 'Slipping' },
  { id: 'A1300', activity: 'Mechanical Equipment Set', baselineFinish: '2024-10-15', currentFinish: '2024-10-31', varianceDays: 16, status: 'Slipping' },
  { id: 'A1400', activity: 'E&I Installation', baselineFinish: '2024-11-15', currentFinish: '2024-11-30', varianceDays: 15, status: 'Slipping' },
  { id: 'A1500', activity: 'Pre-Commissioning', baselineFinish: '2024-11-20', currentFinish: '2024-11-15', varianceDays: -5, status: 'Recovered' },
  { id: 'A1700', activity: 'Turnover / RFSU', baselineFinish: '2025-01-10', currentFinish: '2025-01-20', varianceDays: 10, status: 'Slipping' },
]
export const resourceLoad: ResourceLoad[] = [
  { month: 'Jul', planned: 320, actual: 305, capacity: 360 },
  { month: 'Aug', planned: 380, actual: 372, capacity: 400 },
  { month: 'Sep', planned: 420, actual: 398, capacity: 420 },
  { month: 'Oct', planned: 410, actual: 0, capacity: 420 },
  { month: 'Nov', planned: 360, actual: 0, capacity: 420 },
  { month: 'Dec', planned: 240, actual: 0, capacity: 420 },
]

// ── Risk ─────────────────────────────────────────────────────────────────────
export const riskEntries: RiskEntry[] = [
  { id: 'RK-01', title: 'Long-lead turbine delivery slip', category: 'Schedule', probability: 4, impact: 5, severity: 'Critical', owner: 'R. Okoye', status: 'Mitigating', response: 'Mitigate' },
  { id: 'RK-02', title: 'Welder availability shortfall (Q3)', category: 'Resource', probability: 3, impact: 3, severity: 'Medium', owner: 'J. Martinez', status: 'Open', response: 'Mitigate' },
  { id: 'RK-03', title: 'Flare-stack permit amendment delay', category: 'Regulatory', probability: 2, impact: 4, severity: 'High', owner: 'A. Sterling', status: 'Open', response: 'Transfer' },
  { id: 'RK-04', title: 'FX exposure on EU equipment', category: 'Financial', probability: 3, impact: 2, severity: 'Medium', owner: 'Finance', status: 'Open', response: 'Accept' },
  { id: 'RK-05', title: 'Hurricane-season weather window', category: 'External', probability: 4, impact: 3, severity: 'High', owner: 'HSE', status: 'Mitigating', response: 'Mitigate' },
  { id: 'RK-06', title: 'MV switchgear quality defects', category: 'Quality', probability: 2, impact: 2, severity: 'Low', owner: 'S. Pena', status: 'Closed', response: 'Mitigate' },
]
export const contingencyItems: ContingencyItem[] = [
  { id: 'CN-01', name: 'Schedule contingency (float buy-back)', allocated: '$8.0M', drawn: '$3.2M', remaining: '$4.8M', status: 'Healthy' },
  { id: 'CN-02', name: 'Procurement risk reserve', allocated: '$6.0M', drawn: '$4.9M', remaining: '$1.1M', status: 'Watch' },
  { id: 'CN-03', name: 'Weather / force majeure', allocated: '$3.0M', drawn: '$0.4M', remaining: '$2.6M', status: 'Healthy' },
  { id: 'CN-04', name: 'Scope-change allowance', allocated: '$5.0M', drawn: '$5.0M', remaining: '$0.0M', status: 'Depleted' },
]

// ── Maintenance / Asset lifecycle ────────────────────────────────────────────
export const maintenanceTasks: MaintenanceTask[] = [
  { id: 'MT-9001', asset: 'HVAC-CH-001 Chiller A', type: 'Preventive', due: '2024-07-01', status: 'Scheduled', assignedTo: 'O&M Team', priority: 'Medium' },
  { id: 'MT-9002', asset: 'ELEC-SG-200 Switchgear', type: 'Corrective', due: '2024-06-19', status: 'Overdue', assignedTo: 'SparkElec', priority: 'High' },
  { id: 'MT-9003', asset: 'PUMP-110 Cooling Pump', type: 'Predictive', due: '2024-07-10', status: 'Scheduled', assignedTo: 'O&M Team', priority: 'Low' },
  { id: 'MT-9004', asset: 'CTRL-DCS-300 Controller', type: 'Preventive', due: '2024-06-25', status: 'In Progress', assignedTo: 'CtrlSys', priority: 'Medium' },
]
export const assetRecords: AssetRecord[] = [
  { id: 'AS-001', tag: 'HVAC-CH-001', name: 'Centrifugal Chiller A', category: 'Mechanical', installed: '2024-03-10', condition: 'Good', nextService: '2024-09-10', criticality: 'High' },
  { id: 'AS-002', tag: 'ELEC-SG-200', name: 'MV Switchgear', category: 'Electrical', installed: '2024-04-22', condition: 'Fair', nextService: '2024-08-22', criticality: 'High' },
  { id: 'AS-003', tag: 'PUMP-110', name: 'Cooling Water Pump', category: 'Rotating', installed: '2024-05-01', condition: 'Good', nextService: '2024-11-01', criticality: 'Medium' },
  { id: 'AS-004', tag: 'CTRL-DCS-300', name: 'DCS Controller Rack', category: 'Controls', installed: '2024-05-15', condition: 'Good', nextService: '2025-05-15', criticality: 'High' },
]
export const lifecycleRows: LifecycleRow[] = [
  { id: 'LC-1', component: 'Chiller compressor', ageYears: 0.3, expectedLifeYears: 20, remainingPct: 98, replaceYear: 2044, risk: 'Low' },
  { id: 'LC-2', component: 'Switchgear breakers', ageYears: 0.2, expectedLifeYears: 25, remainingPct: 99, replaceYear: 2049, risk: 'Low' },
  { id: 'LC-3', component: 'Pump mechanical seals', ageYears: 0.1, expectedLifeYears: 4, remainingPct: 70, replaceYear: 2028, risk: 'Medium' },
  { id: 'LC-4', component: 'DCS I/O modules', ageYears: 0.1, expectedLifeYears: 10, remainingPct: 95, replaceYear: 2034, risk: 'Low' },
]

// ── Vendor performance ───────────────────────────────────────────────────────
export const vendorScores: VendorScore[] = [
  { id: 'V1', name: 'Siemens Energy', tier: 'Strategic', onTimePct: 82, qualityPct: 94, leadTimeDays: 280, spend: '$48.2M', status: 'Attention' },
  { id: 'V2', name: 'Sulzer', tier: 'Preferred', onTimePct: 94, qualityPct: 97, leadTimeDays: 190, spend: '$6.4M', status: 'Optimized' },
  { id: 'V3', name: 'GE Power', tier: 'Strategic', onTimePct: 88, qualityPct: 91, leadTimeDays: 240, spend: '$3.1M', status: 'Optimized' },
  { id: 'V4', name: 'Flowserve', tier: 'Approved', onTimePct: 96, qualityPct: 98, leadTimeDays: 120, spend: '$2.2M', status: 'Optimized' },
  { id: 'V5', name: 'SparkElec', tier: 'Watchlist', onTimePct: 61, qualityPct: 74, leadTimeDays: 95, spend: '$48M', status: 'Blocking' },
]

// ── Scenario modeler ─────────────────────────────────────────────────────────
export const scenarios: Scenario[] = [
  { id: 'SC-01', name: 'Dual-source turbine lot', description: 'Split turbine award to a second OEM to de-risk the Dec ETA.', costImpact: '+$2.1M', scheduleImpactDays: -21, riskLevel: 'Medium', recommendation: 'Recommended — recovers 3 weeks of float for ~3.5% premium.', status: 'Recommended' },
  { id: 'SC-02', name: 'Add 2nd loop-check crew', description: 'Surge electrical commissioning labor for 3 weeks.', costImpact: '+$0.4M', scheduleImpactDays: -9, riskLevel: 'Low', recommendation: 'Recommended — closes the IST sequencing gap.', status: 'Recommended' },
  { id: 'SC-03', name: 'Defer non-critical civil scope', description: 'Push landscaping & site finishing past RFSU.', costImpact: '-$1.2M', scheduleImpactDays: 0, riskLevel: 'Low', recommendation: 'Modeled — no schedule benefit on the critical path.', status: 'Modeled' },
  { id: 'SC-04', name: 'Accept supplier B (lower QA)', description: 'Switch valves to a cheaper vendor with 74% quality score.', costImpact: '-$0.9M', scheduleImpactDays: 7, riskLevel: 'High', recommendation: 'Rejected — quality risk outweighs savings.', status: 'Rejected' },
]

// ── Contract compliance ──────────────────────────────────────────────────────
export const complianceItems: ComplianceItem[] = [
  { id: 'CMP-01', contractId: 'CTR-001', clause: '§7.2 Liquidated Damages', requirement: 'RFSU by 2024-11-15 or $50k/day LDs', status: 'At Risk', owner: 'A. Sterling', due: '2024-11-15' },
  { id: 'CMP-02', contractId: 'CTR-001', clause: '§12.4 Insurance', requirement: 'Maintain $100M CGL coverage', status: 'Compliant', owner: 'Legal', due: '2024-12-31' },
  { id: 'CMP-03', contractId: 'CTR-014', clause: '§5.1 Local Content', requirement: '40% local labor minimum', status: 'Compliant', owner: 'J. Martinez', due: '2024-09-30' },
  { id: 'CMP-04', contractId: 'CTR-021', clause: '§9.3 Bonding', requirement: 'Performance bond 10% of value', status: 'Breach', owner: 'SparkElec', due: '2024-06-01' },
  { id: 'CMP-05', contractId: 'CTR-001', clause: '§3.6 Reporting', requirement: 'Monthly progress report by 5th', status: 'Compliant', owner: 'PMO', due: '2024-07-05' },
]

// ── Contracts ────────────────────────────────────────────────────────────────
export const contracts: Contract[] = [
  { id: 'CTR-001', title: 'EPC Prime — Gulf Coast LNG', counterparty: 'Cheniere', type: 'Lump Sum', value: '$680M', status: 'Executed', executed: '2023-11-02' },
  { id: 'CTR-014', title: 'Civil Works Subcontract', counterparty: 'BuildRight Civil', type: 'Unit Rate', value: '$92M', status: 'Executed', executed: '2024-01-18' },
  { id: 'CTR-021', title: 'MV Electrical Subcontract', counterparty: 'SparkElec', type: 'Lump Sum', value: '$48M', status: 'In Negotiation', executed: '—' },
  { id: 'CTR-030', title: 'Commissioning Services', counterparty: 'CxPro', type: 'T&M', value: '$14M', status: 'Draft', executed: '—' },
]
export const changeOrders: ChangeOrder[] = [
  { id: 'CO-101', contractId: 'CTR-001', description: 'Added flare stack scope', value: '+$4.2M', status: 'Approved' },
  { id: 'CO-102', contractId: 'CTR-014', description: 'Rock excavation variance', value: '+$1.8M', status: 'Pending' },
  { id: 'CO-103', contractId: 'CTR-001', description: 'Owner-directed schedule accel.', value: '+$6.5M', status: 'In Review' },
  { id: 'CO-104', contractId: 'CTR-021', description: 'Cable routing redesign', value: '-$0.6M', status: 'Pending' },
]

// ── Administration ───────────────────────────────────────────────────────────
export const adminUsers: AdminUser[] = [
  { id: 'U1', name: 'Alex Sterling', email: 'asterling@denver.eng', role: 'Program Director', status: 'Active', lastActive: '2m ago' },
  { id: 'U2', name: 'Jordan Martinez', email: 'jmartinez@denver.eng', role: 'Construction Manager', status: 'Active', lastActive: '1h ago' },
  { id: 'U3', name: 'Rita Okoye', email: 'rokoye@denver.eng', role: 'Procurement Lead', status: 'Active', lastActive: '3h ago' },
  { id: 'U4', name: 'Sam Pena', email: 'spena@denver.eng', role: 'Commissioning Manager', status: 'Active', lastActive: 'Yesterday' },
  { id: 'U5', name: 'Contractor Portal', email: 'svc-portal@denver.eng', role: 'External (Read-only)', status: 'Suspended', lastActive: '2 weeks ago' },
]
export const featureGates: FeatureGate[] = [
  { key: 'ai_copilot', label: 'AI Copilot (grounded RAG)', enabled: true, rollout: '100%' },
  { key: 'digital_twin', label: 'Digital Twin live telemetry', enabled: true, rollout: '25% (beta)' },
  { key: 'ist_orchestration', label: 'IST Orchestration', enabled: true, rollout: '100%' },
  { key: 'scada_bms', label: 'SCADA/BMS integration', enabled: false, rollout: 'Off' },
  { key: 'mobile_field', label: 'Mobile field execution', enabled: false, rollout: 'Off' },
]

// ── CRM ───────────────────────────────────────────────────────────────────
export const leads: Lead[] = [
  { id: 'L-501', name: 'Red Sea Desalination', client: 'ACWA Power', estValue: '$540M', probability: 38, owner: 'A. Sterling', stage: 'Tendering' },
  { id: 'L-502', name: 'Texas Hydrogen Hub', client: 'Air Liquide', estValue: '$420M', probability: 55, owner: 'M. Cho', stage: 'Negotiation' },
  { id: 'L-503', name: 'Jakarta Metro Power', client: 'PLN', estValue: '$180M', probability: 22, owner: 'M. Cho', stage: 'Qualification' },
  { id: 'L-504', name: 'Alberta Carbon Capture', client: 'Suncor', estValue: '$95M', probability: 90, owner: 'A. Sterling', stage: 'Awarded' },
]
export const crmFunnel = [
  { stage: 'Qualification', count: 28, value: '$540M' },
  { stage: 'Tendering', count: 12, value: '$420M' },
  { stage: 'Negotiation', count: 5, value: '$180M' },
  { stage: 'Awarded', count: 3, value: '$95M' },
]

// ── Procurement ─────────────────────────────────────────────────────────────
export const purchaseOrders: PurchaseOrder[] = [
  { id: 'PO-4510-14', vendor: 'Siemens Energy', description: 'Gas Turbine Generators (2x)', value: '$48.2M', status: 'Delayed', expediting: 'Critical' },
  { id: 'PO-4511-02', vendor: 'Sulzer', description: 'API 610 Pumps (12x)', value: '$6.4M', status: 'Approved', expediting: 'On Track' },
  { id: 'PO-4512-09', vendor: 'GE Power', description: 'MV Switchgear Lineup', value: '$3.1M', status: 'Pending', expediting: 'In Fab' },
  { id: 'PO-4513-21', vendor: 'Flowserve', description: 'Control Valves (220x)', value: '$2.2M', status: 'Approved', expediting: 'Dispatched' },
]
export const longLead: LongLeadItem[] = [
  { id: 'LL-1', name: 'Gas Turbine Generators', ordered: '2024-01-15', eta: '2024-12-01', progressPct: 65, status: 'On Track' },
  { id: 'LL-2', name: 'Pressure Vessels', ordered: '2024-02-10', eta: '2024-09-20', progressPct: 88, status: 'On Track' },
  { id: 'LL-3', name: 'API 610 Pumps', ordered: '2024-03-01', eta: '2025-01-15', progressPct: 32, status: 'Delayed' },
]
export const vendors: Vendor[] = [
  { id: 'V1', name: 'Siemens', avgLeadTimeDays: 280, onTimePct: 82 },
  { id: 'V2', name: 'Sulzer', avgLeadTimeDays: 190, onTimePct: 94 },
  { id: 'V3', name: 'GE Power', avgLeadTimeDays: 240, onTimePct: 88 },
  { id: 'V4', name: 'Flowserve', avgLeadTimeDays: 120, onTimePct: 96 },
]

// ── Finance / EVM ────────────────────────────────────────────────────────────
export const evmSummary: EvmSummary = {
  pv: '$4.28M',
  ev: '$3.92M',
  ac: '$4.15M',
  cpi: 0.94,
  spi: 0.92,
  eac: '$12.45M',
  etc: '$8.53M',
  vac: '-$1.42M',
}
export const evmTrend: EvmTrendPoint[] = [
  { month: 'Jan', pv: 0.6, ev: 0.55, ac: 0.6 },
  { month: 'Feb', pv: 1.3, ev: 1.2, ac: 1.35 },
  { month: 'Mar', pv: 2.0, ev: 1.85, ac: 2.05 },
  { month: 'Apr', pv: 2.7, ev: 2.5, ac: 2.75 },
  { month: 'May', pv: 3.5, ev: 3.2, ac: 3.5 },
  { month: 'Jun', pv: 4.28, ev: 3.92, ac: 4.15 },
]
export const wbsLines: WbsLine[] = [
  { id: 'WBS-100', discipline: 'Civil / Structural', bac: '$3.10M', ev: '$2.95M', ac: '$3.05M', cpi: 0.97, spi: 0.95, status: 'Healthy' },
  { id: 'WBS-200', discipline: 'Mechanical', bac: '$4.20M', ev: '$3.80M', ac: '$4.10M', cpi: 0.93, spi: 0.91, status: 'Critical' },
  { id: 'WBS-300', discipline: 'Electrical', bac: '$2.80M', ev: '$2.60M', ac: '$2.55M', cpi: 1.02, spi: 0.98, status: 'Healthy' },
  { id: 'WBS-400', discipline: 'I&C', bac: '$1.90M', ev: '$1.20M', ac: '$1.35M', cpi: 0.89, spi: 0.84, status: 'Critical' },
]

// ── Engineering / Documents / Actions ────────────────────────────────────────
export const drawings: DrawingRecord[] = [
  { id: 'DWG-P-201', title: 'P&ID Process Area 200', discipline: 'Process', rev: 'C', status: 'Approved', reviewer: 'A. Sterling', due: '2024-06-01' },
  { id: 'DWG-E-340', title: 'Electrical Single Line Diagram', discipline: 'Electrical', rev: 'B', status: 'In Review', reviewer: 'S. Pena', due: '2024-06-18' },
  { id: 'RFI-088', title: 'RFI: Pipe rack elevation clash', discipline: 'Piping', rev: '-', status: 'Open', reviewer: 'J. Martinez', due: '2024-06-20' },
  { id: 'SUB-112', title: 'Submittal: Valve datasheets', discipline: 'Mechanical', rev: 'A', status: 'In Review', reviewer: 'R. Okoye', due: '2024-06-22' },
]
export const documents: DocumentRecord[] = [
  { id: 'DOC-9001', title: 'Project Execution Plan', type: 'Plan', rev: '4', status: 'Approved', owner: 'A. Sterling', updated: '2024-05-30' },
  { id: 'DOC-9120', title: 'Commissioning Strategy', type: 'Procedure', rev: '2', status: 'Approved', owner: 'S. Pena', updated: '2024-06-04' },
  { id: 'DOC-9210', title: 'HAZOP Report — Rev B', type: 'Report', rev: 'B', status: 'In Review', owner: 'HSE', updated: '2024-06-12' },
  { id: 'TRN-441', title: 'Transmittal to Client — IFC pkg', type: 'Transmittal', rev: '-', status: 'Issued', owner: 'Doc Control', updated: '2024-06-15' },
]
export const actions: ActionItem[] = [
  { id: 'ACT-201', title: 'Verify alternative turbine vendor', priority: 'Critical', assignee: 'R. Okoye', due: '2024-06-21', status: 'Open', source: 'AI Insight AI-1' },
  { id: 'ACT-202', title: 'Add electrical loop-check crew', priority: 'High', assignee: 'J. Martinez', due: '2024-06-24', status: 'In Progress', source: 'AI Insight AI-2' },
  { id: 'ACT-203', title: 'Close DEF-4821 calibration', priority: 'High', assignee: 'MechCo', due: '2024-06-19', status: 'Open', source: 'Deficiency' },
  { id: 'ACT-204', title: 'Submit flare permit amendment', priority: 'Medium', assignee: 'A. Sterling', due: '2024-06-30', status: 'Open', source: 'Risk R-031' },
]
