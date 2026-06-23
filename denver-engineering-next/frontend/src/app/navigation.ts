/** Left-navigation information architecture (Stitch left nav order). */
export interface NavItem {
  label: string
  icon: string
  path: string
  /** Phase ≥ 2 modules render as styled placeholders for now. */
  preview?: boolean
}

export const NAV: NavItem[] = [
  { label: 'Dashboard', icon: 'dashboard', path: '/' },
  { label: 'Projects', icon: 'account_tree', path: '/projects' },
  { label: 'CRM', icon: 'handshake', path: '/crm' },
  { label: 'Contracts', icon: 'gavel', path: '/contracts' },
  { label: 'Procurement', icon: 'shopping_cart', path: '/procurement' },
  { label: 'Inventory', icon: 'inventory_2', path: '/inventory' },
  { label: 'Engineering', icon: 'engineering', path: '/engineering' },
  { label: 'Schedule', icon: 'calendar_month', path: '/schedule' },
  { label: 'Risk', icon: 'crisis_alert', path: '/risk' },
  { label: 'Maintenance', icon: 'build', path: '/maintenance' },
  { label: 'Commissioning', icon: 'precision_manufacturing', path: '/commissioning' },
  { label: 'Safety', icon: 'health_and_safety', path: '/safety' },
  { label: 'Digital Twin', icon: 'deployed_code', path: '/twin' },
  { label: 'Closeout', icon: 'task_alt', path: '/closeout' },
  { label: 'Documents', icon: 'description', path: '/documents' },
  { label: 'Actions', icon: 'checklist', path: '/actions' },
  { label: 'AI Mitigation', icon: 'auto_fix_high', path: '/mitigation' },
  { label: 'Finance', icon: 'payments', path: '/finance' },
  { label: 'Analytics', icon: 'analytics', path: '/analytics' },
  { label: 'Reports', icon: 'summarize', path: '/reports' },
  { label: 'AI Copilot', icon: 'smart_toy', path: '/ai' },
  { label: 'Field App', icon: 'smartphone', path: '/m' },
  { label: 'Administration', icon: 'admin_panel_settings', path: '/admin' },
]
