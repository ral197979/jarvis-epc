/**
 * Denver Engineering — Commissioning Rules Engine
 * ─────────────────────────────────────────
 * Ported and extended from the DenverEngineering MVP.
 *
 * Pure functions — no React, no store, no side effects.
 * All logic runs client-side; results dispatched to Zustand store.
 *
 * Asset coverage (21 types):
 *   pump, ahu, chiller, ro skid, panel, valve, fan, motor,
 *   generator, vfd, plc, boiler,
 *   blower, mixer, dosing skid, clarifier, filter,
 *   uv system, chlorination system, lift station, instrument
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CxPhase =
  | 'pre_commissioning'
  | 'pre_functional'
  | 'functional_performance'
  | 'turnover'

export type PackStatus = 'draft' | 'issued' | 'in_progress' | 'completed' | 'failed'
export type MatrixStatus = 'not_started' | 'in_progress' | 'complete' | 'failed'
export type DefStatus = 'open' | 'assigned' | 'in_progress' | 'ready_for_retest' | 'closed'
export type DefSeverity = 'low' | 'medium' | 'high' | 'critical'
export type TurnoverStatus = 'missing' | 'submitted' | 'approved' | 'rejected'
export type StepResult = 'pass' | 'fail' | 'na' | 'blocked'

export interface CxAsset {
  id: string
  systemId: string
  tag: string
  type: string
  description?: string
}

export interface CxMatrixRow {
  id: string
  systemId: string
  assetId: string
  assetTag: string
  assetType: string
  phase: CxPhase
  testName: string
  responsibleParty: string[]
  evidenceRequirements: string[]
  status: MatrixStatus
}

export interface CxPackStep {
  id: string
  stepNo: string
  action: string
  expectedResult: string
}

export interface CxPack {
  id: string
  matrixRowId: string
  assetId: string
  assetTag: string
  title: string
  phase: CxPhase
  revision: string
  status: PackStatus
  prerequisites: string[]
  steps: CxPackStep[]
}

export interface CxStepResult {
  stepId: string
  passFail: StepResult
  comments?: string
  actualResult?: string
}

export interface CxExecution {
  id: string
  packId: string
  stepResults: CxStepResult[]
  status: 'not_started' | 'in_progress' | 'completed' | 'failed'
  createdAt: string
  updatedAt: string
}

export interface CxDeficiency {
  id: string
  packId: string
  title: string
  description: string
  severity: DefSeverity
  status: DefStatus
  assignedTo?: string
  createdAt: string
}

export interface CxRetest {
  id: string
  deficiencyId: string
  originalPackId: string
  status: 'queued' | 'issued' | 'completed'
  createdAt: string
}

export interface CxTurnoverItem {
  id: string
  systemId?: string
  category: string
  title: string
  status: TurnoverStatus
  comments?: string
  createdAt: string
}

export interface CxScopeResult {
  id: string
  documentId: string
  summary: string
  classifications: string[]
  affectedSystems: string[]
  confidence: number
  createdAt: string
}

// ─── Asset Rules ──────────────────────────────────────────────────────────────

interface AssetRule {
  phases: CxPhase[]
  tests: Record<CxPhase, string[]>
  defaultPrereqs: string[]
}

const ASSET_RULES: Record<string, AssetRule> = {
  pump: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Installation verification', 'Rotation check', 'Motor insulation resistance', 'Coupling alignment check'],
      pre_functional:         ['HOA verification', 'Run status feedback check', 'Flow switch verification'],
      functional_performance: ['Startup and flow verification', 'Alarm response verification', 'Pressure performance test'],
      turnover:               ['O&M manual delivered', 'Spare parts kit confirmed'],
    },
    defaultPrereqs: ['Piping complete and flushed', 'Motor power confirmed', 'Applicable P&IDs available'],
  },
  ahu: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Mechanical installation verification', 'Coil piping verification', 'Damper installation check'],
      pre_functional:         ['Sensor calibration', 'Valve stroke verification', 'Fan rotation verification', 'Belt tension check'],
      functional_performance: ['Occupied/unoccupied sequence', 'Alarm and freeze stat verification', 'Supply air temperature control'],
      turnover:               ['Training and O&M delivery', 'Filter schedule confirmed'],
    },
    defaultPrereqs: ['Ductwork connected and balanced', 'BAS wiring complete'],
  },
  chiller: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Piping and power completion', 'Refrigerant charge verification', 'Vendor startup readiness'],
      pre_functional:         ['Flow proof and BAS communications', 'Safety interlocks verification', 'Condenser water flow confirmation'],
      functional_performance: ['Startup sequence verification', 'Temperature control verification', 'Trip and alarm response'],
      turnover:               ['Startup report delivery', 'Warranty activation record'],
    },
    defaultPrereqs: ['Condenser water system operational', 'Chilled water system flushed', 'Electrical power confirmed'],
  },
  'ro skid': {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Skid installation check', 'Instrument calibration', 'Membrane installation verification'],
      pre_functional:         ['Power and interlock verification', 'Chemical dosing readiness', 'Pre-filter installation check'],
      functional_performance: ['Flush and startup sequence', 'Permeate/reject ratio verification', 'Conductivity performance test'],
      turnover:               ['Spare parts kit delivery', 'Startup report delivery', 'O&M training record'],
    },
    defaultPrereqs: ['Feed water quality confirmed', 'Chemical dosing system ready', 'Drain connection complete'],
  },
  panel: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Panel installation and labelling verification', 'Wiring audit against drawings'],
      pre_functional:         ['Power-up and point-to-point checks', 'UPS/bypass verification'],
      functional_performance: ['Control sequence verification', 'Alarm annunciation test'],
      turnover:               ['As-built drawings delivered', 'Backup configuration saved'],
    },
    defaultPrereqs: ['Earthing verified', 'Incoming supply confirmed', 'Drawings issued for construction'],
  },
  valve: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Installation and orientation check', 'Manual operation test'],
      pre_functional:         ['Actuator stroke verification', 'Feedback signal check'],
      functional_performance: ['BAS control sequence verification', 'Leak-off test'],
      turnover:               ['As-installed documentation'],
    },
    defaultPrereqs: ['Pipe system flushed', 'Actuator powered and wired'],
  },
  fan: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Installation verification', 'Belt and pulley check', 'Motor rotation check'],
      pre_functional:         ['VFD parameter verification', 'HOA control verification'],
      functional_performance: ['Airflow measurement', 'Static pressure test', 'VFD speed control sequence'],
      turnover:               ['Filter schedule confirmed', 'O&M delivery'],
    },
    defaultPrereqs: ['Ductwork connected', 'Electrical power confirmed'],
  },
  motor: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Insulation resistance test (MΩ)', 'Mechanical installation check', 'Rotation check'],
      pre_functional:         ['Starter/VFD verification', 'Current draw measurement'],
      functional_performance: ['Load test at rated speed', 'Thermal overload verification'],
      turnover:               ['Test report delivered'],
    },
    defaultPrereqs: ['Mechanical load connected', 'Power supply confirmed'],
  },
  generator: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Installation and earthing check', 'Fuel system verification', 'Coolant level check'],
      pre_functional:         ['Battery and starting system check', 'Governor and AVR verification'],
      functional_performance: ['Load bank test', 'ATS transfer test', 'Run-hours log initialisation'],
      turnover:               ['Warranty and startup report delivery', 'Fuel contract confirmed'],
    },
    defaultPrereqs: ['Exhaust connected', 'Fuel tank filled', 'ATS wired'],
  },
  vfd: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Installation and wiring verification', 'Parameter upload from commissioning sheet'],
      pre_functional:         ['Local control test', 'BAS analogue/digital signal test'],
      functional_performance: ['Speed ramp test', 'PID loop verification'],
      turnover:               ['Parameter backup delivered'],
    },
    defaultPrereqs: ['Motor connected', 'Power supply confirmed', 'BAS wiring complete'],
  },
  plc: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Rack and wiring audit', 'Power supply verification'],
      pre_functional:         ['I/O point-to-point checks', 'Network communications test'],
      functional_performance: ['Control logic sequence verification', 'Alarm handling test'],
      turnover:               ['Program backup delivered', 'Logic documentation issued'],
    },
    defaultPrereqs: ['Field instruments wired', 'Comms network connected'],
  },
  boiler: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Installation and pipework check', 'Fuel supply verification', 'Flue connection check'],
      pre_functional:         ['Safety valve and pressure relief check', 'Burner management system check'],
      functional_performance: ['Ignition and flame proving test', 'Temperature control sequence', 'Low-water cutoff test'],
      turnover:               ['Combustion analysis report', 'O&M and warranty delivery'],
    },
    defaultPrereqs: ['Gas or fuel supply confirmed', 'Flue connected', 'Water treatment in service'],
  },
  blower: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Installation and mounting verification', 'Rotation check', 'Belt and coupling alignment'],
      pre_functional:         ['VFD parameter verification', 'Pressure relief valve check', 'Vibration baseline reading'],
      functional_performance: ['Airflow and pressure measurement', 'DO setpoint response test', 'Surge detection verification'],
      turnover:               ['Startup report delivery', 'Lubrication schedule confirmed'],
    },
    defaultPrereqs: ['Piping connected and pressure tested', 'Motor power confirmed', 'Cooling water available'],
  },
  mixer: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Installation and seal verification', 'Rotation and impeller clearance check', 'Motor insulation resistance'],
      pre_functional:         ['HOA control verification', 'Run status feedback check', 'Gearbox oil level verification'],
      functional_performance: ['Mixing performance test at operating level', 'Alarm response verification', 'Torque and current draw check'],
      turnover:               ['O&M manual delivered', 'Spare parts kit confirmed'],
    },
    defaultPrereqs: ['Tank structurally complete', 'Motor power confirmed', 'Seal flush system ready'],
  },
  'dosing skid': {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Skid installation check', 'Chemical compatibility verification', 'Calibration cylinder installation'],
      pre_functional:         ['Pump priming and leak check', 'Flow meter calibration', 'Interlock verification with receiving process'],
      functional_performance: ['Dosing rate accuracy test', 'Low-level and spill alarm test', 'Automatic control loop verification'],
      turnover:               ['Calibration certificates delivered', 'Spare parts kit confirmed', 'MSDS and handling training record'],
    },
    defaultPrereqs: ['Containment bund complete', 'Chemical feed piping pressure tested', 'Eyewash/safety shower commissioned'],
  },
  clarifier: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Mechanism installation and level verification', 'Drive motor rotation check', 'Weir and baffle alignment'],
      pre_functional:         ['Drive torque and overload verification', 'Scraper and skimmer travel check', 'Sludge draw-off valve stroke'],
      functional_performance: ['Full-speed operational run', 'Sludge blanket and TSS performance test', 'Overload trip verification'],
      turnover:               ['O&M manual delivered', 'Mechanism warranty record'],
    },
    defaultPrereqs: ['Tank filled and leak-tested', 'Influent and effluent piping complete', 'Sludge removal line operational'],
  },
  filter: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Media installation and grading verification', 'Underdrain and nozzle inspection', 'Valve and piping verification'],
      pre_functional:         ['Backwash sequence dry run', 'Differential pressure instrument calibration', 'Air scour verification (if fitted)'],
      functional_performance: ['Filtration run to terminal headloss', 'Backwash performance and recovery test', 'Effluent quality verification'],
      turnover:               ['O&M manual delivered', 'Media certificate delivered'],
    },
    defaultPrereqs: ['Media loaded and washed', 'Backwash supply available', 'Effluent disposal route confirmed'],
  },
  'uv system': {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Reactor installation check', 'Lamp installation and safety interlock verification', 'Quartz sleeve cleanliness check'],
      pre_functional:         ['UV intensity sensor calibration', 'Low-UV and lamp-fail alarm test', 'Ballast and lamp ignition test'],
      functional_performance: ['Dose validation at design flow', 'Wiper/cleaning cycle verification', 'Flow-paced control verification'],
      turnover:               ['Validation report delivered', 'Spare lamp and sleeve stock confirmed'],
    },
    defaultPrereqs: ['Upstream filtration operational', 'Power supply confirmed', 'Effluent flow stable'],
  },
  'chlorination system': {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Gas/liquid feed installation verification', 'Leak detection and scrubber check', 'PPE and safety signage in place'],
      pre_functional:         ['Residual analyzer calibration', 'Leak detector and alarm test', 'Emergency shutdown interlock test'],
      functional_performance: ['Residual setpoint control test', 'Flow-paced dosing verification', 'CT compliance verification'],
      turnover:               ['Operator training record', 'Emergency response drill record', 'Supply contract confirmed'],
    },
    defaultPrereqs: ['Contact tank filled', 'Ventilation and scrubber operational', 'Safety shower commissioned'],
  },
  'lift station': {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Wet well inspection and level sensor installation', 'Pump installation and guide-rail alignment', 'Valve and piping check'],
      pre_functional:         ['Level sensor calibration', 'Duty/standby alternation logic test', 'High-level and dry-run alarm test'],
      functional_performance: ['Pump-down test at duty flow', 'Telemetry and SCADA integration verification', 'Power failure and restart sequence'],
      turnover:               ['O&M manual delivered', 'SCADA point list and alarm register handover'],
    },
    defaultPrereqs: ['Wet well cleaned and filled', 'Force main pressure tested', 'Standby power confirmed'],
  },
  instrument: {
    phases: ['pre_commissioning', 'pre_functional', 'functional_performance', 'turnover'],
    tests: {
      pre_commissioning:      ['Installation and tag verification against loop drawing', 'Wiring termination and shield check'],
      pre_functional:         ['Bench/field calibration against certified standard', 'Loop check to DCS/PLC (4-20 mA or digital)'],
      functional_performance: ['Process response verification under operating conditions', 'Alarm and trip setpoint verification'],
      turnover:               ['Calibration certificate delivered', 'As-installed loop drawing issued'],
    },
    defaultPrereqs: ['Process tapping complete', 'Loop wiring terminated', 'DCS/PLC tag configured'],
  },
}

// ─── Key inference ────────────────────────────────────────────────────────────

function inferAssetKey(type: string): string {
  const v = type.toLowerCase()
  // More-specific water/wastewater types first so they don't collapse into pump/fan
  if (v.includes('lift station') || v.includes('lift-station'))               return 'lift station'
  if (v.includes('clarifier') || v.includes('settler'))                       return 'clarifier'
  if (v.includes('uv') && (v.includes('system') || v.includes('reactor') || v.includes('disinfect'))) return 'uv system'
  if (v.includes('chlorin') || v.includes('hypochlorite'))                    return 'chlorination system'
  if (v.includes('dosing') || v.includes('chem feed') || v.includes('chemical feed')) return 'dosing skid'
  if (v.includes('mixer') || v.includes('agitator') || v.includes('flocculator')) return 'mixer'
  if (v.includes('blower'))                                                    return 'blower'
  if (v.includes('filter') && !v.includes('pre-filter') && !v.includes('prefilter')) return 'filter'
  if (v.includes('analyzer') || v.includes('analyser') || v.includes('transmitter') || v.includes('instrument') || v.includes('sensor')) return 'instrument'
  // General mechanical / electrical
  if (v.includes('pump'))                                  return 'pump'
  if (v.includes('ahu') || v.includes('air handling'))     return 'ahu'
  if (v.includes('chiller'))                               return 'chiller'
  if (v.includes('ro') || v.includes('reverse osmosis'))   return 'ro skid'
  if (v.includes('panel') || v.includes('mcc') || v.includes('switchboard')) return 'panel'
  if (v.includes('valve') || v.includes('actuator'))       return 'valve'
  if (v.includes('fan'))                                   return 'fan'
  if (v.includes('motor') && !v.includes('vfd'))           return 'motor'
  if (v.includes('generator') || v.includes('genset'))     return 'generator'
  if (v.includes('vfd') || v.includes('drive') || v.includes('inverter')) return 'vfd'
  if (v.includes('plc') || v.includes('controller') || v.includes('bms')) return 'plc'
  if (v.includes('boiler'))                                return 'boiler'
  return 'pump' // fallback
}

// ─── Scope analyser ───────────────────────────────────────────────────────────

export function analyzeScope(documentId: string, content: string): CxScopeResult {
  const text = content.toLowerCase()

  const classifications: string[] = []
  if (text.includes('existing') || text.includes('replace'))        classifications.push('Brownfield')
  if (text.includes('new facility') || text.includes('greenfield')) classifications.push('Greenfield')
  if (text.includes('remove and replace') || text.includes('full replacement')) classifications.push('Full System Replacement')
  if (text.includes('upgrade'))                                      classifications.push('Major Upgrade')
  if (text.includes('retrofit'))                                     classifications.push('Retrofit')
  if (text.includes('rehabilitat'))                                  classifications.push('Rehabilitation')
  if (text.includes('extend') || text.includes('expansion'))        classifications.push('Expansion')
  if (classifications.length === 0)                                   classifications.push('Major Upgrade')

  const SYSTEM_KEYWORDS: [string, string][] = [
    ['ro', 'RO Water Treatment'],
    ['chiller', 'Chiller Plant'],
    ['ahu', 'AHU System'],
    ['hvac', 'HVAC'],
    ['panel', 'Electrical Controls'],
    ['pump', 'Pumping System'],
    ['generator', 'Power Generation'],
    ['boiler', 'Heating System'],
    ['vfd', 'Variable Speed Drives'],
    ['plc', 'PLC / BMS Controls'],
    ['valve', 'Valve Control'],
    ['fire', 'Fire Safety System'],
    ['cooling tower', 'Cooling Tower'],
  ]

  const affectedSystems = SYSTEM_KEYWORDS
    .filter(([kw]) => text.includes(kw))
    .map(([, label]) => label)

  const uniqueSystems = [...new Set(affectedSystems)]
  const uniqueClass   = [...new Set(classifications)]

  return {
    id: `scope-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    documentId,
    summary: `Detected ${uniqueClass.join(', ')} from engineering keywords. ${uniqueSystems.length} system type${uniqueSystems.length !== 1 ? 's' : ''} identified.`,
    classifications: uniqueClass,
    affectedSystems: uniqueSystems,
    confidence: uniqueSystems.length >= 2 ? 91 : uniqueSystems.length === 1 ? 78 : 62,
    createdAt: new Date().toISOString(),
  }
}

// ─── Matrix generator ─────────────────────────────────────────────────────────

export function generateMatrixRows(systemId: string, assets: CxAsset[]): CxMatrixRow[] {
  const uid = () => `mrow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  return assets.flatMap(asset => {
    const key  = inferAssetKey(asset.type)
    const rule = ASSET_RULES[key]
    if (!rule) return []

    return rule.phases.flatMap(phase =>
      rule.tests[phase].map(testName => ({
        id:           uid(),
        systemId,
        assetId:      asset.id,
        assetTag:     asset.tag,
        assetType:    asset.type,
        phase,
        testName,
        responsibleParty: [
          'Contractor',
          phase === 'functional_performance' ? 'CxA' : 'Supervisor',
        ],
        evidenceRequirements: phase === 'turnover' ? ['document'] : ['checklist', 'photo'],
        status: 'not_started' as MatrixStatus,
      }))
    )
  })
}

// ─── Pack generator ───────────────────────────────────────────────────────────

export function generatePack(row: CxMatrixRow): CxPack {
  const uid  = () => `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const puid = () => `pack-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  const key  = inferAssetKey(row.assetType)
  const rule = ASSET_RULES[key]

  // Build richer steps based on phase
  const phaseSteps: CxPackStep[] = []

  if (row.phase === 'pre_commissioning') {
    phaseSteps.push(
      { id: uid(), stepNo: '1', action: `Verify ${row.testName} is complete`, expectedResult: `${row.assetTag} ready for pre-commissioning` },
      { id: uid(), stepNo: '2', action: 'Record as-found conditions and measurements', expectedResult: 'Baseline readings documented' },
      { id: uid(), stepNo: '3', action: 'Sign off checklist with site supervisor', expectedResult: 'Sign-off recorded in test pack' },
    )
  } else if (row.phase === 'pre_functional') {
    phaseSteps.push(
      { id: uid(), stepNo: '1', action: `Confirm pre-commissioning complete for ${row.assetTag}`, expectedResult: 'Pre-cx sign-off confirmed' },
      { id: uid(), stepNo: '2', action: `Perform ${row.testName}`, expectedResult: `${row.assetTag} responds as per design` },
      { id: uid(), stepNo: '3', action: 'Record measured values and compare to design', expectedResult: 'Values within acceptance tolerances' },
    )
  } else if (row.phase === 'functional_performance') {
    phaseSteps.push(
      { id: uid(), stepNo: '1', action: `Witness ${row.testName} under operating conditions`, expectedResult: `${row.assetTag} operates to specification` },
      { id: uid(), stepNo: '2', action: 'Verify control sequence and interlocks', expectedResult: 'All sequences confirmed correct' },
      { id: uid(), stepNo: '3', action: 'Record final performance data', expectedResult: 'Performance data within acceptance criteria' },
      { id: uid(), stepNo: '4', action: 'CxA and owner representative sign-off', expectedResult: 'Functional performance accepted' },
    )
  } else {
    phaseSteps.push(
      { id: uid(), stepNo: '1', action: `Confirm ${row.testName} is complete and available`, expectedResult: 'Documentation sighted and accepted' },
      { id: uid(), stepNo: '2', action: 'Log receipt in turnover register', expectedResult: 'Turnover register updated' },
    )
  }

  return {
    id:           puid(),
    matrixRowId:  row.id,
    assetId:      row.assetId,
    assetTag:     row.assetTag,
    title:        `${row.assetTag} — ${row.testName}`,
    phase:        row.phase,
    revision:     'Rev 0',
    status:       'draft',
    prerequisites: rule?.defaultPrereqs ?? ['Asset installed', 'Applicable drawings available'],
    steps:        phaseSteps,
  }
}

// ─── Default turnover items ───────────────────────────────────────────────────

const TURNOVER_DEFAULTS = [
  { title: 'O&M Manual',      category: 'om_manual' },
  { title: 'Startup Report',  category: 'startup_report' },
  { title: 'Test Records',    category: 'test_records' },
  { title: 'Training Record', category: 'training_record' },
  { title: 'Warranty',        category: 'warranty' },
  { title: 'As-Built Drawings', category: 'as_built' },
  { title: 'Spare Parts List', category: 'spare_parts' },
  { title: 'TAB Report',      category: 'tab_report' },
]

export function generateDefaultTurnoverItems(systemId?: string): CxTurnoverItem[] {
  return TURNOVER_DEFAULTS.map(({ title, category }) => ({
    id:         `turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    systemId,
    category,
    title,
    status:     'missing' as TurnoverStatus,
    createdAt:  new Date().toISOString(),
  }))
}

// ─── Execution helpers ────────────────────────────────────────────────────────

export function createExecution(packId: string): CxExecution {
  return {
    id:          `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    packId,
    stepResults: [],
    status:      'in_progress',
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  }
}

export function resolveExecutionStatus(stepResults: CxStepResult[]): CxExecution['status'] {
  if (stepResults.length === 0)           return 'in_progress'
  if (stepResults.some(r => r.passFail === 'fail')) return 'failed'
  return 'completed'
}

// ─── Phase display helpers ────────────────────────────────────────────────────

export const PHASE_LABELS: Record<CxPhase, string> = {
  pre_commissioning:      'Pre-Cx',
  pre_functional:         'Pre-Functional',
  functional_performance: 'Functional Perf.',
  turnover:               'Turnover',
}

export const PHASE_COLOR: Record<CxPhase, string> = {
  pre_commissioning:      'var(--jarvis-td)',
  pre_functional:         'var(--jarvis-blue)',
  functional_performance: 'var(--jarvis-pur)',
  turnover:               'var(--jarvis-grn)',
}

export const ALL_PHASES: CxPhase[] = [
  'pre_commissioning',
  'pre_functional',
  'functional_performance',
  'turnover',
]
