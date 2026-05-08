/**
 * JARVIS EPC — Pin Utilities
 * ─────────────────────────────
 * Extracted from JarvisCore.jsx Phase 19 — P2-A monolith reduction.
 *
 * Provides PIN hashing and ownerCfg migration logic.
 * These were previously inline in JarvisCore.jsx (_hashPin, _migratePinIfNeeded).
 */

export interface OwnerCfg {
  chatEnabled:    boolean
  writesEnabled:  boolean
  exportsEnabled: boolean
  authEnabled:    boolean
  pinHash:        string
  activeRole:     string
  pin?:           string
  [key: string]:  unknown
}

export const DEFAULT_OWNER_CFG: OwnerCfg = {
  chatEnabled:    true,
  writesEnabled:  true,
  exportsEnabled: true,
  authEnabled:    true,
  pinHash:        '',  // populated via hashPin('0000') at runtime
  activeRole:     'owner',
}

/**
 * hashPin — deterministic hash for PIN storage.
 * Non-cryptographic; sufficient for local config protection.
 * Matches the algorithm previously in JarvisCore._hashPin.
 */
export function hashPin(pin: string): string {
  if (!pin) return ''
  const salted = `jarvis:v4:${pin}:salt`
  let hash = 0
  for (let i = 0; i < salted.length; i++) {
    const chr = salted.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return 'jpin_' + Math.abs(hash).toString(36)
}

/**
 * migratePinIfNeeded — upgrades legacy ownerCfg shapes.
 * R-15: migrate plaintext PINs to hashed.
 * R-21: ensure activeRole exists.
 * R-17: ensure kill-switch fields exist.
 */
export function migratePinIfNeeded(cfg: OwnerCfg): OwnerCfg {
  let changed = false

  // R-15: migrate plaintext PIN
  if (cfg.pin && !cfg.pinHash) {
    cfg.pinHash = hashPin(cfg.pin)
    delete cfg.pin
    changed = true
    console.info('[JARVIS] Migrated plaintext PIN to hash')
  }

  // R-21: ensure activeRole
  if (!cfg.activeRole) {
    cfg.activeRole = 'owner'
    changed = true
  }

  // R-17: ensure kill-switch fields
  if (cfg.writesEnabled === undefined)  { cfg.writesEnabled  = true; changed = true }
  if (cfg.exportsEnabled === undefined) { cfg.exportsEnabled = true; changed = true }

  if (changed) {
    try { localStorage.setItem('jarvis:owner_cfg', JSON.stringify(cfg)) } catch { /* non-fatal */ }
  }

  return cfg
}

/**
 * loadOwnerCfg — load and migrate ownerCfg from localStorage.
 * Returns a valid default if storage is absent or corrupt.
 */
export function loadOwnerCfg(): OwnerCfg {
  try {
    const raw = localStorage.getItem('jarvis:owner_cfg')
    const base: OwnerCfg = {
      ...DEFAULT_OWNER_CFG,
      pinHash: hashPin('0000'),
    }
    return raw ? migratePinIfNeeded(JSON.parse(raw) as OwnerCfg) : base
  } catch {
    return { ...DEFAULT_OWNER_CFG, pinHash: hashPin('0000') }
  }
}
