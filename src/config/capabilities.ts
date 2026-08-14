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
 * THE SUBJECT IS THE AUTHENTICATED ROLE. Every predicate here takes
 * `auth.role` — the role the server put in the JWT and `LoginScreen` stored —
 * as its first argument. The OwnerPanel role picker is a *preview* only: it is
 * passed separately and can only ever *narrow* the result (set intersection).
 * A client-controlled value can therefore never widen authority, which is the
 * defect this file previously had (it read `ownerConfig.activeRole` alone).
 *
 * SCOPE — this is a *view* gate plus `effectiveWriteRole()` for the
 * preview-narrowing of write affordances. Which roles may write at all still
 * lives in `POLICY_ACTIONS` / `PERSONAS` and is unchanged.
 *
 * NOT A SECURITY BOUNDARY ON ITS OWN. Client-side gating hides what a user may
 * not open; it does not stop a crafted request. Server enforcement
 * (`requireCapability`) is ADR-014 Phase 2 and is not yet implemented — until it
 * lands, the API remains the authoritative gap.
 *
 * Usage:
 *   import { canSee } from '../config/capabilities'
 *   if (!canSee(tabId, auth.role, previewRole)) renderRestricted()
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

  // ── AI ──────────────────────────────────────────────────────────────────────
  ask:             'assistant.use',
  coordination:    'assistant.use',
  autopilot:       'assistant.use',

  // ── Platform ────────────────────────────────────────────────────────────────
  system:          'platform.admin',
  automation:      'platform.admin',
  integrations:    'platform.admin',
  mcp:             'platform.admin',

  // ── Hidden / deep-link-only destinations ────────────────────────────────────
  // Present in the router's TAB_MAP but absent from NAVIGATION_ITEMS, so they are
  // reachable only by `?tab=`, a persisted `ui.activeTab`, or a programmatic
  // setTab. Each is mapped to the capability matching *what it renders*, not to a
  // generic one. Five of these previously shared `project.view`, which every role
  // holds — so a stale bookmark opened the procurement and engineering module hubs
  // for a viewer. Hidden is not a permission.
  commissioning:   'commissioning.view',  // CommissioningView
  audit:           'audit.view',          // AuditLogView — tenant audit reader
  overview:        'portfolio.view',      // DashboardMainView — portfolio roll-up
  engineering:     'engineering.view',    // EngineeringView — deliverables, transmittals, calc
  procurement:     'procurement.view',    // ProcurementView — vendors, POs, bids
  plan:            'procurement.view',    // PlannerView — logistics + bid items
  resources:       'team.view',           // ResourcesView → LiView — labour items, rates
  jobs:            'project.list.all',    // JobsView — org-wide contracts/jobs register
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
  /** Tenant owner — the only role holding every capability. */
  owner: ALL_CAPS,

  /**
   * Platform Administrator — platform operations, *not* project delivery.
   *
   * `admin` previously aliased `ALL_CAPS`, making it a second owner. It is not:
   * it administers the tenant's platform (settings, automation, integrations,
   * MCP) and reads the audit trail. It deliberately holds no portfolio, no
   * org-wide project registry, no project delivery, engineering, construction,
   * commissioning, commercial or CRM capability — a platform administrator has
   * no business reason to read the tenant's cost or customer data.
   *
   * Known consequence: `personal.view` is withheld too, because that capability
   * bundles the project delivery queues (`focus`, `mywork`, `actions`) with
   * `notifications`. An admin therefore has no personal inbox. Splitting
   * `notifications` out is a product decision, not an authorization one.
   */
  admin: ['platform.admin', 'audit.view'],

  /**
   * Project delivery depth — but not a portfolio role. Holds neither
   * `portfolio.view` nor `project.list.all`: a project manager manages assigned
   * projects, not the organisation-wide registry. See ADR-014 for the resulting
   * project-entry gap, which belongs to Phase 3 record scope, not to a wider grant.
   */
  project_manager: [
    'personal.view', 'project.view', 'team.view',
    'schedule.view', 'risk.view', 'engineering.view', 'docs.view',
    'construction.view', 'field.view', 'quality.view', 'safety.view',
    'procurement.view', 'commissioning.view', 'assistant.use',
  ],

  engineer: [
    'personal.view', 'project.view', 'schedule.view', 'risk.view',
    'engineering.view', 'docs.view', 'construction.view', 'quality.view',
    'assistant.use',
  ],

  /**
   * KNOWN GAP — procurement has no schedule visibility. Required-on-site dates
   * live behind `schedule.view`, but that capability also opens `forecast`
   * (Monte Carlo schedule simulation), which is not procurement's business.
   * Granting it would over-grant to make the matrix look complete, so it is
   * withheld. The fix is to split `schedule.view` into dated-milestone read vs
   * forecast/simulation — a capability-design change, recorded for Phase 2.
   */
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
 * The effective capability set — the one place authority is computed.
 *
 * `authRole` is the authenticated role (`auth.role`, from the JWT). `previewRole`
 * is the OwnerPanel picker, which is client-controlled and therefore may only
 * ever *remove* capabilities:
 *
 *     no valid authenticated role        → ∅
 *     valid auth, no/invalid preview     → the authenticated capabilities
 *     valid auth + valid preview         → auth ∩ preview
 *
 * Set intersection, deliberately: roles are **not** a hierarchy and are not
 * subsets of one another. An engineer previewing procurement gets
 * engineer ∩ procurement — it must not acquire `procurement.view` merely because
 * procurement holds fewer capabilities overall. Nothing here ranks, counts or
 * orders roles, and adding such a shortcut would reintroduce elevation.
 */
