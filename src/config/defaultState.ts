/**
 * Denver Engineering — Default State Seed Data  (v4.28.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 18d extraction: `$i()` function from JarvisCore.jsx → typed export.
 *
 * This is the seed data hydrated into the biz store on first load.
 * It reflects the Lusaka WTP + Maputo PM project state used for demo/dev.
 *
 * Usage:
 *   import { DEFAULT_BIZ_STATE } from '../config/defaultState'
 *   // Replace: function $i() { return {...} } with direct import
 *   // In biz store initializer: state = DEFAULT_BIZ_STATE
 *
 * To override for a specific tenant, call getDefaultState(overrides).
 */

// ─── Type stub (full types live in modules/biz/types.ts) ─────────────────────

type IsoDate = string   // YYYY-MM-DD

interface BizState {
  /** Present only on the shipped demo seed; see DEMO_SEED_MARKER. */
  __demoSeed?:        true
  company:            { name: string; type: string }
  leads:              Lead[]
  contracts:          Contract[]
  invoices:           Invoice[]
  purchase_orders:    PurchaseOrder[]
  submittals:         Submittal[]
  rfis:               RFI[]
  jhas:               JHA[]
  incidents:          Incident[]
  permits:            Permit[]
  toolbox_talks:      ToolboxTalk[]
  cx_phases:          CxPhase[]
  cx_issues:          CxIssue[]
  action_items:       ActionItem[]
  punch_items:        PunchItem[]
  evm_projects:       EVMProject[]
  expenses:           Expense[]
  documents:          Document[]
  lessons:            Lesson[]
  closeouts:          Closeout[]
  rfqs:               RFQ[]
  vendors:            Vendor[]
  customers:          Customer[]
  engineering_deliverables: EngDeliverable[]
  installations:      Installation[]
  manpower:           Manpower[]
  projects:           Project[]
  evm:                EVMProject[]
}

// Minimal interface declarations — the store has the authoritative types
interface Lead          { id: string; [k: string]: unknown }
interface Contract      { id: string; [k: string]: unknown }
interface Invoice       { id: string; [k: string]: unknown }
interface PurchaseOrder { id: string; [k: string]: unknown }
interface Submittal     { id: string; [k: string]: unknown }
interface RFI           { id: string; [k: string]: unknown }
interface JHA           { id: string; [k: string]: unknown }
interface Incident      { id: string; [k: string]: unknown }
interface Permit        { id: string; [k: string]: unknown }
interface ToolboxTalk   { id: string; [k: string]: unknown }
interface CxPhase       { phase: string; [k: string]: unknown }
interface CxIssue       { id: string; [k: string]: unknown }
interface ActionItem    { id: string; [k: string]: unknown }
interface PunchItem     { id: string; [k: string]: unknown }
interface EVMProject    { id?: string; project: string; [k: string]: unknown }
interface Expense       { id: string; [k: string]: unknown }
interface Document      { id: string; [k: string]: unknown }
interface Lesson        { id: string; [k: string]: unknown }
interface Closeout      { id: string; [k: string]: unknown }
interface RFQ           { id: string; [k: string]: unknown }
interface Vendor        { id: string; [k: string]: unknown }
interface Customer      { id: string; [k: string]: unknown }
interface EngDeliverable{ id: string; [k: string]: unknown }
interface Installation  { discipline: string; [k: string]: unknown }
interface Manpower      { month: string; [k: string]: unknown }
interface Project       { id: string; [k: string]: unknown }

// ─── Demonstration data — OPT-IN ONLY ────────────────────────────────────────
//
// This is a Lusaka WTP / Maputo PM sample. It used to be what a fresh session
// LOADED: JarvisCore initialised `biz` from it, handed it to ContentRouter, and
// every store-backed view rendered it. Nothing in that path consults a domain
// API — `biz` is replaced only by a persisted blob or a user's backup file — so
// a new user saw a $425,000 active contract for "US DOS", $63,750 of invoices
// and two open safety incidents, in exactly the styling real figures use.
//
// A fresh session now starts EMPTY. The sample is preserved, because demos and
// tests need it, but it loads only when someone asks for it (see
// `isDemoRequested`). Empty understates and is obviously empty; the sample
// overstated and was indistinguishable from the reader's own operations.
//
// `__demoSeed` marks the sample so the shell can say so. It is deliberately
// part of the DATA rather than a separate flag: JarvisCore persists and
// restores the whole blob, so a flag held outside it would not survive the
// round trip — which is exactly when provenance would otherwise be lost.
export const DEMO_SEED_MARKER = '__demoSeed' as const

