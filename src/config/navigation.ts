/**
 * JARVIS EPC — Navigation Configuration  (v4.28.0)
 * ─────────────────────────────────────────────────
 * Phase 18b extraction: Ci array from JarvisCore.jsx → typed NavItem[].
 * Import this instead of the inline Ci literal in JarvisCore.
 *
 * Usage:
 *   import { NAVIGATION_ITEMS, type NavItem } from '../config/navigation'
 *   // Replace: var Ci = [...] with: const Ci = NAVIGATION_ITEMS
 */

export interface NavItem {
  id:       string
  label:    string
  icon:     string
  domain?:  string
  hidden?:  boolean
}

export const NAVIGATION_ITEMS: NavItem[] = [
  { id: 'dash',          label: 'Dashboard',  icon: '📊',  domain: 'operations'    },
  { id: 'crm',           label: 'CRM',        icon: '🎯',  domain: 'crm'           },
  { id: 'feed',          label: 'FEED',       icon: '🔬',  domain: 'engineering'   },
  { id: 'projects',      label: 'Projects',   icon: '📋',  domain: 'operations'    },
  { id: 'construction',  label: 'Construct',  icon: '🏗️',  domain: 'construction'  },
  { id: 'dailylogs',     label: 'Daily Logs', icon: '🗓️',  domain: 'construction'  },
  { id: 'drawings',      label: 'Drawings',   icon: '📐',  domain: 'construction'  },
  { id: 'bim',           label: 'BIM',        icon: '🏢',  domain: 'construction'  },
  { id: 'rfis',          label: 'RFIs',       icon: '❓',  domain: 'construction'  },
  { id: 'submittals',    label: 'Submittals', icon: '📨',  domain: 'construction'  },
  { id: 'punch',         label: 'Punch List', icon: '📌',  domain: 'construction'  },
  { id: 'inspections',   label: 'Inspections', icon: '🔍', domain: 'construction'  },
  { id: 'compliance',    label: 'Compliance',  icon: '🛡️', domain: 'construction'  },
  { id: 'fixlibrary',    label: 'Fix Library', icon: '🔧', domain: 'engineering'   },
  { id: 'knowledge',     label: 'Knowledge',   icon: '📚', domain: 'system'        },
  { id: 'budget',        label: 'Budget',     icon: '💰',  domain: 'finance'       },
  { id: 'proposals',     label: 'Proposals',  icon: '📄',  domain: 'crm'           },
  { id: 'calc',          label: 'Calcs',      icon: '🧮',  domain: 'engineering'   },
  { id: 'hub',           label: 'Eng Hub',    icon: '🛠️',  domain: 'engineering'   },
  { id: 'team',          label: 'Team',       icon: '👥',  domain: 'operations'    },
  { id: 'portfolio',     label: 'Portfolio',  icon: '💰',  domain: 'finance'       },
  { id: 'predict',       label: 'Predict',    icon: '🔮',  domain: 'ai'            },
  { id: 'actions',       label: 'Actions',    icon: '⚡',  domain: 'operations'    },
  { id: 'field',         label: 'Field Svc',  icon: '🛠️',  domain: 'field'         },
  { id: 'docs',          label: 'Documents',  icon: '🗄️',  domain: 'documents'     },
  { id: 'directory',     label: 'Directory',  icon: '📚',  domain: 'procurement'   },
  { id: 'mcp',           label: 'MCP',        icon: '🔌',  domain: 'system'        },
  { id: 'automation',    label: 'Automation', icon: '⚙️',  domain: 'system'        },
  { id: 'integrations',  label: 'Integr.',    icon: '🔗',  domain: 'system'        },
  { id: 'notifications', label: 'Notifs',     icon: '🔔',  domain: 'operations'    },
  { id: 'system',        label: 'System',     icon: '⚙️',  domain: 'system'        },
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
