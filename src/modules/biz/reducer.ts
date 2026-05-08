/**
 * Denver Engineering — Business Domain Reducer
 * ──────────────────────────────────────
 * Phase 6: Typed TypeScript extraction of `_domainReducer` from JarvisCore.jsx.
 *
 * This module is the single source of truth for all biz state mutations.
 * It is a pure function — no side effects, no React dependency, no imports
 * from the monolith.
 *
 * Architecture:
 *   JarvisCore.jsx → _dispatch() → bizReducer() → new BizState
 *   Zustand biz store  → dispatch() → bizReducer() → React re-render
 *
 * Collections supported (26 domain collections + company + EVM):
 *   CRM:         leads
 *   Contracts:   contracts
 *   Finance:     invoices, expenses, journal
 *   Procurement: purchase_orders, rfqs, submittals, rfis
 *   Safety:      jhas, incidents, toolbox_talks, permits
 *   Engineering: engineering_deliverables, installation, manpower, feed_studies
 *   Commissioning: cx_phases, cx_issues
 *   Documents:   documents, transmittals
 *   Actions:     action_items, punch_items, lessons, closeouts
 *   EVM:         evm_projects
 *
 * Phase 7 target: Replace inline `Z(function(v) { ... })` patterns in JarvisCore
 * with `_dispatch(JARVIS_ACTIONS.ADD_LEAD, leadData)` calls wired through this reducer.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Generic record — any biz collection item must have an id */
export interface BizRecord {
  id:      string
  [key: string]: unknown
}

/** EVM Project entry with computed metrics */
export interface EVMRecord extends BizRecord {
  project: string
  period:  string
  budget:  number
  ev:      number
  ac:      number
  pv:      number
  cpi:     number
  spi:     number
  eac:     number
  vac:     number
  cv:      number
  sv:      number
}

/** Biz state shape — all domain collections */
export interface BizState {
  company:                  Record<string, unknown>
  projects:                 BizRecord[]
  leads:                    BizRecord[]
  contracts:                BizRecord[]
  invoices:                 BizRecord[]
  expenses:                 BizRecord[]
  journal:                  BizRecord[]
  purchase_orders:          BizRecord[]
  rfqs:                     BizRecord[]
  submittals:               BizRecord[]
  rfis:                     BizRecord[]
  jhas:                     BizRecord[]
  incidents:                BizRecord[]
  toolbox_talks:            BizRecord[]
  permits:                  BizRecord[]
  engineering_deliverables: BizRecord[]
  installation:             BizRecord[]
  manpower:                 BizRecord[]
  feed_studies:             BizRecord[]
  cx_phases:                BizRecord[]
  cx_issues:                BizRecord[]
  documents:                BizRecord[]
  transmittals:             BizRecord[]
  action_items:             BizRecord[]
  punch_items:              BizRecord[]
  lessons:                  BizRecord[]
  closeouts:                BizRecord[]
  vendors:                  BizRecord[]
  customers:                BizRecord[]
  evm_projects:             EVMRecord[]
  notifications:            BizRecord[]
  proposals:                BizRecord[]
  service_tickets:          BizRecord[]
  // ── Commissioning Intelligence (Continuum layer) ──────────────────────────
  ci_assets:                BizRecord[]   // CIAsset — canonical asset registry
  ci_baselines:             BizRecord[]   // CIBaseline — immutable after freeze
  ci_tests:                 BizRecord[]   // CITest — commissioning test records
  ci_setpoints:             BizRecord[]   // CISetpoint — as-tested setpoints
  ci_pm_tasks:              BizRecord[]   // CIPMTask — provenance-declared PM
  ci_change_events:         BizRecord[]   // CIChangeEvent — append-only drift log
  ci_evidence:              BizRecord[]   // CIEvidence — write-once, hashed
  [key: string]:            unknown
}

