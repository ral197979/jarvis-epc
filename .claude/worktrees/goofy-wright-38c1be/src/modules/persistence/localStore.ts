/**
 * JARVIS EPC — localStorage persistence shim
 * ─────────────────────────────────────────────
 * Sprint 7 (v4.31.0): Extracted from JarvisCore.jsx (io var declaration).
 *
 * Provides an async get/set/remove API over localStorage with:
 *   - Automatic "jarvis:" key prefix
 *   - In-memory fallback when localStorage is unavailable
 *   - Silent error handling (never throws — always resolves)
 */

const PREFIX = 'jarvis:'
const mem: Record<string, unknown> = {}

const hasLS = ((): boolean => {
  try {
    const k = '__jarvis_ls_test__'
    localStorage.setItem(k, '1')
    localStorage.removeItem(k)
    return true
  } catch {
    return false
  }
})()

export const io = {
  get<T = unknown>(key: string): Promise<T | null> {
    return new Promise(resolve => {
      try {
        if (hasLS) {
          const raw = localStorage.getItem(PREFIX + key)
          resolve(raw == null ? null : (JSON.parse(raw) as T))
        } else {
          resolve(((mem[key] as T | undefined) ?? null))
        }
      } catch {
        resolve(null)
      }
    })
  },

  set<T>(key: string, value: T): Promise<T | null> {
    return new Promise(resolve => {
      try {
        if (hasLS) localStorage.setItem(PREFIX + key, JSON.stringify(value))
        else mem[key] = value
        resolve(value)
      } catch {
        resolve(null)
      }
    })
  },

  remove(key: string): Promise<boolean> {
    return new Promise(resolve => {
      try {
        if (hasLS) localStorage.removeItem(PREFIX + key)
        else delete mem[key]
        resolve(true)
      } catch {
        resolve(false)
      }
    })
  },
}
