/**
 * JARVIS EPC — System Tag Alias Normalization
 * v4.31.0
 *
 * Commissioning and field teams type asset tags inconsistently:
 *   CH-01, CH 01, CH_01, ch-01, Ch01
 *
 * Before correlating events to a failing test, we normalize both the
 * needle and the haystack text so a free-text match in a daily log
 * ("chiller CH_01 filter replaced") connects to a test against CH-01.
 *
 * No embeddings, no fuzzy matching — just deterministic casefolding +
 * separator collapse. Cheap, explainable, covers ~90% of real-world
 * operator inputs.
 */

/**
 * Normalize a system tag to its canonical form.
 * Rules:
 *   1. Uppercase
 *   2. Collapse runs of whitespace / underscore / hyphen to '-'
 *   3. Trim leading/trailing separators
 *
 * Examples:
 *   'CH-01'   → 'CH-01'
 *   'ch 01'   → 'CH-01'
 *   'ch_01'   → 'CH-01'
 *   'Ch--01'  → 'CH-01'
 *   '  CH01'  → 'CH01'       (no internal separator → unchanged shape)
 */
export function normalizeSystemTag(raw: string): string {
  if (!raw) return ''
  return raw
    .toUpperCase()
    .replace(/[\s_\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Produce a set of alternate-form patterns for a given tag, suitable
 * for OR-combining into an ILIKE clause. Includes the original
 * normalized form plus common variants ops might have typed.
 *
 * Example:
 *   tagAliases('CH-01') → ['CH-01', 'CH 01', 'CH_01', 'CH01']
 *
 * Callers escape for SQL themselves via parameterized queries.
 */
export function tagAliases(tag: string): string[] {
  const normalized = normalizeSystemTag(tag)
  if (!normalized) return []
  const parts = normalized.split('-')

  // Single-token tags have no separator to vary.
  if (parts.length === 1) return [normalized]

  const withSpace  = parts.join(' ')
  const withUnder  = parts.join('_')
  const withoutSep = parts.join('')
  // Dedup while preserving order.
  return Array.from(new Set([normalized, withSpace, withUnder, withoutSep]))
}

/**
 * Build an ILIKE OR clause fragment for a single column + the aliases
 * of a tag. Returns the SQL fragment and the param values in order.
 * Starting paramIdx lets callers splice into a larger query.
 *
 *   buildIlikeAliasOr('d.work_performed', 'CH-01', 5)
 *   → { sql: '(d.work_performed ILIKE $5 OR d.work_performed ILIKE $6 ...)',
 *       values: ['%CH-01%', '%CH 01%', ...],
 *       nextIdx: 9 }
 */
export function buildIlikeAliasOr(
  column: string,
  tag: string,
  paramIdx: number,
): { sql: string; values: string[]; nextIdx: number } {
  const aliases = tagAliases(tag)
  if (aliases.length === 0) {
    return { sql: 'FALSE', values: [], nextIdx: paramIdx }
  }
  const clauses: string[] = []
  const values:  string[] = []
  let i = paramIdx
  for (const alias of aliases) {
    clauses.push(`${column} ILIKE $${i}`)
    values.push(`%${alias}%`)
    i++
  }
  return { sql: `(${clauses.join(' OR ')})`, values, nextIdx: i }
}