/** True when this state still descends from the shipped demo sample. */
export function isDemoSeed(biz: unknown): boolean {
  return Boolean((biz as Record<string, unknown> | null | undefined)?.[DEMO_SEED_MARKER])
}

/** Where an explicit opt-in is remembered across navigations. */
export const DEMO_OPT_IN_KEY = 'jarvis:demo_data'

/**
 * Has demonstration data been explicitly asked for?
 *
 * `?demo=1` turns it on and is remembered; `?demo=0` turns it off and forgets.
 * Nothing else enables it — in particular, an empty store does NOT fall back to
 * the sample, which is the whole point of the change.
 *
 * Reads defensively: a locked-down or unavailable localStorage must leave the
 * app empty rather than throwing on boot.
 */
export function isDemoRequested(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const param = new URLSearchParams(window.location.search).get('demo')
    if (param === '1' || param === 'true') {
      try { window.localStorage.setItem(DEMO_OPT_IN_KEY, '1') } catch { /* private mode */ }
      return true
    }
    if (param === '0' || param === 'false') {
      try { window.localStorage.removeItem(DEMO_OPT_IN_KEY) } catch { /* private mode */ }
      return false
    }
    return window.localStorage.getItem(DEMO_OPT_IN_KEY) === '1'
  } catch {
    return false
  }
}

export const DEFAULT_BIZ_STATE: BizState = {
  [DEMO_SEED_MARKER]: true,
  company:  { name: '', type: '' },

  leads: [{
    id: 'LEAD-001', name: 'Embassy Lusaka WTP', contact: 'John Smith',
    source: 'GovCon', service: 'WTP', estimated_value: 425000, probability: 100, status: 'won',
  }],

  contracts: [
    {
      id: 'C-001', project: 'Lusaka WTP', client: 'US DOS', value: 425000,
      type: 'FFP', status: 'active', start: '2026-01-15' as IsoDate, end: '2026-11-01' as IsoDate, retainage: '10%',
      milestones: [
        { name: 'NTP',        date: '2026-01-15', status: 'complete', payment: 0 },
        { name: '30% Design', date: '2026-02-28', status: 'complete', payment: 63750 },
      ],
    },
    {
      id: 'C-002', project: 'Maputo PM', client: 'USAID', value: 45000,
      type: 'T&M', status: 'active', start: '2026-03-01' as IsoDate, end: '2026-05-15' as IsoDate, retainage: '0%',
      milestones: [
        { name: 'Mobilization',  date: '2026-03-01', status: 'complete', payment: 15000 },
        { name: 'PM Execution',  date: '2026-04-15', status: 'complete', payment: 20000 },
      ],
    },
  ],

  invoices: [{
    id: 'INV-001', project: 'Lusaka WTP', client: 'US Embassy Lusaka',
    amount: 63750, description: '30% Design milestone', status: 'paid',
    date: '2026-02-01', due_date: '2026-03-01',
  }],

  purchase_orders: [{
    id: 'PO-001', project: 'Lusaka WTP', vendor: 'Hydranautics',
    equipment: 'RO Membrane System', tag: 'RO-001', amount: 78000, status: 'received',
    issued_date: '2026-02-15', expected_delivery: '2026-05-10',
    chain: { rfq: '2026-01-20', shipped: '2026-04-20', received: '2026-05-08' },
  }],

  submittals: [
    { id: 'SUB-001', spec: '11300', description: 'RO Skid Shop Drawings', vendor: 'Hydranautics', status: 'approved', submitted: '2026-02-20', reviewed: '2026-03-05', project: 'Lusaka WTP', ref_dwg: 'A-101', ref_title: 'Equipment Layout Plan' },
    { id: 'SUB-002', spec: '15100', description: 'Piping Layout & Isometrics', vendor: '—', status: 'approved', submitted: '2026-03-01', reviewed: '2026-03-15', project: 'Lusaka WTP', ref_dwg: 'M-201', ref_title: 'Piping Plan & Sections' },
  ],

  rfis: [
    { id: 'RFI-001', subject: 'Foundation bolt pattern for RO skid', status: 'answered', priority: 'urgent',  date: '2026-03-12', project: 'Lusaka WTP' },
    { id: 'RFI-002', subject: 'Chemical storage room ventilation rate', status: 'answered', priority: 'routine', date: '2026-03-20', project: 'Lusaka WTP' },
  ],

  jhas: [
    { id: 'JHA-001', project: 'Lusaka WTP', task: 'RO Skid Installation',    hazards: ['Elec', 'Lifting'],                     date: '2026-05-15', status: 'active' },
    { id: 'JHA-002', project: 'Lusaka WTP', task: 'Chemical Feed Piping',    hazards: ['Chemical Handling', 'Confined Space'], date: '2026-05-20', status: 'active' },
  ],

  incidents: [
    { id: 'INC-001', type: 'near-miss', project: 'Lusaka WTP', description: 'Unsecured load during crane lift',   date: '2026-05-18', severity: 'medium', recordable: false },
    { id: 'INC-002', type: 'near-miss', project: 'Lusaka WTP', description: 'Tripping hazard from cable routing', date: '2026-06-05', severity: 'low',    recordable: false },
  ],

  permits: [
    { id: 'PER-001', project: 'Lusaka WTP', type: 'Hot Work',           location: 'Mech Room', date: '2026-05-22', status: 'active' },
    { id: 'PER-002', project: 'Lusaka WTP', type: 'Confined Space Entry', location: 'Clearwell', date: '2026-06-10', status: 'active' },
  ],

  toolbox_talks: [
    { id: 'TBT-001', project: 'Lusaka WTP', topic: 'Electrical Safety', date: '2026-05-12', attendees: 6 },
    { id: 'TBT-002', project: 'Lusaka WTP', topic: 'PPE Requirements',  date: '2026-05-19', attendees: 6 },
  ],

  cx_phases: [
    { phase: 'Pre-Cx Planning', status: 'complete',    items: 8,  done: 8,  project: 'Lusaka WTP' },
    { phase: 'Design Review',   status: 'complete',    items: 12, done: 12, project: 'Lusaka WTP' },
    { phase: 'Cx Execution',    status: 'in-progress', items: 24, done: 14, project: 'Lusaka WTP' },
    { phase: 'TAB',             status: 'upcoming',    items: 6,  done: 0,  project: 'Lusaka WTP' },
    { phase: 'Acceptance',      status: 'upcoming',    items: 4,  done: 0,  project: 'Lusaka WTP' },
  ],

  cx_issues: [
    { id: 'CX-001', issue: 'RO unit pressure gauge reading low', severity: 'medium', status: 'open',     assigned: 'Tech A', project: 'Lusaka WTP' },
    { id: 'CX-002', issue: 'Chemical dosing pump calibration off by 8%', severity: 'high', status: 'open', assigned: 'Tech B', project: 'Lusaka WTP' },
    { id: 'CX-003', issue: 'Control panel labeling incomplete',  severity: 'low',    status: 'resolved', assigned: 'Tech A', project: 'Lusaka WTP' },
  ],

  action_items:          [],
  punch_items:           [],
  expenses:              [],
  documents:             [],
  lessons:               [],
  closeouts:             [],
  rfqs:                  [],
  vendors:               [],
  customers:             [],
  engineering_deliverables: [],
  installations:         [],
  manpower:              [],
  projects:              [],

  evm_projects: [{
    id: 'EVM-001', project: 'Lusaka WTP',
    bac: 425000, pv: 180000, ev: 170000, ac: 165000,
    spi: +(170000/180000).toFixed(2),   // 0.94
    cpi: +(170000/165000).toFixed(2),   // 1.03
    eac: +(425000 / (170000/165000)).toFixed(0),
    vac: +(425000 - 425000 / (170000/165000)).toFixed(0),
    date: '2026-04-01',
  }],

  evm: [],
}