/** Empty/default biz state */
export function emptyBizState(): BizState {
  return {
    company:                  {},
    projects:                 [],
    leads:                    [],
    contracts:                [],
    invoices:                 [],
    expenses:                 [],
    journal:                  [],
    purchase_orders:          [],
    rfqs:                     [],
    submittals:               [],
    rfis:                     [],
    jhas:                     [],
    incidents:                [],
    toolbox_talks:            [],
    permits:                  [],
    engineering_deliverables: [],
    installation:             [],
    manpower:                 [],
    feed_studies:             [],
    cx_phases:                [],
    cx_issues:                [],
    documents:                [],
    transmittals:             [],
    action_items:             [],
    punch_items:              [],
    lessons:                  [],
    closeouts:                [],
    vendors:                  [],
    customers:                [],
    evm_projects:             [],
    notifications:            [],
    proposals:                [],
    service_tickets:          [],
    // ── Commissioning Intelligence ─────────────────────────────────────────
    ci_assets:                [],
    ci_baselines:             [],
    ci_tests:                 [],
    ci_setpoints:             [],
    ci_pm_tasks:              [],
    ci_change_events:         [],
    ci_evidence:              [],
  }
}

/** Domain action types */
export type ActionType =
  // CRM
  | 'crm/add_lead'          | 'crm/update_lead'          | 'crm/delete_lead'
  | 'crm/add_vendor'        | 'crm/update_vendor'        | 'crm/delete_vendor'
  | 'crm/add_customer'      | 'crm/update_customer'      | 'crm/delete_customer'
  // Contracts
  | 'contracts/add_contract' | 'contracts/update_contract'
  // Finance
  | 'finance/add_invoice'    | 'finance/update_invoice'   | 'finance/record_payment'
  | 'finance/add_expense'    | 'finance/add_journal'
  // Procurement
  | 'procurement/add_po'     | 'procurement/update_po'  | 'procurement/delete_po'
  | 'procurement/add_rfq'    | 'procurement/update_rfq'
  | 'procurement/add_submittal' | 'procurement/add_rfi'
  // Safety
  | 'safety/add_jha'         | 'safety/add_incident'
  | 'safety/add_toolbox'     | 'safety/add_permit'
  // Engineering
  | 'engineering/add_deliverable' | 'engineering/update_deliverable'
  | 'engineering/add_installation' | 'engineering/add_manpower'
  | 'engineering/add_feed_study'
  // Commissioning
  | 'cx/add_phase'           | 'cx/add_issue'
  // Documents
  | 'docs/add_document'      | 'docs/add_transmittal'
  // Actions
  | 'actions/add_action'     | 'actions/update_action'
  | 'actions/add_punch'      | 'actions/add_lesson'      | 'actions/add_closeout'
  // EVM
  | 'evm/add_evm'
  // Company
  | 'company/set'
  // Generic
  | 'generic/update_status'  | 'generic/update_collection'
  // Notifications
  | 'notif/add'              | 'notif/mark_read'         | 'notif/mark_all_read'
  // Proposals
  | 'proposals/add'          | 'proposals/update_status'
  // Service Tickets
  | 'tickets/add'            | 'tickets/update_status'
  // Emergency
  | 'data/wipe_all'
  // Raw mutator (legacy compatibility)
  | 'raw/mutate'
  // ── Commissioning Intelligence ────────────────────────────────────────────
  // Assets (mutable until linked to a frozen baseline)
  | 'ci/add_asset'           | 'ci/update_asset'        | 'ci/delete_asset'
  // Baselines (draft → frozen; once frozen, no updates permitted)
  | 'ci/add_baseline'        | 'ci/freeze_baseline'
  // Tests (mutable until baseline is frozen)
  | 'ci/add_test'            | 'ci/update_test'
  // Setpoints (mutable until baseline is frozen)
  | 'ci/add_setpoint'        | 'ci/update_setpoint'
  // PM Tasks (mutable — can be revised post-handover with provenance)
  | 'ci/add_pm_task'         | 'ci/update_pm_task'      | 'ci/deactivate_pm_task'
  // Change Events (append-only — no delete, no update of core fields)
  | 'ci/add_change_event'    | 'ci/update_change_status'
  // Evidence (write-once — add only, no update, no delete)
  | 'ci/add_evidence'

export interface BizAction {
  type:     ActionType | string
  payload?: Partial<BizRecord & EVMRecord & Record<string, unknown>>
  data?:    Partial<BizRecord & EVMRecord & Record<string, unknown>>
  mutator?: (state: BizState) => void
}

