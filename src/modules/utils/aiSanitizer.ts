/**
 * Denver Engineering — AI Data Sanitizer
 * ─────────────────────────────────
 * Extracted from JarvisCore.jsx Phase 19 — P2-A monolith reduction.
 *
 * Sanitizes business state before sending to LLM:
 *   - Strips PII fields (R-13)
 *   - Truncates large arrays (R-14)
 *   - Enforces payload size limit
 */

// R-13: PII field patterns — stripped before sending to LLM
const PII_FIELDS: readonly string[] = [
  'contact', 'email', 'phone', 'address', 'ssn', 'social',
  'dob', 'birth', 'license_no', 'bank', 'account_no',
  'routing', 'emergency_contact',
]

// R-14: AI data filter limits
export const AI_MAX_ITEMS_PER_COLLECTION = 25
export const AI_MAX_PAYLOAD_CHARS        = 30_000

type SanitizeInput = unknown

/**
 * sanitizeForAI — recursively sanitize an object for LLM consumption.
 * Redacts PII fields and truncates arrays to AI_MAX_ITEMS_PER_COLLECTION.
 */
export function sanitizeForAI(obj: SanitizeInput): SanitizeInput {
  if (obj === null || obj === undefined)  return obj
  if (typeof obj === 'string')            return obj
  if (typeof obj === 'number')            return obj
  if (typeof obj === 'boolean')           return obj

  if (Array.isArray(obj)) {
    return (obj as SanitizeInput[])
      .slice(0, AI_MAX_ITEMS_PER_COLLECTION)
      .map(sanitizeForAI)
  }

  const record = obj as Record<string, SanitizeInput>
  const clean: Record<string, SanitizeInput> = {}

  for (const key of Object.keys(record)) {
    const keyLower = key.toLowerCase()
    const isPII    = PII_FIELDS.some(p => keyLower.includes(p))

    if (isPII) {
      clean[key] = '[REDACTED]'
    } else if (typeof record[key] === 'object' && record[key] !== null) {
      clean[key] = sanitizeForAI(record[key])
    } else {
      clean[key] = record[key]
    }
  }

  return clean
}

/**
 * sanitizeAndTruncate — sanitize then enforce character payload limit.
 * Returns a JSON string safe to include in an LLM prompt.
 */
export function sanitizeAndTruncate(obj: SanitizeInput): string {
  const sanitized = sanitizeForAI(obj)
  const json      = JSON.stringify(sanitized)
  return json.length > AI_MAX_PAYLOAD_CHARS
    ? json.slice(0, AI_MAX_PAYLOAD_CHARS) + '…'
    : json
}
