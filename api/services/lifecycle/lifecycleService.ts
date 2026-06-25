/**
 * Denver Engineering — Project Lifecycle + Approval Gates (v4.34.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Workflow Redesign W3 (see WORKFLOW_REDESIGN.md §4 + §8).
 *
 * Renders a project's position on the EPC lifecycle and the approval gate that
 * controls advancement. The lifecycle is grounded in the real `project_phase`
 * enum: feasibility → feed → detailed_design → procurement → construction →
 * commissioning → closeout.
 *
 * Each gate's outstanding REQUIREMENTS are COMPUTED from live records (open
 * critical RFIs, open NCRs, punch burndown, failed inspections, budget, pending
 * change orders, open submittals) — never hand-maintained. The human APPROVAL
 * (pending → approved | waived) is stored in `project_gates`.
 *
 * `buildLifecycle` is a PURE, deterministic, unit-tested function. The DB wrappers
 * only fetch facts + approvals and persist decisions. No LLM is involved.
 */
import { tenantQuery } from '../../db/pool'

// ─── Lifecycle phases (mirror the project_phase enum, in order) ───────────────

export const PHASES = [
  'feasibility', 'feed', 'detailed_design', 'procurement', 'construction', 'commissioning', 'closeout',
] as const
export type Phase = typeof PHASES[number]

const PHASE_LABEL: Record<Phase, string> = {
  feasibility: 'Feasibility', feed: 'FEED', detailed_design: 'Detailed Design',
  procurement: 'Procurement', construction: 'Construction', commissioning: 'Commissioning',
  closeout: 'Closeout',
}

// ─── Computed facts that gate requirements test against ───────────────────────

export interface LifecycleFacts {
  budget:              number
  openRfis:            number
  openCriticalRfis:    number
  openSubmittals:      number
  pendingChangeOrders: number
  failedInspections:   number
  openNcrs:            number
  openPunch:           number
}

export interface Requirement { key: string; label: string; satisfied: boolean; detail: string }

// Gate definitions: keyed by the phase the gate UNLOCKS. `feasibility` is the
// start, so it has no entry gate. Requirements use only live, queryable facts.
interface GateDef { key: Phase; name: string; requirements: (f: LifecycleFacts) => Requirement[] }

const GATE_DEFS: Partial<Record<Phase, GateDef>> = {
  feed: {
    key: 'feed', name: 'FEED Authorization',
    requirements: (f) => [
      { key: 'budget', label: 'Project budget established', satisfied: f.budget > 0, detail: f.budget > 0 ? 'Budget set' : 'No budget recorded' },
    ],
  },
  detailed_design: {
    key: 'detailed_design', name: 'Design Development Release',
    requirements: (f) => [
      { key: 'crit_rfi', label: 'No open critical RFIs', satisfied: f.openCriticalRfis === 0, detail: `${f.openCriticalRfis} open critical RFI(s)` },
    ],
  },
  procurement: {
    key: 'procurement', name: 'Issued For Construction (IFC)',
    requirements: (f) => [
      { key: 'crit_rfi', label: 'No open critical RFIs', satisfied: f.openCriticalRfis === 0, detail: `${f.openCriticalRfis} open critical RFI(s)` },
      { key: 'submittals', label: 'No submittals awaiting review', satisfied: f.openSubmittals === 0, detail: `${f.openSubmittals} submittal(s) in review` },
    ],
  },
  construction: {
    key: 'construction', name: 'Construction Release',
    requirements: (f) => [
      { key: 'crit_rfi', label: 'No open critical RFIs', satisfied: f.openCriticalRfis === 0, detail: `${f.openCriticalRfis} open critical RFI(s)` },
      { key: 'pending_co', label: 'No change orders awaiting decision', satisfied: f.pendingChangeOrders === 0, detail: `${f.pendingChangeOrders} change order(s) submitted` },
    ],
  },
  commissioning: {
    key: 'commissioning', name: 'Mechanical Completion',
    requirements: (f) => [
      { key: 'failed_insp', label: 'No failed inspections outstanding', satisfied: f.failedInspections === 0, detail: `${f.failedInspections} failed inspection(s)` },
      { key: 'open_ncr', label: 'No open NCRs', satisfied: f.openNcrs === 0, detail: `${f.openNcrs} open NCR(s)` },
      { key: 'punch', label: 'Punch list cleared', satisfied: f.openPunch === 0, detail: `${f.openPunch} open punch item(s)` },
    ],
  },
  closeout: {
    key: 'closeout', name: 'Ready for Turnover',
    requirements: (f) => [
      { key: 'punch', label: 'Punch list cleared', satisfied: f.openPunch === 0, detail: `${f.openPunch} open punch item(s)` },
      { key: 'open_ncr', label: 'No open NCRs', satisfied: f.openNcrs === 0, detail: `${f.openNcrs} open NCR(s)` },
      { key: 'submittals', label: 'All submittals closed', satisfied: f.openSubmittals === 0, detail: `${f.openSubmittals} submittal(s) open` },
    ],
  },
}