export type ReducerResult =
  | { ok: true;  state: BizState; error?: undefined }
  | { ok: false; state: BizState; error: string }

// ─── Action Constants ─────────────────────────────────────────────────────────
export const JARVIS_ACTIONS = {
  // CRM
  ADD_LEAD:           'crm/add_lead'                 as const,
  UPDATE_LEAD:        'crm/update_lead'              as const,
  DELETE_LEAD:        'crm/delete_lead'              as const,
  ADD_VENDOR:         'crm/add_vendor'               as const,
  UPDATE_VENDOR:      'crm/update_vendor'            as const,
  DELETE_VENDOR:      'crm/delete_vendor'            as const,
  ADD_CUSTOMER:       'crm/add_customer'             as const,
  UPDATE_CUSTOMER:    'crm/update_customer'          as const,
  DELETE_CUSTOMER:    'crm/delete_customer'          as const,
  // Contracts
  ADD_CONTRACT:       'contracts/add_contract'       as const,
  UPDATE_CONTRACT:    'contracts/update_contract'    as const,
  // Financial
  ADD_INVOICE:        'finance/add_invoice'          as const,
  UPDATE_INVOICE:     'finance/update_invoice'       as const,
  RECORD_PAYMENT:     'finance/record_payment'       as const,
  ADD_EXPENSE:        'finance/add_expense'          as const,
  ADD_JOURNAL:        'finance/add_journal'          as const,
  // Procurement
  ADD_PO:             'procurement/add_po'           as const,
  UPDATE_PO:          'procurement/update_po'        as const,
  DELETE_PO:          'procurement/delete_po'        as const,
  ADD_RFQ:            'procurement/add_rfq'          as const,
  UPDATE_RFQ:         'procurement/update_rfq'       as const,
  ADD_SUBMITTAL:      'procurement/add_submittal'    as const,
  ADD_RFI:            'procurement/add_rfi'          as const,
  // Safety
  ADD_JHA:            'safety/add_jha'               as const,
  ADD_INCIDENT:       'safety/add_incident'          as const,
  ADD_TOOLBOX:        'safety/add_toolbox'           as const,
  ADD_PERMIT:         'safety/add_permit'            as const,
  // Engineering
  ADD_DELIVERABLE:    'engineering/add_deliverable'  as const,
  UPDATE_DELIVERABLE: 'engineering/update_deliverable' as const,
  ADD_INSTALLATION:   'engineering/add_installation' as const,
  ADD_MANPOWER:       'engineering/add_manpower'     as const,
  ADD_FEED_STUDY:     'engineering/add_feed_study'   as const,
  // Commissioning
  ADD_CX_PHASE:       'cx/add_phase'                 as const,
  ADD_CX_ISSUE:       'cx/add_issue'                 as const,
  // Documents
  ADD_DOCUMENT:       'docs/add_document'            as const,
  ADD_TRANSMITTAL:    'docs/add_transmittal'         as const,
  // Actions
  ADD_ACTION:         'actions/add_action'           as const,
  UPDATE_ACTION:      'actions/update_action'        as const,
  ADD_PUNCH:          'actions/add_punch'            as const,
  ADD_LESSON:         'actions/add_lesson'           as const,
  ADD_CLOSEOUT:       'actions/add_closeout'         as const,
  // EVM
  ADD_EVM:            'evm/add_evm'                  as const,
  // Company
  SET_COMPANY:        'company/set'                  as const,
  // Generic
  UPDATE_STATUS:      'generic/update_status'        as const,
  UPDATE_COLLECTION:  'generic/update_collection'    as const,
  // Notifications
  ADD_NOTIFICATION:   'notif/add'                    as const,
  MARK_NOTIF_READ:    'notif/mark_read'              as const,
  MARK_ALL_READ:      'notif/mark_all_read'          as const,
  // Proposals
  ADD_PROPOSAL:       'proposals/add'                as const,
  UPDATE_PROPOSAL:    'proposals/update_status'      as const,
  // Service Tickets
  ADD_TICKET:         'tickets/add'                  as const,
  UPDATE_TICKET:      'tickets/update_status'        as const,
  // Emergency
  WIPE_ALL:           'data/wipe_all'                as const,
  // ── Commissioning Intelligence ───────────────────────────────────────────
  CI_ADD_ASSET:            'ci/add_asset'            as const,
  CI_UPDATE_ASSET:         'ci/update_asset'         as const,
  CI_DELETE_ASSET:         'ci/delete_asset'         as const,
  CI_ADD_BASELINE:         'ci/add_baseline'         as const,
  CI_FREEZE_BASELINE:      'ci/freeze_baseline'      as const,
  CI_ADD_TEST:             'ci/add_test'             as const,
  CI_UPDATE_TEST:          'ci/update_test'          as const,
  CI_ADD_SETPOINT:         'ci/add_setpoint'         as const,
  CI_UPDATE_SETPOINT:      'ci/update_setpoint'      as const,
  CI_ADD_PM_TASK:          'ci/add_pm_task'          as const,
  CI_UPDATE_PM_TASK:       'ci/update_pm_task'       as const,
  CI_DEACTIVATE_PM_TASK:   'ci/deactivate_pm_task'   as const,
  CI_ADD_CHANGE_EVENT:     'ci/add_change_event'     as const,
  CI_UPDATE_CHANGE_STATUS: 'ci/update_change_status' as const,
  CI_ADD_EVIDENCE:         'ci/add_evidence'         as const,
} as const

