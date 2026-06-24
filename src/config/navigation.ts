/**
 * Denver Engineering — Navigation Configuration  (v4.28.0)
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
  { id: 'focus',         label: 'Focus',        icon: '🧭',  domain: 'ai'            },
  { id: 'coordination',  label: 'Coordination', icon: '🔗',  domain: 'ai'            },
  { id: 'executive',     label: 'Executive',    icon: '📋',  domain: 'ai'            },
  { id: 'portfolioiq',   label: 'Portfolio IQ', icon: '🗂️',  domain: 'ai'            },
  { id: 'autopilot',     label: 'Autopilot',    icon: '🤖',  domain: 'ai'            },
  { id: 'ask',           label: 'Ask Jarvis',   icon: '🤖',  domain: 'ai'            },
  { id: 'crm',           label: 'CRM',        icon: '🎯',  domain: 'crm'           },
  { id: 'feed',          label: 'FEED',       icon: '🔬',  domain: 'engineering'   },
  { id: 'projects',      label: 'Projects',   icon: '📋',  domain: 'operations'    },
  { id: 'construction',  label: 'Construct',  icon: '🏗️',  domain: 'construction'  },
  { id: 'dailylogs',     label: 'Daily Logs', icon: '🗓️',  domain: 'construction'  },
  { id: 'drawings',        label: 'Drawings',      icon: '📐',  domain: 'construction'  },
  { id: 'scheduleimport',  label: 'Import Schedule', icon: '📅',  domain: 'construction'  },
  { id: 'forecast',        label: 'Schedule Forecast', icon: '🎲', domain: 'construction' },
  { id: 'subcontracts',   label: 'Subcontracts',    icon: '🏗️',  domain: 'construction'  },
  { id: 'meetings',       label: 'Meetings',        icon: '📋',  domain: 'construction'  },
  { id: 'bim',           label: 'BIM',        icon: '🏢',  domain: 'construction'  },
  { id: 'iot',           label: 'IoT Sensors', icon: '📡', domain: 'construction'  },
  { id: 'rfis',          label: 'RFIs',       icon: '❓',  domain: 'construction'  },
  { id: 'submittals',    label: 'Submittals', icon: '📨',  domain: 'construction'  },
  { id: 'punch',         label: 'Punch List', icon: '📌',  domain: 'construction'  },
  { id: 'inspections',   label: 'Inspections', icon: '🔍', domain: 'construction'  },
  { id: 'compliance',    label: 'Compliance',  icon: '🛡️', domain: 'construction'  },
  { id: 'fixlibrary',    label: 'Fix Library', icon: '🔧', domain: 'engineering'   },
  { id: 'knowledge',     label: 'Knowledge',   icon: '📚', domain: 'system'        },
  { id: 'changeorders',  label: 'Change Orders', icon: '🔄', domain: 'finance'      },
  { id: 'costcontrol',   label: 'Cost Control',  icon: '📉', domain: 'finance'      },
  { id: 'costentry',     label: 'Cost Entry',    icon: '💵', domain: 'finance'      },
  { id: 'billing',       label: 'Billing',       icon: '🧾', domain: 'finance'      },
  { id: 'timesheets',    label: 'Timesheets',    icon: '⏱️', domain: 'operations'   },
  { id: 'riskregister',  label: 'Risk Register', icon: '⚠️', domain: 'construction' },
  { id: 'evm',           label: 'EVM',        icon: '📊',  domain: 'finance'       },
  { id: 'budget',        label: 'Budget',     icon: '💰',  domain: 'finance'       },
  { id: 'proposals',     label: 'Proposals',  icon: '📄',  domain: 'crm'           },
  { id: 'processdesign', label: 'Process Design', icon: '🧪', domain: 'engineering' },
  { id: 'calc',          label: 'Calcs',      icon: '🧮',  domain: 'engineering'   },
  { id: 'hub',           label: 'Eng Hub',    icon: '🛠️',  domain: 'engineering'   },
  { id: 'team',          label: 'Team',       icon: '👥',  domain: 'operations'    },
  { id: 'portfolio',     label: 'Portfolio',  icon: '💰',  domain: 'finance'       },
  { id: 'predict',       label: 'Predict',    icon: '🔮',  domain: 'ai'            },
  { id: 'actions',       label: 'Actions',    icon: '⚡',  domain: 'operations'    },
  { id: 'field',         label: 'Field Svc',  icon: '🛠️',  domain: 'field'         },
  { id: 'fieldai',       label: 'Field Asst', icon: '🦺',  domain: 'field'         },
  { id: 'transmittals',  label: 'Transmittals', icon: '📬', domain: 'documents'     },
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
