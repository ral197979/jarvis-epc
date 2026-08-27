/**
 * Denver Engineering — transition-owned state registry (ADR-014 Phase 2A-2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 2A protected the *routes* that name a consequential verb. It did not
 * protect the *states* those routes own. A generic CRUD endpoint that accepts
 *
 *     PATCH /punch-items/:id   { "status": "closed" }
 *
 * reaches exactly the state `POST /punch-items/:id/close` exists to guard, and
 * the path-based ratchet could not see it: there is no verb in `/punch-items/:id`
 * to match. That is the blind spot this file closes.
 *
 * The rule (owner decision, ADR-014 Phase 2A-2 §4)
 * ───────────────────────────────────────────────
 * A state owned by a consequential transition may not be written directly
 * through a generic CRUD endpoint — **even by a caller who holds the transition
 * capability, and even by Owner**. The canonical route owns authorization,
 * state-machine validation, audit behaviour, timestamps/signatures and any
 * downstream side effect. Permitting both paths would be two implementations of
 * one workflow, and only one of them would be enforced.
 *
 * So this is not a role check. `guardTransitionOwnedState` rejects the request
 * on the shape of the mutation, before any business mutation occurs and without
 * consulting the caller's role at all. Authorization for the canonical route
 * stays where it belongs: `requireCapability` on that route.
 *
 * Source of truth
 * ───────────────
 * `transitionOwned[].value` is the literal the canonical transition handler
 * writes (`SET status='closed'`), and `canonical`/`capability` are asserted
 * against `ENFORCED_TRANSITIONS` by the status-write ratchet — so a renamed
 * route, a swapped capability or a deleted transition fails the build rather
 * than silently orphaning a policy. `ordinary` is the explicit complement: the
 * values an ordinary writer may still set. Every state a generic endpoint can
 * write must appear in exactly one of the two lists, so no state is unclassified.
 */
import { Response, NextFunction, RequestHandler } from 'express'
import type { ServerCapability } from './capabilities'

/** A state value only its canonical transition may write. */
export interface TransitionOwnedState {
  /** Literal the canonical transition handler writes. */
  value:      string
  /** Canonical transition, `METHOD /path` as declared on its router. */
  canonical:  string
  /** Capability that transition requires. Asserted against the registry. */
  capability: ServerCapability
}

/** How one state column of one entity is classified. */
export interface StatePolicy {
  /** Table the column lives on. */
  entity:          string
  /** Column name. */
  field:           string
  /** Request-body keys that write it through a generic mutation. */
  bodyKeys:        readonly string[]
  transitionOwned: readonly TransitionOwnedState[]
  /** Values an ordinary writer may set. Must not intersect the above. */
  ordinary:        readonly string[]
  /** Generic mutation endpoints that write it, `file router.METHOD path`. */
  genericEndpoints: readonly string[]
  /** Why the ordinary set is ordinary — reviewed, not assumed. */
  note:            string
}

/**
 * Fields reserved to a canonical transition regardless of the value written.
 *
 * Some transitions are not expressible as one status literal. Completing an
 * inspection writes `status='completed'` *and* stamps `completed_date`,
 * `signatures` and the computed `overall_result`. Reserving only the status
 * would leave a generic caller able to assemble a record that is a completed
 * inspection in every respect an auditor would check — signed, dated, resulted —
 * while carrying a different status string (ADR-014 Phase 2A-2 §6.2).
 */
export interface ReservedFieldPolicy {
  entity:           string
  /** Body keys the generic endpoint may not write at all. */
  fields:           readonly string[]
  canonical:        string
  capability:       ServerCapability
  genericEndpoints: readonly string[]
  reason:           string
}

// ─── Policies ─────────────────────────────────────────────────────────────────