export function effectiveCapabilities(authRole: unknown, previewRole?: unknown): readonly Capability[] {
  if (!isUserRole(authRole)) return []
  const granted = ROLE_CAPS[authRole]
  if (!isUserRole(previewRole) || previewRole === authRole) return granted
  const preview = ROLE_CAPS[previewRole]
  return granted.filter(cap => preview.includes(cap))
}

/**
 * The single authorization predicate. Read by both the sidebar projection
 * ([NavSidebar]) and the route guard ([ContentRouter]) — there is no second table.
 *
 * **Fails closed.** An absent authenticated role, an unknown one, or a
 * destination with no registry entry all deny. This is the deliberate reversal
 * of the original behaviour, where an unrecognised role fell through to
 * `return true` and an empty filter result restored the entire sidebar.
 */
export function canSee(screenId: string, authRole: unknown, previewRole?: unknown): boolean {
  const cap = capabilityForScreen(screenId)
  if (!cap) return false
  return effectiveCapabilities(authRole, previewRole).includes(cap)
}

/** Every destination the effective capabilities open, in registry order. */
export function visibleScreens(authRole: unknown, previewRole?: unknown): string[] {
  const caps = effectiveCapabilities(authRole, previewRole)
  if (!caps.length) return []
  return Object.keys(SCREEN_CAP).filter(id => {
    const cap = capabilityForScreen(id)
    return !!cap && caps.includes(cap)
  })
}

/**
 * The role downstream views must use for write/affordance checks
 * (`policy.activeRole !== 'viewer'`, `PERSONAS[role]`).
 *
 * Binding navigation to `auth.role` without this would leave a second elevation
 * path open: an authenticated viewer whose stored preview is `owner` would still
 * satisfy every `activeRole !== 'viewer'` affordance check. Preview may only
 * reduce here too, so previewing `viewer` makes the UI read-only and an
 * authenticated `viewer` stays read-only whatever the preview says.
 *
 * This narrows the *preview*; it does not change which roles may write at all.
 * That still lives in `POLICY_ACTIONS` / `PERSONAS` — see ADR-014 for the
 * residual fail-open there, which needs product semantics to close.
 */
export function effectiveWriteRole(authRole: unknown, previewRole?: unknown): UserRole {
  if (!isUserRole(authRole)) return 'viewer'
  if (isUserRole(previewRole) && previewRole === 'viewer') return 'viewer'
  return authRole
}