/**
 * What a fresh session starts with: the same SHAPE as the sample, with every
 * collection empty and no demo marker.
 *
 * Derived from `DEFAULT_BIZ_STATE` rather than written out by hand, so a
 * collection added to the sample cannot be missing here — a hand-maintained
 * twin would drift, and the failure mode is `undefined.length` inside a view.
 * Non-array fields (`company`) are reset explicitly; the marker is dropped.
 */
export const EMPTY_BIZ_STATE: BizState = (() => {
  const empty = {} as Record<string, unknown>
  for (const [key, value] of Object.entries(DEFAULT_BIZ_STATE)) {
    if (key === DEMO_SEED_MARKER) continue
    empty[key] = Array.isArray(value) ? [] : value
  }
  empty['company'] = { name: '', type: '' }
  return empty as unknown as BizState
})()

/**
 * The state a session should boot with.
 *
 * Empty unless demonstration data has been explicitly requested. This is the
 * single decision point — `$i()` in JarvisCore calls exactly this, so there is
 * no second path by which the sample can reach a fresh session.
 */
export function getInitialBizState(): BizState {
  return isDemoRequested() ? DEFAULT_BIZ_STATE : EMPTY_BIZ_STATE
}

/**
 * Returns the demonstration state with optional overrides.
 * Use for tenant-specific seed data without mutating the base constant.
 */
export function getDefaultState(overrides?: Partial<BizState>): BizState {
  return { ...DEFAULT_BIZ_STATE, ...overrides }
}