export const STATE_POLICIES: readonly StatePolicy[] = [
  {
    entity: 'punch_items', field: 'status', bodyKeys: ['status'],
    transitionOwned: [
      { value: 'verified', canonical: 'POST /punch-items/:id/verify', capability: 'quality.verify' },
      { value: 'closed',   canonical: 'POST /punch-items/:id/close',  capability: 'quality.verify' },
    ],
    ordinary: ['open', 'in_progress', 'ready_for_review'],
    genericEndpoints: [
      'punchLists.ts router.PATCH /punch-items/:id',
      'punchLists.ts router.POST /punch-lists/:id/items',
    ],
    note: 'The verify and close routes stamp verified_by/verified_at and closed_by/closed_at. '
        + 'Everything before sign-off — raising an item, working it, offering it for review — stays ordinary quality work.',
  },
  {
    entity: 'inspections', field: 'status', bodyKeys: ['status'],
    transitionOwned: [
      { value: 'completed', canonical: 'POST /inspections/:id/complete', capability: 'quality.verify' },
    ],
    ordinary: ['scheduled', 'in_progress', 'cancelled'],
    genericEndpoints: [
      'inspections.ts router.PATCH /inspections/:id',
      'inspections.ts router.POST /projects/:projectId/inspections',
    ],
    note: 'Scheduling, walking and cancelling an inspection are ordinary quality work. Only the '
        + 'completion verdict is a quality gate; see the reserved-field policy for its evidence columns.',
  },
  {
    entity: 'purchase_orders', field: 'status', bodyKeys: ['status'],
    transitionOwned: [
      { value: 'approved', canonical: 'POST /:id/approve', capability: 'procurement.approve' },
    ],
    ordinary: ['draft', 'pending_approval', 'issued', 'partial_delivery', 'delivered', 'invoiced', 'closed', 'cancelled'],
    genericEndpoints: ['procurement.ts purchaseOrdersRouter.PATCH /:id'],
    note: 'po_status enum minus the approval verdict. Raising a PO to pending_approval, and the '
        + 'downstream fulfilment states an approved PO passes through, are ordinary procurement work. '
        + 'Only `approved` commits spend, and only the canonical route stamps approved_by/approved_at.',
  },
  {
    entity: 'vendors', field: 'status', bodyKeys: ['status'],
    transitionOwned: [
      { value: 'approved', canonical: 'POST /:id/approve', capability: 'procurement.approve' },
    ],
    ordinary: ['prospect', 'qualified', 'preferred', 'suspended', 'blacklisted'],
    genericEndpoints: ['procurement.ts vendorsRouter.PATCH /:id'],
    note: 'vendor_status enum minus approval. Discovered by the hardened audit, not the original ten: '
        + 'the generic PATCH stamped approved_by/approved_at whenever the body said approved, so it was '
        + 'recording an approval without requiring approval authority. `preferred`, `suspended` and '
        + '`blacklisted` also read as commercially consequential but stamp no approver and have no '
        + 'canonical route or established capability — classified ordinary and reported for owner review.',
  },
  {
    entity: 'projects', field: 'status', bodyKeys: ['status'],
    transitionOwned: [
      { value: 'completed', canonical: 'POST /:id/close', capability: 'project.approve' },
      { value: 'cancelled', canonical: 'POST /:id/close', capability: 'project.approve' },
    ],
    ordinary: ['planning', 'active', 'on_hold'],
    genericEndpoints: ['projects.ts router.PATCH /:id'],
    note: 'project_status enum minus the two terminal outcomes. Putting a project on hold and taking it '
        + 'off hold is ordinary delivery management; completing or cancelling one ends the commercial '
        + 'relationship, which the capability registry already calls project closure.',
  },
  {
    entity: 'submittals', field: 'status', bodyKeys: ['status'],
    transitionOwned: [
      { value: 'approved',           canonical: 'POST /:id/review', capability: 'construction.approve' },
      { value: 'approved_as_noted',  canonical: 'POST /:id/review', capability: 'construction.approve' },
      { value: 'revise_resubmit',    canonical: 'POST /:id/review', capability: 'construction.approve' },
      { value: 'rejected',           canonical: 'POST /:id/review', capability: 'construction.approve' },
    ],
    ordinary: ['draft', 'submitted', 'under_review'],
    genericEndpoints: ['procurement.ts submittalsRouter.PATCH /:id'],
    note: 'The submittal PATCH already refused terminal stamps inline and pointed callers at the review '
        + 'route — the canonical-path rule, implemented once, by hand. Moved into the registry so the '
        + 'ratchet enforces it rather than trusting the handler to keep doing it, and so the four review '
        + 'verdicts are classified data rather than a literal in one function.',
  },
  {
    entity: 'risks', field: 'status', bodyKeys: ['status'],
    transitionOwned: [
      { value: 'closed', canonical: 'POST /risks/:id/close', capability: 'risk.approve' },
    ],
    ordinary: ['open', 'mitigating', 'accepted', 'occurred'],
    genericEndpoints: ['riskRegister.ts riskRegisterRouter.PATCH /risks/:id'],
    note: 'risk_status enum minus closure. `occurred` records that a risk materialised and `accepted` '
        + 'that it is being carried — both are the risk owner reporting reality, not deciding it, and '
        + 'neither has a consequence-specific capability or canonical route in the current product. '
        + 'Classified ordinary and reported for owner review (ADR-014 Phase 2A-2 §20).',
  },
  {
    entity: 'daily_logs', field: 'status', bodyKeys: ['status'],
    transitionOwned: [
      { value: 'submitted', canonical: 'POST /daily-logs/:id/submit',  capability: 'construction.write' },
      { value: 'approved',  canonical: 'POST /daily-logs/:id/approve', capability: 'construction.approve' },
    ],
    ordinary: ['draft', 'rejected'],
    genericEndpoints: [
      'dailyLogs.ts router.PATCH /daily-logs/:id',
      'dailyLogs.ts router.POST /projects/:projectId/daily-logs',
    ],
    note: 'Submission is transition-owned even though it shares construction.write with ordinary '
        + 'editing (ADR-014 Phase 2A-2 §6.5): the dedicated route stamps submitted_by/submitted_at, so '
        + 'a generic PATCH to `submitted` would produce a submitted log with no submitter on record.',
  },
  {
    entity: 'ncrs', field: 'status', bodyKeys: ['status'],
    transitionOwned: [
      { value: 'closed', canonical: 'POST /ncrs/:id/close', capability: 'quality.verify' },
    ],
    ordinary: ['open', 'investigating', 'corrective_action', 'verification'],
    genericEndpoints: ['ncr.ts router.PATCH /ncrs/:id'],
    note: 'ncr_status enum minus closure. Investigating a non-conformance and recording its '
        + 'disposition are ordinary quality work; closing one asserts the non-conformance is resolved.',
  },
  {
    entity: 'corrective_actions', field: 'status', bodyKeys: ['status'],
    transitionOwned: [
      { value: 'verified', canonical: 'POST /capas/:id/verify', capability: 'quality.verify' },
    ],
    ordinary: ['open', 'in_progress', 'completed'],
    genericEndpoints: ['ncr.ts router.PATCH /capas/:id'],
    note: 'capa_status enum minus verification. The assignee may drive their own corrective action to '
        + '`completed`; attesting that it worked is the quality gate and stamps verified_at.',
  },
  {
    entity: 'turnover_packages', field: 'status', bodyKeys: ['status'],
    transitionOwned: [
      { value: 'accepted', canonical: 'POST /turnover-packages/:id/accept', capability: 'commissioning.approve' },
    ],
    ordinary: ['open', 'ready_for_commissioning', 'in_commissioning', 'ready_for_turnover'],
    genericEndpoints: ['turnover.ts router.PATCH /turnover-packages/:id'],
    note: 'HANDOFF_FLOW minus acceptance. Moving a package along the handover flow is ordinary '
        + 'commissioning work; accepting it transfers custody of the asset to the owner.',
  },
]

