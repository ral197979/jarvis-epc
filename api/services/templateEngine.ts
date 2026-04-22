/**
 * JARVIS EPC — Commissioning Pack Template Engine
 * ─────────────────────────────────────────────────
 * v4.30.0 | Bridges EngineeringHub v11 pack generation to JarvisEPC rules.ts
 *
 * Replaces EngineeringHub's static 5-type library with JarvisEPC's rules engine,
 * expanding coverage from 5 system types to 18+ and producing typed, structured
 * pack payloads that match CIBaseline audit expectations.
 *
 * Pack payload shape (stored in commissioning_packs.payload_json):
 *   {
 *     plan:  string[]   — commissioning plan milestones
 *     pfc:   string[]   — pre-functional checklist items
 *     fpt:   string[]   — functional performance test steps
 *     notes: string[]   — auto-generated + reviewer-appended notes
 *   }
 *
 * System type → rules.ts key mapping:
 *   EngineeringHub → JarvisEPC rules key
 *   'chiller'      → 'chiller'
 *   'pwtp'         → 'ro skid'   (RO-based potable water treatment)
 *   'wwtp'         → 'pump'      (nearest match; WWTP uses pump/blower assets)
 *   'ahu'          → 'ahu'
 *   'generator'    → 'generator'
 *   'vfd'          → 'vfd'       (new — not in EngineeringHub)
 *   'boiler'       → 'boiler'    (new)
 *   'pump'         → 'pump'      (new)
 *   ... all 18 rules.ts types supported
 *
 * Ava integration point:
 *   Replace buildDraftPack() with an Ava MCP call when the MCP server is
 *   reachable. The payload shape is identical — Ava just produces richer content.
 */

import {
  generatePack,
  generateMatrixRows,
  type CxAsset,
  type CxPack,
} from '../../src/modules/commissioning/rules'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PackPayload {
  plan:  string[]
  pfc:   string[]
  fpt:   string[]
  notes: string[]
}

// ─── System type normalisation ────────────────────────────────────────────────

/**
 * Maps user-visible system type strings to rules.ts asset type keys.
 * Case-insensitive. Falls back to 'pump' (safest generic set).
 *
 * Project-type strings (wwtp, pwtp, commercial building, etc.) are
 * intentionally NOT handled here — they are *composite* templates that
 * expand into many assets, not a single asset checklist. The client-side
 * Project Setup tab (CxWorkflowView) calls projectTemplates.ts to do that
 * expansion. If a project-type string reaches this function, we map it to
 * the most representative single-asset checklist as a graceful fallback.
 */
export function normaliseSystemType(raw: string): string {
  const v = raw.toLowerCase().trim()

  // Specific water/wastewater system types (must come before pump/fan checks)
  if (v.includes('lift station') || v.includes('lift-station'))  return 'lift station'
  if (v.includes('clarifier'))                                   return 'clarifier'
  if (v.includes('uv') && (v.includes('system') || v.includes('reactor') || v.includes('disinfect'))) return 'uv system'
  if (v.includes('chlorin') || v.includes('hypochlorite'))       return 'chlorination system'
  if (v.includes('dosing') || v.includes('chem feed') || v.includes('chemical feed')) return 'dosing skid'
  if (v.includes('mixer') || v.includes('agitator') || v.includes('flocculator')) return 'mixer'
  if (v.includes('blower'))                                      return 'blower'
  if (v.includes('filter') && !v.includes('pre-filter') && !v.includes('prefilter')) return 'filter'
  if (v.includes('analyzer') || v.includes('analyser') || v.includes('transmitter') || v.includes('instrument') || v.includes('sensor')) return 'instrument'

  // General mechanical / electrical
  if (v === 'chiller' || v.includes('chiller'))                  return 'chiller'
  if (v === 'ahu'     || v.includes('air handling'))             return 'ahu'
  if (v === 'generator' || v.includes('genset'))                 return 'generator'
  if (v === 'vfd'     || v.includes('drive') || v.includes('vsd')) return 'vfd'
  if (v === 'boiler'  || v.includes('boiler'))                   return 'boiler'
  if (v === 'pump'    || v.includes('pump'))                     return 'pump'
  if (v === 'fan'     || v.includes('fan'))                      return 'fan'
  if (v === 'motor'   || v.includes('motor'))                    return 'motor'
  if (v === 'valve'   || v.includes('valve'))                    return 'valve'
  if (v === 'panel'   || v.includes('panel') || v.includes('mcc') || v.includes('switchboard') || v.includes('ups')) return 'panel'
  if (v === 'plc'     || v.includes('plc') || v.includes('scada') || v.includes('bms')) return 'plc'

  // RO / potable single-asset alias
  if (v === 'ro skid' || v.includes('reverse osmosis') || v.includes('ro '))
    return 'ro skid'

  // Project-type strings — these are composites; pick a representative asset
  // as a graceful fallback when the client sends the project key directly.
  if (v === 'pwtp' || v.includes('potable') || v.includes('drinking water')) return 'ro skid'
  if (v === 'wwtp' || v.includes('waste water') || v.includes('wastewater'))  return 'blower'
  if (v.includes('commercial')  || v.includes('office') || v.includes('retail')) return 'ahu'
  if (v.includes('hospital')    || v.includes('healthcare'))                     return 'ahu'
  if (v.includes('data center') || v.includes('datacenter'))                     return 'ahu'
  if (v.includes('industrial')) return 'pump'
  if (v.includes('utility'))    return 'pump'

  return 'pump' // fallback
}

// ─── Synthetic CxAsset builder ────────────────────────────────────────────────

/**
 * Builds a minimal CxAsset from the pack request so rules.ts
 * generateMatrixRows / generatePack can operate normally.
 */
