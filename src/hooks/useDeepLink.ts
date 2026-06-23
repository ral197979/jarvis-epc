/**
 * Denver Engineering — useDeepLink (v4.41.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Lets a destination view claim a pending deep-link target (set by the Project
 * Copilot's `openRecord`). When the active deep-link matches `source`, the hook
 * returns its `sourceId` once and clears the store target, so the view can open
 * that record as soon as its data loads. Returns null when nothing is pending.
 *
 *   const target = useDeepLink('rfi')
 *   useEffect(() => {
 *     if (target?.sourceId && rfis.length) {
 *       const r = rfis.find(x => x.id === target.sourceId)
 *       if (r) openDetail(r)
 *     }
 *   }, [target, rfis])
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '../modules/store/appSlice'

export interface ClaimedDeepLink { sourceId: string | null; projectId: string | null; parentId: string | null }

export function useDeepLink(source: string): ClaimedDeepLink | null {
  const target = useAppStore(s => s.ui.deepLink)
  const clear  = useAppStore(s => s.clearDeepLink)
  const [claimed, setClaimed] = useState<ClaimedDeepLink | null>(null)

  useEffect(() => {
    if (target && target.source === source) {
      setClaimed({ sourceId: target.sourceId, projectId: target.projectId, parentId: target.parentId ?? null })
      clear()
    }
  }, [target, source, clear])

  return claimed
}
