/**
 * Denver Engineering — Commissioning Intelligence Types
 * ───────────────────────────────────────────────
 * Implements the Continuum Commissioning data model.
 *
 * Design invariants (enforced at reducer level):
 *   1. CommissioningBaseline is IMMUTABLE after freeze — no field may be altered.
 *   2. ChangeEvent references a baseline; it never overwrites it.
 *   3. Evidence records are write-once — hash + uri are set at creation and locked.
 *   4. PMTask always declares provenance — the source of the maintenance strategy.
 *   5. Setpoints capture as-tested values, NOT OEM defaults.
 *
 * Naming convention: all CI collections are prefixed `ci_` in BizState to avoid
 * collisions with the existing cx_phases / cx_issues commissioning stubs.
 */

// ─── Core Identity ────────────────────────────────────────────────────────────

/**
 * All CI records must be identifiable.
 * The index signature `[key: string]: unknown` is required so CI types
 * satisfy `BizAction.data` (which is `Partial<BizRecord & Record<string, unknown>>`)
 * and can be passed directly to `bizReducer` without casting.
 */
export interface CIRecord {
  id:         string
  created_at: string
  created_by: string
  [key: string]: unknown
}

// ─── Asset ────────────────────────────────────────────────────────────────────

export type AssetClass =
  | 'mechanical'
  | 'electrical'
  | 'instrumentation'
  | 'controls'
  | 'civil'
  | 'process'
  | 'utility'
  | 'other'

export type AssetStatus = 'active' | 'decommissioned' | 'standby' | 'spare'

/**
 * Asset — the canonical identity that everything links to.
 * Every baseline, test, setpoint, PM task, change event, and evidence
 * record must reference an Asset id.
 */
export interface CIAsset extends CIRecord {
  tag:            string          // Unique plant tag, e.g. "P-101A"
  name:           string          // Human-readable name
  class:          AssetClass
  system:         string          // Parent system name, e.g. "RO Feed"
  subsystem?:     string
  parent_id?:     string          // Parent asset id for child/component assets
  status:         AssetStatus
  location?:      string          // Physical location / room
  manufacturer?:  string
  model?:         string
  serial?:        string
  spare_ids?:     string[]        // IDs of spare assets
  project_id?:    string          // Link back to EPC project
  notes?:         string
}

// ─── Commissioning Baseline ───────────────────────────────────────────────────

export type BaselineStatus = 'draft' | 'frozen'

/**
 * CommissioningBaseline — the immutable source of truth for a commissioned asset.
 *
 * INVARIANT: Once status === 'frozen', NO field may be changed.
 * The reducer enforces this by rejecting any update action on a frozen baseline.
 *
 * Only one active frozen baseline may exist per asset at any time.
 * Superseded baselines remain in the record for audit purposes.
 */
export interface CIBaseline extends CIRecord {
  asset_id:         string
  status:           BaselineStatus
  frozen_at?:       string        // ISO timestamp of freeze
  frozen_by?:       string
  version:          number        // Monotonically increasing per asset
  scope:            string        // What was commissioned (narrative)
  conditions:       string        // Operating conditions at time of commissioning
  witness?:         string        // Witnessing authority / client rep
  contract_ref?:    string        // Contract / ITP reference
  itp_ref?:         string        // Inspection & Test Plan reference
  test_ids:         string[]      // References to CITest records
  setpoint_ids:     string[]      // References to CISetpoint records
  evidence_ids:     string[]      // References to CIEvidence records
  deferred_items?:  string[]      // Known deferred commissioning items
  notes?:           string
}

// ─── Test ─────────────────────────────────────────────────────────────────────

export type TestType   = 'FPT' | 'SAT' | 'IST' | 'Failover' | 'Loop' | 'Pre-comm' | 'Other'
export type TestResult = 'pass' | 'fail' | 'conditional_pass' | 'deferred' | 'not_applicable'

/**
 * CITest — a single commissioning test linked to an asset and baseline.
 *
 * Tests are created during commissioning and linked to a baseline before freeze.
 * After the baseline is frozen, tests are read-only (update rejected at reducer).
 */
export interface CITest extends CIRecord {
  asset_id:      string
  baseline_id:   string
  type:          TestType
  tag:           string           // Test reference number e.g. "FPT-101-001"
  description:   string
  procedure_ref: string           // ITP / test procedure reference
  result:        TestResult
  tested_at:     string           // ISO timestamp
  tested_by:     string
  witnessed_by?: string
  duration_min?: number
  conditions?:   string           // Environmental / process conditions during test
  deficiencies?: string[]         // Deficiency descriptions found during test
  evidence_ids:  string[]
  notes?:        string
}

// ─── Setpoint ─────────────────────────────────────────────────────────────────

export type SetpointCategory = 'alarm' | 'trip' | 'control' | 'interlock' | 'calibration' | 'other'

/**
 * CISetpoint — as-tested setpoint value for an instrument or control loop.
 *
 * Captures the ACTUAL value tested and verified, not OEM defaults.
 * Linked to a test and baseline. After baseline freeze: read-only.
 */
export interface CISetpoint extends CIRecord {
  asset_id:       string
  baseline_id:    string
  test_id?:       string
  tag:            string          // Instrument tag or loop ID
  description:    string
  category:       SetpointCategory
  parameter:      string          // What is being set, e.g. "High-High Level"
  value:          number | string
  unit?:          string          // Engineering unit
  oem_default?:   number | string // OEM recommended value (for comparison)
  tolerance?:     string          // Acceptable range
  verified_at:    string          // ISO timestamp
  verified_by:    string
  notes?:         string
}

