/**
 * Denver Engineering — notification source policy (ADR-014 Phase 2C-4B)
 * ─────────────────────────────────────────────────────────────────────────────
 * The rule this file exists to enforce:
 *
 *   receiving a notification must never disclose information the recipient
 *   could not read from the source domain itself.
 *
 * That was the second half of the notification defect. The first half was that
 * `notifications` had no recipient at all; the second is that the alert bodies
 * are not neutral. They embed the source record's contents verbatim —
 * "ACWP $412,300 has exceeded revised budget $390,000", "$88,410 from Ellis
 * Mechanical awaiting review", client names against bid deadlines. Fanning those
 * out to everyone with a Personal Inbox would hand cost, CRM and procurement
 * data to roles ADR-014 Phase 2B-1 deliberately keeps away from it.
 *
 * So every generator declares the capabilities its OUTPUT discloses, derived
 * from the tables it actually reads, and the event stores them. Two consequences
 * follow, and both are load-bearing:
 *
 *   fan-out time   a user only receives an alert if they hold every capability
 *   access time    the check runs AGAIN against the live principal, because a
 *                  delivery row is not permanent authorization — a demoted user
 *                  must stop seeing what they were sent while authorized
 *
 * Audience strategies
 * ───────────────────
 *   DIRECT_USER          the source row names a user (an action's assignee).
 *                        Only that user, and only if still eligible.
 *   CAPABILITY_HOLDERS   genuinely tenant-level, but bounded to known domains.
 *                        Everyone holding all of them.
 *   LEGACY_OWNER_ONLY    pre-2C-4B rows with no trustworthy recipient identity.
 *                        Owner only, under `crossdomain.read`. D14.
 *
 * There is deliberately no EVERYONE strategy. "Send it to the whole tenant" is
 * exactly the behaviour this slice removes, and an alert whose authority cannot
 * be derived must fail closed rather than broadcast.
 */
import type { ServerCapability } from './capabilities'

export type AudienceStrategy =
  | 'DIRECT_USER'
  | 'CAPABILITY_HOLDERS'
  | 'LEGACY_OWNER_ONLY'

export interface NotificationSourcePolicy {
  /** Stable key persisted on the event. */
  policyKey: string
  /** The generator inside `scanAndGenerate` that produces this class. */
  generator: string
  /** Tables the generator reads to build the title/body. */
  sourceTables: readonly string[]
  /** What of that data ends up in the alert text — the disclosure being authorized. */
  discloses: string
  /** EVERY capability a recipient must hold. Conjunction. */
  requiredCapabilities: readonly ServerCapability[]
  audienceStrategy: AudienceStrategy
  reason: string
}

/**
 * The capability every notification recipient must hold in addition to the
 * source authority.
 *
 * D15: a delivery carries mutable Personal Inbox state — the user can mark it
 * read and dismiss it — so eligibility requires `personal.write`, not merely
 * `personal.view`. Viewer therefore receives no deliveries, which keeps ADR-014
 * D3 intact without amending it, and Admin receives none because it holds no
 * Personal Inbox capability at all.
 */
export const DELIVERY_BASE_CAPABILITY = 'personal.write' as const

/** The key and authority stamped on every pre-2C-4B event by migration 085. */
export const LEGACY_POLICY_KEY = 'legacy.pre_2c4b' as const
export const LEGACY_REQUIRED_CAPABILITIES = ['crossdomain.read'] as const

