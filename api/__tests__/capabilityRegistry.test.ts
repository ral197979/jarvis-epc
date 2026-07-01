/**
 * Tests: api/services/capabilities/capabilityRegistry.ts
 *
 * Pure config resolution — no DB/IO. Covers capability→provider resolution,
 * ordered fallback, typed errors (unknown capability / no configured provider),
 * the AVA_MCP_URL legacy wrap, flag gating, and registry validation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  resolveCapability, getProviderFor, validateRegistry, listCapabilities,
  UnknownCapabilityError, ProviderUnavailableError,
} from '../services/capabilities/capabilityRegistry'

const PROVIDER_ENVS = [
  'CAPABILITY_REGISTRY', 'CRANIA_MCP_URL',
  'CONTROLCORE_BASE_URL', 'COMMISSIONING_BASE_URL', 'AVA_MCP_URL',
]

describe('capabilityRegistry', () => {
  beforeEach(() => { for (const k of PROVIDER_ENVS) delete process.env[k] })
  afterEach(() => { for (const k of PROVIDER_ENVS) delete process.env[k] })

  it('resolves a capability to its configured provider', () => {
    process.env['CRANIA_MCP_URL'] = 'http://crania:4500'
    const p = resolveCapability('process.design')
    expect(p.id).toBe('crania')
    expect(p.baseUrl).toBe('http://crania:4500')
    expect(p.transport).toBe('mcp')
  })

  it('strips trailing slashes from configured base URLs', () => {
    process.env['CRANIA_MCP_URL'] = 'http://crania:4500///'
    expect(resolveCapability('drawing.review').baseUrl).toBe('http://crania:4500')
  })

  it('resolves engineering capabilities to crania (absorbed from AEC)', () => {
    process.env['CRANIA_MCP_URL'] = 'http://crania:4500'
    expect(resolveCapability('calc.run').id).toBe('crania')
    expect(resolveCapability('drawing.review').id).toBe('crania')
    expect(resolveCapability('engineering.model').id).toBe('crania')
    expect(resolveCapability('doc.generate').id).toBe('crania')
  })

  it('throws UnknownCapabilityError for a capability no provider serves', () => {
    expect(() => resolveCapability('teleport.now')).toThrow(UnknownCapabilityError)
  })

  it('throws ProviderUnavailableError when providers exist but none are configured', () => {
    expect(() => resolveCapability('plc.generate')).toThrow(ProviderUnavailableError)
  })

  it('wraps the legacy AVA_MCP_URL bridge as the ava provider', () => {
    process.env['AVA_MCP_URL'] = 'http://ava:8788'
    const p = resolveCapability('ava.tools')
    expect(p.id).toBe('ava')
    expect(p.baseUrl).toBe('http://ava:8788')
  })

  it('reuses COMMISSIONING_BASE_URL for the menlo provider', () => {
    process.env['COMMISSIONING_BASE_URL'] = 'http://menlo:8787'
    expect(resolveCapability('commissioning.execute').id).toBe('menlo')
  })

  describe('getProviderFor — flag gating', () => {
    it('returns disabled when CAPABILITY_REGISTRY is off', () => {
      process.env['CRANIA_MCP_URL'] = 'http://crania:4500'
      expect(getProviderFor('process.design')).toEqual({ enabled: false })
    })
    it('resolves when the flag is on', () => {
      process.env['CAPABILITY_REGISTRY'] = 'true'
      process.env['CRANIA_MCP_URL'] = 'http://crania:4500'
      const r = getProviderFor('process.design')
      expect(r.enabled).toBe(true)
      if (r.enabled) expect(r.provider.id).toBe('crania')
    })
    it('still throws typed errors when enabled but unresolvable', () => {
      process.env['CAPABILITY_REGISTRY'] = 'true'
      expect(() => getProviderFor('plc.generate')).toThrow(ProviderUnavailableError)
    })
  })

  describe('validateRegistry', () => {
    it('reports configured/unconfigured providers and unresolvable capabilities', () => {
      process.env['CRANIA_MCP_URL'] = 'http://crania:4500'
      const v = validateRegistry()
      expect(v.enabled).toBe(false)
      expect(v.providers.find(p => p.id === 'crania')?.configured).toBe(true)
      expect(v.providers.find(p => p.id === 'controlcore')?.configured).toBe(false)
      // process.design is now resolvable (crania set); plc.generate is not.
      expect(v.unresolvableCapabilities).not.toContain('process.design')
      expect(v.unresolvableCapabilities).toContain('plc.generate')
    })
    it('with nothing configured, every capability is unresolvable', () => {
      const v = validateRegistry()
      expect(v.unresolvableCapabilities.sort()).toEqual(listCapabilities())
    })
  })
})
