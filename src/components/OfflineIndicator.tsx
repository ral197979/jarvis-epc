/**
 * OfflineIndicator — v4.31.0
 * Small chip showing online/offline state + pending-queue count.
 * Drop into any header/toolbar; self-subscribes to navigator.onLine +
 * pings the queue module every 5s while items are pending.
 */

import React, { useEffect, useState } from 'react'
import { all as allOps, flush, type QueuedOp } from '../modules/offlineQueue'

export function OfflineIndicator() {
  const [online, setOnline]   = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [items, setItems] = useState<QueuedOp[]>([])

  async function refresh() {
    try { setItems(await allOps()) } catch { /* IDB unavailable */ }
  }

  useEffect(() => {
    const onOnline  = () => { setOnline(true);  flush().catch(() => {}); refresh() }
    const onOffline = () => setOnline(false)
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    refresh()
    const id = setInterval(refresh, 5_000)
    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
      clearInterval(id)
    }
  }, [])

  const pending   = items.filter(i => i.status === 'pending').length
  const conflicts = items.filter(i => i.status === 'conflict').length
  const failed    = items.filter(i => i.status === 'failed').length

  // Nothing to show when fully clean and online — stay out of the way.
  if (online && pending === 0 && conflicts === 0 && failed === 0) return null

  const bg =
    !online     ? '#ef4444' :
    failed > 0  ? '#f59e0b' :
    conflicts>0 ? '#a855f7' :
                  '#3b82f6'

  const label =
    !online     ? `Offline · ${pending} queued` :
    failed > 0  ? `${failed} failed · retry` :
    conflicts>0 ? `${conflicts} conflicts` :
                  `Syncing · ${pending}`

  return (
    <button
      onClick={() => flush().then(refresh)}
      title="Click to retry pending sync"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 999,
        background: bg, color: '#fff',
        border: 'none', cursor: 'pointer',
        fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
        fontFamily: 'var(--jarvis-font-mono, monospace)',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: 3, background: '#fff',
        opacity: online ? 0.95 : 0.6,
      }} />
      {label}
    </button>
  )
}

export default OfflineIndicator
