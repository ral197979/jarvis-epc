/**
 * Denver Engineering — Capability Registry  (ADR-014, Phase 1)
 * ─────────────────────────────────────────────────────────────────────────────
 * The single client-side authorization registry.
 *
 * The rule (ADR-014): **navigation is a projection of effective authorization,
 * never the enforcement.** Positions grant *capabilities*; every destination
 * declares the capability that opens it. One predicate — `canSee()` — is read by
 * both the sidebar projection ([NavSidebar]) and the route guard
 * ([ContentRouter]). There is deliberately no second table to drift.
 *
 * This replaces three tables that disagreed with each other and with the
 * database: the `domain` filter formerly inline in NavSidebar, `PERSONAS[].tabs`
 * (which keyed on `exec`/`pm` — roles that do not exist in the `user_role`
 * enum), and the ad-hoc role branches those implied.
 *
 * SCOPE — this is a *view* gate only. Write authority still lives in
 * `POLICY_ACTIONS` / `canWriteData` and is unchanged by ADR-014 Phase 1.
 *
 * NOT A SECURITY BOUNDARY ON ITS OWN. Client-side gating hides what a user may
 * not open; it does not stop a crafted request. Server enforcement
 * (`requireCapability`) is ADR-014 Phase 2 and is not yet implemented — until it
 * lands, the API remains the authoritative gap.
 *
 * Usage:
 *   import { canSee, ROLE_CAPS, SCREEN_CAP } from '../config/capabilities'
 *   if (!canSee(tabId, role)) renderRestricted()
 */

/**
 * Authorization roles. Mirrors the `user_role` enum in
 * `api/db/migrations/001_tenants_and_users.sql` exactly — all seven values.
 * Do not add a role here that the database cannot store.
 */
export const USER_ROLES = [
  'owner',
  'admin',
  'project_manager',
  'engineer',
  'procurement',
  'field_ops',
  'viewer',
] as const

export type UserRole = typeof USER_ROLES[number]

/** Capabilities a role may hold. A destination declares exactly one. */
export const CAPABILITIES = [
  'personal.view',       // the signed-in user's own queue and alerts
  'project.view',        // depth inside a project
  'project.list.all',    // the organisation-wide project registry
  'portfolio.view',      // cross-project delivery and financial roll-up
  'crm.view',            // business development pipeline
  'team.view',           // roster, rates, timesheets
  'schedule.view',       // schedule import, forecast
  'cost.view',           // budget, cost control, EVM, change orders, billing
  'risk.view',           // risk register
  'engineering.view',    // design surfaces, drawings, BIM, calc shells
  'docs.view',           // document control, transmittals, knowledge, turnover
  'construction.view',   // daily logs, RFIs, submittals, IoT
  'field.view',          // field service and field assistant
  'quality.view',        // inspections, punch, NCR
  'safety.view',         // safety, compliance
  'procurement.view',    // subcontracts, vendors, procurement risk
  'commissioning.view',  // commissioning workspace
  'assistant.use',       // Ask Jarvis and the AI coordination surfaces
  'audit.view',          // immutable audit log
  'platform.admin',      // settings, automation, integrations, MCP
] as const

export type Capability = typeof CAPABILITIES[number]

/**
 * Every destination → the capability that opens it.
 *
 * Must cover every id in `NAVIGATION_ITEMS` *and* every key in the router's
 * `TAB_MAP`, including the routes that are reachable but absent from the
 * sidebar (`commissioning`, `engineering`, `audit`, `overview`, `plan`,
 * `resources`, `jobs`, `procurement`). Those hidden routes are exactly the ones
 * a stale deep link reaches, so leaving them unmapped would reopen the gap this
 * registry closes. A completeness test asserts both directions.
 */
