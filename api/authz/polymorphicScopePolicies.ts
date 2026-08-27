/**
 * Denver Engineering — polymorphic scope-key policy registry (ADR-014 Phase 3H)
 * ─────────────────────────────────────────────────────────────────────────────
 * Two tables in this system authorize against a POLYMORPHIC key: a kind plus a
 * free-text identifier, with no foreign key to anything.
 *
 *     operational_twins    (entity_type, entity_id)
 *     realtime_event_log   (subscription_scope, scope_id)
 *
 * Phases 3E through 3G could not close the five routes built on them, because
 * the record-scope machinery resolves a parent through a DECLARED foreign key
 * and here there is none. This registry supplies what the schema does not: for
 * every supported kind, the entity it selects and the authority that governs it.
 *
 * ─── The selector is not the authority (D24) ─────────────────────────────────
 *
 * `entity_type`, `subscription_scope`, `entity_id` and `scope_id` are chosen by
 * the caller on at least one route. They say WHAT to authorize; they are never
 * evidence that authorization holds. The order is always:
 *
 *     validate the kind is supported
 *   → validate the identifier's shape
 *   → resolve the underlying entity, inside the caller's tenant
 *   → apply that entity's own authority
 *   → only then read
 *
 * ─── Unknown is not global (D25) ─────────────────────────────────────────────
 *
 * There is no default branch and no fallback to tenant-wide. A kind with no
 * entry, or an entry declared `DENY_UNSUPPORTED`, refuses. That is what stops a
 * value added to `twin_entity_type` tomorrow from silently becoming visible
 * across the tenant, and the ratchet compares the DECLARED enum against this
 * registry as a set rather than a count.
 */
import type { ServerCapability } from './capabilities'

/**
 * What governs the entity a polymorphic key selects.
 *
 * `PLATFORM_GLOBAL` is deliberately unused today. It exists so that a genuine
 * platform entity can be declared as one rather than being smuggled in as
 * `TENANT_GLOBAL`, and the ratchet asserts nothing claims it without evidence.
 */
export type PolymorphicScopeClass =
  /** existing capability + tenant + resolved project + live project record scope */
  | 'PROJECT_SCOPED'
  /** existing capability + tenant; the entity belongs to the tenant, not a project */
  | 'TENANT_GLOBAL'
  /** existing capability + live principal ownership; NOT project membership */
  | 'SELF_SCOPED'
  /** genuinely above tenant scope, and the existing capability already says so */
  | 'PLATFORM_GLOBAL'
  /** unknown, unmodelled, or with no backing entity — fails closed */
  | 'DENY_UNSUPPORTED'

/** The shape an identifier must have before it may reach a query. */
export type ScopeIdShape =
  | 'UUID'
  /** The kind carries no identifier at all (a whole-tenant subscription). */
  | 'NONE'

/**
 * How the underlying entity is found.
 *
 * Every field here is a trusted literal from this file. None is ever taken from
 * a request, which is what makes it safe to compose SQL from them (§11).
 */
export interface PolymorphicResolver {
  /** Physical table the identifier addresses. */
  table:        string
  idColumn:     string
  tenantColumn: string
  /**
   * The record-scope resource whose policy resolves this entity's project.
   * Present only for `PROJECT_SCOPED`, absent when the id IS the project.
   */
  recordResource?: string
  /** `PROJECT_SCOPED` where the identifier is itself a project id. */
  identifierIsProject?: boolean
  /** `SELF_SCOPED`: the column naming the owning principal. */
  ownerColumn?: string
}

export interface PolymorphicScopePolicy {
  /** The enum value as the database and the TypeScript union declare it. */
  kind:      string
  class:     PolymorphicScopeClass
  idShape:   ScopeIdShape
  resolver?: PolymorphicResolver
  /**
   * The capability that already governs the routes reaching this kind. Recorded
   * so the registry cannot be read as granting anything: Phase 3H decides where
   * an existing authority applies, never who holds it.
   */
  capabilities: readonly ServerCapability[]
  /** Why this class, argued from the repository. */
  evidence:  string
}

// ─── operational_twins.entity_type ───────────────────────────────────────────

