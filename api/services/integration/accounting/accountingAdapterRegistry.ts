/**
 * Denver Engineering — the provider adapter registry
 * ─────────────────────────────────────────────────────────────────────────────
 * The seam that keeps the transport neutral. The drainer resolves the adapter
 * for a job's provider through this and knows nothing else about it: not its
 * object model, not its auth, not its error vocabulary. Adding BillBox is
 * therefore a registration, not a change to the boundary.
 *
 * DELIBERATELY EMPTY AT BOOT
 * ──────────────────────────
 * No adapter is registered here, and that is the point of this slice. Denver
 * has a complete, exercised transport with nothing to send through it yet,
 * because BillBox has not published its receiving contract. Writing a BillBox
 * adapter now would mean guessing at that contract and baking the guess into
 * the EPC product, where it would be indistinguishable from a requirement.
 *
 * An unregistered provider is a RETRYABLE condition, not a rejection. A job
 * addressed to a provider whose adapter has not been deployed is a deployment
 * gap: the document is fine, and it will send once the adapter ships. Treating
 * it as a rejection would dead-letter perfectly good documents during a rollout
 * and require a human to re-emit each one. It still dead-letters eventually,
 * through the outbox's ordinary `max_attempts`, so a provider that never
 * arrives does not retry forever.
 */
import type {
  AccountingProviderAdapter, AccountingProviderId,
} from './accountingContract'

const REGISTRY = new Map<AccountingProviderId, AccountingProviderAdapter>()

/**
 * Register the adapter for one provider.
 *
 * Last registration wins, so a test can install a fake and a boot sequence can
 * be re-run idempotently. Registration is process-local and holds no tenant
 * state: an adapter is a protocol implementation, and the same one serves every
 * tenant. Anything tenant-specific — credentials, endpoints, enablement — lives
 * on `integration_connectors`, which is where the tenant predicate can reach it.
 */
export function registerAccountingAdapter(adapter: AccountingProviderAdapter): void {
  REGISTRY.set(adapter.id, adapter)
}

/** The adapter for a provider, or null when none is deployed. */
export function getAccountingAdapter(id: AccountingProviderId): AccountingProviderAdapter | null {
  return REGISTRY.get(id) ?? null
}

/** Which providers can actually be transmitted to right now. */
export function registeredAccountingProviders(): AccountingProviderId[] {
  return [...REGISTRY.keys()].sort()
}

/** Test seam. Never called in production code. */
export function clearAccountingAdapters(): void {
  REGISTRY.clear()
}