export const SCREEN_CAP: Record<string, Capability> = {
  // ── Personal ────────────────────────────────────────────────────────────────
  focus:           'personal.view',
  mywork:          'personal.view',
  actions:         'personal.view',
  notifications:   'personal.view',

  // ── Project setup / registry ────────────────────────────────────────────────
  setup:           'project.view',
  projects:        'project.list.all',
  lifecycle:       'project.view',
  team:            'team.view',
  timesheets:      'team.view',
  meetings:        'project.view',
  construction:    'project.view',
  engineering:     'project.view',   // hidden route — module hub
  procurement:     'project.view',   // hidden route — module hub
  plan:            'project.view',   // hidden route
  resources:       'project.view',   // hidden route
  jobs:            'project.view',   // hidden route

  // ── Business development ────────────────────────────────────────────────────
  crm:             'crm.view',
  proposals:       'crm.view',

  // ── Planning / schedule ─────────────────────────────────────────────────────
  scheduleimport:  'schedule.view',
  forecast:        'schedule.view',
  riskregister:    'risk.view',

  // ── Commercial ──────────────────────────────────────────────────────────────
  budget:          'cost.view',
  changeorders:    'cost.view',
  costcontrol:     'cost.view',
  costentry:       'cost.view',
  evm:             'cost.view',
  billing:         'cost.view',
  costiq:          'cost.view',

  // ── Portfolio / executive ───────────────────────────────────────────────────
  portfolio:       'portfolio.view',
  portfolioiq:     'portfolio.view',
  executive:       'portfolio.view',
  predict:         'portfolio.view',
  dash:            'portfolio.view',
  overview:        'portfolio.view',  // hidden route — alternate dashboard

  // ── Engineering ─────────────────────────────────────────────────────────────
  feed:            'engineering.view',
  processdesign:   'engineering.view',
  calc:            'engineering.view',
  hub:             'engineering.view',
  fixlibrary:      'engineering.view',
  drawings:        'engineering.view',
  bim:             'engineering.view',

  // ── Documents ───────────────────────────────────────────────────────────────
  docs:            'docs.view',
  transmittals:    'docs.view',
  knowledge:       'docs.view',
  turnover:        'docs.view',

  // ── Construction ────────────────────────────────────────────────────────────
  dailylogs:       'construction.view',
  rfis:            'construction.view',
  submittals:      'construction.view',
  iot:             'construction.view',

  // ── Field ───────────────────────────────────────────────────────────────────
  field:           'field.view',
  fieldai:         'field.view',

  // ── Quality ─────────────────────────────────────────────────────────────────
  inspections:     'quality.view',
  punch:           'quality.view',
  ncr:             'quality.view',
  quality:         'quality.view',

  // ── Safety ──────────────────────────────────────────────────────────────────
  safety:          'safety.view',
  compliance:      'safety.view',

  // ── Procurement ─────────────────────────────────────────────────────────────
  subcontracts:    'procurement.view',
  vendorscore:     'procurement.view',
  procurementrisk: 'procurement.view',
  directory:       'procurement.view',

  // ── Commissioning ───────────────────────────────────────────────────────────
  commissioning:   'commissioning.view',  // hidden route

  // ── AI ──────────────────────────────────────────────────────────────────────
  ask:             'assistant.use',
  coordination:    'assistant.use',
  autopilot:       'assistant.use',

  // ── Platform ────────────────────────────────────────────────────────────────
  audit:           'audit.view',          // hidden route
  system:          'platform.admin',
  automation:      'platform.admin',
  integrations:    'platform.admin',
  mcp:             'platform.admin',
}

const ALL_CAPS: readonly Capability[] = CAPABILITIES

/**
 * Role → capabilities.
 *
 * Grants are stated by *function*, not by the nav `domain` tag the previous
 * filter keyed on — that tag was assigned for grouping, not for authorization,
 * which is why `subcontracts` (domain `construction`) was visible to an engineer
 * while `vendorscore` (domain `procurement`) was not.
 *
 * `procurement` and `field_ops` are first-class here. Under the previous filter
 * they matched no branch and fell through to the full sidebar.
 */
export const ROLE_CAPS: Record<UserRole, readonly Capability[]> = {
  owner: ALL_CAPS,
  admin: ALL_CAPS,

  project_manager: [
    'personal.view', 'project.view', 'project.list.all', 'team.view',
    'schedule.view', 'risk.view', 'engineering.view', 'docs.view',
    'construction.view', 'field.view', 'quality.view', 'safety.view',
    'procurement.view', 'commissioning.view', 'assistant.use',
  ],

  engineer: [
    'personal.view', 'project.view', 'schedule.view', 'risk.view',
    'engineering.view', 'docs.view', 'construction.view', 'quality.view',
    'assistant.use',
  ],

  procurement: [
    'personal.view', 'project.view', 'procurement.view', 'docs.view',
    'assistant.use',
  ],

  field_ops: [
    'personal.view', 'project.view', 'field.view', 'construction.view',
    'quality.view', 'safety.view', 'docs.view',
  ],

  viewer: [
    'personal.view', 'project.view', 'docs.view',
  ],
}

/** Narrowing guard — anything not in the enum is not a role. */
export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value)
}

/** The capability that opens a destination, or `undefined` if unregistered. */
export function capabilityForScreen(screenId: string): Capability | undefined {
  return Object.prototype.hasOwnProperty.call(SCREEN_CAP, screenId)
    ? SCREEN_CAP[screenId]
    : undefined
}

/**
 * The single authorization predicate.
 *
 * **Fails closed.** An unknown role, an absent role, or a destination with no
 * registry entry all deny. This is the deliberate reversal of the previous
 * behaviour, where an unrecognised role fell through to `return true` and an
 * empty filter result restored the entire sidebar.
 */
export function canSee(screenId: string, role: unknown): boolean {
  if (!isUserRole(role)) return false
  const cap = capabilityForScreen(screenId)
  if (!cap) return false
  return ROLE_CAPS[role].includes(cap)
}

/** Every destination a role may open — the sidebar projection, in registry order. */
export function visibleScreens(role: unknown): string[] {
  if (!isUserRole(role)) return []
  return Object.keys(SCREEN_CAP).filter(id => canSee(id, role))
}
