/**
 * Denver Engineering — Nova integration config (ADR-001, v1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Feature flag + endpoint/secret accessors for the Nova ↔ Denver boundary.
 * Everything is OFF by default: with NOVA_EXTERNAL unset, the outbox enqueue is
 * a no-op and the inbound command endpoint returns 503 (fail closed — a missing
 * secret is never replaced by a default).
 *
 * Read live from the environment (not cached) so a test or operator can toggle
 * the flag without a process restart. Mirrors cxConfig.ts.
 */

/** Master switch for the Nova integration. Default: off. */
export function isNovaExternalEnabled(): boolean {
  return process.env['NOVA_EXTERNAL'] === 'true'
}

/** Base URL of the Nova API (no trailing slash) — outbound event delivery target. */
export function novaBaseUrl(): string {
  return (process.env['NOVA_BASE_URL'] ?? '').replace(/\/+$/, '')
}

/** Shared secret used to verify HMAC signatures on inbound Nova → Denver commands. */
export function novaCommandSecret(): string {
  return process.env['NOVA_COMMAND_SECRET'] ?? ''
}

/**
 * Previous command secret, accepted alongside the current one during rotation
 * (contracts/v1/README.md security requirement 6). Empty when not rotating.
 */
export function novaCommandSecretPrevious(): string {
  return process.env['NOVA_COMMAND_SECRET_PREVIOUS'] ?? ''
}

/** Shared secret Denver uses to sign outbound Denver → Nova event webhooks. */
export function novaWebhookSecret(): string {
  return process.env['NOVA_WEBHOOK_SECRET'] ?? ''
}

/** Public URL of this Denver deployment (deep-link base Nova composes links from). */
export function novaPublicUrl(): string {
  return (process.env['NOVA_PUBLIC_URL'] ?? '').replace(/\/+$/, '')
}

/** Outbound request timeout (ms). */
export function novaTimeoutMs(): number {
  return Number(process.env['NOVA_TIMEOUT_MS']) || 10_000
}

/** Can Denver receive Nova commands? Flag on AND a verification secret present. */
export function isNovaCommandReceiverConfigured(): boolean {
  return isNovaExternalEnabled() && novaCommandSecret().length > 0
}

/** Can Denver deliver events to Nova? Flag on AND base URL + signing secret present. */
export function isNovaEventDeliveryConfigured(): boolean {
  return isNovaExternalEnabled() && novaBaseUrl().length > 0 && novaWebhookSecret().length > 0
}