/**
 * All fourteen values of the `twin_entity_type` enum (migration 046), each with
 * exactly one class.
 *
 * Four of them — `equipment`, `permit`, `site`, `region` — have NO TABLE
 * anywhere in the migrations. They are enum values with nothing behind them, so
 * there is no entity to authorize and no honest way to admit them. They deny.
 */
export const TWIN_SCOPE_POLICIES: readonly PolymorphicScopePolicy[] = [
  {
    kind: 'project', class: 'PROJECT_SCOPED', idShape: 'UUID',
    resolver: { table: 'projects', idColumn: 'id', tenantColumn: 'tenant_id', identifierIsProject: true },
    capabilities: ['portfolio.view'],
    evidence: 'The identifier IS a project id, so authorization is the canonical project record scope with no parent lookup: an Owner reaches every project in their own tenant and nobody reaches one outside it.',
  },
  {
    kind: 'system', class: 'PROJECT_SCOPED', idShape: 'UUID',
    resolver: { table: 'systems', idColumn: 'id', tenantColumn: 'tenant_id', recordResource: 'systems' },
    capabilities: ['portfolio.view'],
    evidence: 'migration 026 declares `systems.project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE`, and the record-scope registry already carries `systems` as PROJECT_REQUIRED. The twin inherits the authority of the system it mirrors.',
  },
  {
    kind: 'subsystem', class: 'PROJECT_SCOPED', idShape: 'UUID',
    resolver: { table: 'subsystems', idColumn: 'id', tenantColumn: 'tenant_id', recordResource: 'subsystems' },
    capabilities: ['portfolio.view'],
    evidence: 'migration 026 declares `subsystems.project_id UUID NOT NULL REFERENCES projects(id)`, already PROJECT_REQUIRED in the record-scope registry. Ancestry is read from the FK, not from an assumed plant hierarchy (§22).',
  },
  {
    kind: 'tag', class: 'PROJECT_SCOPED', idShape: 'UUID',
    resolver: { table: 'tags', idColumn: 'id', tenantColumn: 'tenant_id', recordResource: 'tags' },
    capabilities: ['portfolio.view'],
    evidence: '`tags` carries `project_id` directly and is PROJECT_REQUIRED in the record-scope registry.',
  },
  {
    kind: 'inspection', class: 'PROJECT_SCOPED', idShape: 'UUID',
    resolver: { table: 'inspections', idColumn: 'id', tenantColumn: 'tenant_id', recordResource: 'inspection' },
    capabilities: ['portfolio.view'],
    evidence: '`inspections.project_id` is a direct column, PROJECT_REQUIRED in the record-scope registry since Phase 3A.',
  },
  {
    kind: 'deficiency', class: 'PROJECT_SCOPED', idShape: 'UUID',
    resolver: { table: 'deficiencies', idColumn: 'id', tenantColumn: 'tenant_id', recordResource: 'deficiencies' },
    capabilities: ['portfolio.view'],
    evidence: '`deficiencies.project_id` is a direct column, PROJECT_REQUIRED in the record-scope registry.',
  },
  {
    kind: 'action', class: 'SELF_SCOPED', idShape: 'UUID',
    resolver: { table: 'actions', idColumn: 'id', tenantColumn: 'tenant_id', ownerColumn: 'assigned_to_user_id' },
    capabilities: ['portfolio.view'],
    evidence: 'ADR-014 Phase 2C-4A established an action as a PERSONAL record owned by its assignee, and the record-scope registry carries `action` as SELF_SCOPED for that reason. An action twin must not become reachable by project membership: two people on the same project would then read each other\'s queue through the twin surface (§24, §39).',
  },
  {
    kind: 'vendor', class: 'TENANT_GLOBAL', idShape: 'UUID',
    resolver: { table: 'vendors', idColumn: 'id', tenantColumn: 'tenant_id' },
    capabilities: ['portfolio.view'],
    evidence: 'Verified rather than inherited from the name (§26). `vendors` has no project column in any migration and is NO_PROJECT_PARENT in the parsed schema; Phase 3D corrected the vendor mutations to non-project and Phase 3G corrected `GET /vendors/:id` for the same reason — its purchase-order JOIN is a count, not ownership. A vendor belongs to the tenant register.',
  },
  {
    kind: 'workforce', class: 'TENANT_GLOBAL', idShape: 'UUID',
    resolver: { table: 'team_members', idColumn: 'id', tenantColumn: 'tenant_id' },
    capabilities: ['portfolio.view'],
    evidence: 'ADR-014 Phase 3A rejected `project_assignments` as an authorization source: its `member_id` references `team_members`, an HR roster with no `user_id` and no bridge to a login principal. Phase 3G kept that separation — a member is visible while their project rows are filtered. So assignments are filterable DATA about a workforce entity, never authority over it (§27), and `team_members` is NO_PROJECT_PARENT.',
  },
  {
    kind: 'workflow', class: 'TENANT_GLOBAL', idShape: 'UUID',
    resolver: { table: 'workflows', idColumn: 'id', tenantColumn: 'tenant_id' },
    capabilities: ['portfolio.view'],
    evidence: 'migration 049 declares `workflows` with `tenant_id NOT NULL` and no project column: an automation definition — trigger config, definition JSON, publication state — belongs to the tenant. NO_PROJECT_PARENT in the parsed schema. The term covers exactly one table here, so §25\'s ambiguity case does not arise.',
  },

  // ── Enum values with no backing entity ────────────────────────────────────
  {
    kind: 'equipment', class: 'DENY_UNSUPPORTED', idShape: 'UUID',
    capabilities: ['portfolio.view'],
    evidence: 'No `equipment` (or `assets`) table exists in any migration — the parsed schema contains only `asset_scan_events` and `evidence_assets`, neither of which is an equipment register. The enum value has nothing behind it, so there is no entity to resolve and no authority to apply. Denies rather than defaulting tenant-global (§5).',
  },
  {
    kind: 'permit', class: 'DENY_UNSUPPORTED', idShape: 'UUID',
    capabilities: ['portfolio.view'],
    evidence: 'No `permits` table exists in any migration. Same reasoning as `equipment`: an enum value with no entity cannot be authorized, and guessing a project ancestry for it would be inventing product policy.',
  },
  {
    kind: 'site', class: 'DENY_UNSUPPORTED', idShape: 'UUID',
    capabilities: ['portfolio.view'],
    evidence: 'No `sites` table exists in any migration. §28 warns specifically against assuming a geographic entity belongs to every project inside it; with no table there is not even a topology to reason from.',
  },
  {
    kind: 'region', class: 'DENY_UNSUPPORTED', idShape: 'UUID',
    capabilities: ['portfolio.view'],
    evidence: 'No `regions` table exists in any migration. Same as `site` — declared in the enum, never created.',
  },
]