// ─── Collection Maps ──────────────────────────────────────────────────────────
/** Maps add-type action strings → collection names */
const ADD_MAP: Readonly<Record<string, keyof BizState>> = {
  'crm/add_lead':                   'leads',
  'crm/add_vendor':                 'vendors',
  'crm/add_customer':               'customers',
  'contracts/add_contract':         'contracts',
  'finance/add_invoice':            'invoices',
  'finance/add_expense':            'expenses',
  'finance/add_journal':            'journal',
  'procurement/add_po':             'purchase_orders',
  'procurement/add_rfq':            'rfqs',
  'procurement/add_submittal':      'submittals',
  'procurement/add_rfi':            'rfis',
  'safety/add_jha':                 'jhas',
  'safety/add_incident':            'incidents',
  'safety/add_toolbox':             'toolbox_talks',
  'safety/add_permit':              'permits',
  'engineering/add_deliverable':    'engineering_deliverables',
  'engineering/add_installation':   'installation',
  'engineering/add_manpower':       'manpower',
  'engineering/add_feed_study':     'feed_studies',
  'cx/add_phase':                   'cx_phases',
  'cx/add_issue':                   'cx_issues',
  'docs/add_document':              'documents',
  'docs/add_transmittal':           'transmittals',
  'actions/add_action':             'action_items',
  'actions/add_punch':              'punch_items',
  'actions/add_lesson':             'lessons',
  'actions/add_closeout':           'closeouts',
  'notif/add':                      'notifications',
  'proposals/add':                  'proposals',
  'tickets/add':                    'service_tickets',
  // Commissioning Intelligence — simple add actions (no special guards)
  'ci/add_asset':                   'ci_assets',
  'ci/add_baseline':                'ci_baselines',
  'ci/add_test':                    'ci_tests',
  'ci/add_setpoint':                'ci_setpoints',
  'ci/add_pm_task':                 'ci_pm_tasks',
  'ci/add_change_event':            'ci_change_events',
  // NOTE: ci/add_evidence is NOT here — it requires content_hash guard (handled in switch)
}

/** Maps update-type action strings → collection names */
const UPDATE_MAP: Readonly<Record<string, keyof BizState>> = {
  'crm/update_lead':                    'leads',
  'crm/update_vendor':                  'vendors',
  'crm/update_customer':                'customers',
  'contracts/update_contract':          'contracts',
  'finance/update_invoice':             'invoices',
  'procurement/update_po':              'purchase_orders',
  'procurement/update_rfq':             'rfqs',
  'engineering/update_deliverable':     'engineering_deliverables',
  'actions/update_action':              'action_items',
  // NOTE: ci/update_test and ci/update_setpoint are NOT here —
  // they require freeze-guard checks (handled in switch)
  // ci/update_asset and ci/update_pm_task have no special guards — safe in UPDATE_MAP
  'ci/update_asset':                    'ci_assets',
  'ci/update_pm_task':                  'ci_pm_tasks',
}