// ─── PM Task ─────────────────────────────────────────────────────────────────

export type PMProvenance = 'oem' | 'tested' | 'site_override' | 'regulatory' | 'failure_mode'
export type PMFrequency  = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'annual' | 'condition_based' | 'custom'

/**
 * CIPMTask — a preventive maintenance task for a commissioned asset.
 *
 * Every PM task MUST declare its provenance — the reason it exists.
 * This prevents the common failure of PM strategies that don't reflect
 * what was actually tested and approved at commissioning.
 *
 * provenance === 'tested' means the PM interval was derived from observed
 * conditions at commissioning, not blindly copied from OEM documentation.
 */
export interface CIPMTask extends CIRecord {
  asset_id:          string
  baseline_id:       string       // Baseline this PM was derived from
  provenance:        PMProvenance
  provenance_note:   string       // Why this task exists / where it came from
  oem_ref?:          string       // OEM document section if provenance === 'oem'
  failure_mode?:     string       // Failure mode addressed if provenance === 'failure_mode'
  title:             string
  description:       string
  frequency:         PMFrequency
  frequency_custom?: string       // Used when frequency === 'custom'
  estimated_hours:   number
  skills_required?:  string[]
  spares_required?:  string[]
  safety_notes?:     string
  active:            boolean
  notes?:            string
}

// ─── Change Event ─────────────────────────────────────────────────────────────

export type ChangeType     = 'setpoint_change' | 'config_change' | 'component_replacement' | 'procedure_update' | 'alarm_adjustment' | 'interlock_bypass' | 'other'
export type ChangeStatus   = 'proposed' | 'approved' | 'rejected' | 'implemented' | 'rolled_back'
export type ChangeImpact   = 'none' | 'low' | 'medium' | 'high' | 'critical'

/**
 * CIChangeEvent — records a post-handover change to a commissioned asset.
 *
 * INVARIANT: ChangeEvents REFERENCE the baseline; they never alter it.
 * The frozen baseline remains the immutable truth of how the system was
 * commissioned. Change events form an append-only audit trail on top of it.
 *
 * The drift analysis system compares the current state of change events
 * against the baseline to detect and surface operational drift.
 */
export interface CIChangeEvent extends CIRecord {
  asset_id:        string
  baseline_id:     string         // Baseline this change deviates from
  type:            ChangeType
  status:          ChangeStatus
  impact:          ChangeImpact
  title:           string
  description:     string
  reason:          string         // Business justification
  requested_by:    string
  approved_by?:    string
  approved_at?:    string
  implemented_at?: string
  implemented_by?: string
  previous_value?: string         // For setpoint changes: old value
  new_value?:      string         // For setpoint changes: new value
  reversible:      boolean
  evidence_ids:    string[]
  pm_impact?:      string         // Does this change affect PM tasks?
  notes?:          string
}

// ─── Evidence ─────────────────────────────────────────────────────────────────

export type EvidenceType = 'test_record' | 'photo' | 'video' | 'certificate' | 'report' | 'datasheet' | 'signature' | 'other'

/**
 * CIEvidence — a write-once evidence record.
 *
 * INVARIANT: Evidence records are immutable after creation.
 * The content_hash ensures the referenced document cannot be silently altered.
 * Any re-upload must create a new evidence record; the old one is retained.
 *
 * content_hash is a SHA-256 hex string of the file contents at time of upload.
 */
export interface CIEvidence extends CIRecord {
  asset_id:      string
  linked_to_id:  string           // baseline_id, test_id, change_event_id, etc.
  linked_to_type: 'baseline' | 'test' | 'setpoint' | 'change_event' | 'pm_task'
  type:          EvidenceType
  title:         string
  uri:           string           // Storage URI (S3, SharePoint, etc.)
  content_hash:  string           // SHA-256 hex — set at creation, never updated
  mime_type?:    string
  size_bytes?:   number
  description?:  string
  uploaded_by:   string
  uploaded_at:   string
}

// ─── Selectors / Derived Types ────────────────────────────────────────────────

/**
 * AssetTruthView — the full commissioning picture for a single asset.
 * This is what the "Asset Truth View" UI renders.
 */
export interface AssetTruthView {
  asset:          CIAsset
  active_baseline: CIBaseline | null
  baseline_history: CIBaseline[]
  tests:          CITest[]
  setpoints:      CISetpoint[]
  pm_tasks:       CIPMTask[]
  change_events:  CIChangeEvent[]
  evidence:       CIEvidence[]
  drift_score:    number          // 0–100: how far current state deviates from baseline
  audit_ready:    boolean         // true if evidence chain is complete
}

/**
 * DriftSummary — per-asset drift analysis result.
 */
export interface DriftSummary {
  asset_id:          string
  asset_tag:         string
  baseline_version:  number
  open_changes:      number
  high_impact_changes: number
  unapproved_changes: number
  drift_score:       number       // 0–100
  last_change_at:    string | null
  flags:             string[]     // Human-readable drift warnings
}

/**
 * AuditAnswerPackage — structured export for regulatory/audit queries.
 */
export interface AuditAnswerPackage {
  generated_at:   string
  generated_by:   string
  asset_tag:      string
  query:          string
  baseline_ref:   string
  evidence_chain: Array<{
    id:           string
    type:         EvidenceType
    title:        string
    uri:          string
    hash:         string
    uploaded_at:  string
  }>
  change_timeline: Array<{
    ts:           string
    type:         ChangeType
    status:       ChangeStatus
    description:  string
    approved_by:  string | undefined
  }>
  narrative:      string          // AI-generated plain-language summary (advisory only)
}
