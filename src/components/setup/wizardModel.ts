/**
 * Denver Engineering — Setup Wizard model (v4.37.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Workflow Redesign W6 (see WORKFLOW_REDESIGN.md §6). Pure, testable logic for the
 * Project Setup Wizard: the draft shape, validation, and the create payload that
 * maps to the real POST /api/v1/projects fields. No React, no I/O.
 *
 * The wizard creates a real project (the fields that genuinely persist on the
 * `projects` table). Subsystem setup (cost codes, WBS, templates, automation,
 * schedule import) is presented by the view as a post-create checklist of links
 * to the existing screens — not fabricated here.
 */

export interface SetupDraft {
  code:           string
  name:           string
  description:    string
  client_name:    string
  location:       string
  country:        string
  contract_type:  string
  currency:       string
  budget:         string   // kept as string in the form; coerced in the payload
  planned_start:  string
  planned_finish: string
}

export const EMPTY_DRAFT: SetupDraft = {
  code: '', name: '', description: '', client_name: '', location: '', country: '',
  contract_type: '', currency: 'USD', budget: '', planned_start: '', planned_finish: '',
}

export const CONTRACT_TYPES = ['lump_sum', 'reimbursable', 'unit_rate', 'gmp', 'ep', 'epc', 'epcm'] as const

export interface WizardStep { id: string; title: string }

export const STEPS: WizardStep[] = [
  { id: 'info',     title: 'Project Information' },
  { id: 'contract', title: 'Contract' },
  { id: 'schedule', title: 'Schedule' },
  { id: 'next',     title: 'Set up next' },
  { id: 'review',   title: 'Review & Go Live' },
]

export interface ValidationResult { ok: boolean; errors: Record<string, string> }

/** Validate the whole draft (used to gate "Go Live"). */
export function validateDraft(d: SetupDraft): ValidationResult {
  const errors: Record<string, string> = {}
  if (!d.code.trim())  errors.code = 'Project code is required'
  if (!d.name.trim())  errors.name = 'Project name is required'
  if (d.budget.trim()) {
    const b = Number(d.budget)
    if (!Number.isFinite(b) || b < 0) errors.budget = 'Budget must be a non-negative number'
  }
  if (d.planned_start && d.planned_finish && d.planned_finish < d.planned_start) {
    errors.planned_finish = 'Finish date must be on or after the start date'
  }
  return { ok: Object.keys(errors).length === 0, errors }
}

/** True if a given wizard step has everything it needs to proceed. */
export function stepValid(stepId: string, d: SetupDraft): boolean {
  const v = validateDraft(d)
  if (stepId === 'info')     return !v.errors.code && !v.errors.name
  if (stepId === 'contract') return !v.errors.budget
  if (stepId === 'schedule') return !v.errors.planned_finish
  return true
}

export interface ProjectPayload {
  code: string; name: string; status: 'planning'; current_phase: 'feasibility'
  description?: string; client_name?: string; location?: string; country?: string
  contract_type?: string; currency?: string; budget?: number
  planned_start?: string; planned_finish?: string
}

const t = (s: string): string | undefined => { const v = s.trim(); return v || undefined }

/** Build the POST /api/v1/projects body from the draft (omitting empty optionals). */
export function buildProjectPayload(d: SetupDraft): ProjectPayload {
  const payload: ProjectPayload = {
    code: d.code.trim(), name: d.name.trim(), status: 'planning', current_phase: 'feasibility',
  }
  const desc = t(d.description);     if (desc) payload.description = desc
  const client = t(d.client_name);  if (client) payload.client_name = client
  const loc = t(d.location);        if (loc) payload.location = loc
  const country = t(d.country);      if (country) payload.country = country.toUpperCase().slice(0, 2)
  const ct = t(d.contract_type);    if (ct) payload.contract_type = ct
  const cur = t(d.currency);        if (cur) payload.currency = cur.toUpperCase().slice(0, 3)
  if (d.budget.trim()) payload.budget = Number(d.budget)
  const ps = t(d.planned_start);    if (ps) payload.planned_start = ps
  const pf = t(d.planned_finish);   if (pf) payload.planned_finish = pf
  return payload
}

/** Post-create setup checklist — links to the real screens for the heavier subsystems. */
export const NEXT_STEPS: { tab: string; label: string; detail: string }[] = [
  { tab: 'team',           label: 'Team & roles',     detail: 'Assign the PM, lead engineer, and project team' },
  { tab: 'budget',         label: 'Budget & cost codes', detail: 'Break the budget down by cost code / WBS' },
  { tab: 'scheduleimport', label: 'Import schedule',  detail: 'Load the P6 / MS Project baseline' },
  { tab: 'inspections',    label: 'Inspection templates', detail: 'Set up the checklists this project will use' },
  { tab: 'automation',     label: 'Automation rules', detail: 'Default SLA, escalation, and notification rules' },
  { tab: 'docs',           label: 'Document structure', detail: 'Folders and numbering for documents & drawings' },
  { tab: 'lifecycle',      label: 'Lifecycle & gates', detail: 'Review phases and the first approval gate' },
]