export const RESERVED_TRANSITION_FIELDS: readonly ReservedFieldPolicy[] = [
  {
    entity: 'inspections',
    fields: ['completed_date', 'signatures', 'overall_result', 'pass_count', 'fail_count', 'na_count'],
    canonical: 'POST /inspections/:id/complete', capability: 'quality.verify',
    genericEndpoints: [
      'inspections.ts router.PATCH /inspections/:id',
      'inspections.ts router.POST /projects/:projectId/inspections',
    ],
    reason: 'These are the completion verdict and its evidence. The canonical route computes the counts '
          + 'and overall_result from the recorded results rather than accepting them, so a generic writer '
          + 'that could set them would be able to assert a passing signed inspection that no checklist supports. '
          + '`results` — the checklist itself — remains ordinary: inspectors fill it in before completion.',
  },
  {
    entity: 'projects',
    fields: ['current_phase'],
    canonical: 'POST /projects/:projectId/advance', capability: 'project.approve',
    genericEndpoints: ['projects.ts router.PATCH /:id'],
    reason: 'The phase machine is what POST /advance exists to drive — it checks the gates for the current '
          + 'phase before moving. A generic PATCH that could set current_phase directly would skip every gate '
          + 'check, which is the whole control the lifecycle service provides.',
  },
]

