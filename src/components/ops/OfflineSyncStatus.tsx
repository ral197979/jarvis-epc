/**
 * Denver Engineering — Offline Sync Status (v4.35.0)
 * ─────────────────────────────────────────────────────
 * Ava Phase 3 — Shows device sync state, pending mutations,
 * unresolved conflicts, and last sync time.
 * Optimistic UI with offline indicator.
 */
import React, { useEffect, useState, useCallback } from 'react'

interface SyncStatus {
  is_online:         boolean
  pending_mutations: number
  unresolved_conflicts: number
  last_sync_at?:     string
  last_session_id?:  string
}

interface OfflineSyncStatusProps {
  deviceId?: string
  compact?:  boolean
  onSync?:   () => void
}

function _relativeTime(iso?: string): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)    return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

export function OfflineSyncStatus({ deviceId, compact = false, onSync }: OfflineSyncStatusProps) {
  const [status, setStatus]   = useState<SyncStatus>({
    is_online: navigator.onLine, pending_mutations: 0, unresolved_conflicts: 0,
  })
  const [syncing, setSyncing] = useState(false)

  const updateOnlineStatus = useCallback(() => {
    setStatus(prev => ({ ...prev, is_online: navigator.onLine }))
  }, [])

  useEffect(() => {
    window.addEventListener('online',  updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)
    return () => {
      window.removeEventListener('online',  updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [updateOnlineStatus])

  useEffect(() => {
    // Fetch sync status from server
    fetch('/api/v1/sync/conflicts?limit=1')
      .then(r => r.json())
      .then(j => setStatus(prev => ({
        ...prev,
        unresolved_conflicts: j.meta?.count ?? 0,
      })))
      .catch(() => { /* offline */ })
  }, [])

  const handleSync = async () => {
    if (syncing || !status.is_online) return
    setSyncing(true)
    try {
      onSync?.()
      setStatus(prev => ({ ...prev, pending_mutations: 0, last_sync_at: new Date().toISOString() }))
    } finally {
      setSyncing(false)
    }
  }

  const hasIssues  = status.unresolved_conflicts > 0 || status.pending_mutations > 0
  const statusColor = !status.is_online ? '#6b7280'
    : status.unresolved_conflicts > 0   ? '#dc2626'
    : status.pending_mutations > 0      ? '#f97316'
    : '#10b981'

  const statusLabel = !status.is_online          ? 'Offline'
    : status.unresolved_conflicts > 0            ? 'Conflicts'
    : status.pending_mutations > 0               ? 'Pending'
    : 'Synced'

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
        onClick={handleSync} title={`Sync status: ${statusLabel}`}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor,
          ...(status.is_online && !hasIssues ? { boxShadow: '0 0 0 2px #d1fae5' } : {}) }} />
        <span style={{ fontSize: 11, color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', border: `1px solid ${hasIssues ? statusColor : '#e5e7eb'}`,
      borderRadius: 8, padding: 14 }}>
      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor,
          ...(status.is_online ? { boxShadow: `0 0 0 3px ${statusColor}22` } : {}) }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: statusColor }}>{statusLabel}</div>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>
            Last sync: {_relativeTime(status.last_sync_at)}
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing || !status.is_online}
          style={{ padding: '4px 10px', borderRadius: 5, fontSize: 12,
            background: status.is_online ? '#2563eb' : '#f3f4f6',
            color: status.is_online ? '#fff' : '#9ca3af',
            border: 'none', cursor: status.is_online ? 'pointer' : 'default' }}>
          {syncing ? '…' : '↻ Sync'}
        </button>
      </div>

      {/* Metrics */}
      <div style={{ display: 'flex', gap: 16 }}>
        <div>
          <div style={{ fontSize: 10, color: '#9ca3af' }}>Pending</div>
          <div style={{ fontSize: 18, fontWeight: 700,
            color: status.pending_mutations > 0 ? '#f97316' : '#111827' }}>
            {status.pending_mutations}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#9ca3af' }}>Conflicts</div>
          <div style={{ fontSize: 18, fontWeight: 700,
            color: status.unresolved_conflicts > 0 ? '#dc2626' : '#111827' }}>
            {status.unresolved_conflicts}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#9ca3af' }}>Status</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: statusColor, marginTop: 4 }}>
            {status.is_online ? 'Online' : 'Offline'}
          </div>
        </div>
      </div>

      {/* Conflict alert */}
      {status.unresolved_conflicts > 0 && (
        <div style={{ marginTop: 10, padding: '6px 10px', background: '#fef2f2',
          borderRadius: 6, fontSize: 11, color: '#dc2626' }}>
          ⚠ {status.unresolved_conflicts} unresolved sync conflict{status.unresolved_conflicts > 1 ? 's' : ''} —
          {' '}<a href="/sync/conflicts" style={{ color: '#dc2626', textDecoration: 'underline' }}>Review</a>
        </div>
      )}

      {/* Offline notice */}
      {!status.is_online && (
        <div style={{ marginTop: 10, padding: '6px 10px', background: '#f9fafb',
          borderRadius: 6, fontSize: 11, color: '#6b7280' }}>
          Changes saved locally. Will sync when connection restored.
        </div>
      )}
    </div>
  )
}
