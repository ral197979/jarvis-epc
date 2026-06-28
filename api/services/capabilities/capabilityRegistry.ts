/**
 * Denver Engineering — AI Capability Registry (R2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Denver asks for a CAPABILITY, never a hardcoded specialist URL
 * (ECOSYSTEM_INTEGRATION_CONTRACT.md §5). This module resolves a canonical
 * capability (e.g. 'process.design', 'doc.generate') to the provider that serves
 * it, using live environment config so providers can be (re)pointed without code
 * changes.
 *
 * Additive + flag-gated: nothing in Denver's request paths is rewired by R2. The
 * existing single-provider Ava bridge (api/routes/mcp.ts, AVA_MCP_URL) keeps
 * working unchanged — it is also exposed here as the `ava` provider so callers
 * can migrate incrementally. `getProviderFor()` returns DISABLED until the
 * CAPABILITY_REGISTRY flag is set, mirroring the commissioningGateway pattern.
 *
 * Env is read live (getters) so tests can set process.env per-case.
 */

export type Transport = 'mcp' | 'rest'

export interface Provider {
  id: string
  label: string
  transport: Transport
  /** Configured base URL/command, or null when the env var is unset. */
  baseUrl: string | null
  /** Canonical capabilities this provider serves. */
  capabilities: string[]
}

export interface ResolvedProvider extends Provider { baseUrl: string }

export class UnknownCapabilityError extends Error {
  constructor(capability: string) {
    super(`no provider serves capability: ${capability}`)
    this.name = 'UnknownCapabilityError'
  }
}

export class ProviderUnavailableError extends Error {
  constructor(capability: string) {
    super(`capability '${capability}' has providers, but none are configured`)
    this.name = 'ProviderUnavailableError'
  }
}

// ─── Config (read live so tests/operators can change env without reload) ───────

function env(name: string): string | null {
  const v = process.env[name]
  return v && v.trim() ? v.trim().replace(/\/+$/, '') : null
}

/** Master flag — registry resolution is dormant until enabled. Default: off. */
export function isCapabilityRegistryEnabled(): boolean {
  return process.env['CAPABILITY_REGISTRY'] === 'true'
}

/**
 * Provider table. Order = resolution preference: for a capability served by more
 * than one provider, the first CONFIGURED provider in this list wins (fallback).
 * baseUrl is derived live from env; Menlo + Ava reuse existing env vars so this
 * wraps current config rather than introducing parallel settings.
 */
export function providers(): Provider[] {
  return [
    { id: 'crania',      label: 'Crania',              transport: 'mcp',  baseUrl: env('CRANIA_MCP_URL'),        capabilities: ['process.design', 'calc.run'] },
    { id: 'aec',         label: 'Ava-Engineering-Core', transport: 'rest', baseUrl: env('AEC_BASE_URL'),          capabilities: ['calc.run', 'drawing.review', 'engineering.model', 'doc.generate'] },
    { id: 'controlcore', label: 'Ava-ControlCore',     transport: 'rest', baseUrl: env('CONTROLCORE_BASE_URL'),  capabilities: ['plc.generate', 'plc.review'] },
    { id: 'menlo',       label: 'Menlo-Commissioning', transport: 'rest', baseUrl: env('COMMISSIONING_BASE_URL'),capabilities: ['commissioning.procedure', 'commissioning.execute'] },
    { id: 'ava',         label: 'Ava MCP (legacy bridge)', transport: 'mcp', baseUrl: env('AVA_MCP_URL'),        capabilities: ['ava.tools'] },
  ]
}

/** All capability names known to the registry. */
export function listCapabilities(): string[] {
  const set = new Set<string>()
  for (const p of providers()) for (const c of p.capabilities) set.add(c)
  return [...set].sort()
}

/**
 * Resolve a capability to its first configured provider (pure resolver, not
 * flag-gated). Throws UnknownCapabilityError if no provider serves it, or
 * ProviderUnavailableError if providers exist but none are configured.
 */
export function resolveCapability(capability: string): ResolvedProvider {
  const serving = providers().filter(p => p.capabilities.includes(capability))
  if (serving.length === 0) throw new UnknownCapabilityError(capability)
  const configured = serving.find(p => p.baseUrl !== null)
  if (!configured) throw new ProviderUnavailableError(capability)
  return configured as ResolvedProvider
}

export type Resolution =
  | { enabled: true; provider: ResolvedProvider }
  | { enabled: false }

/**
 * Flag-gated resolution for callers. Returns { enabled:false } when the registry
 * flag is off (callers fall back to their existing path). When enabled, resolves
 * or throws the typed errors above.
 */
export function getProviderFor(capability: string): Resolution {
  if (!isCapabilityRegistryEnabled()) return { enabled: false }
  return { enabled: true, provider: resolveCapability(capability) }
}

// ─── Config validation / introspection ────────────────────────────────────────

export interface ProviderStatus {
  id: string
  transport: Transport
  configured: boolean
  capabilities: string[]
}

export interface RegistryValidation {
  enabled: boolean
  providers: ProviderStatus[]
  /** Capabilities whose every serving provider is unconfigured. */
  unresolvableCapabilities: string[]
}

/** Snapshot of registry health — which providers are configured, what's unresolvable. */
export function validateRegistry(): RegistryValidation {
  const provs = providers()
  const status: ProviderStatus[] = provs.map(p => ({
    id: p.id, transport: p.transport, configured: p.baseUrl !== null, capabilities: p.capabilities,
  }))
  const unresolvable = listCapabilities().filter(cap => {
    const serving = provs.filter(p => p.capabilities.includes(cap))
    return serving.every(p => p.baseUrl === null)
  })
  return { enabled: isCapabilityRegistryEnabled(), providers: status, unresolvableCapabilities: unresolvable }
}