// ─── realtime_event_log.subscription_scope ───────────────────────────────────

/**
 * All seven values of the `SubscriptionScope` union
 * (`api/realtime/eventBroadcaster.ts`), each with exactly one class.
 *
 * Derived from the PRODUCERS — the eight `broadcastEvent` call sites — not from
 * rows or fixtures (§7), because what `scope_id` MEANS is decided by whoever
 * writes it.
 */
export const REALTIME_SCOPE_POLICIES: readonly PolymorphicScopePolicy[] = [
  {
    kind: 'tenant', class: 'TENANT_GLOBAL', idShape: 'NONE',
    capabilities: ['crossdomain.read'],
    evidence: 'Four producers write this scope and none supplies a `scope_id`: ops.ts:346 (incident_reported) and runbookEngine at 107, 290 and 357. These are tenant-level operational events with no narrower subject, so the tenant predicate is the whole of their scope.',
  },
  {
    kind: 'action', class: 'SELF_SCOPED', idShape: 'UUID',
    resolver: { table: 'actions', idColumn: 'id', tenantColumn: 'tenant_id', ownerColumn: 'assigned_to_user_id' },
    capabilities: ['crossdomain.read'],
    evidence: 'ops.ts:220 writes `scope_id: actionId` for `action_updated`, and the payload carries `assigned_to` reassignment detail. The subject is an action, which Phase 2C-4A made a personal record — so the event follows its subject\'s ownership, not project membership.',
  },
  {
    kind: 'escalation', class: 'SELF_SCOPED', idShape: 'UUID',
    resolver: { table: 'actions', idColumn: 'id', tenantColumn: 'tenant_id', ownerColumn: 'assigned_to_user_id' },
    capabilities: ['crossdomain.read'],
    evidence: 'ops.ts:258 writes `scope_id: actionId` for `escalation_triggered` — a different event type over the SAME subject as `action`. It therefore takes the same ownership rule; classing it separately would let an escalation disclose an action its own scope hides.',
  },
  {
    kind: 'readiness', class: 'DENY_UNSUPPORTED', idShape: 'UUID',
    capabilities: ['crossdomain.read'],
    evidence: 'TWO producers write this scope with DIFFERENT identifier kinds. universalEvents.ts:117 writes `scope_id: envelope.project_id ?? undefined` — a project id, or nothing. commissioningWebhook.ts:60 writes `scope_id: evt.handoff_id` — a commissioning handoff id from an external system. One value, two meanings, and nothing in the row records which producer wrote it. Authorizing it as a project would admit handoff events on a failed lookup or refuse them on a successful one, depending on which way the ambiguity is resolved — so it fails closed until a producer contract decides. Recorded as the Phase-3H deferral rather than guessed (§5, §84).',
  },
  {
    kind: 'project', class: 'DENY_UNSUPPORTED', idShape: 'UUID',
    capabilities: ['crossdomain.read'],
    evidence: 'Declared in the `SubscriptionScope` union and accepted by the subscription manager, but NO producer writes it — none of the eight `broadcastEvent` call sites emits `subscription_scope: \'project\'`. An unproduced scope matches no rows today; it is declared DENY_UNSUPPORTED so that adding a producer later must also add a policy rather than inheriting tenant-wide visibility (§31).',
  },
  {
    kind: 'module', class: 'DENY_UNSUPPORTED', idShape: 'UUID',
    capabilities: ['crossdomain.read'],
    evidence: 'Declared in the union, written by no producer, and `scope_id` would name a module — a concept with no table in the schema. Fails closed for the same reason as `project`.',
  },
  {
    kind: 'assignee', class: 'DENY_UNSUPPORTED', idShape: 'UUID',
    capabilities: ['crossdomain.read'],
    evidence: 'Declared in the union and written by no producer. Its identifier would be a user id, which would make it SELF-shaped — but with no producer there is no contract to confirm that, and guessing one would decide who may read another principal\'s event stream. Fails closed.',
  },
]

