/**
 * Denver Engineering — Navigation Configuration  (v4.32.0)
 * ─────────────────────────────────────────────────
 * Phase 18b extraction: Ci array from JarvisCore.jsx → typed NavItem[].
 * v4.32.0 (Workflow Redesign W1): items carry a lifecycle `section` and are
 * ordered along the EPC lifecycle so the sidebar reads the way a project runs.
 * Every id/label/icon/domain is preserved — nothing removed, only re-homed.
 * See WORKFLOW_REDESIGN.md §2 and §13.
 *
 * Usage:
 *   import { NAVIGATION_ITEMS, NAV_SECTIONS, type NavItem } from '../config/navigation'
 */

export interface NavItem {
  id:       string
  label:    string
  icon:     string
  domain?:  string
  section?: string
  hidden?:  boolean
}

/** Ordered lifecycle sections for the sidebar. */
export const NAV_SECTIONS: { id: string; label: string }[] = [
  { id: 'personal',     label: 'Personal'      },
  { id: 'setup',        label: 'Project Setup' },
  { id: 'planning',     label: 'Planning'      },
  { id: 'engineering',  label: 'Engineering'   },
  { id: 'procurement',  label: 'Procurement'   },
  { id: 'construction', label: 'Construction'  },
  { id: 'quality',      label: 'Quality'       },
  { id: 'safety',       label: 'Safety'        },
  { id: 'commercial',   label: 'Commercial'    },
  { id: 'turnover',     label: 'Turnover'      },
  { id: 'operations',   label: 'Operations'    },
  { id: 'ai',           label: 'AI'            },
  { id: 'executive',    label: 'Executive'     },
  { id: 'admin',        label: 'Administration' },
]

