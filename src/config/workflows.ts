/**
 * Denver Engineering — Guided workflow flows (v4.36.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Workflow Redesign W5 (see WORKFLOW_REDESIGN.md §5). Each flow sequences REAL
 * existing screens into the order work actually happens, so the platform can show
 * "you are here → next step" on the relevant hubs. Every step.tab is a real nav
 * id (see config/navigation.ts) — no fabricated destinations.
 */

export interface FlowStep { tab: string; label: string }
export interface Flow { id: string; label: string; steps: FlowStep[] }

export const WORKFLOWS: Flow[] = [
  {
    id: 'quality', label: 'Quality loop',
    steps: [
      { tab: 'inspections', label: 'Inspect' },
      { tab: 'punch',       label: 'Deficiency' },
      { tab: 'ncr',         label: 'Corrective action' },
      { tab: 'quality',     label: 'Trend analysis' },
    ],
  },
  {
    id: 'construction', label: 'Daily construction',
    steps: [
      { tab: 'dailylogs',   label: 'Daily log' },
      { tab: 'field',       label: 'Field execution' },
      { tab: 'inspections', label: 'Inspections' },
      { tab: 'safety',      label: 'Safety' },
    ],
  },
  {
    id: 'procurement', label: 'Procurement',
    steps: [
      { tab: 'directory',       label: 'Vendors' },
      { tab: 'subcontracts',    label: 'Subcontracts' },
      { tab: 'procurementrisk', label: 'Risk' },
      { tab: 'vendorscore',     label: 'Scorecard' },
    ],
  },
  {
    id: 'engineering', label: 'Engineering',
    steps: [
      { tab: 'feed',          label: 'FEED' },
      { tab: 'processdesign', label: 'Process design' },
      { tab: 'calc',          label: 'Calcs' },
      { tab: 'drawings',      label: 'Drawings' },
      { tab: 'bim',           label: 'BIM' },
      { tab: 'rfis',          label: 'RFIs' },
      { tab: 'submittals',    label: 'Submittals' },
    ],
  },
  {
    id: 'commercial', label: 'Cost & commercial',
    steps: [
      { tab: 'budget',       label: 'Budget' },
      { tab: 'changeorders', label: 'Change orders' },
      { tab: 'costcontrol',  label: 'Cost control' },
      { tab: 'evm',          label: 'EVM' },
      { tab: 'billing',      label: 'Billing' },
      { tab: 'costiq',       label: 'Cost IQ' },
    ],
  },
]

/** The first flow whose steps include this tab (deterministic by WORKFLOWS order). */
export function flowForTab(tab: string): Flow | undefined {
  return WORKFLOWS.find(f => f.steps.some(s => s.tab === tab))
}