/**
 * Mutation endpoints that write a workflow-state field whose values are all
 * ordinary — no consequential transition owns any of them today.
 *
 * This list is not an exemption, it is the third answer the ratchet accepts:
 * "reviewed, and nothing here is transition-owned". The distinction matters
 * because the moment a consequential transition IS registered for one of these
 * entities, its state stops being unclassified and the intersection invariant
 * starts applying to it — which is exactly what did not happen when NCR closure,
 * CAPA verification and turnover acceptance were added without a transition.
 */
export interface OrdinaryStateWriter {
  /** `file router.METHOD path`. */
  endpoint: string
  reason:   string
}

export const ORDINARY_STATE_WRITERS: readonly OrdinaryStateWriter[] = [
  // ── Operational tracking: open → in progress → done, no approver recorded ───
  { endpoint: 'actions.ts actionsRouter.PATCH /:id',
    reason: 'action_status is open/in_progress/overdue/completed/cancelled — a to-do item worked by its '
          + 'assignee. Completing your own action stamps no approver and decides nothing for anyone else.' },
  { endpoint: 'schedule.ts router.PATCH /tasks/:id',
    reason: 'Schedule task progress. Marking an activity complete reports what happened in the field; the '
          + 'consequential schedule decision is the baseline, which this endpoint cannot touch.' },
  { endpoint: 'budgets.ts router.PATCH /budgets/:id',
    reason: 'Budget header status alongside name/currency/baseline_date. Budget approval is not modelled '
          + 'here at all — commercial approval runs through change orders and estimates, which are guarded.' },
  { endpoint: 'punchLists.ts router.PATCH /punch-lists/:id',
    reason: 'The list header, not its items. Its status is a free-text rollup label with no enum, no '
          + 'terminal value and no transition; the sign-off that matters happens per item and is guarded.' },
  { endpoint: 'punchLists.ts router.POST /projects/:projectId/punch-lists',
    reason: 'Creates the list header. Same rollup label as the PATCH above; the item states it summarises '
          + 'are guarded on punch_items.' },

  // ── Commissioning tracking (states report test progress, not acceptance) ────
  { endpoint: 'commissioningItems.ts commissioningItemsRouter.POST /commissioning-items',
    reason: 'Commissioning check-item progress. Acceptance of the resulting package is the consequential '
          + 'step and is guarded on turnover_packages; an individual check records a test result.' },
  { endpoint: 'commissioningItems.ts commissioningItemsRouter.PATCH /commissioning-items/:itemId',
    reason: 'As above — updates one check item\'s progress. The commissioning pack finalize and autosign '
          + 'arbitration routes hold the consequential authority for this domain.' },
  { endpoint: 'deficiencies.ts deficienciesRouter.POST /deficiencies',
    reason: 'Commissioning deficiency tracking. Closing a deficiency is evidenced by the punch and NCR '
          + 'workflows, both of which are guarded; this list records findings.' },
  { endpoint: 'deficiencies.ts deficienciesRouter.PATCH /deficiencies/:deficiencyId',
    reason: 'As above — updates one deficiency\'s progress state. No approver is stamped and no downstream '
          + 'commercial or custody effect follows.' },
  { endpoint: 'testPacks.ts testPacksRouter.PATCH /test-packs/:packId',
    reason: 'Test pack execution progress. The turnover acceptance that depends on completed test packs is '
          + 'the guarded transition; pack status reports how far testing has got.' },
  { endpoint: 'systems.ts systemsRouter.POST /projects/:projectId/systems',
    reason: 'System register entry. Status here is commissioning readiness of an asset record, not a '
          + 'decision — custody transfer is guarded on turnover_packages.' },
  { endpoint: 'systems.ts systemsRouter.PATCH /systems/:systemId',
    reason: 'As above, for an existing system record.' },
  { endpoint: 'systems.ts systemsRouter.POST /systems/:systemId/subsystems',
    reason: 'Subsystem register entry, same readiness semantics as its parent system.' },
  { endpoint: 'systems.ts systemsRouter.PATCH /subsystems/:subsystemId',
    reason: 'As above, for an existing subsystem record.' },
  { endpoint: 'systems.ts systemsRouter.POST /systems/:systemId/tags',
    reason: 'Instrument tag register entry; status tracks whether the tag has been commissioned.' },
  { endpoint: 'systems.ts systemsRouter.PATCH /tags/:tagId',
    reason: 'As above, for an existing tag record.' },

  // ── Safety: candidate consequential states, flagged for owner decision ──────
  { endpoint: 'safety.ts router.PATCH /safety/observations/:id',
    reason: 'open/actioned/closed. Closing a safety observation reads as consequential, but it stamps no '
          + 'approver, has no canonical route and safety.approve is currently scoped to compliance-task '
          + 'completion. Classified ordinary and REPORTED for owner decision (ADR-014 Phase 2A-2 §20).' },
  { endpoint: 'safety.ts router.PATCH /safety/incidents/:id',
    reason: 'reported/investigating/corrective/closed. Same finding as observations, and more material: '
          + 'closing an incident ends an investigation. No approver stamped, no canonical route today. '
          + 'Classified ordinary and REPORTED for owner decision (ADR-014 Phase 2A-2 §20).' },

  // ── BIM (already reviewed and reclassified in Phase 2A) ────────────────────
  { endpoint: 'bim.ts router.PATCH /bim-issues/:id',
    reason: 'Re-confirmed from Phase 2A: status is one of eight updatable columns on a coordination issue, '
          + 'with no consequence-specific transition owning any value. Now tracked by the status ratchet, '
          + 'so registering a BIM transition later forces this classification to be revisited.' },
  { endpoint: 'bim.ts router.POST /projects/:projectId/bim-issues',
    reason: 'Creates a coordination issue in the same state universe as the PATCH above.' },
  { endpoint: 'bim.ts router.PATCH /bim-models/:id',
    reason: 'Model upload/processing state (bim_element_status), a pipeline state rather than a business '
          + 'decision. No transition owns any value.' },
  { endpoint: 'bim.ts router.POST /projects/:projectId/bim-models',
    reason: 'Registers a model in the same pipeline-state universe as the PATCH above.' },

  // ── Platform / integration pipeline states, not business decisions ─────────
  { endpoint: 'enterprise.ts router.PATCH /tickets/:id/status',
    reason: 'Support ticket workflow. Ticket escalation IS registered as a transition and guarded; moving a '
          + 'ticket through its queue states is support operations.' },
  { endpoint: 'integrations.ts integrationsRouter.PATCH /:id',
    reason: 'Connector enable/disable state. Consequential connector operations — job completion, Nova '
          + 'retry — are registered transitions under platform.integrations.' },
  { endpoint: 'policies.ts policiesRouter.PATCH /:id',
    reason: 'Governance policy record status (draft/active). Policy enforcement decisions are evaluated at '
          + 'runtime from the policy body; this endpoint edits the record.' },
  { endpoint: 'twin.ts router.PATCH /:twinId/status',
    reason: 'Digital-twin sync health, written by the twin pipeline rather than decided by a person.' },
  { endpoint: 'twin.ts router.POST /:twinId/sync',
    reason: 'Writes observed twin state from a sync run; `state` here is sensor/model data, not workflow.' },
  { endpoint: 'twin.ts router.POST /register-sync',
    reason: 'Registers a sync source and its initial observed state; same data semantics as /sync.' },
  { endpoint: 'twin.ts router.POST /:twinId/snapshots',
    reason: 'Captures a point-in-time twin state snapshot; `state` is the captured payload, not a status.' },
]

