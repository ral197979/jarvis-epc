/**
 * Denver Engineering — Commissioning integration config (PR-1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Feature flag + endpoint/secret accessors for the Denver ↔ Commissioning
 * boundary. Everything is OFF by default: with COMMISSIONING_EXTERNAL unset, the
 * outbound gateway is a no-op and no behavior changes (see
 * COMMISSIONING_EXTRACTION_PLAN.md §6, PR-1).
 *
 * Read live from the environment (not cached) so a test or operator can toggle
 * the flag without a process restart.
 */

/** Master switch for the external Commissioning integration. Default: off. */
export function isCommissioningExternalEnabled(): boolean {
  return process.env['COMMISSIONING_EXTERNAL'] === 'true'
}

/** Base URL of the external Commissioning platform API (no trailing slash). */
export function commissioningBaseUrl(): string {
  return (process.env['COMMISSIONING_BASE_URL'] ?? '').replace(/\/+$/, '')
}

/** Bearer token Denver presents on outbound calls to Commissioning. */
export function commissioningServiceToken(): string {
  return process.env['COMMISSIONING_SVC_TOKEN'] ?? ''
}

/** Shared secret used to verify HMAC signatures on inbound webhooks. */
export function commissioningWebhookSecret(): string {
  return process.env['COMMISSIONING_WEBHOOK_SECRET'] ?? ''
}

/** Outbound request timeout (ms). */
export function commissioningTimeoutMs(): number {
  return Number(process.env['COMMISSIONING_TIMEOUT_MS']) || 10_000
}
