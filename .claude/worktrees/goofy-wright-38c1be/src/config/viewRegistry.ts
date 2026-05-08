/**
 * JARVIS EPC — View Registry
 * ────────────────────────────
 * Sprint 6-9 (v4.31.0): Extracted from JarvisCore.jsx (_VIEW_REGISTRY constant).
 *
 * Metadata for all domain views — used for lazy loading, collection inventory,
 * and performance budgeting.
 */

export interface ViewMeta {
  module:      string
  label:       string
  collections: string[]
  heavy:       boolean
}

export const VIEW_REGISTRY: Record<string, ViewMeta> = {
  dashboard:    { module: 'core',         label: 'Dashboard',    collections: ['projects','leads','invoices'],                                                              heavy: false },
  crm:          { module: 'crm',          label: 'CRM',          collections: ['leads','contracts'],                                                                       heavy: false },
  projects:     { module: 'project',      label: 'Projects',     collections: ['projects','action_items'],                                                                 heavy: true  },
  safety:       { module: 'safety',       label: 'Safety',       collections: ['jhas','incidents','toolbox_talks'],                                                        heavy: true  },
  construction: { module: 'construction', label: 'Construction', collections: ['construction_punch','construction_reports','rfis_construction','safety_issues'],           heavy: true  },
  portfolio:    { module: 'portfolio',    label: 'Portfolio',    collections: ['expenses','daily_reports','score_cards','service_tickets','service_trips'],                heavy: true  },
  engineering:  { module: 'engineering',  label: 'Engineering',  collections: ['engineering_deliverables','installation','manpower'],                                      heavy: true  },
  procurement:  { module: 'procurement',  label: 'Procurement',  collections: ['rfqs','purchase_orders'],                                                                  heavy: false },
  submittals:   { module: 'submittals',   label: 'Submittals',   collections: ['submittals','rfis'],                                                                       heavy: false },
  invoicing:    { module: 'invoicing',    label: 'Invoicing',    collections: ['invoices'],                                                                                heavy: false },
  commissioning:{ module: 'field',        label: 'Field Ops',    collections: ['deficiencies','commissioning_items','cx_itps','cx_certificates'],                         heavy: true  },
  ncr:          { module: 'ncr',          label: 'NCR',          collections: ['vendors','customers'],                                                                     heavy: false },
  documents:    { module: 'docs',         label: 'Documents',    collections: ['documents'],                                                                               heavy: false },
  closeout:     { module: 'closeout',     label: 'Closeout',     collections: ['punch_items'],                                                                             heavy: false },
  proposals:    { module: 'proposals',    label: 'Proposals',    collections: ['proposals'],                                                                               heavy: false },
  team:         { module: 'team',         label: 'Team',         collections: ['team_members'],                                                                            heavy: false },
}