// ─── Clone utility ────────────────────────────────────────────────────────────
function deepClone<T>(obj: T): T {
  try {
    return structuredClone(obj)
  } catch {
    return JSON.parse(JSON.stringify(obj ?? {})) as T
  }
}

// ─── EVM computation ──────────────────────────────────────────────────────────
interface EVMInput {
  project: string
  period:  string
  budget:  number
  ev:      number
  ac:      number
  pv:      number
  [key: string]: unknown
}

function computeEVM(data: EVMInput): EVMRecord {
  const cpi = data.ac  ? data.ev / data.ac  : 1
  const spi = data.pv  ? data.ev / data.pv  : 1
  const eac = cpi      ? data.budget / cpi  : data.budget
  return {
    ...data,
    id:      data.id as string ?? data.project,
    cpi:     +cpi.toFixed(3),
    spi:     +spi.toFixed(3),
    eac:     Math.round(eac),
    vac:     Math.round(data.budget - eac),
    cv:      data.ev - data.ac,
    sv:      data.ev - data.pv,
  }
}

// ─── Reducer ──────────────────────────────────────────────────────────────────
/**
 * bizReducer — pure function that processes a typed action against biz state.
 *
 * @param state   Current biz state (will NOT be mutated)
 * @param action  Typed domain action
 * @returns       Result object: { ok, state, error? }
 */