// ─── Lookup ───────────────────────────────────────────────────────────────────

const BY_ENTITY = new Map<string, StatePolicy[]>()
for (const p of STATE_POLICIES) BY_ENTITY.set(p.entity, [...(BY_ENTITY.get(p.entity) ?? []), p])

const RESERVED_BY_ENTITY = new Map<string, ReservedFieldPolicy[]>()
for (const p of RESERVED_TRANSITION_FIELDS) RESERVED_BY_ENTITY.set(p.entity, [...(RESERVED_BY_ENTITY.get(p.entity) ?? []), p])

/** Entities this registry can guard. */
export const GUARDED_ENTITIES: readonly string[] = [...new Set([...BY_ENTITY.keys(), ...RESERVED_BY_ENTITY.keys()])]

export interface StateViolation {
  /** Body key that was refused. */
  field:     string
  /** The transition-owned value, when the refusal was value-specific. */
  value?:    string
  /** Canonical transition that owns it. */
  canonical: string
}

/**
 * Does this request body attempt to write a state the entity's canonical
 * transitions own? Returns the first violation, or null.
 *
 * Deliberately role-blind: the answer is a property of the request, not the
 * caller (ADR-014 Phase 2A-2 §33).
 */
export function transitionOwnedViolation(entity: string, body: unknown): StateViolation | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>

  for (const policy of BY_ENTITY.get(entity) ?? []) {
    for (const key of policy.bodyKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) continue
      const raw = b[key]
      if (raw == null) continue
      const owned = policy.transitionOwned.find(t => t.value === String(raw))
      if (owned) return { field: key, value: owned.value, canonical: owned.canonical }
    }
  }

  for (const policy of RESERVED_BY_ENTITY.get(entity) ?? []) {
    for (const key of policy.fields) {
      if (Object.prototype.hasOwnProperty.call(b, key)) {
        return { field: key, canonical: policy.canonical }
      }
    }
  }

  return null
}

/**
 * Refuse a generic mutation that names a transition-owned state.
 *
 * Runs before the handler, so nothing is written and no partial update occurs:
 * the request is rejected whole (ADR-014 Phase 2A-2 §14). 422 rather than 403 —
 * this is not an authorization denial, and answering 403 would tell a caller
 * holding the transition capability that they merely need a bigger role, which
 * is the opposite of true. The response names the canonical route so the client
 * can retry correctly, and no capability, so the policy structure stays private.
 */
export function guardTransitionOwnedState(entity: string): RequestHandler {
  // A typo in an entity name would silently guard nothing. Fail at registration.
  if (!GUARDED_ENTITIES.includes(entity)) {
    throw new Error(`[authz] no transition-state policy for entity: ${entity}`)
  }

  return (req, res: Response, next: NextFunction): void => {
    const violation = transitionOwnedViolation(entity, req.body)
    if (violation) {
      res.status(422).json({
        error:     'transition_state_not_writable',
        message:   `'${violation.field}' is owned by a workflow transition and cannot be set through this endpoint.`,
        field:     violation.field,
        canonical: violation.canonical,
      })
      return
    }
    next()
  }
}