export const NAVIGATION_ITEMS: NavItem[] = [
  // ── Personal ────────────────────────────────────────────────────────────────
  { id: 'focus',         label: 'Focus',        icon: '🧭',  domain: 'ai',           section: 'personal'     },
  { id: 'mywork',        label: 'My Work',      icon: '🗂️',  domain: 'operations',   section: 'personal'     },
  { id: 'actions',       label: 'Actions',      icon: '⚡',  domain: 'operations',   section: 'personal'     },
  { id: 'notifications', label: 'Notifs',       icon: '🔔',  domain: 'operations',   section: 'personal'     },
  // ── Project Setup ─────────────────────────────────────────────────────────────
  { id: 'projects',      label: 'Projects',     icon: '📋',  domain: 'operations',   section: 'setup'        },
  { id: 'lifecycle',     label: 'Lifecycle',    icon: '🛤️',  domain: 'operations',   section: 'setup'        },
  { id: 'crm',           label: 'CRM',          icon: '🎯',  domain: 'crm',          section: 'setup'        },
  { id: 'proposals',     label: 'Proposals',    icon: '📄',  domain: 'crm',          section: 'setup'        },
  { id: 'team',          label: 'Team',         icon: '👥',  domain: 'operations',   section: 'setup'        },
  // ── Planning ──────────────────────────────────────────────────────────────────
  { id: 'scheduleimport', label: 'Import Schedule',   icon: '📅', domain: 'construction', section: 'planning' },
  { id: 'forecast',       label: 'Schedule Forecast', icon: '🎲', domain: 'construction', section: 'planning' },
  { id: 'riskregister',   label: 'Risk Register',     icon: '⚠️', domain: 'construction', section: 'planning' },
  { id: 'budget',         label: 'Budget',            icon: '💰', domain: 'finance',      section: 'planning' },
  { id: 'meetings',       label: 'Meetings',          icon: '📋', domain: 'construction', section: 'planning' },
  // ── Engineering ───────────────────────────────────────────────────────────────
  { id: 'feed',          label: 'FEED',         icon: '🔬',  domain: 'engineering',  section: 'engineering'  },
  { id: 'processdesign', label: 'Process Design', icon: '🧪', domain: 'engineering', section: 'engineering'  },
  { id: 'calc',          label: 'Calcs',        icon: '🧮',  domain: 'engineering',  section: 'engineering'  },
  { id: 'drawings',      label: 'Drawings',     icon: '📐',  domain: 'construction', section: 'engineering'  },
  { id: 'bim',           label: 'BIM',          icon: '🏢',  domain: 'construction', section: 'engineering'  },
  { id: 'hub',           label: 'Eng Hub',      icon: '🛠️',  domain: 'engineering',  section: 'engineering'  },
  { id: 'fixlibrary',    label: 'Fix Library',  icon: '🔧',  domain: 'engineering',  section: 'engineering'  },
  { id: 'rfis',          label: 'RFIs',         icon: '❓',  domain: 'construction', section: 'engineering'  },
  { id: 'submittals',    label: 'Submittals',   icon: '📨',  domain: 'construction', section: 'engineering'  },
  // ── Procurement ───────────────────────────────────────────────────────────────
  { id: 'subcontracts',   label: 'Subcontracts',     icon: '🏗️', domain: 'construction', section: 'procurement' },
  { id: 'procurementrisk', label: 'Procure Risk',    icon: '🚚', domain: 'construction', section: 'procurement' },
  { id: 'vendorscore',    label: 'Vendor Scorecard', icon: '🏅', domain: 'procurement',  section: 'procurement' },
  { id: 'directory',      label: 'Directory',        icon: '📚', domain: 'procurement',  section: 'procurement' },
  // ── Construction ──────────────────────────────────────────────────────────────
  { id: 'construction',  label: 'Construct',    icon: '🏗️',  domain: 'construction', section: 'construction' },
  { id: 'dailylogs',     label: 'Daily Logs',   icon: '🗓️',  domain: 'construction', section: 'construction' },
  { id: 'field',         label: 'Field Svc',    icon: '🛠️',  domain: 'field',        section: 'construction' },
  { id: 'fieldai',       label: 'Field Asst',   icon: '🦺',  domain: 'field',        section: 'construction' },
  { id: 'timesheets',    label: 'Timesheets',   icon: '⏱️',  domain: 'operations',   section: 'construction' },
  { id: 'iot',           label: 'IoT Sensors',  icon: '📡',  domain: 'construction', section: 'construction' },
  // ── Quality ───────────────────────────────────────────────────────────────────
  { id: 'inspections',   label: 'Inspections',  icon: '🔍',  domain: 'construction', section: 'quality'      },
  { id: 'punch',         label: 'Punch List',   icon: '📌',  domain: 'construction', section: 'quality'      },
  { id: 'ncr',           label: 'NCR / CAPA',   icon: '🚫',  domain: 'construction', section: 'quality'      },
  { id: 'quality',       label: 'Quality IQ',   icon: '🔬',  domain: 'construction', section: 'quality'      },
  // ── Safety ────────────────────────────────────────────────────────────────────
  { id: 'safety',        label: 'Safety',       icon: '🦺',  domain: 'construction', section: 'safety'       },
  { id: 'compliance',    label: 'Compliance',   icon: '🛡️',  domain: 'construction', section: 'safety'       },
  // ── Commercial ────────────────────────────────────────────────────────────────
  { id: 'changeorders',  label: 'Change Orders', icon: '🔄', domain: 'finance',      section: 'commercial'   },
  { id: 'costcontrol',   label: 'Cost Control',  icon: '📉', domain: 'finance',      section: 'commercial'   },
  { id: 'costentry',     label: 'Cost Entry',    icon: '💵', domain: 'finance',      section: 'commercial'   },
  { id: 'evm',           label: 'EVM',           icon: '📊', domain: 'finance',      section: 'commercial'   },
  { id: 'billing',       label: 'Billing',       icon: '🧾', domain: 'finance',      section: 'commercial'   },
  { id: 'costiq',        label: 'Cost IQ',       icon: '💸', domain: 'finance',      section: 'commercial'   },
  // ── Turnover ──────────────────────────────────────────────────────────────────
  { id: 'transmittals',  label: 'Transmittals', icon: '📬',  domain: 'documents',    section: 'turnover'     },
  { id: 'docs',          label: 'Documents',    icon: '🗄️',  domain: 'documents',    section: 'turnover'     },
  // ── Operations ────────────────────────────────────────────────────────────────
  { id: 'portfolio',     label: 'Portfolio',    icon: '💰',  domain: 'finance',      section: 'operations'   },
  // ── AI ────────────────────────────────────────────────────────────────────────
  { id: 'coordination',  label: 'Coordination', icon: '🔗',  domain: 'ai',           section: 'ai'           },
  { id: 'predict',       label: 'Predict',      icon: '🔮',  domain: 'ai',           section: 'ai'           },
  { id: 'autopilot',     label: 'Autopilot',    icon: '🤖',  domain: 'ai',           section: 'ai'           },
  { id: 'ask',           label: 'Ask Jarvis',   icon: '🤖',  domain: 'ai',           section: 'ai'           },
  // ── Executive ─────────────────────────────────────────────────────────────────
  { id: 'executive',     label: 'Executive',    icon: '📋',  domain: 'ai',           section: 'executive'    },
  { id: 'portfolioiq',   label: 'Portfolio IQ', icon: '🗂️',  domain: 'ai',           section: 'executive'    },
  { id: 'dash',          label: 'Dashboard',    icon: '📊',  domain: 'operations',   section: 'executive'    },
  // ── Administration ────────────────────────────────────────────────────────────
  { id: 'automation',    label: 'Automation',   icon: '⚙️',  domain: 'system',       section: 'admin'        },
  { id: 'integrations',  label: 'Integr.',      icon: '🔗',  domain: 'system',       section: 'admin'        },
  { id: 'mcp',           label: 'MCP',          icon: '🔌',  domain: 'system',       section: 'admin'        },
  { id: 'knowledge',     label: 'Knowledge',    icon: '📚',  domain: 'system',       section: 'admin'        },
  { id: 'system',        label: 'System',       icon: '⚙️',  domain: 'system',       section: 'admin'        },
]

/** Navigation items grouped by domain for sidebar rendering */
export const NAV_DOMAINS: Record<string, NavItem[]> = NAVIGATION_ITEMS.reduce(
  (acc, item) => {
    const domain = item.domain ?? 'other'
    if (!acc[domain]) acc[domain] = []
    acc[domain].push(item)
    return acc
  },
  {} as Record<string, NavItem[]>
)

/** Look up a nav item by id */
export function getNavItem(id: string): NavItem | undefined {
  return NAVIGATION_ITEMS.find(n => n.id === id)
}