export function bizReducer(state: BizState, action: BizAction): ReducerResult {
  const next = deepClone(state)
  const data = (action.payload ?? action.data ?? {}) as Record<string, unknown>
  const type = action.type

  // ── Add actions ──────────────────────────────────────────────────────────────
  const addCol = ADD_MAP[type]
  if (addCol) {
    const arr = (next[addCol] as BizRecord[]) ?? []
    arr.push(data as BizRecord)
    ;(next[addCol] as BizRecord[]) = arr
    return { ok: true, state: next }
  }

  // ── Update actions ────────────────────────────────────────────────────────────
  const updateCol = UPDATE_MAP[type]
  if (updateCol && data.id) {
    const arr = (next[updateCol] as BizRecord[]) ?? []
    const idx = arr.findIndex(r => r.id === data.id)
    if (idx >= 0) Object.assign(arr[idx], data)
    return { ok: true, state: next }
  }

  // ── Delete actions ────────────────────────────────────────────────────────────
  if (type.includes('/delete_')) {
    const [domain, rest] = type.split('/delete_')
    const delCol = ADD_MAP[`${domain}/add_${rest}`]
    if (delCol && data.id) {
      ;(next[delCol] as BizRecord[]) = ((next[delCol] as BizRecord[]) ?? [])
        .filter(r => r.id !== data.id)
    }
    return { ok: true, state: next }
  }

  // ── Special actions ───────────────────────────────────────────────────────────
  switch (type) {
    case 'company/set': {
      Object.assign(next.company, data)
      return { ok: true, state: next }
    }

    case 'finance/record_payment': {
      const inv = (next.invoices ?? []).find(r => r.id === data['invoice_id'])
      if (inv) inv['status'] = 'paid'
      return { ok: true, state: next }
    }

    case 'evm/add_evm': {
      const evmData = data as unknown as EVMInput
      const record  = computeEVM(evmData)
      const idx     = (next.evm_projects ?? []).findIndex(r => r.project === evmData.project)
      if (idx >= 0) next.evm_projects[idx] = record
      else          next.evm_projects.push(record)
      return { ok: true, state: next }
    }

    case 'generic/update_status': {
      const col   = (data['collection'] as string) ?? `${data['type']}s`
      const items = (next[col] as BizRecord[]) ?? []
      const idx   = items.findIndex(r => r.id === data.id)
      if (idx >= 0) items[idx]['status'] = data['status']
      return { ok: true, state: next }
    }

    case 'generic/update_collection': {
      const col   = data['collection'] as string
      const items = data['items']
      if (col && Array.isArray(items)) {
        ;(next[col] as unknown[]) = items
      }
      return { ok: true, state: next }
    }

    case 'raw/mutate': {
      if (typeof action.mutator === 'function') {
        action.mutator(next)
        return { ok: true, state: next }
      }
      return { ok: false, state, error: 'raw/mutate action missing mutator function' }
    }

    // ── Phase 8: Notifications ────────────────────────────────────────────────
    case 'notif/mark_read': {
      const notifId = data['id'] as string | undefined
      if (!notifId) return { ok: false, state, error: 'notif/mark_read requires id' }
      const notif = (next.notifications ?? []).find(n => n.id === notifId)
      if (notif) notif['read'] = true
      return { ok: true, state: next }
    }

    case 'notif/mark_all_read': {
      ;(next.notifications ?? []).forEach(n => { n['read'] = true })
      return { ok: true, state: next }
    }

    // ── Phase 8: Proposals ────────────────────────────────────────────────────
    case 'proposals/update_status': {
      const { id: pid, status: pStatus } = data as { id?: string; status?: string }
      if (!pid || !pStatus) return { ok: false, state, error: 'proposals/update_status requires id and status' }
      const proposal = (next.proposals ?? []).find(p => p.id === pid)
      if (proposal) proposal['status'] = pStatus
      return { ok: true, state: next }
    }

    // ── Phase 8: Service Tickets ──────────────────────────────────────────────
    case 'tickets/update_status': {
      const { id: tid, status: tStatus } = data as { id?: string; status?: string }
      if (!tid || !tStatus) return { ok: false, state, error: 'tickets/update_status requires id and status' }
      const ticket = (next.service_tickets ?? []).find(t => t.id === tid)
      if (ticket) ticket['status'] = tStatus
      return { ok: true, state: next }
    }

    // ── Phase 8: Emergency wipe (owner-gated at dispatch layer) ──────────────
    case 'data/wipe_all': {
      // Wipe all array collections; preserve company and scalar fields
      for (const key of Object.keys(next)) {
        if (Array.isArray(next[key])) {
          (next as Record<string, unknown>)[key] = []
        }
      }
      next.company = {}
      return { ok: true, state: next }
    }

    // ── Commissioning Intelligence — Special Actions ────────────────────────

    // ci/freeze_baseline — sets status to 'frozen' and stamps frozen_at.
    // INVARIANT: Once frozen, this action is rejected if called again.
    // INVARIANT: All referenced tests/setpoints/evidence become read-only
    //            (enforced by guarding ci/update_test and ci/update_setpoint below).
    case 'ci/freeze_baseline': {
      const { id: blId, frozen_by } = data as { id?: string; frozen_by?: string }
      if (!blId) return { ok: false, state, error: 'ci/freeze_baseline requires id' }

      const baselines = (next.ci_baselines as Array<Record<string, unknown>>) ?? []
      const baseline  = baselines.find(b => b['id'] === blId)

      if (!baseline) {
        return { ok: false, state, error: `ci/freeze_baseline: baseline ${blId} not found` }
      }
      if (baseline['status'] === 'frozen') {
        return { ok: false, state, error: `ci/freeze_baseline: baseline ${blId} is already frozen` }
      }

      baseline['status']    = 'frozen'
      baseline['frozen_at'] = new Date().toISOString()
      baseline['frozen_by'] = frozen_by ?? 'system'
      return { ok: true, state: next }
    }

    // ci/update_test — guarded: reject if linked baseline is frozen.
    case 'ci/update_test': {
      const { id: testId, baseline_id } = data as { id?: string; baseline_id?: string }
      if (!testId) return { ok: false, state, error: 'ci/update_test requires id' }

      if (baseline_id) {
        const baselines = (next.ci_baselines as Array<Record<string, unknown>>) ?? []
        const baseline  = baselines.find(b => b['id'] === baseline_id)
        if (baseline?.['status'] === 'frozen') {
          return { ok: false, state, error: `ci/update_test: baseline ${baseline_id} is frozen — test ${testId} is read-only` }
        }
      }

      const tests = (next.ci_tests as Array<Record<string, unknown>>) ?? []
      const idx   = tests.findIndex(t => t['id'] === testId)
      if (idx >= 0) Object.assign(tests[idx], data)
      return { ok: true, state: next }
    }

    // ci/update_setpoint — guarded: reject if linked baseline is frozen.
    case 'ci/update_setpoint': {
      const { id: spId, baseline_id: spBlId } = data as { id?: string; baseline_id?: string }
      if (!spId) return { ok: false, state, error: 'ci/update_setpoint requires id' }

      if (spBlId) {
        const baselines = (next.ci_baselines as Array<Record<string, unknown>>) ?? []
        const baseline  = baselines.find(b => b['id'] === spBlId)
        if (baseline?.['status'] === 'frozen') {
          return { ok: false, state, error: `ci/update_setpoint: baseline ${spBlId} is frozen — setpoint ${spId} is read-only` }
        }
      }

      const setpoints = (next.ci_setpoints as Array<Record<string, unknown>>) ?? []
      const idx       = setpoints.findIndex(s => s['id'] === spId)
      if (idx >= 0) Object.assign(setpoints[idx], data)
      return { ok: true, state: next }
    }

    // ci/deactivate_pm_task — sets active=false; PM tasks are never hard-deleted.
    case 'ci/deactivate_pm_task': {
      const { id: pmId } = data as { id?: string }
      if (!pmId) return { ok: false, state, error: 'ci/deactivate_pm_task requires id' }

      const pmTasks = (next.ci_pm_tasks as Array<Record<string, unknown>>) ?? []
      const task    = pmTasks.find(p => p['id'] === pmId)
      if (task) task['active'] = false
      return { ok: true, state: next }
    }

    // ci/update_change_status — only status, approved_by, approved_at, implemented fields.
    // Core fields (description, reason, type, impact, baseline_id) are immutable.
    case 'ci/update_change_status': {
      const { id: evId, status, approved_by, approved_at, implemented_at, implemented_by }
        = data as {
            id?: string; status?: string; approved_by?: string
            approved_at?: string; implemented_at?: string; implemented_by?: string
          }

      if (!evId)  return { ok: false, state, error: 'ci/update_change_status requires id' }
      if (!status) return { ok: false, state, error: 'ci/update_change_status requires status' }

      const events = (next.ci_change_events as Array<Record<string, unknown>>) ?? []
      const ev     = events.find(e => e['id'] === evId)

      if (!ev) return { ok: false, state, error: `ci/update_change_status: change event ${evId} not found` }

      // Only allow status field transitions — never touch description, reason, type, impact
      ev['status'] = status
      if (approved_by)    ev['approved_by']    = approved_by
      if (approved_at)    ev['approved_at']    = approved_at
      if (implemented_at) ev['implemented_at'] = implemented_at
      if (implemented_by) ev['implemented_by'] = implemented_by

      return { ok: true, state: next }
    }

    // ci/add_evidence — write-once guard: evidence records must have a content_hash.
    // This is enforced at the reducer level; callers must compute the hash before dispatch.
    case 'ci/add_evidence': {
      const { content_hash } = data as { content_hash?: string }
      if (!content_hash) {
        return { ok: false, state, error: 'ci/add_evidence: content_hash is required. Compute SHA-256 hash before dispatching.' }
      }

      const evidence = (next.ci_evidence as BizRecord[]) ?? []
      evidence.push(data as BizRecord)
      next.ci_evidence = evidence
      return { ok: true, state: next }
    }

    default: {
      // Unknown action — return state unchanged, log warning
      console.warn(`[JARVIS:bizReducer] Unknown action type: ${type}`)
      return { ok: false, state, error: `Unknown action type: ${type}` }
    }
  }
}

// ─── Convenience helpers ──────────────────────────────────────────────────────
/**
 * applyAction — thin wrapper; returns the new state directly.
 * Use for cases where you don't need the result metadata.
 */
export function applyAction(state: BizState, action: BizAction): BizState {
  return bizReducer(state, action).state
}

/**
 * applyActions — apply a sequence of actions to state.
 * Aborts and returns partial state if any action returns ok:false.
 */
export function applyActions(state: BizState, actions: BizAction[]): BizState {
  return actions.reduce((s, action) => bizReducer(s, action).state, state)
}

/** Selector: get a typed collection from biz state */
export function getCollection<T extends BizRecord>(
  state: BizState,
  collection: keyof BizState
): T[] {
  return ((state[collection] as T[]) ?? [])
}