export const NOTIFICATION_SOURCE_POLICIES: readonly NotificationSourcePolicy[] = [
  {
    policyKey: 'budget.overrun',
    generator: 'scanAndGenerate §1 budget alerts',
    sourceTables: ['projects', 'evm_baselines', 'change_orders', 'evm_actuals'],
    discloses: 'project name, ACWP, revised budget, approved change-order value — literal currency amounts',
    requiredCapabilities: ['cost.view', 'project.view'],
    audienceStrategy: 'CAPABILITY_HOLDERS',
    reason: 'The body states actual cost against budget in dollars, which is exactly what ADR-014 Phase 2B-1 puts behind cost.view; the project it names is behind project.view. At the certified baseline only the owner holds cost.view, so this alert is owner-only today — a consequence of the existing cost policy, not a new decision by this slice.',
  },
  {
    policyKey: 'action.overdue',
    generator: 'scanAndGenerate §2 overdue action items',
    sourceTables: ['action_items'],
    discloses: 'action title, days overdue, assignee',
    requiredCapabilities: ['personal.view'],
    audienceStrategy: 'DIRECT_USER',
    reason: 'The only genuinely personal alert in the set: the source row names its assignee, so it goes to that user and nobody else. `personal.view` is the source authority because an overdue item in your own queue is what the Personal Inbox is for. It is deliberately NOT copied to the owner — the assignee is the recipient, and a supervisor view of overdue work already exists at GET /actions/overdue under personal.admin.',
  },
  {
    policyKey: 'bid.deadline',
    generator: 'scanAndGenerate §3 bid deadlines',
    sourceTables: ['proposals'],
    discloses: 'proposal title, client name, bid due date',
    requiredCapabilities: ['crm.view'],
    audienceStrategy: 'CAPABILITY_HOLDERS',
    reason: 'Client names and live bid deadlines are business-development pipeline data, which ADR-014 Phase 2B-1 governs with crm.view. Sending a client name to a field user because they happen to have an inbox is the disclosure this policy exists to stop.',
  },
  {
    policyKey: 'meeting.today',
    generator: 'scanAndGenerate §4 meetings today',
    sourceTables: ['meetings'],
    discloses: 'meeting title and type',
    requiredCapabilities: ['project.view'],
    audienceStrategy: 'CAPABILITY_HOLDERS',
    reason: 'Meetings are project delivery records; `SCREEN_CAP.meetings` is project.view and Phase 2B-2 classifies the meetings surface as a project delivery read. The alert adds no commercial content beyond the title and type.',
  },
  {
    policyKey: 'change_order.stale',
    generator: 'scanAndGenerate §5 stale submitted change orders',
    sourceTables: ['change_orders'],
    discloses: 'CO number, title, days awaiting a decision',
    requiredCapabilities: ['cost.view'],
    audienceStrategy: 'CAPABILITY_HOLDERS',
    reason: 'Change orders are commercial records behind cost.view — the same authority that guards GET /change-orders. That the alert reports only elapsed time does not change which domain the record belongs to.',
  },
  {
    policyKey: 'invoice.stale',
    generator: 'scanAndGenerate §6 stale subcontract invoices',
    sourceTables: ['subcontract_invoices', 'subcontracts', 'vendors'],
    discloses: 'invoice number, gross amount, vendor name, days pending',
    requiredCapabilities: ['procurement.view', 'cost.view'],
    audienceStrategy: 'CAPABILITY_HOLDERS',
    reason: 'A conjunction because the body discloses two domains at once: the vendor and subcontract are procurement records, and the gross amount is a commercial figure. Requiring only one half would leak the other, which is the ADR-014 rule about combined output applied to a notification body.',
  },
  {
    policyKey: LEGACY_POLICY_KEY,
    generator: 'migration 085 backfill — pre-2C-4B rows',
    sourceTables: ['notifications'],
    discloses: 'unknown — a legacy row records no provenance for its own body',
    requiredCapabilities: [...LEGACY_REQUIRED_CAPABILITIES],
    audienceStrategy: 'LEGACY_OWNER_ONLY',
    reason: 'D14. A historical event carries no recipient identity and no source policy, and its body may mix any of the six classes above. crossdomain.read is the established fail-closed authority for a payload whose provenance the schema does not record, so legacy rows go to active owners and to nobody else. Manufacturing a wider historical audience would leak precisely the cost and procurement content the policies above are written to bound.',
  },
]

const BY_KEY = new Map(NOTIFICATION_SOURCE_POLICIES.map(p => [p.policyKey, p]))

/**
 * Look up a policy. Throws rather than defaulting: an unregistered generator
 * must stop, not broadcast (§11, §38). There is no permissive fallback anywhere
 * in this module by design.
 */
export function sourcePolicy(policyKey: string): NotificationSourcePolicy {
  const policy = BY_KEY.get(policyKey)
  if (!policy) {
    throw new Error(
      `[notifications] no source policy for '${policyKey}'. An alert whose ` +
      'authority cannot be derived must fail closed, never broadcast.',
    )
  }
  return policy
}

/** Every capability a recipient needs for an event: the base plus the source authority. */
export function recipientRequirement(
  policy: NotificationSourcePolicy,
): readonly ServerCapability[] {
  return [DELIVERY_BASE_CAPABILITY, ...policy.requiredCapabilities]
}