function _syntheticAsset(systemType: string, title: string): CxAsset {
  return {
    id:          `synthetic-${Date.now()}`,
    systemId:    `sys-${normaliseSystemType(systemType)}`,
    tag:         title.slice(0, 20).toUpperCase().replace(/\s+/g, '-'),
    type:        normaliseSystemType(systemType),
    description: title,
  }
}

// ─── Draft pack builder ───────────────────────────────────────────────────────

/**
 * Generates a structured draft pack payload from the rules engine.
 *
 * @param systemType   User-supplied system type string (normalised internally)
 * @param title        Pack title (used to build synthetic asset tag)
 * @param inputText    Engineer's free-text scope description
 * @param extractedText Optional: text extracted from uploaded spec document
 * @returns PackPayload — ready to store in commissioning_packs.payload_json
 */
export function buildDraftPack(
  systemType:    string,
  title:         string,
  inputText:     string,
  extractedText: string = '',
): PackPayload {
  const normType = normaliseSystemType(systemType)
  const asset    = _syntheticAsset(systemType, title)

  // Generate matrix rows for the asset (one row per commissioning phase)
  const matrixRows = generateMatrixRows(asset.systemId, [asset])

  // Collect steps from all generated packs across cx phases
  const plan: string[] = []
  const pfc:  string[] = []
  const fpt:  string[] = []

  for (const row of matrixRows) {
    const pack: CxPack = generatePack(row)

    // Map CxPack steps to plan / pfc / fpt buckets by cx phase
    for (const step of pack.steps ?? []) {
      // v4.31.0 TS fix: CxPackStep has `action`, not `description` — the
      // pack step's human-readable text is its action field.
      const text = step.action ?? step.id
      if (row.phase === 'pre_commissioning')          plan.push(text)
      else if (row.phase === 'pre_functional')        pfc.push(text)
      else if (row.phase === 'functional_performance') fpt.push(text)
    }
  }

  // Build source summary for notes
  const sourceSummary = [inputText, extractedText]
    .filter(Boolean)
    .join(' ')
    .slice(0, 300)

  const notes: string[] = [
    `Draft generated by JARVIS EPC v4.30.0 — system type: ${normType}`,
    sourceSummary ? `Source summary: ${sourceSummary}` : 'No source document provided.',
  ]

  return { plan, pfc, fpt, notes }
}

// ─── Review edit applicator ───────────────────────────────────────────────────

/**
 * Applies reviewer notes to a draft payload before finalization.
 * Does not mutate the original — returns a new payload.
 */
export function applyReviewEdits(
  draft:       PackPayload,
  reviewNotes: string,
): PackPayload {
  return {
    ...draft,
    notes: [
      ...draft.notes,
      reviewNotes.trim()
        ? `Reviewer notes: ${reviewNotes.slice(0, 500)}`
        : 'No reviewer notes provided.',
    ],
  }
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

/**
 * Renders a PackPayload to a Markdown string for download.
 */
export function renderMarkdown(title: string, systemType: string, payload: PackPayload): string {
  const lines: string[] = [
    `# ${title}`,
    '',
    `**System Type:** ${systemType.toUpperCase()}`,
    `**Generated:** ${new Date().toISOString()}`,
    '',
    '---',
    '',
    '## Commissioning Plan',
    ...payload.plan.map(x => `- ${x}`),
    '',
    '## Pre-Functional Checklist',
    ...payload.pfc.map(x => `- [ ] ${x}`),
    '',
    '## Functional Performance Tests',
    ...payload.fpt.map((x, i) => `${i + 1}. ${x}`),
    '',
    '## Notes',
    ...payload.notes.map(x => `> ${x}`),
  ]
  return lines.join('\n')
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

/**
 * Renders a PackPayload to a standalone HTML string.
 * Styled for print / Puppeteer PDF generation.
 */
export function renderHtml(title: string, systemType: string, payload: PackPayload): string {
  const listItems = (items: string[], ordered = false) => {
    const tag = ordered ? 'ol' : 'ul'
    return `<${tag}>\n${items.map(x => `  <li>${_esc(x)}</li>`).join('\n')}\n</${tag}>`
  }
  const checkItems = (items: string[]) =>
    `<ul class="checklist">\n${items.map(x => `  <li><input type="checkbox"> ${_esc(x)}</li>`).join('\n')}\n</ul>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${_esc(title)}</title>
  <style>
    body          { font-family: 'Segoe UI', Arial, sans-serif; max-width: 900px; margin: 40px auto; color: #1a1a2e; }
    h1            { border-bottom: 3px solid #00d4aa; padding-bottom: 8px; }
    h2            { color: #0f3460; margin-top: 2em; }
    .meta         { color: #666; font-size: 0.9em; margin-bottom: 2em; }
    ul, ol        { line-height: 1.8; }
    .checklist li { list-style: none; }
    .checklist li input { margin-right: 8px; }
    blockquote    { border-left: 4px solid #00d4aa; padding-left: 1em; color: #555; margin: 0.5em 0; }
    @media print  { body { margin: 20px; } }
  </style>
</head>
<body>
  <h1>${_esc(title)}</h1>
  <div class="meta">
    <strong>System Type:</strong> ${_esc(systemType.toUpperCase())} &nbsp;|&nbsp;
    <strong>Generated:</strong> ${new Date().toISOString()}
  </div>

  <h2>Commissioning Plan</h2>
  ${listItems(payload.plan)}

  <h2>Pre-Functional Checklist</h2>
  ${checkItems(payload.pfc)}

  <h2>Functional Performance Tests</h2>
  ${listItems(payload.fpt, true)}

  <h2>Notes</h2>
  ${payload.notes.map(n => `<blockquote>${_esc(n)}</blockquote>`).join('\n  ')}
</body>
</html>`
}

function _esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
