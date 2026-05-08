/**
 * JARVIS EPC — Data Export / Import
 * ────────────────────────────────────
 * Sprint 9 (v4.31.0): Extracted from JarvisCore.jsx (_exportAll / _importAll).
 *
 * Encapsulates full-backup export (R-09) and import/restore (R-10) logic.
 * All required state is passed as parameters so this module is side-effect free
 * and fully testable outside React.
 */

import { io } from '../persistence/localStore'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExportPolicy {
  /** Whether the current policy allows data:export */
  exportAllowed:  boolean
  /** Whether the current policy allows data:import */
  importAllowed:  boolean
}

export interface RestoreCallbacks {
  /** Called with the restored bizState */
  onBizState:   (state: Record<string, unknown>) => void
  /** Called with the restored navOrder array */
  onNavOrder?:  (order: string[]) => void
  /** Called with the restored navHidden map */
  onNavHidden?: (hidden: Record<string, boolean>) => void
  /** Called with the restored ownerCfg */
  onOwnerCfg?:  (cfg: Record<string, unknown>) => void
}

// ─── Export ────────────────────────────────────────────────────────────────────

/**
 * exportAll — serialise the current JARVIS state to a downloadable JSON backup.
 *
 * In proxied mode with a valid JWT, exports are fetched from the server and
 * include the full audit trail. In direct mode, a client-side snapshot is used.
 *
 * @param biz           Current biz state
 * @param ownerCfg      Current owner config
 * @param navOrder      Current nav order array
 * @param navHidden     Current nav hidden map
 * @param backendUrl    Function to build a backend URL from a path
 * @param authToken     JWT token (may be null in direct mode)
 * @param isProxied     Whether the gateway is in proxied mode
 * @param policy        Policy snapshot for export permission check
 */
export async function exportAll(
  biz:        Record<string, unknown>,
  ownerCfg:   Record<string, unknown>,
  navOrder:   string[],
  navHidden:  Record<string, boolean>,
  backendUrl: (path: string) => string,
  authToken:  string | null,
  isProxied:  boolean,
  policy:     ExportPolicy,
): Promise<void> {
  // R-17 / R-20: Policy-gated export check (skip for proxied + JWT path)
  if (isProxied && authToken) {
    // INT-10: Server-side export includes audit trail
    try {
      const [stateRes, auditRes] = await Promise.all([
        fetch(backendUrl('/api/v1/state'), { headers: { Authorization: 'Bearer ' + authToken } }).then(r => r.json()),
        fetch(backendUrl('/api/v1/audit/export?format=json'), { headers: { Authorization: 'Bearer ' + authToken } }).then(r => r.json()),
      ])
      const backup = {
        version:      'jarvis-v4-server-backup',
        exported:     new Date().toISOString(),
        state:        stateRes.state,
        stateVersion: stateRes.version,
        audit:        auditRes.entries,
      }
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'jarvis-server-backup-' + new Date().toISOString().slice(0, 10) + '.json'
      a.click()
    } catch (err) {
      alert('Server export failed: ' + (err as Error).message)
    }
    return
  }

  if (!policy.exportAllowed) {
    alert('Exports are currently disabled by policy. Enable in Owner Controls or switch to Owner role.')
    console.warn('[JARVIS] Export blocked by policy')
    return
  }

  try {
    const payload = {
      _jarvis_version:  '4.0',
      _exported_at:     new Date().toISOString(),
      _record_counts: {
        leads:     ((biz.leads     as unknown[]) || []).length,
        contracts: ((biz.contracts as unknown[]) || []).length,
        invoices:  ((biz.invoices  as unknown[]) || []).length,
        actions:   ((biz.action_items as unknown[]) || []).length,
        events:    ((biz.activity_log as unknown[]) || []).length,
      },
      bizState:  biz,
      ownerCfg,
      navOrder,
      navHidden,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'JARVIS_backup_' + new Date().toISOString().slice(0, 10) + '.json'
    a.click()
    URL.revokeObjectURL(a.href)
    console.info('[JARVIS] Full backup exported')
  } catch (ex) {
    console.error('[JARVIS] Export failed:', ex)
    alert('Export failed: ' + (ex as Error).message)
  }
}

// ─── Import ────────────────────────────────────────────────────────────────────

const DANGER_KEYS = ['__proto__', 'constructor', 'prototype']

/**
 * importAll — parse and restore a JARVIS backup file.
 *
 * Validates the file format, guards against prototype pollution, sanitizes
 * the payload, then calls the provided restore callbacks.
 *
 * @param file        File object from <input type="file">
 * @param ownerCfg    Current owner config (for policy check)
 * @param callbacks   Restore callbacks for biz, nav, ownerCfg
 * @param sanitize    Optional sanitizer function (pass _sanitize from modules/persistence)
 * @param announce    Optional accessibility announcement function
 * @param policy      Policy snapshot for import permission check
 */
export function importAll(
  file:      File,
  policy:    ExportPolicy,
  callbacks: RestoreCallbacks,
  sanitize?: (data: unknown) => unknown,
  announce?: (msg: string) => void,
): void {
  if (!file) return

  // R-20: Policy-gated import check
  if (!policy.importAllowed) {
    alert('Imports are disabled by policy. Switch to Owner role.')
    return
  }

  const reader = new FileReader()
  reader.onload = function (ev) {
    try {
      let data = JSON.parse((ev.target as FileReader & { result: string }).result) as Record<string, unknown>

      if (!data._jarvis_version || !data.bizState) {
        alert('Invalid JARVIS backup file.')
        return
      }
      if (!confirm('This will replace ALL current data with the backup from ' + (data._exported_at ?? 'unknown date') + '. Continue?')) return

      // S15-14: Validate imported data structure
      if (typeof data !== 'object' || Array.isArray(data)) {
        announce?.('Invalid backup format')
        return
      }
      for (const dk of Object.keys(data)) {
        if (DANGER_KEYS.indexOf(dk) >= 0) {
          announce?.('Rejected: unsafe key in import')
          console.error('[JARVIS:security] Prototype pollution attempt in import:', dk)
          return
        }
      }

      // Optional sanitization
      if (sanitize) data = sanitize(data) as Record<string, unknown>

      const restored = data.bizState as Record<string, unknown>
      callbacks.onBizState(restored)
      io.set('bizState', restored)

      if (data.navOrder && callbacks.onNavOrder) {
        callbacks.onNavOrder(data.navOrder as string[])
        io.set('navOrder', data.navOrder)
      }
      if (data.navHidden && callbacks.onNavHidden) {
        callbacks.onNavHidden(data.navHidden as Record<string, boolean>)
        io.set('navHidden', data.navHidden)
      }
      if (data.ownerCfg && callbacks.onOwnerCfg) {
        callbacks.onOwnerCfg(data.ownerCfg as Record<string, unknown>)
        try { localStorage.setItem('jarvis:owner_cfg', JSON.stringify(data.ownerCfg)) } catch { /* noop */ }
      }

      console.info('[JARVIS] Data restored from backup:', data._exported_at)
      alert('Data restored successfully from ' + ((data._exported_at as string | undefined) ?? 'backup') + '.')
    } catch (ex) {
      console.error('[JARVIS] Import failed:', ex)
      alert('Import failed: ' + (ex as Error).message)
    }
  }
  reader.readAsText(file)
}
