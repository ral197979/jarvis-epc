/**
 * Denver Engineering — Project Templates
 * ────────────────────────────────
 * v4.31.0 | Composite presets that bundle the equipment templates from
 * rules.ts into starter scopes for a project category.
 *
 * Use as a *starter scope generator*, not a rigid classifier — the user
 * picks a project type, gets a default system list, then adds/removes
 * before generating the matrix and packs.
 *
 * Layered model:
 *   Asset template   — single equipment checklist (rules.ts ASSET_RULES)
 *   Project template — bundle of asset templates + defaults (this file)
 *   Project instance — actual project created from a template, editable
 */

import type { CxAsset } from './rules'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProjectTemplateKey =
  | 'wwtp'
  | 'pwtp'
  | 'commercial_building'
  | 'utility_plant'
  | 'hospital'
  | 'data_center'
  | 'industrial_plant'

/** A system slot inside a project template — produces one CxAsset on instantiation. */
export interface ProjectTemplateSystem {
  /** Display name shown in the picker (also used as the synthetic asset description). */
  name:      string
  /** rules.ts asset key — must match an entry in ASSET_RULES (or be inferable). */
  assetType: string
  /** Tag prefix used to build the asset tag (e.g. 'P-' → 'P-001'). */
  tagPrefix: string
}

