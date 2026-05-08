/**
 * JARVIS EPC v4 — App Shell
 *
 * Architecture (Phase 20+):
 * ─────────────────────────
 * JarvisCore.jsx is the remaining monolith (currently ~6,479 lines, ratcheted at 6,500).
 * All extracted modules live in src/modules/ and src/components/.
 *
 * Extraction status:
 *   src/modules/auth/          ✅ Extracted — JWT management, policy engine, ARIA announce
 *   src/modules/gateway/       ✅ Extracted — proxied/direct API client
 *   src/modules/persistence/   ✅ Extracted — CRUD layer, undo, validators
 *   src/modules/observability/  ✅ Extracted — slog, activity feed, heartbeat
 *   src/modules/biz/           ✅ Extracted — Zustand store, dispatch, reducer
 *   src/modules/store/         ✅ Extracted — module singleton state
 *   src/components/            ✅ 60+ view components extracted (Phases 11–20)
 *
 * Remaining in JarvisCore.jsx:
 *   - Root component render logic, routing, and top-level state
 *   - Owner panel and settings UI
 *   - Inline style migrations (CSS var() migration is an ongoing TODO)
 *
 * Gateway init: VITE_GATEWAY_MODE and VITE_BACKEND_URL wired in main.jsx (P0-A).
 */

import JarvisCore from './jarvis/JarvisCore.jsx'
import { OfflineBanner } from './components/OfflineBanner'

export default function App() {
  return (
    <>
      <OfflineBanner />
      <JarvisCore />
    </>
  )
}