export type GateApprovalStatus = 'pending' | 'approved' | 'waived'

export interface GateApproval {
  status:       GateApprovalStatus
  ownerId:      string | null
  expectedDate: string | null
  approvedBy:   string | null
  approvedAt:   string | null
}

export interface Gate {
  key:                  Phase
  name:                 string
  phase:                Phase           // the phase this gate unlocks
  approvalStatus:       GateApprovalStatus
  ownerId:              string | null
  expectedDate:         string | null
  approvedBy:           string | null
  approvedAt:           string | null
  requirements:         Requirement[]
  requirementsSatisfied: boolean
}

export interface Stage {
  key:    Phase
  label:  string
  status: 'done' | 'active' | 'upcoming'
  gate:   Gate | null
}

export interface Lifecycle {
  projectId:    string
  generatedAt:  string
  currentPhase: Phase
  stages:       Stage[]
  currentGate:  Gate | null   // gate to advance OUT of the current phase
  nextGate:     Gate | null   // the one after that
  canAdvance:   boolean       // currentGate exists and is approved/waived
}

export interface ProjectLifecycleInput {
  id:           string
  currentPhase: string | null
  projectManager: string | null
}

function gateFor(phase: Phase, facts: LifecycleFacts, approvals: Record<string, GateApproval>, defaultOwner: string | null): Gate | null {
  const def = GATE_DEFS[phase]
  if (!def) return null
  const reqs = def.requirements(facts)
  const ap = approvals[phase]
  return {
    key: phase, name: def.name, phase,
    approvalStatus: ap?.status ?? 'pending',
    ownerId:       ap?.ownerId ?? defaultOwner,
    expectedDate:  ap?.expectedDate ?? null,
    approvedBy:    ap?.approvedBy ?? null,
    approvedAt:    ap?.approvedAt ?? null,
    requirements:  reqs,
    requirementsSatisfied: reqs.every(r => r.satisfied),
  }
}

/** Pure: assemble the lifecycle map from a project, computed facts, and stored gate approvals. */
export function buildLifecycle(
  project: ProjectLifecycleInput,
  facts: LifecycleFacts,
  approvals: Record<string, GateApproval>,
  now: Date,
): Lifecycle {
  const currentPhase: Phase = (PHASES as readonly string[]).includes(project.currentPhase ?? '')
    ? (project.currentPhase as Phase)
    : 'feasibility'
  const currentIdx = PHASES.indexOf(currentPhase)
  const owner = project.projectManager

  const stages: Stage[] = PHASES.map((p, i) => ({
    key: p,
    label: PHASE_LABEL[p],
    status: i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'upcoming',
    gate: gateFor(p, facts, approvals, owner),
  }))

  const nextPhase  = PHASES[currentIdx + 1]
  const afterPhase = PHASES[currentIdx + 2]
  const currentGate = nextPhase  ? gateFor(nextPhase,  facts, approvals, owner) : null
  const nextGate    = afterPhase ? gateFor(afterPhase, facts, approvals, owner) : null

  return {
    projectId: project.id,
    generatedAt: now.toISOString(),
    currentPhase,
    stages,
    currentGate,
    nextGate,
    canAdvance: !!currentGate && currentGate.approvalStatus !== 'pending',
  }
}

// ─── DB wrappers ──────────────────────────────────────────────────────────────

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

