import React from 'react'
import { useOfflineQueue } from '../hooks/useOfflineQueue'

export function OfflineBanner() {
  const { isOnline, queueLength, replaying } = useOfflineQueue()

  if (isOnline && queueLength === 0) return null

  if (replaying) {
    return (
      <div role="status" aria-live="polite" style={{ background: 'var(--jarvis-grn,#27ae60)', color: '#fff', padding: '6px 16px', fontSize: 12, fontWeight: 600, textAlign: 'center', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999 }}>
        Syncing {queueLength} offline change{queueLength !== 1 ? 's' : ''}…
      </div>
    )
  }

  if (!isOnline) {
    return (
      <div role="alert" aria-live="assertive" style={{ background: 'var(--jarvis-amb,#f39c12)', color: '#fff', padding: '6px 16px', fontSize: 12, fontWeight: 600, textAlign: 'center', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999 }}>
        ⚡ Offline mode — changes queued ({queueLength} pending)
      </div>
    )
  }

  return null
}
