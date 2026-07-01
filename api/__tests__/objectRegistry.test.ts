/**
 * Tests: api/services/registry/objectRegistry.ts
 *
 * Pure identity/minting rules — no DB. Covers type registration, minting
 * authority, the "Denver mints only its own / references others" rule, uuid
 * validation, ref key round-trip, and flag gating.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isRegisteredType, mintingAuthority, mint, makeRef, refKey, parseRef, isUuid,
  isObjectRegistryEnabled, listObjectTypes,
  UnknownObjectTypeError, ForeignMintError, InvalidUuidError,
} from '../services/registry/objectRegistry'

describe('object type registry', () => {
  it('recognizes registered types and rejects others', () => {
    expect(isRegisteredType('equipment')).toBe(true)
    expect(isRegisteredType('project')).toBe(true)
    expect(isRegisteredType('teleporter')).toBe(false)
  })
  it('reports minting authority and throws on unknown type', () => {
    expect(mintingAuthority('project')).toBe('denver')
    expect(mintingAuthority('equipment')).toBe('crania')
    expect(mintingAuthority('test')).toBe('menlo')
    expect(() => mintingAuthority('nope')).toThrow(UnknownObjectTypeError)
  })
})

describe('mint — Denver mints only its own', () => {
  it('mints a Denver-owned type with a fresh uuid', () => {
    const ref = mint('project')
    expect(ref.type).toBe('project')
    expect(ref.authority).toBe('denver')
    expect(isUuid(ref.uuid)).toBe(true)
  })
  it('generates distinct uuids each call (immutable per object)', () => {
    expect(mint('project').uuid).not.toBe(mint('project').uuid)
  })
  it('refuses to mint a Crania-owned type (reference it instead)', () => {
    expect(() => mint('equipment')).toThrow(ForeignMintError)
  })
  it('refuses to mint a Menlo-owned type', () => {
    expect(() => mint('test')).toThrow(ForeignMintError)
  })
  it('throws on an unregistered type', () => {
    expect(() => mint('wormhole')).toThrow(UnknownObjectTypeError)
  })
})

describe('makeRef — reference an existing object (any authority)', () => {
  const uuid = '11111111-2222-4333-8444-555555555555'
  it('builds a reference to a Crania-owned object', () => {
    expect(makeRef('equipment', uuid)).toEqual({ type: 'equipment', uuid, authority: 'crania' })
  })
  it('rejects a malformed uuid', () => {
    expect(() => makeRef('equipment', 'not-a-uuid')).toThrow(InvalidUuidError)
  })
  it('rejects an unregistered type', () => {
    expect(() => makeRef('gizmo', uuid)).toThrow(UnknownObjectTypeError)
  })
})

describe('refKey / parseRef', () => {
  const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  it('round-trips a reference through its key', () => {
    const ref = makeRef('instrument', uuid)
    const key = refKey(ref)
    expect(key).toBe(`instrument:${uuid}`)
    expect(parseRef(key)).toEqual(ref)
  })
  it('parseRef rejects a keyless string', () => {
    expect(() => parseRef('justtext')).toThrow(UnknownObjectTypeError)
  })
})

describe('flag + introspection', () => {
  beforeEach(() => { delete process.env['OBJECT_REGISTRY'] })
  afterEach(() => { delete process.env['OBJECT_REGISTRY'] })
  it('flag defaults off and reads live', () => {
    expect(isObjectRegistryEnabled()).toBe(false)
    process.env['OBJECT_REGISTRY'] = 'true'
    expect(isObjectRegistryEnabled()).toBe(true)
  })
  it('lists all registered object types', () => {
    const types = listObjectTypes()
    expect(types).toContain('equipment')
    expect(types).toContain('purchase_order')
    expect(types.length).toBeGreaterThanOrEqual(24)
  })
})