async function gatherFacts(tenantId: string, projectId: string): Promise<LifecycleFacts> {
  const count = async (sql: string): Promise<number> => {
    const r = await tenantQuery(tenantId, sql, [tenantId, projectId])
    return n((r.rows[0] as { c?: unknown })?.c)
  }
  const [
    openRfis, openCriticalRfis, openSubmittals, pendingChangeOrders, failedInspections, openNcrs, openPunch, projectRow,
  ] = await Promise.all([
    count(`SELECT count(*) c FROM rfis WHERE tenant_id=$1 AND project_id=$2 AND status IN ('open','pending')`),
    count(`SELECT count(*) c FROM rfis WHERE tenant_id=$1 AND project_id=$2 AND status IN ('open','pending') AND priority='critical'`),
    count(`SELECT count(*) c FROM submittals WHERE tenant_id=$1 AND project_id=$2 AND status IN ('submitted','under_review')`),
    count(`SELECT count(*) c FROM change_orders WHERE tenant_id=$1 AND project_id=$2 AND status='submitted'`),
    count(`SELECT count(*) c FROM inspections WHERE tenant_id=$1 AND project_id=$2 AND overall_result='fail'`),
    count(`SELECT count(*) c FROM ncrs WHERE tenant_id=$1 AND project_id=$2 AND status <> 'closed'`),
    count(`SELECT count(*) c FROM punch_items WHERE tenant_id=$1 AND project_id=$2 AND status='open'`),
    tenantQuery(tenantId, `SELECT budget FROM projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId]),
  ])
  return {
    budget: n((projectRow.rows[0] as { budget?: unknown })?.budget),
    openRfis, openCriticalRfis, openSubmittals, pendingChangeOrders, failedInspections, openNcrs, openPunch,
  }
}

async function loadApprovals(tenantId: string, projectId: string): Promise<Record<string, GateApproval>> {
  const r = await tenantQuery(tenantId,
    `SELECT gate_key, status, owner_id, expected_date, approved_by, approved_at
       FROM project_gates WHERE tenant_id=$1 AND project_id=$2`, [tenantId, projectId])
  const out: Record<string, GateApproval> = {}
  for (const row of r.rows as Record<string, unknown>[]) {
    out[String(row.gate_key)] = {
      status: (String(row.status) as GateApprovalStatus),
      ownerId: row.owner_id == null ? null : String(row.owner_id),
      expectedDate: row.expected_date == null ? null : String(row.expected_date).slice(0, 10),
      approvedBy: row.approved_by == null ? null : String(row.approved_by),
      approvedAt: row.approved_at == null ? null : String(row.approved_at),
    }
  }
  return out
}

/** Fetch project + facts + gate approvals and assemble the lifecycle. Returns null if no project. */
export async function getProjectLifecycle(tenantId: string, projectId: string, now: Date = new Date()): Promise<Lifecycle | null> {
  const pr = await tenantQuery(tenantId,
    `SELECT id, current_phase, project_manager FROM projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId])
  if (!pr.rows.length) return null
  const row = pr.rows[0] as Record<string, unknown>
  const project: ProjectLifecycleInput = {
    id: String(row.id),
    currentPhase: row.current_phase == null ? null : String(row.current_phase),
    projectManager: row.project_manager == null ? null : String(row.project_manager),
  }
  const [facts, approvals] = await Promise.all([gatherFacts(tenantId, projectId), loadApprovals(tenantId, projectId)])
  return buildLifecycle(project, facts, approvals, now)
}

export function isGateKey(key: string): key is Phase {
  return Object.prototype.hasOwnProperty.call(GATE_DEFS, key)
}

/** Approve / waive / reset a gate. Returns the refreshed lifecycle (or null if no project). */
export async function setGate(
  tenantId: string, projectId: string, gateKey: string,
  action: 'approve' | 'waive' | 'reset', userId: string | null, expectedDate?: string | null,
): Promise<Lifecycle | null> {
  if (!isGateKey(gateKey)) throw new Error('invalid gate key')
  const status: GateApprovalStatus = action === 'approve' ? 'approved' : action === 'waive' ? 'waived' : 'pending'
  const approvedBy = status === 'pending' ? null : userId
  await tenantQuery(tenantId,
    `INSERT INTO project_gates (tenant_id, project_id, gate_key, status, expected_date, approved_by, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $4='pending' THEN NULL ELSE NOW() END)
     ON CONFLICT (tenant_id, project_id, gate_key) DO UPDATE
       SET status=$4, expected_date=COALESCE($5, project_gates.expected_date),
           approved_by=$6, approved_at=CASE WHEN $4='pending' THEN NULL ELSE NOW() END, updated_at=NOW()`,
    [tenantId, projectId, gateKey, status, expectedDate ?? null, approvedBy])
  return getProjectLifecycle(tenantId, projectId)
}

/** Advance the project to the next phase. Requires the controlling gate to be approved/waived. */
export async function advancePhase(tenantId: string, projectId: string): Promise<{ ok: boolean; reason?: string; lifecycle: Lifecycle | null }> {
  const lc = await getProjectLifecycle(tenantId, projectId)
  if (!lc) return { ok: false, reason: 'Project not found', lifecycle: null }
  if (!lc.currentGate) return { ok: false, reason: 'Already at the final phase', lifecycle: lc }
  if (!lc.canAdvance) return { ok: false, reason: `Gate "${lc.currentGate.name}" must be approved or waived first`, lifecycle: lc }
  const nextPhase = lc.currentGate.phase
  await tenantQuery(tenantId, `UPDATE projects SET current_phase=$3, updated_at=NOW() WHERE tenant_id=$1 AND id=$2`,
    [tenantId, projectId, nextPhase])
  return { ok: true, lifecycle: await getProjectLifecycle(tenantId, projectId) }
}