// ─── Lookup and counters ─────────────────────────────────────────────────────

const TWIN_BY_KIND     = new Map(TWIN_SCOPE_POLICIES.map(p => [p.kind, p]))
const REALTIME_BY_KIND = new Map(REALTIME_SCOPE_POLICIES.map(p => [p.kind, p]))

/**
 * The policy for a twin entity type, or `null`.
 *
 * `null` means DENY. There is no permissive fallback: a kind added to the enum
 * without an entry here is refused rather than inheriting tenant-wide reach.
 */
export function twinScopePolicy(kind: string): PolymorphicScopePolicy | null {
  return TWIN_BY_KIND.get(kind) ?? null
}

/** The policy for a realtime subscription scope, or `null` (= DENY). */
export function realtimeScopePolicy(kind: string): PolymorphicScopePolicy | null {
  return REALTIME_BY_KIND.get(kind) ?? null
}

export interface PolymorphicScopeCounters {
  total: number
  projectScoped: number
  tenantGlobal: number
  selfScoped: number
  platformGlobal: number
  denyUnsupported: number
  unexplained: number
}

/** Machine-derived, so the completion report cannot overstate the closure. */
export function polymorphicScopeCounters(
  policies: readonly PolymorphicScopePolicy[],
): PolymorphicScopeCounters {
  const by = (c: PolymorphicScopeClass): number => policies.filter(p => p.class === c).length
  return {
    total:           policies.length,
    projectScoped:   by('PROJECT_SCOPED'),
    tenantGlobal:    by('TENANT_GLOBAL'),
    selfScoped:      by('SELF_SCOPED'),
    platformGlobal:  by('PLATFORM_GLOBAL'),
    denyUnsupported: by('DENY_UNSUPPORTED'),
    // A class without an argument is a gap wearing a label.
    unexplained:     policies.filter(p => p.evidence.length < 80).length,
  }
}
