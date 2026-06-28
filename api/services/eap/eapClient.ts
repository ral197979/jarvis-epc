/**
 * Denver Engineering — EAP document client (R7)
 * ─────────────────────────────────────────────────────────────────────────────
 * Routes Denver's engineering-document generation to AEC's EAP Document Factory —
 * the single document authority (ECOSYSTEM_INTEGRATION_CONTRACT.md §10). Denver
 * never renders documents itself; it requests generation and stores a REFERENCE
 * (URL + sha256). Producer renders, consumer stores the ref.
 *
 * Additive + flag-gated, mirroring commissioningGateway: with EAP_ENABLED off
 * (default) every call is a no-op returning { enabled:false } and never touches
 * the network. Reuses AEC_BASE_URL (already used by the R2 capability registry).
 */

export function isEapEnabled(): boolean {
  return process.env['EAP_ENABLED'] === 'true'
}
function eapBaseUrl(): string {
  return (process.env['AEC_BASE_URL'] ?? '').replace(/\/+$/, '')
}
function eapToken(): string {
  return process.env['AEC_SVC_TOKEN'] ?? ''
}
function eapTimeoutMs(): number {
  return Number(process.env['EAP_TIMEOUT_MS']) || 15_000
}

/** Reference catalogue of EAP engineering-document types (EAP owns the master). */
export const EAP_DOC_TYPES = [
  'fds', 'sequence_of_operations', 'fat', 'sat', 'fpt',
  'om_manual', 'test_procedure', 'turnover_package', 'commissioning_report',
] as const
export type EapDocType = typeof EAP_DOC_TYPES[number]
const DOC_SET = new Set<string>(EAP_DOC_TYPES)
export function isEapDocType(t: string): t is EapDocType { return DOC_SET.has(t) }

export interface GenerateDocInput {
  doc_type: string
  project_id: string
  subject_uuid?: string | null   // Universal Object Registry ref (R4)
  payload: Record<string, unknown>
  idempotency_key?: string
}

/** A document reference Denver stores (never the rendered bytes). */
export interface DocumentRef { url: string; sha256: string; doc_type: string }

export type EapResult<T> = ({ enabled: true } & T) | { enabled: false }
const DISABLED = { enabled: false } as const

async function _request<T>(method: 'POST', path: string, body: unknown, idempotencyKey?: string): Promise<T> {
  const base = eapBaseUrl()
  if (!base) throw new Error('AEC_BASE_URL not configured')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), eapTimeoutMs())
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${eapToken()}`,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`eap ${method} ${path} → ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** Generate an engineering document via EAP; returns a stored-as-reference doc. */
export async function generateDocument(
  input: GenerateDocInput,
): Promise<EapResult<{ document: DocumentRef }>> {
  if (!isEapEnabled()) return DISABLED
  const res = await _request<{ url: string; sha256: string; doc_type?: string }>(
    'POST', '/api/doc-factory/generate', input, input.idempotency_key,
  )
  return { enabled: true, document: { url: res.url, sha256: res.sha256, doc_type: res.doc_type ?? input.doc_type } }
}

/** Export a previously generated document to a format; returns a doc reference. */
export async function exportDocument(
  documentId: string, format: string,
): Promise<EapResult<{ document: DocumentRef }>> {
  if (!isEapEnabled()) return DISABLED
  const res = await _request<{ url: string; sha256: string }>(
    'POST', '/api/doc-factory/export', { document_id: documentId, format },
  )
  return { enabled: true, document: { url: res.url, sha256: res.sha256, doc_type: format } }
}
