/**
 * Denver Engineering — Universal Object Registry (R4)
 * ─────────────────────────────────────────────────────────────────────────────
 * Makes the contract's identity rule executable (ECOSYSTEM_INTEGRATION_CONTRACT.md
 * §3): every real-world object has ONE immutable UUID minted by its owning system;
 * other systems store REFERENCES only. Denver mints its own object types
 * (organization, project, …) and references AEC/Menlo-owned ones (equipment,
 * instrument, test, …) rather than re-minting them.
 *
 * Pure module — no DB, no schema change. It provides the minting/reference
 * vocabulary other steps build on (R3 event `subject_uuid`, R5 digital-thread /
 * knowledge-graph node keys). Wiring refs into specific tables is a later,
 * per-table step. Flag-gated for future enforcement; the helpers themselves are
 * safe pure utilities.
 */
import { randomUUID } from 'node:crypto'

export type MintingAuthority = 'denver' | 'aec' | 'menlo'

export interface ObjectTypeDef { type: string; authority: MintingAuthority }

/** Registered object types and who mints them (contract §3 minting authority). */
export const OBJECT_TYPES: ObjectTypeDef[] = [
  // Denver — EPC business objects
  { type: 'organization', authority: 'denver' },
  { type: 'project', authority: 'denver' },
  { type: 'building', authority: 'denver' },
  { type: 'area', authority: 'denver' },
  { type: 'contract', authority: 'denver' },
  { type: 'purchase_order', authority: 'denver' },
  { type: 'submittal', authority: 'denver' },
  { type: 'vendor', authority: 'denver' },
  { type: 'work_order', authority: 'denver' },
  { type: 'requirement', authority: 'denver' },
  // AEC — canonical engineering objects
  { type: 'system', authority: 'aec' },
  { type: 'subsystem', authority: 'aec' },
  { type: 'equipment', authority: 'aec' },
  { type: 'instrument', authority: 'aec' },
  { type: 'loop', authority: 'aec' },
  { type: 'io_point', authority: 'aec' },
  { type: 'cable', authority: 'aec' },
  { type: 'panel', authority: 'aec' },
  { type: 'drawing', authority: 'aec' },
  { type: 'calculation', authority: 'aec' },
  { type: 'document', authority: 'aec' },
  // Menlo — execution objects
  { type: 'test', authority: 'menlo' },
  { type: 'issue', authority: 'menlo' },
  { type: 'inspection', authority: 'menlo' },
]

const BY_TYPE = new Map(OBJECT_TYPES.map(o => [o.type, o]))

export class UnknownObjectTypeError extends Error {
  constructor(type: string) { super(`unregistered object type: ${type}`); this.name = 'UnknownObjectTypeError' }
}
export class ForeignMintError extends Error {
  constructor(type: string, authority: MintingAuthority) {
    super(`Denver must not mint '${type}' — owned by ${authority}; reference it instead`)
    this.name = 'ForeignMintError'
  }
}
export class InvalidUuidError extends Error {
  constructor(uuid: string) { super(`invalid uuid: ${uuid}`); this.name = 'InvalidUuidError' }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(s: string): boolean { return UUID_RE.test(s) }

export function isRegisteredType(type: string): boolean { return BY_TYPE.has(type) }
export function listObjectTypes(): string[] { return OBJECT_TYPES.map(o => o.type) }

export function mintingAuthority(type: string): MintingAuthority {
  const def = BY_TYPE.get(type)
  if (!def) throw new UnknownObjectTypeError(type)
  return def.authority
}

/** Flag — reserved for future registry enforcement in business flows. Default off. */
export function isObjectRegistryEnabled(): boolean {
  return process.env['OBJECT_REGISTRY'] === 'true'
}

/** An immutable reference to a registered object. */
export interface ObjectRef {
  type: string
  uuid: string
  authority: MintingAuthority
}

/**
 * Mint a NEW identity. Denver may only mint object types it owns; minting a type
 * owned by AEC/Menlo is a ForeignMintError (enforces "no duplicate identities").
 */
export function mint(type: string): ObjectRef {
  const authority = mintingAuthority(type)         // throws UnknownObjectTypeError
  if (authority !== 'denver') throw new ForeignMintError(type, authority)
  return { type, uuid: randomUUID(), authority }
}

/** Build a reference to an EXISTING object (any authority — incl. AEC/Menlo). */
export function makeRef(type: string, uuid: string): ObjectRef {
  const authority = mintingAuthority(type)         // throws UnknownObjectTypeError
  if (!isUuid(uuid)) throw new InvalidUuidError(uuid)
  return { type, uuid, authority }
}

/** Stable key for graph/thread nodes: `type:uuid`. */
export function refKey(ref: ObjectRef): string { return `${ref.type}:${ref.uuid}` }

/** Inverse of refKey. Throws on unknown type / bad uuid. */
export function parseRef(key: string): ObjectRef {
  const i = key.indexOf(':')
  if (i < 0) throw new UnknownObjectTypeError(key)
  return makeRef(key.slice(0, i), key.slice(i + 1))
}
