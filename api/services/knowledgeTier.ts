/**
 * Denver Engineering — Knowledge Source Tier Classifier (v4.31.0)
 *
 * Heuristically classifies a source title into one of four tiers so
 * retrieval can boost authoritative content above noise:
 *
 *   oem    — manufacturer IOM/manual (Carrier, Daikin, Yaskawa, etc.)
 *   record — commissioning / start-up / maintenance record narrative
 *   form   — templates, checklists, blank forms (low information density)
 *   other  — anything else (regulatory, training, misc)
 *
 * Classification is pure string-matching for v1 — cheap, explainable,
 * and accurate enough for the observed commissioning-doc corpus
 * (1,240 PDFs across HVAC/water/wastewater/VFD/PLC domains). If quality
 * plateaus we upgrade to an LLM classifier running as an ingest-time job.
 */

export type SourceTier = 'oem' | 'record' | 'form' | 'other'

// Weights applied to the lexical FTS score. OEM gets a meaningful boost;
// forms get a meaningful penalty so commissioning checklists don't
// flood the top results when you ask a question the manual answers.
export const TIER_WEIGHT: Record<SourceTier, number> = {
  oem:    1.5,
  record: 1.0,
  form:   0.4,
  other:  0.7,
}

// OEM detection — manufacturer names that appear in engineering IOMs
// across the observed corpus. Case-insensitive.
const OEM_BRANDS = [
  'carrier','daikin','trane','york','lennox','copeland',
  'yaskawa','abb','danfoss','mitsubishi','schneider','teco','weg','siemens',
  'allen-bradley','allen bradley','rockwell','automation-direct','automationdirect',
  'grundfos','franklin','bell-gossett','bell & gossett','taco','armstrong',
  'hach','emerson','fisher','rosemount','honeywell','johnson-controls','johnson controls',
  'baldor','leeson','fluke','fieldserver','contemporary-controls','redlion','red lion',
  'watts','viega','victaulic','anvil','nibco','conbraco',
  // 'ge' alone is too short — matches 'hydroGEn' etc. Use 'general electric' full form only.
  'aquaforce','pentair','general electric','square-d',
  'flotronic','flofab','seepex','netzsch','cla-val','belimo',
  'maple-systems','maple systems','babel-buster','babel buster',
  'mitsubishi-electric','mitsubishielectric',
]

// Record-type cues: commissioning/maintenance/field-report narratives.
const RECORD_CUES = [
  'start-up','start up','startup','commissioning','commissioned',
  'maintenance record','maintenance report','service report','service record',
  'field report','trip report','installation report',
  'daily report','daily log','monthly report','annual report',
  'turnover','close-out','closeout','punch',
  'pre-functional','prefunctional','functional test',
]

// Form/template cues — low info density, high keyword hit rate.
const FORM_CUES = [
  'form','template','checklist','blank',
  'spec-sheet','spec sheet','datasheet','data sheet',
  'sign-off','sign off','signoff',
  'submittal','rfq','rfp','purchase order','po ',
  // Common fillable-form filename patterns from this corpus
  'io list','wet boq','boq','punch list',
]

export function classifySource(title: string, kind?: string | null): SourceTier {
  const t = (title ?? '').toLowerCase()
  const k = (kind  ?? '').toLowerCase()

  // kind='form' passed from the caller is a strong signal — trust it.
  if (k === 'form' || k === 'template') return 'form'

  // OEM wins over the others when a known brand appears, since IOMs
  // often contain words like "maintenance" that would otherwise trip
  // the record heuristic.
  for (const brand of OEM_BRANDS) {
    if (t.includes(brand)) return 'oem'
  }

  // Form check before record — "pre-functional checklist" should be a
  // form, not a record, because its density is low (it's mostly blanks).
  for (const cue of FORM_CUES) {
    if (t.includes(cue)) return 'form'
  }

  for (const cue of RECORD_CUES) {
    if (t.includes(cue)) return 'record'
  }

  return 'other'
}

// Expose the heuristic tables for testing / admin introspection.
export const __tierTables = { OEM_BRANDS, RECORD_CUES, FORM_CUES }