export interface ProjectTemplate {
  key:         ProjectTemplateKey
  label:       string
  description: string
  systems:     ProjectTemplateSystem[]
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const PROJECT_TEMPLATES: Record<ProjectTemplateKey, ProjectTemplate> = {
  wwtp: {
    key: 'wwtp',
    label: 'Wastewater Treatment Plant',
    description: 'Influent through clarification and disinfection. Pumps, blowers, mixers, dosing, sludge handling.',
    systems: [
      { name: 'Influent Pumps',      assetType: 'pump',                tagPrefix: 'P-INF-' },
      { name: 'Lift Station',        assetType: 'lift station',        tagPrefix: 'LS-'    },
      { name: 'Aeration Blowers',    assetType: 'blower',              tagPrefix: 'BL-'    },
      { name: 'Process Mixers',      assetType: 'mixer',               tagPrefix: 'MX-'    },
      { name: 'Chemical Dosing Skid',assetType: 'dosing skid',         tagPrefix: 'DS-'    },
      { name: 'Clarifier',           assetType: 'clarifier',           tagPrefix: 'CL-'    },
      { name: 'Sludge Pumps',        assetType: 'pump',                tagPrefix: 'P-SL-'  },
      { name: 'Control Panel',       assetType: 'panel',               tagPrefix: 'CP-'    },
      { name: 'Process Instruments', assetType: 'instrument',          tagPrefix: 'IT-'    },
    ],
  },
  pwtp: {
    key: 'pwtp',
    label: 'Potable Water Treatment Plant',
    description: 'Raw water through RO, dosing and disinfection to potable distribution.',
    systems: [
      { name: 'Raw Water Pumps',     assetType: 'pump',                tagPrefix: 'P-RW-'  },
      { name: 'Transfer Pumps',      assetType: 'pump',                tagPrefix: 'P-TX-'  },
      { name: 'RO Skid',             assetType: 'ro skid',             tagPrefix: 'RO-'    },
      { name: 'Chemical Dosing Skid',assetType: 'dosing skid',         tagPrefix: 'DS-'    },
      { name: 'UV Disinfection',     assetType: 'uv system',           tagPrefix: 'UV-'    },
      { name: 'Chlorination System', assetType: 'chlorination system', tagPrefix: 'CHL-'   },
      { name: 'Filter Train',        assetType: 'filter',              tagPrefix: 'F-'     },
      { name: 'Control Panel',       assetType: 'panel',               tagPrefix: 'CP-'    },
      { name: 'Process Instruments', assetType: 'instrument',          tagPrefix: 'IT-'    },
    ],
  },
  commercial_building: {
    key: 'commercial_building',
    label: 'Commercial Building',
    description: 'HVAC, life safety, electrical and domestic water for an office/retail/mixed-use building.',
    systems: [
      { name: 'Air Handling Unit',     assetType: 'ahu',          tagPrefix: 'AHU-' },
      { name: 'Chiller',               assetType: 'chiller',      tagPrefix: 'CH-'  },
      { name: 'Chilled Water Pumps',   assetType: 'pump',         tagPrefix: 'P-CHW-' },
      { name: 'Cooling Tower',         assetType: 'fan',          tagPrefix: 'CT-'  },
      { name: 'Fire Alarm Panel',      assetType: 'panel',        tagPrefix: 'FAP-' },
      { name: 'Standby Generator',     assetType: 'generator',    tagPrefix: 'GEN-' },
      { name: 'UPS Distribution Panel',assetType: 'panel',        tagPrefix: 'UPS-' },
      { name: 'Domestic Water Booster',assetType: 'pump',         tagPrefix: 'P-DW-' },
      { name: 'Main Switchboard',      assetType: 'panel',        tagPrefix: 'MSB-' },
    ],
  },
  utility_plant: {
    key: 'utility_plant',
    label: 'Utility Plant',
    description: 'Generic utility/process plant — pumping, motors, valves, generation, controls.',
    systems: [
      { name: 'Process Pumps',         assetType: 'pump',             tagPrefix: 'P-'   },
      { name: 'Drive Motors',          assetType: 'motor',            tagPrefix: 'M-'   },
      { name: 'Control Valves',        assetType: 'valve',            tagPrefix: 'V-'   },
      { name: 'Standby Generator',     assetType: 'generator',        tagPrefix: 'GEN-' },
      { name: 'PLC / SCADA Cabinet',   assetType: 'plc',              tagPrefix: 'PLC-' },
      { name: 'MCC / Power Panel',     assetType: 'panel',            tagPrefix: 'MCC-' },
      { name: 'Heat Exchanger',        assetType: 'pump',             tagPrefix: 'HX-'  },
    ],
  },
  hospital: {
    key: 'hospital',
    label: 'Hospital',
    description: 'Healthcare-grade HVAC, heating, life safety and standby power.',
    systems: [
      { name: 'Air Handling Unit',     assetType: 'ahu',         tagPrefix: 'AHU-' },
      { name: 'Chiller',               assetType: 'chiller',     tagPrefix: 'CH-'  },
      { name: 'Boiler',                assetType: 'boiler',      tagPrefix: 'B-'   },
      { name: 'Standby Generator',     assetType: 'generator',   tagPrefix: 'GEN-' },
      { name: 'UPS Distribution Panel',assetType: 'panel',       tagPrefix: 'UPS-' },
      { name: 'Fire Alarm Panel',      assetType: 'panel',       tagPrefix: 'FAP-' },
      { name: 'Critical Power Panel',  assetType: 'panel',       tagPrefix: 'CPP-' },
    ],
  },
  data_center: {
    key: 'data_center',
    label: 'Data Center',
    description: 'High-density cooling, redundant power and life safety for IT loads.',
    systems: [
      { name: 'CRAH / AHU',            assetType: 'ahu',         tagPrefix: 'CRAH-' },
      { name: 'Chiller',               assetType: 'chiller',     tagPrefix: 'CH-'   },
      { name: 'Chilled Water Pumps',   assetType: 'pump',        tagPrefix: 'P-CHW-' },
      { name: 'UPS Distribution Panel',assetType: 'panel',       tagPrefix: 'UPS-'  },
      { name: 'Standby Generator',     assetType: 'generator',   tagPrefix: 'GEN-'  },
      { name: 'Fire Alarm Panel',      assetType: 'panel',       tagPrefix: 'FAP-'  },
      { name: 'PLC / BMS Cabinet',     assetType: 'plc',         tagPrefix: 'BMS-'  },
    ],
  },
  industrial_plant: {
    key: 'industrial_plant',
    label: 'Industrial Plant',
    description: 'Process pumping, motors, drives and instrumentation for a generic industrial facility.',
    systems: [
      { name: 'Process Pumps',         assetType: 'pump',        tagPrefix: 'P-'    },
      { name: 'Drive Motors',          assetType: 'motor',       tagPrefix: 'M-'    },
      { name: 'Variable Speed Drives', assetType: 'vfd',         tagPrefix: 'VFD-'  },
      { name: 'Control Valves',        assetType: 'valve',       tagPrefix: 'V-'    },
      { name: 'PLC Cabinet',           assetType: 'plc',         tagPrefix: 'PLC-'  },
      { name: 'MCC / Power Panel',     assetType: 'panel',       tagPrefix: 'MCC-'  },
      { name: 'Process Instruments',   assetType: 'instrument',  tagPrefix: 'IT-'   },
    ],
  },
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

export function listProjectTemplates(): ProjectTemplate[] {
  return Object.values(PROJECT_TEMPLATES)
}

export function getProjectTemplate(key: ProjectTemplateKey): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES[key]
}

/**
 * Resolve a free-form string (e.g. "wwtp", "wastewater", "hospital") to a
 * project template key. Returns undefined if no match — callers should fall
 * back to per-asset commissioning or prompt the user.
 */
export function resolveProjectTemplateKey(raw: string): ProjectTemplateKey | undefined {
  const v = raw.toLowerCase().trim()
  if (!v) return undefined
  if (v === 'wwtp' || v.includes('wastewater') || v.includes('waste water')) return 'wwtp'
  if (v === 'pwtp' || v.includes('potable')    || v.includes('drinking water')) return 'pwtp'
  if (v.includes('hospital') || v.includes('healthcare') || v.includes('clinic')) return 'hospital'
  if (v.includes('data center') || v.includes('data centre') || v.includes('datacenter')) return 'data_center'
  if (v.includes('commercial') || v.includes('office') || v.includes('retail') || v.includes('building')) return 'commercial_building'
  if (v.includes('utility'))    return 'utility_plant'
  if (v.includes('industrial') || v.includes('plant') || v.includes('factory')) return 'industrial_plant'
  return undefined
}

// ─── Instantiation ────────────────────────────────────────────────────────────

export interface InstantiatedProject {
  /** Synthetic system (a "contract" in BizStore parlance) — groups the assets. */
  system: { id: string; name: string; type: string }
  /** One CxAsset per selected system — fed straight into rules.ts generateMatrixRows. */
  assets: CxAsset[]
}

/**
 * Instantiate a project template into a synthetic system + one CxAsset per
 * selected slot. Pass selectedSystemNames to limit which slots get included
 * (defaults to all slots).
 *
 * Asset tags are built as `${tagPrefix}001` per slot — adequate for v1
 * starter scope. Users can rename in the asset editor.
 */
export function instantiateProjectTemplate(
  key:                   ProjectTemplateKey,
  projectName:           string,
  selectedSystemNames?:  Set<string>,
): InstantiatedProject {
  const template = PROJECT_TEMPLATES[key]
  if (!template) throw new Error(`Unknown project template: ${key}`)

  const selected = selectedSystemNames
    ? template.systems.filter(s => selectedSystemNames.has(s.name))
    : template.systems

  const systemId = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const system = {
    id:   systemId,
    name: projectName.trim() || template.label,
    type: template.key,
  }

  const assets: CxAsset[] = selected.map((slot, idx) => ({
    id:          `asset-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
    systemId,
    tag:         `${slot.tagPrefix}001`,
    type:        slot.assetType,
    description: slot.name,
  }))

  return { system, assets }
}
